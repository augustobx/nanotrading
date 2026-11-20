import { AiProvider } from './types.js';
import { getModelMetadata, calculateCallCost, DetailedTokenUsage } from './models-catalog.js';
import { DatabaseService } from '../storage/database.js';

export type BudgetStatus = 'OK' | 'WARNING_50' | 'WARNING_80' | 'CRITICAL_95' | 'AI_BUDGET_EXCEEDED';

export interface HardBudgetConfig {
  dailyBudgetLimitUsd: number;      // Default: 0.50 USD
  monthlyBudgetLimitUsd: number;    // Default: 10.00 USD
  maxCostPerRequestUsd: number;     // Default: 0.05 USD
  providerLimitsUsd?: {
    openai?: number;
    gemini?: number;
  };
  modelLimitsUsd?: Record<string, number>;
  taskLimitsUsd?: Record<string, number>;
  alertThresholdsPercent: number[]; // Default: [50, 80, 95, 100]
  autoResetPeriod: boolean;         // Default: true
  isBlocked: boolean;               // Mandatory hard stop flag
  blockedReason: string | null;
  updatedAt: number;
}

export interface BudgetReservation {
  id: string;
  amountUsd: number;
  provider: AiProvider;
  model: string;
  task: string;
  timestamp: number;
  status: 'PENDING' | 'RECONCILED' | 'RELEASED';
}

export interface HardBudgetSummary {
  dailyBudgetLimitUsd: number;
  monthlyBudgetLimitUsd: number;
  maxCostPerRequestUsd: number;
  todaySpendUsd: number;
  monthSpendUsd: number;
  reservedPendingUsd: number;
  effectiveTodaySpendUsd: number;
  effectiveMonthSpendUsd: number;
  remainingDailyUsd: number;
  remainingMonthlyUsd: number;
  dailyPercentUsed: number;
  monthlyPercentUsed: number;
  status: BudgetStatus;
  isBlocked: boolean;
  blockedReason: string | null;
  spendByProvider: Record<AiProvider, number>;
  spendByModel: Record<string, number>;
  spendByTask: Record<string, number>;
  tokensSummary: {
    promptTokens: number;
    completionTokens: number;
    cachedTokens: number;
    reasoningTokens: number;
    totalTokens: number;
  };
  activeReservationsCount: number;
  totalCallsCount: number;
  nextDailyResetUtc: string;
  nextDailyResetAr: string;
  nextMonthlyResetUtc: string;
  nextMonthlyResetAr: string;
}

export const DEFAULT_HARD_BUDGET_CONFIG: HardBudgetConfig = {
  dailyBudgetLimitUsd: 0.50, // Límite diario oficial estricto Fase 4.6
  monthlyBudgetLimitUsd: 10.00, // Límite mensual global
  maxCostPerRequestUsd: 0.05,
  providerLimitsUsd: {
    openai: 0.40,
    gemini: 0.40,
  },
  alertThresholdsPercent: [50, 80, 95, 100],
  autoResetPeriod: true,
  isBlocked: false,
  blockedReason: null,
  updatedAt: Date.now(),
};

export interface NotifierCallbacks {
  sendTelegramAlert?: (title: string, message: string, severity: 'INFO' | 'WARNING' | 'CRITICAL') => Promise<void>;
  sendWebPushAlert?: (title: string, message: string) => Promise<void>;
  logAudit?: (category: string, action: string, details: any) => void;
}

export class HardBudgetManager {
  private config: HardBudgetConfig;
  private reservations: Map<string, BudgetReservation> = new Map();
  private triggeredThresholds: Set<number> = new Set();
  private lastResetDay: number = new Date().getUTCDate();
  private notifiers: NotifierCallbacks = {};
  private db?: DatabaseService;

  // In-memory usage records for fast aggregation & recovery
  private usageRecords: Array<{
    id: string;
    timestamp: number;
    provider: AiProvider;
    model: string;
    task: string;
    promptTokens: number;
    completionTokens: number;
    cachedTokens: number;
    reasoningTokens: number;
    costUsd: number;
  }> = [];

  constructor(initialConfig?: Partial<HardBudgetConfig>, notifiers?: NotifierCallbacks, db?: DatabaseService) {
    this.config = { ...DEFAULT_HARD_BUDGET_CONFIG, ...(initialConfig || {}) };
    if (notifiers) {
      this.notifiers = notifiers;
    }
    this.db = db;
  }

  public setDatabase(db: DatabaseService): void {
    this.db = db;
  }

