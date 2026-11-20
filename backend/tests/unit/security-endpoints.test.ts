import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import { DatabaseService } from '../../src/storage/database.js';
import { ApiServer } from '../../src/api/server.js';
import { MarketCoordinator } from '../../src/market/market-coordinator.js';
import { BybitRestClient } from '../../src/bybit/bybit-rest-client.js';
import { BybitWsClient } from '../../src/bybit/bybit-ws-client.js';
import { CandleManager } from '../../src/market/candle-manager.js';
import { OrderBookManager } from '../../src/market/orderbook-manager.js';
import { config } from '../../src/config/index.js';

function setupApiTest() {
  const db = new DatabaseService(':memory:');
  const rest = new BybitRestClient();
  const ws = new BybitWsClient();
  const cm = new CandleManager(db, 'BTCUSDT');
  const ob = new OrderBookManager('BTCUSDT');
  const coordinator = new MarketCoordinator(rest, ws, cm, ob, db, 'BTCUSDT');
  const server = new ApiServer(coordinator, db, 0, '127.0.0.1');
  return { db, coordinator, server };
}

test('ApiServer - Security: POST /api/v1/ai/evaluate rejects unauthorized requests', async () => {
  const { db, server } = setupApiTest();
  await server.start();
  const port = server.getPort();

  // 1. Request without admin key
  const res1 = await fetch(`http://127.0.0.1:${port}/api/v1/ai/evaluate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ setupId: 'setup_test' }),
  });

  assert.equal(res1.status, 401);
  const data1: any = await res1.json();
  assert.match(data1.error, /No autorizado/);

  // 2. Request with invalid admin key
  const res2 = await fetch(`http://127.0.0.1:${port}/api/v1/ai/evaluate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-key': 'wrong_key_123',
    },
    body: JSON.stringify({ setupId: 'setup_test' }),
  });

  assert.equal(res2.status, 401);

  await server.stop();
  db.close();
});

test('ApiServer - Security: Kill Switch endpoint requires authentication', async () => {
  const { db, server, coordinator } = setupApiTest();
  await server.start();
  const port = server.getPort();

  // Unauthorized call to kill switch
  const res1 = await fetch(`http://127.0.0.1:${port}/api/v1/kill-switch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ active: true, reason: 'Emergencia no autorizada' }),
  });
  assert.equal(res1.status, 401);

  // Authorized call with admin key
  const res2 = await fetch(`http://127.0.0.1:${port}/api/v1/kill-switch`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-key': config.security.adminApiKey,
    },
    body: JSON.stringify({ active: true, reason: 'Parada de emergencia autorizada' }),
  });
  assert.equal(res2.status, 200);
  const data2: any = await res2.json();
  assert.equal(data2.killSwitchActive, true);
  assert.equal(coordinator.getMarketState().killSwitchActive, true);

  // Restore kill switch
  coordinator.setKillSwitch(false, 'Fin de test');

  await server.stop();
  db.close();
});

test('ApiServer - Security: Input validation on setupId format', async () => {
  const { db, server } = setupApiTest();
  await server.start();
  const port = server.getPort();

  const res = await fetch(`http://127.0.0.1:${port}/api/v1/ai/evaluate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-key': config.security.adminApiKey,
    },
    body: JSON.stringify({ setupId: 'malicious/id;<script>' }),
  });

  assert.equal(res.status, 400);
  const data: any = await res.json();
  assert.match(data.error, /setupId inválido/);

  await server.stop();
  db.close();
});
