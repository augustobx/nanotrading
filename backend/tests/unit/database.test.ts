import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseService } from '../../src/storage/database.js';
import { Candle } from '../../src/types/market.js';

test('DatabaseService - stores and queries candles with UPSERT semantics', () => {
  const db = new DatabaseService(':memory:');

  const c1: Candle = {
    symbol: 'BTCUSDT',
    timeframe: '1h',
    timestamp: 1700000000000,
    open: 61000,
    high: 61500,
    low: 60900,
    close: 61200,
    volume: 50,
    turnover: 3000000,
    confirmed: true,
  };

  db.saveCandle(c1);

  const fetched = db.getLatestCandle('BTCUSDT', '1h');
  assert.notEqual(fetched, null);
  assert.equal(fetched?.close, 61200);

  // Upsert update
  const c1Updated: Candle = {
    ...c1,
    close: 61400,
  };
  db.saveCandle(c1Updated);

  const fetchedUpdated = db.getLatestCandle('BTCUSDT', '1h');
  assert.equal(fetchedUpdated?.close, 61400);

  db.close();
});

test('DatabaseService - logs events and snapshots', () => {
  const db = new DatabaseService(':memory:');

  db.logEvent('INFO', 'TestComponent', 'Unit test running', { foo: 'bar' });
  const events = db.getRecentEvents(10);
  assert.equal(events.length, 1);
  assert.equal(events[0].component, 'TestComponent');
  assert.equal(events[0].message, 'Unit test running');

  db.saveSnapshot('BTCUSDT', 62000, 62005, 62001, 1.5, 0.0001, 75000);
  db.close();
});
