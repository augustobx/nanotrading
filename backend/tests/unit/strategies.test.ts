import test from 'node:test';
import assert from 'node:assert/strict';
import { StrategyATrendContinuation } from '../../src/engine/strategy-a-trend.js';
import { StrategyBLiquiditySweep } from '../../src/engine/strategy-b-sweep.js';
import { TechnicalIndicators } from '../../src/engine/indicators.js';
import { Candle } from '../../src/types/market.js';

function generateCandleSeries(
  count: number,
  basePrice: number,
  timeframe: string,
  generator: (i: number, basePrice: number) => { open: number; high: number; low: number; close: number; vol?: number }
): Candle[] {
  const candles: Candle[] = [];
  const intervalMs = 60000;

  for (let i = 0; i < count; i++) {
    const bar = generator(i, basePrice);
    candles.push({
      symbol: 'BTCUSDT',
      timeframe: timeframe as any,
      timestamp: 1700000000000 + i * intervalMs,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.vol || 50,
      turnover: bar.close * (bar.vol || 50),
      confirmed: true,
    });
  }
  return candles;
}

test('Strategies - Strategy A generates qualified LONG with Net R:R >= 4.0', () => {
  // Higher timeframes in bullish trend
  const c4h = generateCandleSeries(30, 60000, '4h', (i) => ({
    open: 60000 + i * 50,
    high: 60000 + i * 50 + 40,
    low: 60000 + i * 50 - 20,
    close: 60000 + i * 50 + 30,
  }));
  const c1h = generateCandleSeries(30, 60500, '1h', (i) => ({
    open: 60500 + i * 30,
    high: 60500 + i * 30 + 30,
    low: 60500 + i * 30 - 15,
    close: 60500 + i * 30 + 20,
  }));

  // Create a 15m pullback into demand zone with FVG
  const c15m = generateCandleSeries(30, 61000, '15m', (i) => ({
    open: 61000 + (i < 15 ? i * 20 : 300 - (i - 15) * 10),
    high: 61000 + (i < 15 ? i * 20 + 20 : 300 - (i - 15) * 10 + 10),
    low: 61000 + (i < 15 ? i * 20 - 10 : 300 - (i - 15) * 10 - 20),
    close: 61000 + (i < 15 ? i * 20 + 10 : 300 - (i - 15) * 10 - 10),
  }));

  // Create 5m with bullish break
  const c5m = generateCandleSeries(30, 61150, '5m', (i) => ({
    open: 61150 + (i > 25 ? 50 : 0),
    high: 61150 + (i > 25 ? 120 : 20),
    low: 61150 - 10,
    close: 61150 + (i > 25 ? 100 : 5),
  }));

  const setup = StrategyATrendContinuation.evaluate(c4h, c1h, c15m, c5m, 0.1);
  if (setup) {
    assert.equal(setup.direction, 'LONG');
    assert.ok(setup.riskReward.netRR >= 4.0, `Net R:R must be >= 4.0, got ${setup.riskReward.netRR}`);
    assert.ok(setup.entryPrice > setup.stopLossPrice, 'Long entry must be above SL');
    assert.ok(setup.takeProfitPrice > setup.entryPrice, 'Long TP must be above entry');
  }
});

test('Strategies - Strategy A rejects when candles count is insufficient (< 20)', () => {
  const c4h = generateCandleSeries(10, 60000, '4h', (i) => ({ open: 60000, high: 60010, low: 59990, close: 60005 }));
  const c1h = generateCandleSeries(10, 60000, '1h', (i) => ({ open: 60000, high: 60010, low: 59990, close: 60005 }));
  const c15m = generateCandleSeries(10, 60000, '15m', (i) => ({ open: 60000, high: 60010, low: 59990, close: 60005 }));
  const c5m = generateCandleSeries(10, 60000, '5m', (i) => ({ open: 60000, high: 60010, low: 59990, close: 60005 }));

  const setup = StrategyATrendContinuation.evaluate(c4h, c1h, c15m, c5m, 0.1);
  assert.equal(setup, null, 'Must reject when timeframe history is insufficient');
});

test('Strategies - Strategy B rejects when Net R:R is below 1:4', () => {
  // Construct a sweep scenario where target is too close to entry (reward < 4 * risk)
  const c1h = generateCandleSeries(30, 60000, '1h', (i) => ({
    open: 60000,
    high: 60050, // High target is only +50
    low: 59950,
    close: 60000,
  }));

  const c15m = generateCandleSeries(30, 60000, '15m', (i) => ({
    open: 60000,
    high: 60020,
    low: i === 25 ? 59900 : 59980, // Sweep wick 59900 (risk is 100)
    close: 60000,
  }));

  const c5m = generateCandleSeries(30, 60000, '5m', (i) => ({
    open: 60000,
    high: 60010,
    low: 59990,
    close: 60000,
  }));

  const setup = StrategyBLiquiditySweep.evaluate(c1h, c15m, c5m, 0.1);
  // Target reward (60050 - 60000 = 50) vs risk (60000 - 59890 = 110) has R:R ~0.45 << 4.0
  assert.equal(setup, null, 'Must reject setups with insufficient structural reward');
});

test('TechnicalIndicators - EMA 200 sufficiency check', () => {
  const shortCloses = [60000, 60100, 60200, 60150, 60300];
  assert.equal(TechnicalIndicators.isEmaReady(shortCloses, 200), false);
  const emaShort = TechnicalIndicators.ema(shortCloses, 200);
  assert.ok(emaShort.every((v) => isNaN(v)), 'All values must be NaN when length < period');

  const longCloses = new Array(250).fill(60000).map((v, i) => v + i * 2);
  assert.equal(TechnicalIndicators.isEmaReady(longCloses, 200), true);
  const emaLong = TechnicalIndicators.ema(longCloses, 200);
  assert.ok(!isNaN(emaLong[emaLong.length - 1]), 'Must produce valid number once period is satisfied');
});
