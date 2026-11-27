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
  activeWatchedScenarios: number;
  discoveryInFlight: boolean;
  providerFailureBackoffUntil: number | null;
  consecutiveProviderFailures: number;
  pendingNeutralBreakout: { price: number; confirmedAt: number } | null;
  lastBlockedTrigger: { code: string; timestamp: number } | null;
}

export class AutonomousDiscoveryScheduler extends EventEmitter {
  private coordinator: MarketCoordinator;
  private discoveryEngine: AiMarketDiscoveryEngine;
  private hardBudgetManager: HardBudgetManager;
  private db: DatabaseService;
  private config: DiscoverySchedulerConfig;
  private symbol: string;

  private isRunning: boolean = false;
  private timer: NodeJS.Timeout | null = null;
  private lastTriggerTimestamp: number | null = null;
  private lastTriggerReason: string | null = null;
  private lastTriggerPrice: number | null = null;
  private totalAutonomousRuns: number = 0;
  private totalScenariosFound: number = 0;
  private discoveryInFlight = false;
  private lastStructuralFingerprint: string | null = null;
  private consecutiveProviderFailures = 0;
  private providerFailureBackoffUntil: number | null = null;
  private lastBlockedLog: { code: string; timestamp: number; suppressed: number } | null = null;
  private pendingNeutralBreakout: { price: number; confirmedAt: number } | null = null;
  private readonly neutralBreakoutQueueLifetimeMs = 90 * 60 * 1000;

  private blocked(code: string, trigger: string): false {
    const now = Date.now();
    if (this.lastBlockedLog?.code === code && now - this.lastBlockedLog.timestamp < 15 * 60000) {
      this.lastBlockedLog.suppressed++;
      return false;
    }
    this.db.logEvent('INFO', 'DiscoveryScheduler', 'Discovery trigger blocked', {
      code, trigger, previous: this.lastBlockedLog,
    });
    this.lastBlockedLog = { code, timestamp: now, suppressed: 0 };
    return false;
  }
  private readonly candleHandler = (candle: Candle): void => this.handleCandleClosed(candle);
  private readonly stateHandler = (state: any): void => {
    const price = state.ticker?.lastPrice;
    if (Number.isFinite(price) && price > 0) this.handlePriceUpdate(price);
  };

  /**
   * Existing durable scenarios are the source of truth: a scheduled clock
   * must not spend tokens to rediscover zones already watched by the local
   * watcher. Manual discovery remains available, under the hard budget.
   */
  private structuralFingerprint(): string | null {
    const setup = this.coordinator.getSetupEngine?.();
    if (!setup) return null;
    const tf15 = setup.getAnalysis?.('15m');
    const tf1h = setup.getAnalysis?.('1h');
    if (!tf15 || !tf1h) return null;
    const recentBreak = (tf: any) => {
      const breaks = tf?.structure?.structureBreaks || [];
      const last = breaks[breaks.length - 1];
      return last ? `${last.type || ''}:${last.direction || ''}:${last.timestamp || last.candleIndex || ''}` : 'none';
    };
    // Exclude current price, candle timestamp and tick noise.
    return [tf15.trend, tf1h.trend, recentBreak(tf15), recentBreak(tf1h)].join('|');
  }

  private hasWatchableScenario(): boolean {
    const registry = this.coordinator.getScenarioRegistry?.();
    if (!registry) return false;
    const now = Date.now();
    const terminal = new Set(['EXPIRED', 'INVALIDATED', 'CANCELLED', 'COMPLETED', 'DISCARDED', 'SIGNAL_GENERATED']);
    return registry.getAllActive().some((sc) => {
      if (sc.direction === 'NEUTRAL' || sc.kind === 'NEUTRAL_OBSERVATION') return false;
      const expiry = sc.watchPlan?.expirationTimestamp || sc.validUntilTimestamp;
      return !terminal.has(sc.status) && Number.isFinite(expiry) && expiry > now;
    });
  }

