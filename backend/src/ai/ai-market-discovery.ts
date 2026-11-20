import crypto from 'crypto';
import { EventEmitter } from 'events';
import { MarketCoordinator } from '../market/market-coordinator.js';
import { OpenAiAdapter } from './openai-adapter.js';
import { GeminiAdapter } from './gemini-adapter.js';
import { HardBudgetManager } from './hard-budget-manager.js';
import { ScenarioRegistry } from '../engine/scenario-registry.js';
import { RiskCalculator } from '../engine/risk-calculator.js';
import { DatabaseService } from '../storage/database.js';
import {
  Scenario,
  MarketIntelligenceSummary,
  ScenarioRRMode,
  UncertaintyLevel,
  ScenarioInterpretation,
  AiWatchPlan,
  WatchCondition,
  WatchOperator,
  WatchHorizon,
  AiMarketAnalysis,
  MarketDataAvailability,
  AlgorithmicReferenceSetup,
} from './scenario-types.js';
import { SUPPORTED_TIMEFRAMES, Timeframe } from '../types/market.js';
import { TechnicalIndicators } from '../engine/indicators.js';

export interface DiscoveryOptions {
  forceManual?: boolean;
  minConfidence?: number;
}

const ALLOWED_WATCH_OPERATORS: WatchOperator[] = [
  'PRICE_CROSS_ABOVE',
  'PRICE_CROSS_BELOW',
  'PRICE_IN_RANGE',
  'PRICE_TOUCH_LEVEL',
  'RSI_THRESHOLD',
  'VOLUME_SPIKE',
  'SPREAD_TOLERANCE',
  'ORDERBOOK_IMBALANCE',
  'CANDLE_CLOSE_ABOVE',
  'CANDLE_CLOSE_BELOW',
  'SWEEP_CONFIRMED',
  'STRUCTURE_BREAK',
  'TIME_ELAPSED',
];

export class AiMarketDiscoveryEngine extends EventEmitter {
  private coordinator: MarketCoordinator;
  private openaiAdapter: OpenAiAdapter;
  private geminiAdapter: GeminiAdapter;
  private hardBudgetManager: HardBudgetManager;
  private scenarioRegistry: ScenarioRegistry;
  private db: DatabaseService;
  private lastSummary: MarketIntelligenceSummary | null = null;
  private isDiscovering: boolean = false;
  private mockEvaluator?: (summary: MarketIntelligenceSummary) => {
    openai?: {
      bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
      reasoning: string;
      scenarios: Partial<Scenario>[];
      marketAnalysis?: AiMarketAnalysis;
    };
    gemini?: {
      bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
      reasoning: string;
      scenarios: Partial<Scenario>[];
      marketAnalysis?: AiMarketAnalysis;
    };
  };

  constructor(options: {
    coordinator: MarketCoordinator;
    openaiAdapter: OpenAiAdapter;
    geminiAdapter: GeminiAdapter;
    hardBudgetManager: HardBudgetManager;
    scenarioRegistry: ScenarioRegistry;
    db: DatabaseService;
  }) {
    super();
    this.coordinator = options.coordinator;
    this.openaiAdapter = options.openaiAdapter;
    this.geminiAdapter = options.geminiAdapter;
    this.hardBudgetManager = options.hardBudgetManager;
    this.scenarioRegistry = options.scenarioRegistry;
    this.db = options.db;
  }

  public setMockEvaluator(fn?: any): void {
    this.mockEvaluator = fn;
  }

