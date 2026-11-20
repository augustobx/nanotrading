import dotenv from 'dotenv';
import path from 'path';

// Load .env if present
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });
dotenv.config();

export interface AppConfig {
  env: 'development' | 'production' | 'test';
  port: number;
  host: string;
  timezone: string;
  bybit: {
    restUrl: string;
    wsUrl: string;
    category: 'linear';
    symbol: string;
    wsPingIntervalMs: number;
    wsWatchdogTimeoutMs: number;
    reconnectBaseDelayMs: number;
    reconnectMaxDelayMs: number;
    maxRestRetries: number;
  };
  storage: {
    dbType: 'sqlite' | 'postgres';
    sqlitePath: string;
    postgres: {
      host: string;
      port: number;
      database: string;
      user: string;
      password?: string;
    };
  };
  redis: {
    enabled: boolean;
    host: string;
    port: number;
    password?: string;
  };
  security: {
    killSwitchActive: boolean;
    tradingMode: 'SIGNALS_ONLY' | 'PAPER_TRADING' | 'DEMO_TRADING' | 'LIVE_TRADING';
    maxRiskPerTradePercent: number;
    maxDailyLossPercent: number;
    minRrRatio: number;
    adminApiKey: string;
    corsAllowedOrigins: string[];
    rateLimitPerMinute: number;
  };
  ai: {
    openaiApiKey?: string;
    openaiModel: string;
    geminiApiKey?: string;
    geminiModel: string;
    maxDailySpendUsd: number;
    maxMonthlySpendUsd: number;
  };
  telegram: {
    enabled: boolean;
    botToken?: string;
    chatId?: string;
  };
  push: {
    enabled: boolean;
    vapidPublicKey?: string;
    vapidPrivateKey?: string;
    vapidSubject: string;
  };
}

const isTestEnv =
  process.env.NODE_ENV === 'test' ||
  process.env.npm_lifecycle_event === 'test' ||
  process.argv.some((a) => a.includes('test'));

export const config: AppConfig = {
  env: (process.env.NODE_ENV as AppConfig['env']) || 'development',
  port: parseInt(process.env.PORT || '3001', 10),
  host: process.env.HOST || '0.0.0.0',
  timezone: process.env.TIMEZONE || 'America/Argentina/Buenos_Aires',
  bybit: {
    restUrl: process.env.BYBIT_REST_URL || 'https://api.bybit.com',
    wsUrl: process.env.BYBIT_WS_URL || 'wss://stream.bybit.com/v5/public/linear',
    category: 'linear',
    symbol: process.env.BYBIT_DEFAULT_SYMBOL || 'BTCUSDT',
    wsPingIntervalMs: 20000, // 20s Bybit heartbeat
    wsWatchdogTimeoutMs: 40000, // 40s stale stream trigger
    reconnectBaseDelayMs: 1000,
    reconnectMaxDelayMs: 30000,
    maxRestRetries: 3,
  },
  storage: {
    dbType: (process.env.DB_TYPE as 'sqlite' | 'postgres') || 'sqlite',
    sqlitePath: process.env.DB_SQLITE_PATH || path.resolve(process.cwd(), './data/trading.db'),
    postgres: {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      database: process.env.DB_NAME || 'nanolabs_trading',
      user: process.env.DB_USER || 'nanolabs_admin',
      password: process.env.DB_PASSWORD,
    },
  },
  redis: {
    enabled: process.env.REDIS_ENABLED === 'true',
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD,
  },
  security: {
    killSwitchActive: process.env.KILL_SWITCH_ACTIVE === 'true',
    tradingMode: (process.env.TRADING_MODE as AppConfig['security']['tradingMode']) || 'SIGNALS_ONLY',
    maxRiskPerTradePercent: parseFloat(process.env.MAX_RISK_PER_TRADE_PERCENT || '0.5'),
    maxDailyLossPercent: parseFloat(process.env.MAX_DAILY_LOSS_PERCENT || '1.5'),
    minRrRatio: parseFloat(process.env.MIN_RR_RATIO || '4.0'),
    adminApiKey: process.env.ADMIN_API_KEY || (isTestEnv ? 'test_admin_secure_key_123' : ''),
    corsAllowedOrigins: (process.env.CORS_ALLOWED_ORIGINS || '*').split(',').map((s) => s.trim()),
    rateLimitPerMinute: parseInt(process.env.RATE_LIMIT_PER_MINUTE || '10', 10),
  },
  ai: {
    openaiApiKey: process.env.OPENAI_API_KEY,
    openaiModel: process.env.OPENAI_MODEL || 'gpt-4o',
    geminiApiKey: process.env.GEMINI_API_KEY,
    geminiModel: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
    maxDailySpendUsd: parseFloat(process.env.AI_MAX_DAILY_SPEND_USD || '5.0'),
    maxMonthlySpendUsd: parseFloat(process.env.AI_MAX_MONTHLY_SPEND_USD || '50.0'),
  },
  telegram: {
    enabled: process.env.TELEGRAM_ENABLED === 'true',
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID,
  },
  push: {
    enabled: process.env.PUSH_ENABLED !== 'false',
    vapidPublicKey: process.env.VAPID_PUBLIC_KEY,
    vapidPrivateKey: process.env.VAPID_PRIVATE_KEY,
    vapidSubject: process.env.VAPID_SUBJECT || 'mailto:trading-alerts@nanolabs.com',
  },
};
