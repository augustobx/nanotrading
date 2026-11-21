import fs from 'node:fs';
import path from 'node:path';
import { Candle, Timeframe, TIMEFRAME_DURATION_MS } from '../src/types/market.js';
import { SmcDetector as SmcDetectorV4 } from '../src/engine/smc-detector.js';
import { StrategyATrendContinuation, SetupCandidate } from '../src/engine/strategy-a-trend.js';
import { StrategyBLiquiditySweep } from '../src/engine/strategy-b-sweep.js';
import { RiskCalculator } from '../src/engine/risk-calculator.js';

function evaluateStrategyAWithStruct(
  candles4h: Candle[], candles1h: Candle[], candles15m: Candle[], candles5m: Candle[],
  struct4h: any, struct1h: any, struct15m: any, struct5m: any, spread = 0.1
): SetupCandidate | null {
  if (candles4h.length < 20 || candles1h.length < 20 || candles15m.length < 20 || candles5m.length < 20) return null;
  const lastCandle5m = candles5m[candles5m.length - 1];
  const currentPrice = lastCandle5m.close;

  // Bullish
  const isHigherTfBullish = struct4h.trend === 'BULLISH' || struct1h.trend === 'BULLISH';
  if (isHigherTfBullish) {
    const activeFvg = [...struct15m.fvgs].reverse().find((f: any) => f.type === 'BULLISH' && f.status === 'ACTIVE');
    const activeOb = [...(struct15m.orderBlocks || [])].reverse().find((o: any) => o.type === 'BULLISH' && o.status === 'ACTIVE');
    const demandZone = activeFvg ? { top: activeFvg.top, bottom: activeFvg.bottom } : activeOb ? { top: activeOb.top, bottom: activeOb.bottom } : null;

    if (demandZone && currentPrice >= demandZone.bottom && currentPrice <= demandZone.top * 1.002) {
      const recentBullBreak = [...struct5m.structureBreaks].reverse().find(
        (b: any) => b.direction === 'BULLISH' && b.candleIndex >= candles5m.length - 8
      );
      if (recentBullBreak) {
        const entryPrice = currentPrice;
        const stopLossPrice = parseFloat((demandZone.bottom - 10.0).toFixed(1));
        const opposingHighs = [...struct1h.swings, ...struct15m.swings]
          .filter((s: any) => s.type === 'HIGH' && s.price > entryPrice)
          .sort((a: any, b: any) => a.price - b.price);
        const targetHigh = opposingHighs[0];
        if (targetHigh) {
          const takeProfitPrice = targetHigh.price;
          const rr = RiskCalculator.calculate({
            direction: 'LONG',
            entryPrice,
            stopLossPrice,
            takeProfitPrice,
            spread,
            minRequiredRR: 4.0,
          });
          return {
            id: `strat_a_long_${lastCandle5m.timestamp}`,
            strategy: 'STRATEGY_A_TREND_CONTINUATION',
            symbol: 'BTCUSDT',
            direction: 'LONG',
            timeframe: '5m',
            timestamp: lastCandle5m.timestamp,
            entryPrice,
            stopLossPrice,
            takeProfitPrice,
            riskReward: rr,
            status: rr.netRR >= 4.0 ? 'QUALIFIED' : 'PENDING_CONFIRMATION',
            evidence: {
              macroTrend: `4H: ${struct4h.trend}, 1H: ${struct1h.trend}`,
              triggerReason: `Bullish break on 5m (${recentBullBreak.type}) at demand zone`,
              invalidationReason: `Close below demand bottom $${demandZone.bottom}`,
              confluencePoints: ['Higher TF trend', '15m Demand Zone Mitigated', '5m Structure Break'],
              structuralTarget: `Target high $${targetHigh.price}`,
            },
          };
        }
      }
    }
  }

  // Bearish
  const isHigherTfBearish = struct4h.trend === 'BEARISH' || struct1h.trend === 'BEARISH';
  if (isHigherTfBearish) {
    const activeFvg = [...struct15m.fvgs].reverse().find((f: any) => f.type === 'BEARISH' && f.status === 'ACTIVE');
    const activeOb = [...(struct15m.orderBlocks || [])].reverse().find((o: any) => o.type === 'BEARISH' && o.status === 'ACTIVE');
    const supplyZone = activeFvg ? { top: activeFvg.top, bottom: activeFvg.bottom } : activeOb ? { top: activeOb.top, bottom: activeOb.bottom } : null;

    if (supplyZone && currentPrice <= supplyZone.top && currentPrice >= supplyZone.bottom * 0.998) {
      const recentBearBreak = [...struct5m.structureBreaks].reverse().find(
        (b: any) => b.direction === 'BEARISH' && b.candleIndex >= candles5m.length - 8
      );
      if (recentBearBreak) {
        const entryPrice = currentPrice;
        const stopLossPrice = parseFloat((supplyZone.top + 10.0).toFixed(1));
        const opposingLows = [...struct1h.swings, ...struct15m.swings]
          .filter((s: any) => s.type === 'LOW' && s.price < entryPrice)
          .sort((a: any, b: any) => b.price - a.price);
        const targetLow = opposingLows[0];
        if (targetLow) {
          const takeProfitPrice = targetLow.price;
          const rr = RiskCalculator.calculate({
            direction: 'SHORT',
            entryPrice,
            stopLossPrice,
            takeProfitPrice,
            spread,
            minRequiredRR: 4.0,
          });
          return {
            id: `strat_a_short_${lastCandle5m.timestamp}`,
            strategy: 'STRATEGY_A_TREND_CONTINUATION',
            symbol: 'BTCUSDT',
            direction: 'SHORT',
            timeframe: '5m',
            timestamp: lastCandle5m.timestamp,
            entryPrice,
            stopLossPrice,
            takeProfitPrice,
            riskReward: rr,
            status: rr.netRR >= 4.0 ? 'QUALIFIED' : 'PENDING_CONFIRMATION',
            evidence: {
              macroTrend: `4H: ${struct4h.trend}, 1H: ${struct1h.trend}`,
              triggerReason: `Bearish break on 5m (${recentBearBreak.type}) at supply zone`,
              invalidationReason: `Close above supply top $${supplyZone.top}`,
              confluencePoints: ['Higher TF trend', '15m Supply Zone Mitigated', '5m Structure Break'],
              structuralTarget: `Target low $${targetLow.price}`,
            },
          };
        }
      }
    }
  }

  return null;
}

