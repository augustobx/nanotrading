import { DatabaseService } from '../src/storage/database.js';
import { BybitRestClient } from '../src/bybit/bybit-rest-client.js';
import { HistoricalDataManager } from '../src/backtest/historical-data-manager.js';
import { BacktestEngine } from '../src/backtest/backtest-engine.js';

async function main() {
  console.log('========================================================================');
  console.log('🚀 NanoLabs AI Trading — Fase 5B: Backtest Histórico Real 90 Días');
  console.log('   Símbolo: BTCUSDT | Bybit V5 Linear | SMC/ICT Estrategias A & B');
  console.log('========================================================================\n');

  const db = new DatabaseService('backend/data/trading.db');
  const restClient = new BybitRestClient();
  const dataManager = new HistoricalDataManager(restClient, db, 'BTCUSDT');

  // 1. Check data status
  console.log('🔍 [1/3] Verificando cobertura de datos históricos en SQLite...');
  let status = dataManager.getDataStatus(90);
  console.log('Estado actual de datos:');
  for (const [tf, s] of Object.entries(status.timeframes)) {
    console.log(`  - ${tf}: ${s?.count || 0} velas (esperadas ~${s?.expectedCandles || 0}) | Cobertura: ${s?.isComplete ? 'COMPLETA' : 'INCOMPLETA'}`);
  }

  // Check if we need to import
  const needsImport = Object.values(status.timeframes).some((s) => !s?.isComplete);
  if (needsImport) {
    console.log('\n📥 Descargando velas históricas de 90 días desde Bybit V5 Linear...');
    await dataManager.importAllTimeframes(90, (msg, pct) => {
      process.stdout.write(`\r   [${pct}%] ${msg.padEnd(70)}`);
    });
    console.log('\n✅ Importación completada.\n');
    status = dataManager.getDataStatus(90);
  } else {
    console.log('✅ Base de datos histórica ya cuenta con cobertura completa de 90 días.\n');
  }

  // 2. Run Backtest
  console.log('🧪 [2/3] Ejecutando Backtesting Cuantitativo (60d In-Sample + 30d Out-of-Sample)...');
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
    process.stdout.write(`\r   [${pct}%] ${step.padEnd(70)}`);
  });

  console.log('\n✅ Backtest completado con éxito.\n');

  // 3. Display Results
  console.log('========================================================================');
  console.log('📊 TABLA DE RESULTADOS OBLIGATORIA (BTCUSDT · 90 DÍAS REALES BYBIT V5)');
  console.log('========================================================================');
  console.log('| Estrategia                 | Dir   | Ratio | Trades | WinRate | Net PnL (USDT) | Net R   | Exp R | Max DD   | Profit Factor |');
  console.log('|----------------------------|-------|-------|--------|---------|----------------|---------|-------|----------|---------------|');

  const b = report.breakdown;
  const rows = [
    { name: 'Estrategia A (Trend Cont)  ', dir: 'LONG ', r: '1:2', m: b.strategyA_Long_12 },
    { name: 'Estrategia A (Trend Cont)  ', dir: 'LONG ', r: '1:4', m: b.strategyA_Long_14 },
    { name: 'Estrategia A (Trend Cont)  ', dir: 'SHORT', r: '1:2', m: b.strategyA_Short_12 },
    { name: 'Estrategia A (Trend Cont)  ', dir: 'SHORT', r: '1:4', m: b.strategyA_Short_14 },
    { name: 'Estrategia B (Sweep & Rev) ', dir: 'LONG ', r: '1:2', m: b.strategyB_Long_12 },
    { name: 'Estrategia B (Sweep & Rev) ', dir: 'LONG ', r: '1:4', m: b.strategyB_Long_14 },
    { name: 'Estrategia B (Sweep & Rev) ', dir: 'SHORT', r: '1:2', m: b.strategyB_Short_12 },
    { name: 'Estrategia B (Sweep & Rev) ', dir: 'SHORT', r: '1:4', m: b.strategyB_Short_14 },
    { name: 'CARTERA COMBINADA (No Dupl)', dir: 'AMBAS', r: 'MIX ', m: b.combinedPortfolio },
  ];

  for (const row of rows) {
    const m = row.m;
    const pnlSign = m.netPnlUsdt >= 0 ? '+' : '';
    const rSign = m.netPnlR >= 0 ? '+' : '';
    console.log(
      `| ${row.name} | ${row.dir} | ${row.r}   | ${String(m.totalTrades).padStart(6)} | ${(m.winRate.toFixed(1) + '%').padStart(7)} | ${(pnlSign + m.netPnlUsdt.toFixed(1) + '$').padStart(14)} | ${(rSign + m.netPnlR.toFixed(1) + 'R').padStart(7)} | ${(m.expectancyR.toFixed(2) + 'R').padStart(5)} | ${(m.maxDrawdownPct.toFixed(1) + '%').padStart(8)} | ${m.profitFactor.toFixed(2).padStart(13)} |`
    );
  }
  console.log('========================================================================\n');

  console.log('📌 COMPARATIVA IN-SAMPLE (60d) vs OUT-OF-SAMPLE (30d):');
  console.log(`   - IN-SAMPLE (Días 1-60):`);
  console.log(`     Trades: ${report.inSampleMetrics.totalTrades} | Win Rate: ${report.inSampleMetrics.winRate}% | Net PnL: $${report.inSampleMetrics.netPnlUsdt} (${report.inSampleMetrics.netPnlR}R) | Exp: ${report.inSampleMetrics.expectancyR}R | MaxDD: ${report.inSampleMetrics.maxDrawdownPct}% | PF: ${report.inSampleMetrics.profitFactor}`);
  console.log(`   - OUT-OF-SAMPLE (Días 61-90):`);
  console.log(`     Trades: ${report.outSampleMetrics.totalTrades} | Win Rate: ${report.outSampleMetrics.winRate}% | Net PnL: $${report.outSampleMetrics.netPnlUsdt} (${report.outSampleMetrics.netPnlR}R) | Exp: ${report.outSampleMetrics.expectancyR}R | MaxDD: ${report.outSampleMetrics.maxDrawdownPct}% | PF: ${report.outSampleMetrics.profitFactor}`);

  console.log(`\n💾 Run guardado en SQLite con ID: ${report.id}`);
  db.close();
}

main().catch((err) => {
  console.error('❌ Error en script de backtest:', err);
  process.exit(1);
});
