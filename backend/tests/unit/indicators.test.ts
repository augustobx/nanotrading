import test from 'node:test';
import assert from 'node:assert/strict';
import { TechnicalIndicators } from '../../src/engine/indicators.js';
import { Candle } from '../../src/types/market.js';

test('TechnicalIndicators - RSI calculation', () => {
  // Constant prices -> RSI should be 50
  const flatCloses = new Array(30).fill(60000);
  const flatRsi = TechnicalIndicators.rsi(flatCloses, 14);
  assert.equal(flatRsi[29], 50);

  // Strongly rising prices -> RSI should be > 70
  const risingCloses: number[] = [];
  for (let i = 0; i < 30; i++) {
    risingCloses.push(60000 + i * 100);
  }
  const bullRsi = TechnicalIndicators.rsi(risingCloses, 14);
  assert.ok(bullRsi[29] > 70, `Expected RSI > 70 for uptrend, got ${bullRsi[29]}`);

  // Strongly falling prices -> RSI should be < 30
  const fallingCloses: number[] = [];
  for (let i = 0; i < 30; i++) {
    fallingCloses.push(60000 - i * 100);
  }
  const bearRsi = TechnicalIndicators.rsi(fallingCloses, 14);
  assert.ok(bearRsi[29] < 30, `Expected RSI < 30 for downtrend, got ${bearRsi[29]}`);
});

test('TechnicalIndicators - ATR calculation', () => {
  const candles: Candle[] = [];
  for (let i = 0; i < 30; i++) {
    candles.push({
      symbol: 'BTCUSDT',
      timeframe: '15m',
      timestamp: 1700000000000 + i * 900000,
      open: 60000,
      high: 60200,
      low: 59900,
      close: 60100,
      volume: 10,
      turnover: 600000,
      confirmed: true,
    });
  }

  const atrSeries = TechnicalIndicators.atr(candles, 14);
  // Each candle has high - low = 300, and previous close 60100 to high/low is within 300
  // True range is 300 throughout
  assert.ok(atrSeries[29] > 0, 'ATR must be positive');
  assert.equal(Math.round(atrSeries[29]), 300);
});

test('TechnicalIndicators - EMA calculation', () => {
  const data = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
  const ema5 = TechnicalIndicators.ema(data, 5);
  assert.ok(ema5[ema5.length - 1] > 0);
  // Since series is strictly increasing, EMA must be lower than the latest price
  assert.ok(ema5[ema5.length - 1] < 20);
});

test('TechnicalIndicators - VWAP resets on UTC day boundary', () => {
  const candles: Candle[] = [
    // Day 1
    {
      symbol: 'BTCUSDT',
      timeframe: '1h',
      timestamp: Date.UTC(2026, 0, 1, 23, 0, 0),
      open: 60000,
      high: 60100,
      low: 59900,
      close: 60000,
      volume: 10,
      turnover: 600000,
      confirmed: true,
    },
    // Day 2 (midnight UTC)
    {
      symbol: 'BTCUSDT',
      timeframe: '1h',
      timestamp: Date.UTC(2026, 0, 2, 0, 0, 0),
      open: 62000,
      high: 62100,
      low: 61900,
      close: 62000,
      volume: 5,
      turnover: 310000,
      confirmed: true,
    },
  ];

  const vwapSeries = TechnicalIndicators.vwap(candles);
  assert.equal(vwapSeries[0], 60000);
  // At midnight, VWAP resets to day 2's typical price (62000)
  assert.equal(vwapSeries[1], 62000);
});
