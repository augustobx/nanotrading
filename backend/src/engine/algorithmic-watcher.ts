import { EventEmitter } from 'events';
import { MarketCoordinator } from '../market/market-coordinator.js';
import { ScenarioRegistry } from './scenario-registry.js';
import { TelegramNotifier } from '../notifications/telegram-notifier.js';
import { WebPushNotifier } from '../notifications/web-push-notifier.js';
import { Scenario, WatchCondition, AiWatchPlan, NeutralBreakoutProgress } from '../ai/scenario-types.js';
import { TIMEFRAME_DURATION_MS } from '../types/market.js';

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
    // Bybit REST backfill loads closed candles without emitting candle_closed.
    // Recover any confirmed neutral breakouts missed during a container restart.
    this.reconcileNeutralConfirmedCandles();
  }

  /** Reconcile persisted neutral watchers with real CLOSED REST candles.
   * Never replay directional signals, paper entries or AI revalidation. */
  public reconcileNeutralConfirmedCandles(): void {
    if (!this.isRunning) return;
    const activeNeutral = this.scenarioRegistry.getAllActive().filter(sc =>
      (sc.direction === 'NEUTRAL' || sc.kind === 'NEUTRAL_OBSERVATION') &&
      sc.validUntilTimestamp > Date.now());
    if (!activeNeutral.length) return;
    const earliest = Math.min(...activeNeutral.map(sc => sc.discoveryTimestamp));
    const duration = TIMEFRAME_DURATION_MS['15m'];
    const now = Date.now();
    const candles = this.coordinator.getCandleManager?.()?.getCandles('15m', 200) || [];
    for (const candle of candles.filter((c: any) =>
      c.confirmed === true && c.timeframe === '15m' &&
      (!c.symbol || c.symbol === activeNeutral[0].symbol) &&
      Number.isFinite(c.timestamp) && c.timestamp + duration > earliest &&
      c.timestamp + duration <= now).sort((a: any, b: any) => a.timestamp - b.timestamp)) {
      this.evaluateCandleClose(candle, true);
    }
  }

  public stop(): void {
    if (!this.isRunning) return;
    this.isRunning = false;
    this.coordinator.off('state_updated', this.onStateUpdated);
    this.coordinator.off('candle_closed', this.onCandleClosed);
  }


  /** Save one meaningful change, not every Bybit tick. This is observation
   * telemetry only: it cannot create a trading signal or spend AI tokens. */
  private setNeutralProgress(
    scenario: Scenario, progress: NeutralBreakoutProgress, reason: string, log: boolean
  ): void {
    this.scenarioRegistry.updateMetrics(scenario.id, {
      neutralBreakoutProgress: progress,
      currentPrice: progress.price,
      lastCheckedTimestamp: progress.observedAt,
      ...(Number.isFinite(progress.candleTimestamp)
        ? { neutralLastEvaluatedCandleTimestamp: progress.candleTimestamp }
        : {}),
    });
    if (log) {
      this.scenarioRegistry.logLifecycle({
        scenarioId: scenario.id,
        fromStatus: 'NO_TRADE_OBSERVATION',
        toStatus: 'NO_TRADE_OBSERVATION',
        timestamp: progress.observedAt,
        reason,
        metadata: {
          neutralObservation: true,
          progress: progress.state,
          side: progress.side,
          price: progress.price,
          candleTimestamp: progress.candleTimestamp,
          relativeVolume: progress.relativeVolume,
          baselineCount: progress.baselineCount,
        },
      });
    }
  }

  private neutralSide(scenario: Scenario, price: number): 'CEILING' | 'FLOOR' | null {
    if (!Number.isFinite(price) ||
        !Number.isFinite(scenario.entryZoneMin) || !Number.isFinite(scenario.entryZoneMax)) {
      return null;
    }
    return price > scenario.entryZoneMax ? 'CEILING'
      : price < scenario.entryZoneMin ? 'FLOOR' : null;
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

      // A tick outside is visible evidence, NOT a confirmed neutral breakout.
      // It never launches AI or paper entries: only a confirmed 15m close can.
      if (sc.kind === 'NEUTRAL_OBSERVATION' || sc.direction === 'NEUTRAL') {
        const side = this.neutralSide(sc, currentPrice);
        const previous = sc.neutralBreakoutProgress;
        if (side && (previous?.side !== side ||
            !['OUTSIDE_AWAITING_CLOSE', 'OUTSIDE_CLOSED_LOW_VOLUME',
              'OUTSIDE_CLOSED_INSUFFICIENT_DATA'].includes(previous.state))) {
          this.setNeutralProgress(sc, {
            state: 'OUTSIDE_AWAITING_CLOSE', side, price: currentPrice, observedAt: now,
          }, `Precio ${side === 'CEILING' ? 'sobre techo' : 'bajo piso'} en tiempo real; esperando cierre de vela ${sc.timeframe} y RVOL >= 1.2. No es señal.`, true);
        } else if (!side && previous?.side &&
          ['OUTSIDE_AWAITING_CLOSE', 'OUTSIDE_CLOSED_LOW_VOLUME',
            'OUTSIDE_CLOSED_INSUFFICIENT_DATA'].includes(previous.state)) {
          this.setNeutralProgress(sc, {
            state: 'BACK_INSIDE_RANGE', price: currentPrice, observedAt: now,
          }, 'Precio volvió al rango antes de una ruptura validada; observación continúa.', true);
        }
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

      // An observed live touch is independent of AI condition parameters.
      const { inZone, distPct } = this.calculateDistance(sc, currentPrice);
      const plan = sc.watchPlan;
      const entryPending = ['SCENARIO_PROPOSED', 'SCENARIO_REGISTERED',
        'SCENARIO_MONITORING', 'APPROACHING_ZONE'].includes(sc.status);
      if (entryPending && plan) {
        // Legacy plans may contain false-positive confirmations from the old
        // unbounded PRICE_IN_RANGE evaluator. Never treat them as fresh evidence.
        if (!plan.zoneTouchedTimestamp && plan.observableConditions.some(c => c.isMet)) {
          const allPreviouslyMet = plan.observableConditions.length > 0 &&
            plan.observableConditions.every(c => c.automatable && c.isMet);
          const maxDrift = this.entryDriftLimit(sc);
          const favorableAway = sc.direction === 'SHORT' ? currentPrice < sc.entryZoneMin
            : currentPrice > sc.entryZoneMax;
          if (allPreviouslyMet && favorableAway && Math.abs(currentPrice - sc.targetEntry) > maxDrift) {
            this.scenarioRegistry.transitionStatus(sc.id, 'EXPIRED',
              'OPPORTUNITY_MISSED: confirmaciones históricas registradas, precio fuera del margen; no se reconstruye una entrada retroactiva.',
              { currentPrice, distanceToZonePct: distPct, maxDrift, legacyEvidence: true });
            continue;
          }
          for (const condition of plan.observableConditions) {
            condition.isMet = false;
            delete condition.metTimestamp;
            delete condition.metDetails;
          }
          this.scenarioRegistry.updateMetrics(sc.id, { watchPlan: plan });
          this.scenarioRegistry.logLifecycle({
            scenarioId: sc.id, fromStatus: sc.status, toStatus: sc.status, timestamp: now,
            reason: 'Confirmaciones antiguas sin evidencia verificable de toque; se requiere una observación nueva.',
            metadata: { watcherProgress: 'LEGACY_CONFIRMATIONS_RESET' },
          });
        }
        if (inZone && !plan.zoneTouchedTimestamp) {
          plan.zoneTouchedTimestamp = now;
          plan.zoneTouchedPrice = currentPrice;
          this.scenarioRegistry.updateMetrics(sc.id, { watchPlan: plan, currentPrice, distanceToZonePct: 0 });
          this.scenarioRegistry.logLifecycle({
            scenarioId: sc.id, fromStatus: sc.status, toStatus: sc.status, timestamp: now,
            reason: 'Zona operativa alcanzada; esperando confirmaciones del plan.',
            metadata: { watcherProgress: 'ZONE_TOUCHED', currentPrice },
          });
        }
      }

      // 4. Evaluate Observable Conditions in Strict Sequential Order (1 -> 2 -> 3...)
      let allRequiredConditionsMet = !plan?.observableConditions?.length || !!plan.zoneTouchedTimestamp;
      if (entryPending && plan?.zoneTouchedTimestamp && plan.observableConditions.length > 0) {
        const sortedConditions = [...plan.observableConditions].sort(
          (a, b) => (a.sequenceOrder || 1) - (b.sequenceOrder || 1)
        );
        let sequenceBlocked = false;
        let previousStepMetTimestamp: number | undefined = undefined;
        let conditionsChanged = false;

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
              conditionsChanged = true;
              this.scenarioRegistry.logLifecycle({
                scenarioId: sc.id, fromStatus: sc.status, toStatus: sc.status, timestamp: now,
                reason: `Confirmación cumplida: ${cond.description}`,
                metadata: { watcherProgress: 'CONDITION_MET', conditionId: cond.id, operator: cond.operator, currentPrice },
              });
            } else {
              allRequiredConditionsMet = false;
              sequenceBlocked = true; // Subsequent sequence steps cannot be fulfilled yet
            }
          } else {
            allRequiredConditionsMet = false;
            sequenceBlocked = true;
          }
        }
        if (conditionsChanged) this.scenarioRegistry.updateMetrics(sc.id, { watchPlan: plan });
      }
      if (isInvalidated) {
        this.scenarioRegistry.transitionStatus(sc.id, 'INVALIDATED', invalidationReason, { currentPrice });
        this.notifyCancelled(sc, invalidationReason);
        this.emit('scenario_invalidated', { scenarioId: sc.id, reason: invalidationReason });
        continue;
      }

      // 5. Distance to entry zone calculation

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

      // Confirmation may occur just outside the zone after a rejection.
      // Never chase price beyond the very same drift cap used by revalidation.
      const confirmedPlan = !!plan?.zoneTouchedTimestamp && plan.automatable &&
        plan.observableConditions.length > 0 && allRequiredConditionsMet;
      const drift = Math.abs(currentPrice - sc.targetEntry);
      const maxDrift = this.entryDriftLimit(sc);
      const favorableAway = sc.direction === 'SHORT' ? currentPrice < sc.entryZoneMin
        : currentPrice > sc.entryZoneMax;
      if (entryPending && confirmedPlan && favorableAway && drift > maxDrift) {
        this.scenarioRegistry.transitionStatus(sc.id, 'EXPIRED',
          `OPPORTUNITY_MISSED: confirmaciones completas, precio fuera del margen de entrada (${drift.toFixed(2)} > ${maxDrift.toFixed(2)} USDT).`,
          { currentPrice, distanceToZonePct: distPct, drift, maxDrift });
        this.emit('scenario_expired', { scenarioId: sc.id, reason: 'OPPORTUNITY_MISSED' });
        continue;
      }
      // 6. In Zone / Confirmed Rejection Trigger
      if (inZone || (entryPending && confirmedPlan && favorableAway && drift <= maxDrift)) {
        // If plan has non-automatable conditions, do not auto-approve entry; flag waiting confirmation
        if (sc.watchPlan && !sc.watchPlan.automatable) {
          if (sc.status !== 'WAITING_CONFIRMATION') {
            const reason = `El plan contiene condiciones no automatizables (${(sc.watchPlan.nonAutomatableConditions || []).join(', ')}). Esperando confirmación discrecional.`;
            this.scenarioRegistry.transitionStatus(sc.id, 'WAITING_CONFIRMATION', reason, { currentPrice });
          }
          continue;
        }

        // For automatable plans: all required conditions must be satisfied in sequential order
        if ((!allRequiredConditionsMet || (plan && !plan.zoneTouchedTimestamp)) && entryPending && (plan?.observableConditions?.length || 0) > 0) {
          // Conditions are still pending in sequence, remain in monitoring
          continue;
        }

        if (entryPending) {
          const triggerReason = inZone
            ? `Precio alcanzó la zona operativa [${sc.entryZoneMin} - ${sc.entryZoneMax}]`
            : `Zona previamente alcanzada y confirmaciones satisfechas; precio dentro del margen de entrada (${drift.toFixed(2)} USDT)`;

          this.scenarioRegistry.transitionStatus(
            sc.id,
            'IN_ZONE',
            triggerReason,
            { currentPrice, distanceToZonePct: distPct, inZone }
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
  private neutralVolumeEvidence(candle: any, timeframe: string): {
    confirmed: boolean; relativeVolume?: number; baselineCount: number;
  } {
    const recent = this.coordinator.getCandleManager?.()?.getCandles(timeframe as any, 30) || [];
    const prior = recent.filter((c: any) =>
      c.confirmed === true && Number.isFinite(c.timestamp) && c.timestamp < candle.timestamp &&
      Number.isFinite(c.volume) && c.volume > 0
    ).slice(-20);
    if (prior.length < 10 || !Number.isFinite(candle.volume) || candle.volume <= 0) {
      return { confirmed: false, baselineCount: prior.length };
    }
    const average = prior.reduce((sum: number, c: any) => sum + c.volume, 0) / prior.length;
    if (average <= 0) return { confirmed: false, baselineCount: prior.length };
    const relativeVolume = candle.volume / average;
    return { confirmed: relativeVolume >= 1.2, relativeVolume, baselineCount: prior.length };
  }

  public evaluateCandleClose(candle: any, neutralRecoveryOnly = false): void {
    if (!candle || candle.confirmed !== true || !Number.isFinite(candle.close)) return;
    const inactiveStatuses = ['EXPIRED', 'INVALIDATED', 'CANCELLED', 'COMPLETED', 'DISCARDED'];
    const activeScenarios = this.scenarioRegistry.getAllActive().filter((s) => !inactiveStatuses.includes(s.status));
    if (activeScenarios.length === 0) return;

    const now = Date.now();
    for (const sc of activeScenarios) {
      // 1. NEUTRAL_OBSERVATION check on candle close
      if (sc.kind === 'NEUTRAL_OBSERVATION' || sc.direction === 'NEUTRAL') {
        if (candle.timeframe !== sc.timeframe ||
            candle.symbol && candle.symbol !== sc.symbol ||
            !Number.isFinite(candle.timestamp)) continue;
        // Bybit kline.timestamp is the OPEN time. A 15m candle beginning
        // before discovery may legitimately CLOSE after the watch was created.
        const duration = TIMEFRAME_DURATION_MS[sc.timeframe];
        if (!duration || candle.timestamp + duration <= sc.discoveryTimestamp ||
            candle.timestamp + duration > sc.validUntilTimestamp ||
            (sc.neutralLastEvaluatedCandleTimestamp !== undefined &&
              sc.neutralLastEvaluatedCandleTimestamp >= candle.timestamp)) continue;
        if (!Number.isFinite(sc.entryZoneMin) || !Number.isFinite(sc.entryZoneMax) ||
            sc.entryZoneMin <= 0 || sc.entryZoneMax <= sc.entryZoneMin) continue;

        const side = this.neutralSide(sc, candle.close);
        if (!side) {
          if (sc.neutralBreakoutProgress?.side) {
            this.setNeutralProgress(sc, {
              state: 'BACK_INSIDE_RANGE', price: candle.close, observedAt: now,
              candleTimestamp: candle.timestamp,
            }, `Vela ${sc.timeframe} cerró nuevamente dentro del rango; sin ruptura confirmada.`, true);
          } else {
            this.scenarioRegistry.updateMetrics(sc.id, {
              neutralLastEvaluatedCandleTimestamp: candle.timestamp,
            });
          }
          continue;
        }

        const evidence = this.neutralVolumeEvidence(candle, sc.timeframe);
        if (!evidence.confirmed) {
          const state = evidence.relativeVolume === undefined
            ? 'OUTSIDE_CLOSED_INSUFFICIENT_DATA' : 'OUTSIDE_CLOSED_LOW_VOLUME';
          const ratio = evidence.relativeVolume === undefined
            ? `historial válido insuficiente (${evidence.baselineCount}/10)`
            : `RVOL ${evidence.relativeVolume.toFixed(2)} < 1.20`;
          this.setNeutralProgress(sc, {
            state, side, price: candle.close, observedAt: now,
            candleTimestamp: candle.timestamp,
            relativeVolume: evidence.relativeVolume,
            baselineCount: evidence.baselineCount,
          }, `Cierre ${sc.timeframe} fuera del rango ${side === 'CEILING' ? 'alcista' : 'bajista'} pero ${ratio}; no se solicita IA.`, true);
          continue;
        }

        const breakoutReason = `Ruptura confirmada en vela ${sc.timeframe} cerrada: ${candle.close.toFixed(1)} ${side === 'CEILING'
          ? `superó techo ${sc.entryZoneMax.toFixed(1)}`
          : `perforó piso ${sc.entryZoneMin.toFixed(1)}`}, RVOL ${evidence.relativeVolume!.toFixed(2)}.`;
        // Persist the scheduler event BEFORE marking this watch COMPLETED.
        // A crash between these operations may cause harmless reconciliation,
        // never silent disappearance of a real, confirmed breakout.
        const queued = this.coordinator.getDiscoveryScheduler?.()
          ?.queueConfirmedNeutralBreakout?.(candle.close);
        if (queued === false) {
          this.scenarioRegistry.logLifecycle({
            scenarioId: sc.id, fromStatus: sc.status, toStatus: sc.status,
            timestamp: now,
            reason: 'Ruptura confirmada pero no se pudo persistir su solicitud de IA; seguirá en observación hasta reintento.',
            metadata: { neutralObservation: true, progress: 'QUEUE_PERSIST_FAILED' },
          });
          continue;
        }
        this.setNeutralProgress(sc, {
          state: 'BREAKOUT_CONFIRMED', side, price: candle.close, observedAt: now,
          candleTimestamp: candle.timestamp,
          relativeVolume: evidence.relativeVolume,
          baselineCount: evidence.baselineCount,
        }, breakoutReason, false);
        this.scenarioRegistry.transitionStatus(
          sc.id, 'COMPLETED',
          `${breakoutReason} Descubrimiento solicitado al scheduler, sujeto a cooldown y presupuesto.`,
          { currentPrice: candle.close, relativeVolume: evidence.relativeVolume }
        );
        this.emit('neutral_range_breakout', {
          scenario: sc, breakoutPrice: candle.close, reason: breakoutReason,
        });
        continue;
      }

      if (neutralRecoveryOnly) continue;

      // 2. Sequential conditions check on candle close
      if (candle.symbol && candle.symbol !== sc.symbol) continue;
      const duration = TIMEFRAME_DURATION_MS[candle.timeframe as keyof typeof TIMEFRAME_DURATION_MS];
      if (!duration || !Number.isFinite(candle.timestamp) ||
          candle.timestamp + duration <= sc.discoveryTimestamp ||
          candle.timestamp + duration > Math.min(now, sc.validUntilTimestamp)) continue;
      if (sc.watchPlan?.zoneTouchedTimestamp && sc.watchPlan.observableConditions.length > 0 &&
          ['SCENARIO_PROPOSED', 'SCENARIO_REGISTERED', 'SCENARIO_MONITORING', 'APPROACHING_ZONE', 'WAITING_CONFIRMATION'].includes(sc.status)) {
        const sortedConditions = [...sc.watchPlan.observableConditions].sort(
          (a, b) => (a.sequenceOrder || 1) - (b.sequenceOrder || 1)
        );
        let sequenceBlocked = false;
        let previousStepMetTimestamp: number | undefined = undefined;
        let conditionsChanged = false;

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
            if (['PRICE_IN_RANGE', 'PRICE_TOUCH_LEVEL', 'PRICE_CROSS_ABOVE', 'PRICE_CROSS_BELOW', 'BREAK_AND_RETEST', 'SPREAD_TOLERANCE'].includes(cond.operator)) {
              sequenceBlocked = true;
              continue;
            }
            if (cond.params?.timeframe && cond.params.timeframe !== candle.timeframe) {
              sequenceBlocked = true;
              continue;
            }
            const spreadNow = this.coordinator.getMarketState?.()?.ticker?.spreadPcnt;
            const isMet = this.evaluateCondition(cond, candle.close,
              typeof spreadNow === 'number' ? spreadNow : Number.NaN,
              candle, sc.discoveryTimestamp, previousStepMetTimestamp);
            if (isMet) {
              cond.isMet = true;
              cond.metTimestamp = now;
              previousStepMetTimestamp = now;
              conditionsChanged = true;
              this.scenarioRegistry.logLifecycle({
                scenarioId: sc.id, fromStatus: sc.status, toStatus: sc.status, timestamp: now,
                reason: `Confirmación cumplida: ${cond.description}`,
                metadata: { watcherProgress: 'CONDITION_MET', conditionId: cond.id, operator: cond.operator, candleTimestamp: candle.timestamp },
              });
            } else {
              sequenceBlocked = true;
            }
          } else {
            sequenceBlocked = true;
          }
        }
        if (conditionsChanged && this.scenarioRegistry.getAllActive().some(s => s.id === sc.id)) {
          this.scenarioRegistry.updateMetrics(sc.id, { watchPlan: sc.watchPlan });
        }
      }

      if (sc.status === 'WAITING_CONFIRMATION' && this.scenarioRegistry.getAllActive().some(s => s.id === sc.id)) {
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

    // The queue was already persisted synchronously before closing the watch.
    // Do not replay historical prices into live directional signal handling.
    const ticker = this.coordinator.getMarketState?.()?.ticker;
    if (!neutralRecoveryOnly && ticker && Number.isFinite(ticker.lastPrice) && ticker.lastPrice > 0) {
      this.evaluateTick(ticker.lastPrice, ticker.spreadPcnt);
    }
  }

  private entryDriftLimit(sc: Scenario): number {
    return Math.max(0.5, Math.min(sc.targetEntry * 0.0015,
      Math.abs(sc.targetEntry - sc.stopLossPrice) * 0.10));
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
    const past = recent.filter((c: any) => c.confirmed === true && c.timestamp < candle.timestamp && Number.isFinite(c.volume) && c.volume > 0);
    if (past.length < 2) return false;
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
        const min = p.minLevel ?? p.min;
        const max = p.maxLevel ?? p.max;
        return typeof min === 'number' && typeof max === 'number' &&
          Number.isFinite(min) && Number.isFinite(max) && min > 0 && max >= min &&
          currentPrice >= min && currentPrice <= max;
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

        if (!evalCandle || evalCandle.confirmed !== true) return false;
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
        if (!evalCandle || evalCandle.confirmed !== true) return false;
        if (discoveryTimestamp && evalCandle.timestamp && evalCandle.timestamp < discoveryTimestamp) return false;
        if (previousStepMetTimestamp && evalCandle.timestamp && evalCandle.timestamp < previousStepMetTimestamp) return false;
        if (dir !== 'BEARISH' && dir !== 'BULLISH') return false;
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
        if (String(dir) === 'BEARISH' || String(dir) === 'BELOW') return evalCandle.close <= lvl;
        if (String(dir) === 'BULLISH' || String(dir) === 'ABOVE') return evalCandle.close >= lvl;
        return false;
      }
      case 'VOLUME_EXPANSION':
      case 'VOLUME_SPIKE': {
        const tf = p.timeframe || '15m';
        const threshold = p.threshold ?? p.volumeThresholdRvol ?? p.thresholdMultiplier ?? 1.5;
        if (!Number.isFinite(threshold) || threshold <= 0) return false;
        let evalCandle = candle;
        if (!evalCandle && this.coordinator.getCandleManager) {
          evalCandle = this.coordinator.getCandleManager()?.getLastClosedCandle(tf);
        }
        if (!evalCandle) return false;
        if (discoveryTimestamp && evalCandle.timestamp && evalCandle.timestamp < discoveryTimestamp) return false;
        if (evalCandle.confirmed !== true) return false;
        if (previousStepMetTimestamp && evalCandle.timestamp + TIMEFRAME_DURATION_MS[tf] <= previousStepMetTimestamp) return false;
        if (p.direction === 'BEARISH' && evalCandle.close >= evalCandle.open) return false;
        if (p.direction === 'BULLISH' && evalCandle.close <= evalCandle.open) return false;
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
