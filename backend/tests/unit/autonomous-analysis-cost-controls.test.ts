import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { DatabaseService } from '../../src/storage/database.js';
import { AutonomousDiscoveryScheduler } from '../../src/ai/autonomous-discovery-scheduler.js';
import { AlgorithmicWatcher } from '../../src/engine/algorithmic-watcher.js';
import { ScenarioRegistry } from '../../src/engine/scenario-registry.js';
import { Scenario } from '../../src/ai/scenario-types.js';
import { calculateCallCost } from '../../src/ai/models-catalog.js';
import { HardBudgetManager } from '../../src/ai/hard-budget-manager.js';
import { GeminiAdapter } from '../../src/ai/gemini-adapter.js';

function testScenario(overrides: Partial<Scenario> = {}): Scenario {
  const now = Date.now();
  return {
    id: 'autonomy_scenario_' + now, symbol: 'BTCUSDT',
    direction: 'LONG', kind: 'TRADE_SCENARIO', timeframe: '15m',
    structureType: 'TEST', proposedBy: 'CONSENSUS', modelsUsed: ['test'],
    snapshotId: 'snapshot-test', discoveryTimestamp: now - 3600000,
    entryZoneMin: 59800, entryZoneMax: 60200, targetEntry: 60000,
    stopLossPrice: 59000, target12Price: 62000, target14Price: 64000,
    rrModeAvailable: 'RR_BOTH', uncertaintyLevel: 'MEDIUM',
    status: 'SCENARIO_MONITORING', validUntilTimestamp: now + 3600000,
    aiCostUsd: 0, activationConditions: [], invalidationTriggers: [],
    argumentsFor: [], argumentsAgainst: [], createdAt: now, updatedAt: now,
    ...overrides,
  };
}

test('Scheduler: no paid calls while a valid zone is being watched; manual authorized', async () => {
  const db = new DatabaseService(':memory:');
  const emitter = new EventEmitter() as EventEmitter & Record<string, any>;
  let active: Scenario[] = [testScenario()];
  let calls = 0;
  emitter.getScenarioRegistry = () => ({ getAllActive: () => active });
  emitter.getMarketState = () => ({ ticker: { lastPrice: 60500 } });
  emitter.getSetupEngine = () => ({ getAnalysis: () => undefined });
  const scheduler = new AutonomousDiscoveryScheduler({
    coordinator: emitter as any, db,
    hardBudgetManager: { isBlocked: () => false } as any,
    discoveryEngine: { runDiscovery: async () => {
      calls += 1;
      return { scenarios: [], summary: {}, aiCostUsd: 0 };
    }} as any,
  });
  try {
    scheduler.start();
    assert.equal(await scheduler.triggerDiscovery('PERIODIC_SCHEDULED_DISCOVERY', 60500), false);
    assert.equal(await scheduler.triggerDiscovery('1H_CANDLE_CLOSED_1', 60500), false);
    assert.equal(await scheduler.triggerDiscovery('RANGE_BREAKOUT_FROM_NEUTRAL_WATCH', 60500), false);
    assert.equal(calls, 0);
    assert.equal(await scheduler.triggerDiscovery('MANUAL_REQUEST', 60500), true);
    assert.equal(calls, 1);
    active = [];
    assert.equal(await scheduler.triggerDiscovery('PERIODIC_SCHEDULED_DISCOVERY', 60500), false,
      'Autonomous cooldown also applies when the watch ends');
  } finally { scheduler.stop(); db.close(); }
});

test('Scheduler: concurrent event triggers are coalesced and event listeners do not leak', async () => {
  const db = new DatabaseService(':memory:');
  const coordinator = new EventEmitter() as EventEmitter & Record<string, any>;
  coordinator.getScenarioRegistry = () => ({ getAllActive: () => [] });
  coordinator.getMarketState = () => ({ ticker: { lastPrice: 60000 } });
  let calls = 0;
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => { release = resolve; });
  const scheduler = new AutonomousDiscoveryScheduler({
    coordinator: coordinator as any, db,
    hardBudgetManager: { isBlocked: () => false } as any,
    discoveryEngine: { runDiscovery: async () => {
      calls++;
      await barrier;
      return { scenarios: [], summary: {}, aiCostUsd: 0 };
    }} as any,
  });
  try {
    scheduler.start();
    scheduler.stop();
    scheduler.start();
    assert.equal(coordinator.listenerCount('candle_closed'), 1);
    assert.equal(coordinator.listenerCount('state_updated'), 1);
    const first = scheduler.triggerDiscovery('RANGE_BREAKOUT_FROM_NEUTRAL_WATCH', 60000);
    const second = await scheduler.triggerDiscovery('RANGE_BREAKOUT_FROM_NEUTRAL_WATCH', 60000);
    assert.equal(second, false);
    release();
    assert.equal(await first, true);
    assert.equal(calls, 1);
  } finally { release(); scheduler.stop(); db.close(); }
});

