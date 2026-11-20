import { EventEmitter } from 'events';
import { Candle, Timeframe } from '../types/market.js';
import { CandleManager } from '../market/candle-manager.js';
import { DatabaseService } from '../storage/database.js';
import { SmcDetector, MarketStructureResult } from './smc-detector.js';
import { TechnicalIndicators } from './indicators.js';
import { StrategyATrendContinuation, SetupCandidate } from './strategy-a-trend.js';
import { StrategyBLiquiditySweep } from './strategy-b-sweep.js';

export interface MultiTimeframeAnalysis {
  timeframe: Timeframe;
  trend: 'BULLISH' | 'BEARISH' | 'RANGING';
  rsi: number;
  atr: number;
  ema20: number;
  ema50: number;
  ema200: number;
  vwap: number;
  relativeVolume: number;
  structure: MarketStructureResult;
  lastClose: number;
  timestamp: number;
}

export class SetupEngine extends EventEmitter {
  private candleManager: CandleManager;
  private db: DatabaseService;
  private activeSetups: Map<string, SetupCandidate> = new Map();
  private latestAnalyses: Map<Timeframe, MultiTimeframeAnalysis> = new Map();

  constructor(candleManager: CandleManager, db: DatabaseService) {
    super();
    this.candleManager = candleManager;
    this.db = db;

    // Listen to candle closed events to run deterministic analysis
    this.candleManager.on('candle_closed', (candle: Candle) => {
      this.evaluateTimeframe(candle.timeframe);
    });
  }

  public runFullAnalysis(spread: number = 0.1): {
    analyses: Record<string, MultiTimeframeAnalysis>;
    setups: SetupCandidate[];
  } {
    const timeframes: Timeframe[] = ['1d', '4h', '1h', '15m', '5m', '1m'];

    for (const tf of timeframes) {
      this.evaluateTimeframe(tf);
    }

    // Evaluate Strategies
    const candles4h = this.candleManager.getCandles('4h', 100);
    const candles1h = this.candleManager.getCandles('1h', 100);
    const candles15m = this.candleManager.getCandles('15m', 100);
    const candles5m = this.candleManager.getCandles('5m', 100);

    const stratA = StrategyATrendContinuation.evaluate(candles4h, candles1h, candles15m, candles5m, spread);
    if (stratA) {
      this.registerSetup(stratA);
    }

    const stratB = StrategyBLiquiditySweep.evaluate(candles1h, candles15m, candles5m, spread);
    if (stratB) {
      this.registerSetup(stratB);
    }

    const analysesObj: Record<string, MultiTimeframeAnalysis> = {};
    for (const [tf, an] of this.latestAnalyses.entries()) {
      analysesObj[tf] = an;
    }

    return {
      analyses: analysesObj,
      setups: Array.from(this.activeSetups.values()),
    };
  }

  public evaluateTimeframe(tf: Timeframe): MultiTimeframeAnalysis | null {
    const candles = this.candleManager.getCandles(tf, 100);
    if (candles.length < 5) return null;

    const closes = candles.map((c) => c.close);
    const rsiSeries = TechnicalIndicators.rsi(closes, 14);
    const atrSeries = TechnicalIndicators.atr(candles, 14);
    const ema20Series = TechnicalIndicators.ema(closes, 20);
    const ema50Series = TechnicalIndicators.ema(closes, 50);
    const ema200Series = TechnicalIndicators.ema(closes, 200);
    const vwapSeries = TechnicalIndicators.vwap(candles);
    const rvol = TechnicalIndicators.relativeVolume(candles, 20);

    const structure = SmcDetector.analyzeStructure(candles, tf);

    const lastIdx = candles.length - 1;
    const analysis: MultiTimeframeAnalysis = {
      timeframe: tf,
      trend: structure.trend,
      rsi: rsiSeries[lastIdx] || 50,
      atr: atrSeries[lastIdx] || 0,
      ema20: ema20Series[lastIdx] || closes[lastIdx],
      ema50: ema50Series[lastIdx] || closes[lastIdx],
      ema200: ema200Series[lastIdx] || closes[lastIdx],
      vwap: vwapSeries[lastIdx] || closes[lastIdx],
      relativeVolume: rvol,
      structure,
      lastClose: closes[lastIdx],
      timestamp: candles[lastIdx].timestamp,
    };

    this.latestAnalyses.set(tf, analysis);
    return analysis;
  }

  private registerSetup(setup: SetupCandidate): void {
    if (!this.activeSetups.has(setup.id)) {
      this.activeSetups.set(setup.id, setup);
      this.db.saveSetup({
        id: setup.id,
        timestamp: setup.timestamp,
        symbol: setup.symbol,
        strategy: setup.strategy,
        direction: setup.direction,
        timeframe: setup.timeframe,
        entryPrice: setup.entryPrice,
        stopLoss: setup.stopLossPrice,
        takeProfit: setup.takeProfitPrice,
        rrRatio: setup.riskReward.netRR,
        status: setup.status,
        evidence: setup.evidence,
      });

      this.db.logEvent('INFO', 'SetupEngine', `Setup detected: ${setup.strategy} [${setup.direction}] at ${setup.entryPrice}`, {
        id: setup.id,
        rr: setup.riskReward.netRR,
      });

      this.emit('setup_detected', setup);
    }
  }

  public getAnalysis(tf: Timeframe): MultiTimeframeAnalysis | undefined {
    return this.latestAnalyses.get(tf);
  }

  public getAllAnalyses(): Record<string, MultiTimeframeAnalysis> {
    const res: Record<string, MultiTimeframeAnalysis> = {};
    for (const [tf, an] of this.latestAnalyses.entries()) {
      res[tf] = an;
    }
    return res;
  }

  public getActiveSetups(): SetupCandidate[] {
    return Array.from(this.activeSetups.values());
  }
}
