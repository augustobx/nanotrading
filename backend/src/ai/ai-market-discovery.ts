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
  ScenarioKind,
  TriggerSource,
  ObservableLevel,
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
import { effectiveRRMinimums } from '../engine/effective-rr.js';
import { classifyDiscovery, type CandidateDecision, type DiscoveryAudit } from './discovery-audit.js';

export interface DiscoveryOptions {
  forceManual?: boolean;
  minConfidence?: number;
  triggerSource?: TriggerSource;
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
  'CANDLE_PATTERN',
  'LEVEL_REJECTION_WICK',
  'STRUCTURE_CLOSE',
  'BREAK_AND_RETEST',
  'SWEEP_AND_RECLAIM',
  'VOLUME_EXPANSION',
  'BOS_CONFIRMED',
  'CHOCH_CONFIRMED',
];

export function verifyProposedLevels(
  candidate: Partial<Scenario> & {
    candidateTarget12?: number;
    candidateTarget14?: number;
    structuralStopLoss?: number;
  },
  summary: MarketIntelligenceSummary
): { isValid: boolean; rejectionReason?: string; verifiedLevels: ObservableLevel[] } {
  const currentPrice = summary.currentPrice;
  const horizon = candidate.horizon || 'INTRADAY';
  const targetEntry = Number(candidate.targetEntry || candidate.entryZoneMin || currentPrice);
  const distPct = Math.abs((targetEntry - currentPrice) / currentPrice) * 100;

  // Maximum allowed distance from current price based on horizon
  const maxDistanceByHorizon: Record<string, number> = {
    SCALP: 3.0,
    INTRADAY: 7.0,
    SWING: 18.0,
  };
  const maxAllowedDist = maxDistanceByHorizon[horizon] || 7.0;

  if (distPct > maxAllowedDist) {
    return {
      isValid: false,
      rejectionReason: `Nivel propuesto ${targetEntry} está a ${distPct.toFixed(2)}% del precio actual (${currentPrice}), incompatible con el horizonte ${horizon} (máx ${maxAllowedDist}%)`,
      verifiedLevels: [],
    };
  }

  // Collect anchors across all timeframes in summary
  const anchors: Array<{
    price: number;
    top?: number;
    bottom?: number;
    timeframe: Timeframe;
    levelType: ObservableLevel['levelType'];
    evidence: string;
  }> = [];

  const tfs = Object.keys(summary.timeframes || {}) as Timeframe[];
  for (const tf of tfs) {
    const tfData = (summary.timeframes as any)[tf];
    if (!tfData) continue;

    if (tfData.activeSwings?.high?.price) {
      anchors.push({
        price: tfData.activeSwings.high.price,
        timeframe: tf,
        levelType: 'SWING_HIGH',
        evidence: `Swing High en ${tf} (${tfData.activeSwings.high.price})`,
      });
    }
    if (tfData.activeSwings?.low?.price) {
      anchors.push({
        price: tfData.activeSwings.low.price,
        timeframe: tf,
        levelType: 'SWING_LOW',
        evidence: `Swing Low en ${tf} (${tfData.activeSwings.low.price})`,
      });
    }
    for (const ob of tfData.activeObDetails || []) {
      anchors.push({
        price: (ob.top + ob.bottom) / 2,
        top: Math.max(ob.top, ob.bottom),
        bottom: Math.min(ob.top, ob.bottom),
        timeframe: tf,
        levelType: 'ORDER_BLOCK',
        evidence: `Order Block ${ob.type} en ${tf} [${ob.bottom} - ${ob.top}]`,
      });
    }
    for (const fvg of tfData.activeFvgDetails || []) {
      anchors.push({
        price: (fvg.top + fvg.bottom) / 2,
        top: Math.max(fvg.top, fvg.bottom),
        bottom: Math.min(fvg.top, fvg.bottom),
        timeframe: tf,
        levelType: 'FVG',
        evidence: `FVG ${fvg.type} en ${tf} [${fvg.bottom} - ${fvg.top}]`,
      });
    }
    if (tfData.vwap) {
      anchors.push({
        price: tfData.vwap,
        timeframe: tf,
        levelType: 'DYNAMIC_INDICATOR',
        evidence: `VWAP en ${tf} (${tfData.vwap})`,
      });
    }
  }

  // No observed market anchor => no verified structural trade level.
  if (anchors.length === 0) {
    return { isValid: false, rejectionReason: 'No hay niveles de mercado verificables', verifiedLevels: [] };
  }

  // Verify proposed candidate levels
  const levelsToTest: Array<{ price: number; role: string }> = [
    { price: targetEntry, role: 'entry' },
  ];
  if (candidate.stopLossPrice || candidate.structuralStopLoss) {
    levelsToTest.push({ price: Number(candidate.stopLossPrice || candidate.structuralStopLoss), role: 'stopLoss' });
  }
  const candidateTp12 = candidate.target12Price || candidate.candidateTarget12;
  const candidateTp14 = candidate.target14Price || candidate.candidateTarget14;
  if (candidateTp12) levelsToTest.push({ price: Number(candidateTp12), role: 'target12' });
  if (candidateTp14) levelsToTest.push({ price: Number(candidateTp14), role: 'target14' });

  const verifiedLevels: ObservableLevel[] = [];

  for (const item of levelsToTest) {
    const p = item.price;
    // Prioritize exact range containment (Order Blocks and FVGs) first!
    const rangeMatch = anchors.find((a) => {
      if (a.top !== undefined && a.bottom !== undefined) {
        return p >= a.bottom * 0.999 && p <= a.top * 1.001;
      }
      return false;
    });

    const match = rangeMatch || anchors.find((a) => {
      return Math.abs(a.price - p) / a.price <= 0.008;
    });

    const itemDist = Math.abs((p - currentPrice) / currentPrice) * 100;
    if (match) {
      verifiedLevels.push({
        price: p,
        timeframe: match.timeframe,
        levelType: match.levelType,
        evidence: match.evidence,
        distancePct: Number(itemDist.toFixed(2)),
        isVerified: true,
        relevanceToHorizon: itemDist <= maxAllowedDist ? 'HIGH' : 'LOW',
      });
    } else {
      verifiedLevels.push({
        price: p,
        timeframe: candidate.timeframe || '15m',
        levelType: 'PRICE_ACTION',
        evidence: `Nivel derivado de cálculo técnico (${item.role})`,
        distancePct: Number(itemDist.toFixed(2)),
        isVerified: false,
        relevanceToHorizon: itemDist <= maxAllowedDist ? 'HIGH' : 'LOW',
      });
    }
  }

  const allLevelsVerified = verifiedLevels.length > 0 && verifiedLevels.every((level) => level.isVerified);
  return {
    isValid: allLevelsVerified,
    rejectionReason: allLevelsVerified ? undefined : 'Uno o más niveles no coinciden con estructura de mercado confirmada',
    verifiedLevels,
  };
}


