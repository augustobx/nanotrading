import { AiProvider } from './types.js';
import {
  getModelMetadata,
  calculateCallCost,
  DetailedTokenUsage,
  FreeTierGroup,
  OPENAI_FREE_TIER_LIMITS,
  getModelFreeTierGroup,
} from './models-catalog.js';
import { DatabaseService } from '../storage/database.js';

export type BudgetStatus = 'OK' | 'WARNING_50' | 'WARNING_80' | 'CRITICAL_95' | 'AI_BUDGET_EXCEEDED';

export type FreeTierVerificationStatus = 'UNVERIFIED' | 'DECLARED_BY_ADMIN' | 'CONFIRMED_BILLED';
export type FreeTierDiscountStatus = 'NONE' | 'ESTIMATED' | 'CONFIRMED_BILLED';

export interface OpenAiFreeTierConfig {
  enabled: boolean;                      // Proyecto participa en programa de tokens gratuitos (Data Sharing)
  verified: boolean;                     // Compatibilidad booleana (true si DECLARED o CONFIRMED)
  verificationStatus: FreeTierVerificationStatus; // 'UNVERIFIED' | 'DECLARED_BY_ADMIN' | 'CONFIRMED_BILLED'
  verifiedAt?: number | null;
  lastVerificationError?: string | null;
  mainGroupDailyLimitTokens: number;     // 250,000 tokens/día (gpt-4o, gpt-6-luna)
  smallGroupDailyLimitTokens: number;    // 2,500,000 tokens/día (gpt-5.4-mini, gpt-5.4-nano, gpt-5-mini, o4-mini, gpt-4o-mini)
  mainGroupModels?: string[];            // Lista configurable de modelos del grupo principal
  smallGroupModels?: string[];           // Lista configurable de modelos del grupo pequeño
  externalUsageBufferTokens: number;     // Reserva conservadora si se desconoce uso externo (default 5000)
  isGlobalUsageEstimated: boolean;       // Saldo estimado debido a cupo compartido en organización
  reconciledAt?: number | null;          // Timestamp de última conciliación organizacional
  reconciliationSource?: 'LOCAL_ESTIMATE' | 'OPENAI_USAGE_API' | 'ADMIN_DECLARATION';
  billingEvidenceDetails?: string | null;
  participatingOrganizationId?: string | null;
  dataSharingConsentConfirmed?: boolean;
}

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
  openaiFreeTier: OpenAiFreeTierConfig;
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
  openaiFreeTier: {
    enabled: boolean;
    verified: boolean;
    verificationStatus: FreeTierVerificationStatus;
    isGlobalUsageEstimated: boolean;
    externalUsageBufferTokens: number;
    verifiedAt: number | null;
    reconciledAt: number | null;
    reconciliationSource: 'LOCAL_ESTIMATE' | 'OPENAI_USAGE_API' | 'ADMIN_DECLARATION';
    billingEvidenceDetails: string | null;
    mainGroup: {
      limitTokens: number;
      usedTokens: number;
      remainingTokens: number;
      percentUsed: number;
      models: string[];
    };
    smallGroup: {
      limitTokens: number;
      usedTokens: number;
      remainingTokens: number;
      percentUsed: number;
      models: string[];
    };
    financialsToday: {
      grossSpendUsd: number;
      discountUsd: number;
      netSpendUsd: number;
      freeTokensConsumed: number;
      paidTokensConsumed: number;
      verifiedBilledSpendUsd: number | null;
      discountStatus: FreeTierDiscountStatus;
    };
  };
  activeReservationsCount: number;
  totalCallsCount: number;
  todayGrossSpendUsd: number;
  monthGrossSpendUsd: number;
  lastBudgetDenial: { code: string; reason: string; timestamp: number } | null;
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
  openaiFreeTier: {
    enabled: false,
    verified: false,
    verificationStatus: 'UNVERIFIED',
    verifiedAt: null,
    lastVerificationError: null,
    mainGroupDailyLimitTokens: OPENAI_FREE_TIER_LIMITS.MAIN_GROUP_DAILY_TOKENS,
    smallGroupDailyLimitTokens: OPENAI_FREE_TIER_LIMITS.SMALL_GROUP_DAILY_TOKENS,
    mainGroupModels: [...OPENAI_FREE_TIER_LIMITS.DEFAULT_MAIN_MODELS],
    smallGroupModels: [...OPENAI_FREE_TIER_LIMITS.DEFAULT_SMALL_MODELS],
    externalUsageBufferTokens: 5000,
    isGlobalUsageEstimated: true,
    reconciledAt: null,
    reconciliationSource: 'LOCAL_ESTIMATE',
    billingEvidenceDetails: null,
    participatingOrganizationId: null,
    dataSharingConsentConfirmed: false,
  },
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
  private lastBudgetDenial: { code: string; reason: string; timestamp: number } | null = null;
  private triggeredThresholds: Set<number> = new Set();
  private triggeredFreeTierThresholds: Set<string> = new Set();
  private lastResetDay: number = new Date().getUTCDate();
  private notifiers: NotifierCallbacks = {};
  private db?: DatabaseService;

  // Trackers diarios para grupos de tokens gratuitos (Data Sharing OpenAI)
  private mainGroupTokensUsedToday: number = 0;
  private smallGroupTokensUsedToday: number = 0;
  private grossSpendTodayUsd: number = 0;
  private discountTodayUsd: number = 0;
  private netSpendTodayUsd: number = 0;
  private freeTokensConsumedToday: number = 0;

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
    costGrossUsd?: number;
    discountUsd?: number;
    freeTierGroup?: FreeTierGroup;
    isFreeTier?: boolean;
    discountStatus?: FreeTierDiscountStatus;
  }> = [];

  constructor(initialConfig?: Partial<HardBudgetConfig>, notifiers?: NotifierCallbacks, db?: DatabaseService) {
    this.config = {
      ...DEFAULT_HARD_BUDGET_CONFIG,
      ...(initialConfig || {}),
      openaiFreeTier: {
        ...DEFAULT_HARD_BUDGET_CONFIG.openaiFreeTier,
        ...(initialConfig?.openaiFreeTier || {}),
      },
    };
    if (notifiers) {
      this.notifiers = notifiers;
    }
    this.db = db;
    if (this.db) {
      this.syncDailyUsageFromDatabase();
    }
  }

  public setDatabase(db: DatabaseService): void {
    this.db = db;
    this.syncDailyUsageFromDatabase();
  }

  public syncDailyUsageFromDatabase(): void {
    if (!this.db) return;
    try {
      const startOfDay = new Date();
      startOfDay.setUTCHours(0, 0, 0, 0);
      const usage = this.db.getFreeTierUsageToday(startOfDay.getTime());
      if (usage) {
        this.mainGroupTokensUsedToday = usage.mainGroupTokens || 0;
        this.smallGroupTokensUsedToday = usage.smallGroupTokens || 0;
        this.grossSpendTodayUsd = usage.grossSpendUsd || 0;
        this.discountTodayUsd = usage.discountUsd || 0;
        this.netSpendTodayUsd = usage.netSpendUsd || 0;
        this.freeTokensConsumedToday = usage.freeTokensCount || 0;
      }
    } catch {}
  }

  public setNotifiers(notifiers: NotifierCallbacks): void {
    this.notifiers = notifiers;
  }

  public getConfig(): HardBudgetConfig {
    return { ...this.config };
  }

  public isBlocked(): boolean {
    this.reconcileLegacyEstimateBlock();
    return this.config.isBlocked;
  }

  /** Legacy releases persisted an incorrect hard stop for a denied estimate.
   * Only repair that specific automatic block, not manual safety stops.
   */
  private reconcileLegacyEstimateBlock(): void {
    const reason = this.config.blockedReason || '';
    const dailyLegacy = /^Límite de presupuesto diario alcanzado \(\$[0-9.]+ \+ \$[0-9.]+ > \$[0-9.]+\)$/.test(reason);
    const monthlyLegacy = /^Límite de presupuesto mensual alcanzado \(\$[0-9.]+ > \$[0-9.]+\)$/.test(reason);
    const scope = dailyLegacy ? 'DAILY_GLOBAL' : monthlyLegacy ? 'MONTHLY_GLOBAL' : null;
    if (!this.config.isBlocked || !scope || !this.db) return;
    try {
      const start = new Date();
      if (scope === 'DAILY_GLOBAL') start.setUTCHours(0, 0, 0, 0);
      else { start.setUTCDate(1); start.setUTCHours(0, 0, 0, 0); }
      const spent = this.grossSpentSince(start.getTime());
      const limit = scope === 'DAILY_GLOBAL' ? this.config.dailyBudgetLimitUsd : this.config.monthlyBudgetLimitUsd;
      if (spent + this.getReservedPendingUsd() >= limit) return;
      this.config.isBlocked = false;
      this.config.blockedReason = null;
      this.config.updatedAt = Date.now();
      this.lastBudgetDenial = { code: scope, reason, timestamp: Date.now() };
      this.db.saveHardBudgetConfig(this.config);
      this.notifiers.logAudit?.('AI_BUDGET', 'REPAIR_PROSPECTIVE_BLOCK', {
        code: scope, grossSpentUsd: spent, limitUsd: limit,
      });
    } catch {
      // If the ledger cannot be verified, keep the stop active.
    }
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
      this.triggeredFreeTierThresholds.clear();
      this.mainGroupTokensUsedToday = 0;
      this.smallGroupTokensUsedToday = 0;
      this.grossSpendTodayUsd = 0;
      this.discountTodayUsd = 0;
      this.netSpendTodayUsd = 0;
      this.freeTokensConsumedToday = 0;
      // If blocked solely due to daily limit, auto-unblock on new day
      if (this.config.isBlocked && this.config.blockedReason?.includes('diario')) {
        this.config.isBlocked = false;
        this.config.blockedReason = null;
        this.config.updatedAt = Date.now();
      }
    }
  }

  /**
   * Returns the official Data Sharing Free Tier Group for a given model.
   */
  public getFreeTierGroup(model: string): FreeTierGroup {
    const cfg = this.config.openaiFreeTier;
    return getModelFreeTierGroup(model, {
      mainGroupModels: cfg?.mainGroupModels,
      smallGroupModels: cfg?.smallGroupModels,
    });
  }

  /**
   * Returns remaining daily free tokens for a given group.
   * applyBuffer: If true and global usage is estimated, reserves a conservative margin (externalUsageBufferTokens).
   */
  public getRemainingFreeTokens(group: FreeTierGroup, applyBuffer: boolean = false): number {
    this.checkPeriodReset();
    const cfg = this.config.openaiFreeTier;
    if (!cfg || !cfg.enabled || !cfg.verified || cfg.verificationStatus === 'UNVERIFIED') return 0;
    const buffer = (applyBuffer && cfg.isGlobalUsageEstimated) ? (cfg.externalUsageBufferTokens || 0) : 0;
    if (group === 'MAIN') {
      const remaining = cfg.mainGroupDailyLimitTokens - this.mainGroupTokensUsedToday;
      return Math.max(0, remaining - buffer);
    }
    if (group === 'SMALL') {
      const remaining = cfg.smallGroupDailyLimitTokens - this.smallGroupTokensUsedToday;
      return Math.max(0, remaining - buffer);
    }
    return 0;
  }

  /**
   * Evaluates OpenAI Free Tier eligibility and applies the Official Overage Rule:
   * "Considerar que una solicitud que supera el cupo disponible puede facturarse completamente."
   * Distinguishes:
   * - Model eligibility (isEligible)
   * - Project declared participation vs official billed verification
   * - Estimated discount (ESTIMATED) vs confirmed billed discount (CONFIRMED_BILLED)
   */
  public calculateFreeTierBenefit(
    model: string,
    totalTokens: number,
    grossCostUsd: number
  ): {
    group: FreeTierGroup;
    isEligible: boolean;
    isFree: boolean;
    discountStatus: FreeTierDiscountStatus;
    totalTokens: number;
    grossCostUsd: number;
    discountUsd: number;
    netCostUsd: number;
    reason: string;
  } {
    this.checkPeriodReset();
    const group = this.getFreeTierGroup(model);
    const meta = getModelMetadata(model);
    const cfg = this.config.openaiFreeTier;

    if (meta.provider !== 'OPENAI' || group === 'NONE') {
      return {
        group: 'NONE',
        isEligible: false,
        isFree: false,
        discountStatus: 'NONE',
        totalTokens,
        grossCostUsd,
        discountUsd: 0,
        netCostUsd: grossCostUsd,
        reason: meta.provider !== 'OPENAI' ? 'Proveedor no es OpenAI' : 'Modelo no elegible para tokens gratuitos',
      };
    }

    if (!cfg || !cfg.enabled) {
      return {
        group,
        isEligible: true,
        isFree: false,
        discountStatus: 'NONE',
        totalTokens,
        grossCostUsd,
        discountUsd: 0,
        netCostUsd: grossCostUsd,
        reason: 'Programa de tokens gratuitos de OpenAI no habilitado',
      };
    }

    if (!cfg.verified || cfg.verificationStatus !== 'CONFIRMED_BILLED') {
      // An administrator's declaration is not an actual invoice. Report a
      // possible discount, but enforce the budget against the full gross cost.
      return {
        group,
        isEligible: true,
        isFree: false,
        discountStatus: cfg.verificationStatus === 'DECLARED_BY_ADMIN' ? 'ESTIMATED' : 'NONE',
        totalTokens,
        grossCostUsd,
        discountUsd: 0,
        netCostUsd: grossCostUsd,
        reason: 'Descuento estimado sin facturación verificada: presupuestar costo bruto completo',
      };
    }

    const remaining = this.getRemainingFreeTokens(group);

    // Regla de Exceso Oficial: Si una solicitud supera el cupo remanente, se factura 100% como costo bruto
    if (totalTokens > remaining) {
      return {
        group,
        isEligible: true,
        isFree: false,
        discountStatus: 'NONE',
        totalTokens,
        grossCostUsd,
        discountUsd: 0,
        netCostUsd: grossCostUsd,
        reason: `Solicitud (${totalTokens.toLocaleString()} tokens) supera cupo gratuito remanente (${remaining.toLocaleString()} tokens). Se factura 100% según regla oficial.`,
      };
    }

    const discountStatus: FreeTierDiscountStatus =
      cfg.verificationStatus === 'CONFIRMED_BILLED' ? 'CONFIRMED_BILLED' : 'ESTIMATED';

    // Cumple con el cupo gratuito: 100% bonificado
    return {
      group,
      isEligible: true,
      isFree: true,
      discountStatus,
      totalTokens,
      grossCostUsd,
      discountUsd: grossCostUsd,
      netCostUsd: 0,
      reason: `Beneficio Data Sharing OpenAI aplicado (${discountStatus === 'CONFIRMED_BILLED' ? 'Confirmado en facturación' : 'Estimado por declaración administrativa'}): 100% bonificado (${group === 'MAIN' ? 'Grupo Principal' : 'Grupo Modelos Pequeños'}).`,
    };
  }

  /**
   * Checks thresholds (80%, 95%, 100%) for free tier groups.
   */
  public checkFreeTierThresholds(group: FreeTierGroup): void {
    if (group === 'NONE') return;
    const cfg = this.config.openaiFreeTier;
    if (!cfg || !cfg.enabled || !cfg.verified) return;

    const limit = group === 'MAIN' ? cfg.mainGroupDailyLimitTokens : cfg.smallGroupDailyLimitTokens;
    const used = group === 'MAIN' ? this.mainGroupTokensUsedToday : this.smallGroupTokensUsedToday;
    const percent = Math.min(100, (used / limit) * 100);
    const groupLabel = group === 'MAIN' ? 'Grupo Principal (250k)' : 'Grupo Modelos Pequeños (2.5M)';

    for (const threshold of [80, 95, 100]) {
      const key = `${group}_${threshold}`;
      if (percent >= threshold && !this.triggeredFreeTierThresholds.has(key)) {
        this.triggeredFreeTierThresholds.add(key);

        const severity = threshold === 100 ? 'CRITICAL' : threshold === 95 ? 'WARNING' : 'INFO';
        const title =
          threshold === 100
            ? `🛑 Cupo Gratuito OpenAI Agotado (100%) - ${groupLabel}`
            : `⚠️ Cupo Gratuito OpenAI al ${threshold}% - ${groupLabel}`;
        const msg =
          threshold === 100
            ? `Se han consumido ${used.toLocaleString()} de ${limit.toLocaleString()} tokens gratuitos diarios de OpenAI en el ${groupLabel}. Las siguientes solicitudes se facturarán contra el presupuesto diario monetario ($${this.config.dailyBudgetLimitUsd.toFixed(2)} USD).`
            : `El consumo de tokens gratuitos de OpenAI en el ${groupLabel} alcanzó el ${percent.toFixed(1)}% (${used.toLocaleString()} / ${limit.toLocaleString()} tokens).`;

        this.notifiers.sendTelegramAlert?.(title, msg, severity).catch(() => {});
        this.notifiers.sendWebPushAlert?.(title, msg).catch(() => {});
        this.notifiers.logAudit?.('OPENAI_FREE_TIER', `ALERT_${threshold}`, {
          group,
          percent: parseFloat(percent.toFixed(1)),
          usedTokens: used,
          limitTokens: limit,
        });
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

  /** Conservative gross spend, including previously discounted records. */
  private grossSpentSince(since: number, criteria: {
    provider?: string; model?: string; task?: string;
  } = {}): number {
    if (this.db) return this.db.getAiGrossSpendSince(since, criteria);
    return this.usageRecords.filter((r) => r.timestamp >= since &&
      (!criteria.provider || r.provider === criteria.provider) &&
      (!criteria.model || r.model === criteria.model) &&
      (!criteria.task || r.task === criteria.task))
      .reduce((sum, r) => sum + r.costUsd, 0);
  }

  /** Pending reservations for a single provider/model/task. */
  private pendingFor(criteria: { provider?: string; model?: string; task?: string }): number {
    let pending = 0;
    for (const res of this.reservations.values()) {
      if (res.status !== 'PENDING') continue;
      if (criteria.provider && res.provider !== criteria.provider) continue;
      if (criteria.model && res.model !== criteria.model) continue;
      if (criteria.task && res.task !== criteria.task) continue;
      pending += res.amountUsd;
    }
    return pending;
  }

  /**
   * Pre-call Atomic Budget Reservation.
   * Calculates worst-case cost and checks all limits (daily, monthly, provider, model, task).
   * Safeguard: Never assumes a request is free unless verified and within remaining quota.
   */
  public reserveBudget(params: {
    provider: AiProvider;
    model: string;
    task: string;
    maxEstimatedCostUsd?: number;
    estimatedTokens?: number;
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

    const estimatedGrossCost = params.maxEstimatedCostUsd ?? this.estimateWorstCaseCost(params.model);
    const estimatedTokens = params.estimatedTokens ?? 4000;

    // Hard limits always reserve FULL GROSS exposure, even when the provider
    // may later apply a promotion. Administrative claims are not invoices.
    const reservationAmount = estimatedGrossCost;
    const isEstimatedFree = false;
    if (!Number.isFinite(reservationAmount) || reservationAmount <= 0 ||
        !Number.isFinite(estimatedTokens) || estimatedTokens <= 0) {
      return {
        allowed: false, status: 'AI_BUDGET_EXCEEDED',
        reason: 'No se puede reservar una llamada con costo/tokens estimados inválidos',
        violatedLimit: 'UNKNOWN_COST',
      };
    }

    // 1. Max cost per request limit (checked against gross cost if paid)
    if (!isEstimatedFree && estimatedGrossCost > this.config.maxCostPerRequestUsd) {
      this.lastBudgetDenial = {
        code: 'MAX_PER_REQUEST',
        reason: `Próxima llamada requiere $${estimatedGrossCost.toFixed(4)}; máximo por solicitud $${this.config.maxCostPerRequestUsd.toFixed(4)} USD`,
        timestamp: Date.now(),
      };
      return {
        allowed: false,
        status: 'AI_BUDGET_EXCEEDED',
        reason: `Costo estimado de solicitud ($${estimatedGrossCost.toFixed(4)}) supera el máximo por petición configurado ($${this.config.maxCostPerRequestUsd.toFixed(4)})`,
        violatedLimit: 'MAX_PER_REQUEST',
      };
    }

    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const currentToday = this.grossSpentSince(todayStart.getTime());
    const currentMonth = this.grossSpentSince(monthStart.getTime());
    const currentPending = this.getReservedPendingUsd();

    // 2. Global daily limit
    if (!isEstimatedFree && currentToday + currentPending + reservationAmount > this.config.dailyBudgetLimitUsd) {
      const reason = `Solicitud requiere $${reservationAmount.toFixed(4)}; quedan $${Math.max(0, this.config.dailyBudgetLimitUsd - currentToday - currentPending).toFixed(4)} diarios (gasto bruto $${currentToday.toFixed(4)}, reservas $${currentPending.toFixed(4)})`;
      this.lastBudgetDenial = { code: 'DAILY_GLOBAL', reason, timestamp: Date.now() };
      return {
        allowed: false,
        status: 'AI_BUDGET_EXCEEDED',
        reason,
        violatedLimit: 'DAILY_GLOBAL',
      };
    }

    // 3. Global monthly limit
    if (!isEstimatedFree && currentMonth + currentPending + reservationAmount > this.config.monthlyBudgetLimitUsd) {
      const reason = `Solicitud requiere $${reservationAmount.toFixed(4)}; quedan $${Math.max(0, this.config.monthlyBudgetLimitUsd - currentMonth - currentPending).toFixed(4)} mensuales (gasto bruto $${currentMonth.toFixed(4)}, reservas $${currentPending.toFixed(4)})`;
      this.lastBudgetDenial = { code: 'MONTHLY_GLOBAL', reason, timestamp: Date.now() };
      return {
        allowed: false,
        status: 'AI_BUDGET_EXCEEDED',
        reason,
        violatedLimit: 'MONTHLY_GLOBAL',
      };
    }

    // 4. Provider specific limit (Gemini remains independent)
    if (!isEstimatedFree && this.config.providerLimitsUsd) {
      const provKey = params.provider.toLowerCase() as 'openai' | 'gemini';
      const provLimit = this.config.providerLimitsUsd[provKey];
      if (provLimit !== undefined) {
        const startOfDay = new Date();
        startOfDay.setUTCHours(0, 0, 0, 0);
        const provTodaySpend = this.grossSpentSince(startOfDay.getTime(),
          { provider: params.provider });
        if (provTodaySpend + this.pendingFor({ provider: params.provider }) +
            reservationAmount > provLimit) {
          this.lastBudgetDenial = {
            code: `PROVIDER_${params.provider}`,
            reason: `Proveedor ${params.provider}: bruto $${provTodaySpend.toFixed(4)}, solicitado $${reservationAmount.toFixed(4)}, máximo $${provLimit.toFixed(4)} USD`,
            timestamp: Date.now(),
          };
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
    if (!isEstimatedFree && this.config.modelLimitsUsd && this.config.modelLimitsUsd[params.model]) {
      const modelLimit = this.config.modelLimitsUsd[params.model];
      const startOfDay = new Date();
      startOfDay.setUTCHours(0, 0, 0, 0);
      const modelTodaySpend = this.grossSpentSince(startOfDay.getTime(),
        { model: params.model });
      if (modelTodaySpend + this.pendingFor({ model: params.model }) +
          reservationAmount > modelLimit) {
        this.lastBudgetDenial = {
          code: `MODEL_${params.model}`,
          reason: `Modelo ${params.model}: bruto $${modelTodaySpend.toFixed(4)}, solicitado $${reservationAmount.toFixed(4)}, máximo $${modelLimit.toFixed(4)} USD`,
          timestamp: Date.now(),
        };
        return {
          allowed: false,
          status: 'AI_BUDGET_EXCEEDED',
          reason: `Límite para modelo ${params.model} alcanzado ($${modelTodaySpend.toFixed(4)} >= $${modelLimit.toFixed(4)})`,
          violatedLimit: `MODEL_${params.model}`,
        };
      }
    }

    // 6. Task specific limit
    if (!isEstimatedFree && this.config.taskLimitsUsd && this.config.taskLimitsUsd[params.task]) {
      const taskLimit = this.config.taskLimitsUsd[params.task];
      const startOfDay = new Date();
      startOfDay.setUTCHours(0, 0, 0, 0);
      const taskTodaySpend = this.grossSpentSince(startOfDay.getTime(),
        { task: params.task });
      if (taskTodaySpend + this.pendingFor({ task: params.task }) +
          reservationAmount > taskLimit) {
        this.lastBudgetDenial = {
          code: `TASK_${params.task}`,
          reason: `Tarea ${params.task}: bruto $${taskTodaySpend.toFixed(4)}, solicitado $${reservationAmount.toFixed(4)}, máximo $${taskLimit.toFixed(4)} USD`,
          timestamp: Date.now(),
        };
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
      amountUsd: reservationAmount,
      provider: params.provider,
      model: params.model,
      task: params.task,
      timestamp: Date.now(),
      status: 'PENDING',
    });

    return {
      allowed: true,
      reservationId,
      reservedAmountUsd: reservationAmount,
      status: this.calculateCurrentStatus(),
    };
  }

  /**
   * Reconciles a completed call: releases reservation and logs actual usage with free tier benefit.
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
      analysisId?: string;
    }
  ): {
    grossCostUsd: number;
    discountUsd: number;
    netCostUsd: number;
    isFreeTier: boolean;
    freeTierGroup: FreeTierGroup;
    discountStatus: FreeTierDiscountStatus;
    benefitReason: string;
  } {
    const reservation = this.reservations.get(reservationId);
    this.reservations.delete(reservationId);

    const promptTokens = usage.promptTokens || 0;
    const completionTokens = usage.completionTokens || 0;
    const cachedTokens = usage.cachedTokens || 0;
    const reasoningTokens = usage.reasoningTokens || 0;
    // Completion count already includes OpenAI reasoning usage.
    const totalTokens = promptTokens + Math.max(completionTokens, reasoningTokens);

    let grossCost: number;
    if (usage.status === 'UNCERTAIN_TIMEOUT') {
      grossCost = usage.costUsd !== undefined ? usage.costUsd : (reservation?.amountUsd || 0);
    } else if (usage.status === 'ERROR' && promptTokens === 0 && completionTokens === 0) {
      grossCost = 0;
    } else {
      grossCost =
        usage.costUsd !== undefined
          ? usage.costUsd
          : calculateCallCost(usage.model, {
              promptTokens,
              completionTokens,
              cachedTokens,
              reasoningTokens,
            });
    }

    // Calculate OpenAI free tier benefit
    const benefit = this.calculateFreeTierBenefit(usage.model, totalTokens, grossCost);
    const netCost = benefit.netCostUsd;
    const discount = benefit.discountUsd;
    const isFree = benefit.isFree;

    if (isFree && benefit.group !== 'NONE') {
      if (benefit.group === 'MAIN') {
        this.mainGroupTokensUsedToday += totalTokens;
      } else if (benefit.group === 'SMALL') {
        this.smallGroupTokensUsedToday += totalTokens;
      }
      this.freeTokensConsumedToday += totalTokens;
      this.checkFreeTierThresholds(benefit.group);
    }

    this.grossSpendTodayUsd += grossCost;
    this.discountTodayUsd += discount;
    this.netSpendTodayUsd += netCost;

    this.recordDirectUsage(
      usage.provider,
      usage.model,
      usage.task,
      netCost,
      {
        prompt: promptTokens,
        completion: completionTokens,
        cached: cachedTokens,
        reasoning: reasoningTokens,
      },
      usage.status || 'SUCCESS',
      usage.latencyMs || 0,
      {
        grossCostUsd: grossCost,
        discountUsd: discount,
        freeTierGroup: benefit.group,
        isFreeTier: isFree,
        discountStatus: benefit.discountStatus,
      },
      usage.analysisId
    );

    return {
      grossCostUsd: grossCost,
      discountUsd: discount,
      netCostUsd: netCost,
      isFreeTier: isFree,
      freeTierGroup: benefit.group,
      discountStatus: benefit.discountStatus,
      benefitReason: benefit.reason,
    };
  }

  public releaseReservation(reservationId: string): void {
    this.reservations.delete(reservationId);
  }

  /**
   * Reconciles usage against OpenAI organization usage data or administrative declaration.
   * "El cupo gratuito pertenece a la organización."
   */
  public reconcileOrganizationalUsage(params: {
    mainGroupUsedTokens?: number;
    smallGroupUsedTokens?: number;
    source: 'OPENAI_USAGE_API' | 'ADMIN_DECLARATION' | 'LOCAL_ESTIMATE';
    evidenceDetails?: string;
    verifiedBilled?: boolean;
  }): void {
    if (params.mainGroupUsedTokens !== undefined && params.mainGroupUsedTokens >= 0) {
      this.mainGroupTokensUsedToday = Math.max(this.mainGroupTokensUsedToday, params.mainGroupUsedTokens);
    }
    if (params.smallGroupUsedTokens !== undefined && params.smallGroupUsedTokens >= 0) {
      this.smallGroupTokensUsedToday = Math.max(this.smallGroupTokensUsedToday, params.smallGroupUsedTokens);
    }
    const cfg = this.config.openaiFreeTier;
    if (cfg) {
      cfg.reconciledAt = Date.now();
      cfg.reconciliationSource = params.source;
      if (params.evidenceDetails) {
        cfg.billingEvidenceDetails = params.evidenceDetails;
      }
      if (params.verifiedBilled || params.source === 'OPENAI_USAGE_API') {
        cfg.verificationStatus = 'CONFIRMED_BILLED';
        cfg.verified = true;
        cfg.isGlobalUsageEstimated = false;
      } else if (params.source === 'ADMIN_DECLARATION') {
        cfg.verificationStatus = 'DECLARED_BY_ADMIN';
        cfg.verified = true;
        cfg.isGlobalUsageEstimated = true;
      }
      this.config.updatedAt = Date.now();
    }
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
    latencyMs: number = 0,
    freeTierMeta?: {
      grossCostUsd?: number;
      discountUsd?: number;
      freeTierGroup?: FreeTierGroup;
      isFreeTier?: boolean;
      discountStatus?: FreeTierDiscountStatus;
    },
    analysisId?: string
  ): void {
    const roundedCost = parseFloat(costUsd.toFixed(6));
    const grossCost = freeTierMeta?.grossCostUsd !== undefined ? freeTierMeta.grossCostUsd : roundedCost;
    const discount = freeTierMeta?.discountUsd !== undefined ? freeTierMeta.discountUsd : 0;
    const freeTierGroup = freeTierMeta?.freeTierGroup || 'NONE';
    const isFreeTier = freeTierMeta?.isFreeTier ?? false;
    const discountStatus: FreeTierDiscountStatus = freeTierMeta?.discountStatus || (isFreeTier ? 'ESTIMATED' : 'NONE');

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
      costGrossUsd: grossCost,
      discountUsd: discount,
      freeTierGroup,
      isFreeTier,
      discountStatus,
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
          tokensReasoning: record.reasoningTokens,
          costUsd: roundedCost,
          costGrossUsd: grossCost,
          discountUsd: discount,
          costNetUsd: roundedCost,
          freeTierGroup,
          isFreeTier,
          discountStatus,
          latencyMs,
          status,
          analysisId,
        });
      } catch (err: any) {
        this.triggerBlock('ERROR_CRITICO: No se pudo registrar consumo IA en la base de datos');
        throw new Error('Hard Budget: no se pudo persistir el consumo de IA (fail closed)');
      }
    }

    this.evaluateAlerts();
  }

  private calculateCurrentStatus(): BudgetStatus {
    if (this.isBlocked()) return 'AI_BUDGET_EXCEEDED';
    const day = new Date(); day.setUTCHours(0, 0, 0, 0);
    const today = this.grossSpentSince(day.getTime()) + this.getReservedPendingUsd();
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
    const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
    const todaySpend = this.grossSpentSince(dayStart.getTime()) + this.getReservedPendingUsd();
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

  public blockBudget(reason: string): void {
    this.triggerBlock(reason);
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
    const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
    const currentToday = this.grossSpentSince(dayStart.getTime()) + this.getReservedPendingUsd();
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
      openaiFreeTier: {
        ...this.config.openaiFreeTier,
        ...(updates.openaiFreeTier || {}),
      },
      updatedAt: Date.now(),
    };

    // Editing limits is not permission to clear an administrative hard stop.
    // Use the explicit, authenticated reactivateBudget operation instead.

    this.notifiers.logAudit?.('AI_BUDGET', 'UPDATE_CONFIG', {
      updates,
      updatedBy,
    });

    return this.getConfig();
  }

  public getSummary(): HardBudgetSummary {
    this.reconcileLegacyEstimateBlock();
    const todaySpend = this.getTodaySpendUsd();
    const monthSpend = this.getMonthSpendUsd();
    const reservedPending = this.getReservedPendingUsd();
    const day = new Date(); day.setUTCHours(0, 0, 0, 0);
    const month = new Date(); month.setUTCDate(1); month.setUTCHours(0, 0, 0, 0);
    const todayGrossSpend = this.grossSpentSince(day.getTime());
    const monthGrossSpend = this.grossSpentSince(month.getTime());
    const effectiveToday = todayGrossSpend + reservedPending;
    const effectiveMonth = monthGrossSpend + reservedPending;

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

    // Free tier summary metrics
    const cfg = this.config.openaiFreeTier;
    const mainLimit = cfg?.mainGroupDailyLimitTokens || OPENAI_FREE_TIER_LIMITS.MAIN_GROUP_DAILY_TOKENS;
    const smallLimit = cfg?.smallGroupDailyLimitTokens || OPENAI_FREE_TIER_LIMITS.SMALL_GROUP_DAILY_TOKENS;

    const mainUsed = this.mainGroupTokensUsedToday;
    const smallUsed = this.smallGroupTokensUsedToday;

    const mainRemaining = Math.max(0, mainLimit - mainUsed);
    const smallRemaining = Math.max(0, smallLimit - smallUsed);

    const mainPercent = Math.min(100, parseFloat(((mainUsed / mainLimit) * 100).toFixed(1)));
    const smallPercent = Math.min(100, parseFloat(((smallUsed / smallLimit) * 100).toFixed(1)));

    // Fetch stats from DB if available
    let grossSpendToday = this.grossSpendTodayUsd;
    let discountToday = this.discountTodayUsd;
    let netSpendToday = this.netSpendTodayUsd;
    let freeTokensToday = this.freeTokensConsumedToday;

    if (this.db) {
      try {
        const stats = this.db.getAiConsumptionStats();
        if (stats && stats.grossSpendTodayUsd !== undefined) {
          grossSpendToday = Number(stats.grossSpendTodayUsd);
          discountToday = Number(stats.discountTodayUsd);
          netSpendToday = Number(stats.netSpendTodayUsd);
          freeTokensToday = Number(stats.freeTokensToday);
        }
      } catch {}
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
      todayGrossSpendUsd: todayGrossSpend,
      monthGrossSpendUsd: monthGrossSpend,
      lastBudgetDenial: this.lastBudgetDenial,
      spendByProvider,
      spendByModel,
      spendByTask,
      tokensSummary: {
        promptTokens,
        completionTokens,
        cachedTokens,
        reasoningTokens,
        totalTokens: promptTokens + Math.max(completionTokens, reasoningTokens),
      },
      openaiFreeTier: {
        enabled: !!cfg?.enabled,
        verified: !!cfg?.verified,
        verificationStatus: cfg?.verificationStatus || (cfg?.verified ? 'CONFIRMED_BILLED' : 'UNVERIFIED'),
        isGlobalUsageEstimated: cfg?.isGlobalUsageEstimated ?? true,
        externalUsageBufferTokens: cfg?.externalUsageBufferTokens ?? 5000,
        verifiedAt: cfg?.verifiedAt || null,
        reconciledAt: cfg?.reconciledAt || null,
        reconciliationSource: cfg?.reconciliationSource || 'LOCAL_ESTIMATE',
        billingEvidenceDetails: cfg?.billingEvidenceDetails || null,
        mainGroup: {
          limitTokens: mainLimit,
          usedTokens: mainUsed,
          remainingTokens: mainRemaining,
          percentUsed: mainPercent,
          models: cfg?.mainGroupModels && cfg.mainGroupModels.length > 0 ? [...cfg.mainGroupModels] : [...OPENAI_FREE_TIER_LIMITS.DEFAULT_MAIN_MODELS],
        },
        smallGroup: {
          limitTokens: smallLimit,
          usedTokens: smallUsed,
          remainingTokens: smallRemaining,
          percentUsed: smallPercent,
          models: cfg?.smallGroupModels && cfg.smallGroupModels.length > 0 ? [...cfg.smallGroupModels] : [...OPENAI_FREE_TIER_LIMITS.DEFAULT_SMALL_MODELS],
        },
        financialsToday: {
          grossSpendUsd: parseFloat(grossSpendToday.toFixed(4)),
          discountUsd: parseFloat(discountToday.toFixed(4)),
          netSpendUsd: parseFloat(netSpendToday.toFixed(4)),
          freeTokensConsumed: freeTokensToday,
          paidTokensConsumed: Math.max(0, (promptTokens + Math.max(completionTokens, reasoningTokens)) - freeTokensToday),
          verifiedBilledSpendUsd: cfg?.verificationStatus === 'CONFIRMED_BILLED' ? parseFloat(netSpendToday.toFixed(4)) : null,
          discountStatus: cfg?.verificationStatus === 'CONFIRMED_BILLED' ? 'CONFIRMED_BILLED' : cfg?.verificationStatus === 'DECLARED_BY_ADMIN' ? 'ESTIMATED' : 'NONE',
        },
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
