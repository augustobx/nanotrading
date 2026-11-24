import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { DatabaseService } from '../../src/storage/database.js';
import { ScenarioRegistry } from '../../src/engine/scenario-registry.js';
import { AlgorithmicWatcher } from '../../src/engine/algorithmic-watcher.js';
import { AiMarketDiscoveryEngine } from '../../src/ai/ai-market-discovery.js';
import { AiEntryRevalidation } from '../../src/ai/ai-revalidation.js';
import { HardBudgetManager } from '../../src/ai/hard-budget-manager.js';
import { OpenAiAdapter } from '../../src/ai/openai-adapter.js';
import { GeminiAdapter } from '../../src/ai/gemini-adapter.js';
import { MarketCoordinator } from '../../src/market/market-coordinator.js';
import { BybitRestClient } from '../../src/bybit/bybit-rest-client.js';
import { BybitWsClient } from '../../src/bybit/bybit-ws-client.js';
import { CandleManager } from '../../src/market/candle-manager.js';
import { OrderBookManager } from '../../src/market/orderbook-manager.js';
import { Scenario } from '../../src/ai/scenario-types.js';
import { RiskCalculator } from '../../src/engine/risk-calculator.js';

const TEST_DB_PATH = path.join(process.cwd(), 'data', 'test-fase5a.db');

function cleanup() {
  try {
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
    const wal = `${TEST_DB_PATH}-wal`;
    const shm = `${TEST_DB_PATH}-shm`;
    if (fs.existsSync(wal)) fs.unlinkSync(wal);
    if (fs.existsSync(shm)) fs.unlinkSync(shm);
  } catch {}
}

function createTestHarness() {
  cleanup();
  const db = new DatabaseService(TEST_DB_PATH);
  const restClient = new BybitRestClient();
  const wsClient = new BybitWsClient();
  wsClient.isConnected = () => true;
  wsClient.getLastMessageTime = () => Date.now();
  const candleManager = new CandleManager(db);
  const orderBookManager = new OrderBookManager();
  const coordinator = new MarketCoordinator(restClient, wsClient, candleManager, orderBookManager, db, 'BTCUSDT');
  (coordinator as any).currentTicker = {
    symbol: 'BTCUSDT',
    lastPrice: 64100,
    markPrice: 64100,
    indexPrice: 64100,
    bid1Price: 64099.9,
    ask1Price: 64100.1,
    bid1Size: 1.0,
    ask1Size: 1.0,
    spread: 0.2,
    spreadPcnt: 0.0003,
    highPrice24h: 65000,
    lowPrice24h: 63000,
    timestamp: Date.now(),
  };

  (coordinator.getSetupEngine() as any).latestAnalyses.set('15m', {
    timeframe: '15m',
    trend: 'BULLISH',
    rsi: 55,
    atr: 250,
    structure: { swings: [], breaks: [], fvgs: [], sweeps: [] },
  });

  const hardBudgetManager = new HardBudgetManager(
    {
      dailyBudgetLimitUsd: 5.0,
      monthlyBudgetLimitUsd: 50.0,
      maxCostPerRequestUsd: 0.10,
    },
    undefined,
    db
  );

  const openaiAdapter = new OpenAiAdapter({ apiKey: 'mock-openai' });
  const geminiAdapter = new GeminiAdapter({ apiKey: 'mock-gemini' });

  const scenarioRegistry = new ScenarioRegistry(db);
  const discoveryEngine = new AiMarketDiscoveryEngine({
    coordinator,
    openaiAdapter,
    geminiAdapter,
    hardBudgetManager,
    scenarioRegistry,
    db,
  });

  const watcher = new AlgorithmicWatcher(coordinator, scenarioRegistry, undefined, undefined, { approachThresholdPct: 0.35 });

  const revalidation = new AiEntryRevalidation({
    coordinator,
    openaiAdapter,
    geminiAdapter,
    hardBudgetManager,
    scenarioRegistry,
    db,
  });

  return {
    db,
    coordinator,
    candleManager,
    hardBudgetManager,
    openaiAdapter,
    geminiAdapter,
    scenarioRegistry,
    discoveryEngine,
    watcher,
    revalidation,
    close: () => {
      coordinator.stop();
      db.close();
      cleanup();
    },
  };
}

