import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseService } from '../../src/storage/database.js';
import { CandleManager } from '../../src/market/candle-manager.js';
import { OrderBookManager } from '../../src/market/orderbook-manager.js';
import { BybitRestClient } from '../../src/bybit/bybit-rest-client.js';
import { BybitWsClient } from '../../src/bybit/bybit-ws-client.js';
import { MarketCoordinator } from '../../src/market/market-coordinator.js';
import { Scenario, AiWatchPlan } from '../../src/ai/scenario-types.js';

function makeScenario(
  id: string,
  dir: 'LONG' | 'SHORT' = 'LONG',
  min = 59800,
  max = 60200,
  targetEntry = 60000,
  sl = 59500,
  tp12 = 61200,
  tp14 = 62500
): Scenario {
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
    targetEntry,
    stopLossPrice: sl,
    target12Price: tp12,
    target14Price: tp14,
    rrModeAvailable: 'RR_BOTH',
    uncertaintyLevel: 'LOW',
    status: 'SCENARIO_MONITORING',
    validUntilTimestamp: now + 7200_000,
    aiCostUsd: 0.015,
    activationConditions: ['Precio alcanza zona de demanda'],
    invalidationTriggers: ['Precio perfora stop loss'],
    argumentsFor: ['Bloque de órdenes institucional con confluencia FVG'],
    argumentsAgainst: ['Resistencia intermedia en 1H'],
    createdAt: now,
    updatedAt: now,
  };
}

