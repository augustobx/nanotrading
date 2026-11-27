import type { Candle } from '../types/market.js';
import { detectQuantSetup, type QuantCandidate } from '../engine/quant-fast-lane.js';
import { RiskCalculator } from '../engine/risk-calculator.js';

export interface QuantReplayTrade {
  id: string; strategy: string; direction: 'LONG' | 'SHORT';
  signalAt: number; entryAt: number; exitAt: number;
  entry: number; stop: number; target: number; exit: number;
  result: 'TP' | 'SL' | 'TIME_EXIT';
  netR: number; netPnlUsdt: number; sample: 'IN_SAMPLE' | 'OUT_OF_SAMPLE';
}
export interface QuantReplayMetrics {
  signals: number; qualified: number; filteredRR: number; unfilled: number;
  trades: number; wins: number; losses: number;
  winRate: number; profitFactor: number; expectancyR: number;
  netR: number; maxDrawdownR: number; netPnlUsdt: number;
}
export interface QuantReplayResult {
  symbol: string; periodStart: number; periodEnd: number;
  splitTimestamp: number; evaluatedCandles: number; candidates: number;
  modes: Record<string, {
    overall: QuantReplayMetrics; inSample: QuantReplayMetrics;
    outOfSample: QuantReplayMetrics; trades: QuantReplayTrade[];
  }>;
  notes: string[];
}

const M5 = 300000;
const M15 = 900000;
const round = (x: number) => Number(x.toFixed(4));

function metrics(trades: QuantReplayTrade[], signals: number,
  qualified: number, filteredRR: number, unfilled: number): QuantReplayMetrics {
  let gains = 0, losses = 0, equity = 0, peak = 0, dd = 0, pnl = 0;
  for (const t of trades) {
    pnl += t.netPnlUsdt;
    equity += t.netR;
    peak = Math.max(peak, equity);
    dd = Math.max(dd, peak - equity);
    if (t.netPnlUsdt > 0) gains += t.netPnlUsdt;
    else losses += -t.netPnlUsdt;
  }
  const wins = trades.filter(t => t.netPnlUsdt > 0).length;
  return {
    signals, qualified, filteredRR, unfilled, trades: trades.length,
    wins, losses: trades.length - wins,
    winRate: trades.length ? round(wins / trades.length * 100) : 0,
    profitFactor: losses > 0 ? round(gains / losses) : gains > 0 ? Infinity : 0,
    expectancyR: trades.length ? round(trades.reduce((s,t) => s+t.netR,0)/trades.length) : 0,
    netR: round(trades.reduce((s,t) => s+t.netR,0)),
    maxDrawdownR: round(dd), netPnlUsdt: round(pnl),
  };
}

/** Event-driven replay of the *same pure detector* used on 5m closes live.
 * Conservative OHLC resolution. No partial TP/trailing in this baseline.
 * Only candidates with a simulated subsequent touch of entry can fill.
 */
