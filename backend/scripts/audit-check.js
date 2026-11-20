async function main() {
  const tradesRes = await fetch('http://localhost:3001/api/v1/backtest/runs/run_1795204982010_11688d/trades');
  const tradesJson = await tradesRes.json();
  const trades = tradesJson.data || [];
  
  const groups = {};
  for (const t of trades) {
    const key = `${t.strategy}__${t.direction}__${t.ratioTarget}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(t);
  }
  
  console.log(`Groups found: ${Object.keys(groups).length}`);
  for (const [key, list] of Object.entries(groups)) {
    const wins = list.filter(t => t.outcome === 'TAKE_PROFIT');
    const losses = list.filter(t => t.outcome === 'STOP_LOSS');
    const expired = list.filter(t => t.outcome === 'EXPIRED');
    
    let sumPnl = 0;
    let sumR = 0;
    for (const t of list) {
      sumPnl += t.realizedNetPnlUsdt;
      sumR += t.realizedNetR;
    }
    
    let winPnl = 0, winR = 0;
    for (const w of wins) { winPnl += w.realizedNetPnlUsdt; winR += w.realizedNetR; }
    
    let lossPnl = 0, lossR = 0;
    for (const l of losses) { lossPnl += l.realizedNetPnlUsdt; lossR += l.realizedNetR; }
    
    console.log(`\n--------------------------------------------------`);
    console.log(`Group: ${key}`);
    console.log(`Total: ${list.length} | Wins: ${wins.length} (${(wins.length/list.length*100).toFixed(1)}%) | Losses: ${losses.length} | Expired: ${expired.length}`);
    console.log(`Reported Net PnL: $${sumPnl.toFixed(2)} USDT | Reported Net R: ${sumR.toFixed(2)}R`);
    console.log(`Wins: PnL=$${winPnl.toFixed(2)}, R=${winR.toFixed(2)}R, AvgWinR=${(winR/(wins.length||1)).toFixed(2)}R`);
    console.log(`Losses: PnL=$${lossPnl.toFixed(2)}, R=${lossR.toFixed(2)}R, AvgLossPnL=$${(lossPnl/(losses.length||1)).toFixed(2)}`);
    
    // Inspect each win in this group
    console.log(`Wins list:`);
    wins.forEach((w, i) => {
      console.log(`  Win #${i+1}: Entry=${w.entryPrice}, Exit=${w.exitPrice}, PnL=$${w.realizedNetPnlUsdt}, R=${w.realizedNetR}R, Fees=$${w.feesUsdt}`);
    });
  }
}

main().catch(console.error);