test('Watcher: WAITING_CONFIRMATION cannot be revalidated by repeated ticks', () => {
  const db = new DatabaseService(':memory:');
  const registry = new ScenarioRegistry(db);
  const coordinator = new EventEmitter() as EventEmitter & Record<string, any>;
  coordinator.getCandleManager = () => ({ getCandles: () => [] });
  const watcher = new AlgorithmicWatcher(coordinator as any, registry);
  let revalidations = 0;
  watcher.on('revalidation_requested', () => revalidations++);
  const old = Date.now() - 35 * 60000;
  const scenario = testScenario({
    status: 'WAITING_CONFIRMATION',
    lastRevalidationTimestamp: old,
    watchPlan: {
      id: 'wait-plan', scenarioId: 'wait-scenario', symbol: 'BTCUSDT',
      direction: 'LONG', watchZone: { minPrice: 59800, maxPrice: 60200, targetEntry: 60000 },
      candidateStopLoss: 59000, candidateTakeProfits: {}, rrEligibility: 'RR_BOTH',
      marketThesis: 'Esperar', horizon: 'INTRADAY', primaryTimeframe: '15m',
      observableConditions: [], confirmationSequence: [], invalidationConditions: [],
      expirationTimestamp: Date.now() + 3600000, reevaluationTriggers: [],
      status: 'ACTIVE', automatable: true, createdAt: Date.now(), updatedAt: Date.now(),
    },
  });
  try {
    registry.registerScenario(scenario);
    for (let i = 0; i < 100; i++) watcher.evaluateTick(60000);
    assert.equal(revalidations, 0, 'No debe facturarse IA en cada tick de espera');
    watcher.evaluateCandleClose({
      timeframe: '15m', timestamp: Date.now(), confirmed: true,
      open: 59950, high: 60200, low: 59900, close: 60000, volume: 300,
    });
    assert.equal(revalidations, 1, 'Una nueva vela cerrada permite reevaluación controlada');
    for (let i = 0; i < 100; i++) watcher.evaluateTick(60000);
    assert.equal(revalidations, 1);
  } finally { db.close(); }
});

test('Watcher: neutral range needs valid bounds, closed candle and RVOL >= 1.2', () => {
  const db = new DatabaseService(':memory:');
  const registry = new ScenarioRegistry(db);
  const coordinator = new EventEmitter() as EventEmitter & Record<string, any>;
  const time = Date.now();
  const historical = Array.from({ length: 20 }, (_, i) => ({
    timestamp: time - (i + 1) * 900000, open: 60000, high: 60100,
    low: 59900, close: 60000, volume: 100, confirmed: true,
  }));
  coordinator.getCandleManager = () => ({ getCandles: () => historical });
  let discoveryCalls = 0;
  coordinator.getDiscoveryScheduler = () => ({
    triggerDiscovery: () => { discoveryCalls++; return true; },
  });
  const watcher = new AlgorithmicWatcher(coordinator as any, registry);
  const neutral = testScenario({
    direction: 'NEUTRAL', kind: 'NEUTRAL_OBSERVATION',
    status: 'NO_TRADE_OBSERVATION', rrModeAvailable: 'NONE',
    entryZoneMin: 59500, entryZoneMax: 60500,
  });
  try {
    registry.registerScenario(neutral);
    const candle = { timestamp: time, timeframe: '15m', confirmed: true,
      open: 60450, high: 60700, low: 60300, close: 60600, volume: 110 };
    watcher.evaluateCandleClose(candle);
    assert.equal(registry.getScenario(neutral.id)?.status, 'NO_TRADE_OBSERVATION');
    assert.equal(discoveryCalls, 0);
    watcher.evaluateCandleClose({ ...candle, volume: 150 });
    assert.equal(registry.getScenario(neutral.id)?.status, 'COMPLETED');
    assert.equal(discoveryCalls, 1);
  } finally { db.close(); }
});

