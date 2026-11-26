import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseService } from '../../src/storage/database.js';
import { CandleManager } from '../../src/market/candle-manager.js';
import { OrderBookManager } from '../../src/market/orderbook-manager.js';
import { BybitRestClient } from '../../src/bybit/bybit-rest-client.js';
import { BybitWsClient } from '../../src/bybit/bybit-ws-client.js';
import { MarketCoordinator } from '../../src/market/market-coordinator.js';
import { Scenario, AiWatchPlan } from '../../src/ai/scenario-types.js';
import { MarketMonitorWorker } from '../../src/engine/market-monitor-worker.js';

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

function createPipelineTestRig(dbPath = ':memory:') {
  const db = new DatabaseService(dbPath);
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

  // Provide valid ATR 15m in setupEngine so risk policy ATR cap check can evaluate cleanly
  (coordinator.getSetupEngine() as any).latestAnalyses.set('15m', {
    timeframe: '15m',
    trend: 'BULLISH',
    rsi: 55,
    atr: 250,
    structure: { swings: [], breaks: [], fvgs: [], sweeps: [] },
  });

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

    // ------------------------------------------------------------------------
    // 6. RIESGO BLOQUEANTE: Kill Switch activo con IA en APPROVE no registra señal
    // ------------------------------------------------------------------------
    await t.test('6. Riesgo bloqueante: Kill Switch activo cancela entrada y no registra señal aunque IA emita APPROVE', async () => {
      // Activar Kill Switch
      coordinator.setKillSwitch(true, 'Emergencia administrativa de prueba');
      const countAfterKs = stateMachine.getActiveSignals().length;

      try {
        const scenario = makeScenario('sc_pipe_risk_ks_06', 'SHORT', 59900, 60100, 60000, 60500, 58800, 57500);
        const plan = makeWatchPlan('sc_pipe_risk_ks_06', 'SHORT', 59900, 60100, 60000, 60500, 58800, 57500);
        scenario.watchPlan = plan;
        registry.registerScenario(scenario);
        db.saveWatchPlan(plan);

        aiRevalidation.setMockEvaluator(() => ({
          openaiVerdict: 'APPROVE',
          geminiVerdict: 'APPROVE',
          reasoning: 'IA emite aprobación pero Kill Switch debe bloquearla de forma determinista',
        }));

        (coordinator as any).currentTicker.lastPrice = 60000;
        (coordinator as any).currentTicker.markPrice = 60000;
        (coordinator as any).currentTicker.timestamp = Date.now();

        coordinator.emit('state_updated', {
          ticker: {
            lastPrice: 60000,
            markPrice: 60000,
            spread: 0.1,
            spreadPcnt: 0.0001,
          },
        });

        await new Promise((r) => setTimeout(r, 60));

        const sc = registry.getScenario('sc_pipe_risk_ks_06');
        assert.ok(sc, 'Escenario debe persistir en base de datos');
        assert.equal(sc.status, 'CANCELLED');
        assert.match(sc.rejectionReason || '', /Kill Switch/i);
        assert.equal(stateMachine.getActiveSignals().length, countAfterKs, 'Zero señales nuevas con Kill Switch activo');
      } finally {
        // Restaurar Kill Switch para subsiguientes pruebas
        coordinator.setKillSwitch(false);
      }
    });

    // ------------------------------------------------------------------------
    // 7. RIESGO BLOQUEANTE: Datos obsoletos (stale feed) con IA en APPROVE no registra señal
    // ------------------------------------------------------------------------
    await t.test('7. Riesgo bloqueante: Datos de mercado obsoletos cancelan entrada y no registran señal aunque IA emita APPROVE', async () => {
      const initialCount = stateMachine.getActiveSignals().length;

      // Price zone 64000 (distinct from subtest 1 at 60000 to avoid deduplication)
      const scenario = makeScenario('sc_pipe_risk_stale_07', 'LONG', 63900, 64100, 64000, 63500, 65200, 66500);
      const plan = makeWatchPlan('sc_pipe_risk_stale_07', 'LONG', 63900, 64100, 64000, 63500, 65200, 66500);
      scenario.watchPlan = plan;
      registry.registerScenario(scenario);
      db.saveWatchPlan(plan);

      aiRevalidation.setMockEvaluator(() => ({
        openaiVerdict: 'APPROVE',
        geminiVerdict: 'APPROVE',
        reasoning: 'IA aprueba pero feed desactualizado debe bloquearla',
      }));

      // Simular feed WebSocket desactualizado (> 10s maxDataStalenessMs)
      const origGetLastMsg = (coordinator as any).wsClient.getLastMessageTime;
      (coordinator as any).wsClient.getLastMessageTime = () => Date.now() - 30000;

      try {
        (coordinator as any).currentTicker.lastPrice = 64000;
        (coordinator as any).currentTicker.markPrice = 64000;
        (coordinator as any).currentTicker.timestamp = Date.now();

        coordinator.emit('state_updated', {
          ticker: {
            lastPrice: 64000,
            markPrice: 64000,
            spread: 0.1,
            spreadPcnt: 0.0001,
          },
        });

        await new Promise((r) => setTimeout(r, 60));

        const sc = registry.getScenario('sc_pipe_risk_stale_07');
        assert.ok(sc, 'Escenario debe encontrarse en registro');
        assert.equal(sc.status, 'CANCELLED');
        assert.match(sc.rejectionReason || '', /obsoletos|desconectado|datos/i);
        assert.equal(stateMachine.getActiveSignals().length, initialCount, 'Zero señales nuevas con datos obsoletos');
      } finally {
        // Restaurar reloj de feed
        (coordinator as any).wsClient.getLastMessageTime = origGetLastMsg;
      }
    });

    // ------------------------------------------------------------------------
    // 8. RIESGO BLOQUEANTE: R:R neto insuficiente con IA en APPROVE no registra señal
    // ------------------------------------------------------------------------
    await t.test('8. Riesgo bloqueante: R:R neto insuficiente cancela entrada y no registra señal aunque IA emita APPROVE', async () => {
      const initialCount = stateMachine.getActiveSignals().length;

      // Escenario SHORT en 56000 con objetivos demasiado cercanos que no cubren comisiones (R:R neto < 1:2 / 1:4)
      // SL distance = 200 (0.35% <= 1.5% max SL ceiling), TP12 reward = 50, TP14 reward = 100
      const scenario = makeScenario('sc_pipe_risk_bad_rr_08', 'SHORT', 55900, 56100, 56000, 56200, 55950, 55900);
      const plan = makeWatchPlan('sc_pipe_risk_bad_rr_08', 'SHORT', 55900, 56100, 56000, 56200, 55950, 55900);
      scenario.watchPlan = plan;
      registry.registerScenario(scenario);
      db.saveWatchPlan(plan);

      aiRevalidation.setMockEvaluator(() => ({
        openaiVerdict: 'APPROVE',
        geminiVerdict: 'APPROVE',
        reasoning: 'IA aprueba pero matemática cuantitativa de R:R debe rechazarla',
      }));

      (coordinator as any).currentTicker.lastPrice = 56000;
      (coordinator as any).currentTicker.markPrice = 56000;
      (coordinator as any).currentTicker.timestamp = Date.now();

      coordinator.emit('state_updated', {
        ticker: {
          lastPrice: 56000,
          markPrice: 56000,
          spread: 0.1,
          spreadPcnt: 0.0001,
        },
      });

      await new Promise((r) => setTimeout(r, 60));

      const sc = registry.getScenario('sc_pipe_risk_bad_rr_08');
      assert.ok(sc, 'Escenario debe encontrarse en registro');
      assert.equal(sc.status, 'CANCELLED');
      assert.match(sc.rejectionReason || '', /R:R|umbral|comisiones/i);
      assert.equal(stateMachine.getActiveSignals().length, initialCount, 'Zero señales nuevas con R:R neto insuficiente');
    });

    // ------------------------------------------------------------------------
    // 9. RIESGO BLOQUEANTE: ATR 15m ausente o inválido con límite ATR habilitado
    // ------------------------------------------------------------------------
    await t.test('9. Riesgo bloqueante: ATR 15m ausente o inválido cancela entrada y no registra señal aunque IA emita APPROVE', async () => {
      const initialCount = stateMachine.getActiveSignals().length;

      // Scenario in zone 57000 (distinct price to prevent deduplication)
      const scenario = makeScenario('sc_pipe_risk_no_atr_09', 'LONG', 56900, 57100, 57000, 56500, 58200, 59500);
      const plan = makeWatchPlan('sc_pipe_risk_no_atr_09', 'LONG', 56900, 57100, 57000, 56500, 58200, 59500);
      scenario.watchPlan = plan;
      registry.registerScenario(scenario);
      db.saveWatchPlan(plan);

      aiRevalidation.setMockEvaluator(() => ({
        openaiVerdict: 'APPROVE',
        geminiVerdict: 'APPROVE',
        reasoning: 'IA aprueba pero ATR 15m ausente/inválido debe bloquearla fail-closed',
      }));

      // Simulate ATR 15m missing / invalid (delete '15m' from latestAnalyses)
      const savedAtr = (coordinator.getSetupEngine() as any).latestAnalyses.get('15m');
      (coordinator.getSetupEngine() as any).latestAnalyses.delete('15m');

      try {
        (coordinator as any).currentTicker.lastPrice = 57000;
        (coordinator as any).currentTicker.markPrice = 57000;
        (coordinator as any).currentTicker.timestamp = Date.now();

        coordinator.emit('state_updated', {
          ticker: {
            lastPrice: 57000,
            markPrice: 57000,
            spread: 0.1,
            spreadPcnt: 0.0001,
          },
        });

        await new Promise((r) => setTimeout(r, 60));

        const sc = registry.getScenario('sc_pipe_risk_no_atr_09');
        assert.ok(sc, 'Escenario debe encontrarse en registro');
        assert.equal(sc.status, 'CANCELLED');
        assert.match(sc.rejectionReason || '', /ATR/i);
        assert.equal(stateMachine.getActiveSignals().length, initialCount, 'Zero señales nuevas con ATR ausente');

        // Check SQLite: no signal must be registered for this scenario
        const dbSignals = db.getSignals(10);
        const signalFound = dbSignals.find((s: any) => s.setupId === 'sc_pipe_risk_no_atr_09');
        assert.equal(signalFound, undefined, 'No signal in SQLite for rejected scenario');
      } finally {
        // Restore valid ATR 15m
        if (savedAtr) {
          (coordinator.getSetupEngine() as any).latestAnalyses.set('15m', savedAtr);
        }
      }
    });
  } finally {
    watcher.stop();
    coordinator.stop();
    db.close();
  }
});

