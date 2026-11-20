import { DatabaseService } from '../dist/storage/database.js';

const db = new DatabaseService('backend/data/trading.db');
const credsOpenAi = db.getAiCredentials('openai');
const credsGemini = db.getAiCredentials('gemini');
console.log('Creds OpenAI exists:', !!credsOpenAi, 'status:', credsOpenAi?.status, 'model:', credsOpenAi?.model, 'masked:', credsOpenAi?.apiKeyMasked);
console.log('Creds Gemini exists:', !!credsGemini, 'status:', credsGemini?.status, 'model:', credsGemini?.model, 'masked:', credsGemini?.apiKeyMasked);

const runs = db.getBacktestRuns(1);
if (runs.length > 0) {
  const r = runs[0];
  console.log('\nLatest Run:', r.id, 'MaxDD:', r.maxDrawdownPct, 'NetPnl:', r.netPnlUsdt, 'NetR:', r.netPnlR);
  const trades = db.getBacktestTrades(r.id, 200);
  const executed = trades.filter(t => t.isExecutedInPortfolio);
  console.log('Total executed in portfolio:', executed.length);
  let peak = 10000;
  for (let i = 0; i < executed.length; i++) {
    const t = executed[i];
    const before = t.capitalBeforeUsdt ?? 10000;
    const after = t.capitalAfterUsdt ?? before + t.realizedNetPnlUsdt;
    if (before > peak) peak = before;
    const dd = ((peak - after) / peak) * 100;
    console.log(`Trade #${i+1}: Strategy=${t.strategy} Dir=${t.direction} Outcome=${t.outcome} Entry=${t.entryPrice} SL=${t.stopLossPrice} Exit=${t.exitPrice} PnL=$${t.realizedNetPnlUsdt} R=${t.realizedNetR} CapBefore=$${before.toFixed(2)} CapAfter=$${after.toFixed(2)} InstantDD=${dd.toFixed(2)}% InitialRisk=$${t.initialRiskUsdt}`);
  }
}
db.close();
