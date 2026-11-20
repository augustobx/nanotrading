import { EventEmitter } from 'events';
import { MarketCoordinator } from '../market/market-coordinator.js';
import { AiMarketDiscoveryEngine } from './ai-market-discovery.js';
import { HardBudgetManager } from './hard-budget-manager.js';
import { DatabaseService } from '../storage/database.js';
import { Candle } from '../types/market.js';

export interface DiscoverySchedulerConfig {
  enabled: boolean;
  intervalMinutes: number;
  triggerOn1hClose: boolean;
  triggerOn15mStructure: boolean;
  minPriceMovePct: number;
  minCooldownMinutes: number;
  updatedAt?: number;
}

export interface SchedulerStatus {
  enabled: boolean;
  isRunning: boolean;
  lastTriggerTimestamp: number | null;
  lastTriggerReason: string | null;
  lastTriggerPrice: number | null;
  nextScheduledRun: number | null;
  totalAutonomousRuns: number;
  totalScenariosFound: number;
}

export class AutonomousDiscoveryScheduler extends EventEmitter {
  private coordinator: MarketCoordinator;
  private discoveryEngine: AiMarketDiscoveryEngine;
  private hardBudgetManager: HardBudgetManager;
  private db: DatabaseService;
  private config: DiscoverySchedulerConfig;

  private isRunning: boolean = false;
  private timer: NodeJS.Timeout | null = null;
  private lastTriggerTimestamp: number | null = null;
  private lastTriggerReason: string | null = null;
  private lastTriggerPrice: number | null = null;
  private totalAutonomousRuns: number = 0;
  private totalScenariosFound: number = 0;

  constructor(options: {
    coordinator: MarketCoordinator;
    discoveryEngine: AiMarketDiscoveryEngine;
    hardBudgetManager: HardBudgetManager;
    db: DatabaseService;
  }) {
    super();
    this.coordinator = options.coordinator;
    this.discoveryEngine = options.discoveryEngine;
    this.hardBudgetManager = options.hardBudgetManager;
    this.db = options.db;
    this.config = this.db.getDiscoverySchedulerConfig();
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    // Listen to candle closes from coordinator
    this.coordinator.on('candle_closed', (candle: Candle) => {
      this.handleCandleClosed(candle);
    });

    // Listen to market state to monitor significant price moves
    this.coordinator.on('state_updated', (state) => {
      const price = state.ticker?.lastPrice;
      if (price) {
        this.handlePriceUpdate(price);
      }
    });

    // Start periodic interval timer
    this.startTimer();

    this.db.logEvent('INFO', 'DiscoveryScheduler', 'Autonomous AI Market Discovery Scheduler started', {
      config: this.config,
    });
  }

  public stop(): void {
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.db.logEvent('INFO', 'DiscoveryScheduler', 'Autonomous AI Market Discovery Scheduler stopped');
  }

