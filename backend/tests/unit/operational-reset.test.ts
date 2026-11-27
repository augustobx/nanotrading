import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { DatabaseService } from '../../src/storage/database.js';

test('offline reset refuses missing approval, then deletes only operational data with valid cold tar',()=>{
  const dir=mkdtempSync(join(tmpdir(),'nanotrading-reset-'));
  const dbPath=join(dir,'trading.db');
  const backupPath=join(dir,'sqlite-volume.tar');
  const script=fileURLToPath(new URL('../../src/scripts/reset-operational-history.ts',import.meta.url));
  try {
    const database=new DatabaseService(dbPath);
    database.saveQuantDecision({
      id:'quant_BTCUSDT_5m_1',symbol:'BTCUSDT',candleTimestamp:1,
      regime:'BULL_TREND',outcome:'NO_PATTERN',reason:'fixture',
    });
    database.saveSetup({
      id:'fixture_setup',timestamp:1,symbol:'BTCUSDT',strategy:'TEST',
      direction:'LONG',timeframe:'5m',entryPrice:101,stopLoss:100,
      takeProfit:104,rrRatio:3,status:'SETUP_DETECTED',evidence:[],
    });
    database.close();
    const sql=new DatabaseSync(dbPath);
    sql.prepare(`INSERT INTO historical_candles
      (symbol,timeframe,timestamp,open,high,low,close,volume,turnover)
      VALUES('BTCUSDT','5m',1,100,102,99,101,10,1000)`).run();
    sql.prepare(`INSERT INTO admin_credentials
      (id,password_hash,salt,created_at,updated_at)
      VALUES('primary','fake-hash','fake-salt',1,1)`).run();
    sql.close();

    const tar=spawnSync('tar',['-cf',backupPath,'-C',dir,'trading.db']);
    assert.equal(tar.status,0);

    const params={
      cwd: process.cwd(),
      env:{...process.env,DB_SQLITE_PATH:dbPath,CONFIRMED_BACKUP_FILE:backupPath},
      encoding:'utf8' as const,
    };
    const denied=spawnSync(process.execPath,['--import','tsx',script],params);
    assert.notEqual(denied.status,0,'no confirmation must not delete anything');
    const count=(table:string)=>{
      const db=new DatabaseSync(dbPath,{readOnly:true});
      try {return Number((db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get() as {n:number}).n);}
      finally {db.close();}
    };
    assert.equal(count('quant_decisions'),1);
    const executed=spawnSync(process.execPath,['--import','tsx',script],{
      ...params,
      env:{...params.env,CONFIRM_OPERATIONAL_RESET:'DELETE_NON_CONFIG_DATA'},
    });
    assert.equal(executed.status,0,executed.stderr);
    assert.equal(count('quant_decisions'),0);
    assert.equal(count('setups'),0);
    assert.equal(count('historical_candles'),1,'90d OHLC research is preserved');
    assert.equal(count('admin_credentials'),1,'admin login must survive');
  } finally {rmSync(dir,{recursive:true,force:true});}
});