function evaluateStrategyBWithStruct(
  candles1h: Candle[], candles15m: Candle[], candles5m: Candle[],
  struct1h: any, struct15m: any, struct5m: any, spread = 0.1
): SetupCandidate | null {
  if (candles1h.length < 20 || candles15m.length < 20 || candles5m.length < 20) return null;
  const lastCandle5m = candles5m[candles5m.length - 1];
  const currentPrice = lastCandle5m.close;

  const recentBullSweep = [...struct15m.sweeps, ...struct1h.sweeps]
    .filter((s: any) => s.direction === 'BULLISH' && s.candleTimestamp >= lastCandle5m.timestamp - 3 * 3600 * 1000)
    .pop();

  if (recentBullSweep) {
    const bullChoch = [...struct5m.structureBreaks].reverse().find(
      (b: any) => b.type === 'CHoCH' && b.direction === 'BULLISH' && b.candleIndex >= candles5m.length - 6
    );
    if (bullChoch) {
      const entryPrice = currentPrice;
      const stopLossPrice = parseFloat((recentBullSweep.wickExtreme - 10.0).toFixed(1));
      const opposingHighs = [...struct1h.swings, ...struct15m.swings]
        .filter((s: any) => s.type === 'HIGH' && s.price > entryPrice)
        .sort((a: any, b: any) => a.price - b.price);
      const targetHigh = opposingHighs[0];
      if (targetHigh) {
        const takeProfitPrice = targetHigh.price;
        const rr = RiskCalculator.calculate({
          direction: 'LONG',
          entryPrice,
          stopLossPrice,
          takeProfitPrice,
          spread,
          minRequiredRR: 4.0,
        });
        return {
          id: `strat_b_long_${lastCandle5m.timestamp}`,
          strategy: 'STRATEGY_B_LIQUIDITY_SWEEP_REVERSAL',
          symbol: 'BTCUSDT',
          direction: 'LONG',
          timeframe: '5m',
          timestamp: lastCandle5m.timestamp,
          entryPrice,
          stopLossPrice,
          takeProfitPrice,
          riskReward: rr,
          status: rr.netRR >= 4.0 ? 'QUALIFIED' : 'PENDING_CONFIRMATION',
          evidence: {
            macroTrend: `1H: ${struct1h.trend}`,
            triggerReason: `Bullish sweep of $${recentBullSweep.sweptLevel} + 5m CHoCH`,
            invalidationReason: `Close below sweep low $${recentBullSweep.wickExtreme}`,
            confluencePoints: ['Liquidity Sweep', '5m CHoCH', 'Opposing Liquidity Pool target'],
            structuralTarget: `Target high $${targetHigh.price}`,
          },
        };
      }
    }
  }

  const recentBearSweep = [...struct15m.sweeps, ...struct1h.sweeps]
    .filter((s: any) => s.direction === 'BEARISH' && s.candleTimestamp >= lastCandle5m.timestamp - 3 * 3600 * 1000)
    .pop();

  if (recentBearSweep) {
    const bearChoch = [...struct5m.structureBreaks].reverse().find(
      (b: any) => b.type === 'CHoCH' && b.direction === 'BEARISH' && b.candleIndex >= candles5m.length - 6
    );
    if (bearChoch) {
      const entryPrice = currentPrice;
      const stopLossPrice = parseFloat((recentBearSweep.wickExtreme + 10.0).toFixed(1));
      const opposingLows = [...struct1h.swings, ...struct15m.swings]
        .filter((s: any) => s.type === 'LOW' && s.price < entryPrice)
        .sort((a: any, b: any) => b.price - a.price);
      const targetLow = opposingLows[0];
      if (targetLow) {
        const takeProfitPrice = targetLow.price;
        const rr = RiskCalculator.calculate({
          direction: 'SHORT',
          entryPrice,
          stopLossPrice,
          takeProfitPrice,
          spread,
          minRequiredRR: 4.0,
        });
        return {
          id: `strat_b_short_${lastCandle5m.timestamp}`,
          strategy: 'STRATEGY_B_LIQUIDITY_SWEEP_REVERSAL',
          symbol: 'BTCUSDT',
          direction: 'SHORT',
          timeframe: '5m',
          timestamp: lastCandle5m.timestamp,
          entryPrice,
          stopLossPrice,
          takeProfitPrice,
          riskReward: rr,
          status: rr.netRR >= 4.0 ? 'QUALIFIED' : 'PENDING_CONFIRMATION',
          evidence: {
            macroTrend: `1H: ${struct1h.trend}`,
            triggerReason: `Bearish sweep of $${recentBearSweep.sweptLevel} + 5m CHoCH`,
            invalidationReason: `Close above sweep high $${recentBearSweep.wickExtreme}`,
            confluencePoints: ['Liquidity Sweep', '5m CHoCH', 'Opposing Liquidity Pool target'],
            structuralTarget: `Target low $${targetLow.price}`,
          },
        };
      }
    }
  }

  return null;
}

