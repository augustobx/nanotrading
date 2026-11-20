import { DatabaseService } from '../dist/storage/database.js';
import { BybitRestClient } from '../dist/bybit/bybit-rest-client.js';
import { HistoricalDataManager } from '../dist/backtest/historical-data-manager.js';
import { SmcDetector } from '../dist/engine/smc-detector.js';
import { StrategyATrendContinuation } from '../dist/engine/strategy-a-trend.js';
import { RiskCalculator } from '../dist/engine/risk-calculator.js';

async function main() {
  const db = new DatabaseService('backend/data/trading.db');
  const restClient = new BybitRestClient();
  const dataManager = new HistoricalDataManager(restClient, db, 'BTCUSDT');

  const candles5m = dataManager.getCandles('5m', 90);
  const candles15m = dataManager.getCandles('15m', 90);
  const candles1h = dataManager.getCandles('1h', 90);
  const candles4h = dataManager.getCandles('4h', 90);

  console.log(`Loaded: 5m=${candles5m.length}, 15m=${candles15m.length}, 1h=${candles1h.length}, 4h=${candles4h.length}`);

  let diffCount = 0;
  let sameCount = 0;
  let only12Count = 0;
  let only14Count = 0;

  for (let i = 200; i < candles5m.length; i += 20) {
    const c5 = candles5m[i];
    const w15 = candles15m.filter(c => c.timestamp <= c5.timestamp).slice(-50);
    const w1h = candles1h.filter(c => c.timestamp <= c5.timestamp).slice(-50);
    const w4h = candles4h.filter(c => c.timestamp <= c5.timestamp).slice(-50);
    const w5m = candles5m.slice(Math.max(0, i - 49), i + 1);

    const setup = StrategyATrendContinuation.evaluate(w4h, w1h, w15, w5m, 0.1);
    if (!setup) continue;

    const struct1h = SmcDetector.analyzeStructure(w1h, '1h');
    const struct15m = SmcDetector.analyzeStructure(w15, '15m');

    const entry = setup.entryPrice;
    const isLong = setup.direction === 'LONG';

    // Collect candidates
    const rawCandidates = [];
    if (isLong) {
      struct15m.swings.filter(s => s.type === 'HIGH' && s.price > entry).forEach(s => rawCandidates.push({ price: s.price, desc: `Swing High 15m ($${s.price})` }));
      struct1h.swings.filter(s => s.type === 'HIGH' && s.price > entry).forEach(s => rawCandidates.push({ price: s.price, desc: `Swing High 1H ($${s.price})` }));
      struct15m.fvgs.filter(f => f.bottom > entry).forEach(f => rawCandidates.push({ price: f.bottom, desc: `FVG 15m ($${f.bottom})` }));
      if (setup.takeProfitPrice > entry) rawCandidates.push({ price: setup.takeProfitPrice, desc: `Swing High Mayor ($${setup.takeProfitPrice})` });
    } else {
      struct15m.swings.filter(s => s.type === 'LOW' && s.price < entry).forEach(s => rawCandidates.push({ price: s.price, desc: `Swing Low 15m ($${s.price})` }));
      struct1h.swings.filter(s => s.type === 'LOW' && s.price < entry).forEach(s => rawCandidates.push({ price: s.price, desc: `Swing Low 1H ($${s.price})` }));
      struct15m.fvgs.filter(f => f.top < entry).forEach(f => rawCandidates.push({ price: f.top, desc: `FVG 15m ($${f.top})` }));
      if (setup.takeProfitPrice < entry) rawCandidates.push({ price: setup.takeProfitPrice, desc: `Swing Low Mayor ($${setup.takeProfitPrice})` });
    }

    // Deduplicate & evaluate
    const evaluated = [];
    const seenPrices = new Set();
    for (const cand of rawCandidates) {
      const p = RiskCalculator.roundToTick(cand.price, 0.1);
      if (seenPrices.has(p)) continue;
      seenPrices.add(p);
      const calc = RiskCalculator.calculate({
        direction: setup.direction,
        entryPrice: entry,
        stopLossPrice: setup.stopLossPrice,
        takeProfitPrice: p,
        accountBalance: 10000,
        riskPercent: 1.0,
        minRequiredRR: 0.1,
      });
      if (calc.isValid) {
        evaluated.push({ price: p, desc: cand.desc, netRR: calc.netRR, calc });
      }
    }

    if (isLong) evaluated.sort((a, b) => a.price - b.price);
    else evaluated.sort((a, b) => b.price - a.price);

    const m12 = evaluated.find(e => e.netRR >= 2.0);
    const m14 = evaluated.find(e => e.netRR >= 4.0);

    if (m12 && m14) {
      if (m12.price !== m14.price) {
        diffCount++;
        console.log(`[DIFF] Entry: ${entry} | 1:2 TP: ${m12.price} (${m12.netRR}R, ${m12.desc}) | 1:4 TP: ${m14.price} (${m14.netRR}R, ${m14.desc})`);
      } else {
        sameCount++;
        console.log(`[SAME] Entry: ${entry} | Single TP: ${m12.price} (${m12.netRR}R, ${m12.desc})`);
      }
    } else if (m12 && !m14) {
      only12Count++;
      console.log(`[ONLY 1:2] Entry: ${entry} | 1:2 TP: ${m12.price} (${m12.netRR}R) | 1:4 Excluded`);
    } else if (!m12 && m14) {
      only14Count++;
    }
  }

  console.log(`\nSummary: DIFF=${diffCount}, SAME=${sameCount}, ONLY_1_2=${only12Count}, ONLY_1_4=${only14Count}`);
  db.close();
}

main().catch(console.error);
