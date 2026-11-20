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

    // Capital risk budget (e.g. 0.5% of $10,000 = $50)
    const targetRiskUSDT = accountBalance * (riskPercent / 100);

    // Position sizing quantized strictly by qtyStep
    const rawQty = targetRiskUSDT / priceRiskPerUnit;
    const steps = Math.floor(rawQty / qtyStep);
    let positionSizeBTC = parseFloat((steps * qtyStep).toFixed(4));

    if (positionSizeBTC < minOrderQty) {
      positionSizeBTC = minOrderQty;
    }

    const notionalValueUSDT = parseFloat((positionSizeBTC * entryPrice).toFixed(2));
    const grossRiskUSDT = parseFloat((positionSizeBTC * priceRiskPerUnit).toFixed(2));
    const grossRewardUSDT = parseFloat((positionSizeBTC * priceRewardPerUnit).toFixed(2));
    const grossRR = parseFloat((grossRewardUSDT / grossRiskUSDT).toFixed(2));

    // Fee calculations based on order types
    const entryRate = entryOrderType === 'MAKER' ? feeStructure.makerFeeRate : feeStructure.takerFeeRate;
    const exitSLRate = exitOrderTypeSL === 'MAKER' ? feeStructure.makerFeeRate : feeStructure.takerFeeRate;
    const exitTPRate = exitOrderTypeTP === 'MAKER' ? feeStructure.makerFeeRate : feeStructure.takerFeeRate;

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

    const isValid = netRR >= minRequiredRR && positionSizeBTC >= minOrderQty;
    let rejectionReason: string | undefined;

    if (netRR < minRequiredRR) {
      rejectionReason = `Ratio R:R neto insuficiente: ${netRR.toFixed(2)} (requerido >= ${minRequiredRR.toFixed(1)} neto con comisiones y spread)`;
    } else if (positionSizeBTC < minOrderQty) {
      rejectionReason = `Tamaño de posición (${positionSizeBTC} BTC) inferior al mínimo permitido por Bybit (${minOrderQty} BTC)`;
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
