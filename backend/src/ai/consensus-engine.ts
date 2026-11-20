import { EventEmitter } from 'events';
import { MarketCoordinator } from '../market/market-coordinator.js';
import { SetupCandidate } from '../engine/strategy-a-trend.js';
import { SnapshotBuilder } from './snapshot-builder.js';
import { OpenAiAdapter } from './openai-adapter.js';
import { GeminiAdapter } from './gemini-adapter.js';
import { CostTracker } from './cost-tracker.js';
import { HardBudgetManager } from './hard-budget-manager.js';
import { DatabaseService } from '../storage/database.js';
import {
  ConsensusResult,
  ConsensusVerdict,
  AiEvaluationResult,
  AiEvaluationMode,
  MarketSnapshot,
} from './types.js';

export interface ConsensusEngineOptions {
  coordinator: MarketCoordinator;
  db: DatabaseService;
  openaiAdapter?: OpenAiAdapter;
  geminiAdapter?: GeminiAdapter;
  costTracker?: CostTracker;
  hardBudgetManager?: HardBudgetManager;
  minAiConfidence?: number; // default 70
  maxPriceDriftPcnt?: number; // default 0.15% (0.0015)
  maxSnapshotAgeMs?: number; // default 10000ms
}

export class ConsensusEngine extends EventEmitter {
  private coordinator: MarketCoordinator;
  private db: DatabaseService;
  private openaiAdapter: OpenAiAdapter;
  private geminiAdapter: GeminiAdapter;
  private costTracker: CostTracker;
  private hardBudgetManager: HardBudgetManager;
  private minAiConfidence: number;
  private maxPriceDriftPcnt: number;
  private maxSnapshotAgeMs: number;
  private activeSignals: Map<string, ConsensusResult> = new Map();
  private lastEvaluationMode: AiEvaluationMode = 'DUAL_AI';

  constructor(options: ConsensusEngineOptions) {
    super();
    this.coordinator = options.coordinator;
    this.db = options.db;
    this.openaiAdapter = options.openaiAdapter || new OpenAiAdapter();
    this.geminiAdapter = options.geminiAdapter || new GeminiAdapter();
    this.costTracker = options.costTracker || new CostTracker();
    this.hardBudgetManager = options.hardBudgetManager || new HardBudgetManager();
    if (this.db) {
      this.hardBudgetManager.setDatabase(this.db);
    }
    this.minAiConfidence = options.minAiConfidence || 70;
    this.maxPriceDriftPcnt = options.maxPriceDriftPcnt || 0.0015;
    this.maxSnapshotAgeMs = options.maxSnapshotAgeMs || 10000;
  }

