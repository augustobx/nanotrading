/**
 * One-off, OFFLINE operational-history reset. NEVER executed at application start.
 * Run only with backend stopped, a VERIFIED cold SQLite backup, and explicit opt-in.
 * Keeps encryption keys, risk policy, scheduler config, AI spending history, users,
 * notification subscriptions and historical OHLC data for 90d backtests.
 */
import { DatabaseSync } from 'node:sqlite';
import { existsSync, statSync } from 'node:fs';

const path = process.env.DB_SQLITE_PATH || '/app/data/trading.db';
const confirmation = process.env.CONFIRM_OPERATIONAL_RESET;
const backup = process.env.CONFIRMED_BACKUP_FILE || '/backup/sqlite-volume.tar';
if (confirmation !== 'DELETE_NON_CONFIG_DATA') {
  console.error('RESET RECHAZADO: requiere CONFIRM_OPERATIONAL_RESET=DELETE_NON_CONFIG_DATA');
  process.exit(2);
}
if (!existsSync(backup) || statSync(backup).size < 1024) {
  console.error('RESET RECHAZADO: falta archivo de respaldo SQLite en frío verificable');
  process.exit(2);
}
if (!existsSync(path) || statSync(path).size === 0) {
  console.error('RESET RECHAZADO: SQLite objetivo inexistente');
  process.exit(2);
}

const tables = [
  'quant_decisions',
  'discovery_analyses',
  'scenarios',
  'scenario_lifecycle',
  'scenario_revalidations',
  'ai_watch_plans',
  'signals',
  'signal_lifecycle',
  'setups',
  'ai_reviews',
  'market_snapshots',
  'candles',
  'system_events',
  'notifications_log',
  'backtest_runs',
  'backtest_trades',
] as const;
const protectedTables = [
  'admin_credentials', 'admin_sessions',
  'ai_provider_credentials', 'bybit_credentials', 'risk_policies',
  'hard_budget_config', 'ai_consumption_logs', 'ai_router_config',
  'config_audit_logs', 'discovery_scheduler_config', 'push_subscriptions',
  'historical_candles',
] as const;
const db = new DatabaseSync(path);
try {
  db.exec('PRAGMA busy_timeout=5000');
  const present = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as
    {name: string}[]).map(row => row.name));
  const count = (name: string): number => present.has(name)
    ? Number((db.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get() as {n: number}).n) : 0;
  const before = Object.fromEntries(tables.map(t => [t, count(t)]));
  const protectedBefore = Object.fromEntries(protectedTables.map(t => [t, count(t)]));
  const safe = (db.prepare('PRAGMA integrity_check').get() as {integrity_check: string}).integrity_check;
  if (safe !== 'ok') throw new Error('SQLite integrity_check FAILED: ' + safe);

  db.exec('BEGIN IMMEDIATE');
  try {
    for (const table of tables) if (present.has(table)) {
      db.exec(`DELETE FROM "${table}"`);
    }
    if (present.has('runtime_flags')) {
      db.prepare("DELETE FROM runtime_flags WHERE key LIKE 'pending_neutral_breakout_%'").run();
    }
    for (const table of protectedTables) if (count(table) !== protectedBefore[table]) {
      throw new Error('Protected table unexpectedly changed: ' + table);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  const remaining = Object.fromEntries(tables.map(t => [t, count(t)]));
  if (Object.values(remaining).some(n => n > 0)) throw new Error('Operational tables not empty');
  console.log(JSON.stringify({
    result: 'OPERATIONAL_HISTORY_RESET', backup, path,
    deletedRowsByTable: before, preservedRowsByTable: protectedBefore,
    note: 'AI spending/account limits were NOT reset; historical_candles remain for backtest.',
  }, null, 2));
} finally {
  db.close();
}