test('Fase 5A - ScenarioRegistry: persists scenarios and lifecycle transitions', () => {
  const h = createTestHarness();
  try {
    const sc: Scenario = {
      id: 'scen_test_1',
      symbol: 'BTCUSDT',
      direction: 'LONG',
      timeframe: '15m',
      structureType: 'FVG_RETEST',
      proposedBy: 'OPENAI',
      modelsUsed: ['gpt-4o'],
      snapshotId: 'snap_1',
      discoveryTimestamp: Date.now(),
      entryZoneMin: 64000,
      entryZoneMax: 64200,
      targetEntry: 64100,
      stopLossPrice: 63600,
      target12Price: 65125,
      target14Price: 66150,
      netRR12: 2.05,
      netRR14: 4.10,
      rrModeAvailable: 'RR_BOTH',
      uncertaintyLevel: 'LOW',
      status: 'SCENARIO_REGISTERED',
      validUntilTimestamp: Date.now() + 3600000,
      aiCostUsd: 0.002,
      activationConditions: ['Mitigación FVG'],
      invalidationTriggers: ['Cierre bajo 63600'],
      argumentsFor: ['Confluencia 4H/1H'],
      argumentsAgainst: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    h.scenarioRegistry.registerScenario(sc);
    const retrieved = h.scenarioRegistry.getScenario('scen_test_1');
    assert.ok(retrieved);
    assert.strictEqual(retrieved?.symbol, 'BTCUSDT');
    assert.strictEqual(retrieved?.direction, 'LONG');
    assert.strictEqual(retrieved?.rrModeAvailable, 'RR_BOTH');
    assert.strictEqual(retrieved?.netRR12, 2.05);
    assert.strictEqual(retrieved?.netRR14, 4.10);

    // Lifecycle check
    const lifecycle1 = h.scenarioRegistry.getLifecycle('scen_test_1');
    assert.ok(lifecycle1.length >= 1);
    assert.strictEqual(lifecycle1[0].toStatus, 'SCENARIO_REGISTERED');

    // Transition status
    h.scenarioRegistry.transitionStatus('scen_test_1', 'APPROACHING_ZONE', 'Precio acercándose a zona');
    const updated = h.scenarioRegistry.getScenario('scen_test_1');
    assert.strictEqual(updated?.status, 'APPROACHING_ZONE');

    const lifecycle2 = h.scenarioRegistry.getLifecycle('scen_test_1');
    assert.strictEqual(lifecycle2.length, 2);
    assert.strictEqual(lifecycle2[1].toStatus, 'APPROACHING_ZONE');
  } finally {
    h.close();
  }
});

test('Fase 5A - ScenarioRegistry: deduplicates and groups similar proposals from dual AI', () => {
  const h = createTestHarness();
  try {
    const scOpenAi: Scenario = {
      id: 'scen_openai_1',
      symbol: 'BTCUSDT',
      direction: 'LONG',
      timeframe: '15m',
      structureType: 'OB_MITIGATION',
      proposedBy: 'OPENAI',
      modelsUsed: ['gpt-4o'],
      snapshotId: 'snap_1',
      discoveryTimestamp: Date.now(),
      entryZoneMin: 64000,
      entryZoneMax: 64200,
      targetEntry: 64100,
      stopLossPrice: 63600,
      rrModeAvailable: 'RR_1_4',
      uncertaintyLevel: 'LOW',
      status: 'SCENARIO_REGISTERED',
      validUntilTimestamp: Date.now() + 3600000,
      aiCostUsd: 0.001,
      activationConditions: [],
      invalidationTriggers: [],
      argumentsFor: ['Fuerte volumen comprador'],
      argumentsAgainst: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    h.scenarioRegistry.registerScenario(scOpenAi);

    // Gemini proposes overlapping zone in same direction
    const scGemini: Scenario = {
      id: 'scen_gemini_1',
      symbol: 'BTCUSDT',
      direction: 'LONG',
      timeframe: '15m',
      structureType: 'OB_MITIGATION',
      proposedBy: 'GEMINI',
      modelsUsed: ['gemini-2.0-flash'],
      snapshotId: 'snap_1',
      discoveryTimestamp: Date.now(),
      entryZoneMin: 64050,
      entryZoneMax: 64220,
      targetEntry: 64135,
      stopLossPrice: 63600,
      rrModeAvailable: 'RR_1_4',
      uncertaintyLevel: 'LOW',
      status: 'SCENARIO_REGISTERED',
      validUntilTimestamp: Date.now() + 3600000,
      aiCostUsd: 0.001,
      activationConditions: [],
      invalidationTriggers: [],
      argumentsFor: ['Order book balance favorable'],
      argumentsAgainst: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const merged = h.scenarioRegistry.registerScenario(scGemini);
    // Should merge into the existing scenario
    assert.strictEqual(merged.id, 'scen_openai_1');
    assert.strictEqual(merged.proposedBy, 'CONSENSUS');
    assert.ok(merged.modelsUsed.includes('gpt-4o'));
    assert.ok(merged.modelsUsed.includes('gemini-2.0-flash'));
    assert.strictEqual(merged.argumentsFor.length, 2);
  } finally {
    h.close();
  }
});

test('Fase 5A - AI Market Discovery: preserves both targets but exposes only the target meeting the global 4R floor', async () => {
  const h = createTestHarness();
  try {
    // The production verifier MUST see actual structural anchors; mock-only
    // tests provide explicit market facts instead of accepting fabricated levels.
    const buildSummary = h.discoveryEngine.buildMarketIntelligenceSummary.bind(h.discoveryEngine);
    (h.discoveryEngine as any).buildMarketIntelligenceSummary = () => ({
      ...buildSummary(),
      currentPrice: 64100,
      timeframes: {
        '15m': {
          activeSwings: { low: { price: 63600 }, high: { price: 66600 } },
          activeFvgDetails: [
            { type: 'BULLISH', bottom: 64000, top: 64200 },
            { type: 'BEARISH', bottom: 65300, top: 65400 },
          ],
        },
      },
    });
    h.discoveryEngine.setMockEvaluator((summary) => ({
      openai: {
        bias: 'BULLISH',
        reasoning: 'Estructura alcista con FVG claro en 15m',
        scenarios: [
          {
            direction: 'LONG',
            timeframe: '15m',
            structureType: 'FVG_RETEST',
            entryZoneMin: 64000,
            entryZoneMax: 64200,
            targetEntry: 64100,
            structuralStopLoss: 63600,
            candidateTarget12: 65350,
            candidateTarget14: 66600,
          },
        ],
      },
      gemini: {
        bias: 'BULLISH',
        reasoning: 'Liquidez limpia al alza sin trampas detectadas',
        scenarios: [],
      },
    }));

    const result = await h.discoveryEngine.runDiscovery({ forceManual: true });
    assert.strictEqual(result.scenarios.length, 1);
    const sc = result.scenarios[0];
    assert.strictEqual(sc.direction, 'LONG');
    assert.strictEqual(sc.rrModeAvailable, 'RR_1_4');
    assert.ok((sc.netRR12 || 0) >= 2.0);
    assert.ok((sc.netRR12 || 0) < 4.0);
    assert.ok((sc.netRR14 || 0) >= 4.0);
    assert.strictEqual(result.summary.openaiBias, 'BULLISH');
    assert.strictEqual(result.summary.geminiBias, 'BULLISH');
  } finally {
    h.close();
  }
});

test('Fase 5A - AI Market Discovery: strictly rejects fabricated or unrealistic net R:R (< 2.0)', async () => {
  const h = createTestHarness();
  try {
    h.discoveryEngine.setMockEvaluator(() => ({
      openai: {
        bias: 'BULLISH',
        reasoning: 'Intento de forzar setup con target muy cercano',
        scenarios: [
          {
            direction: 'LONG',
            timeframe: '15m',
            structureType: 'WEAK_SETUP',
            entryZoneMin: 64000,
            entryZoneMax: 64200,
            targetEntry: 64100,
            structuralStopLoss: 63600, // risk = 500
            candidateTarget12: 64400,  // reward = 300 -> R:R = 0.6 (< 2.0)
          },
        ],
      },
    }));

    const result = await h.discoveryEngine.runDiscovery({ forceManual: true });
    // Should reject because neither 1:2 nor 1:4 meets net requirement
    assert.strictEqual(result.scenarios.length, 0);
  } finally {
    h.close();
  }
});

test('Fase 5A - Algorithmic Watcher: zero-cost surveillance triggers APPROACHING and IN_ZONE correctly', () => {
  const h = createTestHarness();
  try {
    const sc: Scenario = {
      id: 'scen_watch_1',
      symbol: 'BTCUSDT',
      direction: 'LONG',
      timeframe: '15m',
      structureType: 'ORDER_BLOCK',
      proposedBy: 'CONSENSUS',
      modelsUsed: ['gpt-4o', 'gemini-2.0-flash'],
      snapshotId: 'snap_w',
      discoveryTimestamp: Date.now(),
      entryZoneMin: 64000,
      entryZoneMax: 64200,
      targetEntry: 64100,
      stopLossPrice: 63500,
      target12Price: 65600,
      target14Price: 67100,
      netRR12: 2.05,
      netRR14: 4.10,
      rrModeAvailable: 'RR_BOTH',
      uncertaintyLevel: 'LOW',
      status: 'SCENARIO_REGISTERED',
      validUntilTimestamp: Date.now() + 3600000,
      aiCostUsd: 0.002,
      activationConditions: [],
      invalidationTriggers: [],
      argumentsFor: [],
      argumentsAgainst: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    h.scenarioRegistry.registerScenario(sc);

    let approachingEventFired = false;
    let revalidationRequestedFired = false;

    h.watcher.on('scenario_approaching', () => {
      approachingEventFired = true;
    });
    h.watcher.on('revalidation_requested', () => {
      revalidationRequestedFired = true;
    });

    // 1. Price is far (e.g. 64600 -> distance to 64200 is ~0.62% > 0.35%)
    h.watcher.evaluateTick(64600);
    assert.strictEqual(h.scenarioRegistry.getScenario('scen_watch_1')?.status, 'SCENARIO_REGISTERED');
    assert.strictEqual(approachingEventFired, false);

    // 2. Price approaches zone (e.g. 64300 -> distance to 64200 is 100/64300 = 0.15% <= 0.35%)
    h.watcher.evaluateTick(64300);
    assert.strictEqual(h.scenarioRegistry.getScenario('scen_watch_1')?.status, 'APPROACHING_ZONE');
    assert.strictEqual(approachingEventFired, true);

    // 3. Price enters zone (64150 -> inside [64000, 64200])
    h.watcher.evaluateTick(64150);
    assert.strictEqual(h.scenarioRegistry.getScenario('scen_watch_1')?.status, 'REVALIDATION_REQUESTED');
    assert.strictEqual(revalidationRequestedFired, true);
  } finally {
    h.close();
  }
});

test('Fase 5A - Algorithmic Watcher: invalidates scenario when Stop Loss is breached prior to entry', () => {
  const h = createTestHarness();
  try {
    const sc: Scenario = {
      id: 'scen_inval_1',
      symbol: 'BTCUSDT',
      direction: 'LONG',
      timeframe: '15m',
      structureType: 'ORDER_BLOCK',
      proposedBy: 'CONSENSUS',
      modelsUsed: ['gpt-4o'],
      snapshotId: 'snap_w',
      discoveryTimestamp: Date.now(),
      entryZoneMin: 64000,
      entryZoneMax: 64200,
      targetEntry: 64100,
      stopLossPrice: 63500,
      rrModeAvailable: 'RR_1_4',
      uncertaintyLevel: 'LOW',
      status: 'SCENARIO_REGISTERED',
      validUntilTimestamp: Date.now() + 3600000,
      aiCostUsd: 0.001,
      activationConditions: [],
      invalidationTriggers: [],
      argumentsFor: [],
      argumentsAgainst: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    h.scenarioRegistry.registerScenario(sc);

    let invalidatedFired = false;
    h.watcher.on('scenario_invalidated', () => {
      invalidatedFired = true;
    });

    // Price gaps down or crashes past Stop Loss (63450 < 63500)
    h.watcher.evaluateTick(63450);
    assert.strictEqual(h.scenarioRegistry.getScenario('scen_inval_1')?.status, 'INVALIDATED');
    assert.strictEqual(invalidatedFired, true);
  } finally {
    h.close();
  }
});

test('Fase 5A - AI Entry Revalidation: dual APPROVE transitions scenario to ENTRY_VALIDATED', async () => {
  const h = createTestHarness();
  try {
    const sc: Scenario = {
      id: 'scen_reval_1',
      symbol: 'BTCUSDT',
      direction: 'LONG',
      timeframe: '15m',
      structureType: 'ORDER_BLOCK',
      proposedBy: 'CONSENSUS',
      modelsUsed: ['gpt-4o', 'gemini-2.0-flash'],
      snapshotId: 'snap_r',
      discoveryTimestamp: Date.now(),
      entryZoneMin: 64000,
      entryZoneMax: 64200,
      targetEntry: 64100,
      stopLossPrice: 63500,
      target12Price: 65600,
      target14Price: 67100,
      netRR12: 2.05,
      netRR14: 4.10,
      rrModeAvailable: 'RR_BOTH',
      uncertaintyLevel: 'LOW',
      status: 'REVALIDATION_REQUESTED',
      validUntilTimestamp: Date.now() + 3600000,
      aiCostUsd: 0.002,
      activationConditions: [],
      invalidationTriggers: [],
      argumentsFor: [],
      argumentsAgainst: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    h.scenarioRegistry.registerScenario(sc);

    h.revalidation.setMockEvaluator(() => ({
      openaiVerdict: 'APPROVE',
      geminiVerdict: 'APPROVE',
      reasoning: 'Reevaluación de confluencia exitosa: absorción compradora confirmada',
    }));

    const result = await h.revalidation.revalidate(sc, 64100);
    assert.strictEqual(result.consensus, 'AUTHORIZED');
    assert.strictEqual(result.scenario.status, 'ENTRY_VALIDATED');

    const revals = h.db.getScenarioRevalidations(sc.id);
    assert.strictEqual(revals.length, 1);
    assert.strictEqual(revals[0].consensusVerdict, 'AUTHORIZED');
    assert.strictEqual(revals[0].priceAtRevalidation, 64100);
  } finally {
    h.close();
  }
});

test('Fase 5A - AI Entry Revalidation: rejection cancels scenario with reason', async () => {
  const h = createTestHarness();
  try {
    const sc: Scenario = {
      id: 'scen_reval_reject',
      symbol: 'BTCUSDT',
      direction: 'LONG',
      timeframe: '15m',
      structureType: 'ORDER_BLOCK',
      proposedBy: 'CONSENSUS',
      modelsUsed: ['gpt-4o'],
      snapshotId: 'snap_r2',
      discoveryTimestamp: Date.now(),
      entryZoneMin: 64000,
      entryZoneMax: 64200,
      targetEntry: 64100,
      stopLossPrice: 63500,
      target12Price: 65600,
      target14Price: 67100,
      rrModeAvailable: 'RR_BOTH',
      uncertaintyLevel: 'LOW',
      status: 'REVALIDATION_REQUESTED',
      validUntilTimestamp: Date.now() + 3600000,
      aiCostUsd: 0.001,
      activationConditions: [],
      invalidationTriggers: [],
      argumentsFor: [],
      argumentsAgainst: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    h.scenarioRegistry.registerScenario(sc);

    h.revalidation.setMockEvaluator(() => ({
      openaiVerdict: 'REJECT',
      geminiVerdict: 'APPROVE',
      reasoning: 'Rechazo: desequilibrio severo en el libro de órdenes contra la posición',
    }));

    const result = await h.revalidation.revalidate(sc, 64100);
    assert.strictEqual(result.consensus, 'DISCARDED');
    assert.strictEqual(result.scenario.status, 'CANCELLED');
  } finally {
    h.close();
  }
});

test('Fase 5A - Hard Budget Limit: blocks Discovery and Revalidation when limit is reached', async () => {
  const h = createTestHarness();
  try {
    // Force hard budget block
    h.hardBudgetManager.blockBudget('Límite de presupuesto diario alcanzado ($5.00/día)');
    assert.strictEqual(h.hardBudgetManager.isBlocked(), true);

    const discResult = await h.discoveryEngine.runDiscovery();
    assert.strictEqual(discResult.scenarios.length, 0);
    assert.strictEqual(discResult.skippedReason, 'Límite de presupuesto diario alcanzado ($5.00/día)');

    const sc: Scenario = {
      id: 'scen_budget_block',
      symbol: 'BTCUSDT',
      direction: 'LONG',
      timeframe: '15m',
      structureType: 'ORDER_BLOCK',
      proposedBy: 'OPENAI',
      modelsUsed: ['gpt-4o'],
      snapshotId: 'snap_b',
      discoveryTimestamp: Date.now(),
      entryZoneMin: 64000,
      entryZoneMax: 64200,
      targetEntry: 64100,
      stopLossPrice: 63500,
      rrModeAvailable: 'RR_1_4',
      uncertaintyLevel: 'LOW',
      status: 'REVALIDATION_REQUESTED',
      validUntilTimestamp: Date.now() + 3600000,
      aiCostUsd: 0.001,
      activationConditions: [],
      invalidationTriggers: [],
      argumentsFor: [],
      argumentsAgainst: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    h.scenarioRegistry.registerScenario(sc);

    const revalResult = await h.revalidation.revalidate(sc, 64100);
    assert.strictEqual(revalResult.consensus, 'WAITING_CONDITIONS');
    assert.strictEqual(revalResult.scenario.status, 'WAITING_CONFIRMATION');
    assert.ok(revalResult.reason?.includes('Límite de presupuesto'));
    assert.ok(h.scenarioRegistry.getScenario(sc.id)?.lastRevalidationTimestamp,
      'Last review must survive a restart to avoid repeated IA costs');
  } finally {
    h.close();
  }
});
