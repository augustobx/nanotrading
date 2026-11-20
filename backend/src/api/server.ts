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

  constructor(coordinator: MarketCoordinator, db: DatabaseService, port?: number, host?: string) {
    this.coordinator = coordinator;
    this.db = db;
    this.port = port || config.port;
    this.host = host || config.host;

    this.server = http.createServer((req, res) => this.handleHttpRequest(req, res));
    this.wss = new WebSocketServer({ noServer: true });

    this.setupUpgradeHandler();
    this.setupWebSocketBroadcast();
  }

  private handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    // Enable CORS for frontend PWA
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

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
      } else if (pathname === '/api/v1/events' && req.method === 'GET') {
        const limit = parseInt(url.searchParams.get('limit') || '50', 10);
        this.sendEvents(res, limit);
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Endpoint not found', path: pathname }));
      }
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal Server Error', message: err.message }));
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

  private sendEvents(res: http.ServerResponse, limit: number): void {
    const events = this.db.getRecentEvents(limit);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, count: events.length, data: events }));
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
        this.db.logEvent('INFO', 'ApiServer', `Server listening on http://${this.host}:${this.port}`);
        resolve();
      });
    });
  }

  public async stop(): Promise<void> {
    return new Promise((resolve) => {
      this.wss.close(() => {
        this.server.close(() => resolve());
      });
    });
  }
}
