import { Candle, Timeframe } from '../types/market.js';

export interface SwingPoint {
  index: number;
  timestamp: number;
  price: number;
  type: 'HIGH' | 'LOW';
  confirmedAtIndex: number;
  confirmedAtTimestamp: number;
  patternOriginTimestamp: number;
  operationalAvailableTimestamp: number;
  label?: 'HH' | 'LH' | 'HL' | 'LL' | 'EQH' | 'EQL';
}

export interface FairValueGap {
  id: string;
  type: 'BULLISH' | 'BEARISH';
  timeframe: Timeframe;
  top: number;
  bottom: number;
  size: number;
  timestamp: number; // Start candle timestamp
  candleIndex: number;
  status: 'ACTIVE' | 'MITIGATED' | 'INVALIDATED';
  mitigatedAt?: number;
  patternOriginTimestamp: number;
  confirmedAtTimestamp: number;
  operationalAvailableTimestamp: number;
}

export interface OrderBlock {
  id: string;
  type: 'BULLISH' | 'BEARISH';
  timeframe: Timeframe;
  top: number;
  bottom: number;
  timestamp: number;
  candleIndex: number;
  status: 'ACTIVE' | 'MITIGATED' | 'INVALIDATED';
  mitigatedAt?: number;
  patternOriginTimestamp: number;
  confirmedAtTimestamp: number;
  operationalAvailableTimestamp: number;
}

export interface StructureBreak {
  type: 'BOS' | 'CHoCH';
  direction: 'BULLISH' | 'BEARISH';
  brokenLevel: number;
  brokenSwing: SwingPoint;
  candleTimestamp: number;
  closePrice: number;
  candleIndex: number;
  patternOriginTimestamp: number;
  confirmedAtTimestamp: number;
  operationalAvailableTimestamp: number;
}

export interface LiquiditySweep {
  direction: 'BULLISH' | 'BEARISH';
  sweptLevel: number;
  wickExtreme: number;
  closePrice: number;
  candleTimestamp: number;
  candleIndex: number;
  poolType: 'EQH' | 'EQL' | 'SWING_HIGH' | 'SWING_LOW';
  patternOriginTimestamp: number;
  confirmedAtTimestamp: number;
  operationalAvailableTimestamp: number;
}

export interface MarketStructureResult {
  trend: 'BULLISH' | 'BEARISH' | 'RANGING';
  swings: SwingPoint[];
  lastSwingHigh: SwingPoint | null;
  lastSwingLow: SwingPoint | null;
  structureBreaks: StructureBreak[];
  fvgs: FairValueGap[];
  orderBlocks: OrderBlock[];
  sweeps: LiquiditySweep[];
}