// ==========================================
// SmcDetectorV3 (as it was in PR #3 / master)
// ==========================================
class SmcDetectorV3 {
  public static detectSwings(candles: Candle[], leftBars = 3, rightBars = 3): any[] {
    const swings: any[] = [];
    if (candles.length < leftBars + rightBars + 1) return swings;

    for (let i = leftBars; i < candles.length - rightBars; i++) {
      const current = candles[i];
      let isHigh = true;
      let isLow = true;

      for (let j = i - leftBars; j < i; j++) {
        if (candles[j].high >= current.high) isHigh = false;
        if (candles[j].low <= current.low) isLow = false;
      }
      for (let j = i + 1; j <= i + rightBars; j++) {
        if (candles[j].high > current.high) isHigh = false;
        if (candles[j].low < current.low) isLow = false;
      }

      const confirmedIdx = i + rightBars;
      const confirmedTime = candles[confirmedIdx].timestamp; // NOTE: Open timestamp in V3

      if (isHigh) {
        swings.push({
          index: i,
          timestamp: current.timestamp,
          price: current.high,
          type: 'HIGH',
          confirmedAtIndex: confirmedIdx,
          confirmedAtTimestamp: confirmedTime,
          patternOriginTimestamp: current.timestamp,
          operationalAvailableTimestamp: confirmedTime,
        });
      }
      if (isLow) {
        swings.push({
          index: i,
          timestamp: current.timestamp,
          price: current.low,
          type: 'LOW',
          confirmedAtIndex: confirmedIdx,
          confirmedAtTimestamp: confirmedTime,
          patternOriginTimestamp: current.timestamp,
          operationalAvailableTimestamp: confirmedTime,
        });
      }
    }
    swings.sort((a, b) => a.timestamp - b.timestamp);
    this.labelSwings(swings);
    return swings;
  }

  private static labelSwings(swings: any[]): void {
    let lastHigh: any = null;
    let lastLow: any = null;
    for (const s of swings) {
      if (s.type === 'HIGH') {
        if (!lastHigh) {
          s.label = 'HH'; // NOTE: Fabricates HH on first swing
        } else {
          const diffPcnt = Math.abs(s.price - lastHigh.price) / lastHigh.price;
          if (diffPcnt <= 0.0015) s.label = 'EQH';
          else if (s.price > lastHigh.price) s.label = 'HH';
          else s.label = 'LH';
        }
        lastHigh = s;
      } else {
        if (!lastLow) {
          s.label = 'HL'; // NOTE: Fabricates HL on first swing
        } else {
          const diffPcnt = Math.abs(s.price - lastLow.price) / lastLow.price;
          if (diffPcnt <= 0.0015) s.label = 'EQL';
          else if (s.price > lastLow.price) s.label = 'HL';
          else s.label = 'LL';
        }
        lastLow = s;
      }
    }
  }

