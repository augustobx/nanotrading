import type { Candle, InstrumentInfo, MarketState } from '../types/market.js';
import { TechnicalIndicators } from './indicators.js';
import { RiskCalculator, type RiskCalculationResult } from './risk-calculator.js';
import type { CandleManager } from '../market/candle-manager.js';
import type { DatabaseService } from '../storage/database.js';
import type { RiskPolicyManager } from './risk-policy.js';
import type { SignalStateMachine } from './signal-state-machine.js';

const FIVE_MINUTES = 5 * 60_000;
const FIFTEEN_MINUTES = 15 * 60_000;

export type QuantRegime = 'BULL_TREND' | 'BEAR_TREND' | 'RANGE_OR_TRANSITION' | 'DATA_NOT_READY';
export type QuantStrategy = 'QUANT_TREND_PULLBACK' | 'QUANT_LIQUIDITY_SWEEP';
export type QuantSignalMode = 'SHADOW' | 'PAPER';

export interface QuantCandidate {
  id: string;
  symbol: string;
  candleTimestamp: number;
  strategy: QuantStrategy;
  direction: 'LONG' | 'SHORT';
  entryPrice: number;
  stopLossPrice: number;
  riskDistance: number;
  atr5m: number;
  regime: QuantRegime;
  reason: string;
}
export interface QuantDetection {
  regime: QuantRegime;
  reason: string;
  candidate: QuantCandidate | null;
  indicators: { ema50_15m?: number; ema21_5m?: number; atr5m?: number; rvol5m?: number };
}

/** One reproducible pure detector. No AI prompts, network, clock or mutable state.
 * Inputs must contain only CLOSED candles available before this 5m close.
 * This first iteration deliberately tests only two simple hypotheses.
 */
