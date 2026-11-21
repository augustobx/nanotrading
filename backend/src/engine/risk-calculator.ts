export interface FeeStructure {
  makerFeeRate: number; // e.g. 0.0002 (0.02% Bybit default)
  takerFeeRate: number; // e.g. 0.00055 (0.055% Bybit default)
  feeRateSource?: string; // 'DEFAULT_BYBIT_LINEAR' | 'BYBIT_API_ACCOUNT_FEE_RATE'
}

export interface RiskCalculationInput {
  direction: 'LONG' | 'SHORT';
  entryPrice: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  accountBalance?: number;
  riskPercent?: number; // e.g. 0.5%
  spread?: number; // USDT spread
  tickSize?: number; // e.g. 0.1 for BTCUSDT
  qtyStep?: number; // e.g. 0.001 for BTCUSDT
  minOrderQty?: number; // e.g. 0.001 for BTCUSDT
  entryOrderType?: 'MAKER' | 'TAKER';
  exitOrderTypeSL?: 'MAKER' | 'TAKER';
  exitOrderTypeTP?: 'MAKER' | 'TAKER';
  feeStructure?: FeeStructure;
  slippageRate?: number; // e.g. 0.0002 (0.02%)
  fundingRate?: number; // 8h funding rate (e.g. 0.0001 = 0.01%)
  fundingSettlementsExpected?: number; // Number of funding intervals expected
  minRequiredRR?: number; // Strict 4.0 default
}

export interface RiskCalculationResult {
  direction: 'LONG' | 'SHORT';
  entryPrice: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  positionSizeBTC: number;
  notionalValueUSDT: number;
  grossRiskUSDT: number;
  grossRewardUSDT: number;
  grossRR: number;
  entryFeeUSDT: number;
  exitFeeTPUSDT: number;
  exitFeeSLUSDT: number;
  totalFeesUSDT: number;
  fundingCostUSDT: number;
  slippageCostUSDT: number;
  spreadCostUSDT: number;
  netLossUSDT: number;
  netRewardUSDT: number;
  netRR: number;
  isValid: boolean;
  rejectionReason?: string;
}

export interface DualRiskRewardResult {
  direction: 'LONG' | 'SHORT';
  entryPrice: number;
  stopLossPrice: number;
  target12Price?: number;
  target14Price?: number;
  calculation12?: RiskCalculationResult;
  calculation14?: RiskCalculationResult;
  qualifiedMode: 'RR_1_2' | 'RR_1_4' | 'RR_BOTH' | 'NONE';
  rejectionReason?: string;
  notes: string[];
}

export class RiskCalculator {
  public static roundToTick(price: number, tickSize: number = 0.1): number {
    return parseFloat((Math.round(price / tickSize) * tickSize).toFixed(2));
  }