  public setNotifiers(notifiers: NotifierCallbacks): void {
    this.notifiers = notifiers;
  }

  public getConfig(): HardBudgetConfig {
    return { ...this.config };
  }

  public isBlocked(): boolean {
    return this.config.isBlocked;
  }

  public getBlockedReason(): string | null {
    return this.config.blockedReason;
  }

  private checkPeriodReset(): void {
    if (!this.config.autoResetPeriod) return;
    const currentDay = new Date().getUTCDate();
    if (currentDay !== this.lastResetDay) {
      this.lastResetDay = currentDay;
      this.triggeredThresholds.clear();
      // If blocked solely due to daily limit, auto-unblock on new day
      if (this.config.isBlocked && this.config.blockedReason?.includes('diario')) {
        this.config.isBlocked = false;
        this.config.blockedReason = null;
        this.config.updatedAt = Date.now();
      }
    }
  }

  /**
   * Calculates worst-case estimated cost for atomic reservation with a 10% safety margin.
   */
  public estimateWorstCaseCost(model: string, maxInputTokens: number = 3000, maxOutputTokens: number = 1000): number {
    const meta = getModelMetadata(model);
    const inputCost = (maxInputTokens / 1_000_000) * meta.estimatedInputCostPerMillion;
    const outputCost = (maxOutputTokens / 1_000_000) * meta.estimatedOutputCostPerMillion;
    const baseCost = inputCost + outputCost;
    // Apply 10% safety margin to absorb output token and formatting variance
    const withSafetyMargin = baseCost * 1.10;
    return parseFloat(withSafetyMargin.toFixed(6));
  }

  public getReservedPendingUsd(): number {
    // Reconcile and clean up stale reservations older than 5 minutes
    const now = Date.now();
    for (const [id, res] of this.reservations.entries()) {
      if (res.status !== 'PENDING' || now - res.timestamp > 300000) {
        this.reservations.delete(id);
      }
    }
    let sum = 0;
    for (const res of this.reservations.values()) {
      if (res.status === 'PENDING') sum += res.amountUsd;
    }
    return parseFloat(sum.toFixed(6));
  }

  public getTodaySpendUsd(): number {
    this.checkPeriodReset();
    if (this.db) {
      try {
        const stats = this.db.getAiConsumptionStats();
        if (stats && typeof stats.todaySpendUsd === 'number') {
          return parseFloat(Number(stats.todaySpendUsd).toFixed(6));
        }
      } catch {}
    }
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const cutoff = startOfDay.getTime();
    const sum = this.usageRecords
      .filter((r) => r.timestamp >= cutoff)
      .reduce((acc, r) => acc + r.costUsd, 0);
    return parseFloat(sum.toFixed(6));
  }

  public getMonthSpendUsd(): number {
    if (this.db) {
      try {
        const stats = this.db.getAiConsumptionStats();
        if (stats && typeof stats.monthSpendUsd === 'number') {
          return parseFloat(Number(stats.monthSpendUsd).toFixed(6));
        }
      } catch {}
    }
    const startOfMonth = new Date();
    startOfMonth.setUTCDate(1);
    startOfMonth.setUTCHours(0, 0, 0, 0);
    const cutoff = startOfMonth.getTime();
    const sum = this.usageRecords
      .filter((r) => r.timestamp >= cutoff)
      .reduce((acc, r) => acc + r.costUsd, 0);
    return parseFloat(sum.toFixed(6));
  }