  public async evaluateSetup(setup: SetupCandidate, existingSnapshot?: MarketSnapshot): Promise<ConsensusResult> {
    const evaluatedAt = Date.now();
    const signalId = `sig_${setup.id}_${evaluatedAt}`;
    const ruleViolations: string[] = [];

    // Step 1: Snapshot build & freshness check
    const snapshot = existingSnapshot || SnapshotBuilder.build(this.coordinator, setup);
    const snapshotAge = Date.now() - snapshot.timestamp;
    if (snapshotAge > this.maxSnapshotAgeMs) {
      ruleViolations.push(`Snapshot caducado (${snapshotAge}ms > ${this.maxSnapshotAgeMs}ms)`);
      return this.rejectDecision(signalId, setup, snapshot.snapshotId, evaluatedAt, ruleViolations, 'SNAPSHOT_STALE');
    }

    // Step 2: Data integrity & WS sync checks
    if (!snapshot.dataIntegrity.wsConnected) {
      ruleViolations.push('WebSocket Bybit desconectado');
      return this.rejectDecision(signalId, setup, snapshot.snapshotId, evaluatedAt, ruleViolations, 'WS_DISCONNECTED');
    }
    if (!snapshot.dataIntegrity.isOrderBookSynced) {
      ruleViolations.push('Libro de órdenes Bybit desincronizado');
      return this.rejectDecision(signalId, setup, snapshot.snapshotId, evaluatedAt, ruleViolations, 'ORDERBOOK_DESYNCED');
    }
    if (snapshot.dataIntegrity.status === 'DATA_UNAVAILABLE') {
      ruleViolations.push('Estado del mercado en DATA_UNAVAILABLE');
      return this.rejectDecision(signalId, setup, snapshot.snapshotId, evaluatedAt, ruleViolations, 'DATA_UNAVAILABLE');
    }

    // Step 3: Kill Switch check
    const marketState = this.coordinator.getMarketState();
    if (marketState.killSwitchActive) {
      ruleViolations.push('Kill switch de emergencia activo');
      return this.rejectDecision(signalId, setup, snapshot.snapshotId, evaluatedAt, ruleViolations, 'KILL_SWITCH_ACTIVE');
    }

    // Step 4: Technical strategy rules
    if (!setup.strategy || !setup.direction) {
      ruleViolations.push('Setup sin estrategia o dirección válida');
      return this.rejectDecision(signalId, setup, snapshot.snapshotId, evaluatedAt, ruleViolations, 'INVALID_STRATEGY');
    }

    // Step 5: Strict 1:4 Net R:R Deterministic Gate (AI can NEVER override this)
    if (!setup.riskReward || setup.riskReward.netRR < 4.0 || !setup.riskReward.isValid) {
      ruleViolations.push(`Ratio R:R neto ${setup.riskReward?.netRR ?? 0} < 4.0 requerido`);
      return this.rejectDecision(signalId, setup, snapshot.snapshotId, evaluatedAt, ruleViolations, 'INSUFFICIENT_NET_RR');
    }

    // Step 6: Risk Policy & Stop Loss Ceilings Evaluation (Fase 4.5)
    const riskPolicyMgr = this.coordinator.getRiskPolicyManager?.();
    if (riskPolicyMgr) {
      const atr15m = snapshot.multiTimeframe?.['15m']?.atr || snapshot.multiTimeframe?.['5m']?.atr || 100;
      const activeSignalsCount = this.activeSignals.size;
      const riskEval = riskPolicyMgr.evaluateSetupRisk(
        setup,
        atr15m,
        snapshot.ticker.spreadPcnt,
        activeSignalsCount
      );
      if (!riskEval.passed) {
        ruleViolations.push(...riskEval.violations);
        return this.rejectDecision(signalId, setup, snapshot.snapshotId, evaluatedAt, ruleViolations, 'RISK_POLICY_VIOLATION');
      }
    }

    // Step 7: Spread / Volatility filter
    if (snapshot.ticker.spreadPcnt > 0.05) {
      ruleViolations.push(`Spread excesivo (${snapshot.ticker.spreadPcnt.toFixed(4)}% > 0.05%)`);
      return this.rejectDecision(signalId, setup, snapshot.snapshotId, evaluatedAt, ruleViolations, 'SPREAD_TOO_HIGH');
    }

    // Step 8: Hard Budget Limit check & Atomic Reservation (Fase 4.6)
    if (this.hardBudgetManager.isBlocked()) {
      const reason = this.hardBudgetManager.getBlockedReason() || 'Límite de presupuesto diario de IA alcanzado (AI_BUDGET_EXCEEDED)';
      ruleViolations.push(reason);
      return this.rejectDecision(
        signalId,
        setup,
        snapshot.snapshotId,
        evaluatedAt,
        ruleViolations,
        'AI_BUDGET_EXCEEDED'
      );
    }

    if (!this.costTracker.canMakeCalls(2)) {
      ruleViolations.push('Presupuesto diario o mensual de IA agotado en CostTracker');
      return this.waitDecision(
        signalId,
        setup,
        snapshot.snapshotId,
        evaluatedAt,
        ruleViolations,
        'DAILY_AI_BUDGET_EXCEEDED'
      );
    }

    const openaiModel = this.openaiAdapter.getModel();
    const geminiModel = this.geminiAdapter.getModel();

    const openaiResv = this.hardBudgetManager.reserveBudget({
      provider: 'OPENAI',
      model: openaiModel,
      task: 'SETUP_EVALUATION',
      estimatedTokens: 4000,
    });

    if (!openaiResv.allowed) {
      ruleViolations.push(openaiResv.reason || 'Límite presupuestario de IA alcanzado');
      return this.rejectDecision(
        signalId,
        setup,
        snapshot.snapshotId,
        evaluatedAt,
        ruleViolations,
        'AI_BUDGET_EXCEEDED'
      );
    }

    const geminiResv = this.hardBudgetManager.reserveBudget({
      provider: 'GEMINI',
      model: geminiModel,
      task: 'SETUP_EVALUATION',
    });

    if (!geminiResv.allowed) {
      if (openaiResv.reservationId) {
        this.hardBudgetManager.releaseReservation(openaiResv.reservationId);
      }
      ruleViolations.push(geminiResv.reason || 'Límite presupuestario de IA alcanzado');
      return this.rejectDecision(
        signalId,
        setup,
        snapshot.snapshotId,
        evaluatedAt,
        ruleViolations,
        'AI_BUDGET_EXCEEDED'
      );
    }

    const budgetReserved = this.costTracker.reserveBudget(2);
    if (!budgetReserved) {
      if (openaiResv.reservationId) this.hardBudgetManager.releaseReservation(openaiResv.reservationId);
      if (geminiResv.reservationId) this.hardBudgetManager.releaseReservation(geminiResv.reservationId);
      ruleViolations.push('Presupuesto de IA temporalmente bloqueado por concurrencia');
      return this.waitDecision(
        signalId,
        setup,
        snapshot.snapshotId,
        evaluatedAt,
        ruleViolations,
        'AI_BUDGET_RESERVATION_BUSY'
      );
    }

    // Step 8: Concurrent Dual AI Consultation
    let openaiRes: AiEvaluationResult;
    let geminiRes: AiEvaluationResult;

    try {
      [openaiRes, geminiRes] = await Promise.all([
        this.openaiAdapter.evaluate(snapshot),
        this.geminiAdapter.evaluate(snapshot),
      ]);
    } finally {
      this.costTracker.releaseReservation(2);
    }

    if (openaiResv.reservationId) {
      const isOpenaiTimeout = openaiRes.availabilityStatus === 'TIMEOUT' || openaiRes.error?.toLowerCase().includes('timeout');
      const reconcile = this.hardBudgetManager.reconcileReservation(openaiResv.reservationId, {
        provider: 'OPENAI',
        model: openaiRes.model || openaiModel,
        task: 'SETUP_EVALUATION',
        promptTokens: openaiRes.tokensPrompt || 0,
        completionTokens: openaiRes.tokensCompletion || 0,
        costUsd: openaiRes.estimatedCostUsd,
        status: isOpenaiTimeout ? 'UNCERTAIN_TIMEOUT' : (openaiRes.error ? 'ERROR' : 'SUCCESS'),
        latencyMs: openaiRes.latencyMs,
      });

      // Registrar datos del beneficio Data Sharing / Free Tier en el resultado de análisis
      (openaiRes as any).grossCostUsd = reconcile.grossCostUsd;
      (openaiRes as any).discountUsd = reconcile.discountUsd;
      (openaiRes as any).netCostUsd = reconcile.netCostUsd;
      (openaiRes as any).freeTierGroup = reconcile.freeTierGroup;
      (openaiRes as any).isFreeTier = reconcile.isFreeTier;
      (openaiRes as any).benefitReason = reconcile.benefitReason;
      openaiRes.estimatedCostUsd = reconcile.netCostUsd; // Net cost reflects financial impact
    }

    if (geminiResv.reservationId) {
      const isGeminiTimeout = geminiRes.availabilityStatus === 'TIMEOUT' || geminiRes.error?.toLowerCase().includes('timeout');
      const reconcile = this.hardBudgetManager.reconcileReservation(geminiResv.reservationId, {
        provider: 'GEMINI',
        model: geminiRes.model || geminiModel,
        task: 'SETUP_EVALUATION',
        promptTokens: geminiRes.tokensPrompt || 0,
        completionTokens: geminiRes.tokensCompletion || 0,
        costUsd: geminiRes.estimatedCostUsd,
        status: isGeminiTimeout ? 'UNCERTAIN_TIMEOUT' : (geminiRes.error ? 'ERROR' : 'SUCCESS'),
        latencyMs: geminiRes.latencyMs,
      });

      (geminiRes as any).grossCostUsd = reconcile.grossCostUsd;
      (geminiRes as any).discountUsd = reconcile.discountUsd;
      (geminiRes as any).netCostUsd = reconcile.netCostUsd;
      (geminiRes as any).freeTierGroup = 'NONE';
      (geminiRes as any).isFreeTier = false;
      geminiRes.estimatedCostUsd = reconcile.netCostUsd;
    }

    // Record usage in costTracker
    if (openaiRes && openaiRes.tokensPrompt > 0) {
      this.costTracker.recordUsage('OPENAI', openaiRes.model, openaiRes.tokensPrompt, openaiRes.tokensCompletion);
    }
    if (geminiRes && geminiRes.tokensPrompt > 0) {
      this.costTracker.recordUsage('GEMINI', geminiRes.model, geminiRes.tokensPrompt, geminiRes.tokensCompletion);
    }

    // Persist reviews to database
    this.saveAiReview(setup.id, openaiRes);
    this.saveAiReview(setup.id, geminiRes);

    // Step 9: Determine Evaluation Mode & Fallback
    const isOpenAiAvailable = !openaiRes.error && openaiRes.availabilityStatus === 'AVAILABLE';
    const isGeminiAvailable = !geminiRes.error && geminiRes.availabilityStatus === 'AVAILABLE';

    let evaluationMode: AiEvaluationMode;
    if (isOpenAiAvailable && isGeminiAvailable) {
      evaluationMode = 'DUAL_AI';
    } else if (isOpenAiAvailable && !isGeminiAvailable) {
      evaluationMode = 'SINGLE_AI_OPENAI';
    } else if (!isOpenAiAvailable && isGeminiAvailable) {
      evaluationMode = 'SINGLE_AI_GEMINI';
    } else {
      evaluationMode = 'AI_UNAVAILABLE';
    }
    this.lastEvaluationMode = evaluationMode;

    // Step 10: Mode-Specific Evaluations
    if (evaluationMode === 'AI_UNAVAILABLE') {
      const errReason = `Ni OpenAI ni Gemini están disponibles (OpenAI: ${openaiRes.error || openaiRes.availabilityStatus}, Gemini: ${geminiRes.error || geminiRes.availabilityStatus})`;
      ruleViolations.push(errReason);
      return this.waitDecision(
        signalId,
        setup,
        snapshot.snapshotId,
        evaluatedAt,
        ruleViolations,
        'AI_UNAVAILABLE',
        openaiRes,
        geminiRes,
        'AI_UNAVAILABLE'
      );
    }

    if (evaluationMode === 'DUAL_AI') {
      // Both must APPROVE. If either says REJECT, strictly discard!
      if (openaiRes.verdict === 'REJECT' || geminiRes.verdict === 'REJECT') {
        const rejectSources = [];
        if (openaiRes.verdict === 'REJECT') rejectSources.push(`OpenAI: ${openaiRes.reasoning}`);
        if (geminiRes.verdict === 'REJECT') rejectSources.push(`Gemini: ${geminiRes.reasoning}`);
        ruleViolations.push(`Rechazado por analista IA (${rejectSources.join(' | ')})`);
        return this.rejectDecision(signalId, setup, snapshot.snapshotId, evaluatedAt, ruleViolations, 'AI_VERDICT_REJECT', openaiRes, geminiRes, 'DUAL_AI');
      }

      if (openaiRes.verdict === 'WAIT' || geminiRes.verdict === 'WAIT') {
        const waitSources = [];
        if (openaiRes.verdict === 'WAIT') waitSources.push(`OpenAI: ${openaiRes.reasoning}`);
        if (geminiRes.verdict === 'WAIT') waitSources.push(`Gemini: ${geminiRes.reasoning}`);
        ruleViolations.push(`En espera de confirmación adicional (${waitSources.join(' | ')})`);
        return this.waitDecision(signalId, setup, snapshot.snapshotId, evaluatedAt, ruleViolations, 'AI_VERDICT_WAIT', openaiRes, geminiRes, 'DUAL_AI');
      }

      // Both approved: check confidence thresholds
      if (openaiRes.confidence < this.minAiConfidence || geminiRes.confidence < this.minAiConfidence) {
        ruleViolations.push(
          `Nivel de confianza IA insuficiente: OpenAI=${openaiRes.confidence}%, Gemini=${geminiRes.confidence}% (mínimo ${this.minAiConfidence}%)`
        );
        return this.waitDecision(signalId, setup, snapshot.snapshotId, evaluatedAt, ruleViolations, 'LOW_AI_CONFIDENCE', openaiRes, geminiRes, 'DUAL_AI');
      }

      // Conflict & Invalidation Checks
      if (!openaiRes.structuralTargetRealistic || !geminiRes.structuralTargetRealistic) {
        ruleViolations.push('Objetivo estructural Take Profit calificado como no realista por auditoría de IA');
        return this.rejectDecision(signalId, setup, snapshot.snapshotId, evaluatedAt, ruleViolations, 'STRUCTURAL_TARGET_UNREALISTIC', openaiRes, geminiRes, 'DUAL_AI');
      }

      if (openaiRes.riskAssessment?.riskLevel === 'CRITICAL' || geminiRes.riskAssessment?.riskLevel === 'CRITICAL') {
        ruleViolations.push('Riesgo crítico detectado por análisis independiente');
        return this.rejectDecision(signalId, setup, snapshot.snapshotId, evaluatedAt, ruleViolations, 'CRITICAL_RISK_DETECTED', openaiRes, geminiRes, 'DUAL_AI');
      }
    } else if (evaluationMode === 'SINGLE_AI_OPENAI') {
      // Gemini is unavailable. Rely on OpenAI alone.
      // CRUCIAL: If OpenAI rejects or waits, that is an analytical verdict, NOT a failure. Never bypass rejection!
      if (openaiRes.verdict === 'REJECT') {
        ruleViolations.push(`Rechazado por OpenAI: ${openaiRes.reasoning}`);
        return this.rejectDecision(signalId, setup, snapshot.snapshotId, evaluatedAt, ruleViolations, 'AI_VERDICT_REJECT', openaiRes, geminiRes, 'SINGLE_AI_OPENAI');
      }

      if (openaiRes.verdict === 'WAIT') {
        ruleViolations.push(`En espera según OpenAI: ${openaiRes.reasoning}`);
        return this.waitDecision(signalId, setup, snapshot.snapshotId, evaluatedAt, ruleViolations, 'AI_VERDICT_WAIT', openaiRes, geminiRes, 'SINGLE_AI_OPENAI');
      }

      if (openaiRes.confidence < this.minAiConfidence) {
        ruleViolations.push(`Nivel de confianza OpenAI insuficiente: ${openaiRes.confidence}% (mínimo ${this.minAiConfidence}%)`);
        return this.waitDecision(signalId, setup, snapshot.snapshotId, evaluatedAt, ruleViolations, 'LOW_AI_CONFIDENCE', openaiRes, geminiRes, 'SINGLE_AI_OPENAI');
      }

      if (!openaiRes.structuralTargetRealistic) {
        ruleViolations.push('Objetivo estructural Take Profit calificado como no realista por OpenAI');
        return this.rejectDecision(signalId, setup, snapshot.snapshotId, evaluatedAt, ruleViolations, 'STRUCTURAL_TARGET_UNREALISTIC', openaiRes, geminiRes, 'SINGLE_AI_OPENAI');
      }

      if (openaiRes.riskAssessment?.riskLevel === 'CRITICAL') {
        ruleViolations.push('Riesgo crítico detectado por análisis OpenAI');
        return this.rejectDecision(signalId, setup, snapshot.snapshotId, evaluatedAt, ruleViolations, 'CRITICAL_RISK_DETECTED', openaiRes, geminiRes, 'SINGLE_AI_OPENAI');
      }
    } else if (evaluationMode === 'SINGLE_AI_GEMINI') {
      // OpenAI is unavailable. Rely on Gemini alone.
      // CRUCIAL: If Gemini rejects or waits, that is an analytical verdict, NOT a failure. Never bypass rejection!
      if (geminiRes.verdict === 'REJECT') {
        ruleViolations.push(`Rechazado por Gemini: ${geminiRes.reasoning}`);
        return this.rejectDecision(signalId, setup, snapshot.snapshotId, evaluatedAt, ruleViolations, 'AI_VERDICT_REJECT', openaiRes, geminiRes, 'SINGLE_AI_GEMINI');
      }

      if (geminiRes.verdict === 'WAIT') {
        ruleViolations.push(`En espera según Gemini: ${geminiRes.reasoning}`);
        return this.waitDecision(signalId, setup, snapshot.snapshotId, evaluatedAt, ruleViolations, 'AI_VERDICT_WAIT', openaiRes, geminiRes, 'SINGLE_AI_GEMINI');
      }

      if (geminiRes.confidence < this.minAiConfidence) {
        ruleViolations.push(`Nivel de confianza Gemini insuficiente: ${geminiRes.confidence}% (mínimo ${this.minAiConfidence}%)`);
        return this.waitDecision(signalId, setup, snapshot.snapshotId, evaluatedAt, ruleViolations, 'LOW_AI_CONFIDENCE', openaiRes, geminiRes, 'SINGLE_AI_GEMINI');
      }

      if (!geminiRes.structuralTargetRealistic) {
        ruleViolations.push('Objetivo estructural Take Profit calificado como no realista por Gemini');
        return this.rejectDecision(signalId, setup, snapshot.snapshotId, evaluatedAt, ruleViolations, 'STRUCTURAL_TARGET_UNREALISTIC', openaiRes, geminiRes, 'SINGLE_AI_GEMINI');
      }

      if (geminiRes.riskAssessment?.riskLevel === 'CRITICAL') {
        ruleViolations.push('Riesgo crítico detectado por auditoría Gemini');
        return this.rejectDecision(signalId, setup, snapshot.snapshotId, evaluatedAt, ruleViolations, 'CRITICAL_RISK_DETECTED', openaiRes, geminiRes, 'SINGLE_AI_GEMINI');
      }
    }

    // Step 11: Post-Evaluation Pre-Breach & Dynamic Price Drift Checks
    const currentPrice = this.coordinator.getMarketState().ticker?.lastPrice || snapshot.ticker.lastPrice;

    // 11a. Pre-breached Stop Loss check (technical invalidation)
    if (setup.direction === 'LONG' && currentPrice <= setup.stopLossPrice) {
      ruleViolations.push(`Stop Loss ya alcanzado antes de la entrada (Precio actual ${currentPrice} <= SL ${setup.stopLossPrice})`);
      return this.rejectDecision(signalId, setup, snapshot.snapshotId, evaluatedAt, ruleViolations, 'STOP_LOSS_PRE_BREACHED', openaiRes, geminiRes, evaluationMode);
    }
    if (setup.direction === 'SHORT' && currentPrice >= setup.stopLossPrice) {
      ruleViolations.push(`Stop Loss ya alcanzado antes de la entrada (Precio actual ${currentPrice} >= SL ${setup.stopLossPrice})`);
      return this.rejectDecision(signalId, setup, snapshot.snapshotId, evaluatedAt, ruleViolations, 'STOP_LOSS_PRE_BREACHED', openaiRes, geminiRes, evaluationMode);
    }

    // 11b. Pre-reached Take Profit check
    if (setup.direction === 'LONG' && currentPrice >= setup.takeProfitPrice) {
      ruleViolations.push(`Take Profit ya alcanzado antes de la entrada (Precio actual ${currentPrice} >= TP ${setup.takeProfitPrice})`);
      return this.expireDecision(signalId, setup, snapshot.snapshotId, evaluatedAt, ruleViolations, 'TAKE_PROFIT_PRE_REACHED', openaiRes, geminiRes, evaluationMode);
    }
    if (setup.direction === 'SHORT' && currentPrice <= setup.takeProfitPrice) {
      ruleViolations.push(`Take Profit ya alcanzado antes de la entrada (Precio actual ${currentPrice} <= TP ${setup.takeProfitPrice})`);
      return this.expireDecision(signalId, setup, snapshot.snapshotId, evaluatedAt, ruleViolations, 'TAKE_PROFIT_PRE_REACHED', openaiRes, geminiRes, evaluationMode);
    }

    // 11c. Dynamic Price Drift Calculation (ATR + Risk Distance Aware)
    const riskDistance = Math.abs(setup.entryPrice - setup.stopLossPrice);
    const atr15m = snapshot.multiTimeframe['15m']?.atr || snapshot.multiTimeframe['5m']?.atr || 50;
    const maxDriftByCeiling = setup.entryPrice * this.maxPriceDriftPcnt; // 0.15% ceiling
    const maxDriftByRisk = riskDistance * 0.10; // max 10% of risk distance
    const maxDriftByAtr = atr15m * 0.05; // max 5% of ATR
    const maxAllowedDriftUsdt = Math.max(0.5, Math.min(maxDriftByCeiling, maxDriftByRisk, maxDriftByAtr));
    const actualDriftUsdt = Math.abs(currentPrice - setup.entryPrice);

    if (actualDriftUsdt > maxAllowedDriftUsdt) {
      ruleViolations.push(
        `Desviación de precio post-análisis dinámica superada (desviación actual ${actualDriftUsdt.toFixed(2)} USDT > máximo permitido ${maxAllowedDriftUsdt.toFixed(2)} USDT; techo=${maxDriftByCeiling.toFixed(2)}, 10%R=${maxDriftByRisk.toFixed(2)}, 5%ATR=${maxDriftByAtr.toFixed(2)})`
      );
      return this.expireDecision(signalId, setup, snapshot.snapshotId, evaluatedAt, ruleViolations, 'PRICE_DRIFT_EXCEEDED', openaiRes, geminiRes, evaluationMode);
    }

    // Step 12: Final Authorization (Strictly SIGNALS_ONLY)
    let confidenceScore: number;
    if (evaluationMode === 'DUAL_AI') {
      confidenceScore = Math.round((openaiRes.confidence + geminiRes.confidence) / 2);
    } else if (evaluationMode === 'SINGLE_AI_OPENAI') {
      confidenceScore = openaiRes.confidence;
    } else {
      confidenceScore = geminiRes.confidence;
    }

    const result: ConsensusResult = {
      signalId,
      setupId: setup.id,
      timestamp: evaluatedAt,
      symbol: setup.symbol,
      strategy: setup.strategy,
      direction: setup.direction,
      timeframe: setup.timeframe,
      entryPrice: setup.entryPrice,
      stopLossPrice: setup.stopLossPrice,
      takeProfitPrice: setup.takeProfitPrice,
      grossRR: setup.riskReward.grossRR,
      netRR: setup.riskReward.netRR,
      consensusVerdict: 'AUTHORIZED',
      status: 'ACTIVE',
      openaiReview: openaiRes,
      geminiReview: geminiRes,
      snapshotId: snapshot.snapshotId,
      executionMode: 'SIGNALS_ONLY',
      evaluationMode,
      ruleViolations: [],
      confidenceScore,
      confidenceDisclaimer: 'La confianza declarada por la IA es subjetiva y no constituye una probabilidad matemática de acierto. Prevalece la invalidación técnica.',
      dynamicDrift: {
        allowedUsdt: parseFloat(maxAllowedDriftUsdt.toFixed(2)),
        actualUsdt: parseFloat(actualDriftUsdt.toFixed(2)),
      },
      evaluatedAt,
    };

    // Step 13: Save Signal & Emit Event
    this.activeSignals.set(signalId, result);
    this.saveSignalToDb(result);
    this.emit('signal_authorized', result);
    this.emit('signal_evaluated', result);

    return result;
  }

