import crypto from 'crypto';
import { DatabaseService } from '../storage/database.js';
import { HistoricalDataManager } from './historical-data-manager.js';
import { Candle, Timeframe } from '../types/market.js';
import { StrategyATrendContinuation, SetupCandidate } from '../engine/strategy-a-trend.js';
import { StrategyBLiquiditySweep } from '../engine/strategy-b-sweep.js';
import { RiskCalculator, RiskCalculationResult } from '../engine/risk-calculator.js';

export interface BacktestConfig {
  symbol?: string;
  days?: number; // default 90
  inSampleDays?: number; // default 60
  strategyFilter?: 'ALL' | 'STRATEGY_A' | 'STRATEGY_B';
  directionFilter?: 'ALL' | 'LONG' | 'SHORT';
  ratioFilter?: 'ALL' | 'RR_1_2' | 'RR_1_4';
  accountBalance?: number; // default 10000
  riskPercent?: number; // default 1.0%
  makerFeeRate?: number; // default 0.00020 (0.02%)
  takerFeeRate?: number; // default 0.00055 (0.055%)
  spread?: number; // default 0.10 USDT
  slippageRate?: number; // default 0.00020 (0.02%)
  allowConcurrentTrades?: boolean; // default false for combined portfolio
}

export interface BacktestTradeResult {
  id: string;
  runId: string;
  symbol: string;
  strategy: 'STRATEGY_A_TREND_CONTINUATION' | 'STRATEGY_B_LIQUIDITY_SWEEP_REVERSAL';
  direction: 'LONG' | 'SHORT';
  ratioTarget: 'RR_1_2' | 'RR_1_4';
  timeframe: Timeframe;
  entryTimestamp: number;
  exitTimestamp: number;
  entryPrice: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  exitPrice: number;
  outcome: 'TAKE_PROFIT' | 'STOP_LOSS' | 'EXPIRED';
  realizedNetPnlUsdt: number;
  realizedNetR: number;
  mfePrice: number;
  mfeR: number;
  maePrice: number;
  maeR: number;
  durationMs: number;
  isInSample: boolean;
  feesUsdt: number;
  spreadCostUsdt: number;
  slippageCostUsdt: number;
  initialRiskUsdt: number;
  positionSizeBtc: number;
  grossPnlUsdt: number;
  capitalBeforeUsdt?: number;
  capitalAfterUsdt?: number;
  isExecutedInPortfolio?: boolean;
}

export interface MetricGroup {
  totalTrades: number;
  wins: number;
  losses: number;
  expired: number;
  winRate: number; // percentage (0-100)
  profitFactor: number;
  expectancyR: number;
  maxDrawdownPct: number;
  maxDrawdownR: number;
  netPnlUsdt: number;
  netPnlR: number;
  avgDurationHours: number;
  avgMfeR: number;
  avgMaeR: number;
}

export interface BacktestReport {
  id: string;
  symbol: string;
  startTimestamp: number;
  endTimestamp: number;
  inSampleEndTimestamp: number;
  status: 'COMPLETED' | 'FAILED';
  totalTrades: number;
  winRate: number;
  profitFactor: number;
  expectancyR: number;
  maxDrawdownPct: number;
  netPnlUsdt: number;
  netPnlR: number;
  inSampleMetrics: MetricGroup;
  outSampleMetrics: MetricGroup;
  breakdown: {
    strategyA_Long_12: MetricGroup;
    strategyA_Long_14: MetricGroup;
    strategyA_Short_12: MetricGroup;
    strategyA_Short_14: MetricGroup;
    strategyB_Long_12: MetricGroup;
    strategyB_Long_14: MetricGroup;
    strategyB_Short_12: MetricGroup;
    strategyB_Short_14: MetricGroup;
    combinedPortfolio: MetricGroup;
  };
  config: BacktestConfig;
  createdAt: number;
  trades?: BacktestTradeResult[];
}

export class BacktestEngine {
  private dataManager: HistoricalDataManager;
  private db: DatabaseService;

  constructor(dataManager: HistoricalDataManager, db: DatabaseService) {
    this.dataManager = dataManager;
    this.db = db;
  }

