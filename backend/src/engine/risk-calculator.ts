export interface RiskCalculationInput {
  direction: 'LONG' | 'SHORT';
  entryPrice: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  accountBalance?: number;
  riskPercent?: number; // e.g. 0.5%
  spread?: number; // USDT spread
  tickSize?: number;
  qtyStep?: number;
  minOrderQty?: number;
  takerFeeRate?: number; // Bybit default 0.055% = 0.00055
  slippageRate?: number; // Default 0.02% = 0.0002
  minRequiredRR?: number; // Default 4.0
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
  totalFeesUSDT: number;
  slippageCostUSDT: number;
  spreadCostUSDT: number;
  netLossUSDT: number;
  netRewardUSDT: number;
  netRR: number;
  isValid: boolean;
  rejectionReason?: string;
}

export class RiskCalculator {
  public static calculate(input: RiskCalculationInput): RiskCalculationResult {
    const {
      direction,
      entryPrice,
      stopLossPrice,
      takeProfitPrice,
      accountBalance = 10000,
      riskPercent = 0.5,
      spread = 0.1,
      qtyStep = 0.001,
      minOrderQty = 0.001,
      takerFeeRate = 0.00055,
      slippageRate = 0.0002,
      minRequiredRR = 4.0,
    } = input;

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

    // Capital risk allowance (e.g. 0.5% of 10,000 = $50)
    const targetRiskUSDT = accountBalance * (riskPercent / 100);

    // Raw position sizing
    let rawQty = targetRiskUSDT / priceRiskPerUnit;

    // Quantize to Bybit qtyStep (0.001)
    const steps = Math.floor(rawQty / qtyStep);
    let positionSizeBTC = parseFloat((steps * qtyStep).toFixed(4));

    if (positionSizeBTC < minOrderQty) {
      positionSizeBTC = minOrderQty;
    }

    const notionalValueUSDT = parseFloat((positionSizeBTC * entryPrice).toFixed(2));
    const grossRiskUSDT = parseFloat((positionSizeBTC * priceRiskPerUnit).toFixed(2));
    const grossRewardUSDT = parseFloat((positionSizeBTC * priceRewardPerUnit).toFixed(2));
    const grossRR = parseFloat((grossRewardUSDT / grossRiskUSDT).toFixed(2));

    // Costs estimation
    const entryFee = notionalValueUSDT * takerFeeRate;
    const exitFeeTP = (positionSizeBTC * takeProfitPrice) * takerFeeRate;
    const exitFeeSL = (positionSizeBTC * stopLossPrice) * takerFeeRate;
    const totalFeesUSDT = parseFloat((entryFee + exitFeeTP).toFixed(3));
    const spreadCostUSDT = parseFloat((positionSizeBTC * spread).toFixed(3));
    const slippageCostUSDT = parseFloat((notionalValueUSDT * slippageRate * 2).toFixed(3));

    // Net calculations
    const netLossUSDT = parseFloat(
      (grossRiskUSDT + entryFee + exitFeeSL + spreadCostUSDT + slippageCostUSDT).toFixed(2)
    );
    const netRewardUSDT = parseFloat(
      (grossRewardUSDT - (entryFee + exitFeeTP + spreadCostUSDT + slippageCostUSDT)).toFixed(2)
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
      totalFeesUSDT,
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
      totalFeesUSDT: 0,
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