for (const exit of ['TP', 'SL'] as const) test(`Paper circuit: watcher through ${exit} survives SQLite reopen`, async () => {
  const folder = mkdtempSync(join(tmpdir(), 'nanotrading-paper-'));
  const dbPath = join(folder, 'paper.sqlite');
  const { coordinator, db } = createPipelineTestRig(dbPath);
  const watcher = coordinator.getAlgorithmicWatcher();
  const machine = coordinator.getSignalStateMachine();
  const notify = async () => {};
  const worker = new MarketMonitorWorker({ coordinator, stateMachine: machine, db,
    telegramNotifier: { notifyApproachingZone: notify, notifyInZone: notify, notifyEntryTriggered: notify,
      notifyTakeProfitCompleted: notify, notifyStopLossCompleted: notify } as any,
    webPushNotifier: { notifyTakeProfit: notify, notifyStopLoss: notify } as any });
  try {
    watcher.start(); worker.start();
    coordinator.getAiRevalidation().setMockEvaluator(() => ({
      openaiVerdict: 'APPROVE', geminiVerdict: 'APPROVE', reasoning: 'Offline fixture',
    }));
    const scenario = makeScenario('audit_paper_fill', 'LONG', 59900, 60100, 60000, 59500, 61200, 62500);
    scenario.watchPlan = makeWatchPlan(scenario.id, 'LONG', 59900, 60100, 60000, 59500, 61200, 62500);
    coordinator.getScenarioRegistry().registerScenario(scenario);
    coordinator.emit('state_updated', { ticker: { lastPrice: 60000, markPrice: 60000, spread: 0.1, spreadPcnt: 0.0001 } });
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(machine.getActiveSignals()[0]?.state, 'ENTRY_VALIDATED');
    coordinator.emit('ticker_updated', { lastPrice: 60000, timestamp: Date.now() });
    assert.equal(machine.getActiveSignals()[0]?.state, 'TRACKING');
    assert.ok(db.getSignals(10)[0].simulatedEntryTime);
    const funnel = db.getDiscoveryFunnel() as any;
    assert.equal(funnel.authorizedSignals, 1);
    assert.equal(funnel.paperEntries, 1);
    assert.equal(funnel.paperClosed, 0);
    const signal = machine.getActiveSignals()[0];
    coordinator.emit('ticker_updated', { lastPrice: 60500, timestamp: Date.now() });
    assert.equal(db.getSignals(10)[0].status, 'TRACKING');
    const exitPrice = exit === 'TP' ? signal.takeProfitPrice : signal.stopLossPrice - 50;
    coordinator.emit('ticker_updated', { lastPrice: exitPrice, timestamp: Date.now() });
    const closed = db.getSignals(10)[0];
    assert.equal(closed.status, `COMPLETED_${exit}`);
    assert.ok(closed.simulatedEntryTime);
    assert.ok(closed.exitTime >= closed.simulatedEntryTime);
    assert.equal(closed.exitPrice, exitPrice);
    assert.ok(exit === 'TP' ? closed.realizedNetPnlUsdt > 0 : closed.realizedNetPnlUsdt < 0);
    assert.equal((db.getDiscoveryFunnel() as any).paperClosed, 1);
    worker.stop(); watcher.stop(); coordinator.stop(); db.close();
    const reopened = new DatabaseService(dbPath);
    try {
      assert.deepEqual(reopened.getSignals(10)[0], closed);
      const states = reopened.getSignalLifecycle(signal.id).map((row: any) => row.toState);
      for (const state of ['ENTRY_TRIGGERED', 'TRACKING', `COMPLETED_${exit}`]) assert.ok(states.includes(state));
    } finally { reopened.close(); }
  } finally {
    worker.stop(); watcher.stop(); coordinator.stop(); db.close();
    rmSync(folder, { recursive: true, force: true });
  }
});


test('Audit fix: selected short target cannot fall back to the extended target below its effective floor', async () => {
  const { coordinator, db } = createPipelineTestRig();
  try {
    coordinator.getRiskPolicyManager().updatePolicy({ rrTargetMode: 'RR_1_2' });
    coordinator.getAiRevalidation().setMockEvaluator(() => ({ openaiVerdict: 'APPROVE', geminiVerdict: 'APPROVE', reasoning: 'Offline fixture' }));
    const scenario = makeScenario('audit_disallowed_target', 'LONG', 59900, 60100, 60000, 59500, 61200, 62500);
    scenario.watchPlan = makeWatchPlan(scenario.id, 'LONG', 59900, 60100, 60000, 59500, 61200, 62500);
    coordinator.getScenarioRegistry().registerScenario(scenario);
    const result = await coordinator.getAiRevalidation().revalidate(scenario, 60000);
    assert.equal(result.scenario.status, 'CANCELLED');
    assert.match(result.reason!, /R:R neto/);
    assert.equal(db.getSignals(10).length, 0);
  } finally { coordinator.stop(); db.close(); }
});
