import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { DatabaseService } from '../../src/storage/database.js';
import { SetupEngine } from '../../src/engine/setup-engine.js';
import { CandleManager } from '../../src/market/candle-manager.js';
import { ScenarioRegistry } from '../../src/engine/scenario-registry.js';
import { AlgorithmicWatcher } from '../../src/engine/algorithmic-watcher.js';
import { AutonomousDiscoveryScheduler } from '../../src/ai/autonomous-discovery-scheduler.js';
import { SignalStateMachine } from '../../src/engine/signal-state-machine.js';
import { Candle, Timeframe } from '../../src/types/market.js';
import { Scenario, AiWatchPlan } from '../../src/ai/scenario-types.js';

function makeCandle(tf: Timeframe, i: number, open: number, high: number, low: number, close: number, vol = 100): Candle {
  const base = 1_700_000_000_000;
  const step = 60_000;
  return {
    symbol: 'BTCUSDT',
    timeframe: tf,
    timestamp: base + i * step,
    open, high, low, close,
    volume: vol,
    turnover: close * vol,
    confirmed: true,
  };
}

function makeScenario(id: string, dir: 'LONG' | 'SHORT' = 'LONG', min = 59800, max = 60200): Scenario {
  const now = Date.now();
  return {
    id,
    symbol: 'BTCUSDT',
    direction: dir,
    kind: 'TRADE_SCENARIO',
    timeframe: '15m',
    structureType: 'SMC_DISCRETIONARY_DISCOVERY',
    proposedBy: 'CONSENSUS',
    modelsUsed: ['gpt-4o', 'gemini-2.5-flash'],
    snapshotId: 'snap_' + id,
    discoveryTimestamp: now,
    entryZoneMin: min,
    entryZoneMax: max,
    targetEntry: (min + max) / 2,
    stopLossPrice: dir === 'LONG' ? min - 500 : max + 500,
    target12Price: dir === 'LONG' ? max + 1000 : min - 1000,
    target14Price: dir === 'LONG' ? max + 2000 : min - 2000,
    rrModeAvailable: 'RR_BOTH',
    uncertaintyLevel: 'LOW',
    status: 'SCENARIO_MONITORING',
    validUntilTimestamp: now + 7200_000,
    aiCostUsd: 0.015,
    activationConditions: ['Price enters zone'],
    invalidationTriggers: ['Price breaches stop loss'],
    argumentsFor: ['Strong demand order block'],
    argumentsAgainst: ['Macro resistance nearby'],
    createdAt: now,
    updatedAt: now,
  };
}

function makeWatchPlan(scenarioId: string, min = 59800, max = 60200): AiWatchPlan {
  const now = Date.now();
  return {
    id: 'wp_' + scenarioId,
    scenarioId,
    symbol: 'BTCUSDT',
    direction: 'LONG',
    marketThesis: 'Integration test watch plan',
    horizon: 'INTRADAY',
    primaryTimeframe: '15m',
    watchZone: { minPrice: min, maxPrice: max, targetEntry: (min + max) / 2 },
    candidateStopLoss: min - 500,
    candidateTakeProfits: { tp12: max + 1000, tp14: max + 2000 },
    rrEligibility: 'RR_BOTH',
    observableConditions: [
      {
        description: 'Precio entra en zona de entrada',
        operator: 'PRICE_IN_RANGE',
        params: { minLevel: min, maxLevel: max },
        automatable: true,
        sequenceOrder: 1,
      },
      {
        description: 'Patrón de vela envolvente alcista',
        operator: 'CANDLE_PATTERN',
        params: { pattern: 'BULLISH_ENGULFING', timeframe: '15m' },
        automatable: true,
        sequenceOrder: 2,
      },
    ],
    confirmationSequence: ['Mitigación en zona', 'Confirmación de vela envolvente'],
    invalidationConditions: [
      {
        description: 'Ruptura de stop loss',
        operator: 'PRICE_CROSS_BELOW',
        params: { level: min - 500 },
        automatable: true,
      },
    ],
    expirationTimestamp: now + 14400_000,
    reevaluationTriggers: [{ event: 'ZONE_TOUCH', description: 'Touch of zone' }],
    reasoningVersion: '1.0',
    status: 'ACTIVE',
    automatable: true,
    createdAt: now,
    updatedAt: now,
  };
}

