import { EventEmitter } from 'events';
import {
  MarketState,
  Ticker,
  InstrumentInfo,
  SUPPORTED_TIMEFRAMES,
  Timeframe,
  SystemOperationalStatus,
  Candle,
} from '../types/market.js';
import { BybitRestClient } from '../bybit/bybit-rest-client.js';
import { BybitWsClient } from '../bybit/bybit-ws-client.js';
import { CandleManager, GapInfo } from './candle-manager.js';
import { OrderBookManager } from './orderbook-manager.js';
import { DatabaseService } from '../storage/database.js';
import { config } from '../config/index.js';

export class MarketCoordinator extends EventEmitter {
  private restClient: BybitRestClient;
  private wsClient: BybitWsClient;
  private candleManager: CandleManager;
  private orderBookManager: OrderBookManager;
  private db: DatabaseService;
  private symbol: string;
  private instrumentInfo: InstrumentInfo | null = null;
  private currentTicker: Ticker | null = null;
  private isBootstrapped: boolean = false;
  private snapshotIntervalTimer: NodeJS.Timeout | null = null;

  constructor(
    restClient: BybitRestClient,
    wsClient: BybitWsClient,
    candleManager: CandleManager,
    orderBookManager: OrderBookManager,
    db: DatabaseService,
    symbol: string = config.bybit.symbol
  ) {
    super();
    this.restClient = restClient;
    this.wsClient = wsClient;
    this.candleManager = candleManager;
    this.orderBookManager = orderBookManager;
    this.db = db;
    this.symbol = symbol;

    this.setupListeners();
  }

  private setupListeners(): void {
    // WebSocket events
    this.wsClient.on('connected', () => {
      this.db.logEvent('INFO', 'BybitWS', `Connected to Bybit V5 Linear stream for ${this.symbol}`);
      this.emit('state_updated', this.getMarketState());
    });

    this.wsClient.on('disconnected', (info) => {
      this.db.logEvent('WARN', 'BybitWS', `Disconnected from Bybit V5: ${JSON.stringify(info)}`);
      this.emit('state_updated', this.getMarketState());
    });

    this.wsClient.on('ticker', (data) => {
      this.handleWsTicker(data);
    });

    this.wsClient.on('kline', (candle: Candle) => {
      this.candleManager.processWsCandle(candle);
    });

    this.wsClient.on('orderbook_raw', (msg) => {
      const type = msg.type; // 'snapshot' | 'delta'
      const data = msg.data;
      if (!data) return;

      if (type === 'snapshot') {
        this.orderBookManager.handleSnapshot(data.b || [], data.a || [], data.seq || msg.cts, data.t || msg.cts);
      } else {
        this.orderBookManager.handleDelta(data.b || [], data.a || [], data.seq || msg.cts, data.t || msg.cts);
      }
    });

    // Candle manager gap detection
    this.candleManager.on('gap_detected', async (gap: GapInfo) => {
      this.db.logEvent('WARN', 'CandleManager', `Gap detected on ${gap.timeframe}: ~${gap.missingCandlesEstimate} candles`, gap);
      await this.backfillGap(gap.timeframe);
    });

    // Forward candle events
    this.candleManager.on('candle_updated', (candle) => {
      this.emit('candle_updated', candle);
    });

    this.candleManager.on('candle_closed', (candle) => {
      this.emit('candle_closed', candle);
      this.emit('state_updated', this.getMarketState());
    });

    // Forward orderbook events
    this.orderBookManager.on('orderbook_updated', (ob) => {
      this.emit('orderbook_updated', ob);
    });
  }

