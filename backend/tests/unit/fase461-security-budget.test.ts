import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import { DatabaseService } from '../../src/storage/database.js';
import { AuthManager, authManager, REVOKED_ADMIN_KEYS } from '../../src/security/auth-manager.js';
import { HardBudgetManager } from '../../src/ai/hard-budget-manager.js';
import { ApiServer } from '../../src/api/server.js';
import { MarketCoordinator } from '../../src/market/market-coordinator.js';
import { BybitRestClient } from '../../src/bybit/bybit-rest-client.js';
import { BybitWsClient } from '../../src/bybit/bybit-ws-client.js';
import { CandleManager } from '../../src/market/candle-manager.js';
import { OrderBookManager } from '../../src/market/orderbook-manager.js';

test('Fase 4.6.1 - AuthManager: Scrypt hashing, timing-safe verification and revocation blacklist', () => {
  const db = new DatabaseService(':memory:');
  const auth = new AuthManager(db);

  // 1. Salted Scrypt Hashing
  const { hash, salt } = auth.hashPassword('MyStrongSecretPass2026!');
  assert.ok(hash);
  assert.ok(salt);
  assert.equal(auth.verifyPassword('MyStrongSecretPass2026!', hash, salt), true);
  assert.equal(auth.verifyPassword('WrongPassword123!', hash, salt), false);

  // 2. Blacklisted/revoked key rejection
  assert.equal(REVOKED_ADMIN_KEYS.has('nanolabs_admin_sec_2026'), true);
  const revokedAttempt = auth.login('nanolabs_admin_sec_2026', '127.0.0.1');
  assert.equal(revokedAttempt.success, false);
  assert.equal(revokedAttempt.isRevoked, true);

  db.close();
});

test('Fase 4.6.1 - AuthManager: Secure first-time setup wizard and CSRF validation', () => {
  const db = new DatabaseService(':memory:');
  const auth = new AuthManager(db);

  assert.equal(auth.isInitialized(), false);

  // Rejects password shorter than 10 characters
  const shortSetup = auth.setupInitialAdmin('short', '127.0.0.1');
  assert.equal(shortSetup.success, false);
  assert.match(shortSetup.error!, /al menos 10 caracteres/);

  // Rejects revoked password
  const revokedSetup = auth.setupInitialAdmin('nanolabs_admin_sec_2026', '127.0.0.1');
  assert.equal(revokedSetup.success, false);

  // Valid setup succeeds
  const validSetup = auth.setupInitialAdmin('SecureMasterAdmin2026!', '127.0.0.1');
  assert.equal(validSetup.success, true);
  assert.ok(validSetup.token);
  assert.ok(validSetup.csrfToken);
  assert.equal(auth.isInitialized(), true);

  // Subsequent setup rejected
  const dupSetup = auth.setupInitialAdmin('AnotherSecret2026!', '127.0.0.1');
  assert.equal(dupSetup.success, false);

  // CSRF validation on mutation request simulation
  const dummyReqWithoutCsrf = {
    method: 'POST',
    headers: {
      cookie: `nanolabs_admin_session=${validSetup.token}`,
    },
  } as any;

  const authWithoutCsrf = auth.validateAuth(dummyReqWithoutCsrf);
  assert.equal(authWithoutCsrf.valid, false);
  assert.match(authWithoutCsrf.reason!, /CSRF/);

  const dummyReqWithCsrf = {
    method: 'POST',
    headers: {
      cookie: `nanolabs_admin_session=${validSetup.token}`,
      'x-csrf-token': validSetup.csrfToken,
    },
  } as any;

  const authWithCsrf = auth.validateAuth(dummyReqWithCsrf);
  assert.equal(authWithCsrf.valid, true);

  db.close();
});

test('Fase 4.6.1 - HardBudgetManager: Reactivation blocked when budget exhausted without higher limit', () => {
  const db = new DatabaseService(':memory:');
  const budget = new HardBudgetManager({ dailyBudgetLimitUsd: 0.50 }, undefined, db);

  // Record usage exceeding limit
  budget.recordDirectUsage('OPENAI', 'gpt-4o', 'SETUP_EVALUATION', 0.55);
  assert.equal(budget.isBlocked(), true);
  assert.ok(budget.getTodaySpendUsd() >= 0.50);

  // Attempting reactivation without increasing daily limit MUST throw error
  assert.throws(
    () => {
      budget.reactivateBudget('admin');
    },
    (err: any) => {
      assert.match(err.message, /alcanza o supera el límite diario configurado/);
      return true;
    }
  );

  // Reactivation with higher daily limit succeeds
  budget.reactivateBudget('admin', 1.00);
  assert.equal(budget.isBlocked(), false);
  assert.equal(budget.getConfig().dailyBudgetLimitUsd, 1.00);

  db.close();
});

