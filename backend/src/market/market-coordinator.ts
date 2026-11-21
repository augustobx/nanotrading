import { EventEmitter } from 'events';
import {
  MarketState,
  Ticker,
  InstrumentInfo,
  SUPPORTED_TIMEFRAMES,
  Timeframe,
  SystemOperationalStatus,
  Candle,
} from '../types/market.js';
import { BybitRestClient } from '../bybit/bybit-rest-client.js';
import { BybitWsClient } from '../bybit/bybit-ws-client.js';
import { CandleManager, GapInfo } from './candle-manager.js';
import { OrderBookManager } from './orderbook-manager.js';
import { DatabaseService } from '../storage/database.js';
import { SetupEngine } from '../engine/setup-engine.js';
import { ConsensusEngine } from '../ai/consensus-engine.js';
import { SignalStateMachine } from '../engine/signal-state-machine.js';
import { TelegramNotifier } from '../notifications/telegram-notifier.js';
import { WebPushNotifier } from '../notifications/web-push-notifier.js';
import { MarketMonitorWorker } from '../engine/market-monitor-worker.js';
import { RiskPolicyManager } from '../engine/risk-policy.js';
import { BybitCredentialsManager } from '../bybit/bybit-credentials.js';
import { AiModelRouter } from '../ai/router/ai-router.js';
import { HardBudgetManager } from '../ai/hard-budget-manager.js';
import { decryptSecret } from '../security/encryption.js';
import { config } from '../config/index.js';
import { ScenarioRegistry } from '../engine/scenario-registry.js';
import { AiMarketDiscoveryEngine } from '../ai/ai-market-discovery.js';
import { AlgorithmicWatcher } from '../engine/algorithmic-watcher.js';
import { AiEntryRevalidation } from '../ai/ai-revalidation.js';
import { AutonomousDiscoveryScheduler } from '../ai/autonomous-discovery-scheduler.js';

export class MarketCoordinator extends EventEmitter {
  private restClient: BybitRestClient;
  private wsClient: BybitWsClient;
  private candleManager: CandleManager;
  private orderBookManager: OrderBookManager;
  private setupEngine: SetupEngine;
  private consensusEngine: ConsensusEngine;
  private signalStateMachine: SignalStateMachine;
  private telegramNotifier: TelegramNotifier;
  private webPushNotifier: WebPushNotifier;
  private marketMonitorWorker: MarketMonitorWorker;
  private riskPolicyManager: RiskPolicyManager;
  private bybitCredentialsManager: BybitCredentialsManager;
  private aiRouter: AiModelRouter;
  private scenarioRegistry: ScenarioRegistry;
  private aiDiscoveryEngine: AiMarketDiscoveryEngine;
  private algorithmicWatcher: AlgorithmicWatcher;
  private aiRevalidation: AiEntryRevalidation;
  private discoveryScheduler: AutonomousDiscoveryScheduler;
  private db: DatabaseService;
  private symbol: string;
  private instrumentInfo: InstrumentInfo | null = null;
  private currentTicker: Ticker | null = null;
  private isBootstrapped: boolean = false;
  private isStopped: boolean = false;
  private snapshotIntervalTimer: NodeJS.Timeout | null = null;

