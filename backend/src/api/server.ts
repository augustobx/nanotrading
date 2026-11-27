import http from 'http';
import { effectiveRRMinimums } from '../engine/effective-rr.js';
import { WebSocketServer, WebSocket } from 'ws';
import { MarketCoordinator } from '../market/market-coordinator.js';
import { DatabaseService } from '../storage/database.js';
import { config } from '../config/index.js';
import { Timeframe, SUPPORTED_TIMEFRAMES } from '../types/market.js';
import { authManager } from '../security/auth-manager.js';
import { maskSecret, encryptSecret, decryptSecret } from '../security/encryption.js';
import { RiskCalculator } from '../engine/risk-calculator.js';
import { AI_MODELS_CATALOG, calculateCallCost, getValidatedModel } from '../ai/models-catalog.js';
import { BybitRestClient } from '../bybit/bybit-rest-client.js';
import { HistoricalDataManager } from '../backtest/historical-data-manager.js';
import { BacktestEngine } from '../backtest/backtest-engine.js';

export class ApiServer {
  private server: http.Server;
  private wss: WebSocketServer;
  private coordinator: MarketCoordinator;
  private markets: Map<string, MarketCoordinator>;
  private db: DatabaseService;
  private port: number;
  private host: string;
  private startTime: number = Date.now();
  private rateLimitMap: Map<string, { count: number; resetTime: number }> = new Map();
  private evaluationsInProgress: Set<string> = new Set();
  private historicalDataManager: HistoricalDataManager;
  private backtestEngine: BacktestEngine;

  constructor(coordinator: MarketCoordinator, db: DatabaseService, port?: number, host?: string,
    markets?: Map<string, MarketCoordinator>) {
    this.coordinator = coordinator;
    this.markets = markets || new Map([['BTCUSDT', coordinator]]);
    this.db = db;
    this.historicalDataManager = new HistoricalDataManager(new BybitRestClient(), this.db);
    this.backtestEngine = new BacktestEngine(this.historicalDataManager, this.db);
    authManager.setDatabase(this.db);
    this.port = port !== undefined ? port : config.port;
    this.host = host || config.host;

    this.server = http.createServer((req, res) => this.handleHttpRequest(req, res));
    this.wss = new WebSocketServer({ noServer: true });

    this.setupUpgradeHandler();
    this.setupWebSocketBroadcast();
  }

  private isAuthenticated(req: http.IncomingMessage): boolean {
    return authManager.validateAuth(req).valid;
  }

  private checkRateLimit(ip: string): boolean {
    const now = Date.now();
    const entry = this.rateLimitMap.get(ip);
    if (!entry || now > entry.resetTime) {
      this.rateLimitMap.set(ip, { count: 1, resetTime: now + 60000 });
      return true;
    }
    if (entry.count >= config.security.rateLimitPerMinute) {
      return false;
    }
    entry.count++;
    return true;
  }

  private async readJsonBody<T = any>(req: http.IncomingMessage): Promise<T> {
    // Reuse the bounded parser; never buffer arbitrarily large request bodies.
    return this.parseJsonBody<T>(req);
  }

