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
  private insertLifecycleStmt: any;
  private selectLifecycleStmt: any;
  private upsertPushSubStmt: any;
  private deletePushSubStmt: any;
  private selectPushSubsStmt: any;
  private insertNotifLogStmt: any;
  private selectNotifLogStmt: any;
  private selectActiveSignalsStmt: any;
  private updateSignalMetricsStmt: any;

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

      CREATE TABLE IF NOT EXISTS signal_lifecycle (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        signal_id TEXT NOT NULL,
        from_state TEXT NOT NULL,
        to_state TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        reason TEXT,
        metadata TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_lifecycle_signal 
      ON signal_lifecycle(signal_id, timestamp ASC);

      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id TEXT PRIMARY KEY,
        endpoint TEXT NOT NULL UNIQUE,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        user_id TEXT,
        created_at INTEGER NOT NULL,
        last_active INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS notifications_log (
        id TEXT PRIMARY KEY,
        channel TEXT NOT NULL,
        recipient TEXT NOT NULL,
        signal_id TEXT,
        message_type TEXT NOT NULL,
        payload TEXT,
        status TEXT NOT NULL,
        delivered_at INTEGER,
        timestamp INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_notif_time 
      ON notifications_log(timestamp DESC);
    `);

    // Signal columns migration for tracking metrics
    const extraCols = [
      'simulated_entry_time INTEGER',
      'exit_time INTEGER',
      'duration_ms INTEGER',
      'exit_price REAL',
      'mfe_price REAL',
      'mfe_r REAL',
      'mae_price REAL',
      'mae_r REAL',
      'realized_net_r REAL',
      'realized_net_pnl_usdt REAL',
      "entry_mode TEXT DEFAULT 'SIGNALS_ONLY'",
      "evaluation_mode TEXT DEFAULT 'DUAL_AI'",
    ];
    for (const col of extraCols) {
      try {
        this.db.exec(`ALTER TABLE signals ADD COLUMN ${col}`);
      } catch {}
    }
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
      INSERT INTO signals (id, setup_id, timestamp, symbol, strategy, direction, timeframe, entry_price, stop_loss, take_profit, rr_net, consensus_verdict, openai_verdict, gemini_verdict, status, rejection_reason, snapshot_id, created_at, evaluation_mode)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        rejection_reason = excluded.rejection_reason,
        evaluation_mode = coalesce(excluded.evaluation_mode, signals.evaluation_mode)
    `);

    this.selectSignalsStmt = this.db.prepare(`
      SELECT * FROM signals ORDER BY timestamp DESC LIMIT ?
    `);

    this.insertLifecycleStmt = this.db.prepare(`
      INSERT INTO signal_lifecycle (signal_id, from_state, to_state, timestamp, reason, metadata)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    this.selectLifecycleStmt = this.db.prepare(`
      SELECT * FROM signal_lifecycle WHERE signal_id = ? ORDER BY timestamp ASC
    `);

    this.upsertPushSubStmt = this.db.prepare(`
      INSERT INTO push_subscriptions (id, endpoint, p256dh, auth, user_id, created_at, last_active)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(endpoint) DO UPDATE SET
        p256dh = excluded.p256dh,
        auth = excluded.auth,
        last_active = excluded.last_active
    `);

    this.deletePushSubStmt = this.db.prepare(`
      DELETE FROM push_subscriptions WHERE endpoint = ?
    `);

    this.selectPushSubsStmt = this.db.prepare(`
      SELECT * FROM push_subscriptions
    `);

    this.insertNotifLogStmt = this.db.prepare(`
      INSERT INTO notifications_log (id, channel, recipient, signal_id, message_type, payload, status, delivered_at, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.selectNotifLogStmt = this.db.prepare(`
      SELECT * FROM notifications_log ORDER BY timestamp DESC LIMIT ?
    `);

    this.selectActiveSignalsStmt = this.db.prepare(`
      SELECT * FROM signals WHERE status NOT IN ('COMPLETED_TP', 'COMPLETED_SL', 'EXPIRED', 'INVALIDATED', 'CANCELLED', 'DISCARDED') ORDER BY timestamp ASC
    `);

    this.updateSignalMetricsStmt = this.db.prepare(`
      UPDATE signals SET
        status = coalesce(?, status),
        simulated_entry_time = coalesce(?, simulated_entry_time),
        exit_time = coalesce(?, exit_time),
        duration_ms = coalesce(?, duration_ms),
        exit_price = coalesce(?, exit_price),
        mfe_price = coalesce(?, mfe_price),
        mfe_r = coalesce(?, mfe_r),
        mae_price = coalesce(?, mae_price),
        mae_r = coalesce(?, mae_r),
        realized_net_r = coalesce(?, realized_net_r),
        realized_net_pnl_usdt = coalesce(?, realized_net_pnl_usdt),
        entry_mode = coalesce(?, entry_mode)
      WHERE id = ?
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
        signal.createdAt || Date.now(),
        signal.evaluationMode || 'DUAL_AI'
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
      evaluationMode: r.evaluation_mode || 'DUAL_AI',
      simulatedEntryTime: r.simulated_entry_time ? Number(r.simulated_entry_time) : null,
      exitTime: r.exit_time ? Number(r.exit_time) : null,
      durationMs: r.duration_ms ? Number(r.duration_ms) : null,
      exitPrice: r.exit_price !== null && r.exit_price !== undefined ? Number(r.exit_price) : null,
      mfePrice: r.mfe_price !== null && r.mfe_price !== undefined ? Number(r.mfe_price) : null,
      mfeR: r.mfe_r !== null && r.mfe_r !== undefined ? Number(r.mfe_r) : null,
      maePrice: r.mae_price !== null && r.mae_price !== undefined ? Number(r.mae_price) : null,
      maeR: r.mae_r !== null && r.mae_r !== undefined ? Number(r.mae_r) : null,
      realizedNetR: r.realized_net_r !== null && r.realized_net_r !== undefined ? Number(r.realized_net_r) : null,
      realizedNetPnlUsdt: r.realized_net_pnl_usdt !== null && r.realized_net_pnl_usdt !== undefined ? Number(r.realized_net_pnl_usdt) : null,
      entryMode: r.entry_mode || 'SIGNALS_ONLY',
    }));
  }

  public recordSignalTransition(transition: {
    signalId: string;
    fromState: string;
    toState: string;
    timestamp: number;
    reason?: string;
    metadata?: any;
  }): void {
    if (this.isClosed) return;
    try {
      this.insertLifecycleStmt.run(
        transition.signalId,
        transition.fromState,
        transition.toState,
        transition.timestamp,
        transition.reason || null,
        transition.metadata ? JSON.stringify(transition.metadata) : null
      );
    } catch {}
  }

  public getSignalLifecycle(signalId: string): any[] {
    if (this.isClosed) return [];
    try {
      const rows = this.selectLifecycleStmt.all(signalId) as any[];
      return rows.map((r) => ({
        id: r.id,
        signalId: r.signal_id,
        fromState: r.from_state,
        toState: r.to_state,
        timestamp: Number(r.timestamp),
        reason: r.reason,
        metadata: r.metadata ? JSON.parse(r.metadata) : null,
      }));
    } catch {
      return [];
    }
  }

  public savePushSubscription(sub: {
    id: string;
    endpoint: string;
    p256dh: string;
    auth: string;
    userId?: string;
    createdAt: number;
    lastActive: number;
  }): void {
    if (this.isClosed) return;
    try {
      this.upsertPushSubStmt.run(
        sub.id,
        sub.endpoint,
        sub.p256dh,
        sub.auth,
        sub.userId || null,
        sub.createdAt,
        sub.lastActive
      );
    } catch {}
  }

  public deletePushSubscription(endpoint: string): void {
    if (this.isClosed) return;
    try {
      this.deletePushSubStmt.run(endpoint);
    } catch {}
  }

  public getPushSubscriptions(): any[] {
    if (this.isClosed) return [];
    try {
      const rows = this.selectPushSubsStmt.all() as any[];
      return rows.map((r) => ({
        id: r.id,
        endpoint: r.endpoint,
        p256dh: r.p256dh,
        auth: r.auth,
        userId: r.user_id,
        createdAt: Number(r.created_at),
        lastActive: Number(r.last_active),
      }));
    } catch {
      return [];
    }
  }

  public logNotification(record: {
    id: string;
    channel: string;
    recipient: string;
    signalId?: string;
    messageType: string;
    payload?: any;
    status: string;
    deliveredAt?: number;
    timestamp: number;
  }): void {
    if (this.isClosed) return;
    try {
      this.insertNotifLogStmt.run(
        record.id,
        record.channel,
        record.recipient,
        record.signalId || null,
        record.messageType,
        record.payload ? (typeof record.payload === 'string' ? record.payload : JSON.stringify(record.payload)) : null,
        record.status,
        record.deliveredAt || null,
        record.timestamp
      );
    } catch {}
  }

  public getNotificationHistory(limit: number = 50): any[] {
    if (this.isClosed) return [];
    try {
      const rows = this.selectNotifLogStmt.all(limit) as any[];
      return rows.map((r) => ({
        id: r.id,
        channel: r.channel,
        recipient: r.recipient,
        signalId: r.signal_id,
        messageType: r.message_type,
        payload: r.payload,
        status: r.status,
        deliveredAt: r.delivered_at ? Number(r.delivered_at) : null,
        timestamp: Number(r.timestamp),
      }));
    } catch {
      return [];
    }
  }

  public updateSignalMetrics(
    id: string,
    metrics: {
      status?: string;
      simulatedEntryTime?: number;
      exitTime?: number;
      durationMs?: number;
      exitPrice?: number;
      mfePrice?: number;
      mfeR?: number;
      maePrice?: number;
      maeR?: number;
      realizedNetR?: number;
      realizedNetPnlUsdt?: number;
      entryMode?: string;
    }
  ): void {
    if (this.isClosed) return;
    try {
      this.updateSignalMetricsStmt.run(
        metrics.status ?? null,
        metrics.simulatedEntryTime ?? null,
        metrics.exitTime ?? null,
        metrics.durationMs ?? null,
        metrics.exitPrice ?? null,
        metrics.mfePrice ?? null,
        metrics.mfeR ?? null,
        metrics.maePrice ?? null,
        metrics.maeR ?? null,
        metrics.realizedNetR ?? null,
        metrics.realizedNetPnlUsdt ?? null,
        metrics.entryMode ?? null,
        id
      );
    } catch {}
  }

  public getActiveSignalsForRecovery(): any[] {
    if (this.isClosed) return [];
    try {
      const rows = this.selectActiveSignalsStmt.all() as any[];
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
        evaluationMode: r.evaluation_mode || 'DUAL_AI',
        simulatedEntryTime: r.simulated_entry_time ? Number(r.simulated_entry_time) : null,
        exitTime: r.exit_time ? Number(r.exit_time) : null,
        durationMs: r.duration_ms ? Number(r.duration_ms) : null,
        exitPrice: r.exit_price !== null && r.exit_price !== undefined ? Number(r.exit_price) : null,
        mfePrice: r.mfe_price !== null && r.mfe_price !== undefined ? Number(r.mfe_price) : null,
        mfeR: r.mfe_r !== null && r.mfe_r !== undefined ? Number(r.mfe_r) : null,
        maePrice: r.mae_price !== null && r.mae_price !== undefined ? Number(r.mae_price) : null,
        maeR: r.mae_r !== null && r.mae_r !== undefined ? Number(r.mae_r) : null,
        realizedNetR: r.realized_net_r !== null && r.realized_net_r !== undefined ? Number(r.realized_net_r) : null,
        realizedNetPnlUsdt: r.realized_net_pnl_usdt !== null && r.realized_net_pnl_usdt !== undefined ? Number(r.realized_net_pnl_usdt) : null,
        entryMode: r.entry_mode || 'SIGNALS_ONLY',
      }));
    } catch {
      return [];
    }
  }

  public close(): void {
    this.isClosed = true;
    this.db.close();
  }
}
