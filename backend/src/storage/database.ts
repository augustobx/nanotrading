import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { Candle, Timeframe } from '../types/market.js';
import { config } from '../config/index.js';
import type { DiscoveryAudit } from '../ai/discovery-audit.js';
import { Scenario, ScenarioLifecycleEvent, ScenarioRevalidationRecord, ScenarioStatus, AiWatchPlan, WatchPlanStatus } from '../ai/scenario-types.js';

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
  private dbPath: string;

  constructor(customPath?: string) {
    const dbPath = customPath || config.storage.sqlitePath;
    this.dbPath = dbPath;

    // Ensure directory exists if not memory
    if (dbPath !== ':memory:') {
      const dir = path.dirname(dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      // Back up only AFTER SQLite opens and recovers WAL; copying now can
      // silently omit transactions that still live in the WAL sidecar.
    }

    this.db = new DatabaseSync(dbPath);
    this.init();
    this.prepareStatements();
    this.db.exec('CREATE TABLE IF NOT EXISTS runtime_flags (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    if (dbPath !== ':memory:' && fs.existsSync(dbPath)) this.backup();
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

      CREATE TABLE IF NOT EXISTS discovery_analyses (
        id TEXT PRIMARY KEY,
        timestamp INTEGER NOT NULL,
        outcome TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_discovery_analyses_time ON discovery_analyses(timestamp DESC);

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
        openai_free_tier_json TEXT,
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
        tokens_reasoning INTEGER DEFAULT 0,
        cost_usd REAL NOT NULL,
        cost_gross_usd REAL DEFAULT 0,
        discount_usd REAL DEFAULT 0,
        cost_net_usd REAL DEFAULT 0,
        free_tier_group TEXT DEFAULT 'NONE',
        is_free_tier INTEGER DEFAULT 0,
        discount_status TEXT DEFAULT 'NONE',
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

      CREATE TABLE IF NOT EXISTS scenarios (
        id TEXT PRIMARY KEY,
        symbol TEXT NOT NULL,
        direction TEXT NOT NULL,
        timeframe TEXT NOT NULL,
        structure_type TEXT NOT NULL,
        proposed_by TEXT NOT NULL,
        models_used TEXT NOT NULL,
        snapshot_id TEXT NOT NULL,
        discovery_timestamp INTEGER NOT NULL,
        entry_zone_min REAL NOT NULL,
        entry_zone_max REAL NOT NULL,
        target_entry REAL NOT NULL,
        stop_loss_price REAL NOT NULL,
        target_12_price REAL,
        target_14_price REAL,
        net_rr_12 REAL,
        net_rr_14 REAL,
        rr_mode_available TEXT NOT NULL,
        uncertainty_level TEXT NOT NULL,
        status TEXT NOT NULL,
        rejection_reason TEXT,
        valid_until_timestamp INTEGER NOT NULL,
        ai_cost_usd REAL DEFAULT 0,
        payload_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_scenarios_status 
      ON scenarios(status, discovery_timestamp DESC);

      CREATE TABLE IF NOT EXISTS scenario_lifecycle (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scenario_id TEXT NOT NULL,
        from_status TEXT NOT NULL,
        to_status TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        reason TEXT,
        metadata_json TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_scen_life_id 
      ON scenario_lifecycle(scenario_id, timestamp ASC);

      CREATE TABLE IF NOT EXISTS scenario_revalidations (
        id TEXT PRIMARY KEY,
        scenario_id TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        openai_verdict TEXT,
        gemini_verdict TEXT,
        consensus_verdict TEXT NOT NULL,
        price_at_revalidation REAL NOT NULL,
        details_json TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_scen_reval_id 
      ON scenario_revalidations(scenario_id, timestamp DESC);

      CREATE TABLE IF NOT EXISTS ai_watch_plans (
        id TEXT PRIMARY KEY,
        scenario_id TEXT NOT NULL,
        symbol TEXT NOT NULL,
        direction TEXT NOT NULL,
        horizon TEXT NOT NULL,
        primary_timeframe TEXT NOT NULL,
        watch_zone_min REAL NOT NULL,
        watch_zone_max REAL NOT NULL,
        target_entry REAL NOT NULL,
        candidate_stop_loss REAL NOT NULL,
        candidate_tp12 REAL,
        candidate_tp14 REAL,
        rr_eligibility TEXT NOT NULL,
        status TEXT NOT NULL,
        automatable INTEGER NOT NULL,
        expiration_timestamp INTEGER NOT NULL,
        plan_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_watch_plans_status 
      ON ai_watch_plans(status, expiration_timestamp DESC);

      CREATE INDEX IF NOT EXISTS idx_watch_plans_scen_id 
      ON ai_watch_plans(scenario_id);

      CREATE TABLE IF NOT EXISTS discovery_scheduler_config (
        id TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL DEFAULT 1,
        interval_minutes INTEGER NOT NULL DEFAULT 60,
        trigger_on_1h_close INTEGER NOT NULL DEFAULT 1,
        trigger_on_15m_structure INTEGER NOT NULL DEFAULT 1,
        min_price_move_pct REAL NOT NULL DEFAULT 1.5,
        min_cooldown_minutes INTEGER NOT NULL DEFAULT 15,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS historical_candles (
        symbol TEXT NOT NULL,
        timeframe TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        open REAL NOT NULL,
        high REAL NOT NULL,
        low REAL NOT NULL,
        close REAL NOT NULL,
        volume REAL NOT NULL,
        turnover REAL NOT NULL,
        PRIMARY KEY (symbol, timeframe, timestamp)
      );

      CREATE INDEX IF NOT EXISTS idx_hist_candles_tf_time
      ON historical_candles(symbol, timeframe, timestamp ASC);

      CREATE TABLE IF NOT EXISTS backtest_runs (
        id TEXT PRIMARY KEY,
        symbol TEXT NOT NULL,
        start_timestamp INTEGER NOT NULL,
        end_timestamp INTEGER NOT NULL,
        in_sample_end_timestamp INTEGER NOT NULL,
        status TEXT NOT NULL,
        total_trades INTEGER NOT NULL DEFAULT 0,
        win_rate REAL NOT NULL DEFAULT 0,
        profit_factor REAL NOT NULL DEFAULT 0,
        expectancy_r REAL NOT NULL DEFAULT 0,
        max_drawdown_pct REAL NOT NULL DEFAULT 0,
        net_pnl_usdt REAL NOT NULL DEFAULT 0,
        net_pnl_r REAL NOT NULL DEFAULT 0,
        in_sample_metrics_json TEXT,
        out_sample_metrics_json TEXT,
        breakdown_json TEXT,
        config_json TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_backtest_runs_time
      ON backtest_runs(created_at DESC);

      CREATE TABLE IF NOT EXISTS backtest_trades (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        symbol TEXT NOT NULL,
        strategy TEXT NOT NULL,
        direction TEXT NOT NULL,
        ratio_target TEXT NOT NULL,
        timeframe TEXT NOT NULL,
        entry_timestamp INTEGER NOT NULL,
        exit_timestamp INTEGER NOT NULL,
        entry_price REAL NOT NULL,
        stop_loss_price REAL NOT NULL,
        take_profit_price REAL NOT NULL,
        exit_price REAL NOT NULL,
        outcome TEXT NOT NULL,
        realized_net_pnl_usdt REAL NOT NULL,
        realized_net_r REAL NOT NULL,
        mfe_price REAL NOT NULL,
        mfe_r REAL NOT NULL,
        mae_price REAL NOT NULL,
        mae_r REAL NOT NULL,
        duration_ms INTEGER NOT NULL,
        is_in_sample INTEGER NOT NULL,
        fees_usdt REAL NOT NULL,
        spread_cost_usdt REAL NOT NULL,
        slippage_cost_usdt REAL NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_backtest_trades_run
      ON backtest_trades(run_id, entry_timestamp ASC);
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
      'risk_usdt REAL',
      'position_size_btc REAL',
    ];
    for (const col of extraCols) {
      try {
        this.db.exec(`ALTER TABLE signals ADD COLUMN ${col}`);
      } catch {}
    }

    const consumptionExtraCols = [
      'tokens_reasoning INTEGER DEFAULT 0',
      'cost_gross_usd REAL DEFAULT 0',
      'discount_usd REAL DEFAULT 0',
      'cost_net_usd REAL DEFAULT 0',
      "free_tier_group TEXT DEFAULT 'NONE'",
      'is_free_tier INTEGER DEFAULT 0',
      "discount_status TEXT DEFAULT 'NONE'",
    ];
    for (const col of consumptionExtraCols) {
      try {
        this.db.exec(`ALTER TABLE ai_consumption_logs ADD COLUMN ${col}`);
      } catch {}
    }

    try {
      this.db.exec("ALTER TABLE hard_budget_config ADD COLUMN openai_free_tier_json TEXT");
    } catch {}

    const tradeAuditCols = [
      'initial_risk_usdt REAL DEFAULT 0',
      'position_size_btc REAL DEFAULT 0',
      'gross_pnl_usdt REAL DEFAULT 0',
      'capital_before_usdt REAL DEFAULT 0',
      'capital_after_usdt REAL DEFAULT 0',
      'is_executed_in_portfolio INTEGER DEFAULT 0',
      'expected_net_rr REAL DEFAULT 0',
      'structural_justification TEXT DEFAULT ""',
      'exclusion_reason TEXT DEFAULT ""',
    ];
    for (const col of tradeAuditCols) {
      try {
        this.db.exec(`ALTER TABLE backtest_trades ADD COLUMN ${col}`);
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
      INSERT INTO signals (id, setup_id, timestamp, symbol, strategy, direction, timeframe, entry_price, stop_loss, take_profit, rr_net, consensus_verdict, openai_verdict, gemini_verdict, status, rejection_reason, snapshot_id, created_at, evaluation_mode, risk_usdt, position_size_btc)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

  public saveDiscoveryAudit(audit: DiscoveryAudit): void {
    if (this.isClosed) throw new Error('Cannot persist discovery audit: database closed');
    this.db.prepare(`INSERT INTO discovery_analyses (id, timestamp, outcome, payload_json)
      VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET outcome=excluded.outcome, payload_json=excluded.payload_json`)
      .run(audit.id, audit.timestamp, audit.outcome, JSON.stringify(audit));
  }

  public getDiscoveryAudit(id: string): DiscoveryAudit | null {
    const row = this.db.prepare('SELECT payload_json FROM discovery_analyses WHERE id=?').get(id) as any;
    return row ? JSON.parse(row.payload_json) : null;
  }

  public getDiscoveryAudits(limit = 20, symbol?: string): DiscoveryAudit[] {
    const bounded = Number.isFinite(limit) ? Math.max(1, Math.min(100, Math.floor(limit))) : 20;
    const rows = symbol
      ? this.db.prepare(`SELECT payload_json FROM discovery_analyses
        WHERE json_extract(payload_json, '$.snapshot.symbol') = ?
        ORDER BY timestamp DESC LIMIT ?`).all(symbol, bounded)
      : this.db.prepare('SELECT payload_json FROM discovery_analyses ORDER BY timestamp DESC LIMIT ?').all(bounded);
    return (rows as any[]).map(row => JSON.parse(row.payload_json));
  }

  public getDiscoveryAuditsForScenario(scenarioId: string): DiscoveryAudit[] {
    return (this.db.prepare(`SELECT a.payload_json FROM discovery_analyses a
      WHERE EXISTS (SELECT 1 FROM json_each(a.payload_json, '$.scenarioIds') s WHERE s.value=?)
      ORDER BY a.timestamp DESC LIMIT 5`).all(scenarioId) as any[]).map(row => JSON.parse(row.payload_json));
  }

  public getDiscoveryFunnel(symbol?: string): Record<string, unknown> {
    const bind = symbol ? [symbol] : [];
    const scenariosFilter = symbol ? ' WHERE symbol = ?' : '';
    const auditsFilter = symbol ?
      " WHERE json_extract(a.payload_json, '$.snapshot.symbol') = ?" : '';
    const signalsFilter = symbol ? ' WHERE symbol = ?' : '';
    const counts = this.db.prepare(`SELECT COUNT(*) scenarios,
      SUM(CASE WHEN direction='NEUTRAL' THEN 1 ELSE 0 END) neutral,
      SUM(CASE WHEN direction='LONG' THEN 1 ELSE 0 END) longs,
      SUM(CASE WHEN direction='SHORT' THEN 1 ELSE 0 END) shorts,
      SUM(CASE WHEN direction='NEUTRAL' AND status='COMPLETED' THEN 1 ELSE 0 END) neutralBreakouts,
      SUM(CASE WHEN snapshot_id NOT IN (SELECT id FROM discovery_analyses) THEN 1 ELSE 0 END) legacyScenarios
      FROM scenarios${scenariosFilter}`).get(...bind);
    const signals = this.db.prepare(`SELECT SUM(CASE WHEN consensus_verdict='AUTHORIZED' THEN 1 ELSE 0 END) authorizedSignals,
      COUNT(simulated_entry_time) paperEntries,
      SUM(CASE WHEN simulated_entry_time IS NOT NULL AND exit_time IS NOT NULL THEN 1 ELSE 0 END) paperClosed
      FROM signals${signalsFilter}`).get(...bind);
    return {
      ...counts, ...signals,
      analyses: this.db.prepare(`SELECT a.outcome, COUNT(*) count FROM discovery_analyses a
        ${auditsFilter} GROUP BY a.outcome`).all(...bind),
      candidates: this.db.prepare(`SELECT json_extract(c.value, '$.reason') reason, COUNT(*) count
        FROM discovery_analyses a, json_each(a.payload_json, '$.candidates') c
        ${auditsFilter} GROUP BY 1`).all(...bind),
      providers: this.db.prepare(`SELECT p.key provider, json_extract(p.value, '$.status') status, COUNT(*) count
        FROM discovery_analyses a, json_each(a.payload_json, '$.providers') p
        ${auditsFilter} GROUP BY 1,2`).all(...bind),
      revalidations: this.db.prepare(`SELECT s.direction, r.consensus_verdict verdict, COUNT(*) count
        FROM scenario_revalidations r JOIN scenarios s ON s.id=r.scenario_id
        ${symbol ? 'WHERE s.symbol = ?' : ''} GROUP BY 1,2`).all(...bind),
      zoneConfirmed: this.db.prepare(`SELECT s.direction, COUNT(DISTINCT l.scenario_id) count
        FROM scenario_lifecycle l JOIN scenarios s ON s.id=l.scenario_id
        WHERE l.to_status='IN_ZONE' ${symbol ? 'AND s.symbol = ?' : ''}
        GROUP BY 1`).all(...bind),
    };
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
        signal.evaluationMode || 'DUAL_AI',
        signal.riskUsdt ?? null,
        signal.positionSizeBTC ?? null
      );
    } catch {}
  }

  public getSignals(limit: number = 50, symbol?: string): any[] {
    if (this.isClosed) return [];
    const bounded = Number.isFinite(limit) ? Math.max(1, Math.min(500, Math.floor(limit))) : 50;
    const rows = symbol
      ? this.db.prepare('SELECT * FROM signals WHERE symbol = ? ORDER BY timestamp DESC LIMIT ?').all(symbol, bounded) as any[]
      : this.selectSignalsStmt.all(bounded) as any[];
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
      riskUsdt: r.risk_usdt != null ? Number(r.risk_usdt) : null,
      positionSizeBTC: r.position_size_btc != null ? Number(r.position_size_btc) : null,
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

  public getActiveSignalsForRecovery(symbol?: string): any[] {
    if (this.isClosed) return [];
    try {
      const rows = this.selectActiveSignalsStmt.all() as any[];
      return rows.filter((r) => !symbol || r.symbol === symbol).map((r) => ({
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
        riskUsdt: r.risk_usdt != null ? Number(r.risk_usdt) : null,
        positionSizeBTC: r.position_size_btc != null ? Number(r.position_size_btc) : null,
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
        INSERT INTO hard_budget_config (id, daily_budget_limit_usd, monthly_budget_limit_usd, max_cost_per_request_usd, provider_limits_json, model_limits_json, task_limits_json, alert_thresholds_json, auto_reset_period, is_blocked, blocked_reason, openai_free_tier_json, updated_at)
        VALUES ('primary_hard_budget', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          openai_free_tier_json = excluded.openai_free_tier_json,
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
        config.openaiFreeTier ? JSON.stringify(config.openaiFreeTier) : null,
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
        openaiFreeTier: row.openai_free_tier_json ? JSON.parse(row.openai_free_tier_json) : null,
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
    tokensReasoning?: number;
    costUsd: number;
    costGrossUsd?: number;
    discountUsd?: number;
    costNetUsd?: number;
    freeTierGroup?: string;
    isFreeTier?: boolean;
    discountStatus?: string;
    latencyMs: number;
    status: string;
    analysisId?: string;
  }): void {
    if (this.isClosed) throw new Error('AI_LEDGER_CLOSED');
    try {
      const id = log.id || `cons_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const costGross = log.costGrossUsd !== undefined ? log.costGrossUsd : log.costUsd;
      const discount = log.discountUsd !== undefined ? log.discountUsd : 0;
      const costNet = log.costNetUsd !== undefined ? log.costNetUsd : (costGross - discount);
      const discountStatus = log.discountStatus || (log.isFreeTier ? 'ESTIMATED' : 'NONE');

      this.db.prepare(`
        INSERT INTO ai_consumption_logs (
          id, timestamp, provider, model, task,
          tokens_prompt, tokens_completion, tokens_cached, tokens_reasoning,
          cost_usd, cost_gross_usd, discount_usd, cost_net_usd,
          free_tier_group, is_free_tier, discount_status, latency_ms, status, analysis_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        log.timestamp || Date.now(),
        log.provider,
        log.model,
        log.task,
        log.tokensPrompt || 0,
        log.tokensCompletion || 0,
        log.tokensCached || 0,
        log.tokensReasoning || 0,
        costNet, // cost_usd preserves actual net financial spend
        costGross,
        discount,
        costNet,
        log.freeTierGroup || 'NONE',
        log.isFreeTier ? 1 : 0,
        discountStatus,
        log.latencyMs || 0,
        log.status || 'SUCCESS',
        log.analysisId || null
      );
    } catch (err: any) {
      throw new Error(`AI_LEDGER_WRITE_FAILED: ${err?.message || 'unknown'}`);
    }
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
        tokensReasoning: Number(r.tokens_reasoning || 0),
        costUsd: Number(r.cost_usd),
        costGrossUsd: Number(r.cost_gross_usd !== undefined && r.cost_gross_usd !== null ? r.cost_gross_usd : r.cost_usd),
        discountUsd: Number(r.discount_usd || 0),
        costNetUsd: Number(r.cost_net_usd !== undefined && r.cost_net_usd !== null ? r.cost_net_usd : r.cost_usd),
        freeTierGroup: r.free_tier_group || 'NONE',
        isFreeTier: r.is_free_tier === 1,
        discountStatus: r.discount_status || (r.is_free_tier === 1 ? 'ESTIMATED' : 'NONE'),
        latencyMs: Number(r.latency_ms),
        status: r.status,
        analysisId: r.analysis_id,
      }));
    } catch {
      return [];
    }
  }

  /**
   * Durable gross spend for HARD budget limits (never subtract estimated
   * promotion discounts). Filter names are fixed SQL, values parameterized.
   */
  public getAiGrossSpendSince(since: number, criteria: {
    provider?: string; model?: string; task?: string;
  } = {}): number {
    if (this.isClosed) throw new Error('No se puede verificar presupuesto con base de datos cerrada');
    const clauses = ['timestamp >= ?'];
    const values: Array<string | number> = [since];
    if (criteria.provider) { clauses.push('provider = ?'); values.push(criteria.provider); }
    if (criteria.model) { clauses.push('model = ?'); values.push(criteria.model); }
    if (criteria.task) { clauses.push('task = ?'); values.push(criteria.task); }
    const row = this.db.prepare(`
      SELECT COALESCE(SUM(CASE
        WHEN cost_gross_usd > 0 THEN cost_gross_usd
        ELSE cost_usd END), 0) AS gross
      FROM ai_consumption_logs WHERE ${clauses.join(' AND ')}
    `).get(...values) as { gross: number };
    return Number(row?.gross || 0);
  }

  public getAiConsumptionStats(): any {
    if (this.isClosed) return {};
    try {
      const now = Date.now();
      const startOfToday = new Date().setUTCHours(0, 0, 0, 0);
      const startOfYesterday = startOfToday - 86400000;
      const startOfLast7Days = now - 7 * 86400000;
      const startOfMonth = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1);

      const todayRow = this.db.prepare(`
        SELECT 
          COALESCE(SUM(cost_usd), 0) as spend, 
          COALESCE(SUM(cost_gross_usd), 0) as grossSpend,
          COALESCE(SUM(discount_usd), 0) as discount,
          COALESCE(SUM(cost_net_usd), 0) as netSpend,
          COALESCE(SUM(CASE WHEN is_free_tier = 1 THEN (tokens_prompt + MAX(tokens_completion, tokens_reasoning)) ELSE 0 END), 0) as freeTokens,
          COUNT(*) as calls 
        FROM ai_consumption_logs 
        WHERE timestamp >= ?
      `).get(startOfToday) as any;

      const yesterdayRow = this.db.prepare('SELECT COALESCE(SUM(cost_usd), 0) as spend FROM ai_consumption_logs WHERE timestamp >= ? AND timestamp < ?').get(startOfYesterday, startOfToday) as any;
      const weekRow = this.db.prepare('SELECT COALESCE(SUM(cost_usd), 0) as spend FROM ai_consumption_logs WHERE timestamp >= ?').get(startOfLast7Days) as any;
      const monthRow = this.db.prepare('SELECT COALESCE(SUM(cost_usd), 0) as spend FROM ai_consumption_logs WHERE timestamp >= ?').get(startOfMonth) as any;
      const totalRow = this.db.prepare(`
        SELECT 
          COALESCE(SUM(cost_usd), 0) as spend,
          COALESCE(SUM(cost_gross_usd), SUM(cost_usd), 0) as grossSpend,
          COALESCE(SUM(discount_usd), 0) as discount,
          COALESCE(SUM(cost_net_usd), SUM(cost_usd), 0) as netSpend,
          COALESCE(SUM(tokens_prompt), 0) as prompt, 
          COALESCE(SUM(tokens_completion), 0) as comp, 
          COALESCE(SUM(tokens_cached), 0) as cached, 
          COALESCE(SUM(tokens_reasoning), 0) as reasoning,
          COUNT(*) as calls, 
          COALESCE(AVG(latency_ms), 0) as avgLat 
        FROM ai_consumption_logs
      `).get() as any;

      const byProviderRows = this.db.prepare('SELECT provider, COALESCE(SUM(cost_usd), 0) as spend, COUNT(*) as calls FROM ai_consumption_logs GROUP BY provider').all() as any[];
      const byModelRows = this.db.prepare('SELECT model, COALESCE(SUM(cost_usd), 0) as spend, COUNT(*) as calls FROM ai_consumption_logs GROUP BY model ORDER BY spend DESC LIMIT 10').all() as any[];
      const byTaskRows = this.db.prepare('SELECT task, COALESCE(SUM(cost_usd), 0) as spend, COUNT(*) as calls FROM ai_consumption_logs GROUP BY task ORDER BY spend DESC').all() as any[];

      return {
        todaySpendUsd: Number(todayRow?.spend || 0),
        grossSpendTodayUsd: Number(todayRow?.grossSpend || todayRow?.spend || 0),
        discountTodayUsd: Number(todayRow?.discount || 0),
        netSpendTodayUsd: Number(todayRow?.netSpend || todayRow?.spend || 0),
        freeTokensToday: Number(todayRow?.freeTokens || 0),
        todayCalls: Number(todayRow?.calls || 0),
        yesterdaySpendUsd: Number(yesterdayRow?.spend || 0),
        last7DaysSpendUsd: Number(weekRow?.spend || 0),
        monthSpendUsd: Number(monthRow?.spend || 0),
        totalSpendUsd: Number(totalRow?.spend || 0),
        totalGrossSpendUsd: Number(totalRow?.grossSpend || totalRow?.spend || 0),
        totalDiscountUsd: Number(totalRow?.discount || 0),
        totalNetSpendUsd: Number(totalRow?.netSpend || totalRow?.spend || 0),
        totalPromptTokens: Number(totalRow?.prompt || 0),
        totalCompletionTokens: Number(totalRow?.comp || 0),
        totalCachedTokens: Number(totalRow?.cached || 0),
        totalReasoningTokens: Number(totalRow?.reasoning || 0),
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

  public getFreeTierUsageToday(startOfUtcDay: number): {
    mainGroupTokens: number;
    smallGroupTokens: number;
    grossSpendUsd: number;
    discountUsd: number;
    netSpendUsd: number;
    freeTokensCount: number;
  } {
    if (this.isClosed) return { mainGroupTokens: 0, smallGroupTokens: 0, grossSpendUsd: 0, discountUsd: 0, netSpendUsd: 0, freeTokensCount: 0 };
    try {
      const row = this.db.prepare(`
        SELECT 
          COALESCE(SUM(CASE WHEN free_tier_group = 'MAIN' AND is_free_tier = 1 THEN (tokens_prompt + MAX(tokens_completion, tokens_reasoning)) ELSE 0 END), 0) as mainTokens,
          COALESCE(SUM(CASE WHEN free_tier_group = 'SMALL' AND is_free_tier = 1 THEN (tokens_prompt + MAX(tokens_completion, tokens_reasoning)) ELSE 0 END), 0) as smallTokens,
          COALESCE(SUM(cost_gross_usd), 0) as grossSpend,
          COALESCE(SUM(discount_usd), 0) as discount,
          COALESCE(SUM(cost_net_usd), 0) as netSpend,
          COALESCE(SUM(CASE WHEN is_free_tier = 1 THEN (tokens_prompt + MAX(tokens_completion, tokens_reasoning)) ELSE 0 END), 0) as freeTokens
        FROM ai_consumption_logs
        WHERE timestamp >= ?
      `).get(startOfUtcDay) as any;
      return {
        mainGroupTokens: Number(row?.mainTokens || 0),
        smallGroupTokens: Number(row?.smallTokens || 0),
        grossSpendUsd: Number(row?.grossSpend || 0),
        discountUsd: Number(row?.discount || 0),
        netSpendUsd: Number(row?.netSpend || 0),
        freeTokensCount: Number(row?.freeTokens || 0),
      };
    } catch {
      return { mainGroupTokens: 0, smallGroupTokens: 0, grossSpendUsd: 0, discountUsd: 0, netSpendUsd: 0, freeTokensCount: 0 };
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

  public saveScenario(scenario: Scenario): void {
    if (this.isClosed) return;
    const now = Date.now();
    const payload = {
      activationConditions: scenario.activationConditions || [],
      invalidationTriggers: scenario.invalidationTriggers || [],
      argumentsFor: scenario.argumentsFor || [],
      argumentsAgainst: scenario.argumentsAgainst || [],
      openaiInterpretation: scenario.openaiInterpretation,
      geminiInterpretation: scenario.geminiInterpretation,
      distanceToZonePct: scenario.distanceToZonePct,
      currentPrice: scenario.currentPrice,
      neutralBreakoutProgress: scenario.neutralBreakoutProgress,
      neutralLastEvaluatedCandleTimestamp: scenario.neutralLastEvaluatedCandleTimestamp,
      lastCheckedTimestamp: scenario.lastCheckedTimestamp,
      lastRevalidationTimestamp: scenario.lastRevalidationTimestamp,
      isSimulated: scenario.isSimulated,
      kind: scenario.kind,
      triggerSource: scenario.triggerSource,
      verifiedLevels: scenario.verifiedLevels,
      watchPlan: scenario.watchPlan,
      aiMarketThesis: scenario.aiMarketThesis,
      horizon: scenario.horizon,
      missingConditions: scenario.missingConditions,
      confidenceDisclaimer: scenario.confidenceDisclaimer,
    };
    if (scenario.watchPlan) {
      this.saveWatchPlan(scenario.watchPlan);
    }
    this.db.prepare(`
      INSERT INTO scenarios (
        id, symbol, direction, timeframe, structure_type, proposed_by, models_used,
        snapshot_id, discovery_timestamp, entry_zone_min, entry_zone_max, target_entry,
        stop_loss_price, target_12_price, target_14_price, net_rr_12, net_rr_14,
        rr_mode_available, uncertainty_level, status, rejection_reason,
        valid_until_timestamp, ai_cost_usd, payload_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        rejection_reason = excluded.rejection_reason,
        target_12_price = excluded.target_12_price,
        target_14_price = excluded.target_14_price,
        net_rr_12 = excluded.net_rr_12,
        net_rr_14 = excluded.net_rr_14,
        rr_mode_available = excluded.rr_mode_available,
        ai_cost_usd = excluded.ai_cost_usd,
        payload_json = excluded.payload_json,
        updated_at = excluded.updated_at
    `).run(
      scenario.id,
      scenario.symbol,
      scenario.direction,
      scenario.timeframe,
      scenario.structureType,
      scenario.proposedBy,
      JSON.stringify(scenario.modelsUsed || []),
      scenario.snapshotId,
      scenario.discoveryTimestamp,
      scenario.entryZoneMin,
      scenario.entryZoneMax,
      scenario.targetEntry,
      scenario.stopLossPrice,
      scenario.target12Price ?? null,
      scenario.target14Price ?? null,
      scenario.netRR12 ?? null,
      scenario.netRR14 ?? null,
      scenario.rrModeAvailable,
      scenario.uncertaintyLevel,
      scenario.status,
      scenario.rejectionReason ?? null,
      scenario.validUntilTimestamp,
      scenario.aiCostUsd ?? 0,
      JSON.stringify(payload),
      scenario.createdAt || now,
      scenario.updatedAt || now
    );
  }

  public getScenarios(options?: { status?: ScenarioStatus | ScenarioStatus[]; symbol?: string; limit?: number }): Scenario[] {
    if (this.isClosed) return [];
    try {
      let query = 'SELECT * FROM scenarios';
      const params: any[] = [];
      const conditions: string[] = [];
      if (options?.symbol) {
        conditions.push('symbol = ?');
        params.push(options.symbol);
      }
      if (options?.status) {
        if (Array.isArray(options.status)) {
          if (options.status.length === 0) return [];
          conditions.push(`status IN (${options.status.map(() => '?').join(',')})`);
          params.push(...options.status);
        } else {
          conditions.push('status = ?');
          params.push(options.status);
        }
      }
      if (conditions.length > 0) query += ' WHERE ' + conditions.join(' AND ');
      query += ' ORDER BY discovery_timestamp DESC';
      if (options?.limit) {
        query += ' LIMIT ?';
        params.push(options.limit);
      }
      const rows = this.db.prepare(query).all(...params) as any[];
      return rows.map((r) => this.mapScenarioRow(r));
    } catch {
      return [];
    }
  }

  public getScenarioById(id: string): Scenario | null {
    if (this.isClosed) return null;
    try {
      const row = this.db.prepare('SELECT * FROM scenarios WHERE id = ?').get(id) as any;
      if (!row) return null;
      return this.mapScenarioRow(row);
    } catch {
      return null;
    }
  }

  public updateScenarioStatus(id: string, status: ScenarioStatus, reason?: string, updates?: Partial<Scenario>): void {
    if (this.isClosed) return;
    try {
      const existing = this.getScenarioById(id);
      if (!existing) return;
      const merged: Scenario = {
        ...existing,
        ...updates,
        status,
        rejectionReason: reason ?? updates?.rejectionReason ?? existing.rejectionReason,
        updatedAt: Date.now(),
      };
      this.saveScenario(merged);
    } catch {}
  }

  public logScenarioLifecycle(event: ScenarioLifecycleEvent): void {
    if (this.isClosed) return;
    try {
      this.db.prepare(`
        INSERT INTO scenario_lifecycle (scenario_id, from_status, to_status, timestamp, reason, metadata_json)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        event.scenarioId,
        event.fromStatus,
        event.toStatus,
        event.timestamp || Date.now(),
        event.reason ?? null,
        event.metadata ? JSON.stringify(event.metadata) : null
      );
    } catch {}
  }

  public getScenarioLifecycle(scenarioId: string): ScenarioLifecycleEvent[] {
    if (this.isClosed) return [];
    try {
      const rows = this.db.prepare('SELECT * FROM scenario_lifecycle WHERE scenario_id = ? ORDER BY timestamp ASC').all(scenarioId) as any[];
      return rows.map((r) => ({
        id: Number(r.id),
        scenarioId: r.scenario_id,
        fromStatus: r.from_status,
        toStatus: r.to_status,
        timestamp: Number(r.timestamp),
        reason: r.reason,
        metadata: r.metadata_json ? JSON.parse(r.metadata_json) : undefined,
      }));
    } catch {
      return [];
    }
  }

  public saveScenarioRevalidation(record: ScenarioRevalidationRecord): void {
    if (this.isClosed) return;
    try {
      this.db.prepare(`
        INSERT INTO scenario_revalidations (id, scenario_id, timestamp, openai_verdict, gemini_verdict, consensus_verdict, price_at_revalidation, details_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          consensus_verdict = excluded.consensus_verdict,
          price_at_revalidation = excluded.price_at_revalidation,
          details_json = excluded.details_json
      `).run(
        record.id,
        record.scenarioId,
        record.timestamp,
        record.openaiVerdict ?? null,
        record.geminiVerdict ?? null,
        record.consensusVerdict,
        record.priceAtRevalidation,
        JSON.stringify(record.details || {})
      );
    } catch {}
  }

  public getScenarioRevalidations(scenarioId: string): ScenarioRevalidationRecord[] {
    if (this.isClosed) return [];
    try {
      const rows = this.db.prepare('SELECT * FROM scenario_revalidations WHERE scenario_id = ? ORDER BY timestamp DESC').all(scenarioId) as any[];
      return rows.map((r) => ({
        id: r.id,
        scenarioId: r.scenario_id,
        timestamp: Number(r.timestamp),
        openaiVerdict: r.openai_verdict,
        geminiVerdict: r.gemini_verdict,
        consensusVerdict: r.consensus_verdict,
        priceAtRevalidation: Number(r.price_at_revalidation),
        details: r.details_json ? JSON.parse(r.details_json) : {},
      }));
    } catch {
      return [];
    }
  }

  private mapScenarioRow(r: any): Scenario {
    let payload: any = {};
    try {
      payload = r.payload_json ? JSON.parse(r.payload_json) : {};
    } catch {}
    let modelsUsed: string[] = [];
    try {
      modelsUsed = r.models_used ? JSON.parse(r.models_used) : [];
    } catch {}

    return {
      id: r.id,
      symbol: r.symbol,
      direction: r.direction,
      timeframe: r.timeframe,
      structureType: r.structure_type,
      proposedBy: r.proposed_by,
      modelsUsed,
      snapshotId: r.snapshot_id,
      discoveryTimestamp: Number(r.discovery_timestamp),
      entryZoneMin: Number(r.entry_zone_min),
      entryZoneMax: Number(r.entry_zone_max),
      targetEntry: Number(r.target_entry),
      stopLossPrice: Number(r.stop_loss_price),
      target12Price: r.target_12_price !== null && r.target_12_price !== undefined ? Number(r.target_12_price) : undefined,
      target14Price: r.target_14_price !== null && r.target_14_price !== undefined ? Number(r.target_14_price) : undefined,
      netRR12: r.net_rr_12 !== null && r.net_rr_12 !== undefined ? Number(r.net_rr_12) : undefined,
      netRR14: r.net_rr_14 !== null && r.net_rr_14 !== undefined ? Number(r.net_rr_14) : undefined,
      rrModeAvailable: r.rr_mode_available,
      uncertaintyLevel: r.uncertainty_level,
      status: r.status,
      rejectionReason: r.rejection_reason || undefined,
      validUntilTimestamp: Number(r.valid_until_timestamp),
      aiCostUsd: Number(r.ai_cost_usd || 0),
      activationConditions: payload.activationConditions || [],
      invalidationTriggers: payload.invalidationTriggers || [],
      argumentsFor: payload.argumentsFor || [],
      argumentsAgainst: payload.argumentsAgainst || [],
      openaiInterpretation: payload.openaiInterpretation,
      geminiInterpretation: payload.geminiInterpretation,
      distanceToZonePct: payload.distanceToZonePct,
      currentPrice: payload.currentPrice,
      neutralBreakoutProgress: payload.neutralBreakoutProgress,
      neutralLastEvaluatedCandleTimestamp: payload.neutralLastEvaluatedCandleTimestamp,
      lastCheckedTimestamp: payload.lastCheckedTimestamp,
      lastRevalidationTimestamp: payload.lastRevalidationTimestamp,
      isSimulated: payload.isSimulated,
      kind: payload.kind,
      triggerSource: payload.triggerSource,
      verifiedLevels: payload.verifiedLevels || [],
      watchPlan: payload.watchPlan,
      aiMarketThesis: payload.aiMarketThesis,
      horizon: payload.horizon,
      missingConditions: payload.missingConditions,
      confidenceDisclaimer: payload.confidenceDisclaimer,
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at),
    };
  }

  // ---------------------------------------------------------------------------
  // AI Watch Plans (Fase 5C)
  // ---------------------------------------------------------------------------
  public saveWatchPlan(plan: AiWatchPlan): void {
    if (this.isClosed) return;
    const now = Date.now();
    try {
      this.db.prepare(`
        INSERT INTO ai_watch_plans (
          id, scenario_id, symbol, direction, horizon, primary_timeframe,
          watch_zone_min, watch_zone_max, target_entry, candidate_stop_loss,
          candidate_tp12, candidate_tp14, rr_eligibility, status,
          automatable, expiration_timestamp, plan_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          status = excluded.status,
          automatable = excluded.automatable,
          expiration_timestamp = excluded.expiration_timestamp,
          plan_json = excluded.plan_json,
          updated_at = excluded.updated_at
      `).run(
        plan.id,
        plan.scenarioId,
        plan.symbol,
        plan.direction,
        plan.horizon,
        plan.primaryTimeframe,
        plan.watchZone.minPrice,
        plan.watchZone.maxPrice,
        plan.watchZone.targetEntry,
        plan.candidateStopLoss,
        plan.candidateTakeProfits?.tp12 ?? null,
        plan.candidateTakeProfits?.tp14 ?? null,
        plan.rrEligibility,
        plan.status,
        plan.automatable ? 1 : 0,
        plan.expirationTimestamp,
        JSON.stringify(plan),
        plan.createdAt || now,
        plan.updatedAt || now
      );
    } catch {}
  }

  public getWatchPlanById(id: string): AiWatchPlan | null {
    if (this.isClosed) return null;
    try {
      const row = this.db.prepare('SELECT * FROM ai_watch_plans WHERE id = ?').get(id) as any;
      if (!row) return null;
      return this.mapWatchPlanRow(row);
    } catch {
      return null;
    }
  }

  public getWatchPlanByScenarioId(scenarioId: string): AiWatchPlan | null {
    if (this.isClosed) return null;
    try {
      const row = this.db.prepare('SELECT * FROM ai_watch_plans WHERE scenario_id = ? ORDER BY created_at DESC LIMIT 1').get(scenarioId) as any;
      if (!row) return null;
      return this.mapWatchPlanRow(row);
    } catch {
      return null;
    }
  }

  public getActiveWatchPlans(symbol?: string): AiWatchPlan[] {
    if (this.isClosed) return [];
    try {
      const rows = this.db.prepare(`
        SELECT * FROM ai_watch_plans 
        WHERE status IN ('PENDING', 'ACTIVE', 'TRIGGERED', 'REVALIDATING')
          AND (? IS NULL OR symbol = ?)
        ORDER BY created_at DESC
      `).all(symbol || null, symbol || null) as any[];
      return rows.map((r) => this.mapWatchPlanRow(r));
    } catch {
      return [];
    }
  }

  public updateWatchPlanStatus(id: string, status: WatchPlanStatus, updates?: Partial<AiWatchPlan>): void {
    if (this.isClosed) return;
    try {
      const existing = this.getWatchPlanById(id);
      if (!existing) return;
      const merged: AiWatchPlan = {
        ...existing,
        ...updates,
        status,
        updatedAt: Date.now(),
      };
      this.saveWatchPlan(merged);
    } catch {}
  }

  private mapWatchPlanRow(r: any): AiWatchPlan {
    let full: any = {};
    try {
      full = r.plan_json ? JSON.parse(r.plan_json) : {};
    } catch {}

    return {
      id: r.id,
      scenarioId: r.scenario_id,
      symbol: r.symbol,
      direction: r.direction,
      marketThesis: full.marketThesis || r.market_thesis || '',
      horizon: r.horizon,
      primaryTimeframe: r.primary_timeframe,
      watchZone: {
        minPrice: Number(r.watch_zone_min),
        maxPrice: Number(r.watch_zone_max),
        targetEntry: Number(r.target_entry),
      },
      candidateStopLoss: Number(r.candidate_stop_loss),
      candidateTakeProfits: {
        tp12: r.candidate_tp12 !== null ? Number(r.candidate_tp12) : undefined,
        tp14: r.candidate_tp14 !== null ? Number(r.candidate_tp14) : undefined,
        structuralTarget: full.candidateTakeProfits?.structuralTarget,
      },
      rrEligibility: r.rr_eligibility,
      observableConditions: full.observableConditions || [],
      confirmationSequence: full.confirmationSequence || [],
      invalidationConditions: full.invalidationConditions || [],
      expirationTimestamp: Number(r.expiration_timestamp),
      reevaluationTriggers: full.reevaluationTriggers || [],
      reasoningVersion: full.reasoningVersion || 'v1',
      status: r.status,
      automatable: Boolean(r.automatable),
      nonAutomatableConditions: full.nonAutomatableConditions,
      lastEvaluatedTimestamp: full.lastEvaluatedTimestamp,
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at),
    };
  }

  // ---------------------------------------------------------------------------
  // Discovery Scheduler Configuration
  // ---------------------------------------------------------------------------
  public getDiscoverySchedulerConfig(symbol = 'BTCUSDT'): {
    enabled: boolean;
    intervalMinutes: number;
    triggerOn1hClose: boolean;
    triggerOn15mStructure: boolean;
    minPriceMovePct: number;
    minCooldownMinutes: number;
    updatedAt: number;
  } {
    if (this.isClosed) {
      return {
        enabled: true,
        intervalMinutes: symbol === 'ETHUSDT' ? 120 : 60,
        triggerOn1hClose: symbol !== 'ETHUSDT',
        triggerOn15mStructure: true,
        minPriceMovePct: 1.5,
        minCooldownMinutes: 15,
        updatedAt: Date.now(),
      };
    }
    try {
      const id = symbol === 'BTCUSDT' ? 'default' : symbol;
      const row = this.db.prepare('SELECT * FROM discovery_scheduler_config WHERE id = ?').get(id) as any;
      if (!row) {
        return {
          enabled: true,
          intervalMinutes: symbol === 'ETHUSDT' ? 120 : 60,
          triggerOn1hClose: symbol !== 'ETHUSDT',
          triggerOn15mStructure: true,
          minPriceMovePct: 1.5,
          minCooldownMinutes: 15,
          updatedAt: Date.now(),
        };
      }
      return {
        enabled: Boolean(row.enabled),
        intervalMinutes: Number(row.interval_minutes),
        triggerOn1hClose: Boolean(row.trigger_on_1h_close),
        triggerOn15mStructure: Boolean(row.trigger_on_15m_structure),
        minPriceMovePct: Number(row.min_price_move_pct),
        minCooldownMinutes: Number(row.min_cooldown_minutes),
        updatedAt: Number(row.updated_at),
      };
    } catch {
      return {
        enabled: true,
        intervalMinutes: symbol === 'ETHUSDT' ? 120 : 60,
        triggerOn1hClose: symbol !== 'ETHUSDT',
        triggerOn15mStructure: true,
        minPriceMovePct: 1.5,
        minCooldownMinutes: 15,
        updatedAt: Date.now(),
      };
    }
  }

  public saveDiscoverySchedulerConfig(config: {
    enabled: boolean;
    intervalMinutes: number;
    triggerOn1hClose: boolean;
    triggerOn15mStructure: boolean;
    minPriceMovePct: number;
    minCooldownMinutes: number;
  }, symbol = 'BTCUSDT'): void {
    if (this.isClosed) return;
    try {
      this.db.prepare(`
        INSERT INTO discovery_scheduler_config (
          id, enabled, interval_minutes, trigger_on_1h_close, trigger_on_15m_structure, min_price_move_pct, min_cooldown_minutes, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          enabled = excluded.enabled,
          interval_minutes = excluded.interval_minutes,
          trigger_on_1h_close = excluded.trigger_on_1h_close,
          trigger_on_15m_structure = excluded.trigger_on_15m_structure,
          min_price_move_pct = excluded.min_price_move_pct,
          min_cooldown_minutes = excluded.min_cooldown_minutes,
          updated_at = excluded.updated_at
      `).run(
        symbol === 'BTCUSDT' ? 'default' : symbol,
        config.enabled ? 1 : 0,
        config.intervalMinutes,
        config.triggerOn1hClose ? 1 : 0,
        config.triggerOn15mStructure ? 1 : 0,
        config.minPriceMovePct,
        config.minCooldownMinutes,
        Date.now()
      );
    } catch (err: any) {
      this.logEvent('ERROR', 'Database', `Error saving discovery scheduler config: ${err.message}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Historical Candles for Backtesting
  // ---------------------------------------------------------------------------
  public saveHistoricalCandles(candles: Candle[]): number {
    if (this.isClosed || candles.length === 0) return 0;
    const stmt = this.db.prepare(`
      INSERT INTO historical_candles (
        symbol, timeframe, timestamp, open, high, low, close, volume, turnover
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(symbol, timeframe, timestamp) DO UPDATE SET
        open = excluded.open,
        high = excluded.high,
        low = excluded.low,
        close = excluded.close,
        volume = excluded.volume,
        turnover = excluded.turnover
    `);

    let count = 0;
    this.db.exec('BEGIN TRANSACTION');
    try {
      for (const c of candles) {
        stmt.run(
          c.symbol,
          c.timeframe,
          c.timestamp,
          c.open,
          c.high,
          c.low,
          c.close,
          c.volume,
          c.turnover || 0
        );
        count++;
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }

    return count;
  }

  public getHistoricalCandles(
    symbol: string,
    timeframe: string,
    startTime?: number,
    endTime?: number,
    limit?: number
  ): Candle[] {
    if (this.isClosed) return [];
    try {
      let query = 'SELECT * FROM historical_candles WHERE symbol = ? AND timeframe = ?';
      const params: any[] = [symbol, timeframe];

      if (startTime !== undefined) {
        query += ' AND timestamp >= ?';
        params.push(startTime);
      }
      if (endTime !== undefined) {
        query += ' AND timestamp <= ?';
        params.push(endTime);
      }
      query += ' ORDER BY timestamp ASC';
      if (limit !== undefined && limit > 0) {
        query += ` LIMIT ${limit}`;
      }

      const rows = this.db.prepare(query).all(...params) as any[];
      return rows.map((r) => ({
        symbol: r.symbol,
        timeframe: r.timeframe,
        timestamp: Number(r.timestamp),
        open: Number(r.open),
        high: Number(r.high),
        low: Number(r.low),
        close: Number(r.close),
        volume: Number(r.volume),
        turnover: Number(r.turnover),
        confirmed: true,
      }));
    } catch {
      return [];
    }
  }

  /** SQL-based continuity check; avoids loading 100k+ 1m candles in JS. */
  public getHistoricalGapStats(
    symbol: string, timeframe: string, startTime: number, intervalMs: number
  ): { gapCount: number; missingCandles: number; largestGapMs: number } {
    if (this.isClosed) throw new Error('Base de datos cerrada: continuidad histórica no verificable');
    if (!Number.isFinite(startTime) || !Number.isFinite(intervalMs) || intervalMs <= 0) {
      throw new Error('Parámetros de continuidad histórica inválidos');
    }
    const row = this.db.prepare(`
      WITH rows AS (
        SELECT timestamp, LAG(timestamp) OVER (ORDER BY timestamp) AS previous
        FROM historical_candles WHERE symbol = ? AND timeframe = ? AND timestamp >= ?
      )
      SELECT
        COALESCE(SUM(CASE WHEN previous IS NOT NULL AND timestamp - previous > ?
          THEN 1 ELSE 0 END), 0) AS gap_count,
        COALESCE(SUM(CASE WHEN previous IS NOT NULL AND timestamp - previous > ?
          THEN CAST((timestamp - previous - 1) / ? AS INTEGER) ELSE 0 END), 0) AS missing,
        COALESCE(MAX(CASE WHEN previous IS NOT NULL
          THEN timestamp - previous ELSE 0 END), 0) AS largest_gap
      FROM rows
    `).get(symbol, timeframe, startTime, intervalMs, intervalMs, intervalMs) as any;
    return {
      gapCount: Number(row?.gap_count || 0),
      missingCandles: Number(row?.missing || 0),
      largestGapMs: Number(row?.largest_gap || 0),
    };
  }

  public getHistoricalCandleStats(symbol: string, timeframe: string): {
    count: number;
    earliest: number | null;
    latest: number | null;
  } {
    if (this.isClosed) return { count: 0, earliest: null, latest: null };
    try {
      const row = this.db.prepare(`
        SELECT COUNT(*) as cnt, MIN(timestamp) as min_ts, MAX(timestamp) as max_ts
        FROM historical_candles
        WHERE symbol = ? AND timeframe = ?
      `).get(symbol, timeframe) as any;

      return {
        count: Number(row?.cnt || 0),
        earliest: row?.min_ts ? Number(row.min_ts) : null,
        latest: row?.max_ts ? Number(row.max_ts) : null,
      };
    } catch {
      return { count: 0, earliest: null, latest: null };
    }
  }

  // ---------------------------------------------------------------------------
  // Backtest Runs and Trades
  // ---------------------------------------------------------------------------
  public saveBacktestRun(run: {
    id: string;
    symbol: string;
    startTimestamp: number;
    endTimestamp: number;
    inSampleEndTimestamp: number;
    status: string;
    totalTrades: number;
    winRate: number;
    profitFactor: number;
    expectancyR: number;
    maxDrawdownPct: number;
    netPnlUsdt: number;
    netPnlR: number;
    inSampleMetrics: any;
    outSampleMetrics: any;
    breakdown: any;
    config: any;
    createdAt?: number;
  }): void {
    if (this.isClosed) return;
    this.db.prepare(`
      INSERT INTO backtest_runs (
        id, symbol, start_timestamp, end_timestamp, in_sample_end_timestamp,
        status, total_trades, win_rate, profit_factor, expectancy_r,
        max_drawdown_pct, net_pnl_usdt, net_pnl_r,
        in_sample_metrics_json, out_sample_metrics_json, breakdown_json, config_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        total_trades = excluded.total_trades,
        win_rate = excluded.win_rate,
        profit_factor = excluded.profit_factor,
        expectancy_r = excluded.expectancy_r,
        max_drawdown_pct = excluded.max_drawdown_pct,
        net_pnl_usdt = excluded.net_pnl_usdt,
        net_pnl_r = excluded.net_pnl_r,
        in_sample_metrics_json = excluded.in_sample_metrics_json,
        out_sample_metrics_json = excluded.out_sample_metrics_json,
        breakdown_json = excluded.breakdown_json,
        config_json = excluded.config_json
    `).run(
      run.id,
      run.symbol,
      run.startTimestamp,
      run.endTimestamp,
      run.inSampleEndTimestamp,
      run.status,
      run.totalTrades,
      run.winRate,
      run.profitFactor,
      run.expectancyR,
      run.maxDrawdownPct,
      run.netPnlUsdt,
      run.netPnlR,
      JSON.stringify(run.inSampleMetrics || {}),
      JSON.stringify(run.outSampleMetrics || {}),
      JSON.stringify(run.breakdown || {}),
      JSON.stringify(run.config || {}),
      run.createdAt || Date.now()
    );
  }

  public getBacktestRuns(limit: number = 20): any[] {
    if (this.isClosed) return [];
    try {
      const rows = this.db.prepare('SELECT * FROM backtest_runs ORDER BY created_at DESC LIMIT ?').all(limit) as any[];
      return rows.map((r) => ({
        id: r.id,
        symbol: r.symbol,
        startTimestamp: Number(r.start_timestamp),
        endTimestamp: Number(r.end_timestamp),
        inSampleEndTimestamp: Number(r.in_sample_end_timestamp),
        status: r.status,
        totalTrades: Number(r.total_trades),
        winRate: Number(r.win_rate),
        profitFactor: Number(r.profit_factor),
        expectancyR: Number(r.expectancy_r),
        maxDrawdownPct: Number(r.max_drawdown_pct),
        netPnlUsdt: Number(r.net_pnl_usdt),
        netPnlR: Number(r.net_pnl_r),
        inSampleMetrics: JSON.parse(r.in_sample_metrics_json || '{}'),
        outSampleMetrics: JSON.parse(r.out_sample_metrics_json || '{}'),
        breakdown: JSON.parse(r.breakdown_json || '{}'),
        config: JSON.parse(r.config_json || '{}'),
        createdAt: Number(r.created_at),
      }));
    } catch {
      return [];
    }
  }

  public getBacktestRunById(id: string): any | null {
    if (this.isClosed) return null;
    try {
      const r = this.db.prepare('SELECT * FROM backtest_runs WHERE id = ?').get(id) as any;
      if (!r) return null;
      return {
        id: r.id,
        symbol: r.symbol,
        startTimestamp: Number(r.start_timestamp),
        endTimestamp: Number(r.end_timestamp),
        inSampleEndTimestamp: Number(r.in_sample_end_timestamp),
        status: r.status,
        totalTrades: Number(r.total_trades),
        winRate: Number(r.win_rate),
        profitFactor: Number(r.profit_factor),
        expectancyR: Number(r.expectancy_r),
        maxDrawdownPct: Number(r.max_drawdown_pct),
        netPnlUsdt: Number(r.net_pnl_usdt),
        netPnlR: Number(r.net_pnl_r),
        inSampleMetrics: JSON.parse(r.in_sample_metrics_json || '{}'),
        outSampleMetrics: JSON.parse(r.out_sample_metrics_json || '{}'),
        breakdown: JSON.parse(r.breakdown_json || '{}'),
        config: JSON.parse(r.config_json || '{}'),
        createdAt: Number(r.created_at),
      };
    } catch {
      return null;
    }
  }

  public saveBacktestTrades(trades: any[]): number {
    if (this.isClosed || trades.length === 0) return 0;
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO backtest_trades (
        id, run_id, symbol, strategy, direction, ratio_target, timeframe,
        entry_timestamp, exit_timestamp, entry_price, stop_loss_price, take_profit_price,
        exit_price, outcome, realized_net_pnl_usdt, realized_net_r,
        mfe_price, mfe_r, mae_price, mae_r, duration_ms, is_in_sample,
        fees_usdt, spread_cost_usdt, slippage_cost_usdt,
        initial_risk_usdt, position_size_btc, gross_pnl_usdt, capital_before_usdt, capital_after_usdt, is_executed_in_portfolio,
        expected_net_rr, structural_justification, exclusion_reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    let count = 0;
    this.db.exec('BEGIN TRANSACTION');
    try {
      for (const t of trades) {
        stmt.run(
          t.id,
          t.runId,
          t.symbol,
          t.strategy,
          t.direction,
          t.ratioTarget,
          t.timeframe,
          t.entryTimestamp,
          t.exitTimestamp,
          t.entryPrice,
          t.stopLossPrice,
          t.takeProfitPrice,
          t.exitPrice,
          t.outcome,
          t.realizedNetPnlUsdt,
          t.realizedNetR,
          t.mfePrice || 0,
          t.mfeR || 0,
          t.maePrice || 0,
          t.maeR || 0,
          t.durationMs,
          t.isInSample ? 1 : 0,
          t.feesUsdt || 0,
          t.spreadCostUsdt || 0,
          t.slippageCostUsdt || 0,
          t.initialRiskUsdt || 0,
          t.positionSizeBtc || 0,
          t.grossPnlUsdt || 0,
          t.capitalBeforeUsdt || 0,
          t.capitalAfterUsdt || 0,
          t.isExecutedInPortfolio ? 1 : 0,
          t.expectedNetRR || 0,
          t.structuralJustification || '',
          t.exclusionReason || ''
        );
        count++;
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }

    return count;
  }

  public getBacktestTrades(runId: string, limit: number = 500): any[] {
    if (this.isClosed) return [];
    try {
      const rows = this.db.prepare('SELECT * FROM backtest_trades WHERE run_id = ? ORDER BY entry_timestamp ASC LIMIT ?').all(runId, limit) as any[];
      return rows.map((r) => ({
        id: r.id,
        runId: r.run_id,
        symbol: r.symbol,
        strategy: r.strategy,
        direction: r.direction,
        ratioTarget: r.ratio_target,
        timeframe: r.timeframe,
        entryTimestamp: Number(r.entry_timestamp),
        exitTimestamp: Number(r.exit_timestamp),
        entryPrice: Number(r.entry_price),
        stopLossPrice: Number(r.stop_loss_price),
        takeProfitPrice: Number(r.take_profit_price),
        exitPrice: Number(r.exit_price),
        outcome: r.outcome,
        realizedNetPnlUsdt: Number(r.realized_net_pnl_usdt),
        realizedNetR: Number(r.realized_net_r),
        mfePrice: Number(r.mfe_price),
        mfeR: Number(r.mfe_r),
        maePrice: Number(r.mae_price),
        maeR: Number(r.mae_r),
        durationMs: Number(r.duration_ms),
        isInSample: Boolean(r.is_in_sample),
        feesUsdt: Number(r.fees_usdt),
        spreadCostUsdt: Number(r.spread_cost_usdt),
        slippageCostUsdt: Number(r.slippage_cost_usdt),
        initialRiskUsdt: Number(r.initial_risk_usdt || 0),
        positionSizeBtc: Number(r.position_size_btc || 0),
        grossPnlUsdt: Number(r.gross_pnl_usdt || 0),
        capitalBeforeUsdt: Number(r.capital_before_usdt || 0),
        capitalAfterUsdt: Number(r.capital_after_usdt || 0),
        isExecutedInPortfolio: Boolean(r.is_executed_in_portfolio),
        expectedNetRR: Number(r.expected_net_rr || 0),
        structuralJustification: r.structural_justification || '',
        exclusionReason: r.exclusion_reason || '',
      }));
    } catch {
      return [];
    }
  }

  /** Durable, symbol-scoped breakout queue; shares the existing runtime_flags
   * SQLite table, so no schema migration is required. Fail closed on DB errors.
   * null clears the queue only when discovery finished successfully. */
  public savePendingNeutralBreakout(symbol: string,
    pending: { price: number; confirmedAt: number } | null): void {
    if (this.isClosed) throw new Error('No se puede guardar una ruptura con SQLite cerrada');
    if (!/^(BTCUSDT|ETHUSDT)$/.test(symbol)) throw new Error('Símbolo no permitido');
    const key = `pending_neutral_breakout_${symbol}`;
    if (pending !== null && (!Number.isFinite(pending.price) || pending.price <= 0 ||
        !Number.isFinite(pending.confirmedAt))) {
      throw new Error('Datos de ruptura inválidos');
    }
    if (pending === null) {
      this.db.prepare('DELETE FROM runtime_flags WHERE key = ?').run(key);
      return;
    }
    this.db.prepare(`INSERT INTO runtime_flags(key, value) VALUES(?, ?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value`)
      .run(key, JSON.stringify(pending));
  }

  public getPendingNeutralBreakout(symbol: string): { price: number; confirmedAt: number } | null {
    if (this.isClosed) throw new Error('SQLite cerrada al recuperar ruptura');
    if (!/^(BTCUSDT|ETHUSDT)$/.test(symbol)) throw new Error('Símbolo no permitido');
    const key = `pending_neutral_breakout_${symbol}`;
    const row = this.db.prepare('SELECT value FROM runtime_flags WHERE key = ?')
      .get(key) as { value: string } | undefined;
    if (!row) return null;
    const data = JSON.parse(row.value);
    if (!Number.isFinite(data?.price) || data.price <= 0 ||
        !Number.isFinite(data?.confirmedAt)) {
      throw new Error(`Cola de ruptura dañada para ${symbol}; se requiere inspección`);
    }
    return { price: data.price, confirmedAt: data.confirmedAt };
  }

  public getKillSwitchState(): boolean | null {
    const row = this.db.prepare("SELECT value FROM runtime_flags WHERE key='kill_switch'").get() as
      { value: string } | undefined;
    return row ? row.value === 'true' : null;
  }

  public saveKillSwitchState(active: boolean): void {
    if (this.isClosed) throw new Error('No se puede persistir Kill Switch con DB cerrada');
    this.db.prepare(`
      INSERT INTO runtime_flags (key, value) VALUES ('kill_switch', ?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value
    `).run(active ? 'true' : 'false');
  }

  public checkpoint(): boolean {
    if (this.isClosed) return false;
    try {
      this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      return true;
    } catch {
      return false;
    }
  }

  public backup(targetPath?: string): boolean {
    if (this.isClosed || this.dbPath === ':memory:') return false;
    const dest = targetPath || `${this.dbPath}.bak`;
    const temp = `${dest}.tmp`;
    try {
      if (!this.checkpoint()) return false;
      fs.copyFileSync(this.dbPath, temp);
      fs.renameSync(temp, dest);
      return true;
    } catch (err) {
      try { fs.rmSync(temp, { force: true }); } catch {}
      console.warn('[Database] Error al crear backup consistente de SQLite:', err);
      return false;
    }
  }

  public close(): void {
    if (this.isClosed) return;
    this.checkpoint();
    this.isClosed = true;
    this.db.close();
  }

}
