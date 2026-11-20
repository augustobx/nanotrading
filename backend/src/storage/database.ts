import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { Candle, Timeframe } from '../types/market.js';
import { config } from '../config/index.js';

export class DatabaseService {
  private db: DatabaseSync;
  private isClosed: boolean = false;
  private upsertCandleStmt: any;
  private selectCandlesStmt: any;
  private selectLatestCandleStmt: any;
  private insertEventStmt: any;
  private insertSnapshotStmt: any;
  private upsertSetupStmt: any;
  private selectSetupsStmt: any;
  private insertAiReviewStmt: any;
  private selectAiReviewsStmt: any;
  private selectAiReviewsBySetupStmt: any;
  private insertSignalStmt: any;
  private selectSignalsStmt: any;

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

      CREATE TABLE IF NOT EXISTS setups (
        id TEXT PRIMARY KEY,
        timestamp INTEGER NOT NULL,
        symbol TEXT NOT NULL,
        strategy TEXT NOT NULL,
        direction TEXT NOT NULL,
        timeframe TEXT NOT NULL,
        entry_price REAL NOT NULL,
        stop_loss REAL NOT NULL,
        take_profit REAL NOT NULL,
        rr_ratio REAL NOT NULL,
        status TEXT NOT NULL,
        evidence TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_setups_time 
      ON setups(timestamp DESC);

      CREATE TABLE IF NOT EXISTS ai_reviews (
        id TEXT PRIMARY KEY,
        setup_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        verdict TEXT NOT NULL,
        confidence REAL NOT NULL,
        reasoning TEXT NOT NULL,
        arguments_for TEXT,
        arguments_against TEXT,
        invalidation_trigger TEXT,
        risk_score REAL,
        latency_ms INTEGER,
        tokens_used INTEGER,
        cost_usd REAL,
        raw_response TEXT,
        timestamp INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_ai_reviews_setup 
      ON ai_reviews(setup_id, timestamp DESC);

      CREATE TABLE IF NOT EXISTS signals (
        id TEXT PRIMARY KEY,
        setup_id TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        symbol TEXT NOT NULL,
        strategy TEXT NOT NULL,
        direction TEXT NOT NULL,
        timeframe TEXT NOT NULL,
        entry_price REAL NOT NULL,
        stop_loss REAL NOT NULL,
        take_profit REAL NOT NULL,
        rr_net REAL NOT NULL,
        consensus_verdict TEXT NOT NULL,
        openai_verdict TEXT,
        gemini_verdict TEXT,
        status TEXT NOT NULL,
        rejection_reason TEXT,
        snapshot_id TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_signals_time 
      ON signals(timestamp DESC);
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

    this.upsertSetupStmt = this.db.prepare(`
      INSERT INTO setups (id, timestamp, symbol, strategy, direction, timeframe, entry_price, stop_loss, take_profit, rr_ratio, status, evidence, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        evidence = excluded.evidence
    `);

    this.selectSetupsStmt = this.db.prepare(`
      SELECT * FROM setups ORDER BY timestamp DESC LIMIT ?
    `);

    this.insertAiReviewStmt = this.db.prepare(`
      INSERT INTO ai_reviews (id, setup_id, provider, model, verdict, confidence, reasoning, arguments_for, arguments_against, invalidation_trigger, risk_score, latency_ms, tokens_used, cost_usd, raw_response, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.selectAiReviewsStmt = this.db.prepare(`
      SELECT * FROM ai_reviews ORDER BY timestamp DESC LIMIT ?
    `);

    this.selectAiReviewsBySetupStmt = this.db.prepare(`
      SELECT * FROM ai_reviews WHERE setup_id = ? ORDER BY timestamp DESC LIMIT ?
    `);

    this.insertSignalStmt = this.db.prepare(`
      INSERT INTO signals (id, setup_id, timestamp, symbol, strategy, direction, timeframe, entry_price, stop_loss, take_profit, rr_net, consensus_verdict, openai_verdict, gemini_verdict, status, rejection_reason, snapshot_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        rejection_reason = excluded.rejection_reason
    `);

    this.selectSignalsStmt = this.db.prepare(`
      SELECT * FROM signals ORDER BY timestamp DESC LIMIT ?
    `);
  }

  public saveCandle(candle: Candle): void {
    if (this.isClosed) return;
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
    if (this.isClosed || candles.length === 0) return;
    this.db.exec('BEGIN TRANSACTION;');
    try {
      for (const c of candles) {
        this.saveCandle(c);
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
    fromTimestamp: number = 0,
    toTimestamp: number = Number.MAX_SAFE_INTEGER,
    limit: number = 1000
  ): Candle[] {
    if (this.isClosed) return [];
    const rows = this.selectCandlesStmt.all(symbol, timeframe, fromTimestamp, toTimestamp, limit) as any[];
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
    if (this.isClosed) return null;
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
    if (this.isClosed) return;
    try {
      this.insertEventStmt.run(
        Date.now(),
        level,
        component,
        message,
        metadata ? JSON.stringify(metadata) : null
      );
    } catch {}
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
    if (this.isClosed) return;
    try {
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
    } catch {}
  }

  public getRecentEvents(limit: number = 50): any[] {
    if (this.isClosed) return [];
    const stmt = this.db.prepare(`
      SELECT * FROM system_events ORDER BY timestamp DESC LIMIT ?
    `);
    return stmt.all(limit);
  }

  public saveSetup(setup: any): void {
    if (this.isClosed) return;
    try {
      this.upsertSetupStmt.run(
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
        Date.now()
      );
    } catch {}
  }

  public getSetups(limit: number = 50): any[] {
    if (this.isClosed) return [];
    const rows = this.selectSetupsStmt.all(limit) as any[];
    return rows.map((r) => ({
      id: r.id,
      timestamp: Number(r.timestamp),
      symbol: r.symbol,
      strategy: r.strategy,
      direction: r.direction,
      timeframe: r.timeframe,
      entryPrice: Number(r.entry_price),
      stopLoss: Number(r.stop_loss),
      takeProfit: Number(r.take_profit),
      rrRatio: Number(r.rr_ratio),
      status: r.status,
      evidence: r.evidence ? JSON.parse(r.evidence) : {},
      createdAt: Number(r.created_at),
    }));
  }

  public saveAiReview(review: any): void {
    if (this.isClosed) return;
    try {
      this.insertAiReviewStmt.run(
        review.id,
        review.setupId,
        review.provider,
        review.model,
        review.verdict,
        review.confidence,
        review.reasoning,
        JSON.stringify(review.argumentsFor || []),
        JSON.stringify(review.argumentsAgainst || []),
        review.invalidationTrigger || null,
        review.riskScore ?? 0.5,
        review.latencyMs ?? 0,
        review.tokensUsed ?? 0,
        review.costUsd ?? 0,
        review.rawResponse || null,
        review.timestamp || Date.now()
      );
    } catch {}
  }

  public getAiReviews(setupId?: string, limit: number = 50): any[] {
    if (this.isClosed) return [];
    const rows = setupId
      ? (this.selectAiReviewsBySetupStmt.all(setupId, limit) as any[])
      : (this.selectAiReviewsStmt.all(limit) as any[]);

    return rows.map((r) => ({
      id: r.id,
      setupId: r.setup_id,
      provider: r.provider,
      model: r.model,
      verdict: r.verdict,
      confidence: Number(r.confidence),
      reasoning: r.reasoning,
      argumentsFor: r.arguments_for ? JSON.parse(r.arguments_for) : [],
      argumentsAgainst: r.arguments_against ? JSON.parse(r.arguments_against) : [],
      invalidationTrigger: r.invalidation_trigger,
      riskScore: Number(r.risk_score),
      latencyMs: Number(r.latency_ms),
      tokensUsed: Number(r.tokens_used),
      costUsd: Number(r.cost_usd),
      rawResponse: r.raw_response ? JSON.parse(r.raw_response) : null,
      timestamp: Number(r.timestamp),
    }));
  }

  public saveSignal(signal: any): void {
    if (this.isClosed) return;
    try {
      this.insertSignalStmt.run(
        signal.id,
        signal.setupId,
        signal.timestamp,
        signal.symbol,
        signal.strategy,
        signal.direction,
        signal.timeframe,
        signal.entryPrice,
        signal.stopLoss,
        signal.takeProfit,
        signal.rrNet,
        signal.consensusVerdict,
        signal.openaiVerdict || null,
        signal.geminiVerdict || null,
        signal.status,
        signal.rejectionReason || null,
        signal.snapshotId || null,
        signal.createdAt || Date.now()
      );
    } catch {}
  }

  public getSignals(limit: number = 50): any[] {
    if (this.isClosed) return [];
    const rows = this.selectSignalsStmt.all(limit) as any[];
    return rows.map((r) => ({
      id: r.id,
      setupId: r.setup_id,
      timestamp: Number(r.timestamp),
      symbol: r.symbol,
      strategy: r.strategy,
      direction: r.direction,
      timeframe: r.timeframe,
      entryPrice: Number(r.entry_price),
      stopLoss: Number(r.stop_loss),
      takeProfit: Number(r.take_profit),
      rrNet: Number(r.rr_net),
      consensusVerdict: r.consensus_verdict,
      openaiVerdict: r.openai_verdict,
      geminiVerdict: r.gemini_verdict,
      status: r.status,
      rejectionReason: r.rejection_reason,
      snapshotId: r.snapshot_id,
      createdAt: Number(r.created_at),
    }));
  }

  public close(): void {
    this.isClosed = true;
    this.db.close();
  }
}
