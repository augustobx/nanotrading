import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { RiskCalculator } from '../../src/engine/risk-calculator.js';
import { DatabaseService } from '../../src/storage/database.js';
import { SignalStateMachine } from '../../src/engine/signal-state-machine.js';
import { ScenarioRegistry } from '../../src/engine/scenario-registry.js';
import { HardBudgetManager } from '../../src/ai/hard-budget-manager.js';
import { AutonomousDiscoveryScheduler } from '../../src/ai/autonomous-discovery-scheduler.js';
import { Scenario } from '../../src/ai/scenario-types.js';

function createTestDb(): { db: DatabaseService; cleanup: () => void } {
  const testDbPath = path.join(process.cwd(), `backend/data/test_fase5c_${Date.now()}_${Math.random().toString(36).substring(7)}.db`);
  const db = new DatabaseService(testDbPath);
  const cleanup = () => {
    try {
      db.close();
      if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
      const wal = `${testDbPath}-wal`;
      const shm = `${testDbPath}-shm`;
      if (fs.existsSync(wal)) fs.unlinkSync(wal);
      if (fs.existsSync(shm)) fs.unlinkSync(shm);
    } catch {}
  };
  return { db, cleanup };
}

// 1. Distinción real entre 1:2 y 1:4 cuando existen niveles intermedios
test('Fase 5C - Distinción objetiva entre 1:2 y 1:4 con niveles estructurales independientes', () => {
  const entryPrice = 80000;
  const stopLossPrice = 79500; // riesgo de $500
  const candidateTargets = [81400, 82500]; // 81400 (~2.19R), 82500 (~4.01R)

  const result = RiskCalculator.calculateDualTargets({
    direction: 'LONG',
    entryPrice,
    stopLossPrice,
    candidateTargets,
    accountBalance: 10000,
    riskPercent: 1.0,
    feeStructure: { makerFeeRate: 0.0002, takerFeeRate: 0.00055 },
    spread: 0.1,
    slippageRate: 0.0002,
    minRRShort: 2.0,
    minRRExtended: 4.0,
  });

  assert.equal(result.qualifiedMode, 'RR_BOTH');
  assert.equal(result.target12Price, 81400);
  assert.equal(result.target14Price, 82500);
  assert.ok(result.calculation12 && result.calculation12.netRR >= 2.0);
  assert.ok(result.calculation12 && result.calculation12.netRR < 4.0);
  assert.ok(result.calculation14 && result.calculation14.netRR >= 4.0);
  assert.notEqual(result.target12Price, result.target14Price);
});

// 2. Unicidad de objetivo cuando solo existe swing mayor
test('Fase 5C - Identifica objetivo único cuando solo existe un nivel que supera 4.0R', () => {
  const entryPrice = 80000;
  const stopLossPrice = 79500;
  const candidateTargets = [82500]; // Único nivel disponible a ~4.01R

  const result = RiskCalculator.calculateDualTargets({
    direction: 'LONG',
    entryPrice,
    stopLossPrice,
    candidateTargets,
    accountBalance: 10000,
    riskPercent: 1.0,
    feeStructure: { makerFeeRate: 0.0002, takerFeeRate: 0.00055 },
    spread: 0.1,
    slippageRate: 0.0002,
    minRRShort: 2.0,
    minRRExtended: 4.0,
  });

  assert.equal(result.qualifiedMode, 'RR_BOTH');
  assert.equal(result.target12Price, 82500);
  assert.equal(result.target14Price, 82500);
  assert.equal(result.target12Price, result.target14Price);
});

// 3. Exclusión de objetivos sin respaldo estructural
test('Fase 5C - Rechaza 1:4 si ningún nivel estructural alcanza 4.0R neto', () => {
  const entryPrice = 80000;
  const stopLossPrice = 79500;
  const candidateTargets = [81400]; // Solo alcanza ~2.19R

  const result = RiskCalculator.calculateDualTargets({
    direction: 'LONG',
    entryPrice,
    stopLossPrice,
    candidateTargets,
    accountBalance: 10000,
    riskPercent: 1.0,
    feeStructure: { makerFeeRate: 0.0002, takerFeeRate: 0.00055 },
    spread: 0.1,
    slippageRate: 0.0002,
    minRRShort: 2.0,
    minRRExtended: 4.0,
  });

  assert.equal(result.qualifiedMode, 'RR_1_2');
  assert.equal(result.target12Price, 81400);
  assert.equal(result.target14Price, undefined);
  assert.equal(result.calculation14, undefined);
});