  constructor(
    restClient: BybitRestClient,
    wsClient: BybitWsClient,
    candleManager: CandleManager,
    orderBookManager: OrderBookManager,
    db: DatabaseService,
    symbol: string = config.bybit.symbol
  ) {
    super();
    this.restClient = restClient;
    this.wsClient = wsClient;
    this.candleManager = candleManager;
    this.orderBookManager = orderBookManager;
    this.db = db;
    this.symbol = symbol;
    this.setupEngine = new SetupEngine(this.candleManager, this.db);
    this.signalStateMachine = new SignalStateMachine(this.db);
    this.telegramNotifier = new TelegramNotifier(this.db);
    this.webPushNotifier = new WebPushNotifier(this.db);

    const savedBudget = this.db.getHardBudgetConfig();
    const hardBudgetManager = new HardBudgetManager(savedBudget || undefined, {
      sendTelegramAlert: async (title, msg) => {
        await this.telegramNotifier.sendMessage(`🚨 *${title}*\n\n${msg}`, 'BUDGET_ALERT');
      },
      sendWebPushAlert: async (title, msg) => {
        await this.webPushNotifier.broadcast({ title, body: msg });
      },
      logAudit: (cat, act, det) => this.db.logConfigAudit({ category: cat, action: act, details: det }),
    }, this.db);

    this.consensusEngine = new ConsensusEngine({
      coordinator: this,
      db: this.db,
      hardBudgetManager,
    });

    // Load persisted AI credentials from DB into ConsensusEngine adapters
    const savedOpenAi = this.db.getAiCredentials('openai');
    if (savedOpenAi?.encryptedSecret) {
      try {
        const decryptedKey = decryptSecret(savedOpenAi.encryptedSecret);
        if (decryptedKey) {
          this.consensusEngine.updateAiCredentials('openai', decryptedKey, savedOpenAi.model);
        }
      } catch (err) {
        console.warn('[Coordinator] No se pudo descifrar la clave OpenAI guardada');
      }
    }
    const savedGemini = this.db.getAiCredentials('gemini');
    if (savedGemini?.encryptedSecret) {
      try {
        const decryptedKey = decryptSecret(savedGemini.encryptedSecret);
        if (decryptedKey) {
          this.consensusEngine.updateAiCredentials('gemini', decryptedKey, savedGemini.model);
        }
      } catch (err) {
        console.warn('[Coordinator] No se pudo descifrar la clave Gemini guardada');
      }
    }

    // A persisted emergency stop must survive process/container restarts.
    config.security.killSwitchActive = config.security.killSwitchActive || this.db.getKillSwitchState() === true;
    this.riskPolicyManager = new RiskPolicyManager(this.db.getActiveRiskPolicy() || undefined);
    this.bybitCredentialsManager = new BybitCredentialsManager(this.db.getBybitCredentials() || undefined);
    this.aiRouter = new AiModelRouter(this.db.getRouterConfig() || undefined);
    this.marketMonitorWorker = new MarketMonitorWorker({
      coordinator: this,
      stateMachine: this.signalStateMachine,
      telegramNotifier: this.telegramNotifier,
      webPushNotifier: this.webPushNotifier,
      db: this.db,
    });

    this.scenarioRegistry = new ScenarioRegistry(this.db);
    this.aiDiscoveryEngine = new AiMarketDiscoveryEngine({
      coordinator: this,
      openaiAdapter: this.consensusEngine.getOpenAiAdapter(),
      geminiAdapter: this.consensusEngine.getGeminiAdapter(),
      hardBudgetManager,
      scenarioRegistry: this.scenarioRegistry,
      db: this.db,
    });
    this.algorithmicWatcher = new AlgorithmicWatcher(
      this,
      this.scenarioRegistry,
      this.telegramNotifier,
      this.webPushNotifier
    );
    this.aiRevalidation = new AiEntryRevalidation({
      coordinator: this,
      openaiAdapter: this.consensusEngine.getOpenAiAdapter(),
      geminiAdapter: this.consensusEngine.getGeminiAdapter(),
      hardBudgetManager,
      scenarioRegistry: this.scenarioRegistry,
      db: this.db,
      telegramNotifier: this.telegramNotifier,
      webPushNotifier: this.webPushNotifier,
    });
    this.discoveryScheduler = new AutonomousDiscoveryScheduler({
      coordinator: this,
      discoveryEngine: this.aiDiscoveryEngine,
      hardBudgetManager,
      db: this.db,
    });

    this.setupListeners();
  }

