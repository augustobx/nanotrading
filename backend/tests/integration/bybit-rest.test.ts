import test from 'node:test';
import assert from 'node:assert/strict';
import { BybitRestClient } from '../../src/bybit/bybit-rest-client.js';

test('BybitRestClient - live connectivity to Bybit V5 Linear', async () => {
  const client = new BybitRestClient();

  // 1. Ticker
  const ticker = await client.getTicker('BTCUSDT');
  assert.equal(ticker.symbol, 'BTCUSDT');
  assert.ok(ticker.lastPrice > 0, `Expected lastPrice > 0, got ${ticker.lastPrice}`);
  assert.ok(ticker.markPrice > 0, `Expected markPrice > 0, got ${ticker.markPrice}`);
  assert.ok(ticker.indexPrice > 0, `Expected indexPrice > 0, got ${ticker.indexPrice}`);
  assert.ok(ticker.ask1Price >= ticker.bid1Price, 'Ask price should be >= Bid price');
  console.log(`[LIVE TEST] BTCUSDT Ticker: Last=$${ticker.lastPrice}, Mark=$${ticker.markPrice}, Spread=$${ticker.spread}`);

  // 2. Instrument info
  const info = await client.getInstrumentsInfo('BTCUSDT');
  assert.equal(info.symbol, 'BTCUSDT');
  assert.equal(info.baseCoin, 'BTC');
  assert.equal(info.quoteCoin, 'USDT');
  assert.ok(info.tickSize > 0, `Expected tickSize > 0, got ${info.tickSize}`);
  assert.ok(info.minOrderQty > 0, `Expected minOrderQty > 0, got ${info.minOrderQty}`);
  console.log(`[LIVE TEST] BTCUSDT Specs: TickSize=${info.tickSize}, QtyStep=${info.qtyStep}, MinQty=${info.minOrderQty}`);

  // 3. Klines
  const klines = await client.getKlines('BTCUSDT', '15m', 10);
  assert.equal(klines.length, 10, 'Should return exactly 10 klines');
  for (let i = 0; i < klines.length; i++) {
    const k = klines[i];
    assert.ok(k.high >= k.low, `High must be >= Low: ${k.high} vs ${k.low}`);
    assert.ok(k.volume >= 0, `Volume must be >= 0: ${k.volume}`);
    if (i > 0) {
      assert.ok(k.timestamp > klines[i - 1].timestamp, 'Klines must be in strictly ascending chronological order');
    }
  }
  console.log(`[LIVE TEST] 15m Klines: Successfully fetched 10 sequential candles, newest at ${new Date(klines[9].timestamp).toISOString()}`);

  // 4. OrderBook
  const ob = await client.getOrderBook('BTCUSDT', 20);
  assert.ok(ob.bids.length > 0, 'Must have bids');
  assert.ok(ob.asks.length > 0, 'Must have asks');
  assert.ok(ob.bestAsk >= ob.bestBid, `bestAsk (${ob.bestAsk}) must be >= bestBid (${ob.bestBid})`);
  assert.ok(ob.spread >= 0, `Spread must be >= 0, got ${ob.spread}`);
  console.log(`[LIVE TEST] OrderBook: BestBid=$${ob.bestBid}, BestAsk=$${ob.bestAsk}, Spread=$${ob.spread}`);
});