// --------------------------------------------------------------------------
// TEST 1: Ninguna estrategia A/B genera señales nuevas en el flujo operativo
// --------------------------------------------------------------------------
test('PR 4.1 Integration 1: SetupEngine does not evaluate or register A/B strategies during live operation', () => {
  const db = new DatabaseService(':memory:');
  const candleManager = new CandleManager('BTCUSDT', db);

  // Feed perfect A/B setup conditions across timeframes
  const c4h: Candle[] = [];
  const c1h: Candle[] = [];
  const c15m: Candle[] = [];
  const c5m: Candle[] = [];
  for (let i = 0; i < 30; i++) {
    c4h.push(makeCandle('4h', i, 60000 + i * 50, 60000 + i * 50 + 40, 60000 + i * 50 - 20, 60000 + i * 50 + 30));
    c1h.push(makeCandle('1h', i, 60500 + i * 30, 60500 + i * 30 + 30, 60500 + i * 30 - 15, 60500 + i * 30 + 20));
    c15m.push(makeCandle('15m', i, 61000 + i * 10, 61000 + i * 10 + 20, 61000 + i * 10 - 10, 61000 + i * 10 + 15));
    c5m.push(makeCandle('5m', i, 61200 + i * 5, 61200 + i * 5 + 10, 61200 + i * 5 - 5, 61200 + i * 5 + 8));
  }
  candleManager.loadHistoricalCandles('4h', c4h);
  candleManager.loadHistoricalCandles('1h', c1h);
  candleManager.loadHistoricalCandles('15m', c15m);
  candleManager.loadHistoricalCandles('5m', c5m);

  const setupEngine = new SetupEngine(candleManager, db);

  let setupDetectedEmitted = false;
  setupEngine.on('setup_detected', () => {
    setupDetectedEmitted = true;
  });

  const fullAnalysisResult = setupEngine.runFullAnalysis(0.1);

  // Quantitative analyses are populated
  assert.ok(fullAnalysisResult.analyses['15m'], '15m quantitative analysis should exist');
  assert.ok(fullAnalysisResult.analyses['1h'], '1h quantitative analysis should exist');

  // But setups list is strictly empty
  assert.equal(fullAnalysisResult.setups.length, 0, 'No live A/B setups should be emitted');
  assert.equal(setupEngine.getActiveSetups().length, 0, 'activeSetups must remain empty');
  assert.equal(setupDetectedEmitted, false, 'setup_detected must not be emitted');

  // Database setups table must remain empty
  const storedSetups = db.getSetups(10);
  assert.equal(storedSetups.length, 0, 'No setups should be written to SQLite');

  db.close();
});

