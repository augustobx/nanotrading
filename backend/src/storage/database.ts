import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { Candle, Timeframe } from '../types/market.js';
import { config } from '../config/index.js';

export class DatabaseService {
  private db: DatabaseSync;
  private upsertCandleStmt: any;
  private selectCandlesStmt: any;
  private selectLatestCandleStmt: any;
  private insertEventStmt: any;
  private insertSnapshotStmt: any;

  constructor(customPath?: string) {
    const dbPath = customPath || config.storage.sqlitePath;
    
    // Ensure directory exists if not memory
    if (dbPath !== ':memory:') {
      const dir = path.dirname(dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    this.db = new DatabaseSync(dbPath);
    this.init();
    this.prepareStatements();
  }

  private init(): void {
    // Enable WAL mode for high performance concurrent writes
    try {
      this.db.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        PRAGMA busy_timeout = 5000;
      `);
    } catch {
      // In-memory sqlite might ignore some pragmas
    }

    // Create tables
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS candles (
        symbol TEXT NOT NULL,
        timeframe TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        open REAL NOT NULL,
        high REAL NOT NULL,
        low REAL NOT NULL,
        close REAL NOT NULL,
        volume REAL NOT NULL,
        turnover REAL NOT NULL,
        confirmed INTEGER NOT NULL,
        PRIMARY KEY (symbol, timeframe, timestamp)
      );

      CREATE INDEX IF NOT EXISTS idx_candles_lookup 
      ON candles(symbol, timeframe, timestamp DESC);

      CREATE TABLE IF NOT EXISTS market_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        symbol TEXT NOT NULL,
        last_price REAL NOT NULL,
        mark_price REAL NOT NULL,
        index_price REAL NOT NULL,
        spread REAL NOT NULL,
        funding_rate REAL,
        open_interest REAL,
        payload TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_snapshots_time 
      ON market_snapshots(timestamp DESC);

      CREATE TABLE IF NOT EXISTS system_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        level TEXT NOT NULL,
        component TEXT NOT NULL,
        message TEXT NOT NULL,
        metadata TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_events_time 
      ON system_events(timestamp DESC);
    `);
  }

  private prepareStatements(): void {
    this.upsertCandleStmt = this.db.prepare(`
      INSERT INTO candles (symbol, timeframe, timestamp, open, high, low, close, volume, turnover, confirmed)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(symbol, timeframe, timestamp) DO UPDATE SET
        open = excluded.open,
        high = excluded.high,
        low = excluded.low,
        close = excluded.close,
        volume = excluded.volume,
        turnover = excluded.turnover,
        confirmed = excluded.confirmed
    `);

    this.selectCandlesStmt = this.db.prepare(`
      SELECT symbol, timeframe, timestamp, open, high, low, close, volume, turnover, confirmed
      FROM candles
      WHERE symbol = ? AND timeframe = ? AND timestamp >= ? AND timestamp <= ?
      ORDER BY timestamp ASC
      LIMIT ?
    `);

    this.selectLatestCandleStmt = this.db.prepare(`
      SELECT symbol, timeframe, timestamp, open, high, low, close, volume, turnover, confirmed
      FROM candles
      WHERE symbol = ? AND timeframe = ?
      ORDER BY timestamp DESC
      LIMIT 1
    `);

    this.insertEventStmt = this.db.prepare(`
      INSERT INTO system_events (timestamp, level, component, message, metadata)
      VALUES (?, ?, ?, ?, ?)
    `);

    this.insertSnapshotStmt = this.db.prepare(`
      INSERT INTO market_snapshots (timestamp, symbol, last_price, mark_price, index_price, spread, funding_rate, open_interest, payload)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
  }

  public saveCandle(candle: Candle): void {
    this.upsertCandleStmt.run(
      candle.symbol,
      candle.timeframe,
      candle.timestamp,
      candle.open,
      candle.high,
      candle.low,
      candle.close,
      candle.volume,
      candle.turnover,
      candle.confirmed ? 1 : 0
    );
  }

  public saveCandlesBatch(candles: Candle[]): void {
    this.db.exec('BEGIN TRANSACTION;');
    try {
      for (const candle of candles) {
        this.saveCandle(candle);
      }
      this.db.exec('COMMIT;');
    } catch (err) {
      this.db.exec('ROLLBACK;');
      throw err;
    }
  }

  public getCandles(
    symbol: string,
    timeframe: Timeframe,
    startTime: number = 0,
    endTime: number = Date.now(),
    limit: number = 200
  ): Candle[] {
    const rows = this.selectCandlesStmt.all(symbol, timeframe, startTime, endTime, limit) as any[];
    return rows.map((r) => ({
      symbol: r.symbol,
      timeframe: r.timeframe as Timeframe,
      timestamp: Number(r.timestamp),
      open: Number(r.open),
      high: Number(r.high),
      low: Number(r.low),
      close: Number(r.close),
      volume: Number(r.volume),
      turnover: Number(r.turnover),
      confirmed: r.confirmed === 1,
    }));
  }

  public getLatestCandle(symbol: string, timeframe: Timeframe): Candle | null {
    const row = this.selectLatestCandleStmt.get(symbol, timeframe) as any;
    if (!row) return null;
    return {
      symbol: row.symbol,
      timeframe: row.timeframe as Timeframe,
      timestamp: Number(row.timestamp),
      open: Number(row.open),
      high: Number(row.high),
      low: Number(row.low),
      close: Number(row.close),
      volume: Number(row.volume),
      turnover: Number(row.turnover),
      confirmed: row.confirmed === 1,
    };
  }

  public logEvent(level: 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL', component: string, message: string, metadata?: any): void {
    this.insertEventStmt.run(
      Date.now(),
      level,
      component,
      message,
      metadata ? JSON.stringify(metadata) : null
    );
  }

  public saveSnapshot(
    symbol: string,
    lastPrice: number,
    markPrice: number,
    indexPrice: number,
    spread: number,
    fundingRate?: number,
    openInterest?: number,
    payload?: any
  ): void {
    this.insertSnapshotStmt.run(
      Date.now(),
      symbol,
      lastPrice,
      markPrice,
      indexPrice,
      spread,
      fundingRate ?? null,
      openInterest ?? null,
      payload ? JSON.stringify(payload) : null
    );
  }

  public getRecentEvents(limit: number = 50): any[] {
    const stmt = this.db.prepare(`
      SELECT * FROM system_events ORDER BY timestamp DESC LIMIT ?
    `);
    return stmt.all(limit);
  }

  public close(): void {
    this.db.close();
  }
}
