import test from 'node:test';
import assert from 'node:assert/strict';
import { OrderBookManager } from '../../src/market/orderbook-manager.js';

test('OrderBookManager - handles snapshots and sorts levels correctly', () => {
  const obm = new OrderBookManager('BTCUSDT');

  const rawBids: [string, string][] = [
    ['60000.0', '1.5'],
    ['60010.0', '2.0'],
    ['59990.0', '0.5'],
  ];

  const rawAsks: [string, string][] = [
    ['60030.0', '1.2'],
    ['60020.0', '3.0'],
    ['60040.0', '0.8'],
  ];

  const ob = obm.handleSnapshot(rawBids, rawAsks, 100, 1700000000000);

  // Bids must be descending (highest first)
  assert.equal(ob.bids[0][0], 60010.0);
  assert.equal(ob.bids[1][0], 60000.0);
  assert.equal(ob.bids[2][0], 59990.0);
  assert.equal(ob.bestBid, 60010.0);

  // Asks must be ascending (lowest first)
  assert.equal(ob.asks[0][0], 60020.0);
  assert.equal(ob.asks[1][0], 60030.0);
  assert.equal(ob.asks[2][0], 60040.0);
  assert.equal(ob.bestAsk, 60020.0);

  // Spread = 60020 - 60010 = 10
  assert.equal(ob.spread, 10.0);
  assert.equal(ob.midPrice, 60015.0);
});

test('OrderBookManager - handles delta additions and deletions', () => {
  const obm = new OrderBookManager('BTCUSDT');

  obm.handleSnapshot(
    [['60000.0', '1.0'], ['59900.0', '2.0']],
    [['60010.0', '1.0'], ['60100.0', '2.0']],
    1,
    1700000000000
  );

  // Delta: update best bid, and delete 59900 by setting size 0
  const updated = obm.handleDelta(
    [['60005.0', '3.0'], ['59900.0', '0']],
    [['60010.0', '0.5']],
    2,
    1700000001000
  );

  assert.equal(updated.bestBid, 60005.0);
  assert.equal(updated.bids.length, 2); // 60005.0 and 60000.0
  assert.equal(updated.asks[0][1], 0.5); // updated size
  assert.equal(updated.spread, 5.0); // 60010 - 60005
});
