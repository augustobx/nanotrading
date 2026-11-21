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
  setups?: SetupData[];
  symbol?: string;
  isDark?: boolean;
}

const TIMEFRAMES: Timeframe[] = ['1m', '5m', '15m', '1h', '4h', '1d'];

export function CandleChart({
  candles,
  currentCandle,
  timeframe,
  onTimeframeChange,
  swings = [],
  structureBreaks = [],
  fvgs = [],
  setups = [],
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
  const [showSetups, setShowSetups] = useState(true);

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

    // Setups Lines (Entry, SL, TP 1:4)
    if (showSetups && setups && setups.length > 0) {
      const activeSetup = [...setups].reverse().find(s =>
        (s.status === 'QUALIFIED' || s.status === 'PENDING_CONFIRMATION') &&
        Number.isFinite(s.riskReward?.netRR) && s.riskReward!.netRR >= 4); 
      if (activeSetup) {
      try {
        const entryLine = candleSeriesRef.current.createPriceLine({
          price: activeSetup.entryPrice,
          color: '#3b82f6', // Blue
          lineWidth: 2,
          lineStyle: 0, // Solid
          axisLabelVisible: true,
          title: `ENTRADA ($${activeSetup.entryPrice})`,
        });

        const slLine = candleSeriesRef.current.createPriceLine({
          price: activeSetup.stopLossPrice,
          color: '#ef4444', // Red
          lineWidth: 2,
          lineStyle: 0,
          axisLabelVisible: true,
          title: `SL ($${activeSetup.stopLossPrice})`,
        });

        const tpLine = candleSeriesRef.current.createPriceLine({
          price: activeSetup.takeProfitPrice,
          color: '#10b981', // Green
          lineWidth: 2,
          lineStyle: 0,
          axisLabelVisible: true,
          title: `TP (${activeSetup.riskReward!.netRR.toFixed(2)}R neto)`,
        });

        priceLinesRef.current.push(entryLine, slLine, tpLine);
      } catch {}
      }
    }
  }, [fvgs, setups, showFvg, showSetups]);

  const activeCandle = hoverData || currentCandle || (candles.length > 0 ? candles[candles.length - 1] : null);
  const priceColor =
    activeCandle && activeCandle.close >= activeCandle.open ? 'text-emerald-400' : 'text-rose-400';

  return (
    <div className="rounded-2xl border border-slate-800 bg-[#0f1422] p-4 shadow-xl">
      {/* Top Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="font-display font-extrabold text-white text-base tracking-wide">
              {symbol}
            </span>
            <span className="rounded-md bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-400 uppercase tracking-wider">
              Bybit V5 Linear
            </span>
          </div>

          {/* Timeframe Selector */}
          <div className="flex items-center gap-1 rounded-xl bg-slate-900/90 p-1 border border-slate-800">
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf}
                onClick={() => onTimeframeChange(tf)}
                className={`px-2.5 py-1 text-xs font-bold rounded-lg transition-all ${
                  timeframe === tf
                    ? 'bg-[var(--color-brand,#FF6600)] text-white shadow-md'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
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
              <span className="text-slate-500">O: </span>
              <span className="text-slate-200 font-semibold">{activeCandle.open.toFixed(1)}</span>
            </div>
            <div>
              <span className="text-slate-500">H: </span>
              <span className="text-slate-200 font-semibold">{activeCandle.high.toFixed(1)}</span>
            </div>
            <div>
              <span className="text-slate-500">L: </span>
              <span className="text-slate-200 font-semibold">{activeCandle.low.toFixed(1)}</span>
            </div>
            <div>
              <span className="text-slate-500">C: </span>
              <span className={`font-bold ${priceColor}`}>{activeCandle.close.toFixed(1)}</span>
            </div>
            <div>
              <span className="text-slate-500">Vol: </span>
              <span className="text-slate-300 font-semibold">{activeCandle.volume.toFixed(3)} BTC</span>
            </div>
          </div>
        )}
      </div>

      {/* Layer Toggles Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 py-2 border-b border-slate-800/50 text-[11px] font-mono">
        <span className="text-slate-400 font-semibold uppercase tracking-wider">Capas SMC / ICT:</span>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setShowSwings(!showSwings)}
            className={`px-2 py-0.5 rounded-md border transition-all ${
              showSwings
                ? 'border-sky-500/40 bg-sky-500/10 text-sky-400 font-bold'
                : 'border-slate-800 text-slate-500 hover:text-slate-300'
            }`}
          >
            ● Swings (HH/LL)
          </button>
          <button
            onClick={() => setShowBreaks(!showBreaks)}
            className={`px-2 py-0.5 rounded-md border transition-all ${
              showBreaks
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400 font-bold'
                : 'border-slate-800 text-slate-500 hover:text-slate-300'
            }`}
          >
            ● BOS / CHoCH
          </button>
          <button
            onClick={() => setShowFvg(!showFvg)}
            className={`px-2 py-0.5 rounded-md border transition-all ${
              showFvg
                ? 'border-amber-500/40 bg-amber-500/10 text-amber-400 font-bold'
                : 'border-slate-800 text-slate-500 hover:text-slate-300'
            }`}
          >
            ● FVG / Zonas
          </button>
          <button
            onClick={() => setShowSetups(!showSetups)}
            className={`px-2 py-0.5 rounded-md border transition-all ${
              showSetups
                ? 'border-[var(--color-brand,#FF6600)] bg-[var(--color-brand,#FF6600)]/10 text-[var(--color-brand,#FF6600)] font-bold'
                : 'border-slate-800 text-slate-500 hover:text-slate-300'
            }`}
          >
            ● Setups 1:4 (SL/TP)
          </button>
        </div>
      </div>

      {/* Candlestick Canvas Container */}
      <div ref={chartContainerRef} className="w-full relative mt-3 rounded-lg overflow-hidden" />
    </div>
  );
}