  public static calculate(input: RiskCalculationInput): RiskCalculationResult {
    const {
      direction,
      accountBalance = 10000,
      riskPercent = 0.5,
      spread = 0.1,
      tickSize = 0.1,
      qtyStep = 0.001,
      minOrderQty = 0.001,
      entryOrderType = 'TAKER',
      exitOrderTypeSL = 'TAKER',
      exitOrderTypeTP = 'MAKER', // TP is usually a limit order sitting at the level
      feeStructure = {
        makerFeeRate: 0.0002,
        takerFeeRate: 0.00055,
        feeRateSource: 'DEFAULT_BYBIT_LINEAR',
      },
      slippageRate = 0.0002,
      fundingRate = 0,
      fundingSettlementsExpected = 0,
      minRequiredRR = 4.0,
    } = input;

    if (!Number.isFinite(input.entryPrice) || input.entryPrice <= 0 ||
        !Number.isFinite(input.stopLossPrice) || input.stopLossPrice <= 0 ||
        !Number.isFinite(input.takeProfitPrice) || input.takeProfitPrice <= 0 ||
        !Number.isFinite(accountBalance) || accountBalance <= 0 ||
        !Number.isFinite(riskPercent) || riskPercent <= 0 ||
        !Number.isFinite(tickSize) || tickSize <= 0 ||
        !Number.isFinite(qtyStep) || qtyStep <= 0 ||
        !Number.isFinite(minOrderQty) || minOrderQty <= 0 ||
        !Number.isFinite(spread) || spread < 0 ||
        !Number.isFinite(slippageRate) || slippageRate < 0) {
      return this.invalidResult(direction, input.entryPrice, input.stopLossPrice, input.takeProfitPrice,
        'Parámetros financieros inválidos, ausentes o no finitos');
    }

    // Apply tickSize precision
    const entryPrice = this.roundToTick(input.entryPrice, tickSize);
    const stopLossPrice = this.roundToTick(input.stopLossPrice, tickSize);
    const takeProfitPrice = this.roundToTick(input.takeProfitPrice, tickSize);

    // Validate geometry
    if (direction === 'LONG') {
      if (stopLossPrice >= entryPrice) {
        return this.invalidResult(direction, entryPrice, stopLossPrice, takeProfitPrice, 'Stop Loss debe ser menor al precio de entrada en LONG');
      }
      if (takeProfitPrice <= entryPrice) {
        return this.invalidResult(direction, entryPrice, stopLossPrice, takeProfitPrice, 'Take Profit debe ser mayor al precio de entrada en LONG');
      }
    } else {
      if (stopLossPrice <= entryPrice) {
        return this.invalidResult(direction, entryPrice, stopLossPrice, takeProfitPrice, 'Stop Loss debe ser mayor al precio de entrada en SHORT');
      }
      if (takeProfitPrice >= entryPrice) {
        return this.invalidResult(direction, entryPrice, stopLossPrice, takeProfitPrice, 'Take Profit debe ser menor al precio de entrada en SHORT');
      }
    }

    const priceRiskPerUnit = Math.abs(entryPrice - stopLossPrice);
    const priceRewardPerUnit = Math.abs(takeProfitPrice - entryPrice);

    if (priceRiskPerUnit === 0) {
      return this.invalidResult(direction, entryPrice, stopLossPrice, takeProfitPrice, 'La distancia de riesgo es cero');
    }

    // Capital risk budget (e.g. 1.0% of $10,000 = $100)
    const targetRiskUSDT = accountBalance * (riskPercent / 100);

    // Fee calculations based on order types
    const entryRate = entryOrderType === 'MAKER' ? feeStructure.makerFeeRate : feeStructure.takerFeeRate;
    const exitSLRate = exitOrderTypeSL === 'MAKER' ? feeStructure.makerFeeRate : feeStructure.takerFeeRate;
    const exitTPRate = exitOrderTypeTP === 'MAKER' ? feeStructure.makerFeeRate : feeStructure.takerFeeRate;

    // Unit loss per BTC if Stop Loss is hit (including price distance, entry taker fee, exit SL taker fee, spread, slippage)
    const unitFeesSLPerBtc = (entryPrice * entryRate) + (stopLossPrice * exitSLRate);
    const unitSpreadSLPerBtc = spread * 0.5;
    const unitSlippageSLPerBtc = entryPrice * slippageRate;
    const totalRiskPerUnit = priceRiskPerUnit + unitFeesSLPerBtc + unitSpreadSLPerBtc + unitSlippageSLPerBtc;

    // Position sizing quantized strictly by qtyStep, solving so total loss at SL does not exceed targetRiskUSDT
    const rawQty = totalRiskPerUnit > 0 ? targetRiskUSDT / totalRiskPerUnit : 0;
    const steps = Math.floor(rawQty / qtyStep);
    let positionSizeBTC = parseFloat((steps * qtyStep).toFixed(4));

    // Cap by maximum allowable leverage (5.0x max leverage) to avoid liquidation risks and unrealistic margin exposure
    const maxLeverage = 5.0;
    const maxNotional = accountBalance * maxLeverage;
    const maxAllowedQty = Math.floor((maxNotional / entryPrice) / qtyStep) * qtyStep;
    if (positionSizeBTC > maxAllowedQty) {
      positionSizeBTC = parseFloat(maxAllowedQty.toFixed(4));
    }

    // Fail closed. Raising a calculated quantity to the exchange minimum would
    // exceed the configured loss/margin ceilings for small accounts.
    if (positionSizeBTC < minOrderQty) {
      return this.invalidResult(direction, entryPrice, stopLossPrice, takeProfitPrice,
        'Capital o riesgo insuficiente para cubrir el lote mínimo sin exceder el límite');
    }

    const notionalValueUSDT = parseFloat((positionSizeBTC * entryPrice).toFixed(2));
    const grossRiskUSDT = parseFloat((positionSizeBTC * priceRiskPerUnit).toFixed(2));
    const grossRewardUSDT = parseFloat((positionSizeBTC * priceRewardPerUnit).toFixed(2));
    const grossRR = parseFloat((grossRewardUSDT / grossRiskUSDT).toFixed(2));

    const entryFeeUSDT = parseFloat((notionalValueUSDT * entryRate).toFixed(3));
    const exitFeeTPUSDT = parseFloat(((positionSizeBTC * takeProfitPrice) * exitTPRate).toFixed(3));
    const exitFeeSLUSDT = parseFloat(((positionSizeBTC * stopLossPrice) * exitSLRate).toFixed(3));
    const totalFeesUSDT = parseFloat((entryFeeUSDT + exitFeeTPUSDT).toFixed(3));

    // Spread cost (only incurred when taking liquidity / crossing spread)
    const spreadCrossingFactor = (entryOrderType === 'TAKER' ? 0.5 : 0) + (exitOrderTypeTP === 'TAKER' ? 0.5 : 0);
    const spreadCostUSDT = parseFloat((positionSizeBTC * spread * spreadCrossingFactor).toFixed(3));

    // Slippage (only on market / taker orders)
    const slippageMultiplier = (entryOrderType === 'TAKER' ? 1 : 0) + (exitOrderTypeTP === 'TAKER' ? 1 : 0);
    const slippageCostUSDT = parseFloat((notionalValueUSDT * slippageRate * slippageMultiplier).toFixed(3));

    // Funding cost impact (if held across funding intervals)
    // Long pays if funding > 0, receives if funding < 0
    // Short receives if funding > 0, pays if funding < 0
    let fundingCostUSDT = 0;
    if (fundingSettlementsExpected > 0 && fundingRate !== 0) {
      const directionFactor = direction === 'LONG' ? 1 : -1;
      fundingCostUSDT = parseFloat(
        (notionalValueUSDT * fundingRate * directionFactor * fundingSettlementsExpected).toFixed(3)
      );
    }

    // Net loss (SL hit scenario)
    const netLossUSDT = parseFloat(
      (grossRiskUSDT + entryFeeUSDT + exitFeeSLUSDT + (positionSizeBTC * spread * 0.5) + (notionalValueUSDT * slippageRate)).toFixed(2)
    );

    // Net reward (TP hit scenario)
    const netRewardUSDT = parseFloat(
      (grossRewardUSDT - entryFeeUSDT - exitFeeTPUSDT - spreadCostUSDT - slippageCostUSDT - fundingCostUSDT).toFixed(2)
    );

    const netRR = netLossUSDT > 0 ? parseFloat((netRewardUSDT / netLossUSDT).toFixed(2)) : 0;

    const worstCaseLossUsdt = positionSizeBTC * totalRiskPerUnit;
    const withinRisk = Number.isFinite(worstCaseLossUsdt) &&
      worstCaseLossUsdt <= targetRiskUSDT + 1e-8;
    const withinLeverage = Number.isFinite(notionalValueUSDT) &&
      notionalValueUSDT <= maxNotional + 1e-8;
    const isValid = netRR >= minRequiredRR && positionSizeBTC >= minOrderQty &&
      withinRisk && withinLeverage;
    let rejectionReason: string | undefined;

    if (netRR < minRequiredRR) {
      rejectionReason = `Ratio R:R neto insuficiente: ${netRR.toFixed(2)} (requerido >= ${minRequiredRR.toFixed(1)} neto con comisiones y spread)`;
    } else if (positionSizeBTC < minOrderQty) {
      rejectionReason = `Tamaño de posición (${positionSizeBTC} BTC) inferior al mínimo permitido por Bybit (${minOrderQty} BTC)`;
    } else if (!withinRisk || !withinLeverage) {
      rejectionReason = `Riesgo o apalancamiento excedidos (pérdida potencial ${worstCaseLossUsdt.toFixed(4)} frente a ${targetRiskUSDT.toFixed(4)} USDT autorizados)`;
    }

    return {
      direction,
      entryPrice,
      stopLossPrice,
      takeProfitPrice,
      positionSizeBTC,
      notionalValueUSDT,
      grossRiskUSDT,
      grossRewardUSDT,
      grossRR,
      entryFeeUSDT,
      exitFeeTPUSDT,
      exitFeeSLUSDT,
      totalFeesUSDT,
      fundingCostUSDT,
      slippageCostUSDT,
      spreadCostUSDT,
      netLossUSDT,
      netRewardUSDT,
      netRR,
      isValid,
      rejectionReason,
    };
  }

