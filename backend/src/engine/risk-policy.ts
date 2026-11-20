import { Timeframe } from '../types/market.js';
import { SetupCandidate } from './strategy-a-trend.js';
import { RiskCalculationResult } from './risk-calculator.js';

export interface SlCeilingOption {
  enabled: boolean;
  value: number;
}

export type RiskRewardTargetMode = 'RR_1_2' | 'RR_1_4' | 'RR_BOTH' | 'RR_PARTIAL';

export interface RiskPolicyConfig {
  id?: string;
  version: number;
  capitalUsdt: number;
  maxRiskPerTradePercent: number;
  maxRiskPerTradeUsdt: number;
  maxDailyLossPercent: number;
  maxDailyLossUsdt: number;
  maxWeeklyLossPercent: number;
  maxWeeklyLossUsdt: number;
  maxSimultaneousExposureUsdt: number;
  maxActiveSignals: number;
  maxDailyEntries: number;
  maxConsecutiveLosses: number;
  minNetRR: number;
  rrTargetMode: RiskRewardTargetMode;
  minRRShort: number;
  minRRExtended: number;
  partialClosePercent: number;
  stopLossCeilings: {
    maxSlDistancePercent: SlCeilingOption;
    maxSlDistanceUsdt: SlCeilingOption;
    maxSlDistanceAtrMultiplier: SlCeilingOption;
    maxMonetaryLossUsdt: SlCeilingOption;
  };
  marketRestrictions: {
    maxSpreadPercent: number;
    minAtrUsdt: number;
    maxAtrUsdt: number;
    maxDataStalenessMs: number;
    allowedSessions: string[];
    setupTtlMs: number;
  };
  updatedAt: number;
  updatedBy: string;
}

export const DEFAULT_RISK_POLICY: RiskPolicyConfig = {
  version: 1,
  capitalUsdt: 10000,
  maxRiskPerTradePercent: 0.5,
  maxRiskPerTradeUsdt: 50,
  maxDailyLossPercent: 1.5,
  maxDailyLossUsdt: 150,
  maxWeeklyLossPercent: 4.0,
  maxWeeklyLossUsdt: 400,
  maxSimultaneousExposureUsdt: 15000,
  maxActiveSignals: 3,
  maxDailyEntries: 5,
  maxConsecutiveLosses: 3,
  minNetRR: 4.0,
  rrTargetMode: 'RR_BOTH',
  minRRShort: 2.0,
  minRRExtended: 4.0,
  partialClosePercent: 50,
  stopLossCeilings: {
    maxSlDistancePercent: { enabled: true, value: 1.5 },
    maxSlDistanceUsdt: { enabled: true, value: 1000 },
    maxSlDistanceAtrMultiplier: { enabled: true, value: 3.0 },
    maxMonetaryLossUsdt: { enabled: true, value: 100 },
  },
  marketRestrictions: {
    maxSpreadPercent: 0.05,
    minAtrUsdt: 10,
    maxAtrUsdt: 450,
    maxDataStalenessMs: 10000,
    allowedSessions: ['ASIA', 'LONDON', 'NEW_YORK'],
    setupTtlMs: 1800000, // 30 mins
  },
  updatedAt: Date.now(),
  updatedBy: 'system_default',
};

export interface RiskEvaluationResult {
  passed: boolean;
  violations: string[];
  effectiveRiskUsdt: number;
  effectiveMaxDailyLossUsdt: number;
  effectiveMaxWeeklyLossUsdt: number;
  policySnapshot: RiskPolicyConfig;
}

export class RiskPolicyManager {
  private currentPolicy: RiskPolicyConfig;

  constructor(initialPolicy?: RiskPolicyConfig) {
    this.currentPolicy = initialPolicy ? { ...initialPolicy } : { ...DEFAULT_RISK_POLICY };
  }

  public getPolicy(): RiskPolicyConfig {
    return { ...this.currentPolicy };
  }

  public updatePolicy(updates: Partial<RiskPolicyConfig>, updatedBy: string = 'admin'): RiskPolicyConfig {
    // Strict validations
    if (updates.minNetRR !== undefined && updates.minNetRR < 4.0) {
      throw new Error('El ratio riesgo/beneficio mínimo no puede ser menor a 1:4.0 (Regla fundamental NanoLabs)');
    }
    if (updates.capitalUsdt !== undefined && updates.capitalUsdt <= 0) {
      throw new Error('El capital operativo debe ser mayor a 0 USDT');
    }
    if (updates.maxRiskPerTradePercent !== undefined && (updates.maxRiskPerTradePercent <= 0 || updates.maxRiskPerTradePercent > 5)) {
      throw new Error('El riesgo porcentual por operación debe estar entre 0.01% y 5%');
    }
    if (updates.maxRiskPerTradeUsdt !== undefined && updates.maxRiskPerTradeUsdt <= 0) {
      throw new Error('El riesgo monetario por operación debe ser mayor a 0 USDT');
    }

    const newVersion = (this.currentPolicy.version || 1) + 1;
    this.currentPolicy = {
      ...this.currentPolicy,
      ...updates,
      stopLossCeilings: {
        ...this.currentPolicy.stopLossCeilings,
        ...(updates.stopLossCeilings || {}),
      },
      marketRestrictions: {
        ...this.currentPolicy.marketRestrictions,
        ...(updates.marketRestrictions || {}),
      },
      version: newVersion,
      updatedAt: Date.now(),
      updatedBy,
    };

    return this.getPolicy();
  }

