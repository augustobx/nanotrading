import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { MarketCoordinator } from '../market/market-coordinator.js';
import { DatabaseService } from '../storage/database.js';
import { config } from '../config/index.js';
import { Timeframe, SUPPORTED_TIMEFRAMES } from '../types/market.js';
import { authManager } from '../security/auth-manager.js';
import { maskSecret, encryptSecret } from '../security/encryption.js';
import { RiskCalculator } from '../engine/risk-calculator.js';
import { AI_MODELS_CATALOG } from '../ai/models-catalog.js';

export class ApiServer {
  private server: http.Server;
  private wss: WebSocketServer;
  private coordinator: MarketCoordinator;
  private db: DatabaseService;
  private port: number;
  private host: string;
  private startTime: number = Date.now();
  private rateLimitMap: Map<string, { count: number; resetTime: number }> = new Map();
  private evaluationsInProgress: Set<string> = new Set();

  constructor(coordinator: MarketCoordinator, db: DatabaseService, port?: number, host?: string) {
    this.coordinator = coordinator;
    this.db = db;
    this.port = port !== undefined ? port : config.port;
    this.host = host || config.host;

    this.server = http.createServer((req, res) => this.handleHttpRequest(req, res));
    this.wss = new WebSocketServer({ noServer: true });

    this.setupUpgradeHandler();
    this.setupWebSocketBroadcast();
  }

