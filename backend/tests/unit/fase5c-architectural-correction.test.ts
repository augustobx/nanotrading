import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseService } from '../../src/storage/database.js';
import { ScenarioRegistry } from '../../src/engine/scenario-registry.js';
import { AlgorithmicWatcher } from '../../src/engine/algorithmic-watcher.js';
import { AiMarketDiscoveryEngine } from '../../src/ai/ai-market-discovery.js';
import { AiEntryRevalidation } from '../../src/ai/ai-revalidation.js';
import { HardBudgetManager } from '../../src/ai/hard-budget-manager.js';
import { OpenAiAdapter } from '../../src/ai/openai-adapter.js';
import { GeminiAdapter } from '../../src/ai/gemini-adapter.js';
import { SignalStateMachine } from '../../src/engine/signal-state-machine.js';
import { EventEmitter } from 'events';
import { CandleManager } from '../../src/market/candle-manager.js';
import { OrderBookManager } from '../../src/market/orderbook-manager.js';
import { BybitRestClient } from '../../src/bybit/bybit-rest-client.js';
import { BybitWsClient } from '../../src/bybit/bybit-ws-client.js';
import { MarketCoordinator } from '../../src/market/market-coordinator.js';
import { Scenario, AiWatchPlan } from '../../src/ai/scenario-types.js';

class MockMarketCoordinator extends EventEmitter {
  private marketState: any = {
    symbol: 'BTCUSDT',
    wsConnected: true,
    ticker: {
      lastPrice: 65200,
      markPrice: 65200,
      indexPrice: 65200,
      spread: 0.8,
      spreadPcnt: 0.0012,
      fundingRate: 0.0001,
      openInterest: 65000,
      highPrice24h: 66500,
      lowPrice24h: 64200,
    },
    orderBook: {
      spread: 0.8,
      spreadPcnt: 0.0012,
      imbalance: 0.15,
      bestBid: 65199.6,
      bestAsk: 65200.4,
      bids: [[65199.6, 2.5], [65199.0, 5.0]],
      asks: [[65200.4, 2.2], [65201.0, 4.8]],
      isSynced: true,
    },
  };

  private candleManager: any;
  private setupEngine: any;

  constructor() {
    super();
    this.candleManager = {
      getCandles: () => [
        { open: 64800, high: 65300, low: 64700, close: 65200, volume: 1500, timestamp: Date.now() - 900000 },
        { open: 65200, high: 65400, low: 65150, close: 65200, volume: 1200, timestamp: Date.now() },
      ],
      getLastClosedCandle: () => ({ open: 64800, high: 65300, low: 64700, close: 65200, volume: 1500, timestamp: Date.now() - 900000 }),
      getCurrentCandle: () => ({ open: 65200, high: 65400, low: 65150, close: 65200, volume: 1200, timestamp: Date.now() }),
    };

    this.setupEngine = {
      getAnalysis: (tf: string) => ({
        trend: 'BULLISH',
        rsi: 54.2,
        atr: 120,
        structure: {
          swings: [
            { type: 'LOW', price: 64100, label: 'HL', timestamp: Date.now() - 3600000 },
            { type: 'HIGH', price: 65800, label: 'HH', timestamp: Date.now() - 1800000 },
          ],
          structureBreaks: [
            { type: 'BOS', direction: 'BULLISH', brokenLevel: 65100, timestamp: Date.now() - 900000 },
          ],
          fvgs: [
            { type: 'BULLISH', top: 64600, bottom: 64400, size: 200, status: 'ACTIVE' },
          ],
          orderBlocks: [
            { type: 'BULLISH', top: 64350, bottom: 64100, status: 'ACTIVE' },
          ],
          sweeps: [
            { direction: 'BULLISH', sweptLevel: 64150, poolType: 'EQL', timestamp: Date.now() - 7200000 },
          ],
        },
      }),
      getActiveSetups: () => [
        {
          id: 'ref_strat_a_1',
          strategy: 'STRATEGY_A_TREND_CONTINUATION',
          direction: 'LONG',
          timeframe: '15m',
          entryPrice: 64500,
          stopLossPrice: 64000,
          takeProfitPrice: 66600,
          riskReward: { grossRR: 4.2, netRR: 4.12, isValid: true },
          evidence: ['Referencia algorítmica: retroceso a FVG 15m'],
        },
      ],
    };
  }

