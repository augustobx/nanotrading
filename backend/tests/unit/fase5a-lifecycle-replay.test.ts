import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseService } from '../../src/storage/database.js';
import { ScenarioRegistry } from '../../src/engine/scenario-registry.js';
import { AlgorithmicWatcher } from '../../src/engine/algorithmic-watcher.js';
import { AiEntryRevalidation } from '../../src/ai/ai-revalidation.js';
import { HardBudgetManager } from '../../src/ai/hard-budget-manager.js';
import { OpenAiAdapter } from '../../src/ai/openai-adapter.js';
import { GeminiAdapter } from '../../src/ai/gemini-adapter.js';
import { Scenario } from '../../src/ai/scenario-types.js';
import { EventEmitter } from 'events';

class MockCoordinator extends EventEmitter {
  private marketState: any = {
    symbol: 'BTCUSDT',
    ticker: { lastPrice: 65000, spreadPcnt: 0.001 },
  };

  public getMarketState() {
    return this.marketState;
  }

  public setPrice(price: number) {
    this.marketState.ticker.lastPrice = price;
    this.emit('state_updated', this.marketState);
  }
}

test('Fase 5A — Lifecycle Replay Completo: Registro -> Aproximación -> In-Zone -> Reevaluación -> Señal Validada', async () => {
  const db = new DatabaseService(':memory:');
  const registry = new ScenarioRegistry(db);
  const coordinator = new MockCoordinator() as any;

  const budgetManager = new HardBudgetManager({
    dailyBudgetLimitUsd: 10,
    monthlyBudgetLimitUsd: 100,
    maxCostPerRequestUsd: 1,
  }, undefined, db);

  const openaiAdapter = new OpenAiAdapter({ apiKey: 'mock', model: 'gpt-4o' });
  const geminiAdapter = new GeminiAdapter({ apiKey: 'mock', model: 'gemini-2.0-flash' });

  const revalidation = new AiEntryRevalidation({
    coordinator,
    openaiAdapter,
    geminiAdapter,
    hardBudgetManager: budgetManager,
    scenarioRegistry: registry,
    db,
  });

  const watcher = new AlgorithmicWatcher(
    coordinator,
    registry,
    undefined,
    undefined,
    { approachThresholdPct: 0.5 }
  );

  let revalRequestedCount = 0;
  watcher.on('revalidation_requested', async ({ scenario, currentPrice }) => {
    revalRequestedCount++;
    await revalidation.revalidate(scenario, currentPrice);
  });

  // 1. Registrar Escenario LONG (Entrada 64500, SL 64000, TP12 65600, TP14 66600)
  const scenario: Scenario = {
    id: 'scen_replay_long_1',
    symbol: 'BTCUSDT',
    direction: 'LONG',
    timeframe: '15m',
    structureType: 'ORDER_BLOCK_MITIGATION',
    proposedBy: 'CONSENSUS',
    modelsUsed: ['gpt-4o', 'gemini-2.0-flash'],
    snapshotId: 'snap_test_1',
    discoveryTimestamp: Date.now(),
    entryZoneMin: 64400,
    entryZoneMax: 64600,
    targetEntry: 64500,
    stopLossPrice: 64000,
    target12Price: 65800,
    target14Price: 66800,
    netRR12: 2.15,
    netRR14: 4.12,
    rrModeAvailable: 'RR_BOTH',
    uncertaintyLevel: 'LOW',
    status: 'SCENARIO_REGISTERED',
    validUntilTimestamp: Date.now() + 3600000,
    aiCostUsd: 0.002,
    activationConditions: ['Mitigación limpia'],
    invalidationTriggers: ['Ruptura de 64000'],
    argumentsFor: ['Soporte 4H y FVG 15m'],
    argumentsAgainst: ['Posible absorción'],
    distanceToZonePct: 1.5,
    currentPrice: 65500,
    lastCheckedTimestamp: Date.now(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  registry.registerScenario(scenario);
  assert.equal(registry.getAllActive().length, 1);
  assert.equal(registry.getScenario('scen_replay_long_1')?.status, 'SCENARIO_REGISTERED');

  watcher.start();

  // 2. Replay tick: Precio se acerca a 64700 (distancia = (64700 - 64600)/64700 = 0.15% <= 0.5% umbral)
  coordinator.setPrice(64700);
  const scenApproaching = registry.getScenario('scen_replay_long_1');
  assert.equal(scenApproaching?.status, 'APPROACHING_ZONE', 'Debe transicionar a APPROACHING_ZONE al entrar en umbral');

  // Configurar mock evaluator de reevaluación para dar APPROVE unánime
  revalidation.setMockEvaluator((sc, price) => ({
    openaiVerdict: 'APPROVE',
    geminiVerdict: 'APPROVE',
    reasoning: 'Entrada limpia con absorción confirmada en 64500',
  }));

  // 3. Replay tick: Precio entra a la zona operativa (64520)
  coordinator.setPrice(64520);

  // Comprobar que watcher detectó IN_ZONE y disparó reevaluación
  assert.equal(revalRequestedCount, 1, 'Debe haber disparado exactamente 1 solicitud de reevaluación');
  const scenValidated = registry.getScenario('scen_replay_long_1');
  assert.equal(scenValidated?.status, 'ENTRY_VALIDATED', 'Debe haber culminado en ENTRY_VALIDATED tras aprobación de IA');

  // 4. Verificar trazabilidad en base de datos
  const lifecycle = db.getScenarioLifecycle('scen_replay_long_1');
  assert.ok(lifecycle.length >= 3, 'Debe existir historial de eventos de ciclo de vida');
  const statuses = lifecycle.map((l) => l.toStatus);
  assert.ok(statuses.includes('APPROACHING_ZONE'));
  assert.ok(statuses.includes('IN_ZONE'));
  assert.ok(statuses.includes('AI_REVALIDATING'));
  assert.ok(statuses.includes('ENTRY_VALIDATED'));

  const revals = db.getScenarioRevalidations('scen_replay_long_1');
  assert.equal(revals.length, 1);
  assert.equal(revals[0].consensusVerdict, 'AUTHORIZED');

  watcher.stop();
  db.close();
});

test('Fase 5A — Early Invalidation: Si el precio rompe el Stop Loss antes de entrar, invalida de inmediato', async () => {
  const db = new DatabaseService(':memory:');
  const registry = new ScenarioRegistry(db);
  const coordinator = new MockCoordinator() as any;

  const watcher = new AlgorithmicWatcher(
    coordinator,
    registry,
    undefined,
    undefined,
    { approachThresholdPct: 0.5 }
  );

  const scenario: Scenario = {
    id: 'scen_replay_inv_1',
    symbol: 'BTCUSDT',
    direction: 'LONG',
    timeframe: '15m',
    structureType: 'ORDER_BLOCK_MITIGATION',
    proposedBy: 'CONSENSUS',
    modelsUsed: ['gpt-4o'],
    snapshotId: 'snap_test_2',
    discoveryTimestamp: Date.now(),
    entryZoneMin: 64400,
    entryZoneMax: 64600,
    targetEntry: 64500,
    stopLossPrice: 64000,
    target12Price: 65800,
    target14Price: 66800,
    netRR12: 2.15,
    netRR14: 4.12,
    rrModeAvailable: 'RR_BOTH',
    uncertaintyLevel: 'LOW',
    status: 'SCENARIO_REGISTERED',
    validUntilTimestamp: Date.now() + 3600000,
    aiCostUsd: 0.002,
    currentPrice: 65000,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  registry.registerScenario(scenario);
  watcher.start();

  // Caída brusca por debajo del SL (63900 < 64000)
  coordinator.setPrice(63900);

  const scen = registry.getScenario('scen_replay_inv_1');
  assert.equal(scen?.status, 'INVALIDATED');
  assert.equal(registry.getAllActive().length, 0);

  watcher.stop();
  db.close();
});
