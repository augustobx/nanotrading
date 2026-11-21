import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseService } from '../../src/storage/database.js';
import { SetupEngine } from '../../src/engine/setup-engine.js';
import { CandleManager } from '../../src/market/candle-manager.js';
import { OrderBookManager } from '../../src/market/orderbook-manager.js';
import { BybitRestClient } from '../../src/bybit/bybit-rest-client.js';
import { BybitWsClient } from '../../src/bybit/bybit-ws-client.js';
import { MarketCoordinator } from '../../src/market/market-coordinator.js';
import { ApiServer } from '../../src/api/server.js';
import { ScenarioRegistry } from '../../src/engine/scenario-registry.js';
import { AlgorithmicWatcher } from '../../src/engine/algorithmic-watcher.js';
import { Candle, Timeframe } from '../../src/types/market.js';
import { Scenario, AiWatchPlan } from '../../src/ai/scenario-types.js';
import { config } from '../../src/config/index.js';

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

function createTestCoordinator(db: DatabaseService) {
  const restClient = new BybitRestClient();
  const wsClient = new BybitWsClient();
  const candleManager = new CandleManager('BTCUSDT', db);
  const orderBookManager = new OrderBookManager('BTCUSDT');

  // Stub network I/O
  wsClient.isConnected = () => true;
  wsClient.getLastMessageTime = () => Date.now();
  wsClient.connect = () => {};

  orderBookManager.handleSnapshot(
    [['60000.0', '1.0']],
    [['60000.1', '1.0']],
    100,
    Date.now(),
    1
  );

  const coordinator = new MarketCoordinator(
    restClient,
    wsClient,
    candleManager,
    orderBookManager,
    db,
    'BTCUSDT'
  );

  (coordinator as any).currentTicker = {
    symbol: 'BTCUSDT',
    lastPrice: 60000,
    markPrice: 60000,
    indexPrice: 60000,
    bid1Price: 59999.9,
    ask1Price: 60000.1,
    bid1Size: 1.0,
    ask1Size: 1.0,
    spread: 0.2,
    spreadPcnt: 0.0003,
    highPrice24h: 61000,
    lowPrice24h: 59000,
    turnover24h: 1000000,
    volume24h: 100,
  };

  return { coordinator, db, candleManager, orderBookManager };
}

// --------------------------------------------------------------------------
// TEST 1: SetupEngine no evalúa ni registra Estrategias A/B en vivo
// --------------------------------------------------------------------------
test('PR 4.1 Integration 1: SetupEngine does not evaluate or register A/B strategies during live operation', () => {
  const db = new DatabaseService(':memory:');
  const candleManager = new CandleManager('BTCUSDT', db);

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

  // But live setups list is strictly empty
  assert.equal(fullAnalysisResult.setups.length, 0, 'No live A/B setups should be emitted');
  assert.equal(setupEngine.getActiveSetups().length, 0, 'activeSetups must remain empty');
  assert.equal(setupDetectedEmitted, false, 'setup_detected must not be emitted');

  // Database setups table must remain empty
  const storedSetups = db.getSetups(10);
  assert.equal(storedSetups.length, 0, 'No setups should be written to SQLite');

  db.close();
});