test('Fase 4.6.1 - HardBudgetManager: Conservative UNCERTAIN_TIMEOUT retention', () => {
  const db = new DatabaseService(':memory:');
  const budget = new HardBudgetManager({ dailyBudgetLimitUsd: 0.50 }, undefined, db);

  const reservation = budget.reserveBudget({
    provider: 'OPENAI',
    model: 'gpt-4o',
    task: 'SETUP_EVALUATION',
    maxEstimatedCostUsd: 0.05,
  });
  assert.equal(reservation.allowed, true);

  // Reconcile as UNCERTAIN_TIMEOUT without explicit costUsd: must retain reserved worst-case
  budget.reconcileReservation(reservation.reservationId!, {
    provider: 'OPENAI',
    model: 'gpt-4o',
    task: 'SETUP_EVALUATION',
    promptTokens: 0,
    completionTokens: 0,
    status: 'UNCERTAIN_TIMEOUT',
  });

  // Today spend must not be 0
  assert.equal(budget.getTodaySpendUsd(), 0.05);

  db.close();
});

test('Fase 4.6.1 - HardBudgetManager: Immutable persistence in Database across reboots', () => {
  const db = new DatabaseService(':memory:');
  const budget1 = new HardBudgetManager({ dailyBudgetLimitUsd: 0.50 }, undefined, db);

  budget1.recordDirectUsage('OPENAI', 'gpt-4o', 'SETUP_EVALUATION', 0.12, { prompt: 1000, completion: 500 });
  budget1.recordDirectUsage('GEMINI', 'gemini-2.0-flash', 'RISK_AUDIT', 0.08, { prompt: 2000, completion: 1000 });

  assert.equal(budget1.getTodaySpendUsd(), 0.20);

  // Simulate reboot: new HardBudgetManager instance connected to same DB
  const budget2 = new HardBudgetManager({ dailyBudgetLimitUsd: 0.50 }, undefined, db);
  assert.equal(budget2.getTodaySpendUsd(), 0.20);
  assert.equal(budget2.getSummary().totalCallsCount, 0); // usageRecords empty in new instance
  assert.equal(budget2.getSummary().effectiveTodaySpendUsd, 0.20); // read from DB!

  // Reset timestamps check
  const summary = budget2.getSummary();
  assert.ok(summary.nextDailyResetUtc);
  assert.ok(summary.nextDailyResetAr);
  assert.ok(summary.nextMonthlyResetUtc);
  assert.ok(summary.nextMonthlyResetAr);

  db.close();
});

test('Fase 4.6.1 - ApiServer: Full Auth lifecycle (status, setup, cookie login, test connection budget guard)', async () => {
  authManager.reset();
  const db = new DatabaseService(':memory:');
  const rest = new BybitRestClient();
  const ws = new BybitWsClient();
  const cm = new CandleManager(db, 'BTCUSDT');
  const ob = new OrderBookManager('BTCUSDT');
  const coordinator = new MarketCoordinator(rest, ws, cm, ob, db, 'BTCUSDT');
  const server = new ApiServer(coordinator, db, 0, '127.0.0.1');

  await server.start();
  const port = server.getPort();
  const baseUrl = `http://127.0.0.1:${port}`;

  // 1. GET /api/v1/auth/status initially uninitialized
  const statusRes1 = await fetch(`${baseUrl}/api/v1/auth/status`);
  const statusData1: any = await statusRes1.json();
  assert.equal(statusData1.success, true);
  assert.equal(statusData1.initialized, false);
  assert.equal(statusData1.authenticated, false);

  // 2. POST /api/v1/auth/setup
  const setupRes = await fetch(`${baseUrl}/api/v1/auth/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'AdminPasswordTest2026!' }),
  });
  assert.equal(setupRes.status, 200);
  const setupData: any = await setupRes.json();
  assert.equal(setupData.success, true);
  assert.ok(setupData.csrfToken);

  const cookieHeader = setupRes.headers.get('set-cookie');
  assert.ok(cookieHeader);
  assert.ok(cookieHeader.includes('nanolabs_admin_session='));
  assert.ok(cookieHeader.includes('HttpOnly'));

  // 3. POST /api/v1/config/ai/test without auth fails
  const testResUnauth = await fetch(`${baseUrl}/api/v1/config/ai/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'openai', model: 'gpt-4o' }),
  });
  assert.equal(testResUnauth.status, 401);

  // 4. POST /api/v1/config/ai/test with cookie and csrf token (budget guard triggered if no key)
  const sessionToken = cookieHeader.split(';')[0].split('=')[1];
  const testResAuth = await fetch(`${baseUrl}/api/v1/config/ai/test`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      cookie: `nanolabs_admin_session=${sessionToken}`,
      'x-csrf-token': setupData.csrfToken,
    },
    body: JSON.stringify({ provider: 'openai', model: 'gpt-4o' }),
  });
  // Without real key in test env, returns 400 with unconfigured status
  assert.equal(testResAuth.status, 400);
  const testData: any = await testResAuth.json();
  assert.equal(testData.status, 'UNCONFIGURED');

  // 5. POST /api/v1/auth/logout clears session
  const logoutRes = await fetch(`${baseUrl}/api/v1/auth/logout`, {
    method: 'POST',
    headers: {
      cookie: `nanolabs_admin_session=${sessionToken}`,
      'x-csrf-token': setupData.csrfToken,
    },
  });
  assert.equal(logoutRes.status, 200);

  // 6. Request after logout is now unauthenticated
  const statusResAfter = await fetch(`${baseUrl}/api/v1/auth/status`, {
    headers: { cookie: `nanolabs_admin_session=${sessionToken}` },
  });
  const statusDataAfter: any = await statusResAfter.json();
  assert.equal(statusDataAfter.authenticated, false);

  await server.stop();
  db.close();
});
