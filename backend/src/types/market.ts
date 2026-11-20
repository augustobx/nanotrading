export type Timeframe = '1m' | '5m' | '15m' | '1h' | '4h' | '1d';

export type BybitInterval = '1' | '5' | '15' | '60' | '240' | 'D';

export const TIMEFRAME_TO_BYBIT: Record<Timeframe, BybitInterval> = {
  '1m': '1',
  '5m': '5',
  '15m': '15',
  '1h': '60',
  '4h': '240',
  '1d': 'D',
};

export const BYBIT_TO_TIMEFRAME: Record<string, Timeframe> = {
  '1': '1m',
  '5': '5m',
  '15': '15m',
  '60': '1h',
  '240': '4h',
  'D': '1d',
};

export const TIMEFRAME_DURATION_MS: Record<Timeframe, number> = {
  '1m': 60 * 1000,
  '5m': 5 * 60 * 1000,
  '15m': 15 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
};

export const SUPPORTED_TIMEFRAMES: Timeframe[] = ['1m', '5m', '15m', '1h', '4h', '1d'];

export interface Candle {
  symbol: string;
  timeframe: Timeframe;
  timestamp: number; // Candle start time in ms (UTC)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  turnover: number;
  confirmed: boolean; // true if candle has closed
}

export interface Ticker {
  symbol: string;
  lastPrice: number;
  markPrice: number;
  indexPrice: number;
  bid1Price: number;
  ask1Price: number;
  bid1Size: number;
  ask1Size: number;
  spread: number;
  spreadPcnt: number;
  highPrice24h: number;
  lowPrice24h: number;
  prevPrice24h: number;
  price24hPcnt: number;
  volume24h: number;
  turnover24h: number;
  fundingRate: number;
  nextFundingTime: number;
  openInterest: number;
  openInterestValue: number;
  timestamp: number;
}

export type OrderBookLevel = [price: number, size: number];

export interface OrderBook {
  symbol: string;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  timestamp: number;
  seq: number;
  bestBid: number;
  bestAsk: number;
  spread: number;
  spreadPcnt: number;
  midPrice: number;
  imbalance: number; // (bidVol - askVol) / (bidVol + askVol)
}

export interface Trade {
  id: string;
  symbol: string;
  price: number;
  size: number;
  side: 'Buy' | 'Sell';
  timestamp: number;
}

export interface Liquidation {
  symbol: string;
  side: 'Buy' | 'Sell';
  price: number;
  size: number;
  timestamp: number;
}

export interface InstrumentInfo {
  symbol: string;
  baseCoin: string;
  quoteCoin: string;
  tickSize: number;
  qtyStep: number;
  minOrderQty: number;
  maxOrderQty: number;
  maxLeverage: number;
}

export type SystemOperationalStatus = 'OBSERVING' | 'DATA_UNAVAILABLE' | 'ERROR';

export interface MarketState {
  symbol: string;
  ticker: Ticker | null;
  orderBook: OrderBook | null;
  currentCandle: Record<Timeframe, Candle | null>;
  lastClosedCandle: Record<Timeframe, Candle | null>;
  wsConnected: boolean;
  wsLatencyMs: number;
  lastWsMessageTimestamp: number;
  gapsDetectedCount: number;
  status: SystemOperationalStatus;
  killSwitchActive: boolean;
  updatedAt: number;
}
