import { EventEmitter } from 'events';
import { MarketCoordinator } from '../market/market-coordinator.js';
import { SignalStateMachine, SignalInstance } from './signal-state-machine.js';
import { TelegramNotifier } from '../notifications/telegram-notifier.js';
import { WebPushNotifier } from '../notifications/web-push-notifier.js';
import { DatabaseService } from '../storage/database.js';
import { Ticker, Candle } from '../types/market.js';
import { ConsensusResult } from '../ai/types.js';

export interface MarketMonitorOptions {
  coordinator: MarketCoordinator;
  stateMachine: SignalStateMachine;
  telegramNotifier: TelegramNotifier;
  webPushNotifier: WebPushNotifier;
  db: DatabaseService;
  maxSignalLifetimeMs?: number; // default 4 hours (14400000 ms)
  approachingZoneThresholdPcnt?: number; // default 0.25% (0.0025)
  inZoneThresholdPcnt?: number; // default 0.05% (0.0005)
}

export class MarketMonitorWorker extends EventEmitter {
  private coordinator: MarketCoordinator;
  private stateMachine: SignalStateMachine;
  private telegramNotifier: TelegramNotifier;
  private webPushNotifier: WebPushNotifier;
  private db: DatabaseService;
  private maxSignalLifetimeMs: number;
  private approachingZoneThresholdPcnt: number;
  private inZoneThresholdPcnt: number;
  private isRunning: boolean = false;
  private boundOnTicker: (ticker: Ticker) => void;
  private boundOnCandleClosed: (candle: Candle) => void;
  private boundOnSignalEvaluated: (result: ConsensusResult) => void;

  constructor(options: MarketMonitorOptions) {
    super();
    this.coordinator = options.coordinator;
    this.stateMachine = options.stateMachine;
    this.telegramNotifier = options.telegramNotifier;
    this.webPushNotifier = options.webPushNotifier;
    this.db = options.db;
    this.maxSignalLifetimeMs = options.maxSignalLifetimeMs || 4 * 60 * 60 * 1000;
    this.approachingZoneThresholdPcnt = options.approachingZoneThresholdPcnt || 0.0025;
    this.inZoneThresholdPcnt = options.inZoneThresholdPcnt || 0.0005;

    this.boundOnTicker = (t) => this.processTicker(t);
    this.boundOnCandleClosed = (c) => this.processCandleClosed(c);
    this.boundOnSignalEvaluated = (s) => this.processSignalEvaluated(s);
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    // Recover non-terminal signals from database
    const recovered = this.stateMachine.recoverActiveSignals();
    this.db.logEvent('INFO', 'MarketMonitor', `24/7 Monitor started. Recovered ${recovered} active signals from DB`);

    // Wire listeners
    this.coordinator.on('ticker_updated', this.boundOnTicker);
    this.coordinator.on('candle_closed', this.boundOnCandleClosed);
    this.coordinator.getConsensusEngine().on('signal_authorized', this.boundOnSignalEvaluated);

    this.emit('started');
  }

  public stop(): void {
    if (!this.isRunning) return;
    this.isRunning = false;

    this.coordinator.off('ticker_updated', this.boundOnTicker);
    this.coordinator.off('candle_closed', this.boundOnCandleClosed);
    this.coordinator.getConsensusEngine().off('signal_authorized', this.boundOnSignalEvaluated);

    this.db.logEvent('INFO', 'MarketMonitor', '24/7 Monitor stopped');
    this.emit('stopped');
  }

  public getStateMachine(): SignalStateMachine {
    return this.stateMachine;
  }

  public getTelegramNotifier(): TelegramNotifier {
    return this.telegramNotifier;
  }

  public getWebPushNotifier(): WebPushNotifier {
    return this.webPushNotifier;
  }

  private async processSignalEvaluated(consensus: ConsensusResult): Promise<void> {
    if (consensus.consensusVerdict !== 'AUTHORIZED') return;

    try {
      const signal = this.stateMachine.registerSignalFromConsensus(consensus);

      // Transition to ALERT_SENT
      if (signal.state === 'ENTRY_VALIDATED') {
        this.stateMachine.transition(signal.id, 'ALERT_SENT', 'Notificaciones emitidas');
      }

      // Send Telegram & Web Push asynchronously
      await Promise.all([
        this.telegramNotifier.notifySignalValidated(signal),
        this.webPushNotifier.notifySignalValidated(signal),
      ]);
    } catch (err: any) {
      this.db.logEvent('ERROR', 'MarketMonitor', `Error processing signal evaluation: ${err.message}`);
    }
  }