  private setupListeners(): void {
    // WebSocket events
    this.wsClient.on('connected', () => {
      this.db.logEvent('INFO', 'BybitWS', `Connected to Bybit V5 Linear stream for ${this.symbol}`);
      this.emit('state_updated', this.getMarketState());
    });

    this.wsClient.on('disconnected', (info) => {
      this.db.logEvent('WARN', 'BybitWS', `Disconnected from Bybit V5: ${JSON.stringify(info)}`);
      this.emit('state_updated', this.getMarketState());
    });

    this.wsClient.on('ticker', (data) => {
      this.handleWsTicker(data);
    });

    this.wsClient.on('kline', (candle: Candle) => {
      this.candleManager.processWsCandle(candle);
    });

    this.wsClient.on('orderbook_raw', (msg) => {
      const type = msg.type; // 'snapshot' | 'delta'
      const data = msg.data;
      if (!data) return;

      if (type === 'snapshot') {
        this.orderBookManager.handleSnapshot(data.b || [], data.a || [], data.seq || msg.cts, data.t || msg.cts, data.u);
      } else {
        this.orderBookManager.handleDelta(data.b || [], data.a || [], data.seq || msg.cts, data.t || msg.cts, data.u);
      }
    });

    this.wsClient.on('disconnected', () => {
      this.orderBookManager.markDesynced('WS_DISCONNECTED');
    });

    this.orderBookManager.on('desync_detected', async (info: any) => {
      this.db.logEvent('WARN', 'OrderBook', `OrderBook desync detected (${info.reason}), requesting fresh REST snapshot`, info);
      try {
        const ob = await this.restClient.getOrderBook(this.symbol, 50);
        this.orderBookManager.handleSnapshot(
          ob.bids.map((b) => [String(b[0]), String(b[1])]),
          ob.asks.map((a) => [String(a[0]), String(a[1])]),
          ob.seq,
          ob.timestamp
        );
        this.db.logEvent('INFO', 'OrderBook', 'OrderBook resynced successfully via REST snapshot');
      } catch (err: any) {
        this.db.logEvent('ERROR', 'OrderBook', `Failed to resync orderbook via REST: ${err.message}`);
      }
    });

    // Candle manager gap detection
    this.candleManager.on('gap_detected', async (gap: GapInfo) => {
      this.db.logEvent('WARN', 'CandleManager', `Gap detected on ${gap.timeframe}: ~${gap.missingCandlesEstimate} candles`, gap);
      await this.backfillGap(gap.timeframe);
    });

    // Forward candle events
    this.candleManager.on('candle_updated', (candle) => {
      this.emit('candle_updated', candle);
    });

    this.candleManager.on('candle_closed', (candle) => {
      this.emit('candle_closed', candle);
      this.emit('state_updated', this.getMarketState());
    });

    // Forward orderbook events
    this.orderBookManager.on('orderbook_updated', (ob) => {
      this.emit('orderbook_updated', ob);
    });

    // PR 4.1: Autonomous architecture consolidation.
    // Legacy consensus evaluation triggered by setup_detected is completely disabled.
    // All operative signals originate exclusively from autonomous AI discovery -> AlgorithmicWatcher -> AI revalidation.
    this.setupEngine.on('setup_detected', (setup) => {
      this.emit('setup_detected', setup);
      this.db.logEvent('INFO', 'Coordinator',
        'Technical setup observed (legacy research); no operative signal generated. Operative signals originate strictly from autonomous AI discovery.',
        { setupId: setup.id });
    });

    // Forward Signal State Machine events
    this.signalStateMachine.on('state_changed', (evt) => {
      this.emit('signal_state_changed', evt);
    });
    this.signalStateMachine.on('metrics_updated', (signal) => {
      this.emit('signal_metrics_updated', signal);
    });

    // Wire Algorithmic Watcher & Scenario Events
    this.algorithmicWatcher.on('revalidation_requested', async ({ scenario, watchPlan, currentPrice }) => {
      try {
        await this.aiRevalidation.revalidate(scenario, currentPrice, watchPlan);
      } catch (err: any) {
        if (!this.isStopped) {
          this.db.logEvent('ERROR', 'AIRevalidation', err.message);
        }
      }
    });

    this.scenarioRegistry.on('scenario_registered', (sc) => this.emit('scenario_registered', sc));
    this.scenarioRegistry.on('scenario_status_changed', (evt) => this.emit('scenario_status_changed', evt));
    this.scenarioRegistry.on('scenario_updated', (sc) => this.emit('scenario_updated', sc));
    this.algorithmicWatcher.on('scenario_approaching', (evt) => this.emit('scenario_approaching', evt));
    this.aiRevalidation.on('entry_validated', (evt: any) => {
      this.emit('scenario_entry_validated', evt);
      const { scenario, currentPrice, riskCalc } = evt;
      if (scenario && scenario.direction !== 'NEUTRAL') {
        // Alternative targets do NOT allocate two independently sized positions.
        const policy = this.riskPolicyManager.getPolicy();
        const modes = policy.rrTargetMode === 'RR_1_2' ?
          ['RR_1_2', 'RR_1_4'] : ['RR_1_4', 'RR_1_2'];
        for (const mode of modes) {
          const calc = mode === 'RR_1_4' ? riskCalc?.calculation14 : riskCalc?.calculation12;
          const target = mode === 'RR_1_4' ? scenario.target14Price : scenario.target12Price;
          const requiredRR = Math.max(policy.minNetRR,
            mode === 'RR_1_4' ? policy.minRRExtended : policy.minRRShort);
          if (!target || !calc?.isValid || calc.netRR < requiredRR ||
              calc.netLossUSDT <= 0 ||
              calc.netLossUSDT > Math.min(policy.maxRiskPerTradeUsdt,
                policy.capitalUsdt * policy.maxRiskPerTradePercent / 100)) continue;
          this.signalStateMachine.registerSignalFromScenario(
            scenario, currentPrice, mode as 'RR_1_2' | 'RR_1_4',
            target, calc.netRR, calc.netLossUSDT, calc.positionSizeBTC
          );
          break;
        }
      }
    });
    this.aiDiscoveryEngine.on('discovery_completed', (evt) => this.emit('discovery_completed', evt));
  }

