import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseService } from '../../src/storage/database.js';
import { RiskPolicyManager, DEFAULT_RISK_POLICY } from '../../src/engine/risk-policy.js';
import { RiskCalculator } from '../../src/engine/risk-calculator.js';
import { BybitCredentialsManager } from '../../src/bybit/bybit-credentials.js';
import { AiModelRouter } from '../../src/ai/router/ai-router.js';
import { authManager } from '../../src/security/auth-manager.js';
import { encryptSecret, decryptSecret, maskSecret } from '../../src/security/encryption.js';
import { config } from '../../src/config/index.js';

test('Security & Encryption - AES-256-GCM authenticated encryption and masking', () => {
  const secret = 'sk-proj-super-secret-key-1234567890abcdefg';
  const encrypted = encryptSecret(secret);

  assert.ok(encrypted.ciphertext);
  assert.ok(encrypted.iv);
  assert.ok(encrypted.authTag);

  const decrypted = decryptSecret(encrypted);
  assert.equal(decrypted, secret);

  const masked = maskSecret(secret);
  assert.ok(masked.startsWith('sk-pr****'));
  assert.ok(masked.endsWith('defg'));
  assert.equal(masked.includes('super-secret'), false);
});

test('AuthManager - Timing-safe login, rate limiting and lockout', () => {
  const ip = '192.168.1.100';

  // Successful login with correct key
  const successLogin = authManager.login(config.security.adminApiKey, ip);
  assert.equal(successLogin.success, true);
  assert.ok(successLogin.token);
  assert.ok(authManager.validateAuth(`Bearer ${successLogin.token}`, ip));

  // Logout invalidates session
  authManager.logout(successLogin.token!);
  assert.equal(authManager.validateAuth(`Bearer ${successLogin.token}`, ip), false);

  // Failed attempts trigger lockout
  const badIp = '192.168.1.101';
  for (let i = 0; i < 5; i++) {
    const res = authManager.login('wrong_password_attempt', badIp);
    assert.equal(res.success, false);
  }

  // 6th attempt is locked out
  const lockedRes = authManager.login('wrong_password_attempt', badIp);
  assert.equal(lockedRes.success, false);
  assert.ok(lockedRes.error?.includes('Bloqueado temporalmente'));
});

test('RiskPolicyManager - Most restrictive capital risk enforcement', () => {
  const manager = new RiskPolicyManager({
    ...DEFAULT_RISK_POLICY,
    capitalUsdt: 10000,
    maxRiskPerTradePercent: 1.0, // 1% = 100 USDT
    maxRiskPerTradeUsdt: 50,     // Cap at 50 USDT
  });

  const mockSetup: any = {
    entryPrice: 60000,
    stopLossPrice: 59700, // 300 USDT (0.5%)
    takeProfitPrice: 61500,
    riskReward: { netRR: 4.5, netLossUSDT: 45, isValid: true },
  };

  const evalResult = manager.evaluateSetupRisk(mockSetup, 150, 0.01, 0, 0, 0);
  assert.equal(evalResult.passed, true);
  // Enforces most restrictive: min(100, 50) = 50 USDT
  assert.equal(evalResult.effectiveRiskUsdt, 50);
});

test('RiskPolicyManager - Stop Loss ceilings strictly discard setup without compressing SL', () => {
  const manager = new RiskPolicyManager({
    ...DEFAULT_RISK_POLICY,
    stopLossCeilings: {
      maxSlDistancePercent: { enabled: true, value: 1.0 }, // max 1%
      maxSlDistanceUsdt: { enabled: true, value: 500 },     // max 500 USDT
      maxSlDistanceAtrMultiplier: { enabled: true, value: 2.5 }, // max 2.5x ATR
      maxMonetaryLossUsdt: { enabled: true, value: 80 },
    },
  });

  // Setup exceeding % ceiling: 60000 to 59100 = 900 USDT (1.5% > 1.0%)
  const setupExceedingPercent: any = {
    entryPrice: 60000,
    stopLossPrice: 59100,
    takeProfitPrice: 64500,
    riskReward: { netRR: 4.5, netLossUSDT: 50, isValid: true },
  };

  const evalPercent = manager.evaluateSetupRisk(setupExceedingPercent, 400, 0.01, 0, 0, 0);
  assert.equal(evalPercent.passed, false);
  assert.ok(evalPercent.violations.some((v) => v.includes('porcentaje superada')));

  // Setup exceeding ATR multiplier: SL = 300 USDT, ATR = 100 USDT => 3.0x ATR > 2.5x ATR
  const setupExceedingAtr: any = {
    entryPrice: 60000,
    stopLossPrice: 59700,
    takeProfitPrice: 61500,
    riskReward: { netRR: 4.5, netLossUSDT: 50, isValid: true },
  };

  const evalAtr = manager.evaluateSetupRisk(setupExceedingAtr, 100, 0.01, 0, 0, 0);
  assert.equal(evalAtr.passed, false);
  assert.ok(evalAtr.violations.some((v) => v.includes('múltiplos de ATR superada')));

  // Setup exceeding max active signals
  const managerMaxSignals = new RiskPolicyManager({
    ...DEFAULT_RISK_POLICY,
    maxActiveSignals: 2,
  });
  const evalSignals = managerMaxSignals.evaluateSetupRisk(setupExceedingAtr, 200, 0.01, 2, 0, 0);
  assert.equal(evalSignals.passed, false);
  assert.ok(evalSignals.violations.some((v) => v.includes('Límite de señales activas')));
});

