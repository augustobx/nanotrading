import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'events';
import { DatabaseService } from '../../src/storage/database.js';
import { SignalStateMachine } from '../../src/engine/signal-state-machine.js';
import { MarketMonitorWorker } from '../../src/engine/market-monitor-worker.js';
import { TelegramNotifier } from '../../src/notifications/telegram-notifier.js';
import { WebPushNotifier } from '../../src/notifications/web-push-notifier.js';
import { ConsensusResult } from '../../src/ai/types.js';
import { Ticker, Candle } from '../../src/types/market.js';

class MockCoordinator extends EventEmitter {
  public consensusEngine = new EventEmitter();
  public marketState = { killSwitchActive: false };

  public getMarketState() {
    return this.marketState;
  }

  public getConsensusEngine() {
    return this.consensusEngine;
  }
}

test('MarketMonitorWorker - Transitions through Approaching Zone, In Zone, and Fill Trigger to Tracking', () => {
  const db = new DatabaseService(':memory:');
  const coordinator = new MockCoordinator() as any;
  const sm = new SignalStateMachine(db);
  const tg = new TelegramNotifier(db, undefined, undefined, false);
  const push = new WebPushNotifier(db);

  const worker = new MarketMonitorWorker({
    coordinator,
    stateMachine: sm,
    telegramNotifier: tg,
    webPushNotifier: push,
    db,
  });

  worker.start();

  const consensus: ConsensusResult = {
    signalId: 'sig_worker_1',
    setupId: 'setup_worker_1',
    timestamp: Date.now(),
    symbol: 'BTCUSDT',
    strategy: 'STRATEGY_A_TREND_CONTINUATION',
    direction: 'LONG',
    timeframe: '15m',
    entryPrice: 65000,
    stopLossPrice: 64500,
    takeProfitPrice: 67100,
    grossRR: 4.2,
    netRR: 4.1,
    consensusVerdict: 'AUTHORIZED',
    status: 'ACTIVE',
    snapshotId: 'snap_w1',
    executionMode: 'SIGNALS_ONLY',
    ruleViolations: [],
    confidenceScore: 85,
    evaluatedAt: Date.now(),
  };

  // Signal authorized event
  coordinator.consensusEngine.emit('signal_authorized', consensus);
  const signal = sm.getSignal('sig_worker_1')!;
  assert.ok(signal);
  assert.equal(signal.state, 'ALERT_SENT');

  // Ticker approaching (e.g. 65100 -> ~0.15% distance, threshold is 0.25%)
  const tickerApproaching: Ticker = {
    symbol: 'BTCUSDT',
    lastPrice: 65100,
    markPrice: 65100,
    indexPrice: 65100,
    bid1Price: 65099,
    ask1Price: 65101,
    bid1Size: 1,
    ask1Size: 1,
    spread: 2,
    spreadPcnt: 0.003,
    highPrice24h: 66000,
    lowPrice24h: 64000,
    prevPrice24h: 64500,
    price24hPcnt: 0.01,
    volume24h: 1000,
    turnover24h: 65000000,
    fundingRate: 0.0001,
    nextFundingTime: Date.now() + 3600000,
    openInterest: 1000,
    openInterestValue: 65000000,
    timestamp: Date.now(),
  };

  coordinator.emit('ticker_updated', tickerApproaching);
  assert.equal(signal.state, 'APPROACHING_ZONE');

  // Ticker in zone (65010 -> 0.015% distance <= 0.05%)
  const tickerInZone = { ...tickerApproaching, lastPrice: 65010 };
  coordinator.emit('ticker_updated', tickerInZone);
  assert.equal(signal.state, 'IN_ZONE');

  // Ticker crosses entry level (64995 <= 65000) -> triggers entry
  const tickerFilled = { ...tickerApproaching, lastPrice: 64995 };
  coordinator.emit('ticker_updated', tickerFilled);
  assert.equal(signal.state, 'TRACKING');
  assert.ok(signal.simulatedEntryTime! > 0);

  // Price touches Take Profit (67150 >= 67100)
  const tickerTp = { ...tickerApproaching, lastPrice: 67150 };
  coordinator.emit('ticker_updated', tickerTp);
  assert.equal(signal.state, 'COMPLETED_TP');
  assert.equal(signal.realizedNetR, 4.1);

  worker.stop();
  db.close();
});