  private rejectDecision(
    signalId: string,
    setup: SetupCandidate,
    snapshotId: string,
    evaluatedAt: number,
    violations: string[],
    reason: string,
    openai?: AiEvaluationResult,
    gemini?: AiEvaluationResult,
    evaluationMode?: AiEvaluationMode
  ): ConsensusResult {
    const result: ConsensusResult = {
      signalId,
      setupId: setup.id,
      timestamp: evaluatedAt,
      symbol: setup.symbol,
      strategy: setup.strategy,
      direction: setup.direction,
      timeframe: setup.timeframe,
      entryPrice: setup.entryPrice,
      stopLossPrice: setup.stopLossPrice,
      takeProfitPrice: setup.takeProfitPrice,
      grossRR: setup.riskReward?.grossRR || 0,
      netRR: setup.riskReward?.netRR || 0,
      consensusVerdict: 'DISCARDED',
      status: 'DISCARDED',
      rejectionReason: reason,
      ruleViolations: violations,
      openaiReview: openai,
      geminiReview: gemini,
      snapshotId,
      executionMode: 'SIGNALS_ONLY',
      evaluationMode: evaluationMode || 'DUAL_AI',
      confidenceScore: 0,
      evaluatedAt,
    };

    this.saveSignalToDb(result);
    this.emit('signal_evaluated', result);
    return result;
  }