/**
 * Discovery contract shared by OpenAI and Gemini.
 * Describes only levels actually present in the market snapshot; illustrative
 * percentage-derived entry/stop/target examples must never enter paid prompts.
 * Validation and the administrative R:R policy remain authoritative.
 */
export function buildDiscoveryPrompt(
  summary: MarketIntelligenceSummary,
  provider: 'OPENAI' | 'GEMINI',
  policy?: { minNetRR: number; minRRShort: number; minRRExtended: number; rrTargetMode?: string } | null
): string {
  const minimums = effectiveRRMinimums(policy);
  const anchorLines: string[] = [];
  const positive = (input: unknown): number | null => {
    const number = Number(input);
    return Number.isFinite(number) && number > 0 ? number : null;
  };

  for (const [tf, raw] of Object.entries(summary.timeframes || {})) {
    const data: any = raw;
    if (!data) continue;
    const levels: string[] = [];
    const high = positive(data.activeSwings?.high?.price);
    const low = positive(data.activeSwings?.low?.price);
    const vwap = positive(data.vwap);
    if (high !== null) levels.push('SWING_HIGH=' + high);
    if (low !== null) levels.push('SWING_LOW=' + low);
    for (const ob of data.activeObDetails || []) {
      const bottom = positive(ob.bottom);
      const top = positive(ob.top);
      if (bottom !== null && top !== null) {
        levels.push('OB_' + String(ob.type || 'UNKNOWN') + '=[' + Math.min(bottom, top) + ',' + Math.max(bottom, top) + ']');
      }
    }
    for (const fvg of data.activeFvgDetails || []) {
      const bottom = positive(fvg.bottom);
      const top = positive(fvg.top);
      if (bottom !== null && top !== null) {
        levels.push('FVG_' + String(fvg.type || 'UNKNOWN') + '=[' + Math.min(bottom, top) + ',' + Math.max(bottom, top) + ']');
      }
    }
    if (vwap !== null) levels.push('VWAP=' + vwap);
    if (levels.length) anchorLines.push(tf + ': ' + levels.join('; '));
  }

  const analystRole = provider === 'OPENAI'
    ? 'Analista principal cuantitativo y discrecional de BTCUSDT Perpetual.'
    : 'Auditor crítico independiente de BTCUSDT Perpetual: cuestiona las tesis sin inventar niveles.';
  return [
    analystRole,
    'Precio de referencia: ' + summary.currentPrice + ' USDT.',
    'Política real: R:R NETO mínimo ' + minimums.short + ' para objetivo corto y ' +
      minimums.extended + ' para extendido; modo ' + (policy?.rrTargetMode || 'RR_BOTH') + '.',
    'Examinar estructura SMC/ICT, tendencia y rangos multitemporales, velas cerradas, volumen, RSI, EMA, VWAP y spreads.',
    'Las siguientes son las ÚNICAS anclas estructurales activas admitidas por el verificador de escenarios:',
    anchorLines.length ? anchorLines.join('\n') : 'No hay anclas verificables: responde scenarios: [].',
    'Los recentSwings históricos son contexto descriptivo, NO anclas válidas salvo que coincidan con activeSwings.',
    'REGLAS PARA PRECIOS: elige entrada, límites de zona, stop y objetivos apoyándote en estas anclas actuales. ' +
      'Puedes ubicar un nivel dentro del rango de un OB/FVG activo o cerca de un punto anclado conforme al verificador. ' +
      'Cita el timeframe y el nivel usado en thesis o argumentsFor.',
    'PROHIBIDO: objetivos derivados de multiplicadores del precio actual (+2%, +4%), ' +
      'R:R fijado a priori, precios redondeados inventados, stops arbitrarios y objetivos sin referencia verificable.',
    'Primero determina los objetivos estructurales alcanzables y el stop estructural; después comprueba si el R:R NETO ' +
      'alcanza la política. Si no, devuelve scenarios: [] y explica la falta de elegibilidad.',
    'No hay obligación de emitir un LONG o SHORT. NEUTRAL/NO_TRADE es correcto sin confluencia y precio justificable.',
    'Construye AI_WATCH_PLAN determinista con pasos secuenciales y operadores soportados: PRICE_IN_RANGE, ' +
      'CANDLE_PATTERN, LEVEL_REJECTION_WICK, STRUCTURE_CLOSE, BREAK_AND_RETEST, SWEEP_AND_RECLAIM, ' +
      'VOLUME_EXPANSION, BOS_CONFIRMED, CHOCH_CONFIRMED, RSI_THRESHOLD, SPREAD_TOLERANCE. ' +
      'Solo automatable:true para condiciones verificables con los datos disponibles; si no, automatable:false.',
    'RESPUESTA: exclusivamente JSON válido con claves marketAnalysis, bias, reasoning, keyZones y scenarios.',
    'marketAnalysis es objeto con whatMarketIsDoing, whyMarketIsDoingIt, evidenceList (array de strings), ' +
      'bias (BULLISH/BEARISH/NEUTRAL), preferredHorizon (SCALP/INTRADAY/SWING), recommendedTimeframe ' +
      'y noTradeJustification.',
    'scenarios es un array (puede ser []). Para cada elemento usa direction (LONG/SHORT), thesis, horizon, timeframe, ' +
      'structureType, entryZoneMin, entryZoneMax, targetEntry, structuralStopLoss, candidateTarget12 y/o ' +
      'candidateTarget14, missingConditions, invalidationEvents, argumentsFor, argumentsAgainst, confidence y watchPlan.',
    'watchPlan incluye horizon, observableConditions [{description,operator,params,automatable,sequenceOrder}], ' +
      'confirmationSequence, invalidationConditions [{description,operator,params,automatable}] y expirationHours.',
    'Los niveles monetarios deben ser NÚMEROS JSON basados en el snapshot, nunca strings, null ni ejemplos. ' +
      'Si no hay un target estructural, omite ese target; si no hay ninguno, devuelve scenarios: [].',
    'No inventes probabilidades estadísticas ni garantices rendimiento.',
    'Panorama Multitemporal:',
    JSON.stringify(summary, null, 2),
  ].join('\n');
}

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
      const candles: any[] = candleManager.getCandles(tf).filter((c: any) => c.confirmed === true);
      klinesAvailableMap[tf] = candles.length > 0;
      const lastCandle = [...candles].at(-1);
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

    // PR 4.1: Autonomous architecture consolidation.
    // Live AI discovery operates fully autonomously without legacy A/B benchmarks.
    const algorithmicReferenceSetups: AlgorithmicReferenceSetup[] = [];

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
    let audit: DiscoveryAudit | undefined;
    try {
      const triggerSource: TriggerSource = options.triggerSource || (options.forceManual ? 'MANUAL_TRIGGER' : 'AUTOMATIC_SCHEDULER');
      const summary = this.buildMarketIntelligenceSummary();
      const snapshotId = `snap_disc_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      audit = {
        id: snapshotId, timestamp: Date.now(), triggerSource, outcome: 'RUNNING',
        snapshot: structuredClone(summary),
        policy: structuredClone(this.coordinator.getRiskPolicyManager?.()?.getPolicy?.() || null) as any,
        providers: { OPENAI: { status: 'NOT_REQUESTED' }, GEMINI: { status: 'NOT_REQUESTED' } }, candidates: [], scenarioIds: [],
      };
      // Persist the exact input before spending tokens, including its stable ID.
      this.db.saveDiscoveryAudit?.(audit);

      // Check Hard Budget Limit
      if (this.hardBudgetManager.isBlocked()) {
        const reason = this.hardBudgetManager.getBlockedReason() || 'AI_BUDGET_EXCEEDED';
        audit.outcome = 'BUDGET_BLOCKED';
        audit.reason = reason;
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
          ...(mockResult.openai?.scenarios || []).map((s) => ({ ...s, proposedBy: 'OPENAI' as const, triggerSource })),
          ...(mockResult.gemini?.scenarios || []).map((s) => ({ ...s, proposedBy: 'GEMINI' as const, triggerSource })),
        ];

        for (const cand of candidateScenarios) {
          const validated = this.validateAndBuildScenario(cand, summary, snapshotId, 0.001, audit.candidates, audit.policy);
          if (validated) {
            this.retireNeutralObservations(snapshotId);
            this.registerAuditedScenario(validated, audit, registered);
          }
        }

        audit.outcome = classifyDiscovery(audit.candidates, !!(mockResult.openai || mockResult.gemini));
        if (registered.length === 0 && (mockResult.openai || mockResult.gemini)) {
          const neutralScenario = this.buildNeutralObservationScenario(summary, snapshotId, 0.001, mockResult.openai, mockResult.gemini, triggerSource);
          if (neutralScenario) {
            this.annotateObservation(neutralScenario, audit);
            this.retireNeutralObservations(snapshotId);
            this.registerAuditedScenario(neutralScenario, audit, registered);
          }
        }

        summary.lastDiscoveryTimestamp = Date.now();
        audit.scenarioIds = registered.map(s => s.id);
        this.lastSummary = summary;
        this.emit('discovery_completed', { scenarios: registered, summary });
        return { scenarios: registered, summary, aiCostUsd: 0.001 };
      }

      // Real or Semi-autonomous AI Discovery
      const openaiConfigured = this.openaiAdapter.isConfigured();
      const geminiConfigured = this.geminiAdapter.isConfigured();

      if (!openaiConfigured && !geminiConfigured && !options.forceManual) {
        audit.outcome = 'PROVIDER_UNAVAILABLE';
        audit.reason = 'NO_AI_PROVIDERS_CONFIGURED';
        return { scenarios: [], summary, aiCostUsd: 0, skippedReason: 'NO_AI_PROVIDERS_CONFIGURED' };
      }

      // Reserve independently for BOTH possible paid providers before requesting either.
      // Never launch the second AI call against a reservation held only for the first.
      const reservations: Array<{
        provider: 'OPENAI' | 'GEMINI'; model: string; reservationId: string;
      }> = [];
      const providersToQuery: Array<{ provider: 'OPENAI' | 'GEMINI'; model: string }> = [];
      const router = this.coordinator.getAiRouter?.();
      const remainingUsd = Math.max(0,
        this.hardBudgetManager.getConfig().dailyBudgetLimitUsd -
        this.hardBudgetManager.getTodaySpendUsd() - this.hardBudgetManager.getReservedPendingUsd());
      const openaiModel = router?.routeModel('MARKET_DISCOVERY', 'OPENAI', remainingUsd).selectedModel ||
        this.openaiAdapter.getModel();
      const geminiModel = router?.routeModel('MARKET_DISCOVERY', 'GEMINI', remainingUsd).selectedModel ||
        this.geminiAdapter.getModel();
      const geminiHealth = this.geminiAdapter.getDiscoveryHealth?.(geminiModel);
      const geminiPaused = !!geminiHealth && geminiHealth.retryNotBefore > Date.now();
      if (openaiConfigured) providersToQuery.push({ provider: 'OPENAI', model: openaiModel });
      if (geminiConfigured && !geminiPaused) providersToQuery.push({ provider: 'GEMINI', model: geminiModel });
      if (!summary.dataAvailability.allCriticalDataPresent) {
        audit.outcome = 'DATA_UNAVAILABLE';
        return { scenarios: [], summary, aiCostUsd: 0, skippedReason: 'MARKET_DATA_NOT_READY' };
      }
      for (const provider of providersToQuery) {
        const held = this.hardBudgetManager.reserveBudget({
          provider: provider.provider, model: provider.model,
          task: 'MARKET_DISCOVERY', estimatedTokens: 3500,
        });
        if (!held.allowed || !held.reservationId) {
          audit.outcome = 'BUDGET_BLOCKED';
          audit.reason = held.reason || 'AI_BUDGET_EXCEEDED';
          for (const prior of reservations) this.hardBudgetManager.releaseReservation(prior.reservationId);
          return { scenarios: [], summary, aiCostUsd: 0, skippedReason: held.reason || 'AI_BUDGET_EXCEEDED' };
        }
        reservations.push({ ...provider, reservationId: held.reservationId });
      }

      let totalCostUsd = 0;
      const discoveredScenarios: Scenario[] = [];
      let openaiDiscovery: any = null;
      let geminiDiscovery: any = null;

      try {
        // Query OpenAI and Gemini for autonomous discovery
        const [resOpenai, resGemini] = await Promise.all([
          openaiConfigured ? this.queryOpenAiDiscovery(summary, openaiModel) : Promise.resolve(null),
          geminiConfigured && !geminiPaused ? this.queryGeminiDiscovery(summary, geminiModel) : Promise.resolve(null),
        ]);
        openaiDiscovery = resOpenai;
        geminiDiscovery = resGemini;

        if (openaiDiscovery) {
          summary.openaiBias = openaiDiscovery.bias;
          if (openaiDiscovery.marketAnalysis) summary.openaiAnalysis = openaiDiscovery.marketAnalysis;
          totalCostUsd += openaiDiscovery.costUsd || 0;
          for (const cand of (openaiDiscovery.scenarios || [])) {
            const sc = this.validateAndBuildScenario({ ...cand, proposedBy: 'OPENAI', triggerSource }, summary, snapshotId, (openaiDiscovery.costUsd || 0) / Math.max(1, (openaiDiscovery.scenarios || []).length), audit.candidates, audit.policy);
            if (sc) {
              sc.openaiInterpretation = {
                provider: 'OPENAI',
                model: openaiDiscovery.model || openaiModel,
                bias: openaiDiscovery.bias,
                reasoning: openaiDiscovery.reasoning,
                keyZones: openaiDiscovery.keyZones || [],
                confidence: cand.confidence || 75,
                marketAnalysis: openaiDiscovery.marketAnalysis,
                costUsd: openaiDiscovery.costUsd,
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
            const sc = this.validateAndBuildScenario({ ...cand, proposedBy: 'GEMINI', triggerSource }, summary, snapshotId, (geminiDiscovery.costUsd || 0) / Math.max(1, (geminiDiscovery.scenarios || []).length), audit.candidates, audit.policy);
            if (sc) {
              sc.geminiInterpretation = {
                provider: 'GEMINI',
                model: geminiDiscovery.model || geminiModel,
                bias: geminiDiscovery.bias,
                reasoning: geminiDiscovery.reasoning,
                keyZones: geminiDiscovery.keyZones || [],
                confidence: cand.confidence || 75,
                marketAnalysis: geminiDiscovery.marketAnalysis,
                costUsd: geminiDiscovery.costUsd,
              };
              discoveredScenarios.push(sc);
            }
          }

        }
      } finally {
        for (const [provider, configured, result, model] of [
          ['OPENAI', openaiConfigured, openaiDiscovery, openaiModel],
          ['GEMINI', geminiConfigured, geminiDiscovery, geminiModel],
        ] as const) {
          audit.providers[provider] = {
            status: result ? 'SUCCESS' : configured ? 'UNAVAILABLE' : 'NOT_CONFIGURED',
            model, bias: result?.bias, candidateCount: result?.scenarios?.length,
            failure: configured && !result ? 'NO_VALID_RESPONSE' : undefined,
          };
          if (provider === 'GEMINI' && configured && !result) {
            const health = this.geminiAdapter.getDiscoveryHealth?.(model);
            audit.providers[provider].status = geminiPaused ? 'PAUSED' : 'UNAVAILABLE';
            audit.providers[provider].failure = health?.failureCode || 'NO_VALID_RESPONSE';
            audit.providers[provider].retryNotBefore = health?.retryNotBefore;
          }
        }
        for (const reservation of reservations) {
          const result = reservation.provider === 'OPENAI' ? openaiDiscovery : geminiDiscovery;
          // Missing/invalid responses are uncertain: keep the reserved amount
          // instead of incorrectly reporting a zero-cost successful API call.
          this.hardBudgetManager.reconcileReservation(reservation.reservationId, {
            provider: reservation.provider,
            model: result?.model || reservation.model,
            task: 'MARKET_DISCOVERY',
            analysisId: snapshotId,
            promptTokens: result?.promptTokens || 0,
            completionTokens: result?.completionTokens || 0,
            ...(result ? { costUsd: result.costUsd } : {}),
            status: result ? 'SUCCESS' : 'UNCERTAIN_TIMEOUT',
            latencyMs: result?.latencyMs || 0,
          });
        }
      }

      audit.outcome = classifyDiscovery(audit.candidates, !!(openaiDiscovery || geminiDiscovery));
      if (!openaiDiscovery && !geminiDiscovery) {
        // Do NOT manufacture a neutral "AI consensus" when both API calls
        // failed or timed out. Budget reservations were already reconciled.
        return {
          scenarios: [], summary, aiCostUsd: totalCostUsd,
          skippedReason: 'AI_PROVIDERS_FAILED_NO_VALID_ANALYSIS',
        };
      }

      // If no directional scenarios were proposed or if AI concluded NEUTRAL,
      // register a formal NEUTRAL observation scenario (preserving "no operar es una decisión válida")
      if (discoveredScenarios.length === 0) {
        const neutralScenario = this.buildNeutralObservationScenario(summary, snapshotId, totalCostUsd, openaiDiscovery, geminiDiscovery, triggerSource);
        if (neutralScenario) {
          this.annotateObservation(neutralScenario, audit);
          discoveredScenarios.push(neutralScenario);
        }
      }

      // Register all valid scenarios in registry
      if (discoveredScenarios.length) this.retireNeutralObservations(snapshotId);
      const registered: Scenario[] = [];
      for (const sc of discoveredScenarios) {
        this.registerAuditedScenario(sc, audit, registered);
      }

      summary.lastDiscoveryTimestamp = Date.now();
      this.lastSummary = summary;
      audit.scenarioIds = registered.map(s => s.id);
      this.emit('discovery_completed', { scenarios: registered, summary });
      return { scenarios: registered, summary, aiCostUsd: totalCostUsd };
    } finally {
      this.isDiscovering = false;
      if (audit) {
        audit.completedAt = Date.now();
        if (audit.outcome === 'RUNNING') { audit.outcome = 'ERROR'; audit.reason = 'EXECUTION_FAILED'; }
        this.db.saveDiscoveryAudit?.(audit);
      }
    }
  }

  private registerAuditedScenario(scenario: Scenario, audit: DiscoveryAudit, registered: Scenario[]): void {
    const saved = this.scenarioRegistry.registerScenario(scenario);
    // Registry deduplication can replace the proposed ID with a durable existing ID.
    for (const decision of audit.candidates) {
      if (decision.scenarioId === scenario.id) decision.scenarioId = saved.id;
    }
    const existing = registered.findIndex(s => s.id === saved.id);
    if (existing >= 0) registered[existing] = saved;
    else registered.push(saved);
  }

  private retireNeutralObservations(snapshotId: string): void {
    for (const old of this.scenarioRegistry.getAllActive()) {
      if (old.direction === 'NEUTRAL' || old.kind === 'NEUTRAL_OBSERVATION') {
        this.scenarioRegistry.transitionStatus(old.id, 'CANCELLED',
          'Observación sustituida por un análisis más reciente', { replacementSnapshotId: snapshotId });
      }
    }
  }

  private annotateObservation(scenario: Scenario, audit: DiscoveryAudit): void {
    if (audit.outcome !== 'CANDIDATES_REJECTED') return;
    const reasons = [...new Set(audit.candidates.filter(c => !c.accepted).map(c => c.reason))].join(', ');
    scenario.rejectionReason = `Candidatos descartados por validación: ${reasons}. Observación algorítmica; no equivale a una conclusión NEUTRAL de la IA.`;
    scenario.aiMarketThesis = scenario.rejectionReason;
    if (scenario.watchPlan) scenario.watchPlan.marketThesis = scenario.rejectionReason;
  }

  private buildNeutralObservationScenario(
    summary: MarketIntelligenceSummary,
    snapshotId: string,
    aiCostUsd: number,
    openaiDiscovery?: any,
    geminiDiscovery?: any,
    triggerSource: TriggerSource = 'AUTOMATIC_SCHEDULER'
  ): Scenario | null {
    const openaiConfigured = this.openaiAdapter.isConfigured();
    const geminiConfigured = this.geminiAdapter.isConfigured();

    const tf15 = (summary.timeframes as any)?.['15m'];
    const structuralHigh = tf15?.activeSwings?.high?.price;
    const structuralLow = tf15?.activeSwings?.low?.price;
    let rangeHigh = structuralHigh;
    let rangeLow = structuralLow;

    if (!Number.isFinite(rangeHigh) || !Number.isFinite(rangeLow) || rangeHigh <= rangeLow) {
      // Fallback is OBSERVED OHLC, never a synthetic +/-0.6% price estimate.
      const closed = (this.coordinator.getCandleManager?.()?.getCandles('15m', 30) || [])
        .filter((c: any) => c.confirmed === true && Number.isFinite(c.high) &&
          Number.isFinite(c.low) && c.high >= c.low && c.low > 0)
        .slice(-20);
      if (closed.length < 10) return null;
      rangeHigh = Math.max(...closed.map((c: any) => c.high));
      rangeLow = Math.min(...closed.map((c: any) => c.low));
    }

    // Degenerate ranges are not actionable observations and must not be
    // persisted as "2 verified levels" or trigger further paid discovery.
    if (!Number.isFinite(rangeHigh) || !Number.isFinite(rangeLow) ||
        rangeLow <= 0 || rangeHigh <= rangeLow ||
        (rangeHigh - rangeLow) / summary.currentPrice < 0.0005) {
      return null;
    }

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
      id: `wp_neutral_${summary.symbol}_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      scenarioId: `sc_neutral_${summary.symbol}_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      symbol: summary.symbol || 'BTCUSDT',
      direction: 'NEUTRAL',
      marketThesis: neutralThesis,
      horizon: 'INTRADAY',
      primaryTimeframe: '15m',
      watchZone: {
        minPrice: rangeLow,
        maxPrice: rangeHigh,
        targetEntry: (rangeLow + rangeHigh) / 2,
      },
      candidateStopLoss: rangeLow,
      candidateTakeProfits: {},
      rrEligibility: 'NONE',
      observableConditions: [
        {
          id: `cond_range_ceiling`,
          description: `Ruptura del techo del rango en ${rangeHigh} con volumen`,
          operator: 'PRICE_CROSS_ABOVE',
          params: { level: rangeHigh },
          isMet: false,
          automatable: true,
          sequenceOrder: 1,
        },
        {
          id: `cond_range_floor`,
          description: `Ruptura del piso del rango en ${rangeLow} con volumen`,
          operator: 'PRICE_CROSS_BELOW',
          params: { level: rangeLow },
          isMet: false,
          automatable: true,
          sequenceOrder: 1,
        },
      ],
      confirmationSequence: [
        `1. Ruptura del rango [${rangeLow} - ${rangeHigh}] con vela cerrada`,
        '2. Confirmación de volumen relativo rvol > 1.2',
      ],
      invalidationConditions: [],
      expirationTimestamp: Date.now() + 6 * 3600 * 1000,
      reevaluationTriggers: [
        { event: 'STRUCTURE_SHIFT', description: 'Ruptura de rango consolidado', timeframe: '15m' },
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
      kind: 'NEUTRAL_OBSERVATION' as ScenarioKind,
      triggerSource,
      timeframe: '15m',
      structureType: 'RANGING_NO_CONFLUENCE',
      proposedBy: openaiDiscovery && geminiDiscovery ? 'CONSENSUS' :
        openaiDiscovery ? 'OPENAI' : 'GEMINI',
      modelsUsed: [
        ...(openaiDiscovery ? [openaiDiscovery.model || this.openaiAdapter.getModel()] : []),
        ...(geminiDiscovery ? [geminiDiscovery.model || this.geminiAdapter.getModel()] : []),
      ],
      snapshotId,
      discoveryTimestamp: Date.now(),
      entryZoneMin: rangeLow,
      entryZoneMax: rangeHigh,
      targetEntry: (rangeLow + rangeHigh) / 2,
      stopLossPrice: rangeLow,
      rrModeAvailable: 'NONE',
      uncertaintyLevel: 'HIGH',
      status: 'NO_TRADE_OBSERVATION',
      // A range can already be broken intrabar at discovery. Show that state
      // immediately, but do not assert a confirmed close or request paid AI.
      neutralBreakoutProgress: {
        state: summary.currentPrice > rangeHigh || summary.currentPrice < rangeLow
          ? 'OUTSIDE_AWAITING_CLOSE' : 'WAITING_RANGE',
        side: summary.currentPrice > rangeHigh ? 'CEILING'
          : summary.currentPrice < rangeLow ? 'FLOOR' : undefined,
        price: summary.currentPrice,
        observedAt: Date.now(),
      },
      validUntilTimestamp: Date.now() + 6 * 3600 * 1000,
      aiCostUsd,
      activationConditions: [`Esperar ruptura de rango consolidado [${rangeLow} - ${rangeHigh}]`],
      invalidationTriggers: ['Rango invalidado por cierre de sesión'],
      argumentsFor: ['Preservación de capital prioritaria', 'Relación riesgo/beneficio desfavorable dentro del rango'],
      argumentsAgainst: ['Pérdida de oportunidad en caso de movimiento impulsivo repentino'],
      watchPlan: neutralPlan,
      aiMarketThesis: neutralThesis,
      horizon: 'INTRADAY',
      confidenceDisclaimer: 'La confianza declarada por la IA es cualitativa y subjetiva; no constituye probabilidad estadística.',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      verifiedLevels: [
        {
          price: rangeHigh,
          timeframe: '15m',
          levelType: 'RANGE_BOUNDARY',
          evidence: `Techo de rango consolidado (${rangeHigh})`,
          distancePct: Number((Math.abs(rangeHigh - summary.currentPrice) / summary.currentPrice * 100).toFixed(2)),
          isVerified: true,
          relevanceToHorizon: 'HIGH',
        },
        {
          price: rangeLow,
          timeframe: '15m',
          levelType: 'RANGE_BOUNDARY',
          evidence: `Piso de rango consolidado (${rangeLow})`,
          distancePct: Number((Math.abs(rangeLow - summary.currentPrice) / summary.currentPrice * 100).toFixed(2)),
          isVerified: true,
          relevanceToHorizon: 'HIGH',
        },
      ],
      openaiInterpretation: openaiDiscovery ? {
        provider: 'OPENAI',
        model: this.openaiAdapter.getModel(),
        bias: openaiDiscovery.bias,
        reasoning: openaiDiscovery.reasoning,
        keyZones: openaiDiscovery.keyZones || [],
        confidence: 90,
        marketAnalysis: openaiDiscovery.marketAnalysis,
        costUsd: openaiDiscovery.costUsd,
      } : undefined,
      geminiInterpretation: geminiDiscovery ? {
        provider: 'GEMINI',
        model: this.geminiAdapter.getModel(),
        bias: geminiDiscovery.bias,
        reasoning: geminiDiscovery.reasoning,
        keyZones: geminiDiscovery.keyZones || [],
        confidence: 90,
        marketAnalysis: geminiDiscovery.marketAnalysis,
        costUsd: geminiDiscovery.costUsd,
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
    aiCostUsd: number,
    decisions?: CandidateDecision[],
    policySnapshot?: Record<string, unknown> | null
  ): Scenario | null {
    const symbol = summary.symbol || 'BTCUSDT';
    const currentPrice = summary.currentPrice;
    const direction = candidate.direction;
    const decision: CandidateDecision = {
      provider: candidate.proposedBy || 'UNKNOWN', direction,
      levels: Object.fromEntries(['entryZoneMin', 'entryZoneMax', 'targetEntry', 'stopLossPrice',
        'structuralStopLoss', 'target12Price', 'target14Price', 'candidateTarget12', 'candidateTarget14']
        .map(key => [key, Number.isFinite((candidate as any)[key]) ? (candidate as any)[key] : null])),
      accepted: false, reason: 'UNVALIDATED',
    };
    const reject = (reason: string, details?: Record<string, unknown>): null => {
      decisions?.push({ ...decision, reason, details });
      return null;
    };
    if (!direction || (direction !== 'LONG' && direction !== 'SHORT')) return reject('INVALID_DIRECTION');

    const levelCheck = verifyProposedLevels(candidate, summary);
    if (!levelCheck.isValid) return reject('UNVERIFIED_STRUCTURAL_LEVELS', { ...levelCheck });

    const entryMin = Number(candidate.entryZoneMin);
    const entryMax = Number(candidate.entryZoneMax);
    let targetEntry = Number(candidate.targetEntry || (entryMin + entryMax) / 2);
    const stopLoss = Number(candidate.stopLossPrice || candidate.structuralStopLoss);

    if (![currentPrice, entryMin, entryMax, targetEntry, stopLoss].every(
      (n) => Number.isFinite(n) && n > 0
    ) || entryMin > entryMax || targetEntry < entryMin || targetEntry > entryMax) return reject('INVALID_ENTRY_GEOMETRY');

    // Validate sanity of prices (no fake values, no inverted order)
    if (direction === 'LONG') {
      if (stopLoss >= targetEntry) return reject('INVALID_STOP_SIDE');
      if (Math.abs(currentPrice - targetEntry) / currentPrice > 0.08) return reject('ENTRY_DRIFT', { currentPrice, targetEntry, maxFraction: 0.08 });
    } else {
      if (stopLoss <= targetEntry) return reject('INVALID_STOP_SIDE');
      if (Math.abs(currentPrice - targetEntry) / currentPrice > 0.08) return reject('ENTRY_DRIFT', { currentPrice, targetEntry, maxFraction: 0.08 });
    }

    // Determine candidate structural targets
    let target12 = candidate.target12Price || candidate.candidateTarget12;
    let target14 = candidate.target14Price || candidate.candidateTarget14;

    const riskDistance = Math.abs(targetEntry - stopLoss);
    if (riskDistance <= 0) return reject('INVALID_RISK_DISTANCE');

    // A qualifying mathematical R:R is not itself a structural target.
    // Never fabricate 2.05R / 4.10R price levels when neither analyst supplied one.
    if (!target12 && !target14) return reject('MISSING_STRUCTURAL_TARGET');
    if ((target12 !== undefined && (!Number.isFinite(target12) || target12 <= 0)) ||
        (target14 !== undefined && (!Number.isFinite(target14) || target14 <= 0))) return reject('INVALID_TARGET');

    // Use the actual administrative account policy and the live spread for
    // discovery previews. Hard-coded 10k/1% creates misleading RR/position sizing.
    const policy = policySnapshot === undefined ? this.coordinator.getRiskPolicyManager?.()?.getPolicy?.() : policySnapshot as any;
    const ticker = this.coordinator.getMarketState?.()?.ticker;
    const dualCalc = RiskCalculator.calculateDualTargets({
      direction,
      entryPrice: targetEntry,
      stopLossPrice: stopLoss,
      candidateTargets: [target12, target14].filter((n): n is number => typeof n === 'number'),
      explicit12Price: target12,
      explicit14Price: target14,
      accountBalance: policy?.capitalUsdt ?? 10000,
      riskPercent: policy?.maxRiskPerTradePercent ?? 0.5,
      spread: Number.isFinite(summary.orderBook?.spread) && summary.orderBook.spread >= 0 ? summary.orderBook.spread :
        ticker && Number.isFinite(ticker.spread) && ticker.spread >= 0 ? ticker.spread : 0.1,
      minRRShort: policy?.minRRShort ?? 2.0,
      minRRExtended: policy?.minRRExtended ?? 4.0,
      feeStructure: {
        makerFeeRate: 0.00020,
        takerFeeRate: 0.00055,
      },
    });

    if (dualCalc.qualifiedMode === 'NONE') {
      // Rejects scenarios that don't reach net 1:2
      return reject('RR_UNQUALIFIED', { calculation12: dualCalc.calculation12, calculation14: dualCalc.calculation14 });
    }

    let effectiveMode = dualCalc.qualifiedMode;
    if (policy) {
      const minimums = effectiveRRMinimums(policy);
      const valid12 = policy.rrTargetMode !== 'RR_1_4' && dualCalc.calculation12?.isValid &&
        dualCalc.calculation12.netRR >= minimums.short;
      const valid14 = policy.rrTargetMode !== 'RR_1_2' && dualCalc.calculation14?.isValid &&
        dualCalc.calculation14.netRR >= minimums.extended;
      if (!valid12 && !valid14) return reject('RR_POLICY_REJECTED', {
        netRR12: dualCalc.calculation12?.netRR, netRR14: dualCalc.calculation14?.netRR,
        minimums, rrTargetMode: policy.rrTargetMode, policyVersion: policy.version,
      });
      effectiveMode = valid12 && valid14 ? 'RR_BOTH' : valid12 ? 'RR_1_2' : 'RR_1_4';
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
        let op = (cond.operator || 'PRICE_IN_RANGE') as string;
        const params = { ...(cond.params || {}) };

        // Normalize candle pattern aliases (e.g. BEARISH_ENGULFING, SHOOTING_STAR, PIN_BAR, BULLISH_ENGULFING)
        const candlePatterns = ['BEARISH_ENGULFING', 'BULLISH_ENGULFING', 'PIN_BAR', 'SHOOTING_STAR', 'HAMMER', 'INVERTED_HAMMER'];
        if (candlePatterns.includes(op.toUpperCase())) {
          params.pattern = op.toUpperCase() as any;
          op = 'CANDLE_PATTERN';
        } else if (op === 'REJECTION_WICK' || op === 'LEVEL_REJECTION') {
          op = 'LEVEL_REJECTION_WICK';
        }

        const isOpValid = ALLOWED_WATCH_OPERATORS.includes(op as any);
        const automatable = isOpValid && cond.automatable !== false;
        if (!automatable) {
          allConditionsAutomatable = false;
          nonAutomatable.push(cond.description || `Condición ${i + 1}`);
        }
        validatedConditions.push({
          id: cond.id || `cond_${id}_${i}`,
          description: cond.description || `Condición ${op}`,
          operator: isOpValid ? (op as WatchOperator) : 'PRICE_IN_RANGE',
          params: Object.keys(params).length > 0 ? params : { minLevel: minZone, maxLevel: maxZone },
          isMet: false,
          automatable,
          sequenceOrder: cond.sequenceOrder !== undefined ? cond.sequenceOrder : i + 1,
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
        sequenceOrder: 1,
      });
      validatedConditions.push({
        id: `cond_${id}_spread`,
        description: 'Spread controlado menor o igual a 0.05% al momento de activación',
        operator: 'SPREAD_TOLERANCE',
        params: { threshold: 0.05 },
        isMet: false,
        automatable: true,
        sequenceOrder: 2,
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
      rrEligibility: effectiveMode,
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
      kind: 'TRADE_SCENARIO' as ScenarioKind,
      triggerSource: (candidate as any).triggerSource || 'AUTOMATIC_SCHEDULER',
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
      rrModeAvailable: effectiveMode,
      uncertaintyLevel: candidate.uncertaintyLevel || 'MEDIUM',
      status: 'SCENARIO_REGISTERED',
      validUntilTimestamp: expirationTimestamp,
      aiCostUsd,
      activationConditions: validatedConditions.map((c) => c.description),
      invalidationTriggers: validatedInvalidations.map((i) => i.description),
      argumentsFor: candidate.argumentsFor || [
        'Confluencia de soporte/resistencia multitemporal',
        `Ratio R:R neto calificado para modo ${effectiveMode}`,
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
      verifiedLevels: levelCheck.verifiedLevels,
    };

    decisions?.push({ ...decision, accepted: true, reason: 'ACCEPTED', scenarioId: scenario.id });
    return scenario;
  }

  private async queryOpenAiDiscovery(summary: MarketIntelligenceSummary, selectedModel?: string): Promise<{
    bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    reasoning: string;
    keyZones: string[];
    scenarios: any[];
    marketAnalysis?: AiMarketAnalysis;
    costUsd: number;
    model?: string;
    promptTokens?: number;
    completionTokens?: number;
    latencyMs?: number;
  } | null> {
    if (!this.openaiAdapter.isConfigured()) return null;

    try {
      const prompt = buildDiscoveryPrompt(summary, 'OPENAI',
        this.coordinator.getRiskPolicyManager?.()?.getPolicy?.());

      const res = await this.openaiAdapter.evaluateWithCustomPrompt?.(prompt, selectedModel) || null;
      if (!res || !['BULLISH', 'BEARISH', 'NEUTRAL'].includes(res.bias || res.marketAnalysis?.bias) ||
          (res.scenarios !== undefined && !Array.isArray(res.scenarios))) return null;
      return {
        bias: res.bias || res.marketAnalysis?.bias || 'NEUTRAL',
        reasoning: res.reasoning || res.marketAnalysis?.whatMarketIsDoing || '',
        keyZones: res.keyZones || [],
        scenarios: res.scenarios || [],
        marketAnalysis: res.marketAnalysis,
        costUsd: res.costUsd || 0,
        model: res.model || selectedModel,
        promptTokens: res.promptTokens,
        completionTokens: res.completionTokens,
        latencyMs: res.latencyMs,
      };
    } catch {
      return null;
    }
  }

  private async queryGeminiDiscovery(summary: MarketIntelligenceSummary, selectedModel?: string): Promise<{
    bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    reasoning: string;
    keyZones: string[];
    scenarios: any[];
    marketAnalysis?: AiMarketAnalysis;
    costUsd: number;
    model?: string;
    promptTokens?: number;
    completionTokens?: number;
    latencyMs?: number;
  } | null> {
    if (!this.geminiAdapter.isConfigured()) return null;

    try {
      const prompt = buildDiscoveryPrompt(summary, 'GEMINI',
        this.coordinator.getRiskPolicyManager?.()?.getPolicy?.());

      const res = await this.geminiAdapter.evaluateWithCustomPrompt?.(prompt, selectedModel, { discovery: true }) || null;
      if (!res || !['BULLISH', 'BEARISH', 'NEUTRAL'].includes(res.bias || res.marketAnalysis?.bias) ||
          (res.scenarios !== undefined && !Array.isArray(res.scenarios))) return null;
      return {
        bias: res.bias || res.marketAnalysis?.bias || 'NEUTRAL',
        reasoning: res.reasoning || res.marketAnalysis?.whatMarketIsDoing || '',
        keyZones: res.keyZones || [],
        scenarios: res.scenarios || [],
        marketAnalysis: res.marketAnalysis,
        costUsd: res.costUsd || 0,
        model: res.model || selectedModel,
        promptTokens: res.promptTokens,
        completionTokens: res.completionTokens,
        latencyMs: res.latencyMs,
      };
    } catch {
      return null;
    }
  }
}
