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
    id: `setup_fb_${Date.now()}_${Math.random()}`,
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

  wsClient.isConnected = () => true;
  wsClient.getLastMessageTime = () => Date.now();

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
    fundingRate: 0.0001,
    openInterest: 10000,
    timestamp: Date.now(),
  };

  return { db, coordinator };
}

test('AI Fallback - DUAL_AI mode when both OpenAI and Gemini are functional', async () => {
  const { coordinator, db } = setupTestEnvironment();
  const setup = createMockSetup();

  const openaiAdapter = new OpenAiAdapter({
    mockEvaluator: async () => ({
      verdict: 'APPROVE',
      confidence: 85,
      availabilityStatus: 'AVAILABLE',
      structuralTargetRealistic: true,
    }),
  });

  const geminiAdapter = new GeminiAdapter({
    mockEvaluator: async () => ({
      verdict: 'APPROVE',
      confidence: 80,
      availabilityStatus: 'AVAILABLE',
      structuralTargetRealistic: true,
    }),
  });

  const snapshot = SnapshotBuilder.build(coordinator, setup);
  snapshot.dataIntegrity.wsConnected = true;

  const engine = new ConsensusEngine({ coordinator, db, openaiAdapter, geminiAdapter });
  const result = await engine.evaluateSetup(setup, snapshot);

  assert.equal(result.consensusVerdict, 'AUTHORIZED');
  assert.equal(result.evaluationMode, 'DUAL_AI');
  assert.equal(result.status, 'ACTIVE');
  assert.equal(result.confidenceScore, 83); // (85 + 80) / 2

  // Check DB persistence of evaluationMode
  const saved = db.getSignals();
  assert.equal(saved[0].evaluationMode, 'DUAL_AI');

  db.close();
});

test('AI Fallback - SINGLE_AI_OPENAI when Gemini is unconfigured or unavailable and OpenAI approves', async () => {
  const { coordinator, db } = setupTestEnvironment();
  const setup = createMockSetup();

  const openaiAdapter = new OpenAiAdapter({
    mockEvaluator: async () => ({
      verdict: 'APPROVE',
      confidence: 88,
      availabilityStatus: 'AVAILABLE',
      structuralTargetRealistic: true,
    }),
  });

  const geminiAdapter = new GeminiAdapter({
    mockEvaluator: async () => ({
      verdict: 'WAIT',
      confidence: 0,
      availabilityStatus: 'UNCONFIGURED',
      error: 'GEMINI_API_KEY no configurada',
    }),
  });

  const snapshot = SnapshotBuilder.build(coordinator, setup);
  snapshot.dataIntegrity.wsConnected = true;

  const engine = new ConsensusEngine({ coordinator, db, openaiAdapter, geminiAdapter });
  const result = await engine.evaluateSetup(setup, snapshot);

  assert.equal(result.consensusVerdict, 'AUTHORIZED');
  assert.equal(result.evaluationMode, 'SINGLE_AI_OPENAI');
  assert.equal(result.confidenceScore, 88);
  assert.equal(result.status, 'ACTIVE');

  const saved = db.getSignals();
  assert.equal(saved[0].evaluationMode, 'SINGLE_AI_OPENAI');

  db.close();
});

test('AI Fallback - SINGLE_AI_OPENAI preserves OpenAI REJECT without bypassing', async () => {
  const { coordinator, db } = setupTestEnvironment();
  const setup = createMockSetup();

  const openaiAdapter = new OpenAiAdapter({
    mockEvaluator: async () => ({
      verdict: 'REJECT',
      confidence: 90,
      availabilityStatus: 'AVAILABLE',
      reasoning: 'Ruptura estructural dudosa y mecha de absorción superior.',
    }),
  });

  const geminiAdapter = new GeminiAdapter({
    mockEvaluator: async () => ({
      verdict: 'WAIT',
      confidence: 0,
      availabilityStatus: 'TIMEOUT',
      error: 'Timeout al conectar con Gemini',
    }),
  });

  const snapshot = SnapshotBuilder.build(coordinator, setup);
  snapshot.dataIntegrity.wsConnected = true;

  const engine = new ConsensusEngine({ coordinator, db, openaiAdapter, geminiAdapter });
  const result = await engine.evaluateSetup(setup, snapshot);

  // CRUCIAL: Must NOT authorize! Must reject!
  assert.equal(result.consensusVerdict, 'DISCARDED');
  assert.equal(result.evaluationMode, 'SINGLE_AI_OPENAI');
  assert.equal(result.rejectionReason, 'AI_VERDICT_REJECT');
  assert.ok(result.ruleViolations[0].includes('Rechazado por OpenAI'));

  db.close();
});

test('AI Fallback - SINGLE_AI_GEMINI when OpenAI is unavailable and Gemini approves', async () => {
  const { coordinator, db } = setupTestEnvironment();
  const setup = createMockSetup();

  const openaiAdapter = new OpenAiAdapter({
    mockEvaluator: async () => ({
      verdict: 'WAIT',
      confidence: 0,
      availabilityStatus: 'AUTH_ERROR',
      error: 'OpenAI API key invalid (401)',
    }),
  });

  const geminiAdapter = new GeminiAdapter({
    mockEvaluator: async () => ({
      verdict: 'APPROVE',
      confidence: 84,
      availabilityStatus: 'AVAILABLE',
      structuralTargetRealistic: true,
      reasoning: 'Auditoría crítica validada independientemente.',
    }),
  });

  const snapshot = SnapshotBuilder.build(coordinator, setup);
  snapshot.dataIntegrity.wsConnected = true;

  const engine = new ConsensusEngine({ coordinator, db, openaiAdapter, geminiAdapter });
  const result = await engine.evaluateSetup(setup, snapshot);

  assert.equal(result.consensusVerdict, 'AUTHORIZED');
  assert.equal(result.evaluationMode, 'SINGLE_AI_GEMINI');
  assert.equal(result.confidenceScore, 84);
  assert.equal(result.status, 'ACTIVE');

  const saved = db.getSignals();
  assert.equal(saved[0].evaluationMode, 'SINGLE_AI_GEMINI');

  db.close();
});