  public async bootstrap(): Promise<void> {
    try {
      this.db.logEvent('INFO', 'Coordinator', `Bootstrapping market coordinator for ${this.symbol}`);

      // 1. Get instrument specs
      this.instrumentInfo = await this.restClient.getInstrumentsInfo(this.symbol);
      this.db.logEvent('INFO', 'Coordinator', `Instrument info loaded: tickSize=${this.instrumentInfo.tickSize}, qtyStep=${this.instrumentInfo.qtyStep}`);

      // 2. Fetch initial ticker
      this.currentTicker = await this.restClient.getTicker(this.symbol);

      // 3. Fetch initial orderbook
      const ob = await this.restClient.getOrderBook(this.symbol, 50);
      this.orderBookManager.handleSnapshot(
        ob.bids.map((b) => [String(b[0]), String(b[1])]),
        ob.asks.map((a) => [String(a[0]), String(a[1])]),
        ob.seq,
        ob.timestamp
      );

      // 4. Load historical candles for all 6 timeframes
      this.candleManager.initFromDatabase();
      for (const tf of SUPPORTED_TIMEFRAMES) {
        try {
          const historical = await this.restClient.getKlines(this.symbol, tf, 200);
          this.candleManager.loadHistoricalCandles(tf, historical);
          this.db.logEvent('INFO', 'Coordinator', `Loaded ${historical.length} historical candles for ${tf}`);
        } catch (err: any) {
          this.db.logEvent('ERROR', 'Coordinator', `Failed to load historical candles for ${tf}: ${err.message}`);
        }
      }

      // 5. Connect WebSocket
      this.wsClient.connect();

      // 6. Start periodic audit snapshot timer (every 60s)
      this.startSnapshotTimer();

      this.isBootstrapped = true;
      this.db.logEvent('INFO', 'Coordinator', 'Bootstrap completed successfully');
      this.emit('state_updated', this.getMarketState());
    } catch (err: any) {
      this.db.logEvent('CRITICAL', 'Coordinator', `Bootstrap failed: ${err.message}`);
      throw err;
    }
  }

  private handleWsTicker(data: any): void {
    if (!this.currentTicker) {
      const last = parseFloat(data.lastPrice || '0');
      this.currentTicker = {
        symbol: this.symbol,
        lastPrice: last,
        markPrice: parseFloat(data.markPrice || '0'),
        indexPrice: parseFloat(data.indexPrice || '0'),
        bid1Price: parseFloat(data.bid1Price || '0'),
        ask1Price: parseFloat(data.ask1Price || '0'),
        bid1Size: parseFloat(data.bid1Size || '0'),
        ask1Size: parseFloat(data.ask1Size || '0'),
        spread: 0,
        spreadPcnt: 0,
        highPrice24h: parseFloat(data.highPrice24h || '0'),
        lowPrice24h: parseFloat(data.lowPrice24h || '0'),
        prevPrice24h: parseFloat(data.prevPrice24h || '0'),
        price24hPcnt: parseFloat(data.price24hPcnt || '0'),
        volume24h: parseFloat(data.volume24h || '0'),
        turnover24h: parseFloat(data.turnover24h || '0'),
        fundingRate: parseFloat(data.fundingRate || '0'),
        nextFundingTime: parseInt(data.nextFundingTime || '0', 10),
        openInterest: parseFloat(data.openInterest || '0'),
        openInterestValue: parseFloat(data.openInterestValue || '0'),
        timestamp: Date.now(),
      };
    } else {
      // Incremental ticker update
      if (data.lastPrice) this.currentTicker.lastPrice = parseFloat(data.lastPrice);
      if (data.markPrice) this.currentTicker.markPrice = parseFloat(data.markPrice);
      if (data.indexPrice) this.currentTicker.indexPrice = parseFloat(data.indexPrice);
      if (data.bid1Price) this.currentTicker.bid1Price = parseFloat(data.bid1Price);
      if (data.ask1Price) this.currentTicker.ask1Price = parseFloat(data.ask1Price);
      if (data.bid1Size) this.currentTicker.bid1Size = parseFloat(data.bid1Size);
      if (data.ask1Size) this.currentTicker.ask1Size = parseFloat(data.ask1Size);
      if (data.highPrice24h) this.currentTicker.highPrice24h = parseFloat(data.highPrice24h);
      if (data.lowPrice24h) this.currentTicker.lowPrice24h = parseFloat(data.lowPrice24h);
      if (data.price24hPcnt) this.currentTicker.price24hPcnt = parseFloat(data.price24hPcnt);
      if (data.volume24h) this.currentTicker.volume24h = parseFloat(data.volume24h);
      if (data.turnover24h) this.currentTicker.turnover24h = parseFloat(data.turnover24h);
      if (data.fundingRate) this.currentTicker.fundingRate = parseFloat(data.fundingRate);
      if (data.nextFundingTime) this.currentTicker.nextFundingTime = parseInt(data.nextFundingTime, 10);
      if (data.openInterest) this.currentTicker.openInterest = parseFloat(data.openInterest);
      if (data.openInterestValue) this.currentTicker.openInterestValue = parseFloat(data.openInterestValue);
      this.currentTicker.timestamp = Date.now();
    }

    if (this.currentTicker.ask1Price > 0 && this.currentTicker.bid1Price > 0) {
      this.currentTicker.spread = parseFloat((this.currentTicker.ask1Price - this.currentTicker.bid1Price).toFixed(2));
      this.currentTicker.spreadPcnt = (this.currentTicker.spread / this.currentTicker.lastPrice) * 100;
    }

    this.emit('ticker_updated', this.currentTicker);
  }

