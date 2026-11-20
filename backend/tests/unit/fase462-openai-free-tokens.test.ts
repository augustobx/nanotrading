import { describe, it } from 'node:test';
import assert from 'node:assert';
import { HardBudgetManager, DEFAULT_HARD_BUDGET_CONFIG } from '../../src/ai/hard-budget-manager.js';
import { AiModelRouter } from '../../src/ai/router/ai-router.js';
import { OPENAI_FREE_TIER_LIMITS, getModelFreeTierGroup } from '../../src/ai/models-catalog.js';

describe('Fase 4.6.2 — Integración Oficial de Tokens Gratuitos de OpenAI (Data Sharing)', () => {
  // -------------------------------------------------------------------------
  // 1. Configuración y No Asunción de Beneficio hasta Verificación
  // -------------------------------------------------------------------------
  it('1. No asume beneficio activo hasta ser verificado oficialmente', () => {
    const budget = new HardBudgetManager({
      dailyBudgetLimitUsd: 0.50,
      openaiFreeTier: {
        enabled: true,
        verified: false, // NO verificado
        mainGroupDailyLimitTokens: 250_000,
        smallGroupDailyLimitTokens: 2_500_000,
      },
    });

    // Sin verificación, el beneficio es 0 y se factura 100% costo bruto
    const benefit = budget.calculateFreeTierBenefit('gpt-4o', 2000, 0.02);
    assert.strictEqual(benefit.isFree, false);
    assert.strictEqual(benefit.discountUsd, 0);
    assert.strictEqual(benefit.netCostUsd, 0.02);
    assert.match(benefit.reason, /no verificado/i);
    assert.strictEqual(budget.getRemainingFreeTokens('MAIN'), 0);
  });

  // -------------------------------------------------------------------------
  // 2. Consumo Compartido en Grupo Principal (250.000 tokens)
  // -------------------------------------------------------------------------
  it('2. Grupo Principal: consumo compartido entre gpt-4o y gpt-6-luna (250.000 tokens)', () => {
    const budget = new HardBudgetManager({
      dailyBudgetLimitUsd: 0.50,
      openaiFreeTier: {
        enabled: true,
        verified: true, // Verificado
        mainGroupDailyLimitTokens: 250_000,
        smallGroupDailyLimitTokens: 2_500_000,
      },
    });

    assert.strictEqual(getModelFreeTierGroup('gpt-4o'), 'MAIN');
    assert.strictEqual(getModelFreeTierGroup('gpt-6-luna'), 'MAIN');
    assert.strictEqual(budget.getRemainingFreeTokens('MAIN'), 250_000);

    // Call 1: gpt-4o consume 100.000 tokens
    const res1 = budget.reserveBudget({
      provider: 'OPENAI',
      model: 'gpt-4o',
      task: 'SETUP_EVALUATION',
      estimatedTokens: 100_000,
    });
    assert.strictEqual(res1.allowed, true);
    assert.strictEqual(res1.reservedAmountUsd, 0); // Bonificado

    const r1 = budget.reconcileReservation(res1.reservationId!, {
      provider: 'OPENAI',
      model: 'gpt-4o',
      task: 'SETUP_EVALUATION',
      promptTokens: 80_000,
      completionTokens: 20_000,
    });
    assert.strictEqual(r1.isFreeTier, true);
    assert.strictEqual(r1.discountUsd > 0, true);
    assert.strictEqual(r1.netCostUsd, 0);
    assert.strictEqual(budget.getRemainingFreeTokens('MAIN'), 150_000);

    // Call 2: gpt-6-luna consume 50.000 tokens del mismo fondo compartido
    const res2 = budget.reserveBudget({
      provider: 'OPENAI',
      model: 'gpt-6-luna',
      task: 'SETUP_EVALUATION',
      estimatedTokens: 50_000,
    });
    assert.strictEqual(res2.allowed, true);

    const r2 = budget.reconcileReservation(res2.reservationId!, {
      provider: 'OPENAI',
      model: 'gpt-6-luna',
      task: 'SETUP_EVALUATION',
      promptTokens: 40_000,
      completionTokens: 10_000,
      reasoningTokens: 5_000,
    });
    assert.strictEqual(r2.isFreeTier, true);
    assert.strictEqual(r2.netCostUsd, 0);
    // 250k - 100k - 55k = 95k restantes
    assert.strictEqual(budget.getRemainingFreeTokens('MAIN'), 95_000);
  });

  // -------------------------------------------------------------------------
  // 3. Consumo Compartido en Grupo Modelos Pequeños (2.500.000 tokens)
  // -------------------------------------------------------------------------
  it('3. Grupo Modelos Pequeños: consumo compartido entre gpt-4o-mini y o3-mini (2.500.000 tokens)', () => {
    const budget = new HardBudgetManager({
      dailyBudgetLimitUsd: 0.50,
      openaiFreeTier: {
        enabled: true,
        verified: true,
        mainGroupDailyLimitTokens: 250_000,
        smallGroupDailyLimitTokens: 2_500_000,
      },
    });

    assert.strictEqual(getModelFreeTierGroup('gpt-4o-mini'), 'SMALL');
    assert.strictEqual(getModelFreeTierGroup('o3-mini'), 'SMALL');
    assert.strictEqual(budget.getRemainingFreeTokens('SMALL'), 2_500_000);

    // gpt-4o-mini usa 500.000 tokens
    const res1 = budget.reserveBudget({
      provider: 'OPENAI',
      model: 'gpt-4o-mini',
      task: 'MARKET_SUMMARY',
      estimatedTokens: 500_000,
    });
    budget.reconcileReservation(res1.reservationId!, {
      provider: 'OPENAI',
      model: 'gpt-4o-mini',
      task: 'MARKET_SUMMARY',
      promptTokens: 400_000,
      completionTokens: 100_000,
    });

    assert.strictEqual(budget.getRemainingFreeTokens('SMALL'), 2_000_000);

    // o3-mini usa 1.000.000 tokens (incluyendo reasoning tokens)
    const res2 = budget.reserveBudget({
      provider: 'OPENAI',
      model: 'o3-mini',
      task: 'RISK_AUDIT',
      estimatedTokens: 1_000_000,
    });
    budget.reconcileReservation(res2.reservationId!, {
      provider: 'OPENAI',
      model: 'o3-mini',
      task: 'RISK_AUDIT',
      promptTokens: 500_000,
      completionTokens: 200_000,
      reasoningTokens: 300_000,
    });

    assert.strictEqual(budget.getRemainingFreeTokens('SMALL'), 1_000_000);
  });

  // -------------------------------------------------------------------------
  // 4. Regla Oficial de Exceso: Si supera el cupo remanente, se factura 100%
  // -------------------------------------------------------------------------
  it('4. Regla de Exceso Oficial: Solicitud que excede remanente se factura 100% costo bruto', () => {
    const budget = new HardBudgetManager({
      dailyBudgetLimitUsd: 1.00,
      maxCostPerRequestUsd: 0.20,
      openaiFreeTier: {
        enabled: true,
        verified: true,
        mainGroupDailyLimitTokens: 250_000,
        smallGroupDailyLimitTokens: 2_500_000,
      },
    });

    // Consumimos 240.000 tokens en Grupo Principal -> Quedan 10.000 tokens libres
    const res1 = budget.reserveBudget({
      provider: 'OPENAI',
      model: 'gpt-4o',
      task: 'SETUP_EVALUATION',
      estimatedTokens: 240_000,
    });
    budget.reconcileReservation(res1.reservationId!, {
      provider: 'OPENAI',
      model: 'gpt-4o',
      task: 'SETUP_EVALUATION',
      promptTokens: 200_000,
      completionTokens: 40_000,
    });
    assert.strictEqual(budget.getRemainingFreeTokens('MAIN'), 10_000);

    // Solicitud siguiente requiere 15.000 tokens (> 10.000 restantes)
    // REGLA OFICIAL: No se descuenta parcial, sino que se factura 100% a tarifa estándar
    const benefit = budget.calculateFreeTierBenefit('gpt-4o', 15_000, 0.08);
    assert.strictEqual(benefit.isFree, false);
    assert.strictEqual(benefit.discountUsd, 0);
    assert.strictEqual(benefit.netCostUsd, 0.08);
    assert.match(benefit.reason, /supera cupo gratuito remanente/i);

    // Al reconciliar una solicitud que excedió el cupo:
    const res2 = budget.reserveBudget({
      provider: 'OPENAI',
      model: 'gpt-4o',
      task: 'SETUP_EVALUATION',
      maxEstimatedCostUsd: 0.08,
      estimatedTokens: 15_000,
    });
    const r2 = budget.reconcileReservation(res2.reservationId!, {
      provider: 'OPENAI',
      model: 'gpt-4o',
      task: 'SETUP_EVALUATION',
      promptTokens: 10_000,
      completionTokens: 5_000,
      costUsd: 0.08,
    });
    assert.strictEqual(r2.isFreeTier, false);
    assert.strictEqual(r2.netCostUsd, 0.08);
    // El cupo remanente de 10.000 se mantiene intacto porque la solicitud fue pagada 100%
    assert.strictEqual(budget.getRemainingFreeTokens('MAIN'), 10_000);
    assert.strictEqual(budget.getTodaySpendUsd(), 0.08);
  });

  // -------------------------------------------------------------------------
  // 5. Inviolabilidad del Hard Budget Limit ($0.50)
  // -------------------------------------------------------------------------
  it('5. Hard Budget Inviolable: Nunca supera límite monetario asumiendo que será gratuita', () => {
    const budget = new HardBudgetManager({
      dailyBudgetLimitUsd: 0.10, // Límite estricto bajo para la prueba
      openaiFreeTier: {
        enabled: true,
        verified: false, // NO verificado: NUNCA asumir gratis
        mainGroupDailyLimitTokens: 250_000,
        smallGroupDailyLimitTokens: 2_500_000,
      },
    });

    // Simulamos un gasto previo de $0.09
    budget.recordDirectUsage('OPENAI', 'gpt-4o-mini', 'MARKET_SUMMARY', 0.09);
    assert.strictEqual(budget.getTodaySpendUsd(), 0.09);

    // Intentamos reservar una llamada con costo estimado de $0.03
    // Como no está verificado, DEBE comprobar contra el límite diario ($0.09 + $0.03 = $0.12 > $0.10)
    // y bloquear inmediatamente!
    const res = budget.reserveBudget({
      provider: 'OPENAI',
      model: 'gpt-4o',
      task: 'SETUP_EVALUATION',
      maxEstimatedCostUsd: 0.03,
      estimatedTokens: 3000,
    });

    assert.strictEqual(res.allowed, false);
    assert.strictEqual(res.status, 'AI_BUDGET_EXCEEDED');
    assert.strictEqual(budget.isBlocked(), true);
  });

  // -------------------------------------------------------------------------
  // 6. Router Inteligente: Priorización de Elegibles y Fallback
  // -------------------------------------------------------------------------
  it('6. Router Inteligente: prioriza gpt-4o cuando hay cupo y hace fallback a gpt-4o-mini al agotarse', () => {
    const router = new AiModelRouter({
      mode: 'AUTOMATIC',
      profile: 'BALANCED',
      manualGlobal: { openaiModel: 'gpt-4o', geminiModel: 'gemini-2.0-flash' },
      manualByTask: {},
      dailyBudgetLimitUsd: 0.50,
      monthlyBudgetLimitUsd: 10.00,
      updatedAt: Date.now(),
    });

    // Caso A: Free Tier activo con cupo libre en Grupo Principal (200k restantes)
    const decisionWithQuota = router.routeModel('SETUP_EVALUATION', 'OPENAI', 0.40, {
      enabled: true,
      verified: true,
      mainRemainingTokens: 200_000,
      smallRemainingTokens: 2_000_000,
    });
    assert.strictEqual(decisionWithQuota.selectedModel, 'gpt-4o');
    assert.match(decisionWithQuota.selectionReason, /Beneficio OpenAI Free Tier activo/i);

    // Caso B: Tarea ligera con cupo en Grupo Pequeños
    const lightDecision = router.routeModel('MARKET_SUMMARY', 'OPENAI', 0.40, {
      enabled: true,
      verified: true,
      mainRemainingTokens: 200_000,
      smallRemainingTokens: 2_000_000,
    });
    assert.strictEqual(lightDecision.selectedModel, 'gpt-4o-mini');

    // Caso C: Cupo Grupo Principal AGOTADO (0 tokens) y presupuesto bajo
    // Debe hacer fallback a modelo económico sin romper reglas de riesgo
    const decisionExhausted = router.routeModel('SETUP_EVALUATION', 'OPENAI', 0.20, {
      enabled: true,
      verified: true,
      mainRemainingTokens: 0,
      smallRemainingTokens: 1_500_000,
    });
    assert.strictEqual(decisionExhausted.selectedModel, 'gpt-4o-mini');
    assert.match(decisionExhausted.selectionReason, /fallback/i);
  });

  // -------------------------------------------------------------------------
  // 7. Alertas a los Umbrales 80%, 95% y 100% de Cupo Gratuito
  // -------------------------------------------------------------------------
  it('7. Alertas deduplicadas al 80%, 95% y 100% del cupo gratuito de cada grupo', () => {
    const alertsReceived: string[] = [];
    const budget = new HardBudgetManager(
      {
        dailyBudgetLimitUsd: 1.00,
        openaiFreeTier: {
          enabled: true,
          verified: true,
          mainGroupDailyLimitTokens: 100_000, // Limite para testing
          smallGroupDailyLimitTokens: 1_000_000,
        },
      },
      {
        sendTelegramAlert: async (title, msg) => {
          alertsReceived.push(title);
        },
      }
    );

    // 1. Llegamos al 80% (80.000 tokens)
    const res80 = budget.reserveBudget({ provider: 'OPENAI', model: 'gpt-4o', task: 'SETUP_EVALUATION', estimatedTokens: 80_000 });
    budget.reconcileReservation(res80.reservationId!, {
      provider: 'OPENAI',
      model: 'gpt-4o',
      task: 'SETUP_EVALUATION',
      promptTokens: 60_000,
      completionTokens: 20_000,
    });
    assert.strictEqual(alertsReceived.some((a) => a.includes('80%')), true);

    // 2. Llegamos al 95% (95.000 tokens)
    const res95 = budget.reserveBudget({ provider: 'OPENAI', model: 'gpt-4o', task: 'SETUP_EVALUATION', estimatedTokens: 15_000 });
    budget.reconcileReservation(res95.reservationId!, {
      provider: 'OPENAI',
      model: 'gpt-4o',
      task: 'SETUP_EVALUATION',
      promptTokens: 10_000,
      completionTokens: 5_000,
    });
    assert.strictEqual(alertsReceived.some((a) => a.includes('95%')), true);

    // 3. Llegamos al 100% (100.000 tokens agotados)
    const res100 = budget.reserveBudget({ provider: 'OPENAI', model: 'gpt-4o', task: 'SETUP_EVALUATION', estimatedTokens: 5_000 });
    budget.reconcileReservation(res100.reservationId!, {
      provider: 'OPENAI',
      model: 'gpt-4o',
      task: 'SETUP_EVALUATION',
      promptTokens: 4_000,
      completionTokens: 1_000,
    });
    assert.strictEqual(alertsReceived.some((a) => a.includes('Agotado') || a.includes('100%')), true);
  });

  // -------------------------------------------------------------------------
  // 8. Independencia Total de Gemini
  // -------------------------------------------------------------------------
  it('8. Gemini permanece totalmente independiente con su propio presupuesto y facturación', () => {
    const budget = new HardBudgetManager({
      dailyBudgetLimitUsd: 0.50,
      providerLimitsUsd: {
        openai: 0.30,
        gemini: 0.20,
      },
      openaiFreeTier: {
        enabled: true,
        verified: true,
        mainGroupDailyLimitTokens: 250_000,
        smallGroupDailyLimitTokens: 2_500_000,
      },
    });

    // OpenAI consume 10.000 tokens gratuitos (costo neto $0)
    const resOpenai = budget.reserveBudget({ provider: 'OPENAI', model: 'gpt-4o', task: 'SETUP_EVALUATION', estimatedTokens: 10_000 });
    budget.reconcileReservation(resOpenai.reservationId!, {
      provider: 'OPENAI',
      model: 'gpt-4o',
      task: 'SETUP_EVALUATION',
      promptTokens: 8000,
      completionTokens: 2000,
    });

    // Gemini realiza llamada paga estándar ($0.05)
    const resGemini = budget.reserveBudget({ provider: 'GEMINI', model: 'gemini-2.0-flash', task: 'RISK_AUDIT', maxEstimatedCostUsd: 0.05 });
    assert.strictEqual(resGemini.allowed, true);
    budget.reconcileReservation(resGemini.reservationId!, {
      provider: 'GEMINI',
      model: 'gemini-2.0-flash',
      task: 'RISK_AUDIT',
      promptTokens: 1000,
      completionTokens: 500,
      costUsd: 0.05,
    });

    const summary = budget.getSummary();
    assert.strictEqual(summary.spendByProvider.OPENAI, 0); // Bonificado
    assert.strictEqual(summary.spendByProvider.GEMINI, 0.05); // Facturado normalmente
    assert.strictEqual(summary.todaySpendUsd, 0.05);
  });

  // -------------------------------------------------------------------------
  // 9. Desglose Completo en getSummary() (Item 8 del requerimiento)
  // -------------------------------------------------------------------------
  it('9. getSummary() reporta métricas segregadas: consumidos, gratuitos, remanentes, bruto, descuento y neto', () => {
    const budget = new HardBudgetManager({
      dailyBudgetLimitUsd: 1.00,
      openaiFreeTier: {
        enabled: true,
        verified: true,
        mainGroupDailyLimitTokens: 250_000,
        smallGroupDailyLimitTokens: 2_500_000,
      },
    });

    const res = budget.reserveBudget({ provider: 'OPENAI', model: 'gpt-4o', task: 'SETUP_EVALUATION', estimatedTokens: 50_000 });
    budget.reconcileReservation(res.reservationId!, {
      provider: 'OPENAI',
      model: 'gpt-4o',
      task: 'SETUP_EVALUATION',
      promptTokens: 40_000,
      completionTokens: 10_000,
    });

    const summary = budget.getSummary();
    assert.strictEqual(summary.openaiFreeTier.enabled, true);
    assert.strictEqual(summary.openaiFreeTier.verified, true);
    assert.strictEqual(summary.openaiFreeTier.mainGroup.usedTokens, 50_000);
    assert.strictEqual(summary.openaiFreeTier.mainGroup.remainingTokens, 200_000);
    assert.strictEqual(summary.openaiFreeTier.mainGroup.percentUsed, 20);
    assert.strictEqual(summary.openaiFreeTier.financialsToday.freeTokensConsumed, 50_000);
    assert.strictEqual(summary.openaiFreeTier.financialsToday.grossSpendUsd > 0, true);
    assert.strictEqual(summary.openaiFreeTier.financialsToday.discountUsd > 0, true);
    assert.strictEqual(summary.openaiFreeTier.financialsToday.netSpendUsd, 0);
  });
});