  public static detectFVGs(candles: Candle[], timeframe: Timeframe): any[] {
    const fvgs: any[] = [];
    if (candles.length < 3) return fvgs;
    for (let i = 0; i < candles.length - 2; i++) {
      const c1 = candles[i];
      const c2 = candles[i + 1];
      const c3 = candles[i + 2];
      let type: 'BULLISH' | 'BEARISH' | null = null;
      let top = 0;
      let bottom = 0;

      // NOTE: No body/range ratio, no minimum bps/ATR filter
      if (c3.low > c1.high) {
        type = 'BULLISH';
        top = c3.low;
        bottom = c1.high;
      } else if (c1.low > c3.high) {
        type = 'BEARISH';
        top = c1.low;
        bottom = c3.high;
      }
      if (!type) continue;

      const fvg = {
        id: `fvg_${type === 'BULLISH' ? 'bull' : 'bear'}_${timeframe}_${c2.timestamp}`,
        type,
        timeframe,
        top,
        bottom,
        size: parseFloat((top - bottom).toFixed(2)),
        timestamp: c2.timestamp,
        candleIndex: i + 1,
        status: 'ACTIVE',
        mitigatedAt: undefined as number | undefined,
        patternOriginTimestamp: c2.timestamp,
        confirmedAtTimestamp: c3.timestamp,
        operationalAvailableTimestamp: c3.timestamp,
      };

      for (let k = i + 3; k < candles.length; k++) {
        const next = candles[k];
        if (type === 'BULLISH') {
          if (next.low <= fvg.bottom) {
            fvg.status = 'INVALIDATED';
            fvg.mitigatedAt = next.timestamp;
            break;
          } else if (next.low < fvg.top) {
            fvg.status = 'MITIGATED';
            fvg.mitigatedAt = next.timestamp;
          }
        } else {
          if (next.high >= fvg.top) {
            fvg.status = 'INVALIDATED';
            fvg.mitigatedAt = next.timestamp;
            break;
          } else if (next.high > fvg.bottom) {
            fvg.status = 'MITIGATED';
            fvg.mitigatedAt = next.timestamp;
          }
        }
      }
      fvgs.push(fvg);
    }
    return fvgs;
  }

  public static analyzeStructure(candles: Candle[], timeframe: Timeframe): any {
    const swings = this.detectSwings(candles, 3, 3);
    const fvgs = this.detectFVGs(candles, timeframe);
    const structureBreaks: any[] = [];
    const sweeps: any[] = [];
    let currentTrend: 'BULLISH' | 'BEARISH' | 'RANGING' = 'RANGING';

    const highs = swings.filter((s) => s.type === 'HIGH');
    const lows = swings.filter((s) => s.type === 'LOW');

    // NOTE: LOOK-AHEAD BIAS - uses the LAST two highs and lows of the entire series
    if (highs.length >= 2 && lows.length >= 2) {
      const h1 = highs[highs.length - 2];
      const h2 = highs[highs.length - 1];
      const l1 = lows[lows.length - 2];
      const l2 = lows[lows.length - 1];
      if (h2.price > h1.price && l2.price >= l1.price) currentTrend = 'BULLISH';
      else if (h2.price <= h1.price && l2.price < l1.price) currentTrend = 'BEARISH';
    }

    // NOTE: Loops over each swing, so a candle breaking multiple swings generates MULTIPLE breaks!
    for (const swing of swings) {
      for (let i = swing.confirmedAtIndex; i < candles.length; i++) {
        const c = candles[i];
        if (swing.type === 'HIGH') {
          if (c.close > swing.price) {
            const isChoch = currentTrend === 'BEARISH' && swing.label === 'LH';
            structureBreaks.push({
              type: isChoch ? 'CHoCH' : 'BOS',
              direction: 'BULLISH',
              brokenLevel: swing.price,
              brokenSwing: swing,
              candleTimestamp: c.timestamp,
              closePrice: c.close,
              candleIndex: i,
              patternOriginTimestamp: swing.timestamp,
              confirmedAtTimestamp: c.timestamp,
              operationalAvailableTimestamp: c.timestamp,
            });
            break;
          } else if (c.high > swing.price && c.close <= swing.price) {
            const wick = c.high - Math.max(c.open, c.close);
            const range = c.high - c.low;
            if (range > 0 && wick / range >= 0.25) {
              sweeps.push({
                direction: 'BEARISH',
                sweptLevel: swing.price,
                wickExtreme: c.high,
                closePrice: c.close,
                candleTimestamp: c.timestamp,
                candleIndex: i,
                poolType: swing.label === 'EQH' ? 'EQH' : 'SWING_HIGH',
                patternOriginTimestamp: swing.timestamp,
                confirmedAtTimestamp: c.timestamp,
                operationalAvailableTimestamp: c.timestamp,
              });
            }
          }
        } else if (swing.type === 'LOW') {
          if (c.close < swing.price) {
            const isChoch = currentTrend === 'BULLISH' && swing.label === 'HL';
            structureBreaks.push({
              type: isChoch ? 'CHoCH' : 'BOS',
              direction: 'BEARISH',
              brokenLevel: swing.price,
              brokenSwing: swing,
              candleTimestamp: c.timestamp,
              closePrice: c.close,
              candleIndex: i,
              patternOriginTimestamp: swing.timestamp,
              confirmedAtTimestamp: c.timestamp,
              operationalAvailableTimestamp: c.timestamp,
            });
            break;
          } else if (c.low < swing.price && c.close >= swing.price) {
            const wick = Math.min(c.open, c.close) - c.low;
            const range = c.high - c.low;
            if (range > 0 && wick / range >= 0.25) {
              sweeps.push({
                direction: 'BULLISH',
                sweptLevel: swing.price,
                wickExtreme: c.low,
                closePrice: c.close,
                candleTimestamp: c.timestamp,
                candleIndex: i,
                poolType: swing.label === 'EQL' ? 'EQL' : 'SWING_LOW',
                patternOriginTimestamp: swing.timestamp,
                confirmedAtTimestamp: c.timestamp,
                operationalAvailableTimestamp: c.timestamp,
              });
            }
          }
        }
      }
    }

    return {
      trend: currentTrend,
      swings,
      lastSwingHigh: highs.length > 0 ? highs[highs.length - 1] : null,
      lastSwingLow: lows.length > 0 ? lows[lows.length - 1] : null,
      structureBreaks,
      fvgs,
      orderBlocks: [],
      sweeps,
    };
  }
}