  private waitDecision(
    signalId: string,
    setup: SetupCandidate,
    snapshotId: string,
    evaluatedAt: number,
    violations: string[],
    reason: string,
    openai?: AiEvaluationResult,
    gemini?: AiEvaluationResult,
    evaluationMode?: AiEvaluationMode
  ): ConsensusResult {
    const conf =
      evaluationMode === 'SINGLE_AI_OPENAI'
        ? openai?.confidence || 0
        : evaluationMode === 'SINGLE_AI_GEMINI'
        ? gemini?.confidence || 0
        : Math.round(((openai?.confidence || 0) + (gemini?.confidence || 0)) / 2);

    const result: ConsensusResult = {
      signalId,
      setupId: setup.id,
      timestamp: evaluatedAt,
      symbol: setup.symbol,
      strategy: setup.strategy,
      direction: setup.direction,
      timeframe: setup.timeframe,
      entryPrice: setup.entryPrice,
      stopLossPrice: setup.stopLossPrice,
      takeProfitPrice: setup.takeProfitPrice,
      grossRR: setup.riskReward?.grossRR || 0,
      netRR: setup.riskReward?.netRR || 0,
      consensusVerdict: 'WAITING_CONDITIONS',
      status: 'ACTIVE',
      rejectionReason: reason,
      ruleViolations: violations,
      openaiReview: openai,
      geminiReview: gemini,
      snapshotId,
      executionMode: 'SIGNALS_ONLY',
      evaluationMode: evaluationMode || 'DUAL_AI',
      confidenceScore: conf,
      evaluatedAt,
    };

    this.saveSignalToDb(result);
    this.emit('signal_evaluated', result);
    return result;
  }