  public async backfillGap(timeframe: Timeframe): Promise<void> {
    try {
      this.db.logEvent('INFO', 'Coordinator', `Starting automatic REST backfill for ${timeframe}`);
      const freshCandles = await this.restClient.getKlines(this.symbol, timeframe, 50);
      this.candleManager.loadHistoricalCandles(timeframe, freshCandles);
      this.db.logEvent('INFO', 'Coordinator', `Backfill complete for ${timeframe}, merged ${freshCandles.length} candles`);
    } catch (err: any) {
      this.db.logEvent('ERROR', 'Coordinator', `Backfill failed for ${timeframe}: ${err.message}`);
    }
  }

  private startSnapshotTimer(): void {
    if (this.snapshotIntervalTimer) clearInterval(this.snapshotIntervalTimer);
    this.snapshotIntervalTimer = setInterval(() => {
      if (this.currentTicker) {
        this.db.saveSnapshot(
          this.symbol,
          this.currentTicker.lastPrice,
          this.currentTicker.markPrice,
          this.currentTicker.indexPrice,
          this.currentTicker.spread,
          this.currentTicker.fundingRate,
          this.currentTicker.openInterest
        );
      }
    }, 60000);
  }

  public getMarketState(): MarketState {
    const wsConnected = this.wsClient.isConnected();
    const wsLatency = this.wsClient.getLatency();
    const lastMsgTime = this.wsClient.getLastMessageTime();

    let status: SystemOperationalStatus = 'OBSERVING';
    if (!wsConnected || !this.currentTicker || Date.now() - lastMsgTime > config.bybit.wsWatchdogTimeoutMs) {
      status = 'DATA_UNAVAILABLE';
    }

    return {
      symbol: this.symbol,
      ticker: this.currentTicker,
      orderBook: this.orderBookManager.getOrderBook(),
      currentCandle: this.candleManager.getAllCurrentCandles(),
      lastClosedCandle: this.candleManager.getAllLastClosedCandles(),
      wsConnected,
      wsLatencyMs: wsLatency,
      lastWsMessageTimestamp: lastMsgTime,
      gapsDetectedCount: this.candleManager.getGapsCount(),
      status,
      killSwitchActive: config.security.killSwitchActive,
      updatedAt: Date.now(),
    };
  }

  public getCandles(timeframe: Timeframe, count: number = 100): Candle[] {
    return this.candleManager.getCandles(timeframe, count);
  }

  public getInstrumentInfo(): InstrumentInfo | null {
    return this.instrumentInfo;
  }

  public stop(): void {
    if (this.snapshotIntervalTimer) {
      clearInterval(this.snapshotIntervalTimer);
      this.snapshotIntervalTimer = null;
    }
    this.wsClient.disconnect();
  }
}
