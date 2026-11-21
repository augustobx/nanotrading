import { Candle, Timeframe, TIMEFRAME_DURATION_MS } from '../types/market.js';

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
   * Bybit timestamps are candle START times. A structural observation is only
   * available when the confirming candle has CLOSED. This is also what a
   * chronological replay must use, especially across multiple timeframes.
   */
  private static closeTime(c: Candle): number {
    return c.timestamp + TIMEFRAME_DURATION_MS[c.timeframe];
  }

  /** Missing candles are not consecutive evidence; never bridge a feed gap. */
  private static consecutive(first: Candle, second: Candle): boolean {
    return second.timestamp - first.timestamp === TIMEFRAME_DURATION_MS[first.timeframe] &&
      first.timeframe === second.timeframe;
  }

  private static swingKey(s: SwingPoint): string {
    return s.type + ':' + s.index;
  }

  /** Filter unfinished, invalid, out-of-order and duplicate observations. */
  private static normalizeCandles(candles: Candle[], timeframe?: Timeframe): Candle[] {
    const closed = new Map<number, Candle>();
    for (const c of candles) {
      if (!c || c.confirmed !== true || (timeframe && c.timeframe !== timeframe)) continue;
      if (![c.timestamp, c.open, c.high, c.low, c.close, c.volume].every(Number.isFinite)) continue;
      if (c.timestamp < 0 || c.low <= 0 || c.volume < 0 ||
          c.low > Math.min(c.open, c.close) ||
          c.high < Math.max(c.open, c.close) || c.high < c.low) continue;
      closed.set(c.timestamp, c);
    }
    return [...closed.values()].sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Pivot i becomes known only on close of i+rightBars, never at its
   * historical origin. Initial highs/lows are unclassified (SH/SL), not
   * fabricated HH/HL.
   */
  public static detectSwings(candles: Candle[], leftBars: number = 3, rightBars: number = 3): SwingPoint[] {
    candles = this.normalizeCandles(candles);
    const swings: SwingPoint[] = [];
    if (!Number.isInteger(leftBars) || !Number.isInteger(rightBars) ||
        leftBars < 1 || rightBars < 1 || candles.length < leftBars + rightBars + 1) return swings;
    for (let i = leftBars; i < candles.length - rightBars; i++) {
      const current = candles[i];
      let contiguous = true;
      for (let j = i - leftBars; j < i + rightBars; j++) {
        if (!this.consecutive(candles[j], candles[j + 1])) {
          contiguous = false; break;
        }
      }
      if (!contiguous) continue;
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
      const confirmedTime = this.closeTime(candles[confirmedIdx]);
      if (isHigh) swings.push({
        index: i, timestamp: current.timestamp, price: current.high, type: 'HIGH',
        confirmedAtIndex: confirmedIdx, confirmedAtTimestamp: confirmedTime,
        patternOriginTimestamp: current.timestamp, operationalAvailableTimestamp: confirmedTime,
      });
      if (isLow) swings.push({
        index: i, timestamp: current.timestamp, price: current.low, type: 'LOW',
        confirmedAtIndex: confirmedIdx, confirmedAtTimestamp: confirmedTime,
        patternOriginTimestamp: current.timestamp, operationalAvailableTimestamp: confirmedTime,
      });
    }
    swings.sort((a, b) => a.confirmedAtIndex - b.confirmedAtIndex || a.index - b.index);
    this.labelSwings(swings);
    return swings;
  }

  private static labelSwings(swings: SwingPoint[]): void {
    let lastHigh: SwingPoint | null = null;
    let lastLow: SwingPoint | null = null;
    for (const s of swings) {
      if (s.type === 'HIGH') {
        if (lastHigh) {
          const diff = Math.abs(s.price - lastHigh.price) / lastHigh.price;
          s.label = diff <= 0.0015 ? 'EQH' : s.price > lastHigh.price ? 'HH' : 'LH';
        }
        lastHigh = s;
      } else {
        if (lastLow) {
          const diff = Math.abs(s.price - lastLow.price) / lastLow.price;
          s.label = diff <= 0.0015 ? 'EQL' : s.price > lastLow.price ? 'HL' : 'LL';
        }
        lastLow = s;
      }
    }
  }

  /**
   * Three CLOSED candles + impulsive middle candle + minimum trade-relevant gap.
   * A 3 USDT gap at 60,000 is a mathematical imbalance, NOT an actionable FVG.
   * Thresholds: at least 2 bps of price and, with sufficient history, 8% of
   * recent average candle range. They are technical heuristics, not proof of edge.
   */
  public static detectFVGs(candles: Candle[], timeframe: Timeframe): FairValueGap[] {
    candles = this.normalizeCandles(candles, timeframe);
    const fvgs: FairValueGap[] = [];
    if (candles.length < 3) return fvgs;
    for (let i = 0; i < candles.length - 2; i++) {
      const c1 = candles[i], c2 = candles[i + 1], c3 = candles[i + 2];
      if (!this.consecutive(c1, c2) || !this.consecutive(c2, c3)) continue;
      const body = Math.abs(c2.close - c2.open);
      const range = c2.high - c2.low;
      if (range <= 0 || body / range < 0.5) continue;
      const previous = candles.slice(Math.max(0, i - 13), i + 1);
      const meanRange = previous.reduce((total, c) => total + c.high - c.low, 0) / previous.length;
      const minGap = Math.max(c2.close * 0.0002, previous.length >= 10 ? meanRange * 0.08 : 0);
      let type: FairValueGap['type'];
      let top: number, bottom: number;
      if (c2.close > c2.open && c1.high < c3.low && c3.low - c1.high >= minGap) {
        type = 'BULLISH';
        top = c3.low;
        bottom = c1.high;
      } else if (c2.close < c2.open && c1.low > c3.high && c1.low - c3.high >= minGap) {
        type = 'BEARISH';
        top = c1.low;
        bottom = c3.high;
      } else {
        continue;
      }
      const fvg: FairValueGap = {
        id: 'fvg_' + (type === 'BULLISH' ? 'bull' : 'bear') + '_' + timeframe + '_' + c2.timestamp,
        type, timeframe, top, bottom, size: parseFloat((top - bottom).toFixed(2)),
        timestamp: c2.timestamp, candleIndex: i + 1, status: 'ACTIVE',
        patternOriginTimestamp: c2.timestamp,
        confirmedAtTimestamp: this.closeTime(c3),
        operationalAvailableTimestamp: this.closeTime(c3),
      };
      for (let k = i + 3; k < candles.length; k++) {
        const future = candles[k];
        if (!this.consecutive(candles[k - 1], future)) {
          // A missing interval might have filled the gap. A stale FVG cannot
          // be considered safely ACTIVE without reconstructing that period.
          fvg.status = 'INVALIDATED';
          fvg.mitigatedAt = this.closeTime(future);
          break;
        }
        if (type === 'BULLISH') {
          if (future.low <= fvg.bottom) {
            fvg.status = 'INVALIDATED'; fvg.mitigatedAt = this.closeTime(future); break;
          }
          if (future.low < fvg.top) {
            fvg.status = 'MITIGATED'; fvg.mitigatedAt = this.closeTime(future);
          }
        } else {
          if (future.high >= fvg.top) {
            fvg.status = 'INVALIDATED'; fvg.mitigatedAt = this.closeTime(future); break;
          }
          if (future.high > fvg.bottom) {
            fvg.status = 'MITIGATED'; fvg.mitigatedAt = this.closeTime(future);
          }
        }
      }
      fvgs.push(fvg);
    }
    return fvgs;
  }

  /**
   * Identifies Order Blocks with displacement.
   */
  public static detectOrderBlocks(candles: Candle[], timeframe: Timeframe): OrderBlock[] {
    candles = this.normalizeCandles(candles, timeframe);
    const obs: OrderBlock[] = [];
    if (candles.length < 5) return obs;

    for (let i = 1; i < candles.length - 2; i++) {
      const obCandle = candles[i];
      const nextCandle = candles[i + 1];
      if (!this.consecutive(obCandle, nextCandle)) continue;

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
            confirmedAtTimestamp: this.closeTime(nextCandle),
            operationalAvailableTimestamp: this.closeTime(nextCandle),
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
            confirmedAtTimestamp: this.closeTime(nextCandle),
            operationalAvailableTimestamp: this.closeTime(nextCandle),
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

  /** Infer swing trend strictly from pivots ALREADY confirmed at that point. */
  private static trendFromConfirmedSwings(swings: SwingPoint[]): MarketStructureResult['trend'] {
    const highs = swings.filter(s => s.type === 'HIGH');
    const lows = swings.filter(s => s.type === 'LOW');
    if (highs.length < 2 || lows.length < 2) return 'RANGING';
    const h1 = highs[highs.length - 2], h2 = highs[highs.length - 1];
    const l1 = lows[lows.length - 2], l2 = lows[lows.length - 1];
    if (h2.price > h1.price && l2.price >= l1.price) return 'BULLISH';
    if (h2.price <= h1.price && l2.price < l1.price) return 'BEARISH';
    return 'RANGING';
  }

  /**
   * Chronological event replay, never classify a historical break using the
   * final trend of the full series. Only previously confirmed pivots may break.
   * One dominant BOS/CHoCH per candle; all crossed levels are consumed so
   * several old swings cannot produce duplicates on future crossings.
   */
  public static analyzeStructure(candles: Candle[], timeframe: Timeframe): MarketStructureResult {
    candles = this.normalizeCandles(candles, timeframe);
    const swings = this.detectSwings(candles, 3, 3);
    const fvgs = this.detectFVGs(candles, timeframe);
    const orderBlocks = this.detectOrderBlocks(candles, timeframe);
    const structureBreaks: StructureBreak[] = [];
    const sweeps: LiquiditySweep[] = [];
    const brokenLevels = new Set<string>();
    const sweptLevels = new Set<string>();
    let trend: MarketStructureResult['trend'] = 'RANGING';

    for (let i = 1; i < candles.length; i++) {
      const c = candles[i], prev = candles[i - 1];
      if (!this.consecutive(prev, c)) continue;
      const available = swings.filter(s => s.confirmedAtIndex <= i &&
        s.operationalAvailableTimestamp <= this.closeTime(c));
      if (trend === 'RANGING') trend = this.trendFromConfirmedSwings(available);

      const bullish = available.filter(s => s.type === 'HIGH' && !brokenLevels.has(this.swingKey(s)) &&
        prev.close <= s.price && c.close > s.price);
      const bearish = available.filter(s => s.type === 'LOW' && !brokenLevels.has(this.swingKey(s)) &&
        prev.close >= s.price && c.close < s.price);

      // In a consistent OHLC sequence opposite closes cannot both occur across
      // ordered levels. Prefer the direction of the candle in a degenerate feed.
      const direction = bullish.length && bearish.length
        ? (c.close >= prev.close ? 'BULLISH' : 'BEARISH')
        : bullish.length ? 'BULLISH' : bearish.length ? 'BEARISH' : null;
      if (direction) {
        const candidates = direction === 'BULLISH' ? bullish : bearish;
        // Select strongest broken structure, not one marker per older swing.
        const brokenSwing = [...candidates].sort((a, b) =>
          direction === 'BULLISH' ? b.price - a.price : a.price - b.price)[0];
        candidates.forEach(s => brokenLevels.add(this.swingKey(s)));
        const type: StructureBreak['type'] =
          (trend !== 'RANGING' && trend !== direction) ? 'CHoCH' : 'BOS';
        structureBreaks.push({
          type, direction, brokenLevel: brokenSwing.price, brokenSwing,
          candleTimestamp: c.timestamp, closePrice: c.close, candleIndex: i,
          patternOriginTimestamp: brokenSwing.timestamp,
          confirmedAtTimestamp: this.closeTime(c),
          operationalAvailableTimestamp: this.closeTime(c),
        });
        trend = direction;
      }

      // Sweep only once per structural level, after its confirmation, and
      // only when the market rejected it by the close (not a BOS by wick).
      const highSweeps = available.filter(s => s.type === 'HIGH' &&
        !brokenLevels.has(this.swingKey(s)) && !sweptLevels.has(this.swingKey(s)) &&
        c.high > s.price && c.close <= s.price &&
        (c.high - Math.max(c.open, c.close)) / Math.max(0.000001, c.high - c.low) >= 0.25);
      const lowSweeps = available.filter(s => s.type === 'LOW' &&
        !brokenLevels.has(this.swingKey(s)) && !sweptLevels.has(this.swingKey(s)) &&
        c.low < s.price && c.close >= s.price &&
        (Math.min(c.open, c.close) - c.low) / Math.max(0.000001, c.high - c.low) >= 0.25);
      for (const [candidates, sweepDirection] of [
        [highSweeps, 'BEARISH'], [lowSweeps, 'BULLISH'],
      ] as const) {
        if (!candidates.length) continue;
        const s = [...candidates].sort((a, b) => b.confirmedAtIndex - a.confirmedAtIndex)[0];
        candidates.forEach(candidate => sweptLevels.add(this.swingKey(candidate)));
        sweeps.push({
          direction: sweepDirection, sweptLevel: s.price,
          wickExtreme: sweepDirection === 'BEARISH' ? c.high : c.low,
          closePrice: c.close, candleTimestamp: c.timestamp, candleIndex: i,
          poolType: s.label === 'EQH' ? 'EQH' : s.label === 'EQL' ? 'EQL' :
            s.type === 'HIGH' ? 'SWING_HIGH' : 'SWING_LOW',
          patternOriginTimestamp: s.timestamp,
          confirmedAtTimestamp: this.closeTime(c),
          operationalAvailableTimestamp: this.closeTime(c),
        });
      }
    }
    const highs = swings.filter(s => s.type === 'HIGH');
    const lows = swings.filter(s => s.type === 'LOW');
    return {
      trend, swings,
      lastSwingHigh: highs.length ? highs[highs.length - 1] : null,
      lastSwingLow: lows.length ? lows[lows.length - 1] : null,
      structureBreaks, fvgs, orderBlocks, sweeps,
    };
  }
}
