import { EventEmitter } from 'events';
import { MarketCoordinator } from '../market/market-coordinator.js';
import { ScenarioRegistry } from './scenario-registry.js';
import { TelegramNotifier } from '../notifications/telegram-notifier.js';
import { WebPushNotifier } from '../notifications/web-push-notifier.js';
import { Scenario } from '../ai/scenario-types.js';

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
    const activeScenarios = this.scenarioRegistry.getAllActive();
    if (activeScenarios.length === 0) return;

    const now = Date.now();

    for (const sc of activeScenarios) {
      // 1. Expiration check
      if (now > sc.validUntilTimestamp) {
        this.scenarioRegistry.transitionStatus(
          sc.id,
          'EXPIRED',
          'Vigencia temporal agotada sin mitigación de la zona',
          { currentPrice }
        );
        this.emit('scenario_expired', { scenarioId: sc.id, reason: 'EXPIRED_TIME' });
        continue;
      }

      // 2. Early Invalidation check (breaching Stop Loss prior to entry)
      const isLong = sc.direction === 'LONG';
      const isInvalidated = isLong
        ? currentPrice <= sc.stopLossPrice
        : currentPrice >= sc.stopLossPrice;

      if (isInvalidated) {
        const reason = `Stop Loss estructural vulnerado (${currentPrice.toFixed(1)} vs SL ${sc.stopLossPrice.toFixed(1)})`;
        this.scenarioRegistry.transitionStatus(sc.id, 'INVALIDATED', reason, { currentPrice });
        this.notifyCancelled(sc, reason);
        this.emit('scenario_invalidated', { scenarioId: sc.id, reason });
        continue;
      }

      // 3. Distance to entry zone calculation
      const { inZone, distPct } = this.calculateDistance(sc, currentPrice);

      // Update tracked metrics on scenario
      this.scenarioRegistry.updateMetrics(sc.id, {
        distanceToZonePct: distPct,
        currentPrice,
        lastCheckedTimestamp: now,
      });

      // 4. In Zone Trigger -> Request AI Revalidation
      if (inZone) {
        if (sc.status !== 'IN_ZONE' && sc.status !== 'REVALIDATION_REQUESTED' && sc.status !== 'AI_REVALIDATING' && sc.status !== 'ENTRY_VALIDATED') {
          this.scenarioRegistry.transitionStatus(
            sc.id,
            'IN_ZONE',
            `Precio alcanzó la zona operativa [${sc.entryZoneMin} - ${sc.entryZoneMax}]`,
            { currentPrice, distPct }
          );

          this.scenarioRegistry.transitionStatus(
            sc.id,
            'REVALIDATION_REQUESTED',
            'Iniciando reevaluación de IA ante mitigación de zona',
            { currentPrice }
          );

          this.notifyInZone(sc, currentPrice);
          this.emit('revalidation_requested', { scenario: sc, currentPrice });
        }
        continue;
      }

      // 5. Approaching Zone Trigger
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
    // When a candle closes, re-check active scenarios for structural invalidation
    this.evaluateTick(candle.close);
  }

  public calculateDistance(scenario: Scenario, currentPrice: number): { inZone: boolean; distPct: number } {
    const minZone = Math.min(scenario.entryZoneMin, scenario.entryZoneMax);
    const maxZone = Math.max(scenario.entryZoneMin, scenario.entryZoneMax);

    if (scenario.direction === 'LONG') {
      if (currentPrice >= minZone && currentPrice <= maxZone) {
        return { inZone: true, distPct: 0 };
      }
      if (currentPrice < minZone) {
        // Price pulled back deeper than zone but above SL
        return { inZone: true, distPct: 0 };
      }
      // Price is above zone, approaching downwards
      const distPct = Math.max(0, ((currentPrice - maxZone) / currentPrice) * 100);
      return { inZone: false, distPct: Number(distPct.toFixed(2)) };
    } else {
      // SHORT
      if (currentPrice >= minZone && currentPrice <= maxZone) {
        return { inZone: true, distPct: 0 };
      }
      if (currentPrice > maxZone) {
        // Price pulled back higher than zone but below SL
        return { inZone: true, distPct: 0 };
      }
      // Price is below zone, approaching upwards
      const distPct = Math.max(0, ((minZone - currentPrice) / currentPrice) * 100);
      return { inZone: false, distPct: Number(distPct.toFixed(2)) };
    }
  }

  private notifyApproaching(sc: Scenario, currentPrice: number, distPct: number): void {
    const last = this.lastAlertTimestamps.get(`app_${sc.id}`) || 0;
    if (Date.now() - last < 5 * 60 * 1000) return; // 5 min deduplication
    this.lastAlertTimestamps.set(`app_${sc.id}`, Date.now());

    const title = `⚠️ ${sc.symbol} Aproximándose a Zona Registrada`;
    const msg = `El precio ($${currentPrice.toFixed(1)}) está a sólo ${distPct.toFixed(2)}% de la zona operativa [${sc.entryZoneMin} - ${sc.entryZoneMax}] (${sc.direction}).\nTodavía NO existe entrada validada.`;

    this.telegramNotifier?.sendMessage?.(`*${title}*\n\n${msg}`, 'APPROACHING_ALERT');
    this.webPushNotifier?.broadcast?.({ title, body: msg });
  }

  private notifyInZone(sc: Scenario, currentPrice: number): void {
    const title = `🎯 ${sc.symbol} en Zona Operativa`;
    const msg = `${sc.symbol} alcanzó la zona operativa [${sc.entryZoneMin} - ${sc.entryZoneMax}]. OpenAI y Gemini están revisando las condiciones actuales para revalidación.`;

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
