import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseService } from '../../src/storage/database.js';
import { BybitRestClient } from '../../src/bybit/bybit-rest-client.js';
import { BybitWsClient } from '../../src/bybit/bybit-ws-client.js';
import { CandleManager } from '../../src/market/candle-manager.js';
import { OrderBookManager } from '../../src/market/orderbook-manager.js';
import { MarketCoordinator } from '../../src/market/market-coordinator.js';
import { ConsensusEngine } from '../../src/ai/consensus-engine.js';
import { OpenAiAdapter } from '../../src/ai/openai-adapter.js';
import { GeminiAdapter } from '../../src/ai/gemini-adapter.js';
import { CostTracker } from '../../src/ai/cost-tracker.js';
import { SnapshotBuilder } from '../../src/ai/snapshot-builder.js';
import { SetupCandidate } from '../../src/engine/strategy-a-trend.js';
import { RiskCalculator } from '../../src/engine/risk-calculator.js';

function createMockSetup(overrides: Partial<SetupCandidate> = {}): SetupCandidate {
  const riskReward = RiskCalculator.calculate({
    direction: 'LONG',
    entryPrice: 60000,
    stopLossPrice: 59800,
    takeProfitPrice: 61500, // Valid 1:4 Net R:R
    spread: 0.1,
    minRequiredRR: 4.0,
  });

  return {
    id: `setup_test_${Date.now()}`,
    strategy: 'STRATEGY_A_TREND_CONTINUATION',
    symbol: 'BTCUSDT',
    direction: 'LONG',
    timeframe: '15m',
    timestamp: Date.now(),
    entryPrice: 60000,
    stopLossPrice: 59800,
    takeProfitPrice: 61500,
    riskReward,
    status: 'QUALIFIED',
    evidence: {
      macroTrend: '4H: BULLISH, 1H: BULLISH',
      triggerReason: 'Mitigación de FVG 15m con BOS en 5m',
      invalidationReason: 'Cierre por debajo de 59800',
      confluencePoints: ['Estructura alcista', 'FVG activo', 'Net RR >= 4.0'],
      structuralTarget: 'Swing High previo en 61500',
    },
    ...overrides,
  };
}

function setupTestEnvironment() {
  const db = new DatabaseService(':memory:');
  const restClient = new BybitRestClient();
  const wsClient = new BybitWsClient();
  const candleManager = new CandleManager('BTCUSDT', db);
  const orderBookManager = new OrderBookManager('BTCUSDT');

  // Mock WS client as connected and healthy
  wsClient.isConnected = () => true;
  wsClient.getLastMessageTime = () => Date.now();

  // Seed orderbook snapshot so it is synced
  orderBookManager.handleSnapshot(
    [['60000.0', '1.0']],
    [['60000.1', '1.0']],
    100,
    Date.now(),
    1
  );

  const coordinator = new MarketCoordinator(
    restClient,
    wsClient,
    candleManager,
    orderBookManager,
    db,
    'BTCUSDT'
  );

  (coordinator as any).currentTicker = {
    symbol: 'BTCUSDT',
    lastPrice: 60000,
    markPrice: 60000,
    indexPrice: 60000,
    bid1Price: 59999.9,
    ask1Price: 60000.1,
    bid1Size: 1.0,
    ask1Size: 1.0,
    spread: 0.2,
    spreadPcnt: 0.0003,
    highPrice24h: 61000,
    lowPrice24h: 59000,
    prevPrice24h: 59500,
    price24hPcnt: 0.008,
    volume24h: 50000,
    turnover24h: 3000000000,
    fundingRate: 0.0001,
    nextFundingTime: Date.now() + 14400000,
    openInterest: 10000,
    openInterestValue: 600000000,
    timestamp: Date.now(),
  };

  return { db, coordinator, orderBookManager };
}