  public async bootstrap(): Promise<void> {
    try {
      this.db.logEvent('INFO', 'Coordinator', `Bootstrapping market coordinator for ${this.symbol}`);

      // 1. Get instrument specs
      this.instrumentInfo = await this.restClient.getInstrumentsInfo(this.symbol);
      this.db.logEvent('INFO', 'Coordinator', `Instrument info loaded: tickSize=${this.instrumentInfo.tickSize}, qtyStep=${this.instrumentInfo.qtyStep}`);

      // 2. Fetch initial ticker
      this.currentTicker = await this.restClient.getTicker(this.symbol);

      // 3. Fetch initial orderbook
      const ob = await this.restClient.getOrderBook(this.symbol, 50);
      this.orderBookManager.handleSnapshot(
        ob.bids.map((b) => [String(b[0]), String(b[1])]),
        ob.asks.map((a) => [String(a[0]), String(a[1])]),
        ob.seq,
        ob.timestamp
      );

      // 4. Load historical candles for all 6 timeframes
      this.candleManager.initFromDatabase();
      for (const tf of SUPPORTED_TIMEFRAMES) {
        try {
          const historical = await this.restClient.getKlines(this.symbol, tf, 200);
          this.candleManager.loadHistoricalCandles(tf, historical);
          this.db.logEvent('INFO', 'Coordinator', `Loaded ${historical.length} historical candles for ${tf}`);
        } catch (err: any) {
          this.db.logEvent('ERROR', 'Coordinator', `Failed to load historical candles for ${tf}: ${err.message}`);
        }
      }

      // 5. Connect WebSocket
      this.wsClient.connect();

      // 6. Run quantitative setup engine analysis across loaded candles
      this.setupEngine.runFullAnalysis(this.currentTicker?.spread || 0.1);

      // 7. Start 24/7 background monitor worker & Algorithmic Watcher
      this.marketMonitorWorker.start();
      this.algorithmicWatcher.start();
      this.discoveryScheduler.start();

      // 8. Start periodic audit snapshot timer (every 60s)
      this.startSnapshotTimer();

      this.isBootstrapped = true;
      this.db.logEvent('INFO', 'Coordinator', 'Bootstrap completed successfully');
      this.emit('state_updated', this.getMarketState());
    } catch (err: any) {
      this.db.logEvent('CRITICAL', 'Coordinator', `Bootstrap failed: ${err.message}`);
      throw err;
    }
  }

