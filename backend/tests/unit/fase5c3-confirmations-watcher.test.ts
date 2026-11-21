import { describe, it } from 'node:test';
import assert from 'node:assert';
import { AlgorithmicWatcher } from '../../src/engine/algorithmic-watcher.js';
import { ScenarioRegistry } from '../../src/engine/scenario-registry.js';
import { DatabaseService } from '../../src/storage/database.js';
import { Scenario, AiWatchPlan } from '../../src/ai/scenario-types.js';

describe('Fase 5C.3: Algorithmic Confirmation Operators & Sequential Watcher', () => {
  const db = new DatabaseService(':memory:');
  const mockCoordinator: any = {
    on: () => {},
    emit: () => {},
    getSetupEngine: () => ({
      getAnalysis: () => ({
        rsi: 50,
        structure: {
          structureBreaks: [],
          sweeps: [],
        },
      }),
    }),
    getCandleManager: () => ({
      getCandles: () => [],
      getLastClosedCandle: () => null,
    }),
    getDiscoveryScheduler: () => ({
      triggerDiscovery: () => {},
    }),
  };

  const registry = new ScenarioRegistry(db);
  const watcher = new AlgorithmicWatcher(mockCoordinator, registry);

  it('1. Detécta patrón BEARISH_ENGULFING correctamente', () => {
    const prevCandle = {
      open: 50000,
      high: 50600,
      low: 49950,
      close: 50500,
      volume: 100,
      timestamp: Date.now() - 60000,
    };
    const currentCandle = {
      open: 50550,
      high: 50600,
      low: 49800,
      close: 49850,
      volume: 150,
      timestamp: Date.now(),
    };

    const isBearishEngulfing = watcher.evaluateCandlePattern('BEARISH_ENGULFING', currentCandle, prevCandle);
    assert.strictEqual(isBearishEngulfing, true, 'Debe detectar vela envolvente bajista');

    // Caso negativo: vela actual alcista
    const falseCandle = {
      open: 50000,
      high: 50600,
      low: 49900,
      close: 50550,
      volume: 120,
      timestamp: Date.now(),
    };
    assert.strictEqual(watcher.evaluateCandlePattern('BEARISH_ENGULFING', falseCandle, prevCandle), false);
  });

  it('2. Detécta patrón BULLISH_ENGULFING correctamente', () => {
    const prevCandle = {
      open: 50500,
      high: 50550,
      low: 49950,
      close: 50000,
      volume: 100,
      timestamp: Date.now() - 60000,
    };
    const currentCandle = {
      open: 49950,
      high: 50700,
      low: 49900,
      close: 50650,
      volume: 180,
      timestamp: Date.now(),
    };

    const isBullishEngulfing = watcher.evaluateCandlePattern('BULLISH_ENGULFING', currentCandle, prevCandle);
    assert.strictEqual(isBullishEngulfing, true, 'Debe detectar vela envolvente alcista');
  });

  it('3. Detécta SHOOTING_STAR y PIN_BAR con rechazo mecha', () => {
    // Shooting Star: mecha superior larga, cuerpo pequeño abajo
    const shootingStar = {
      open: 50100,
      high: 50900,
      low: 50050,
      close: 50150,
      volume: 100,
      timestamp: Date.now(),
    };
    assert.strictEqual(watcher.evaluateCandlePattern('SHOOTING_STAR', shootingStar), true, 'Debe identificar Shooting Star');

    // Pin Bar alcista / Hammer: mecha inferior larga, cuerpo arriba
    const pinBar = {
      open: 50800,
      high: 50850,
      low: 50050,
      close: 50750,
      volume: 110,
      timestamp: Date.now(),
    };
    assert.strictEqual(watcher.evaluateCandlePattern('PIN_BAR', pinBar), true, 'Debe identificar Pin Bar alcista');
  });

  it('4. Detécta LEVEL_REJECTION_WICK en resistencia y soporte', () => {
    // Resistencia en 50500: mecha perfora 50500 pero cierra en 50350
    const resistanceCandle = {
      open: 50400,
      high: 50650,
      low: 50300,
      close: 50350,
      volume: 80,
    };
    const rejectedResistance = watcher.evaluateLevelRejectionWick('BEARISH', 50500, resistanceCandle, 0.25);
    assert.strictEqual(rejectedResistance, true, 'Debe detectar rechazo de resistencia con mecha superior');

    // Soporte en 50000: mecha perfora 50000 pero cierra en 50150
    const supportCandle = {
      open: 50100,
      high: 50200,
      low: 49850,
      close: 50150,
      volume: 90,
    };
    const rejectedSupport = watcher.evaluateLevelRejectionWick('BULLISH', 50000, supportCandle, 0.25);
    assert.strictEqual(rejectedSupport, true, 'Debe detectar rechazo de soporte con mecha inferior');
  });

  it('5. Evalúa progresión secuencial estricta paso 1 -> paso 2', () => {
    const now = Date.now();
    const scenarioId = `sc_test_seq_${now}`;
    const watchPlan: AiWatchPlan = {
      id: `wp_${scenarioId}`,
      scenarioId,
      symbol: 'BTCUSDT',
      direction: 'SHORT',
      entryZoneMin: 50400,
      entryZoneMax: 50600,
      targetEntry: 50500,
      stopLossPrice: 50800,
      candidateTakeProfits: { target12: 49900, target14: 49300 },
      rrEligibility: 'RR_BOTH',
      observableConditions: [
        {
          id: 'step_1_zone',
          description: 'Precio entra en zona de oferta [50400 - 50600]',
          operator: 'PRICE_IN_RANGE',
          params: { minLevel: 50400, maxLevel: 50600 },
          isMet: false,
          automatable: true,
          sequenceOrder: 1,
        },
        {
          id: 'step_2_pattern',
          description: 'Patrón de rechazo bajista en 15m (BEARISH_ENGULFING)',
          operator: 'CANDLE_PATTERN',
          params: { pattern: 'BEARISH_ENGULFING', timeframe: '15m' },
          isMet: false,
          automatable: true,
          sequenceOrder: 2,
        },
      ],
      confirmationSequence: ['1. Mitigación de zona', '2. Vela envolvente bajista'],
      invalidationConditions: [],
      expirationTimestamp: now + 3600000,
      reevaluationTriggers: [],
      horizon: 'INTRADAY',
      automatable: true,
      status: 'ACTIVE',
    };

    const sc: Scenario = {
      id: scenarioId,
      symbol: 'BTCUSDT',
      direction: 'SHORT',
      timeframe: '15m',
      structureType: 'SMC_DISCRETIONARY_DISCOVERY',
      entryZoneMin: 50400,
      entryZoneMax: 50600,
      targetEntry: 50500,
      stopLossPrice: 50800,
      target12Price: 49900,
      target14Price: 49300,
      rrModeAvailable: 'RR_BOTH',
      status: 'SCENARIO_MONITORING',
      confidence: 75,
      discoveryTimestamp: now - 5000,
      validUntilTimestamp: now + 3600000,
      proposedBy: 'OPENAI',
      modelsUsed: ['gpt-4o', 'gemini-2.5-flash'],
      snapshotId: 'snap_test',
      uncertaintyLevel: 'LOW',
      aiCostUsd: 0.001,
      activationConditions: [],
      invalidationTriggers: [],
      argumentsFor: [],
      argumentsAgainst: [],
      watchPlan,
    };

    registry.registerScenario(sc);

    // Precio a 50500 (dentro de zona)
    watcher.evaluateTick(50500);

    const conditions = sc.watchPlan!.observableConditions;
    assert.strictEqual(conditions[0].isMet, true, 'Paso 1 debe estar cumplido');
    assert.strictEqual(conditions[1].isMet, false, 'Paso 2 debe seguir pendiente');

    // Ahora llega vela cerrada con patrón envolvente bajista con timestamp posterior a discovery
    const closedCandle = {
      open: 50550,
      high: 50600,
      low: 49800,
      close: 49850,
      timeframe: '15m',
      timestamp: now + 1000,
    };

    // Simulamos vela previa para el test
    const prevCandle = {
      open: 50000,
      high: 50600,
      low: 49950,
      close: 50500,
      timeframe: '15m',
      timestamp: now,
    };

    // Usamos el método de evaluación directamente con las velas
    const patternMet = watcher.evaluateCandlePattern('BEARISH_ENGULFING', closedCandle, prevCandle);
    assert.strictEqual(patternMet, true, 'El operador de vela evaluó el patrón con éxito');
  });

  it('6. Rechaza velas obsoletas anteriores a discoveryTimestamp', () => {
    const discoveryTime = 1700000000000;
    const oldCandle = {
      open: 50550,
      high: 50600,
      low: 49800,
      close: 49850,
      timeframe: '15m',
      timestamp: discoveryTime - 3600000, // 1 hora antes de discovery
    };

    const cond = {
      id: 'c1',
      description: 'Engulfing',
      operator: 'CANDLE_PATTERN' as const,
      params: { pattern: 'BEARISH_ENGULFING' as const },
      automatable: true,
    };

    const met = watcher.evaluateCondition(cond, 50000, 0.001, oldCandle, discoveryTime);
    assert.strictEqual(met, false, 'Debe rechazar velas ocurridas antes de discoveryTimestamp');
  });

  it('7. Observación NEUTRAL se completa ante ruptura confirmada de rango', () => {
    const now = Date.now();
    const neutralId = `sc_neutral_test_${now}`;
    const neutralSc: Scenario = {
      id: neutralId,
      symbol: 'BTCUSDT',
      direction: 'NEUTRAL',
      kind: 'NEUTRAL_OBSERVATION',
      timeframe: '15m',
      structureType: 'NEUTRAL_RANGE_CONSOLIDATION',
      entryZoneMin: 50000,
      entryZoneMax: 51000,
      targetEntry: 50500,
      stopLossPrice: 50000,
      rrModeAvailable: 'NONE',
      status: 'NO_TRADE_OBSERVATION',
      confidence: 80,
      discoveryTimestamp: now,
      validUntilTimestamp: now + 3600000,
      proposedBy: 'GEMINI',
      modelsUsed: ['gemini-2.5-flash'],
      snapshotId: 'snap_neutral',
      uncertaintyLevel: 'MEDIUM',
      aiCostUsd: 0.0005,
      activationConditions: [],
      invalidationTriggers: [],
      argumentsFor: [],
      argumentsAgainst: [],
      watchPlan: {
        id: `wp_${neutralId}`,
        scenarioId: neutralId,
        symbol: 'BTCUSDT',
        direction: 'NEUTRAL',
        entryZoneMin: 50000,
        entryZoneMax: 51000,
        targetEntry: 50500,
        stopLossPrice: 50000,
        candidateTakeProfits: {},
        rrEligibility: 'NONE',
        observableConditions: [],
        confirmationSequence: [],
        invalidationConditions: [],
        expirationTimestamp: now + 3600000,
        reevaluationTriggers: [],
        horizon: 'INTRADAY',
        automatable: true,
        status: 'ACTIVE',
      },
    };

    registry.registerScenario(neutralSc);

    // A single tick/wick outside the range is not a confirmed breakout.
    watcher.evaluateTick(51050);
    assert.equal(registry.getScenario(neutralId)?.status, 'NO_TRADE_OBSERVATION');
    // Only a closed 15m candle after discovery may complete the observation.
    watcher.evaluateCandleClose({
      timeframe: '15m', timestamp: now + 1000, confirmed: true,
      open: 50800, high: 51100, low: 50700, close: 51050, volume: 10,
    });

    const updated = registry.getScenario(neutralId);
    assert.strictEqual(updated?.status, 'COMPLETED', 'La observación NEUTRAL debe completarse al romper el rango');
    assert.strictEqual(updated?.watchPlan?.status, 'COMPLETED');
  });

  it('8. Reconciliación contable en base de datos distingue bruto vs neto', () => {
    db.logAiConsumption({
      provider: 'OPENAI',
      model: 'gpt-4o',
      task: 'MARKET_DISCOVERY',
      promptTokens: 2000,
      completionTokens: 500,
      costUsd: 0.010,
      costGrossUsd: 0.010,
      discountUsd: 0.010, // 100% promo discount
      costNetUsd: 0.000,
      isFreeTier: true,
      discountStatus: 'ESTIMATED',
    });

    db.logAiConsumption({
      provider: 'GEMINI',
      model: 'gemini-2.5-flash',
      task: 'MARKET_DISCOVERY',
      promptTokens: 2000,
      completionTokens: 500,
      costUsd: 0.001,
      costGrossUsd: 0.001,
      discountUsd: 0.000,
      costNetUsd: 0.001,
      isFreeTier: false,
      discountStatus: 'NONE',
    });

    const stats = db.getAiConsumptionStats();
    assert.ok(stats.totalGrossSpendUsd >= 0.011, 'Gasto bruto debe acumular el costo sin descuento');
    assert.ok(stats.totalNetSpendUsd <= stats.totalGrossSpendUsd, 'Gasto neto debe ser menor o igual al bruto');
    assert.ok(stats.totalDiscountUsd >= 0.010, 'Descuento total debe reflejar la bonificación');
  });
});
