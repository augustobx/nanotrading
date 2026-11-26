import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { DatabaseService } from '../../src/storage/database.js';
import { ScenarioRegistry } from '../../src/engine/scenario-registry.js';
import { AiMarketDiscoveryEngine, buildDiscoveryPrompt } from '../../src/ai/ai-market-discovery.js';
import { AutonomousDiscoveryScheduler } from '../../src/ai/autonomous-discovery-scheduler.js';
import { DEFAULT_RISK_POLICY } from '../../src/engine/risk-policy.js';

function harness() {
  const db = new DatabaseService(':memory:');
  const registry = new ScenarioRegistry(db);
  const policy = { ...DEFAULT_RISK_POLICY, version: 17, minNetRR: 4 };
  const summary: any = {
    symbol: 'BTCUSDT', timestamp: Date.now(), currentPrice: 60000,
    dataAvailability: { allCriticalDataPresent: true },
    timeframes: { '15m': {
      trend: 'BULLISH', activeSwings: { high: { price: 60500 }, low: { price: 59000 } },
      recentSwings: [59000, 59500, 60000, 60500, 61700, 63100].map(price => ({ price, type: 'HIGH' })),
      activeObDetails: [59500, 60000, 61700, 63100].map(price => ({ type: 'BULLISH', bottom: price - 10, top: price + 10 })), activeFvgDetails: [],
    } },
  };
  const coordinator: any = new EventEmitter();
  coordinator.getRiskPolicyManager = () => ({ getPolicy: () => policy });
  coordinator.getMarketState = () => ({ ticker: { lastPrice: 60000, spread: 0.1 } });
  coordinator.getScenarioRegistry = () => registry;
  const reservations: string[] = [];
  const reconciled: string[] = [];
  const budget: any = {
    isBlocked: () => false, getConfig: () => ({ dailyBudgetLimitUsd: 100 }),
    getTodaySpendUsd: () => 0, getReservedPendingUsd: () => 0,
    reserveBudget: ({ provider }: any) => { reservations.push(provider); return { allowed: true, reservationId: provider }; },
    reconcileReservation: (id: string) => reconciled.push(id), releaseReservation: () => {},
  };
  const openai: any = { isConfigured: () => true, getModel: () => 'gpt-4o' };
  const gemini: any = { isConfigured: () => false, getModel: () => 'gemini-2.5-flash' };
  const discovery = new AiMarketDiscoveryEngine({ coordinator, db, scenarioRegistry: registry,
    hardBudgetManager: budget, openaiAdapter: openai, geminiAdapter: gemini });
  discovery.buildMarketIntelligenceSummary = () => structuredClone(summary);
  return { db, registry, policy, summary, coordinator, budget, reservations, reconciled, openai, gemini, discovery };
}
const candidate: any = { direction: 'LONG', entryZoneMin: 59990, entryZoneMax: 60010,
  targetEntry: 60000, stopLossPrice: 59500, candidateTarget12: 61700 };