test('SnapshotBuilder - Creates immutable snapshot with integrity and SHA-256 ID', () => {
  const { coordinator, db } = setupTestEnvironment();
  const setup = createMockSetup();

  const snapshot = SnapshotBuilder.build(coordinator, setup);

  assert.ok(snapshot.snapshotId.startsWith('snap_'));
  assert.equal(snapshot.symbol, 'BTCUSDT');
  assert.ok(snapshot.ticker.lastPrice > 0);
  assert.ok(snapshot.orderBook.bidsTop5.length > 0);
  assert.equal(snapshot.orderBook.isSynced, true);
  assert.equal(snapshot.candidateSetup.id, setup.id);
  assert.ok(snapshot.dataIntegrity !== undefined);

  db.close();
});

test('ConsensusEngine - Dual APPROVE creates AUTHORIZED signal in SIGNALS_ONLY mode', async () => {
  const { coordinator, db } = setupTestEnvironment();
  const setup = createMockSetup();

  const openaiAdapter = new OpenAiAdapter({
    mockEvaluator: async () => ({
      verdict: 'APPROVE',
      confidence: 88,
      reasoning: 'Confluencia técnica óptima en marco de 15m y 1H.',
      structuralTargetRealistic: true,
      riskAssessment: { riskLevel: 'LOW', primaryRisks: [], invalidationTrigger: '59800' },
    }),
  });

  const geminiAdapter = new GeminiAdapter({
    mockEvaluator: async () => ({
      verdict: 'APPROVE',
      confidence: 82,
      reasoning: 'Auditoría crítica completada. No se detectan anomalías de absorción ni trampas.',
      structuralTargetRealistic: true,
      riskAssessment: { riskLevel: 'LOW', primaryRisks: [], invalidationTrigger: '59800' },
    }),
  });

  // Mock wsConnected in snapshot
  const snapshot = SnapshotBuilder.build(coordinator, setup);
  snapshot.dataIntegrity.wsConnected = true;

  const engine = new ConsensusEngine({
    coordinator,
    db,
    openaiAdapter,
    geminiAdapter,
  });

  const result = await engine.evaluateSetup(setup, snapshot);

  assert.equal(result.consensusVerdict, 'AUTHORIZED');
  assert.equal(result.status, 'ACTIVE');
  assert.equal(result.executionMode, 'SIGNALS_ONLY', 'Live trading must be strictly disabled');
  assert.equal(result.confidenceScore, 85);
  assert.equal(result.openaiReview?.verdict, 'APPROVE');
  assert.equal(result.geminiReview?.verdict, 'APPROVE');
  assert.equal(result.ruleViolations.length, 0);

  // Check persistence in SQLite
  const savedSignals = db.getSignals();
  assert.equal(savedSignals.length, 1);
  assert.equal(savedSignals[0].id, result.signalId);
  assert.equal(savedSignals[0].consensusVerdict, 'AUTHORIZED');

  const savedReviews = db.getAiReviews(setup.id);
  assert.equal(savedReviews.length, 2, 'Must persist reviews from both OpenAI and Gemini');

  db.close();
});

test('ConsensusEngine - Disagreement: OpenAI APPROVE + Gemini REJECT => DISCARDED', async () => {
  const { coordinator, db } = setupTestEnvironment();
  const setup = createMockSetup();

  const openaiAdapter = new OpenAiAdapter({
    mockEvaluator: async () => ({
      verdict: 'APPROVE',
      confidence: 85,
      reasoning: 'Tendencia alcista clara.',
    }),
  });

  const geminiAdapter = new GeminiAdapter({
    mockEvaluator: async () => ({
      verdict: 'REJECT',
      confidence: 90,
      reasoning: 'Divergencia bajista oculta y acumulación pasiva de órdenes vendedoras.',
    }),
  });

  const snapshot = SnapshotBuilder.build(coordinator, setup);
  snapshot.dataIntegrity.wsConnected = true;

  const engine = new ConsensusEngine({ coordinator, db, openaiAdapter, geminiAdapter });
  const result = await engine.evaluateSetup(setup, snapshot);

  assert.equal(result.consensusVerdict, 'DISCARDED');
  assert.equal(result.status, 'DISCARDED');
  assert.equal(result.rejectionReason, 'AI_VERDICT_REJECT');
  assert.ok(result.ruleViolations[0].includes('Rechazado por analista IA'));

  db.close();
});

