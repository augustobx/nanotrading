import { EventEmitter } from 'events';
import { MarketCoordinator } from '../market/market-coordinator.js';
import { ScenarioRegistry } from './scenario-registry.js';
import { TelegramNotifier } from '../notifications/telegram-notifier.js';
import { WebPushNotifier } from '../notifications/web-push-notifier.js';
import { Scenario, WatchCondition, AiWatchPlan } from '../ai/scenario-types.js';

export interface WatcherOptions {
  approachThresholdPct?: number; // default 0.35%
}

export class AlgorithmicWatcher extends EventEmitter {
  private coordinator: MarketCoordinator;
  private scenarioRegistry: ScenarioRegistry;
  private telegramNotifier?: TelegramNotifier;
  private webPushNotifier?: WebPushNotifier;
  private approachThresholdPct: number;
  private isRunning: boolean = false;
  private lastAlertTimestamps: Map<string, number> = new Map();

  constructor(
    coordinator: MarketCoordinator,
    scenarioRegistry: ScenarioRegistry,
    telegramNotifier?: TelegramNotifier,
    webPushNotifier?: WebPushNotifier,
    options: WatcherOptions = {}
  ) {
    super();
    this.coordinator = coordinator;
    this.scenarioRegistry = scenarioRegistry;
    this.telegramNotifier = telegramNotifier;
    this.webPushNotifier = webPushNotifier;
    this.approachThresholdPct = options.approachThresholdPct ?? 0.35;
  }