// 4. Sizing de riesgo en Stop Loss ultra-estrecho (evita el apalancamiento excesivo)
test('Fase 5C - Limita el apalancamiento a 5x y contempla comisiones completas ante SL ajustado de $3.40', () => {
  const entryPrice = 78896.1;
  const stopLossPrice = 78892.7; // Distancia ultra-ajustada: $3.40 USDT
  const targetRiskUSDT = 100;
  const accountBalance = 10000;

  const calc = RiskCalculator.calculate({
    direction: 'LONG',
    entryPrice,
    stopLossPrice,
    takeProfitPrice: 80000,
    accountBalance,
    riskPercent: 1.0,
    feeStructure: { makerFeeRate: 0.0002, takerFeeRate: 0.00055 },
    spread: 0.1,
    slippageRate: 0.0002,
    minRequiredRR: 0.1,
  });

  const notional = calc.positionSizeBTC * entryPrice;
  const leverage = notional / accountBalance;

  assert.ok(leverage <= 5.05, `Leverage ${leverage} must be <= 5.05x`);
  assert.ok(calc.netLossUSDT <= targetRiskUSDT * 1.05, `netLossUSDT ${calc.netLossUSDT} must be <= 105`);
  assert.ok(calc.positionSizeBTC < 1.0, `positionSizeBTC ${calc.positionSizeBTC} must be < 1.0`);
});

// 5. Invariante canónico de 1R: netLossUSDT === 1R real
test('Fase 5C - Cumple que la recompensa neta y riesgo neto conservan invariante de signos estrictos', () => {
  const calc = RiskCalculator.calculate({
    direction: 'SHORT',
    entryPrice: 80000,
    stopLossPrice: 80800,
    takeProfitPrice: 76000,
    accountBalance: 10000,
    riskPercent: 1.0,
    feeStructure: { makerFeeRate: 0.0002, takerFeeRate: 0.00055 },
    spread: 0.1,
    slippageRate: 0.0002,
    minRequiredRR: 2.0,
  });

  assert.equal(calc.isValid, true);
  assert.ok(calc.netLossUSDT > 0);
  assert.ok(calc.grossRewardUSDT > 0);
  assert.ok(calc.netRewardUSDT > 0);
  assert.ok(calc.netRR >= 4.0);
});

