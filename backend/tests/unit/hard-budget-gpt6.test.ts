import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AI_MODELS_CATALOG,
  calculateCallCost,
  getModelMetadata,
} from '../../src/ai/models-catalog.js';
import {
  HardBudgetManager,
  DEFAULT_HARD_BUDGET_CONFIG,
} from '../../src/ai/hard-budget-manager.js';
import { OpenAiAdapter } from '../../src/ai/openai-adapter.js';
import { GeminiAdapter } from '../../src/ai/gemini-adapter.js';
import { ConsensusEngine } from '../../src/ai/consensus-engine.js';
import { CostTracker } from '../../src/ai/cost-tracker.js';

test('Fase 4.6 - GPT-6 Luna Catalog & Official Tariffs', () => {
  const meta = getModelMetadata('gpt-6-luna');
  assert.ok(meta);
  assert.equal(meta.id, 'gpt-6-luna');
  assert.equal(meta.provider, 'OPENAI');
  assert.equal(meta.status, 'ACTIVE');
  assert.equal(meta.estimatedInputCostPerMillion, 0.10); // $0.10 USD / 1M
  assert.equal(meta.estimatedCachedInputCostPerMillion, 0.01); // $0.01 USD / 1M
  assert.equal(meta.estimatedCacheWriteCostPerMillion, 0.125); // $0.125 USD / 1M
  assert.equal(meta.estimatedOutputCostPerMillion, 0.50); // $0.50 USD / 1M
  assert.equal(meta.supportsStructuredJson, true);
  assert.equal(meta.supportsReasoningEffort, true);
  assert.equal(meta.supportsResponsesApi, true);
});

test('Fase 4.6 - GPT-6 Luna Cost Calculation (Uncached & Standard Output)', () => {
  // 10,000 uncached input tokens: 10,000 * 0.10 / 1,000,000 = $0.001
  // 2,000 output tokens: 2,000 * 0.50 / 1,000,000 = $0.001
  // Total = $0.002
  const cost = calculateCallCost('gpt-6-luna', {
    promptTokens: 10000,
    completionTokens: 2000,
  });
  assert.ok(Math.abs(cost - 0.002) < 0.00001);
});

test('Fase 4.6 - GPT-6 Luna Cost Calculation (Cached Read & Reasoning Tokens)', () => {
  // Prompt: 20,000 total tokens, of which 15,000 cached and 5,000 uncached
  // Uncached: 5,000 * 0.10 / 1,000,000 = $0.0005
  // Cached read: 15,000 * 0.01 / 1,000,000 = $0.00015
  // API completionTokens reports 4,000 TOTAL output tokens, including 3,000 reasoning tokens
  // Output: 4,000 * 0.50 / 1,000,000 = $0.002
  // Total = $0.0005 + $0.00015 + $0.002 = $0.00265
  const cost = calculateCallCost('gpt-6-luna', {
    promptTokens: 20000,
    completionTokens: 4000,
    cachedTokens: 15000,
    reasoningTokens: 3000,
  });
  assert.ok(Math.abs(cost - 0.00265) < 0.00001);
});

test('Fase 4.6 - HardBudgetManager: Pre-call Atomic Reservation & Reconciliation', () => {
  const alerts: Array<{ title: string; message: string; severity: string }> = [];
  const budgetManager = new HardBudgetManager(
    {
      ...DEFAULT_HARD_BUDGET_CONFIG,
      dailyBudgetLimitUsd: 0.50, // $0.50 USD diario oficial
      monthlyBudgetLimitUsd: 10.00,
      maxCostPerRequestUsd: 0.05,
    },
    {
      sendTelegramAlert: async (title, message, severity) => {
        alerts.push({ title, message, severity });
      },
    }
  );

  const reservation = budgetManager.reserveBudget({
    provider: 'OPENAI',
    model: 'gpt-6-luna',
    task: 'SETUP_EVALUATION',
  });

  assert.equal(reservation.allowed, true);
  assert.ok(reservation.reservationId);
  assert.ok((reservation.reservedAmountUsd || 0) > 0);
  assert.equal(budgetManager.getReservedPendingUsd(), reservation.reservedAmountUsd);

  budgetManager.reconcileReservation(reservation.reservationId!, {
    provider: 'OPENAI',
    model: 'gpt-6-luna',
    task: 'SETUP_EVALUATION',
    promptTokens: 1800,
    completionTokens: 800,
    reasoningTokens: 200,
  });

  assert.equal(budgetManager.getReservedPendingUsd(), 0);
  assert.ok(budgetManager.getTodaySpendUsd() > 0);
});