export class SmcDetector {
  /**
   * Detects confirmed Swing Highs and Lows without look-ahead bias.
   * A pivot at index i is ONLY confirmed at index i + rightBars.
   */
  public static detectSwings(candles: Candle[], leftBars: number = 3, rightBars: number = 3): SwingPoint[] {
    const swings: SwingPoint[] = [];
    if (candles.length < leftBars + rightBars + 1) return swings;

    for (let i = leftBars; i < candles.length - rightBars; i++) {
      const current = candles[i];
      let isHigh = true;
      let isLow = true;

      // Check left bars
      for (let j = i - leftBars; j < i; j++) {
        if (candles[j].high >= current.high) isHigh = false;
        if (candles[j].low <= current.low) isLow = false;
      }

      // Check right bars (confirmed closed candles)
      for (let j = i + 1; j <= i + rightBars; j++) {
        if (candles[j].high > current.high) isHigh = false;
        if (candles[j].low < current.low) isLow = false;
      }

      const confirmedIdx = i + rightBars;
      const confirmedTime = candles[confirmedIdx].timestamp;

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

    // Sort by timestamp
    swings.sort((a, b) => a.timestamp - b.timestamp);

    // Label swings (HH, LH, HL, LL, EQH, EQL)
    this.labelSwings(swings);

    return swings;
  }

  private static labelSwings(swings: SwingPoint[]): void {
    let lastHigh: SwingPoint | null = null;
    let lastLow: SwingPoint | null = null;

    for (const s of swings) {
      if (s.type === 'HIGH') {
        if (!lastHigh) {
          s.label = 'HH';
        } else {
          const diffPcnt = Math.abs(s.price - lastHigh.price) / lastHigh.price;
          if (diffPcnt <= 0.0015) {
            // Equal Highs (within 0.15%)
            s.label = 'EQH';
          } else if (s.price > lastHigh.price) {
            s.label = 'HH';
          } else {
            s.label = 'LH';
          }
        }
        lastHigh = s;
      } else {
        if (!lastLow) {
          s.label = 'HL';
        } else {
          const diffPcnt = Math.abs(s.price - lastLow.price) / lastLow.price;
          if (diffPcnt <= 0.0015) {
            // Equal Lows (within 0.15%)
            s.label = 'EQL';
          } else if (s.price > lastLow.price) {
            s.label = 'HL';
          } else {
            s.label = 'LL';
          }
        }
        lastLow = s;
      }
    }
  }

  /**
   * Identifies Fair Value Gaps (FVG) and tracks mitigation state.
   */
  public static detectFVGs(candles: Candle[], timeframe: Timeframe): FairValueGap[] {
    const fvgs: FairValueGap[] = [];
    if (candles.length < 3) return fvgs;

    for (let i = 0; i < candles.length - 2; i++) {
      const c1 = candles[i];
      const c2 = candles[i + 1];
      const c3 = candles[i + 2];

      // Bullish FVG: Candle 1 High < Candle 3 Low
      if (c1.high < c3.low) {
        const gapSize = c3.low - c1.high;
        if (gapSize > 0) {
          const fvg: FairValueGap = {
            id: `fvg_bull_${timeframe}_${c2.timestamp}`,
            type: 'BULLISH',
            timeframe,
            top: c3.low,
            bottom: c1.high,
            size: parseFloat(gapSize.toFixed(2)),
            timestamp: c2.timestamp,
            candleIndex: i + 1,
            status: 'ACTIVE',
            patternOriginTimestamp: c2.timestamp,
            confirmedAtTimestamp: c3.timestamp,
            operationalAvailableTimestamp: c3.timestamp,
          };

          // Check mitigation on subsequent candles
          for (let k = i + 3; k < candles.length; k++) {
            if (candles[k].low <= fvg.bottom) {
              fvg.status = 'INVALIDATED';
              fvg.mitigatedAt = candles[k].timestamp;
              break;
            } else if (candles[k].low < fvg.top) {
              fvg.status = 'MITIGATED';
              fvg.mitigatedAt = candles[k].timestamp;
            }
          }

          fvgs.push(fvg);
        }
      }

      // Bearish FVG: Candle 1 Low > Candle 3 High
      if (c1.low > c3.high) {
        const gapSize = c1.low - c3.high;
        if (gapSize > 0) {
          const fvg: FairValueGap = {
            id: `fvg_bear_${timeframe}_${c2.timestamp}`,
            type: 'BEARISH',
            timeframe,
            top: c1.low,
            bottom: c3.high,
            size: parseFloat(gapSize.toFixed(2)),
            timestamp: c2.timestamp,
            candleIndex: i + 1,
            status: 'ACTIVE',
            patternOriginTimestamp: c2.timestamp,
            confirmedAtTimestamp: c3.timestamp,
            operationalAvailableTimestamp: c3.timestamp,
          };

          // Check mitigation on subsequent candles
          for (let k = i + 3; k < candles.length; k++) {
            if (candles[k].high >= fvg.top) {
              fvg.status = 'INVALIDATED';
              fvg.mitigatedAt = candles[k].timestamp;
              break;
            } else if (candles[k].high > fvg.bottom) {
              fvg.status = 'MITIGATED';
              fvg.mitigatedAt = candles[k].timestamp;
            }
          }

          fvgs.push(fvg);
        }
      }
    }

    return fvgs;
  }

  /**
   * Identifies Order Blocks with displacement.
   */
  public static detectOrderBlocks(candles: Candle[], timeframe: Timeframe): OrderBlock[] {
    const obs: OrderBlock[] = [];
    if (candles.length < 5) return obs;

    for (let i = 1; i < candles.length - 2; i++) {
      const obCandle = candles[i];
      const nextCandle = candles[i + 1];

      const bodySize = Math.abs(obCandle.close - obCandle.open);
      const nextBodySize = Math.abs(nextCandle.close - nextCandle.open);

      // Bullish OB: Bearish candle followed by strong bullish displacement
      if (obCandle.close < obCandle.open && nextCandle.close > nextCandle.open) {
        if (nextBodySize > bodySize * 1.5 && nextCandle.close > obCandle.high) {
          const ob: OrderBlock = {
            id: `ob_bull_${timeframe}_${obCandle.timestamp}`,
            type: 'BULLISH',
            timeframe,
            top: obCandle.high,
            bottom: obCandle.low,
            timestamp: obCandle.timestamp,
            candleIndex: i,
            status: 'ACTIVE',
            patternOriginTimestamp: obCandle.timestamp,
            confirmedAtTimestamp: nextCandle.timestamp,
            operationalAvailableTimestamp: nextCandle.timestamp,
          };

          for (let k = i + 2; k < candles.length; k++) {
            if (candles[k].close < ob.bottom) {
              ob.status = 'INVALIDATED';
              ob.mitigatedAt = candles[k].timestamp;
              break;
            } else if (candles[k].low <= ob.top) {
              ob.status = 'MITIGATED';
              ob.mitigatedAt = candles[k].timestamp;
            }
          }

          obs.push(ob);
        }
      }

      // Bearish OB: Bullish candle followed by strong bearish displacement
      if (obCandle.close > obCandle.open && nextCandle.close < nextCandle.open) {
        if (nextBodySize > bodySize * 1.5 && nextCandle.close < obCandle.low) {
          const ob: OrderBlock = {
            id: `ob_bear_${timeframe}_${obCandle.timestamp}`,
            type: 'BEARISH',
            timeframe,
            top: obCandle.high,
            bottom: obCandle.low,
            timestamp: obCandle.timestamp,
            candleIndex: i,
            status: 'ACTIVE',
            patternOriginTimestamp: obCandle.timestamp,
            confirmedAtTimestamp: nextCandle.timestamp,
            operationalAvailableTimestamp: nextCandle.timestamp,
          };

          for (let k = i + 2; k < candles.length; k++) {
            if (candles[k].close > ob.top) {
              ob.status = 'INVALIDATED';
              ob.mitigatedAt = candles[k].timestamp;
              break;
            } else if (candles[k].high >= ob.bottom) {
              ob.status = 'MITIGATED';
              ob.mitigatedAt = candles[k].timestamp;
            }
          }

          obs.push(ob);
        }
      }
    }

    return obs;
  }

  /**
   * Evaluates BOS, CHoCH, Liquidity Sweeps and overall structure.
   */
  public static analyzeStructure(candles: Candle[], timeframe: Timeframe): MarketStructureResult {
    const swings = this.detectSwings(candles, 3, 3);
    const fvgs = this.detectFVGs(candles, timeframe);
    const orderBlocks = this.detectOrderBlocks(candles, timeframe);

    const structureBreaks: StructureBreak[] = [];
    const sweeps: LiquiditySweep[] = [];

    let currentTrend: 'BULLISH' | 'BEARISH' | 'RANGING' = 'RANGING';

    const highs = swings.filter((s) => s.type === 'HIGH');
    const lows = swings.filter((s) => s.type === 'LOW');

    const lastHigh = highs.length > 0 ? highs[highs.length - 1] : null;
    const lastLow = lows.length > 0 ? lows[lows.length - 1] : null;

    if (highs.length >= 2 && lows.length >= 2) {
      const h1 = highs[highs.length - 2];
      const h2 = highs[highs.length - 1];
      const l1 = lows[lows.length - 2];
      const l2 = lows[lows.length - 1];

      if (h2.price > h1.price && l2.price >= l1.price) {
        currentTrend = 'BULLISH';
      } else if (h2.price <= h1.price && l2.price < l1.price) {
        currentTrend = 'BEARISH';
      }
    }

    // Detect BOS and CHoCH over closed candles
    for (const swing of swings) {
      // Find candles occurring AFTER the swing was confirmed
      for (let i = swing.confirmedAtIndex; i < candles.length; i++) {
        const c = candles[i];
        if (swing.type === 'HIGH') {
          // Candle closes above confirmed swing high
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
            break; // Stop testing this swing once broken
          } else if (c.high > swing.price && c.close <= swing.price) {
            // Liquidity Sweep Bearish: wick above, but close below
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
          // Candle closes below confirmed swing low
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
            // Liquidity Sweep Bullish: wick below, but close above
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
      lastSwingHigh: lastHigh,
      lastSwingLow: lastLow,
      structureBreaks,
      fvgs,
      orderBlocks,
      sweeps,
    };
  }
}
