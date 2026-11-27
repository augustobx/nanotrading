import { describe, it } from 'node:test';
import assert from 'node:assert';
import { AlgorithmicWatcher } from '../../src/engine/algorithmic-watcher.js';
import { ScenarioRegistry } from '../../src/engine/scenario-registry.js';
import { DatabaseService } from '../../src/storage/database.js';
import { Scenario } from '../../src/ai/scenario-types.js';

describe('Observación Independiente: Comportamiento de WAITING_CONFIRMATION ante recuperación de presupuesto', () => {
  const db = new DatabaseService(':memory:');
  const mockCoordinator: any = {
    on: () => {},
    emit: () => {},
    getSetupEngine: () => ({
      getAnalysis: () => ({ rsi: 50, structure: { structureBreaks: [], sweeps: [] } }),
    }),
    getCandleManager: () => ({
      getCandles: () => [],
      getLastClosedCandle: () => null,
    }),
    getDiscoveryScheduler: () => ({
      triggerDiscovery: () => {},
    }),
    getMarketState: () => ({
      wsConnected: true,
      ticker: { lastPrice: 50500, spreadPcnt: 0.0001 },
    }),
  };

  it('Reproducción: Un escenario en WAITING_CONFIRMATION no reanuda vigilancia por ticks al recuperarse el presupuesto', () => {
    const registry = new ScenarioRegistry(db);
    const watcher = new AlgorithmicWatcher(mockCoordinator, registry);

    const now = Date.now();
    const scenario: Scenario = {
      id: 'sc_test_waiting_budget',
      symbol: 'BTCUSDT',
      direction: 'SHORT',
      kind: 'TRADE_SCENARIO',
      timeframe: '15m',
      structureType: 'TREND_CONTINUATION',
      proposedBy: 'CONSENSUS',
      modelsUsed: ['gpt-4o', 'gemini-2.5-flash'],
      snapshotId: 'snap_1',
      discoveryTimestamp: now - 20 * 60000,
      entryZoneMin: 50400,
      entryZoneMax: 50600,
      targetEntry: 50500,
      stopLossPrice: 50800,
      target12Price: 49900,
      target14Price: 49300,
      netRR12: 2.0,
      netRR14: 4.0,
      rrModeAvailable: 'RR_BOTH',
      uncertaintyLevel: 'LOW',
      status: 'SCENARIO_REGISTERED',
      validUntilTimestamp: now + 6 * 3600000,
      aiCostUsd: 0.001,
      activationConditions: [],
      invalidationTriggers: [],
      argumentsFor: [],
      argumentsAgainst: [],
      watchPlan: {
        id: 'wp_test_1',
        scenarioId: 'sc_test_waiting_budget',
        symbol: 'BTCUSDT',
        direction: 'SHORT',
        horizon: 'INTRADAY',
        primaryTimeframe: '15m',
        watchZone: { minPrice: 50400, maxPrice: 50600, targetEntry: 50500 },
        candidateStopLoss: 50800,
        candidateTakeProfits: { tp12: 49900, tp14: 49300 },
        rrEligibility: 'RR_BOTH',
        observableConditions: [],
        confirmationSequence: [],
        invalidationConditions: [],
        expirationTimestamp: now + 6 * 3600000,
        reevaluationTriggers: [],
        reasoningVersion: 'v1',
        status: 'ACTIVE',
        automatable: true,
        createdAt: now,
        updatedAt: now,
      },
    };

    registry.registerScenario(scenario);

    // 1. Simulación: El escenario pasa a WAITING_CONFIRMATION por agotamiento de cuota de IA
    registry.transitionStatus(
      scenario.id,
      'WAITING_CONFIRMATION',
      'Presupuesto insuficiente para reevaluación dual',
      { currentPrice: 50500 }
    );
    assert.strictEqual(registry.getScenario(scenario.id)?.status, 'WAITING_CONFIRMATION');

    // 2. Simulación: El presupuesto se recupera (ej. reinicio de cuota diaria o adición de saldo)
    // Se reciben múltiples ticks de mercado en tiempo real exactamente dentro de la zona operativa (50500)
    let revalidationRequestedEmitted = false;
    watcher.on('revalidation_requested', () => {
      revalidationRequestedEmitted = true;
    });

    watcher.evaluateTick(50500);
    watcher.evaluateTick(50510);
    watcher.evaluateTick(50490);

    // Evidencia de reproducción:
    // evaluateTick omite deliberadamente los escenarios en WAITING_CONFIRMATION (línea 204 de algorithmic-watcher.ts).
    // Por lo tanto, ningún tick reactiva la revalidación aunque el presupuesto esté 100% disponible.
    assert.strictEqual(
      registry.getScenario(scenario.id)?.status,
      'WAITING_CONFIRMATION',
      'El escenario permanece estancado en WAITING_CONFIRMATION frente a ticks en zona'
    );
    assert.strictEqual(
      revalidationRequestedEmitted,
      false,
      'No se emite solicitud de reevaluación por ticks de mercado'
    );

    // 3. Simulación: Llega una vela confirmada de 15m antes de transcurrir los 30 minutos de cooldown
    const earlyCandle = {
      open: 50520,
      high: 50580,
      low: 50480,
      close: 50500, // Cierra dentro de zona
      timeframe: '15m',
      confirmed: true,
      timestamp: now - 16 * 60000, // Cerró hace 1 minuto; cooldown todavía inferior a 30 min
    };

    watcher.evaluateCandleClose(earlyCandle);
    assert.strictEqual(
      registry.getScenario(scenario.id)?.status,
      'WAITING_CONFIRMATION',
      'Debe permanecer en WAITING_CONFIRMATION porque no pasaron los 30 min de cooldown'
    );
    assert.strictEqual(revalidationRequestedEmitted, false);

    // 4. Simulación: Pasan los 30 minutos de cooldown, pero la vela de 15m cierra fuera de la zona (ej. 50650)
    // aunque la mecha llegó a 50500
    const targetSc = registry.getScenario(scenario.id)!;
    targetSc.lastRevalidationTimestamp = Date.now() - 35 * 60000;
    targetSc.discoveryTimestamp = Date.now() - 35 * 60000;
    const outOfZoneCandle = {
      open: 50500,
      high: 50680,
      low: 50480, // Mitigó la zona con la mecha
      close: 50650, // Cerró fuera de [50400, 50600]
      timeframe: '15m',
      confirmed: true,
      timestamp: now - 16 * 60000, // Vela realmente cerrada, cooldown superado
    };

    watcher.evaluateCandleClose(outOfZoneCandle);
    assert.strictEqual(
      registry.getScenario(scenario.id)?.status,
      'WAITING_CONFIRMATION',
      'Debe permanecer en WAITING_CONFIRMATION porque el cierre de vela estuvo fuera de zona'
    );
    assert.strictEqual(revalidationRequestedEmitted, false);

    // 5. Simulación: Pasan 35 minutos de tiempo real (cooldown superado en wall clock) y llega vela cerrada en zona
    // El cooldown ya fue superado en el paso anterior; ahora llega un cierre posterior en zona.

    const qualifyingCandle = {
      open: 50550,
      high: 50580,
      low: 50480,
      close: 50510, // Cierra dentro de zona
      timeframe: '15m',
      confirmed: true,
      timestamp: Date.now() - 15 * 60000,
    };

    watcher.evaluateCandleClose(qualifyingCandle);
    assert.strictEqual(
      registry.getScenario(scenario.id)?.status,
      'REVALIDATION_REQUESTED',
      'Únicamente se reactiva ante vela cerrada de 15m en zona tras cooldown de 30m'
    );
    assert.strictEqual(revalidationRequestedEmitted, true);
  });
});
