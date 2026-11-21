import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseService } from '../../src/storage/database.js';
import { ScenarioRegistry } from '../../src/engine/scenario-registry.js';
import { AlgorithmicWatcher } from '../../src/engine/algorithmic-watcher.js';
import { AiMarketDiscoveryEngine, verifyProposedLevels } from '../../src/ai/ai-market-discovery.js';
import { HardBudgetManager } from '../../src/ai/hard-budget-manager.js';
import { OpenAiAdapter } from '../../src/ai/openai-adapter.js';
import { GeminiAdapter } from '../../src/ai/gemini-adapter.js';
import { EventEmitter } from 'events';
import { MarketIntelligenceSummary } from '../../src/ai/scenario-types.js';

class MockMarketCoordinator extends EventEmitter {
  private marketState: any = {
    symbol: 'BTCUSDT',
    wsConnected: true,
    ticker: {
      lastPrice: 60000,
      markPrice: 60000,
      indexPrice: 60000,
      spread: 0.5,
      spreadPcnt: 0.0008,
      fundingRate: 0.0001,
      openInterest: 50000,
      highPrice24h: 61000,
      lowPrice24h: 59000,
    },
    orderBook: {
      spread: 0.5,
      spreadPcnt: 0.0008,
      imbalance: 0.1,
      bestBid: 59999.5,
      bestAsk: 60000.5,
      bids: [[59999.5, 3.0]],
      asks: [[60000.5, 3.0]],
      isSynced: true,
    },
  };

  public setupEngine: any;
  public discoveryScheduler: any;
  public candleManager: any;

  constructor() {
    super();
    this.candleManager = {
      getCandles: () => Array.from({ length: 20 }, (_, i) => ({
        open: 60000, high: 60200, low: 59900, close: 60000, volume: 100,
        timestamp: Date.now() - (i + 1) * 900000, confirmed: true,
      })),
      getLastClosedCandle: () => ({ open: 60000, high: 60200, low: 59900, close: 60000, volume: 1500, timestamp: Date.now() - 900000 }),
      getCurrentCandle: () => ({ open: 60000, high: 60200, low: 59900, close: 60000, volume: 1200, timestamp: Date.now() }),
    };
    this.setupEngine = {
      getAnalysis: (tf: string) => ({
        trend: 'RANGING',
        rsi: 50,
        atr: 100,
        structure: {
          swings: [
            { type: 'LOW', price: 59500, label: 'LL', timestamp: Date.now() - 3600000 },
            { type: 'HIGH', price: 60500, label: 'HH', timestamp: Date.now() - 1800000 },
          ],
          structureBreaks: [],
          fvgs: [],
          orderBlocks: [],
          sweeps: [],
        },
      }),
      getActiveSetups: () => [],
    };
    this.discoveryScheduler = {
      triggerDiscovery: (reason: string, price?: number) => {
        this.emit('discovery_triggered', { reason, price });
        return true;
      },
    };
  }

  public getMarketState() {
    return this.marketState;
  }
  public getSetupEngine() {
    return this.setupEngine;
  }
  public getCandleManager() {
    return this.candleManager;
  }
  public getDiscoveryScheduler() {
    return this.discoveryScheduler;
  }
  public setPrice(p: number) {
    this.marketState.ticker.lastPrice = p;
    this.emit('state_updated', this.marketState);
  }
}

