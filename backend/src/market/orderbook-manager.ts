import { EventEmitter } from 'events';
import { OrderBook, OrderBookLevel } from '../types/market.js';

export class OrderBookManager extends EventEmitter {
  private symbol: string;
  private bidsMap: Map<number, number> = new Map(); // price -> size
  private asksMap: Map<number, number> = new Map(); // price -> size
  private lastSeq: number = 0;
  private lastUpdateTimestamp: number = 0;

  constructor(symbol: string) {
    super();
    this.symbol = symbol;
  }

  public handleSnapshot(bids: [string, string][], asks: [string, string][], seq: number, ts: number): OrderBook {
    this.bidsMap.clear();
    this.asksMap.clear();
    this.lastSeq = seq;
    this.lastUpdateTimestamp = ts || Date.now();

    for (const [p, s] of bids) {
      const size = parseFloat(s);
      if (size > 0) this.bidsMap.set(parseFloat(p), size);
    }
    for (const [p, s] of asks) {
      const size = parseFloat(s);
      if (size > 0) this.asksMap.set(parseFloat(p), size);
    }

    const ob = this.buildOrderBook();
    this.emit('orderbook_updated', ob);
    return ob;
  }

  public handleDelta(bids: [string, string][], asks: [string, string][], seq: number, ts: number): OrderBook {
    this.lastSeq = seq;
    this.lastUpdateTimestamp = ts || Date.now();

    for (const [p, s] of bids) {
      const price = parseFloat(p);
      const size = parseFloat(s);
      if (size === 0) {
        this.bidsMap.delete(price);
      } else {
        this.bidsMap.set(price, size);
      }
    }

    for (const [p, s] of asks) {
      const price = parseFloat(p);
      const size = parseFloat(s);
      if (size === 0) {
        this.asksMap.delete(price);
      } else {
        this.asksMap.set(price, size);
      }
    }

    const ob = this.buildOrderBook();
    this.emit('orderbook_updated', ob);
    return ob;
  }

  public buildOrderBook(): OrderBook {
    // Sort bids descending (highest price first)
    const bids: OrderBookLevel[] = Array.from(this.bidsMap.entries())
      .sort((a, b) => b[0] - a[0])
      .slice(0, 50);

    // Sort asks ascending (lowest price first)
    const asks: OrderBookLevel[] = Array.from(this.asksMap.entries())
      .sort((a, b) => a[0] - b[0])
      .slice(0, 50);

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
      symbol: this.symbol,
      bids,
      asks,
      timestamp: this.lastUpdateTimestamp,
      seq: this.lastSeq,
      bestBid,
      bestAsk,
      spread,
      spreadPcnt,
      midPrice,
      imbalance,
    };
  }

  public getOrderBook(): OrderBook {
    return this.buildOrderBook();
  }
}
