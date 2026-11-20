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

      CREATE TABLE IF NOT EXISTS risk_policies (
        id TEXT PRIMARY KEY,
        version INTEGER NOT NULL,
        is_active INTEGER NOT NULL,
        policy_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        created_by TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS bybit_credentials (
        id TEXT PRIMARY KEY,
        api_key TEXT NOT NULL,
        api_key_masked TEXT NOT NULL,
        encrypted_secret TEXT NOT NULL,
        environment TEXT NOT NULL,
        status TEXT NOT NULL,
        detected_permissions TEXT,
        fee_source TEXT,
        actual_maker_fee REAL,
        actual_taker_fee REAL,
        account_balance_usdt REAL,
        last_verified_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ai_provider_credentials (
        provider TEXT PRIMARY KEY,
        api_key_masked TEXT NOT NULL,
        encrypted_secret TEXT NOT NULL,
        model TEXT NOT NULL,
        status TEXT NOT NULL,
        last_verified_at INTEGER,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ai_router_config (
        id TEXT PRIMARY KEY,
        mode TEXT NOT NULL,
        profile TEXT NOT NULL,
        config_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS hard_budget_config (
        id TEXT PRIMARY KEY,
        daily_budget_limit_usd REAL NOT NULL,
        monthly_budget_limit_usd REAL NOT NULL,
        max_cost_per_request_usd REAL NOT NULL,
        provider_limits_json TEXT,
        model_limits_json TEXT,
        task_limits_json TEXT,
        alert_thresholds_json TEXT,
        auto_reset_period INTEGER NOT NULL,
        is_blocked INTEGER NOT NULL,
        blocked_reason TEXT,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ai_consumption_logs (
        id TEXT PRIMARY KEY,
        timestamp INTEGER NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        task TEXT NOT NULL,
        tokens_prompt INTEGER NOT NULL,
        tokens_completion INTEGER NOT NULL,
        tokens_cached INTEGER NOT NULL,
        cost_usd REAL NOT NULL,
        latency_ms INTEGER NOT NULL,
        status TEXT NOT NULL,
        analysis_id TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_ai_cons_time 
      ON ai_consumption_logs(timestamp DESC);

      CREATE TABLE IF NOT EXISTS config_audit_logs (
        id TEXT PRIMARY KEY,
        timestamp INTEGER NOT NULL,
        admin_user TEXT NOT NULL,
        category TEXT NOT NULL,
        action TEXT NOT NULL,
        details_json TEXT,
        ip_address TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_audit_time 
      ON config_audit_logs(timestamp DESC);

      CREATE TABLE IF NOT EXISTS admin_credentials (
        id TEXT PRIMARY KEY,
        password_hash TEXT NOT NULL,
        salt TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS admin_sessions (
        token TEXT PRIMARY KEY,
        csrf_token TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        ip_address TEXT,
        user_agent TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_expires 
      ON admin_sessions(expires_at);
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

  // --- FASE 4.5 CONFIGURATION & RISK PERSISTENCE ---

  public saveRiskPolicy(policy: any): void {
    if (this.isClosed) return;
    try {
      this.db.exec('BEGIN TRANSACTION;');
      // Deactivate previous active policies
      this.db.prepare('UPDATE risk_policies SET is_active = 0').run();
      const versionId = `risk_pol_v${policy.version || 1}_${Date.now()}`;
      this.db.prepare(`
        INSERT INTO risk_policies (id, version, is_active, policy_json, created_at, created_by)
        VALUES (?, ?, 1, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          version = excluded.version,
          is_active = 1,
          policy_json = excluded.policy_json,
          created_at = excluded.created_at,
          created_by = excluded.created_by
      `).run(versionId, policy.version || 1, JSON.stringify({ ...policy, id: versionId }), policy.updatedAt || Date.now(), policy.updatedBy || 'admin');
      this.db.exec('COMMIT;');
    } catch (err: any) {
      try { this.db.exec('ROLLBACK;'); } catch {}
      console.error('[DatabaseService] Error guardando política de riesgo:', err?.message || err);
      throw err;
    }
  }

  public getActiveRiskPolicy(): any | null {
    if (this.isClosed) return null;
    try {
      const row = this.db.prepare('SELECT * FROM risk_policies WHERE is_active = 1 ORDER BY created_at DESC LIMIT 1').get() as any;
      if (!row) return null;
      return JSON.parse(row.policy_json);
    } catch {
      return null;
    }
  }

  public saveBybitCredentials(record: any): void {
    if (this.isClosed) return;
    try {
      const id = record.id || 'primary_bybit_credentials';
      this.db.prepare(`
        INSERT INTO bybit_credentials (id, api_key, api_key_masked, encrypted_secret, environment, status, detected_permissions, fee_source, actual_maker_fee, actual_taker_fee, account_balance_usdt, last_verified_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          api_key = excluded.api_key,
          api_key_masked = excluded.api_key_masked,
          encrypted_secret = excluded.encrypted_secret,
          environment = excluded.environment,
          status = excluded.status,
          detected_permissions = excluded.detected_permissions,
          fee_source = excluded.fee_source,
          actual_maker_fee = excluded.actual_maker_fee,
          actual_taker_fee = excluded.actual_taker_fee,
          account_balance_usdt = excluded.account_balance_usdt,
          last_verified_at = excluded.last_verified_at,
          updated_at = excluded.updated_at
      `).run(
        id,
        record.apiKey,
        record.apiKeyMasked,
        JSON.stringify(record.encryptedSecret),
        record.environment,
        record.status,
        JSON.stringify(record.detectedPermissions || {}),
        record.feeSource || 'DEFAULT_BYBIT_LINEAR',
        record.actualMakerFeeRate ?? null,
        record.actualTakerFeeRate ?? null,
        record.accountBalanceUsdt ?? null,
        record.lastVerifiedAt ?? null,
        record.createdAt || Date.now(),
        record.updatedAt || Date.now()
      );
    } catch (err: any) {
      console.error('[DatabaseService] Error guardando credenciales Bybit:', err?.message || err);
      throw err;
    }
  }

  public getBybitCredentials(): any | null {
    if (this.isClosed) return null;
    try {
      const row = this.db.prepare('SELECT * FROM bybit_credentials ORDER BY updated_at DESC LIMIT 1').get() as any;
      if (!row) return null;
      return {
        id: row.id,
        apiKey: row.api_key,
        apiKeyMasked: row.api_key_masked,
        encryptedSecret: JSON.parse(row.encrypted_secret),
        environment: row.environment,
        status: row.status,
        detectedPermissions: JSON.parse(row.detected_permissions || '{}'),
        feeSource: row.fee_source,
        actualMakerFeeRate: row.actual_maker_fee !== null ? Number(row.actual_maker_fee) : undefined,
        actualTakerFeeRate: row.actual_taker_fee !== null ? Number(row.actual_taker_fee) : undefined,
        accountBalanceUsdt: row.account_balance_usdt !== null ? Number(row.account_balance_usdt) : undefined,
        lastVerifiedAt: row.last_verified_at ? Number(row.last_verified_at) : undefined,
        createdAt: Number(row.created_at),
        updatedAt: Number(row.updated_at),
      };
    } catch {
      return null;
    }
  }

  public deleteBybitCredentials(): void {
    if (this.isClosed) return;
    try {
      this.db.prepare('DELETE FROM bybit_credentials').run();
    } catch {}
  }

  public saveAiCredentials(record: { provider: string; apiKeyMasked: string; encryptedSecret: any; model: string; status: string }): void {
    if (this.isClosed) return;
    try {
      this.db.prepare(`
        INSERT INTO ai_provider_credentials (provider, api_key_masked, encrypted_secret, model, status, last_verified_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(provider) DO UPDATE SET
          api_key_masked = excluded.api_key_masked,
          encrypted_secret = excluded.encrypted_secret,
          model = excluded.model,
          status = excluded.status,
          last_verified_at = excluded.last_verified_at,
          updated_at = excluded.updated_at
      `).run(
        record.provider,
        record.apiKeyMasked,
        JSON.stringify(record.encryptedSecret),
        record.model,
        record.status,
        Date.now(),
        Date.now()
      );
    } catch {}
  }

  public getAiCredentials(provider: string): any | null {
    if (this.isClosed) return null;
    try {
      const row = this.db.prepare('SELECT * FROM ai_provider_credentials WHERE provider = ?').get(provider) as any;
      if (!row) return null;
      return {
        provider: row.provider,
        apiKeyMasked: row.api_key_masked,
        encryptedSecret: JSON.parse(row.encrypted_secret),
        model: row.model,
        status: row.status,
        lastVerifiedAt: row.last_verified_at ? Number(row.last_verified_at) : undefined,
        updatedAt: Number(row.updated_at),
      };
    } catch {
      return null;
    }
  }

  public deleteAiCredentials(provider: string): void {
    if (this.isClosed) return;
    try {
      this.db.prepare('DELETE FROM ai_provider_credentials WHERE provider = ?').run(provider);
    } catch {}
  }

  public saveRouterConfig(config: any): void {
    if (this.isClosed) return;
    try {
      this.db.prepare(`
        INSERT INTO ai_router_config (id, mode, profile, config_json, updated_at)
        VALUES ('primary_router_config', ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          mode = excluded.mode,
          profile = excluded.profile,
          config_json = excluded.config_json,
          updated_at = excluded.updated_at
      `).run(config.mode, config.profile, JSON.stringify(config), config.updatedAt || Date.now());
    } catch {}
  }

  public getRouterConfig(): any | null {
    if (this.isClosed) return null;
    try {
      const row = this.db.prepare("SELECT * FROM ai_router_config WHERE id = 'primary_router_config'").get() as any;
      if (!row) return null;
      return JSON.parse(row.config_json);
    } catch {
      return null;
    }
  }

  public saveHardBudgetConfig(config: any): void {
    if (this.isClosed) return;
    try {
      this.db.prepare(`
        INSERT INTO hard_budget_config (id, daily_budget_limit_usd, monthly_budget_limit_usd, max_cost_per_request_usd, provider_limits_json, model_limits_json, task_limits_json, alert_thresholds_json, auto_reset_period, is_blocked, blocked_reason, updated_at)
        VALUES ('primary_hard_budget', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          daily_budget_limit_usd = excluded.daily_budget_limit_usd,
          monthly_budget_limit_usd = excluded.monthly_budget_limit_usd,
          max_cost_per_request_usd = excluded.max_cost_per_request_usd,
          provider_limits_json = excluded.provider_limits_json,
          model_limits_json = excluded.model_limits_json,
          task_limits_json = excluded.task_limits_json,
          alert_thresholds_json = excluded.alert_thresholds_json,
          auto_reset_period = excluded.auto_reset_period,
          is_blocked = excluded.is_blocked,
          blocked_reason = excluded.blocked_reason,
          updated_at = excluded.updated_at
      `).run(
        config.dailyBudgetLimitUsd,
        config.monthlyBudgetLimitUsd,
        config.maxCostPerRequestUsd,
        JSON.stringify(config.providerLimitsUsd || {}),
        JSON.stringify(config.modelLimitsUsd || {}),
        JSON.stringify(config.taskLimitsUsd || {}),
        JSON.stringify(config.alertThresholdsPercent || [50, 80, 95, 100]),
        config.autoResetPeriod ? 1 : 0,
        config.isBlocked ? 1 : 0,
        config.blockedReason || null,
        config.updatedAt || Date.now()
      );
    } catch (err: any) {
      console.error('[DatabaseService] Error guardando hard_budget_config:', err?.message || err);
      throw err;
    }
  }

  public getHardBudgetConfig(): any | null {
    if (this.isClosed) return null;
    try {
      const row = this.db.prepare("SELECT * FROM hard_budget_config WHERE id = 'primary_hard_budget'").get() as any;
      if (!row) return null;
      return {
        dailyBudgetLimitUsd: Number(row.daily_budget_limit_usd),
        monthlyBudgetLimitUsd: Number(row.monthly_budget_limit_usd),
        maxCostPerRequestUsd: Number(row.max_cost_per_request_usd),
        providerLimitsUsd: JSON.parse(row.provider_limits_json || '{}'),
        modelLimitsUsd: JSON.parse(row.model_limits_json || '{}'),
        taskLimitsUsd: JSON.parse(row.task_limits_json || '{}'),
        alertThresholdsPercent: JSON.parse(row.alert_thresholds_json || '[50, 80, 95, 100]'),
        autoResetPeriod: row.auto_reset_period === 1,
        isBlocked: row.is_blocked === 1,
        blockedReason: row.blocked_reason,
        updatedAt: Number(row.updated_at),
      };
    } catch {
      return null;
    }
  }

  public logAiConsumption(log: {
    id?: string;
    timestamp?: number;
    provider: string;
    model: string;
    task: string;
    tokensPrompt: number;
    tokensCompletion: number;
    tokensCached?: number;
    costUsd: number;
    latencyMs: number;
    status: string;
    analysisId?: string;
  }): void {
    if (this.isClosed) return;
    try {
      const id = log.id || `cons_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      this.db.prepare(`
        INSERT INTO ai_consumption_logs (id, timestamp, provider, model, task, tokens_prompt, tokens_completion, tokens_cached, cost_usd, latency_ms, status, analysis_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        log.timestamp || Date.now(),
        log.provider,
        log.model,
        log.task,
        log.tokensPrompt || 0,
        log.tokensCompletion || 0,
        log.tokensCached || 0,
        log.costUsd || 0,
        log.latencyMs || 0,
        log.status || 'SUCCESS',
        log.analysisId || null
      );
    } catch {}
  }

  public getAiConsumptionLogs(limit: number = 100, provider?: string): any[] {
    if (this.isClosed) return [];
    try {
      const stmt = provider
        ? this.db.prepare('SELECT * FROM ai_consumption_logs WHERE provider = ? ORDER BY timestamp DESC LIMIT ?')
        : this.db.prepare('SELECT * FROM ai_consumption_logs ORDER BY timestamp DESC LIMIT ?');
      const rows = (provider ? stmt.all(provider, limit) : stmt.all(limit)) as any[];
      return rows.map((r) => ({
        id: r.id,
        timestamp: Number(r.timestamp),
        provider: r.provider,
        model: r.model,
        task: r.task,
        tokensPrompt: Number(r.tokens_prompt),
        tokensCompletion: Number(r.tokens_completion),
        tokensCached: Number(r.tokens_cached),
        costUsd: Number(r.cost_usd),
        latencyMs: Number(r.latency_ms),
        status: r.status,
        analysisId: r.analysis_id,
      }));
    } catch {
      return [];
    }
  }

  public getAiConsumptionStats(): any {
    if (this.isClosed) return {};
    try {
      const now = Date.now();
      const startOfToday = new Date().setHours(0, 0, 0, 0);
      const startOfYesterday = startOfToday - 86400000;
      const startOfLast7Days = now - 7 * 86400000;
      const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();

      const todayRow = this.db.prepare('SELECT COALESCE(SUM(cost_usd), 0) as spend, COUNT(*) as calls FROM ai_consumption_logs WHERE timestamp >= ?').get(startOfToday) as any;
      const yesterdayRow = this.db.prepare('SELECT COALESCE(SUM(cost_usd), 0) as spend FROM ai_consumption_logs WHERE timestamp >= ? AND timestamp < ?').get(startOfYesterday, startOfToday) as any;
      const weekRow = this.db.prepare('SELECT COALESCE(SUM(cost_usd), 0) as spend FROM ai_consumption_logs WHERE timestamp >= ?').get(startOfLast7Days) as any;
      const monthRow = this.db.prepare('SELECT COALESCE(SUM(cost_usd), 0) as spend FROM ai_consumption_logs WHERE timestamp >= ?').get(startOfMonth) as any;
      const totalRow = this.db.prepare('SELECT COALESCE(SUM(cost_usd), 0) as spend, COALESCE(SUM(tokens_prompt), 0) as prompt, COALESCE(SUM(tokens_completion), 0) as comp, COALESCE(SUM(tokens_cached), 0) as cached, COUNT(*) as calls, COALESCE(AVG(latency_ms), 0) as avgLat FROM ai_consumption_logs').get() as any;

      const byProviderRows = this.db.prepare('SELECT provider, COALESCE(SUM(cost_usd), 0) as spend, COUNT(*) as calls FROM ai_consumption_logs GROUP BY provider').all() as any[];
      const byModelRows = this.db.prepare('SELECT model, COALESCE(SUM(cost_usd), 0) as spend, COUNT(*) as calls FROM ai_consumption_logs GROUP BY model ORDER BY spend DESC LIMIT 10').all() as any[];
      const byTaskRows = this.db.prepare('SELECT task, COALESCE(SUM(cost_usd), 0) as spend, COUNT(*) as calls FROM ai_consumption_logs GROUP BY task ORDER BY spend DESC').all() as any[];

      return {
        todaySpendUsd: Number(todayRow?.spend || 0),
        todayCalls: Number(todayRow?.calls || 0),
        yesterdaySpendUsd: Number(yesterdayRow?.spend || 0),
        last7DaysSpendUsd: Number(weekRow?.spend || 0),
        monthSpendUsd: Number(monthRow?.spend || 0),
        totalSpendUsd: Number(totalRow?.spend || 0),
        totalPromptTokens: Number(totalRow?.prompt || 0),
        totalCompletionTokens: Number(totalRow?.comp || 0),
        totalCachedTokens: Number(totalRow?.cached || 0),
        totalCalls: Number(totalRow?.calls || 0),
        avgLatencyMs: Math.round(Number(totalRow?.avgLat || 0)),
        byProvider: byProviderRows,
        byModel: byModelRows,
        byTask: byTaskRows,
      };
    } catch {
      return {};
    }
  }

  public logConfigAudit(record: {
    id?: string;
    adminUser?: string;
    category: string;
    action: string;
    details?: any;
    ipAddress?: string;
  }): void {
    if (this.isClosed) return;
    try {
      const id = record.id || `aud_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      this.db.prepare(`
        INSERT INTO config_audit_logs (id, timestamp, admin_user, category, action, details_json, ip_address)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        Date.now(),
        record.adminUser || 'admin',
        record.category,
        record.action,
        record.details ? JSON.stringify(record.details) : null,
        record.ipAddress || null
      );
    } catch {}
  }

  public getConfigAuditLogs(limit: number = 50): any[] {
    if (this.isClosed) return [];
    try {
      const rows = this.db.prepare('SELECT * FROM config_audit_logs ORDER BY timestamp DESC LIMIT ?').all(limit) as any[];
      return rows.map((r) => ({
        id: r.id,
        timestamp: Number(r.timestamp),
        adminUser: r.admin_user,
        category: r.category,
        action: r.action,
        details: r.details_json ? JSON.parse(r.details_json) : null,
        ipAddress: r.ip_address,
      }));
    } catch {
      return [];
    }
  }

  public getAdminCredentials(): { passwordHash: string; salt: string; createdAt: number; updatedAt: number } | null {
    if (this.isClosed) return null;
    try {
      const row = this.db.prepare("SELECT * FROM admin_credentials WHERE id = 'primary_admin'").get() as any;
      if (!row) return null;
      return {
        passwordHash: row.password_hash,
        salt: row.salt,
        createdAt: Number(row.created_at),
        updatedAt: Number(row.updated_at),
      };
    } catch {
      return null;
    }
  }

  public setAdminCredentials(passwordHash: string, salt: string): void {
    if (this.isClosed) return;
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO admin_credentials (id, password_hash, salt, created_at, updated_at)
      VALUES ('primary_admin', ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        password_hash = excluded.password_hash,
        salt = excluded.salt,
        updated_at = excluded.updated_at
    `).run(passwordHash, salt, now, now);
  }

  public hasAdminCredentials(): boolean {
    return this.getAdminCredentials() !== null;
  }

  public saveAdminSession(session: {
    token: string;
    csrfToken: string;
    createdAt: number;
    expiresAt: number;
    ipAddress?: string;
    userAgent?: string;
  }): void {
    if (this.isClosed) return;
    this.db.prepare(`
      INSERT INTO admin_sessions (token, csrf_token, created_at, expires_at, ip_address, user_agent)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(token) DO UPDATE SET
        expires_at = excluded.expires_at,
        ip_address = excluded.ip_address,
        user_agent = excluded.user_agent
    `).run(session.token, session.csrfToken, session.createdAt, session.expiresAt, session.ipAddress || null, session.userAgent || null);
  }

  public getAdminSession(token: string): {
    token: string;
    csrfToken: string;
    createdAt: number;
    expiresAt: number;
    ipAddress?: string;
    userAgent?: string;
  } | null {
    if (this.isClosed) return null;
    try {
      const row = this.db.prepare('SELECT * FROM admin_sessions WHERE token = ?').get(token) as any;
      if (!row) return null;
      return {
        token: row.token,
        csrfToken: row.csrf_token,
        createdAt: Number(row.created_at),
        expiresAt: Number(row.expires_at),
        ipAddress: row.ip_address,
        userAgent: row.user_agent,
      };
    } catch {
      return null;
    }
  }

  public deleteAdminSession(token: string): void {
    if (this.isClosed) return;
    try {
      this.db.prepare('DELETE FROM admin_sessions WHERE token = ?').run(token);
    } catch {}
  }

  public deleteExpiredAdminSessions(): void {
    if (this.isClosed) return;
    try {
      this.db.prepare('DELETE FROM admin_sessions WHERE expires_at < ?').run(Date.now());
    } catch {}
  }

  public close(): void {
    this.isClosed = true;
    this.db.close();
  }
}