  private expireDecision(
    signalId: string,
    setup: SetupCandidate,
    snapshotId: string,
    evaluatedAt: number,
    violations: string[],
    reason: string,
    openai?: AiEvaluationResult,
    gemini?: AiEvaluationResult,
    evaluationMode?: AiEvaluationMode
  ): ConsensusResult {
    const result: ConsensusResult = {
      signalId,
      setupId: setup.id,
      timestamp: evaluatedAt,
      symbol: setup.symbol,
      strategy: setup.strategy,
      direction: setup.direction,
      timeframe: setup.timeframe,
      entryPrice: setup.entryPrice,
      stopLossPrice: setup.stopLossPrice,
      takeProfitPrice: setup.takeProfitPrice,
      grossRR: setup.riskReward?.grossRR || 0,
      netRR: setup.riskReward?.netRR || 0,
      consensusVerdict: 'DISCARDED',
      status: 'EXPIRED',
      rejectionReason: reason,
      ruleViolations: violations,
      openaiReview: openai,
      geminiReview: gemini,
      snapshotId,
      executionMode: 'SIGNALS_ONLY',
      evaluationMode: evaluationMode || 'DUAL_AI',
      confidenceScore: 0,
      evaluatedAt,
    };

    this.saveSignalToDb(result);
    this.emit('signal_evaluated', result);
    return result;
  }

