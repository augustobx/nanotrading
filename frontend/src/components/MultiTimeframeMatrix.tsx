'use client';

import React from 'react';
import { Timeframe } from './CandleChart';

interface CandleData {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  confirmed?: boolean;
}

interface MultiTimeframeMatrixProps {
  currentCandles: Record<Timeframe, CandleData | null>;
  lastClosedCandles: Record<Timeframe, CandleData | null>;
  activeTimeframe: Timeframe;
  onSelectTimeframe: (tf: Timeframe) => void;
}

const TIMEFRAMES: { id: Timeframe; label: string; role: string }[] = [
  { id: '1d', label: '1D', role: 'Tendencia Macro' },
  { id: '4h', label: '4H', role: 'Estructura Media' },
  { id: '1h', label: '1H', role: 'Estructura Intradía' },
  { id: '15m', label: '15m', role: 'Identificación Setup' },
  { id: '5m', label: '5m', role: 'Gatillo / Confirmación' },
  { id: '1m', label: '1m', role: 'Precisión & Spread' },
];

export function MultiTimeframeMatrix({
  currentCandles,
  lastClosedCandles,
  activeTimeframe,
  onSelectTimeframe,
}: MultiTimeframeMatrixProps) {
  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1422] p-4 shadow-xl">
      <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800/80 mb-3">
        <h3 className="font-display font-bold text-sm text-slate-800 dark:text-slate-200 uppercase tracking-wider">
          Matriz Multitemporal Obligatoria (6 Marcos)
        </h3>
        <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
          Velas Reales Confirmadas
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {TIMEFRAMES.map((item) => {
          const tf = item.id;
          const current = currentCandles[tf];
          const closed = lastClosedCandles[tf];
          const activeCandle = current || closed;

          const isSelected = activeTimeframe === tf;

          let changePcnt = 0;
          let isBullish = true;
          if (activeCandle) {
            changePcnt = ((activeCandle.close - activeCandle.open) / activeCandle.open) * 100;
            isBullish = changePcnt >= 0;
          }

          return (
            <div
              key={tf}
              onClick={() => onSelectTimeframe(tf)}
              className={`p-3 rounded-xl border transition-all cursor-pointer ${
                isSelected
                  ? 'border-[var(--color-brand,#FF6600)] bg-orange-50/50 dark:bg-slate-900 shadow-md ring-1 ring-[var(--color-brand,#FF6600)]/30'
                  : 'border-slate-200 dark:border-slate-800/80 bg-slate-50 dark:bg-slate-900/50 hover:bg-slate-100 dark:hover:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="font-display font-extrabold text-sm text-slate-900 dark:text-white">
                  {item.label}
                </span>
                <span
                  className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${
                    isBullish ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                  }`}
                >
                  {isBullish ? '+' : ''}
                  {changePcnt.toFixed(2)}%
                </span>
              </div>

              <p className="text-[10px] text-slate-500 dark:text-slate-400 font-medium mb-2">{item.role}</p>

              {activeCandle ? (
                <div className="font-mono text-xs space-y-0.5">
                  <div className="flex justify-between">
                    <span className="text-slate-400 dark:text-slate-500 text-[10px]">Close:</span>
                    <span className={`font-bold ${isBullish ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                      ${activeCandle.close.toFixed(1)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400 dark:text-slate-500 text-[10px]">Rango:</span>
                    <span className="text-slate-700 dark:text-slate-300 text-[10px]">
                      ${(activeCandle.high - activeCandle.low).toFixed(1)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400 dark:text-slate-500 text-[10px]">Vol:</span>
                    <span className="text-slate-600 dark:text-slate-400 text-[10px]">
                      {activeCandle.volume.toFixed(1)} BTC
                    </span>
                  </div>
                </div>
              ) : (
                <div className="text-[11px] font-mono text-slate-400 dark:text-slate-600">Sincronizando...</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