// --------------------------------------------------------------------------
// TEST 2: Rutas reales: Bloqueo de consenso legado y rechazo HTTP 410 en API
// --------------------------------------------------------------------------
test('PR 4.1 Integration 2: Real coordinator blocks legacy consensus when scheduler disabled; /api/v1/ai/evaluate returns HTTP 410', async () => {
  const db = new DatabaseService(':memory:');
  const { coordinator } = createTestCoordinator(db);

  // Disable discovery scheduler
  coordinator.getDiscoveryScheduler().updateConfig({ enabled: false });
  assert.equal(coordinator.getDiscoveryScheduler().getConfig().enabled, false);

  let legacyConsensusEmitted = false;
  coordinator.on('signal_evaluated', () => {
    legacyConsensusEmitted = true;
  });

  // Emit a mock legacy setup through the real coordinator setup engine
  coordinator.getSetupEngine().emit('setup_detected', {
    id: 'test_legacy_setup',
    strategy: 'STRATEGY_A_TREND_CONTINUATION',
  });

  await new Promise((resolve) => setTimeout(resolve, 50));

  // Legacy consensus must NEVER be triggered
  assert.equal(legacyConsensusEmitted, false, 'Legacy consensus must NEVER be triggered on real coordinator');
  assert.equal(db.getSignals(10).length, 0, 'Zero signals should exist in database');

  // Start real ApiServer and verify /api/v1/ai/evaluate returns HTTP 410 immediately
  const server = new ApiServer(coordinator, db, 0, '127.0.0.1');
  await server.start();
  const port = server.getPort();

  // 1. Unauthorized request gets 401
  const unauthRes = await fetch(`http://127.0.0.1:${port}/api/v1/ai/evaluate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Connection: 'close' },
    body: JSON.stringify({ setupId: 'any_setup' }),
  });
  assert.equal(unauthRes.status, 401, 'Unauthenticated request must get 401');

  // 2. Authenticated request gets HTTP 410 Gone immediately without budget checks
  const authRes = await fetch(`http://127.0.0.1:${port}/api/v1/ai/evaluate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Connection: 'close',
      'x-admin-key': config.security.adminApiKey,
    },
    body: JSON.stringify({ setupId: 'any_setup' }),
  });
  assert.equal(authRes.status, 410, 'Authenticated request to legacy evaluator must receive HTTP 410');
  const authBody: any = await authRes.json();
  assert.equal(authBody.error, 'LEGACY_EVALUATOR_DISABLED');

  await server.stop();
  coordinator.stop();
  db.close();
});

// --------------------------------------------------------------------------
// TEST 3: Oportunidades provienen exclusivamente del descubrimiento autónomo
// --------------------------------------------------------------------------
test('PR 4.1 Integration 3: Active opportunities originate exclusively from autonomous AI discovery scenarios in real registry', () => {
  const db = new DatabaseService(':memory:');
  const { coordinator } = createTestCoordinator(db);
  const registry = coordinator.getScenarioRegistry();

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

  coordinator.stop();
  db.close();
});

