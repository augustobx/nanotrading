import { Candle } from '../types/market.js';

export class TechnicalIndicators {
  /**
   * Relative Strength Index (RSI) using Wilder's smoothed average
   * @param closes array of closing prices in chronological order (oldest first)
   * @param period default 14
   */
  public static rsi(closes: number[], period: number = 14): number[] {
    const result: number[] = new Array(closes.length).fill(50);
    if (closes.length <= period) return result;

    let gains = 0;
    let losses = 0;

    // First period simple average
    for (let i = 1; i <= period; i++) {
      const change = closes[i] - closes[i - 1];
      if (change > 0) gains += change;
      else losses += Math.abs(change);
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;

    if (avgGain === 0 && avgLoss === 0) {
      result[period] = 50;
    } else if (avgLoss === 0) {
      result[period] = 100;
    } else {
      result[period] = parseFloat((100 - 100 / (1 + avgGain / avgLoss)).toFixed(2));
    }

    // Wilder's smoothing for subsequent values
    for (let i = period + 1; i < closes.length; i++) {
      const change = closes[i] - closes[i - 1];
      const gain = change > 0 ? change : 0;
      const loss = change < 0 ? Math.abs(change) : 0;

      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;

      if (avgGain === 0 && avgLoss === 0) {
        result[i] = 50;
      } else if (avgLoss === 0) {
        result[i] = 100;
      } else {
        const rs = avgGain / avgLoss;
        result[i] = parseFloat((100 - 100 / (1 + rs)).toFixed(2));
      }
    }

    return result;
  }

  /**
   * Average True Range (ATR)
   * @param candles array of candles in chronological order
   * @param period default 14
   */
  public static atr(candles: Candle[], period: number = 14): number[] {
    const result: number[] = new Array(candles.length).fill(0);
    if (candles.length < 2) return result;

    const trValues: number[] = [candles[0].high - candles[0].low];

    for (let i = 1; i < candles.length; i++) {
      const high = candles[i].high;
      const low = candles[i].low;
      const prevClose = candles[i - 1].close;

      const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
      trValues.push(tr);
    }

    if (trValues.length < period) return result;

    // First period simple average
    let initialSum = 0;
    for (let i = 0; i < period; i++) {
      initialSum += trValues[i];
    }
    let currentAtr = initialSum / period;
    result[period - 1] = parseFloat(currentAtr.toFixed(2));

    // Wilder's smoothed ATR
    for (let i = period; i < trValues.length; i++) {
      currentAtr = (currentAtr * (period - 1) + trValues[i]) / period;
      result[i] = parseFloat(currentAtr.toFixed(2));
    }

    return result;
  }

  /**
   * Exponential Moving Average (EMA)
   * @param data series of numbers (e.g. closes)
   * @param period EMA period (e.g. 20, 50, 200)
   */
  public static ema(data: number[], period: number): number[] {
    const result: number[] = new Array(data.length).fill(0);
    if (data.length < period) return result;

    const multiplier = 2 / (period + 1);

    // Initial SMA for first value
    let sum = 0;
    for (let i = 0; i < period; i++) {
      sum += data[i];
    }
    let prevEma = sum / period;
    result[period - 1] = parseFloat(prevEma.toFixed(2));

    for (let i = period; i < data.length; i++) {
      const currentEma = (data[i] - prevEma) * multiplier + prevEma;
      result[i] = parseFloat(currentEma.toFixed(2));
      prevEma = currentEma;
    }

    return result;
  }

  /**
   * Volume Weighted Average Price (VWAP)
   * Resets when day changes (UTC 00:00)
   */
  public static vwap(candles: Candle[]): number[] {
    const result: number[] = new Array(candles.length).fill(0);
    if (candles.length === 0) return result;

    let cumulativeTypicalVol = 0;
    let cumulativeVol = 0;
    let currentDay = -1;

    for (let i = 0; i < candles.length; i++) {
      const c = candles[i];
      const candleDay = new Date(c.timestamp).getUTCDate();

      if (candleDay !== currentDay) {
        // Reset at midnight UTC
        currentDay = candleDay;
        cumulativeTypicalVol = 0;
        cumulativeVol = 0;
      }

      const typicalPrice = (c.high + c.low + c.close) / 3;
      cumulativeTypicalVol += typicalPrice * c.volume;
      cumulativeVol += c.volume;

      result[i] = cumulativeVol > 0 ? parseFloat((cumulativeTypicalVol / cumulativeVol).toFixed(2)) : c.close;
    }

    return result;
  }

  /**
   * Relative Volume (RVOL)
   * Ratio of current candle volume vs average volume of previous N candles
   */
  public static relativeVolume(candles: Candle[], period: number = 20): number {
    if (candles.length < 2) return 1.0;
    const currentVol = candles[candles.length - 1].volume;

    const lookback = candles.slice(-period - 1, -1);
    if (lookback.length === 0) return 1.0;

    const sumVol = lookback.reduce((acc, c) => acc + c.volume, 0);
    const avgVol = sumVol / lookback.length;

    return avgVol > 0 ? parseFloat((currentVol / avgVol).toFixed(2)) : 1.0;
  }
}