  /**
   * Pre-call Atomic Budget Reservation.
   * Calculates worst-case cost and checks all limits (daily, monthly, provider, model, task).
   * If any limit would be exceeded, immediately blocks the call.
   */
  public reserveBudget(params: {
    provider: AiProvider;
    model: string;
    task: string;
    maxEstimatedCostUsd?: number;
  }): {
    allowed: boolean;
    reservationId?: string;
    reservedAmountUsd?: number;
    status: BudgetStatus;
    reason?: string;
    violatedLimit?: string;
  } {
    this.checkPeriodReset();

    if (this.config.isBlocked) {
      return {
        allowed: false,
        status: 'AI_BUDGET_EXCEEDED',
        reason: this.config.blockedReason || 'Presupuesto de IA bloqueado por límite económico excedido',
        violatedLimit: 'BLOCKED',
      };
    }

    const estimatedCost = params.maxEstimatedCostUsd ?? this.estimateWorstCaseCost(params.model);

    // 1. Max cost per request limit
    if (estimatedCost > this.config.maxCostPerRequestUsd) {
      return {
        allowed: false,
        status: 'AI_BUDGET_EXCEEDED',
        reason: `Costo estimado de solicitud ($${estimatedCost.toFixed(4)}) supera el máximo por petición configurado ($${this.config.maxCostPerRequestUsd.toFixed(4)})`,
        violatedLimit: 'MAX_PER_REQUEST',
      };
    }

    const currentToday = this.getTodaySpendUsd();
    const currentMonth = this.getMonthSpendUsd();
    const currentPending = this.getReservedPendingUsd();

    // 2. Global daily limit
    if (currentToday + currentPending + estimatedCost > this.config.dailyBudgetLimitUsd) {
      this.triggerBlock(`Límite de presupuesto diario alcanzado ($${(currentToday + currentPending).toFixed(4)} + $${estimatedCost.toFixed(4)} > $${this.config.dailyBudgetLimitUsd.toFixed(4)})`);
      return {
        allowed: false,
        status: 'AI_BUDGET_EXCEEDED',
        reason: this.config.blockedReason!,
        violatedLimit: 'DAILY_GLOBAL',
      };
    }

    // 3. Global monthly limit
    if (currentMonth + currentPending + estimatedCost > this.config.monthlyBudgetLimitUsd) {
      this.triggerBlock(`Límite de presupuesto mensual alcanzado ($${(currentMonth + currentPending).toFixed(4)} > $${this.config.monthlyBudgetLimitUsd.toFixed(4)})`);
      return {
        allowed: false,
        status: 'AI_BUDGET_EXCEEDED',
        reason: this.config.blockedReason!,
        violatedLimit: 'MONTHLY_GLOBAL',
      };
    }

    // 4. Provider specific limit
    if (this.config.providerLimitsUsd) {
      const provKey = params.provider.toLowerCase() as 'openai' | 'gemini';
      const provLimit = this.config.providerLimitsUsd[provKey];
      if (provLimit !== undefined) {
        const startOfDay = new Date();
        startOfDay.setUTCHours(0, 0, 0, 0);
        const provTodaySpend = this.usageRecords
          .filter((r) => r.timestamp >= startOfDay.getTime() && r.provider === params.provider)
          .reduce((acc, r) => acc + r.costUsd, 0);
        if (provTodaySpend + estimatedCost > provLimit) {
          return {
            allowed: false,
            status: 'AI_BUDGET_EXCEEDED',
            reason: `Límite específico para proveedor ${params.provider} alcanzado ($${provTodaySpend.toFixed(4)} >= $${provLimit.toFixed(4)})`,
            violatedLimit: `PROVIDER_${params.provider}`,
          };
        }
      }
    }

    // 5. Model specific limit
    if (this.config.modelLimitsUsd && this.config.modelLimitsUsd[params.model]) {
      const modelLimit = this.config.modelLimitsUsd[params.model];
      const startOfDay = new Date();
      startOfDay.setUTCHours(0, 0, 0, 0);
      const modelTodaySpend = this.usageRecords
        .filter((r) => r.timestamp >= startOfDay.getTime() && r.model === params.model)
        .reduce((acc, r) => acc + r.costUsd, 0);
      if (modelTodaySpend + estimatedCost > modelLimit) {
        return {
          allowed: false,
          status: 'AI_BUDGET_EXCEEDED',
          reason: `Límite para modelo ${params.model} alcanzado ($${modelTodaySpend.toFixed(4)} >= $${modelLimit.toFixed(4)})`,
          violatedLimit: `MODEL_${params.model}`,
        };
      }
    }

    // 6. Task specific limit
    if (this.config.taskLimitsUsd && this.config.taskLimitsUsd[params.task]) {
      const taskLimit = this.config.taskLimitsUsd[params.task];
      const startOfDay = new Date();
      startOfDay.setUTCHours(0, 0, 0, 0);
      const taskTodaySpend = this.usageRecords
        .filter((r) => r.timestamp >= startOfDay.getTime() && r.task === params.task)
        .reduce((acc, r) => acc + r.costUsd, 0);
      if (taskTodaySpend + estimatedCost > taskLimit) {
        return {
          allowed: false,
          status: 'AI_BUDGET_EXCEEDED',
          reason: `Límite para tarea ${params.task} alcanzado ($${taskTodaySpend.toFixed(4)} >= $${taskLimit.toFixed(4)})`,
          violatedLimit: `TASK_${params.task}`,
        };
      }
    }

    // Atomic allocation
    const reservationId = `res_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    this.reservations.set(reservationId, {
      id: reservationId,
      amountUsd: estimatedCost,
      provider: params.provider,
      model: params.model,
      task: params.task,
      timestamp: Date.now(),
      status: 'PENDING',
    });

    return {
      allowed: true,
      reservationId,
      reservedAmountUsd: estimatedCost,
      status: this.calculateCurrentStatus(),
    };
  }

  /**
   * Reconciles a completed call: releases reservation and logs actual usage.
   * If status is UNCERTAIN_TIMEOUT, holds estimated cost conservatively to protect the budget.
   */
  public reconcileReservation(
    reservationId: string,
    usage: {
      provider: AiProvider;
      model: string;
      task: string;
      promptTokens: number;
      completionTokens: number;
      cachedTokens?: number;
      reasoningTokens?: number;
      costUsd?: number;
      status?: 'SUCCESS' | 'UNCERTAIN_TIMEOUT' | 'ERROR';
      latencyMs?: number;
    }
  ): void {
    const reservation = this.reservations.get(reservationId);
    this.reservations.delete(reservationId);

    let actualCost: number;
    if (usage.status === 'UNCERTAIN_TIMEOUT') {
      actualCost = usage.costUsd !== undefined ? usage.costUsd : (reservation?.amountUsd || 0);
    } else if (usage.status === 'ERROR' && (usage.promptTokens || 0) === 0 && (usage.completionTokens || 0) === 0) {
      actualCost = 0;
    } else {
      actualCost =
        usage.costUsd !== undefined
          ? usage.costUsd
          : calculateCallCost(usage.model, {
              promptTokens: usage.promptTokens,
              completionTokens: usage.completionTokens,
              cachedTokens: usage.cachedTokens || 0,
              reasoningTokens: usage.reasoningTokens || 0,
            });
    }

    this.recordDirectUsage(
      usage.provider,
      usage.model,
      usage.task,
      actualCost,
      {
        prompt: usage.promptTokens,
        completion: usage.completionTokens,
        cached: usage.cachedTokens,
        reasoning: usage.reasoningTokens,
      },
      usage.status || 'SUCCESS',
      usage.latencyMs || 0
    );
  }

  public releaseReservation(reservationId: string): void {
    this.reservations.delete(reservationId);
  }

  /**
   * Records usage directly and evaluates threshold crossings.
   */
  public recordDirectUsage(
    provider: AiProvider,
    model: string,
    task: string,
    costUsd: number,
    tokens?: { prompt: number; completion: number; cached?: number; reasoning?: number },
    status: string = 'SUCCESS',
    latencyMs: number = 0
  ): void {
    const roundedCost = parseFloat(costUsd.toFixed(6));
    const record = {
      id: `usg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      timestamp: Date.now(),
      provider,
      model,
      task,
      promptTokens: tokens?.prompt || 0,
      completionTokens: tokens?.completion || 0,
      cachedTokens: tokens?.cached || 0,
      reasoningTokens: tokens?.reasoning || 0,
      costUsd: roundedCost,
    };
    this.usageRecords.push(record);