  private handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    // Credentialed CORS must never reflect arbitrary caller-controlled origins.
    const origin = req.headers.origin as string | undefined;
    const trustedOrigins = config.security.corsAllowedOrigins;
    const allowedOrigin = !!origin && trustedOrigins.includes(origin);
    res.setHeader('Vary', 'Origin');
    if (allowedOrigin) {
      res.setHeader('Access-Control-Allow-Origin', origin!);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-csrf-token, x-admin-key');
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(origin && !allowedOrigin ? 403 : 204);
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;

    // Market prices may remain public, but private configuration/usage records cannot.
    const privateReadPaths = new Set([
      '/api/v1/config/bybit', '/api/v1/config/budget',
      '/api/v1/config/ai/router', '/api/v1/config/ai/credentials',
      '/api/v1/config/ai/consumption', '/api/v1/config/ai/consumption/export',
      '/api/v1/config/ai/gemini/models', '/api/v1/config/audit',
      '/api/v1/notifications/history',
    ]);
    if (req.method === 'GET' && privateReadPaths.has(pathname) && !this.isAuthenticated(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Autenticación requerida' }));
      return;
    }

    try {
      if (pathname === '/api/v1/markets/portfolio' && req.method === 'GET') {
        this.sendCrossMarketExposure(res);
      } else if (pathname === '/api/v1/markets' && req.method === 'GET') {
        this.sendMarketDirectory(res);
      } else if (pathname.startsWith('/api/v1/markets/')) {
        this.handleMultiMarketRequest(req, res, url, pathname);
      } else if (pathname === '/health' && req.method === 'GET') {
        this.sendHealth(res);
      } else if (pathname === '/api/v1/market/state' && req.method === 'GET') {
        this.sendMarketState(res);
      } else if (pathname === '/api/v1/market/candles' && req.method === 'GET') {
        const tf = (url.searchParams.get('timeframe') || '15m') as Timeframe;
        const limit = parseInt(url.searchParams.get('limit') || '100', 10);
        this.sendCandles(res, tf, limit);
      } else if (pathname === '/api/v1/market/orderbook' && req.method === 'GET') {
        this.sendOrderBook(res);
      } else if (pathname === '/api/v1/market/instrument' && req.method === 'GET') {
        this.sendInstrumentInfo(res);
      } else if (pathname === '/api/v1/market/analysis' && req.method === 'GET') {
        this.sendMarketAnalysis(res);
      } else if (pathname === '/api/v1/market/setups' && req.method === 'GET') {
        this.sendActiveSetups(res, url);
      } else if (pathname === '/api/v1/ai/status' && req.method === 'GET') {
        this.sendAiStatus(res);
      } else if (pathname === '/api/v1/ai/reviews' && req.method === 'GET') {
        const setupId = url.searchParams.get('setupId');
        const limit = parseInt(url.searchParams.get('limit') || '50', 10);
        this.sendAiReviews(res, setupId, limit);
      } else if ((pathname === '/api/v1/signals' || pathname === '/api/v1/signals/history') && req.method === 'GET') {
        const limit = parseInt(url.searchParams.get('limit') || '50', 10);
        this.sendSignals(res, limit);
      } else if (pathname === '/api/v1/signals/active' && req.method === 'GET') {
        this.sendActiveSignals(res);
      } else if (pathname.startsWith('/api/v1/signals/') && pathname.endsWith('/lifecycle') && req.method === 'GET') {
        const parts = pathname.split('/');
        const signalId = parts[4];
        this.sendSignalLifecycle(res, signalId);
      } else if (pathname.startsWith('/api/v1/signals/') && pathname.endsWith('/cancel') && req.method === 'POST') {
        const parts = pathname.split('/');
        const signalId = parts[4];
        this.handleCancelSignal(req, res, signalId);
      } else if (pathname === '/api/v1/ai/evaluate' && req.method === 'POST') {
        this.handleEvaluateSetup(req, res);
      } else if (pathname === '/api/v1/kill-switch' && req.method === 'POST') {
        this.handleKillSwitch(req, res);
      } else if (pathname === '/api/v1/push/vapid-public-key' && req.method === 'GET') {
        this.sendVapidPublicKey(res);
      } else if (pathname === '/api/v1/push/subscribe' && req.method === 'POST') {
        this.handlePushSubscribe(req, res);
      } else if (pathname === '/api/v1/push/unsubscribe' && req.method === 'POST') {
        this.handlePushUnsubscribe(req, res);
      } else if (pathname === '/api/v1/push/test' && req.method === 'POST') {
        this.handlePushTest(req, res);
      } else if (pathname === '/api/v1/notifications/telegram/test' && req.method === 'POST') {
        this.handleTelegramTest(req, res);
      } else if (pathname === '/api/v1/notifications/history' && req.method === 'GET') {
        const limit = parseInt(url.searchParams.get('limit') || '50', 10);
        this.sendNotificationHistory(res, limit);
      } else if (pathname === '/api/v1/auth/status' && req.method === 'GET') {
        this.handleAuthStatus(req, res);
      } else if (pathname === '/api/v1/auth/setup' && req.method === 'POST') {
        this.handleAuthSetup(req, res);
      } else if (pathname === '/api/v1/auth/login' && req.method === 'POST') {
        this.handleAuthLogin(req, res);
      } else if (pathname === '/api/v1/auth/verify' && req.method === 'GET') {
        this.handleAuthVerify(req, res);
      } else if (pathname === '/api/v1/auth/logout' && req.method === 'POST') {
        this.handleAuthLogout(req, res);
      } else if (pathname === '/api/v1/config/risk' && req.method === 'GET') {
        this.sendRiskPolicy(res);
      } else if (pathname === '/api/v1/config/risk' && req.method === 'POST') {
        this.handleUpdateRiskPolicy(req, res);
      } else if (pathname === '/api/v1/risk/calculate' && req.method === 'POST') {
        this.handleCalculateRisk(req, res);
      } else if (pathname === '/api/v1/config/bybit' && req.method === 'GET') {
        this.sendBybitConfig(res);
      } else if (pathname === '/api/v1/config/bybit' && req.method === 'POST') {
        this.handleSaveBybitConfig(req, res);
      } else if (pathname === '/api/v1/config/bybit' && req.method === 'DELETE') {
        this.handleDeleteBybitConfig(req, res);
      } else if (pathname === '/api/v1/config/bybit/test' && req.method === 'POST') {
        this.handleTestBybitConfig(req, res);
      } else if (pathname === '/api/v1/config/budget' && req.method === 'GET') {
        this.sendBudgetConfig(res);
      } else if (pathname === '/api/v1/config/budget' && req.method === 'POST') {
        this.handleUpdateBudgetConfig(req, res);
      } else if (pathname === '/api/v1/config/budget/reactivate' && req.method === 'POST') {
        this.handleReactivateBudget(req, res);
      } else if (pathname === '/api/v1/config/ai/openai/verify-free-tier' && req.method === 'POST') {
        this.handleVerifyOpenAiFreeTier(req, res);
      } else if (pathname === '/api/v1/config/ai/router' && req.method === 'GET') {
        this.sendAiRouterConfig(res);
      } else if (pathname === '/api/v1/config/ai/router' && req.method === 'POST') {
        this.handleUpdateAiRouterConfig(req, res);
      } else if (pathname === '/api/v1/config/ai/credentials' && req.method === 'GET') {
        this.sendAiCredentials(res);
      } else if (pathname === '/api/v1/config/ai/credentials' && req.method === 'POST') {
        this.handleSaveAiCredentials(req, res);
      } else if (pathname === '/api/v1/config/ai/gemini/models' && req.method === 'GET') {
        this.handleGetGeminiModels(req, res);
      } else if (pathname.startsWith('/api/v1/config/ai/credentials/') && req.method === 'DELETE') {
        const provider = pathname.split('/')[5];
        this.handleDeleteAiCredentials(req, res, provider);
      } else if (pathname === '/api/v1/config/ai/test' && req.method === 'POST') {
        this.handleTestAiConnection(req, res);
      } else if (pathname === '/api/v1/config/ai/consumption' && req.method === 'GET') {
        this.sendAiConsumption(req, res);
      } else if (pathname === '/api/v1/config/ai/consumption/export' && req.method === 'GET') {
        this.handleExportAiConsumption(res);
      } else if (pathname === '/api/v1/config/audit' && req.method === 'GET') {
        this.sendConfigAudit(req, res);
      } else if (pathname === '/api/v1/config/summary' && req.method === 'GET') {
        this.sendConfigSummary(res);
      } else if (pathname === '/api/v1/discovery/market-intelligence' && req.method === 'GET') {
        this.sendMarketIntelligence(res);
      } else if (pathname === '/api/v1/discovery/audit' && req.method === 'GET') {
        const analyses = this.db.getDiscoveryAudits(Number(url.searchParams.get('limit') || 20), this.coordinator.getMarketState().symbol);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, data: {
          funnel: this.db.getDiscoveryFunnel(this.coordinator.getMarketState().symbol),
          policy: { ...effectiveRRMinimums(this.coordinator.getRiskPolicyManager().getPolicy()),
            mode: this.coordinator.getRiskPolicyManager().getPolicy().rrTargetMode },
          analyses: analyses.map(({ snapshot, policy, ...analysis }) => ({
            ...analysis, policyVersion: policy?.version,
          })),
        } }));
      } else if (pathname.startsWith('/api/v1/discovery/audit/') && req.method === 'GET') {
        const audit = this.db.getDiscoveryAudit(decodeURIComponent(pathname.slice('/api/v1/discovery/audit/'.length)));
        res.writeHead(audit ? 200 : 404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: !!audit, data: audit }));
      } else if (pathname === '/api/v1/discovery/scenarios' && req.method === 'GET') {
        this.sendScenarios(req, res, url);
      } else if (pathname === '/api/v1/discovery/watch-plans' && req.method === 'GET') {
        this.sendWatchPlans(res);
      } else if (pathname.startsWith('/api/v1/discovery/scenarios/') && pathname.endsWith('/revalidate') && req.method === 'POST') {
        const parts = pathname.split('/');
        const scenarioId = parts[5];
        this.handleManualRevalidate(req, res, scenarioId);
      } else if (pathname.startsWith('/api/v1/discovery/scenarios/') && req.method === 'GET') {
        const parts = pathname.split('/');
        const scenarioId = parts[5];
        this.sendScenarioDetail(res, scenarioId);
      } else if (pathname === '/api/v1/discovery/trigger' && req.method === 'POST') {
        this.handleTriggerDiscovery(req, res);
      } else if (pathname === '/api/v1/discovery/scheduler/status' && req.method === 'GET') {
        this.sendDiscoverySchedulerStatus(res);
      } else if (pathname === '/api/v1/discovery/scheduler/config' && req.method === 'GET') {
        this.sendDiscoverySchedulerConfig(res);
      } else if (pathname === '/api/v1/discovery/scheduler/config' && req.method === 'POST') {
        this.handleUpdateDiscoverySchedulerConfig(req, res);
      } else if (pathname === '/api/v1/backtest/data/status' && req.method === 'GET') {
        this.sendBacktestDataStatus(res);
      } else if (pathname === '/api/v1/backtest/data/import' && req.method === 'POST') {
        this.handleBacktestImport(req, res);
      } else if (pathname === '/api/v1/backtest/run' && req.method === 'POST') {
        this.handleBacktestRun(req, res);
      } else if (pathname === '/api/v1/backtest/runs' && req.method === 'GET') {
        const limit = parseInt(url.searchParams.get('limit') || '20', 10);
        this.sendBacktestRuns(res, limit);
      } else if (pathname.startsWith('/api/v1/backtest/runs/') && pathname.endsWith('/export') && req.method === 'GET') {
        const parts = pathname.split('/');
        const runId = parts[5];
        const format = (url.searchParams.get('format') || 'json') as 'csv' | 'json';
        this.sendBacktestExport(res, runId, format);
      } else if (pathname.startsWith('/api/v1/backtest/runs/') && pathname.endsWith('/trades') && req.method === 'GET') {
        const parts = pathname.split('/');
        const runId = parts[5];
        const limit = parseInt(url.searchParams.get('limit') || '500', 10);
        this.sendBacktestRunTrades(res, runId, limit);
      } else if (pathname.startsWith('/api/v1/backtest/runs/') && req.method === 'GET') {
        const parts = pathname.split('/');
        const runId = parts[5];
        this.sendBacktestRunDetail(res, runId);
      } else if (pathname === '/api/v1/events' && req.method === 'GET') {
        const limit = parseInt(url.searchParams.get('limit') || '50', 10);
        this.sendEvents(res, limit);
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Endpoint not found', path: pathname }));
      }
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal Server Error', message: 'Error interno de servidor' }));
    }
  }


  /** Read-only BTC/ETH overlap audit for correlated paper positions. */
  private sendCrossMarketExposure(res: http.ServerResponse): void {
    const liveStates = new Set(['ENTRY_VALIDATED', 'ALERT_SENT', 'APPROACHING_ZONE',
      'IN_ZONE', 'ENTRY_TRIGGERED', 'TRACKING']);
    const entries = Array.from(this.markets.entries()).flatMap(([symbol, coordinator]) =>
      coordinator.getSignalStateMachine().getActiveSignals()
        .filter(s => liveStates.has(s.state))
        .map(s => ({ symbol, id: s.id, direction: s.direction, state: s.state,
          paperRiskUsdt: Number(s.riskUsdt) || 0 })));
    const overlappingDirections = ['LONG', 'SHORT'].filter(direction =>
      new Set(entries.filter(s => s.direction === direction).map(s => s.symbol)).size > 1);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, data: {
      concurrentPaperSignals: entries,
      overlappingDirections,
      correlatedSameDirection: overlappingDirections.length > 0,
      combinedRiskUsdt: Number(entries.reduce((sum, s) => sum + s.paperRiskUsdt, 0).toFixed(2)),
      advisoryOnly: true,
      note: 'BTC y ETH pueden estar correlacionados. La alerta no modifica la política de 4R ni las decisiones paper.',
    } }));
  }

  /** Read-only per-market API. The legacy /api/v1/market endpoints remain BTC-compatible.
   * No paid AI invocation is performed by GET requests. Writes require admin authentication.
   */
  private sendMarketDirectory(res: http.ServerResponse): void {
    const list = Array.from(this.markets.entries()).map(([symbol, coordinator]) => {
      const market = coordinator.getMarketState();
      const scheduler = coordinator.getDiscoveryScheduler().getStatus();
      return {
        symbol, status: market.status,
        lastPrice: market.ticker?.lastPrice ?? null,
        wsConnected: market.wsConnected,
        schedulerEnabled: scheduler.enabled,
        activeWatchedScenarios: scheduler.activeWatchedScenarios,
        autonomousRunsSinceRestart: scheduler.totalAutonomousRuns,
        executionMode: 'SIGNALS_ONLY',
      };
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, data: list }));
  }

  private handleMultiMarketRequest(req: http.IncomingMessage, res: http.ServerResponse,
    url: URL, pathname: string): void {
    const segments = pathname.slice('/api/v1/markets/'.length).split('/');
    const symbol = segments[0];
    const resource = segments.slice(1).join('/');
    const coordinator = this.markets.get(symbol);
    if (!coordinator || !resource) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Mercado o ruta no disponible' }));
      return;
    }
    const reply = (data: any, statusCode = 200) => {
      res.writeHead(statusCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: statusCode < 400, symbol, data }));
    };
    if (req.method === 'POST' && resource.startsWith('scenarios/') &&
      resource.endsWith('/revalidate')) {
      if (!this.isAuthenticated(req)) {
        reply({ error: 'Autenticación requerida' }, 401);
        return;
      }
      const scenarioId = resource.slice('scenarios/'.length, -'/revalidate'.length);
      const sc = coordinator.getScenarioRegistry().getScenario(scenarioId);
      if (!sc || sc.symbol !== symbol) return reply({ error: 'Escenario no encontrado' }, 404);
      const currentPrice = coordinator.getMarketState().ticker?.lastPrice || sc.targetEntry;
      coordinator.getAiRevalidation().revalidate(sc, currentPrice)
        .then(result => reply(result))
        .catch(err => {
          this.db.logEvent('ERROR', 'MarketApi', `Revalidation failed for ${symbol}: ${err?.message || err}`);
          reply({ error: 'No se pudo completar la revalidación' }, 503);
        });
      return;
    }
    if (req.method === 'POST' && resource === 'discovery/trigger') {
      if (!this.isAuthenticated(req)) {
        reply({ error: 'Autenticación requerida' }, 401);
        return;
      }
      coordinator.getAiDiscoveryEngine().runDiscovery({
        forceManual: true, triggerSource: 'MANUAL_TRIGGER',
      }).then(result => reply(result)).catch(err => {
        this.db.logEvent('ERROR', 'MarketApi', `Discovery failed for ${symbol}: ${err?.message || err}`);
        reply({ error: 'No se pudo completar el descubrimiento' }, 503);
      });
      return;
    }
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      reply({ error: 'Método no permitido' }, 405);
      return;
    }
    const limit = Math.max(1, Math.min(500, Number(url.searchParams.get('limit')) || 100));
    const state = coordinator.getMarketState();
    if (resource === 'state') return reply(state);
    if (resource === 'orderbook') return reply(state.orderBook);
    if (resource === 'instrument') return reply(coordinator.getInstrumentInfo());
    if (resource === 'analysis') return reply(coordinator.getAnalyses());
    if (resource === 'candles') {
      const timeframe = url.searchParams.get('timeframe') || '15m';
      if (!SUPPORTED_TIMEFRAMES.includes(timeframe as Timeframe)) {
        return reply({ error: 'Timeframe no permitido' }, 400);
      }
      return reply(coordinator.getCandles(timeframe as Timeframe, limit));
    }
    if (resource === 'scenarios') {
      return reply(coordinator.getScenarioRegistry().getAll({ limit }));
    }
    if (resource.startsWith('scenarios/')) {
      const id = resource.slice('scenarios/'.length);
      const scenario = coordinator.getScenarioRegistry().getScenario(id);
      if (!scenario || scenario.symbol !== symbol) return reply({ error: 'Escenario no encontrado' }, 404);
      return reply({
        scenario,
        lifecycle: coordinator.getScenarioRegistry().getLifecycle(id),
        revalidations: this.db.getScenarioRevalidations(id),
        discoveryAudit: this.db.getDiscoveryAudit(scenario.snapshotId),
        relatedDiscoveryAudits: this.db.getDiscoveryAuditsForScenario(id),
      });
    }
    if (resource === 'signals/active') return reply(coordinator.getSignalStateMachine().getActiveSignals());
    if (resource === 'signals') return reply(this.db.getSignals(limit, symbol));
    if (resource === 'watch-plans') return reply(this.db.getActiveWatchPlans(symbol));
    if (resource === 'scheduler') return reply(coordinator.getDiscoveryScheduler().getStatus());
    if (resource === 'market-intelligence') {
      if (!state.ticker) return reply({ error: 'Mercado sin datos suficientes' }, 503);
      return reply(coordinator.getAiDiscoveryEngine().getLatestSummary());
    }
    if (resource === 'audits') {
      return reply(this.db.getDiscoveryAudits(limit, symbol).map(({ snapshot, policy, ...record }) => record));
    }
    if (resource === 'stats') {
      const scenarios = this.db.getScenarios({ symbol });
      const signals = this.db.getSignals(500, symbol);
      const closed = signals.filter(s => s.simulatedEntryTime && s.exitTime);
      const realized = closed.reduce((sum, s) => sum + (Number(s.realizedNetR) || 0), 0);
      return reply({
        symbol,
        totalScenarios: scenarios.length,
        neutralObservations: scenarios.filter(s => s.direction === 'NEUTRAL').length,
        directionalScenarios: scenarios.filter(s => s.direction !== 'NEUTRAL').length,
        paperEntries: signals.filter(s => s.simulatedEntryTime).length,
        paperClosed: closed.length,
        netRRealized: Number(realized.toFixed(4)),
        note: 'Las estadísticas no prueban edge por sí mismas; incluyen el historial prospectivo.',
      });
    }
    reply({ error: 'Recurso no disponible' }, 404);
  }

  private sendHealth(res: http.ServerResponse): void {
    const state = this.coordinator.getMarketState();
    const uptimeSec = Math.floor((Date.now() - this.startTime) / 1000);
    const mem = process.memoryUsage();

    const healthData = {
      status: state.status,
      timestampUtc: new Date().toISOString(),
      timestampAr: new Date().toLocaleString('es-AR', { timeZone: config.timezone }),
      uptimeSeconds: uptimeSec,
      bybit: {
        symbol: state.symbol,
        wsConnected: state.wsConnected,
        wsLatencyMs: state.wsLatencyMs,
        lastMessageAgeMs: Date.now() - state.lastWsMessageTimestamp,
        gapsDetected: state.gapsDetectedCount,
      },
      lastClosedCandles: Object.fromEntries(
        SUPPORTED_TIMEFRAMES.map((tf) => [
          tf,
          state.lastClosedCandle[tf]
            ? {
              timestamp: state.lastClosedCandle[tf]?.timestamp,
              close: state.lastClosedCandle[tf]?.close,
              ageSeconds: Math.floor((Date.now() - (state.lastClosedCandle[tf]?.timestamp || 0)) / 1000),
            }
            : null,
        ])
      ),
      system: {
        memoryRssMb: Math.round(mem.rss / 1024 / 1024),
        memoryHeapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
        killSwitchActive: state.killSwitchActive,
      },
    };

    const statusCode = state.status === 'ERROR' ? 503 : 200;
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(healthData, null, 2));
  }

  private sendMarketState(res: http.ServerResponse): void {
    const state = this.coordinator.getMarketState();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, data: state }));
  }

  private sendCandles(res: http.ServerResponse, timeframe: Timeframe, limit: number): void {
    if (!SUPPORTED_TIMEFRAMES.includes(timeframe)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: `Invalid timeframe. Supported: ${SUPPORTED_TIMEFRAMES.join(', ')}`,
        })
      );
      return;
    }

    const candles = this.coordinator.getCandles(timeframe, Math.min(limit, 500));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, timeframe, count: candles.length, data: candles }));
  }

  private sendOrderBook(res: http.ServerResponse): void {
    const state = this.coordinator.getMarketState();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, data: state.orderBook }));
  }

  private sendInstrumentInfo(res: http.ServerResponse): void {
    const info = this.coordinator.getInstrumentInfo();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, data: info }));
  }

  private sendMarketAnalysis(res: http.ServerResponse): void {
    const analyses = this.coordinator.getAnalyses();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, data: analyses }));
  }

  private sendActiveSetups(res: http.ServerResponse, url?: URL): void {
    const historical = url?.searchParams?.get('historical') === 'true';
    if (historical) {
      const limit = parseInt(url?.searchParams?.get('limit') || '50', 10);
      const setups = this.db.getSetups(limit);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, count: setups.length, data: setups, isHistorical: true }));
      return;
    }

    // PR 4.1: Autonomous architecture consolidation.
    // Live operative setups originate exclusively from autonomous AI discovery scenarios (/api/v1/discovery/scenarios).
    // Historical setups remain queryable with ?historical=true for audit and compliance.
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        success: true,
        count: 0,
        data: [],
        notice:
          'Operative setups originate exclusively from autonomous AI discovery scenarios (/api/v1/discovery/scenarios). Historical records are accessible via ?historical=true.',
      })
    );
  }

  private sendEvents(res: http.ServerResponse, limit: number): void {
    const events = this.db.getRecentEvents(limit);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, count: events.length, data: events }));
  }

  private sendAiStatus(res: http.ServerResponse): void {
    const consensusEngine = this.coordinator.getConsensusEngine();
    const costTracker = consensusEngine.getCostTracker();
    const stats = costTracker.getStats();
    const currentMode = consensusEngine.getCurrentEvaluationMode();
    const lastMode = consensusEngine.getLastEvaluationMode();
    const hardBudgetManager = consensusEngine.getHardBudgetManager();
    const hardBudgetSummary = hardBudgetManager.getSummary();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        success: true,
        data: {
          currentMode,
          lastEvaluationMode: lastMode,
          isBudgetBlocked: hardBudgetSummary.isBlocked,
          budgetStatus: hardBudgetSummary.status,
          blockedReason: hardBudgetSummary.blockedReason,
          hardBudgetSummary,
          providers: {
            openai: consensusEngine.getOpenAiAdapter().getStatus(),
            gemini: consensusEngine.getGeminiAdapter().getStatus(),
          },
          fallbackPolicy: {
            activeMode: currentMode,
            modes: ['DUAL_AI', 'SINGLE_AI_OPENAI', 'SINGLE_AI_GEMINI', 'AI_UNAVAILABLE', 'AI_BUDGET_EXCEEDED'],
            rejectionsEnforced: true,
            minAiConfidence: 70,
            strictNetRR: 4.0,
            description:
              currentMode === 'DUAL_AI'
                ? 'Doble Consenso Activo (OpenAI + Gemini)'
                : currentMode === 'SINGLE_AI_OPENAI'
                  ? 'Fallback Activo: Operando con OpenAI (Gemini no disponible)'
                  : currentMode === 'SINGLE_AI_GEMINI'
                    ? 'Fallback Activo: Operando con Gemini (OpenAI no disponible)'
                    : currentMode === 'AI_BUDGET_EXCEEDED'
                      ? 'Límite Presupuestario de IA Excedido: Evaluaciones de IA suspendidas para proteger capital económico. Monitoreo Bybit activo.'
                      : 'Sin IAs disponibles: Monitoreo técnico Bybit activo, esperando disponibilidad',
          },
          costTracker: stats,
          consensusRule: 'Consenso Multimodal con Fallback Inteligente y Rechazo Estricto Inviolable',
          executionMode: 'SIGNALS_ONLY',
        },
      })
    );
  }

  private sendAiReviews(res: http.ServerResponse, setupId: string | null, limit: number): void {
    const reviews = this.db.getAiReviews(setupId || undefined, limit);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, count: reviews.length, data: reviews }));
  }

  private sendSignals(res: http.ServerResponse, limit: number): void {
    const signals = this.db.getSignals(limit, this.coordinator.getMarketState().symbol);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, count: signals.length, data: signals }));
  }

  private sendActiveSignals(res: http.ServerResponse): void {
    const active = this.coordinator.getSignalStateMachine().getActiveSignals();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, count: active.length, data: active }));
  }

  private sendSignalLifecycle(res: http.ServerResponse, signalId: string): void {
    if (!signalId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Falta signalId' }));
      return;
    }
    const history = this.db.getSignalLifecycle(signalId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, signalId, count: history.length, data: history }));
  }

  private handleCancelSignal(req: http.IncomingMessage, res: http.ServerResponse, signalId: string): void {
    if (!this.isAuthenticated(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No autorizado: se requiere clave administrativa' }));
      return;
    }
    try {
      const updated = this.coordinator.getSignalStateMachine().cancelSignal(signalId, 'CANCELLED_BY_ADMIN');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, data: updated }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  }

  private handleKillSwitch(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (!this.isAuthenticated(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No autorizado: se requiere clave administrativa' }));
      return;
    }

    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const active = payload.active === true;
        const reason = payload.reason || 'Acción manual desde panel de control';
        this.coordinator.setKillSwitch(active, reason);
        // A single emergency action must cover both symbol-isolated paper engines.
        // Share the global kill switch without sending duplicate Telegram alerts.
        if (active) {
          for (const market of this.markets.values()) {
            if (market !== this.coordinator) {
              market.getSignalStateMachine().cancelAll('KILL_SWITCH_ACTIVE');
            }
          }
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, killSwitchActive: active, reason }));
      } catch (err: any) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'JSON inválido' }));
      }
    });
  }

  private sendVapidPublicKey(res: http.ServerResponse): void {
    const key = this.coordinator.getWebPushNotifier().getPublicKey();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, publicKey: key }));
  }

  private handlePushSubscribe(req: http.IncomingMessage, res: http.ServerResponse): void {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        if (!payload.endpoint || !payload.keys?.p256dh || !payload.keys?.auth) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Suscripción inválida: faltan endpoint o keys' }));
          return;
        }
        this.coordinator.getWebPushNotifier().saveSubscription(payload);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: 'Suscripción Web Push registrada exitosamente' }));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'JSON inválido' }));
      }
    });
  }

  private handlePushUnsubscribe(req: http.IncomingMessage, res: http.ServerResponse): void {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        if (!payload.endpoint) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Falta endpoint' }));
          return;
        }
        this.coordinator.getWebPushNotifier().removeSubscription(payload.endpoint);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: 'Suscripción Web Push eliminada' }));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'JSON inválido' }));
      }
    });
  }

  private async handlePushTest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (!this.isAuthenticated(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No autorizado' }));
      return;
    }
    const result = await this.coordinator.getWebPushNotifier().sendTestPush();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, result }));
  }

  private async handleTelegramTest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (!this.isAuthenticated(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No autorizado' }));
      return;
    }
    const result = await this.coordinator.getTelegramNotifier().sendTestNotification();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  }

  private sendNotificationHistory(res: http.ServerResponse, limit: number): void {
    const history = this.db.getNotificationHistory(limit);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, count: history.length, data: history }));
  }

  private handleEvaluateSetup(req: http.IncomingMessage, res: http.ServerResponse): void {
    // 1. Authentication check
    if (!this.isAuthenticated(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ error: 'No autorizado: se requiere clave administrativa (x-admin-key o Bearer token)' })
      );
      return;
    }

    // PR 4.1: Autonomous architecture consolidation.
    // Legacy manual setup evaluation is permanently disabled with HTTP 410 Gone.
    // Reject immediately after authentication without budget checks, deduplication, body parsing, or AI calls.
    res.writeHead(410, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        error: 'LEGACY_EVALUATOR_DISABLED',
        message:
          'La evaluación manual de setups legados está deshabilitada en la arquitectura autónoma consolidada. Las oportunidades y señales operativas son gestionadas exclusivamente a través del ciclo autónomo (descubrimiento -> vigilancia -> revalidación).',
      })
    );
  }

  private parseJsonBody<T>(req: http.IncomingMessage, maxBytes = 50000): Promise<T> {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
        if (body.length > maxBytes) {
          req.destroy();
          reject(new Error('Payload demasiado grande'));
        }
      });
      req.on('end', () => {
        try {
          resolve(JSON.parse(body || '{}'));
        } catch {
          reject(new Error('Formato JSON inválido'));
        }
      });
      req.on('error', (err) => reject(err));
    });
  }

  // --- Auth Handlers ---

  private handleAuthStatus(req: http.IncomingMessage, res: http.ServerResponse): void {
    const auth = authManager.validateAuth(req);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        success: true,
        initialized: authManager.isInitialized(),
        authenticated: auth.valid,
        csrfToken: auth.session?.csrfToken || null,
      })
    );
  }

  private async handleAuthSetup(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || req.socket.remoteAddress || '127.0.0.1';
    try {
      if (authManager.isInitialized()) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'El administrador ya se encuentra inicializado en el sistema.' }));
        return;
      }
      const payload = await this.parseJsonBody<{ password?: string }>(req);
      if (!payload.password) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'La nueva clave administrativa es requerida' }));
        return;
      }
      const result = authManager.setupInitialAdmin(payload.password, clientIp);
      if (result.success && result.token) {
        const isSecure = req.headers['x-forwarded-proto'] === 'https';
        const cookieFlags = `Path=/; HttpOnly; SameSite=Lax; Max-Age=43200${isSecure ? '; Secure' : ''}`;
        res.setHeader('Set-Cookie', `nanolabs_admin_session=${result.token}; ${cookieFlags}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            success: true,
            token: result.token,
            csrfToken: result.csrfToken,
            expiresAt: result.expiresAt,
            message: 'Administrador configurado exitosamente',
          })
        );
      } else {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: result.error || 'Error en configuración inicial' }));
      }
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message || 'Error en configuración inicial' }));
    }
  }

  private async handleAuthLogin(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || req.socket.remoteAddress || '127.0.0.1';
    try {
      const payload = await this.parseJsonBody<{ key?: string }>(req);
      if (!payload.key) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'La clave de administración es obligatoria' }));
        return;
      }
      const result = authManager.login(payload.key, clientIp);
      if (result.success && result.token) {
        this.db.logConfigAudit({
          category: 'AUTH',
          action: 'LOGIN_SUCCESS',
          details: { clientIp },
          ipAddress: clientIp,
        });
        const isSecure = req.headers['x-forwarded-proto'] === 'https';
        const cookieFlags = `Path=/; HttpOnly; SameSite=Lax; Max-Age=43200${isSecure ? '; Secure' : ''}`;
        res.setHeader('Set-Cookie', `nanolabs_admin_session=${result.token}; ${cookieFlags}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            success: true,
            token: result.token,
            csrfToken: result.csrfToken,
            expiresAt: result.expiresAt,
          })
        );
      } else {
        this.db.logConfigAudit({
          category: 'AUTH',
          action: 'LOGIN_FAILED',
          details: { clientIp, error: result.error },
          ipAddress: clientIp,
        });
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            success: false,
            error: result.error,
            lockedUntil: result.lockedUntil,
            requiresSetup: result.requiresSetup,
            isRevoked: result.isRevoked,
          })
        );
      }
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message || 'Error en autenticación' }));
    }
  }

  private handleAuthVerify(req: http.IncomingMessage, res: http.ServerResponse): void {
    const auth = authManager.validateAuth(req);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        success: true,
        authenticated: auth.valid,
        csrfToken: auth.session?.csrfToken || null,
        reason: auth.reason,
      })
    );
  }

  private async handleAuthLogout(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const authHeader = (req.headers['authorization'] as string) || '';
    const tokenFromHeader = authHeader.replace(/^Bearer\s+/i, '').trim();
    let tokenFromBody = '';
    try {
      const payload = await this.parseJsonBody<{ token?: string }>(req);
      tokenFromBody = payload.token || '';
    } catch { }
    authManager.logout(tokenFromHeader || tokenFromBody, req);
    res.setHeader('Set-Cookie', 'nanolabs_admin_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, message: 'Sesión cerrada correctamente' }));
  }

  // --- Risk Policy Handlers ---

  private sendRiskPolicy(res: http.ServerResponse): void {
    const policy = this.coordinator.getRiskPolicyManager().getPolicy();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, data: policy }));
  }

  private async handleUpdateRiskPolicy(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || req.socket.remoteAddress || '127.0.0.1';
    if (!this.isAuthenticated(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No autorizado: se requiere autenticación de administrador' }));
      return;
    }
    try {
      const updates = await this.parseJsonBody<any>(req);
      const updated = this.coordinator.getRiskPolicyManager().updatePolicy(updates);
      this.db.saveRiskPolicy(updated);
      this.db.logConfigAudit({
        category: 'RISK_POLICY',
        action: 'UPDATE',
        details: updates,
        ipAddress: clientIp,
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, data: updated }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message || 'Error actualizando política de riesgo' }));
    }
  }

  private async handleCalculateRisk(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      const payload = await this.parseJsonBody<any>(req);
      const result = RiskCalculator.calculateInteractive(payload);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, data: result }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message || 'Error en cálculo interactivo de riesgo' }));
    }
  }

  // --- Bybit Credentials Handlers ---

  private sendBybitConfig(res: http.ServerResponse): void {
    const sanitized = this.coordinator.getBybitCredentialsManager().getSanitizedView();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, data: sanitized }));
  }

  private async handleSaveBybitConfig(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || req.socket.remoteAddress || '127.0.0.1';
    if (!this.isAuthenticated(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No autorizado: se requiere autenticación de administrador' }));
      return;
    }
    try {
      const payload = await this.parseJsonBody<any>(req);
      const { apiKey, apiSecret, environment } = payload;
      if (!apiKey || !apiSecret) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'apiKey y apiSecret son requeridos' }));
        return;
      }
      const result = await this.coordinator.getBybitCredentialsManager().saveCredentials(apiKey.trim(), apiSecret.trim(), environment || 'mainnet');
      this.db.saveBybitCredentials(result);
      this.db.logConfigAudit({
        category: 'BYBIT_CREDENTIALS',
        action: 'SAVE',
        details: { environment: result.environment, apiKeyMasked: maskSecret(apiKey.trim()), permissions: result.detectedPermissions, warning: result.verificationWarning },
        ipAddress: clientIp,
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, data: result, warning: result.verificationWarning }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message || 'Error guardando credenciales Bybit' }));
    }
  }

  private handleDeleteBybitConfig(req: http.IncomingMessage, res: http.ServerResponse): void {
    const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || req.socket.remoteAddress || '127.0.0.1';
    if (!this.isAuthenticated(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No autorizado: se requiere autenticación de administrador' }));
      return;
    }
    this.coordinator.getBybitCredentialsManager().revokeCredentials();
    this.db.logConfigAudit({
      category: 'BYBIT_CREDENTIALS',
      action: 'REVOKE',
      details: { reason: 'Revocadas por administrador' },
      ipAddress: clientIp,
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, message: 'Credenciales Bybit revocadas correctamente' }));
  }

  private async handleTestBybitConfig(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || req.socket.remoteAddress || '127.0.0.1';
    if (!this.isAuthenticated(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No autorizado: se requiere autenticación de administrador' }));
      return;
    }
    try {
      const payload = await this.parseJsonBody<any>(req);
      const { apiKey, apiSecret, environment } = payload;
      if (!apiKey || !apiSecret) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'apiKey y apiSecret son requeridos' }));
        return;
      }
      const result = await this.coordinator.getBybitCredentialsManager().verifyAndEnforceReadOnly(apiKey.trim(), apiSecret.trim(), environment || 'mainnet');
      if (!result.valid) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: result.error, data: result }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, data: result }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message || 'Error verificando API key de Bybit' }));
    }
  }

  // --- AI Router & Credentials Handlers ---

  private sendAiRouterConfig(res: http.ServerResponse): void {
    const routerConfig = this.coordinator.getAiRouter().getConfig();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, data: { routerConfig, modelsCatalog: AI_MODELS_CATALOG } }));
  }

  private async handleUpdateAiRouterConfig(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || req.socket.remoteAddress || '127.0.0.1';
    if (!this.isAuthenticated(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No autorizado: se requiere autenticación de administrador' }));
      return;
    }
    try {
      const updates = await this.parseJsonBody<any>(req);
      const updated = this.coordinator.getAiRouter().updateConfig(updates);
      this.db.saveRouterConfig(updated);
      this.db.logConfigAudit({
        category: 'AI_ROUTER',
        action: 'UPDATE',
        details: updates,
        ipAddress: clientIp,
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, data: updated }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message || 'Error actualizando router IA' }));
    }
  }

  private sendAiCredentials(res: http.ServerResponse): void {
    const openai = this.db.getAiCredentials('openai');
    const gemini = this.db.getAiCredentials('gemini');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        success: true,
        data: {
          openai: openai
            ? { provider: 'openai', configured: true, apiKeyMasked: openai.apiKeyMasked, model: openai.model, status: openai.status || 'CONFIGURED', lastVerifiedAt: openai.lastVerifiedAt }
            : { provider: 'openai', configured: !!config.ai.openaiApiKey, apiKeyMasked: config.ai.openaiApiKey ? maskSecret(config.ai.openaiApiKey) : null, model: config.ai.openaiModel, status: config.ai.openaiApiKey ? 'CONFIGURED' : 'UNCONFIGURED' },
          gemini: gemini
            ? { provider: 'gemini', configured: true, apiKeyMasked: gemini.apiKeyMasked, model: gemini.model, status: gemini.status || 'CONFIGURED', lastVerifiedAt: gemini.lastVerifiedAt }
            : { provider: 'gemini', configured: !!config.ai.geminiApiKey, apiKeyMasked: config.ai.geminiApiKey ? maskSecret(config.ai.geminiApiKey) : null, model: config.ai.geminiModel, status: config.ai.geminiApiKey ? 'CONFIGURED' : 'UNCONFIGURED' },
        },
      })
    );
  }

  private async handleSaveAiCredentials(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || req.socket.remoteAddress || '127.0.0.1';
    if (!this.isAuthenticated(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No autorizado: se requiere autenticación de administrador' }));
      return;
    }
    try {
      const payload = await this.parseJsonBody<any>(req);
      const { provider, apiKey, model } = payload;
      if (!provider || !apiKey) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'provider y apiKey son requeridos' }));
        return;
      }
      const providerNorm = provider.toLowerCase();
      if (providerNorm !== 'openai' && providerNorm !== 'gemini') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Provider debe ser "openai" o "gemini"' }));
        return;
      }
      const trimmedApiKey = apiKey.trim();
      const encryptedSecret = encryptSecret(trimmedApiKey);
      const apiKeyMasked = maskSecret(trimmedApiKey);
      const validatedModel = getValidatedModel(
        model || (providerNorm === 'openai' ? 'gpt-4o' : 'gemini-2.0-flash'),
        providerNorm.toUpperCase() as any
      );
      this.db.saveAiCredentials({
        provider: providerNorm,
        apiKeyMasked,
        encryptedSecret,
        model: validatedModel,
        status: 'CONFIGURED',
      });
      // Dynamically update adapter credentials in memory immediately
      this.coordinator.getConsensusEngine().updateAiCredentials(
        providerNorm as 'openai' | 'gemini',
        trimmedApiKey,
        validatedModel,
        payload.reasoningEffort
      );
      this.db.logConfigAudit({
        category: 'AI_CREDENTIALS',
        action: 'SAVE',
        details: { provider: providerNorm, model, apiKeyMasked },
        ipAddress: clientIp,
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, message: `Credenciales de ${providerNorm} guardadas correctamente` }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message || 'Error guardando credenciales IA' }));
    }
  }

  private handleDeleteAiCredentials(req: http.IncomingMessage, res: http.ServerResponse, provider: string): void {
    const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || req.socket.remoteAddress || '127.0.0.1';
    if (!this.isAuthenticated(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No autorizado: se requiere autenticación de administrador' }));
      return;
    }
    const providerNorm = provider.toLowerCase();
    this.db.deleteAiCredentials(providerNorm);
    this.coordinator.getConsensusEngine().updateAiCredentials(
      providerNorm as 'openai' | 'gemini',
      '',
      ''
    );
    this.db.logConfigAudit({
      category: 'AI_CREDENTIALS',
      action: 'DELETE',
      details: { provider: providerNorm },
      ipAddress: clientIp,
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, message: `Credenciales de ${providerNorm} eliminadas correctamente` }));
  }

  private async handleGetGeminiModels(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // Never accept API keys in GET query parameters (they leak to access logs).
    let apiKey = '';

    if (!apiKey) {
      const saved = this.db.getAiCredentials('gemini');
      if (saved?.encryptedSecret) {
        try {
          apiKey = decryptSecret(saved.encryptedSecret) || '';
        } catch { }
      }
      if (!apiKey) {
        apiKey = config.ai.geminiApiKey || '';
      }
    }
    apiKey = apiKey.trim();

    const staticModels = Object.values(AI_MODELS_CATALOG)
      .filter((m) => m.provider === 'GEMINI' && m.status === 'ACTIVE')
      .map((m) => ({
        id: m.id,
        name: `models/${m.id}`,
        displayName: m.displayName,
        description: m.costNote,
        isDefault: m.isDefault,
        isRecommended: m.id === 'gemini-2.0-flash' || m.id === 'gemini-1.5-flash' || m.id === 'gemini-1.5-pro',
      }));

    if (!apiKey) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, live: false, models: staticModels }));
      return;
    }

    try {
      const googleRes = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models',
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
          },
          signal: AbortSignal.timeout(10000),
        }
      );

      if (!googleRes.ok) {
        const errText = await googleRes.text();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            success: false,
            live: false,
            error: `Google API (${googleRes.status}): ${errText.slice(0, 150)}`,
            models: staticModels,
          })
        );
        return;
      }

      const data: any = await googleRes.json();
      const rawModels: any[] = data.models || [];
      const contentModels = rawModels
        .filter((m) => {
          const methods: string[] = m.supportedGenerationMethods || [];
          return methods.includes('generateContent');
        })
        .map((m) => {
          const id = m.name.replace(/^models\//, '');
          const catalogEntry = AI_MODELS_CATALOG[id];
          return {
            id,
            name: m.name,
            displayName: m.displayName || catalogEntry?.displayName || id,
            description: m.description || catalogEntry?.costNote || '',
            inputTokenLimit: m.inputTokenLimit,
            outputTokenLimit: m.outputTokenLimit,
            isDefault: id === 'gemini-2.0-flash',
            isRecommended:
              id === 'gemini-2.0-flash' ||
              id === 'gemini-2.0-flash-lite' ||
              id === 'gemini-1.5-flash' ||
              id === 'gemini-1.5-pro',
          };
        })
        .sort((a, b) => {
          if (a.isDefault) return -1;
          if (b.isDefault) return 1;
          if (a.isRecommended && !b.isRecommended) return -1;
          if (!a.isRecommended && b.isRecommended) return 1;
          return a.displayName.localeCompare(b.displayName);
        });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          success: true,
          live: true,
          models: contentModels.length > 0 ? contentModels : staticModels,
        })
      );
    } catch (err: any) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          success: false,
          live: false,
          error: err.message || 'Error consultando modelos a Google',
          models: staticModels,
        })
      );
    }
  }

  private async handleTestAiConnection(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || req.socket.remoteAddress || '127.0.0.1';
    if (!this.isAuthenticated(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No autorizado: se requiere autenticación de administrador' }));
      return;
    }

    try {
      const payload = await this.parseJsonBody<{
        provider?: string;
        model?: string;
        apiKey?: string;
        reasoningEffort?: string;
      }>(req);

      const provider = (payload.provider || '').toLowerCase();
      if (provider !== 'openai' && provider !== 'gemini') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'El proveedor debe ser "openai" o "gemini"' }));
        return;
      }

      // 1. Resolve API key
      let apiKeyToUse = (payload.apiKey || '').trim();
      if (!apiKeyToUse) {
        const saved = this.db.getAiCredentials(provider);
        if (saved?.encryptedSecret) {
          try {
            apiKeyToUse = decryptSecret(saved.encryptedSecret) || '';
          } catch { }
        }
        if (!apiKeyToUse) {
          apiKeyToUse = provider === 'openai' ? (config.ai.openaiApiKey || '') : (config.ai.geminiApiKey || '');
        }
      }

      if (!apiKeyToUse) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            success: false,
            valid: false,
            provider,
            error: `No hay clave API configurada ni provista para ${provider}.`,
            status: 'UNCONFIGURED',
          })
        );
        return;
      }

      const modelToTest = payload.model || (provider === 'openai' ? 'gpt-4o' : 'gemini-2.0-flash');
      const hardBudget = this.coordinator.getConsensusEngine().getHardBudgetManager();

      // 2. Budget Reservation check (Connection tests consume real money/tokens!)
      const worstCase = hardBudget.estimateWorstCaseCost(modelToTest, 500, 150);
      const reservation = hardBudget.reserveBudget({
        provider: provider.toUpperCase() as any,
        model: modelToTest,
        task: 'CONNECTION_TEST',
        maxEstimatedCostUsd: worstCase,
      });

      if (!reservation.allowed) {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            success: false,
            valid: false,
            provider,
            model: modelToTest,
            error: reservation.reason || 'Límite presupuestario de IA alcanzado. Prueba de conexión cancelada.',
            status: 'AI_BUDGET_EXCEEDED',
          })
        );
        return;
      }

      // 3. Execute Real Live API Call
      const startTime = Date.now();
      let testSuccess = false;
      let testError: string | null = null;
      let errorCode: string | null = null;
      let tokensPrompt = 0;
      let tokensCompletion = 0;
      let tokensCached = 0;
      let reasoningTokens = 0;
      let latencyMs = 0;
      let costUsd = 0;
      let providerStatus = 'UNAVAILABLE';
      let parsedResponse: any = null;

      try {
        if (provider === 'openai') {
          const reqBody: any = {
            model: modelToTest,
            messages: [
              { role: 'system', content: 'You are NanoLabs AI Connection Verifier. Output JSON only.' },
              {
                role: 'user',
                content: `Respond with exact JSON: {"status":"ok","ping":true,"model":"${modelToTest}","timestamp":${Date.now()}}`,
              },
            ],
            response_format: { type: 'json_object' },
            max_tokens: 100,
          };

          if (modelToTest.includes('o1') || modelToTest.includes('o3') || modelToTest.includes('luna')) {
            delete reqBody.response_format;
            reqBody.max_completion_tokens = 150;
            delete reqBody.max_tokens;
            if (payload.reasoningEffort) {
              reqBody.reasoning_effort = payload.reasoningEffort;
            }
          }

          const apiRes = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiKeyToUse}`,
            },
            body: JSON.stringify(reqBody),
            signal: AbortSignal.timeout(15000),
          });

          latencyMs = Date.now() - startTime;
          const rawText = await apiRes.text();
          let jsonRes: any = {};
          try {
            jsonRes = JSON.parse(rawText);
          } catch { }

          if (!apiRes.ok) {
            errorCode = jsonRes.error?.code || jsonRes.error?.type || `HTTP_${apiRes.status}`;
            testError = jsonRes.error?.message || `Error HTTP ${apiRes.status}: ${rawText.slice(0, 150)}`;
            providerStatus = apiRes.status === 401 ? 'AUTH_ERROR' : apiRes.status === 429 ? 'RATE_LIMITED' : 'UNAVAILABLE';
          } else {
            tokensPrompt = jsonRes.usage?.prompt_tokens || 0;
            tokensCompletion = jsonRes.usage?.completion_tokens || 0;
            tokensCached = jsonRes.usage?.prompt_tokens_details?.cached_tokens || 0;
            reasoningTokens = jsonRes.usage?.completion_tokens_details?.reasoning_tokens || 0;
            const content = jsonRes.choices?.[0]?.message?.content || '{}';
            try {
              parsedResponse = JSON.parse(content);
            } catch {
              parsedResponse = { raw: content };
            }
            costUsd = calculateCallCost(modelToTest, {
              promptTokens: tokensPrompt,
              completionTokens: tokensCompletion,
              cachedTokens: tokensCached,
              reasoningTokens,
            });
            testSuccess = true;
            providerStatus = 'VERIFIED';
          }
        } else {
          // Gemini
          const trimmedKey = apiKeyToUse.trim();
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelToTest)}:generateContent?key=${encodeURIComponent(trimmedKey)}`;
          const geminiReqBody = {
            contents: [
              {
                role: 'user',
                parts: [{ text: `Respond with exact JSON only: {"status":"ok","ping":true,"model":"${modelToTest}","timestamp":${Date.now()}}` }],
              },
            ],
            generationConfig: {
              responseMimeType: 'application/json',
              maxOutputTokens: 100,
            },
          };

          const apiRes = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-goog-api-key': trimmedKey,
            },
            body: JSON.stringify(geminiReqBody),
            signal: AbortSignal.timeout(15000),
          });

          latencyMs = Date.now() - startTime;
          const rawText = await apiRes.text();
          let jsonRes: any = {};
          try {
            jsonRes = JSON.parse(rawText);
          } catch { }

          if (!apiRes.ok) {
            errorCode = jsonRes.error?.status || `HTTP_${apiRes.status}`;
            const rawMsg = jsonRes.error?.message || `Error HTTP ${apiRes.status}: ${rawText.slice(0, 150)}`;
            const errorReason = jsonRes.error?.details?.[0]?.reason;
            const isAuthError =
              apiRes.status === 401 ||
              apiRes.status === 403 ||
              (apiRes.status === 400 && (
                errorReason === 'API_KEY_INVALID' ||
                /api key not valid|key not valid|api_key_invalid/i.test(rawMsg) ||
                /api key not valid|key not valid/i.test(rawText)
              ));

            if (isAuthError) {
              providerStatus = 'AUTH_ERROR';
              testError = `Clave de API inválida (${rawMsg}). Verifique que la clave de Gemini provenga de Google AI Studio (https://aistudio.google.com/app/apikey) y comience con 'AIzaSy...'.`;
            } else if (apiRes.status === 404 || /not found|models\//i.test(rawMsg)) {
              providerStatus = 'MODEL_NOT_FOUND';
              testError = `El modelo '${modelToTest}' no está disponible o no existe en la API de Gemini (${rawMsg}). Modelos recomendados: gemini-2.0-flash, gemini-1.5-flash, gemini-1.5-pro.`;
            } else if (apiRes.status === 429 || /quota|resource_exhausted/i.test(rawMsg)) {
              providerStatus = 'RATE_LIMITED';
              testError = `Límite de cuota alcanzado en Google Gemini (${rawMsg}).`;
            } else {
              providerStatus = 'UNAVAILABLE';
              testError = rawMsg;
            }
          } else {
            tokensPrompt = jsonRes.usageMetadata?.promptTokenCount || 0;
            tokensCompletion = jsonRes.usageMetadata?.candidatesTokenCount || 0;
            tokensCached = jsonRes.usageMetadata?.cachedContentTokenCount || 0;
            const content = jsonRes.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
            try {
              parsedResponse = JSON.parse(content);
            } catch {
              parsedResponse = { raw: content };
            }
            costUsd = calculateCallCost(modelToTest, {
              promptTokens: tokensPrompt,
              completionTokens: tokensCompletion,
              cachedTokens: tokensCached,
              reasoningTokens: 0,
            });
            testSuccess = true;
            providerStatus = 'VERIFIED';
          }
        }
      } catch (callErr: any) {
        latencyMs = Date.now() - startTime;
        const isTimeout = callErr.name === 'TimeoutError' || callErr.message?.toLowerCase().includes('timeout');
        errorCode = isTimeout ? 'TIMEOUT' : callErr.code || 'NETWORK_ERROR';
        testError = callErr.message || 'Error de conexión con el proveedor de IA';
        providerStatus = isTimeout ? 'DEGRADED' : 'UNAVAILABLE';
      }

      // 4. Reconcile reservation
      hardBudget.reconcileReservation(reservation.reservationId!, {
        provider: provider.toUpperCase() as any,
        model: modelToTest,
        task: 'CONNECTION_TEST',
        promptTokens: tokensPrompt,
        completionTokens: tokensCompletion,
        cachedTokens: tokensCached,
        reasoningTokens,
        costUsd: testSuccess ? costUsd : 0,
        status: testSuccess ? 'SUCCESS' : 'ERROR',
        latencyMs,
      });

      // 5. Update DB credential status and adapter in memory
      if (testSuccess) {
        this.db.saveAiCredentials({
          provider,
          apiKeyMasked: maskSecret(apiKeyToUse),
          encryptedSecret: encryptSecret(apiKeyToUse),
          model: modelToTest,
          status: 'VERIFIED',
        });
        this.coordinator.getConsensusEngine().updateAiCredentials(
          provider as 'openai' | 'gemini',
          apiKeyToUse.trim(),
          modelToTest,
          payload.reasoningEffort as any
        );
      }

      this.db.logConfigAudit({
        category: 'AI_CONNECTION_TEST',
        action: testSuccess ? 'TEST_SUCCESS' : 'TEST_FAILED',
        details: { provider, model: modelToTest, latencyMs, costUsd, error: testError, errorCode, status: providerStatus },
        ipAddress: clientIp,
      });

      res.writeHead(testSuccess ? 200 : 400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          success: testSuccess,
          valid: testSuccess,
          provider,
          model: modelToTest,
          latencyMs,
          tokensPrompt,
          tokensCompletion,
          tokensCached,
          reasoningTokens,
          costUsd: parseFloat(costUsd.toFixed(6)),
          status: providerStatus,
          parsedResponse,
          error: testError,
          errorCode,
        })
      );
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message || 'Fallo interno en prueba de conexión IA' }));
    }
  }

  // --- Hard Budget Handlers ---

  private sendBudgetConfig(res: http.ServerResponse): void {
    const hardBudgetManager = this.coordinator.getConsensusEngine().getHardBudgetManager();
    const summary = hardBudgetManager.getSummary();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, data: summary }));
  }

  private async handleUpdateBudgetConfig(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || req.socket.remoteAddress || '127.0.0.1';
    if (!this.isAuthenticated(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No autorizado: se requiere autenticación de administrador' }));
      return;
    }
    try {
      const updates = await this.parseJsonBody<any>(req);
      const hardBudgetManager = this.coordinator.getConsensusEngine().getHardBudgetManager();
      const updated = hardBudgetManager.updateConfig(updates);
      this.db.saveHardBudgetConfig(updated);
      this.db.logConfigAudit({
        category: 'HARD_BUDGET',
        action: 'UPDATE',
        details: updates,
        ipAddress: clientIp,
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, data: hardBudgetManager.getSummary() }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message || 'Error actualizando presupuesto duro' }));
    }
  }

  private async handleReactivateBudget(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || req.socket.remoteAddress || '127.0.0.1';
    if (!this.isAuthenticated(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No autorizado: se requiere autenticación de administrador' }));
      return;
    }
    try {
      const payload = await this.parseJsonBody<{ newDailyLimitUsd?: number }>(req).catch(() => ({} as any));
      const hardBudgetManager = this.coordinator.getConsensusEngine().getHardBudgetManager();
      hardBudgetManager.reactivateBudget('admin', payload?.newDailyLimitUsd);
      this.db.saveHardBudgetConfig(hardBudgetManager.getConfig());
      this.db.logConfigAudit({
        category: 'HARD_BUDGET',
        action: 'REACTIVATE',
        details: { reactivatedBy: 'admin', newDailyLimitUsd: payload?.newDailyLimitUsd, ipAddress: clientIp },
        ipAddress: clientIp,
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          success: true,
          message: 'Presupuesto de IA reactivado correctamente. Evaluaciones habilitadas.',
          data: hardBudgetManager.getSummary(),
        })
      );
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message || 'Error reactivando presupuesto' }));
    }
  }

  private async handleVerifyOpenAiFreeTier(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || req.socket.remoteAddress || '127.0.0.1';
    if (!this.isAuthenticated(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No autorizado: se requiere autenticación de administrador' }));
      return;
    }

    try {
      const payload = await this.parseJsonBody<{
        forceVerify?: boolean;
        adminDeclaration?: boolean;
        dataSharingConfirmed?: boolean;
        billingEvidenceDetails?: string;
        reconcileUsage?: {
          mainGroupUsedTokens?: number;
          smallGroupUsedTokens?: number;
        };
        organizationId?: string;
      }>(req).catch(() => ({} as any));

      const hardBudgetManager = this.coordinator.getConsensusEngine().getHardBudgetManager();
      const currentConfig = hardBudgetManager.getConfig();

      // Resolve OpenAI API Key
      let apiKeyToUse = '';
      const saved = this.db.getAiCredentials('openai');
      if (saved?.encryptedSecret) {
        try {
          apiKeyToUse = decryptSecret(saved.encryptedSecret) || '';
        } catch {}
      }
      if (!apiKeyToUse) {
        apiKeyToUse = config.ai.openaiApiKey || '';
      }

      if (!apiKeyToUse) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            success: false,
            verified: false,
            error: 'No hay clave API de OpenAI configurada. Ingrese y guarde su clave API antes de verificar el programa de tokens gratuitos.',
          })
        );
        return;
      }

      // 1. Check OpenAI API connectivity & models (Verificación de clave y conectividad)
      let apiKeyValid = false;
      let lastVerificationError: string | null = null;
      let orgId = payload.organizationId || null;

      try {
        const response = await fetch('https://api.openai.com/v1/models', {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${apiKeyToUse.trim()}`,
            ...(orgId ? { 'OpenAI-Organization': orgId } : {}),
          },
        });

        if (response.ok) {
          apiKeyValid = true;
          const headerOrg = response.headers.get('openai-organization');
          if (headerOrg) orgId = headerOrg;
        } else {
          const errData: any = await response.json().catch(() => ({}));
          lastVerificationError = errData.error?.message || `HTTP ${response.status}: Error verificando acceso en OpenAI`;
        }
      } catch (err: any) {
        lastVerificationError = err.message || 'Error de red conectando con OpenAI API';
      }

      if (!apiKeyValid) {
        const updatedConfig = hardBudgetManager.updateConfig({
          openaiFreeTier: {
            ...currentConfig.openaiFreeTier,
            verified: false,
            verificationStatus: 'UNVERIFIED',
            lastVerificationError,
          },
        });
        this.db.saveHardBudgetConfig(updatedConfig);
        this.db.logConfigAudit({
          category: 'OPENAI_FREE_TIER',
          action: 'VERIFY_FAILED',
          details: { error: lastVerificationError, ipAddress: clientIp },
          ipAddress: clientIp,
        });

        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            success: false,
            verified: false,
            error: lastVerificationError || 'No se pudo verificar el acceso a la API de OpenAI.',
            data: hardBudgetManager.getSummary().openaiFreeTier,
          })
        );
        return;
      }

      // 2. Distinguir Verificación Oficial de Facturación vs Declaración Administrativa
      // "El endpoint verify-free-tier no debe marcar el beneficio como confirmado simplemente porque una API Key funciona o un modelo responde."
      let verificationStatus: 'UNVERIFIED' | 'DECLARED_BY_ADMIN' | 'CONFIRMED_BILLED' = 'UNVERIFIED';
      let isGlobalUsageEstimated = true;
      let message = '';
      let reconciliationSource: 'LOCAL_ESTIMATE' | 'OPENAI_USAGE_API' | 'ADMIN_DECLARATION' = 'LOCAL_ESTIMATE';

      // Check if billing evidence is explicitly provided
      if (payload.billingEvidenceDetails) {
        // Client-provided text is not independently verified API billing evidence.
        verificationStatus = 'DECLARED_BY_ADMIN';
        isGlobalUsageEstimated = true;
        reconciliationSource = 'ADMIN_DECLARATION';
        message = 'Se registró evidencia declarada por el administrador. Los descuentos siguen siendo ESTIMADOS hasta verificar facturación oficial.';
      } else if (payload.adminDeclaration || payload.dataSharingConfirmed || payload.forceVerify) {
        verificationStatus = 'DECLARED_BY_ADMIN';
        isGlobalUsageEstimated = true;
        reconciliationSource = 'ADMIN_DECLARATION';
        message = 'Inscripción en programa Data Sharing confirmada por declaración administrativa tras revisión del panel oficial de OpenAI. Los descuentos se registran como ESTIMADOS hasta contar con evidencia de facturación.';
      } else {
        // Just tested the key, not declared yet
        verificationStatus = 'UNVERIFIED';
        isGlobalUsageEstimated = true;
        message = 'Clave API de OpenAI válida y operativa. La activación de tokens gratuitos requiere confirmación administrativa de inscripción en OpenAI (Settings > Data Sharing).';
      }

      // Reconcile external usage if provided
      if (payload.reconcileUsage) {
        hardBudgetManager.reconcileOrganizationalUsage({
          mainGroupUsedTokens: payload.reconcileUsage.mainGroupUsedTokens,
          smallGroupUsedTokens: payload.reconcileUsage.smallGroupUsedTokens,
          source: reconciliationSource,
          evidenceDetails: payload.billingEvidenceDetails,
          verifiedBilled: false,
        });
      }

      const isVerified = verificationStatus !== 'UNVERIFIED';

      const updatedConfig = hardBudgetManager.updateConfig({
        openaiFreeTier: {
          ...currentConfig.openaiFreeTier,
          enabled: isVerified || !!currentConfig.openaiFreeTier.enabled,
          verified: isVerified,
          verificationStatus,
          isGlobalUsageEstimated,
          verifiedAt: isVerified ? Date.now() : null,
          reconciledAt: Date.now(),
          reconciliationSource,
          billingEvidenceDetails: payload.billingEvidenceDetails || currentConfig.openaiFreeTier.billingEvidenceDetails,
          lastVerificationError: null,
          participatingOrganizationId: orgId,
          dataSharingConsentConfirmed: payload.dataSharingConfirmed ?? (verificationStatus !== 'UNVERIFIED'),
        },
      });

      this.db.saveHardBudgetConfig(updatedConfig);
      this.db.logConfigAudit({
        category: 'OPENAI_FREE_TIER',
        action: isVerified ? 'DECLARED_BY_ADMIN' : 'API_KEY_VALID_UNVERIFIED_TIER',
        details: { orgId, verificationStatus, isGlobalUsageEstimated, ipAddress: clientIp },
        ipAddress: clientIp,
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          success: true,
          verified: isVerified,
          verificationStatus,
          isGlobalUsageEstimated,
          message,
          data: hardBudgetManager.getSummary().openaiFreeTier,
        })
      );
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message || 'Error interno en verificación de tokens gratuitos' }));
    }
  }

  private sendAiConsumption(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const limit = parseInt(url.searchParams.get('limit') || '50', 10);
    const provider = url.searchParams.get('provider') || undefined;
    const stats = this.db.getAiConsumptionStats();
    const logs = this.db.getAiConsumptionLogs(limit, provider);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, data: { stats, logs } }));
  }

  private handleExportAiConsumption(res: http.ServerResponse): void {
    const logs = this.db.getAiConsumptionLogs(5000);
    const headers = ['id', 'timestamp', 'timestamp_iso', 'provider', 'model', 'task', 'tokens_prompt', 'tokens_completion', 'tokens_cached', 'cost_usd', 'latency_ms', 'status', 'analysis_id'];
    const rows = logs.map((l) => [
      l.id,
      l.timestamp,
      new Date(l.timestamp).toISOString(),
      `"${l.provider}"`,
      `"${l.model}"`,
      `"${l.task}"`,
      l.tokensPrompt,
      l.tokensCompletion,
      l.tokensCached,
      l.costUsd.toFixed(6),
      l.latencyMs,
      `"${l.status}"`,
      l.analysisId ? `"${l.analysisId}"` : '""',
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="ai-consumption.csv"',
    });
    res.end(csv);
  }

  // --- Audit & Summary Handlers ---

  private sendConfigAudit(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (!this.isAuthenticated(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No autorizado: se requiere autenticación de administrador' }));
      return;
    }
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const limit = parseInt(url.searchParams.get('limit') || '50', 10);
    const logs = this.db.getConfigAuditLogs(limit);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, count: logs.length, data: logs }));
  }

  private sendConfigSummary(res: http.ServerResponse): void {
    const routerCfg = this.coordinator.getAiRouter().getConfig();
    const riskPolicy = this.coordinator.getRiskPolicyManager().getPolicy();
    const bybitView = this.coordinator.getBybitCredentialsManager().getSanitizedView();
    const stats = this.db.getAiConsumptionStats();
    const openai = this.db.getAiCredentials('openai');
    const gemini = this.db.getAiCredentials('gemini');
    const hardBudgetSummary = this.coordinator.getConsensusEngine().getHardBudgetManager().getSummary();
    const consumptionStats = this.db.getAiConsumptionStats();

    const lifetimeGrossSpendUsd = Number(consumptionStats.totalGrossSpendUsd ?? 0);
    const lifetimeNetSpendUsd = Number(consumptionStats.totalNetSpendUsd ?? 0);
    const lifetimeDiscountUsd = Number(consumptionStats.totalDiscountUsd || 0);

    const todayGrossSpendUsd = Number(hardBudgetSummary.todayGrossSpendUsd);
    const todayNetSpendUsd = Number(consumptionStats.netSpendTodayUsd ?? hardBudgetSummary.todaySpendUsd);
    const todayDiscountUsd = Number(hardBudgetSummary.openaiFreeTier?.financialsToday?.discountUsd ?? consumptionStats.discountTodayUsd ?? 0);

    const isConfirmedBilled = hardBudgetSummary.openaiFreeTier?.verificationStatus === 'CONFIRMED_BILLED';
    const estimatedPromoDiscountUsd = isConfirmedBilled ? 0 : todayDiscountUsd;
    const confirmedBilledDiscountUsd = isConfirmedBilled ? todayDiscountUsd : 0;

    const aiAccounting = {
      lifetimeGrossSpendUsd,
      lifetimeNetSpendUsd,
      lifetimeDiscountUsd,
      todayGrossSpendUsd,
      todayNetSpendUsd,
      todayDiscountUsd,
      estimatedPromoDiscountUsd,
      confirmedBilledDiscountUsd,
      pendingReservationsUsd: hardBudgetSummary.reservedPendingUsd || 0,
      dailyBudgetLimitUsd: hardBudgetSummary.dailyBudgetLimitUsd,
      dailyRemainingBalanceUsd: hardBudgetSummary.remainingDailyUsd,
      dailyPercentUsed: hardBudgetSummary.dailyPercentUsed,
      freeTierStatus: hardBudgetSummary.openaiFreeTier?.verificationStatus || 'DECLARED_BY_ADMIN',
    };

    const summary = {
      routerMode: routerCfg.mode,
      activeProfile: routerCfg.profile,
      openaiConfigured: !!openai || !!config.ai.openaiApiKey,
      geminiConfigured: !!gemini || !!config.ai.geminiApiKey,
      dailyBudgetUsd: hardBudgetSummary.dailyBudgetLimitUsd,
      monthlyBudgetUsd: hardBudgetSummary.monthlyBudgetLimitUsd,
      spentTodayUsd: hardBudgetSummary.todaySpendUsd,
      spentMonthUsd: hardBudgetSummary.monthSpendUsd,
      grossSpentTodayUsd: hardBudgetSummary.todayGrossSpendUsd,
      reservedPendingUsd: hardBudgetSummary.reservedPendingUsd,
      lastBudgetDenial: hardBudgetSummary.lastBudgetDenial,
      budgetBlockedReason: hardBudgetSummary.blockedReason,
      budgetRemainingUsd: hardBudgetSummary.remainingDailyUsd,
      hardBudgetStatus: hardBudgetSummary.status,
      isBudgetBlocked: hardBudgetSummary.isBlocked,
      hardBudgetSummary,
      aiAccounting,
      capitalUsdt: riskPolicy.capitalUsdt,
      maxRiskPerTradePercentage: riskPolicy.maxRiskPerTradePercent,
      maxRiskPerTradeUsdt: riskPolicy.maxRiskPerTradeUsdt,
      maxStopLossPercentage: riskPolicy.stopLossCeilings?.maxSlDistancePercent?.value ?? 1.5,
      minNetRiskReward: riskPolicy.minNetRR,
      bybitStatus: bybitView?.status || 'UNCONFIGURED',
      killSwitchActive: config.security.killSwitchActive,
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, data: summary }));
  }

  private setupUpgradeHandler(): void {
    this.server.on('upgrade', (request, socket, head) => {
      const pathname = new URL(request.url || '/', `http://${request.headers.host}`).pathname;

      if (pathname === '/ws/live') {
        this.wss.handleUpgrade(request, socket, head, (ws) => {
          this.wss.emit('connection', ws, request);
        });
      } else {
        socket.destroy();
      }
    });

    this.wss.on('connection', (ws: WebSocket) => {
      // Send immediate full state snapshot to newly connected client
      const state = this.coordinator.getMarketState();
      ws.send(JSON.stringify({ type: 'initial_state', data: state }));

      ws.on('message', (msg) => {
        try {
          const parsed = JSON.parse(msg.toString());
          if (parsed.op === 'ping') {
            ws.send(JSON.stringify({ op: 'pong', timestamp: Date.now() }));
          }
        } catch { }
      });
    });
  }

  private setupWebSocketBroadcast(): void {
    // Broadcast ticker updates
    this.coordinator.on('ticker_updated', (ticker) => {
      this.broadcast({ type: 'ticker', data: ticker });
    });

    // Broadcast candle updates
    this.coordinator.on('candle_updated', (candle) => {
      this.broadcast({ type: 'candle_updated', data: candle });
    });

    this.coordinator.on('candle_closed', (candle) => {
      this.broadcast({ type: 'candle_closed', data: candle });
    });

    // Broadcast orderbook updates (throttled to max every 200ms)
    let lastObBroadcast = 0;
    this.coordinator.on('orderbook_updated', (ob) => {
      const now = Date.now();
      if (now - lastObBroadcast > 200) {
        lastObBroadcast = now;
        this.broadcast({ type: 'orderbook', data: ob });
      }
    });

    // Broadcast state updates
    this.coordinator.on('state_updated', (state) => {
      this.broadcast({ type: 'state', data: state });
    });

    // Broadcast consensus signals
    this.coordinator.on('signal_evaluated', (signal) => {
      this.broadcast({ type: 'signal_evaluated', data: signal });
    });

    // Broadcast signal lifecycle transitions
    this.coordinator.on('signal_state_changed', (evt) => {
      this.broadcast({ type: 'signal_state_changed', data: evt });
    });

    // Broadcast live signal tracking metrics (MFE / MAE)
    this.coordinator.on('signal_metrics_updated', (signal) => {
      this.broadcast({ type: 'signal_metrics_updated', data: signal });
    });

    // Broadcast discovery and scenario events
    this.coordinator.on('scenario_registered', (sc) => {
      this.broadcast({ type: 'scenario_registered', data: sc });
    });
    this.coordinator.on('scenario_status_changed', (evt) => {
      this.broadcast({ type: 'scenario_status_changed', data: evt });
    });
    this.coordinator.on('scenario_updated', (sc) => {
      this.broadcast({ type: 'scenario_updated', data: sc });
    });
    this.coordinator.on('scenario_approaching', (evt) => {
      this.broadcast({ type: 'scenario_approaching', data: evt });
    });
    this.coordinator.on('scenario_entry_validated', (evt) => {
      this.broadcast({ type: 'scenario_entry_validated', data: evt });
    });
    this.coordinator.on('discovery_completed', (evt) => {
      this.broadcast({ type: 'discovery_completed', data: evt });
    });
  }

  private sendMarketIntelligence(res: http.ServerResponse): void {
    const summary = this.coordinator.getAiDiscoveryEngine().getLatestSummary();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, data: summary }));
  }

  private sendScenarios(req: http.IncomingMessage, res: http.ServerResponse, url: URL): void {
    const statusParam = url.searchParams.get('status');
    const rrModeParam = url.searchParams.get('rrMode') as any;
    const limit = parseInt(url.searchParams.get('limit') || '100', 10);
    const statuses = statusParam ? statusParam.split(',') as any : undefined;

    const scenarios = this.coordinator.getScenarioRegistry().getAll({
      status: statuses,
      rrMode: rrModeParam,
      limit,
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, count: scenarios.length, data: scenarios }));
  }

  private sendWatchPlans(res: http.ServerResponse): void {
    const plans = this.db.getActiveWatchPlans(this.coordinator.getMarketState().symbol);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, count: plans.length, data: plans }));
  }

  private sendScenarioDetail(res: http.ServerResponse, id: string): void {
    const scenario = this.coordinator.getScenarioRegistry().getScenario(id);
    if (!scenario) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Escenario no encontrado' }));
      return;
    }
    const lifecycle = this.coordinator.getScenarioRegistry().getLifecycle(id);
    const revalidations = this.db.getScenarioRevalidations(id);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      data: {
        scenario,
        lifecycle,
        revalidations,
        discoveryAudit: this.db.getDiscoveryAudit(scenario.snapshotId),
        relatedDiscoveryAudits: this.db.getDiscoveryAuditsForScenario(scenario.id),
      },
    }));
  }

  private async handleTriggerDiscovery(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (!this.isAuthenticated(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'No autorizado' }));
      return;
    }

    try {
      const result = await this.coordinator.getAiDiscoveryEngine().runDiscovery({ forceManual: true, triggerSource: 'MANUAL_TRIGGER' });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        scenariosDiscovered: result.scenarios.length,
        data: result,
      }));
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
  }

  private async handleManualRevalidate(req: http.IncomingMessage, res: http.ServerResponse, id: string): Promise<void> {
    if (!this.isAuthenticated(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'No autorizado' }));
      return;
    }

    const scenario = this.coordinator.getScenarioRegistry().getScenario(id);
    if (!scenario) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Escenario no encontrado' }));
      return;
    }

    const currentPrice = this.coordinator.getMarketState().ticker?.lastPrice || scenario.targetEntry;
    try {
      const result = await this.coordinator.getAiRevalidation().revalidate(scenario, currentPrice);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        data: result,
      }));
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
  }

  private sendDiscoverySchedulerStatus(res: http.ServerResponse): void {
    const status = this.coordinator.getDiscoveryScheduler().getStatus();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, data: status }));
  }

  private sendDiscoverySchedulerConfig(res: http.ServerResponse): void {
    const config = this.coordinator.getDiscoveryScheduler().getConfig();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, data: config }));
  }

  private async handleUpdateDiscoverySchedulerConfig(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (!this.isAuthenticated(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'No autorizado' }));
      return;
    }
    try {
      const body = await this.readJsonBody(req);
      const updated = this.coordinator.getDiscoveryScheduler().updateConfig(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, data: updated }));
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
  }

  private sendBacktestDataStatus(res: http.ServerResponse): void {
    const status = this.historicalDataManager.getDataStatus(90);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, data: status }));
  }

  private async handleBacktestImport(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (!this.isAuthenticated(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'No autorizado' }));
      return;
    }
    try {
      const body = await this.readJsonBody(req).catch(() => ({ days: 90 }));
      const days = Number(body?.days || 90);
      const summary = await this.historicalDataManager.importAllTimeframes(days);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, data: summary }));
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
  }

  private async handleBacktestRun(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (!this.isAuthenticated(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'No autorizado' }));
      return;
    }
    try {
      const body = await this.readJsonBody(req).catch(() => ({}));
      const report = await this.backtestEngine.runBacktest(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, data: report }));
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
  }

  private sendBacktestRuns(res: http.ServerResponse, limit: number): void {
    const runs = this.db.getBacktestRuns(limit);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, data: runs }));
  }

  private sendBacktestRunDetail(res: http.ServerResponse, id: string): void {
    const run = this.db.getBacktestRunById(id);
    if (!run) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Backtest run no encontrado' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, data: run }));
  }

  private sendBacktestRunTrades(res: http.ServerResponse, id: string, limit: number): void {
    const trades = this.db.getBacktestTrades(id, limit);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, data: trades }));
  }

  private sendBacktestExport(res: http.ServerResponse, id: string, format: 'csv' | 'json'): void {
    const trades = this.db.getBacktestTrades(id, 5000);
    if (format === 'csv') {
      const headers = [
        'id', 'strategy', 'direction', 'ratioTarget', 'entryTimestamp', 'exitTimestamp',
        'entryPrice', 'stopLossPrice', 'takeProfitPrice', 'exitPrice', 'outcome',
        'realizedNetPnlUsdt', 'realizedNetR', 'mfeR', 'maeR', 'durationMs', 'isInSample', 'feesUsdt'
      ];
      let csv = headers.join(',') + '\n';
      for (const t of trades) {
        csv += [
          t.id, t.strategy, t.direction, t.ratioTarget, t.entryTimestamp, t.exitTimestamp,
          t.entryPrice, t.stopLossPrice, t.takeProfitPrice, t.exitPrice, t.outcome,
          t.realizedNetPnlUsdt, t.realizedNetR, t.mfeR, t.maeR, t.durationMs, t.isInSample ? 1 : 0, t.feesUsdt
        ].join(',') + '\n';
      }
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="backtest_${id}.csv"`);
      res.writeHead(200);
      res.end(csv);
    } else {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="backtest_${id}.json"`);
      res.writeHead(200);
      res.end(JSON.stringify(trades, null, 2));
    }
  }

  private broadcast(payload: any): void {
    const raw = JSON.stringify(payload);
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(raw);
      }
    }
  }

  public async start(): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(this.port, this.host, () => {
        const addr = this.server.address();
        if (typeof addr === 'object' && addr !== null) {
          this.port = addr.port;
        }
        this.db.logEvent('INFO', 'ApiServer', `Server listening on http://${this.host}:${this.port}`);
        resolve();
      });
    });
  }

  public getPort(): number {
    return this.port;
  }

  public async stop(): Promise<void> {
    return new Promise((resolve) => {
      try {
        for (const client of this.wss.clients) {
          try {
            client.terminate();
          } catch {}
        }
      } catch {}
      this.wss.close(() => {
        if (typeof (this.server as any).closeAllConnections === 'function') {
          try {
            (this.server as any).closeAllConnections();
          } catch {}
        }
        this.server.close(() => resolve());
      });
    });
  }
}