  /**
   * Interactive calculator helper for UI and administration.
   * Calculates suggested BTC, fees, spread, slippage, and gross/net R:R.
   */
  public static calculateInteractive(params: {
    capitalUsdt: number;
    entryPrice: number;
    stopLossPrice: number;
    takeProfitPrice: number;
    maxRiskPercent?: number;
    maxRiskUsdt?: number;
    makerFeeRate?: number;
    takerFeeRate?: number;
    spread?: number;
    slippageRate?: number;
    tickSize?: number;
    qtyStep?: number;
    minRequiredRR?: number;
  }): RiskCalculationResult & { slDistanceUsdt: number; slDistancePercent: number } {
    const direction = params.takeProfitPrice > params.entryPrice ? 'LONG' : 'SHORT';
    const effectiveRiskByPercent = (params.capitalUsdt * (params.maxRiskPercent || 0.5)) / 100;
    const effectiveRiskUsdt = params.maxRiskUsdt ? Math.min(effectiveRiskByPercent, params.maxRiskUsdt) : effectiveRiskByPercent;

    const baseResult = this.calculate({
      direction,
      entryPrice: params.entryPrice,
      stopLossPrice: params.stopLossPrice,
      takeProfitPrice: params.takeProfitPrice,
      accountBalance: params.capitalUsdt,
      riskPercent: (effectiveRiskUsdt / params.capitalUsdt) * 100,
      tickSize: params.tickSize || 0.1,
      qtyStep: params.qtyStep || 0.001,
      spread: params.spread || 0.1,
      slippageRate: params.slippageRate || 0.0002,
      minRequiredRR: params.minRequiredRR || 4.0,
      feeStructure: {
        makerFeeRate: params.makerFeeRate || 0.0002,
        takerFeeRate: params.takerFeeRate || 0.00055,
      },
    });

    const slDistanceUsdt = Math.abs(params.entryPrice - params.stopLossPrice);
    const slDistancePercent = params.entryPrice > 0 ? (slDistanceUsdt / params.entryPrice) * 100 : 0;

    return {
      ...baseResult,
      slDistanceUsdt: parseFloat(slDistanceUsdt.toFixed(2)),
      slDistancePercent: parseFloat(slDistancePercent.toFixed(2)),
    };
  }

