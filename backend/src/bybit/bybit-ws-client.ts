import { EventEmitter } from 'events';
import { Candle, Timeframe, BYBIT_TO_TIMEFRAME, Ticker, OrderBook, OrderBookLevel, Trade, Liquidation } from '../types/market.js';
import { config } from '../config/index.js';

export class BybitWsClient extends EventEmitter {
  private wsUrl: string;
  private symbol: string;
  private ws: any = null; // native WebSocket
  private isAlive: boolean = false;
  private pingIntervalTimer: NodeJS.Timeout | null = null;
  private watchdogTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts: number = 0;
  private isExplicitlyClosed: boolean = false;
  private lastMessageTimestamp: number = 0;
  private latencyMs: number = 0;

  constructor(wsUrl?: string, symbol?: string) {
    super();
    this.wsUrl = wsUrl || config.bybit.wsUrl;
    this.symbol = symbol || config.bybit.symbol;
  }

  public connect(): void {
    this.isExplicitlyClosed = false;
    this.cleanup();

    try {
      // Use Node 22 native WebSocket
      this.ws = new (globalThis as any).WebSocket(this.wsUrl);

      this.ws.onopen = () => {
        this.isAlive = true;
        this.reconnectAttempts = 0;
        this.lastMessageTimestamp = Date.now();
        this.emit('connected');
        this.startHeartbeat();
        this.subscribe();
      };

      this.ws.onmessage = (event: any) => {
        this.handleMessage(event.data);
      };

      this.ws.onerror = (err: any) => {
        this.emit('error', err);
      };

      this.ws.onclose = (event: any) => {
        this.isAlive = false;
        this.emit('disconnected', { code: event.code, reason: event.reason });
        if (!this.isExplicitlyClosed) {
          this.scheduleReconnect();
        }
      };
    } catch (err) {
      this.emit('error', err);
      this.scheduleReconnect();
    }
  }

  private subscribe(): void {
    if (!this.ws || this.ws.readyState !== 1) return;

    // Subscriptions required by Bybit V5 Linear
    const topics = [
      `tickers.${this.symbol}`,
      `kline.1.${this.symbol}`,
      `kline.5.${this.symbol}`,
      `kline.15.${this.symbol}`,
      `kline.60.${this.symbol}`,
      `kline.240.${this.symbol}`,
      `kline.D.${this.symbol}`,
      `orderbook.50.${this.symbol}`,
      `publicTrade.${this.symbol}`,
      `allLiquidation.${this.symbol}`,
    ];

    const subMsg = {
      op: 'subscribe',
      args: topics,
    };

    this.ws.send(JSON.stringify(subMsg));
    this.emit('subscribed', topics);
  }

