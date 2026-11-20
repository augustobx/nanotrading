'use client';

import React, { useEffect, useRef, useState } from 'react';
import { createChart, IChartApi, ISeriesApi, CandlestickData, HistogramData, Time } from 'lightweight-charts';

export type Timeframe = '1m' | '5m' | '15m' | '1h' | '4h' | '1d';

interface CandleData {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  confirmed?: boolean;
}

interface CandleChartProps {
  candles: CandleData[];
  currentCandle: CandleData | null;
  timeframe: Timeframe;
  onTimeframeChange: (tf: Timeframe) => void;
  symbol?: string;
  isDark?: boolean;
}

const TIMEFRAMES: Timeframe[] = ['1m', '5m', '15m', '1h', '4h', '1d'];

export function CandleChart({
  candles,
  currentCandle,
  timeframe,
  onTimeframeChange,
  symbol = 'BTCUSDT',
  isDark = true,
}: CandleChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);

  const [hoverData, setHoverData] = useState<CandleData | null>(null);

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
        mode: 1, // Magnet
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
      upColor: '#10b981', // Emerald green
      downColor: '#ef4444', // Red
      borderVisible: false,
      wickUpColor: '#10b981',
      wickDownColor: '#ef4444',
    });

    const volumeSeries = chart.addHistogramSeries({
      color: '#3b82f6',
      priceFormat: {
        type: 'volume',
      },
      priceScaleId: '', // Set as overlay
    });

    volumeSeries.priceScale().applyOptions({
      scaleMargins: {
        top: 0.8, // Places volume at the bottom 20%
        bottom: 0,
      },
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;

    // Crosshair move handler
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

    // Handle responsive resize
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

  // Set initial and updated historical candles
  useEffect(() => {
    if (!candleSeriesRef.current || !volumeSeriesRef.current || candles.length === 0) return;

    const formattedCandles: CandlestickData<Time>[] = [];
    const formattedVolume: HistogramData<Time>[] = [];

    // Deduplicate and sort by timestamp
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

  // Update current ticking candle
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

  const activeCandle = hoverData || currentCandle || (candles.length > 0 ? candles[candles.length - 1] : null);
  const priceColor =
    activeCandle && activeCandle.close >= activeCandle.open ? 'text-emerald-400' : 'text-rose-400';

  return (
    <div className="rounded-2xl border border-slate-800 bg-[#0f1422] p-4 shadow-xl">
      {/* Header Bar */}
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

          {/* Timeframe Buttons */}
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

      {/* Candlestick Canvas Container */}
      <div ref={chartContainerRef} className="w-full relative mt-3 rounded-lg overflow-hidden" />
    </div>
  );
}
