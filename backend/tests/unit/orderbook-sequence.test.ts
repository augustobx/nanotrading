import test from 'node:test';
import assert from 'node:assert/strict';
import { OrderBookManager } from '../../src/market/orderbook-manager.js';

test('OrderBookManager - Snapshot initialization and state reconstruction', () => {
  const obm = new OrderBookManager('BTCUSDT');
  assert.equal(obm.isOrderBookSynced(), false, 'Starts unsynced before snapshot');

  const snapshotBids: [string, string][] = [
    ['60000.0', '1.5'],
    ['59990.0', '2.0'],
    ['59980.0', '0.5'],
  ];
  const snapshotAsks: [string, string][] = [
    ['60010.0', '1.0'],
    ['60020.0', '3.0'],
  ];

  const ob = obm.handleSnapshot(snapshotBids, snapshotAsks, 1001, 1700000000000, 50);

  assert.equal(obm.isOrderBookSynced(), true);
  assert.equal(ob.isSynced, true);
  assert.equal(ob.bestBid, 60000.0);
  assert.equal(ob.bestAsk, 60010.0);
  assert.equal(ob.spread, 10.0);
  assert.equal(ob.seq, 1001);
  assert.equal(ob.lastUpdateId, 50);
});

test('OrderBookManager - Handles continuous deltas correctly', () => {
  const obm = new OrderBookManager('BTCUSDT');
  obm.handleSnapshot([['60000.0', '1.0']], [['60010.0', '1.0']], 100, 1000, 10);

  // Apply delta: update ask, remove bid (size 0), add new bid
  const deltaBids: [string, string][] = [
    ['60000.0', '0'], // remove
    ['60005.0', '2.0'], // new best bid
  ];
  const deltaAsks: [string, string][] = [
    ['60010.0', '1.5'], // update size
  ];

  const ob = obm.handleDelta(deltaBids, deltaAsks, 101, 1001, 11);

  assert.equal(ob.isSynced, true);
  assert.equal(ob.bestBid, 60005.0);
  assert.equal(ob.bestAsk, 60010.0);
  assert.equal(ob.spread, 5.0);
  assert.equal(ob.lastUpdateId, 11);
});

test('OrderBookManager - Ignores stale / duplicate deltas without desyncing', () => {
  const obm = new OrderBookManager('BTCUSDT');
  obm.handleSnapshot([['60000.0', '1.0']], [['60010.0', '1.0']], 100, 1000, 20);

  // Delta with updateId <= lastUpdateId (stale/duplicate)
  const ob = obm.handleDelta([['60000.0', '5.0']], [], 101, 1001, 20);
  assert.equal(ob.isSynced, true);
  assert.equal(ob.bids[0][1], 1.0, 'Stale delta size must not overwrite current state');
});

test('OrderBookManager - Detects updateId gap and marks desynced', () => {
  const obm = new OrderBookManager('BTCUSDT');
  obm.handleSnapshot([['60000.0', '1.0']], [['60010.0', '1.0']], 100, 1000, 20);

  let desyncEvent: any = null;
  obm.on('desync_detected', (info) => {
    desyncEvent = info;
  });

  // Delta with big jump in updateId (e.g. 500 when last was 20)
  const ob = obm.handleDelta([['59990.0', '1.0']], [], 101, 1001, 500);

  assert.equal(obm.isOrderBookSynced(), false);
  assert.equal(ob.isSynced, false);
  assert.ok(desyncEvent !== null);
  assert.equal(desyncEvent.reason, 'UPDATE_ID_GAP');
});

test('OrderBookManager - Resets on disconnect and recovers cleanly on new snapshot', () => {
  const obm = new OrderBookManager('BTCUSDT');
  obm.handleSnapshot([['60000.0', '1.0']], [['60010.0', '1.0']], 100, 1000, 10);
  assert.equal(obm.isOrderBookSynced(), true);

  obm.markDesynced('WS_CONNECTION_DROPPED');
  assert.equal(obm.isOrderBookSynced(), false);

  // Fresh snapshot received after reconnect
  obm.handleSnapshot([['60500.0', '2.0']], [['60510.0', '2.0']], 200, 2000, 1);
  assert.equal(obm.isOrderBookSynced(), true);
  assert.equal(obm.getOrderBook().bestBid, 60500.0);
});
