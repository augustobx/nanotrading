import { Candle, Timeframe, TIMEFRAME_TO_BYBIT, Ticker, InstrumentInfo, OrderBook, OrderBookLevel } from '../types/market.js';
import { config } from '../config/index.js';

export interface BybitKlineResponse {
  retCode: number;
  retMsg: string;
  result: {
    symbol: string;
    category: string;
    list: [string, string, string, string, string, string, string][]; // [startTime, open, high, low, close, volume, turnover]
  };
  time: number;
}

export interface BybitTickerResponse {
  retCode: number;
  retMsg: string;
  result: {
    category: string;
    list: Array<{
      symbol: string;
      lastPrice: string;
      indexPrice: string;
      markPrice: string;
      prevPrice24h: string;
      price24hPcnt: string;
      highPrice24h: string;
      lowPrice24h: string;
      prevPrice1h: string;
      openInterest: string;
      openInterestValue: string;
      turnover24h: string;
      volume24h: string;
      fundingRate: string;
      nextFundingTime: string;
      bid1Price: string;
      bid1Size: string;
      ask1Price: string;
      ask1Size: string;
    }>;
  };
  time: number;
}

export class BybitRestClient {
  private baseUrl: string;
  private maxRetries: number;

  constructor(baseUrl?: string, maxRetries?: number) {
    this.baseUrl = baseUrl || config.bybit.restUrl;
    this.maxRetries = maxRetries ?? config.bybit.maxRestRetries;
  }

  private async fetchWithRetry<T>(endpoint: string, params: Record<string, string | number | undefined>): Promise<T> {
    const url = new URL(`${this.baseUrl}${endpoint}`);
    for (const [key, val] of Object.entries(params)) {
      if (val !== undefined) {
        url.searchParams.append(key, String(val));
      }
    }

    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const res = await fetch(url.toString(), {
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'NanoLabs-AI-Trading/1.0',
          },
        });

        if (res.status === 429) {
          const waitMs = attempt * 1500 + Math.random() * 500;
          await new Promise((r) => setTimeout(r, waitMs));
          continue;
        }

        if (!res.ok) {
          throw new Error(`Bybit HTTP error: ${res.status} ${res.statusText}`);
        }

        const data = (await res.json()) as any;
        if (data.retCode !== 0) {
          throw new Error(`Bybit API error code ${data.retCode}: ${data.retMsg}`);
        }