  private processTicker(ticker: Ticker): void {
    if (!this.isRunning) return;

    const marketState = this.coordinator.getMarketState();
    if (marketState.killSwitchActive) {
      this.stateMachine.cancelAll('KILL_SWITCH_ACTIVE');
      return;
    }

    const price = ticker.lastPrice;
    const activeSignals = this.stateMachine.getActiveSignals();

    for (const signal of activeSignals) {
      try {
        const state = signal.state;

        // 1. Check distance to entry zone (Approaching)
        if (state === 'ENTRY_VALIDATED' || state === 'ALERT_SENT') {
          const distPcnt = Math.abs(price - signal.entryPrice) / signal.entryPrice;
          if (distPcnt <= this.approachingZoneThresholdPcnt) {
            this.stateMachine.transition(signal.id, 'APPROACHING_ZONE', `Precio a ${(distPcnt * 100).toFixed(3)}% de entrada`);
            this.telegramNotifier.notifyApproachingZone(signal, price).catch(() => {});
          }
        }

        // 2. Check if reached in-zone
        if (signal.state === 'APPROACHING_ZONE') {
          const distPcnt = Math.abs(price - signal.entryPrice) / signal.entryPrice;
          if (distPcnt <= this.inZoneThresholdPcnt) {
            this.stateMachine.transition(signal.id, 'IN_ZONE', `Precio dentro de zona de entrada`);
            this.telegramNotifier.notifyInZone(signal, price).catch(() => {});
          }
        }

        // 3. Trigger fill (Simulated paper execution)
        if (['ALERT_SENT', 'ENTRY_VALIDATED', 'APPROACHING_ZONE', 'IN_ZONE'].includes(signal.state)) {
          let isFilled = false;
          if (signal.direction === 'LONG' && price <= signal.entryPrice && price > signal.stopLossPrice) {
            isFilled = true;
          } else if (signal.direction === 'SHORT' && price >= signal.entryPrice && price < signal.stopLossPrice) {
            isFilled = true;
          }

          if (isFilled) {
            this.stateMachine.transition(signal.id, 'ENTRY_TRIGGERED', `Precio tocó nivel de entrada $${signal.entryPrice}`);
            this.stateMachine.transition(signal.id, 'TRACKING', `Seguimiento de posición en curso`);
            this.telegramNotifier.notifyEntryTriggered(signal).catch(() => {});
          }
        }

        // 4. Position Tracking (MFE, MAE, TP, SL)
        if (signal.state === 'TRACKING') {
          this.stateMachine.updatePriceMetrics(signal.id, price);

          // Check Take Profit hit
          let tpHit = false;
          if (signal.direction === 'LONG' && price >= signal.takeProfitPrice) {
            tpHit = true;
          } else if (signal.direction === 'SHORT' && price <= signal.takeProfitPrice) {
            tpHit = true;
          }

          if (tpHit) {
            this.stateMachine.transition(signal.id, 'COMPLETED_TP', `Take Profit alcanzado en ${price.toFixed(2)}`, { executionPrice: price });
            this.telegramNotifier.notifyTakeProfitCompleted(signal).catch(() => {});
            this.webPushNotifier.notifyTakeProfit(signal).catch(() => {});
            continue;
          }

          // Check Stop Loss hit
          let slHit = false;
          if (signal.direction === 'LONG' && price <= signal.stopLossPrice) {
            slHit = true;
          } else if (signal.direction === 'SHORT' && price >= signal.stopLossPrice) {
            slHit = true;
          }

          if (slHit) {
            this.stateMachine.transition(signal.id, 'COMPLETED_SL', `Stop Loss alcanzado en ${price.toFixed(2)}`, { executionPrice: price });
            this.telegramNotifier.notifyStopLossCompleted(signal).catch(() => {});
            this.webPushNotifier.notifyStopLoss(signal).catch(() => {});
            continue;
          }
        }
      } catch (err: any) {
        this.db.logEvent('ERROR', 'MarketMonitor', `Error processing ticker for signal ${signal.id}: ${err.message}`);
      }
    }
  }

  private processCandleClosed(candle: Candle): void {
    if (!this.isRunning) return;

    const now = Date.now();
    const activeSignals = this.stateMachine.getActiveSignals();

    for (const signal of activeSignals) {
      try {
        // Expiration check: if signal was not filled within maxSignalLifetimeMs
        if (['ENTRY_VALIDATED', 'ALERT_SENT', 'APPROACHING_ZONE', 'IN_ZONE'].includes(signal.state)) {
          if (now - signal.createdAt > this.maxSignalLifetimeMs) {
            this.stateMachine.transition(
              signal.id,
              'EXPIRED',
              `Tiempo de espera excedido (${Math.round(this.maxSignalLifetimeMs / 3600000)}h)`
            );
            continue;
          }

          // Technical Invalidation check before entry
          let invalidated = false;
          if (signal.direction === 'LONG' && candle.close <= signal.stopLossPrice) {
            invalidated = true;
          } else if (signal.direction === 'SHORT' && candle.close >= signal.stopLossPrice) {
            invalidated = true;
          }

          if (invalidated) {
            this.stateMachine.transition(
              signal.id,
              'INVALIDATED',
              `Vela cerrada en ${candle.close} vulneró el Stop Loss antes de entrar`
            );
            this.telegramNotifier.notifyInvalidated(signal, `Vela cerrada vulneró el Stop Loss estructural`).catch(() => {});
            continue;
          }
        }
      } catch (err: any) {
        this.db.logEvent('ERROR', 'MarketMonitor', `Error processing candle close for signal ${signal.id}: ${err.message}`);
      }
    }
  }
}