export function detectQuantSetup(
  symbol: string, history5m: readonly Candle[], history15m: readonly Candle[]
): QuantDetection {
  const valid = (history: readonly Candle[], tf: '5m' | '15m') => {
    const byTimestamp = new Map<number, Candle>();
    for (const c of history) {
      if (c.symbol === symbol && c.timeframe === tf && c.confirmed === true &&
          Number.isFinite(c.timestamp) && Number.isFinite(c.close) &&
          c.close > 0 && c.high >= c.low && c.volume > 0) {
        byTimestamp.set(c.timestamp, c);
      }
    }
    return [...byTimestamp.values()].sort((a, b) => a.timestamp - b.timestamp);
  };
  const five = valid(history5m, '5m');
  const last5 = five[five.length - 1];
  if (!last5 || five.length < 60) {
    return { regime: 'DATA_NOT_READY', reason: 'Faltan 60 velas cerradas 5m válidas', candidate: null, indicators: {} };
  }
  const closeTime = last5.timestamp + FIVE_MINUTES;
  const fifteen = valid(history15m, '15m')
    .filter(c => c.timestamp + FIFTEEN_MINUTES <= closeTime);
  if (fifteen.length < 55) {
    return { regime: 'DATA_NOT_READY', reason: 'Faltan 55 velas cerradas 15m anteriores a la señal', candidate: null, indicators: {} };
  }
  // Missing live bars are not proof of price action; no detection across gaps.
  const last5Bars = five.slice(-21);
  if (last5Bars.some((bar, i) => i > 0 &&
      bar.timestamp - last5Bars[i - 1].timestamp !== FIVE_MINUTES) ||
      closeTime - (fifteen[fifteen.length - 1].timestamp + FIFTEEN_MINUTES) > FIFTEEN_MINUTES) {
    return { regime: 'DATA_NOT_READY', reason: 'Hay un gap 5m/15m: recuperar datos Bybit antes de evaluar', candidate: null, indicators: {} };
  }

  const closes5 = five.map(c => c.close);
  const closes15 = fifteen.map(c => c.close);
  const ema21 = TechnicalIndicators.ema(closes5, 21);
  const ema50 = TechnicalIndicators.ema(closes15, 50);
  const atr = TechnicalIndicators.atr(five, 14);
  const prev5 = five[five.length - 2];
  const last15 = fifteen[fifteen.length - 1];
  const emaNow = ema21[ema21.length - 1];
  const emaPrev = ema21[ema21.length - 2];
  const ema15Now = ema50[ema50.length - 1];
  const ema15Prev = ema50[ema50.length - 4];
  const atrNow = atr[atr.length - 1];
  const volumes = five.slice(-21, -1);
  const avgVolume = volumes.reduce((total, c) => total + c.volume, 0) / volumes.length;
  const rvol = avgVolume > 0 ? last5.volume / avgVolume : 0;
  const indicators = {
    ema50_15m: ema15Now, ema21_5m: emaNow, atr5m: atrNow,
    rvol5m: Number(rvol.toFixed(2)),
  };
  if (![emaNow, emaPrev, ema15Now, ema15Prev, atrNow].every(Number.isFinite) || atrNow <= 0) {
    return { regime: 'DATA_NOT_READY', reason: 'EMA o ATR insuficiente/no válido', candidate: null, indicators };
  }
  const bull = last15.close > ema15Now && ema15Now > ema15Prev;
  const bear = last15.close < ema15Now && ema15Now < ema15Prev;
  const regime: QuantRegime = bull ? 'BULL_TREND' : bear ? 'BEAR_TREND' : 'RANGE_OR_TRANSITION';
  const make = (strategy: QuantStrategy, direction: 'LONG' | 'SHORT',
    stopLossPrice: number, reason: string): QuantDetection => {
    const riskDistance = Math.abs(last5.close - stopLossPrice);
    if (!Number.isFinite(stopLossPrice) || stopLossPrice <= 0 ||
        riskDistance <= 0.05 * atrNow) {
      return { regime, reason: 'SL inválido o demasiado próximo al ruido de mercado', candidate: null, indicators };
    }
    return {
      regime, reason, indicators,
      candidate: {
        id: `quant_${symbol}_${strategy}_${last5.timestamp}`,
        symbol, candleTimestamp: last5.timestamp, strategy, direction,
        entryPrice: last5.close, stopLossPrice, riskDistance, atr5m: atrNow, regime, reason,
      },
    };
  };

  // SFP: current candle takes a previous extreme then closes back inside.
  const previous = five.slice(-13, -1);
  const floor = Math.min(...previous.map(c => c.low));
  const ceiling = Math.max(...previous.map(c => c.high));
  const lowerWick = Math.min(last5.open, last5.close) - last5.low;
  const upperWick = last5.high - Math.max(last5.open, last5.close);
  if (last5.low < floor && last5.close > floor && lowerWick > atrNow * 0.22) {
    return make('QUANT_LIQUIDITY_SWEEP', 'LONG', last5.low - atrNow * 0.3,
      'Barrido del mínimo de 12 velas y cierre 5m de vuelta dentro del rango');
  }
  if (last5.high > ceiling && last5.close < ceiling && upperWick > atrNow * 0.22) {
    return make('QUANT_LIQUIDITY_SWEEP', 'SHORT', last5.high + atrNow * 0.3,
      'Barrido del máximo de 12 velas y cierre 5m de vuelta dentro del rango');
  }
  // Trend pullback: recent touch of EMA21 5m and reversal aligned with EMA50 15m.
  if (bull && prev5.low <= emaPrev * 1.0005 &&
      last5.close > emaNow && last5.close > last5.open) {
    return make('QUANT_TREND_PULLBACK', 'LONG',
      Math.min(last5.low, prev5.low) - atrNow * 0.3,
      'Tendencia alcista 15m; retroceso a EMA21 y confirmación alcista 5m');
  }
  if (bear && prev5.high >= emaPrev * 0.9995 &&
      last5.close < emaNow && last5.close < last5.open) {
    return make('QUANT_TREND_PULLBACK', 'SHORT',
      Math.max(last5.high, prev5.high) + atrNow * 0.3,
      'Tendencia bajista 15m; retroceso a EMA21 y confirmación bajista 5m');
  }
  return { regime, reason: 'Sin patrón de barrido o pullback confirmado en esta vela 5m', candidate: null, indicators };
}