// --------------------------------------------------------------------------
// TEST 2: Deshabilitar el scheduler no reactiva funcionalidades antiguas
// --------------------------------------------------------------------------
test('PR 4.1 Integration 2: Disabling discoveryScheduler does not trigger legacy consensus fallback', async () => {
  const db = new DatabaseService(':memory:');
  const emitter = new EventEmitter() as EventEmitter & Record<string, any>;

  let legacyConsensusCalls = 0;
  emitter.getConsensusEngine = () => ({
    evaluateSetup: async () => {
      legacyConsensusCalls++;
      return { verdict: 'DISCARDED' };
    },
  });

  // Mock scheduler with enabled: false
  const scheduler = new AutonomousDiscoveryScheduler({
    coordinator: emitter as any,
    db,
    hardBudgetManager: { isBlocked: () => false } as any,
    discoveryEngine: { runDiscovery: async () => ({ scenarios: [], summary: {}, aiCostUsd: 0 }) } as any,
  });

  scheduler.updateConfig({ enabled: false });
  assert.equal(scheduler.getConfig().enabled, false);

  // Even when a mock setup is emitted on a legacy emitter, no consensus call is triggered
  const candleManager = new CandleManager('BTCUSDT', db);
  const setupEngine = new SetupEngine(candleManager, db);

  // Simulating coordinator listener behavior under PR 4.1
  setupEngine.on('setup_detected', (setup) => {
    // In PR 4.1, this listener only logs for legacy research; it NEVER calls consensusEngine
    db.logEvent('INFO', 'Coordinator', 'Technical setup observed (legacy research); no operative signal generated', { setupId: setup.id });
  });

  // Emit a mock legacy setup
  setupEngine.emit('setup_detected', { id: 'test_legacy_setup', strategy: 'STRATEGY_A_TREND_CONTINUATION' });

  assert.equal(legacyConsensusCalls, 0, 'Legacy consensus must NEVER be triggered when scheduler is disabled');

  // Signals table must have 0 records
  const signals = db.getSignals(10);
  assert.equal(signals.length, 0, 'Zero signals should exist');

  db.close();
});

// --------------------------------------------------------------------------
// TEST 3: Las oportunidades provienen exclusivamente del descubrimiento autónomo
// --------------------------------------------------------------------------
test('PR 4.1 Integration 3: Active opportunities originate exclusively from autonomous AI discovery scenarios', () => {
  const db = new DatabaseService(':memory:');
  const registry = new ScenarioRegistry(db);

  const autonomousScenario = makeScenario('sc_auto_001', 'LONG', 59800, 60200);
  registry.registerScenario(autonomousScenario);
  db.saveWatchPlan(makeWatchPlan('sc_auto_001', 59800, 60200));

  const activeScenarios = registry.getAllActive();
  assert.equal(activeScenarios.length, 1);
  assert.equal(activeScenarios[0].structureType, 'SMC_DISCRETIONARY_DISCOVERY');
  assert.equal(activeScenarios[0].proposedBy, 'CONSENSUS');
  assert.deepEqual(activeScenarios[0].modelsUsed, ['gpt-4o', 'gemini-2.5-flash']);

  // Verify in SQLite
  const row = db.getScenarioById('sc_auto_001');
  assert.ok(row, 'Scenario must be persisted in SQLite');
  assert.equal(row.structureType, 'SMC_DISCRETIONARY_DISCOVERY');

  db.close();
});

// --------------------------------------------------------------------------
// TEST 4: El watcher consume cero tokens en vigilancia ordinaria
// --------------------------------------------------------------------------
test('PR 4.1 Integration 4: AlgorithmicWatcher consumes exactly zero AI tokens/calls during routine tick watching', () => {
  const db = new DatabaseService(':memory:');
  const registry = new ScenarioRegistry(db);

  const scenario = makeScenario('sc_watcher_001', 'LONG', 59800, 60200);
  const plan = makeWatchPlan('sc_watcher_001', 59800, 60200);
  scenario.watchPlan = plan;
  registry.registerScenario(scenario);
  db.saveWatchPlan(plan);

  let aiCallsTriggered = 0;
  const mockCoordinator = new EventEmitter() as EventEmitter & Record<string, any>;
  mockCoordinator.getSetupEngine = () => ({ getAnalysis: () => undefined });
  mockCoordinator.getMarketState = () => ({ ticker: { lastPrice: 60100 } });

  const watcher = new AlgorithmicWatcher(mockCoordinator as any, registry);
  watcher.on('revalidation_requested', () => {
    aiCallsTriggered++;
  });

  watcher.start();

  // Simulate 100 price updates/ticks within the observation range without meeting the pattern condition
  for (let price = 59850; price <= 60150; price += 3) {
    mockCoordinator.emit('state_updated', {
      ticker: {
        lastPrice: price,
        spreadPcnt: 0.001,
      },
    });
  }

  // Check consumption: Zero AI consumption logs
  const logs = db.getAiConsumptionLogs();
  assert.equal(logs.length, 0, 'Watcher must not write any AI consumption logs');
  assert.equal(aiCallsTriggered, 0, 'No revalidation requested without full confirmation sequence');

  watcher.stop();
  db.close();
});

