import pg from 'pg';
import { Candle, Timeframe } from '../types/market.js';
import { config } from '../config/index.js';
import { Scenario, ScenarioLifecycleEvent, ScenarioRevalidationRecord, ScenarioStatus } from '../ai/scenario-types.js';

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

        CREATE TABLE IF NOT EXISTS ai_reviews (
          id VARCHAR(64) PRIMARY KEY,
          setup_id VARCHAR(64) NOT NULL,
          provider VARCHAR(20) NOT NULL,
          model VARCHAR(50) NOT NULL,
          verdict VARCHAR(20) NOT NULL,
          confidence DOUBLE PRECISION NOT NULL,
          reasoning TEXT NOT NULL,
          arguments_for JSONB,
          arguments_against JSONB,
          invalidation_trigger TEXT,
          risk_score DOUBLE PRECISION,
          latency_ms INTEGER,
          tokens_used INTEGER,
          cost_usd DOUBLE PRECISION,
          raw_response JSONB,
          timestamp BIGINT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_pg_ai_reviews_setup 
        ON ai_reviews(setup_id, timestamp DESC);

        CREATE TABLE IF NOT EXISTS signals (
          id VARCHAR(64) PRIMARY KEY,
          setup_id VARCHAR(64) NOT NULL,
          timestamp BIGINT NOT NULL,
          symbol VARCHAR(20) NOT NULL,
          strategy VARCHAR(50) NOT NULL,
          direction VARCHAR(10) NOT NULL,
          timeframe VARCHAR(10) NOT NULL,
          entry_price DOUBLE PRECISION NOT NULL,
          stop_loss DOUBLE PRECISION NOT NULL,
          take_profit DOUBLE PRECISION NOT NULL,
          rr_net DOUBLE PRECISION NOT NULL,
          consensus_verdict VARCHAR(30) NOT NULL,
          openai_verdict VARCHAR(20),
          gemini_verdict VARCHAR(20),
          status VARCHAR(30) NOT NULL,
          rejection_reason TEXT,
          snapshot_id VARCHAR(64),
          created_at BIGINT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_pg_signals_time 
        ON signals(timestamp DESC);

        CREATE TABLE IF NOT EXISTS signal_lifecycle (
          id SERIAL PRIMARY KEY,
          signal_id VARCHAR(64) NOT NULL,
          from_state VARCHAR(30) NOT NULL,
          to_state VARCHAR(30) NOT NULL,
          timestamp BIGINT NOT NULL,
          reason TEXT,
          metadata JSONB
        );

        CREATE INDEX IF NOT EXISTS idx_pg_lifecycle_signal 
        ON signal_lifecycle(signal_id, timestamp ASC);

        CREATE TABLE IF NOT EXISTS push_subscriptions (
          id VARCHAR(64) PRIMARY KEY,
          endpoint TEXT NOT NULL UNIQUE,
          p256dh TEXT NOT NULL,
          auth TEXT NOT NULL,
          user_id VARCHAR(64),
          created_at BIGINT NOT NULL,
          last_active BIGINT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS notifications_log (
          id VARCHAR(64) PRIMARY KEY,
          channel VARCHAR(20) NOT NULL,
          recipient TEXT NOT NULL,
          signal_id VARCHAR(64),
          message_type VARCHAR(50) NOT NULL,
          payload JSONB,
          status VARCHAR(20) NOT NULL,
          delivered_at BIGINT,
          timestamp BIGINT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_pg_notif_time 
        ON notifications_log(timestamp DESC);

        CREATE TABLE IF NOT EXISTS risk_policies (
          id VARCHAR(64) PRIMARY KEY,
          version INTEGER NOT NULL,
          is_active INTEGER NOT NULL,
          policy_json JSONB NOT NULL,
          created_at BIGINT NOT NULL,
          created_by VARCHAR(50) NOT NULL
        );

        CREATE TABLE IF NOT EXISTS bybit_credentials (
          id VARCHAR(64) PRIMARY KEY,
          api_key VARCHAR(100) NOT NULL,
          api_key_masked VARCHAR(50) NOT NULL,
          encrypted_secret JSONB NOT NULL,
          environment VARCHAR(20) NOT NULL,
          status VARCHAR(30) NOT NULL,
          detected_permissions JSONB,
          fee_source VARCHAR(50),
          actual_maker_fee DOUBLE PRECISION,
          actual_taker_fee DOUBLE PRECISION,
          account_balance_usdt DOUBLE PRECISION,
          last_verified_at BIGINT,
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS ai_provider_credentials (
          provider VARCHAR(20) PRIMARY KEY,
          api_key_masked VARCHAR(50) NOT NULL,
          encrypted_secret JSONB NOT NULL,
          model VARCHAR(50) NOT NULL,
          status VARCHAR(30) NOT NULL,
          last_verified_at BIGINT,
          updated_at BIGINT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS ai_router_config (
          id VARCHAR(64) PRIMARY KEY,
          mode VARCHAR(30) NOT NULL,
          profile VARCHAR(30) NOT NULL,
          config_json JSONB NOT NULL,
          updated_at BIGINT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS hard_budget_config (
          id VARCHAR(64) PRIMARY KEY,
          daily_budget_limit_usd NUMERIC(10,4) NOT NULL,
          monthly_budget_limit_usd NUMERIC(10,4) NOT NULL,
          max_cost_per_request_usd NUMERIC(10,4) NOT NULL,
          provider_limits_json JSONB,
          model_limits_json JSONB,
          task_limits_json JSONB,
          alert_thresholds_json JSONB,
          auto_reset_period INTEGER NOT NULL,
          is_blocked INTEGER NOT NULL,
          blocked_reason TEXT,
          updated_at BIGINT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS ai_consumption_logs (
          id VARCHAR(64) PRIMARY KEY,
          timestamp BIGINT NOT NULL,
          provider VARCHAR(20) NOT NULL,
          model VARCHAR(50) NOT NULL,
          task VARCHAR(50) NOT NULL,
          tokens_prompt INTEGER NOT NULL,
          tokens_completion INTEGER NOT NULL,
          tokens_cached INTEGER NOT NULL,
          cost_usd DOUBLE PRECISION NOT NULL,
          latency_ms INTEGER NOT NULL,
          status VARCHAR(20) NOT NULL,
          analysis_id VARCHAR(64)
        );

        CREATE INDEX IF NOT EXISTS idx_pg_ai_cons_time 
        ON ai_consumption_logs(timestamp DESC);

        CREATE TABLE IF NOT EXISTS config_audit_logs (
          id VARCHAR(64) PRIMARY KEY,
          timestamp BIGINT NOT NULL,
          admin_user VARCHAR(50) NOT NULL,
          category VARCHAR(30) NOT NULL,
          action VARCHAR(50) NOT NULL,
          details_json JSONB,
          ip_address VARCHAR(50)
        );

        CREATE INDEX IF NOT EXISTS idx_pg_audit_time 
        ON config_audit_logs(timestamp DESC);

        CREATE TABLE IF NOT EXISTS admin_credentials (
          id VARCHAR(32) PRIMARY KEY,
          password_hash VARCHAR(128) NOT NULL,
          salt VARCHAR(64) NOT NULL,
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS admin_sessions (
          token VARCHAR(64) PRIMARY KEY,
          csrf_token VARCHAR(64) NOT NULL,
          created_at BIGINT NOT NULL,
          expires_at BIGINT NOT NULL,
          ip_address VARCHAR(50),
          user_agent TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_pg_sessions_expires 
        ON admin_sessions(expires_at);

        CREATE TABLE IF NOT EXISTS scenarios (
          id VARCHAR(64) PRIMARY KEY,
          symbol VARCHAR(20) NOT NULL,
          direction VARCHAR(10) NOT NULL,
          timeframe VARCHAR(10) NOT NULL,
          structure_type VARCHAR(50) NOT NULL,
          proposed_by VARCHAR(30) NOT NULL,
          models_used JSONB NOT NULL,
          snapshot_id VARCHAR(64) NOT NULL,
          discovery_timestamp BIGINT NOT NULL,
          entry_zone_min DOUBLE PRECISION NOT NULL,
          entry_zone_max DOUBLE PRECISION NOT NULL,
          target_entry DOUBLE PRECISION NOT NULL,
          stop_loss_price DOUBLE PRECISION NOT NULL,
          target_12_price DOUBLE PRECISION,
          target_14_price DOUBLE PRECISION,
          net_rr_12 DOUBLE PRECISION,
          net_rr_14 DOUBLE PRECISION,
          rr_mode_available VARCHAR(20) NOT NULL,
          uncertainty_level VARCHAR(20) NOT NULL,
          status VARCHAR(30) NOT NULL,
          rejection_reason TEXT,
          valid_until_timestamp BIGINT NOT NULL,
          ai_cost_usd DOUBLE PRECISION DEFAULT 0,
          payload_json JSONB NOT NULL,
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_pg_scenarios_status 
        ON scenarios(status, discovery_timestamp DESC);

        CREATE TABLE IF NOT EXISTS scenario_lifecycle (
          id SERIAL PRIMARY KEY,
          scenario_id VARCHAR(64) NOT NULL,
          from_status VARCHAR(30) NOT NULL,
          to_status VARCHAR(30) NOT NULL,
          timestamp BIGINT NOT NULL,
          reason TEXT,
          metadata_json JSONB
        );

        CREATE INDEX IF NOT EXISTS idx_pg_scen_life_id 
        ON scenario_lifecycle(scenario_id, timestamp ASC);

        CREATE TABLE IF NOT EXISTS scenario_revalidations (
          id VARCHAR(64) PRIMARY KEY,
          scenario_id VARCHAR(64) NOT NULL,
          timestamp BIGINT NOT NULL,
          openai_verdict VARCHAR(20),
          gemini_verdict VARCHAR(20),
          consensus_verdict VARCHAR(30) NOT NULL,
          price_at_revalidation DOUBLE PRECISION NOT NULL,
          details_json JSONB NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_pg_scen_reval_id 
        ON scenario_revalidations(scenario_id, timestamp DESC);

        ALTER TABLE signals ADD COLUMN IF NOT EXISTS simulated_entry_time BIGINT;
        ALTER TABLE signals ADD COLUMN IF NOT EXISTS exit_time BIGINT;
        ALTER TABLE signals ADD COLUMN IF NOT EXISTS duration_ms BIGINT;
        ALTER TABLE signals ADD COLUMN IF NOT EXISTS exit_price DOUBLE PRECISION;
        ALTER TABLE signals ADD COLUMN IF NOT EXISTS mfe_price DOUBLE PRECISION;
        ALTER TABLE signals ADD COLUMN IF NOT EXISTS mfe_r DOUBLE PRECISION;
        ALTER TABLE signals ADD COLUMN IF NOT EXISTS mae_price DOUBLE PRECISION;
        ALTER TABLE signals ADD COLUMN IF NOT EXISTS mae_r DOUBLE PRECISION;
        ALTER TABLE signals ADD COLUMN IF NOT EXISTS realized_net_r DOUBLE PRECISION;
        ALTER TABLE signals ADD COLUMN IF NOT EXISTS realized_net_pnl_usdt DOUBLE PRECISION;
        ALTER TABLE signals ADD COLUMN IF NOT EXISTS entry_mode VARCHAR(30) DEFAULT 'SIGNALS_ONLY';
        ALTER TABLE signals ADD COLUMN IF NOT EXISTS evaluation_mode VARCHAR(30) DEFAULT 'DUAL_AI';

        ALTER TABLE hard_budget_config ADD COLUMN IF NOT EXISTS openai_free_tier_json TEXT;
        ALTER TABLE ai_consumption_logs ADD COLUMN IF NOT EXISTS tokens_reasoning INTEGER DEFAULT 0;
        ALTER TABLE ai_consumption_logs ADD COLUMN IF NOT EXISTS cost_gross_usd DOUBLE PRECISION DEFAULT 0;
        ALTER TABLE ai_consumption_logs ADD COLUMN IF NOT EXISTS discount_usd DOUBLE PRECISION DEFAULT 0;
        ALTER TABLE ai_consumption_logs ADD COLUMN IF NOT EXISTS cost_net_usd DOUBLE PRECISION DEFAULT 0;
        ALTER TABLE ai_consumption_logs ADD COLUMN IF NOT EXISTS free_tier_group VARCHAR(20) DEFAULT 'NONE';
        ALTER TABLE ai_consumption_logs ADD COLUMN IF NOT EXISTS is_free_tier INTEGER DEFAULT 0;
        ALTER TABLE ai_consumption_logs ADD COLUMN IF NOT EXISTS discount_status VARCHAR(20) DEFAULT 'NONE';
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
    fromTimestamp: number = 0,
    toTimestamp: number = Number.MAX_SAFE_INTEGER,
    limit: number = 1000
  ): Promise<Candle[]> {
    const query = `
      SELECT symbol, timeframe, timestamp, open, high, low, close, volume, turnover, confirmed
      FROM candles
      WHERE symbol = $1 AND timeframe = $2 AND timestamp >= $3 AND timestamp <= $4
      ORDER BY timestamp ASC
      LIMIT $5
    `;
    const res = await this.pool.query(query, [symbol, timeframe, fromTimestamp, toTimestamp, limit]);
    return res.rows.map((r: any) => ({
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

  public async logEvent(
    level: 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL',
    component: string,
    message: string,
    metadata?: any
  ): Promise<void> {
    const query = `
      INSERT INTO system_events (timestamp, level, component, message, metadata)
      VALUES ($1, $2, $3, $4, $5)
    `;
    await this.pool.query(query, [
      Date.now(),
      level,
      component,
      message,
      metadata ? JSON.stringify(metadata) : null,
    ]);
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
    const query = `SELECT * FROM setups ORDER BY timestamp DESC LIMIT $1`;
    const res = await this.pool.query(query, [limit]);
    return res.rows.map((r: any) => ({
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
      evidence: typeof r.evidence === 'string' ? JSON.parse(r.evidence) : r.evidence || {},
      createdAt: Number(r.created_at),
    }));
  }

  public async saveAiReview(review: any): Promise<void> {
    const query = `
      INSERT INTO ai_reviews (id, setup_id, provider, model, verdict, confidence, reasoning, arguments_for, arguments_against, invalidation_trigger, risk_score, latency_ms, tokens_used, cost_usd, raw_response, timestamp)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
    `;
    await this.pool.query(query, [
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
      review.rawResponse ? JSON.stringify(review.rawResponse) : null,
      review.timestamp || Date.now(),
    ]);
  }

  public async getAiReviews(setupId?: string, limit: number = 50): Promise<any[]> {
    const query = setupId
      ? `SELECT * FROM ai_reviews WHERE setup_id = $1 ORDER BY timestamp DESC LIMIT $2`
      : `SELECT * FROM ai_reviews ORDER BY timestamp DESC LIMIT $1`;
    const params = setupId ? [setupId, limit] : [limit];
    const res = await this.pool.query(query, params);
    return res.rows.map((r: any) => ({
      id: r.id,
      setupId: r.setup_id,
      provider: r.provider,
      model: r.model,
      verdict: r.verdict,
      confidence: Number(r.confidence),
      reasoning: r.reasoning,
      argumentsFor: typeof r.arguments_for === 'string' ? JSON.parse(r.arguments_for) : r.arguments_for || [],
      argumentsAgainst: typeof r.arguments_against === 'string' ? JSON.parse(r.arguments_against) : r.arguments_against || [],
      invalidationTrigger: r.invalidation_trigger,
      riskScore: Number(r.risk_score),
      latencyMs: Number(r.latency_ms),
      tokensUsed: Number(r.tokens_used),
      costUsd: Number(r.cost_usd),
      rawResponse: typeof r.raw_response === 'string' ? JSON.parse(r.raw_response) : r.raw_response || null,
      timestamp: Number(r.timestamp),
    }));
  }

  public async saveSignal(signal: any): Promise<void> {
    const query = `
      INSERT INTO signals (id, setup_id, timestamp, symbol, strategy, direction, timeframe, entry_price, stop_loss, take_profit, rr_net, consensus_verdict, openai_verdict, gemini_verdict, status, rejection_reason, snapshot_id, created_at, evaluation_mode)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
      ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status,
        rejection_reason = EXCLUDED.rejection_reason,
        evaluation_mode = COALESCE(EXCLUDED.evaluation_mode, signals.evaluation_mode)
    `;
    await this.pool.query(query, [
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
    ]);
  }

  public async getSignals(limit: number = 50): Promise<any[]> {
    const query = `SELECT * FROM signals ORDER BY timestamp DESC LIMIT $1`;
    const res = await this.pool.query(query, [limit]);
    return res.rows.map((r: any) => ({
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

  public async recordSignalTransition(transition: {
    signalId: string;
    fromState: string;
    toState: string;
    timestamp: number;
    reason?: string;
    metadata?: any;
  }): Promise<void> {
    const query = `
      INSERT INTO signal_lifecycle (signal_id, from_state, to_state, timestamp, reason, metadata)
      VALUES ($1, $2, $3, $4, $5, $6)
    `;
    await this.pool.query(query, [
      transition.signalId,
      transition.fromState,
      transition.toState,
      transition.timestamp,
      transition.reason || null,
      transition.metadata ? JSON.stringify(transition.metadata) : null,
    ]);
  }

  public async getSignalLifecycle(signalId: string): Promise<any[]> {
    const query = `SELECT * FROM signal_lifecycle WHERE signal_id = $1 ORDER BY timestamp ASC`;
    const res = await this.pool.query(query, [signalId]);
    return res.rows.map((r: any) => ({
      id: r.id,
      signalId: r.signal_id,
      fromState: r.from_state,
      toState: r.to_state,
      timestamp: Number(r.timestamp),
      reason: r.reason,
      metadata: typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata || null,
    }));
  }

  public async savePushSubscription(sub: {
    id: string;
    endpoint: string;
    p256dh: string;
    auth: string;
    userId?: string;
    createdAt: number;
    lastActive: number;
  }): Promise<void> {
    const query = `
      INSERT INTO push_subscriptions (id, endpoint, p256dh, auth, user_id, created_at, last_active)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (endpoint) DO UPDATE SET
        p256dh = EXCLUDED.p256dh,
        auth = EXCLUDED.auth,
        last_active = EXCLUDED.last_active
    `;
    await this.pool.query(query, [
      sub.id,
      sub.endpoint,
      sub.p256dh,
      sub.auth,
      sub.userId || null,
      sub.createdAt,
      sub.lastActive,
    ]);
  }

  public async deletePushSubscription(endpoint: string): Promise<void> {
    const query = `DELETE FROM push_subscriptions WHERE endpoint = $1`;
    await this.pool.query(query, [endpoint]);
  }

  public async getPushSubscriptions(): Promise<any[]> {
    const query = `SELECT * FROM push_subscriptions`;
    const res = await this.pool.query(query);
    return res.rows.map((r: any) => ({
      id: r.id,
      endpoint: r.endpoint,
      p256dh: r.p256dh,
      auth: r.auth,
      userId: r.user_id,
      createdAt: Number(r.created_at),
      lastActive: Number(r.last_active),
    }));
  }

  public async logNotification(record: {
    id: string;
    channel: string;
    recipient: string;
    signalId?: string;
    messageType: string;
    payload?: any;
    status: string;
    deliveredAt?: number;
    timestamp: number;
  }): Promise<void> {
    const query = `
      INSERT INTO notifications_log (id, channel, recipient, signal_id, message_type, payload, status, delivered_at, timestamp)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `;
    await this.pool.query(query, [
      record.id,
      record.channel,
      record.recipient,
      record.signalId || null,
      record.messageType,
      record.payload ? (typeof record.payload === 'string' ? record.payload : JSON.stringify(record.payload)) : null,
      record.status,
      record.deliveredAt || null,
      record.timestamp,
    ]);
  }

  public async getNotificationHistory(limit: number = 50): Promise<any[]> {
    const query = `SELECT * FROM notifications_log ORDER BY timestamp DESC LIMIT $1`;
    const res = await this.pool.query(query, [limit]);
    return res.rows.map((r: any) => ({
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
  }

  public async updateSignalMetrics(
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
  ): Promise<void> {
    const query = `
      UPDATE signals SET
        status = COALESCE($1, status),
        simulated_entry_time = COALESCE($2, simulated_entry_time),
        exit_time = COALESCE($3, exit_time),
        duration_ms = COALESCE($4, duration_ms),
        exit_price = COALESCE($5, exit_price),
        mfe_price = COALESCE($6, mfe_price),
        mfe_r = COALESCE($7, mfe_r),
        mae_price = COALESCE($8, mae_price),
        mae_r = COALESCE($9, mae_r),
        realized_net_r = COALESCE($10, realized_net_r),
        realized_net_pnl_usdt = COALESCE($11, realized_net_pnl_usdt),
        entry_mode = COALESCE($12, entry_mode)
      WHERE id = $13
    `;
    await this.pool.query(query, [
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
      id,
    ]);
  }

  public async getActiveSignalsForRecovery(): Promise<any[]> {
    const query = `
      SELECT * FROM signals 
      WHERE status NOT IN ('COMPLETED_TP', 'COMPLETED_SL', 'EXPIRED', 'INVALIDATED', 'CANCELLED', 'DISCARDED')
      ORDER BY timestamp ASC
    `;
    const res = await this.pool.query(query);
    return res.rows.map((r: any) => ({
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

  public async saveRiskPolicy(policy: any): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('UPDATE risk_policies SET is_active = 0');
      const id = policy.id || `risk_pol_${Date.now()}`;
      await client.query(
        `INSERT INTO risk_policies (id, version, is_active, policy_json, created_at, created_by)
         VALUES ($1, $2, 1, $3, $4, $5)`,
        [id, policy.version || 1, JSON.stringify(policy), policy.updatedAt || Date.now(), policy.updatedBy || 'admin']
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  public async getActiveRiskPolicy(): Promise<any | null> {
    const res = await this.pool.query('SELECT * FROM risk_policies WHERE is_active = 1 ORDER BY created_at DESC LIMIT 1');
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return typeof r.policy_json === 'string' ? JSON.parse(r.policy_json) : r.policy_json;
  }

  public async saveBybitCredentials(record: any): Promise<void> {
    const query = `
      INSERT INTO bybit_credentials (id, api_key, api_key_masked, encrypted_secret, environment, status, detected_permissions, fee_source, actual_maker_fee, actual_taker_fee, account_balance_usdt, last_verified_at, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      ON CONFLICT (id) DO UPDATE SET
        api_key = EXCLUDED.api_key,
        api_key_masked = EXCLUDED.api_key_masked,
        encrypted_secret = EXCLUDED.encrypted_secret,
        environment = EXCLUDED.environment,
        status = EXCLUDED.status,
        detected_permissions = EXCLUDED.detected_permissions,
        fee_source = EXCLUDED.fee_source,
        actual_maker_fee = EXCLUDED.actual_maker_fee,
        actual_taker_fee = EXCLUDED.actual_taker_fee,
        account_balance_usdt = EXCLUDED.account_balance_usdt,
        last_verified_at = EXCLUDED.last_verified_at,
        updated_at = EXCLUDED.updated_at
    `;
    await this.pool.query(query, [
      record.id,
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
      record.updatedAt || Date.now(),
    ]);
  }

  public async getBybitCredentials(): Promise<any | null> {
    const res = await this.pool.query('SELECT * FROM bybit_credentials ORDER BY updated_at DESC LIMIT 1');
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      id: r.id,
      apiKey: r.api_key,
      apiKeyMasked: r.api_key_masked,
      encryptedSecret: typeof r.encrypted_secret === 'string' ? JSON.parse(r.encrypted_secret) : r.encrypted_secret,
      environment: r.environment,
      status: r.status,
      detectedPermissions: typeof r.detected_permissions === 'string' ? JSON.parse(r.detected_permissions) : r.detected_permissions || {},
      feeSource: r.fee_source,
      actualMakerFeeRate: r.actual_maker_fee !== null ? Number(r.actual_maker_fee) : undefined,
      actualTakerFeeRate: r.actual_taker_fee !== null ? Number(r.actual_taker_fee) : undefined,
      accountBalanceUsdt: r.account_balance_usdt !== null ? Number(r.account_balance_usdt) : undefined,
      lastVerifiedAt: r.last_verified_at ? Number(r.last_verified_at) : undefined,
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at),
    };
  }

  public async deleteBybitCredentials(): Promise<void> {
    await this.pool.query('DELETE FROM bybit_credentials');
  }

  public async logConfigAudit(record: any): Promise<void> {
    const id = record.id || `aud_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    await this.pool.query(
      `INSERT INTO config_audit_logs (id, timestamp, admin_user, category, action, details_json, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        id,
        Date.now(),
        record.adminUser || 'admin',
        record.category,
        record.action,
        record.details ? JSON.stringify(record.details) : null,
        record.ipAddress || null,
      ]
    );
  }

  public async getConfigAuditLogs(limit: number = 50): Promise<any[]> {
    const res = await this.pool.query('SELECT * FROM config_audit_logs ORDER BY timestamp DESC LIMIT $1', [limit]);
    return res.rows.map((r: any) => ({
      id: r.id,
      timestamp: Number(r.timestamp),
      adminUser: r.admin_user,
      category: r.category,
      action: r.action,
      details: typeof r.details_json === 'string' ? JSON.parse(r.details_json) : r.details_json,
      ipAddress: r.ip_address,
    }));
  }

  public async saveRouterConfig(config: any): Promise<void> {
    const query = `
      INSERT INTO ai_router_config (id, mode, profile, config_json, updated_at)
      VALUES ('primary_router_config', $1, $2, $3, $4)
      ON CONFLICT (id) DO UPDATE SET
        mode = EXCLUDED.mode,
        profile = EXCLUDED.profile,
        config_json = EXCLUDED.config_json,
        updated_at = EXCLUDED.updated_at
    `;
    await this.pool.query(query, [config.mode, config.profile, JSON.stringify(config), config.updatedAt || Date.now()]);
  }

  public async getRouterConfig(): Promise<any | null> {
    const res = await this.pool.query("SELECT * FROM ai_router_config WHERE id = 'primary_router_config'");
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return typeof r.config_json === 'string' ? JSON.parse(r.config_json) : r.config_json;
  }

  public async saveHardBudgetConfig(config: any): Promise<void> {
    const query = `
      INSERT INTO hard_budget_config (id, daily_budget_limit_usd, monthly_budget_limit_usd, max_cost_per_request_usd, provider_limits_json, model_limits_json, task_limits_json, alert_thresholds_json, auto_reset_period, is_blocked, blocked_reason, openai_free_tier_json, updated_at)
      VALUES ('primary_hard_budget', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      ON CONFLICT (id) DO UPDATE SET
        daily_budget_limit_usd = EXCLUDED.daily_budget_limit_usd,
        monthly_budget_limit_usd = EXCLUDED.monthly_budget_limit_usd,
        max_cost_per_request_usd = EXCLUDED.max_cost_per_request_usd,
        provider_limits_json = EXCLUDED.provider_limits_json,
        model_limits_json = EXCLUDED.model_limits_json,
        task_limits_json = EXCLUDED.task_limits_json,
        alert_thresholds_json = EXCLUDED.alert_thresholds_json,
        auto_reset_period = EXCLUDED.auto_reset_period,
        is_blocked = EXCLUDED.is_blocked,
        blocked_reason = EXCLUDED.blocked_reason,
        openai_free_tier_json = EXCLUDED.openai_free_tier_json,
        updated_at = EXCLUDED.updated_at
    `;
    await this.pool.query(query, [
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
      config.updatedAt || Date.now(),
    ]);
  }

  public async getHardBudgetConfig(): Promise<any | null> {
    const res = await this.pool.query("SELECT * FROM hard_budget_config WHERE id = 'primary_hard_budget'");
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      dailyBudgetLimitUsd: Number(r.daily_budget_limit_usd),
      monthlyBudgetLimitUsd: Number(r.monthly_budget_limit_usd),
      maxCostPerRequestUsd: Number(r.max_cost_per_request_usd),
      providerLimitsUsd: typeof r.provider_limits_json === 'string' ? JSON.parse(r.provider_limits_json) : r.provider_limits_json || {},
      modelLimitsUsd: typeof r.model_limits_json === 'string' ? JSON.parse(r.model_limits_json) : r.model_limits_json || {},
      taskLimitsUsd: typeof r.task_limits_json === 'string' ? JSON.parse(r.task_limits_json) : r.task_limits_json || {},
      alertThresholdsPercent: typeof r.alert_thresholds_json === 'string' ? JSON.parse(r.alert_thresholds_json) : r.alert_thresholds_json || [50, 80, 95, 100],
      autoResetPeriod: r.auto_reset_period === 1,
      isBlocked: r.is_blocked === 1,
      blockedReason: r.blocked_reason,
      openaiFreeTier: r.openai_free_tier_json ? (typeof r.openai_free_tier_json === 'string' ? JSON.parse(r.openai_free_tier_json) : r.openai_free_tier_json) : null,
      updatedAt: Number(r.updated_at),
    };
  }

  public async saveAiCredentials(record: { provider: string; apiKeyMasked: string; encryptedSecret: any; model: string; status: string }): Promise<void> {
    const query = `
      INSERT INTO ai_provider_credentials (provider, api_key_masked, encrypted_secret, model, status, last_verified_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (provider) DO UPDATE SET
        api_key_masked = EXCLUDED.api_key_masked,
        encrypted_secret = EXCLUDED.encrypted_secret,
        model = EXCLUDED.model,
        status = EXCLUDED.status,
        last_verified_at = EXCLUDED.last_verified_at,
        updated_at = EXCLUDED.updated_at
    `;
    await this.pool.query(query, [
      record.provider,
      record.apiKeyMasked,
      JSON.stringify(record.encryptedSecret),
      record.model,
      record.status,
      Date.now(),
      Date.now(),
    ]);
  }

  public async getAiCredentials(provider: string): Promise<any | null> {
    const res = await this.pool.query('SELECT * FROM ai_provider_credentials WHERE provider = $1', [provider]);
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      provider: r.provider,
      apiKeyMasked: r.api_key_masked,
      encryptedSecret: typeof r.encrypted_secret === 'string' ? JSON.parse(r.encrypted_secret) : r.encrypted_secret,
      model: r.model,
      status: r.status,
      lastVerifiedAt: r.last_verified_at ? Number(r.last_verified_at) : undefined,
      updatedAt: Number(r.updated_at),
    };
  }

  public async deleteAiCredentials(provider: string): Promise<void> {
    await this.pool.query('DELETE FROM ai_provider_credentials WHERE provider = $1', [provider]);
  }

  public async logAiConsumption(log: {
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
  }): Promise<void> {
    const id = log.id || `cons_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const costGross = log.costGrossUsd !== undefined ? log.costGrossUsd : log.costUsd;
    const discount = log.discountUsd !== undefined ? log.discountUsd : 0;
    const costNet = log.costNetUsd !== undefined ? log.costNetUsd : (costGross - discount);
    const discountStatus = log.discountStatus || (log.isFreeTier ? 'ESTIMATED' : 'NONE');

    const query = `
      INSERT INTO ai_consumption_logs (
        id, timestamp, provider, model, task,
        tokens_prompt, tokens_completion, tokens_cached, tokens_reasoning,
        cost_usd, cost_gross_usd, discount_usd, cost_net_usd,
        free_tier_group, is_free_tier, discount_status, latency_ms, status, analysis_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
    `;
    await this.pool.query(query, [
      id,
      log.timestamp || Date.now(),
      log.provider,
      log.model,
      log.task,
      log.tokensPrompt || 0,
      log.tokensCompletion || 0,
      log.tokensCached || 0,
      log.tokensReasoning || 0,
      costNet,
      costGross,
      discount,
      costNet,
      log.freeTierGroup || 'NONE',
      log.isFreeTier ? 1 : 0,
      discountStatus,
      log.latencyMs || 0,
      log.status || 'SUCCESS',
      log.analysisId || null,
    ]);
  }

  public async getAiConsumptionLogs(limit: number = 50): Promise<any[]> {
    const res = await this.pool.query('SELECT * FROM ai_consumption_logs ORDER BY timestamp DESC LIMIT $1', [limit]);
    return res.rows.map((r: any) => ({
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
  }

  public async getAdminCredentials(): Promise<{ passwordHash: string; salt: string; createdAt: number; updatedAt: number } | null> {
    const res = await this.pool.query("SELECT * FROM admin_credentials WHERE id = 'primary_admin'");
    if (res.rows.length === 0) return null;
    const row = res.rows[0];
    return {
      passwordHash: row.password_hash,
      salt: row.salt,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
  }

  public async setAdminCredentials(passwordHash: string, salt: string): Promise<void> {
    const now = Date.now();
    await this.pool.query(`
      INSERT INTO admin_credentials (id, password_hash, salt, created_at, updated_at)
      VALUES ('primary_admin', $1, $2, $3, $4)
      ON CONFLICT(id) DO UPDATE SET
        password_hash = EXCLUDED.password_hash,
        salt = EXCLUDED.salt,
        updated_at = EXCLUDED.updated_at
    `, [passwordHash, salt, now, now]);
  }

  public async hasAdminCredentials(): Promise<boolean> {
    const creds = await this.getAdminCredentials();
    return creds !== null;
  }

  public async saveAdminSession(session: {
    token: string;
    csrfToken: string;
    createdAt: number;
    expiresAt: number;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<void> {
    await this.pool.query(`
      INSERT INTO admin_sessions (token, csrf_token, created_at, expires_at, ip_address, user_agent)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT(token) DO UPDATE SET
        expires_at = EXCLUDED.expires_at,
        ip_address = EXCLUDED.ip_address,
        user_agent = EXCLUDED.user_agent
    `, [session.token, session.csrfToken, session.createdAt, session.expiresAt, session.ipAddress || null, session.userAgent || null]);
  }

  public async getAdminSession(token: string): Promise<{
    token: string;
    csrfToken: string;
    createdAt: number;
    expiresAt: number;
    ipAddress?: string;
    userAgent?: string;
  } | null> {
    const res = await this.pool.query('SELECT * FROM admin_sessions WHERE token = $1', [token]);
    if (res.rows.length === 0) return null;
    const row = res.rows[0];
    return {
      token: row.token,
      csrfToken: row.csrf_token,
      createdAt: Number(row.created_at),
      expiresAt: Number(row.expires_at),
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
    };
  }

  public async deleteAdminSession(token: string): Promise<void> {
    await this.pool.query('DELETE FROM admin_sessions WHERE token = $1', [token]);
  }

  public async saveScenario(scenario: Scenario): Promise<void> {
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
      lastCheckedTimestamp: scenario.lastCheckedTimestamp,
      isSimulated: scenario.isSimulated,
    };
    const query = `
      INSERT INTO scenarios (
        id, symbol, direction, timeframe, structure_type, proposed_by, models_used,
        snapshot_id, discovery_timestamp, entry_zone_min, entry_zone_max, target_entry,
        stop_loss_price, target_12_price, target_14_price, net_rr_12, net_rr_14,
        rr_mode_available, uncertainty_level, status, rejection_reason,
        valid_until_timestamp, ai_cost_usd, payload_json, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26)
      ON CONFLICT(id) DO UPDATE SET
        status = EXCLUDED.status,
        rejection_reason = EXCLUDED.rejection_reason,
        target_12_price = EXCLUDED.target_12_price,
        target_14_price = EXCLUDED.target_14_price,
        net_rr_12 = EXCLUDED.net_rr_12,
        net_rr_14 = EXCLUDED.net_rr_14,
        rr_mode_available = EXCLUDED.rr_mode_available,
        ai_cost_usd = EXCLUDED.ai_cost_usd,
        payload_json = EXCLUDED.payload_json,
        updated_at = EXCLUDED.updated_at
    `;
    await this.pool.query(query, [
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
      scenario.updatedAt || now,
    ]);
  }

  public async getScenarios(options?: { status?: ScenarioStatus | ScenarioStatus[]; limit?: number }): Promise<Scenario[]> {
    try {
      let query = 'SELECT * FROM scenarios';
      const params: any[] = [];
      if (options?.status) {
        if (Array.isArray(options.status)) {
          const placeholders = options.status.map((_, i) => `$${i + 1}`).join(',');
          query += ` WHERE status IN (${placeholders})`;
          params.push(...options.status);
        } else {
          query += ' WHERE status = $1';
          params.push(options.status);
        }
      }
      query += ' ORDER BY discovery_timestamp DESC';
      if (options?.limit) {
        query += ` LIMIT $${params.length + 1}`;
        params.push(options.limit);
      }
      const res = await this.pool.query(query, params);
      return res.rows.map((r) => this.mapScenarioRow(r));
    } catch {
      return [];
    }
  }

  public async getScenarioById(id: string): Promise<Scenario | null> {
    try {
      const res = await this.pool.query('SELECT * FROM scenarios WHERE id = $1', [id]);
      if (res.rows.length === 0) return null;
      return this.mapScenarioRow(res.rows[0]);
    } catch {
      return null;
    }
  }

  public async updateScenarioStatus(id: string, status: ScenarioStatus, reason?: string, updates?: Partial<Scenario>): Promise<void> {
    try {
      const existing = await this.getScenarioById(id);
      if (!existing) return;
      const merged: Scenario = {
        ...existing,
        ...updates,
        status,
        rejectionReason: reason ?? updates?.rejectionReason ?? existing.rejectionReason,
        updatedAt: Date.now(),
      };
      await this.saveScenario(merged);
    } catch {}
  }

  public async logScenarioLifecycle(event: ScenarioLifecycleEvent): Promise<void> {
    try {
      await this.pool.query(`
        INSERT INTO scenario_lifecycle (scenario_id, from_status, to_status, timestamp, reason, metadata_json)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [
        event.scenarioId,
        event.fromStatus,
        event.toStatus,
        event.timestamp || Date.now(),
        event.reason ?? null,
        event.metadata ? JSON.stringify(event.metadata) : null,
      ]);
    } catch {}
  }

  public async getScenarioLifecycle(scenarioId: string): Promise<ScenarioLifecycleEvent[]> {
    try {
      const res = await this.pool.query('SELECT * FROM scenario_lifecycle WHERE scenario_id = $1 ORDER BY timestamp ASC', [scenarioId]);
      return res.rows.map((r) => ({
        id: Number(r.id),
        scenarioId: r.scenario_id,
        fromStatus: r.from_status,
        toStatus: r.to_status,
        timestamp: Number(r.timestamp),
        reason: r.reason,
        metadata: typeof r.metadata_json === 'string' ? JSON.parse(r.metadata_json) : r.metadata_json,
      }));
    } catch {
      return [];
    }
  }

  public async saveScenarioRevalidation(record: ScenarioRevalidationRecord): Promise<void> {
    try {
      await this.pool.query(`
        INSERT INTO scenario_revalidations (id, scenario_id, timestamp, openai_verdict, gemini_verdict, consensus_verdict, price_at_revalidation, details_json)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT(id) DO UPDATE SET
          consensus_verdict = EXCLUDED.consensus_verdict,
          price_at_revalidation = EXCLUDED.price_at_revalidation,
          details_json = EXCLUDED.details_json
      `, [
        record.id,
        record.scenarioId,
        record.timestamp,
        record.openaiVerdict ?? null,
        record.geminiVerdict ?? null,
        record.consensusVerdict,
        record.priceAtRevalidation,
        JSON.stringify(record.details || {}),
      ]);
    } catch {}
  }

  public async getScenarioRevalidations(scenarioId: string): Promise<ScenarioRevalidationRecord[]> {
    try {
      const res = await this.pool.query('SELECT * FROM scenario_revalidations WHERE scenario_id = $1 ORDER BY timestamp DESC', [scenarioId]);
      return res.rows.map((r) => ({
        id: r.id,
        scenarioId: r.scenario_id,
        timestamp: Number(r.timestamp),
        openaiVerdict: r.openai_verdict,
        geminiVerdict: r.gemini_verdict,
        consensusVerdict: r.consensus_verdict,
        priceAtRevalidation: Number(r.price_at_revalidation),
        details: typeof r.details_json === 'string' ? JSON.parse(r.details_json) : r.details_json,
      }));
    } catch {
      return [];
    }
  }

  private mapScenarioRow(r: any): Scenario {
    const payload = typeof r.payload_json === 'string' ? JSON.parse(r.payload_json) : (r.payload_json || {});
    const modelsUsed = typeof r.models_used === 'string' ? JSON.parse(r.models_used) : (r.models_used || []);

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
      lastCheckedTimestamp: payload.lastCheckedTimestamp,
      isSimulated: payload.isSimulated,
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at),
    };
  }

  public async close(): Promise<void> {
    await this.pool.end();
  }
}
