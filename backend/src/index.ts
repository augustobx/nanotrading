import { config } from './config/index.js';
import { DatabaseService } from './storage/database.js';
import { BybitRestClient } from './bybit/bybit-rest-client.js';
import { BybitWsClient } from './bybit/bybit-ws-client.js';
import { CandleManager } from './market/candle-manager.js';
import { OrderBookManager } from './market/orderbook-manager.js';
import { MarketCoordinator } from './market/market-coordinator.js';
import { ApiServer } from './api/server.js';

async function main() {
  console.log('================================================================');
  console.log('   NanoLabs AI Trading — Market Ingestion & Engine Core');
  console.log(`   Symbol: ${config.bybit.symbol} | Category: ${config.bybit.category}`);
  console.log(`   Timezone: ${config.timezone} | Env: ${config.env}`);
  console.log('================================================================');

  // 1. Storage
  const db = new DatabaseService();
  db.logEvent('INFO', 'System', 'Starting NanoLabs AI Trading core services');

  // 2. Bybit Clients
  const restClient = new BybitRestClient();
  const wsClient = new BybitWsClient();

  // 3. Managers
  const candleManager = new CandleManager(config.bybit.symbol, db);
  const orderBookManager = new OrderBookManager(config.bybit.symbol);

  // 4. Coordinator
  const coordinator = new MarketCoordinator(
    restClient,
    wsClient,
    candleManager,
    orderBookManager,
    db,
    config.bybit.symbol
  );

  // 5. API Server (HTTP + WebSocket)
  const apiServer = new ApiServer(coordinator, db, config.port, config.host);

  // Graceful shutdown handlers
  const shutdown = async (signal: string) => {
    console.log(`\n[Shutdown] Received ${signal}. Closing gracefully...`);
    db.logEvent('WARN', 'System', `Shutdown initiated by signal ${signal}`);
    try {
      await apiServer.stop();
      coordinator.stop();
      db.close();
      console.log('[Shutdown] All services stopped safely.');
      process.exit(0);
    } catch (err: any) {
      console.error('[Shutdown Error]', err);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  try {
    // Start HTTP & WS API server
    await apiServer.start();
    console.log(`[API Server] Running on http://${config.host}:${config.port}`);
    console.log(`[API Server] Live WebSocket on ws://${config.host}:${config.port}/ws/live`);

    // Bootstrap market coordinator (fetch specs, klines, orderbook, connect WS)
    await coordinator.bootstrap();
    console.log('[Coordinator] Market streaming initialized and active.');
  } catch (err: any) {
    console.error('[Fatal Startup Error]', err);
    process.exit(1);
  }
}

main();