test('Fase 5C.2 — Quantitative Level Verification (verifyProposedLevels)', () => {
  const summary: MarketIntelligenceSummary = {
    symbol: 'BTCUSDT',
    timestamp: Date.now(),
    currentPrice: 59150,
    dataAvailability: {
      wsConnected: true,
      orderBookSynced: true,
      recentTradesFlowing: true,
      klinesCurrent: true,
      allCriticalDataPresent: true,
      lastCheckTimestamp: Date.now(),
      missingFeeds: [],
    },
    timeframes: {
      '15m': {
        trend: 'RANGING',
        rsi: 48,
        atr: 120,
        ema20Ready: true,
        volumeRelative: 1.0,
        activeSwings: {
          high: { price: 59600, timestamp: Date.now() - 1800000 },
          low: { price: 58800, timestamp: Date.now() - 3600000 },
        },
        recentSwings: [],
        bosCount: 0,
        chochCount: 0,
        recentStructureBreaks: [],
        activeFvgs: 1,
        activeFvgDetails: [{ type: 'BEARISH', top: 59450, bottom: 59300, size: 150 }],
        activeObs: 1,
        activeObDetails: [{ type: 'BULLISH', top: 58950, bottom: 58800 }],
        recentSweeps: [],
      },
      '4H': {
        trend: 'BEARISH',
        rsi: 42,
        atr: 650,
        ema20Ready: true,
        volumeRelative: 0.9,
        activeSwings: {
          high: { price: 64067, timestamp: Date.now() - 86400000 },
          low: { price: 58200, timestamp: Date.now() - 43200000 },
        },
        recentSwings: [],
        bosCount: 1,
        chochCount: 0,
        recentStructureBreaks: [],
        activeFvgs: 0,
        activeFvgDetails: [],
        activeObs: 1,
        activeObDetails: [{ type: 'BEARISH', top: 64067, bottom: 63531 }],
        recentSweeps: [],
      },
    } as any,
    orderBook: {
      spread: 0.5,
      spreadPcnt: 0.0008,
      imbalance: 0.05,
      bestBid: 59149.5,
      bestAsk: 59150.5,
    },
    marketContext: {
      fundingRate: 0.0001,
      openInterest: 60000,
      volatility24hPct: 2.5,
      high24h: 60200,
      low24h: 58500,
    },
  };

  // Case A: SCALP scenario proposing 64200 entry when price is 59150 (8.5% away)
  // Must be strictly rejected as INCOMPATIBLE with SCALP horizon
  const scalpCandidate = {
    direction: 'LONG' as const,
    horizon: 'SCALP' as const,
    timeframe: '5m' as const,
    targetEntry: 64200,
    stopLossPrice: 63800,
  };
  const scalpResult = verifyProposedLevels(scalpCandidate, summary);
  assert.strictEqual(scalpResult.isValid, false);
  assert.ok(scalpResult.rejectionReason?.includes('incompatible con el horizonte SCALP'));

  // Case B: Valid Intraday setup anchored to 15m bullish Order Block [58800 - 58950]
  const validCandidate = {
    direction: 'LONG' as const,
    horizon: 'INTRADAY' as const,
    timeframe: '15m' as const,
    entryZoneMin: 58850,
    entryZoneMax: 58950,
    targetEntry: 58900,
    stopLossPrice: 58750,
    candidateTarget12: 59250,
    candidateTarget14: 59550,
  };
  const validResult = verifyProposedLevels(validCandidate, summary);
  assert.strictEqual(validResult.isValid, true);
  assert.ok(validResult.verifiedLevels.length >= 2);
  const entryLevel = validResult.verifiedLevels.find((l) => l.price === 58900);
  assert.ok(entryLevel);
  assert.strictEqual(entryLevel.isVerified, true);
  assert.strictEqual(entryLevel.levelType, 'ORDER_BLOCK');
  assert.ok(entryLevel.evidence.includes('Order Block BULLISH'));
});

test('Fase 5C.2 — NEUTRAL_OBSERVATION never triggers entry revalidation and triggers new discovery on breakout', async () => {
  const db = new DatabaseService(':memory:');
  const coordinator = new MockMarketCoordinator() as any;
  const registry = new ScenarioRegistry(db);

  const budget = new HardBudgetManager({
    dailyBudgetLimitUsd: 10,
    monthlyBudgetLimitUsd: 100,
    maxCostPerRequestUsd: 1,
  }, undefined, db);

  const openai = new OpenAiAdapter({ apiKey: 'mock', model: 'gpt-4o' });
  const gemini = new GeminiAdapter({ apiKey: 'mock', model: 'gemini-2.5-flash' });

  const discovery = new AiMarketDiscoveryEngine({
    coordinator,
    openaiAdapter: openai,
    geminiAdapter: gemini,
    hardBudgetManager: budget,
    scenarioRegistry: registry,
    db,
  });

  const watcher = new AlgorithmicWatcher(coordinator, registry);
  watcher.start();

  let breakoutEventFired = false;
  let revalidationEventFired = false;
  let discoveryTriggerReason = '';

  watcher.on('neutral_range_breakout', (evt) => {
    breakoutEventFired = true;
  });
  watcher.on('revalidation_requested', () => {
    revalidationEventFired = true;
  });
  coordinator.on('discovery_triggered', (evt: any) => {
    discoveryTriggerReason = evt.reason;
  });

  // Mock returning NEUTRAL
  discovery.setMockEvaluator(() => ({
    openai: {
      bias: 'NEUTRAL',
      reasoning: 'Mercado consolidado sin ventaja nítida en 60000',
      scenarios: [],
    },
    gemini: {
      bias: 'NEUTRAL',
      reasoning: 'Rango estricto sin ruptura estructural confirmada',
      scenarios: [],
    },
  }));

  const discResult = await discovery.runDiscovery({ forceManual: true });
  assert.strictEqual(discResult.scenarios.length, 1);
  const neutralSc = discResult.scenarios[0];
  assert.strictEqual(neutralSc.direction, 'NEUTRAL');
  assert.strictEqual(neutralSc.kind, 'NEUTRAL_OBSERVATION');
  assert.strictEqual(neutralSc.status, 'NO_TRADE_OBSERVATION');

  // Tick inside range (60000): should NOT trigger revalidation!
  watcher.evaluateTick(60000);
  assert.strictEqual(revalidationEventFired, false);
  assert.strictEqual(breakoutEventFired, false);

  // Tick breaking range is merely a wick; a CLOSED matching candle confirms.
  const ceiling = neutralSc.entryZoneMax;
  watcher.evaluateTick(ceiling + 100);
  assert.strictEqual(breakoutEventFired, false);
  watcher.evaluateCandleClose({
    timeframe: neutralSc.timeframe, timestamp: neutralSc.discoveryTimestamp + 1000,
    confirmed: true, open: ceiling - 50, high: ceiling + 110,
    low: ceiling - 70, close: ceiling + 100, volume: 150,
  });

  assert.strictEqual(breakoutEventFired, true);
  assert.strictEqual(revalidationEventFired, false); // Crucial: NEVER revalidated as trade!
  assert.strictEqual(discoveryTriggerReason, 'RANGE_BREAKOUT_FROM_NEUTRAL_WATCH');

  const updatedSc = registry.getScenario(neutralSc.id);
  assert.strictEqual(updatedSc?.status, 'COMPLETED');

  watcher.stop();
  db.close();
});