  private startTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
    const intervalMs = Math.max(1, this.config.intervalMinutes) * 60 * 1000;
    this.timer = setInterval(() => {
      this.evaluatePeriodicTrigger();
    }, Math.min(intervalMs, 60000)); // Check at least once a minute
  }

  private handleCandleClosed(candle: Candle): void {
    if (!this.isRunning || !this.config.enabled) return;

    // Trigger on 1H candle close
    if (candle.timeframe === '1h' && this.config.triggerOn1hClose) {
      this.triggerDiscovery(`1H_CANDLE_CLOSED_${candle.timestamp}`, candle.close);
      return;
    }

    // Trigger on 15m candle close if structure break was detected
    if (candle.timeframe === '15m' && this.config.triggerOn15mStructure) {
      const setupEngine = this.coordinator.getSetupEngine();
      const analysis = setupEngine?.getAnalysis('15m');
      const breaks = analysis?.structure?.structureBreaks || [];
      const candleCount = this.coordinator.getCandleManager().getCandles('15m').length;
      const hasRecentBreak = breaks.some((b) => b.candleIndex >= candleCount - 2);
      if (hasRecentBreak) {
        this.triggerDiscovery('15M_STRUCTURE_SHIFT_BOS_CHOCH', candle.close);
        return;
      }
    }
  }

  private handlePriceUpdate(currentPrice: number): void {
    if (!this.isRunning || !this.config.enabled) return;
    if (!this.lastTriggerPrice) {
      this.lastTriggerPrice = currentPrice;
      return;
    }

    const priceMovePct = (Math.abs(currentPrice - this.lastTriggerPrice) / this.lastTriggerPrice) * 100;
    if (priceMovePct >= this.config.minPriceMovePct) {
      const now = Date.now();
      const cooldownMs = this.config.minCooldownMinutes * 60 * 1000;
      if (!this.lastTriggerTimestamp || now - this.lastTriggerTimestamp >= cooldownMs) {
        this.triggerDiscovery(`SIGNIFICANT_PRICE_MOVE_${priceMovePct.toFixed(2)}%`, currentPrice);
      }
    }
  }

  private evaluatePeriodicTrigger(): void {
    if (!this.isRunning || !this.config.enabled) return;
    const now = Date.now();
    const intervalMs = this.config.intervalMinutes * 60 * 1000;

    if (!this.lastTriggerTimestamp || now - this.lastTriggerTimestamp >= intervalMs) {
      const currentPrice = this.coordinator.getMarketState().ticker?.lastPrice || 0;
      this.triggerDiscovery('PERIODIC_SCHEDULED_DISCOVERY', currentPrice);
    }
  }

  public async triggerDiscovery(reason: string, currentPrice?: number): Promise<boolean> {
    const now = Date.now();
    const cooldownMs = this.config.minCooldownMinutes * 60 * 1000;

    // Cooldown check (unless forced)
    if (this.lastTriggerTimestamp && now - this.lastTriggerTimestamp < cooldownMs && !reason.startsWith('MANUAL')) {
      return false;
    }

    // Budget check
    if (this.hardBudgetManager.isBlocked()) {
      this.db.logEvent('WARN', 'DiscoveryScheduler', 'Autonomous discovery skipped: Budget limit blocked', {
        reason: this.hardBudgetManager.getBlockedReason(),
      });
      return false;
    }

    this.lastTriggerTimestamp = now;
    this.lastTriggerReason = reason;
    if (currentPrice) {
      this.lastTriggerPrice = currentPrice;
    }

    try {
      this.db.logEvent('INFO', 'DiscoveryScheduler', `Running autonomous market discovery. Reason: ${reason}`);
      const result = await this.discoveryEngine.runDiscovery();
      this.totalAutonomousRuns++;
      this.totalScenariosFound += result.scenarios.length;

      this.emit('discovery_executed', {
        reason,
        scenariosCount: result.scenarios.length,
        timestamp: now,
      });

      return true;
    } catch (err: any) {
      this.db.logEvent('ERROR', 'DiscoveryScheduler', `Autonomous discovery failed: ${err.message}`);
      return false;
    }
  }

  public getConfig(): DiscoverySchedulerConfig {
    return { ...this.config };
  }

  public updateConfig(newConfig: Partial<DiscoverySchedulerConfig>): DiscoverySchedulerConfig {
    this.config = {
      ...this.config,
      ...newConfig,
      updatedAt: Date.now(),
    };
    this.db.saveDiscoverySchedulerConfig(this.config);
    this.startTimer(); // Restart timer with new interval
    return { ...this.config };
  }

  public getStatus(): SchedulerStatus {
    const now = Date.now();
    const intervalMs = this.config.intervalMinutes * 60 * 1000;
    const nextRun = this.lastTriggerTimestamp
      ? this.lastTriggerTimestamp + intervalMs
      : now + intervalMs;

    return {
      enabled: this.config.enabled,
      isRunning: this.isRunning,
      lastTriggerTimestamp: this.lastTriggerTimestamp,
      lastTriggerReason: this.lastTriggerReason,
      lastTriggerPrice: this.lastTriggerPrice,
      nextScheduledRun: this.config.enabled ? nextRun : null,
      totalAutonomousRuns: this.totalAutonomousRuns,
      totalScenariosFound: this.totalScenariosFound,
    };
  }
}