test('Token accounting: reasoning tokens already included in reported completion tokens', () => {
  const plain = calculateCallCost('gpt-4o', {
    promptTokens: 10000, completionTokens: 5000, reasoningTokens: 0,
  });
  const withBreakdown = calculateCallCost('gpt-4o', {
    promptTokens: 10000, completionTokens: 5000, reasoningTokens: 4000,
  });
  assert.equal(withBreakdown, plain);
});

test('Safety: budget ledger write failure must block all subsequent paid AI calls', () => {
  const db = new DatabaseService(':memory:');
  const manager = new HardBudgetManager({
    dailyBudgetLimitUsd: 1, monthlyBudgetLimitUsd: 10, maxCostPerRequestUsd: 0.05,
  }, undefined, db);
  const oldLogger = db.logAiConsumption.bind(db);
  try {
    (db as any).logAiConsumption = () => { throw new Error('disk full'); };
    assert.throws(() => manager.recordDirectUsage(
      'OPENAI', 'gpt-4o', 'MARKET_DISCOVERY', 0.01,
    ), /no se pudo persistir el consumo/);
    assert.equal(manager.isBlocked(), true);
    assert.match(manager.getBlockedReason() || '', /ERROR_CRITICO/);
    const blocked = manager.reserveBudget({
      provider: 'OPENAI', model: 'gpt-4o', task: 'MARKET_DISCOVERY',
      maxEstimatedCostUsd: 0.001, estimatedTokens: 200,
    });
    assert.equal(blocked.allowed, false);
    assert.equal(db.getHardBudgetConfig()?.isBlocked, true);
  } finally {
    (db as any).logAiConsumption = oldLogger;
    db.close();
  }
});

test('Accounting: 95% alert uses gross estimate, not a declared discount', () => {
  const db = new DatabaseService(':memory:');
  const alerts: string[] = [];
  const budget = new HardBudgetManager({
    dailyBudgetLimitUsd: 1, monthlyBudgetLimitUsd: 10,
    maxCostPerRequestUsd: 1,
  }, {
    sendTelegramAlert: async (title) => { alerts.push(title); },
  }, db);
  try {
    budget.recordDirectUsage('OPENAI', 'gpt-4o', 'MARKET_DISCOVERY', 0.01,
      { prompt: 1000, completion: 300 }, 'SUCCESS', 1,
      { grossCostUsd: 0.96, discountUsd: 0.95, discountStatus: 'ESTIMATED' });
    const summary = budget.getSummary();
    assert.equal(summary.status, 'CRITICAL_95');
    assert.ok(summary.todayGrossSpendUsd > 0.95);
    assert.ok(summary.todaySpendUsd < 0.05);
    assert.ok(alerts.some(title => title.includes('95')));
  } finally { db.close(); }
});

test('Provider sublimit audit exposes the real gross headroom without relaxing any hard budget', () => {
  const db = new DatabaseService(':memory:');
  const budget = new HardBudgetManager({
    dailyBudgetLimitUsd: 5,
    monthlyBudgetLimitUsd: 20,
    maxCostPerRequestUsd: 0.05,
    providerLimitsUsd: { openai: 0.40, gemini: 0.40 },
  }, undefined, db);
  try {
    budget.recordDirectUsage('OPENAI', 'gpt-4o', 'MARKET_DISCOVERY', 0.3983,
      { prompt: 1000, completion: 300 }, 'SUCCESS', 1, { grossCostUsd: 0.3983 });
    const denied = budget.reserveBudget({
      provider: 'OPENAI', model: 'gpt-4o', task: 'MARKET_DISCOVERY',
      estimatedTokens: 1000, maxEstimatedCostUsd: 0.0192,
    });
    assert.equal(denied.allowed, false);
    assert.equal(denied.violatedLimit, 'PROVIDER_OPENAI');
    const summary = budget.getSummary();
    assert.equal(summary.isBlocked, false);
    assert.equal(summary.remainingDailyUsd > 4, true);
    assert.equal(summary.providerDaily.OPENAI.limitUsd, 0.40);
    assert.equal(summary.providerDaily.OPENAI.grossSpentUsd, 0.3983);
    assert.equal(summary.providerDaily.OPENAI.remainingUsd, 0.0017);
    assert.equal(summary.providerDaily.GEMINI.remainingUsd, 0.40);

    const reservation = budget.reserveBudget({
      provider: 'GEMINI', model: 'gemini-2.5-flash', task: 'MARKET_DISCOVERY',
      estimatedTokens: 1000, maxEstimatedCostUsd: 0.02,
    });
    assert.equal(reservation.allowed, true);
    assert.equal(budget.getSummary().providerDaily.GEMINI.reservedUsd, 0.02);
    assert.equal(budget.getConfig().providerLimitsUsd?.openai, 0.40);
  } finally { db.close(); }
});

