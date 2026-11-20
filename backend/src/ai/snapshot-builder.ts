import { createHash } from 'node:crypto';
import { MarketCoordinator } from '../market/market-coordinator.js';
import { SetupCandidate } from '../engine/strategy-a-trend.js';
import { MarketSnapshot, MarketSnapshotTimeframeSummary } from './types.js';
import { SUPPORTED_TIMEFRAMES } from '../types/market.js';

export class SnapshotBuilder {
  public static build(coordinator: MarketCoordinator, setup: SetupCandidate): MarketSnapshot {
    const marketState = coordinator.getMarketState();
    const ticker = marketState.ticker || {
      lastPrice: setup.entryPrice,
      markPrice: setup.entryPrice,
      indexPrice: setup.entryPrice,
      bid1Price: setup.entryPrice - 0.1,
      ask1Price: setup.entryPrice + 0.1,
      spread: 0.1,
      spreadPcnt: 0.0001,
      fundingRate: 0.0001,
      openInterest: 10000,
    };

    const ob = marketState.orderBook;
    const bidsTop5 = (ob?.bids || []).slice(0, 5).map(([price, size]) => ({ price, size }));
    const asksTop5 = (ob?.asks || []).slice(0, 5).map(([price, size]) => ({ price, size }));

    const multiTimeframe: Record<string, MarketSnapshotTimeframeSummary> = {};
    const analyses = coordinator.getAnalyses();

    for (const tf of SUPPORTED_TIMEFRAMES) {
      const an = analyses[tf];
      if (an) {
        multiTimeframe[tf] = {
          timeframe: tf,
          trend: an.trend,
          rsi: an.rsi,
          atr: an.atr,
          lastClose: an.lastClose,
          ema20: an.ema20,
          ema50: an.ema50,
          ema200: an.ema200,
          ema200Ready: an.ema200Ready || false,
          relativeVolume: an.relativeVolume,
          lastSwingHighPrice: an.structure?.lastSwingHigh?.price,
          lastSwingLowPrice: an.structure?.lastSwingLow?.price,
          activeFvgsCount: (an.structure?.fvgs || []).filter((f: any) => f.status === 'ACTIVE').length,
          activeObsCount: (an.structure?.orderBlocks || []).filter((o: any) => o.status === 'ACTIVE').length,
        };
      } else {
        // Fallback if timeframe analysis is pending
        multiTimeframe[tf] = {
          timeframe: tf,
          trend: 'RANGING',
          rsi: 50,
          atr: 0,
          lastClose: ticker.lastPrice,
          ema200Ready: false,
          relativeVolume: 1.0,
          activeFvgsCount: 0,
          activeObsCount: 0,
        };
      }
    }

    const timestamp = Date.now();
    const rawPayload = JSON.stringify({
      symbol: marketState.symbol,
      timestamp,
      setupId: setup.id,
      entry: setup.entryPrice,
      sl: setup.stopLossPrice,
      tp: setup.takeProfitPrice,
      netRR: setup.riskReward.netRR,
    });

    const snapshotId = `snap_${createHash('sha256').update(rawPayload).digest('hex').substring(0, 16)}`;

    return {
      snapshotId,
      timestamp,
      symbol: marketState.symbol,
      ticker: {
        lastPrice: ticker.lastPrice,
        markPrice: ticker.markPrice,
        indexPrice: ticker.indexPrice,
        bid1Price: ticker.bid1Price,
        ask1Price: ticker.ask1Price,
        spread: ticker.spread,
        spreadPcnt: ticker.spreadPcnt,
        fundingRate: ticker.fundingRate,
        openInterest: ticker.openInterest,
      },
      orderBook: {
        bestBid: ob?.bestBid || ticker.lastPrice - 0.1,
        bestAsk: ob?.bestAsk || ticker.lastPrice + 0.1,
        spread: ob?.spread || 0.1,
        spreadPcnt: ob?.spreadPcnt || 0.0001,
        imbalance: ob?.imbalance || 0,
        bidsTop5,
        asksTop5,
        isSynced: ob?.isSynced ?? false,
      },
      multiTimeframe,
      candidateSetup: JSON.parse(JSON.stringify(setup)),
      dataIntegrity: {
        wsConnected: marketState.wsConnected,
        isOrderBookSynced: ob?.isSynced ?? false,
        gapsDetectedCount: marketState.gapsDetectedCount,
        lastWsMessageAgeMs: Date.now() - (marketState.lastWsMessageTimestamp || Date.now()),
        status: marketState.status,
      },
    };
  }
}
