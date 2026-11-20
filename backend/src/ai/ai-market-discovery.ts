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
} from './scenario-types.js';
import { SUPPORTED_TIMEFRAMES, Timeframe } from '../types/market.js';
import { TechnicalIndicators } from '../engine/indicators.js';

export interface DiscoveryOptions {
  forceManual?: boolean;
  minConfidence?: number;
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
    openai?: { bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL'; reasoning: string; scenarios: Partial<Scenario>[] };
    gemini?: { bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL'; reasoning: string; scenarios: Partial<Scenario>[] };
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
    };

    const candleManager = this.coordinator.getCandleManager();
    const setupEngine = this.coordinator.getSetupEngine();

    const tfSummaries: any = {};
    for (const tf of SUPPORTED_TIMEFRAMES) {
      const candles: any[] = candleManager.getCandles(tf);
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

      tfSummaries[tf] = {
        trend,
        rsi: Number((rsi || 50).toFixed(2)),
        atr: Number((atr || 50).toFixed(2)),
        ema20: ema20 !== undefined ? Number(ema20.toFixed(2)) : undefined,
        ema50: ema50 !== undefined ? Number(ema50.toFixed(2)) : undefined,
        ema200: ema200 !== undefined ? Number(ema200.toFixed(2)) : undefined,
        vwap: vwap ? Number(vwap.toFixed(2)) : undefined,
        volumeRelative: Number((rvol || 1.0).toFixed(2)),
        activeSwings: {
          high: lastSwingHigh?.price,
          low: lastSwingLow?.price,
        },
        bosCount: structureBreaks.filter((b: any) => b.type === 'BOS').length,
        chochCount: structureBreaks.filter((b: any) => b.type === 'CHoCH').length,
        activeFvgs: activeFvgs.length,
        activeObs: activeObs.length,
      };
    }

    const summary: MarketIntelligenceSummary = {
      symbol: this.coordinator.getMarketState().symbol || 'BTCUSDT',
      timestamp: Date.now(),
      currentPrice: ticker.lastPrice,
      timeframes: tfSummaries,
      orderBook: {
        spread: orderBook.spread,
        spreadPcnt: orderBook.spreadPcnt,
        imbalance: orderBook.imbalance,
        bestBid: orderBook.bestBid,
        bestAsk: orderBook.bestAsk,
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
      lastDiscoveryTimestamp: this.lastSummary?.lastDiscoveryTimestamp,
      lastRevalidationTimestamp: this.lastSummary?.lastRevalidationTimestamp,
      openaiBias: this.lastSummary?.openaiBias,
      geminiBias: this.lastSummary?.geminiBias,
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

        summary.lastDiscoveryTimestamp = Date.now();
        this.emit('discovery_completed', { scenarios: registered, summary });
        return { scenarios: registered, summary, aiCostUsd: 0.001 };
      }

      // Real or Semi-autonomous AI Discovery
      // Evaluate if adapters are configured
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
        estimatedTokens: 3000,
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
          totalCostUsd += openaiDiscovery.costUsd;
          for (const cand of openaiDiscovery.scenarios) {
            const sc = this.validateAndBuildScenario(cand, summary, snapshotId, openaiDiscovery.costUsd / Math.max(1, openaiDiscovery.scenarios.length));
            if (sc) {
              sc.openaiInterpretation = {
                provider: 'OPENAI',
                model: this.openaiAdapter.getModel(),
                bias: openaiDiscovery.bias,
                reasoning: openaiDiscovery.reasoning,
                keyZones: openaiDiscovery.keyZones,
                confidence: cand.confidence || 75,
              };
              discoveredScenarios.push(sc);
            }
          }
        }

        if (geminiDiscovery) {
          summary.geminiBias = geminiDiscovery.bias;
          totalCostUsd += geminiDiscovery.costUsd;
          for (const cand of geminiDiscovery.scenarios) {
            const sc = this.validateAndBuildScenario(cand, summary, snapshotId, geminiDiscovery.costUsd / Math.max(1, geminiDiscovery.scenarios.length));
            if (sc) {
              sc.geminiInterpretation = {
                provider: 'GEMINI',
                model: this.geminiAdapter.getModel(),
                bias: geminiDiscovery.bias,
                reasoning: geminiDiscovery.reasoning,
                keyZones: geminiDiscovery.keyZones,
                confidence: cand.confidence || 75,
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
            promptTokens: 1500,
            completionTokens: 500,
            costUsd: totalCostUsd,
            status: 'SUCCESS',
            latencyMs: 1200,
          });
        }
      }

      // If no directional scenarios were proposed or if AI concluded NEUTRAL,
      // register a formal NEUTRAL observation scenario (preserving "no operar es una decisión válida")
      if (discoveredScenarios.length === 0) {
        const neutralScenario: Scenario = {
          id: `sc_neutral_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
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
          validUntilTimestamp: Date.now() + 4 * 3600 * 1000,
          aiCostUsd: totalCostUsd,
          activationConditions: ['Esperar desplazamiento direccional limpio y ruptura con confirmación'],
          invalidationTriggers: ['Ruptura con volumen fuera del rango'],
          argumentsFor: ['Mercado sin confluencia técnica estricta', 'Preservación de capital prioritaria'],
          argumentsAgainst: ['Riesgo/beneficio asimétrico desfavorable en la zona actual'],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          openaiInterpretation: openaiDiscovery ? {
            provider: 'OPENAI',
            model: this.openaiAdapter.getModel(),
            bias: openaiDiscovery.bias,
            reasoning: openaiDiscovery.reasoning,
            keyZones: openaiDiscovery.keyZones || [],
            confidence: 90,
          } : undefined,
          geminiInterpretation: geminiDiscovery ? {
            provider: 'GEMINI',
            model: this.geminiAdapter.getModel(),
            bias: geminiDiscovery.bias,
            reasoning: geminiDiscovery.reasoning,
            keyZones: geminiDiscovery.keyZones || [],
            confidence: 90,
          } : undefined,
          rejectionReason: 'Conclusión formal de IA: ESPERAR (No operar es una decisión válida)',
        };
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

  private validateAndBuildScenario(
    candidate: Partial<Scenario> & {
      candidateTarget12?: number;
      candidateTarget14?: number;
      structuralStopLoss?: number;
      confidence?: number;
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
      // Target entry shouldn't be too far from current price (within 8%)
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
    const distanceToZone = direction === 'LONG'
      ? Math.max(0, (currentPrice - Math.max(entryMin, entryMax)) / currentPrice) * 100
      : Math.max(0, (Math.min(entryMin, entryMax) - currentPrice) / currentPrice) * 100;

    const scenario: Scenario = {
      id,
      symbol,
      direction,
      timeframe: candidate.timeframe || '15m',
      structureType: candidate.structureType || 'SMC_KEY_ZONE',
      proposedBy: candidate.proposedBy || 'CONSENSUS',
      modelsUsed: candidate.modelsUsed || ['ai-analyst'],
      snapshotId,
      discoveryTimestamp: Date.now(),
      entryZoneMin: Math.min(entryMin, entryMax),
      entryZoneMax: Math.max(entryMin, entryMax),
      targetEntry,
      stopLossPrice: stopLoss,
      target12Price: dualCalc.target12Price,
      target14Price: dualCalc.target14Price,
      netRR12: dualCalc.calculation12?.netRR,
      netRR14: dualCalc.calculation14?.netRR,
      rrModeAvailable: dualCalc.qualifiedMode,
      uncertaintyLevel: candidate.uncertaintyLevel || 'MEDIUM',
      status: 'SCENARIO_REGISTERED',
      validUntilTimestamp: Date.now() + 12 * 60 * 60 * 1000, // 12 hours validity
      aiCostUsd,
      activationConditions: candidate.activationConditions || [
        'Mitigación limpia de la zona operativa con volumen decreciente',
        'CHoCH en microestructura (5m) tras tocar la zona',
      ],
      invalidationTriggers: candidate.invalidationTriggers || [
        `Pérdida estructural y cierre de vela con cuerpo más allá de ${stopLoss}`,
      ],
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
    costUsd: number;
  } | null> {
    if (!this.openaiAdapter.isConfigured()) return null;

    try {
      const prompt = `Analiza este panorama multitemporal cuantitativo de BTCUSDT y descubre hipótesis de trading operables (LONG o SHORT con R:R >= 1:2 o 1:4).
Si no hay confluencia técnica estricta, concluye con bias NEUTRAL y 0 escenarios. "No operar es una decisión válida y a menudo la mejor".
Responde obligatoriamente en JSON estricto con:
{
  "bias": "BULLISH" | "BEARISH" | "NEUTRAL",
  "reasoning": "...",
  "keyZones": ["64200 - 64500", ...],
  "scenarios": [
    {
      "direction": "LONG" | "SHORT",
      "timeframe": "15m",
      "structureType": "FVG_RETEST" | "ORDER_BLOCK_MITIGATION" | "LIQUIDITY_SWEEP_REVERSAL",
      "entryZoneMin": 64200,
      "entryZoneMax": 64400,
      "targetEntry": 64300,
      "structuralStopLoss": 63800,
      "candidateTarget12": 65300,
      "candidateTarget14": 66300,
      "activationConditions": ["..."],
      "invalidationTriggers": ["..."],
      "argumentsFor": ["..."],
      "argumentsAgainst": ["..."],
      "confidence": 75
    }
  ]
}
Panorama:\n${JSON.stringify(summary, null, 2)}`;

      const res = await this.openaiAdapter.evaluateWithCustomPrompt?.(prompt) || null;
      if (!res) return null;
      return {
        bias: res.bias || 'NEUTRAL',
        reasoning: res.reasoning || '',
        keyZones: res.keyZones || [],
        scenarios: res.scenarios || [],
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
    costUsd: number;
  } | null> {
    if (!this.geminiAdapter.isConfigured()) return null;

    try {
      const prompt = `Auditor de Riesgo y Descubrimiento Independiente: analiza el panorama multitemporal de BTCUSDT. Identifica trampas de liquidez y escenarios válidos.
Responde en JSON estricto:
{
  "bias": "BULLISH" | "BEARISH" | "NEUTRAL",
  "reasoning": "...",
  "keyZones": ["..."],
  "scenarios": [...]
}
Panorama:\n${JSON.stringify(summary, null, 2)}`;

      const res = await this.geminiAdapter.evaluateWithCustomPrompt?.(prompt) || null;
      if (!res) return null;
      return {
        bias: res.bias || 'NEUTRAL',
        reasoning: res.reasoning || '',
        keyZones: res.keyZones || [],
        scenarios: res.scenarios || [],
        costUsd: res.costUsd || 0.001,
      };
    } catch {
      return null;
    }
  }
}