  public buildMarketIntelligenceSummary(): MarketIntelligenceSummary {
    const marketState = this.coordinator.getMarketState();
    const ticker = marketState.ticker || {
      lastPrice: 65000,
      markPrice: 65000,
      indexPrice: 65000,
      spread: 1.0,
      spreadPcnt: 0.0015,
      fundingRate: 0.0001,
      openInterest: 50000,
      highPrice24h: 66000,
      lowPrice24h: 64000,
      timestamp: Date.now(),
    };
    const orderBook = marketState.orderBook || {
      spread: ticker.spread,
      spreadPcnt: ticker.spreadPcnt,
      imbalance: 0,
      bestBid: ticker.lastPrice - 0.5,
      bestAsk: ticker.lastPrice + 0.5,
      bids: [],
      asks: [],
      isSynced: true,
    };

    const candleManager = this.coordinator.getCandleManager();
    const setupEngine = this.coordinator.getSetupEngine();

    const tfSummaries: any = {};
    const klinesAvailableMap: Record<Timeframe, boolean> = {
      '1d': false,
      '4h': false,
      '1h': false,
      '15m': false,
      '5m': false,
      '1m': false,
    };

    for (const tf of SUPPORTED_TIMEFRAMES) {
      const candles: any[] = candleManager.getCandles(tf);
      klinesAvailableMap[tf] = candles.length > 0;
      const lastCandle = candleManager.getLastClosedCandle(tf) || candleManager.getCurrentCandle(tf);
      const closes: number[] = candles.map((c) => c.close);

      const rsiArr = TechnicalIndicators.rsi(closes, 14);
      const rsi = rsiArr.length > 0 ? rsiArr[rsiArr.length - 1] : 50;
      const atrArr = TechnicalIndicators.atr(candles, 14);
      const atr = atrArr.length > 0 ? atrArr[atrArr.length - 1] : 50;
      const ema20Arr = TechnicalIndicators.ema(closes, 20);
      const ema20 = ema20Arr.length > 0 && !isNaN(ema20Arr[ema20Arr.length - 1]) ? ema20Arr[ema20Arr.length - 1] : undefined;
      const ema50Arr = TechnicalIndicators.ema(closes, 50);
      const ema50 = ema50Arr.length > 0 && !isNaN(ema50Arr[ema50Arr.length - 1]) ? ema50Arr[ema50Arr.length - 1] : undefined;
      const is200Ready = TechnicalIndicators.isEmaReady(closes, 200);
      const ema200Arr = is200Ready ? TechnicalIndicators.ema(closes, 200) : [];
      const ema200 = is200Ready && ema200Arr.length > 0 && !isNaN(ema200Arr[ema200Arr.length - 1]) ? ema200Arr[ema200Arr.length - 1] : undefined;
      const vwapArr = TechnicalIndicators.vwap(candles);
      const vwap = vwapArr.length > 0 ? vwapArr[vwapArr.length - 1] : undefined;
      const rvol = TechnicalIndicators.relativeVolume(candles, 20);

      let trend: 'BULLISH' | 'BEARISH' | 'RANGING' = 'RANGING';
      if (lastCandle && ema20 !== undefined && ema50 !== undefined) {
        if (lastCandle.close > ema20 && ema20 > ema50) trend = 'BULLISH';
        else if (lastCandle.close < ema20 && ema20 < ema50) trend = 'BEARISH';
      }

      const analysis = setupEngine?.getAnalysis(tf);
      const structure = analysis?.structure;
      const activeSwings = structure?.swings || [];
      const lastSwingHigh = [...activeSwings].reverse().find((s: any) => s.type === 'HIGH');
      const lastSwingLow = [...activeSwings].reverse().find((s: any) => s.type === 'LOW');
      const activeFvgs = structure?.fvgs || [];
      const activeObs = structure?.orderBlocks || [];
      const structureBreaks = structure?.structureBreaks || [];
      const sweeps = structure?.sweeps || [];

      tfSummaries[tf] = {
        trend,
        rsi: Number((rsi || 50).toFixed(2)),
        atr: Number((atr || 50).toFixed(2)),
        ema20: ema20 !== undefined ? Number(ema20.toFixed(2)) : undefined,
        ema50: ema50 !== undefined ? Number(ema50.toFixed(2)) : undefined,
        ema200: ema200 !== undefined ? Number(ema200.toFixed(2)) : undefined,
        ema200Ready: is200Ready,
        vwap: vwap ? Number(vwap.toFixed(2)) : undefined,
        volumeRelative: Number((rvol || 1.0).toFixed(2)),
        activeSwings: {
          high: lastSwingHigh ? { price: lastSwingHigh.price, label: lastSwingHigh.label, timestamp: lastSwingHigh.timestamp } : undefined,
          low: lastSwingLow ? { price: lastSwingLow.price, label: lastSwingLow.label, timestamp: lastSwingLow.timestamp } : undefined,
        },
        recentSwings: activeSwings.slice(-6).map((s: any) => ({
          type: s.type,
          price: s.price,
          label: s.label,
        })),
        bosCount: structureBreaks.filter((b: any) => b.type === 'BOS').length,
        chochCount: structureBreaks.filter((b: any) => b.type === 'CHoCH').length,
        recentStructureBreaks: structureBreaks.slice(-4).map((b: any) => ({
          type: b.type,
          direction: b.direction,
          level: b.brokenLevel,
        })),
        activeFvgs: activeFvgs.filter((f: any) => f.status === 'ACTIVE').length,
        activeFvgDetails: activeFvgs.filter((f: any) => f.status === 'ACTIVE').slice(-3).map((f: any) => ({
          type: f.type,
          top: f.top,
          bottom: f.bottom,
          size: f.size,
        })),
        activeObs: activeObs.filter((o: any) => o.status === 'ACTIVE').length,
        activeObDetails: activeObs.filter((o: any) => o.status === 'ACTIVE').slice(-3).map((o: any) => ({
          type: o.type,
          top: o.top,
          bottom: o.bottom,
        })),
        recentSweeps: sweeps.slice(-3).map((sw: any) => ({
          direction: sw.direction,
          sweptLevel: sw.sweptLevel,
          poolType: sw.poolType,
        })),
      };
    }

    // Top 5 bids and asks
    const bidsTop5 = (orderBook.bids || []).slice(0, 5).map(([price, size]: any) => ({ price, size }));
    const asksTop5 = (orderBook.asks || []).slice(0, 5).map(([price, size]: any) => ({ price, size }));

    // Data availability check
    const wsConnected = Boolean(marketState.wsConnected);
    const orderBookSynced = Boolean((orderBook as any).isSynced);
    const allKlines = Object.values(klinesAvailableMap).every(Boolean);
    const allCriticalDataPresent = wsConnected && orderBookSynced && allKlines;
    const missingItems: string[] = [];
    if (!wsConnected) missingItems.push('WebSocket Bybit desconectado');
    if (!orderBookSynced) missingItems.push('OrderBook desincronizado');
    if (!allKlines) missingItems.push('Klines parciales en temporalidades');

    const dataAvailability: MarketDataAvailability = {
      wsConnected,
      orderBookSynced,
      klinesAvailable: klinesAvailableMap,
      liquidationsAvailable: true,
      openInterestAvailable: ticker.openInterest !== undefined,
      fundingRateAvailable: ticker.fundingRate !== undefined,
      allCriticalDataPresent,
      missingDataNotice: missingItems.length > 0 ? missingItems.join('; ') : undefined,
    };

    // Algorithmic reference setups (Strategy A and B as benchmarks, NOT mandatory filters)
    const activeSetups = setupEngine?.getActiveSetups() || [];
    const algorithmicReferenceSetups: AlgorithmicReferenceSetup[] = activeSetups.map((s: any) => ({
      strategy: s.strategy,
      direction: s.direction,
      timeframe: s.timeframe,
      entryPrice: s.entryPrice,
      stopLossPrice: s.stopLossPrice,
      takeProfitPrice: s.takeProfitPrice,
      netRR: s.riskReward?.netRR || 0,
      evidence: Array.isArray(s.evidence)
        ? s.evidence
        : [
            s.evidence?.triggerReason,
            s.evidence?.macroTrend,
            s.evidence?.invalidationReason,
            ...(s.evidence?.confluencePoints || []),
          ].filter(Boolean),
    }));

    const summary: MarketIntelligenceSummary = {
      symbol: marketState.symbol || 'BTCUSDT',
      timestamp: Date.now(),
      currentPrice: ticker.lastPrice,
      timeframes: tfSummaries,
      orderBook: {
        spread: orderBook.spread,
        spreadPcnt: orderBook.spreadPcnt,
        imbalance: orderBook.imbalance,
        bestBid: orderBook.bestBid,
        bestAsk: orderBook.bestAsk,
        bidsTop5,
        asksTop5,
      },
      marketContext: {
        fundingRate: ticker.fundingRate,
        openInterest: ticker.openInterest,
        volatility24hPct: ticker.highPrice24h && ticker.lowPrice24h
          ? ((ticker.highPrice24h - ticker.lowPrice24h) / ticker.lowPrice24h) * 100
          : 0,
        high24h: ticker.highPrice24h,
        low24h: ticker.lowPrice24h,
      },
      dataAvailability,
      algorithmicReferenceSetups,
      lastDiscoveryTimestamp: this.lastSummary?.lastDiscoveryTimestamp,
      lastRevalidationTimestamp: this.lastSummary?.lastRevalidationTimestamp,
      openaiBias: this.lastSummary?.openaiBias,
      geminiBias: this.lastSummary?.geminiBias,
      confidenceDisclaimer: 'La confianza declarada por la IA es cualitativa y subjetiva; no constituye probabilidad matemática ni certeza estadística.',
    };

    this.lastSummary = summary;
    return summary;
  }

