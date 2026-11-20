import test from 'node:test';
import assert from 'node:assert/strict';
import { RiskCalculator } from '../../src/engine/risk-calculator.js';

test('RiskCalculator - validates genuine 1:4 Net R:R with Bybit fees and slippage', () => {
  // Long setup: Entry 60000, SL 59800 (risk 200), TP 61500 (reward 1500)
  // Gross R:R = 1500 / 200 = 7.5
  // After taker fees (0.11% round-trip on $15k notional) and slippage, Net R:R is ~4.8 >= 4.0
  const result = RiskCalculator.calculate({
    direction: 'LONG',
    entryPrice: 60000,
    stopLossPrice: 59800,
    takeProfitPrice: 61500,
    accountBalance: 10000,
    riskPercent: 0.5, // $50 risk budget
    spread: 0.1,
    takerFeeRate: 0.00055,
    slippageRate: 0.0002,
    minRequiredRR: 4.0,
  });

  assert.equal(result.isValid, true);
  assert.ok(result.netRR >= 4.0, `Expected netRR >= 4.0, got ${result.netRR}`);
  assert.ok(result.totalFeesUSDT > 0, 'Must deduct trading fees');
  assert.ok(result.slippageCostUSDT > 0, 'Must deduct slippage');
  assert.ok(result.positionSizeBTC >= 0.001, 'Must satisfy Bybit minOrderQty');
});

test('RiskCalculator - rejects setup when Net R:R falls below 1:4 due to costs', () => {
  // Long setup: Entry 60000, SL 59750 (risk 250), TP 60800 (reward 800)
  // Gross R:R = 800 / 250 = 3.2 (less than 4)
  const result = RiskCalculator.calculate({
    direction: 'LONG',
    entryPrice: 60000,
    stopLossPrice: 59750,
    takeProfitPrice: 60800,
    accountBalance: 10000,
    riskPercent: 0.5,
    minRequiredRR: 4.0,
  });

  assert.equal(result.isValid, false);
  assert.ok(result.netRR < 4.0);
  assert.ok(result.rejectionReason?.includes('insuficiente'));
});

test('RiskCalculator - rejects inverted Stop Loss for SHORT and LONG', () => {
  // Long setup with SL above entry
  const badLong = RiskCalculator.calculate({
    direction: 'LONG',
    entryPrice: 60000,
    stopLossPrice: 60500, // Invalid: above entry
    takeProfitPrice: 62000,
  });
  assert.equal(badLong.isValid, false);

  // Short setup with SL below entry
  const badShort = RiskCalculator.calculate({
    direction: 'SHORT',
    entryPrice: 60000,
    stopLossPrice: 59500, // Invalid: below entry
    takeProfitPrice: 58000,
  });
  assert.equal(badShort.isValid, false);
});