test('AI Fallback - SINGLE_AI_GEMINI preserves Gemini REJECT without bypassing', async () => {
  const { coordinator, db } = setupTestEnvironment();
  const setup = createMockSetup();

  const openaiAdapter = new OpenAiAdapter({
    mockEvaluator: async () => ({
      verdict: 'WAIT',
      confidence: 0,
      availabilityStatus: 'RATE_LIMIT_EXCEEDED',
      error: 'Rate limit exceeded (429)',
    }),
  });

  const geminiAdapter = new GeminiAdapter({
    mockEvaluator: async () => ({
      verdict: 'REJECT',
      confidence: 85,
      availabilityStatus: 'AVAILABLE',
      reasoning: 'Trampa de liquidez evidente bajo mínimos iguales.',
    }),
  });

  const snapshot = SnapshotBuilder.build(coordinator, setup);
  snapshot.dataIntegrity.wsConnected = true;

  const engine = new ConsensusEngine({ coordinator, db, openaiAdapter, geminiAdapter });
  const result = await engine.evaluateSetup(setup, snapshot);

  assert.equal(result.consensusVerdict, 'DISCARDED');
  assert.equal(result.evaluationMode, 'SINGLE_AI_GEMINI');
  assert.equal(result.rejectionReason, 'AI_VERDICT_REJECT');
  assert.ok(result.ruleViolations[0].includes('Rechazado por Gemini'));

  db.close();
});

test('AI Fallback - AI_UNAVAILABLE when neither provider is available', async () => {
  const { coordinator, db } = setupTestEnvironment();
  const setup = createMockSetup();

  const openaiAdapter = new OpenAiAdapter({
    mockEvaluator: async () => ({
      verdict: 'WAIT',
      confidence: 0,
      availabilityStatus: 'UNCONFIGURED',
      error: 'OPENAI_API_KEY no configurada',
    }),
  });

  const geminiAdapter = new GeminiAdapter({
    mockEvaluator: async () => ({
      verdict: 'WAIT',
      confidence: 0,
      availabilityStatus: 'PROVIDER_ERROR',
      error: 'Connection reset by peer (503)',
    }),
  });

  const snapshot = SnapshotBuilder.build(coordinator, setup);
  snapshot.dataIntegrity.wsConnected = true;

  const engine = new ConsensusEngine({ coordinator, db, openaiAdapter, geminiAdapter });
  const result = await engine.evaluateSetup(setup, snapshot);

  assert.equal(result.consensusVerdict, 'WAITING_CONDITIONS');
  assert.equal(result.evaluationMode, 'AI_UNAVAILABLE');
  assert.equal(result.rejectionReason, 'AI_UNAVAILABLE');
  assert.ok(result.ruleViolations[0].includes('Ni OpenAI ni Gemini están disponibles'));

  db.close();
});

test('AI Fallback - Dynamic recovery to DUAL_AI when both providers recover', async () => {
  const { coordinator, db } = setupTestEnvironment();
  const setup1 = createMockSetup();
  const setup2 = createMockSetup();

  let geminiAvailable = false;

  const openaiAdapter = new OpenAiAdapter({
    mockEvaluator: async () => ({
      verdict: 'APPROVE',
      confidence: 85,
      availabilityStatus: 'AVAILABLE',
      structuralTargetRealistic: true,
    }),
  });

  const geminiAdapter = new GeminiAdapter({
    mockEvaluator: async () => {
      if (!geminiAvailable) {
        return {
          verdict: 'WAIT',
          confidence: 0,
          availabilityStatus: 'TIMEOUT',
          error: 'Gemini request timed out',
        };
      }
      return {
        verdict: 'APPROVE',
        confidence: 80,
        availabilityStatus: 'AVAILABLE',
        structuralTargetRealistic: true,
      };
    },
  });

  const engine = new ConsensusEngine({ coordinator, db, openaiAdapter, geminiAdapter });

  // First evaluation: Gemini down -> SINGLE_AI_OPENAI
  const snapshot1 = SnapshotBuilder.build(coordinator, setup1);
  snapshot1.dataIntegrity.wsConnected = true;
  const res1 = await engine.evaluateSetup(setup1, snapshot1);
  assert.equal(res1.consensusVerdict, 'AUTHORIZED');
  assert.equal(res1.evaluationMode, 'SINGLE_AI_OPENAI');

  // Gemini recovers!
  geminiAvailable = true;

  // Second evaluation: Both up -> DUAL_AI automatically recovered
  const snapshot2 = SnapshotBuilder.build(coordinator, setup2);
  snapshot2.dataIntegrity.wsConnected = true;
  const res2 = await engine.evaluateSetup(setup2, snapshot2);
  assert.equal(res2.consensusVerdict, 'AUTHORIZED');
  assert.equal(res2.evaluationMode, 'DUAL_AI');

  db.close();
});