  public getLatestSummary(): MarketIntelligenceSummary {
    if (!this.lastSummary) {
      return this.buildMarketIntelligenceSummary();
    }
    return this.lastSummary;
  }

  public async runDiscovery(options: DiscoveryOptions = {}): Promise<{
    scenarios: Scenario[];
    summary: MarketIntelligenceSummary;
    aiCostUsd: number;
    skippedReason?: string;
  }> {
    if (this.isDiscovering) {
      return { scenarios: [], summary: this.getLatestSummary(), aiCostUsd: 0, skippedReason: 'DISCOVERY_ALREADY_IN_PROGRESS' };
    }

    this.isDiscovering = true;
    try {
      const summary = this.buildMarketIntelligenceSummary();
      const snapshotId = `snap_disc_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

      // Check Hard Budget Limit
      if (this.hardBudgetManager.isBlocked()) {
        const reason = this.hardBudgetManager.getBlockedReason() || 'AI_BUDGET_EXCEEDED';
        return { scenarios: [], summary, aiCostUsd: 0, skippedReason: reason };
      }

      // If mock evaluator is set (unit tests or mock mode)
      if (this.mockEvaluator) {
        const mockResult = this.mockEvaluator(summary);
        const registered: Scenario[] = [];

        if (mockResult.openai?.bias) summary.openaiBias = mockResult.openai.bias;
        if (mockResult.gemini?.bias) summary.geminiBias = mockResult.gemini.bias;
        if (mockResult.openai?.marketAnalysis) summary.openaiAnalysis = mockResult.openai.marketAnalysis;
        if (mockResult.gemini?.marketAnalysis) summary.geminiAnalysis = mockResult.gemini.marketAnalysis;

        const candidateScenarios = [
          ...(mockResult.openai?.scenarios || []).map((s) => ({ ...s, proposedBy: 'OPENAI' as const })),
          ...(mockResult.gemini?.scenarios || []).map((s) => ({ ...s, proposedBy: 'GEMINI' as const })),
        ];

        for (const cand of candidateScenarios) {
          const validated = this.validateAndBuildScenario(cand, summary, snapshotId, 0.001);
          if (validated) {
            this.scenarioRegistry.registerScenario(validated);
            registered.push(validated);
          }
        }

        // If no candidate scenarios were passed and bias is NEUTRAL
        if (registered.length === 0 && candidateScenarios.length === 0) {
          const neutralScenario = this.buildNeutralObservationScenario(summary, snapshotId, 0.001, mockResult.openai, mockResult.gemini);
          this.scenarioRegistry.registerScenario(neutralScenario);
          registered.push(neutralScenario);
        }

        summary.lastDiscoveryTimestamp = Date.now();
        this.emit('discovery_completed', { scenarios: registered, summary });
        return { scenarios: registered, summary, aiCostUsd: 0.001 };
      }

      // Real or Semi-autonomous AI Discovery
      const openaiConfigured = this.openaiAdapter.isConfigured();
      const geminiConfigured = this.geminiAdapter.isConfigured();

      if (!openaiConfigured && !geminiConfigured && !options.forceManual) {
        return { scenarios: [], summary, aiCostUsd: 0, skippedReason: 'NO_AI_PROVIDERS_CONFIGURED' };
      }

      // Reserve budget for market discovery
      const resv = this.hardBudgetManager.reserveBudget({
        provider: openaiConfigured ? 'OPENAI' : 'GEMINI',
        model: openaiConfigured ? this.openaiAdapter.getModel() : this.geminiAdapter.getModel(),
        task: 'MARKET_DISCOVERY',
        estimatedTokens: 3500,
      });

      if (!resv.allowed) {
        return { scenarios: [], summary, aiCostUsd: 0, skippedReason: resv.reason || 'AI_BUDGET_EXCEEDED' };
      }

      let totalCostUsd = 0;
      const discoveredScenarios: Scenario[] = [];
      let openaiDiscovery: any = null;
      let geminiDiscovery: any = null;

      try {
        // Query OpenAI and Gemini for autonomous discovery
        const [resOpenai, resGemini] = await Promise.all([
          this.queryOpenAiDiscovery(summary),
          this.queryGeminiDiscovery(summary),
        ]);
        openaiDiscovery = resOpenai;
        geminiDiscovery = resGemini;

        if (openaiDiscovery) {
          summary.openaiBias = openaiDiscovery.bias;
          if (openaiDiscovery.marketAnalysis) summary.openaiAnalysis = openaiDiscovery.marketAnalysis;
          totalCostUsd += openaiDiscovery.costUsd || 0;
          for (const cand of (openaiDiscovery.scenarios || [])) {
            const sc = this.validateAndBuildScenario(cand, summary, snapshotId, (openaiDiscovery.costUsd || 0) / Math.max(1, (openaiDiscovery.scenarios || []).length));
            if (sc) {
              sc.openaiInterpretation = {
                provider: 'OPENAI',
                model: this.openaiAdapter.getModel(),
                bias: openaiDiscovery.bias,
                reasoning: openaiDiscovery.reasoning,
                keyZones: openaiDiscovery.keyZones || [],
                confidence: cand.confidence || 75,
                marketAnalysis: openaiDiscovery.marketAnalysis,
              };
              discoveredScenarios.push(sc);
            }
          }
        }

        if (geminiDiscovery) {
          summary.geminiBias = geminiDiscovery.bias;
          if (geminiDiscovery.marketAnalysis) summary.geminiAnalysis = geminiDiscovery.marketAnalysis;
          totalCostUsd += geminiDiscovery.costUsd || 0;
          for (const cand of (geminiDiscovery.scenarios || [])) {
            const sc = this.validateAndBuildScenario(cand, summary, snapshotId, (geminiDiscovery.costUsd || 0) / Math.max(1, (geminiDiscovery.scenarios || []).length));
            if (sc) {
              sc.geminiInterpretation = {
                provider: 'GEMINI',
                model: this.geminiAdapter.getModel(),
                bias: geminiDiscovery.bias,
                reasoning: geminiDiscovery.reasoning,
                keyZones: geminiDiscovery.keyZones || [],
                confidence: cand.confidence || 75,
                marketAnalysis: geminiDiscovery.marketAnalysis,
              };
              discoveredScenarios.push(sc);
            }
          }
        }
      } finally {
        if (resv.reservationId) {
          this.hardBudgetManager.reconcileReservation(resv.reservationId, {
            provider: openaiConfigured ? 'OPENAI' : 'GEMINI',
            model: openaiConfigured ? this.openaiAdapter.getModel() : this.geminiAdapter.getModel(),
            task: 'MARKET_DISCOVERY',
            promptTokens: 2000,
            completionTokens: 600,
            costUsd: totalCostUsd,
            status: 'SUCCESS',
            latencyMs: 1400,
          });
        }
      }

      // If no directional scenarios were proposed or if AI concluded NEUTRAL,
      // register a formal NEUTRAL observation scenario (preserving "no operar es una decisión válida")
      if (discoveredScenarios.length === 0) {
        const neutralScenario = this.buildNeutralObservationScenario(summary, snapshotId, totalCostUsd, openaiDiscovery, geminiDiscovery);
        discoveredScenarios.push(neutralScenario);
      }

      // Register all valid scenarios in registry
      const registered: Scenario[] = [];
      for (const sc of discoveredScenarios) {
        const saved = this.scenarioRegistry.registerScenario(sc);
        registered.push(saved);
      }

      summary.lastDiscoveryTimestamp = Date.now();
      this.lastSummary = summary;
      this.emit('discovery_completed', { scenarios: registered, summary });
      return { scenarios: registered, summary, aiCostUsd: totalCostUsd };
    } finally {
      this.isDiscovering = false;
    }
  }

  private buildNeutralObservationScenario(
    summary: MarketIntelligenceSummary,
    snapshotId: string,
    aiCostUsd: number,
    openaiDiscovery?: any,
    geminiDiscovery?: any
  ): Scenario {
    const openaiConfigured = this.openaiAdapter.isConfigured();
    const geminiConfigured = this.geminiAdapter.isConfigured();

    const rawJustification =
      openaiDiscovery?.marketAnalysis?.noTradeJustification ||
      geminiDiscovery?.marketAnalysis?.noTradeJustification ||
      openaiDiscovery?.reasoning ||
      geminiDiscovery?.reasoning;

    const neutralThesis = rawJustification
      ? (rawJustification.includes('No operar')
          ? rawJustification
          : `${rawJustification}. "No operar es una decisión válida y a menudo la mejor". Preservación de capital prioritaria.`)
      : 'Mercado sin confluencia técnica estricta. "No operar es una decisión válida y a menudo la mejor". Preservación de capital prioritaria.';

    const neutralPlan: AiWatchPlan = {
      id: `wp_neutral_${Date.now()}`,
      scenarioId: `sc_neutral_${Date.now()}`,
      symbol: summary.symbol || 'BTCUSDT',
      direction: 'NEUTRAL',
      marketThesis: neutralThesis,
      horizon: 'INTRADAY',
      primaryTimeframe: '15m',
      watchZone: {
        minPrice: summary.currentPrice,
        maxPrice: summary.currentPrice,
        targetEntry: summary.currentPrice,
      },
      candidateStopLoss: summary.currentPrice,
      candidateTakeProfits: {},
      rrEligibility: 'NONE',
      observableConditions: [
        {
          id: `cond_neutral_breakout`,
          description: 'Esperar desplazamiento direccional limpio y ruptura estructural confirmada en 15m con volumen',
          operator: 'STRUCTURE_BREAK',
          params: { timeframe: '15m' },
          isMet: false,
          automatable: true,
        },
      ],
      confirmationSequence: [
        '1. Ruptura de rango consolidado con vela cerrada de cuerpo completo',
        '2. Confirmación de volumen relativo rvol > 1.2',
      ],
      invalidationConditions: [],
      expirationTimestamp: Date.now() + 6 * 3600 * 1000,
      reevaluationTriggers: [
        { event: 'STRUCTURE_SHIFT', description: 'Cambio estructural relevante en 15m o 1h', timeframe: '15m' },
      ],
      reasoningVersion: snapshotId,
      status: 'ACTIVE',
      automatable: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    return {
      id: neutralPlan.scenarioId,
      symbol: summary.symbol || 'BTCUSDT',
      direction: 'NEUTRAL',
      timeframe: '15m',
      structureType: 'RANGING_NO_CONFLUENCE',
      proposedBy: 'CONSENSUS',
      modelsUsed: [
        ...(openaiConfigured ? [this.openaiAdapter.getModel()] : []),
        ...(geminiConfigured ? [this.geminiAdapter.getModel()] : []),
      ],
      snapshotId,
      discoveryTimestamp: Date.now(),
      entryZoneMin: summary.currentPrice,
      entryZoneMax: summary.currentPrice,
      targetEntry: summary.currentPrice,
      stopLossPrice: summary.currentPrice,
      rrModeAvailable: 'NONE',
      uncertaintyLevel: 'HIGH',
      status: 'NO_TRADE_OBSERVATION',
      validUntilTimestamp: Date.now() + 6 * 3600 * 1000,
      aiCostUsd,
      activationConditions: ['Esperar desplazamiento direccional limpio y ruptura estructural con confirmación'],
      invalidationTriggers: ['Ruptura de rango con volumen fuera de la consolidación'],
      argumentsFor: ['Preservación de capital prioritaria', 'Relación riesgo/beneficio asimétrico desfavorable en la zona actual'],
      argumentsAgainst: ['Pérdida de oportunidad en caso de movimiento impulsivo repentino'],
      watchPlan: neutralPlan,
      aiMarketThesis: neutralThesis,
      horizon: 'INTRADAY',
      confidenceDisclaimer: 'La confianza declarada por la IA es cualitativa y subjetiva; no constituye probabilidad estadística.',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      openaiInterpretation: openaiDiscovery ? {
        provider: 'OPENAI',
        model: this.openaiAdapter.getModel(),
        bias: openaiDiscovery.bias,
        reasoning: openaiDiscovery.reasoning,
        keyZones: openaiDiscovery.keyZones || [],
        confidence: 90,
        marketAnalysis: openaiDiscovery.marketAnalysis,
      } : undefined,
      geminiInterpretation: geminiDiscovery ? {
        provider: 'GEMINI',
        model: this.geminiAdapter.getModel(),
        bias: geminiDiscovery.bias,
        reasoning: geminiDiscovery.reasoning,
        keyZones: geminiDiscovery.keyZones || [],
        confidence: 90,
        marketAnalysis: geminiDiscovery.marketAnalysis,
      } : undefined,
      rejectionReason: 'Conclusión formal de IA: ESPERAR (No operar es una decisión válida y a menudo la mejor)',
    };
  }

  public validateAndBuildScenario(
    candidate: Partial<Scenario> & {
      candidateTarget12?: number;
      candidateTarget14?: number;
      structuralStopLoss?: number;
      confidence?: number;
      thesis?: string;
    },
    summary: MarketIntelligenceSummary,
    snapshotId: string,
    aiCostUsd: number
  ): Scenario | null {
    const symbol = summary.symbol || 'BTCUSDT';
    const currentPrice = summary.currentPrice;
    const direction = candidate.direction;
    if (!direction || (direction !== 'LONG' && direction !== 'SHORT')) return null;

    const entryMin = Number(candidate.entryZoneMin);
    const entryMax = Number(candidate.entryZoneMax);
    let targetEntry = Number(candidate.targetEntry || (entryMin + entryMax) / 2);
    const stopLoss = Number(candidate.stopLossPrice || candidate.structuralStopLoss);

    if (isNaN(entryMin) || isNaN(entryMax) || isNaN(targetEntry) || isNaN(stopLoss)) return null;

    // Validate sanity of prices (no fake values, no inverted order)
    if (direction === 'LONG') {
      if (stopLoss >= targetEntry) return null;
      if (Math.abs(currentPrice - targetEntry) / currentPrice > 0.08) return null;
    } else {
      if (stopLoss <= targetEntry) return null;
      if (Math.abs(currentPrice - targetEntry) / currentPrice > 0.08) return null;
    }

    // Determine candidate structural targets
    let target12 = candidate.target12Price || candidate.candidateTarget12;
    let target14 = candidate.target14Price || candidate.candidateTarget14;

    const riskDistance = Math.abs(targetEntry - stopLoss);
    if (riskDistance <= 0) return null;

    if (!target12) {
      target12 = direction === 'LONG' ? targetEntry + riskDistance * 2.05 : targetEntry - riskDistance * 2.05;
    }
    if (!target14) {
      target14 = direction === 'LONG' ? targetEntry + riskDistance * 4.10 : targetEntry - riskDistance * 4.10;
    }

    // Run strict quantitative net R:R calculation
    const dualCalc = RiskCalculator.calculateDualTargets({
      direction,
      entryPrice: targetEntry,
      stopLossPrice: stopLoss,
      candidateTargets: [target12, target14],
      explicit12Price: target12,
      explicit14Price: target14,
      accountBalance: 10000,
      riskPercent: 1.0,
      feeStructure: {
        makerFeeRate: 0.00020,
        takerFeeRate: 0.00055,
      },
    });

    if (dualCalc.qualifiedMode === 'NONE') {
      // Rejects scenarios that don't reach net 1:2
      return null;
    }

    const id = candidate.id || `scen_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const minZone = Math.min(entryMin, entryMax);
    const maxZone = Math.max(entryMin, entryMax);
    const distanceToZone = direction === 'LONG'
      ? Math.max(0, (currentPrice - maxZone) / currentPrice) * 100
      : Math.max(0, (minZone - currentPrice) / currentPrice) * 100;

    // Build Structured AI_WATCH_PLAN Contract
    const watchPlanId = `wp_${id}`;
    const horizon: WatchHorizon = candidate.horizon || candidate.watchPlan?.horizon || 'INTRADAY';
    const primaryTf = candidate.timeframe || '15m';

    // Validate observable conditions
    const rawObservable = candidate.watchPlan?.observableConditions || [];
    const validatedConditions: WatchCondition[] = [];
    let allConditionsAutomatable = true;
    const nonAutomatable: string[] = [];

    if (rawObservable.length > 0) {
      for (let i = 0; i < rawObservable.length; i++) {
        const cond = rawObservable[i];
        const isOpValid = ALLOWED_WATCH_OPERATORS.includes(cond.operator as any);
        const automatable = isOpValid && cond.automatable !== false;
        if (!automatable) {
          allConditionsAutomatable = false;
          nonAutomatable.push(cond.description || `Condición ${i + 1}`);
        }
        validatedConditions.push({
          id: cond.id || `cond_${id}_${i}`,
          description: cond.description || `Condición ${cond.operator}`,
          operator: isOpValid ? cond.operator : 'PRICE_IN_RANGE',
          params: cond.params || { minLevel: minZone, maxLevel: maxZone },
          isMet: false,
          automatable,
        });
      }
    } else {
      validatedConditions.push({
        id: `cond_${id}_zone`,
        description: `Mitigación limpia de la zona operativa [${minZone} - ${maxZone}]`,
        operator: 'PRICE_IN_RANGE',
        params: { minLevel: minZone, maxLevel: maxZone },
        isMet: false,
        automatable: true,
      });
      validatedConditions.push({
        id: `cond_${id}_spread`,
        description: 'Spread controlado menor o igual a 0.05% al momento de activación',
        operator: 'SPREAD_TOLERANCE',
        params: { threshold: 0.05 },
        isMet: false,
        automatable: true,
      });
    }

    // Invalidation conditions
    const rawInvalidations = candidate.watchPlan?.invalidationConditions || [];
    const validatedInvalidations: WatchCondition[] = [];
    if (rawInvalidations.length > 0) {
      for (let i = 0; i < rawInvalidations.length; i++) {
        const inv = rawInvalidations[i];
        const isOpValid = ALLOWED_WATCH_OPERATORS.includes(inv.operator as any);
        validatedInvalidations.push({
          id: inv.id || `inv_${id}_${i}`,
          description: inv.description || `Invalidación por ${inv.operator}`,
          operator: isOpValid ? inv.operator : (direction === 'LONG' ? 'PRICE_CROSS_BELOW' : 'PRICE_CROSS_ABOVE'),
          params: inv.params || { level: stopLoss },
          isMet: false,
          automatable: isOpValid,
        });
      }
    } else {
      validatedInvalidations.push({
        id: `inv_${id}_sl`,
        description: `Precio vulnera Stop Loss estructural en ${stopLoss}`,
        operator: direction === 'LONG' ? 'PRICE_CROSS_BELOW' : 'PRICE_CROSS_ABOVE',
        params: { level: stopLoss },
        isMet: false,
        automatable: true,
      });
    }

    const expirationTimestamp = candidate.validUntilTimestamp || Date.now() + 12 * 60 * 60 * 1000;

    const watchPlan: AiWatchPlan = {
      id: watchPlanId,
      scenarioId: id,
      symbol,
      direction,
      marketThesis: candidate.aiMarketThesis || candidate.thesis || candidate.argumentsFor?.[0] || 'Hipótesis discrecional descubierta por IA',
      horizon,
      primaryTimeframe: primaryTf,
      watchZone: {
        minPrice: minZone,
        maxPrice: maxZone,
        targetEntry,
      },
      candidateStopLoss: stopLoss,
      candidateTakeProfits: {
        tp12: dualCalc.target12Price,
        tp14: dualCalc.target14Price,
        structuralTarget: candidate.watchPlan?.candidateTakeProfits?.structuralTarget || dualCalc.target14Price,
      },
      rrEligibility: dualCalc.qualifiedMode,
      observableConditions: validatedConditions,
      confirmationSequence: candidate.watchPlan?.confirmationSequence || [
        `1. Mitigación de la zona operativa [${minZone} - ${maxZone}]`,
        '2. Confirmación de desaceleración y volumen adverso decreciente',
        '3. Reevaluación dual de IA en tiempo real sin Stop Loss vulnerado',
      ],
      invalidationConditions: validatedInvalidations,
      expirationTimestamp,
      reevaluationTriggers: candidate.watchPlan?.reevaluationTriggers || [
        { event: 'ZONE_TOUCH', description: `Precio alcanza zona operativa [${minZone} - ${maxZone}]`, timeframe: primaryTf },
      ],
      reasoningVersion: snapshotId,
      status: 'ACTIVE',
      automatable: allConditionsAutomatable,
      nonAutomatableConditions: nonAutomatable.length > 0 ? nonAutomatable : undefined,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const scenario: Scenario = {
      id,
      symbol,
      direction,
      timeframe: primaryTf,
      structureType: candidate.structureType || 'SMC_DISCRETIONARY_DISCOVERY',
      proposedBy: candidate.proposedBy || 'CONSENSUS',
      modelsUsed: candidate.modelsUsed || ['ai-analyst'],
      snapshotId,
      discoveryTimestamp: Date.now(),
      entryZoneMin: minZone,
      entryZoneMax: maxZone,
      targetEntry,
      stopLossPrice: stopLoss,
      target12Price: dualCalc.target12Price,
      target14Price: dualCalc.target14Price,
      netRR12: dualCalc.calculation12?.netRR,
      netRR14: dualCalc.calculation14?.netRR,
      rrModeAvailable: dualCalc.qualifiedMode,
      uncertaintyLevel: candidate.uncertaintyLevel || 'MEDIUM',
      status: 'SCENARIO_REGISTERED',
      validUntilTimestamp: expirationTimestamp,
      aiCostUsd,
      activationConditions: validatedConditions.map((c) => c.description),
      invalidationTriggers: validatedInvalidations.map((i) => i.description),
      argumentsFor: candidate.argumentsFor || [
        'Confluencia de soporte/resistencia multitemporal',
        `Ratio R:R neto calificado para modo ${dualCalc.qualifiedMode}`,
      ],
      argumentsAgainst: candidate.argumentsAgainst || [
        'Volatilidad intradía puede dilatar la mecha',
      ],
      distanceToZonePct: Number(distanceToZone.toFixed(2)),
      currentPrice,
      lastCheckedTimestamp: Date.now(),
      watchPlan,
      aiMarketThesis: watchPlan.marketThesis,
      horizon,
      missingConditions: candidate.missingConditions || [],
      confidenceDisclaimer: 'La confianza declarada por la IA es cualitativa y subjetiva; no constituye probabilidad estadística.',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    return scenario;
  }

  private async queryOpenAiDiscovery(summary: MarketIntelligenceSummary): Promise<{
    bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    reasoning: string;
    keyZones: string[];
    scenarios: any[];
    marketAnalysis?: AiMarketAnalysis;
    costUsd: number;
  } | null> {
    if (!this.openaiAdapter.isConfigured()) return null;

    try {
      const prompt = `Actúa como Analista Principal Cuantitativo y Discrecional de Mercado para NanoLabs AI Trading.
Tu objetivo es analizar integralmente la estructura técnica de BTCUSDT Perpetual (1D, 4H, 1H, 15m, 5m, 1m, SMC, ICT, order flow, RSI, EMA, VWAP, spreads y contexto).
IMPORTANTE:
1. No estás limitado por estrategias fijas ni patrones predefinidos (Estrategia A o B solo existen como referencias de comparación algorítmica).
2. Tienes plena libertad para descubrir hipótesis operables LONG o SHORT con confluencia estructural estricta y R:R neto >= 1:2 o 1:4.
3. Si el mercado no ofrece una ventaja estadística nítida, la conclusión imperativa es NEUTRAL / NO_TRADE ("No operar es una decisión válida y a menudo la mejor").
4. Para cada oportunidad seleccionada, diseña un plan de vigilancia determinista (AI_WATCH_PLAN) con condiciones observables mediante operadores deterministas permitidos (PRICE_IN_RANGE, PRICE_TOUCH_LEVEL, RSI_THRESHOLD, SPREAD_TOLERANCE, PRICE_CROSS_ABOVE, PRICE_CROSS_BELOW, STRUCTURE_BREAK, SWEEP_CONFIRMED).
5. No inventes probabilidades matemáticas ni porcentajes de acierto calibrados; tu evaluación de confianza es cualitativa.

Responde obligatoriamente en JSON estricto:
{
  "marketAnalysis": {
    "whatMarketIsDoing": "Descripción concisa del estado actual del mercado...",
    "whyMarketIsDoingIt": "Tesis sobre motivación de la acción del precio (absorción, barrido de liquidez, reacumulación)...",
    "evidenceList": ["Evidencia 1", "Evidencia 2", "..."],
    "bias": "BULLISH" | "BEARISH" | "NEUTRAL",
    "preferredHorizon": "SCALP" | "INTRADAY" | "SWING",
    "recommendedTimeframe": "15m",
    "noTradeJustification": "Explicación en caso de concluir NEUTRAL"
  },
  "bias": "BULLISH" | "BEARISH" | "NEUTRAL",
  "reasoning": "Resumen ejecutivo del análisis",
  "keyZones": ["64200 - 64500", "63800"],
  "scenarios": [
    {
      "direction": "LONG" | "SHORT",
      "thesis": "Tesis técnica de la oportunidad",
      "horizon": "SCALP" | "INTRADAY" | "SWING",
      "timeframe": "15m",
      "structureType": "SMC_DISCRETIONARY_DISCOVERY",
      "entryZoneMin": 64200,
      "entryZoneMax": 64400,
      "targetEntry": 64300,
      "structuralStopLoss": 63800,
      "candidateTarget12": 65300,
      "candidateTarget14": 66300,
      "missingConditions": ["Esperar mitigación limpia y desaceleración de volumen"],
      "invalidationEvents": ["Cierre de vela de 15m por debajo de 63800"],
      "argumentsFor": ["..."],
      "argumentsAgainst": ["..."],
      "confidence": 75,
      "watchPlan": {
        "horizon": "INTRADAY",
        "observableConditions": [
          {
            "description": "Precio entra en zona de entrada [64200, 64400]",
            "operator": "PRICE_IN_RANGE",
            "params": { "minLevel": 64200, "maxLevel": 64400 },
            "automatable": true
          }
        ],
        "confirmationSequence": ["Mitigación de zona", "Rechazo de volumen adverso"],
        "invalidationConditions": [
          {
            "description": "Precio vulnera Stop Loss en 63800",
            "operator": "PRICE_CROSS_BELOW",
            "params": { "level": 63800 },
            "automatable": true
          }
        ],
        "expirationHours": 8
      }
    }
  ]
}

Panorama Multitemporal:\n${JSON.stringify(summary, null, 2)}`;

      const res = await this.openaiAdapter.evaluateWithCustomPrompt?.(prompt) || null;
      if (!res) return null;
      return {
        bias: res.bias || res.marketAnalysis?.bias || 'NEUTRAL',
        reasoning: res.reasoning || res.marketAnalysis?.whatMarketIsDoing || '',
        keyZones: res.keyZones || [],
        scenarios: res.scenarios || [],
        marketAnalysis: res.marketAnalysis,
        costUsd: res.costUsd || 0.001,
      };
    } catch {
      return null;
    }
  }

  private async queryGeminiDiscovery(summary: MarketIntelligenceSummary): Promise<{
    bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    reasoning: string;
    keyZones: string[];
    scenarios: any[];
    marketAnalysis?: AiMarketAnalysis;
    costUsd: number;
  } | null> {
    if (!this.geminiAdapter.isConfigured()) return null;

    try {
      const prompt = `Actúa como Auditor Crítico y Analista Independiente de Mercado para NanoLabs AI Trading.
Evalúa con máxima objetividad la estructura multitemporal de BTCUSDT y descubre oportunidades técnicas genuinas.
IMPORTANTE:
1. Sin estrategias preprogramadas obligatorias. Eres libre de evaluar cualquier setup técnico de SMC/ICT o confluencia de mercado.
2. Identifica trampas de liquidez, mechas de absorción y falsos quiebres.
3. Si el mercado está en rango sucio o sin ventaja nítida, concluye NEUTRAL / NO_TRADE.
4. Genera planes de vigilancia algorítmicos estructurados (AI_WATCH_PLAN) con condiciones deterministas.

Responde obligatoriamente en JSON estricto:
{
  "marketAnalysis": {
    "whatMarketIsDoing": "...",
    "whyMarketIsDoingIt": "...",
    "evidenceList": ["..."],
    "bias": "BULLISH" | "BEARISH" | "NEUTRAL",
    "preferredHorizon": "SCALP" | "INTRADAY" | "SWING",
    "recommendedTimeframe": "15m",
    "noTradeJustification": "..."
  },
  "bias": "BULLISH" | "BEARISH" | "NEUTRAL",
  "reasoning": "...",
  "keyZones": ["..."],
  "scenarios": [
    {
      "direction": "LONG" | "SHORT",
      "thesis": "...",
      "horizon": "SCALP" | "INTRADAY" | "SWING",
      "timeframe": "15m",
      "structureType": "SMC_DISCRETIONARY_DISCOVERY",
      "entryZoneMin": 64200,
      "entryZoneMax": 64400,
      "targetEntry": 64300,
      "structuralStopLoss": 63800,
      "candidateTarget12": 65300,
      "candidateTarget14": 66300,
      "missingConditions": ["..."],
      "invalidationEvents": ["..."],
      "argumentsFor": ["..."],
      "argumentsAgainst": ["..."],
      "confidence": 75,
      "watchPlan": {
        "horizon": "INTRADAY",
        "observableConditions": [
          {
            "description": "Precio entra en zona [64200, 64400]",
            "operator": "PRICE_IN_RANGE",
            "params": { "minLevel": 64200, "maxLevel": 64400 },
            "automatable": true
          }
        ],
        "confirmationSequence": ["..."],
        "invalidationConditions": [
          {
            "description": "Precio cruza bajo SL",
            "operator": "PRICE_CROSS_BELOW",
            "params": { "level": 63800 },
            "automatable": true
          }
        ],
        "expirationHours": 8
      }
    }
  ]
}

Panorama Multitemporal:\n${JSON.stringify(summary, null, 2)}`;

      const res = await this.geminiAdapter.evaluateWithCustomPrompt?.(prompt) || null;
      if (!res) return null;
      return {
        bias: res.bias || res.marketAnalysis?.bias || 'NEUTRAL',
        reasoning: res.reasoning || res.marketAnalysis?.whatMarketIsDoing || '',
        keyZones: res.keyZones || [],
        scenarios: res.scenarios || [],
        marketAnalysis: res.marketAnalysis,
        costUsd: res.costUsd || 0.001,
      };
    } catch {
      return null;
    }
  }
}
