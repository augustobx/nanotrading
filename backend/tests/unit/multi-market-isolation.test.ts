import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseService } from '../../src/storage/database.js';
import { ScenarioRegistry } from '../../src/engine/scenario-registry.js';
import { Scenario } from '../../src/ai/scenario-types.js';
import { SignalStateMachine } from '../../src/engine/signal-state-machine.js';
import { HardBudgetManager } from '../../src/ai/hard-budget-manager.js';

function scenario(symbol: string, id: string): Scenario {
  const now = Date.now();
  return {
    id, symbol, direction: 'LONG', kind: 'TRADE_SCENARIO',
    timeframe: '15m', structureType: 'TEST', proposedBy: 'OPENAI',
    modelsUsed: ['fixture'], snapshotId: `snapshot_${id}`,
    discoveryTimestamp: now, entryZoneMin: 2900, entryZoneMax: 3000,
    targetEntry: 2950, stopLossPrice: 2850,
    target12Price: 3150, target14Price: 3350,
    rrModeAvailable: 'RR_1_4', uncertaintyLevel: 'MEDIUM',
    status: 'SCENARIO_MONITORING', validUntilTimestamp: now + 60 * 60000,
    aiCostUsd: 0, activationConditions: [], invalidationTriggers: [],
    argumentsFor: [], argumentsAgainst: [], createdAt: now, updatedAt: now,
  };
}

test('Market registry loads, queries and mutates scenarios only for its own symbol', () => {
  const db = new DatabaseService(':memory:');
  try {
    const btc = new ScenarioRegistry(db, 'BTCUSDT');
    const eth = new ScenarioRegistry(db, 'ETHUSDT');
    btc.registerScenario(scenario('BTCUSDT', 'BTC_scenario'));
    eth.registerScenario(scenario('ETHUSDT', 'ETH_scenario'));
    assert.deepEqual(btc.getAllActive().map(s => s.symbol), ['BTCUSDT']);
    assert.deepEqual(eth.getAllActive().map(s => s.symbol), ['ETHUSDT']);
    assert.deepEqual(db.getScenarios({ symbol: 'ETHUSDT' }).map(s => s.id), ['ETH_scenario']);
    assert.equal(btc.getScenario('ETH_scenario'), null);
    assert.equal(eth.getScenario('BTC_scenario'), null);
    assert.throws(() => eth.registerScenario(scenario('BTCUSDT', 'cross_market')),
      /mismatches isolated registry/);
    const recoveredBtc = new ScenarioRegistry(db, 'BTCUSDT');
    const recoveredEth = new ScenarioRegistry(db, 'ETHUSDT');
    assert.deepEqual(recoveredBtc.getAllActive().map(s => s.id), ['BTC_scenario']);
    assert.deepEqual(recoveredEth.getAllActive().map(s => s.id), ['ETH_scenario']);
  } finally { db.close(); }
});

test('ETH discovery scheduler settings persist independently without touching legacy BTC scheduler', () => {
  const db = new DatabaseService(':memory:');
  try {
    const before = db.getDiscoverySchedulerConfig('BTCUSDT');
    const eth = db.getDiscoverySchedulerConfig('ETHUSDT');
    assert.equal(before.intervalMinutes, 60);
    assert.equal(eth.intervalMinutes, 120);
    assert.equal(eth.triggerOn1hClose, false);
    db.saveDiscoverySchedulerConfig({
      ...eth, enabled: false, intervalMinutes: 180,
      triggerOn1hClose: false,
    }, 'ETHUSDT');
    assert.equal(db.getDiscoverySchedulerConfig('ETHUSDT').enabled, false);
    assert.equal(db.getDiscoverySchedulerConfig('ETHUSDT').intervalMinutes, 180);
    assert.equal(db.getDiscoverySchedulerConfig('BTCUSDT').enabled, before.enabled);
    assert.equal(db.getDiscoverySchedulerConfig('BTCUSDT').intervalMinutes, 60);
  } finally { db.close(); }
});

test('Active paper signal recovery and persisted history are symbol-separated', () => {
  const db = new DatabaseService(':memory:');
  try {
    for (const symbol of ['BTCUSDT', 'ETHUSDT']) {
      db.saveSignal({
        id: `sig_${symbol}`, setupId: `setup_${symbol}`,
        timestamp: Date.now(), createdAt: Date.now(),
        symbol, strategy: 'TEST', direction: 'LONG', timeframe: '15m',
        entryPrice: 3000, stopLoss: 2900, takeProfit: 3400, rrNet: 4,
        consensusVerdict: 'AUTHORIZED', status: 'TRACKING',
      });
    }
    const btc = new SignalStateMachine(db, 'BTCUSDT');
    const eth = new SignalStateMachine(db, 'ETHUSDT');
    assert.equal(btc.recoverActiveSignals(), 1);
    assert.equal(eth.recoverActiveSignals(), 1);
    assert.deepEqual(btc.getActiveSignals().map(s => s.symbol), ['BTCUSDT']);
    assert.deepEqual(eth.getActiveSignals().map(s => s.symbol), ['ETHUSDT']);
    assert.deepEqual(db.getSignals(50, 'ETHUSDT').map(s => s.symbol), ['ETHUSDT']);
    assert.deepEqual(db.getSignals(50, 'BTCUSDT').map(s => s.symbol), ['BTCUSDT']);
  } finally { db.close(); }
});

test('One shared hard budget refuses extra reservations across BTC and ETH', () => {
  const db = new DatabaseService(':memory:');
  const budget = new HardBudgetManager({
    dailyBudgetLimitUsd: 0.05, monthlyBudgetLimitUsd: 0.05,
    maxCostPerRequestUsd: 0.05, providerLimitsUsd: { openai: 0.05, gemini: 0.05 },
  }, undefined, db);
  try {
    const btc = budget.reserveBudget({
      provider: 'OPENAI', model: 'gpt-4o', task: 'MARKET_DISCOVERY',
      estimatedTokens: 1000, maxEstimatedCostUsd: 0.04,
    });
    assert.equal(btc.allowed, true);
    const eth = budget.reserveBudget({
      provider: 'GEMINI', model: 'gemini-2.5-flash', task: 'MARKET_DISCOVERY',
      estimatedTokens: 1000, maxEstimatedCostUsd: 0.04,
    });
    assert.equal(eth.allowed, false);
    assert.equal(budget.getReservedPendingUsd() >= 0.04, true);
    assert.equal(budget.getConfig().monthlyBudgetLimitUsd, 0.05);
  } finally { db.close(); }
});