  /**
   * Analytically solves for the exact take profit price required to achieve
   * a specific net Risk/Reward ratio after deducting maker/taker fees, spread, and slippage.
   */
  public static solveTargetPriceForNetRR(params: {
    direction: 'LONG' | 'SHORT';
    entryPrice: number;
    stopLossPrice: number;
    targetNetRR: number;
    accountBalance?: number;
    riskPercent?: number;
    spread?: number;
    slippageRate?: number;
    makerFeeRate?: number;
    takerFeeRate?: number;
    tickSize?: number;
    qtyStep?: number;
  }): number {
    const {
      direction,
      entryPrice,
      stopLossPrice,
      targetNetRR,
      accountBalance = 10000,
      riskPercent = 1.0,
      spread = 0.1,
      slippageRate = 0.0002,
      makerFeeRate = 0.0002,
      takerFeeRate = 0.00055,
      tickSize = 0.1,
      qtyStep = 0.001,
    } = params;

    // Use dummy TP to obtain accurate position size and net loss
    const dummyTp = direction === 'LONG' ? entryPrice + 1000 : entryPrice - 1000;
    const baseCalc = this.calculate({
      direction,
      entryPrice,
      stopLossPrice,
      takeProfitPrice: dummyTp,
      accountBalance,
      riskPercent,
      spread,
      slippageRate,
      tickSize,
      qtyStep,
      feeStructure: { makerFeeRate, takerFeeRate },
      minRequiredRR: 0.1,
    });

    const posBTC = baseCalc.positionSizeBTC;
    if (posBTC <= 0) return dummyTp;

    const netLoss = baseCalc.netLossUSDT;
    const entryFee = baseCalc.entryFeeUSDT;
    const spreadCost = baseCalc.spreadCostUSDT;
    const slippageCost = baseCalc.slippageCostUSDT;

    const numerator = targetNetRR * netLoss + entryFee + posBTC * entryPrice * makerFeeRate + spreadCost + slippageCost;
    const denominator = posBTC * (1 - makerFeeRate);
    const deltaPrice = numerator / denominator;

    const solvedPrice = direction === 'LONG' ? entryPrice + deltaPrice : entryPrice - deltaPrice;
    const factor = Math.round(1 / tickSize);
    return Math.round(solvedPrice * factor) / factor;
  }