  public getMarketState() {
    return this.marketState;
  }

  public getCandleManager() {
    return this.candleManager;
  }

  public getSetupEngine() {
    return this.setupEngine;
  }

  public setPrice(price: number) {
    this.marketState.ticker.lastPrice = price;
    this.emit('state_updated', this.marketState);
  }
}

test('Fase 5C — Análisis integral autónomo de IA sin ataduras a Estrategia A/B', async () => {
  const db = new DatabaseService(':memory:');
  const coordinator = new MockMarketCoordinator() as any;
  const registry = new ScenarioRegistry(db);

  const budget = new HardBudgetManager({
    dailyBudgetLimitUsd: 10,
    monthlyBudgetLimitUsd: 100,
    maxCostPerRequestUsd: 1,
  }, undefined, db);

  const openai = new OpenAiAdapter({ apiKey: 'mock', model: 'gpt-4o' });
  const gemini = new GeminiAdapter({ apiKey: 'mock', model: 'gemini-2.0-flash' });

  const discovery = new AiMarketDiscoveryEngine({
    coordinator,
    openaiAdapter: openai,
    geminiAdapter: gemini,
    hardBudgetManager: budget,
    scenarioRegistry: registry,
    db,
  });

  // 1. Verificar Market Intelligence Summary completo
  const summary = discovery.buildMarketIntelligenceSummary();
  assert.ok(summary);
  assert.strictEqual(summary.symbol, 'BTCUSDT');
  assert.strictEqual(summary.dataAvailability.wsConnected, true);
  assert.strictEqual(summary.dataAvailability.orderBookSynced, true);
  assert.strictEqual(summary.dataAvailability.allCriticalDataPresent, true);
  assert.ok(summary.algorithmicReferenceSetups && summary.algorithmicReferenceSetups.length > 0);
  assert.strictEqual(summary.algorithmicReferenceSetups[0].strategy, 'STRATEGY_A_TREND_CONTINUATION');

  // 2. Mock de razonamiento autónomo de las IA:
  // OpenAI y Gemini proponen libremente una oportunidad de mitigación en zona de descuento FVG (sin ser forzados a Estrategia A o B)
  discovery.setMockEvaluator((sum: any) => ({
    openai: {
      bias: 'BULLISH',
      reasoning: 'BTC absorbió liquidez previa en 64,150 y formó BOS alcista en 15m. Esperamos mitigación en zona 64,400 - 64,600 para continuación con R:R 1:4.',
      marketAnalysis: {
        whatMarketIsDoing: 'Consolidando por encima de la zona de quiebre estructural de 15m',
        whyMarketIsDoingIt: 'Reacumulación tras barrido de liquidez de mínimos asiáticos',
        evidenceList: [
          'BOS confirmado en 65,100',
          'FVG activo en [64,400 - 64,600]',
          'Order book balanceado sin muros de venta pesados',
        ],
        bias: 'BULLISH',
        preferredHorizon: 'INTRADAY',
        recommendedTimeframe: '15m',
      },
      scenarios: [
        {
          direction: 'LONG',
          timeframe: '15m',
          structureType: 'SMC_DISCRETIONARY_DISCOVERY',
          entryZoneMin: 64400,
          entryZoneMax: 64600,
          targetEntry: 64500,
          structuralStopLoss: 64000,
          candidateTarget12: 65800,
          candidateTarget14: 67200,
          missingConditions: ['Mitigación limpia del FVG en 15m sin cierre bajo 64,400'],
          argumentsFor: ['Confluencia BOS + FVG de descuento'],
          argumentsAgainst: ['Spread en apertura de sesión de Londres'],
          watchPlan: {
            horizon: 'INTRADAY',
            observableConditions: [
              {
                id: 'cond_fvg_mitigation',
                description: 'Precio entra en la zona FVG [64400 - 64600]',
                operator: 'PRICE_IN_RANGE',
                params: { minLevel: 64400, maxLevel: 64600 },
                automatable: true,
              },
              {
                id: 'cond_spread_check',
                description: 'Spread menor a 0.05%',
                operator: 'SPREAD_TOLERANCE',
                params: { threshold: 0.05 },
                automatable: true,
              },
            ],
            confirmationSequence: [
              '1. Mitigación controlada de la zona [64400 - 64600]',
              '2. Absorción sin cuerpo de vela debajo de 64400',
            ],
            invalidationConditions: [
              {
                id: 'inv_sl_break',
                description: 'Precio vulnera el Stop Loss estructural 64000',
                operator: 'PRICE_CROSS_BELOW',
                params: { level: 64000 },
                automatable: true,
              },
            ],
            expirationHours: 8,
          },
        },
      ],
    },
  }));

  const discResult = await discovery.runDiscovery({ forceManual: true });
  assert.strictEqual(discResult.scenarios.length, 1);

  const sc = discResult.scenarios[0];
  assert.strictEqual(sc.direction, 'LONG');
  assert.strictEqual(sc.structureType, 'SMC_DISCRETIONARY_DISCOVERY');
  assert.ok(sc.watchPlan);
  assert.strictEqual(sc.watchPlan.symbol, 'BTCUSDT');
  assert.strictEqual(sc.watchPlan.horizon, 'INTRADAY');
  assert.strictEqual(sc.watchPlan.automatable, true);
  assert.strictEqual(sc.watchPlan.observableConditions.length, 2);
  assert.strictEqual(sc.watchPlan.invalidationConditions.length, 1);

  // Verificar persistencia del plan de vigilancia
  const savedPlan = db.getWatchPlanById(sc.watchPlan.id);
  assert.ok(savedPlan);
  assert.strictEqual(savedPlan?.id, sc.watchPlan.id);
  assert.strictEqual(savedPlan?.direction, 'LONG');
  assert.strictEqual(savedPlan?.watchZone.minPrice, 64400);
  assert.strictEqual(savedPlan?.watchZone.maxPrice, 64600);

  db.close();
});

