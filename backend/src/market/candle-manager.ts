import { EventEmitter } from 'events';
import { Candle, Timeframe, TIMEFRAME_DURATION_MS, SUPPORTED_TIMEFRAMES } from '../types/market.js';
import { DatabaseService } from '../storage/database.js';

export interface GapInfo {
  symbol: string;
  timeframe: Timeframe;
  expectedTimestamp: number;
  receivedTimestamp: number;
  missingCandlesEstimate: number;
}

export class CandleManager extends EventEmitter {
  private symbol: string;
  private db: DatabaseService;
  // Circular memory buffers: up to 500 candles per timeframe
  private candleBuffers: Map<Timeframe, Candle[]> = new Map();
  private currentCandles: Map<Timeframe, Candle | null> = new Map();
  private lastClosedCandles: Map<Timeframe, Candle | null> = new Map();
  private gapsCount: number = 0;
  private maxBufferSize: number = 500;

  constructor(symbol: string, db: DatabaseService) {
    super();
    this.symbol = symbol;
    this.db = db;

    for (const tf of SUPPORTED_TIMEFRAMES) {
      this.candleBuffers.set(tf, []);
      this.currentCandles.set(tf, null);
      this.lastClosedCandles.set(tf, null);
    }
  }

  public initFromDatabase(): void {
    for (const tf of SUPPORTED_TIMEFRAMES) {
      const historical = this.db.getCandles(this.symbol, tf, 0, Date.now(), this.maxBufferSize);
      if (historical.length > 0) {
        this.candleBuffers.set(tf, historical);
        const last = historical[historical.length - 1];
        if (last.confirmed) {
          this.lastClosedCandles.set(tf, last);
        } else {
          this.currentCandles.set(tf, last);
          if (historical.length > 1) {
            this.lastClosedCandles.set(tf, historical[historical.length - 2]);
          }
        }
      }
    }
  }

  public loadHistoricalCandles(timeframe: Timeframe, candles: Candle[]): void {
    if (!candles || candles.length === 0) return;

    const sorted = [...candles].sort((a, b) => a.timestamp - b.timestamp);
    const buffer = this.candleBuffers.get(timeframe) || [];

    // Merge without duplicates
    const candleMap = new Map<number, Candle>();
    for (const c of buffer) {
      candleMap.set(c.timestamp, c);
    }
    for (const c of sorted) {
      candleMap.set(c.timestamp, c);
    }

    const merged = Array.from(candleMap.values()).sort((a, b) => a.timestamp - b.timestamp);
    const trimmed = merged.slice(-this.maxBufferSize);
    this.candleBuffers.set(timeframe, trimmed);

    // Save batch to DB
    this.db.saveCandlesBatch(sorted);

    // Set latest closed candle
    const lastConfirmed = [...trimmed].reverse().find((c) => c.confirmed);
    if (lastConfirmed) {
      this.lastClosedCandles.set(timeframe, lastConfirmed);
    }
  }

  public processWsCandle(candle: Candle): void {
    const tf = candle.timeframe;
    const buffer = this.candleBuffers.get(tf) || [];
    const duration = TIMEFRAME_DURATION_MS[tf];

    // If candle is confirmed (closed)
    if (candle.confirmed) {
      const lastClosed = this.lastClosedCandles.get(tf);

      // Check gap
      if (lastClosed) {
        const expectedNextTimestamp = lastClosed.timestamp + duration;
        if (candle.timestamp > expectedNextTimestamp) {
          this.gapsCount++;
          const missing = Math.round((candle.timestamp - expectedNextTimestamp) / duration);
          const gapInfo: GapInfo = {
            symbol: this.symbol,
            timeframe: tf,
            expectedTimestamp: expectedNextTimestamp,
            receivedTimestamp: candle.timestamp,
            missingCandlesEstimate: missing,
          };
          this.emit('gap_detected', gapInfo);
        }
      }

      // Add to buffer
      const existingIdx = buffer.findIndex((c) => c.timestamp === candle.timestamp);
      if (existingIdx >= 0) {
        buffer[existingIdx] = candle;
      } else {
        buffer.push(candle);
        if (buffer.length > this.maxBufferSize) {
          buffer.shift();
        }
      }

      this.lastClosedCandles.set(tf, candle);
      this.currentCandles.set(tf, null); // current open candle closed
      this.db.saveCandle(candle);
      this.emit('candle_closed', candle);
    } else {
      // Candle is still open / ticking
      this.currentCandles.set(tf, candle);

      // Update or add in buffer
      const existingIdx = buffer.findIndex((c) => c.timestamp === candle.timestamp);
      if (existingIdx >= 0) {
        buffer[existingIdx] = candle;
      } else {
        buffer.push(candle);
        if (buffer.length > this.maxBufferSize) {
          buffer.shift();
        }
      }

      this.emit('candle_updated', candle);
    }
  }

  public getCandles(timeframe: Timeframe, count: number = 100): Candle[] {
    const buffer = this.candleBuffers.get(timeframe) || [];
    return buffer.slice(-count);
  }

  public getCurrentCandle(timeframe: Timeframe): Candle | null {
    return this.currentCandles.get(timeframe) || null;
  }

  public getLastClosedCandle(timeframe: Timeframe): Candle | null {
    return this.lastClosedCandles.get(timeframe) || null;
  }

  public getAllCurrentCandles(): Record<Timeframe, Candle | null> {
    const res: Partial<Record<Timeframe, Candle | null>> = {};
    for (const tf of SUPPORTED_TIMEFRAMES) {
      res[tf] = this.currentCandles.get(tf) || null;
    }
    return res as Record<Timeframe, Candle | null>;
  }

  public getAllLastClosedCandles(): Record<Timeframe, Candle | null> {
    const res: Partial<Record<Timeframe, Candle | null>> = {};
    for (const tf of SUPPORTED_TIMEFRAMES) {
      res[tf] = this.lastClosedCandles.get(tf) || null;
    }
    return res as Record<Timeframe, Candle | null>;
  }

  public getGapsCount(): number {
    return this.gapsCount;
  }
}