export function runQuantFastLaneBacktest(input: {
  symbol: string; candles5m: readonly Candle[]; candles15m: readonly Candle[];
  periodStart: number; periodEnd: number; splitTimestamp: number;
  capitalUsdt?: number; riskPercent?: number; spreadUsdt?: number;
}): QuantReplayResult {
  const { symbol, periodStart, periodEnd, splitTimestamp } = input;
  const five = input.candles5m.filter(c => c.symbol === symbol && c.confirmed)
    .sort((a,b) => a.timestamp-b.timestamp);
  const fifteen = input.candles15m.filter(c => c.symbol === symbol && c.confirmed)
    .sort((a,b) => a.timestamp-b.timestamp);
  const modes: QuantReplayResult['modes'] = {};
  let evaluatedCandles = 0;
  let candidates = 0;
  const output = [2, 4].map(netMinimum => ({
    name: `${netMinimum}R_MIN`, trades: [] as QuantReplayTrade[],
    counts: { overall: [0,0,0,0], in: [0,0,0,0], out: [0,0,0,0] },
    busyUntil: -1,
  }));
  let last15 = 0;

  for (let i=60; i<five.length-1; i++) {
    const current = five[i];
    const closedAt = current.timestamp + M5;
    if (closedAt < periodStart || closedAt >= periodEnd) continue;
    while (last15 < fifteen.length &&
      fifteen[last15].timestamp + M15 <= closedAt) last15++;
    const window15 = fifteen.slice(Math.max(0,last15-120),last15);
    const window5 = five.slice(Math.max(0,i-120),i+1);
    const detection = detectQuantSetup(symbol, window5, window15);
    evaluatedCandles++;
    const cand = detection.candidate;
    if (!cand) continue;
    candidates++;
    const sample = closedAt < splitTimestamp ? 'IN_SAMPLE' : 'OUT_OF_SAMPLE';
    for (const mode of output) {
      const counts = mode.counts;
      counts.overall[0]++;
      (sample === 'IN_SAMPLE' ? counts.in : counts.out)[0]++;
      if (i <= mode.busyUntil) continue;
      const grossRatio = mode.name === '2R_MIN' ? 2.8 : 4.9;
      const target = cand.entryPrice +
        (cand.direction === 'LONG' ? 1 : -1) * cand.riskDistance * grossRatio;
      const r = RiskCalculator.calculate({
        direction: cand.direction, entryPrice: cand.entryPrice,
        stopLossPrice: cand.stopLossPrice, takeProfitPrice: target,
        accountBalance: input.capitalUsdt ?? 10000,
        riskPercent: input.riskPercent ?? 0.5,
        tickSize: symbol === 'BTCUSDT' ? 0.1 : 0.01,
        qtyStep: symbol === 'BTCUSDT' ? 0.001 : 0.01,
        minOrderQty: symbol === 'BTCUSDT' ? 0.001 : 0.01,
        spread: input.spreadUsdt ?? (symbol === 'BTCUSDT' ? 0.1 : 0.02),
        minRequiredRR: netMinimum,
      });
      if (!r.isValid || r.netLossUSDT <= 0) {
        counts.overall[2]++;
        (sample === 'IN_SAMPLE' ? counts.in : counts.out)[2]++;
        continue;
      }
      counts.overall[1]++;
      (sample === 'IN_SAMPLE' ? counts.in : counts.out)[1]++;
      let fill = -1;
      for (let j=i+1; j<=Math.min(i+6,five.length-1);j++) {
        const c=five[j];
        if (c.timestamp + M5 > periodEnd) break;
        if (c.low <= r.entryPrice && c.high >= r.entryPrice) { fill=j;break; }
      }
      if (fill < 0) {
        counts.overall[3]++;
        (sample === 'IN_SAMPLE' ? counts.in : counts.out)[3]++;
        continue;
      }

      const long=cand.direction==='LONG';
      let exitIndex=fill, exit=r.entryPrice;
      let result: QuantReplayTrade['result']='TIME_EXIT';
      const end=Math.min(five.length-1, fill+96);
      for(let j=fill;j<=end;j++){
        const bar=five[j];
        const sl=long ? bar.low<=r.stopLossPrice : bar.high>=r.stopLossPrice;
        // Same-bar TP at fill is unknowable: cannot claim it.
        const tp=j>fill && (long ? bar.high>=r.takeProfitPrice : bar.low<=r.takeProfitPrice);
        if(sl) {
          result='SL';
          // A gap through stop must be worse than the requested stop.
          exit=long?Math.min(bar.open,r.stopLossPrice):Math.max(bar.open,r.stopLossPrice);
          exitIndex=j;break;
        }
        if(tp){ result='TP';exit=r.takeProfitPrice;exitIndex=j;break;}
        exitIndex=j;exit=bar.close;
        if(bar.timestamp + M5 >= periodEnd) break;
      }
      const qty=r.positionSizeBTC;
      const pnl=result==='SL' && exit===r.stopLossPrice ? -r.netLossUSDT :
        result==='TP' ? r.netRewardUSDT :
        (long ? exit-r.entryPrice : r.entryPrice-exit)*qty -
        (r.entryPrice+exit)*qty*0.00055 -
        qty*(input.spreadUsdt ?? 0.1)*0.5 -
        (r.entryPrice+exit)*qty*0.0002;
      const trade: QuantReplayTrade={
        id:`${cand.id}_${mode.name}`, strategy:cand.strategy, direction:cand.direction,
        signalAt:closedAt, entryAt:five[fill].timestamp,
        exitAt:five[exitIndex].timestamp, entry:r.entryPrice,
        stop:r.stopLossPrice,target:r.takeProfitPrice,exit,
        result,netR:round(pnl/r.netLossUSDT),netPnlUsdt:round(pnl),sample,
      };
      mode.trades.push(trade);
      mode.busyUntil=exitIndex;
    }
  }
  for (const mode of output) {
    const c=mode.counts;
    modes[mode.name]={
      overall:metrics(mode.trades,...c.overall as [number,number,number,number]),
      inSample:metrics(mode.trades.filter(t=>t.sample==='IN_SAMPLE'),...c.in as [number,number,number,number]),
      outOfSample:metrics(mode.trades.filter(t=>t.sample==='OUT_OF_SAMPLE'),...c.out as [number,number,number,number]),
      trades:mode.trades,
    };
  }
  return {
    symbol, periodStart, periodEnd, splitTimestamp, evaluatedCandles,candidates,modes,
    notes:[
      'Cierre 5m -> señal; entrada solo si una vela posterior vuelve a tocarla, máximo 6 velas.',
      'Si SL y TP se tocan en la misma vela se prioriza SL; no se acredita TP en la vela de entrada.',
      'Incluye fees taker, spread y slippage nominal vía RiskCalculator; no incluye funding ni parcial/trailing.',
      'No equivale todavía a paridad tick-by-tick de producción; requiere replay y paper prospectivo.',
    ],
  };
}