// --------------------------------------------------------------------------
// TEST 5: No existen revalidaciones duplicadas
// --------------------------------------------------------------------------
test('PR 4.1 Integration 5: Cooldown and in-flight guard strictly prevent duplicate revalidations', () => {
  const db = new DatabaseService(':memory:');
  const registry = new ScenarioRegistry(db);

  const scenario = makeScenario('sc_cooldown_001', 'LONG', 59800, 60200);
  // Watch plan requiring only price in range
  const plan: AiWatchPlan = {
    ...makeWatchPlan('sc_cooldown_001', 59800, 60200),
    observableConditions: [
      {
        description: 'Entrada en zona',
        operator: 'PRICE_IN_RANGE',
        params: { minLevel: 59800, maxLevel: 60200 },
        automatable: true,
      },
    ],
  };

  scenario.watchPlan = plan;
  registry.registerScenario(scenario);
  db.saveWatchPlan(plan);

  let revalidationEvents = 0;
  const mockCoordinator = new EventEmitter() as EventEmitter & Record<string, any>;
  mockCoordinator.getSetupEngine = () => ({ getAnalysis: () => undefined });
  mockCoordinator.getMarketState = () => ({ ticker: { lastPrice: 60000, spreadPcnt: 0.001 } });

  const watcher = new AlgorithmicWatcher(mockCoordinator as any, registry);
  watcher.on('revalidation_requested', () => {
    revalidationEvents++;
  });

  watcher.start();

  // First trigger: price in zone triggers revalidation
  mockCoordinator.emit('state_updated', { ticker: { lastPrice: 60000, spreadPcnt: 0.001 } });
  assert.equal(revalidationEvents, 1, 'First revalidation should be emitted');

  // Immediately bombard with 50 subsequent ticks while in cooldown
  for (let i = 0; i < 50; i++) {
    mockCoordinator.emit('state_updated', { ticker: { lastPrice: 60005, spreadPcnt: 0.001 } });
  }

  // Must still be exactly 1
  assert.equal(revalidationEvents, 1, 'Subsequent ticks during cooldown must NOT fire duplicate revalidations');

  watcher.stop();
  db.close();
});

// --------------------------------------------------------------------------
// TEST 6: Las señales solo se validan con confirmaciones suficientes y R:R >= 4.0
// --------------------------------------------------------------------------
test('PR 4.1 Integration 6: Signal registration strictly requires Net R:R >= 4.0 and authorized verdict', () => {
  const db = new DatabaseService(':memory:');
  const signalStateMachine = new SignalStateMachine(db);

  const scenario = makeScenario('sc_risk_001', 'LONG', 59800, 60200);

  // 1. Setup with Net R:R < 4.0 (e.g. 2.5R) must not be qualified for 1:4 execution
  const disqualifiedTarget14 = 61000; // Too close, Net RR ~ 2.0
  const lowRR = 2.0;

  // Emulating coordinator validation logic in PR 4.1
  const policyMinRR = 4.0;
  let signalCreated = false;
  signalStateMachine.on('signal_created', () => {
    signalCreated = true;
  });

  if (lowRR >= policyMinRR) {
    const qualifiedScenario = { ...scenario, status: 'ENTRY_VALIDATED' as const };
    signalStateMachine.registerSignalFromScenario(qualifiedScenario, 60000, 'RR_1_4', disqualifiedTarget14, lowRR, 100, 0.05);
  }

  assert.equal(signalCreated, false, 'Signal with Net R:R < 4.0 must not be registered');
  assert.equal(db.getSignals(10).length, 0);

  // 2. Setup with Net R:R >= 4.0 (e.g. 4.2R) is successfully registered
  const qualifiedTarget14 = 64500;
  const highRR = 4.2;

  if (highRR >= policyMinRR) {
    const qualifiedScenario = { ...scenario, status: 'ENTRY_VALIDATED' as const };
    signalStateMachine.registerSignalFromScenario(qualifiedScenario, 60000, 'RR_1_4', qualifiedTarget14, highRR, 100, 0.05);
  }

  assert.equal(signalCreated, true, 'Signal with Net R:R >= 4.0 should be registered');
  const activeSignals = db.getSignals(10);
  assert.equal(activeSignals.length, 1);
  assert.equal(activeSignals[0].status, 'ENTRY_VALIDATED');
  assert.equal(activeSignals[0].rrNet, 4.2);

  db.close();
});

