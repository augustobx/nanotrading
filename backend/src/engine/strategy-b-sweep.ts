import { Candle, Timeframe } from '../types/market.js';
import { SmcDetector, MarketStructureResult } from './smc-detector.js';
import { RiskCalculator, RiskCalculationResult } from './risk-calculator.js';
import { SetupCandidate } from './strategy-a-trend.js';

export class StrategyBLiquiditySweep {
  public static evaluate(
    candles1h: Candle[],
    candles15m: Candle[],
    candles5m: Candle[],
    spread: number = 0.1
  ): SetupCandidate | null {
    if (candles1h.length < 20 || candles15m.length < 20 || candles5m.length < 20) {
      return null;
    }

    const struct1h = SmcDetector.analyzeStructure(candles1h, '1h');
    const struct15m = SmcDetector.analyzeStructure(candles15m, '15m');
    const struct5m = SmcDetector.analyzeStructure(candles5m, '5m');

    const lastCandle5m = candles5m[candles5m.length - 1];
    const currentPrice = lastCandle5m.close;

    // LONG Setup (Bullish Liquidity Sweep & Reversal):
    // 1. A recent Bullish Liquidity Sweep occurred on 15m or 1H (sweep below lows, close above)
    const recentBullSweep = [...struct15m.sweeps, ...struct1h.sweeps]
      .filter((s) => s.direction === 'BULLISH' && s.candleTimestamp >= lastCandle5m.timestamp - 3 * 3600 * 1000)
      .pop();

    if (recentBullSweep) {
      // 2. Micro confirmation on 5m: Bullish CHoCH
      const bullChoch = [...struct5m.structureBreaks].reverse().find(
        (b) => b.type === 'CHoCH' && b.direction === 'BULLISH' && b.candleIndex >= candles5m.length - 6
      );

      if (bullChoch) {
        const entryPrice = currentPrice;
        const stopLossPrice = parseFloat((recentBullSweep.wickExtreme - 10.0).toFixed(1)); // Strictly below sweep wick

        // Structural Target: Opposing 1H or 15m swing high / EQH
        const targetHigh = struct1h.lastSwingHigh?.price || struct15m.lastSwingHigh?.price;
        if (targetHigh && targetHigh > entryPrice) {
          const takeProfitPrice = parseFloat(targetHigh.toFixed(1));

          const riskReward = RiskCalculator.calculate({
            direction: 'LONG',
            entryPrice,
            stopLossPrice,
            takeProfitPrice,
            spread,
            minRequiredRR: 4.0,
          });

          if (riskReward.isValid) {
            return {
              id: `setup_stratB_long_${lastCandle5m.timestamp}`,
              strategy: 'STRATEGY_B_LIQUIDITY_SWEEP_REVERSAL',
              symbol: lastCandle5m.symbol,
              direction: 'LONG',
              timeframe: '15m',
              timestamp: lastCandle5m.timestamp,
              entryPrice,
              stopLossPrice,
              takeProfitPrice,
              riskReward,
              status: 'QUALIFIED',
              evidence: {
                macroTrend: `1H: ${struct1h.trend}`,
                triggerReason: `Barrido de liquidez bajo ${recentBullSweep.sweptLevel} (${recentBullSweep.poolType}) con mecha de rechazo en $${recentBullSweep.wickExtreme} y confirmación de CHoCH en 5m`,
                invalidationReason: `Ruptura del mínimo de mecha en $${stopLossPrice}`,
                confluencePoints: [
                  `Barrido de liquidez ${recentBullSweep.poolType} ejecutado`,
                  'Rechazo verificado con cierre por encima del nivel',
                  'Gatillo de confirmación micro CHoCH en 5m',
                  `Ratio R:R neto ${riskReward.netRR}:1 verificable`,
                ],
                structuralTarget: `Piscina de liquidez opuesta / Swing High en $${takeProfitPrice}`,
              },
            };
          }
        }
      }
    }

    // SHORT Setup (Bearish Liquidity Sweep & Reversal):
    // 1. A recent Bearish Liquidity Sweep occurred on 15m or 1H (sweep above highs, close below)
    const recentBearSweep = [...struct15m.sweeps, ...struct1h.sweeps]
      .filter((s) => s.direction === 'BEARISH' && s.candleTimestamp >= lastCandle5m.timestamp - 3 * 3600 * 1000)
      .pop();

    if (recentBearSweep) {
      // 2. Micro confirmation on 5m: Bearish CHoCH
      const bearChoch = [...struct5m.structureBreaks].reverse().find(
        (b) => b.type === 'CHoCH' && b.direction === 'BEARISH' && b.candleIndex >= candles5m.length - 6
      );

      if (bearChoch) {
        const entryPrice = currentPrice;
        const stopLossPrice = parseFloat((recentBearSweep.wickExtreme + 10.0).toFixed(1)); // Strictly above sweep wick

        // Structural Target: Opposing 1H or 15m swing low / EQL
        const targetLow = struct1h.lastSwingLow?.price || struct15m.lastSwingLow?.price;
        if (targetLow && targetLow < entryPrice) {
          const takeProfitPrice = parseFloat(targetLow.toFixed(1));

          const riskReward = RiskCalculator.calculate({
            direction: 'SHORT',
            entryPrice,
            stopLossPrice,
            takeProfitPrice,
            spread,
            minRequiredRR: 4.0,
          });

          if (riskReward.isValid) {
            return {
              id: `setup_stratB_short_${lastCandle5m.timestamp}`,
              strategy: 'STRATEGY_B_LIQUIDITY_SWEEP_REVERSAL',
              symbol: lastCandle5m.symbol,
              direction: 'SHORT',
              timeframe: '15m',
              timestamp: lastCandle5m.timestamp,
              entryPrice,
              stopLossPrice,
              takeProfitPrice,
              riskReward,
              status: 'QUALIFIED',
              evidence: {
                macroTrend: `1H: ${struct1h.trend}`,
                triggerReason: `Barrido de liquidez sobre ${recentBearSweep.sweptLevel} (${recentBearSweep.poolType}) con mecha de rechazo en $${recentBearSweep.wickExtreme} y confirmación de CHoCH en 5m`,
                invalidationReason: `Ruptura del máximo de mecha en $${stopLossPrice}`,
                confluencePoints: [
                  `Barrido de liquidez ${recentBearSweep.poolType} ejecutado`,
                  'Rechazo verificado con cierre por debajo del nivel',
                  'Gatillo de confirmación micro CHoCH en 5m',
                  `Ratio R:R neto ${riskReward.netRR}:1 verificable`,
                ],
                structuralTarget: `Piscina de liquidez opuesta / Swing Low en $${takeProfitPrice}`,
              },
            };
          }
        }
      }
    }

    return null;
  }
}