    if (this.db) {
      try {
        this.db.logAiConsumption({
          id: record.id,
          timestamp: record.timestamp,
          provider,
          model,
          task,
          tokensPrompt: record.promptTokens,
          tokensCompletion: record.completionTokens,
          tokensCached: record.cachedTokens,
          costUsd: record.costUsd,
          latencyMs,
          status,
        });
      } catch {}
    }

    this.evaluateAlerts();
  }

  private calculateCurrentStatus(): BudgetStatus {
    if (this.config.isBlocked) return 'AI_BUDGET_EXCEEDED';
    const today = this.getTodaySpendUsd() + this.getReservedPendingUsd();
    const percent = (today / this.config.dailyBudgetLimitUsd) * 100;
    if (percent >= 100) return 'AI_BUDGET_EXCEEDED';
    if (percent >= 95) return 'CRITICAL_95';
    if (percent >= 80) return 'WARNING_80';
    if (percent >= 50) return 'WARNING_50';
    return 'OK';
  }

  /**
   * Checks budget threshold crossings and triggers deduplicated alerts.
   * "Las notificaciones de presupuesto no deben consumir tokens de IA."
   */
  private evaluateAlerts(): void {
    const todaySpend = this.getTodaySpendUsd();
    const percent = (todaySpend / this.config.dailyBudgetLimitUsd) * 100;

    // Check 100% suspension
    if (percent >= 100 && !this.config.isBlocked) {
      this.triggerBlock(`Límite del 100% de presupuesto diario alcanzado ($${todaySpend.toFixed(4)} / $${this.config.dailyBudgetLimitUsd.toFixed(2)})`);
      return;
    }

    // Check thresholds: 50, 80, 95
    for (const threshold of [50, 80, 95]) {
      if (percent >= threshold && !this.triggeredThresholds.has(threshold)) {
        this.triggeredThresholds.add(threshold);
        const severity = threshold === 95 ? 'CRITICAL' : threshold === 80 ? 'WARNING' : 'INFO';
        const title = `⚠️ Presupuesto IA al ${threshold}%`;
        const msg = `El gasto diario de IA ha alcanzado el ${percent.toFixed(1)}% ($${todaySpend.toFixed(4)} de $${this.config.dailyBudgetLimitUsd.toFixed(2)} USD). Operación en modo SIGNALS_ONLY preservada.`;

        this.notifiers.sendTelegramAlert?.(title, msg, severity).catch(() => {});
        this.notifiers.sendWebPushAlert?.(title, msg).catch(() => {});
        this.notifiers.logAudit?.('AI_BUDGET', `ALERT_${threshold}`, {
          percent: parseFloat(percent.toFixed(1)),
          todaySpendUsd: todaySpend,
          dailyLimitUsd: this.config.dailyBudgetLimitUsd,
        });
      }
    }
  }

  private triggerBlock(reason: string): void {
    this.config.isBlocked = true;
    this.config.blockedReason = reason;
    this.config.updatedAt = Date.now();
    this.triggeredThresholds.add(100);

    const title = '🛑 SUSPENSIÓN DE LLAMADAS PAGAS DE IA (Límite 100%)';
    const msg = `Se ha alcanzado el límite presupuestario de IA: ${reason}. Las llamadas pagadas quedan suspendidas (AI_BUDGET_EXCEEDED). El monitoreo de mercado Bybit y las estrategias cuantitativas SMC continúan al 100% sin interrupciones.`;

    this.notifiers.sendTelegramAlert?.(title, msg, 'CRITICAL').catch(() => {});
    this.notifiers.sendWebPushAlert?.(title, msg).catch(() => {});
    this.notifiers.logAudit?.('AI_BUDGET', 'HARD_STOP', {
      reason,
      todaySpendUsd: this.getTodaySpendUsd(),
      dailyLimitUsd: this.config.dailyBudgetLimitUsd,
      monthlyLimitUsd: this.config.monthlyBudgetLimitUsd,
    });
  }

  public reactivateBudget(updatedBy: string = 'admin', newDailyLimit?: number): void {
    const currentToday = this.getTodaySpendUsd() + this.getReservedPendingUsd();
    if (currentToday >= this.config.dailyBudgetLimitUsd) {
      if (newDailyLimit === undefined || newDailyLimit <= currentToday) {
        throw new Error(
          `No es posible reactivar el presupuesto: el gasto acumulado actual ($${currentToday.toFixed(4)} USD) alcanza o supera el límite diario configurado ($${this.config.dailyBudgetLimitUsd.toFixed(2)} USD). Para reactivar las evaluaciones, debe especificar un nuevo límite diario superior al gasto acumulado.`
        );
      }
      this.config.dailyBudgetLimitUsd = newDailyLimit;
    } else if (newDailyLimit !== undefined && newDailyLimit > 0) {
      this.config.dailyBudgetLimitUsd = newDailyLimit;
    }

    this.config.isBlocked = false;
    this.config.blockedReason = null;
    this.config.updatedAt = Date.now();
    this.triggeredThresholds.clear();

    this.notifiers.logAudit?.('AI_BUDGET', 'REACTIVATE', {
      updatedBy,
      newDailyLimitUsd: this.config.dailyBudgetLimitUsd,
      currentTodaySpendUsd: currentToday,
    });
  }

  public updateConfig(updates: Partial<HardBudgetConfig>, updatedBy: string = 'admin'): HardBudgetConfig {
    if (updates.dailyBudgetLimitUsd !== undefined && updates.dailyBudgetLimitUsd <= 0) {
      throw new Error('El límite diario de presupuesto debe ser mayor a 0 USD');
    }
    if (updates.monthlyBudgetLimitUsd !== undefined && updates.monthlyBudgetLimitUsd <= 0) {
      throw new Error('El límite mensual de presupuesto debe ser mayor a 0 USD');
    }

    this.config = {
      ...this.config,
      ...updates,
      providerLimitsUsd: {
        ...this.config.providerLimitsUsd,
        ...(updates.providerLimitsUsd || {}),
      },
      modelLimitsUsd: {
        ...this.config.modelLimitsUsd,
        ...(updates.modelLimitsUsd || {}),
      },
      taskLimitsUsd: {
        ...this.config.taskLimitsUsd,
        ...(updates.taskLimitsUsd || {}),
      },
      updatedAt: Date.now(),
    };

    // If new limit is higher than current spend and isBlocked was not explicitly set, unblock
    const today = this.getTodaySpendUsd();
    if (updates.isBlocked === undefined && this.config.isBlocked && today < this.config.dailyBudgetLimitUsd) {
      this.config.isBlocked = false;
      this.config.blockedReason = null;
    }

    this.notifiers.logAudit?.('AI_BUDGET', 'UPDATE_CONFIG', {
      updates,
      updatedBy,
    });

    return this.getConfig();
  }

  public getSummary(): HardBudgetSummary {
    const todaySpend = this.getTodaySpendUsd();
    const monthSpend = this.getMonthSpendUsd();
    const reservedPending = this.getReservedPendingUsd();
    const effectiveToday = todaySpend + reservedPending;
    const effectiveMonth = monthSpend + reservedPending;

    const remainingDaily = Math.max(0, parseFloat((this.config.dailyBudgetLimitUsd - effectiveToday).toFixed(4)));
    const remainingMonthly = Math.max(0, parseFloat((this.config.monthlyBudgetLimitUsd - effectiveMonth).toFixed(4)));

    const dailyPercent = Math.min(100, parseFloat(((effectiveToday / this.config.dailyBudgetLimitUsd) * 100).toFixed(1)));
    const monthlyPercent = Math.min(100, parseFloat(((effectiveMonth / this.config.monthlyBudgetLimitUsd) * 100).toFixed(1)));

    const spendByProvider: Record<AiProvider, number> = { OPENAI: 0, GEMINI: 0 };
    const spendByModel: Record<string, number> = {};
    const spendByTask: Record<string, number> = {};

    let promptTokens = 0;
    let completionTokens = 0;
    let cachedTokens = 0;
    let reasoningTokens = 0;

    for (const r of this.usageRecords) {
      spendByProvider[r.provider] = parseFloat(((spendByProvider[r.provider] || 0) + r.costUsd).toFixed(4));
      spendByModel[r.model] = parseFloat(((spendByModel[r.model] || 0) + r.costUsd).toFixed(4));
      spendByTask[r.task] = parseFloat(((spendByTask[r.task] || 0) + r.costUsd).toFixed(4));

      promptTokens += r.promptTokens;
      completionTokens += r.completionTokens;
      cachedTokens += r.cachedTokens;
      reasoningTokens += r.reasoningTokens;
    }

    const now = new Date();
    const nextDailyResetUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0));
    const nextMonthlyResetUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));

    return {
      dailyBudgetLimitUsd: this.config.dailyBudgetLimitUsd,
      monthlyBudgetLimitUsd: this.config.monthlyBudgetLimitUsd,
      maxCostPerRequestUsd: this.config.maxCostPerRequestUsd,
      todaySpendUsd: todaySpend,
      monthSpendUsd: monthSpend,
      reservedPendingUsd: reservedPending,
      effectiveTodaySpendUsd: effectiveToday,
      effectiveMonthSpendUsd: effectiveMonth,
      remainingDailyUsd: remainingDaily,
      remainingMonthlyUsd: remainingMonthly,
      dailyPercentUsed: dailyPercent,
      monthlyPercentUsed: monthlyPercent,
      status: this.calculateCurrentStatus(),
      isBlocked: this.config.isBlocked,
      blockedReason: this.config.blockedReason,
      spendByProvider,
      spendByModel,
      spendByTask,
      tokensSummary: {
        promptTokens,
        completionTokens,
        cachedTokens,
        reasoningTokens,
        totalTokens: promptTokens + completionTokens + reasoningTokens,
      },
      activeReservationsCount: this.reservations.size,
      totalCallsCount: this.usageRecords.length,
      nextDailyResetUtc: nextDailyResetUtc.toISOString(),
      nextDailyResetAr: nextDailyResetUtc.toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' }),
      nextMonthlyResetUtc: nextMonthlyResetUtc.toISOString(),
      nextMonthlyResetAr: nextMonthlyResetUtc.toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' }),
    };
  }
}
