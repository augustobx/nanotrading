import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseService } from '../../src/storage/database.js';
import { HardBudgetManager } from '../../src/ai/hard-budget-manager.js';
import { RiskCalculator } from '../../src/engine/risk-calculator.js';
import { SignalStateMachine } from '../../src/engine/signal-state-machine.js';
import { Scenario } from '../../src/ai/scenario-types.js';

test('Audit guardrail: provider hard limit survives a process restart', () => {
  const db = new DatabaseService(':memory:');
  try {
    const config = {
      dailyBudgetLimitUsd: 0.10,
      monthlyBudgetLimitUsd: 1.0,
      maxCostPerRequestUsd: 0.10,
      providerLimitsUsd: { openai: 0.04, gemini: 0.10 },
    };
    const first = new HardBudgetManager(config, undefined, db);
    first.recordDirectUsage('OPENAI', 'gpt-4o', 'MARKET_DISCOVERY', 0.03);
    const afterRestart = new HardBudgetManager(config, undefined, db);
    const next = afterRestart.reserveBudget({
      provider: 'OPENAI', model: 'gpt-4o', task: 'MARKET_DISCOVERY',
      maxEstimatedCostUsd: 0.02, estimatedTokens: 1500,
    });
    assert.equal(next.allowed, false, 'No puede ignorar el gasto del proveedor al reiniciar');
    assert.equal(next.violatedLimit, 'PROVIDER_OPENAI');
  } finally {
    db.close();
  }
});

test('Audit guardrail: gross cost and pending reservations cap daily exposure', () => {
  const db = new DatabaseService(':memory:');
  try {
    const cfg = {
      dailyBudgetLimitUsd: 0.05, monthlyBudgetLimitUsd: 1.0,
      maxCostPerRequestUsd: 0.10,
    };
    const budget = new HardBudgetManager(cfg, undefined, db);
    budget.recordDirectUsage('OPENAI', 'gpt-4o', 'MARKET_DISCOVERY', 0.03);
    const first = budget.reserveBudget({
      provider: 'GEMINI', model: 'gemini-2.5-flash', task: 'SCENARIO_REVALIDATION',
      maxEstimatedCostUsd: 0.01, estimatedTokens: 1000,
    });
    assert.equal(first.allowed, true);
    const second = budget.reserveBudget({
      provider: 'OPENAI', model: 'gpt-4o', task: 'MARKET_DISCOVERY',
      maxEstimatedCostUsd: 0.02, estimatedTokens: 1000,
    });
    assert.equal(second.allowed, false);
  } finally {
    db.close();
  }
});

test('Audit guardrail: one risk-sized prospective paper position, recovered with realistic gap loss', () => {
  const db = new DatabaseService(':memory:');
  try {
    const scenario = {
      id: 'paper_audit_1', status: 'ENTRY_VALIDATED', direction: 'LONG',
      symbol: 'BTCUSDT', timeframe: '15m', structureType: 'BOS_TEST',
      stopLossPrice: 59900,
    } as Scenario;
    const sm = new SignalStateMachine(db);
    const calc = RiskCalculator.calculate({
      direction: 'LONG', entryPrice: 60000, stopLossPrice: 59900,
      takeProfitPrice: 60500, accountBalance: 10000,
      riskPercent: 0.1, minRequiredRR: 0,
    });
    assert.ok(calc.isValid);
    const signal = sm.registerSignalFromScenario(scenario, 60000, 'RR_1_4', 60500,
      calc.netRR, calc.netLossUSDT, calc.positionSizeBTC);
    assert.equal(signal.state, 'ENTRY_VALIDATED');
    assert.equal(signal.simulatedEntryTime, undefined);

    const duplicate = sm.registerSignalFromScenario(scenario, 60000, 'RR_1_2', 60300,
      2.1, calc.netLossUSDT, calc.positionSizeBTC);
    assert.equal(duplicate.id, signal.id);
    assert.equal(sm.getActiveSignals().length, 1);

    const recovered = new SignalStateMachine(db);
    assert.equal(recovered.recoverActiveSignals(), 1);
    const restored = recovered.getSignal(signal.id)!;
    assert.equal(restored.riskUsdt, calc.netLossUSDT);
    assert.equal(restored.positionSizeBTC, calc.positionSizeBTC);
    recovered.transition(restored.id, 'ENTRY_TRIGGERED', 'Tick observed');
    recovered.transition(restored.id, 'TRACKING', 'Tracking');
    recovered.transition(restored.id, 'COMPLETED_SL', 'Observed gap', { executionPrice: 59800 });
    assert.equal(restored.exitPrice, 59800);
    assert.ok((restored.realizedNetPnlUsdt || 0) < -calc.netLossUSDT,
      'Un gap adverso debe registrar una pérdida mayor que el SL ideal');
  } finally {
    db.close();
  }
});
