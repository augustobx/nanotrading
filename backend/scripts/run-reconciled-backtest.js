import { DatabaseService } from '../dist/storage/database.js';
import { BybitRestClient } from '../dist/bybit/bybit-rest-client.js';
import { HistoricalDataManager } from '../dist/backtest/historical-data-manager.js';
import { BacktestEngine } from '../dist/backtest/backtest-engine.js';

async function main() {
  console.log('========================================================================');
  console.log(' NanoLabs AI Trading — Auditoría Fase 5B & Ejecución Conciliada');
  console.log(' Símbolo: BTCUSDT | Motor Canónico 1R = netLossUSDT | Swings Estructurales');
  console.log('========================================================================\n');

  const db = new DatabaseService('backend/data/trading.db');
  const restClient = new BybitRestClient();
  const dataManager = new HistoricalDataManager(restClient, db, 'BTCUSDT');

  const status = dataManager.getDataStatus(90);
  console.log(`[1/3] Estado de datos: ${status.totalCandles} velas en SQLite.`);

  console.log('[2/3] Ejecutando simulación canónica (90 días, 60 in-sample, 30 out-of-sample)...');
  const engine = new BacktestEngine(dataManager, db);

  const report = await engine.runBacktest({
    symbol: 'BTCUSDT',
    days: 90,
    inSampleDays: 60,
    accountBalance: 10000,
    riskPercent: 1.0,
    makerFeeRate: 0.00020,
    takerFeeRate: 0.00055,
    spread: 0.10,
    slippageRate: 0.00020,
  }, (step, pct) => {
    process.stdout.write(`\r   [${pct}%] ${step.padEnd(65)}`);
  });

  console.log('\n\n✅ Backtest finalizado y persistido con éxito en trading.db.\n');
  console.log(`Run ID generado: ${report.id}`);
  console.log(`Trades totales en Cartera Ejecutada: ${report.totalTrades}`);
  console.log(`WinRate Cartera: ${report.winRate}%`);
  console.log(`Net PnL Cartera: $${report.netPnlUsdt} USDT`);
  console.log(`Net R Cartera: ${report.netPnlR}R`);
  console.log(`Max Drawdown Cartera: ${report.maxDrawdownPct}%\n`);

  console.log('================================================================================================================');
  console.log('| Estrategia                     | Dir   | Ratio | Trades | WinRate  | Net PnL (USDT) | Net R    | Exp R   | Max DD   |');
  console.log('|--------------------------------|-------|-------|--------|----------|----------------|----------|---------|----------|');

  const b = report.breakdown;
  const rows = [
    { name: 'Estrategia A (Trend Cont)      ', dir: 'LONG ', r: '1:2', m: b.strategyA_Long_12 },
    { name: 'Estrategia A (Trend Cont)      ', dir: 'LONG ', r: '1:4', m: b.strategyA_Long_14 },
    { name: 'Estrategia A (Trend Cont)      ', dir: 'SHORT', r: '1:2', m: b.strategyA_Short_12 },
    { name: 'Estrategia A (Trend Cont)      ', dir: 'SHORT', r: '1:4', m: b.strategyA_Short_14 },
    { name: 'Estrategia B (Sweep & Reversal)', dir: 'LONG ', r: '1:2', m: b.strategyB_Long_12 },
    { name: 'Estrategia B (Sweep & Reversal)', dir: 'LONG ', r: '1:4', m: b.strategyB_Long_14 },
    { name: 'Estrategia B (Sweep & Reversal)', dir: 'SHORT', r: '1:2', m: b.strategyB_Short_12 },
    { name: 'Estrategia B (Sweep & Reversal)', dir: 'SHORT', r: '1:4', m: b.strategyB_Short_14 },
    { name: '>> CARTERA EJECUTADA (COMBINADA)', dir: 'ALL  ', r: 'REAL', m: b.combinedPortfolio },
  ];

  for (const row of rows) {
    const m = row.m;
    const trades = String(m.totalTrades).padStart(6);
    const wr = `${m.winRate.toFixed(1)}%`.padStart(8);
    const pnl = `$${m.netPnlUsdt.toFixed(2)}`.padStart(14);
    const r = `${m.netPnlR.toFixed(2)}R`.padStart(8);
    const exp = `${m.expectancyR.toFixed(2)}R`.padStart(7);
    const dd = `${m.maxDrawdownPct.toFixed(1)}%`.padStart(8);
    console.log(`| ${row.name} | ${row.dir} | ${row.r}   | ${trades} | ${wr} | ${pnl} | ${r} | ${exp} | ${dd} |`);
  }
  console.log('================================================================================================================\n');

  // Verify trade-by-trade mathematical integrity
  console.log('🔍 [3/3] Verificando invariante matemático en los trades de la cartera:');
  const trades = report.trades;
  let inconsistencies = 0;
  for (const t of trades) {
    if (t.realizedNetPnlUsdt < 0 && t.realizedNetR > 0) {
      console.error(`❌ INCONSISTENCIA: Trade ${t.id} tiene USDT negativo ($${t.realizedNetPnlUsdt}) y R positivo (${t.realizedNetR}R)!`);
      inconsistencies++;
    }
    if (t.realizedNetPnlUsdt > 0 && t.realizedNetR < 0) {
      console.error(`❌ INCONSISTENCIA: Trade ${t.id} tiene USDT positivo ($${t.realizedNetPnlUsdt}) y R negativo (${t.realizedNetR}R)!`);
      inconsistencies++;
    }
  }

  if (inconsistencies === 0) {
    console.log(`✅ ¡CERO INCONSISTENCIAS! Todos los ${trades.length} trades cumplen rigurosamente: PnL < 0 <=> R < 0 y PnL > 0 <=> R > 0.`);
  }

  db.close();
}

main().catch(console.error);