  public async runBacktest(
    config: BacktestConfig = {},
    onProgress?: (step: string, pct: number) => void
  ): Promise<BacktestReport> {
    const symbol = config.symbol || 'BTCUSDT';
    const totalDays = config.days || 90;
    const inSampleDays = config.inSampleDays || 60;
    const accountBalance = config.accountBalance || 10000;
    const riskPercent = config.riskPercent || 1.0;
    const spread = config.spread || 0.10;
    const makerFee = config.makerFeeRate || 0.00020;
    const takerFee = config.takerFeeRate || 0.00055;
    const slippageRate = config.slippageRate || 0.00020;
    const allowConcurrent = config.allowConcurrentTrades ?? false;

    const runId = `run_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const now = Date.now();
    const startTimestamp = now - totalDays * 24 * 60 * 60 * 1000;
    const inSampleEndTimestamp = startTimestamp + inSampleDays * 24 * 60 * 60 * 1000;
    const endTimestamp = now;

    if (onProgress) onProgress('Cargando velas históricas de la base de datos...', 10);

    // Load candles for all timeframes
    const candles5m = this.dataManager.getCandles('5m', startTimestamp, endTimestamp);
    const candles15m = this.dataManager.getCandles('15m', startTimestamp, endTimestamp);
    const candles1h = this.dataManager.getCandles('1h', startTimestamp - 10 * 24 * 3600 * 1000, endTimestamp); // extra lookback for indicators
    const candles4h = this.dataManager.getCandles('4h', startTimestamp - 30 * 24 * 3600 * 1000, endTimestamp);

    if (candles15m.length < 50 || candles5m.length < 100) {
      throw new Error(`Datos históricos insuficientes para ${symbol}. Velas 15m: ${candles15m.length}, Velas 5m: ${candles5m.length}. Ejecuta primero la importación de 90 días.`);
    }

    if (onProgress) onProgress('Indexando secuencias temporales sin look-ahead bias...', 25);

    // Map 5m candles by index and timestamp for fast lookups
    const candle5mTimeMap = new Map<number, number>();
    candles5m.forEach((c, idx) => candle5mTimeMap.set(c.timestamp, idx));

    const simulatedTrades: BacktestTradeResult[] = [];
    const totalBars15m = candles15m.length;

    // Portfolio tracker for combined portfolio (no concurrent trades)
    let combinedPortfolioBusyUntil = 0;

    if (onProgress) onProgress('Ejecutando simulación cuantitativa barra a barra...', 35);

    // Loop through 15m bars starting from index 30 (to have structural lookback)
    for (let i = 30; i < totalBars15m; i++) {
      if (i % 200 === 0 && onProgress) {
        const pct = 35 + Math.round((i / totalBars15m) * 50);
        onProgress(`Procesando vela ${i}/${totalBars15m} (${new Date(candles15m[i].timestamp).toISOString().slice(0, 10)})...`, pct);
      }

      const bar15m = candles15m[i];
      const barTs = bar15m.timestamp;

      // Slice historical windows strictly up to barTs (NO look-ahead)
      const window15m = candles15m.slice(Math.max(0, i - 100), i + 1);
      const window1h = candles1h.filter((c) => c.timestamp <= barTs);
      const window4h = candles4h.filter((c) => c.timestamp <= barTs);

      // We need recent 5m candles up to barTs
      const idx5m = this.findLastCandleIndex(candles5m, barTs);
      if (idx5m < 30) continue;
      const window5m = candles5m.slice(Math.max(0, idx5m - 50), idx5m + 1);

      // 1. Evaluate Strategy A (Trend Continuation)
      if (config.strategyFilter !== 'STRATEGY_B') {
        const setupA = StrategyATrendContinuation.evaluate(
          window4h.slice(-50),
          window1h.slice(-50),
          window15m,
          window5m,
          spread
        );

        if (setupA && (!config.directionFilter || config.directionFilter === 'ALL' || config.directionFilter === setupA.direction)) {
          this.simulateSetupCandidate({
            setup: setupA,
            candles5m,
            start5mIdx: idx5m,
            runId,
            symbol,
            inSampleEndTimestamp,
            accountBalance,
            riskPercent,
            makerFee,
            takerFee,
            spread,
            slippageRate,
            configRatio: config.ratioFilter,
            simulatedTrades,
          });
        }
      }

      // 2. Evaluate Strategy B (Liquidity Sweep & Reversal)
      if (config.strategyFilter !== 'STRATEGY_A') {
        const setupB = StrategyBLiquiditySweep.evaluate(
          window1h.slice(-50),
          window15m,
          window5m,
          spread
        );

        if (setupB && (!config.directionFilter || config.directionFilter === 'ALL' || config.directionFilter === setupB.direction)) {
          this.simulateSetupCandidate({
            setup: setupB,
            candles5m,
            start5mIdx: idx5m,
            runId,
            symbol,
            inSampleEndTimestamp,
            accountBalance,
            riskPercent,
            makerFee,
            takerFee,
            spread,
            slippageRate,
            configRatio: config.ratioFilter,
            simulatedTrades,
          });
        }
      }
    }

    if (onProgress) onProgress('Calculando métricas estadísticas y desgloses...', 90);

    // Realistic Portfolio Simulation: Max 1 concurrent trade in BTCUSDT, dynamic capital, margin halt protection
    const portfolioSim = this.simulateCombinedPortfolio(simulatedTrades, accountBalance, 30);
    const combinedTrades = portfolioSim.executedTrades;
    const combinedMetrics = portfolioSim.metrics;

    // Breakdown for each standalone virtual variant (without cross-polluting the portfolio)
    const breakdown = {
      strategyA_Long_12: this.calculateMetrics(simulatedTrades.filter((t) => t.strategy === 'STRATEGY_A_TREND_CONTINUATION' && t.direction === 'LONG' && t.ratioTarget === 'RR_1_2')),
      strategyA_Long_14: this.calculateMetrics(simulatedTrades.filter((t) => t.strategy === 'STRATEGY_A_TREND_CONTINUATION' && t.direction === 'LONG' && t.ratioTarget === 'RR_1_4')),
      strategyA_Short_12: this.calculateMetrics(simulatedTrades.filter((t) => t.strategy === 'STRATEGY_A_TREND_CONTINUATION' && t.direction === 'SHORT' && t.ratioTarget === 'RR_1_2')),
      strategyA_Short_14: this.calculateMetrics(simulatedTrades.filter((t) => t.strategy === 'STRATEGY_A_TREND_CONTINUATION' && t.direction === 'SHORT' && t.ratioTarget === 'RR_1_4')),
      strategyB_Long_12: this.calculateMetrics(simulatedTrades.filter((t) => t.strategy === 'STRATEGY_B_LIQUIDITY_SWEEP_REVERSAL' && t.direction === 'LONG' && t.ratioTarget === 'RR_1_2')),
      strategyB_Long_14: this.calculateMetrics(simulatedTrades.filter((t) => t.strategy === 'STRATEGY_B_LIQUIDITY_SWEEP_REVERSAL' && t.direction === 'LONG' && t.ratioTarget === 'RR_1_4')),
      strategyB_Short_12: this.calculateMetrics(simulatedTrades.filter((t) => t.strategy === 'STRATEGY_B_LIQUIDITY_SWEEP_REVERSAL' && t.direction === 'SHORT' && t.ratioTarget === 'RR_1_2')),
      strategyB_Short_14: this.calculateMetrics(simulatedTrades.filter((t) => t.strategy === 'STRATEGY_B_LIQUIDITY_SWEEP_REVERSAL' && t.direction === 'SHORT' && t.ratioTarget === 'RR_1_4')),
      combinedPortfolio: combinedMetrics,
    };

    // Metrics for in-sample / out-sample based on executed portfolio
    const inSampleTrades = combinedTrades.filter((t) => t.isInSample);
    const outSampleTrades = combinedTrades.filter((t) => !t.isInSample);
    const inSampleMetrics = this.calculateMetrics(inSampleTrades);
    const outSampleMetrics = this.calculateMetrics(outSampleTrades);

    const report: BacktestReport = {
      id: runId,
      symbol,
      startTimestamp,
      endTimestamp,
      inSampleEndTimestamp,
      status: 'COMPLETED',
      totalTrades: combinedMetrics.totalTrades,
      winRate: combinedMetrics.winRate,
      profitFactor: combinedMetrics.profitFactor,
      expectancyR: combinedMetrics.expectancyR,
      maxDrawdownPct: combinedMetrics.maxDrawdownPct,
      netPnlUsdt: combinedMetrics.netPnlUsdt,
      netPnlR: combinedMetrics.netPnlR,
      inSampleMetrics,
      outSampleMetrics,
      breakdown,
      config,
      createdAt: Date.now(),
      trades: simulatedTrades,
    };

    // Save report and trades to database
    this.db.saveBacktestRun({
      id: report.id,
      symbol: report.symbol,
      startTimestamp: report.startTimestamp,
      endTimestamp: report.endTimestamp,
      inSampleEndTimestamp: report.inSampleEndTimestamp,
      status: report.status,
      totalTrades: report.totalTrades,
      winRate: report.winRate,
      profitFactor: report.profitFactor,
      expectancyR: report.expectancyR,
      maxDrawdownPct: report.maxDrawdownPct,
      netPnlUsdt: report.netPnlUsdt,
      netPnlR: report.netPnlR,
      inSampleMetrics: report.inSampleMetrics,
      outSampleMetrics: report.outSampleMetrics,
      breakdown: report.breakdown,
      config: report.config,
      createdAt: report.createdAt,
    });

    this.db.saveBacktestTrades(simulatedTrades);

    if (onProgress) onProgress('Backtest finalizado con éxito.', 100);

    return report;
  }

  private simulateSetupCandidate(params: {
    setup: SetupCandidate;
    candles5m: Candle[];
    start5mIdx: number;
    runId: string;
    symbol: string;
    inSampleEndTimestamp: number;
    accountBalance: number;
    riskPercent: number;
    makerFee: number;
    takerFee: number;
    spread: number;
    slippageRate: number;
    configRatio?: string;
    simulatedTrades: BacktestTradeResult[];
  }): void {
    const { setup, candles5m, start5mIdx, runId, symbol, inSampleEndTimestamp, accountBalance, riskPercent, makerFee, takerFee, spread, slippageRate, configRatio, simulatedTrades } = params;

    const entryPrice = setup.entryPrice;
    const stopLoss = setup.stopLossPrice;
    const riskDistance = Math.abs(entryPrice - stopLoss);
    if (riskDistance <= 0) return;

    // Real structural candidate targets only — NEVER invent prices in the air with synthetic solvers
    const candidateTargets: number[] = [];
    if (setup.takeProfitPrice && setup.takeProfitPrice > 0) {
      candidateTargets.push(setup.takeProfitPrice);
    }

    const dualCalc = RiskCalculator.calculateDualTargets({
      direction: setup.direction,
      entryPrice,
      stopLossPrice: stopLoss,
      candidateTargets,
      accountBalance,
      riskPercent,
      feeStructure: {
        makerFeeRate: makerFee,
        takerFeeRate: takerFee,
      },
      minRRShort: 2.0,
      minRRExtended: 4.0,
    });

    const ratiosToTest: Array<'RR_1_2' | 'RR_1_4'> = [];
    if (!configRatio || configRatio === 'ALL') {
      if (dualCalc.calculation12?.isValid) ratiosToTest.push('RR_1_2');
      if (dualCalc.calculation14?.isValid) ratiosToTest.push('RR_1_4');
    } else if (configRatio === 'RR_1_2' && dualCalc.calculation12?.isValid) {
      ratiosToTest.push('RR_1_2');
    } else if (configRatio === 'RR_1_4' && dualCalc.calculation14?.isValid) {
      ratiosToTest.push('RR_1_4');
    }

    for (const ratioTarget of ratiosToTest) {
      const takeProfitPrice = ratioTarget === 'RR_1_2' ? dualCalc.target12Price! : dualCalc.target14Price!;
      const calc = ratioTarget === 'RR_1_2' ? dualCalc.calculation12! : dualCalc.calculation14!;

      const trade = this.evaluateSimulatedTradeExecution({
        setup,
        takeProfitPrice,
        calc,
        ratioTarget,
        candles5m,
        start5mIdx,
        runId,
        symbol,
        inSampleEndTimestamp,
        spread,
        slippageRate,
      });

      if (trade) {
        simulatedTrades.push(trade);
      }
    }
  }

  private evaluateSimulatedTradeExecution(params: {
    setup: SetupCandidate;
    takeProfitPrice: number;
    calc: RiskCalculationResult;
    ratioTarget: 'RR_1_2' | 'RR_1_4';
    candles5m: Candle[];
    start5mIdx: number;
    runId: string;
    symbol: string;
    inSampleEndTimestamp: number;
    spread: number;
    slippageRate: number;
  }): BacktestTradeResult | null {
    const { setup, takeProfitPrice, calc, ratioTarget, candles5m, start5mIdx, runId, symbol, inSampleEndTimestamp, spread, slippageRate } = params;

    const entryPrice = setup.entryPrice;
    const stopLossPrice = setup.stopLossPrice;
    const isLong = setup.direction === 'LONG';
    const entryTimestamp = setup.timestamp;

    let mfePrice = entryPrice;
    let maePrice = entryPrice;
    let exitPrice = entryPrice;
    let exitTimestamp = entryTimestamp;
    let outcome: 'TAKE_PROFIT' | 'STOP_LOSS' | 'EXPIRED' = 'EXPIRED';

    const maxHoldingCandles = 576; // 48 hours in 5m candles (48 * 12)
    const endLookIdx = Math.min(candles5m.length - 1, start5mIdx + maxHoldingCandles);

    for (let j = start5mIdx + 1; j <= endLookIdx; j++) {
      const candle = candles5m[j];

      // Update MFE & MAE
      if (isLong) {
        if (candle.high > mfePrice) mfePrice = candle.high;
        if (candle.low < maePrice) maePrice = candle.low;
      } else {
        if (candle.low < mfePrice) mfePrice = candle.low;
        if (candle.high > maePrice) maePrice = candle.high;
      }

      // Check hit conditions
      const hitStopLoss = isLong ? candle.low <= stopLossPrice : candle.high >= stopLossPrice;
      const hitTakeProfit = isLong ? candle.high >= takeProfitPrice : candle.low <= takeProfitPrice;

      // Conservative resolution: If both touched in the same candle, SL hit first
      if (hitStopLoss && hitTakeProfit) {
        outcome = 'STOP_LOSS';
        exitPrice = stopLossPrice;
        exitTimestamp = candle.timestamp;
        break;
      } else if (hitStopLoss) {
        outcome = 'STOP_LOSS';
        exitPrice = stopLossPrice;
        exitTimestamp = candle.timestamp;
        break;
      } else if (hitTakeProfit) {
        outcome = 'TAKE_PROFIT';
        exitPrice = takeProfitPrice;
        exitTimestamp = candle.timestamp;
        break;
      }

      // If reached end of holding window
      if (j === endLookIdx) {
        outcome = 'EXPIRED';
        exitPrice = candle.close;
        exitTimestamp = candle.timestamp;
      }
    }

    // Calculate realistic financial outcome
    const durationMs = Math.max(300000, exitTimestamp - entryTimestamp);
    let realizedNetPnlUsdt = 0;
    let realizedNetR = 0;
    let grossPnlUsdt = 0;

    const positionSize = calc.positionSizeBTC;
    const notional = positionSize * entryPrice;
    const spreadCostUsdt = calc.spreadCostUSDT;
    const slippageCostUsdt = calc.slippageCostUSDT;
    const feesUsdt = calc.totalFeesUSDT;

    // CANONICAL DEFINITION OF 1R:
    // 1R is EXACTLY the net loss in USDT realized if Stop Loss is hit (gross risk + entry fees + exit fees + spread + slippage)
    const unitRisk = calc.netLossUSDT; // 1R real

    if (outcome === 'TAKE_PROFIT') {
      grossPnlUsdt = calc.grossRewardUSDT;
      realizedNetPnlUsdt = calc.netRewardUSDT;
      realizedNetR = unitRisk > 0 ? parseFloat((realizedNetPnlUsdt / unitRisk).toFixed(2)) : 0;
    } else if (outcome === 'STOP_LOSS') {
      grossPnlUsdt = -calc.grossRiskUSDT;
      realizedNetPnlUsdt = -calc.netLossUSDT;
      realizedNetR = -1.0; // By definition, since realizedNetPnlUsdt === -unitRisk
    } else {
      // Expired: market exit at exitPrice
      const grossDiff = isLong ? exitPrice - entryPrice : entryPrice - exitPrice;
      grossPnlUsdt = parseFloat((grossDiff * positionSize).toFixed(2));
      realizedNetPnlUsdt = parseFloat((grossPnlUsdt - feesUsdt - spreadCostUsdt - slippageCostUsdt).toFixed(2));
      realizedNetR = unitRisk > 0 ? parseFloat((realizedNetPnlUsdt / unitRisk).toFixed(2)) : 0;
    }

    // Calculate MFE and MAE in R terms
    const riskDistance = Math.abs(entryPrice - stopLossPrice);
    const mfeR = isLong
      ? parseFloat(((mfePrice - entryPrice) / riskDistance).toFixed(2))
      : parseFloat(((entryPrice - mfePrice) / riskDistance).toFixed(2));
    const maeR = isLong
      ? parseFloat(((entryPrice - maePrice) / riskDistance).toFixed(2))
      : parseFloat(((maePrice - entryPrice) / riskDistance).toFixed(2));

    const tradeId = `bt_${runId}_${setup.strategy.slice(9, 15)}_${ratioTarget}_${entryTimestamp}`;

    return {
      id: tradeId,
      runId,
      symbol,
      strategy: setup.strategy,
      direction: setup.direction,
      ratioTarget,
      timeframe: setup.timeframe,
      entryTimestamp,
      exitTimestamp,
      entryPrice,
      stopLossPrice,
      takeProfitPrice,
      exitPrice,
      outcome,
      realizedNetPnlUsdt,
      realizedNetR,
      mfePrice,
      mfeR: Math.max(0, mfeR),
      maePrice,
      maeR: Math.max(0, maeR),
      durationMs,
      isInSample: entryTimestamp < inSampleEndTimestamp,
      feesUsdt,
      spreadCostUsdt,
      slippageCostUsdt,
      initialRiskUsdt: unitRisk,
      positionSizeBtc: positionSize,
      grossPnlUsdt,
    };
  }

  private simulateCombinedPortfolio(
    trades: BacktestTradeResult[],
    initialCapital: number = 10000,
    maxAllowedDrawdownPct: number = 30
  ): { executedTrades: BacktestTradeResult[]; metrics: MetricGroup } {
    // Sort chronologically by entryTimestamp
    const sorted = [...trades].sort((a, b) => a.entryTimestamp - b.entryTimestamp);
    const executedTrades: BacktestTradeResult[] = [];
    let busyUntil = 0;
    let currentCapital = initialCapital;
    let peakCapital = initialCapital;
    let isHalted = false;

    // Group concurrent signals at the exact same timestamp (variants of the same signal)
    const signalsByTimestamp = new Map<number, BacktestTradeResult[]>();
    for (const t of sorted) {
      const list = signalsByTimestamp.get(t.entryTimestamp) || [];
      list.push(t);
      signalsByTimestamp.set(t.entryTimestamp, list);
    }

    for (const [timestamp, candidates] of signalsByTimestamp.entries()) {
      if (timestamp < busyUntil) {
        // Already in a trade: enforce strictly MAX 1 CONCURRENT POSITION IN BTCUSDT
        continue;
      }
      if (isHalted) {
        // Account halted by risk limits / margin protection
        break;
      }

      // Select ONE representative variant for execution in the real portfolio
      // Prioritize qualified 1:4 if valid, else 1:2
      const chosen = candidates.find((c) => c.ratioTarget === 'RR_1_4') || candidates[0];

      // Capital tracking before trade
      const capitalBefore = Number(currentCapital.toFixed(2));

      // Calculate realized outcome on this trade
      const tradeNetPnl = chosen.realizedNetPnlUsdt;
      const capitalAfter = Number((capitalBefore + tradeNetPnl).toFixed(2));

      // Clone trade and assign portfolio execution fields
      const executed: BacktestTradeResult = {
        ...chosen,
        capitalBeforeUsdt: capitalBefore,
        capitalAfterUsdt: Math.max(0, capitalAfter),
        isExecutedInPortfolio: true,
      };

      currentCapital = Math.max(0, capitalAfter);
      if (currentCapital > peakCapital) peakCapital = currentCapital;

      // Check drawdown halt condition
      const currentDd = peakCapital > 0 ? ((peakCapital - currentCapital) / peakCapital) * 100 : 0;
      if (currentDd >= maxAllowedDrawdownPct || currentCapital < 1000) {
        isHalted = true;
      }

      executedTrades.push(executed);
      busyUntil = chosen.exitTimestamp;
    }

    const metrics = this.calculateMetrics(executedTrades);
    return { executedTrades, metrics };
  }

  public calculateMetrics(trades: BacktestTradeResult[]): MetricGroup {
    if (trades.length === 0) {
      return {
        totalTrades: 0,
        wins: 0,
        losses: 0,
        expired: 0,
        winRate: 0,
        profitFactor: 0,
        expectancyR: 0,
        maxDrawdownPct: 0,
        maxDrawdownR: 0,
        netPnlUsdt: 0,
        netPnlR: 0,
        avgDurationHours: 0,
        avgMfeR: 0,
        avgMaeR: 0,
      };
    }

    let wins = 0;
    let losses = 0;
    let expired = 0;
    let grossGainsUsdt = 0;
    let grossLossesUsdt = 0;
    let totalPnlUsdt = 0;
    let totalPnlR = 0;
    let totalDurationMs = 0;
    let totalMfeR = 0;
    let totalMaeR = 0;

    let peakPnl = 0;
    let currentPnl = 0;
    let maxDrawdownUsdt = 0;
    let peakR = 0;
    let currentR = 0;
    let maxDrawdownR = 0;

    for (const t of trades) {
      totalDurationMs += t.durationMs;
      totalMfeR += t.mfeR;
      totalMaeR += t.maeR;
      totalPnlUsdt += t.realizedNetPnlUsdt;
      totalPnlR += t.realizedNetR;

      currentPnl += t.realizedNetPnlUsdt;
      if (currentPnl > peakPnl) peakPnl = currentPnl;
      const dd = peakPnl - currentPnl;
      if (dd > maxDrawdownUsdt) maxDrawdownUsdt = dd;

      currentR += t.realizedNetR;
      if (currentR > peakR) peakR = currentR;
      const ddR = peakR - currentR;
      if (ddR > maxDrawdownR) maxDrawdownR = ddR;

      if (t.outcome === 'TAKE_PROFIT' || t.realizedNetPnlUsdt > 0) {
        wins++;
        grossGainsUsdt += t.realizedNetPnlUsdt;
      } else if (t.outcome === 'STOP_LOSS' || t.realizedNetPnlUsdt < 0) {
        losses++;
        grossLossesUsdt += Math.abs(t.realizedNetPnlUsdt);
      } else {
        expired++;
      }
    }

    const total = trades.length;
    const winRate = Number(((wins / total) * 100).toFixed(2));
    const profitFactor = grossLossesUsdt > 0
      ? Number((grossGainsUsdt / grossLossesUsdt).toFixed(2))
      : grossGainsUsdt > 0 ? 99.99 : 0;
    const expectancyR = Number((totalPnlR / total).toFixed(2));
    const avgDurationHours = Number((totalDurationMs / total / 3600000).toFixed(1));
    const avgMfeR = Number((totalMfeR / total).toFixed(2));
    const avgMaeR = Number((totalMaeR / total).toFixed(2));
    const maxDrawdownPct = Number(((maxDrawdownUsdt / 10000) * 100).toFixed(2));

    return {
      totalTrades: total,
      wins,
      losses,
      expired,
      winRate,
      profitFactor,
      expectancyR,
      maxDrawdownPct,
      maxDrawdownR: Number(maxDrawdownR.toFixed(2)),
      netPnlUsdt: Number(totalPnlUsdt.toFixed(2)),
      netPnlR: Number(totalPnlR.toFixed(2)),
      avgDurationHours,
      avgMfeR,
      avgMaeR,
    };
  }

  private findLastCandleIndex(candles: Candle[], targetTimestamp: number): number {
    let low = 0;
    let high = candles.length - 1;
    let ans = -1;

    while (low <= high) {
      const mid = (low + high) >> 1;
      if (candles[mid].timestamp <= targetTimestamp) {
        ans = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return ans;
  }
}
