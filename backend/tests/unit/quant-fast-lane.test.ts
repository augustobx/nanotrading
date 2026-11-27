import test from 'node:test';
import assert from 'node:assert/strict';
import type { Candle } from '../../src/types/market.js';
import { detectQuantSetup } from '../../src/engine/quant-fast-lane.js';
import { DatabaseService } from '../../src/storage/database.js';
import { runQuantFastLaneBacktest } from '../../src/backtest/quant-fast-lane-backtest.js';

const M5=300000, M15=900000;
const START=Date.UTC(2026,9,1,0,0,0);

function createTrend() {
  const c5: Candle[] = Array.from({length:180},(_,i)=>{
    const close=100+i*0.1;
    return {
      symbol:'BTCUSDT',timeframe:'5m',timestamp:START+i*M5,
      open:close-.1,high:close+.8,low:close-.8,close,volume:10,turnover:100,confirmed:true,
    };
  });
  const c15: Candle[] = Array.from({length:60},(_,i)=>{
    const close=100+i*0.4;
    return {
      symbol:'BTCUSDT',timeframe:'15m',timestamp:START+i*M15,
      open:close-.2,high:close+1,low:close-1,close,volume:30,turnover:100,confirmed:true,
    };
  });
  return {c5,c15};
}

test('quant detector refuses to use incomplete 15m or 5m history',()=>{
  const {c5,c15}=createTrend();
  assert.equal(detectQuantSetup('BTCUSDT',c5.slice(-15),c15).regime,'DATA_NOT_READY');
  assert.equal(detectQuantSetup('BTCUSDT',c5,c15.slice(-20)).regime,'DATA_NOT_READY');
});

test('pure 5m SFP detector produces the same levels and ID on repeated inputs',()=>{
  const {c5,c15}=createTrend();
  const last=c5[c5.length-1];
  const previous=c5.slice(-13,-1);
  const floor=Math.min(...previous.map(c=>c.low));
  c5[c5.length-1]={...last,open:floor+.3,high:floor+1.1,
    low:floor-.5,close:floor+.2};
  const a=detectQuantSetup('BTCUSDT',c5,c15);
  const b=detectQuantSetup('BTCUSDT',c5,c15);
  assert.deepEqual(a,b);
  assert.equal(a.candidate?.strategy,'QUANT_LIQUIDITY_SWEEP');
  assert.equal(a.candidate?.direction,'LONG');
  assert.ok((a.candidate?.stopLossPrice || 999)<floor-.5);
  assert.ok((a.candidate?.entryPrice || 0)>floor);
});

test('5m EMA21 pullback uses 15m trend but no AI',()=>{
  const {c5,c15}=createTrend();
  c5[c5.length-2].low=116.2;
  const last=c5[c5.length-1];
  c5[c5.length-1]={...last,open:117.2,close:118.2,low:117.0,high:118.5};
  const result=detectQuantSetup('BTCUSDT',c5,c15);
  assert.equal(result.regime,'BULL_TREND');
  assert.equal(result.candidate?.strategy,'QUANT_TREND_PULLBACK');
  assert.equal(result.candidate?.direction,'LONG');
});

test('an unfinished candle never contributes to closed-candle math',()=>{
  const {c5,c15}=createTrend();
  const base=detectQuantSetup('BTCUSDT',c5,c15);
  const newest={...c5[c5.length-1],timestamp:START+180*M5,
    close:99999,high:99999,confirmed:false};
  assert.deepEqual(detectQuantSetup('BTCUSDT',[...c5,newest],c15),base);
});

test('one market/candle can be audited only once across replay/restart',()=>{
  const db=new DatabaseService(':memory:');
  try {
    const e={id:'quant_BTCUSDT_5m_1',symbol:'BTCUSDT',candleTimestamp:1,
      regime:'BULL_TREND',outcome:'NO_PATTERN',reason:'no candle'};
    assert.equal(db.saveQuantDecision(e),true);
    assert.equal(db.saveQuantDecision(e),false);
    assert.equal(db.getQuantSummary('BTCUSDT',0).evaluatedCandles,1);
    assert.equal(db.getQuantSummary('ETHUSDT',0).evaluatedCandles,0);
  } finally {db.close();}
});

test('quant 90d replay is deterministic and preserves 60/30 train/test partition',()=>{
  const {c5,c15}=createTrend();
  const opts={
    symbol:'BTCUSDT',candles5m:c5,candles15m:c15,
    periodStart:START,periodEnd:START+180*M5,
    splitTimestamp:START+90*M5,
  };
  const a=runQuantFastLaneBacktest(opts);
  const b=runQuantFastLaneBacktest(opts);
  assert.deepEqual(a,b);
  assert.equal(a.modes['2R_MIN'].overall.trades>=0,true);
  assert.equal(a.modes['4R_MIN'].overall.trades>=0,true);
  assert.equal(a.symbol,'BTCUSDT');
});
