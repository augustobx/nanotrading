import crypto from 'crypto';
import { EventEmitter } from 'events';
import { MarketCoordinator } from '../market/market-coordinator.js';
import { OpenAiAdapter } from './openai-adapter.js';
import { GeminiAdapter } from './gemini-adapter.js';
import { HardBudgetManager } from './hard-budget-manager.js';
import { ScenarioRegistry } from '../engine/scenario-registry.js';
import { RiskCalculator } from '../engine/risk-calculator.js';
import { DatabaseService } from '../storage/database.js';
import { TelegramNotifier } from '../notifications/telegram-notifier.js';
import { WebPushNotifier } from '../notifications/web-push-notifier.js';
import {
  Scenario,
  ScenarioRevalidationRecord,
  AiWatchPlan,
} from './scenario-types.js';
import { AiVerdict, ConsensusVerdict } from './types.js';

export interface RevalidationOptions {
  forceDualAi?: boolean;
}

export class AiEntryRevalidation extends EventEmitter {
  private coordinator: MarketCoordinator;
  private openaiAdapter: OpenAiAdapter;
  private geminiAdapter: GeminiAdapter;
  private hardBudgetManager: HardBudgetManager;
  private scenarioRegistry: ScenarioRegistry;
  private db: DatabaseService;
  private telegramNotifier?: TelegramNotifier;
  private webPushNotifier?: WebPushNotifier;
  private mockEvaluator?: (scenario: Scenario, currentPrice: number) => {
    openaiVerdict?: AiVerdict;
    geminiVerdict?: AiVerdict;
    reasoning?: string;
  };

  constructor(options: {
    coordinator: MarketCoordinator;
    openaiAdapter: OpenAiAdapter;
    geminiAdapter: GeminiAdapter;
    hardBudgetManager: HardBudgetManager;
    scenarioRegistry: ScenarioRegistry;
    db: DatabaseService;
    telegramNotifier?: TelegramNotifier;
    webPushNotifier?: WebPushNotifier;
  }) {
    super();
    this.coordinator = options.coordinator;
    this.openaiAdapter = options.openaiAdapter;
    this.geminiAdapter = options.geminiAdapter;
    this.hardBudgetManager = options.hardBudgetManager;
    this.scenarioRegistry = options.scenarioRegistry;
    this.db = options.db;
    this.telegramNotifier = options.telegramNotifier;
    this.webPushNotifier = options.webPushNotifier;
  }

  public setMockEvaluator(fn?: any): void {
    this.mockEvaluator = fn;
  }

