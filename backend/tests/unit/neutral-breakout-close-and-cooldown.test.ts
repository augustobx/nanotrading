import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseService } from '../../src/storage/database.js';
import { AlgorithmicWatcher } from '../../src/engine/algorithmic-watcher.js';
import { ScenarioRegistry } from '../../src/engine/scenario-registry.js';
import { AutonomousDiscoveryScheduler } from '../../src/ai/autonomous-discovery-scheduler.js';
import type { Scenario } from '../../src/ai/scenario-types.js';

const FIFTEEN = 15 * 60 * 1000;
const startOfCurrent15m = () => Math.floor(Date.now() / FIFTEEN) * FIFTEEN;

function neutral(id: string, timestamp: number): Scenario {
  return {
    id, symbol: 'BTCUSDT', direction: 'NEUTRAL',
    kind: 'NEUTRAL_OBSERVATION', timeframe: '15m',
    structureType: 'RANGING_NO_CONFLUENCE', proposedBy: 'OPENAI',
    modelsUsed: ['fixture'], snapshotId: `snapshot_${id}`,
    discoveryTimestamp: timestamp, entryZoneMin: 100, entryZoneMax: 110,
    targetEntry: 105, stopLossPrice: 100,
    rrModeAvailable: 'NONE', uncertaintyLevel: 'HIGH',
    status: 'NO_TRADE_OBSERVATION',
    validUntilTimestamp: Date.now() + 60 * 60 * 1000,
    aiCostUsd: 0, activationConditions: [], invalidationTriggers: [],
    argumentsFor: [], argumentsAgainst: [], createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function buildWatcher() {
  const db = new DatabaseService(':memory:');
  const registry = new ScenarioRegistry(db, 'BTCUSDT');
  const confirmed: number[] = [];
  let candles: any[] = [];
  const coordinator = new EventEmitter() as EventEmitter & Record<string, any>;
  coordinator.getCandleManager = () => ({ getCandles: () => candles });
  coordinator.getMarketState = () => ({ symbol: 'BTCUSDT', ticker: { lastPrice: 112 } });
  coordinator.getDiscoveryScheduler = () => ({
    queueConfirmedNeutralBreakout: (price: number) => confirmed.push(price),
  });
  const watcher = new AlgorithmicWatcher(coordinator as any, registry);
  return {
    db, registry, watcher, confirmed,
    addCandle: (candle: any) => { candles.push(candle); },
    setHistory: (timestamp: number, count: number) => {
      candles = Array.from({ length: count }, (_, i) => ({
        symbol: 'BTCUSDT', timeframe: '15m', confirmed: true,
        timestamp: timestamp - (count - i) * FIFTEEN, volume: 10,
      }));
    },
  };
}

const candle = (timestamp: number, close: number, volume: number) => ({
  symbol: 'BTCUSDT', timeframe: '15m', timestamp, confirmed: true,
  open: 105, high: Math.max(close, 105), low: 100, close, volume,
});

test('neutral tick beyond resistance is visible but never a signal or AI discovery', () => {
  const ctx = buildWatcher();
  try {
    const t = startOfCurrent15m() + 5000;
    ctx.registry.registerScenario(neutral('tick-only', t));
    ctx.watcher.evaluateTick(113);
    const s = ctx.registry.getScenario('tick-only');
    assert.equal(s?.status, 'NO_TRADE_OBSERVATION');
    assert.equal(s?.neutralBreakoutProgress?.state, 'OUTSIDE_AWAITING_CLOSE');
    assert.equal(s?.neutralBreakoutProgress?.side, 'CEILING');
    assert.deepEqual(ctx.confirmed, []);
    const persisted = ctx.db.getScenarioById('tick-only');
    assert.equal(persisted?.neutralBreakoutProgress?.state, 'OUTSIDE_AWAITING_CLOSE');

    ctx.watcher.evaluateTick(114);
    assert.equal(ctx.registry.getLifecycle('tick-only').filter(
      e => e.metadata?.progress === 'OUTSIDE_AWAITING_CLOSE').length, 1,
      'should not write a lifecycle event for every tick');
    ctx.watcher.evaluateTick(106);
    assert.equal(ctx.registry.getScenario('tick-only')?.neutralBreakoutProgress?.state,
      'BACK_INSIDE_RANGE');
  } finally { ctx.db.close(); }
});

test('15m candle opened before discovery but CLOSED after discovery confirms on RVOL', () => {
  const ctx = buildWatcher();
  try {
    const opened = startOfCurrent15m();
    const discovered = opened + 15000;
    ctx.registry.registerScenario(neutral('close-after-discovery', discovered));
    ctx.setHistory(opened, 20);
    ctx.watcher.evaluateCandleClose(candle(opened, 112, 15));
    const s = ctx.registry.getScenario('close-after-discovery');
    assert.equal(s?.status, 'COMPLETED');
    assert.equal(s?.neutralBreakoutProgress?.state, 'BREAKOUT_CONFIRMED');
    assert.equal(s?.neutralBreakoutProgress?.relativeVolume, 1.5);
    assert.deepEqual(ctx.confirmed, [112]);
  } finally { ctx.db.close(); }
});

test('closed candle ending before discovery is ignored, even with breakout volume', () => {
  const ctx = buildWatcher();
  try {
    const opened = startOfCurrent15m();
    ctx.registry.registerScenario(neutral('historical-close', opened + 20000));
    ctx.setHistory(opened - FIFTEEN, 20);
    ctx.watcher.evaluateCandleClose(candle(opened - FIFTEEN, 114, 25));
    assert.equal(ctx.registry.getScenario('historical-close')?.status, 'NO_TRADE_OBSERVATION');
    assert.deepEqual(ctx.confirmed, []);
  } finally { ctx.db.close(); }
});

test('15m close beyond ceiling with RVOL under 1.2 stays neutral and says why', () => {
  const ctx = buildWatcher();
  try {
    const opened = startOfCurrent15m();
    ctx.registry.registerScenario(neutral('volume-gate', opened + 5000));
    ctx.setHistory(opened, 20);
    ctx.watcher.evaluateCandleClose(candle(opened, 111, 11));
    const s = ctx.registry.getScenario('volume-gate');
    assert.equal(s?.status, 'NO_TRADE_OBSERVATION');
    assert.equal(s?.neutralBreakoutProgress?.state, 'OUTSIDE_CLOSED_LOW_VOLUME');
    assert.ok(Math.abs((s?.neutralBreakoutProgress?.relativeVolume || 0) - 1.1) < .001);
    assert.equal(ctx.confirmed.length, 0);
    assert.equal(ctx.registry.getLifecycle('volume-gate').some(e =>
      e.metadata?.progress === 'OUTSIDE_CLOSED_LOW_VOLUME'), true);
  } finally { ctx.db.close(); }
});

test('without ten valid previous closed candles, breakout is not confirmed', () => {
  const ctx = buildWatcher();
  try {
    const opened = startOfCurrent15m();
    ctx.registry.registerScenario(neutral('insufficient-history', opened + 5000));
    ctx.setHistory(opened, 5);
    ctx.watcher.evaluateCandleClose(candle(opened, 112, 25));
    assert.equal(ctx.registry.getScenario('insufficient-history')?.neutralBreakoutProgress?.state,
      'OUTSIDE_CLOSED_INSUFFICIENT_DATA');
    assert.equal(ctx.confirmed.length, 0);
  } finally { ctx.db.close(); }
});

test('neutral breakout is queued across scheduler cooldown, without bypassing shared budget', async () => {
  const db = new DatabaseService(':memory:');
  const coordinator = new EventEmitter() as EventEmitter & Record<string, any>;
  coordinator.getScenarioRegistry = () => ({ getAllActive: () => [] });
  coordinator.getSetupEngine = () => null;
  coordinator.getMarketState = () => ({ ticker: { lastPrice: 112 } });
  let discoveryCalls = 0;
  const scheduler = new AutonomousDiscoveryScheduler({
    coordinator: coordinator as any, db, symbol: 'BTCUSDT',
    hardBudgetManager: { isBlocked: () => false } as any,
    discoveryEngine: {
      runDiscovery: async () => {
        discoveryCalls++;
        return { scenarios: [], summary: {}, aiCostUsd: 0 };
      },
    } as any,
  });
  scheduler.start();
  try {
    assert.equal(await scheduler.triggerDiscovery('MANUAL_TEST', 100), true);
    assert.equal(discoveryCalls, 1);
    scheduler.queueConfirmedNeutralBreakout(112);
    assert.equal(discoveryCalls, 1, 'cooldown must prevent immediate paid analysis');
    assert.equal(scheduler.getStatus().pendingNeutralBreakout?.price, 112);
    assert.equal(scheduler.getStatus().lastBlockedTrigger?.code, 'COOLDOWN');
    (scheduler as any).lastTriggerTimestamp = Date.now() - 16 * 60 * 1000;
    // Exercise the automatic one-minute scheduler retry, not a manual call.
    (scheduler as any).evaluatePeriodicTrigger();
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(discoveryCalls, 2);
    assert.equal(scheduler.getStatus().pendingNeutralBreakout, null);
  } finally {
    scheduler.stop();
    db.close();
  }
});

test('confirmed breakout survives closing and reopening the actual SQLite database', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nanotrading-neutral-'));
  const dbPath = join(dir, 'test-trading.db');
  try {
    const original = new DatabaseService(dbPath);
    original.savePendingNeutralBreakout('BTCUSDT', { price: 111, confirmedAt: 1795746788904 });
    original.savePendingNeutralBreakout('ETHUSDT', { price: 1729, confirmedAt: 1795746788905 });
    original.close();

    const reopened = new DatabaseService(dbPath);
    const btc = reopened.getPendingNeutralBreakout('BTCUSDT');
    const eth = reopened.getPendingNeutralBreakout('ETHUSDT');
    assert.equal(btc?.price, 111);
    assert.equal(eth?.price, 1729);
    reopened.savePendingNeutralBreakout('BTCUSDT', null);
    assert.equal(reopened.getPendingNeutralBreakout('BTCUSDT'), null);
    assert.equal(reopened.getPendingNeutralBreakout('ETHUSDT')?.price, 1729);
    reopened.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('watcher replays a Bybit REST closed candle missed during offline time, exactly once', () => {
  const ctx = buildWatcher();
  try {
    const opened = startOfCurrent15m() - FIFTEEN;
    const discovered = opened + 5000;
    ctx.registry.registerScenario(neutral('replayed-after-restart', discovered));
    ctx.setHistory(opened, 20);
    ctx.addCandle(candle(opened, 112, 18));
    ctx.watcher.start(); // must replay from history, without another WS close
    assert.equal(ctx.registry.getScenario('replayed-after-restart')?.status, 'COMPLETED');
    assert.equal(ctx.registry.getScenario('replayed-after-restart')?.neutralBreakoutProgress?.relativeVolume, 1.8);
    assert.deepEqual(ctx.confirmed, [112]);
    ctx.watcher.reconcileNeutralConfirmedCandles();
    assert.deepEqual(ctx.confirmed, [112], 'duplicate replay must not repeat signal');
    ctx.watcher.stop();
  } finally { ctx.db.close(); }
});

test('when SQLite queue persistence fails, the watcher MUST NOT finish the neutral watch', () => {
  const ctx = buildWatcher();
  try {
    const opened = startOfCurrent15m();
    ctx.registry.registerScenario(neutral('fail-closed', opened + 5000));
    ctx.setHistory(opened, 20);
    const coordinator: any = (ctx.watcher as any).coordinator;
    coordinator.getDiscoveryScheduler = () => ({
      queueConfirmedNeutralBreakout: () => false,
    });
    ctx.watcher.evaluateCandleClose(candle(opened, 112, 18));
    assert.equal(ctx.registry.getScenario('fail-closed')?.status, 'NO_TRADE_OBSERVATION');
    assert.equal(ctx.registry.getScenario('fail-closed')?.neutralBreakoutProgress?.state, undefined);
    assert.equal(ctx.registry.getLifecycle('fail-closed').some(ev =>
      ev.metadata?.progress === 'QUEUE_PERSIST_FAILED'), true);
  } finally { ctx.db.close(); }
});

test('scheduler reloads pending breakout and restores cooldown from latest analysis audit', () => {
  const db = new DatabaseService(':memory:');
  const coordinator = new EventEmitter() as EventEmitter & Record<string, any>;
  coordinator.getScenarioRegistry = () => ({ getAllActive: () => [] });
  coordinator.getSetupEngine = () => null;
  coordinator.getMarketState = () => ({ ticker: { lastPrice: 112 } });
  let paidCalls = 0;
  const options: any = {
    coordinator, db, symbol: 'BTCUSDT',
    hardBudgetManager: { isBlocked: () => false },
    discoveryEngine: { runDiscovery: async () => {
      paidCalls++;
      return { scenarios: [], summary: {}, aiCostUsd: 0 };
    }},
  };
  const scheduler = new AutonomousDiscoveryScheduler(options);
  scheduler.start();
  try {
    assert.equal(scheduler.queueConfirmedNeutralBreakout(112), true);
    assert.equal(db.getPendingNeutralBreakout('BTCUSDT')?.price, 112);
    // Simulate restart before a scheduled discovery is permitted.
    scheduler.stop();
    const restarted = new AutonomousDiscoveryScheduler(options);
    assert.equal(restarted.getStatus().pendingNeutralBreakout?.price, 112);
    restarted.start();
    (restarted as any).evaluatePeriodicTrigger();
    assert.equal(paidCalls, 0, 'cooldown recovery must not issue unexpected AI analysis');
    restarted.stop();
  } finally { db.close(); }
});
