import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
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
    assert.equal(await scheduler.triggerDiscovery('RANGE_BREAKOUT_FROM_NEUTRAL_WATCH', 112), true);
    assert.equal(discoveryCalls, 2);
    assert.equal(scheduler.getStatus().pendingNeutralBreakout, null);
  } finally {
    scheduler.stop();
    db.close();
  }
});