// ==========================================
// Data Fetching and Comparison Runner
// ==========================================
const BYBIT_INTERVAL_MAP: Record<Timeframe, string> = {
  '1m': '1',
  '5m': '5',
  '15m': '15',
  '1h': '60',
  '4h': '240',
  '1d': 'D',
};

async function fetchBybitKlines(timeframe: Timeframe, count = 200): Promise<Candle[]> {
  const interval = BYBIT_INTERVAL_MAP[timeframe];
  const url = `https://api.bybit.com/v5/market/kline?category=linear&symbol=BTCUSDT&interval=${interval}&limit=${count}`;
  const resp = await fetch(url);
  const data = (await resp.json()) as any;
  if (data.retCode !== 0 || !data.result || !Array.isArray(data.result.list)) {
    throw new Error(`Bybit error: ${data.retMsg || 'unknown'}`);
  }
  // Bybit returns list newest to oldest. Reverse to get ascending chronological order.
  const rawList = [...data.result.list].reverse();
  const candles: Candle[] = rawList.map((row: any) => ({
    symbol: 'BTCUSDT',
    timeframe,
    timestamp: parseInt(row[0], 10),
    open: parseFloat(row[1]),
    high: parseFloat(row[2]),
    low: parseFloat(row[3]),
    close: parseFloat(row[4]),
    volume: parseFloat(row[5]),
    turnover: parseFloat(row[6]),
    confirmed: true,
  }));
  return candles;
}

