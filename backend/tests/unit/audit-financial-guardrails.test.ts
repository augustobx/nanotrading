import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseService } from '../../src/storage/database.js';
import { HardBudgetManager } from '../../src/ai/hard-budget-manager.js';
import { RiskCalculator } from '../../src/engine/risk-calculator.js';
import { BacktestEngine } from '../../src/backtest/backtest-engine.js';
import { HistoricalDataManager } from '../../src/backtest/historical-data-manager.js';
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

test('Audit backtest: a winning trade compounds capital and resizes subsequent position', () => {
  const db = new DatabaseService(':memory:');
  try {
    const engine = new BacktestEngine(new HistoricalDataManager({} as any, db, 'BTCUSDT'), db);
    const common: any = {
      runId: 'audit-compound', symbol: 'BTCUSDT',
      strategy: 'STRATEGY_A_TREND_CONTINUATION',
      direction: 'LONG', ratioTarget: 'RR_1_4', timeframe: '15m',
      entryPrice: 60000, stopLossPrice: 59900, takeProfitPrice: 61000,
      mfePrice: 61000, mfeR: 4, maePrice: 59950, maeR: 0.5,
      durationMs: 1000, isInSample: true, feesUsdt: 0,
      spreadCostUsdt: 0, slippageCostUsdt: 0, initialRiskUsdt: 100,
      positionSizeBtc: 0.5, grossPnlUsdt: 0,
    };
    const trades = [
      { ...common, id: 'win', entryTimestamp: 1000, exitTimestamp: 2000,
        exitPrice: 61000, outcome: 'TAKE_PROFIT',
        realizedNetPnlUsdt: 500, realizedNetR: 4 },
      { ...common, id: 'loss', entryTimestamp: 3000, exitTimestamp: 4000,
        exitPrice: 59900, outcome: 'STOP_LOSS',
        realizedNetPnlUsdt: -100, realizedNetR: -1 },
    ];
    const result = (engine as any).simulateCombinedPortfolio(trades, 10000, 30, 1, 0.0002, 0.00055, 0.1, 0.0002);
    assert.equal(result.executedTrades.length, 2);
    const [first, second] = result.executedTrades;
    assert.ok(first.realizedNetPnlUsdt > 0);
    assert.ok(second.capitalBeforeUsdt > first.capitalBeforeUsdt);
    assert.ok(second.positionSizeBtc > first.positionSizeBtc,
      'El riesgo del segundo trade se recalcula desde el nuevo capital');
    assert.equal(second.capitalBeforeUsdt, first.capitalAfterUsdt);
    assert.ok(result.metrics.maxDrawdownPct > 0);
  } finally {
    db.close();
  }
});