test('Fase 4.6 - HardBudgetManager: Daily Limit ($0.50) Hard Stop and 50%/100% Alerts', () => {
  const alerts: Array<{ title: string; message: string; severity: string }> = [];
  const budgetManager = new HardBudgetManager(
    {
      ...DEFAULT_HARD_BUDGET_CONFIG,
      dailyBudgetLimitUsd: 0.50,
      monthlyBudgetLimitUsd: 10.00,
      maxCostPerRequestUsd: 0.05,
    },
    {
      sendTelegramAlert: async (title, message, severity) => {
        alerts.push({ title, message, severity });
      },
    }
  );

  // Spend over 50% ($0.26)
  const res1 = budgetManager.reserveBudget({
    provider: 'OPENAI',
    model: 'gpt-4o',
    task: 'SETUP_EVALUATION',
  });
  assert.equal(res1.allowed, true);
  budgetManager.reconcileReservation(res1.reservationId!, {
    provider: 'OPENAI',
    model: 'gpt-4o',
    task: 'SETUP_EVALUATION',
    promptTokens: 50000,
    completionTokens: 13500, // $0.125 + $0.135 = $0.26
  });

  assert.ok(budgetManager.getTodaySpendUsd() >= 0.25);
  const alert50 = alerts.find((a) => a.title.includes('50%'));
  assert.ok(alert50);

  // Spend over 100% ($0.50)
  const res2 = budgetManager.reserveBudget({
    provider: 'OPENAI',
    model: 'gpt-4o',
    task: 'SETUP_EVALUATION',
  });
  assert.equal(res2.allowed, true);
  budgetManager.reconcileReservation(res2.reservationId!, {
    provider: 'OPENAI',
    model: 'gpt-4o',
    task: 'SETUP_EVALUATION',
    promptTokens: 50000,
    completionTokens: 15000, // another $0.275 -> total > $0.50
  });

  assert.equal(budgetManager.isBlocked(), true);
  assert.equal(budgetManager.getSummary().status, 'AI_BUDGET_EXCEEDED');

  // Next reservation must be blocked
  const res3 = budgetManager.reserveBudget({
    provider: 'OPENAI',
    model: 'gpt-6-luna',
    task: 'RISK_AUDIT',
  });
  assert.equal(res3.allowed, false);
  assert.equal(res3.status, 'AI_BUDGET_EXCEEDED');
});

test('Fase 4.6 - HardBudgetManager: Admin Reactivation', () => {
  const budgetManager = new HardBudgetManager({
    ...DEFAULT_HARD_BUDGET_CONFIG,
    dailyBudgetLimitUsd: 0.50,
  });

  budgetManager.triggerBlock('Test block');
  assert.equal(budgetManager.isBlocked(), true);

  budgetManager.reactivateBudget('admin', 1.00);
  assert.equal(budgetManager.isBlocked(), false);
  assert.equal(budgetManager.getConfig().dailyBudgetLimitUsd, 1.00);
});

test('Fase 4.6 - Dynamic Adapter Credentials Update and Consensus Propagation', () => {
  const openAiAdapter = new OpenAiAdapter({ apiKey: '', model: 'gpt-4o' });
  const geminiAdapter = new GeminiAdapter({ apiKey: '', model: 'gemini-2.0-flash' });
  const costTracker = new CostTracker({ maxDailySpendUsd: 5.0, maxMonthlySpendUsd: 50.0 });
  const budgetManager = new HardBudgetManager({
    ...DEFAULT_HARD_BUDGET_CONFIG,
    dailyBudgetLimitUsd: 0.50,
  });

  const consensus = new ConsensusEngine({
    coordinator: {} as any,
    db: {} as any,
    openaiAdapter: openAiAdapter,
    geminiAdapter: geminiAdapter,
    costTracker,
    hardBudgetManager: budgetManager,
  });

  assert.equal(consensus.getCurrentEvaluationMode(), 'AI_UNAVAILABLE');

  // Set OpenAI key dynamically
  consensus.updateAiCredentials('openai', 'sk-test-live-key', 'gpt-6-luna', 'high');
  assert.equal(consensus.getOpenAiAdapter().getStatus().configured, true);
  assert.equal(consensus.getOpenAiAdapter().getStatus().model, 'gpt-6-luna');
  assert.equal(consensus.getCurrentEvaluationMode(), 'SINGLE_AI_OPENAI');

  // Set Gemini key dynamically
  consensus.updateAiCredentials('gemini', 'AIzaSyTestKey', 'gemini-1.5-flash');
  assert.equal(consensus.getGeminiAdapter().getStatus().configured, true);
  assert.equal(consensus.getGeminiAdapter().getStatus().model, 'gemini-1.5-flash');
  assert.equal(consensus.getCurrentEvaluationMode(), 'DUAL_AI');

  // If hard budget triggers block, mode shifts to AI_BUDGET_EXCEEDED
  budgetManager.triggerBlock('Daily limit reached');
  assert.equal(consensus.getCurrentEvaluationMode(), 'AI_BUDGET_EXCEEDED');
});
