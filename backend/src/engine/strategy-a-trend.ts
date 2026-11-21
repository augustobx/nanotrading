import { Candle, Timeframe } from '../types/market.js';
import { SmcDetector, MarketStructureResult } from './smc-detector.js';
import { RiskCalculator, RiskCalculationResult } from './risk-calculator.js';

export interface SetupCandidate {
  id: string;
  strategy: 'STRATEGY_A_TREND_CONTINUATION' | 'STRATEGY_B_LIQUIDITY_SWEEP_REVERSAL';
  symbol: string;
  direction: 'LONG' | 'SHORT';
  timeframe: Timeframe;
  timestamp: number;
  entryPrice: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  riskReward: RiskCalculationResult;
  status: 'PENDING_CONFIRMATION' | 'QUALIFIED' | 'INVALIDATED';
  evidence: {
    macroTrend: string;
    triggerReason: string;
    invalidationReason: string;
    confluencePoints: string[];
    structuralTarget: string;
  };
}

export class StrategyATrendContinuation {
  public static evaluate(
    candles4h: Candle[],
    candles1h: Candle[],
    candles15m: Candle[],
    candles5m: Candle[],
    spread: number = 0.1
  ): SetupCandidate | null {
    if (candles4h.length < 20 || candles1h.length < 20 || candles15m.length < 20 || candles5m.length < 20) {
      return null;
    }

    const struct4h = SmcDetector.analyzeStructure(candles4h, '4h');
    const struct1h = SmcDetector.analyzeStructure(candles1h, '1h');
    const struct15m = SmcDetector.analyzeStructure(candles15m, '15m');
    const struct5m = SmcDetector.analyzeStructure(candles5m, '5m');

    const lastCandle5m = candles5m[candles5m.length - 1];
    const currentPrice = lastCandle5m.close;

    // LONG Setup Conditions:
    // 1. 4H or 1H is Bullish
    const isHigherTfBullish = struct4h.trend === 'BULLISH' || struct1h.trend === 'BULLISH';
    if (isHigherTfBullish) {
      // Find active Bullish FVG or Order Block on 15m
      const activeFvg = [...struct15m.fvgs].reverse().find((f) => f.type === 'BULLISH' && f.status === 'ACTIVE');
      const activeOb = [...struct15m.orderBlocks].reverse().find((o) => o.type === 'BULLISH' && o.status === 'ACTIVE');

      const demandZone = activeFvg ? { top: activeFvg.top, bottom: activeFvg.bottom } : activeOb ? { top: activeOb.top, bottom: activeOb.bottom } : null;

      if (demandZone && currentPrice >= demandZone.bottom && currentPrice <= demandZone.top * 1.002) {
        // Micro confirmation on 5m: Bullish BOS or CHoCH
        const recentBullBreak = [...struct5m.structureBreaks].reverse().find(
          (b) => b.direction === 'BULLISH' && b.candleIndex >= candles5m.length - 8
        );

        if (recentBullBreak) {
          const entryPrice = currentPrice;
          const stopLossPrice = parseFloat((demandZone.bottom - 15.0).toFixed(1)); // Buffer below zone
          
          // Structural Target: Recent 1H or 4H swing high
          const targetHigh = struct1h.lastSwingHigh?.price || struct4h.lastSwingHigh?.price;
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
                id: `setup_stratA_long_${lastCandle5m.timestamp}`,
                strategy: 'STRATEGY_A_TREND_CONTINUATION',
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
                  macroTrend: `4H: ${struct4h.trend}, 1H: ${struct1h.trend}`,
                  triggerReason: `Retroceso a zona de demanda 15m (${demandZone.bottom} - ${demandZone.top}) con confirmación de ${recentBullBreak.type} en 5m`,
                  invalidationReason: `Cierre de vela 5m por debajo de ${stopLossPrice}`,
                  confluencePoints: [
                    'Sesgo mayor alcista confirmado',
                    'Mitigación de zona de demanda 15m',
                    `Confirmación de microestructura ${recentBullBreak.type} en 5m`,
                    `Ratio R:R neto ${riskReward.netRR}:1 verificable con comisiones`,
                  ],
                  structuralTarget: `Swing High estructural 1H en $${takeProfitPrice}`,
                },
              };
            }
          }
        }
      }
    }

    // SHORT Setup Conditions:
    // 1. 4H or 1H is Bearish
    const isHigherTfBearish = struct4h.trend === 'BEARISH' || struct1h.trend === 'BEARISH';
    if (isHigherTfBearish) {
      // Find active Bearish FVG or Order Block on 15m
      const activeFvg = [...struct15m.fvgs].reverse().find((f) => f.type === 'BEARISH' && f.status === 'ACTIVE');
      const activeOb = [...struct15m.orderBlocks].reverse().find((o) => o.type === 'BEARISH' && o.status === 'ACTIVE');

      const supplyZone = activeFvg ? { top: activeFvg.top, bottom: activeFvg.bottom } : activeOb ? { top: activeOb.top, bottom: activeOb.bottom } : null;

      if (supplyZone && currentPrice <= supplyZone.top && currentPrice >= supplyZone.bottom * 0.998) {
        // Micro confirmation on 5m: Bearish BOS or CHoCH
        const recentBearBreak = [...struct5m.structureBreaks].reverse().find(
          (b) => b.direction === 'BEARISH' && b.candleIndex >= candles5m.length - 8
        );

        if (recentBearBreak) {
          const entryPrice = currentPrice;
          const stopLossPrice = parseFloat((supplyZone.top + 15.0).toFixed(1)); // Buffer above zone

          // Structural Target: Recent 1H or 4H swing low
          const targetLow = struct1h.lastSwingLow?.price || struct4h.lastSwingLow?.price;
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
                id: `setup_stratA_short_${lastCandle5m.timestamp}`,
                strategy: 'STRATEGY_A_TREND_CONTINUATION',
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
                  macroTrend: `4H: ${struct4h.trend}, 1H: ${struct1h.trend}`,
                  triggerReason: `Retroceso a zona de oferta 15m (${supplyZone.bottom} - ${supplyZone.top}) con confirmación de ${recentBearBreak.type} en 5m`,
                  invalidationReason: `Cierre de vela 5m por encima de ${stopLossPrice}`,
                  confluencePoints: [
                    'Sesgo mayor bajista confirmado',
                    'Mitigación de zona de oferta 15m',
                    `Confirmación de microestructura ${recentBearBreak.type} en 5m`,
                    `Ratio R:R neto ${riskReward.netRR}:1 verificable con comisiones`,
                  ],
                  structuralTarget: `Swing Low estructural 1H en $${takeProfitPrice}`,
                },
              };
            }
          }
        }
      }
    }

    return null;
  }
}
