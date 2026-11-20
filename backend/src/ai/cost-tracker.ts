import { calculateCallCost, getModelMetadata } from './models-catalog.js';
import { AiProvider } from './types.js';

export interface UsageRecord {
  id: string;
  provider: AiProvider;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
  timestamp: number;
}

export interface CostTrackerBudgetConfig {
  maxDailySpendUsd: number; // e.g. 5.0 USD
  maxMonthlySpendUsd: number; // e.g. 50.0 USD
}

export class CostTracker {
  private records: UsageRecord[] = [];
  private budget: CostTrackerBudgetConfig;
  private reservedSpendUsd: number = 0;

  constructor(budget: CostTrackerBudgetConfig = { maxDailySpendUsd: 5.0, maxMonthlySpendUsd: 50.0 }) {
    this.budget = budget;
  }

  public recordUsage(
    provider: AiProvider,
    model: string,
    promptTokens: number,
    completionTokens: number
  ): UsageRecord {
    const costUsd = calculateCallCost(model, promptTokens, completionTokens);
    const record: UsageRecord = {
      id: `usage_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      provider,
      model,
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      costUsd,
      timestamp: Date.now(),
    };

    this.records.push(record);
    return record;
  }

  public getDailySpendUsd(): number {
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const recent = this.records.filter((r) => r.timestamp >= oneDayAgo);
    const total = recent.reduce((sum, r) => sum + r.costUsd, 0);
    return parseFloat(total.toFixed(4));
  }

  public getMonthlySpendUsd(): number {
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const recent = this.records.filter((r) => r.timestamp >= thirtyDaysAgo);
    const total = recent.reduce((sum, r) => sum + r.costUsd, 0);
    return parseFloat(total.toFixed(4));
  }

  public canMakeCalls(estimatedCalls: number = 2, estimatedCostPerCall: number = 0.01): boolean {
    const expectedAdditionalSpend = estimatedCalls * estimatedCostPerCall;
    const currentDaily = this.getDailySpendUsd();
    const currentMonthly = this.getMonthlySpendUsd();

    if (currentDaily + this.reservedSpendUsd + expectedAdditionalSpend > this.budget.maxDailySpendUsd) {
      return false;
    }
    if (currentMonthly + this.reservedSpendUsd + expectedAdditionalSpend > this.budget.maxMonthlySpendUsd) {
      return false;
    }
    return true;
  }

  public reserveBudget(estimatedCalls: number = 2, estimatedCostPerCall: number = 0.01): boolean {
    const required = estimatedCalls * estimatedCostPerCall;
    const currentDaily = this.getDailySpendUsd();
    const currentMonthly = this.getMonthlySpendUsd();

    if (currentDaily + this.reservedSpendUsd + required > this.budget.maxDailySpendUsd) {
      return false;
    }
    if (currentMonthly + this.reservedSpendUsd + required > this.budget.maxMonthlySpendUsd) {
      return false;
    }
    this.reservedSpendUsd += required;
    return true;
  }

  public releaseReservation(estimatedCalls: number = 2, estimatedCostPerCall: number = 0.01): void {
    const amount = estimatedCalls * estimatedCostPerCall;
    this.reservedSpendUsd = Math.max(0, this.reservedSpendUsd - amount);
  }

  public getStats(): {
    dailySpendUsd: number;
    monthlySpendUsd: number;
    dailyBudgetUsd: number;
    monthlyBudgetUsd: number;
    dailyBudgetRemainingUsd: number;
    totalCalls: number;
    totalTokens: number;
    callsByProvider: Record<AiProvider, number>;
  } {
    const dailySpend = this.getDailySpendUsd();
    const monthlySpend = this.getMonthlySpendUsd();
    const totalTokens = this.records.reduce((sum, r) => sum + r.totalTokens, 0);

    const callsByProvider: Record<AiProvider, number> = {
      OPENAI: this.records.filter((r) => r.provider === 'OPENAI').length,
      GEMINI: this.records.filter((r) => r.provider === 'GEMINI').length,
    };

    return {
      dailySpendUsd: dailySpend,
      monthlySpendUsd: monthlySpend,
      dailyBudgetUsd: this.budget.maxDailySpendUsd,
      monthlyBudgetUsd: this.budget.maxMonthlySpendUsd,
      dailyBudgetRemainingUsd: Math.max(0, parseFloat((this.budget.maxDailySpendUsd - dailySpend).toFixed(4))),
      totalCalls: this.records.length,
      totalTokens,
      callsByProvider,
    };
  }

  public updateBudget(newBudget: Partial<CostTrackerBudgetConfig>): void {
    if (newBudget.maxDailySpendUsd !== undefined) this.budget.maxDailySpendUsd = newBudget.maxDailySpendUsd;
    if (newBudget.maxMonthlySpendUsd !== undefined) this.budget.maxMonthlySpendUsd = newBudget.maxMonthlySpendUsd;
  }
}