  private readonly onStateUpdated = (state: any): void => {
    if (this.isRunning && state.ticker?.lastPrice) {
      this.evaluateTick(state.ticker.lastPrice, state.ticker.spreadPcnt);
    }
  };
  private readonly onCandleClosed = (candle: any): void => {
    if (this.isRunning) this.evaluateCandleClose(candle);
  };

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.coordinator.on('state_updated', this.onStateUpdated);
    this.coordinator.on('candle_closed', this.onCandleClosed);
  }

  public stop(): void {
    if (!this.isRunning) return;
    this.isRunning = false;
    this.coordinator.off('state_updated', this.onStateUpdated);
    this.coordinator.off('candle_closed', this.onCandleClosed);
  }

  public evaluateTick(currentPrice: number, spreadPcnt: number = 0.001): void {
    const inactiveStatuses = ['EXPIRED', 'INVALIDATED', 'CANCELLED', 'COMPLETED', 'DISCARDED'];
    const activeScenarios = this.scenarioRegistry.getAllActive().filter((s) => !inactiveStatuses.includes(s.status));
    if (activeScenarios.length === 0) return;

    const now = Date.now();

    for (const sc of activeScenarios) {
      // 1. Expiration check
      const validUntil = sc.watchPlan?.expirationTimestamp || sc.validUntilTimestamp;
      if (now > validUntil) {
        this.scenarioRegistry.transitionStatus(
          sc.id,
          'EXPIRED',
          'Vigencia temporal agotada sin mitigación de la zona o cumplimiento de condiciones',
          { currentPrice }
        );
        if (sc.watchPlan) {
          sc.watchPlan.status = 'EXPIRED';
        }
        this.emit('scenario_expired', { scenarioId: sc.id, reason: 'EXPIRED_TIME' });
        continue;
      }

      // NEUTRAL is a market observation, not a trade or tick-level breakout.
      // Wait for an explicit matching CLOSED candle in evaluateCandleClose.
      if (sc.kind === 'NEUTRAL_OBSERVATION' || sc.direction === 'NEUTRAL') {
        continue;
      }

      // 3. Invalidation conditions check (Structured Plan or Default Stop Loss)
      let isInvalidated = false;
      let invalidationReason = '';

      if (sc.watchPlan?.invalidationConditions && sc.watchPlan.invalidationConditions.length > 0) {
        for (const invCond of sc.watchPlan.invalidationConditions) {
          if (this.evaluateCondition(invCond, currentPrice, spreadPcnt, undefined, sc.discoveryTimestamp)) {
            isInvalidated = true;
            invalidationReason = invCond.description;
            invCond.isMet = true;
            invCond.metTimestamp = now;
            break;
          }
        }
      }

      // Fallback structural check if not already triggered
      if (!isInvalidated) {
        const isLong = sc.direction === 'LONG';
        if (isLong && currentPrice <= sc.stopLossPrice) {
          isInvalidated = true;
          invalidationReason = `Stop Loss estructural vulnerado (${currentPrice.toFixed(1)} <= SL ${sc.stopLossPrice.toFixed(1)})`;
        } else if (!isLong && sc.direction === 'SHORT' && currentPrice >= sc.stopLossPrice) {
          isInvalidated = true;
          invalidationReason = `Stop Loss estructural vulnerado (${currentPrice.toFixed(1)} >= SL ${sc.stopLossPrice.toFixed(1)})`;
        }
      }

      if (isInvalidated) {
        this.scenarioRegistry.transitionStatus(sc.id, 'INVALIDATED', invalidationReason, { currentPrice });
        if (sc.watchPlan) {
          sc.watchPlan.status = 'INVALIDATED';
        }
        this.notifyCancelled(sc, invalidationReason);
        this.emit('scenario_invalidated', { scenarioId: sc.id, reason: invalidationReason });
        continue;
      }

      // 4. Evaluate Observable Conditions in Strict Sequential Order (1 -> 2 -> 3...)
      let allRequiredConditionsMet = true;
      if (sc.watchPlan?.observableConditions && sc.watchPlan.observableConditions.length > 0) {
        const sortedConditions = [...sc.watchPlan.observableConditions].sort(
          (a, b) => (a.sequenceOrder || 1) - (b.sequenceOrder || 1)
        );
        let sequenceBlocked = false;
        let previousStepMetTimestamp: number | undefined = undefined;

        for (const cond of sortedConditions) {
          if (cond.isMet) {
            previousStepMetTimestamp = cond.metTimestamp;
            continue;
          }
          if (sequenceBlocked) {
            allRequiredConditionsMet = false;
            continue;
          }

          // Check step timeout if previous step completed
          if (previousStepMetTimestamp && cond.params.maxStepDurationMs) {
            if (now - previousStepMetTimestamp > cond.params.maxStepDurationMs) {
              isInvalidated = true;
              invalidationReason = `Tiempo máximo entre pasos de confirmación excedido (${Math.round((now - previousStepMetTimestamp) / 60000)}m > ${Math.round(cond.params.maxStepDurationMs / 60000)}m)`;
              break;
            }
          }

          if (cond.automatable) {
            const conditionMet = this.evaluateCondition(cond, currentPrice, spreadPcnt, undefined, sc.discoveryTimestamp, previousStepMetTimestamp);
            if (conditionMet) {
              cond.isMet = true;
              cond.metTimestamp = now;
              previousStepMetTimestamp = now;
            } else {
              allRequiredConditionsMet = false;
              sequenceBlocked = true; // Subsequent sequence steps cannot be fulfilled yet
            }
          } else {
            allRequiredConditionsMet = false;
            sequenceBlocked = true;
          }
        }
      }

      // 5. Distance to entry zone calculation
      const { inZone, distPct } = this.calculateDistance(sc, currentPrice);

      // Update tracked metrics on scenario
      // Avoid a SQLite write for every WebSocket tick. State transitions are
      // still persisted immediately; live ticker remains available via Bybit.
      if (!sc.lastCheckedTimestamp || now - sc.lastCheckedTimestamp >= 10000 ||
          Math.abs(distPct - (sc.distanceToZonePct ?? distPct)) >= 0.1) {
        this.scenarioRegistry.updateMetrics(sc.id, {
          distanceToZonePct: distPct,
          currentPrice,
          lastCheckedTimestamp: now,
        });
      }

      // 6. In Zone Trigger
      if (inZone) {
        // If plan has non-automatable conditions, do not auto-approve entry; flag waiting confirmation
        if (sc.watchPlan && !sc.watchPlan.automatable) {
          if (sc.status !== 'WAITING_CONFIRMATION') {
            const reason = `El plan contiene condiciones no automatizables (${(sc.watchPlan.nonAutomatableConditions || []).join(', ')}). Esperando confirmación discrecional.`;
            this.scenarioRegistry.transitionStatus(sc.id, 'WAITING_CONFIRMATION', reason, { currentPrice });
          }
          continue;
        }

        // For automatable plans: all required conditions must be satisfied in sequential order
        if (!allRequiredConditionsMet && (sc.watchPlan?.observableConditions?.length || 0) > 0) {
          // Conditions are still pending in sequence, remain in monitoring
          continue;
        }

        if (sc.status !== 'IN_ZONE' && sc.status !== 'REVALIDATION_REQUESTED' && sc.status !== 'AI_REVALIDATING' && sc.status !== 'ENTRY_VALIDATED' && sc.status !== 'WAITING_CONFIRMATION') {
          const triggerReason = inZone
            ? `Precio alcanzó la zona operativa [${sc.entryZoneMin} - ${sc.entryZoneMax}]`
            : `Condiciones observables del AI_WATCH_PLAN satisfechas en secuencia`;

          this.scenarioRegistry.transitionStatus(
            sc.id,
            'IN_ZONE',
            triggerReason,
            { currentPrice, distPct }
          );

          this.scenarioRegistry.transitionStatus(
            sc.id,
            'REVALIDATION_REQUESTED',
            'Iniciando reevaluación inteligente con OpenAI y Gemini ante activación del plan',
            { currentPrice }
          );

          if (sc.watchPlan) {
            sc.watchPlan.status = 'TRIGGERED';
          }

          this.notifyInZone(sc, currentPrice);
          this.emit('revalidation_requested', {
            scenario: sc,
            watchPlan: sc.watchPlan,
            currentPrice,
            triggerReason,
          });
        }
        continue;
      }

      // 7. Approaching Zone Trigger
      if (distPct <= this.approachThresholdPct) {
        if (sc.status === 'SCENARIO_REGISTERED' || sc.status === 'SCENARIO_MONITORING') {
          this.scenarioRegistry.transitionStatus(
            sc.id,
            'APPROACHING_ZONE',
            `Precio a ${distPct.toFixed(2)}% de la zona (umbral <= ${this.approachThresholdPct}%)`,
            { currentPrice, distPct }
          );
          this.notifyApproaching(sc, currentPrice, distPct);
          this.emit('scenario_approaching', { scenario: sc, currentPrice, distPct });
        }
      } else {
        // If price moved back away from approaching zone
        if (sc.status === 'APPROACHING_ZONE' && distPct > this.approachThresholdPct * 1.5) {
          this.scenarioRegistry.transitionStatus(
            sc.id,
            'SCENARIO_MONITORING',
            `Precio se alejó de la zona (${distPct.toFixed(2)}%)`,
            { currentPrice, distPct }
          );
        }
      }
    }
  }

  /**
   * A neutral breakout must have meaningful relative volume. Claims in the
   * AI plan are not evidence: verify against >= 10 historical closed candles.
   */
  private hasConfirmedNeutralVolume(candle: any, timeframe: string): boolean {
    const recent = this.coordinator.getCandleManager?.()?.getCandles(timeframe as any, 30) || [];
    const prior = recent.filter((c: any) =>
      c.confirmed !== false && Number.isFinite(c.timestamp) && c.timestamp < candle.timestamp &&
      Number.isFinite(c.volume) && c.volume > 0
    ).slice(-20);
    if (prior.length < 10 || !Number.isFinite(candle.volume) || candle.volume <= 0) return false;
    const avg = prior.reduce((sum: number, c: any) => sum + c.volume, 0) / prior.length;
    return avg > 0 && candle.volume / avg >= 1.2;
  }

  public evaluateCandleClose(candle: any): void {
    if (!candle || candle.confirmed !== true || !Number.isFinite(candle.close)) return;
    const inactiveStatuses = ['EXPIRED', 'INVALIDATED', 'CANCELLED', 'COMPLETED', 'DISCARDED'];
    const activeScenarios = this.scenarioRegistry.getAllActive().filter((s) => !inactiveStatuses.includes(s.status));
    if (activeScenarios.length === 0) return;

    const now = Date.now();
    let neutralBreakout: { price: number; reason: string } | null = null;

    for (const sc of activeScenarios) {
      // 1. NEUTRAL_OBSERVATION check on candle close
      if (sc.kind === 'NEUTRAL_OBSERVATION' || sc.direction === 'NEUTRAL') {
        if (candle.timeframe !== sc.timeframe ||
            !Number.isFinite(candle.timestamp) ||
            candle.timestamp < sc.discoveryTimestamp) continue;
        if (!Number.isFinite(sc.entryZoneMin) || !Number.isFinite(sc.entryZoneMax) ||
            sc.entryZoneMin <= 0 || sc.entryZoneMax <= sc.entryZoneMin ||
            !this.hasConfirmedNeutralVolume(candle, sc.timeframe)) continue;
        let breakoutOccurred = false;
        let breakoutReason = '';

        if (sc.entryZoneMax > 0 && candle.close > sc.entryZoneMax) {
          breakoutOccurred = true;
          breakoutReason = `Ruptura confirmada de rango neutral en vela cerrada: precio $${candle.close.toFixed(1)} superó techo $${sc.entryZoneMax.toFixed(1)}`;
        } else if (sc.entryZoneMin > 0 && candle.close < sc.entryZoneMin) {
          breakoutOccurred = true;
          breakoutReason = `Ruptura confirmada de rango neutral en vela cerrada: precio $${candle.close.toFixed(1)} perforó piso $${sc.entryZoneMin.toFixed(1)}`;
        }

        if (breakoutOccurred) {
          this.scenarioRegistry.transitionStatus(
            sc.id,
            'COMPLETED',
            `${breakoutReason}. Ruptura confirmada: solicitando nuevo descubrimiento de IA.`,
            { currentPrice: candle.close }
          );
          if (sc.watchPlan) {
            sc.watchPlan.status = 'COMPLETED';
          }
          this.emit('neutral_range_breakout', { scenario: sc, breakoutPrice: candle.close, reason: breakoutReason });
          // Multiple overlapping neutral watches in the same candle must not
          // individually charge the AI. One coalesced scheduler request only.
          if (!neutralBreakout) neutralBreakout = { price: candle.close, reason: breakoutReason };
        }
        continue;
      }

      // 2. Sequential conditions check on candle close
      if (candle.timestamp < sc.discoveryTimestamp) continue;
      if (sc.watchPlan?.observableConditions && sc.watchPlan.observableConditions.length > 0) {
        const sortedConditions = [...sc.watchPlan.observableConditions].sort(
          (a, b) => (a.sequenceOrder || 1) - (b.sequenceOrder || 1)
        );
        let sequenceBlocked = false;
        let previousStepMetTimestamp: number | undefined = undefined;

        for (const cond of sortedConditions) {
          if (cond.isMet) {
            previousStepMetTimestamp = cond.metTimestamp;
            continue;
          }
          if (sequenceBlocked) break;

          // Check step timeout if previous step completed
          if (previousStepMetTimestamp && cond.params.maxStepDurationMs) {
            if (now - previousStepMetTimestamp > cond.params.maxStepDurationMs) {
              const reason = `Tiempo máximo entre pasos de confirmación excedido (${Math.round((now - previousStepMetTimestamp) / 60000)}m > ${Math.round(cond.params.maxStepDurationMs / 60000)}m)`;
              this.scenarioRegistry.transitionStatus(sc.id, 'INVALIDATED', reason, { currentPrice: candle.close });
              if (sc.watchPlan) sc.watchPlan.status = 'INVALIDATED';
              this.notifyCancelled(sc, reason);
              this.emit('scenario_invalidated', { scenarioId: sc.id, reason });
              break;
            }
          }

          if (cond.automatable) {
            if (cond.params?.timeframe && cond.params.timeframe !== candle.timeframe) {
              sequenceBlocked = true;
              continue;
            }
            const spreadNow = this.coordinator.getMarketState()?.ticker?.spreadPcnt;
            const isMet = this.evaluateCondition(cond, candle.close,
              typeof spreadNow === 'number' ? spreadNow : Number.NaN,
              candle, sc.discoveryTimestamp, previousStepMetTimestamp);
            if (isMet) {
              cond.isMet = true;
              cond.metTimestamp = now;
              previousStepMetTimestamp = now;
            } else {
              sequenceBlocked = true;
            }
          } else {
            sequenceBlocked = true;
          }
        }
      }

      if (sc.status === 'WAITING_CONFIRMATION') {
        const lastReview = sc.lastRevalidationTimestamp ?? sc.discoveryTimestamp;
        const planConditions = sc.watchPlan?.observableConditions || [];
        const allMet = planConditions.every((cond) => cond.automatable && cond.isMet);
        // A new candle is necessary, but not sufficient: ALL plan
        // confirmations must be met before spending another AI request.
        if (sc.watchPlan?.automatable !== false && allMet &&
            candle.timeframe === sc.timeframe &&
            candle.timestamp >= lastReview && now - lastReview >= 30 * 60000 &&
            this.calculateDistance(sc, candle.close).inZone) {
          this.scenarioRegistry.transitionStatus(sc.id, 'REVALIDATION_REQUESTED',
            'Nueva vela y todas las condiciones confirmadas tras cooldown',
            { currentPrice: candle.close });
          this.emit('revalidation_requested', {
            scenario: sc, watchPlan: sc.watchPlan, currentPrice: candle.close,
            triggerReason: 'NEW_CONFIRMED_CANDLE_AFTER_WAIT',
          });
        }
      }
    }

    if (neutralBreakout) {
      this.coordinator.getDiscoveryScheduler?.()?.triggerDiscovery?.(
        'RANGE_BREAKOUT_FROM_NEUTRAL_WATCH', neutralBreakout.price
      );
    }
    this.evaluateTick(candle.close);
  }

  public evaluateCandlePattern(pattern: string, candle: any, prevCandle?: any): boolean {
    if (!candle) return false;
    const o1 = candle.open;
    const h1 = candle.high;
    const l1 = candle.low;
    const c1 = candle.close;
    const range1 = Math.max(0.1, h1 - l1);
    const body1 = Math.abs(c1 - o1);
    const isGreen1 = c1 > o1;
    const isRed1 = c1 < o1;

    switch (pattern.toUpperCase()) {
      case 'BEARISH_ENGULFING': {
        if (!prevCandle) return false;
        const o0 = prevCandle.open;
        const c0 = prevCandle.close;
        if (!isRed1) return false;
        // Engulfing: open at or above previous body top, close below previous body bottom
        const engulfsBody = o1 >= Math.min(o0, c0) * 0.9995 && c1 < Math.min(o0, c0);
        const significantBody = body1 >= range1 * 0.35;
        return engulfsBody && significantBody;
      }
      case 'BULLISH_ENGULFING': {
        if (!prevCandle) return false;
        const o0 = prevCandle.open;
        const c0 = prevCandle.close;
        if (!isGreen1) return false;
        const engulfsBody = o1 <= Math.max(o0, c0) * 1.0005 && c1 > Math.max(o0, c0);
        const significantBody = body1 >= range1 * 0.35;
        return engulfsBody && significantBody;
      }
      case 'SHOOTING_STAR': {
        const upperWick = h1 - Math.max(o1, c1);
        const lowerWick = Math.min(o1, c1) - l1;
        const upperWickRatio = upperWick / range1;
        const lowerWickRatio = lowerWick / range1;
        const closePosition = (c1 - l1) / range1;
        return upperWick >= 1.8 * Math.max(0.1, body1) && upperWickRatio >= 0.45 && lowerWickRatio <= 0.30 && closePosition <= 0.45;
      }
      case 'PIN_BAR':
      case 'HAMMER': {
        const lowerWick = Math.min(o1, c1) - l1;
        const upperWick = h1 - Math.max(o1, c1);
        const lowerWickRatio = lowerWick / range1;
        const upperWickRatio = upperWick / range1;
        const closePosition = (c1 - l1) / range1;
        return lowerWick >= 1.8 * Math.max(0.1, body1) && lowerWickRatio >= 0.45 && upperWickRatio <= 0.30 && closePosition >= 0.55;
      }
      case 'INVERTED_HAMMER': {
        const upperWick = h1 - Math.max(o1, c1);
        const lowerWick = Math.min(o1, c1) - l1;
        return upperWick >= 1.8 * Math.max(0.1, body1) && (upperWick / range1) >= 0.45 && (lowerWick / range1) <= 0.30;
      }
      default:
        return false;
    }
  }

  public evaluateLevelRejectionWick(direction: 'BULLISH' | 'BEARISH', level: number, candle: any, minWickRatio: number = 0.25): boolean {
    if (!candle || level === undefined) return false;
    const range = Math.max(0.1, candle.high - candle.low);
    if (direction === 'BEARISH') {
      const wickedAbove = candle.high >= level * 0.9998;
      const closedBelow = candle.close < level;
      const upperWick = candle.high - Math.max(candle.open, candle.close);
      return wickedAbove && closedBelow && (upperWick / range) >= minWickRatio;
    } else {
      const wickedBelow = candle.low <= level * 1.0002;
      const closedAbove = candle.close > level;
      const lowerWick = Math.min(candle.open, candle.close) - candle.low;
      return wickedBelow && closedAbove && (lowerWick / range) >= minWickRatio;
    }
  }

  public evaluateVolumeExpansion(candle: any, timeframe: any = '15m', threshold: number = 1.5): boolean {
    if (!candle) return false;
    const candleManager = this.coordinator.getCandleManager?.();
    if (!candleManager) return false;
    const recent = candleManager.getCandles(timeframe, 20);
    if (!recent || recent.length < 3) return false;
    const past = recent.slice(0, -1);
    const avgVol = past.reduce((acc: number, c: any) => acc + (c.volume || 0), 0) / Math.max(1, past.length);
    if (!Number.isFinite(avgVol) || avgVol <= 0) return false;
    return (candle.volume || 0) >= avgVol * threshold;
  }

  public evaluateCondition(
    cond: WatchCondition,
    currentPrice: number,
    spreadPcnt: number,
    candle?: any,
    discoveryTimestamp?: number,
    previousStepMetTimestamp?: number
  ): boolean {
    const p = cond.params || {};
    switch (cond.operator) {
      case 'PRICE_IN_RANGE': {
        const min = p.minLevel !== undefined ? p.minLevel : 0;
        const max = p.maxLevel !== undefined ? p.maxLevel : Infinity;
        return currentPrice >= min && currentPrice <= max;
      }
      case 'PRICE_TOUCH_LEVEL': {
        if (p.level === undefined) return false;
        const tol = p.tolerancePct !== undefined ? p.tolerancePct : 0.001; // default 0.1%
        return Math.abs(currentPrice - p.level) / p.level <= tol;
      }
      case 'PRICE_CROSS_ABOVE': {
        if (p.level === undefined) return false;
        return currentPrice >= p.level;
      }
      case 'PRICE_CROSS_BELOW': {
        if (p.level === undefined) return false;
        return currentPrice <= p.level;
      }
      case 'SPREAD_TOLERANCE': {
        const maxSpread = p.threshold !== undefined ? p.threshold : 0.05;
        return spreadPcnt <= maxSpread;
      }
      case 'RSI_THRESHOLD': {
        if (p.threshold === undefined) return false;
        const tf = p.timeframe || '15m';
        const analysis = this.coordinator.getSetupEngine()?.getAnalysis(tf);
        if (!analysis || !Number.isFinite(analysis.rsi)) return false;
        if (p.comparison === 'GREATER_THAN') return analysis.rsi >= p.threshold;
        if (p.comparison === 'LESS_THAN') return analysis.rsi <= p.threshold;
        return false;
      }
      case 'CANDLE_CLOSE_ABOVE': {
        if (p.level === undefined || !candle) return false;
        return candle.close >= p.level;
      }
      case 'CANDLE_CLOSE_BELOW': {
        if (p.level === undefined || !candle) return false;
        return candle.close <= p.level;
      }
      case 'CANDLE_PATTERN': {
        const pattern = p.pattern || 'BEARISH_ENGULFING';
        const tf = p.timeframe || '15m';
        let evalCandle = candle;
        let prevCandle: any = undefined;

        if (!evalCandle && this.coordinator.getCandleManager) {
          const candleManager = this.coordinator.getCandleManager();
          const candles = candleManager?.getCandles(tf, 3);
          if (candles && candles.length >= 2) {
            evalCandle = candles[candles.length - 1];
            prevCandle = candles[candles.length - 2];
          }
        } else if (this.coordinator.getCandleManager) {
          const candles = this.coordinator.getCandleManager()?.getCandles(candle?.timeframe || tf, 3);
          if (candles && candles.length >= 2) {
            prevCandle = candles[candles.length - 2];
          }
        }

        if (!evalCandle) return false;
        // Never reuse stale events before discovery
        if (discoveryTimestamp && evalCandle.timestamp && evalCandle.timestamp < discoveryTimestamp) {
          return false;
        }
        if (previousStepMetTimestamp && evalCandle.timestamp && evalCandle.timestamp < previousStepMetTimestamp) {
          return false;
        }
        return this.evaluateCandlePattern(pattern, evalCandle, prevCandle);
      }
      case 'LEVEL_REJECTION_WICK': {
        const lvl = p.level;
        if (lvl === undefined) return false;
        const dir = p.direction || 'BEARISH';
        const tf = p.timeframe || '15m';
        let evalCandle = candle;
        if (!evalCandle && this.coordinator.getCandleManager) {
          evalCandle = this.coordinator.getCandleManager()?.getLastClosedCandle(tf);
        }
        if (!evalCandle) return false;
        if (discoveryTimestamp && evalCandle.timestamp && evalCandle.timestamp < discoveryTimestamp) return false;
        if (previousStepMetTimestamp && evalCandle.timestamp && evalCandle.timestamp < previousStepMetTimestamp) return false;
        return this.evaluateLevelRejectionWick(dir, lvl, evalCandle, p.minWickRatio || 0.25);
      }
      case 'STRUCTURE_CLOSE': {
        const lvl = p.level;
        if (lvl === undefined) return false;
        const dir = p.direction || 'BEARISH';
        const tf = p.timeframe || '15m';
        let evalCandle = candle;
        if (!evalCandle && this.coordinator.getCandleManager) {
          evalCandle = this.coordinator.getCandleManager()?.getLastClosedCandle(tf);
        }
        if (!evalCandle) return false;
        if (discoveryTimestamp && evalCandle.timestamp && evalCandle.timestamp < discoveryTimestamp) return false;
        if (previousStepMetTimestamp && evalCandle.timestamp && evalCandle.timestamp < previousStepMetTimestamp) return false;
        return dir === 'BEARISH' ? evalCandle.close <= lvl : evalCandle.close >= lvl;
      }
      case 'VOLUME_EXPANSION':
      case 'VOLUME_SPIKE': {
        const tf = p.timeframe || '15m';
        const threshold = p.threshold || p.volumeThresholdRvol || 1.5;
        let evalCandle = candle;
        if (!evalCandle && this.coordinator.getCandleManager) {
          evalCandle = this.coordinator.getCandleManager()?.getLastClosedCandle(tf);
        }
        if (!evalCandle) return false;
        if (discoveryTimestamp && evalCandle.timestamp && evalCandle.timestamp < discoveryTimestamp) return false;
        return this.evaluateVolumeExpansion(evalCandle, tf, threshold);
      }
      case 'BREAK_AND_RETEST': {
        const lvl = p.level;
        if (lvl === undefined) return false;
        const tol = p.tolerancePct !== undefined ? p.tolerancePct : 0.002;
        return Math.abs(currentPrice - lvl) / lvl <= tol;
      }
      case 'SWEEP_AND_RECLAIM': {
        const lvl = p.level;
        if (lvl === undefined) return false;
        const dir = p.direction || 'BULLISH';
        let evalCandle = candle;
        if (!evalCandle && this.coordinator.getCandleManager) {
          evalCandle = this.coordinator.getCandleManager()?.getLastClosedCandle(p.timeframe || '15m');
        }
        if (!evalCandle) return false;
        if (discoveryTimestamp && evalCandle.timestamp && evalCandle.timestamp < discoveryTimestamp) return false;
        if (dir === 'BULLISH') {
          return evalCandle.low < lvl && evalCandle.close >= lvl;
        } else {
          return evalCandle.high > lvl && evalCandle.close <= lvl;
        }
      }
      case 'STRUCTURE_BREAK':
      case 'BOS_CONFIRMED':
      case 'CHOCH_CONFIRMED': {
        const tf = p.timeframe || '5m';
        const analysis = this.coordinator.getSetupEngine()?.getAnalysis(tf);
        if (!analysis?.structure?.structureBreaks) return false;
        return analysis.structure.structureBreaks.some((b: any) =>
          (!p.direction || b.direction === p.direction) &&
          (!discoveryTimestamp || !b.timestamp || b.timestamp >= discoveryTimestamp) &&
          (!previousStepMetTimestamp || !b.timestamp || b.timestamp >= previousStepMetTimestamp)
        );
      }
      case 'SWEEP_CONFIRMED': {
        const tf = p.timeframe || '15m';
        const analysis = this.coordinator.getSetupEngine()?.getAnalysis(tf);
        if (!analysis?.structure?.sweeps) return false;
        return analysis.structure.sweeps.some((s: any) =>
          (!p.direction || s.direction === p.direction) &&
          (!discoveryTimestamp || !s.timestamp || s.timestamp >= discoveryTimestamp) &&
          (!previousStepMetTimestamp || !s.timestamp || s.timestamp >= previousStepMetTimestamp)
        );
      }
      case 'TIME_ELAPSED': {
        // threshold is elapsed seconds since the previous confirmation or discovery.
        if (!Number.isFinite(p.threshold) || !p.threshold || p.threshold < 0) return false;
        const anchor = previousStepMetTimestamp || discoveryTimestamp;
        return !!anchor && Date.now() - anchor >= p.threshold * 1000;
      }
      default:
        return false;
    }
  }

  public calculateDistance(scenario: Scenario, currentPrice: number): { inZone: boolean; distPct: number } {
    const minZone = scenario.entryZoneMin;
    const maxZone = scenario.entryZoneMax;
    if (!Number.isFinite(currentPrice) || currentPrice <= 0 ||
        !Number.isFinite(minZone) || !Number.isFinite(maxZone) ||
        minZone <= 0 || maxZone <= minZone) {
      return { inZone: false, distPct: Number.POSITIVE_INFINITY };
    }
    if (scenario.direction !== 'LONG' && scenario.direction !== 'SHORT') {
      return { inZone: false, distPct: Number.POSITIVE_INFINITY };
    }
    // Passing completely through a zone is NOT a valid zone touch / fill.
    // Reentry must be observed inside the actual bounded interval.
    const inZone = currentPrice >= minZone && currentPrice <= maxZone;
    const distance = inZone ? 0 : currentPrice < minZone ?
      minZone - currentPrice : currentPrice - maxZone;
    return { inZone, distPct: Number((distance / currentPrice * 100).toFixed(2)) };
  }

  private notifyApproaching(sc: Scenario, currentPrice: number, distPct: number): void {
    const last = this.lastAlertTimestamps.get(`app_${sc.id}`) || 0;
    if (Date.now() - last < 5 * 60 * 1000) return;
    this.lastAlertTimestamps.set(`app_${sc.id}`, Date.now());

    const title = `⚠️ ${sc.symbol} Aproximándose a Zona Registrada`;
    const msg = `El precio ($${currentPrice.toFixed(1)}) está a sólo ${distPct.toFixed(2)}% de la zona operativa [${sc.entryZoneMin} - ${sc.entryZoneMax}] (${sc.direction}).\nAI_WATCH_PLAN activo. Todavía NO existe entrada validada.`;

    this.telegramNotifier?.sendMessage?.(`*${title}*\n\n${msg}`, 'APPROACHING_ALERT');
    this.webPushNotifier?.broadcast?.({ title, body: msg });
  }

  private notifyInZone(sc: Scenario, currentPrice: number): void {
    const title = `🎯 ${sc.symbol} en Zona Operativa`;
    const msg = `${sc.symbol} activó condiciones en zona [${sc.entryZoneMin} - ${sc.entryZoneMax}]. Consultando reevaluación inteligente con OpenAI y Gemini...`;

    this.telegramNotifier?.sendMessage?.(`*${title}*\n\n${msg}`, 'IN_ZONE_ALERT');
    this.webPushNotifier?.broadcast?.({ title, body: msg });
  }

  private notifyCancelled(sc: Scenario, reason: string): void {
    const title = `❌ ${sc.symbol} Entrada Cancelada`;
    const msg = `Escenario ${sc.direction} ${sc.id} cancelado.\nMotivo: ${reason}`;

    this.telegramNotifier?.sendMessage?.(`*${title}*\n\n${msg}`, 'CANCELLED_ALERT');
    this.webPushNotifier?.broadcast?.({ title, body: msg });
  }
}
