import { BybitRestClient } from '../bybit/bybit-rest-client.js';
import { DatabaseService } from '../storage/database.js';
import { Candle, Timeframe, TIMEFRAME_TO_BYBIT } from '../types/market.js';
import { config } from '../config/index.js';

export interface DataStatusSummary {
  symbol: string;
  targetDays: number;
  timeframes: {
    [key in Timeframe]?: {
      count: number;
      earliest: number | null;
      latest: number | null;
      earliestDate: string | null;
      latestDate: string | null;
      isComplete: boolean;
      expectedCandles: number;
    };
  };
  totalCandles: number;
  lastImportTimestamp?: number;
}

export class HistoricalDataManager {
  private restClient: BybitRestClient;
  private db: DatabaseService;
  private symbol: string;

  constructor(restClient: BybitRestClient, db: DatabaseService, symbol: string = config.bybit.symbol) {
    this.restClient = restClient;
    this.db = db;
    this.symbol = symbol;
  }

  public async importTimeframe(
    timeframe: Timeframe,
    days: number = 90,
    onProgress?: (progress: { timeframe: Timeframe; fetched: number; target: number; pct: number }) => void
  ): Promise<number> {
    const now = Date.now();
    const startTarget = now - days * 24 * 60 * 60 * 1000;
    let currentEnd = now;
    let totalImported = 0;

    // Approximate candles needed
    const minutesPerCandle = this.getMinutesForTimeframe(timeframe);
    const expectedTotal = Math.ceil((days * 24 * 60) / minutesPerCandle);

    while (currentEnd > startTarget) {
      try {
        const candles = await this.restClient.getKlines(
          this.symbol,
          timeframe,
          1000,
          undefined,
          currentEnd
        );

        if (!candles || candles.length === 0) {
          break;
        }

        // Save candles to database
        const saved = this.db.saveHistoricalCandles(candles);
        totalImported += saved;

        // Oldest candle in this batch (since candles are sorted ascending, candles[0] is oldest)
        const oldestCandle = candles[0];
        if (!oldestCandle || oldestCandle.timestamp >= currentEnd) {
          break;
        }

        currentEnd = oldestCandle.timestamp - 1;

        if (onProgress) {
          const pct = Math.min(100, Math.round((totalImported / expectedTotal) * 100));
          onProgress({ timeframe, fetched: totalImported, target: expectedTotal, pct });
        }

        if (oldestCandle.timestamp <= startTarget) {
          break;
        }

        // Rate limit courtesy delay
        await new Promise((resolve) => setTimeout(resolve, 80));
      } catch (err: any) {
        console.warn(`[HistoricalData] Error fetching ${timeframe} candles: ${err.message}`);
        await new Promise((resolve) => setTimeout(resolve, 1000));
        break;
      }
    }

    return totalImported;
  }

  public async importAllTimeframes(
    days: number = 90,
    onProgress?: (msg: string, overallPct: number) => void
  ): Promise<DataStatusSummary> {
    const timeframes: Timeframe[] = ['1d', '4h', '1h', '15m', '5m', '1m'];
    const totalTfs = timeframes.length;

    for (let i = 0; i < totalTfs; i++) {
      const tf = timeframes[i];
      if (onProgress) {
        onProgress(`Descargando datos históricos ${tf} de Bybit V5...`, Math.round((i / totalTfs) * 100));
      }
      await this.importTimeframe(tf, days, (p) => {
        if (onProgress) {
          const stepPct = (i / totalTfs) * 100 + (p.pct / totalTfs);
          onProgress(`Descargando ${tf}: ${p.fetched}/${p.target} velas (${p.pct}%)`, Math.round(stepPct));
        }
      });
    }

    if (onProgress) {
      onProgress('Importación completada y verificada en base de datos', 100);
    }

    return this.getDataStatus(days);
  }

  public getDataStatus(targetDays: number = 90): DataStatusSummary {
    const timeframes: Timeframe[] = ['1d', '4h', '1h', '15m', '5m', '1m'];
    const result: DataStatusSummary = {
      symbol: this.symbol,
      targetDays,
      timeframes: {},
      totalCandles: 0,
    };

    for (const tf of timeframes) {
      const stats = this.db.getHistoricalCandleStats(this.symbol, tf);
      const minutesPerCandle = this.getMinutesForTimeframe(tf);
      const expectedCandles = Math.ceil((targetDays * 24 * 60) / minutesPerCandle);
      const isComplete = stats.count >= Math.floor(expectedCandles * 0.95);

      result.timeframes[tf] = {
        count: stats.count,
        earliest: stats.earliest,
        latest: stats.latest,
        earliestDate: stats.earliest ? new Date(stats.earliest).toISOString() : null,
        latestDate: stats.latest ? new Date(stats.latest).toISOString() : null,
        isComplete,
        expectedCandles,
      };

      result.totalCandles += stats.count;
    }

    return result;
  }

  public getCandles(timeframe: Timeframe, startTime?: number, endTime?: number, limit?: number): Candle[] {
    return this.db.getHistoricalCandles(this.symbol, timeframe, startTime, endTime, limit);
  }

  private getMinutesForTimeframe(tf: Timeframe): number {
    switch (tf) {
      case '1m': return 1;
      case '5m': return 5;
      case '15m': return 15;
      case '1h': return 60;
      case '4h': return 240;
      case '1d': return 1440;
      default: return 15;
    }
  }
}