  private startHeartbeat(): void {
    if (this.pingIntervalTimer) clearInterval(this.pingIntervalTimer);
    if (this.watchdogTimer) clearInterval(this.watchdogTimer);

    // Ping every 20s as specified in Bybit V5
    this.pingIntervalTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === 1) {
        const pingTime = Date.now();
        this.ws.send(JSON.stringify({ op: 'ping' }));
        this.emit('ping_sent', pingTime);
      }
    }, config.bybit.wsPingIntervalMs);

    // Watchdog checks if we haven't received ANY message or pong for 40s
    this.watchdogTimer = setInterval(() => {
      const elapsed = Date.now() - this.lastMessageTimestamp;
      if (elapsed > config.bybit.wsWatchdogTimeoutMs) {
        this.emit('stream_frozen', { elapsedMs: elapsed });
        if (this.ws) {
          try {
            this.ws.close();
          } catch {}
        }
      }
    }, 10000);
  }

  private handleMessage(raw: string): void {
    this.lastMessageTimestamp = Date.now();
    try {
      const data = JSON.parse(raw);

      // Handle Bybit pong response
      if (data.op === 'pong' || data.ret_msg === 'pong') {
        this.latencyMs = Date.now() - (data.conn_id ? this.lastMessageTimestamp : Date.now());
        this.emit('pong_received', { timestamp: Date.now() });
        return;
      }

      if (data.topic) {
        this.routeTopicMessage(data);
      }
    } catch (err) {
      this.emit('parse_error', err);
    }
  }

  private routeTopicMessage(msg: any): void {
    const topic: string = msg.topic;

    if (topic.startsWith('tickers.')) {
      this.handleTickerUpdate(msg);
    } else if (topic.startsWith('kline.')) {
      this.handleKlineUpdate(msg);
    } else if (topic.startsWith('orderbook.')) {
      this.handleOrderBookUpdate(msg);
    } else if (topic.startsWith('publicTrade.')) {
      this.handleTradeUpdate(msg);
    } else if (topic.startsWith('allLiquidation.') || topic.startsWith('liquidation.')) {
      this.handleLiquidationUpdate(msg);
    }
  }

  private handleTickerUpdate(msg: any): void {
    const data = msg.data;
    if (!data) return;

    this.emit('ticker', data);
  }

  private handleKlineUpdate(msg: any): void {
    // topic format: "kline.{interval}.{symbol}"
    const parts = msg.topic.split('.');
    const intervalStr = parts[1];
    const tf = BYBIT_TO_TIMEFRAME[intervalStr];
    if (!tf) return;

    const klineList = msg.data;
    if (!Array.isArray(klineList)) return;

    for (const item of klineList) {
      const candle: Candle = {
        symbol: this.symbol,
        timeframe: tf,
        timestamp: Number(item.start),
        open: parseFloat(item.open),
        high: parseFloat(item.high),
        low: parseFloat(item.low),
        close: parseFloat(item.close),
        volume: parseFloat(item.volume),
        turnover: parseFloat(item.turnover),
        confirmed: item.confirm === true,
      };
      this.emit('kline', candle);
    }
  }

  private handleOrderBookUpdate(msg: any): void {
    this.emit('orderbook_raw', msg);
  }

  private handleTradeUpdate(msg: any): void {
    const list = msg.data || [];
    for (const item of list) {
      const trade: Trade = {
        id: item.i,
        symbol: item.s,
        price: parseFloat(item.p),
        size: parseFloat(item.v),
        side: item.S === 'Buy' ? 'Buy' : 'Sell',
        timestamp: Number(item.T),
      };
      this.emit('trade', trade);
    }
  }

  private handleLiquidationUpdate(msg: any): void {
    const item = msg.data;
    if (!item) return;
    const liq: Liquidation = {
      symbol: item.symbol,
      side: item.side === 'Buy' ? 'Buy' : 'Sell',
      price: parseFloat(item.price),
      size: parseFloat(item.size),
      timestamp: Number(item.updatedTime),
    };
    this.emit('liquidation', liq);
  }

  private scheduleReconnect(): void {
    this.cleanup();
    this.reconnectAttempts++;
    const delay = Math.min(
      config.bybit.reconnectBaseDelayMs * Math.pow(2, this.reconnectAttempts - 1) + Math.random() * 500,
      config.bybit.reconnectMaxDelayMs
    );

    this.emit('reconnecting', { attempt: this.reconnectAttempts, delayMs: Math.round(delay) });
    setTimeout(() => {
      if (!this.isExplicitlyClosed) {
        this.connect();
      }
    }, delay);
  }

  private cleanup(): void {
    if (this.pingIntervalTimer) {
      clearInterval(this.pingIntervalTimer);
      this.pingIntervalTimer = null;
    }
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.onopen = null;
        this.ws.onmessage = null;
        this.ws.onerror = null;
        this.ws.onclose = null;
        this.ws.close();
      } catch {}
      this.ws = null;
    }
  }

  public disconnect(): void {
    this.isExplicitlyClosed = true;
    this.cleanup();
    this.emit('disconnected', { code: 1000, reason: 'Client disconnect' });
  }

  public isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === 1;
  }

  public getLatency(): number {
    return this.latencyMs;
  }

  public getLastMessageTime(): number {
    return this.lastMessageTimestamp;
  }
}