// 6. Registro formal de escenario NEUTRAL ("no operar es una decisión válida")
test('Fase 5C - Registra formalmente un escenario NEUTRAL sin permitir órdenes operativas', () => {
  const { db, cleanup } = createTestDb();
  try {
    const registry = new ScenarioRegistry(db);
    const neutralScenario: Scenario = {
      id: `sc_test_neutral_${Date.now()}`,
      symbol: 'BTCUSDT',
      direction: 'NEUTRAL',
      timeframe: '15m',
      structureType: 'RANGING_NO_CONFLUENCE',
      proposedBy: 'CONSENSUS',
      modelsUsed: ['gpt-4o', 'gemini-2.0-flash'],
      snapshotId: 'snap_test_1',
      discoveryTimestamp: Date.now(),
      entryZoneMin: 80000,
      entryZoneMax: 80000,
      targetEntry: 80000,
      stopLossPrice: 80000,
      rrModeAvailable: 'NONE',
      uncertaintyLevel: 'HIGH',
      status: 'NO_TRADE_OBSERVATION',
      validUntilTimestamp: Date.now() + 3600000,
      aiCostUsd: 0.001,
      activationConditions: ['Esperar desplazamiento limpio'],
      invalidationTriggers: ['Ruptura de rango con volumen'],
      argumentsFor: ['No operar es una decisión válida y a menudo la mejor'],
      argumentsAgainst: ['Riesgo/beneficio asimétrico desfavorable'],
      rejectionReason: 'Conclusión formal de IA: ESPERAR',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    registry.registerScenario(neutralScenario);
    const retrieved = registry.getScenario(neutralScenario.id);
    assert.ok(retrieved !== null);
    assert.equal(retrieved?.direction, 'NEUTRAL');
    assert.equal(retrieved?.status, 'NO_TRADE_OBSERVATION');
  } finally {
    cleanup();
  }
});

// 7. Ciclo completo: Registro de Señal Paper Trading desde Escenario Validado
test('Fase 5C - Registra y transiciona a TRACKING un Paper Trade generado desde un escenario validado', () => {
  const { db, cleanup } = createTestDb();
  try {
    const stateMachine = new SignalStateMachine(db);

    const scenario: Scenario = {
      id: `sc_paper_test_${Date.now()}`,
      symbol: 'BTCUSDT',
      direction: 'LONG',
      timeframe: '15m',
      structureType: 'BOS_FVG_CONFLUENCE',
      proposedBy: 'CONSENSUS',
      modelsUsed: ['gpt-4o', 'gemini-2.0-flash'],
      snapshotId: 'snap_paper_1',
      discoveryTimestamp: Date.now(),
      entryZoneMin: 79900,
      entryZoneMax: 80100,
      targetEntry: 80000,
      stopLossPrice: 79500,
      target12Price: 81100,
      target14Price: 82500,
      netRR12: 2.1,
      netRR14: 4.8,
      rrModeAvailable: 'RR_BOTH',
      uncertaintyLevel: 'LOW',
      status: 'ENTRY_VALIDATED',
      validUntilTimestamp: Date.now() + 3600000,
      aiCostUsd: 0.002,
      activationConditions: [],
      invalidationTriggers: [],
      argumentsFor: [],
      argumentsAgainst: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const paperSignal12 = stateMachine.registerSignalFromScenario(
      scenario,
      80000,
      'RR_1_2',
      81100,
      2.1,
      50,
      0.08
    );

    assert.ok(paperSignal12 !== undefined);
    assert.equal(paperSignal12.id, `sig_${scenario.id}_RR_1_2`);
    assert.equal(paperSignal12.state, 'ENTRY_VALIDATED');
    assert.equal(paperSignal12.entryMode, 'EMITTED_SIGNAL');
    stateMachine.transition(paperSignal12.id, 'ENTRY_TRIGGERED', 'Precio de entrada observado');
    stateMachine.transition(paperSignal12.id, 'TRACKING', 'Seguimiento paper');
    assert.equal(paperSignal12.entryMode, 'SIMULATED_PAPER_ENTRY');
    assert.equal(paperSignal12.entryPrice, 80000);
    assert.equal(paperSignal12.takeProfitPrice, 81100);

    // Simular avance de precio favorable
    stateMachine.updatePriceMetrics(paperSignal12.id, 80600);
    const active = stateMachine.getActiveSignals().find((s) => s.id === paperSignal12.id);
    assert.equal(active?.mfePrice, 80600);
    assert.ok(active && active.mfeR > 1.0);

    // Simular Take Profit alcanzado
    stateMachine.transition(paperSignal12.id, 'COMPLETED_TP', 'Take Profit alcanzado en precio real');
    assert.equal(paperSignal12.state, 'COMPLETED_TP');
    assert.ok((paperSignal12.realizedNetR || 0) > 1);
    assert.ok((paperSignal12.realizedNetPnlUsdt || 0) > 0);
    assert.ok((paperSignal12.realizedNetPnlUsdt || 0) < (81100 - 80000) * 0.08);
    assert.equal(paperSignal12.riskUsdt, 50);
  } finally {
    cleanup();
  }
});

// 8. HardBudgetManager bloquea llamadas del Scheduler si presupuesto está agotado
test('Fase 5C - Omite la ejecución autónoma si el HardBudgetManager se encuentra bloqueado', async () => {
  const { db, cleanup } = createTestDb();
  try {
    const budgetManager = new HardBudgetManager(
      {
        dailyBudgetLimitUsd: 0.05,
        monthlyBudgetLimitUsd: 1.0,
        perScenarioLimitUsd: 0.02,
        hardStopAction: 'HALT_AI_FALLBACK_TECHNICAL',
        alertThresholdPercent: 80,
        isBlocked: true,
        blockedReason: 'Límite diario de presupuesto alcanzado en simulación',
      },
      undefined,
      db
    );

    assert.equal(budgetManager.isBlocked(), true);

    const mockCoordinator: any = {
      on: () => {},
      off: () => {},
      getMarketState: () => ({ ticker: { lastPrice: 80000 } }),
    };

    const mockDiscoveryEngine: any = {
      runDiscovery: async () => ({ scenarios: [] }),
    };

    const scheduler = new AutonomousDiscoveryScheduler({
      coordinator: mockCoordinator,
      discoveryEngine: mockDiscoveryEngine,
      hardBudgetManager: budgetManager,
      db,
    });

    const triggered = await scheduler.triggerDiscovery('SCHEDULED_TEST', 80000);
    assert.equal(triggered, false);
  } finally {
    cleanup();
  }
});
