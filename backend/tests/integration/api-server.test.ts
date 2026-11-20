import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseService } from '../../src/storage/database.js';
import { BybitRestClient } from '../../src/bybit/bybit-rest-client.js';
import { BybitWsClient } from '../../src/bybit/bybit-ws-client.js';
import { CandleManager } from '../../src/market/candle-manager.js';
import { OrderBookManager } from '../../src/market/orderbook-manager.js';
import { MarketCoordinator } from '../../src/market/market-coordinator.js';
import { ApiServer } from '../../src/api/server.js';

test('ApiServer - full end-to-end bootstrap and HTTP endpoints verification', async () => {
  const db = new DatabaseService(':memory:');
  const restClient = new BybitRestClient();
  const wsClient = new BybitWsClient();
  const candleManager = new CandleManager('BTCUSDT', db);
  const orderBookManager = new OrderBookManager('BTCUSDT');

  const coordinator = new MarketCoordinator(
    restClient,
    wsClient,
    candleManager,
    orderBookManager,
    db,
    'BTCUSDT'
  );

  const testPort = 3299;
  const apiServer = new ApiServer(coordinator, db, testPort, '127.0.0.1');

  try {
    await apiServer.start();
    await coordinator.bootstrap();

    // Wait a moment for WS connection to establish
    await new Promise((r) => setTimeout(r, 1200));

    // Test /health
    const healthRes = await fetch(`http://127.0.0.1:${testPort}/health`);
    assert.equal(healthRes.status, 200);
    const healthData = await healthRes.json();
    assert.equal(healthData.bybit.symbol, 'BTCUSDT');
    assert.equal(healthData.bybit.wsConnected, true);
    console.log('[E2E TEST] /health verified: Bybit WS Connected, Symbol=' + healthData.bybit.symbol);

    // Test /api/v1/market/state
    const stateRes = await fetch(`http://127.0.0.1:${testPort}/api/v1/market/state`);
    assert.equal(stateRes.status, 200);
    const stateData = await stateRes.json();
    assert.equal(stateData.success, true);
    assert.ok(stateData.data.ticker.lastPrice > 0);
    console.log('[E2E TEST] /api/v1/market/state verified: Last Price=' + stateData.data.ticker.lastPrice);

    // Test /api/v1/market/candles?timeframe=15m
    const candlesRes = await fetch(`http://127.0.0.1:${testPort}/api/v1/market/candles?timeframe=15m&limit=20`);
    assert.equal(candlesRes.status, 200);
    const candlesData = await candlesRes.json();
    assert.equal(candlesData.success, true);
    assert.ok(candlesData.count > 0);
    console.log(`[E2E TEST] /api/v1/market/candles verified: returned ${candlesData.count} real 15m candles`);

    // Test /api/v1/market/orderbook
    const obRes = await fetch(`http://127.0.0.1:${testPort}/api/v1/market/orderbook`);
    assert.equal(obRes.status, 200);
    const obData = await obRes.json();
    assert.ok(obData.data.bids.length > 0);
    console.log(`[E2E TEST] /api/v1/market/orderbook verified: bestBid=${obData.data.bestBid}, bestAsk=${obData.data.bestAsk}`);

    // Test live WS connection to internal API server
    const clientWs = new (globalThis as any).WebSocket(`ws://127.0.0.1:${testPort}/ws/live`);
    const wsReceived = await new Promise<boolean>((resolve) => {
      clientWs.onmessage = (e: any) => {
        const msg = JSON.parse(e.data);
        if (msg.type === 'initial_state') {
          resolve(true);
        }
      };
      setTimeout(() => resolve(false), 5000);
    });
    clientWs.close();
    assert.equal(wsReceived, true, 'Frontend client should receive initial_state from internal WS');
    console.log('[E2E TEST] Internal WebSocket /ws/live verified!');
  } finally {
    coordinator.stop();
    await apiServer.stop();
    db.close();
  }
});
