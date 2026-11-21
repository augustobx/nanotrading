import test from 'node:test';
import assert from 'node:assert/strict';
import { Candle } from '../../src/types/market.js';
import { SmcDetector } from '../../src/engine/smc-detector.js';

function createSyntheticCandleSequence(count: number, basePrice: number = 60000, startTimestamp: number = 1700000000000): Candle[] {
  const candles: Candle[] = [];
  const intervalMs = 15 * 60 * 1000; // 15m

  for (let i = 0; i < count; i++) {
    const ts = startTimestamp + i * intervalMs;
    // Create an identifiable peak around index 10 and trough around index 20
    let price = basePrice;
    if (i === 10) price += 500; // Swing High candidate
    else if (i === 20) price -= 500; // Swing Low candidate
    else price += (i % 2 === 0 ? 50 : -50);

    candles.push({
      symbol: 'BTCUSDT',
      timeframe: '15m',
      timestamp: ts,
      open: price - 20,
      high: price + 30,
      low: price - 30,
      close: price + 10,
      volume: 100 + i * 2,
      turnover: (price + 10) * (100 + i * 2),
      confirmed: true,
    });
  }
  return candles;
}

test('Look-Ahead Bias Prevention - Swings require confirmed right bars', () => {
  const candles = createSyntheticCandleSequence(30);
  const leftBars = 3;
  const rightBars = 3;

  const swings = SmcDetector.detectSwings(candles, leftBars, rightBars);

  assert.ok(swings.length > 0, 'Must detect swings');
  for (const s of swings) {
    // 1. Origin timestamp must precede or equal confirmation timestamp
    assert.ok(
      s.confirmedAtTimestamp >= s.patternOriginTimestamp,
      `confirmedAtTimestamp (${s.confirmedAtTimestamp}) must be >= patternOriginTimestamp (${s.patternOriginTimestamp})`
    );

    // 2. Operational available timestamp must match confirmation timestamp (no look-ahead)
    assert.equal(s.operationalAvailableTimestamp, s.confirmedAtTimestamp);

    // 3. Right bars delay: confirmedAtIndex must strictly equal index + rightBars
    assert.equal(
      s.confirmedAtIndex,
      s.index + rightBars,
      `Confirmation must occur exactly rightBars (${rightBars}) after swing index`
    );
  }
});

test('Look-Ahead Bias Prevention - FVGs confirmed strictly on candle 3 close', () => {
  // Construct 3 candles forming a bullish FVG
  const t0 = 1700000000000;
  const candles: Candle[] = [
    { symbol: 'BTCUSDT', timeframe: '15m', timestamp: t0, open: 60000, high: 60100, low: 59950, close: 60050, volume: 100, turnover: 6005000, confirmed: true },
    { symbol: 'BTCUSDT', timeframe: '15m', timestamp: t0 + 900000, open: 60050, high: 60600, low: 60040, close: 60550, volume: 250, turnover: 15137500, confirmed: true },
    { symbol: 'BTCUSDT', timeframe: '15m', timestamp: t0 + 1800000, open: 60550, high: 60800, low: 60300, close: 60700, volume: 180, turnover: 10926000, confirmed: true },
  ];

  const fvgs = SmcDetector.detectFVGs(candles, '15m');
  assert.equal(fvgs.length, 1);
  const fvg = fvgs[0];

  assert.equal(fvg.type, 'BULLISH');
  assert.equal(fvg.patternOriginTimestamp, candles[1].timestamp, 'Origin is the middle displacement candle');
  assert.equal(fvg.confirmedAtTimestamp, candles[2].timestamp + 15 * 60 * 1000, 'Confirmation occurs when candle 3 closes');
  assert.equal(fvg.operationalAvailableTimestamp, candles[2].timestamp + 15 * 60 * 1000, 'Not operationally available before candle 3 close');
});

test('Look-Ahead Bias Prevention - BOS and Liquidity Sweeps occur strictly on breaking candle', () => {
  const candles = createSyntheticCandleSequence(30);
  const result = SmcDetector.analyzeStructure(candles, '15m');

  for (const b of result.structureBreaks) {
    assert.ok(
      b.confirmedAtTimestamp >= b.patternOriginTimestamp,
      'Structure break confirmation must be after the origin swing'
    );
    assert.equal(b.operationalAvailableTimestamp, b.confirmedAtTimestamp);
  }

  for (const s of result.sweeps) {
    assert.ok(
      s.confirmedAtTimestamp >= s.patternOriginTimestamp,
      'Liquidity sweep confirmation must be after origin swing'
    );
    assert.equal(s.operationalAvailableTimestamp, s.confirmedAtTimestamp);
  }
});
