import test from 'node:test';
import assert from 'node:assert/strict';
import { CandleManager } from '../../src/market/candle-manager.js';
import { DatabaseService } from '../../src/storage/database.js';
import { Candle, TIMEFRAME_DURATION_MS } from '../../src/types/market.js';

test('CandleManager - processes open and closed candles', () => {
  const db = new DatabaseService(':memory:');
  const cm = new CandleManager('BTCUSDT', db);

  const baseTime = 1700000000000;

  // Open candle
  const openCandle: Candle = {
    symbol: 'BTCUSDT',
    timeframe: '15m',
    timestamp: baseTime,
    open: 60000,
    high: 60100,
    low: 59900,
    close: 60050,
    volume: 10,
    turnover: 600000,
    confirmed: false,
  };

  cm.processWsCandle(openCandle);
  const current = cm.getCurrentCandle('15m');
  assert.notEqual(current, null);
  assert.equal(current?.close, 60050);
  assert.equal(cm.getLastClosedCandle('15m'), null);

  // Close candle
  const closedCandle: Candle = {
    ...openCandle,
    close: 60200,
    confirmed: true,
  };

  cm.processWsCandle(closedCandle);
  assert.equal(cm.getCurrentCandle('15m'), null);
  const lastClosed = cm.getLastClosedCandle('15m');
  assert.notEqual(lastClosed, null);
  assert.equal(lastClosed?.close, 60200);
  assert.equal(lastClosed?.confirmed, true);

  db.close();
});

test('CandleManager - detects timestamp gaps', () => {
  const db = new DatabaseService(':memory:');
  const cm = new CandleManager('BTCUSDT', db);

  const baseTime = 1700000000000;
  const duration = TIMEFRAME_DURATION_MS['15m'];

  let gapDetected = false;
  cm.on('gap_detected', (gap) => {
    gapDetected = true;
    assert.equal(gap.timeframe, '15m');
    assert.equal(gap.missingCandlesEstimate, 2);
  });

  // Candle 1
  cm.processWsCandle({
    symbol: 'BTCUSDT',
    timeframe: '15m',
    timestamp: baseTime,
    open: 60000,
    high: 60100,
    low: 59900,
    close: 60050,
    volume: 10,
    turnover: 600000,
    confirmed: true,
  });

  // Candle 2 skips 2 periods (i.e. + 3 * duration)
  cm.processWsCandle({
    symbol: 'BTCUSDT',
    timeframe: '15m',
    timestamp: baseTime + duration * 3,
    open: 60500,
    high: 60600,
    low: 60400,
    close: 60550,
    volume: 12,
    turnover: 720000,
    confirmed: true,
  });

  assert.equal(gapDetected, true);
  assert.equal(cm.getGapsCount(), 1);

  db.close();
});
