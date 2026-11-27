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
    return rows.map(r=>({
      symbol:r.symbol,timeframe:r.timeframe,timestamp:r.timestamp,
      open:r.open,high:r.high,low:r.low,close:r.close,
      volume:r.volume,turnover:r.turnover,confirmed:true,
    }));
  };
  const five=candle('5m'),fifteen=candle('15m');
  if(five.length<24000 || fifteen.length<7900) {
    throw new Error(`Cobertura histórica insuficiente para 90 días: 5m=${five.length},15m=${fifteen.length}. Importar desde Bybit antes de evaluar.`);
  }
  const result=runQuantFastLaneBacktest({symbol,candles5m:five,candles15m:fifteen,
    periodStart:start,periodEnd:now,splitTimestamp:split});
  console.log(JSON.stringify(result,null,2));
} finally {
  db.close();
}