test('Recovery: last AI reevaluation timestamp survives a ScenarioRegistry reload', () => {
  const db = new DatabaseService(':memory:');
  try {
    const registry = new ScenarioRegistry(db);
    const sc = testScenario({ id: 'durable_revalidation_1', status: 'WAITING_CONFIRMATION' });
    registry.registerScenario(sc);
    const last = Date.now() - 1000;
    registry.updateMetrics(sc.id, { lastRevalidationTimestamp: last });
    const recovered = new ScenarioRegistry(db);
    assert.equal(recovered.getScenario(sc.id)?.lastRevalidationTimestamp, last);
  } finally { db.close(); }
});

test('UTC midnight is 21:00 ART on 21 November 2026', () => {
  const iso = '2026-11-22T00:00:00.000Z';
  const rendered = new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(iso));
  assert.equal(rendered, '21:00');
});

test('Watcher: WAIT with unconfirmed plan condition must not spend on new candle', () => {
  const db = new DatabaseService(':memory:');
  const registry = new ScenarioRegistry(db);
  const coordinator = new EventEmitter() as EventEmitter & Record<string, any>;
  coordinator.getCandleManager = () => ({ getCandles: () => [] });
  coordinator.getMarketState = () => ({ ticker: { spreadPcnt: 0.001 } });
  coordinator.getSetupEngine = () => ({ getAnalysis: () => undefined });
  const watcher = new AlgorithmicWatcher(coordinator as any, registry);
  let evaluations = 0;
  watcher.on('revalidation_requested', () => evaluations++);
  const older = Date.now() - 45 * 60000;
  const scenario = testScenario({
    id: 'wait_unconfirmed_condition', status: 'WAITING_CONFIRMATION',
    lastRevalidationTimestamp: older,
    watchPlan: {
      id: 'pending_plan', scenarioId: 'wait_unconfirmed_condition',
      symbol: 'BTCUSDT', direction: 'LONG', horizon: 'INTRADAY',
      primaryTimeframe: '15m', marketThesis: 'Esperar RSI confirmado',
      watchZone: { minPrice: 59800, maxPrice: 60200, targetEntry: 60000 },
      candidateStopLoss: 59000, candidateTakeProfits: {}, rrEligibility: 'RR_BOTH',
      observableConditions: [{
        id: 'rsi_cond', description: 'RSI sin dato', operator: 'RSI_THRESHOLD',
        params: { threshold: 20, direction: 'BELOW', timeframe: '15m' },
        automatable: true, sequenceOrder: 1, isMet: false,
      }],
      confirmationSequence: [], invalidationConditions: [], reevaluationTriggers: [],
      expirationTimestamp: Date.now() + 3600000,
      status: 'ACTIVE', automatable: true, createdAt: Date.now(), updatedAt: Date.now(),
    },
  });
  try {
    registry.registerScenario(scenario);
    watcher.evaluateCandleClose({
      timeframe: '15m', timestamp: Date.now(), confirmed: true,
      open: 59990, high: 60030, low: 59900, close: 60000, volume: 100,
    });
    assert.equal(evaluations, 0);
    assert.equal(registry.getScenario(scenario.id)?.status, 'WAITING_CONFIRMATION');
  } finally { db.close(); }
});

test('Scheduler: provider outage triggers a bounded automatic backoff, not a paid retry storm', async () => {
  const db = new DatabaseService(':memory:');
  const emitter = new EventEmitter() as EventEmitter & Record<string, any>;
  emitter.getScenarioRegistry = () => ({ getAllActive: () => [] });
  emitter.getMarketState = () => ({ ticker: { lastPrice: 60000 } });
  let attempts = 0;
  const scheduler = new AutonomousDiscoveryScheduler({
    coordinator: emitter as any, db,
    hardBudgetManager: { isBlocked: () => false } as any,
    discoveryEngine: { runDiscovery: async () => {
      attempts++;
      return { scenarios: [], summary: {}, aiCostUsd: 0,
        skippedReason: 'AI_PROVIDERS_FAILED_NO_VALID_ANALYSIS' };
    }} as any,
  });
  try {
    scheduler.start();
    const failed = await scheduler.triggerDiscovery('PERIODIC_SCHEDULED_DISCOVERY', 60000);
    assert.equal(failed, false);
    assert.equal(attempts, 1);
    assert.equal(scheduler.getStatus().consecutiveProviderFailures, 1);
    assert.ok((scheduler.getStatus().providerFailureBackoffUntil || 0) > Date.now());
    const retry = await scheduler.triggerDiscovery('RANGE_BREAKOUT_FROM_NEUTRAL_WATCH', 60000);
    assert.equal(retry, false);
    assert.equal(attempts, 1, 'RANGE_BREAKOUT cannot bypass provider failure backoff');
  } finally { scheduler.stop(); db.close(); }
});