test('MarketMonitorWorker - Stop Loss touch transitions position to COMPLETED_SL', () => {
  const db = new DatabaseService(':memory:');
  const coordinator = new MockCoordinator() as any;
  const sm = new SignalStateMachine(db);
  const tg = new TelegramNotifier(db, undefined, undefined, false);
  const push = new WebPushNotifier(db);

  const worker = new MarketMonitorWorker({
    coordinator,
    stateMachine: sm,
    telegramNotifier: tg,
    webPushNotifier: push,
    db,
  });

  worker.start();

  const consensus: ConsensusResult = {
    signalId: 'sig_worker_sl',
    setupId: 'setup_worker_sl',
    timestamp: Date.now(),
    symbol: 'BTCUSDT',
    strategy: 'STRATEGY_A_TREND_CONTINUATION',
    direction: 'LONG',
    timeframe: '15m',
    entryPrice: 65000,
    stopLossPrice: 64500,
    takeProfitPrice: 67100,
    grossRR: 4.2,
    netRR: 4.1,
    consensusVerdict: 'AUTHORIZED',
    status: 'ACTIVE',
    snapshotId: 'snap_wsl',
    executionMode: 'SIGNALS_ONLY',
    ruleViolations: [],
    confidenceScore: 85,
    evaluatedAt: Date.now(),
  };

  coordinator.consensusEngine.emit('signal_authorized', consensus);
  const signal = sm.getSignal('sig_worker_sl')!;

  // Fill entry
  coordinator.emit('ticker_updated', { lastPrice: 65000 } as any);
  assert.equal(signal.state, 'TRACKING');

  // Price hits Stop Loss (64480 <= 64500)
  coordinator.emit('ticker_updated', { lastPrice: 64480 } as any);
  assert.equal(signal.state, 'COMPLETED_SL');
  assert.equal(signal.realizedNetR, -1.0);

  worker.stop();
  db.close();
});

test('MarketMonitorWorker - Candle close invalidates setup if SL is breached before fill', () => {
  const db = new DatabaseService(':memory:');
  const coordinator = new MockCoordinator() as any;
  const sm = new SignalStateMachine(db);
  const tg = new TelegramNotifier(db, undefined, undefined, false);
  const push = new WebPushNotifier(db);

  const worker = new MarketMonitorWorker({
    coordinator,
    stateMachine: sm,
    telegramNotifier: tg,
    webPushNotifier: push,
    db,
  });

  worker.start();

  const consensus: ConsensusResult = {
    signalId: 'sig_worker_inval',
    setupId: 'setup_worker_inval',
    timestamp: Date.now(),
    symbol: 'BTCUSDT',
    strategy: 'STRATEGY_A_TREND_CONTINUATION',
    direction: 'LONG',
    timeframe: '15m',
    entryPrice: 65000,
    stopLossPrice: 64500,
    takeProfitPrice: 67100,
    grossRR: 4.2,
    netRR: 4.1,
    consensusVerdict: 'AUTHORIZED',
    status: 'ACTIVE',
    snapshotId: 'snap_inval',
    executionMode: 'SIGNALS_ONLY',
    ruleViolations: [],
    confidenceScore: 85,
    evaluatedAt: Date.now(),
  };

  coordinator.consensusEngine.emit('signal_authorized', consensus);
  const signal = sm.getSignal('sig_worker_inval')!;
  assert.equal(signal.state, 'ALERT_SENT');

  // Closed candle breaches SL (close: 64400 <= 64500) before entry trigger
  const adverseCandle: Candle = {
    symbol: 'BTCUSDT',
    timeframe: '15m',
    timestamp: Date.now(),
    open: 64800,
    high: 64850,
    low: 64350,
    close: 64400,
    volume: 120,
    turnover: 7700000,
    confirmed: true,
  };

  coordinator.emit('candle_closed', adverseCandle);
  assert.equal(signal.state, 'INVALIDATED');

  worker.stop();
  db.close();
});

test('MarketMonitorWorker - Candle close expires setup after maxLifetimeMs', () => {
  const db = new DatabaseService(':memory:');
  const coordinator = new MockCoordinator() as any;
  const sm = new SignalStateMachine(db);
  const tg = new TelegramNotifier(db, undefined, undefined, false);
  const push = new WebPushNotifier(db);

  const worker = new MarketMonitorWorker({
    coordinator,
    stateMachine: sm,
    telegramNotifier: tg,
    webPushNotifier: push,
    db,
    maxSignalLifetimeMs: 1000, // 1 second lifetime for testing
  });

  worker.start();

  const consensus: ConsensusResult = {
    signalId: 'sig_worker_exp',
    setupId: 'setup_worker_exp',
    timestamp: Date.now() - 2000, // 2s ago
    symbol: 'BTCUSDT',
    strategy: 'STRATEGY_A_TREND_CONTINUATION',
    direction: 'LONG',
    timeframe: '15m',
    entryPrice: 65000,
    stopLossPrice: 64500,
    takeProfitPrice: 67100,
    grossRR: 4.2,
    netRR: 4.1,
    consensusVerdict: 'AUTHORIZED',
    status: 'ACTIVE',
    snapshotId: 'snap_exp',
    executionMode: 'SIGNALS_ONLY',
    ruleViolations: [],
    confidenceScore: 85,
    evaluatedAt: Date.now() - 2000,
  };

  coordinator.consensusEngine.emit('signal_authorized', consensus);
  const signal = sm.getSignal('sig_worker_exp')!;
  assert.equal(signal.state, 'ALERT_SENT');

  const regularCandle: Candle = {
    symbol: 'BTCUSDT',
    timeframe: '15m',
    timestamp: Date.now(),
    open: 65500,
    high: 65600,
    low: 65400,
    close: 65550,
    volume: 50,
    turnover: 3200000,
    confirmed: true,
  };

  coordinator.emit('candle_closed', regularCandle);
  assert.equal(signal.state, 'EXPIRED');

  worker.stop();
  db.close();
});
