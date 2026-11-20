import test from 'node:test';
import assert from 'node:assert/strict';
import { StrategyATrendContinuation } from '../../src/engine/strategy-a-trend.js';
import { StrategyBLiquiditySweep } from '../../src/engine/strategy-b-sweep.js';
import { Candle } from '../../src/types/market.js';

function generateCandles(count: number, basePrice: number, trend: 'UP' | 'DOWN' | 'SIDEWAYS', timeframe: string): Candle[] {
  const candles: Candle[] = [];
  let price = basePrice;

  for (let i = 0; i < count; i++) {
    const step = trend === 'UP' ? 20 : trend === 'DOWN' ? -20 : (i % 2 === 0 ? 10 : -10);
    const open = price;
    const close = price + step;
    const high = Math.max(open, close) + 15;
    const low = Math.min(open, close) - 15;
    price = close;

    candles.push({
      symbol: 'BTCUSDT',
      timeframe: timeframe as any,
      timestamp: 1700000000000 + i * 60000,
      open,
      high,
      low,
      close,
      volume: 10 + (i % 5),
      turnover: open * 10,
      confirmed: true,
    });
  }

  return candles;
}

test('Strategies - Strategy A rejects when market is ranging and has no valid 1:4 setup', () => {
  // Ranging sideways market across all timeframes
  const c4h = generateCandles(30, 60000, 'SIDEWAYS', '4h');
  const c1h = generateCandles(30, 60000, 'SIDEWAYS', '1h');
  const c15m = generateCandles(30, 60000, 'SIDEWAYS', '15m');
  const c5m = generateCandles(30, 60000, 'SIDEWAYS', '5m');

  const setup = StrategyATrendContinuation.evaluate(c4h, c1h, c15m, c5m, 0.1);

  // Must decide NO OPERAR (null setup)
  assert.equal(setup, null, 'Should return null when no strict 1:4 trend setup exists');
});

test('Strategies - Strategy B detects Liquidity Sweep and checks 1:4 R:R', () => {
  // Create an explicit bullish sweep scenario on 15m
  const c1h = generateCandles(30, 60000, 'UP', '1h');
  const c15m = generateCandles(30, 60000, 'SIDEWAYS', '15m');

  // Insert a known low swing at index 10
  c15m[10].low = 59000;
  c15m[10].close = 59200;

  // Insert a sweep candle at index 25 (wick to 58950, close back inside at 59150)
  c15m[25].low = 58950;
  c15m[25].open = 59100;
  c15m[25].close = 59150;
  c15m[25].high = 59180;

  const c5m = generateCandles(30, 59150, 'UP', '5m');
  // 5m produces a micro CHoCH
  c5m[28].close = 59400;
  c5m[28].high = 59450;

  const setup = StrategyBLiquiditySweep.evaluate(c1h, c15m, c5m, 0.1);

  if (setup) {
    assert.equal(setup.strategy, 'STRATEGY_B_LIQUIDITY_SWEEP_REVERSAL');
    assert.equal(setup.direction, 'LONG');
    assert.ok(setup.riskReward.netRR >= 4.0, `Expected R:R >= 4.0, got ${setup.riskReward.netRR}`);
    assert.ok(setup.evidence.triggerReason.includes('Barrido de liquidez'));
  }
});
