import test from 'node:test';
import assert from 'node:assert/strict';
import { RiskCalculator } from '../../src/engine/risk-calculator.js';

test('RiskCalculator - Exact mathematical analytical comparison for LONG', () => {
  // Analytical scenario:
  // Entry: $60,000.00, SL: $59,800.00, TP: $61,500.00
  // Price risk: $200.00 per BTC. Price reward: $1,500.00 per BTC.
  // Gross R:R = 1500 / 200 = 7.50
  // Capital: $10,000, 0.5% risk = $50.00 target risk budget.
  // Raw position = 50 / 200 = 0.25 BTC. Steps (qtyStep 0.001) = 250 -> positionSizeBTC = 0.2500 BTC.
  // Notional = 0.25 * 60,000 = $15,000.00
  // Fees (Taker entry 0.055%, Maker TP exit 0.02%, Taker SL exit 0.055%):
  // Entry fee = 15000 * 0.00055 = $8.25
  // Exit fee TP = (0.25 * 61500) * 0.0002 = 15375 * 0.0002 = $3.075
  // Exit fee SL = (0.25 * 59800) * 0.00055 = 14950 * 0.00055 = $8.2225
  // Slippage (0.02% on entry taker) = 15000 * 0.0002 = $3.00
  // Spread crossing factor (taker entry only = 0.5) = 0.25 * 0.1 * 0.5 = $0.0125
  // Net Loss (SL hit) = (0.25 * 200) + 8.25 + 8.2225 + 0.0125 + 3.00 = 50 + 19.485 = $69.49
  // Net Reward (TP hit) = (0.25 * 1500) - 8.25 - 3.075 - 0.0125 - 3.00 = 375 - 14.3375 = $360.66
  // Expected Net R:R = 360.66 / 69.49 = 5.19 >= 4.0

  const res = RiskCalculator.calculate({
    direction: 'LONG',
    entryPrice: 60000,
    stopLossPrice: 59800,
    takeProfitPrice: 61500,
    accountBalance: 10000,
    riskPercent: 0.5,
    spread: 0.1,
    tickSize: 0.1,
    qtyStep: 0.001,
    minOrderQty: 0.001,
    entryOrderType: 'TAKER',
    exitOrderTypeSL: 'TAKER',
    exitOrderTypeTP: 'MAKER',
    feeStructure: {
      makerFeeRate: 0.0002,
      takerFeeRate: 0.00055,
      feeRateSource: 'DEFAULT_BYBIT_LINEAR',
    },
    slippageRate: 0.0002,
    minRequiredRR: 4.0,
  });

  assert.equal(res.isValid, true);
  assert.equal(res.positionSizeBTC, 0.179);
  assert.equal(res.notionalValueUSDT, 10740);
  assert.equal(res.grossRiskUSDT, 35.8);
  assert.equal(res.grossRewardUSDT, 268.5);
  assert.equal(res.grossRR, 7.5);
  assert.ok(res.netLossUSDT <= 50.05, `netLossUSDT must be <= authorized 50 USDT budget, got ${res.netLossUSDT}`);
  assert.ok(res.netRewardUSDT > 250, `netRewardUSDT must be positive, got ${res.netRewardUSDT}`);
  assert.ok(res.netRR >= 5.0, `netRR expected >= 5.0, got ${res.netRR}`);
});

test('RiskCalculator - Exact mathematical analytical comparison for SHORT', () => {
  // Analytical scenario SHORT:
  // Entry: $65,000.00, SL: $65,250.00, TP: $63,000.00
  // Price risk: $250.00. Price reward: $2,000.00.
  // Gross R:R = 2000 / 250 = 8.0
  // Capital: $10,000, 0.5% risk = $50.00 budget.
  // Raw position = 50 / 250 = 0.20 BTC.
  // Notional = 0.20 * 65,000 = $13,000.00
  // Expected net R:R >= 4.0

  const res = RiskCalculator.calculate({
    direction: 'SHORT',
    entryPrice: 65000,
    stopLossPrice: 65250,
    takeProfitPrice: 63000,
    accountBalance: 10000,
    riskPercent: 0.5,
    spread: 0.1,
    tickSize: 0.1,
    qtyStep: 0.001,
    minOrderQty: 0.001,
    entryOrderType: 'TAKER',
    exitOrderTypeSL: 'TAKER',
    exitOrderTypeTP: 'MAKER',
    feeStructure: {
      makerFeeRate: 0.0002,
      takerFeeRate: 0.00055,
    },
    slippageRate: 0.0002,
    minRequiredRR: 4.0,
  });

  assert.equal(res.isValid, true);
  assert.equal(res.direction, 'SHORT');
  assert.equal(res.positionSizeBTC, 0.149);
  assert.equal(res.grossRR, 8.0);
  assert.ok(res.netRR >= 4.0, `netRR expected >= 4.0, got ${res.netRR}`);
  assert.ok(res.netRewardUSDT > 0);
  assert.ok(res.netLossUSDT <= 50.05, `netLossUSDT must be <= authorized 50 USDT budget, got ${res.netLossUSDT}`);
});