test('Fase 5C — Condición no automatizable: marca automatable=false y no aprueba automáticamente', async () => {
  const db = new DatabaseService(':memory:');
  const coordinator = new MockMarketCoordinator() as any;
  const registry = new ScenarioRegistry(db);

  const budget = new HardBudgetManager({
    dailyBudgetLimitUsd: 10,
    monthlyBudgetLimitUsd: 100,
    maxCostPerRequestUsd: 1,
  }, undefined, db);

  const openai = new OpenAiAdapter({ apiKey: 'mock', model: 'gpt-4o' });
  const gemini = new GeminiAdapter({ apiKey: 'mock', model: 'gemini-2.0-flash' });

  const discovery = new AiMarketDiscoveryEngine({
    coordinator,
    openaiAdapter: openai,
    geminiAdapter: gemini,
    hardBudgetManager: budget,
    scenarioRegistry: registry,
    db,
  });

  const watcher = new AlgorithmicWatcher(coordinator, registry, undefined, undefined, { approachThresholdPct: 0.5 });

  discovery.setMockEvaluator(() => ({
    openai: {
      bias: 'BULLISH',
      reasoning: 'Oportunidad con condición subjetiva no automatizable',
      scenarios: [
        {
          direction: 'LONG',
          timeframe: '15m',
          entryZoneMin: 64400,
          entryZoneMax: 64600,
          targetEntry: 64500,
          structuralStopLoss: 64000,
          candidateTarget12: 65800,
          candidateTarget14: 67200,
          watchPlan: {
            horizon: 'INTRADAY',
            observableConditions: [
              {
                id: 'cond_manual_sentiment',
                description: 'Verificar sentimiento positivo en redes sociales antes de entrar',
                operator: 'PRICE_IN_RANGE', // fallback
                params: { minLevel: 64400, maxLevel: 64600 },
                automatable: false, // Subjective non-automatable
              },
            ],
            invalidationConditions: [
              {
                id: 'inv_1',
                description: 'Pérdida de 64000',
                operator: 'PRICE_CROSS_BELOW',
                params: { level: 64000 },
                automatable: true,
              },
            ],
            expirationHours: 4,
          },
        },
      ],
    },
  }));

  const discResult = await discovery.runDiscovery({ forceManual: true });
  assert.strictEqual(discResult.scenarios.length, 1);
  const sc = discResult.scenarios[0];
  assert.strictEqual(sc.watchPlan?.automatable, false);

  // Cuando el precio llega a la zona, el watcher no auto-aprueba ni solicita reevaluación directa:
  // Pasa a WAITING_CONFIRMATION por requerir intervención manual
  watcher.evaluateTick(64500);
  await new Promise((resolve) => setTimeout(resolve, 50)); // In zone price

  const updatedSc = registry.getScenario(sc.id);
  assert.strictEqual(updatedSc?.status, 'WAITING_CONFIRMATION');

  db.close();
});