  private handleWsTicker(data: any): void {
    if (!this.currentTicker) {
      const last = parseFloat(data.lastPrice || '0');
      this.currentTicker = {
        symbol: this.symbol,
        lastPrice: last,
        markPrice: parseFloat(data.markPrice || '0'),
        indexPrice: parseFloat(data.indexPrice || '0'),
        bid1Price: parseFloat(data.bid1Price || '0'),
        ask1Price: parseFloat(data.ask1Price || '0'),
        bid1Size: parseFloat(data.bid1Size || '0'),
        ask1Size: parseFloat(data.ask1Size || '0'),
        spread: 0,
        spreadPcnt: 0,
        highPrice24h: parseFloat(data.highPrice24h || '0'),
        lowPrice24h: parseFloat(data.lowPrice24h || '0'),
        prevPrice24h: parseFloat(data.prevPrice24h || '0'),
        price24hPcnt: parseFloat(data.price24hPcnt || '0'),
        volume24h: parseFloat(data.volume24h || '0'),
        turnover24h: parseFloat(data.turnover24h || '0'),
        fundingRate: parseFloat(data.fundingRate || '0'),
        nextFundingTime: parseInt(data.nextFundingTime || '0', 10),
        openInterest: parseFloat(data.openInterest || '0'),
        openInterestValue: parseFloat(data.openInterestValue || '0'),
        timestamp: Date.now(),
      };
    } else {
      // Incremental ticker update
      if (data.lastPrice) this.currentTicker.lastPrice = parseFloat(data.lastPrice);
      if (data.markPrice) this.currentTicker.markPrice = parseFloat(data.markPrice);
      if (data.indexPrice) this.currentTicker.indexPrice = parseFloat(data.indexPrice);
      if (data.bid1Price) this.currentTicker.bid1Price = parseFloat(data.bid1Price);
      if (data.ask1Price) this.currentTicker.ask1Price = parseFloat(data.ask1Price);
      if (data.bid1Size) this.currentTicker.bid1Size = parseFloat(data.bid1Size);
      if (data.ask1Size) this.currentTicker.ask1Size = parseFloat(data.ask1Size);
      if (data.highPrice24h) this.currentTicker.highPrice24h = parseFloat(data.highPrice24h);
      if (data.lowPrice24h) this.currentTicker.lowPrice24h = parseFloat(data.lowPrice24h);
      if (data.price24hPcnt) this.currentTicker.price24hPcnt = parseFloat(data.price24hPcnt);
      if (data.volume24h) this.currentTicker.volume24h = parseFloat(data.volume24h);
      if (data.turnover24h) this.currentTicker.turnover24h = parseFloat(data.turnover24h);
      if (data.fundingRate) this.currentTicker.fundingRate = parseFloat(data.fundingRate);
      if (data.nextFundingTime) this.currentTicker.nextFundingTime = parseInt(data.nextFundingTime, 10);
      if (data.openInterest) this.currentTicker.openInterest = parseFloat(data.openInterest);
      if (data.openInterestValue) this.currentTicker.openInterestValue = parseFloat(data.openInterestValue);
      this.currentTicker.timestamp = Date.now();
    }

    if (this.currentTicker.ask1Price > 0 && this.currentTicker.bid1Price > 0) {
      this.currentTicker.spread = parseFloat((this.currentTicker.ask1Price - this.currentTicker.bid1Price).toFixed(2));
      this.currentTicker.spreadPcnt = (this.currentTicker.spread / this.currentTicker.lastPrice) * 100;
    }

    this.emit('ticker_updated', this.currentTicker);
  }

  public async backfillGap(timeframe: Timeframe): Promise<void> {
    try {
      this.db.logEvent('INFO', 'Coordinator', `Starting automatic REST backfill for ${timeframe}`);
      const freshCandles = await this.restClient.getKlines(this.symbol, timeframe, 50);
      this.candleManager.loadHistoricalCandles(timeframe, freshCandles);
      this.db.logEvent('INFO', 'Coordinator', `Backfill complete for ${timeframe}, merged ${freshCandles.length} candles`);
    } catch (err: any) {
      this.db.logEvent('ERROR', 'Coordinator', `Backfill failed for ${timeframe}: ${err.message}`);
    }
  }

  private startSnapshotTimer(): void {
    if (this.snapshotIntervalTimer) clearInterval(this.snapshotIntervalTimer);
    this.snapshotIntervalTimer = setInterval(() => {
      if (this.currentTicker) {
        this.db.saveSnapshot(
          this.symbol,
          this.currentTicker.lastPrice,
          this.currentTicker.markPrice,
          this.currentTicker.indexPrice,
          this.currentTicker.spread,
          this.currentTicker.fundingRate,
          this.currentTicker.openInterest
        );
      }
    }, 60000);
  }

