'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  createChart,
  IChartApi,
  ISeriesApi,
  CandlestickData,
  HistogramData,
  Time,
  SeriesMarker,
  IPriceLine,
} from 'lightweight-charts';

export type Timeframe = '1m' | '5m' | '15m' | '1h' | '4h' | '1d';

export interface CandleData {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  confirmed?: boolean;
}

export interface SwingData {
  timestamp: number;
  price: number;
  type: 'HIGH' | 'LOW';
  label?: string;
  confirmedAtTimestamp?: number;
  operationalAvailableTimestamp?: number;
}

export interface BreakData {
  type: 'BOS' | 'CHoCH';
  direction: 'BULLISH' | 'BEARISH';
  brokenLevel: number;
  candleTimestamp: number;
}

export interface FvgData {
  id: string;
  type: 'BULLISH' | 'BEARISH';
  top: number;
  bottom: number;
  status: string;
}

export interface SetupData {
  id: string;
  strategy: string;
  direction: 'LONG' | 'SHORT';
  entryPrice: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  riskReward?: {
    netRR: number;
    grossRR: number;
  };
  status: string;
}

interface CandleChartProps {
  candles: CandleData[];
  currentCandle: CandleData | null;
  timeframe: Timeframe;
  onTimeframeChange: (tf: Timeframe) => void;
  swings?: SwingData[];
  structureBreaks?: BreakData[];
  fvgs?: FvgData[];
  scenarios?: any[];
  selectedScenarioId?: string | null;
  onSelectScenario?: (id: string | null) => void;
  symbol?: string;
  isDark?: boolean;
}

const TIMEFRAMES: Timeframe[] = ['1m', '5m', '15m', '1h', '4h', '1d'];

const TERMINAL_SCENARIO_STATUSES = new Set([
  'COMPLETED', 'COMPLETED_TP', 'COMPLETED_SL', 'INVALIDATED',
  'EXPIRED', 'CANCELLED', 'DISCARDED', 'SIGNAL_GENERATED',
]);
const DIRECTIONAL_WATCH_STATUSES = new Set([
  'SCENARIO_PROPOSED', 'SCENARIO_REGISTERED', 'SCENARIO_MONITORING',
  'APPROACHING_ZONE', 'IN_ZONE', 'REVALIDATION_REQUESTED',
  'AI_REVALIDATING', 'WAITING_CONFIRMATION', 'ENTRY_VALIDATED',
]);
const isNeutralRange = (scenario: any) =>
  scenario?.direction === 'NEUTRAL' || scenario?.kind === 'NEUTRAL_OBSERVATION';

function isVisibleWatch(scenario: any): boolean {
  if (!scenario || TERMINAL_SCENARIO_STATUSES.has(scenario.status)) return false;
  const expiry = Number(scenario.watchPlan?.expirationTimestamp || scenario.validUntilTimestamp);
  if (Number.isFinite(expiry) && expiry > 0 && expiry <= Date.now()) return false;
  if (isNeutralRange(scenario)) {
    return scenario.status === 'NO_TRADE_OBSERVATION' &&
      Number.isFinite(scenario.entryZoneMin) &&
      Number.isFinite(scenario.entryZoneMax) &&
      scenario.entryZoneMax > scenario.entryZoneMin;
  }
  return DIRECTIONAL_WATCH_STATUSES.has(scenario.status) &&
    (scenario.direction === 'LONG' || scenario.direction === 'SHORT') &&
    Number.isFinite(scenario.targetEntry) &&
    Number.isFinite(scenario.stopLossPrice);
}

function resolveWatchForChart(scenarios: any[], selectedId: string | null, symbol: string): any | null {
  const matchesSymbol = (s: any) => !s.symbol || s.symbol === symbol;
  if (selectedId) {
    const selected = scenarios.find(s => s.id === selectedId && matchesSymbol(s));
    // Never draw expired / invalidated levels as if they were active.
    if (selected) return isVisibleWatch(selected) ? selected : null;
  }
  const active = scenarios.filter(s => matchesSymbol(s) && isVisibleWatch(s))
    .sort((a, b) => (b.discoveryTimestamp || b.createdAt || 0) -
      (a.discoveryTimestamp || a.createdAt || 0));
  return active.find(s => !isNeutralRange(s)) || active.find(isNeutralRange) || null;
}


