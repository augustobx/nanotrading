import test from 'node:test';
import assert from 'node:assert/strict';
import { SmcDetector } from '../../src/engine/smc-detector.js';
import { Candle } from '../../src/types/market.js';

function createCandle(index: number, open: number, high: number, low: number, close: number): Candle {
  return {
    symbol: 'BTCUSDT',
    timeframe: '15m',
    timestamp: 1700000000000 + index * 900000,
    open,
    high,
    low,
    close,
    volume: 10,
    turnover: 600000,
    confirmed: true,
  };
}

test('SmcDetector - Swing detection strictly prevents look-ahead bias', () => {
  // Peak at index 3: left bars (0, 1, 2) lower, right bars (4, 5, 6) lower
  const candles: Candle[] = [
    createCandle(0, 100, 105, 95, 102),
    createCandle(1, 102, 108, 100, 106),
    createCandle(2, 106, 112, 104, 110),
    createCandle(3, 110, 125, 108, 120), // Peak (Swing High)
    createCandle(4, 120, 118, 112, 115),
    createCandle(5, 115, 114, 108, 110),
    createCandle(6, 110, 108, 102, 105), // rightBars = 3 ends here
    createCandle(7, 105, 104, 98, 100),
  ];

  const swings = SmcDetector.detectSwings(candles, 3, 3);
  const swingHigh = swings.find((s) => s.type === 'HIGH');

  assert.notEqual(swingHigh, undefined);
  assert.equal(swingHigh?.index, 3);
  assert.equal(swingHigh?.price, 125);

  // Critical verification: confirmedAtIndex must be index + rightBars = 3 + 3 = 6
  assert.equal(swingHigh?.confirmedAtIndex, 6);
  assert.equal(swingHigh?.confirmedAtTimestamp, candles[6].timestamp);
});

test('SmcDetector - Bullish and Bearish Fair Value Gaps (FVG)', () => {
  const candles: Candle[] = [
    // Candle 0
    createCandle(0, 100, 105, 98, 102), // High = 105
    // Candle 1 (Displacement candle)
    createCandle(1, 102, 130, 101, 128),
    // Candle 2
    createCandle(2, 128, 135, 115, 132), // Low = 115
    // FVG between 105 and 115 (Size = 10)
    createCandle(3, 132, 134, 120, 125), // Still above 115 -> ACTIVE
  ];

  const fvgs = SmcDetector.detectFVGs(candles, '15m');
  assert.equal(fvgs.length, 1);
  assert.equal(fvgs[0].type, 'BULLISH');
  assert.equal(fvgs[0].bottom, 105);
  assert.equal(fvgs[0].top, 115);
  assert.equal(fvgs[0].size, 10);
  assert.equal(fvgs[0].status, 'ACTIVE');

  // Next candle mitigates FVG
  const candle4 = createCandle(4, 125, 126, 110, 112); // Low = 110 is inside [105, 115]
  candles.push(candle4);

  const fvgsAfter = SmcDetector.detectFVGs(candles, '15m');
  assert.equal(fvgsAfter[0].status, 'MITIGATED');
});

test('SmcDetector - Break of Structure (BOS) and Liquidity Sweep', () => {
  const candles: Candle[] = [
    createCandle(0, 100, 105, 95, 102),
    createCandle(1, 102, 108, 100, 106),
    createCandle(2, 106, 112, 104, 110),
    createCandle(3, 110, 120, 108, 115), // Swing High at 120
    createCandle(4, 115, 116, 110, 112),
    createCandle(5, 112, 113, 106, 108),
    createCandle(6, 108, 107, 101, 104), // Swing confirmed here (idx 6)
    // Candle 7: Liquidity Sweep (pokes above 120 to 123, but closes at 117 with top rejection wick)
    createCandle(7, 104, 123, 103, 117),
    // Candle 8: Full break and close above 120 -> BOS
    createCandle(8, 117, 130, 116, 126),
  ];

  const result = SmcDetector.analyzeStructure(candles, '15m');

  // Should identify the liquidity sweep from candle 7
  assert.ok(result.sweeps.length > 0);
  assert.equal(result.sweeps[0].sweptLevel, 120);
  assert.equal(result.sweeps[0].wickExtreme, 123);

  // Should identify BOS from candle 8 closing above 120
  assert.ok(result.structureBreaks.length > 0);
  assert.equal(result.structureBreaks[0].direction, 'BULLISH');
  assert.equal(result.structureBreaks[0].brokenLevel, 120);
});
