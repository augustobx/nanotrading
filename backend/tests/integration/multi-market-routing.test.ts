import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { DatabaseService } from '../../src/storage/database.js';
import { ApiServer } from '../../src/api/server.js';
import { ScenarioRegistry } from '../../src/engine/scenario-registry.js';
import { Scenario } from '../../src/ai/scenario-types.js';

function coordinatorFor(symbol: string, db: DatabaseService) {
  const emitter = new EventEmitter() as EventEmitter & Record<string, any>;
  const registry = new ScenarioRegistry(db, symbol);
  emitter.getMarketState = () => ({
    symbol, status: 'OBSERVING', wsConnected: true,
    ticker: { symbol, lastPrice: symbol === 'ETHUSDT' ? 3050 : 60000 },
    orderBook: { bids: [], asks: [] },
  });
  emitter.getDiscoveryScheduler = () => ({
    getStatus: () => ({
      enabled: true, isRunning: true, activeWatchedScenarios: registry.getAllActive().length,
      totalAutonomousRuns: 0,
    }),
  });
  emitter.getCandles = (_tf: string, _limit: number) => ([{
    symbol, timeframe: '15m', timestamp: 100, open: 3000, high: 3060,
    low: 2950, close: 3050, volume: 100, confirmed: true,
  }]);
  emitter.getAnalyses = () => ({ '15m': { timeframe: '15m', lastClose: symbol === 'ETHUSDT' ? 3050 : 60000 } });
  emitter.getInstrumentInfo = () => ({ symbol });
  emitter.getScenarioRegistry = () => registry;
  return emitter as any;
}

function fixtureScenario(symbol: string): Scenario {
  const now = Date.now();
  return {
    id: `integration_${symbol}`, symbol, direction: 'LONG', kind: 'TRADE_SCENARIO',
    timeframe: '15m', structureType: 'TEST', proposedBy: 'OPENAI',
    modelsUsed: ['fixture'], snapshotId: 'snap-' + symbol,
    discoveryTimestamp: now, entryZoneMin: 2900, entryZoneMax: 3000,
    targetEntry: 2950, stopLossPrice: 2850, target14Price: 3350,
    rrModeAvailable: 'RR_1_4', uncertaintyLevel: 'LOW', status: 'SCENARIO_MONITORING',
    validUntilTimestamp: now + 3600000, aiCostUsd: 0,
    activationConditions: [], invalidationTriggers: [], argumentsFor: [],
    argumentsAgainst: [], createdAt: now, updatedAt: now,
  };
}

test('Multi-market API validates symbol and never returns BTC data under ETH routes', async () => {
  const db = new DatabaseService(':memory:');
  const btc = coordinatorFor('BTCUSDT', db);
  const eth = coordinatorFor('ETHUSDT', db);
  btc.getScenarioRegistry().registerScenario(fixtureScenario('BTCUSDT'));
  eth.getScenarioRegistry().registerScenario(fixtureScenario('ETHUSDT'));
  const server = new ApiServer(btc, db, 0, '127.0.0.1', new Map([
    ['BTCUSDT', btc], ['ETHUSDT', eth],
  ]));
  try {
    await server.start();
    const origin = `http://127.0.0.1:${server.getPort()}`;
    const get = async (path: string) => {
      const response = await fetch(origin + path);
      return { code: response.status, body: await response.json() as any };
    };

    const markets = await get('/api/v1/markets');
    assert.equal(markets.code, 200);
    assert.deepEqual(markets.body.data.map((s: any) => s.symbol).sort(), ['BTCUSDT', 'ETHUSDT']);

    const ethState = await get('/api/v1/markets/ETHUSDT/state');
    const btcState = await get('/api/v1/markets/BTCUSDT/state');
    assert.equal(ethState.body.data.symbol, 'ETHUSDT');
    assert.equal(ethState.body.data.ticker.lastPrice, 3050);
    assert.equal(btcState.body.data.ticker.lastPrice, 60000);

    const candles = await get('/api/v1/markets/ETHUSDT/candles?timeframe=15m');
    assert.deepEqual(candles.body.data.map((c: any) => c.symbol), ['ETHUSDT']);

    const ethScenarios = await get('/api/v1/markets/ETHUSDT/scenarios');
    const btcScenarios = await get('/api/v1/markets/BTCUSDT/scenarios');
    assert.deepEqual(ethScenarios.body.data.map((s: any) => s.symbol), ['ETHUSDT']);
    assert.deepEqual(btcScenarios.body.data.map((s: any) => s.symbol), ['BTCUSDT']);

    assert.equal((await get('/api/v1/markets/ETHUSDT/analysis')).code, 200);
    assert.equal((await get('/api/v1/markets/ETHUSDT/stats')).code, 200);
    assert.equal((await get('/api/v1/markets/ETHUSDT/scheduler')).code, 200);
    assert.equal((await get('/api/v1/markets/FAKEUSDT/state')).code, 404);
    assert.equal((await get('/api/v1/markets/ETHUSDT/candles?timeframe=2h')).code, 400);
    const unauthorized = await fetch(origin + '/api/v1/markets/ETHUSDT/discovery/trigger', { method: 'POST' });
    assert.equal(unauthorized.status, 401);
  } finally {
    await server.stop();
    db.close();
  }
});