// --------------------------------------------------------------------------
// TEST 4: El watcher consume cero tokens en vigilancia ordinaria
// --------------------------------------------------------------------------
test('PR 4.1 Integration 4: AlgorithmicWatcher consumes exactly zero AI tokens/calls during routine tick watching', () => {
  const db = new DatabaseService(':memory:');
  const { coordinator } = createTestCoordinator(db);
  const registry = coordinator.getScenarioRegistry();
  const watcher = coordinator.getAlgorithmicWatcher();

  const scenario = makeScenario('sc_watcher_001', 'LONG', 59800, 60200);
  const plan = makeWatchPlan('sc_watcher_001', 59800, 60200);
  scenario.watchPlan = plan;
  registry.registerScenario(scenario);
  db.saveWatchPlan(plan);

  let aiCallsTriggered = 0;
  watcher.on('revalidation_requested', () => {
    aiCallsTriggered++;
  });

  watcher.start();

  // Simulate 100 price updates/ticks within the observation range without meeting the pattern condition
  for (let price = 59850; price <= 60150; price += 3) {
    coordinator.emit('state_updated', {
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
  coordinator.stop();
  db.close();
});

// --------------------------------------------------------------------------
// TEST 5: Deduplicación: Cooldown e in-flight guard evitan revalidaciones duplicadas
// --------------------------------------------------------------------------
test('PR 4.1 Integration 5: Cooldown and in-flight guard strictly prevent duplicate revalidations on real watcher', () => {
  const db = new DatabaseService(':memory:');
  const { coordinator } = createTestCoordinator(db);
  const registry = coordinator.getScenarioRegistry();
  const watcher = coordinator.getAlgorithmicWatcher();

  const scenario = makeScenario('sc_cooldown_001', 'LONG', 59800, 60200);
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
  watcher.on('revalidation_requested', () => {
    revalidationEvents++;
  });

  watcher.start();

  // First trigger: price in zone triggers revalidation
  coordinator.emit('state_updated', { ticker: { lastPrice: 60000, spreadPcnt: 0.001 } });
  assert.equal(revalidationEvents, 1, 'First revalidation should be emitted');

  // Immediately bombard with 50 subsequent ticks while in cooldown
  for (let i = 0; i < 50; i++) {
    coordinator.emit('state_updated', { ticker: { lastPrice: 60005, spreadPcnt: 0.001 } });
  }

  // Must still be exactly 1
  assert.equal(revalidationEvents, 1, 'Subsequent ticks during cooldown must NOT fire duplicate revalidations');

  // Also test ScenarioRegistry deduplication: registering same scenario again does not duplicate
  registry.registerScenario(scenario);
  assert.equal(registry.getAllActive().length, 1, 'Registry must not duplicate active scenario');

  watcher.stop();
  coordinator.stop();
  db.close();
});

// --------------------------------------------------------------------------
// TEST 6: Registro de señales real tras revalidación con R:R >= 4.0
// --------------------------------------------------------------------------
test('PR 4.1 Integration 6: Real coordinator pipeline registers signal only when Net R:R >= 4.0 after revalidation', () => {
  const db = new DatabaseService(':memory:');
  const { coordinator } = createTestCoordinator(db);

  const scenario = makeScenario('sc_pipe_001', 'LONG', 59800, 60200);
  scenario.target14Price = 64500;
  scenario.stopLossPrice = 59000;
  scenario.status = 'ENTRY_VALIDATED';

  // 1. Revalidation with Net R:R < 4.0 (disqualified)
  coordinator.getAiRevalidation().emit('entry_validated', {
    scenario,
    currentPrice: 60000,
    riskCalc: {
      calculation14: {
        isValid: true,
        netRR: 2.5,
        netLossUSDT: 100,
        positionSizeBTC: 0.05,
      },
    },
  });

  // Must NOT create signal because Net R:R is below policy minimum (4.0)
  assert.equal(coordinator.getSignalStateMachine().getActiveSignals().length, 0, 'Net R:R < 4.0 must not register signal');
  assert.equal(db.getSignals(10).length, 0, 'No signal in SQLite');

  // 2. Revalidation with Net R:R >= 4.0 and risk within policy (<= 50 USDT)
  let signalCreatedEventEmitted = false;
  coordinator.on('scenario_entry_validated', () => {
    signalCreatedEventEmitted = true;
  });

  coordinator.getAiRevalidation().emit('entry_validated', {
    scenario,
    currentPrice: 60000,
    riskCalc: {
      calculation14: {
        isValid: true,
        netRR: 4.2,
        netLossUSDT: 45,
        positionSizeBTC: 0.05,
      },
    },
  });

  assert.equal(signalCreatedEventEmitted, true, 'scenario_entry_validated should be emitted by coordinator');
  const activeSignals = coordinator.getSignalStateMachine().getActiveSignals();
  assert.equal(activeSignals.length, 1, 'Exactly one signal should be registered');
  assert.equal(activeSignals[0].state, 'ENTRY_VALIDATED');
  assert.equal(activeSignals[0].netRR, 4.2);

  // Check persisted in SQLite
  const dbSignals = db.getSignals(10);
  assert.equal(dbSignals.length, 1, 'Signal must be persisted in SQLite');
  assert.equal(dbSignals[0].status, 'ENTRY_VALIDATED');
  assert.equal(dbSignals[0].rrNet, 4.2);

  coordinator.stop();
  db.close();
});

// --------------------------------------------------------------------------
// TEST 7: Persistencia ante cierre y reapertura REAL de SQLite en disco
// --------------------------------------------------------------------------
test('PR 4.1 Integration 7: Autonomous scenarios and watch plans survive real SQLite file close and reopen', () => {
  const tmpDbPath = path.join(os.tmpdir(), `nanotrading-pr41-persistence-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);

  try {
    // 1. Create real database on disk and populate with scenario and watch plan
    const db1 = new DatabaseService(tmpDbPath);
    const reg1 = new ScenarioRegistry(db1);

    const originalScenario = makeScenario('sc_disk_001', 'SHORT', 61500, 62000);
    const originalPlan = makeWatchPlan('sc_disk_001', 61500, 62000);

    reg1.registerScenario(originalScenario);
    db1.saveWatchPlan(originalPlan);
    assert.equal(reg1.getAllActive().length, 1);

    // 2. CLOSE real database connection on disk
    db1.close();

    // 3. REOPEN real database from disk
    const db2 = new DatabaseService(tmpDbPath);
    const reg2 = new ScenarioRegistry(db2);

    const recoveredScenarios = reg2.getAllActive();
    assert.equal(recoveredScenarios.length, 1, 'Recovered scenarios count from disk must match');
    assert.equal(recoveredScenarios[0].id, 'sc_disk_001');
    assert.equal(recoveredScenarios[0].direction, 'SHORT');
    assert.equal(recoveredScenarios[0].entryZoneMin, 61500);
    assert.equal(recoveredScenarios[0].entryZoneMax, 62000);
    assert.equal(recoveredScenarios[0].structureType, 'SMC_DISCRETIONARY_DISCOVERY');

    const recoveredPlan = db2.getWatchPlanByScenarioId('sc_disk_001');
    assert.ok(recoveredPlan, 'Watch plan must be recovered from disk');
    assert.equal(recoveredPlan.watchZone.minPrice, 61500);
    assert.equal(recoveredPlan.watchZone.maxPrice, 62000);

    db2.close();
  } finally {
    if (fs.existsSync(tmpDbPath)) {
      try {
        fs.unlinkSync(tmpDbPath);
      } catch {}
    }
  }
});

// --------------------------------------------------------------------------
// TEST 8: Protecciones reales: Kill Switch y límites de presupuesto en coordinator
// --------------------------------------------------------------------------
test('PR 4.1 Integration 8: Real Kill Switch and Hard Budget Guards enforce strict security', () => {
  const db = new DatabaseService(':memory:');
  const { coordinator } = createTestCoordinator(db);

  // 1. Test Kill Switch real
  assert.equal(coordinator.getMarketState().killSwitchActive, false);

  // Register a signal
  const scenario = makeScenario('sc_ks_001', 'LONG', 59800, 60200);
  scenario.status = 'ENTRY_VALIDATED';
  coordinator.getSignalStateMachine().registerSignalFromScenario(
    scenario, 60000, 'RR_1_4', 64500, 4.2, 100, 0.05
  );
  assert.equal(coordinator.getSignalStateMachine().getActiveSignals().length, 1);

  // Trigger Kill Switch on coordinator
  coordinator.setKillSwitch(true, 'Emergency test halt');

  // Assert signal cancelled, state updated, persisted in DB
  assert.equal(coordinator.getMarketState().killSwitchActive, true);
  assert.equal(coordinator.getSignalStateMachine().getActiveSignals().length, 0);
  assert.equal(db.getKillSwitchState(), true, 'Kill switch state must be persisted in SQLite');

  // Restore Kill Switch
  coordinator.setKillSwitch(false, 'Test reset');
  assert.equal(coordinator.getMarketState().killSwitchActive, false);

  // 2. Test Hard Budget Guard real
  const hardBudget = (coordinator.getConsensusEngine() as any).hardBudgetManager;
  hardBudget.updateConfig({
    dailyBudgetLimitUsd: 0.01,
    monthlyBudgetLimitUsd: 100,
    maxCostPerRequestUsd: 1,
  });

  // Record direct usage exceeding daily budget limit ($0.05 > $0.01)
  hardBudget.recordDirectUsage('openai', 'gpt-4o', 'MARKET_DISCOVERY', 0.05, {
    prompt: 4000,
    completion: 1000,
  });

  assert.equal(hardBudget.isBlocked(), true, 'Hard budget must be blocked when daily limit exceeded');
  const reservation = hardBudget.reserveBudget({
    provider: 'openai',
    model: 'gpt-4o',
    task: 'MARKET_DISCOVERY',
    maxEstimatedCostUsd: 0.005,
  });
  assert.equal(reservation.allowed, false, 'Further reservations must be denied by budget manager');
  assert.equal(reservation.status, 'AI_BUDGET_EXCEEDED');

  coordinator.stop();
  db.close();
});