test('Fase 5C — Replay determinista de ciclo completo con AI_WATCH_PLAN', async () => {
  const db = new DatabaseService(':memory:');
  const coordinator = new MockMarketCoordinator() as any;
  const registry = new ScenarioRegistry(db);
  const stateMachine = new SignalStateMachine(db);

  const budget = new HardBudgetManager({
    dailyBudgetLimitUsd: 10,
    monthlyBudgetLimitUsd: 100,
    maxCostPerRequestUsd: 1,
  }, undefined, db);

  const openai = new OpenAiAdapter({ apiKey: 'mock', model: 'gpt-4o' });
  const gemini = new GeminiAdapter({ apiKey: 'mock', model: 'gemini-2.0-flash' });

  const discovery = new AiMarketDiscoveryEngine({
    coordinator,
    openaiAdapter: openai,
    geminiAdapter: gemini,
    hardBudgetManager: budget,
    scenarioRegistry: registry,
    db,
  });

  const watcher = new AlgorithmicWatcher(coordinator, registry, undefined, undefined, { approachThresholdPct: 0.5 });

  const revalidation = new AiEntryRevalidation({
    coordinator,
    openaiAdapter: openai,
    geminiAdapter: gemini,
    hardBudgetManager: budget,
    scenarioRegistry: registry,
    db,
  });

  revalidation.setMockEvaluator(() => ({
    openaiVerdict: 'APPROVE',
    geminiVerdict: 'APPROVE',
    reasoning: 'Evaluación rápida mock para drift test',
  }));

  let revalCalls = 0;
  watcher.on('revalidation_requested', async ({ scenario, watchPlan, currentPrice }) => {
    revalCalls++;
    await revalidation.revalidate(scenario, currentPrice, watchPlan);
  });

  revalidation.on('entry_validated', ({ scenario, currentPrice, riskCalc }) => {
    // Register dual target paper trading signals
    if (scenario.target12Price && riskCalc?.calculation12?.isValid) {
      stateMachine.registerSignalFromScenario(scenario, currentPrice, 'RR_1_2', scenario.target12Price, riskCalc.calculation12.netRR);
    }
    if (scenario.target14Price && riskCalc?.calculation14?.isValid) {
      stateMachine.registerSignalFromScenario(scenario, currentPrice, 'RR_1_4', scenario.target14Price, riskCalc.calculation14.netRR);
    }
  });

  // 1. Descubrimiento autónomo
  discovery.setMockEvaluator(() => ({
    openai: {
      bias: 'BULLISH',
      reasoning: 'Rebote confirmado en demanda 15m con FVG activo',
      scenarios: [
        {
          id: 'scen_walkthrough_1',
          direction: 'LONG',
          timeframe: '15m',
          entryZoneMin: 64400,
          entryZoneMax: 64600,
          targetEntry: 64500,
          structuralStopLoss: 64000,
          candidateTarget12: 65800,
          candidateTarget14: 67200,
          watchPlan: {
            horizon: 'INTRADAY',
            observableConditions: [
              {
                id: 'c1',
                description: 'Zona [64400 - 64600]',
                operator: 'PRICE_IN_RANGE',
                params: { minLevel: 64400, maxLevel: 64600 },
                automatable: true,
              },
            ],
            invalidationConditions: [
              {
                id: 'i1',
                description: 'SL 64000',
                operator: 'PRICE_CROSS_BELOW',
                params: { level: 64000 },
                automatable: true,
              },
            ],
            expirationHours: 6,
          },
        },
      ],
    },
  }));

  const disc = await discovery.runDiscovery({ forceManual: true });
  const sc = disc.scenarios[0];
  assert.strictEqual(sc.status, 'SCENARIO_REGISTERED');
  assert.strictEqual(sc.watchPlan?.status, 'ACTIVE');

  // 2. Vigilancia: Precio a 64,800 (distancia = (64800 - 64600)/64800 = 0.30% <= 0.5% -> APPROACHING_ZONE)
  watcher.evaluateTick(64800);
  const appSc = registry.getScenario(sc.id);
  assert.strictEqual(appSc?.status, 'APPROACHING_ZONE');

  // 3. Vigilancia: Precio entra a la zona a 64,500
  // Configurar reevaluación mock con consenso aprobatorio dual
  revalidation.setMockEvaluator(() => ({
    openaiVerdict: 'APPROVE',
    geminiVerdict: 'APPROVE',
    reasoning: 'Mitigación limpia sin presión vendedora excesiva confirmada.',
  }));

  watcher.evaluateTick(64500);
  await new Promise((resolve) => setTimeout(resolve, 50));

  // Verificar que la reevaluación fue llamada
  assert.strictEqual(revalCalls, 1);

  const valSc = registry.getScenario(sc.id);
  assert.strictEqual(valSc?.status, 'ENTRY_VALIDATED');
  assert.strictEqual(valSc?.watchPlan?.status, 'ENTRY_VALIDATED');

  // 4. Verificar que se crearon los registros prospectivos en Paper Trading
  const activePaperSignals = stateMachine.getActiveSignals();
  assert.strictEqual(activePaperSignals.length, 2); // 1:2 y 1:4

  const sig12 = activePaperSignals.find((s) => s.rrMode === 'RR_1_2' || s.id.includes('RR_1_2'));
  const sig14 = activePaperSignals.find((s) => s.rrMode === 'RR_1_4' || s.id.includes('RR_1_4'));

  assert.ok(sig12);
  assert.ok(sig14);
  assert.strictEqual(sig12?.entryPrice, 64500);
  assert.strictEqual(sig14?.entryPrice, 64500);
  assert.ok((sig12?.netRR || 0) >= 2.0);
  assert.ok((sig14?.netRR || 0) >= 4.0);

  db.close();
});