        return data as T;
      } catch (err: any) {
        lastError = err;
        if (attempt < this.maxRetries) {
          const backoff = attempt * 1000 + Math.random() * 300;
          await new Promise((r) => setTimeout(r, backoff));
        }
      }
    }

    throw lastError || new Error(`Failed to fetch from ${endpoint} after ${this.maxRetries} attempts`);
  }

  public async getKlines(
    symbol: string,
    timeframe: Timeframe,
    limit: number = 200,
    startTime?: number,
    endTime?: number
  ): Promise<Candle[]> {
    const interval = TIMEFRAME_TO_BYBIT[timeframe];
    const data = await this.fetchWithRetry<BybitKlineResponse>('/v5/market/kline', {
      category: config.bybit.category,
      symbol,
      interval,
      limit,
      start: startTime,
      end: endTime,
    });

    // Bybit returns list in reverse chronological order: newest first.
    // Parse and sort in ascending order (oldest first).
    const list = data.result?.list || [];
    const candles: Candle[] = list.map((item) => ({
      symbol,
      timeframe,
      timestamp: Number(item[0]),
      open: parseFloat(item[1]),
      high: parseFloat(item[2]),
      low: parseFloat(item[3]),
      close: parseFloat(item[4]),
      volume: parseFloat(item[5]),
      turnover: parseFloat(item[6]),
      confirmed: true, // historical klines returned from REST are confirmed
    }));

    candles.sort((a, b) => a.timestamp - b.timestamp);
    return candles;
  }

  public async getTicker(symbol: string = config.bybit.symbol): Promise<Ticker> {
    const data = await this.fetchWithRetry<BybitTickerResponse>('/v5/market/tickers', {
      category: config.bybit.category,
      symbol,
    });

    const item = data.result?.list?.[0];
    if (!item) {
      throw new Error(`No ticker returned for symbol ${symbol}`);
    }

    const lastPrice = parseFloat(item.lastPrice || '0');
    const markPrice = parseFloat(item.markPrice || '0');
    const indexPrice = parseFloat(item.indexPrice || '0');
    const bid1Price = parseFloat(item.bid1Price || '0');
    const ask1Price = parseFloat(item.ask1Price || '0');
    const spread = ask1Price > 0 && bid1Price > 0 ? parseFloat((ask1Price - bid1Price).toFixed(2)) : 0;
    const spreadPcnt = lastPrice > 0 ? (spread / lastPrice) * 100 : 0;

    return {
      symbol: item.symbol,
      lastPrice,
      markPrice,
      indexPrice,
      bid1Price,
      ask1Price,
      bid1Size: parseFloat(item.bid1Size || '0'),
      ask1Size: parseFloat(item.ask1Size || '0'),
      spread,
      spreadPcnt,
      highPrice24h: parseFloat(item.highPrice24h || '0'),
      lowPrice24h: parseFloat(item.lowPrice24h || '0'),
      prevPrice24h: parseFloat(item.prevPrice24h || '0'),
      price24hPcnt: parseFloat(item.price24hPcnt || '0'),
      volume24h: parseFloat(item.volume24h || '0'),
      turnover24h: parseFloat(item.turnover24h || '0'),
      fundingRate: parseFloat(item.fundingRate || '0'),
      nextFundingTime: parseInt(item.nextFundingTime || '0', 10),
      openInterest: parseFloat(item.openInterest || '0'),
      openInterestValue: parseFloat(item.openInterestValue || '0'),
      timestamp: data.time || Date.now(),
    };
  }

  public async getOrderBook(symbol: string = config.bybit.symbol, limit: number = 50): Promise<OrderBook> {
    const data = await this.fetchWithRetry<any>('/v5/market/orderbook', {
      category: config.bybit.category,
      symbol,
      limit,
    });

    const res = data.result;
    const bids: OrderBookLevel[] = (res.b || []).map((b: [string, string]) => [parseFloat(b[0]), parseFloat(b[1])]);
    const asks: OrderBookLevel[] = (res.a || []).map((a: [string, string]) => [parseFloat(a[0]), parseFloat(a[1])]);

    const bestBid = bids[0]?.[0] || 0;
    const bestAsk = asks[0]?.[0] || 0;
    const spread = bestAsk > 0 && bestBid > 0 ? parseFloat((bestAsk - bestBid).toFixed(2)) : 0;
    const midPrice = bestAsk > 0 && bestBid > 0 ? (bestAsk + bestBid) / 2 : 0;
    const spreadPcnt = midPrice > 0 ? (spread / midPrice) * 100 : 0;

    const topBidsVol = bids.slice(0, 10).reduce((acc, curr) => acc + curr[1], 0);
    const topAsksVol = asks.slice(0, 10).reduce((acc, curr) => acc + curr[1], 0);
    const totalVol = topBidsVol + topAsksVol;
    const imbalance = totalVol > 0 ? (topBidsVol - topAsksVol) / totalVol : 0;

    return {
      symbol,
      bids,
      asks,
      timestamp: res.ts || Date.now(),
      seq: res.seq || 0,
      bestBid,
      bestAsk,
      spread,
      spreadPcnt,
      midPrice,
      imbalance,
    };
  }

  public async getInstrumentsInfo(symbol: string = config.bybit.symbol): Promise<InstrumentInfo> {
    const data = await this.fetchWithRetry<any>('/v5/market/instruments-info', {
      category: config.bybit.category,
      symbol,
    });

    const item = data.result?.list?.[0];
    if (!item) {
      throw new Error(`Instrument info not found for ${symbol}`);
    }

    return {
      symbol: item.symbol,
      baseCoin: item.baseCoin,
      quoteCoin: item.quoteCoin,
      tickSize: parseFloat(item.priceFilter?.tickSize || '0.1'),
      qtyStep: parseFloat(item.lotSizeFilter?.qtyStep || '0.001'),
      minOrderQty: parseFloat(item.lotSizeFilter?.minOrderQty || '0.001'),
      maxOrderQty: parseFloat(item.lotSizeFilter?.maxOrderQty || '100'),
      maxLeverage: parseFloat(item.leverageFilter?.maxLeverage || '100'),
    };
  }

  public async getServerTime(): Promise<number> {
    const data = await this.fetchWithRetry<any>('/v5/market/time', {});
    return Number(data.timeSecond) * 1000 || Date.now();
  }
}
