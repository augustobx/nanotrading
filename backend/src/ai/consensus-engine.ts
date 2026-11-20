import { EventEmitter } from 'events';
import { MarketCoordinator } from '../market/market-coordinator.js';
import { SetupCandidate } from '../engine/strategy-a-trend.js';
import { SnapshotBuilder } from './snapshot-builder.js';
import { OpenAiAdapter } from './openai-adapter.js';
import { GeminiAdapter } from './gemini-adapter.js';
import { CostTracker } from './cost-tracker.js';
import { DatabaseService } from '../storage/database.js';
import {
  ConsensusResult,
  ConsensusVerdict,
  AiEvaluationResult,
  MarketSnapshot,
} from './types.js';

export interface ConsensusEngineOptions {
  coordinator: MarketCoordinator;
  db: DatabaseService;
  openaiAdapter?: OpenAiAdapter;
  geminiAdapter?: GeminiAdapter;
  costTracker?: CostTracker;
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
  private minAiConfidence: number;
  private maxPriceDriftPcnt: number;
  private maxSnapshotAgeMs: number;
  private activeSignals: Map<string, ConsensusResult> = new Map();

  constructor(options: ConsensusEngineOptions) {
    super();
    this.coordinator = options.coordinator;
    this.db = options.db;
    this.openaiAdapter = options.openaiAdapter || new OpenAiAdapter();
    this.geminiAdapter = options.geminiAdapter || new GeminiAdapter();
    this.costTracker = options.costTracker || new CostTracker();
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

    // Step 6: Spread / Volatility filter
    if (snapshot.ticker.spreadPcnt > 0.05) {
      ruleViolations.push(`Spread excesivo (${snapshot.ticker.spreadPcnt.toFixed(4)}% > 0.05%)`);
      return this.rejectDecision(signalId, setup, snapshot.snapshotId, evaluatedAt, ruleViolations, 'SPREAD_TOO_HIGH');
    }

    // Step 7: Budget / Rate limit check
    if (!this.costTracker.canMakeCalls(2)) {
      ruleViolations.push('Límite de presupuesto diario de IA alcanzado');
      return this.waitDecision(
        signalId,
        setup,
        snapshot.snapshotId,
        evaluatedAt,
        ruleViolations,
        'DAILY_AI_BUDGET_EXCEEDED'
      );
    }

    // Step 8: Parallel Dual AI Consultation
    const [openaiRes, geminiRes] = await Promise.all([
      this.openaiAdapter.evaluate(snapshot),
      this.geminiAdapter.evaluate(snapshot),
    ]);

    // Record usage
    if (openaiRes.tokensPrompt > 0) {
      this.costTracker.recordUsage('OPENAI', openaiRes.model, openaiRes.tokensPrompt, openaiRes.tokensCompletion);
    }
    if (geminiRes.tokensPrompt > 0) {
      this.costTracker.recordUsage('GEMINI', geminiRes.model, geminiRes.tokensPrompt, geminiRes.tokensCompletion);
    }

    // Persist reviews to database
    this.saveAiReview(setup.id, openaiRes);
    this.saveAiReview(setup.id, geminiRes);

    // Step 9: AI Availability & Double-Validation enforcement
    if (openaiRes.error || geminiRes.error) {
      const errReason = `Doble validación incompleta (OpenAI: ${openaiRes.error || 'OK'}, Gemini: ${geminiRes.error || 'OK'})`;
      ruleViolations.push(errReason);
      return this.waitDecision(signalId, setup, snapshot.snapshotId, evaluatedAt, ruleViolations, 'AI_VALIDATION_INCOMPLETE', openaiRes, geminiRes);
    }

    // Step 10: Consensus Rules (Both must APPROVE)
    if (openaiRes.verdict === 'REJECT' || geminiRes.verdict === 'REJECT') {
      const rejectSources = [];
      if (openaiRes.verdict === 'REJECT') rejectSources.push(`OpenAI: ${openaiRes.reasoning}`);
      if (geminiRes.verdict === 'REJECT') rejectSources.push(`Gemini: ${geminiRes.reasoning}`);
      ruleViolations.push(`Rechazado por analista IA (${rejectSources.join(' | ')})`);
      return this.rejectDecision(signalId, setup, snapshot.snapshotId, evaluatedAt, ruleViolations, 'AI_VERDICT_REJECT', openaiRes, geminiRes);
    }

    if (openaiRes.verdict === 'WAIT' || geminiRes.verdict === 'WAIT') {
      const waitSources = [];
      if (openaiRes.verdict === 'WAIT') waitSources.push(`OpenAI: ${openaiRes.reasoning}`);
      if (geminiRes.verdict === 'WAIT') waitSources.push(`Gemini: ${geminiRes.reasoning}`);
      ruleViolations.push(`En espera de confirmación adicional (${waitSources.join(' | ')})`);
      return this.waitDecision(signalId, setup, snapshot.snapshotId, evaluatedAt, ruleViolations, 'AI_VERDICT_WAIT', openaiRes, geminiRes);
    }

    // Both approved: check confidence thresholds
    if (openaiRes.confidence < this.minAiConfidence || geminiRes.confidence < this.minAiConfidence) {
      ruleViolations.push(
        `Nivel de confianza IA insuficiente: OpenAI=${openaiRes.confidence}%, Gemini=${geminiRes.confidence}% (mínimo ${this.minAiConfidence}%)`
      );
      return this.waitDecision(signalId, setup, snapshot.snapshotId, evaluatedAt, ruleViolations, 'LOW_AI_CONFIDENCE', openaiRes, geminiRes);
    }

    // Step 11: Conflict & Invalidation Checks
    if (!openaiRes.structuralTargetRealistic || !geminiRes.structuralTargetRealistic) {
      ruleViolations.push('Objetivo estructural Take Profit calificado como no realista por auditoría de IA');
      return this.rejectDecision(signalId, setup, snapshot.snapshotId, evaluatedAt, ruleViolations, 'STRUCTURAL_TARGET_UNREALISTIC', openaiRes, geminiRes);
    }

    if (openaiRes.riskAssessment?.riskLevel === 'CRITICAL' || geminiRes.riskAssessment?.riskLevel === 'CRITICAL') {
      ruleViolations.push('Riesgo crítico detectado por análisis independiente');
      return this.rejectDecision(signalId, setup, snapshot.snapshotId, evaluatedAt, ruleViolations, 'CRITICAL_RISK_DETECTED', openaiRes, geminiRes);
    }

    // Step 12: Post-Evaluation Price Drift Check
    const currentPrice = this.coordinator.getMarketState().ticker?.lastPrice || snapshot.ticker.lastPrice;
    const priceDrift = Math.abs(currentPrice - setup.entryPrice) / setup.entryPrice;
    if (priceDrift > this.maxPriceDriftPcnt) {
      ruleViolations.push(
        `Deslizamiento de precio post-análisis (${(priceDrift * 100).toFixed(3)}% > ${(this.maxPriceDriftPcnt * 100).toFixed(3)}%)`
      );
      return this.expireDecision(signalId, setup, snapshot.snapshotId, evaluatedAt, ruleViolations, 'PRICE_DRIFT_EXCEEDED', openaiRes, geminiRes);
    }

    // Step 13: Final Authorization (Strictly SIGNALS_ONLY)
    const confidenceScore = Math.round((openaiRes.confidence + geminiRes.confidence) / 2);
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
      ruleViolations: [],
      confidenceScore,
      evaluatedAt,
    };

    // Step 14: Save Signal & Emit Event
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
    gemini?: AiEvaluationResult
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
    gemini?: AiEvaluationResult
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
      consensusVerdict: 'WAITING_CONDITIONS',
      status: 'ACTIVE',
      rejectionReason: reason,
      ruleViolations: violations,
      openaiReview: openai,
      geminiReview: gemini,
      snapshotId,
      executionMode: 'SIGNALS_ONLY',
      confidenceScore: Math.round(((openai?.confidence || 0) + (gemini?.confidence || 0)) / 2),
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
    gemini?: AiEvaluationResult
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
}