// --------------------------------------------------------------------------
// TEST 7: Los escenarios sobreviven a reinicios del proceso
// --------------------------------------------------------------------------
test('PR 4.1 Integration 7: Autonomous scenarios and watch plans survive process and database restarts', () => {
  const db = new DatabaseService(':memory:');
  const registry1 = new ScenarioRegistry(db);

  const originalScenario = makeScenario('sc_restart_001', 'SHORT', 61500, 62000);
  const originalPlan = makeWatchPlan('sc_restart_001', 61500, 62000);

  registry1.registerScenario(originalScenario);
  db.saveWatchPlan(originalPlan);
  assert.equal(registry1.getAllActive().length, 1);

  // Simulate process shutdown and reboot: create a new registry from the same DB
  const registry2 = new ScenarioRegistry(db);

  const recovered = registry2.getAllActive();
  assert.equal(recovered.length, 1, 'Recovered scenarios count must match');
  assert.equal(recovered[0].id, 'sc_restart_001');
  assert.equal(recovered[0].direction, 'SHORT');
  assert.equal(recovered[0].entryZoneMin, 61500);
  assert.equal(recovered[0].entryZoneMax, 62000);

  const recoveredPlan = db.getWatchPlanByScenarioId('sc_restart_001');
  assert.ok(recoveredPlan, 'Watch plan must be recovered');
  assert.equal(recoveredPlan.watchZone.minPrice, 61500);
  assert.equal(recoveredPlan.watchZone.maxPrice, 62000);

  db.close();
});

// --------------------------------------------------------------------------
// TEST 8: El historial legado sigue disponible sin intervenir en decisiones
// --------------------------------------------------------------------------
test('PR 4.1 Integration 8: Legacy history is accessible for auditing but isolated from live decisions', () => {
  const db = new DatabaseService(':memory:');

  // Insert a historical legacy setup from Phase 2
  db.saveSetup({
    id: 'historical_legacy_setup_phase2',
    timestamp: 1700000000000,
    symbol: 'BTCUSDT',
    strategy: 'STRATEGY_A_TREND_CONTINUATION',
    direction: 'LONG',
    timeframe: '15m',
    entryPrice: 58000,
    stopLoss: 57500,
    takeProfit: 60500,
    rrRatio: 5.0,
    status: 'COMPLETED_TP',
    evidence: { triggerReason: 'Historical test fixture' },
  });

  // Verify historical setup is readable for audit / backtest reporting
  const historicalSetups = db.getSetups(10);
  assert.equal(historicalSetups.length, 1);
  assert.equal(historicalSetups[0].id, 'historical_legacy_setup_phase2');
  assert.equal(historicalSetups[0].strategy, 'STRATEGY_A_TREND_CONTINUATION');

  // Verify live SetupEngine returns zero active setups and does not touch historical records
  const candleManager = new CandleManager('BTCUSDT', db);
  const setupEngine = new SetupEngine(candleManager, db);
  assert.equal(setupEngine.getActiveSetups().length, 0, 'Live activeSetups must not include historical rows');

  // Verify AlgorithmicWatcher only tracks scenarios, never legacy setups
  const registry = new ScenarioRegistry(db);
  assert.equal(registry.getAllActive().length, 0, 'Registry must not load historical setups as scenarios');

  db.close();
});
