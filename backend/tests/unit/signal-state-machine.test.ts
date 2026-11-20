import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseService } from '../../src/storage/database.js';
import { SignalStateMachine, SignalInstance } from '../../src/engine/signal-state-machine.js';
import { ConsensusResult } from '../../src/ai/types.js';

test('SignalStateMachine - Valid transitions and lifecycle persistence', () => {
  const db = new DatabaseService(':memory:');
  const sm = new SignalStateMachine(db);

  const consensus: ConsensusResult = {
    signalId: 'sig_test_1',
    setupId: 'setup_trend_1',
    timestamp: Date.now(),
    symbol: 'BTCUSDT',
    strategy: 'STRATEGY_A_TREND_CONTINUATION',
    direction: 'LONG',
    timeframe: '15m',
    entryPrice: 65000,
    stopLossPrice: 64500,
    takeProfitPrice: 67100,
    grossRR: 4.2,
    netRR: 4.1,
    consensusVerdict: 'AUTHORIZED',
    status: 'ACTIVE',
    snapshotId: 'snap_1',
    executionMode: 'SIGNALS_ONLY',
    ruleViolations: [],
    confidenceScore: 85,
    evaluatedAt: Date.now(),
  };

  const signal = sm.registerSignalFromConsensus(consensus);
  assert.equal(signal.state, 'ENTRY_VALIDATED');
  assert.equal(signal.direction, 'LONG');
  assert.equal(signal.netRR, 4.1);

  // Transition to ALERT_SENT
  sm.transition(signal.id, 'ALERT_SENT', 'Alertas enviadas');
  assert.equal(signal.state, 'ALERT_SENT');

  // Transition to ENTRY_TRIGGERED
  sm.transition(signal.id, 'ENTRY_TRIGGERED', 'Precio alcanzó entrada');
  assert.equal(signal.state, 'ENTRY_TRIGGERED');
  assert.equal(signal.entryMode, 'SIMULATED_PAPER_ENTRY');
  assert.ok(signal.simulatedEntryTime! > 0);

  // Transition to TRACKING
  sm.transition(signal.id, 'TRACKING', 'Posición activa en seguimiento');
  assert.equal(signal.state, 'TRACKING');

  // Update MFE and MAE
  sm.updatePriceMetrics(signal.id, 65500, 66000, 64900);
  assert.equal(signal.mfePrice, 66000);
  assert.equal(signal.mfeR, 2.0); // (66000 - 65000) / 500 = 2.0R
  assert.equal(signal.maePrice, 64900);
  assert.equal(signal.maeR, -0.2); // (64900 - 65000) / 500 = -0.2R

  // Transition to COMPLETED_TP
  sm.transition(signal.id, 'COMPLETED_TP', 'Take Profit tocado');
  assert.equal(signal.state, 'COMPLETED_TP');
  assert.equal(signal.realizedNetR, 4.1);
  assert.equal(signal.realizedNetPnlUsdt, 410.0); // 100 USDT risk * 4.1

  // Verify lifecycle records in DB
  const history = db.getSignalLifecycle(signal.id);
  assert.ok(history.length >= 4);
  assert.equal(history[0].fromState, 'SETUP_DETECTED');
  assert.equal(history[0].toState, 'ENTRY_VALIDATED');

  db.close();
});

test('SignalStateMachine - Invalid transitions throw strict errors', () => {
  const db = new DatabaseService(':memory:');
  const sm = new SignalStateMachine(db);

  const consensus: ConsensusResult = {
    signalId: 'sig_test_inv',
    setupId: 'setup_trend_inv',
    timestamp: Date.now(),
    symbol: 'BTCUSDT',
    strategy: 'STRATEGY_A_TREND_CONTINUATION',
    direction: 'LONG',
    timeframe: '15m',
    entryPrice: 65000,
    stopLossPrice: 64500,
    takeProfitPrice: 67100,
    grossRR: 4.2,
    netRR: 4.1,
    consensusVerdict: 'AUTHORIZED',
    status: 'ACTIVE',
    snapshotId: 'snap_inv',
    executionMode: 'SIGNALS_ONLY',
    ruleViolations: [],
    confidenceScore: 85,
    evaluatedAt: Date.now(),
  };

  const signal = sm.registerSignalFromConsensus(consensus);
  assert.equal(signal.state, 'ENTRY_VALIDATED');

  // Jumping directly from ENTRY_VALIDATED to COMPLETED_TP without fill must throw
  assert.throws(() => {
    sm.transition(signal.id, 'COMPLETED_TP', 'Salto ilegal');
  }, /Transición inválida de estado/);

  // Transition to COMPLETED_SL from terminal state must throw
  sm.transition(signal.id, 'CANCELLED', 'Cancelación');
  assert.throws(() => {
    sm.transition(signal.id, 'TRACKING', 'Revivir señal');
  }, /Transición inválida de estado/);

  db.close();
});

