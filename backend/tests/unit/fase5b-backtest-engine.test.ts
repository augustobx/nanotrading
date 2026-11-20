import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseService } from '../../src/storage/database.js';
import { HistoricalDataManager } from '../../src/backtest/historical-data-manager.js';
import { BacktestEngine } from '../../src/backtest/backtest-engine.js';
import { Candle } from '../../src/types/market.js';

function createMockCandles(count: number, startPrice: number = 65000, stepMin: number = 5): Candle[] {
  const candles: Candle[] = [];
  const startTs = Date.now() - count * stepMin * 60 * 1000;
  let price = startPrice;

  for (let i = 0; i < count; i++) {
    const ts = startTs + i * stepMin * 60 * 1000;
    const wave = Math.sin(i / 10) * 150;
    const open = price + wave;
    const high = open + 60;
    const low = open - 60;
    const close = open + (i % 2 === 0 ? 30 : -30);
    price = close;

    candles.push({
      symbol: 'BTCUSDT',
      timeframe: stepMin === 5 ? '5m' : stepMin === 15 ? '15m' : stepMin === 60 ? '1h' : '4h',
      timestamp: ts,
      open: parseFloat(open.toFixed(1)),
      high: parseFloat(high.toFixed(1)),
      low: parseFloat(low.toFixed(1)),
      close: parseFloat(close.toFixed(1)),
      volume: 100 + (i % 5) * 20,
      turnover: (100 + (i % 5) * 20) * open,
      confirmed: true,
    });
  }

  return candles;
}

test('Fase 5B — Historical Data Storage: Guardado y lectura precisa de velas', () => {
  const db = new DatabaseService(':memory:');
  const dataManager = new HistoricalDataManager({} as any, db, 'BTCUSDT');

  const candles = createMockCandles(100, 65000, 15);
  const saved = db.saveHistoricalCandles(candles);
  assert.equal(saved, 100);

  const stats = db.getHistoricalCandleStats('BTCUSDT', '15m');
  assert.equal(stats.count, 100);
  assert.equal(stats.earliest, candles[0].timestamp);
  assert.equal(stats.latest, candles[99].timestamp);

  const loaded = dataManager.getCandles('15m');
  assert.equal(loaded.length, 100);
  assert.equal(loaded[0].open, candles[0].open);

  db.close();
});

test('Fase 5B — BacktestEngine: Métricas, R:R Dual (1:2 y 1:4) y Resolución Conservadora', async () => {
  const db = new DatabaseService(':memory:');
  const dataManager = new HistoricalDataManager({} as any, db, 'BTCUSDT');

  // Insert mock candles for 5m, 15m, 1h, 4h
  const c5m = createMockCandles(500, 65000, 5);
  const c15m = createMockCandles(200, 65000, 15);
  const c1h = createMockCandles(100, 65000, 60);
  const c4h = createMockCandles(50, 65000, 240);

  db.saveHistoricalCandles(c5m);
  db.saveHistoricalCandles(c15m);
  db.saveHistoricalCandles(c1h);
  db.saveHistoricalCandles(c4h);

  const engine = new BacktestEngine(dataManager, db);

  // Run backtest
  const report = await engine.runBacktest({
    symbol: 'BTCUSDT',
    days: 10,
    inSampleDays: 7,
    accountBalance: 10000,
    riskPercent: 1.0,
    makerFeeRate: 0.00020,
    takerFeeRate: 0.00055,
    spread: 0.10,
    slippageRate: 0.00020,
  });

  assert.equal(report.status, 'COMPLETED');
  assert.ok(report.id.startsWith('run_'));
  assert.ok(report.createdAt > 0);

  // Check metrics calculation integrity
  assert.ok(report.inSampleMetrics !== undefined);
  assert.ok(report.outSampleMetrics !== undefined);
  assert.ok(report.breakdown !== undefined);
  assert.ok(report.breakdown.combinedPortfolio !== undefined);

  // Verify run is stored in DB
  const storedRun = db.getBacktestRunById(report.id);
  assert.ok(storedRun !== null);
  assert.equal(storedRun.id, report.id);

  // Test metric calculation helper
  const sampleTrades: any[] = [
    {
      id: 't1', runId: 'r1', symbol: 'BTCUSDT', strategy: 'STRATEGY_A_TREND_CONTINUATION',
      direction: 'LONG', ratioTarget: 'RR_1_2', timeframe: '15m',
      entryTimestamp: 1000, exitTimestamp: 5000, entryPrice: 65000, stopLossPrice: 64500, takeProfitPrice: 66050,
      exitPrice: 66050, outcome: 'TAKE_PROFIT', realizedNetPnlUsdt: 200, realizedNetR: 2.0,
      mfePrice: 66200, mfeR: 2.4, maePrice: 64900, maeR: 0.2, durationMs: 4000, isInSample: true,
      feesUsdt: 5, spreadCostUsdt: 1, slippageCostUsdt: 1,
    },
    {
      id: 't2', runId: 'r1', symbol: 'BTCUSDT', strategy: 'STRATEGY_A_TREND_CONTINUATION',
      direction: 'LONG', ratioTarget: 'RR_1_4', timeframe: '15m',
      entryTimestamp: 6000, exitTimestamp: 9000, entryPrice: 65000, stopLossPrice: 64500, takeProfitPrice: 67100,
      exitPrice: 64500, outcome: 'STOP_LOSS', realizedNetPnlUsdt: -100, realizedNetR: -1.0,
      mfePrice: 65300, mfeR: 0.6, maePrice: 64500, maeR: 1.0, durationMs: 3000, isInSample: false,
      feesUsdt: 5, spreadCostUsdt: 1, slippageCostUsdt: 1,
    },
  ];

  const metrics = engine.calculateMetrics(sampleTrades);
  assert.equal(metrics.totalTrades, 2);
  assert.equal(metrics.wins, 1);
  assert.equal(metrics.losses, 1);
  assert.equal(metrics.winRate, 50.0);
  assert.equal(metrics.netPnlUsdt, 100);
  assert.equal(metrics.netPnlR, 1.0);
  assert.equal(metrics.expectancyR, 0.5); // (2 - 1) / 2 = 0.5R
  assert.equal(metrics.profitFactor, 2.0); // 200 / 100 = 2.0

  db.close();
});