  public async revalidate(scenario: Scenario, currentPrice: number, watchPlan?: AiWatchPlan): Promise<{
    consensus: ConsensusVerdict;
    scenario: Scenario;
    revalidationRecord: ScenarioRevalidationRecord;
    reason?: string;
  }> {
    const revalId = `reval_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    this.scenarioRegistry.transitionStatus(scenario.id, 'AI_REVALIDATING', 'Ejecutando reevaluación inteligente con IA en zona', { currentPrice });

    const activePlan = watchPlan || scenario.watchPlan;
    if (activePlan) {
      activePlan.status = 'REVALIDATING';
    }

    // 1. Mock Evaluator (for unit testing deterministic scenarios)
    if (this.mockEvaluator) {
      const mock = this.mockEvaluator(scenario, currentPrice);
      const consensus = this.determineConsensus(mock.openaiVerdict || 'APPROVE', mock.geminiVerdict || 'APPROVE');

      const revalidationRecord: ScenarioRevalidationRecord = {
        id: revalId,
        scenarioId: scenario.id,
        timestamp: Date.now(),
        openaiVerdict: mock.openaiVerdict || 'APPROVE',
        geminiVerdict: mock.geminiVerdict || 'APPROVE',
        consensusVerdict: consensus,
        priceAtRevalidation: currentPrice,
        details: {
          openaiReasoning: mock.reasoning || 'Reevaluación mock aprobada',
          geminiReasoning: mock.reasoning || 'Reevaluación mock aprobada',
          rr12Confirmed: !!scenario.target12Price,
          rr14Confirmed: !!scenario.target14Price,
          costUsd: 0.001,
          watchPlanId: activePlan?.id,
        },
      };

      this.db.saveScenarioRevalidation(revalidationRecord);
      const outcome = this.applyConsensusOutcome(scenario, consensus, currentPrice, revalidationRecord, activePlan);
      return {
        consensus,
        scenario: outcome.scenario,
        revalidationRecord,
        reason: outcome.reason,
      };
    }

    // 2. Budget Check
    if (this.hardBudgetManager.isBlocked()) {
      const reason = this.hardBudgetManager.getBlockedReason() || 'AI_BUDGET_EXCEEDED';
      const record: ScenarioRevalidationRecord = {
        id: revalId,
        scenarioId: scenario.id,
        timestamp: Date.now(),
        consensusVerdict: 'DISCARDED',
        priceAtRevalidation: currentPrice,
        details: { invalidationTrigger: reason, costUsd: 0, watchPlanId: activePlan?.id },
      };
      this.db.saveScenarioRevalidation(record);
      const updated = this.scenarioRegistry.transitionStatus(scenario.id, 'CANCELLED', reason, { currentPrice });
      if (activePlan) activePlan.status = 'CANCELLED';
      return { consensus: 'DISCARDED', scenario: updated || scenario, revalidationRecord: record, reason };
    }

    // 3. Fallback Mode determination
    const openaiConfigured = this.openaiAdapter.isConfigured();
    const geminiConfigured = this.geminiAdapter.isConfigured();

    let evaluationMode: 'DUAL_AI' | 'SINGLE_AI_OPENAI' | 'SINGLE_AI_GEMINI' | 'AI_UNAVAILABLE' = 'AI_UNAVAILABLE';
    if (openaiConfigured && geminiConfigured) evaluationMode = 'DUAL_AI';
    else if (openaiConfigured) evaluationMode = 'SINGLE_AI_OPENAI';
    else if (geminiConfigured) evaluationMode = 'SINGLE_AI_GEMINI';

    if (evaluationMode === 'AI_UNAVAILABLE') {
      const reason = 'Sin proveedores de IA configurados para reevaluar la entrada';
      const record: ScenarioRevalidationRecord = {
        id: revalId,
        scenarioId: scenario.id,
        timestamp: Date.now(),
        consensusVerdict: 'WAITING_CONDITIONS',
        priceAtRevalidation: currentPrice,
        details: { invalidationTrigger: reason, costUsd: 0, watchPlanId: activePlan?.id },
      };
      this.db.saveScenarioRevalidation(record);
      const updated = this.scenarioRegistry.transitionStatus(scenario.id, 'WAITING_CONFIRMATION', reason, { currentPrice });
      return { consensus: 'WAITING_CONDITIONS', scenario: updated || scenario, revalidationRecord: record, reason };
    }

    // Reserve both providers separately; no AI request may borrow the other's reservation.
    const reservations: Array<{ provider: 'OPENAI' | 'GEMINI'; model: string; id: string }> = [];
    const requested: Array<{ provider: 'OPENAI' | 'GEMINI'; model: string }> = [];
    if (openaiConfigured) requested.push({ provider: 'OPENAI', model: this.openaiAdapter.getModel() });
    if (geminiConfigured) requested.push({ provider: 'GEMINI', model: this.geminiAdapter.getModel() });
    const marketStateBefore = this.coordinator.getMarketState();
    if (!marketStateBefore.wsConnected || !marketStateBefore.ticker ||
        marketStateBefore.status === 'DATA_UNAVAILABLE') {
      const reason = 'Datos de mercado no disponibles para reevaluación';
      const updated = this.scenarioRegistry.transitionStatus(scenario.id, 'WAITING_CONFIRMATION', reason, { currentPrice });
      const record: ScenarioRevalidationRecord = {
        id: revalId, scenarioId: scenario.id, timestamp: Date.now(),
        consensusVerdict: 'WAITING_CONDITIONS', priceAtRevalidation: currentPrice,
        details: { invalidationTrigger: reason, costUsd: 0, watchPlanId: activePlan?.id },
      };
      this.db.saveScenarioRevalidation(record);
      return { consensus: 'WAITING_CONDITIONS', scenario: updated || scenario, revalidationRecord: record, reason };
    }
    for (const provider of requested) {
      const held = this.hardBudgetManager.reserveBudget({
        provider: provider.provider, model: provider.model,
        task: 'SCENARIO_REVALIDATION', estimatedTokens: 2500,
      });
      if (!held.allowed || !held.reservationId) {
        for (const prior of reservations) this.hardBudgetManager.releaseReservation(prior.id);
        const reason = held.reason || 'Presupuesto insuficiente para reevaluación dual';
        const updated = this.scenarioRegistry.transitionStatus(scenario.id, 'WAITING_CONFIRMATION', reason, { currentPrice });
        const record: ScenarioRevalidationRecord = {
          id: revalId, scenarioId: scenario.id, timestamp: Date.now(),
          consensusVerdict: 'WAITING_CONDITIONS', priceAtRevalidation: currentPrice,
          details: { invalidationTrigger: reason, costUsd: 0, watchPlanId: activePlan?.id },
        };
        this.db.saveScenarioRevalidation(record);
        return { consensus: 'WAITING_CONDITIONS', scenario: updated || scenario, revalidationRecord: record, reason };
      }
      reservations.push({ ...provider, id: held.reservationId });
    }

    // 5. Query models with full context of plan and market evolution
    let openaiVerdict: AiVerdict = 'WAIT';
    let geminiVerdict: AiVerdict = 'WAIT';
    let openaiReason = '';
    let geminiReason = '';
    let totalCostUsd = 0;
    let openaiRes: any = null;
    let geminiRes: any = null;

    const timeElapsedSec = Math.round((Date.now() - scenario.discoveryTimestamp) / 1000);
    const priceEvolutionPcnt = ((currentPrice - scenario.targetEntry) / scenario.targetEntry) * 100;

    const evolutionSummary = `Tiempo transcurrido desde descubrimiento: ${timeElapsedSec}s. Desviación actual vs entrada teórica: ${priceEvolutionPcnt.toFixed(2)}% ($${currentPrice} vs $${scenario.targetEntry}).`;

    try {
      const marketSummary = this.coordinator.getAiDiscoveryEngine().buildMarketIntelligenceSummary();
      const prompt = `REEVALUACIÓN DE ENTRADA DISCRECIONAL (AI_WATCH_PLAN):
El precio de BTCUSDT alcanzó la zona o satisfizo las condiciones observables del plan.

CONTRATO DE VIGILANCIA ORIGINAL (AI_WATCH_PLAN):
- ID Plan: ${activePlan?.id || scenario.id}
- Dirección: ${scenario.direction}
- Tesis Original: ${activePlan?.marketThesis || scenario.argumentsFor[0] || 'N/A'}
- Horizonte: ${activePlan?.horizon || scenario.horizon || 'INTRADAY'}
- Temporalidad: ${scenario.timeframe}
- Zona Operativa: [${scenario.entryZoneMin} - ${scenario.entryZoneMax}]
- Precio Actual: $${currentPrice}
- Entrada Teórica: $${scenario.targetEntry}
- Stop Loss Estructural: $${scenario.stopLossPrice}
- Target 1:2: $${scenario.target12Price} (Net R:R: ${scenario.netRR12})
- Target 1:4: $${scenario.target14Price} (Net R:R: ${scenario.netRR14})
- Secuencia de Confirmaciones: ${JSON.stringify(activePlan?.confirmationSequence || [])}
- Condiciones de Invalidación: ${JSON.stringify(activePlan?.invalidationConditions?.map((i) => i.description) || scenario.invalidationTriggers)}

EVOLUCIÓN OBSERVADA:
${evolutionSummary}

SNAPSHOT DE MERCADO ACTUALIZADO (seis temporalidades, orderbook y liquidez):
${JSON.stringify(marketSummary)}

CRITERIO DE DECISIÓN:
Evalúa si la hipótesis original sigue plenamente vigente tras la llegada del precio a la zona.
- Emite APPROVE solo si hay absorción o mitigación favorable sin indicios de trampa de liquidez en contra.
- Emite WAIT si el precio llegó con volumen impulsivo adverso y se requiere confirmación adicional en 5m/1m.
- Emite REJECT si la estructura se degradó, si hubo barrido violento o si el riesgo/beneficio se distorsionó.

Responde estrictamente en JSON:
{
  "verdict": "APPROVE" | "WAIT" | "REJECT",
  "reasoning": "Explicación rigurosa de la decisión",
  "argumentsFor": ["Evidencia a favor"],
  "argumentsAgainst": ["Evidencia en contra"],
  "targetsStillValid": true,
  "invalidationRisk": "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"
}`;

      [openaiRes, geminiRes] = await Promise.all([
        openaiConfigured ? this.openaiAdapter.evaluateWithCustomPrompt?.(prompt) : Promise.resolve(null),
        geminiConfigured ? this.geminiAdapter.evaluateWithCustomPrompt?.(prompt) : Promise.resolve(null),
      ]);

      if (openaiRes) {
        openaiVerdict = ['APPROVE', 'WAIT', 'REJECT'].includes(openaiRes.verdict) ? openaiRes.verdict : 'WAIT';
        openaiReason = openaiRes.reasoning || '';
        totalCostUsd += openaiRes.costUsd || 0.0005;
      }
      if (geminiRes) {
        geminiVerdict = ['APPROVE', 'WAIT', 'REJECT'].includes(geminiRes.verdict) ? geminiRes.verdict : 'WAIT';
        geminiReason = geminiRes.reasoning || '';
        totalCostUsd += geminiRes.costUsd || 0.0005;
      }
    } finally {
      for (const reservation of reservations) {
        const result = reservation.provider === 'OPENAI' ? openaiRes : geminiRes;
        this.hardBudgetManager.reconcileReservation(reservation.id, {
          provider: reservation.provider, model: result?.model || reservation.model,
          task: 'SCENARIO_REVALIDATION',
          promptTokens: result?.promptTokens || 0,
          completionTokens: result?.completionTokens || 0,
          ...(result ? { costUsd: result.costUsd } : {}),
          status: result ? 'SUCCESS' : 'UNCERTAIN_TIMEOUT',
          latencyMs: result?.latencyMs || 0,
        });
      }
    }
    // Market data may have changed while the models reasoned.
    const latestState = this.coordinator.getMarketState();
    if (latestState.ticker?.lastPrice && Number.isFinite(latestState.ticker.lastPrice)) {
      currentPrice = latestState.ticker.lastPrice;
    }

    // 6. Determine consensus based on mode
    let consensus: ConsensusVerdict = 'DISCARDED';
    if (evaluationMode === 'DUAL_AI') {
      consensus = this.determineConsensus(openaiVerdict, geminiVerdict);
    } else if (evaluationMode === 'SINGLE_AI_OPENAI') {
      consensus = openaiVerdict === 'APPROVE' ? 'AUTHORIZED' : (openaiVerdict === 'WAIT' ? 'WAITING_CONDITIONS' : 'DISCARDED');
    } else if (evaluationMode === 'SINGLE_AI_GEMINI') {
      consensus = geminiVerdict === 'APPROVE' ? 'AUTHORIZED' : (geminiVerdict === 'WAIT' ? 'WAITING_CONDITIONS' : 'DISCARDED');
    }

    const revalidationRecord: ScenarioRevalidationRecord = {
      id: revalId,
      scenarioId: scenario.id,
      timestamp: Date.now(),
      openaiVerdict,
      geminiVerdict,
      consensusVerdict: consensus,
      priceAtRevalidation: currentPrice,
      details: {
        openaiReasoning: openaiReason,
        geminiReasoning: geminiReason,
        rr12Confirmed: !!scenario.target12Price,
        rr14Confirmed: !!scenario.target14Price,
        costUsd: totalCostUsd,
        marketEvolutionSummary: evolutionSummary,
        watchPlanId: activePlan?.id,
      },
    };

    this.db.saveScenarioRevalidation(revalidationRecord);
    const outcome = this.applyConsensusOutcome(scenario, consensus, currentPrice, revalidationRecord, activePlan);
    return {
      consensus,
      scenario: outcome.scenario,
      revalidationRecord,
      reason: outcome.reason,
    };
  }

  private determineConsensus(openai: AiVerdict, gemini: AiVerdict): ConsensusVerdict {
    if (openai === 'APPROVE' && gemini === 'APPROVE') {
      return 'AUTHORIZED';
    }
    if (openai === 'REJECT' || gemini === 'REJECT') {
      return 'DISCARDED';
    }
    return 'WAITING_CONDITIONS';
  }

  private applyConsensusOutcome(
    scenario: Scenario,
    consensus: ConsensusVerdict,
    currentPrice: number,
    record: ScenarioRevalidationRecord,
    watchPlan?: AiWatchPlan
  ): { scenario: Scenario; reason?: string } {
    if (consensus === 'AUTHORIZED') {
      if (scenario.direction === 'NEUTRAL') {
        const reason = 'Escenario en observación neutral sin dirección operativa ejecutable';
        return { scenario, reason };
      }

      // Check Pre-breached Stop Loss
      if (scenario.direction === 'LONG' && currentPrice <= scenario.stopLossPrice) {
        const reason = `Stop Loss ya alcanzado antes de validar entrada (Precio ${currentPrice} <= SL ${scenario.stopLossPrice})`;
        const updated = this.scenarioRegistry.transitionStatus(scenario.id, 'INVALIDATED', reason, { currentPrice })!;
        if (watchPlan) watchPlan.status = 'INVALIDATED';
        this.notifyCancelled(scenario, reason);
        return { scenario: updated, reason };
      }
      if (scenario.direction === 'SHORT' && currentPrice >= scenario.stopLossPrice) {
        const reason = `Stop Loss ya alcanzado antes de validar entrada (Precio ${currentPrice} >= SL ${scenario.stopLossPrice})`;
        const updated = this.scenarioRegistry.transitionStatus(scenario.id, 'INVALIDATED', reason, { currentPrice })!;
        if (watchPlan) watchPlan.status = 'INVALIDATED';
        this.notifyCancelled(scenario, reason);
        return { scenario: updated, reason };
      }

      // Dynamic Price Drift Calculation (Tolerance aware)
      const riskDistance = Math.abs(scenario.targetEntry - scenario.stopLossPrice);
      const maxDriftByCeiling = scenario.targetEntry * 0.0015; // 0.15%
      const maxDriftByRisk = riskDistance * 0.10; // 10% risk distance
      const maxAllowedDriftUsdt = Math.max(0.5, Math.min(maxDriftByCeiling, maxDriftByRisk));
      const actualDriftUsdt = Math.abs(currentPrice - scenario.targetEntry);

      if (actualDriftUsdt > maxAllowedDriftUsdt) {
        const reason = `Desviación de precio post-análisis dinámica superada (${actualDriftUsdt.toFixed(2)} USDT > máximo permitido ${maxAllowedDriftUsdt.toFixed(2)} USDT)`;
        const updated = this.scenarioRegistry.transitionStatus(scenario.id, 'EXPIRED', reason, { currentPrice })!;
        if (watchPlan) watchPlan.status = 'EXPIRED';
        return { scenario: updated, reason };
      }

      // The AI path must enforce the same administrative constraints as the rest
      // of the engine. Fail closed if a live feed, kill switch or policy is unsafe.
      const liveState = this.coordinator.getMarketState();
      const riskPolicy = this.coordinator.getRiskPolicyManager().getPolicy();
      const currentSpread = liveState.ticker?.spreadPcnt;
      const livePrice = liveState.ticker?.lastPrice;
      const spreadTooHigh = !Number.isFinite(currentSpread) ||
        (currentSpread as number) > riskPolicy.marketRestrictions.maxSpreadPercent;
      const stale = !liveState.wsConnected ||
        liveState.status === 'DATA_UNAVAILABLE' || !Number.isFinite(livePrice) ||
        !Number.isFinite(liveState.lastWsMessageTimestamp) ||
        Date.now() - liveState.lastWsMessageTimestamp > riskPolicy.marketRestrictions.maxDataStalenessMs;
      const stopDistancePercent = Math.abs(currentPrice - scenario.stopLossPrice) / currentPrice * 100;
      const slCeiling = riskPolicy.stopLossCeilings.maxSlDistancePercent;
      const tooWide = slCeiling.enabled && stopDistancePercent > slCeiling.value;
      const activeCount = this.coordinator.getSignalStateMachine().getActiveSignals().length;
      if (liveState.killSwitchActive || stale || spreadTooHigh || tooWide ||
          activeCount >= riskPolicy.maxActiveSignals) {
        const reason = 'Política de riesgo, Kill Switch, exposición o datos de mercado impiden validar entrada';
        const updated = this.scenarioRegistry.transitionStatus(scenario.id, 'CANCELLED', reason, { currentPrice })!;
        if (watchPlan) watchPlan.status = 'CANCELLED';
        return { scenario: updated, reason };
      }

      // Deterministic Quant Risk verification: re-check net R:R at current price
      const riskCalc = RiskCalculator.calculateDualTargets({
        direction: scenario.direction,
        entryPrice: currentPrice,
        stopLossPrice: scenario.stopLossPrice,
        candidateTargets: [scenario.target12Price || currentPrice, scenario.target14Price || currentPrice],
        explicit12Price: scenario.target12Price,
        explicit14Price: scenario.target14Price,
        accountBalance: riskPolicy.capitalUsdt,
        riskPercent: Math.min(riskPolicy.maxRiskPerTradePercent,
          riskPolicy.maxRiskPerTradeUsdt / riskPolicy.capitalUsdt * 100),
        spread: currentSpread,
      });

      if (riskCalc.qualifiedMode === 'NONE' ||
          (riskCalc.calculation12?.isValid && riskCalc.calculation12.netLossUSDT > riskPolicy.maxRiskPerTradeUsdt) ||
          (riskCalc.calculation14?.isValid && riskCalc.calculation14.netLossUSDT > riskPolicy.maxRiskPerTradeUsdt)) {
        const reason = `R:R neto en precio actual (${currentPrice}) no alcanza el umbral mínimo 1:2 tras deducción de comisiones`;
        const updated = this.scenarioRegistry.transitionStatus(scenario.id, 'CANCELLED', reason, { currentPrice })!;
        if (watchPlan) watchPlan.status = 'CANCELLED';
        this.notifyCancelled(scenario, reason);
        return { scenario: updated, reason };
      }

      const updated = this.scenarioRegistry.transitionStatus(
        scenario.id,
        'ENTRY_VALIDATED',
        'Consenso de IA dual alcanzado y validación cuantitativa aprobada',
        { currentPrice, netRR12: riskCalc.calculation12?.netRR, netRR14: riskCalc.calculation14?.netRR }
      )!;

      if (watchPlan) {
        watchPlan.status = 'ENTRY_VALIDATED';
      }

      this.notifyEntryValidated(updated, currentPrice, riskCalc);
      this.emit('entry_validated', { scenario: updated, currentPrice, riskCalc, watchPlan });
      return { scenario: updated };
    }

    if (consensus === 'WAITING_CONDITIONS') {
      const reason = 'Una o ambas IA recomiendan esperar mayor confirmación en microestructura';
      const updated = this.scenarioRegistry.transitionStatus(scenario.id, 'WAITING_CONFIRMATION', reason, { currentPrice })!;
      return { scenario: updated, reason };
    }

    // DISCARDED / REJECT
    const reason = 'Rechazo por discrepancia técnica, riesgo de trampa de liquidez o R:R insuficiente';
    const updated = this.scenarioRegistry.transitionStatus(scenario.id, 'CANCELLED', reason, { currentPrice })!;
    if (watchPlan) watchPlan.status = 'CANCELLED';
    this.notifyCancelled(scenario, reason);
    return { scenario: updated, reason };
  }

  private notifyEntryValidated(sc: Scenario, currentPrice: number, riskCalc: any): void {
    const title = `🚀 ENTRADA VALIDADA: ${sc.symbol} ${sc.direction}`;
    const msg = [
      `*Modo:* ${sc.rrModeAvailable} (SIGNALS_ONLY)`,
      `*Entrada:* $${currentPrice.toFixed(1)}`,
      `*Stop Loss:* $${sc.stopLossPrice.toFixed(1)}`,
      sc.target12Price ? `*TP 1:2:* $${sc.target12Price.toFixed(1)} (Net R:R: ${riskCalc.netRR12}R)` : '',
      sc.target14Price ? `*TP 1:4:* $${sc.target14Price.toFixed(1)} (Net R:R: ${riskCalc.netRR14}R)` : '',
      `*Estructura:* ${sc.structureType}`,
      `*Consenso:* Aprobado por analistas IA sobre AI_WATCH_PLAN`,
      `*Garantía:* Modo de prueba / paper trading. Cero órdenes reales en Bybit.`,
    ].filter(Boolean).join('\n');

    this.telegramNotifier?.sendMessage?.(`*${title}*\n\n${msg}`, 'ENTRY_VALIDATED');
    this.webPushNotifier?.broadcast?.({ title, body: msg });
  }

  private notifyCancelled(sc: Scenario, reason: string): void {
    const title = `❌ ${sc.symbol} Entrada Cancelada`;
    const msg = `Escenario ${sc.direction} ${sc.id} descartado en reevaluación.\nMotivo: ${reason}`;

    this.telegramNotifier?.sendMessage?.(`*${title}*\n\n${msg}`, 'CANCELLED_ALERT');
    this.webPushNotifier?.broadcast?.({ title, body: msg });
  }
}