test('ConsensusEngine - Disagreement: OpenAI REJECT + Gemini APPROVE => DISCARDED', async () => {
  const { coordinator, db } = setupTestEnvironment();
  const setup = createMockSetup();

  const openaiAdapter = new OpenAiAdapter({
    mockEvaluator: async () => ({
      verdict: 'REJECT',
      confidence: 80,
      reasoning: 'Falta desplazamiento limpio en la ruptura de estructura.',
    }),
  });

  const geminiAdapter = new GeminiAdapter({
    mockEvaluator: async () => ({
      verdict: 'APPROVE',
      confidence: 75,
      reasoning: 'Cumple reglas de mitigación.',
    }),
  });

  const snapshot = SnapshotBuilder.build(coordinator, setup);
  snapshot.dataIntegrity.wsConnected = true;

  const engine = new ConsensusEngine({ coordinator, db, openaiAdapter, geminiAdapter });
  const result = await engine.evaluateSetup(setup, snapshot);

  assert.equal(result.consensusVerdict, 'DISCARDED');
  assert.equal(result.rejectionReason, 'AI_VERDICT_REJECT');

  db.close();
});

test('ConsensusEngine - Dual WAIT => WAITING_CONDITIONS', async () => {
  const { coordinator, db } = setupTestEnvironment();
  const setup = createMockSetup();

  const openaiAdapter = new OpenAiAdapter({
    mockEvaluator: async () => ({
      verdict: 'WAIT',
      confidence: 60,
      reasoning: 'Esperar cierre de vela de 15m para confirmar absorción.',
    }),
  });

  const geminiAdapter = new GeminiAdapter({
    mockEvaluator: async () => ({
      verdict: 'WAIT',
      confidence: 65,
      reasoning: 'Esperar confirmación de volumen en microestructura.',
    }),
  });

  const snapshot = SnapshotBuilder.build(coordinator, setup);
  snapshot.dataIntegrity.wsConnected = true;

  const engine = new ConsensusEngine({ coordinator, db, openaiAdapter, geminiAdapter });
  const result = await engine.evaluateSetup(setup, snapshot);

  assert.equal(result.consensusVerdict, 'WAITING_CONDITIONS');
  assert.equal(result.status, 'ACTIVE');
  assert.equal(result.rejectionReason, 'AI_VERDICT_WAIT');

  db.close();
});

test('ConsensusEngine - Technical Net R:R < 4.0 strictly rejects EVEN IF both AIs APPROVE 100%', async () => {
  const { coordinator, db } = setupTestEnvironment();

  // Create an invalid setup where Net R:R is 2.5 (< 4.0)
  const badSetup = createMockSetup({
    takeProfitPrice: 60500, // Reward 500 vs Risk 200 -> R:R < 4.0
    riskReward: {
      direction: 'LONG',
      entryPrice: 60000,
      stopLossPrice: 59800,
      takeProfitPrice: 60500,
      positionSizeBTC: 0.25,
      notionalValueUSDT: 15000,
      grossRiskUSDT: 50,
      grossRewardUSDT: 125,
      grossRR: 2.5,
      entryFeeUSDT: 8.25,
      exitFeeTPUSDT: 2.5,
      exitFeeSLUSDT: 8.2,
      totalFeesUSDT: 10.75,
      fundingCostUSDT: 0,
      slippageCostUSDT: 3,
      spreadCostUSDT: 0.01,
      netLossUSDT: 69.45,
      netRewardUSDT: 110.0,
      netRR: 1.58, // << 4.0
      isValid: false,
      rejectionReason: 'Ratio R:R neto insuficiente: 1.58 < 4.0',
    },
  });

  let openaiCalled = false;
  let geminiCalled = false;

  const openaiAdapter = new OpenAiAdapter({
    mockEvaluator: async () => {
      openaiCalled = true;
      return { verdict: 'APPROVE', confidence: 100 };
    },
  });

  const geminiAdapter = new GeminiAdapter({
    mockEvaluator: async () => {
      geminiCalled = true;
      return { verdict: 'APPROVE', confidence: 100 };
    },
  });

  const snapshot = SnapshotBuilder.build(coordinator, badSetup);
  snapshot.dataIntegrity.wsConnected = true;

  const engine = new ConsensusEngine({ coordinator, db, openaiAdapter, geminiAdapter });
  const result = await engine.evaluateSetup(badSetup, snapshot);

  assert.equal(result.consensusVerdict, 'DISCARDED');
  assert.equal(result.rejectionReason, 'INSUFFICIENT_NET_RR');
  assert.equal(openaiCalled, false, 'AI must NOT be queried if deterministic technical gate fails');
  assert.equal(geminiCalled, false, 'AI must NOT be queried if deterministic technical gate fails');

  db.close();
});