export async function runComprehensiveValidation() {
  console.log('===============================================================');
  console.log('   NanoLabs AI Trading — Validación Cuantitativa SMC PR #4 vs PR #3');
  console.log('===============================================================\n');

  const timeframes: Timeframe[] = ['1m', '5m', '15m', '1h', '4h', '1d'];
  const dataset: Record<Timeframe, Candle[]> = {} as any;

  console.log('1. Descargando velas históricas reales de Bybit V5 Linear (BTCUSDT)...');
  for (const tf of timeframes) {
    const count = tf === '1d' ? 100 : 200;
    const candles = await fetchBybitKlines(tf, count);
    dataset[tf] = candles;
    const firstDate = new Date(candles[0].timestamp).toISOString();
    const lastDate = new Date(candles[candles.length - 1].timestamp).toISOString();
    const minPrice = Math.min(...candles.map((c) => c.low));
    const maxPrice = Math.max(...candles.map((c) => c.high));
    console.log(`   [${tf.padEnd(3)}] ${candles.length} velas | ${firstDate} -> ${lastDate} | Rango: $${minPrice.toFixed(1)} - $${maxPrice.toFixed(1)}`);
  }

  // Cache dataset to scratch directory for auditability
  const cacheDir = path.resolve('scratch');
  if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(path.join(cacheDir, 'bybit_validation_candles.json'), JSON.stringify(dataset, null, 2));
  console.log(`\nDatos reales guardados para auditoría en: scratch/bybit_validation_candles.json\n`);

  console.log('2. Ejecución comparativa del Motor PR #3 vs PR #4 sobre exactamente las mismas velas:');

  const metricsV3 = {
    swings: 0,
    swingsHH: 0,
    swingsHL: 0,
    swingsLH: 0,
    swingsLL: 0,
    swingsEQ: 0,
    bosBull: 0,
    bosBear: 0,
    chochBull: 0,
    chochBear: 0,
    fvgTotal: 0,
    fvgMitigated: 0,
    fvgInvalidated: 0,
    duplicateBreaks: 0,
    futureInfoSignals: 0,
    setupsEvaluated: 0,
    setupsQualified: 0,
    setupsNetRR4: 0,
    signalsDiscarded: 0,
  };

  const metricsV4 = {
    swings: 0,
    swingsHH: 0,
    swingsHL: 0,
    swingsLH: 0,
    swingsLL: 0,
    swingsEQ: 0,
    bosBull: 0,
    bosBear: 0,
    chochBull: 0,
    chochBear: 0,
    fvgTotal: 0,
    fvgMitigated: 0,
    fvgInvalidated: 0,
    duplicateBreaks: 0,
    futureInfoSignals: 0,
    setupsEvaluated: 0,
    setupsQualified: 0,
    setupsNetRR4: 0,
    signalsDiscarded: 0,
  };

  // Analyze structure on each timeframe
  for (const tf of timeframes) {
    const candles = dataset[tf];
    const resV3 = SmcDetectorV3.analyzeStructure(candles, tf);
    const resV4 = SmcDetectorV4.analyzeStructure(candles, tf);

    // Swings
    metricsV3.swings += resV3.swings.length;
    resV3.swings.forEach((s: any) => {
      if (s.label === 'HH') metricsV3.swingsHH++;
      else if (s.label === 'HL') metricsV3.swingsHL++;
      else if (s.label === 'LH') metricsV3.swingsLH++;
      else if (s.label === 'LL') metricsV3.swingsLL++;
      else if (s.label === 'EQH' || s.label === 'EQL') metricsV3.swingsEQ++;
    });

    metricsV4.swings += resV4.swings.length;
    resV4.swings.forEach((s: any) => {
      if (s.label === 'HH') metricsV4.swingsHH++;
      else if (s.label === 'HL') metricsV4.swingsHL++;
      else if (s.label === 'LH') metricsV4.swingsLH++;
      else if (s.label === 'LL') metricsV4.swingsLL++;
      else if (s.label === 'EQH' || s.label === 'EQL') metricsV4.swingsEQ++;
    });

    // Structure breaks
    resV3.structureBreaks.forEach((b: any) => {
      if (b.type === 'BOS') {
        if (b.direction === 'BULLISH') metricsV3.bosBull++;
        else metricsV3.bosBear++;
      } else {
        if (b.direction === 'BULLISH') metricsV3.chochBull++;
        else metricsV3.chochBear++;
      }
    });

    resV4.structureBreaks.forEach((b: any) => {
      if (b.type === 'BOS') {
        if (b.direction === 'BULLISH') metricsV4.bosBull++;
        else metricsV4.bosBear++;
      } else {
        if (b.direction === 'BULLISH') metricsV4.chochBull++;
        else metricsV4.chochBear++;
      }
    });

    // Check duplicate breaks per candle (multiple breaks on exact same candle index)
    const candleBreakCountsV3: Record<number, number> = {};
    resV3.structureBreaks.forEach((b: any) => {
      candleBreakCountsV3[b.candleIndex] = (candleBreakCountsV3[b.candleIndex] || 0) + 1;
    });
    Object.values(candleBreakCountsV3).forEach((cnt) => {
      if (cnt > 1) metricsV3.duplicateBreaks += cnt - 1;
    });

    const candleBreakCountsV4: Record<number, number> = {};
    resV4.structureBreaks.forEach((b: any) => {
      candleBreakCountsV4[b.candleIndex] = (candleBreakCountsV4[b.candleIndex] || 0) + 1;
    });
    Object.values(candleBreakCountsV4).forEach((cnt) => {
      if (cnt > 1) metricsV4.duplicateBreaks += cnt - 1;
    });

    // FVGs
    metricsV3.fvgTotal += resV3.fvgs.length;
    metricsV3.fvgMitigated += resV3.fvgs.filter((f: any) => f.status === 'MITIGATED').length;
    metricsV3.fvgInvalidated += resV3.fvgs.filter((f: any) => f.status === 'INVALIDATED').length;

    metricsV4.fvgTotal += resV4.fvgs.length;
    metricsV4.fvgMitigated += resV4.fvgs.filter((f: any) => f.status === 'MITIGATED').length;
    metricsV4.fvgInvalidated += resV4.fvgs.filter((f: any) => f.status === 'INVALIDATED').length;

    // Future info / retrospective look-ahead check
    // In V3, confirmedAtTimestamp was candle start time (before close) AND trend used final series state
    resV3.structureBreaks.forEach((b: any) => {
      // In V3, operational timestamp is candle start time, not close time: look-ahead
      if (b.operationalAvailableTimestamp === b.candleTimestamp) {
        metricsV3.futureInfoSignals++;
      }
    });
    resV4.structureBreaks.forEach((b: any) => {
      // In V4, operational timestamp is close time: strictly causal
      if (b.operationalAvailableTimestamp < b.candleTimestamp + TIMEFRAME_DURATION_MS[tf]) {
        metricsV4.futureInfoSignals++;
      }
    });
  }

  // 3. Evaluate Strategy A and Strategy B in multi-timeframe mode
  // We simulate chronological step-by-step evaluation across the 15m/5m/1h/4h sequence


  const c4h = dataset['4h'];
  const c1h = dataset['1h'];
  const c15m = dataset['15m'];
  const c5m = dataset['5m'];

  // Replay across the last 50 15-minute periods
  for (let idx = 25; idx < c15m.length; idx++) {
    const cur15m = c15m[idx];
    const curTime = cur15m.timestamp + TIMEFRAME_DURATION_MS['15m'];
    const sub4h = c4h.filter((c) => c.timestamp + TIMEFRAME_DURATION_MS['4h'] <= curTime);
    const sub1h = c1h.filter((c) => c.timestamp + TIMEFRAME_DURATION_MS['1h'] <= curTime);
    const sub15m = c15m.slice(0, idx + 1);
    const sub5m = c5m.filter((c) => c.timestamp + TIMEFRAME_DURATION_MS['5m'] <= curTime);

    if (sub4h.length < 5 || sub1h.length < 5 || sub15m.length < 20 || sub5m.length < 10) continue;

    // V3 evaluation
    const s4hV3 = SmcDetectorV3.analyzeStructure(sub4h, '4h');
    const s1hV3 = SmcDetectorV3.analyzeStructure(sub1h, '1h');
    const s15mV3 = SmcDetectorV3.analyzeStructure(sub15m, '15m');
    const s5mV3 = SmcDetectorV3.analyzeStructure(sub5m, '5m');

    metricsV3.setupsEvaluated += 2;
    const aV3 = evaluateStrategyAWithStruct(sub4h, sub1h, sub15m, sub5m, s4hV3, s1hV3, s15mV3, s5mV3);
    const bV3 = evaluateStrategyBWithStruct(sub1h, sub15m, sub5m, s1hV3, s15mV3, s5mV3);
    for (const setup of [aV3, bV3]) {
      if (setup) {
        if (setup.status === 'QUALIFIED') metricsV3.setupsQualified++;
        if (setup.riskReward && setup.riskReward.netRR >= 4.0) metricsV3.setupsNetRR4++;
        else metricsV3.signalsDiscarded++;
      } else {
        metricsV3.signalsDiscarded++;
      }
    }

    // V4 evaluation
    const s4hV4 = SmcDetectorV4.analyzeStructure(sub4h, '4h');
    const s1hV4 = SmcDetectorV4.analyzeStructure(sub1h, '1h');
    const s15mV4 = SmcDetectorV4.analyzeStructure(sub15m, '15m');
    const s5mV4 = SmcDetectorV4.analyzeStructure(sub5m, '5m');

    metricsV4.setupsEvaluated += 2;
    const aV4 = evaluateStrategyAWithStruct(sub4h, sub1h, sub15m, sub5m, s4hV4, s1hV4, s15mV4, s5mV4);
    const bV4 = evaluateStrategyBWithStruct(sub1h, sub15m, sub5m, s1hV4, s15mV4, s5mV4);
    for (const setup of [aV4, bV4]) {
      if (setup) {
        if (setup.status === 'QUALIFIED') metricsV4.setupsQualified++;
        if (setup.riskReward && setup.riskReward.netRR >= 4.0) metricsV4.setupsNetRR4++;
        else metricsV4.signalsDiscarded++;
      } else {
        metricsV4.signalsDiscarded++;
      }
    }
  }

  console.log('\n===============================================================');
  console.log('   TABLA COMPARATIVA: MOTOR ANTERIOR (PR #3) VS MOTOR PR #4');
  console.log('===============================================================');
  console.log('| Métrica                               | Motor PR #3 (Anterior) | Motor PR #4 (Auditado) |');
  console.log('|---------------------------------------|------------------------|------------------------|');
  console.log(`| Swings detectados                     | ${String(metricsV3.swings).padEnd(22)} | ${String(metricsV4.swings).padEnd(22)} |`);
  console.log(`| - HH / HL (Alcistas)                  | ${String(`${metricsV3.swingsHH} / ${metricsV3.swingsHL}`).padEnd(22)} | ${String(`${metricsV4.swingsHH} / ${metricsV4.swingsHL}`).padEnd(22)} |`);
  console.log(`| - LH / LL (Bajistas)                  | ${String(`${metricsV3.swingsLH} / ${metricsV3.swingsLL}`).padEnd(22)} | ${String(`${metricsV4.swingsLH} / ${metricsV4.swingsLL}`).padEnd(22)} |`);
  console.log(`| - EQH / EQL (Iguales)                 | ${String(metricsV3.swingsEQ).padEnd(22)} | ${String(metricsV4.swingsEQ).padEnd(22)} |`);
  console.log(`| BOS detectados (Bull / Bear)          | ${String(`${metricsV3.bosBull} / ${metricsV3.bosBear}`).padEnd(22)} | ${String(`${metricsV4.bosBull} / ${metricsV4.bosBear}`).padEnd(22)} |`);
  console.log(`| CHoCH detectados (Bull / Bear)        | ${String(`${metricsV3.chochBull} / ${metricsV3.chochBear}`).padEnd(22)} | ${String(`${metricsV4.chochBull} / ${metricsV4.chochBear}`).padEnd(22)} |`);
  console.log(`| FVG detectados                        | ${String(metricsV3.fvgTotal).padEnd(22)} | ${String(metricsV4.fvgTotal).padEnd(22)} |`);
  console.log(`| FVG mitigados                         | ${String(metricsV3.fvgMitigated).padEnd(22)} | ${String(metricsV4.fvgMitigated).padEnd(22)} |`);
  console.log(`| FVG invalidados                       | ${String(metricsV3.fvgInvalidated).padEnd(22)} | ${String(metricsV4.fvgInvalidated).padEnd(22)} |`);
  console.log(`| Rupturas duplicadas (por vela)        | ${String(metricsV3.duplicateBreaks).padEnd(22)} | ${String(metricsV4.duplicateBreaks).padEnd(22)} |`);
  console.log(`| Señales con información futura        | ${String(metricsV3.futureInfoSignals).padEnd(22)} | ${String(metricsV4.futureInfoSignals).padEnd(22)} |`);
  console.log(`| Evaluaciones de Setups (Strategy A/B) | ${String(metricsV3.setupsEvaluated).padEnd(22)} | ${String(metricsV4.setupsEvaluated).padEnd(22)} |`);
  console.log(`| Setups calificados                    | ${String(metricsV3.setupsQualified).padEnd(22)} | ${String(metricsV4.setupsQualified).padEnd(22)} |`);
  console.log(`| Setups con R:R neto >= 4.0            | ${String(metricsV3.setupsNetRR4).padEnd(22)} | ${String(metricsV4.setupsNetRR4).padEnd(22)} |`);
  console.log(`| Señales descartadas / no calificadas  | ${String(metricsV3.signalsDiscarded).padEnd(22)} | ${String(metricsV4.signalsDiscarded).padEnd(22)} |`);
  console.log('===============================================================\n');

  // 4. Invariant Replay Verification on Real Data
  console.log('3. Verificación de invariancia causal cronológica (Prefix Replay sobre velas reales 15m):');
  const full15m = dataset['15m'];
  let invariantViolations = 0;
  // Test 10 consecutive prefix lengths
  for (let k = 30; k <= 50; k++) {
    const prefix = full15m.slice(0, k);
    const structPrefix = SmcDetectorV4.analyzeStructure(prefix, '15m');
    const structFull = SmcDetectorV4.analyzeStructure(full15m, '15m');

    // All breaks in structPrefix must match exactly in structFull for that slice
    for (const bPrefix of structPrefix.structureBreaks) {
      const match = structFull.structureBreaks.find(
        (b) => b.candleIndex === bPrefix.candleIndex && b.candleTimestamp === bPrefix.candleTimestamp
      );
      if (!match || match.type !== bPrefix.type || match.direction !== bPrefix.direction || match.brokenLevel !== bPrefix.brokenLevel) {
        console.error(`   [VIOLACIÓN INVARIANTE] En vela ${bPrefix.candleIndex}: prefix=${bPrefix.type} ${bPrefix.direction} @ ${bPrefix.brokenLevel}, full=${match ? `${match.type} ${match.direction} @ ${match.brokenLevel}` : 'NONE'}`);
        invariantViolations++;
      }
    }
  }

  if (invariantViolations === 0) {
    console.log('   [OK] Invariancia causal confirmada al 100%: ninguna vela futura alteró retrospectivamente ningún BOS ni CHoCH histórico.');
  } else {
    console.error(`   [FALLO] Se detectaron ${invariantViolations} violaciones de invariancia causal.`);
  }

  console.log('\n4. Verificación de timestamps operacionales y disponibilidad causal:');
  const sampleBreaks = SmcDetectorV4.analyzeStructure(dataset['15m'], '15m').structureBreaks.slice(0, 5);
  for (const b of sampleBreaks) {
    const candleStart = b.candleTimestamp;
    const candleClose = candleStart + TIMEFRAME_DURATION_MS['15m'];
    const isExact = b.operationalAvailableTimestamp === candleClose && b.confirmedAtTimestamp === candleClose;
    console.log(`   Break ${b.type} ${b.direction} @ $${b.brokenLevel} | Vela Inicio: ${new Date(candleStart).toISOString()} | Cierre/Operable: ${new Date(b.operationalAvailableTimestamp).toISOString()} [${isExact ? 'CONFIRMADO CAUSAL' : 'ERROR'}]`);
  }
}

runComprehensiveValidation().catch(console.error);