  private isAuthenticated(req: http.IncomingMessage): boolean {
    const authHeader = (req.headers['authorization'] as string) || '';
    const apiKeyHeader = (req.headers['x-admin-key'] as string) || '';
    const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || req.socket.remoteAddress || '127.0.0.1';

    if (authManager.validateAuth(authHeader || apiKeyHeader, clientIp)) {
      return true;
    }
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    return token === config.security.adminApiKey || apiKeyHeader === config.security.adminApiKey;
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

  private handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    // Enable CORS for frontend PWA
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-admin-key');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;

    try {
      if (pathname === '/health' && req.method === 'GET') {
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
        this.sendActiveSetups(res);
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
      } else if (pathname === '/api/v1/config/ai/router' && req.method === 'GET') {
        this.sendAiRouterConfig(res);
      } else if (pathname === '/api/v1/config/ai/router' && req.method === 'POST') {
        this.handleUpdateAiRouterConfig(req, res);
      } else if (pathname === '/api/v1/config/ai/credentials' && req.method === 'GET') {
        this.sendAiCredentials(res);
      } else if (pathname === '/api/v1/config/ai/credentials' && req.method === 'POST') {
        this.handleSaveAiCredentials(req, res);
      } else if (pathname.startsWith('/api/v1/config/ai/credentials/') && req.method === 'DELETE') {
        const provider = pathname.split('/')[5];
        this.handleDeleteAiCredentials(req, res, provider);
      } else if (pathname === '/api/v1/config/ai/consumption' && req.method === 'GET') {
        this.sendAiConsumption(req, res);
      } else if (pathname === '/api/v1/config/ai/consumption/export' && req.method === 'GET') {
        this.handleExportAiConsumption(res);
      } else if (pathname === '/api/v1/config/audit' && req.method === 'GET') {
        this.sendConfigAudit(req, res);
      } else if (pathname === '/api/v1/config/summary' && req.method === 'GET') {
        this.sendConfigSummary(res);
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

  private sendActiveSetups(res: http.ServerResponse): void {
    const setups = this.coordinator.getActiveSetups();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, count: setups.length, data: setups }));
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

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        success: true,
        data: {
          currentMode,
          lastEvaluationMode: lastMode,
          providers: {
            openai: consensusEngine.getOpenAiAdapter().getStatus(),
            gemini: consensusEngine.getGeminiAdapter().getStatus(),
          },
          fallbackPolicy: {
            activeMode: currentMode,
            modes: ['DUAL_AI', 'SINGLE_AI_OPENAI', 'SINGLE_AI_GEMINI', 'AI_UNAVAILABLE'],
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
    const signals = this.db.getSignals(limit);
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
    const clientIp =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || req.socket.remoteAddress || '127.0.0.1';

    // 1. Authentication check
    if (!this.isAuthenticated(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ error: 'No autorizado: se requiere clave administrativa (x-admin-key o Bearer token)' })
      );
      return;
    }

    // 2. Rate limiting check
    if (!this.checkRateLimit(clientIp)) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: `Límite de solicitudes de evaluación excedido (máximo ${config.security.rateLimitPerMinute} por minuto)`,
        })
      );
      return;
    }

    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 50000) req.destroy();
    });

    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const setupId = payload.setupId;

        // 3. Input validation
        if (!setupId || typeof setupId !== 'string' || !/^[a-zA-Z0-9_\-]+$/.test(setupId)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Parámetro setupId inválido o ausente' }));
          return;
        }

        // 4. Deduplication
        if (this.evaluationsInProgress.has(setupId)) {
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              error: `Evaluación de IA ya en progreso para el setup ${setupId}. Evitando costo duplicado.`,
            })
          );
          return;
        }

        // 5. Budget guard check
        const costTracker = this.coordinator.getConsensusEngine().getCostTracker();
        if (!costTracker.canMakeCalls(2)) {
          res.writeHead(429, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              error: 'Límite de presupuesto diario o mensual de IA alcanzado. Evaluación bloqueada.',
            })
          );
          return;
        }

        const setups = this.coordinator.getActiveSetups();
        const setup = setups.find((s: any) => s.id === setupId);
        if (!setup) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Setup con id ${setupId} no encontrado entre setups activos` }));
          return;
        }

        // 6. Audit security log
        this.db.logEvent('INFO', 'Security', `Evaluación IA autorizada para setup ${setupId}`, { clientIp });

        this.evaluationsInProgress.add(setupId);
        try {
          const result = await this.coordinator.getConsensusEngine().evaluateSetup(setup);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, data: result }));
        } finally {
          this.evaluationsInProgress.delete(setupId);
        }
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: 'Error durante la evaluación de consenso',
            message: 'Fallo interno controlado en evaluación',
          })
        );
      }
    });
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
      if (result.success) {
        this.db.logConfigAudit({
          category: 'AUTH',
          action: 'LOGIN_SUCCESS',
          details: { clientIp },
          ipAddress: clientIp,
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, token: result.token, expiresAt: result.expiresAt }));
      } else {
        this.db.logConfigAudit({
          category: 'AUTH',
          action: 'LOGIN_FAILED',
          details: { clientIp, error: result.error },
          ipAddress: clientIp,
        });
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: result.error, lockedUntil: result.lockedUntil }));
      }
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message || 'Error en autenticación' }));
    }
  }

  private handleAuthVerify(req: http.IncomingMessage, res: http.ServerResponse): void {
    const isAuth = this.isAuthenticated(req);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, authenticated: isAuth }));
  }

  private async handleAuthLogout(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const authHeader = (req.headers['authorization'] as string) || '';
    const tokenFromHeader = authHeader.replace(/^Bearer\s+/i, '').trim();
    let tokenFromBody = '';
    try {
      const payload = await this.parseJsonBody<{ token?: string }>(req);
      tokenFromBody = payload.token || '';
    } catch {}
    const token = tokenFromHeader || tokenFromBody;
    if (token) {
      authManager.logout(token);
    }
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
      const result = await this.coordinator.getBybitCredentialsManager().saveCredentials(apiKey, apiSecret, environment || 'mainnet');
      this.db.logConfigAudit({
        category: 'BYBIT_CREDENTIALS',
        action: 'SAVE',
        details: { environment: environment || 'mainnet', apiKeyMasked: maskSecret(apiKey), permissions: result.detectedPermissions },
        ipAddress: clientIp,
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, data: result }));
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
      const result = await this.coordinator.getBybitCredentialsManager().verifyAndEnforceReadOnly(apiKey, apiSecret, environment || 'mainnet');
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
            ? { provider: 'openai', configured: true, apiKeyMasked: openai.apiKeyMasked, model: openai.model, lastVerifiedAt: openai.lastVerifiedAt }
            : { provider: 'openai', configured: !!config.ai.openaiApiKey, apiKeyMasked: config.ai.openaiApiKey ? maskSecret(config.ai.openaiApiKey) : null, model: config.ai.openaiModel },
          gemini: gemini
            ? { provider: 'gemini', configured: true, apiKeyMasked: gemini.apiKeyMasked, model: gemini.model, lastVerifiedAt: gemini.lastVerifiedAt }
            : { provider: 'gemini', configured: !!config.ai.geminiApiKey, apiKeyMasked: config.ai.geminiApiKey ? maskSecret(config.ai.geminiApiKey) : null, model: config.ai.geminiModel },
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
      const encryptedSecret = encryptSecret(apiKey);
      const apiKeyMasked = maskSecret(apiKey);
      this.db.saveAiCredentials({
        provider: providerNorm,
        apiKeyMasked,
        encryptedSecret,
        model: model || (providerNorm === 'openai' ? 'gpt-4o' : 'gemini-2.5-flash'),
        status: 'CONFIGURED',
      });
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
    this.db.logConfigAudit({
      category: 'AI_CREDENTIALS',
      action: 'DELETE',
      details: { provider: providerNorm },
      ipAddress: clientIp,
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, message: `Credenciales de ${providerNorm} eliminadas correctamente` }));
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

    const summary = {
      routerMode: routerCfg.mode,
      activeProfile: routerCfg.profile,
      openaiConfigured: !!openai || !!config.ai.openaiApiKey,
      geminiConfigured: !!gemini || !!config.ai.geminiApiKey,
      dailyBudgetUsd: routerCfg.dailyBudgetLimitUsd || 5.0,
      spentTodayUsd: stats.todaySpendUsd || 0,
      budgetRemainingUsd: Math.max(0, (routerCfg.dailyBudgetLimitUsd || 5.0) - (stats.todaySpendUsd || 0)),
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
        } catch {}
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

    // Broadcast detected setups
    this.coordinator.on('setup_detected', (setup) => {
      this.broadcast({ type: 'setup_detected', data: setup });
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
      this.wss.close(() => {
        this.server.close(() => resolve());
      });
    });
  }
}