  /**
   * Evaluates a setup against both 1:2 and 1:4 Risk/Reward targets using real structural levels.
   * "La distancia del objetivo NO debe calcularse arbitrariamente para obtener un ratio deseado.
   *  Primero:
   *  1. Encontrar entrada válida.
   *  2. Determinar Stop Loss estructural.
   *  3. Identificar objetivos técnicos reales.
   *  4. Calcular costos.
   *  5. Verificar el R:R neto.
   *  6. Clasificar la oportunidad."
   */
  public static calculateDualTargets(params: {
    direction: 'LONG' | 'SHORT';
    entryPrice: number;
    stopLossPrice: number;
    candidateTargets: number[];
    explicit12Price?: number;
    explicit14Price?: number;
    accountBalance?: number;
    riskPercent?: number;
    tickSize?: number;
    qtyStep?: number;
    spread?: number;
    slippageRate?: number;
    feeStructure?: FeeStructure;
    minRRShort?: number; // default 2.0
    minRRExtended?: number; // default 4.0
  }): DualRiskRewardResult {
    const {
      direction,
      entryPrice,
      stopLossPrice,
      candidateTargets,
      explicit12Price,
      explicit14Price,
      accountBalance = 10000,
      riskPercent = 0.5,
      tickSize = 0.1,
      qtyStep = 0.001,
      spread = 0.1,
      slippageRate = 0.0002,
      feeStructure,
      minRRShort = 2.0,
      minRRExtended = 4.0,
    } = params;

    const notes: string[] = [];

    // Filter candidate targets by direction
    const validTargets = (candidateTargets || []).filter((tp) =>
      direction === 'LONG' ? tp > entryPrice : tp < entryPrice
    );

    // Calculate all possible targets with exact net R:R
    const evaluatedTargets = validTargets.map((tp) => {
      const res = this.calculate({
        direction,
        entryPrice,
        stopLossPrice,
        takeProfitPrice: tp,
        accountBalance,
        riskPercent,
        tickSize,
        qtyStep,
        spread,
        slippageRate,
        feeStructure,
        minRequiredRR: 0, // calculate raw net RR
      });
      return { price: tp, result: res };
    });

    // Check 1:2 target
    let target12Price = explicit12Price;
    let calculation12: RiskCalculationResult | undefined;

    if (target12Price) {
      calculation12 = this.calculate({
        direction,
        entryPrice,
        stopLossPrice,
        takeProfitPrice: target12Price,
        accountBalance,
        riskPercent,
        tickSize,
        qtyStep,
        spread,
        slippageRate,
        feeStructure,
        minRequiredRR: minRRShort,
      });
    } else {
      // Find the closest structural level that achieves at least minRRShort
      const match12 = evaluatedTargets
        .filter((t) => t.result.isValid && t.result.netRR >= minRRShort)
        .sort((a, b) => a.result.netRR - b.result.netRR)[0];
      if (match12) {
        target12Price = match12.price;
        calculation12 = match12.result;
      }
    }

    // Check 1:4 target
    let target14Price = explicit14Price;
    let calculation14: RiskCalculationResult | undefined;

    if (target14Price) {
      calculation14 = this.calculate({
        direction,
        entryPrice,
        stopLossPrice,
        takeProfitPrice: target14Price,
        accountBalance,
        riskPercent,
        tickSize,
        qtyStep,
        spread,
        slippageRate,
        feeStructure,
        minRequiredRR: minRRExtended,
      });
    } else {
      // Find the structural level that achieves at least minRRExtended
      const match14 = evaluatedTargets
        .filter((t) => t.result.isValid && t.result.netRR >= minRRExtended)
        .sort((a, b) => a.result.netRR - b.result.netRR)[0];
      if (match14) {
        target14Price = match14.price;
        calculation14 = match14.result;
      }
    }

    const is12Qualified = !!calculation12 && calculation12.isValid && calculation12.netRR >= minRRShort;
    const is14Qualified = !!calculation14 && calculation14.isValid && calculation14.netRR >= minRRExtended;

    let qualifiedMode: 'RR_1_2' | 'RR_1_4' | 'RR_BOTH' | 'NONE' = 'NONE';
    if (is12Qualified && is14Qualified) {
      qualifiedMode = 'RR_BOTH';
      notes.push(`Oportunidad con recorrido estructural amplio: califica para 1:2 (Net R:R ${calculation12?.netRR.toFixed(2)}) y 1:4 (Net R:R ${calculation14?.netRR.toFixed(2)})`);
    } else if (is14Qualified) {
      qualifiedMode = 'RR_1_4';
      notes.push(`Califica para 1:4 extendido (Net R:R ${calculation14?.netRR.toFixed(2)})`);
    } else if (is12Qualified) {
      qualifiedMode = 'RR_1_2';
      notes.push(`Califica exclusivamente para 1:2 corto (Net R:R ${calculation12?.netRR.toFixed(2)}), sin recorrido verificado hasta 1:4`);
    } else {
      qualifiedMode = 'NONE';
      notes.push('No califica: ningún nivel estructural técnico alcanza el ratio beneficio/riesgo neto mínimo');
    }

    return {
      direction,
      entryPrice,
      stopLossPrice,
      target12Price,
      target14Price,
      calculation12,
      calculation14,
      qualifiedMode,
      rejectionReason: qualifiedMode === 'NONE' ? notes[0] : undefined,
      notes,
    };
  }

  private static invalidResult(
    direction: 'LONG' | 'SHORT',
    entry: number,
    sl: number,
    tp: number,
    reason: string
  ): RiskCalculationResult {
    return {
      direction,
      entryPrice: entry,
      stopLossPrice: sl,
      takeProfitPrice: tp,
      positionSizeBTC: 0,
      notionalValueUSDT: 0,
      grossRiskUSDT: 0,
      grossRewardUSDT: 0,
      grossRR: 0,
      entryFeeUSDT: 0,
      exitFeeTPUSDT: 0,
      exitFeeSLUSDT: 0,
      totalFeesUSDT: 0,
      fundingCostUSDT: 0,
      slippageCostUSDT: 0,
      spreadCostUSDT: 0,
      netLossUSDT: 0,
      netRewardUSDT: 0,
      netRR: 0,
      isValid: false,
      rejectionReason: reason,
    };
  }
}