  public getMarketState(): MarketState {
    const wsConnected = this.wsClient.isConnected();
    const wsLatency = this.wsClient.getLatency();
    const lastMsgTime = this.wsClient.getLastMessageTime();

    let status: SystemOperationalStatus = 'OBSERVING';
    if (!wsConnected || !this.currentTicker || Date.now() - lastMsgTime > config.bybit.wsWatchdogTimeoutMs) {
      status = 'DATA_UNAVAILABLE';
    }

    return {
      symbol: this.symbol,
      ticker: this.currentTicker,
      orderBook: this.orderBookManager.getOrderBook(),
      currentCandle: this.candleManager.getAllCurrentCandles(),
      lastClosedCandle: this.candleManager.getAllLastClosedCandles(),
      wsConnected,
      wsLatencyMs: wsLatency,
      lastWsMessageTimestamp: lastMsgTime,
      gapsDetectedCount: this.candleManager.getGapsCount(),
      status,
      killSwitchActive: config.security.killSwitchActive,
      updatedAt: Date.now(),
    };
  }

  public getCandles(timeframe: Timeframe, count: number = 100): Candle[] {
    return this.candleManager.getCandles(timeframe, count);
  }

  public getCandleManager(): CandleManager {
    return this.candleManager;
  }

  public getSetupEngine(): SetupEngine {
    return this.setupEngine;
  }

  public getInstrumentInfo(): InstrumentInfo | null {
    return this.instrumentInfo;
  }

  public getAnalyses(): Record<string, any> {
    return this.setupEngine.getAllAnalyses();
  }

  public getActiveSetups(): any[] {
    return this.setupEngine.getActiveSetups();
  }

  public getConsensusEngine(): ConsensusEngine {
    return this.consensusEngine;
  }

  public getSignalStateMachine(): SignalStateMachine {
    return this.signalStateMachine;
  }

  public getMarketMonitorWorker(): MarketMonitorWorker {
    return this.marketMonitorWorker;
  }

  public getTelegramNotifier(): TelegramNotifier {
    return this.telegramNotifier;
  }

  public getWebPushNotifier(): WebPushNotifier {
    return this.webPushNotifier;
  }

  public getRiskPolicyManager(): RiskPolicyManager {
    return this.riskPolicyManager;
  }

  public getBybitCredentialsManager(): BybitCredentialsManager {
    return this.bybitCredentialsManager;
  }

  public getAiRouter(): AiModelRouter {
    return this.aiRouter;
  }

  public getHardBudgetManager(): HardBudgetManager {
    return this.consensusEngine.getHardBudgetManager();
  }

  public getScenarioRegistry(): ScenarioRegistry {
    return this.scenarioRegistry;
  }

  public getAiDiscoveryEngine(): AiMarketDiscoveryEngine {
    return this.aiDiscoveryEngine;
  }

  public getAlgorithmicWatcher(): AlgorithmicWatcher {
    return this.algorithmicWatcher;
  }

  public getAiRevalidation(): AiEntryRevalidation {
    return this.aiRevalidation;
  }

  public getDiscoveryScheduler(): AutonomousDiscoveryScheduler {
    return this.discoveryScheduler;
  }

  public setKillSwitch(active: boolean, reason?: string): void {
    this.db.saveKillSwitchState(active);
    config.security.killSwitchActive = active;
    this.db.logEvent('WARN', 'Security', `Kill Switch ${active ? 'ACTIVATED' : 'DEACTIVATED'}: ${reason || 'Acción administrativa'}`);
    if (active) {
      this.signalStateMachine.cancelAll('KILL_SWITCH_ACTIVE');
      this.telegramNotifier.notifyEmergencyKillSwitch(true, reason).catch(() => {});
    } else {
      this.telegramNotifier.notifyEmergencyKillSwitch(false, reason).catch(() => {});
    }
    this.emit('state_updated', this.getMarketState());
  }

  public stop(): void {
    this.isStopped = true;
    this.marketMonitorWorker.stop();
    this.algorithmicWatcher.stop();
    this.discoveryScheduler.stop();
    if (this.snapshotIntervalTimer) {
      clearInterval(this.snapshotIntervalTimer);
      this.snapshotIntervalTimer = null;
    }
    this.wsClient.disconnect();
  }
}
