import { createHash } from 'node:crypto';
import { MarketCoordinator } from '../market/market-coordinator.js';
import { SetupCandidate } from '../engine/strategy-a-trend.js';
import { MarketSnapshot, MarketSnapshotTimeframeSummary } from './types.js';
import { SUPPORTED_TIMEFRAMES } from '../types/market.js';

export class SnapshotBuilder {
  public static build(coordinator: MarketCoordinator, setup?: SetupCandidate | any): MarketSnapshot {
    const marketState = coordinator.getMarketState();
    const fallbackPrice = marketState.ticker?.lastPrice || 65000;
    const effectiveSetup = setup || {
      id: `setup_disc_${Date.now()}`,
      symbol: marketState.symbol || 'BTCUSDT',
      strategy: 'AI_DISCRETIONARY_DISCOVERY',
      direction: 'NEUTRAL',
      timeframe: '15m',
      entryPrice: fallbackPrice,
      stopLossPrice: fallbackPrice - 500,
      takeProfitPrice: fallbackPrice + 2000,
      riskReward: { grossRR: 4.0, netRR: 4.0, isValid: true },
      evidence: ['Snapshot para análisis de mercado autónomo'],
    };

    const ticker = marketState.ticker || {
      lastPrice: effectiveSetup.entryPrice,
      markPrice: effectiveSetup.entryPrice,
      indexPrice: effectiveSetup.entryPrice,
      bid1Price: effectiveSetup.entryPrice - 0.1,
      ask1Price: effectiveSetup.entryPrice + 0.1,
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
      setupId: effectiveSetup.id,
      entry: effectiveSetup.entryPrice,
      sl: effectiveSetup.stopLossPrice,
      tp: effectiveSetup.takeProfitPrice,
      netRR: effectiveSetup.riskReward?.netRR || 4.0,
      ticker: marketState.ticker,
      orderBook: ob,
      multiTimeframe,
      marketStatus: marketState.status,
      gapsDetectedCount: marketState.gapsDetectedCount,
      lastWsMessageTimestamp: marketState.lastWsMessageTimestamp,
      candidateSetup: effectiveSetup,
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
      candidateSetup: JSON.parse(JSON.stringify(effectiveSetup)),
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