  private saveAiReview(setupId: string, review: AiEvaluationResult): void {
    try {
      const reviewId = `rev_${review.provider.toLowerCase()}_${setupId}_${Date.now()}`;
      this.db.saveAiReview({
        id: reviewId,
        setupId,
        provider: review.provider,
        model: review.model,
        verdict: review.verdict,
        confidence: review.confidence,
        reasoning: review.reasoning,
        argumentsFor: review.argumentsFor,
        argumentsAgainst: review.argumentsAgainst,
        invalidationTrigger: review.riskAssessment?.invalidationTrigger,
        riskScore: review.riskAssessment?.riskLevel === 'CRITICAL' ? 1.0 : review.riskAssessment?.riskLevel === 'HIGH' ? 0.75 : review.riskAssessment?.riskLevel === 'MEDIUM' ? 0.5 : 0.2,
        latencyMs: review.latencyMs,
        tokensUsed: review.tokensPrompt + review.tokensCompletion,
        costUsd: review.estimatedCostUsd,
        rawResponse: JSON.stringify(review.rawResponse || {}),
        timestamp: Date.now(),
      });
    } catch {}
  }

  private saveSignalToDb(signal: ConsensusResult): void {
    try {
      this.db.saveSignal({
        id: signal.signalId,
        setupId: signal.setupId,
        timestamp: signal.timestamp,
        symbol: signal.symbol,
        strategy: signal.strategy,
        direction: signal.direction,
        timeframe: signal.timeframe,
        entryPrice: signal.entryPrice,
        stopLoss: signal.stopLossPrice,
        takeProfit: signal.takeProfitPrice,
        rrNet: signal.netRR,
        consensusVerdict: signal.consensusVerdict,
        openaiVerdict: signal.openaiReview?.verdict,
        geminiVerdict: signal.geminiReview?.verdict,
        status: signal.status,
        rejectionReason: signal.rejectionReason,
        snapshotId: signal.snapshotId,
        evaluationMode: signal.evaluationMode || 'DUAL_AI',
        createdAt: signal.evaluatedAt,
      });
    } catch {}
  }

