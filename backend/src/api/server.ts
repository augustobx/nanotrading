import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { MarketCoordinator } from '../market/market-coordinator.js';
import { DatabaseService } from '../storage/database.js';
import { config } from '../config/index.js';
import { Timeframe, SUPPORTED_TIMEFRAMES } from '../types/market.js';

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
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    const apiKeyHeader = (req.headers['x-admin-key'] as string) || '';
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
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
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
