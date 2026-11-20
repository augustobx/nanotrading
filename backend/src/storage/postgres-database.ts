import pg from 'pg';
import { Candle, Timeframe } from '../types/market.js';
import { config } from '../config/index.js';

const { Pool } = pg;

export class PostgresDatabaseService {
  private pool: pg.Pool;

  constructor() {
    this.pool = new Pool({
      host: config.storage.postgres.host,
      port: config.storage.postgres.port,
      database: config.storage.postgres.database,
      user: config.storage.postgres.user,
      password: config.storage.postgres.password,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
  }

  public async init(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS candles (
          symbol VARCHAR(20) NOT NULL,
          timeframe VARCHAR(10) NOT NULL,
          timestamp BIGINT NOT NULL,
          open DOUBLE PRECISION NOT NULL,
          high DOUBLE PRECISION NOT NULL,
          low DOUBLE PRECISION NOT NULL,
          close DOUBLE PRECISION NOT NULL,
          volume DOUBLE PRECISION NOT NULL,
          turnover DOUBLE PRECISION NOT NULL,
          confirmed BOOLEAN NOT NULL,
          PRIMARY KEY (symbol, timeframe, timestamp)
        );

        CREATE INDEX IF NOT EXISTS idx_pg_candles_lookup 
        ON candles(symbol, timeframe, timestamp DESC);

        CREATE TABLE IF NOT EXISTS market_snapshots (
          id SERIAL PRIMARY KEY,
          timestamp BIGINT NOT NULL,
          symbol VARCHAR(20) NOT NULL,
          last_price DOUBLE PRECISION NOT NULL,
          mark_price DOUBLE PRECISION NOT NULL,
          index_price DOUBLE PRECISION NOT NULL,
          spread DOUBLE PRECISION NOT NULL,
          funding_rate DOUBLE PRECISION,
          open_interest DOUBLE PRECISION,
          payload JSONB
        );

        CREATE INDEX IF NOT EXISTS idx_pg_snapshots_time 
        ON market_snapshots(timestamp DESC);

        CREATE TABLE IF NOT EXISTS system_events (
          id SERIAL PRIMARY KEY,
          timestamp BIGINT NOT NULL,
          level VARCHAR(20) NOT NULL,
          component VARCHAR(50) NOT NULL,
          message TEXT NOT NULL,
          metadata JSONB
        );

        CREATE INDEX IF NOT EXISTS idx_pg_events_time 
        ON system_events(timestamp DESC);

        CREATE TABLE IF NOT EXISTS setups (
          id VARCHAR(64) PRIMARY KEY,
          timestamp BIGINT NOT NULL,
          symbol VARCHAR(20) NOT NULL,
          strategy VARCHAR(50) NOT NULL,
          direction VARCHAR(10) NOT NULL,
          timeframe VARCHAR(10) NOT NULL,
          entry_price DOUBLE PRECISION NOT NULL,
          stop_loss DOUBLE PRECISION NOT NULL,
          take_profit DOUBLE PRECISION NOT NULL,
          rr_ratio DOUBLE PRECISION NOT NULL,
          status VARCHAR(30) NOT NULL,
          evidence JSONB,
          created_at BIGINT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_pg_setups_time 
        ON setups(timestamp DESC);
      `);
    } finally {
      client.release();
    }
  }

  public async saveCandle(candle: Candle): Promise<void> {
    const query = `
      INSERT INTO candles (symbol, timeframe, timestamp, open, high, low, close, volume, turnover, confirmed)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (symbol, timeframe, timestamp) DO UPDATE SET
        open = EXCLUDED.open,
        high = EXCLUDED.high,
        low = EXCLUDED.low,
        close = EXCLUDED.close,
        volume = EXCLUDED.volume,
        turnover = EXCLUDED.turnover,
        confirmed = EXCLUDED.confirmed
    `;
    await this.pool.query(query, [
      candle.symbol,
      candle.timeframe,
      candle.timestamp,
      candle.open,
      candle.high,
      candle.low,
      candle.close,
      candle.volume,
      candle.turnover,
      candle.confirmed,
    ]);
  }

  public async saveCandlesBatch(candles: Candle[]): Promise<void> {
    if (candles.length === 0) return;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const candle of candles) {
        const query = `
          INSERT INTO candles (symbol, timeframe, timestamp, open, high, low, close, volume, turnover, confirmed)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          ON CONFLICT (symbol, timeframe, timestamp) DO UPDATE SET
            open = EXCLUDED.open,
            high = EXCLUDED.high,
            low = EXCLUDED.low,
            close = EXCLUDED.close,
            volume = EXCLUDED.volume,
            turnover = EXCLUDED.turnover,
            confirmed = EXCLUDED.confirmed
        `;
        await client.query(query, [
          candle.symbol,
          candle.timeframe,
          candle.timestamp,
          candle.open,
          candle.high,
          candle.low,
          candle.close,
          candle.volume,
          candle.turnover,
          candle.confirmed,
        ]);
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  public async getCandles(
    symbol: string,
    timeframe: Timeframe,
    startTime: number = 0,
    endTime: number = Date.now(),
    limit: number = 200
  ): Promise<Candle[]> {
    const query = `
      SELECT symbol, timeframe, timestamp, open, high, low, close, volume, turnover, confirmed
      FROM candles
      WHERE symbol = $1 AND timeframe = $2 AND timestamp >= $3 AND timestamp <= $4
      ORDER BY timestamp ASC
      LIMIT $5
    `;
    const res = await this.pool.query(query, [symbol, timeframe, startTime, endTime, limit]);
    return res.rows.map((r) => ({
      symbol: r.symbol,
      timeframe: r.timeframe as Timeframe,
      timestamp: Number(r.timestamp),
      open: Number(r.open),
      high: Number(r.high),
      low: Number(r.low),
      close: Number(r.close),
      volume: Number(r.volume),
      turnover: Number(r.turnover),
      confirmed: Boolean(r.confirmed),
    }));
  }

  public async getLatestCandle(symbol: string, timeframe: Timeframe): Promise<Candle | null> {
    const query = `
      SELECT symbol, timeframe, timestamp, open, high, low, close, volume, turnover, confirmed
      FROM candles
      WHERE symbol = $1 AND timeframe = $2
      ORDER BY timestamp DESC
      LIMIT 1
    `;
    const res = await this.pool.query(query, [symbol, timeframe]);
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      symbol: r.symbol,
      timeframe: r.timeframe as Timeframe,
      timestamp: Number(r.timestamp),
      open: Number(r.open),
      high: Number(r.high),
      low: Number(r.low),
      close: Number(r.close),
      volume: Number(r.volume),
      turnover: Number(r.turnover),
      confirmed: Boolean(r.confirmed),
    };
  }

  public async logEvent(level: string, component: string, message: string, metadata?: any): Promise<void> {
    const query = `
      INSERT INTO system_events (timestamp, level, component, message, metadata)
      VALUES ($1, $2, $3, $4, $5)
    `;
    await this.pool.query(query, [Date.now(), level, component, message, metadata ? JSON.stringify(metadata) : null]);
  }

  public async saveSnapshot(
    symbol: string,
    lastPrice: number,
    markPrice: number,
    indexPrice: number,
    spread: number,
    fundingRate?: number,
    openInterest?: number,
    payload?: any
  ): Promise<void> {
    const query = `
      INSERT INTO market_snapshots (timestamp, symbol, last_price, mark_price, index_price, spread, funding_rate, open_interest, payload)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `;
    await this.pool.query(query, [
      Date.now(),
      symbol,
      lastPrice,
      markPrice,
      indexPrice,
      spread,
      fundingRate ?? null,
      openInterest ?? null,
      payload ? JSON.stringify(payload) : null,
    ]);
  }

  public async getRecentEvents(limit: number = 50): Promise<any[]> {
    const res = await this.pool.query(`SELECT * FROM system_events ORDER BY timestamp DESC LIMIT $1`, [limit]);
    return res.rows;
  }

  public async saveSetup(setup: any): Promise<void> {
    const query = `
      INSERT INTO setups (id, timestamp, symbol, strategy, direction, timeframe, entry_price, stop_loss, take_profit, rr_ratio, status, evidence, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status,
        evidence = EXCLUDED.evidence
    `;
    await this.pool.query(query, [
      setup.id,
      setup.timestamp,
      setup.symbol,
      setup.strategy,
      setup.direction,
      setup.timeframe,
      setup.entryPrice,
      setup.stopLoss,
      setup.takeProfit,
      setup.rrRatio,
      setup.status,
      JSON.stringify(setup.evidence || {}),
      Date.now(),
    ]);
  }

  public async getSetups(limit: number = 50): Promise<any[]> {
    const res = await this.pool.query(`SELECT * FROM setups ORDER BY timestamp DESC LIMIT $1`, [limit]);
    return res.rows;
  }

  public async close(): Promise<void> {
    await this.pool.end();
  }
}
