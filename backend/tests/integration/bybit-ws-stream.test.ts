import test from 'node:test';
import assert from 'node:assert/strict';
import { BybitWsClient } from '../../src/bybit/bybit-ws-client.js';

test('BybitWsClient - live streaming from Bybit V5 Linear WebSocket', async () => {
  const wsClient = new BybitWsClient();

  let receivedTicker = false;
  let receivedKline = false;
  let receivedOrderBook = false;

  const promise = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      wsClient.disconnect();
      reject(new Error(`WS test timed out. Received: ticker=${receivedTicker}, kline=${receivedKline}, ob=${receivedOrderBook}`));
    }, 15000);

    wsClient.on('connected', () => {
      console.log('[LIVE WS TEST] Connected to Bybit V5 Linear stream');
    });

    wsClient.on('ticker', (data) => {
      if (data.lastPrice) {
        receivedTicker = true;
        console.log(`[LIVE WS TEST] Ticker received: Last=${data.lastPrice}`);
        checkDone();
      }
    });

    wsClient.on('kline', (candle) => {
      if (candle.close > 0) {
        receivedKline = true;
        console.log(`[LIVE WS TEST] Kline received: TF=${candle.timeframe}, Close=${candle.close}`);
        checkDone();
      }
    });

    wsClient.on('orderbook_raw', () => {
      receivedOrderBook = true;
      checkDone();
    });

    function checkDone() {
      if (receivedTicker && receivedKline && receivedOrderBook) {
        clearTimeout(timeout);
        wsClient.disconnect();
        resolve();
      }
    }
  });

  wsClient.connect();
  await promise;

  assert.equal(receivedTicker, true, 'Should receive ticker message');
  assert.equal(receivedKline, true, 'Should receive kline message');
  assert.equal(receivedOrderBook, true, 'Should receive orderbook message');
  console.log('[LIVE WS TEST] Stream test passed with 100% verified real Bybit live messages!');
});