test('Both analyst prompts require current verified anchors and contain no numeric price examples', () => {
  const h = harness();
  try {
    const openai = buildDiscoveryPrompt(h.summary, 'OPENAI', h.policy);
    const gemini = buildDiscoveryPrompt(h.summary, 'GEMINI', h.policy);
    for (const prompt of [openai, gemini]) {
      assert.match(prompt, /SWING_HIGH=60500/);
      assert.ok(prompt.includes('OB_BULLISH=[61690,61710]'));
      assert.match(prompt, /R:R NETO mínimo 4 para objetivo corto y 4 para extendido/);
      assert.match(prompt, /PROHIBIDO: objetivos derivados de multiplicadores/);
      assert.match(prompt, /Los recentSwings históricos son contexto descriptivo, NO anclas válidas/);
      assert.doesNotMatch(prompt, /"candidateTarget(?:12|14)"\s*:\s*[0-9]/);
      assert.doesNotMatch(prompt, /"entryZoneMin"\s*:\s*[0-9]/);
      assert.doesNotMatch(prompt, /Math\.round\(pCurrent/);
    }
  } finally { h.db.close(); }
});

test('Real discovery path preserves rejected bullish candidate, effective RR, snapshot and provider degradation', async () => {
  const h = harness();
  h.openai.evaluateWithCustomPrompt = async () => ({ bias: 'BULLISH', scenarios: [candidate], costUsd: 0,
    marketAnalysis: { noTradeJustification: 'Hay una oportunidad operable' } });
  h.gemini.isConfigured = () => true;
  h.gemini.evaluateWithCustomPrompt = async () => null;
  h.gemini.getDiscoveryHealth = () => ({ failureCode: 'HTTP_503', retryNotBefore: 0 });
  try {
    const result = await h.discovery.runDiscovery();
    const audit = h.db.getDiscoveryAudit(result.scenarios[0].snapshotId)!;
    assert.equal(audit.outcome, 'CANDIDATES_REJECTED');
    assert.equal(audit.candidates[0].reason, 'RR_POLICY_REJECTED');
    assert.deepEqual(audit.candidates[0].details?.minimums, { short: 4, extended: 4 });
    assert.equal(audit.policy?.version, 17);
    assert.equal(audit.snapshot.currentPrice, 60000);
    assert.equal(audit.providers.GEMINI.failure, 'HTTP_503');
    assert.equal(audit.providers.OPENAI.status, 'SUCCESS');
    assert.match(result.scenarios[0].rejectionReason!, /Candidatos descartados/);
    assert.deepEqual(h.reservations, ['OPENAI', 'GEMINI']);
    assert.deepEqual(h.reconciled, ['OPENAI', 'GEMINI']);
    const funnel = h.db.getDiscoveryFunnel() as any;
    assert.equal(funnel.legacyScenarios, 0);
    assert.equal(funnel.candidates[0].reason, 'RR_POLICY_REJECTED');
    assert.equal(funnel.neutral, 1);
  } finally { h.db.close(); }
});

test('New analysis replaces neutral watches; a genuine no-trade stays distinct from rejected candidates', async () => {
  const h = harness();
  h.openai.evaluateWithCustomPrompt = async () => ({ bias: 'NEUTRAL', scenarios: [], costUsd: 0 });
  try {
    const first = await h.discovery.runDiscovery();
    // Neutral IDs are time based; ensure a different persisted observation.
    await new Promise(resolve => setTimeout(resolve, 2));
    h.summary.timeframes['15m'].activeSwings.high.price = 60700;
    const second = await h.discovery.runDiscovery();
    assert.equal(h.registry.getScenario(first.scenarios[0].id)?.status, 'CANCELLED');
    assert.equal(h.registry.getAllActive().length, 1);
    assert.equal(h.db.getDiscoveryAudit(second.scenarios[0].snapshotId)?.outcome, 'AI_NO_TRADE');
    assert.equal(h.db.getDiscoveryAudits(10).length, 2);
  } finally { h.db.close(); }
});

test('Provider outage, paused Gemini and unavailable data never become a neutral conclusion', async () => {
  const h = harness();
  h.openai.evaluateWithCustomPrompt = async () => null;
  h.gemini.isConfigured = () => true;
  h.gemini.getDiscoveryHealth = () => ({ failureCode: 'TIMEOUT', retryNotBefore: Date.now() + 60000 });
  h.gemini.evaluateWithCustomPrompt = async () => { throw new Error('Paused provider must not be called'); };
  try {
    const result = await h.discovery.runDiscovery();
    assert.equal(result.scenarios.length, 0);
    assert.equal(h.db.getDiscoveryAudits()[0].outcome, 'PROVIDER_UNAVAILABLE');
    assert.equal(h.db.getDiscoveryAudits()[0].providers.GEMINI.status, 'PAUSED');
    assert.deepEqual(h.reservations, ['OPENAI']);
    h.summary.dataAvailability.allCriticalDataPresent = false;
    await new Promise(resolve => setTimeout(resolve, 2));
    await h.discovery.runDiscovery();
    assert.equal(h.db.getDiscoveryAudits()[0].outcome, 'DATA_UNAVAILABLE');
    assert.equal(h.reservations.length, 1);
  } finally { h.db.close(); }
});

test('Directional accepted candidate is attributed to its real provider and audit write failure prevents paid calls', async () => {
  const h = harness(); let calls = 0;
  h.openai.evaluateWithCustomPrompt = async () => { calls++; return { bias: 'BULLISH', scenarios: [{ ...candidate, candidateTarget14: 63100 }], costUsd: 0 }; };
  try {
    const result = await h.discovery.runDiscovery();
    assert.equal(result.scenarios[0].direction, 'LONG');
    assert.equal(result.scenarios[0].proposedBy, 'OPENAI');
    assert.equal(result.scenarios[0].rrModeAvailable, 'RR_1_4');
    assert.equal(h.db.getDiscoveryAudits()[0].outcome, 'DIRECTIONAL_ACCEPTED');
    h.db.saveDiscoveryAudit = () => { throw new Error('disk full'); };
    await assert.rejects(h.discovery.runDiscovery(), /disk full/);
    assert.equal(calls, 1);
  } finally { h.db.close(); }
});

test('Neutral does not veto structural or material price changes; cooldown, dedup, budget and directional gate survive', async () => {
  const h = harness(); let now = Date.now(); const originalNow = Date.now;
  let revision = 1, calls = 0;
  const neutral: any = { direction: 'NEUTRAL', kind: 'NEUTRAL_OBSERVATION', status: 'NO_TRADE_OBSERVATION', validUntilTimestamp: now + 6 * 3600000 };
  let active: any[] = [neutral];
  h.coordinator.getScenarioRegistry = () => ({ getAllActive: () => active });
  h.coordinator.getSetupEngine = () => ({ getAnalysis: () => ({ trend: 'BULLISH', structure: {
    structureBreaks: [{ type: 'BOS', direction: 'BULLISH', timestamp: revision }],
  } }) });
  const scheduler = new AutonomousDiscoveryScheduler({ coordinator: h.coordinator, db: h.db,
    hardBudgetManager: h.budget, discoveryEngine: { runDiscovery: async () => { calls++; return { scenarios: [], summary: {}, aiCostUsd: 0 }; } } as any });
  Date.now = () => now;
  try {
    scheduler.start();
    assert.equal(await scheduler.triggerDiscovery('15M_STRUCTURE_SHIFT_BOS_CHOCH', 60000), true);
    revision++;
    assert.equal(await scheduler.triggerDiscovery('15M_STRUCTURE_SHIFT_BOS_CHOCH', 60000), false);
    now += 16 * 60000;
    assert.equal(await scheduler.triggerDiscovery('15M_STRUCTURE_SHIFT_BOS_CHOCH', 60000), true);
    now += 16 * 60000;
    assert.equal(await scheduler.triggerDiscovery('1H_CANDLE_CLOSED_1', 60000), false);
    assert.equal(await scheduler.triggerDiscovery('SIGNIFICANT_PRICE_MOVE_2%', 61200), true);
    now += 16 * 60000;
    active = [{ ...neutral, direction: 'LONG', kind: 'TRADE_SCENARIO' }];
    assert.equal(await scheduler.triggerDiscovery('RANGE_BREAKOUT_FROM_NEUTRAL_WATCH', 61200), false);
    active = [neutral]; h.budget.isBlocked = () => true; h.budget.getBlockedReason = () => 'budget';
    assert.equal(await scheduler.triggerDiscovery('RANGE_BREAKOUT_FROM_NEUTRAL_WATCH', 61200), false);
    assert.equal(calls, 3);
  } finally { Date.now = originalNow; scheduler.stop(); h.db.close(); }
});

test('Deduplicated provider candidates and later rediscovery retain canonical IDs and their own snapshots', async () => {
  const h = harness();
  const response = () => ({ bias: 'BULLISH', scenarios: [{ ...candidate, candidateTarget14: 63100 }], costUsd: 0 });
  h.openai.evaluateWithCustomPrompt = async () => response();
  h.gemini.isConfigured = () => true;
  h.gemini.evaluateWithCustomPrompt = async () => response();
  try {
    const first = await h.discovery.runDiscovery();
    assert.equal(first.scenarios.length, 1);
    const canonical = first.scenarios[0];
    assert.equal(canonical.proposedBy, 'CONSENSUS');
    const firstAudit = h.db.getDiscoveryAudit(canonical.snapshotId)!;
    assert.equal(firstAudit.candidates.length, 2);
    assert.deepEqual(firstAudit.candidates.map(c => c.scenarioId), [canonical.id, canonical.id]);
    assert.deepEqual(firstAudit.scenarioIds, [canonical.id]);
    const second = await h.discovery.runDiscovery();
    assert.equal(second.scenarios.length, 1);
    assert.equal(second.scenarios[0].id, canonical.id);
    assert.equal(second.scenarios[0].snapshotId, canonical.snapshotId, 'Original geometry keeps its source snapshot');
    const related = h.db.getDiscoveryAuditsForScenario(canonical.id);
    assert.equal(related.length, 2);
    assert.equal(new Set(related.map(a => a.id)).size, 2);
    for (const audit of related) {
      assert.deepEqual(audit.scenarioIds, [canonical.id]);
      assert.ok(audit.candidates.every(c => c.scenarioId === canonical.id));
    }
  } finally { h.db.close(); }
});
