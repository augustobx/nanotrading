import test from 'node:test';
import assert from 'node:assert/strict';
import { SmcDetector } from '../../src/engine/smc-detector.js';
import { Candle } from '../../src/types/market.js';

const BEGIN = 1_700_000_000_000;
const FIFTEEN_MIN = 900_000;
function bar(index: number, open: number, high: number, low: number, close: number,
             confirmed = true): Candle {
  return {
    symbol: 'BTCUSDT', timeframe: '15m', timestamp: BEGIN + index * FIFTEEN_MIN,
    open, high, low, close, volume: 100, turnover: close * 100, confirmed,
  };
}

function structureSequence(): Candle[] {
  return [
    bar(0, 100, 105, 95, 100),
    bar(1, 100, 110, 98, 105),
    bar(2, 105, 113, 101, 106),
    bar(3, 106, 120, 102, 110), // candidate swing high 120
    bar(4, 110, 115, 104, 106),
    bar(5, 106, 112, 100, 104),
    bar(6, 104, 111, 99, 103), // swing 120 confirmed at close
    bar(7, 103, 110, 98, 101),
    bar(8, 101, 119, 99, 113), // second swing high 119
    bar(9, 113, 114, 103, 110),
    bar(10, 110, 112, 100, 108),
    bar(11, 108, 116, 101, 112), // swing 119 confirmed at close
    bar(12, 112, 132, 111, 130), // breaks BOTH 120 and 119: ONE event
    bar(13, 130, 131, 118, 121),
    bar(14, 121, 124, 112, 115),
    bar(15, 115, 120, 105, 109), // pivot low 105
    bar(16, 109, 117, 106, 111),
    bar(17, 111, 119, 107, 112),
    bar(18, 112, 120, 109, 114), // pivot low confirmed
    bar(19, 114, 115, 99, 101), // breaks 105 => bearish CHoCH
  ];
}

test('SMC PR4: one dominant bullish BOS per candle, not one per historical swing', () => {
  const result = SmcDetector.analyzeStructure(structureSequence().slice(0, 13), '15m');
  const events = result.structureBreaks.filter(b => b.candleIndex === 12);
  assert.equal(events.length, 1, 'crossing two confirmed swing highs produces only one BOS');
  assert.equal(events[0].direction, 'BULLISH');
  assert.equal(events[0].type, 'BOS');
  assert.equal(events[0].brokenLevel, 120);
  assert.equal(events[0].confirmedAtTimestamp, BEGIN + 13 * FIFTEEN_MIN);
});

test('SMC PR4: a later reversal cannot reclassify a historical BOS', () => {
  const sequence = structureSequence();
  const early = SmcDetector.analyzeStructure(sequence.slice(0, 13), '15m');
  const later = SmcDetector.analyzeStructure(sequence, '15m');
  const oldEvent = early.structureBreaks.find(b => b.candleIndex === 12);
  const replayedEvent = later.structureBreaks.find(b => b.candleIndex === 12);
  assert.ok(oldEvent && replayedEvent);
  assert.equal(oldEvent.type, 'BOS');
  assert.deepEqual([replayedEvent.type, replayedEvent.direction, replayedEvent.brokenLevel],
    [oldEvent.type, oldEvent.direction, oldEvent.brokenLevel]);
  assert.ok(later.structureBreaks.some(b =>
    b.candleIndex === 19 && b.type === 'CHoCH' && b.direction === 'BEARISH'));
});

test('SMC PR4: every prefix replay agrees with final history up to that time', () => {
  const sequence = structureSequence();
  const finalResult = SmcDetector.analyzeStructure(sequence, '15m');
  for (let count = 1; count <= sequence.length; count++) {
    const prefix = SmcDetector.analyzeStructure(sequence.slice(0, count), '15m');
    const expected = finalResult.structureBreaks
      .filter(b => b.candleIndex < count)
      .map(b => [b.candleTimestamp, b.brokenLevel, b.type, b.direction]);
    const actual = prefix.structureBreaks
      .map(b => [b.candleTimestamp, b.brokenLevel, b.type, b.direction]);
    assert.deepEqual(actual, expected, 'history changes at replay candle ' + count);
    const lastCloseTime = sequence[count - 1].timestamp + FIFTEEN_MIN;
    assert.ok(prefix.structureBreaks.every(b => b.operationalAvailableTimestamp <= lastCloseTime));
    assert.ok(prefix.swings.every(s => s.operationalAvailableTimestamp <= lastCloseTime));
    assert.ok(prefix.fvgs.every(f => f.operationalAvailableTimestamp <= lastCloseTime));
  }
});

test('SMC PR4: tentative incomplete candle never creates swings, BOS or FVG', () => {
  const all = structureSequence();
  const confirmed = SmcDetector.analyzeStructure(all, '15m');
  const phantom = bar(20, 101, 300, 100, 260, false);
  const withOpen = SmcDetector.analyzeStructure([...all, phantom], '15m');
  assert.deepEqual(withOpen, confirmed);
  assert.equal(SmcDetector.detectSwings([...all, phantom]).length,
    SmcDetector.detectSwings(all).length);
});