  /**
   * Evaluates a candidate setup against the active risk policy and SL ceilings.
   * "Si un setup necesita un Stop Loss estructural mayor al máximo configurado, debe descartarse.
   * Nunca acercar artificialmente el SL para hacer entrar la operación en el límite."
   */
  public evaluateSetupRisk(
    setup: SetupCandidate,
    atr15m: number = 50,
    currentSpreadPcnt: number = 0.0003,
    activeSignalsCount: number = 0,
    todayEntriesCount: number = 0,
    consecutiveLossesCount: number = 0
  ): RiskEvaluationResult {
    const violations: string[] = [];
    const policy = this.getPolicy();

    // 1. Most restrictive risk calculation
    const riskByPercentUsdt = (policy.capitalUsdt * policy.maxRiskPerTradePercent) / 100;
    const effectiveRiskUsdt = Math.min(riskByPercentUsdt, policy.maxRiskPerTradeUsdt);
    const effectiveMaxDailyLossUsdt = Math.min((policy.capitalUsdt * policy.maxDailyLossPercent) / 100, policy.maxDailyLossUsdt);
    const effectiveMaxWeeklyLossUsdt = Math.min((policy.capitalUsdt * policy.maxWeeklyLossPercent) / 100, policy.maxWeeklyLossUsdt);

    // 2. Strict R:R Gate
    const netRR = setup.riskReward?.netRR ?? 0;
    if (netRR < policy.minNetRR) {
      violations.push(`R:R neto insuficiente: 1:${netRR.toFixed(2)} < 1:${policy.minNetRR.toFixed(2)} requerido`);
    }

    // 3. Stop Loss Ceilings Enforcement
    const slDistanceUsdt = Math.abs(setup.entryPrice - setup.stopLossPrice);
    const slDistancePercent = (slDistanceUsdt / setup.entryPrice) * 100;

    const { maxSlDistancePercent, maxSlDistanceUsdt, maxSlDistanceAtrMultiplier, maxMonetaryLossUsdt } = policy.stopLossCeilings;

    if (maxSlDistancePercent.enabled && slDistancePercent > maxSlDistancePercent.value) {
      violations.push(
        `Distancia de SL en porcentaje superada (${slDistancePercent.toFixed(2)}% > máx ${maxSlDistancePercent.value}%) - Setup descartado estructuralmente`
      );
    }

    if (maxSlDistanceUsdt.enabled && slDistanceUsdt > maxSlDistanceUsdt.value) {
      violations.push(
        `Distancia de SL en USDT superada ($${slDistanceUsdt.toFixed(1)} > máx $${maxSlDistanceUsdt.value}) - Setup descartado estructuralmente`
      );
    }

    if (maxSlDistanceAtrMultiplier.enabled && atr15m > 0) {
      const slAtrMultiple = slDistanceUsdt / atr15m;
      if (slAtrMultiple > maxSlDistanceAtrMultiplier.value) {
        violations.push(
          `Distancia de SL en múltiplos de ATR superada (${slAtrMultiple.toFixed(2)}x ATR > máx ${maxSlDistanceAtrMultiplier.value}x ATR) - Setup descartado`
        );
      }
    }

    if (maxMonetaryLossUsdt.enabled && setup.riskReward?.netLossUSDT) {
      if (setup.riskReward.netLossUSDT > maxMonetaryLossUsdt.value) {
        violations.push(
          `Pérdida monetaria estimada en SL supera el límite ($${setup.riskReward.netLossUSDT.toFixed(2)} > máx $${maxMonetaryLossUsdt.value})`
        );
      }
    }

    // 4. Market & Exposure Constraints
    if (currentSpreadPcnt > policy.marketRestrictions.maxSpreadPercent) {
      violations.push(`Spread actual (${currentSpreadPcnt.toFixed(4)}%) supera el máximo permitido (${policy.marketRestrictions.maxSpreadPercent}%)`);
    }

    if (atr15m < policy.marketRestrictions.minAtrUsdt || atr15m > policy.marketRestrictions.maxAtrUsdt) {
      violations.push(`Volatilidad ATR ($${atr15m.toFixed(1)}) fuera del rango permitido [$${policy.marketRestrictions.minAtrUsdt} - $${policy.marketRestrictions.maxAtrUsdt}]`);
    }

    if (activeSignalsCount >= policy.maxActiveSignals) {
      violations.push(`Límite de señales activas simultáneas alcanzado (${activeSignalsCount} >= ${policy.maxActiveSignals})`);
    }

    if (todayEntriesCount >= policy.maxDailyEntries) {
      violations.push(`Límite de entradas diarias alcanzado (${todayEntriesCount} >= ${policy.maxDailyEntries})`);
    }

    if (consecutiveLossesCount >= policy.maxConsecutiveLosses) {
      violations.push(`Límite de pérdidas consecutivas alcanzado (${consecutiveLossesCount} >= ${policy.maxConsecutiveLosses}) - Bloqueo de seguridad preventivo`);
    }

    return {
      passed: violations.length === 0,
      violations,
      effectiveRiskUsdt,
      effectiveMaxDailyLossUsdt,
      effectiveMaxWeeklyLossUsdt,
      policySnapshot: policy,
    };
  }
}
