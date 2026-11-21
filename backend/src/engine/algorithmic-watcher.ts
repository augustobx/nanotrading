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

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    // Listen to market ticks from coordinator
    this.coordinator.on('state_updated', (state) => {
      if (state.ticker?.lastPrice) {
        this.evaluateTick(state.ticker.lastPrice, state.ticker.spreadPcnt);
      }
    });

    this.coordinator.on('candle_closed', (candle) => {
      this.evaluateCandleClose(candle);
    });
  }

  public stop(): void {
    this.isRunning = false;
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

      // 2. NEUTRAL_OBSERVATION check: Monitor range breakout ONLY. NEVER revalidate as a trade entry!
      if (sc.kind === 'NEUTRAL_OBSERVATION' || sc.direction === 'NEUTRAL') {
        let breakoutOccurred = false;
        let breakoutReason = '';

        // Check if price broke through dynamic range boundaries
        if (sc.entryZoneMax > 0 && currentPrice > sc.entryZoneMax) {
          breakoutOccurred = true;
          breakoutReason = `Ruptura alcista de rango neutral: precio $${currentPrice.toFixed(1)} superó techo $${sc.entryZoneMax.toFixed(1)}`;
        } else if (sc.entryZoneMin > 0 && currentPrice < sc.entryZoneMin) {
          breakoutOccurred = true;
          breakoutReason = `Ruptura bajista de rango neutral: precio $${currentPrice.toFixed(1)} perforó piso $${sc.entryZoneMin.toFixed(1)}`;
        }

        // Check any observable conditions on the neutral plan
        if (!breakoutOccurred && sc.watchPlan?.observableConditions) {
          for (const cond of sc.watchPlan.observableConditions) {
            if (this.evaluateCondition(cond, currentPrice, spreadPcnt, undefined, sc.discoveryTimestamp)) {
              cond.isMet = true;
              cond.metTimestamp = now;
              breakoutOccurred = true;
              breakoutReason = cond.description;
              break;
            }
          }
        }

        if (breakoutOccurred) {
          this.scenarioRegistry.transitionStatus(
            sc.id,
            'COMPLETED',
            `${breakoutReason}. Ruptura confirmada: solicitando nuevo descubrimiento de IA.`,
            { currentPrice }
          );
          if (sc.watchPlan) {
            sc.watchPlan.status = 'COMPLETED';
          }
          this.emit('neutral_range_breakout', { scenario: sc, breakoutPrice: currentPrice, reason: breakoutReason });
          // Autonomous Trigger: When neutral observation breaks out, trigger a fresh AI market discovery
          this.coordinator.getDiscoveryScheduler?.()?.triggerDiscovery?.('RANGE_BREAKOUT_FROM_NEUTRAL_WATCH', currentPrice);
        }

        // Never evaluate entry revalidation for neutral observations
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

        for (const cond of sortedConditions) {
          if (cond.isMet) {
            continue;
          }
          if (sequenceBlocked) {
            allRequiredConditionsMet = false;
            continue;
          }

          if (cond.automatable) {
            const conditionMet = this.evaluateCondition(cond, currentPrice, spreadPcnt, undefined, sc.discoveryTimestamp);
            if (conditionMet) {
              cond.isMet = true;
              cond.metTimestamp = now;
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
      this.scenarioRegistry.updateMetrics(sc.id, {
        distanceToZonePct: distPct,
        currentPrice,
        lastCheckedTimestamp: now,
      });

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

        if (sc.status !== 'IN_ZONE' && sc.status !== 'REVALIDATION_REQUESTED' && sc.status !== 'AI_REVALIDATING' && sc.status !== 'ENTRY_VALIDATED') {
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

  public evaluateCandleClose(candle: any): void {
    const activeScenarios = this.scenarioRegistry.getAllActive();
    if (activeScenarios.length === 0) return;

    for (const sc of activeScenarios) {
      if (sc.watchPlan?.observableConditions) {
        for (const cond of sc.watchPlan.observableConditions) {
          if (cond.operator === 'CANDLE_CLOSE_ABOVE' && cond.params.level !== undefined) {
            if (candle.close >= cond.params.level) {
              cond.isMet = true;
              cond.metTimestamp = Date.now();
            }
          } else if (cond.operator === 'CANDLE_CLOSE_BELOW' && cond.params.level !== undefined) {
            if (candle.close <= cond.params.level) {
              cond.isMet = true;
              cond.metTimestamp = Date.now();
            }
          }
        }
      }
    }

    this.evaluateTick(candle.close);
  }

  public evaluateCondition(
    cond: WatchCondition,
    currentPrice: number,
    spreadPcnt: number,
    candle?: any,
    discoveryTimestamp?: number
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
        if (p.threshold === undefined) return true;
        const tf = p.timeframe || '15m';
        const analysis = this.coordinator.getSetupEngine()?.getAnalysis(tf);
        if (!analysis) return true;
        if (p.comparison === 'GREATER_THAN') return analysis.rsi >= p.threshold;
        if (p.comparison === 'LESS_THAN') return analysis.rsi <= p.threshold;
        return true;
      }
      case 'CANDLE_CLOSE_ABOVE': {
        if (p.level === undefined || !candle) return false;
        return candle.close >= p.level;
      }
      case 'CANDLE_CLOSE_BELOW': {
        if (p.level === undefined || !candle) return false;
        return candle.close <= p.level;
      }
      case 'STRUCTURE_BREAK': {
        const tf = p.timeframe || '5m';
        const analysis = this.coordinator.getSetupEngine()?.getAnalysis(tf);
        if (!analysis?.structure?.structureBreaks) return false;
        return analysis.structure.structureBreaks.some((b: any) =>
          (!p.direction || b.direction === p.direction) &&
          (!discoveryTimestamp || !b.timestamp || b.timestamp >= discoveryTimestamp)
        );
      }
      case 'SWEEP_CONFIRMED': {
        const tf = p.timeframe || '15m';
        const analysis = this.coordinator.getSetupEngine()?.getAnalysis(tf);
        if (!analysis?.structure?.sweeps) return false;
        return analysis.structure.sweeps.some((s: any) =>
          (!p.direction || s.direction === p.direction) &&
          (!discoveryTimestamp || !s.timestamp || s.timestamp >= discoveryTimestamp)
        );
      }
      case 'TIME_ELAPSED': {
        return true;
      }
      default:
        return false;
    }
  }

  public calculateDistance(scenario: Scenario, currentPrice: number): { inZone: boolean; distPct: number } {
    const minZone = Math.min(scenario.entryZoneMin, scenario.entryZoneMax);
    const maxZone = Math.max(scenario.entryZoneMin, scenario.entryZoneMax);

    if (scenario.direction === 'LONG') {
      if (currentPrice >= minZone && currentPrice <= maxZone) {
        return { inZone: true, distPct: 0 };
      }
      if (currentPrice < minZone) {
        return { inZone: true, distPct: 0 };
      }
      const distPct = Math.max(0, ((currentPrice - maxZone) / currentPrice) * 100);
      return { inZone: false, distPct: Number(distPct.toFixed(2)) };
    } else if (scenario.direction === 'SHORT') {
      if (currentPrice >= minZone && currentPrice <= maxZone) {
        return { inZone: true, distPct: 0 };
      }
      if (currentPrice > maxZone) {
        return { inZone: true, distPct: 0 };
      }
      const distPct = Math.max(0, ((minZone - currentPrice) / currentPrice) * 100);
      return { inZone: false, distPct: Number(distPct.toFixed(2)) };
    }

    return { inZone: false, distPct: 0 };
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
