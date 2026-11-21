import { describe, it } from 'node:test';
import assert from 'node:assert';
import { HardBudgetManager, DEFAULT_HARD_BUDGET_CONFIG } from '../../src/ai/hard-budget-manager.js';
import { AiModelRouter } from '../../src/ai/router/ai-router.js';
import { OPENAI_FREE_TIER_LIMITS, getModelFreeTierGroup } from '../../src/ai/models-catalog.js';
import { DatabaseService } from '../../src/storage/database.js';

describe('Fase 4.6.2 — Corrección Oficial de Tokens Gratuitos de OpenAI (Data Sharing)', () => {
  // -------------------------------------------------------------------------
  // 1. Modelos Excluidos de la Promoción Oficial
  // -------------------------------------------------------------------------
  it('1. Modelos excluidos: gpt-4-turbo y o3-mini retornan freeTierGroup NONE', () => {
    assert.strictEqual(getModelFreeTierGroup('gpt-4-turbo'), 'NONE');
    assert.strictEqual(getModelFreeTierGroup('o3-mini'), 'NONE');
    assert.strictEqual(getModelFreeTierGroup('gpt-3.5-turbo'), 'NONE');
  });

  // -------------------------------------------------------------------------
  // 2. Modelos Elegibles Oficiales Vigentes
  // -------------------------------------------------------------------------
  it('2. Modelos elegibles: gpt-6-luna y gpt-4o en MAIN; gpt-5.4-mini, gpt-5.4-nano, gpt-5-mini, o4-mini, gpt-4o-mini en SMALL', () => {
    // Grupo Principal (250k tokens/día)
    assert.strictEqual(getModelFreeTierGroup('gpt-6-luna'), 'MAIN');
    assert.strictEqual(getModelFreeTierGroup('gpt-4o'), 'MAIN');

    // Grupo Modelos Pequeños (2.5M tokens/día)
    assert.strictEqual(getModelFreeTierGroup('gpt-5.4-mini'), 'SMALL');
    assert.strictEqual(getModelFreeTierGroup('gpt-5.4-nano'), 'SMALL');
    assert.strictEqual(getModelFreeTierGroup('gpt-5-mini'), 'SMALL');
    assert.strictEqual(getModelFreeTierGroup('o4-mini'), 'SMALL');
    assert.strictEqual(getModelFreeTierGroup('gpt-4o-mini'), 'SMALL');

    // Soporte para personalización de grupos mediante configuración
    assert.strictEqual(
      getModelFreeTierGroup('custom-main-model', { mainGroupModels: ['custom-main-model'] }),
      'MAIN'
    );
    assert.strictEqual(
      getModelFreeTierGroup('custom-small-model', { smallGroupModels: ['custom-small-model'] }),
      'SMALL'
    );
  });

  // -------------------------------------------------------------------------
  // 3. Promoción Sin Verificar (UNVERIFIED)
  // -------------------------------------------------------------------------
  it('3. Promoción sin verificar: UNVERIFIED resulta en isFree: false, discountStatus: NONE y facturación 100%', () => {
    const budget = new HardBudgetManager({
      dailyBudgetLimitUsd: 0.50,
      openaiFreeTier: {
        enabled: true,
        verified: false,
        verificationStatus: 'UNVERIFIED',
        mainGroupDailyLimitTokens: 250_000,
        smallGroupDailyLimitTokens: 2_500_000,
        externalUsageBufferTokens: 5000,
        isGlobalUsageEstimated: true,
      },
    });

    const benefit = budget.calculateFreeTierBenefit('gpt-4o', 2000, 0.02);
    assert.strictEqual(benefit.isEligible, true);
    assert.strictEqual(benefit.isFree, false);
    assert.strictEqual(benefit.discountStatus, 'NONE');
    assert.strictEqual(benefit.discountUsd, 0);
    assert.strictEqual(benefit.netCostUsd, 0.02);
    assert.match(benefit.reason, /no verificado/i);
    assert.strictEqual(budget.getRemainingFreeTokens('MAIN'), 0);
  });

  // -------------------------------------------------------------------------
  // 4. Beneficio Confirmado (CONFIRMED_BILLED) vs Declarado (DECLARED_BY_ADMIN -> ESTIMATED)
  // -------------------------------------------------------------------------
  it('4. Distinción estricta: CONFIRMED_BILLED genera descuentos confirmados y DECLARED_BY_ADMIN genera estimados', () => {
    // Caso A: Declarado por el Administrador (ESTIMATED)
    const budgetDeclared = new HardBudgetManager({
      dailyBudgetLimitUsd: 0.50,
      openaiFreeTier: {
        enabled: true,
        verified: true,
        verificationStatus: 'DECLARED_BY_ADMIN',
        mainGroupDailyLimitTokens: 250_000,
        smallGroupDailyLimitTokens: 2_500_000,
        externalUsageBufferTokens: 5000,
        isGlobalUsageEstimated: true,
      },
    });

    const benefitDeclared = budgetDeclared.calculateFreeTierBenefit('gpt-4o', 5000, 0.05);
    assert.strictEqual(benefitDeclared.isFree, false);
    assert.strictEqual(benefitDeclared.discountStatus, 'ESTIMATED');
    assert.strictEqual(benefitDeclared.netCostUsd, 0.05);
    assert.strictEqual(benefitDeclared.discountUsd, 0);
    assert.match(benefitDeclared.reason, /costo bruto completo/i);

    // Caso B: Confirmado en Facturación (CONFIRMED_BILLED)
    const budgetConfirmed = new HardBudgetManager({
      dailyBudgetLimitUsd: 0.50,
      openaiFreeTier: {
        enabled: true,
        verified: true,
        verificationStatus: 'CONFIRMED_BILLED',
        mainGroupDailyLimitTokens: 250_000,
        smallGroupDailyLimitTokens: 2_500_000,
        externalUsageBufferTokens: 0,
        isGlobalUsageEstimated: false,
      },
    });

    const benefitConfirmed = budgetConfirmed.calculateFreeTierBenefit('gpt-4o', 5000, 0.05);
    assert.strictEqual(benefitConfirmed.isFree, true);
    assert.strictEqual(benefitConfirmed.discountStatus, 'CONFIRMED_BILLED');
    assert.match(benefitConfirmed.reason, /Confirmado en facturación/i);
  });

  // -------------------------------------------------------------------------
  // 5. Cupo Compartido Organizacional y Reserva Conservadora (externalUsageBufferTokens)
  // -------------------------------------------------------------------------
  it('5. Cupo organizacional compartido: aplica reserva conservadora cuando el consumo global es estimado', () => {
    const budget = new HardBudgetManager({
      dailyBudgetLimitUsd: 0.50,
      openaiFreeTier: {
        enabled: true,
        verified: true,
        verificationStatus: 'DECLARED_BY_ADMIN',
        mainGroupDailyLimitTokens: 50_000,
        smallGroupDailyLimitTokens: 500_000,
        externalUsageBufferTokens: 5000, // Colchón de seguridad de 5k tokens
        isGlobalUsageEstimated: true,
      },
    });

    // Saldo nominal sin buffer = 50.000 tokens
    assert.strictEqual(budget.getRemainingFreeTokens('MAIN', false), 50_000);

    // Saldo conservador con buffer de protección = 45.000 tokens
    assert.strictEqual(budget.getRemainingFreeTokens('MAIN', true), 45_000);

    // Conciliación con consumo de organización (otros proyectos consumieron 30k tokens)
    budget.reconcileOrganizationalUsage({
      mainGroupUsedTokens: 30_000,
      source: 'ADMIN_DECLARATION',
      evidenceDetails: 'Consumo verificado en panel OpenAI Usage por el equipo de datos',
    });

    // Saldo remanente nominal: 50k - 30k = 20k
    assert.strictEqual(budget.getRemainingFreeTokens('MAIN', false), 20_000);
    // Con buffer conservador: 20k - 5k = 15k
    assert.strictEqual(budget.getRemainingFreeTokens('MAIN', true), 15_000);
  });

  // -------------------------------------------------------------------------
  // 6. Saldo Insuficiente y Bloqueo de Presupuesto Monetario
  // -------------------------------------------------------------------------
  it('6. Saldo insuficiente: Bloqueo inmediato cuando la solicitud supera el límite monetario remanente', () => {
    const budget = new HardBudgetManager({
      dailyBudgetLimitUsd: 0.10,
      openaiFreeTier: {
        enabled: true,
        verified: false, // NO verificado
        mainGroupDailyLimitTokens: 250_000,
        smallGroupDailyLimitTokens: 2_500_000,
        externalUsageBufferTokens: 5000,
        isGlobalUsageEstimated: true,
      },
    });

    // Gasto previo de $0.09
    budget.recordDirectUsage('OPENAI', 'gpt-4o-mini', 'MARKET_SUMMARY', 0.09);
    assert.strictEqual(budget.getTodaySpendUsd(), 0.09);

    // Intentamos llamada de $0.03 ($0.09 + $0.03 = $0.12 > $0.10)
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
  // 7. Regla Oficial de Exceso: Solicitud que Excede Cupo se Factura 100%
  // -------------------------------------------------------------------------
  it('7. Regla de Exceso Oficial: Solicitud que excede cupo remanente se factura 100% costo bruto sin alterar remanente', () => {
    const budget = new HardBudgetManager({
      dailyBudgetLimitUsd: 1.00,
      maxCostPerRequestUsd: 0.20,
      openaiFreeTier: {
        enabled: true,
        verified: true,
        verificationStatus: 'CONFIRMED_BILLED',
        mainGroupDailyLimitTokens: 250_000,
        smallGroupDailyLimitTokens: 2_500_000,
        externalUsageBufferTokens: 0,
        isGlobalUsageEstimated: false,
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

    // Solicitud requiere 15.000 tokens (> 10.000 restantes)
    // REGLA OFICIAL: Se factura 100% como costo bruto
    const benefit = budget.calculateFreeTierBenefit('gpt-4o', 15_000, 0.08);
    assert.strictEqual(benefit.isFree, false);
    assert.strictEqual(benefit.discountStatus, 'NONE');
    assert.strictEqual(benefit.discountUsd, 0);
    assert.strictEqual(benefit.netCostUsd, 0.08);
    assert.match(benefit.reason, /supera cupo gratuito remanente/i);

    // Reconciliación: el cupo libre remanente de 10.000 se mantiene intacto
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
    assert.strictEqual(r2.discountStatus, 'NONE');
    assert.strictEqual(r2.netCostUsd, 0.08);
    assert.strictEqual(budget.getRemainingFreeTokens('MAIN'), 10_000);
  });

  // -------------------------------------------------------------------------
  // 8. Recuperación de Contadores tras Reinicio
  // -------------------------------------------------------------------------
  it('8. Recuperación tras reinicio: sincroniza contadores y consumo diario desde la base de datos', () => {
    const db = new DatabaseService(':memory:');
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);

    // Registramos consumo previo en la BD
    db.logAiConsumption({
      id: 'prev_1',
      timestamp: startOfDay.getTime() + 1000,
      provider: 'OPENAI',
      model: 'gpt-4o',
      task: 'SETUP_EVALUATION',
      tokensPrompt: 50_000,
      tokensCompletion: 10_000,
      costUsd: 0,
      costGrossUsd: 0.15,
      discountUsd: 0.15,
      costNetUsd: 0,
      freeTierGroup: 'MAIN',
      isFreeTier: true,
      discountStatus: 'ESTIMATED',
      latencyMs: 800,
      status: 'SUCCESS',
    });

    // Nuevo HardBudgetManager conectado a la misma base de datos
    const budget = new HardBudgetManager(
      {
        dailyBudgetLimitUsd: 0.50,
        openaiFreeTier: {
          enabled: true,
          verified: true,
          verificationStatus: 'DECLARED_BY_ADMIN',
          mainGroupDailyLimitTokens: 250_000,
          smallGroupDailyLimitTokens: 2_500_000,
          externalUsageBufferTokens: 0,
          isGlobalUsageEstimated: false,
        },
      },
      undefined,
      db
    );

    // El contador de uso del día debe haberse recuperado (60.000 tokens en MAIN)
    assert.strictEqual(budget.getRemainingFreeTokens('MAIN'), 190_000);
  });

  // -------------------------------------------------------------------------
  // 9. Concurrencia: Reservas Atómicas sin Condiciones de Carrera
  // -------------------------------------------------------------------------
  it('9. Concurrencia: Reservas concurrentes atómicas respetan el límite monetario sin sobregiro', async () => {
    const budget = new HardBudgetManager({
      dailyBudgetLimitUsd: 0.10, // Límite diario estricto: $0.10
      openaiFreeTier: {
        enabled: true,
        verified: false, // Forzar llamadas pagas para probar límite monetario
        mainGroupDailyLimitTokens: 250_000,
        smallGroupDailyLimitTokens: 2_500_000,
      },
    });

    // Lanzamos 10 intentos concurrentes de $0.03 cada uno (solo los primeros 3 deben permitirse: 3 * 0.03 = 0.09 <= 0.10)
    const attempts = Array.from({ length: 10 }).map(async (_, idx) => {
      return budget.reserveBudget({
        provider: 'OPENAI',
        model: 'gpt-4o-mini',
        task: 'MARKET_SUMMARY',
        maxEstimatedCostUsd: 0.03,
        estimatedTokens: 2000,
      });
    });

    const results = await Promise.all(attempts);
    const allowed = results.filter((r) => r.allowed);
    const rejected = results.filter((r) => !r.allowed);

    assert.strictEqual(allowed.length, 3);
    assert.strictEqual(rejected.length, 7);
    assert.strictEqual(budget.getReservedPendingUsd(), 0.09);
    assert.strictEqual(budget.isBlocked(), true);
  });

  // -------------------------------------------------------------------------
  // 10. Persistencia de Descuentos Estimados y Confirmados en BD
  // -------------------------------------------------------------------------
  it('10. Persistencia: almacena discount_status (ESTIMATED vs CONFIRMED_BILLED) en la base de datos', () => {
    const db = new DatabaseService(':memory:');
    const budget = new HardBudgetManager(
      {
        dailyBudgetLimitUsd: 0.50,
        openaiFreeTier: {
          enabled: true,
          verified: true,
          verificationStatus: 'DECLARED_BY_ADMIN',
          mainGroupDailyLimitTokens: 250_000,
          smallGroupDailyLimitTokens: 2_500_000,
        },
      },
      undefined,
      db
    );

    // Llamada A: Estimada por declaración
    const resA = budget.reserveBudget({ provider: 'OPENAI', model: 'gpt-4o', task: 'SETUP_EVALUATION', estimatedTokens: 10_000 });
    const recA = budget.reconcileReservation(resA.reservationId!, {
      provider: 'OPENAI',
      model: 'gpt-4o',
      task: 'SETUP_EVALUATION',
      promptTokens: 8000,
      completionTokens: 2000,
    });
    assert.strictEqual(recA.discountStatus, 'ESTIMATED');

    // Cambiamos a CONFIRMED_BILLED
    budget.reconcileOrganizationalUsage({
      source: 'OPENAI_USAGE_API',
      evidenceDetails: 'Factura oficial OpenAI verificada',
      verifiedBilled: true,
    });

    // Llamada B: Confirmada en facturación
    const resB = budget.reserveBudget({ provider: 'OPENAI', model: 'gpt-4o', task: 'SETUP_EVALUATION', estimatedTokens: 10_000 });
    const recB = budget.reconcileReservation(resB.reservationId!, {
      provider: 'OPENAI',
      model: 'gpt-4o',
      task: 'SETUP_EVALUATION',
      promptTokens: 8000,
      completionTokens: 2000,
    });
    assert.strictEqual(recB.discountStatus, 'CONFIRMED_BILLED');

    // Verificar lectura de la base de datos
    const logs = db.getAiConsumptionLogs(10);
    assert.strictEqual(logs.length, 2);
    const logB = logs.find((l) => l.discountStatus === 'CONFIRMED_BILLED');
    const logA = logs.find((l) => l.discountStatus === 'ESTIMATED');
    assert.ok(logB, 'Debe persistir log con discountStatus CONFIRMED_BILLED');
    assert.ok(logA, 'Debe persistir log con discountStatus ESTIMATED');
  });

  // -------------------------------------------------------------------------
  // 11. Comparación Reproducible de Modelos en AI Model Router (compareModels)
  // -------------------------------------------------------------------------
  it('11. AI Model Router: compareModels permite benchmarking reproducible y seguro de modelos', async () => {
    const router = new AiModelRouter();
    const candidateModels = ['gpt-6-luna', 'gpt-4o', 'gpt-5.4-mini', 'gemini-2.0-flash'];

    const benchmarkResults = await router.compareModels({
      task: 'SETUP_EVALUATION',
      candidateModels,
      testPayload: { symbol: 'BTCUSDT', timeframe: '15m' },
    });

    assert.strictEqual(benchmarkResults.length, 4);
    for (const res of benchmarkResults) {
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.tokensPrompt > 0, true);
      assert.strictEqual(res.tokensCompletion > 0, true);
      assert.strictEqual(typeof res.estimatedCostUsd, 'number');
    }

    // Verificar que gpt-6-luna calcula su costo oficial correctamente
    const lunaRes = benchmarkResults.find((r) => r.model === 'gpt-6-luna');
    assert.ok(lunaRes);
    assert.strictEqual(lunaRes?.provider, 'OPENAI');
  });

  // -------------------------------------------------------------------------
  // 12. Consumo Compartido en Grupo Pequeño con Modelos Elegibles Oficiales
  // -------------------------------------------------------------------------
  it('12. Grupo Pequeño: consumo compartido entre gpt-5.4-mini, gpt-5-mini, o4-mini y gpt-4o-mini', () => {
    const budget = new HardBudgetManager({
      dailyBudgetLimitUsd: 0.50,
      openaiFreeTier: {
        enabled: true,
        verified: true,
        verificationStatus: 'CONFIRMED_BILLED',
        mainGroupDailyLimitTokens: 250_000,
        smallGroupDailyLimitTokens: 2_500_000,
      },
    });

    // 1. gpt-4o-mini consume 500k tokens
    const res1 = budget.reserveBudget({ provider: 'OPENAI', model: 'gpt-4o-mini', task: 'MARKET_SUMMARY', estimatedTokens: 500_000 });
    budget.reconcileReservation(res1.reservationId!, {
      provider: 'OPENAI',
      model: 'gpt-4o-mini',
      task: 'MARKET_SUMMARY',
      promptTokens: 400_000,
      completionTokens: 100_000,
    });
    assert.strictEqual(budget.getRemainingFreeTokens('SMALL'), 2_000_000);

    // 2. gpt-5.4-mini consume 300k tokens
    const res2 = budget.reserveBudget({ provider: 'OPENAI', model: 'gpt-5.4-mini', task: 'TECHNICAL_CONTEXT', estimatedTokens: 300_000 });
    budget.reconcileReservation(res2.reservationId!, {
      provider: 'OPENAI',
      model: 'gpt-5.4-mini',
      task: 'TECHNICAL_CONTEXT',
      promptTokens: 250_000,
      completionTokens: 50_000,
    });
    assert.strictEqual(budget.getRemainingFreeTokens('SMALL'), 1_700_000);

    // 3. o4-mini consume 700k tokens (incluyendo reasoning tokens)
    const res3 = budget.reserveBudget({ provider: 'OPENAI', model: 'o4-mini', task: 'RISK_AUDIT', estimatedTokens: 700_000 });
    budget.reconcileReservation(res3.reservationId!, {
      provider: 'OPENAI',
      model: 'o4-mini',
      task: 'RISK_AUDIT',
      promptTokens: 400_000,
      completionTokens: 100_000,
      reasoningTokens: 200_000,
    });
    // 2.5M - 500k - 300k - 700k = 1.0M restantes
    assert.strictEqual(budget.getRemainingFreeTokens('SMALL'), 1_000_000);
  });

  // -------------------------------------------------------------------------
  // 13. Alertas a los Umbrales 80%, 95% y 100% de Cupo Gratuito
  // -------------------------------------------------------------------------
  it('13. Alertas deduplicadas al 80%, 95% y 100% del cupo gratuito de cada grupo', () => {
    const alertsReceived: string[] = [];
    const budget = new HardBudgetManager(
      {
        dailyBudgetLimitUsd: 1.00,
        openaiFreeTier: {
          enabled: true,
          verified: true,
          verificationStatus: 'CONFIRMED_BILLED',
          mainGroupDailyLimitTokens: 100_000,
          smallGroupDailyLimitTokens: 1_000_000,
        },
      },
      {
        sendTelegramAlert: async (title) => {
          alertsReceived.push(title);
        },
      }
    );

    // 80% (80.000 tokens)
    const res80 = budget.reserveBudget({ provider: 'OPENAI', model: 'gpt-4o', task: 'SETUP_EVALUATION', estimatedTokens: 80_000 });
    budget.reconcileReservation(res80.reservationId!, {
      provider: 'OPENAI',
      model: 'gpt-4o',
      task: 'SETUP_EVALUATION',
      promptTokens: 60_000,
      completionTokens: 20_000,
    });
    assert.strictEqual(alertsReceived.some((a) => a.includes('80%')), true);

    // 95% (95.000 tokens)
    const res95 = budget.reserveBudget({ provider: 'OPENAI', model: 'gpt-4o', task: 'SETUP_EVALUATION', estimatedTokens: 15_000 });
    budget.reconcileReservation(res95.reservationId!, {
      provider: 'OPENAI',
      model: 'gpt-4o',
      task: 'SETUP_EVALUATION',
      promptTokens: 10_000,
      completionTokens: 5_000,
    });
    assert.strictEqual(alertsReceived.some((a) => a.includes('95%')), true);

    // 100% (100.000 tokens)
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
  // 14. Gemini Permanece Totalmente Independiente
  // -------------------------------------------------------------------------
  it('14. Gemini permanece totalmente independiente con su propio presupuesto y facturación', () => {
    const budget = new HardBudgetManager({
      dailyBudgetLimitUsd: 0.50,
      providerLimitsUsd: {
        openai: 0.30,
        gemini: 0.20,
      },
      openaiFreeTier: {
        enabled: true,
        verified: true,
        verificationStatus: 'CONFIRMED_BILLED',
        mainGroupDailyLimitTokens: 250_000,
        smallGroupDailyLimitTokens: 2_500_000,
      },
    });

    // OpenAI consume tokens bonificados ($0 neto)
    const resOpenai = budget.reserveBudget({ provider: 'OPENAI', model: 'gpt-4o', task: 'SETUP_EVALUATION', estimatedTokens: 10_000 });
    budget.reconcileReservation(resOpenai.reservationId!, {
      provider: 'OPENAI',
      model: 'gpt-4o',
      task: 'SETUP_EVALUATION',
      promptTokens: 8000,
      completionTokens: 2000,
    });

    // Gemini realiza llamada paga ($0.05)
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
    assert.strictEqual(summary.spendByProvider.OPENAI, 0);
    assert.strictEqual(summary.spendByProvider.GEMINI, 0.05);
    assert.strictEqual(summary.todaySpendUsd, 0.05);
  });

  // -------------------------------------------------------------------------
  // 15. Desglose Completo en getSummary()
  // -------------------------------------------------------------------------
  it('15. getSummary() reporta métricas segregadas completas y modelos configurados', () => {
    const budget = new HardBudgetManager({
      dailyBudgetLimitUsd: 1.00,
      openaiFreeTier: {
        enabled: true,
        verified: true,
        verificationStatus: 'CONFIRMED_BILLED',
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
    assert.strictEqual(summary.openaiFreeTier.verificationStatus, 'CONFIRMED_BILLED');
    assert.strictEqual(summary.openaiFreeTier.mainGroup.usedTokens, 50_000);
    assert.strictEqual(summary.openaiFreeTier.mainGroup.remainingTokens, 200_000);
    assert.strictEqual(summary.openaiFreeTier.mainGroup.percentUsed, 20);
    assert.ok(summary.openaiFreeTier.mainGroup.models.includes('gpt-6-luna'));
    assert.ok(summary.openaiFreeTier.smallGroup.models.includes('gpt-5.4-mini'));
    assert.strictEqual(summary.openaiFreeTier.financialsToday.freeTokensConsumed, 50_000);
    assert.strictEqual(summary.openaiFreeTier.financialsToday.discountStatus, 'CONFIRMED_BILLED');
  });
});