  constructor(options: {
    coordinator: MarketCoordinator;
    discoveryEngine: AiMarketDiscoveryEngine;
    hardBudgetManager: HardBudgetManager;
    db: DatabaseService;
    symbol?: string;
  }) {
    super();
    this.coordinator = options.coordinator;
    this.discoveryEngine = options.discoveryEngine;
    this.hardBudgetManager = options.hardBudgetManager;
    this.db = options.db;
    this.symbol = options.symbol || 'BTCUSDT';
    this.config = this.db.getDiscoverySchedulerConfig(this.symbol);

  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    this.coordinator.on('candle_closed', this.candleHandler);
    this.coordinator.on('state_updated', this.stateHandler);

    // Start periodic interval timer
    this.startTimer();

    this.db.logEvent('INFO', 'DiscoveryScheduler', 'Autonomous AI Market Discovery Scheduler started', {
      config: this.config,
    });
  }

  public stop(): void {
    this.isRunning = false;
    this.coordinator.off('candle_closed', this.candleHandler);
    this.coordinator.off('state_updated', this.stateHandler);
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.db.logEvent('INFO', 'DiscoveryScheduler', 'Autonomous AI Market Discovery Scheduler stopped');
  }

  private startTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (!this.isRunning || !this.config.enabled) {
      return;
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

    // A confirmed neutral breakout is important enough to retry after a
    // cooldown/backoff, but not important enough to bypass hard budgets.
    if (this.pendingNeutralBreakout) {
      if (now - this.pendingNeutralBreakout.confirmedAt > this.neutralBreakoutQueueLifetimeMs) {
        this.db.logEvent('WARN', 'DiscoveryScheduler', 'Neutral breakout expired while awaiting discovery', {
          symbol: this.symbol, price: this.pendingNeutralBreakout.price,
        });
        this.pendingNeutralBreakout = null;
      } else {
        void this.triggerDiscovery('RANGE_BREAKOUT_FROM_NEUTRAL_WATCH',
          this.pendingNeutralBreakout.price);
        return;
      }
    }
    const intervalMs = this.config.intervalMinutes * 60 * 1000;

    if (!this.lastTriggerTimestamp || now - this.lastTriggerTimestamp >= intervalMs) {
      const currentPrice = this.coordinator.getMarketState().ticker?.lastPrice || 0;
      this.triggerDiscovery('PERIODIC_SCHEDULED_DISCOVERY', currentPrice);
    }
  }

  /** Coalesce confirmed breakouts without bypassing cooldown, provider backoff,
   * global budget or the existing active-directional-scenario guard. */
  public queueConfirmedNeutralBreakout(price: number): void {
    if (!Number.isFinite(price) || price <= 0) return;
    if (!this.pendingNeutralBreakout) {
      this.pendingNeutralBreakout = { price, confirmedAt: Date.now() };
      this.db.logEvent('INFO', 'DiscoveryScheduler', 'Confirmed neutral breakout queued for autonomous discovery', {
        symbol: this.symbol, price,
      });
    }
    void this.triggerDiscovery('RANGE_BREAKOUT_FROM_NEUTRAL_WATCH',
      this.pendingNeutralBreakout.price);
  }

