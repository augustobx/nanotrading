import { EventEmitter } from 'events';
import { OrderBook, OrderBookLevel } from '../types/market.js';

export class OrderBookManager extends EventEmitter {
  private symbol: string;
  private bidsMap: Map<number, number> = new Map(); // price -> size
  private asksMap: Map<number, number> = new Map(); // price -> size
  private lastSeq: number = 0;
  private lastUpdateId: number = 0;
  private isSynced: boolean = false;
  private lastUpdateTimestamp: number = 0;

  constructor(symbol: string) {
    super();
    this.symbol = symbol;
  }

  public handleSnapshot(
    bids: [string, string][],
    asks: [string, string][],
    seq: number,
    ts: number,
    updateId?: number
  ): OrderBook {
    this.bidsMap.clear();
    this.asksMap.clear();
    this.lastSeq = seq;
    this.lastUpdateId = updateId || 0;
    this.isSynced = true;
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
    this.emit('orderbook_snapshot', ob);
    this.emit('orderbook_updated', ob);
    return ob;
  }

  public handleDelta(
    bids: [string, string][],
    asks: [string, string][],
    seq: number,
    ts: number,
    updateId?: number
  ): OrderBook {
    // 1. If not yet initialized with snapshot, ignore deltas and signal desync
    if (!this.isSynced) {
      this.emit('desync_detected', { reason: 'DELTA_BEFORE_SNAPSHOT', seq, updateId });
      return this.buildOrderBook();
    }

    // 2. Bybit V5 Linear updateId sequence integrity check
    if (updateId !== undefined && updateId > 0 && this.lastUpdateId > 0) {
      // Old or duplicate message: drop silently
      if (updateId <= this.lastUpdateId) {
        return this.buildOrderBook();
      }

      // Detect sequence gap: updateId skipped more than expected
      // Note: Bybit V5 delta updateId increments continuously
      if (updateId > this.lastUpdateId + 100) {
        this.isSynced = false;
        this.emit('desync_detected', {
          reason: 'UPDATE_ID_GAP',
          expected: this.lastUpdateId + 1,
          received: updateId,
        });
        return this.buildOrderBook();
      }

      this.lastUpdateId = updateId;
    }

    // 3. Sequence protection: detect backward seq restart
    if (this.lastSeq > 0 && seq > 0 && seq < this.lastSeq) {
      this.emit('out_of_order_delta', { receivedSeq: seq, lastSeq: this.lastSeq });
      // If seq dropped drastically (e.g. Bybit server restart), mark desynced
      if (this.lastSeq - seq > 1000) {
        this.isSynced = false;
        this.emit('desync_detected', { reason: 'SEQ_RESET', receivedSeq: seq, lastSeq: this.lastSeq });
        return this.buildOrderBook();
      }
    }

    if (seq > 0) {
      this.lastSeq = seq;
    }
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

  public markDesynced(reason: string = 'CONNECTION_LOST'): void {
    const wasSynced = this.isSynced;
    this.isSynced = false;
    if (wasSynced) {
      this.emit('desync_detected', { reason });
    }
  }

  public isOrderBookSynced(): boolean {
    return this.isSynced;
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
      lastUpdateId: this.lastUpdateId,
      isSynced: this.isSynced,
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