test('ConsensusEngine - OrderBook Desync rejects setup immediately', async () => {
  const { coordinator, db } = setupTestEnvironment();
  const setup = createMockSetup();

  const snapshot = SnapshotBuilder.build(coordinator, setup);
  snapshot.dataIntegrity.isOrderBookSynced = false; // Desynced!

  const engine = new ConsensusEngine({ coordinator, db });
  const result = await engine.evaluateSetup(setup, snapshot);

  assert.equal(result.consensusVerdict, 'DISCARDED');
  assert.equal(result.rejectionReason, 'ORDERBOOK_DESYNCED');

  db.close();
});

test('ConsensusEngine - Stale Snapshot (> 10s) rejects setup', async () => {
  const { coordinator, db } = setupTestEnvironment();
  const setup = createMockSetup();

  const snapshot = SnapshotBuilder.build(coordinator, setup);
  snapshot.timestamp = Date.now() - 15000; // 15 seconds old

  const engine = new ConsensusEngine({ coordinator, db, maxSnapshotAgeMs: 10000 });
  const result = await engine.evaluateSetup(setup, snapshot);

  assert.equal(result.consensusVerdict, 'DISCARDED');
  assert.equal(result.rejectionReason, 'SNAPSHOT_STALE');

  db.close();
});

test('ConsensusEngine - Post-evaluation price drift (> 0.15%) expires the signal', async () => {
  const { coordinator, db, orderBookManager } = setupTestEnvironment();
  const setup = createMockSetup({ entryPrice: 60000 });

  const openaiAdapter = new OpenAiAdapter({
    mockEvaluator: async () => ({ verdict: 'APPROVE', confidence: 90, structuralTargetRealistic: true }),
  });
  const geminiAdapter = new GeminiAdapter({
    mockEvaluator: async () => ({ verdict: 'APPROVE', confidence: 90, structuralTargetRealistic: true }),
  });

  const snapshot = SnapshotBuilder.build(coordinator, setup);
  snapshot.dataIntegrity.wsConnected = true;

  // Simulate market price moving away by 0.3% ($180) to $60180 during evaluation
  (coordinator as any).currentTicker = {
    lastPrice: 60180, // Drift = 180 / 60000 = 0.003 (0.3% > 0.15%)
  };

  const engine = new ConsensusEngine({
    coordinator,
    db,
    openaiAdapter,
    geminiAdapter,
    maxPriceDriftPcnt: 0.0015,
  });

  const result = await engine.evaluateSetup(setup, snapshot);

  assert.equal(result.consensusVerdict, 'DISCARDED');
  assert.equal(result.status, 'EXPIRED');
  assert.equal(result.rejectionReason, 'PRICE_DRIFT_EXCEEDED');

  db.close();
});

test('ConsensusEngine - Daily AI Budget limit enforcement', async () => {
  const { coordinator, db } = setupTestEnvironment();
  const setup = createMockSetup();

  const costTracker = new CostTracker({ maxDailySpendUsd: 0.05, maxMonthlySpendUsd: 1.0 });
  // Artificially saturate daily spend
  costTracker.recordUsage('OPENAI', 'gpt-4o', 15000, 3000); // Exceeds $0.05

  const snapshot = SnapshotBuilder.build(coordinator, setup);
  snapshot.dataIntegrity.wsConnected = true;

  const engine = new ConsensusEngine({
    coordinator,
    db,
    costTracker,
  });

  const result = await engine.evaluateSetup(setup, snapshot);

  assert.equal(result.consensusVerdict, 'WAITING_CONDITIONS');
  assert.equal(result.rejectionReason, 'DAILY_AI_BUDGET_EXCEEDED');

  db.close();
});