test('SignalStateMachine - Stop Loss hit calculates net -1.0R loss', () => {
  const db = new DatabaseService(':memory:');
  const sm = new SignalStateMachine(db);

  const consensus: ConsensusResult = {
    signalId: 'sig_test_sl',
    setupId: 'setup_trend_sl',
    timestamp: Date.now(),
    symbol: 'BTCUSDT',
    strategy: 'STRATEGY_B_LIQUIDITY_SWEEP',
    direction: 'SHORT',
    timeframe: '15m',
    entryPrice: 65000,
    stopLossPrice: 65500,
    takeProfitPrice: 62900,
    grossRR: 4.2,
    netRR: 4.05,
    consensusVerdict: 'AUTHORIZED',
    status: 'ACTIVE',
    snapshotId: 'snap_sl',
    executionMode: 'SIGNALS_ONLY',
    ruleViolations: [],
    confidenceScore: 80,
    evaluatedAt: Date.now(),
  };

  const signal = sm.registerSignalFromConsensus(consensus);
  sm.transition(signal.id, 'ENTRY_TRIGGERED');
  sm.transition(signal.id, 'TRACKING');

  // Short position adverse excursion
  sm.updatePriceMetrics(signal.id, 65300, 65400, 64900);
  assert.equal(signal.mfeR, 0.2); // (65000 - 64900) / 500 = 0.2R
  assert.equal(signal.maeR, -0.8); // (65000 - 65400) / 500 = -0.8R adverse

  sm.transition(signal.id, 'COMPLETED_SL', 'Stop Loss tocado');
  assert.equal(signal.state, 'COMPLETED_SL');
  assert.equal(signal.realizedNetR, -1.0);
  assert.equal(signal.realizedNetPnlUsdt, -100.0);

  db.close();
});

test('SignalStateMachine - Recovery from DB on reboot restores active signals', () => {
  const db = new DatabaseService(':memory:');
  const sm1 = new SignalStateMachine(db);

  const consensus: ConsensusResult = {
    signalId: 'sig_reboot_1',
    setupId: 'setup_reboot',
    timestamp: Date.now(),
    symbol: 'BTCUSDT',
    strategy: 'STRATEGY_A_TREND_CONTINUATION',
    direction: 'LONG',
    timeframe: '15m',
    entryPrice: 65000,
    stopLossPrice: 64500,
    takeProfitPrice: 67100,
    grossRR: 4.2,
    netRR: 4.1,
    consensusVerdict: 'AUTHORIZED',
    status: 'ACTIVE',
    snapshotId: 'snap_reboot',
    executionMode: 'SIGNALS_ONLY',
    ruleViolations: [],
    confidenceScore: 85,
    evaluatedAt: Date.now(),
  };

  const signal = sm1.registerSignalFromConsensus(consensus);
  sm1.transition(signal.id, 'ENTRY_TRIGGERED');
  sm1.transition(signal.id, 'TRACKING');

  // Create a second fresh instance connected to the same DB (simulating restart)
  const sm2 = new SignalStateMachine(db);
  assert.equal(sm2.getActiveSignals().length, 0);

  const recoveredCount = sm2.recoverActiveSignals();
  assert.equal(recoveredCount, 1);
  assert.equal(sm2.getActiveSignals().length, 1);

  const recoveredSignal = sm2.getSignal('sig_reboot_1');
  assert.ok(recoveredSignal);
  assert.equal(recoveredSignal.state, 'TRACKING');
  assert.equal(recoveredSignal.entryPrice, 65000);

  db.close();
});

test('SignalStateMachine - Kill Switch cancelAll terminates all active non-terminal signals', () => {
  const db = new DatabaseService(':memory:');
  const sm = new SignalStateMachine(db);

  const makeConsensus = (id: string): ConsensusResult => ({
    signalId: id,
    setupId: `setup_${id}`,
    timestamp: Date.now(),
    symbol: 'BTCUSDT',
    strategy: 'STRATEGY_A_TREND_CONTINUATION',
    direction: 'LONG',
    timeframe: '15m',
    entryPrice: 65000,
    stopLossPrice: 64500,
    takeProfitPrice: 67100,
    grossRR: 4.2,
    netRR: 4.1,
    consensusVerdict: 'AUTHORIZED',
    status: 'ACTIVE',
    snapshotId: `snap_${id}`,
    executionMode: 'SIGNALS_ONLY',
    ruleViolations: [],
    confidenceScore: 85,
    evaluatedAt: Date.now(),
  });

  const s1 = sm.registerSignalFromConsensus(makeConsensus('sig_ks_1'));
  const s2 = sm.registerSignalFromConsensus(makeConsensus('sig_ks_2'));
  sm.transition(s2.id, 'ENTRY_TRIGGERED');
  sm.transition(s2.id, 'TRACKING');

  assert.equal(sm.getActiveSignals().length, 2);

  const cancelledCount = sm.cancelAll('EMERGENCY_KILL_SWITCH');
  assert.equal(cancelledCount, 2);
  assert.equal(sm.getActiveSignals().length, 0);
  assert.equal(s1.state, 'CANCELLED');
  assert.equal(s2.state, 'CANCELLED');

  db.close();
});