test('SMC PR4: do not invent an HH/HL label for the first swing', () => {
  const swings = SmcDetector.detectSwings(structureSequence());
  const firstHigh = swings.find(s => s.type === 'HIGH');
  const firstLow = swings.find(s => s.type === 'LOW');
  assert.ok(firstHigh && firstLow);
  assert.equal(firstHigh.label, undefined);
  assert.equal(firstLow.label, undefined);
  assert.equal(firstHigh.operationalAvailableTimestamp,
    structureSequence()[firstHigh.confirmedAtIndex].timestamp + FIFTEEN_MIN);
});

test('SMC PR4: ignore 3-dollar BTC FVG; accept meaningful impulsive gap', () => {
  const tiny = [
    bar(0, 60000, 60010, 59990, 60000),
    bar(1, 60000, 60110, 59998, 60100),
    bar(2, 60101, 60120, 60013, 60110), // only 3 USD gap
  ];
  assert.equal(SmcDetector.detectFVGs(tiny, '15m').length, 0);
  const significant = [
    bar(0, 60000, 60020, 59980, 60000),
    bar(1, 60000, 60240, 59995, 60200),
    bar(2, 60210, 60300, 60090, 60290), // 70 USD gap
  ];
  const fvgs = SmcDetector.detectFVGs(significant, '15m');
  assert.equal(fvgs.length, 1);
  assert.equal(fvgs[0].status, 'ACTIVE');
  assert.equal(fvgs[0].bottom, 60020);
  assert.equal(fvgs[0].top, 60090);
  assert.equal(fvgs[0].operationalAvailableTimestamp, significant[2].timestamp + FIFTEEN_MIN);
});

test('SMC PR4: require closed third candle and a directional displacement candle', () => {
  const candles = [
    bar(0, 60000, 60020, 59980, 60000),
    bar(1, 60000, 60240, 59995, 60200),
    bar(2, 60210, 60300, 60090, 60290, false),
  ];
  assert.deepEqual(SmcDetector.detectFVGs(candles, '15m'), []);
  assert.equal(SmcDetector.detectFVGs([{...candles[0]}, bar(1, 60200, 60240, 59995, 60010),
    {...candles[2], confirmed: true}], '15m').length, 0);
});

test('SMC PR4: invalidated/mitigated FVGs are not mistakenly ACTIVE', () => {
  const original = [
    bar(0, 60000, 60020, 59980, 60000),
    bar(1, 60000, 60240, 59995, 60200),
    bar(2, 60210, 60300, 60090, 60290),
  ];
  const mitigated = SmcDetector.detectFVGs([...original,
    bar(3, 60290, 60310, 60070, 60100)], '15m');
  assert.equal(mitigated[0].status, 'MITIGATED');
  const invalidated = SmcDetector.detectFVGs([...original,
    bar(3, 60290, 60310, 60000, 60030)], '15m');
  assert.equal(invalidated[0].status, 'INVALIDATED');
});

test('SMC PR4: repeated wick sweeps of the same level are deduplicated', () => {
  const base = structureSequence().slice(0, 7);
  const replay = [...base,
    bar(7, 105, 126, 100, 115),
    bar(8, 112, 128, 104, 114)];
  const result = SmcDetector.analyzeStructure(replay, '15m');
  const sweeps120 = result.sweeps.filter(s => s.sweptLevel === 120);
  assert.equal(sweeps120.length, 1);
  assert.equal(sweeps120[0].direction, 'BEARISH');
});

test('SMC PR4: unordered candles replay deterministically, without duplicates', () => {
  const seq = structureSequence();
  const duplicates = [seq[5], seq[1], ...seq, seq[5]];
  const expected = SmcDetector.analyzeStructure(seq, '15m');
  assert.deepEqual(SmcDetector.analyzeStructure(duplicates, '15m'), expected);
});

test('SMC PR4: missing 15m interval cannot create an FVG across data gap', () => {
  const candles = [
    bar(0, 60000, 60020, 59980, 60000),
    bar(1, 60000, 60240, 59995, 60200),
    bar(3, 60210, 60300, 60090, 60290),
  ];
  assert.equal(SmcDetector.detectFVGs(candles, '15m').length, 0);
});

test('SMC PR4: a gap invalidates an old FVG until REST backfill repairs the history', () => {
  const base = [
    bar(0, 60000, 60020, 59980, 60000),
    bar(1, 60000, 60240, 59995, 60200),
    bar(2, 60210, 60300, 60090, 60290),
  ];
  assert.equal(SmcDetector.detectFVGs(base, '15m')[0].status, 'ACTIVE');
  const missing = [...base, bar(4, 60290, 60310, 60270, 60300)];
  assert.equal(SmcDetector.detectFVGs(missing, '15m')[0].status, 'INVALIDATED');
});