  public async triggerDiscovery(reason: string, currentPrice?: number): Promise<boolean> {
    const now = Date.now();
    const isManual = reason.startsWith('MANUAL');
    const cooldownMs = Math.max(15, this.config.minCooldownMinutes) * 60 * 1000;

    if (this.discoveryInFlight) return false;
    if (!isManual && (!this.isRunning || !this.config.enabled)) return false;
    if (!isManual && this.providerFailureBackoffUntil && now < this.providerFailureBackoffUntil) {
      return this.blocked('PROVIDER_BACKOFF', reason);
    }
    if (!isManual && this.hasWatchableScenario()) {
      // The watcher is already monitoring a valid hypothesis at zero token cost.
      return this.blocked('DIRECTIONAL_SCENARIO_ACTIVE', reason);
    }
    // Even confirmed NEUTRAL breakouts must obey global autonomous cooldown.
    if (!isManual && this.lastTriggerTimestamp && now - this.lastTriggerTimestamp < cooldownMs) {
      return this.blocked('COOLDOWN', reason);
    }

    const fingerprint = this.structuralFingerprint();
    // The 60-minute timer is a health check, not a mandate to buy an analysis.
    // Only a newly confirmed structural regime, actual neutral breakout, a
    // manual request, or an infrequent 4h watchdog may justify another call.
    const significantMove = reason.startsWith('SIGNIFICANT_PRICE_MOVE') &&
      Number.isFinite(currentPrice) && !!this.lastTriggerPrice &&
      Math.abs(currentPrice! - this.lastTriggerPrice) / this.lastTriggerPrice * 100 >= this.config.minPriceMovePct;
    if (!isManual && !reason.startsWith('RANGE_BREAKOUT') && !significantMove &&
        fingerprint && fingerprint === this.lastStructuralFingerprint &&
        this.lastTriggerTimestamp && now - this.lastTriggerTimestamp < 4 * 3600000) {
      return this.blocked('STRUCTURE_UNCHANGED', reason);
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

    this.discoveryInFlight = true;
    try {
      this.db.logEvent('INFO', 'DiscoveryScheduler', `Running autonomous market discovery. Reason: ${reason}`);
      const triggerSource = reason.startsWith('MANUAL')
        ? 'MANUAL_TRIGGER'
        : (reason.startsWith('RANGE_BREAKOUT') ? 'NEUTRAL_BREAKOUT' : 'AUTOMATIC_SCHEDULER');
      const result = await this.discoveryEngine.runDiscovery({
        triggerSource,
        forceManual: reason.startsWith('MANUAL'),
      });
      if (result.skippedReason) {
        if (result.skippedReason === 'AI_PROVIDERS_FAILED_NO_VALID_ANALYSIS') {
          this.consecutiveProviderFailures++;
          const cooldown = Math.min(4 * 3600000,
            30 * 60000 * Math.pow(2, Math.min(3, this.consecutiveProviderFailures - 1)));
          this.providerFailureBackoffUntil = Date.now() + cooldown;
        }
        this.db.logEvent('INFO', 'DiscoveryScheduler', 'Discovery skipped without new scenarios', {
          reason: result.skippedReason, trigger: reason,
          retryNotBefore: this.providerFailureBackoffUntil,
        });
        return false;
      }
      this.consecutiveProviderFailures = 0;
      this.providerFailureBackoffUntil = null;
      // A completed discovery (even an explicit AI NO_TRADE) satisfies the
      // queued request; do not spend a second time on the same breakout.
      this.pendingNeutralBreakout = null;
      this.totalAutonomousRuns++;
      this.totalScenariosFound += result.scenarios.length;
      if (fingerprint) this.lastStructuralFingerprint = fingerprint;

      this.emit('discovery_executed', {
        reason,
        scenariosCount: result.scenarios.length,
        timestamp: now,
      });

      return true;
    } catch (err: any) {
      this.db.logEvent('ERROR', 'DiscoveryScheduler', `Autonomous discovery failed: ${err.message}`);
      return false;
    } finally {
      this.discoveryInFlight = false;
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
    this.db.saveDiscoverySchedulerConfig(this.config, this.symbol);
    if (this.isRunning && this.config.enabled) {
      this.startTimer(); // Restart timer with new interval
    } else if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
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
      activeWatchedScenarios: this.coordinator.getScenarioRegistry?.()?.getAllActive?.()
        .filter((sc) => {
          if (sc.direction === 'NEUTRAL' || sc.kind === 'NEUTRAL_OBSERVATION' ||
              sc.status === 'NO_TRADE_OBSERVATION') return false;
          const expiry = sc.watchPlan?.expirationTimestamp || sc.validUntilTimestamp;
          return Number.isFinite(expiry) && expiry > now &&
            !['COMPLETED', 'CANCELLED', 'EXPIRED', 'INVALIDATED', 'DISCARDED',
              'SIGNAL_GENERATED'].includes(sc.status);
        })
        .length || 0,
      discoveryInFlight: this.discoveryInFlight,
      providerFailureBackoffUntil: this.providerFailureBackoffUntil,
      consecutiveProviderFailures: this.consecutiveProviderFailures,
      pendingNeutralBreakout: this.pendingNeutralBreakout,
      lastBlockedTrigger: this.lastBlockedLog
        ? { code: this.lastBlockedLog.code, timestamp: this.lastBlockedLog.timestamp }
        : null,
    };
  }
}