test('Scheduler status counts actionable watches, never neutral observations', () => {
  const db = new DatabaseService(':memory:');
  const coordinator = new EventEmitter() as EventEmitter & Record<string, any>;
  const neutral = testScenario({
    id: 'neutral-watch', direction: 'NEUTRAL', kind: 'NEUTRAL_OBSERVATION',
    rrModeAvailable: 'NONE', status: 'NO_TRADE_OBSERVATION',
  });
  const directional = testScenario({ id: 'directional-watch' });
  let active = [neutral];
  coordinator.getScenarioRegistry = () => ({ getAllActive: () => active });
  const scheduler = new AutonomousDiscoveryScheduler({
    coordinator: coordinator as any, db,
    hardBudgetManager: { isBlocked: () => false } as any,
    discoveryEngine: { runDiscovery: async () => ({ scenarios: [] }) } as any,
  });
  try {
    assert.equal(scheduler.getStatus().activeWatchedScenarios, 0);
    active = [neutral, directional];
    assert.equal(scheduler.getStatus().activeWatchedScenarios, 1);
    active = [neutral, testScenario({ id: 'expired', validUntilTimestamp: Date.now() - 1000 })];
    assert.equal(scheduler.getStatus().activeWatchedScenarios, 0);
  } finally { db.close(); }
});

test('Gemini discovery gets a separate 60-second timeout and reports latency without extra calls', async () => {
  const adapter = new GeminiAdapter({ apiKey: 'fixture-only', timeoutMs: 5 });
  const previousFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls++;
    const signal = init?.signal as AbortSignal;
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(signal.aborted, false, 'Discovery must not inherit the short review timeout');
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: '{"bias":"NEUTRAL","scenarios":[]}' }] } }],
    }), { status: 200 });
  };
  try {
    const result = await adapter.evaluateWithCustomPrompt('fixture prompt', 'gemini-2.5-flash', { discovery: true });
    assert.equal(result?.bias, 'NEUTRAL');
    assert.equal(calls, 1);
    assert.deepEqual(adapter.getDiscoveryHealth('gemini-2.5-flash'), {
      failureCode: null, consecutiveFailures: 0, retryNotBefore: 0,
    });
    const info = adapter.getStatus().lastDiscoveryAttempt;
    assert.equal(info?.model, 'gemini-2.5-flash');
    assert.equal(info?.timeoutMs, 60000);
    assert.equal(info?.outcome, 'SUCCESS');
    assert.ok((info?.durationMs || 0) >= 20);
  } finally { globalThis.fetch = previousFetch; }
});

test('Gemini discovery timeout is recorded, paused and never retried inside the same reservation', async () => {
  const adapter = new GeminiAdapter({ apiKey: 'fixture-only', discoveryTimeoutMs: 25 });
  const previousFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls++;
    return await new Promise<Response>((_resolve, reject) => {
      (init?.signal as AbortSignal).addEventListener('abort', () => {
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      }, { once: true });
    });
  };
  try {
    const result = await adapter.evaluateWithCustomPrompt('fixture', 'gemini-2.5-flash', { discovery: true });
    assert.equal(result, null);
    assert.equal(adapter.getStatus().lastDiscoveryAttempt?.outcome, 'TIMEOUT');
    assert.equal(adapter.getStatus().lastDiscoveryAttempt?.timeoutMs, 25);
    assert.equal(adapter.getDiscoveryHealth('gemini-2.5-flash').failureCode, 'TIMEOUT');
    assert.ok(adapter.getDiscoveryHealth('gemini-2.5-flash').retryNotBefore > Date.now());
    const paused = await adapter.evaluateWithCustomPrompt('fixture', 'gemini-2.5-flash', { discovery: true });
    assert.equal(paused, null);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = previousFetch; }
});