function makeWatchPlan(
  scenarioId: string,
  dir: 'LONG' | 'SHORT' = 'LONG',
  min = 59800,
  max = 60200,
  targetEntry = 60000,
  sl = 59500,
  tp12 = 61200,
  tp14 = 62500
): AiWatchPlan {
  const now = Date.now();
  return {
    id: 'wp_' + scenarioId,
    scenarioId,
    symbol: 'BTCUSDT',
    direction: dir,
    marketThesis: 'End-to-end pipeline test plan',
    horizon: 'INTRADAY',
    primaryTimeframe: '15m',
    watchZone: { minPrice: min, maxPrice: max, targetEntry },
    candidateStopLoss: sl,
    candidateTakeProfits: { tp12, tp14 },
    rrEligibility: 'RR_BOTH',
    observableConditions: [
      {
        id: 'cond_zone_' + scenarioId,
        description: 'Precio entra en zona de entrada',
        operator: 'PRICE_IN_RANGE',
        params: { minLevel: min, maxLevel: max },
        automatable: true,
        sequenceOrder: 1,
      },
    ],
    confirmationSequence: ['Mitigación en zona'],
    invalidationConditions: [
      {
        id: 'cond_inv_' + scenarioId,
        description: 'Ruptura de stop loss',
        operator: dir === 'LONG' ? 'PRICE_CROSS_BELOW' : 'PRICE_CROSS_ABOVE',
        params: { level: sl },
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

function createPipelineTestRig() {
  const db = new DatabaseService(':memory:');
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

  // Disable background scheduler to prevent interference with test events
  coordinator.getDiscoveryScheduler().updateConfig({ enabled: false });

  return { coordinator, db };
}

test('PR 4.1 E2E Pipeline: AlgorithmicWatcher -> AiEntryRevalidation -> MarketCoordinator -> SignalStateMachine', async (t) => {
  const { coordinator, db } = createPipelineTestRig();
  const registry = coordinator.getScenarioRegistry();
  const watcher = coordinator.getAlgorithmicWatcher();
  const aiRevalidation = coordinator.getAiRevalidation();
  const stateMachine = coordinator.getSignalStateMachine();
  const hardBudget = (coordinator.getConsensusEngine() as any).hardBudgetManager;

  watcher.start();

  try {
    // ------------------------------------------------------------------------
    // 1. AUTORIZACIÓN: Flujo completo con IA Mock APPROVE -> Signal ENTRY_VALIDATED
    // ------------------------------------------------------------------------
    await t.test('1. Autorización: Detección en zona + revalidación mock exitosa genera señal en SignalStateMachine', async () => {
      const scenario = makeScenario('sc_pipe_auth_01', 'LONG', 59900, 60100, 60000, 59500, 61200, 62500);
      const plan = makeWatchPlan('sc_pipe_auth_01', 'LONG', 59900, 60100, 60000, 59500, 61200, 62500);
      scenario.watchPlan = plan;
      registry.registerScenario(scenario);
      db.saveWatchPlan(plan);

      // Configure Mock AI Evaluator: Dual APPROVE, zero external API tokens
      aiRevalidation.setMockEvaluator((sc: Scenario, price: number) => ({
        openaiVerdict: 'APPROVE',
        geminiVerdict: 'APPROVE',
        reasoning: 'Confluencia alcista institucional verificada sobre AI_WATCH_PLAN',
      }));

      let entryValidatedEmitted = false;
      coordinator.once('scenario_entry_validated', () => {
        entryValidatedEmitted = true;
      });

      // Price triggers into zone [59900 - 60100] at 60000
      coordinator.emit('state_updated', {
        ticker: {
          lastPrice: 60000,
          markPrice: 60000,
          spread: 0.1,
          spreadPcnt: 0.0001,
        },
      });

      // Allow microtask cycle for event dispatch
      await new Promise((r) => setTimeout(r, 60));

      assert.equal(entryValidatedEmitted, true, 'scenario_entry_validated event must be emitted by coordinator');

      // Check scenario updated state
      const updatedScenario = registry.getScenario('sc_pipe_auth_01');
      assert.ok(updatedScenario, 'Scenario must exist in registry');
      assert.equal(updatedScenario.status, 'ENTRY_VALIDATED');

      // Check signal registered in SignalStateMachine
      const activeSignals = stateMachine.getActiveSignals();
      assert.equal(activeSignals.length, 1, 'Exactly one signal should be registered');
      assert.equal(activeSignals[0].setupId, 'sc_pipe_auth_01');
      assert.equal(activeSignals[0].state, 'ENTRY_VALIDATED');
      assert.ok(activeSignals[0].netRR >= 4.0, `Signal netRR must be >= 4.0, got ${activeSignals[0].netRR}`);

      // Check persisted in SQLite
      const dbSignals = db.getSignals(10);
      assert.equal(dbSignals.length, 1, 'Signal must be saved in database');
      assert.equal(dbSignals[0].setupId, 'sc_pipe_auth_01');
      assert.equal(dbSignals[0].status, 'ENTRY_VALIDATED');
      assert.ok(dbSignals[0].rrNet >= 4.0);
    });

    // ------------------------------------------------------------------------
    // 2. RECHAZO: IA Mock emite REJECT -> Escenario CANCELLED sin crear señal
    // ------------------------------------------------------------------------
    await t.test('2. Rechazo: IA Mock emite REJECT -> Transiciona a CANCELLED sin registrar señal', async () => {
      const scenario = makeScenario('sc_pipe_reject_02', 'SHORT', 61900, 62100, 62000, 62500, 60800, 59500);
      const plan = makeWatchPlan('sc_pipe_reject_02', 'SHORT', 61900, 62100, 62000, 62500, 60800, 59500);
      scenario.watchPlan = plan;
      registry.registerScenario(scenario);
      db.saveWatchPlan(plan);

      // Configure Mock AI Evaluator: REJECT
      aiRevalidation.setMockEvaluator((sc: Scenario, price: number) => ({
        openaiVerdict: 'REJECT',
        geminiVerdict: 'REJECT',
        reasoning: 'Riesgo de absorción y trampa de liquidez detectado',
      }));

      // Price triggers into zone at 62000
      coordinator.emit('state_updated', {
        ticker: {
          lastPrice: 62000,
          markPrice: 62000,
          spread: 0.1,
          spreadPcnt: 0.0001,
        },
      });

      await new Promise((r) => setTimeout(r, 60));

      // Scenario should be CANCELLED (discarded by AI consensus)
      const updatedScenario = registry.getScenario('sc_pipe_reject_02');
      assert.ok(updatedScenario, 'Scenario must exist in database after cancellation');
      assert.equal(updatedScenario.status, 'CANCELLED');

      // No new signal should be registered
      const activeSignals = stateMachine.getActiveSignals();
      assert.equal(activeSignals.length, 1, 'Signal count must remain 1 (no new signal created)');
    });

    // ------------------------------------------------------------------------
    // 3. PRESUPUESTO: HardBudget bloqueado -> WAITING_CONFIRMATION sin señal
    // ------------------------------------------------------------------------
    await t.test('3. Presupuesto: HardBudgetManager bloqueado detiene revalidación con AI_BUDGET_EXCEEDED', async () => {
      const scenario = makeScenario('sc_pipe_budget_03', 'LONG', 60400, 60600, 60500, 60200, 61200, 62500);
      const plan = makeWatchPlan('sc_pipe_budget_03', 'LONG', 60400, 60600, 60500, 60200, 61200, 62500);
      scenario.watchPlan = plan;
      registry.registerScenario(scenario);
      db.saveWatchPlan(plan);

      // Block hard budget manager
      hardBudget.updateConfig({ dailyBudgetLimitUsd: 0.01 });
      hardBudget.recordDirectUsage('openai', 'gpt-4o', 'TEST', 0.05, { prompt: 1000, completion: 500 });
      assert.equal(hardBudget.isBlocked(), true, 'Hard budget must be blocked');

      // Trigger tick in zone at 60500 (above auth scenario SL 59500)
      coordinator.emit('state_updated', {
        ticker: {
          lastPrice: 60500,
          markPrice: 60500,
          spread: 0.1,
          spreadPcnt: 0.0001,
        },
      });

      await new Promise((r) => setTimeout(r, 60));

      // Scenario should be kept in WAITING_CONFIRMATION (pending safe budget re-evaluation)
      const updatedScenario = registry.getScenario('sc_pipe_budget_03');
      assert.ok(updatedScenario);
      assert.equal(updatedScenario.status, 'WAITING_CONFIRMATION');

      // Zero new signals
      assert.equal(stateMachine.getActiveSignals().length, 1);

      // Restore budget for subsequent test steps
      hardBudget.updateConfig({ dailyBudgetLimitUsd: 5.0, isBlocked: false });
    });

    // ------------------------------------------------------------------------
    // 4. DUPLICADOS: Cooldown e in-flight guard evitan señales redundantes
    // ------------------------------------------------------------------------
    await t.test('4. Duplicados: Ráfaga de ticks en zona no dispara revalidaciones ni señales duplicadas', async () => {
      const initialSignalsCount = stateMachine.getActiveSignals().length;

      // Bombard with 50 subsequent ticks in the active zone
      for (let i = 0; i < 50; i++) {
        coordinator.emit('state_updated', {
          ticker: {
            lastPrice: 60000 + (i % 10),
            markPrice: 60000 + (i % 10),
            spread: 0.1,
            spreadPcnt: 0.0001,
          },
        });
      }

      await new Promise((r) => setTimeout(r, 60));

      // Signal count must not change
      assert.equal(stateMachine.getActiveSignals().length, initialSignalsCount, 'Duplicate ticks must not create duplicate signals');
    });

    // ------------------------------------------------------------------------
    // 5. PERSISTENCIA: Verificación en SQLite de escenarios y señales
    // ------------------------------------------------------------------------
    await t.test('5. Persistencia: Los registros de revalidación, escenario y señal persisten correctamente en SQLite', () => {
      // 1. Check scenario
      const scRow = db.getScenarioById('sc_pipe_auth_01');
      assert.ok(scRow, 'Scenario must exist in SQLite');
      assert.equal(scRow.status, 'ENTRY_VALIDATED');

      // 2. Check revalidation history in SQLite
      const revals = db.getScenarioRevalidations('sc_pipe_auth_01');
      assert.ok(revals.length >= 1, 'Revalidation record must be persisted in SQLite');
      assert.equal(revals[0].consensusVerdict, 'AUTHORIZED');

      // 3. Check signal in SQLite
      const signals = db.getSignals(10);
      const authSignal = signals.find((s: any) => s.setupId === 'sc_pipe_auth_01');
      assert.ok(authSignal, 'Authorized signal must exist in SQLite');
      assert.equal(authSignal.status, 'ENTRY_VALIDATED');
      assert.equal(authSignal.symbol, 'BTCUSDT');
      assert.ok(authSignal.rrNet >= 4.0);
    });
  } finally {
    watcher.stop();
    coordinator.stop();
    db.close();
  }
});
