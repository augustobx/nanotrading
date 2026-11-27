/** Read-only offline research runner: historical Bybit V5 data already imported into SQLite. */
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import type { Candle, Timeframe } from '../types/market.js';
import { runQuantFastLaneBacktest } from '../backtest/quant-fast-lane-backtest.js';

const path = process.env.DB_SQLITE_PATH || '/app/data/trading.db';
if (!existsSync(path)) throw new Error('No existe SQLite histórica: '+path);
const symbol = process.argv.includes('--eth') ? 'ETHUSDT' : 'BTCUSDT';
const days = 90, now = Date.now();
const start = now - days*86400000, split = start+60*86400000;
const db = new DatabaseSync(path, { readOnly: true });
try {
  const candle = (tf: Timeframe): Candle[] => {
    const rows = db.prepare(`SELECT symbol, timeframe,timestamp,open,high,low,close,volume,turnover
      FROM historical_candles WHERE symbol = ? AND timeframe = ?
      AND timestamp >= ? AND timestamp < ? ORDER BY timestamp`)
      .all(symbol,tf,start-5*86400000,now) as any[];
    const period = tf === '5m' ? 300000 : 900000;
    return rows.filter(r => r.timestamp + period <= now).map(r=>({
      symbol:r.symbol,timeframe:r.timeframe,timestamp:r.timestamp,
      open:r.open,high:r.high,low:r.low,close:r.close,
      volume:r.volume,turnover:r.turnover,confirmed:true,
    }));
  };
  const five=candle('5m'),fifteen=candle('15m');
  if(five.length<24000 || fifteen.length<7900) {
    throw new Error(`Cobertura histórica insuficiente para 90 días: 5m=${five.length},15m=${fifteen.length}. Importar desde Bybit antes de evaluar.`);
  }
  // Fail closed if historical capture has missing or repeated bars.
  const ensureContinuous = (candles: Candle[], step: number, name: string) => {
    const inPeriod = candles.filter(c => c.timestamp >= start);
    if (!inPeriod.length || inPeriod[0].timestamp > start + step * 2 ||
        inPeriod[inPeriod.length-1].timestamp < now - step * 2) {
      throw new Error(`Cobertura temporal incompleta en ${name}`);
    }
    const gaps: number[] = [];
    for (let i=1;i<inPeriod.length;i++) {
      if (inPeriod[i].timestamp - inPeriod[i-1].timestamp !== step) {
        gaps.push(inPeriod[i].timestamp);
      }
    }
    if (gaps.length) throw new Error(`${name}: ${gaps.length} gaps o duplicados. Primer error ${new Date(gaps[0]).toISOString()}`);
  };
  ensureContinuous(five,300000,'5m');
  ensureContinuous(fifteen,900000,'15m');

  const result=runQuantFastLaneBacktest({symbol,candles5m:five,candles15m:fifteen,
    periodStart:start,periodEnd:now,splitTimestamp:split});
  console.log(JSON.stringify(result,null,2));
} finally {
  db.close();
}