  public getActiveSignals(): ConsensusResult[] {
    return Array.from(this.activeSignals.values());
  }

  public getCostTracker(): CostTracker {
    return this.costTracker;
  }

  public getHardBudgetManager(): HardBudgetManager {
    return this.hardBudgetManager;
  }

  public getOpenAiAdapter(): OpenAiAdapter {
    return this.openaiAdapter;
  }

  public getGeminiAdapter(): GeminiAdapter {
    return this.geminiAdapter;
  }

  public updateAiCredentials(provider: 'openai' | 'gemini', apiKey: string, model?: string, reasoningEffort?: 'low' | 'medium' | 'high'): void {
    if (provider === 'openai') {
      this.openaiAdapter.updateCredentials(apiKey, model, reasoningEffort);
    } else if (provider === 'gemini') {
      this.geminiAdapter.updateCredentials(apiKey, model);
    }
    this.lastEvaluationMode = this.getCurrentEvaluationMode();
  }

  public getCurrentEvaluationMode(): AiEvaluationMode {
    if (this.hardBudgetManager.isBlocked() || this.hardBudgetManager.getTodaySpendUsd() >= this.hardBudgetManager.getConfig().dailyBudgetLimitUsd) {
      return 'AI_BUDGET_EXCEEDED';
    }

    const openaiStatus = this.openaiAdapter.getStatus();
    const geminiStatus = this.geminiAdapter.getStatus();
    const isOpenAiConfigured = openaiStatus.configured;
    const isGeminiConfigured = geminiStatus.configured;

    if (isOpenAiConfigured && isGeminiConfigured) {
      return 'DUAL_AI';
    }
    if (isOpenAiConfigured && !isGeminiConfigured) {
      return 'SINGLE_AI_OPENAI';
    }
    if (!isOpenAiConfigured && isGeminiConfigured) {
      return 'SINGLE_AI_GEMINI';
    }
    return 'AI_UNAVAILABLE';
  }

  public getLastEvaluationMode(): AiEvaluationMode {
    return this.lastEvaluationMode;
  }
}