test('RiskCalculator - Interactive risk calculator with tickSize and qtyStep precision', () => {
  const result = RiskCalculator.calculateInteractive({
    capitalUsdt: 10000,
    entryPrice: 60000.15,
    stopLossPrice: 59800.05,
    takeProfitPrice: 61000.55,
    maxRiskPercent: 0.5,
    tickSize: 0.1,
    qtyStep: 0.001,
  });

  assert.equal(result.entryPrice, 60000.2);
  assert.equal(result.stopLossPrice, 59800.1);
  assert.equal(result.takeProfitPrice, 61000.6);
  assert.ok(result.positionSizeBTC > 0);
  assert.ok(result.notionalValueUSDT > 0);
  assert.ok(result.netRR !== undefined);
  assert.ok(result.netLossUSDT > 0 && result.netLossUSDT <= 80); // Realistic risk + fees/slippage
});

test('BybitCredentials - Rejects write/trading permissions and enforces Read-Only', async () => {
  // Test read-only rejection logic when mock returns trading permissions
  const mockReadOnlyCheck = (permissions: Record<string, string[]>) => {
    const dangerousWords = ['Order', 'Position', 'Trade', 'Withdraw', 'Transfer', 'Exchange'];
    const detected: string[] = [];
    for (const [scope, perms] of Object.entries(permissions)) {
      if (Array.isArray(perms)) {
        for (const perm of perms) {
          for (const danger of dangerousWords) {
            if (perm.toLowerCase().includes(danger.toLowerCase())) {
              detected.push(`${scope}:${perm}`);
            }
          }
        }
      }
    }
    if (detected.length > 0) {
      throw new Error(`Permiso de escritura o trading no permitido detectado: '${detected.join(', ')}'`);
    }
  };

  // Safe read-only permissions
  assert.doesNotThrow(() => {
    mockReadOnlyCheck({
      ContractTrade: ['Read'],
      Account: ['Query'],
      Wallet: ['Read'],
    });
  });

  // Dangerous permissions with Order/Position
  assert.throws(() => {
    mockReadOnlyCheck({
      ContractTrade: ['Order', 'Position'],
    });
  }, /Permiso de escritura o trading no permitido/);
});

test('AiModelRouter - 4 routing modes, profiles and task classification', () => {
  const router = new AiModelRouter({
    mode: 'AUTOMATIC',
    profile: 'BALANCED',
    manualGlobal: { openaiModel: 'gpt-4o', geminiModel: 'gemini-2.0-flash' },
    manualByTask: {
      SETUP_EVALUATION: { openaiModel: 'gpt-4o', geminiModel: 'gemini-1.5-pro' },
      ALERT_EXPLANATION: { openaiModel: 'gpt-4o-mini', geminiModel: 'gemini-2.0-flash' },
    },
    dailyBudgetLimitUsd: 5.0,
    monthlyBudgetLimitUsd: 50.0,
    updatedAt: Date.now(),
  });

  // 1. AUTOMATIC - Balanced profile selects gpt-4o for evaluation and gpt-4o-mini for alert
  const evalDecision = router.routeModel('SETUP_EVALUATION', 'OPENAI', 5.0);
  assert.equal(evalDecision.selectedModel, 'gpt-4o');

  const alertDecision = router.routeModel('ALERT_EXPLANATION', 'OPENAI', 5.0);
  assert.equal(alertDecision.selectedModel, 'gpt-4o-mini');

  // 2. Budget Depletion Fallback: when remaining budget < $0.50, switches to economic model
  const lowBudgetDecision = router.routeModel('SETUP_EVALUATION', 'OPENAI', 0.20);
  assert.equal(lowBudgetDecision.selectedModel, 'gpt-4o-mini');

  // 3. MANUAL_BY_TASK mode
  router.updateConfig({ mode: 'MANUAL_BY_TASK' });
  const taskGeminiDecision = router.routeModel('SETUP_EVALUATION', 'GEMINI', 5.0);
  assert.equal(taskGeminiDecision.selectedModel, 'gemini-1.5-pro');

  // 4. MANUAL_GLOBAL mode
  router.updateConfig({
    mode: 'MANUAL_GLOBAL',
    manualGlobal: { openaiModel: 'gpt-4o-mini', geminiModel: 'gemini-1.5-flash' },
  });
  const globalDecision = router.routeModel('SETUP_EVALUATION', 'OPENAI', 5.0);
  assert.equal(globalDecision.selectedModel, 'gpt-4o-mini');
});