export interface QuantFastLaneDependencies {
  symbol: string;
  candleManager: CandleManager;
  db: DatabaseService;
  riskPolicyManager: RiskPolicyManager;
  stateMachine: SignalStateMachine;
  getMarketState: () => MarketState;
  getInstrumentInfo: () => InstrumentInfo | null;
}

export class QuantFastLane {
  private readonly mode: QuantSignalMode =
    process.env.QUANT_SIGNAL_MODE === 'PAPER' ? 'PAPER' : 'SHADOW';
  constructor(private readonly deps: QuantFastLaneDependencies) {}

  public getMode(): QuantSignalMode { return this.mode; }

  public evaluateCandle(candle: Candle): void {
    const { db, symbol, candleManager } = this.deps;
    if (candle.timeframe !== '5m' || candle.symbol !== symbol || !candle.confirmed) return;
    const id = `quant_${symbol}_5m_${candle.timestamp}`;
    // Replay/WS duplications must not generate a second signal.
    if (db.hasQuantDecision(id)) return;
    const history5m = candleManager.getCandles('5m', 120)
      .filter(c => c.timestamp <= candle.timestamp && c.confirmed);
    const history15m = candleManager.getCandles('15m', 120)
      .filter(c => c.timestamp + FIFTEEN_MINUTES <= candle.timestamp + FIVE_MINUTES && c.confirmed);
    const detection = detectQuantSetup(symbol, history5m, history15m);
    const record: Parameters<DatabaseService['saveQuantDecision']>[0] = {
      id, symbol, candleTimestamp: candle.timestamp, regime: detection.regime,
      strategy: detection.candidate?.strategy, direction: detection.candidate?.direction,
      outcome: detection.candidate ? 'CANDIDATE' : detection.regime === 'DATA_NOT_READY'
        ? 'DATA_NOT_READY' : 'NO_PATTERN',
      reason: detection.reason,
      metadata: { indicators: detection.indicators, mode: this.mode },
    };
    if (detection.candidate) {
      const candidate = detection.candidate;
      const policy = this.deps.riskPolicyManager.getPolicy();
      const instrument = this.deps.getInstrumentInfo();
      const riskPercent = Math.min(policy.maxRiskPerTradePercent,
        policy.maxRiskPerTradeUsdt / policy.capitalUsdt * 100);
      const ticker = this.deps.getMarketState().ticker;
      const target = (grossRatio: number) => candidate.entryPrice +
        (candidate.direction === 'LONG' ? 1 : -1) * candidate.riskDistance * grossRatio;
      const calc = (ratio: number): RiskCalculationResult => RiskCalculator.calculate({
        direction: candidate.direction, entryPrice: candidate.entryPrice,
        stopLossPrice: candidate.stopLossPrice, takeProfitPrice: target(ratio),
        accountBalance: policy.capitalUsdt, riskPercent,
        tickSize: instrument?.tickSize ?? (symbol === 'BTCUSDT' ? 0.1 : 0.01),
        qtyStep: instrument?.qtyStep ?? (symbol === 'BTCUSDT' ? 0.001 : 0.01),
        minOrderQty: instrument?.minOrderQty ?? (symbol === 'BTCUSDT' ? 0.001 : 0.01),
        spread: Number.isFinite(ticker?.spread) ? ticker!.spread : 0.1,
        minRequiredRR: 0.1,
      });
      const calc2 = calc(2.8);
      const calc4 = calc(4.9);
      const selected = policy.minNetRR >= 3 ? calc4 : calc2;
      record.entryPrice = candidate.entryPrice;
      record.stopLoss = selected.stopLossPrice;
      record.takeProfit = selected.takeProfitPrice;
      record.netRR = selected.netRR;
      record.metadata = {
        ...record.metadata, alternative2NetRR: calc2.netRR,
        alternative4NetRR: calc4.netRR,
        policyMinNetRR: policy.minNetRR,
      };
      const active = this.deps.stateMachine.getActiveSignals();
      const state = this.deps.getMarketState();
      const history = db.getSignals(500);
      const dayStart = Math.floor(Date.now() / 86400000) * 86400000;
      const enteredToday = history.filter(x => x.simulatedEntryTime >= dayStart).length;
      const realizedToday = history.filter(x => x.exitTime >= dayStart)
        .reduce((total: number, x: any) => total + (Number(x.realizedNetPnlUsdt) || 0), 0);
      const violations: string[] = [];
      if (!selected.isValid || selected.netRR < policy.minNetRR) violations.push('RR_POLICY');
      if (selected.netLossUSDT > Math.min(policy.maxRiskPerTradeUsdt,
        policy.capitalUsdt * policy.maxRiskPerTradePercent / 100)) violations.push('POSITION_RISK');
      if (active.length >= policy.maxActiveSignals) violations.push('MAX_ACTIVE_SIGNALS');
      if (enteredToday >= policy.maxDailyEntries) violations.push('MAX_DAILY_ENTRIES');
      if (-realizedToday >= Math.min(policy.maxDailyLossUsdt,
        policy.capitalUsdt * policy.maxDailyLossPercent / 100)) violations.push('DAILY_LOSS_LIMIT');
      if (policy.stopLossCeilings.maxSlDistancePercent.enabled &&
          candidate.riskDistance / candidate.entryPrice * 100 >
          policy.stopLossCeilings.maxSlDistancePercent.value) violations.push('SL_DISTANCE');
      if (policy.stopLossCeilings.maxSlDistanceUsdt.enabled &&
          candidate.riskDistance > policy.stopLossCeilings.maxSlDistanceUsdt.value) violations.push('SL_USDT');
      if (policy.stopLossCeilings.maxSlDistanceAtrMultiplier.enabled &&
          candidate.riskDistance / Math.max(candidate.atr5m, 0.001) >
          policy.stopLossCeilings.maxSlDistanceAtrMultiplier.value) violations.push('SL_ATR');
      if (policy.stopLossCeilings.maxMonetaryLossUsdt.enabled &&
          selected.netLossUSDT > policy.stopLossCeilings.maxMonetaryLossUsdt.value) violations.push('SL_MONETARY');
      if (!Number.isFinite(state.ticker?.spreadPcnt) ||
          state.ticker!.spreadPcnt > policy.marketRestrictions.maxSpreadPercent) violations.push('SPREAD');
      if (state.killSwitchActive) violations.push('KILL_SWITCH');
      if (!state.wsConnected || !Number.isFinite(state.lastWsMessageTimestamp) ||
          Date.now() - state.lastWsMessageTimestamp > policy.marketRestrictions.maxDataStalenessMs) violations.push('STALE_MARKET');
      if (!instrument) violations.push('INSTRUMENT_NOT_READY');
      if (Date.now() - (candle.timestamp + FIVE_MINUTES) > 120_000) violations.push('STALE_CANDLE');
      if (this.mode === 'PAPER' && violations.length === 0) {
        try {
          this.deps.stateMachine.registerQuantSignal(candidate, selected);
          record.outcome = 'PAPER_SIGNAL';
          record.reason = 'Setup matemático aprobado sin LLM; señal paper emitida';
        } catch (err: any) {
          record.outcome = 'SIGNAL_ERROR';
          record.reason = err?.message || 'Falló la creación de la señal paper';
          db.logEvent('ERROR', 'QuantFastLane', record.reason, { id: candidate.id, symbol });
        }
      } else if (violations.length) {
        record.outcome = 'REJECTED_RISK';
        record.reason = `Patrón confirmado; filtros: ${violations.join(', ')}`;
      } else {
        record.outcome = 'SHADOW_QUALIFIED';
        record.reason = 'Candidato válido en modo sombra; no se emiten operaciones';
      }
      record.metadata = { ...record.metadata, violations };
    }
    const inserted = db.saveQuantDecision(record);
    if (inserted && record.outcome !== 'NO_PATTERN') {
      db.logEvent(record.outcome === 'SIGNAL_ERROR' ? 'ERROR' : 'INFO',
        'QuantFastLane', `${symbol}: ${record.outcome} — ${record.reason}`, {
          candleTimestamp: candle.timestamp, strategy: record.strategy,
          direction: record.direction, netRR: record.netRR,
        });
    }
  }
}
