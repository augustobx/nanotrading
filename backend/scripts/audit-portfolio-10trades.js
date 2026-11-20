import { DatabaseService } from '../dist/storage/database.js';

const db = new DatabaseService('backend/data/trading.db');
const trades = db.getBacktestTrades('run_1795208052613_ead8da', 500);
console.log('Total trades in run:', trades.length);

// Sort chronologically
const sorted = [...trades].sort((a, b) => a.entryTimestamp - b.entryTimestamp);
const signalsByTimestamp = new Map();
for (const t of sorted) {
  const list = signalsByTimestamp.get(t.entryTimestamp) || [];
  list.push(t);
  signalsByTimestamp.set(t.entryTimestamp, list);
}

console.log('Unique signal timestamps:', signalsByTimestamp.size);

let currentCapital = 10000;
let peakCapital = 10000;
let busyUntil = 0;
let isHalted = false;
let tradeIdx = 0;

console.log('\n--- SEQUENCE OF EXECUTED PORTFOLIO TRADES ---');
for (const [timestamp, candidates] of signalsByTimestamp.entries()) {
  if (timestamp < busyUntil) continue;
  if (isHalted) {
    console.log(`[HALTED] Skipping trade at ${new Date(timestamp).toISOString()} because account is halted.`);
    continue;
  }

  const chosen = candidates.find(c => c.ratioTarget === 'RR_1_4') || candidates[0];
  tradeIdx++;
  const capitalBefore = Number(currentCapital.toFixed(2));
  const tradeNetPnl = chosen.realizedNetPnlUsdt;
  const capitalAfter = Number((capitalBefore + tradeNetPnl).toFixed(2));
  currentCapital = Math.max(0, capitalAfter);
  if (currentCapital > peakCapital) peakCapital = currentCapital;

  const currentDd = peakCapital > 0 ? ((peakCapital - currentCapital) / peakCapital) * 100 : 0;
  
  console.log(`Trade #${tradeIdx}: Strategy=${chosen.strategy} Dir=${chosen.direction} EntryTime=${new Date(chosen.entryTimestamp).toISOString()} ExitTime=${new Date(chosen.exitTimestamp).toISOString()} Entry=${chosen.entryPrice} SL=${chosen.stopLossPrice} Exit=${chosen.exitPrice} Outcome=${chosen.outcome} PnL=$${chosen.realizedNetPnlUsdt} R=${chosen.realizedNetR} CapBefore=$${capitalBefore} CapAfter=$${capitalAfter} Peak=$${peakCapital} Drawdown=${currentDd.toFixed(2)}% InitialRisk=$${chosen.initialRiskUsdt} PosSize=${chosen.positionSizeBtc} Fees=$${chosen.feesUsdt}`);

  if (currentDd >= 30 || currentCapital < 1000) {
    isHalted = true;
    console.log(`>>> KILL SWITCH / MARGIN HALT ACTIVATED at Trade #${tradeIdx} (Current DD: ${currentDd.toFixed(2)}% >= 30%) <<<`);
  }

  busyUntil = chosen.exitTimestamp;
}

db.close();