export function CandleChart({
  candles,
  currentCandle,
  timeframe,
  onTimeframeChange,
  swings = [],
  structureBreaks = [],
  fvgs = [],
  scenarios = [],
  selectedScenarioId = null,
  onSelectScenario,
  symbol = 'BTCUSDT',
  isDark = true,
}: CandleChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);

  const [hoverData, setHoverData] = useState<CandleData | null>(null);

  // Layer toggles
  const [showSwings, setShowSwings] = useState(false);
  const [showBreaks, setShowBreaks] = useState(false);
  const [showFvg, setShowFvg] = useState(true);
  const [showScenarios, setShowScenarios] = useState(true);
  const chartWatch = resolveWatchForChart(scenarios, selectedScenarioId, symbol);

  // Initialize Lightweight Chart
  useEffect(() => {
    if (!chartContainerRef.current) return;

    const container = chartContainerRef.current;
    container.innerHTML = '';

    const chart = createChart(container, {
      width: container.clientWidth,
      height: 480,
      layout: {
        background: { color: isDark ? '#0c0f17' : '#ffffff' },
        textColor: isDark ? '#94a3b8' : '#334155',
        fontSize: 12,
        fontFamily: 'JetBrains Mono, monospace',
      },
      grid: {
        vertLines: { color: isDark ? 'rgba(30, 41, 59, 0.4)' : 'rgba(226, 232, 240, 0.6)' },
        horzLines: { color: isDark ? 'rgba(30, 41, 59, 0.4)' : 'rgba(226, 232, 240, 0.6)' },
      },
      crosshair: {
        mode: 1,
      },
      rightPriceScale: {
        borderColor: isDark ? '#1e293b' : '#cbd5e1',
        scaleMargins: {
          top: 0.1,
          bottom: 0.25,
        },
      },
      timeScale: {
        borderColor: isDark ? '#1e293b' : '#cbd5e1',
        timeVisible: true,
        secondsVisible: false,
      },
    });

    const candleSeries = chart.addCandlestickSeries({
      upColor: '#10b981',
      downColor: '#ef4444',
      borderVisible: false,
      wickUpColor: '#10b981',
      wickDownColor: '#ef4444',
    });

    const volumeSeries = chart.addHistogramSeries({
      color: '#3b82f6',
      priceFormat: {
        type: 'volume',
      },
      priceScaleId: '',
    });

    volumeSeries.priceScale().applyOptions({
      scaleMargins: {
        top: 0.8,
        bottom: 0,
      },
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;

    chart.subscribeCrosshairMove((param) => {
      if (!param.time || !param.seriesData.get(candleSeries)) {
        setHoverData(null);
        return;
      }
      const data = param.seriesData.get(candleSeries) as any;
      if (data) {
        setHoverData({
          timestamp: typeof param.time === 'number' ? param.time * 1000 : 0,
          open: data.open,
          high: data.high,
          low: data.low,
          close: data.close,
          volume: 0,
        });
      }
    });

    const resizeObserver = new ResizeObserver((entries) => {
      if (entries.length === 0 || !entries[0].contentRect) return;
      chart.applyOptions({ width: entries[0].contentRect.width });
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
  }, [isDark]);

  // Set historical candles
  useEffect(() => {
    if (!candleSeriesRef.current || !volumeSeriesRef.current || candles.length === 0) return;

    const formattedCandles: CandlestickData<Time>[] = [];
    const formattedVolume: HistogramData<Time>[] = [];

    const sorted = [...candles].sort((a, b) => a.timestamp - b.timestamp);
    const seenTimes = new Set<number>();

    for (const c of sorted) {
      const timeInSec = Math.floor(c.timestamp / 1000) as Time;
      if (seenTimes.has(timeInSec as number)) continue;
      seenTimes.add(timeInSec as number);

      formattedCandles.push({
        time: timeInSec,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      });

      formattedVolume.push({
        time: timeInSec,
        value: c.volume,
        color: c.close >= c.open ? 'rgba(16, 185, 129, 0.4)' : 'rgba(239, 68, 68, 0.4)',
      });
    }

    try {
      candleSeriesRef.current.setData(formattedCandles);
      volumeSeriesRef.current.setData(formattedVolume);
      chartRef.current?.timeScale().fitContent();
    } catch {}
  }, [candles, timeframe]);

  // Update ticking candle
  useEffect(() => {
    if (!currentCandle || !candleSeriesRef.current || !volumeSeriesRef.current) return;

    const timeInSec = Math.floor(currentCandle.timestamp / 1000) as Time;
    try {
      candleSeriesRef.current.update({
        time: timeInSec,
        open: currentCandle.open,
        high: currentCandle.high,
        low: currentCandle.low,
        close: currentCandle.close,
      });

      volumeSeriesRef.current.update({
        time: timeInSec,
        value: currentCandle.volume,
        color: currentCandle.close >= currentCandle.open ? 'rgba(16, 185, 129, 0.4)' : 'rgba(239, 68, 68, 0.4)',
      });
    } catch {}
  }, [currentCandle]);

  // Render SMC Markers (Swings, BOS, CHoCH)
  useEffect(() => {
    if (!candleSeriesRef.current || candles.length === 0) return;

    const markers: SeriesMarker<Time>[] = [];
    const candleTimes = new Set(candles.map((c) => Math.floor(c.timestamp / 1000)));

    if (showSwings && swings) {
      for (const s of swings) {
        const timeInSec = Math.floor(s.timestamp / 1000) as Time;
        if (!candleTimes.has(timeInSec as number)) continue;

        if (s.type === 'HIGH') {
          markers.push({
            time: timeInSec,
            position: 'aboveBar',
            color: '#38bdf8',
            shape: 'arrowDown',
            text: s.label || 'SH',
          });
        } else {
          markers.push({
            time: timeInSec,
            position: 'belowBar',
            color: '#c084fc',
            shape: 'arrowUp',
            text: s.label || 'SL',
          });
        }
      }
    }

    if (showBreaks && structureBreaks) {
      for (const b of structureBreaks) {
        const timeInSec = Math.floor(b.candleTimestamp / 1000) as Time;
        if (!candleTimes.has(timeInSec as number)) continue;

        markers.push({
          time: timeInSec,
          position: b.direction === 'BULLISH' ? 'aboveBar' : 'belowBar',
          color: b.type === 'CHoCH' ? '#f59e0b' : '#10b981',
          shape: 'circle',
          text: `${b.type}`,
        });
      }
    }

    // Sort markers chronologically
    markers.sort((a, b) => (a.time as number) - (b.time as number));

    try {
      candleSeriesRef.current.setMarkers(markers);
    } catch {}
  }, [candles, swings, structureBreaks, showSwings, showBreaks]);

  // Render Price Lines (FVG, OrderBlocks, Setups)
  useEffect(() => {
    if (!candleSeriesRef.current) return;

    // Remove previous price lines
    for (const pl of priceLinesRef.current) {
      try {
        candleSeriesRef.current.removePriceLine(pl);
      } catch {}
    }
    priceLinesRef.current = [];

    // FVG Lines
    if (showFvg && fvgs) {
      const activeFvgs = fvgs.filter((f) => f.status === 'ACTIVE').slice(-2);
      for (const fvg of activeFvgs) {
        try {
          const topLine = candleSeriesRef.current.createPriceLine({
            price: fvg.top,
            color: fvg.type === 'BULLISH' ? '#10b981' : '#ef4444',
            lineWidth: 1,
            lineStyle: 2, // Dashed
            axisLabelVisible: true,
            title: `FVG Top`,
          });
          const botLine = candleSeriesRef.current.createPriceLine({
            price: fvg.bottom,
            color: fvg.type === 'BULLISH' ? '#10b981' : '#ef4444',
            lineWidth: 1,
            lineStyle: 2,
            axisLabelVisible: true,
            title: `FVG Bottom`,
          });
          priceLinesRef.current.push(topLine, botLine);
        } catch {}
      }
    }

    // Always visualize the persisted watcher levels, even when only NEUTRAL exists.
    if (showScenarios && chartWatch) {
      const activeScenario = chartWatch;
      if (isNeutralRange(activeScenario)) {
        try {
          const ceiling = candleSeriesRef.current.createPriceLine({
            price: activeScenario.entryZoneMax,
            color: '#f59e0b',
            lineWidth: 2,
            lineStyle: 2,
            axisLabelVisible: true,
            title: activeScenario.neutralBreakoutProgress?.side === 'CEILING'
              ? 'TECHO · CONFIRMACION 15M' : 'TECHO · ESPERA RUPTURA',
          });
          const floor = candleSeriesRef.current.createPriceLine({
            price: activeScenario.entryZoneMin,
            color: '#38bdf8',
            lineWidth: 2,
            lineStyle: 2,
            axisLabelVisible: true,
            title: activeScenario.neutralBreakoutProgress?.side === 'FLOOR'
              ? 'PISO · CONFIRMACION 15M' : 'PISO · ESPERA RUPTURA',
          });
          priceLinesRef.current.push(ceiling, floor);
        } catch {}
      } else {
        try {
          // Entry-zone bounds are informational, not trade authorization.
          const min = activeScenario.entryZoneMin;
          const max = activeScenario.entryZoneMax;
          if (Number.isFinite(min) && Number.isFinite(max) && max > min) {
            for (const [price, label] of [
              [min, 'ZONA · LIMITE INFERIOR'], [max, 'ZONA · LIMITE SUPERIOR'],
            ] as const) {
              if (Math.abs(price - activeScenario.targetEntry) < 0.01) continue;
              priceLinesRef.current.push(candleSeriesRef.current.createPriceLine({
                price, color: '#818cf8', lineWidth: 1, lineStyle: 2,
                axisLabelVisible: true, title: label,
              }));
            }
          }
          const isValidated = activeScenario.status === 'ENTRY_VALIDATED' || activeScenario.status === 'SIGNAL_GENERATED';
          const lineStyle = isValidated ? 0 : 2; // Solid for validated signals, dashed for proposed monitoring scenarios
          const entryPrefix = isValidated ? 'ENTRADA VALIDADA' : 'ZONA PROPUESTA';
          const slPrefix = isValidated ? 'SL VALIDADO' : 'SL PROPUESTO';
          const tpPrefix = isValidated ? 'TP VALIDADO' : 'TP PROPUESTO';

          const entryLine = candleSeriesRef.current.createPriceLine({
            price: activeScenario.targetEntry,
            color: '#3b82f6', // Blue
            lineWidth: 2,
            lineStyle,
            axisLabelVisible: true,
            title: `${entryPrefix} ($${activeScenario.targetEntry.toFixed(1)})`,
          });

          const slLine = candleSeriesRef.current.createPriceLine({
            price: activeScenario.stopLossPrice,
            color: '#ef4444', // Red
            lineWidth: 2,
            lineStyle,
            axisLabelVisible: true,
            title: `${slPrefix} ($${activeScenario.stopLossPrice.toFixed(1)})`,
          });

          priceLinesRef.current.push(entryLine, slLine);

          const riskDist = Math.abs(activeScenario.targetEntry - activeScenario.stopLossPrice);

          // 1. Target 1:4 (if defined)
          if (activeScenario.target14Price && Number.isFinite(activeScenario.target14Price)) {
            let tpLabel: string;
            if (Number.isFinite(activeScenario.netRR14) && activeScenario.netRR14! > 0) {
              const net14 = activeScenario.netRR14!;
              if (net14 >= 4.0) {
                tpLabel = `${tpPrefix} 1:4 (R:R 1:${net14.toFixed(1)} neto)`;
              } else {
                tpLabel = `${tpPrefix} Ext (R:R 1:${net14.toFixed(1)} neto < 1:4)`;
              }
            } else {
              tpLabel = `${tpPrefix} 1:4 (R:R neto no disponible)`;
            }

            const tp14Line = candleSeriesRef.current.createPriceLine({
              price: activeScenario.target14Price,
              color: '#10b981', // Green
              lineWidth: 2,
              lineStyle,
              axisLabelVisible: true,
              title: `${tpLabel} ($${activeScenario.target14Price.toFixed(1)})`,
            });
            priceLinesRef.current.push(tp14Line);
          }

          // 2. Target 1:2 (if defined and either standalone or secondary target)
          if (activeScenario.target12Price && Number.isFinite(activeScenario.target12Price)) {
            let tpLabel: string;
            if (Number.isFinite(activeScenario.netRR12) && activeScenario.netRR12! > 0) {
              const net12 = activeScenario.netRR12!;
              if (net12 >= 2.0) {
                tpLabel = `${tpPrefix} 1:2 (R:R 1:${net12.toFixed(1)} neto)`;
              } else {
                tpLabel = `${tpPrefix} (R:R 1:${net12.toFixed(1)} neto < 1:2)`;
              }
            } else {
              tpLabel = `${tpPrefix} 1:2 (R:R neto no disponible)`;
            }

            const tp12Line = candleSeriesRef.current.createPriceLine({
              price: activeScenario.target12Price,
              color: '#06b6d4', // Cyan
              lineWidth: 2,
              lineStyle,
              axisLabelVisible: true,
              title: `${tpLabel} ($${activeScenario.target12Price.toFixed(1)})`,
            });
            priceLinesRef.current.push(tp12Line);
          }
        } catch {}
      }
    }
  }, [fvgs, scenarios, selectedScenarioId, showFvg, showScenarios, symbol, isDark]);

  const activeCandle = hoverData || currentCandle || (candles.length > 0 ? candles[candles.length - 1] : null);
  const priceColor =
    activeCandle && activeCandle.close >= activeCandle.open ? 'text-emerald-500 dark:text-emerald-400' : 'text-rose-500 dark:text-rose-400';

  const selectedScenario = selectedScenarioId && chartWatch?.id === selectedScenarioId ? chartWatch : null;

  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1422] p-4 shadow-xl">
      {/* Top Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800/80 pb-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="font-display font-extrabold text-slate-900 dark:text-white text-base tracking-wide">
              {symbol}
            </span>
            <span className="rounded-md bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">
              Bybit V5 Linear
            </span>
          </div>

          {/* Timeframe Selector */}
          <div className="flex items-center gap-1 rounded-xl bg-slate-100 dark:bg-slate-900/90 p-1 border border-slate-200 dark:border-slate-800">
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf}
                onClick={() => onTimeframeChange(tf)}
                className={`px-2.5 py-1 text-xs font-bold rounded-lg transition-all ${
                  timeframe === tf
                    ? 'bg-[var(--color-brand,#FF6600)] text-white shadow-md'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-800/50'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>
        </div>

        {/* OHLC Legend */}
        {activeCandle && (
          <div className="flex flex-wrap items-center gap-3 text-xs font-mono">
            <div>
              <span className="text-slate-400 dark:text-slate-500">O: </span>
              <span className="text-slate-700 dark:text-slate-200 font-semibold">{activeCandle.open.toFixed(1)}</span>
            </div>
            <div>
              <span className="text-slate-400 dark:text-slate-500">H: </span>
              <span className="text-slate-700 dark:text-slate-200 font-semibold">{activeCandle.high.toFixed(1)}</span>
            </div>
            <div>
              <span className="text-slate-400 dark:text-slate-500">L: </span>
              <span className="text-slate-700 dark:text-slate-200 font-semibold">{activeCandle.low.toFixed(1)}</span>
            </div>
            <div>
              <span className="text-slate-400 dark:text-slate-500">C: </span>
              <span className={`font-bold ${priceColor}`}>{activeCandle.close.toFixed(1)}</span>
            </div>
            <div>
              <span className="text-slate-400 dark:text-slate-500">Vol: </span>
              <span className="text-slate-700 dark:text-slate-300 font-semibold">{activeCandle.volume.toFixed(3)} {symbol.replace('USDT', '')}</span>
            </div>
          </div>
        )}
      </div>

      {/* Layer Toggles Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 py-2 border-b border-slate-200 dark:border-slate-800/50 text-[11px] font-mono">
        <span className="text-slate-500 dark:text-slate-400 font-semibold uppercase tracking-wider">Capas SMC / ICT:</span>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setShowSwings(!showSwings)}
            className={`px-2 py-0.5 rounded-md border transition-all ${
              showSwings
                ? 'border-sky-500/40 bg-sky-500/10 text-sky-600 dark:text-sky-400 font-bold'
                : 'border-slate-200 dark:border-slate-800 text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'
            }`}
          >
            ● Swings (HH/LL)
          </button>
          <button
            onClick={() => setShowBreaks(!showBreaks)}
            className={`px-2 py-0.5 rounded-md border transition-all ${
              showBreaks
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-bold'
                : 'border-slate-200 dark:border-slate-800 text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'
            }`}
          >
            ● BOS / CHoCH
          </button>
          <button
            onClick={() => setShowFvg(!showFvg)}
            className={`px-2 py-0.5 rounded-md border transition-all ${
              showFvg
                ? 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400 font-bold'
                : 'border-slate-200 dark:border-slate-800 text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'
            }`}
          >
            ● FVG / Zonas
          </button>
          <button
            onClick={() => setShowScenarios(!showScenarios)}
            className={`px-2 py-0.5 rounded-md border transition-all ${
              showScenarios
                ? 'border-[var(--color-brand,#FF6600)] bg-[var(--color-brand,#FF6600)]/10 text-[var(--color-brand,#FF6600)] font-bold'
                : 'border-slate-200 dark:border-slate-800 text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'
            }`}
          >
            ● Escenario IA / zonas
          </button>
        </div>
      </div>

      {/* Selected Scenario Notification Banner */}
      {selectedScenario && (
        <div className="flex items-center justify-between px-3 py-1.5 mt-2 rounded-lg bg-[var(--color-brand,#FF6600)]/10 border border-[var(--color-brand,#FF6600)]/30 text-xs">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[var(--color-brand,#FF6600)] animate-ping" />
            <span className="text-[var(--color-brand,#FF6600)] font-bold">
              Escenario seleccionado en gráfico:
            </span>
            <span className="font-mono text-slate-800 dark:text-slate-200">
              {isNeutralRange(selectedScenario)
                ? `NEUTRAL · TECHO ${selectedScenario.entryZoneMax.toFixed(1)} · PISO ${selectedScenario.entryZoneMin.toFixed(1)} · Validación ${selectedScenario.timeframe} + RVOL ≥ 1.20`
                : `${selectedScenario.direction} · Entrada $${selectedScenario.targetEntry?.toFixed(1)} · SL $${selectedScenario.stopLossPrice?.toFixed(1)}${selectedScenario.target14Price ? ` · TP $${selectedScenario.target14Price.toFixed(1)}` : ''}`}
            </span>
          </div>
          {onSelectScenario && (
            <button
              onClick={() => onSelectScenario(null)}
              className="text-[11px] font-mono text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 underline cursor-pointer"
            >
              Restablecer automático
            </button>
          )}
        </div>
      )}

      {showScenarios && chartWatch && (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 px-3 py-2 text-[11px] font-mono">
          {isNeutralRange(chartWatch) ? (
            <>
              <span className="font-semibold text-amber-600 dark:text-amber-400">● Techo ${chartWatch.entryZoneMax.toFixed(1)}</span>
              <span className="font-semibold text-sky-600 dark:text-sky-400">● Piso ${chartWatch.entryZoneMin.toFixed(1)}</span>
              <span className="text-slate-600 dark:text-slate-400">{chartWatch.neutralBreakoutProgress?.state === 'OUTSIDE_AWAITING_CLOSE'
                ? `Precio fuera de rango · Pendiente vela ${chartWatch.timeframe} y RVOL ≥ 1.20`
                : chartWatch.neutralBreakoutProgress?.state === 'OUTSIDE_CLOSED_LOW_VOLUME'
                ? `Cierre fuera sin volumen · RVOL ${chartWatch.neutralBreakoutProgress.relativeVolume?.toFixed(2)} / 1.20`
                : chartWatch.neutralBreakoutProgress?.state === 'OUTSIDE_CLOSED_INSUFFICIENT_DATA'
                ? 'Cierre fuera · Historial de volumen insuficiente'
                : chartWatch.neutralBreakoutProgress?.state === 'BACK_INSIDE_RANGE'
                ? 'El precio volvió al rango · Ruptura no confirmada'
                : `Rango neutral · Esperando vela ${chartWatch.timeframe} cerrada + volumen`}</span>
            </>
          ) : (
            <>
              <span className="font-semibold text-indigo-600 dark:text-indigo-400">● Zona de entrada</span>
              <span className="font-semibold text-blue-600 dark:text-blue-400">● Entrada</span>
              <span className="font-semibold text-red-600 dark:text-red-400">● Stop loss</span>
              <span className="font-semibold text-emerald-600 dark:text-emerald-400">● Objetivo</span>
            </>
          )}
        </div>
      )}

      {/* Candlestick Canvas Container */}
      <div ref={chartContainerRef} className="w-full relative mt-3 rounded-lg overflow-hidden" />
    </div>
  );
}