test('Fase 5C.2 — Sequential conditions must be met in chronological order ($t_1 \\le t_2$)', () => {
  const db = new DatabaseService(':memory:');
  const coordinator = new MockMarketCoordinator() as any;
  const registry = new ScenarioRegistry(db);

  const watcher = new AlgorithmicWatcher(coordinator, registry);

  const scenarioId = 'scen_sequential_test';
  const discoveryTime = Date.now() - 5000;

  registry.registerScenario({
    id: scenarioId,
    symbol: 'BTCUSDT',
    direction: 'LONG',
    kind: 'TRADE_SCENARIO',
    triggerSource: 'AUTOMATIC_SCHEDULER',
    timeframe: '15m',
    structureType: 'SMC_DISCRETIONARY_DISCOVERY',
    proposedBy: 'CONSENSUS',
    modelsUsed: ['gpt-4o', 'gemini-2.5-flash'],
    snapshotId: 'snap_test',
    discoveryTimestamp: discoveryTime,
    entryZoneMin: 59900,
    entryZoneMax: 60100,
    targetEntry: 60000,
    stopLossPrice: 59500,
    rrModeAvailable: 'RR_BOTH',
    uncertaintyLevel: 'MEDIUM',
    status: 'SCENARIO_REGISTERED',
    validUntilTimestamp: Date.now() + 3600000,
    aiCostUsd: 0.001,
    activationConditions: ['1. Mitigación', '2. Spread bajo'],
    invalidationTriggers: ['SL vulnerado'],
    argumentsFor: ['SMC confluencia'],
    argumentsAgainst: [],
    watchPlan: {
      id: 'wp_test',
      scenarioId,
      symbol: 'BTCUSDT',
      direction: 'LONG',
      marketThesis: 'Test secuencia',
      horizon: 'INTRADAY',
      primaryTimeframe: '15m',
      watchZone: { minPrice: 59900, maxPrice: 60100, targetEntry: 60000 },
      candidateStopLoss: 59500,
      candidateTakeProfits: {},
      rrEligibility: 'RR_BOTH',
      observableConditions: [
        {
          id: 'cond_seq_1',
          description: 'Paso 1: Precio toca nivel 60050',
          operator: 'PRICE_CROSS_BELOW',
          params: { level: 60050 },
          isMet: false,
          automatable: true,
          sequenceOrder: 1,
        },
        {
          id: 'cond_seq_2',
          description: 'Paso 2: Precio entra a zona profunda 59950',
          operator: 'PRICE_CROSS_BELOW',
          params: { level: 59950 },
          isMet: false,
          automatable: true,
          sequenceOrder: 2,
        },
      ],
      confirmationSequence: ['Paso 1', 'Paso 2'],
      invalidationConditions: [],
      expirationTimestamp: Date.now() + 3600000,
      reevaluationTriggers: [],
      reasoningVersion: 'snap_test',
      status: 'ACTIVE',
      automatable: true,
      createdAt: discoveryTime,
      updatedAt: discoveryTime,
    },
  });

  // Tick at 60200: neither step is met
  watcher.evaluateTick(60200, 0.0005);
  let sc = registry.getScenario(scenarioId);
  assert.strictEqual(sc?.watchPlan?.observableConditions[0].isMet, false);
  assert.strictEqual(sc?.watchPlan?.observableConditions[1].isMet, false);

  // Tick at 60020: Step 1 (<= 60050) is met, Step 2 (<= 59950) is NOT met
  watcher.evaluateTick(60020, 0.0005);
  sc = registry.getScenario(scenarioId);
  assert.strictEqual(sc?.watchPlan?.observableConditions[0].isMet, true);
  assert.strictEqual(sc?.watchPlan?.observableConditions[1].isMet, false);
  const step1Timestamp = sc?.watchPlan?.observableConditions[0].metTimestamp;
  assert.ok(step1Timestamp);

  // Tick at 59940: Step 2 (<= 59950) is now met after Step 1!
  watcher.evaluateTick(59940, 0.0005);
  sc = registry.getScenario(scenarioId);
  assert.strictEqual(sc?.watchPlan?.observableConditions[1].isMet, true);
  const step2Timestamp = sc?.watchPlan?.observableConditions[1].metTimestamp;
  assert.ok(step2Timestamp);
  assert.ok(step2Timestamp >= step1Timestamp);

  db.close();
});