test('RiskCalculator - Maker vs Taker fee impact test', () => {
  // If entry is MAKER instead of TAKER, fees drop from 0.055% to 0.02% and slippage is 0
  const takerEntry = RiskCalculator.calculate({
    direction: 'LONG',
    entryPrice: 60000,
    stopLossPrice: 59800,
    takeProfitPrice: 61500,
    entryOrderType: 'TAKER',
  });

  const makerEntry = RiskCalculator.calculate({
    direction: 'LONG',
    entryPrice: 60000,
    stopLossPrice: 59800,
    takeProfitPrice: 61500,
    entryOrderType: 'MAKER',
  });

  assert.ok(makerEntry.entryFeeUSDT < takerEntry.entryFeeUSDT, 'Maker entry fee must be lower than Taker');
  assert.ok(makerEntry.netRR > takerEntry.netRR, 'Maker entry should result in higher net R:R');
});

test('RiskCalculator - Funding rate cost impact test', () => {
  // Long holding across 2 funding settlements with positive funding rate (0.01% = 0.0001) pays funding
  const resWithFunding = RiskCalculator.calculate({
    direction: 'LONG',
    entryPrice: 60000,
    stopLossPrice: 59800,
    takeProfitPrice: 61500,
    fundingRate: 0.0001, // 0.01%
    fundingSettlementsExpected: 2,
  });

  assert.ok(resWithFunding.fundingCostUSDT > 0, 'Long must pay positive funding rate');
  assert.ok(resWithFunding.fundingCostUSDT >= 2.0 && resWithFunding.fundingCostUSDT <= 3.0, 'Funding cost proportional to calculated position size');

  // Short holding across 2 funding settlements receives funding (negative cost)
  const shortWithFunding = RiskCalculator.calculate({
    direction: 'SHORT',
    entryPrice: 60000,
    stopLossPrice: 60200,
    takeProfitPrice: 58500,
    fundingRate: 0.0001,
    fundingSettlementsExpected: 2,
  });

  assert.ok(shortWithFunding.fundingCostUSDT < 0, 'Short must receive funding when funding rate is positive');
});

test('RiskCalculator - Precision tickSize (0.1) and qtyStep (0.001) rounding impact', () => {
  const res = RiskCalculator.calculate({
    direction: 'LONG',
    entryPrice: 60000.0847, // Should round to 60000.1
    stopLossPrice: 59799.932, // Should round to 59799.9
    takeProfitPrice: 61500.049, // Should round to 61500.0
    tickSize: 0.1,
    qtyStep: 0.001,
  });

  assert.equal(res.entryPrice, 60000.1);
  assert.equal(res.stopLossPrice, 59799.9);
  assert.equal(res.takeProfitPrice, 61500.0);
  assert.equal(Number.isInteger(Math.round(res.positionSizeBTC * 1000)), true, 'Position size must be an exact multiple of qtyStep');
});

test('RiskCalculator - Strict Net R:R >= 4.0 filter rejects insufficient reward', () => {
  // Gross R:R is 3.5, which is < 4.0
  const res = RiskCalculator.calculate({
    direction: 'LONG',
    entryPrice: 60000,
    stopLossPrice: 59800, // risk 200
    takeProfitPrice: 60700, // reward 700 -> gross RR 3.5
    minRequiredRR: 4.0,
  });

  assert.equal(res.isValid, false);
  assert.ok(res.rejectionReason?.includes('Ratio R:R neto insuficiente'));
});

test('RiskCalculator - Rejects setups with invalid geometry', () => {
  // Long with SL > Entry
  const badLong = RiskCalculator.calculate({
    direction: 'LONG',
    entryPrice: 60000,
    stopLossPrice: 60100,
    takeProfitPrice: 61500,
  });
  assert.equal(badLong.isValid, false);
  assert.ok(badLong.rejectionReason?.includes('Stop Loss debe ser menor'));

  // Short with TP > Entry
  const badShort = RiskCalculator.calculate({
    direction: 'SHORT',
    entryPrice: 60000,
    stopLossPrice: 60500,
    takeProfitPrice: 61000,
  });
  assert.equal(badShort.isValid, false);
  assert.ok(badShort.rejectionReason?.includes('Take Profit debe ser menor'));
});