test('Fase 5C — Invalidation y Dynamic Price Drift garantizan seguridad determinista', async () => {
  const db = new DatabaseService(':memory:');
  const coordinator = new MockMarketCoordinator() as any;
  const registry = new ScenarioRegistry(db);

  const budget = new HardBudgetManager({
    dailyBudgetLimitUsd: 10,
    monthlyBudgetLimitUsd: 100,
    maxCostPerRequestUsd: 1,
  }, undefined, db);

  const openai = new OpenAiAdapter({ apiKey: 'mock', model: 'gpt-4o' });
  const gemini = new GeminiAdapter({ apiKey: 'mock', model: 'gemini-2.0-flash' });

  const revalidation = new AiEntryRevalidation({
    coordinator,
    openaiAdapter: openai,
    geminiAdapter: gemini,
    hardBudgetManager: budget,
    scenarioRegistry: registry,
    db,
  });

  revalidation.setMockEvaluator(() => ({
    openaiVerdict: 'APPROVE',
    geminiVerdict: 'APPROVE',
    reasoning: 'Evaluación rápida mock para drift test',
  }));

  const watcher = new AlgorithmicWatcher(coordinator, registry);

  // Escenario LONG: Entrada 64500, SL 64000
  const scenario: Scenario = {
    id: 'scen_drift_test',
    symbol: 'BTCUSDT',
    direction: 'LONG',
    timeframe: '15m',
    structureType: 'SMC_DISCRETIONARY_DISCOVERY',
    proposedBy: 'CONSENSUS',
    modelsUsed: ['gpt-4o'],
    snapshotId: 'snap_1',
    discoveryTimestamp: Date.now(),
    entryZoneMin: 64400,
    entryZoneMax: 64600,
    targetEntry: 64500,
    stopLossPrice: 64000,
    target12Price: 65800,
    target14Price: 67200,
    netRR12: 2.1,
    netRR14: 4.15,
    rrModeAvailable: 'RR_BOTH',
    uncertaintyLevel: 'LOW',
    status: 'SCENARIO_REGISTERED',
    validUntilTimestamp: Date.now() + 3600000,
    aiCostUsd: 0.001,
    activationConditions: ['En zona'],
    invalidationTriggers: ['SL 64000'],
    argumentsFor: ['SMC'],
    argumentsAgainst: [],
    watchPlan: {
      id: 'wp_drift_test',
      scenarioId: 'scen_drift_test',
      symbol: 'BTCUSDT',
      direction: 'LONG',
      marketThesis: 'Test Drift y SL',
      horizon: 'INTRADAY',
      primaryTimeframe: '15m',
      watchZone: { minPrice: 64400, maxPrice: 64600, targetEntry: 64500 },
      candidateStopLoss: 64000,
      candidateTakeProfits: { tp12: 65800, tp14: 67200 },
      rrEligibility: 'RR_BOTH',
      observableConditions: [],
      confirmationSequence: [],
      invalidationConditions: [
        {
          id: 'inv_sl',
          description: 'Cruce bajo 64000',
          operator: 'PRICE_CROSS_BELOW',
          params: { level: 64000 },
          automatable: true,
        },
      ],
      expirationTimestamp: Date.now() + 3600000,
      reevaluationTriggers: [],
      reasoningVersion: 'v1',
      status: 'ACTIVE',
      automatable: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  registry.registerScenario(scenario);

  // 1. Caso Invalidation: El precio se desploma directo a 63,950 antes de entrar
  watcher.evaluateTick(63950);
  const invSc = registry.getScenario('scen_drift_test');
  assert.strictEqual(invSc?.status, 'INVALIDATED');
  assert.strictEqual(invSc?.watchPlan?.status, 'INVALIDATED');

  // 2. Caso Price Drift: El precio se aleja materialmente de la entrada (a 64,800 vs 64,500 = +300 USDT > tolerancia máxima de 50 USDT)
  const scDrift = {
    ...scenario,
    id: 'scen_drift_2',
    status: 'IN_ZONE' as const,
  };
  registry.registerScenario(scDrift);

  // Revalidar en precio con drift excesivo
  const resDrift = await revalidation.revalidate(scDrift, 64800);
  assert.strictEqual(resDrift.scenario.status, 'EXPIRED');
  assert.ok(resDrift.reason?.includes('Desviación de precio'));

  db.close();
});

test('Fase 5C — Conclusión formal NEUTRAL genera plan de espera sin forzar señales', async () => {
  const db = new DatabaseService(':memory:');
  const coordinator = new MockMarketCoordinator() as any;
  const registry = new ScenarioRegistry(db);

  const budget = new HardBudgetManager({
    dailyBudgetLimitUsd: 10,
    monthlyBudgetLimitUsd: 100,
    maxCostPerRequestUsd: 1,
  }, undefined, db);

  const openai = new OpenAiAdapter({ apiKey: 'mock', model: 'gpt-4o' });
  const gemini = new GeminiAdapter({ apiKey: 'mock', model: 'gemini-2.0-flash' });

  const discovery = new AiMarketDiscoveryEngine({
    coordinator,
    openaiAdapter: openai,
    geminiAdapter: gemini,
    hardBudgetManager: budget,
    scenarioRegistry: registry,
    db,
  });

  // Ambos modelos concluyen NEUTRAL con 0 escenarios (mercado en consolidación sucia)
  discovery.setMockEvaluator(() => ({
    openai: {
      bias: 'NEUTRAL',
      reasoning: 'Mercado en rango sucio sin volumen ni confluencia. "No operar es una decisión válida y a menudo la mejor".',
      scenarios: [],
      marketAnalysis: {
        whatMarketIsDoing: 'Rango lateral comprimido en 15m',
        whyMarketIsDoingIt: 'Falta de participación institucional previo al cierre semanal',
        evidenceList: ['Volumen decreciente', 'Sin barridos limpios'],
        bias: 'NEUTRAL',
        preferredHorizon: 'INTRADAY',
        recommendedTimeframe: '15m',
        noTradeJustification: 'Sin asimetría favorable de riesgo/beneficio',
      },
    },
  }));

  const disc = await discovery.runDiscovery({ forceManual: true });
  assert.strictEqual(disc.scenarios.length, 1);

  const neutralSc = disc.scenarios[0];
  assert.strictEqual(neutralSc.direction, 'NEUTRAL');
  assert.strictEqual(neutralSc.status, 'NO_TRADE_OBSERVATION');
  assert.ok(neutralSc.watchPlan);
  assert.strictEqual(neutralSc.watchPlan.direction, 'NEUTRAL');
  assert.ok(neutralSc.aiMarketThesis?.includes('No operar es una decisión válida'));

  db.close();
});