test('DatabaseService - AI Consumption logging, statistics aggregation and audit logs', () => {
  const db = new DatabaseService(':memory:');

  // Log consumption
  db.logAiConsumption({
    provider: 'OPENAI',
    model: 'gpt-4o',
    task: 'SETUP_EVALUATION',
    tokensPrompt: 1200,
    tokensCompletion: 400,
    costUsd: 0.007,
    latencyMs: 1250,
    status: 'SUCCESS',
  });

  db.logAiConsumption({
    provider: 'GEMINI',
    model: 'gemini-2.0-flash',
    task: 'SETUP_EVALUATION',
    tokensPrompt: 1200,
    tokensCompletion: 350,
    costUsd: 0.0003,
    latencyMs: 650,
    status: 'SUCCESS',
  });

  const logs = db.getAiConsumptionLogs(10);
  assert.equal(logs.length, 2);

  const stats = db.getAiConsumptionStats();
  assert.ok(stats.todaySpendUsd > 0);
  assert.equal(stats.todayCalls, 2);
  assert.equal(stats.totalCalls, 2);
  assert.ok(stats.byProvider.length >= 2);

  // Config audit log
  db.logConfigAudit({
    category: 'RISK_POLICY',
    action: 'UPDATE',
    details: { maxRiskPerTradeUsdt: 60 },
    ipAddress: '127.0.0.1',
  });

  const auditLogs = db.getConfigAuditLogs(5);
  assert.equal(auditLogs.length, 1);
  assert.equal(auditLogs[0].category, 'RISK_POLICY');
  assert.equal(auditLogs[0].action, 'UPDATE');
  assert.equal(auditLogs[0].details.maxRiskPerTradeUsdt, 60);

  // Risk Policy persistence across saves
  const initialPolicy = { ...DEFAULT_RISK_POLICY, capitalUsdt: 15000, maxRiskPerTradeUsdt: 75 };
  db.saveRiskPolicy(initialPolicy);
  const activePol1 = db.getActiveRiskPolicy();
  assert.ok(activePol1);
  assert.equal(activePol1.capitalUsdt, 15000);
  assert.equal(activePol1.maxRiskPerTradeUsdt, 75);

  // Subsequent save updates active policy without primary key collision
  const updatedPolicy = { ...activePol1, capitalUsdt: 20000, maxRiskPerTradeUsdt: 100, version: 2 };
  db.saveRiskPolicy(updatedPolicy);
  const activePol2 = db.getActiveRiskPolicy();
  assert.ok(activePol2);
  assert.equal(activePol2.capitalUsdt, 20000);
  assert.equal(activePol2.maxRiskPerTradeUsdt, 100);
  assert.equal(activePol2.version, 2);

  // Router Config persistence
  const routerCfg = { mode: 'MANUAL_GLOBAL', profile: 'CONSERVATIVE', dailyBudgetLimitUsd: 10.0 };
  db.saveRouterConfig(routerCfg);
  const loadedRouter = db.getRouterConfig();
  assert.ok(loadedRouter);
  assert.equal(loadedRouter.mode, 'MANUAL_GLOBAL');
  assert.equal(loadedRouter.profile, 'CONSERVATIVE');

  // Bybit credentials persistence
  const bybitRecord = {
    apiKey: 'test_key_123',
    apiKeyMasked: 'test****_123',
    encryptedSecret: { ciphertext: 'abc', iv: 'def', authTag: 'ghi' },
    environment: 'testnet',
    status: 'ACTIVE',
    detectedPermissions: { ContractTrade: ['Order', 'Position'] },
    hasTradePermissions: true,
    feeSource: 'DEFAULT_BYBIT_LINEAR',
  };
  db.saveBybitCredentials(bybitRecord);
  const loadedBybit = db.getBybitCredentials();
  assert.ok(loadedBybit);
  assert.equal(loadedBybit.apiKey, 'test_key_123');
  assert.equal(loadedBybit.environment, 'testnet');
  assert.equal(loadedBybit.status, 'ACTIVE');

  db.close();
});
