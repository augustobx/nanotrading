'use client';

import React from 'react';
import {
  Activity,
  Crosshair,
  TrendingUp,
  TrendingDown,
  Clock,
  ShieldAlert,
  CheckCircle2,
  XCircle,
  AlertOctagon,
  ChevronRight,
  ExternalLink,
} from 'lucide-react';

export interface ActiveSignalItem {
  id: string;
  setupId: string;
  symbol: string;
  strategy: string;
  direction: 'LONG' | 'SHORT';
  timeframe: string;
  entryPrice: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  netRR: number;
  state: string;
  entryMode: string;
  simulatedEntryTime?: number;
  exitTime?: number;
  durationMs?: number;
  mfePrice?: number;
  mfeR?: number;
  maePrice?: number;
  maeR?: number;
  realizedNetR?: number;
  realizedNetPnlUsdt?: number;
  createdAt: number;
}

interface SignalLifecycleMonitorProps {
  activeSignals: ActiveSignalItem[];
  onCancelSignal?: (signalId: string) => void;
  onRefresh?: () => void;
}

export function SignalLifecycleMonitor({
  activeSignals,
  onCancelSignal,
  onRefresh,
}: SignalLifecycleMonitorProps) {
  const getStateBadge = (state: string) => {
    switch (state) {
      case 'IN_ZONE':
        return (
          <span className="px-2.5 py-1 rounded-full text-[11px] font-mono font-bold bg-purple-500/20 text-purple-300 border border-purple-500/40 animate-pulse flex items-center gap-1.5 shadow-[0_0_12px_rgba(168,85,247,0.3)]">
            <span className="w-1.5 h-1.5 rounded-full bg-purple-400" />
            EN ZONA (IN_ZONE)
          </span>
        );
      case 'TRACKING':
        return (
          <span className="px-2.5 py-1 rounded-full text-[11px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 flex items-center gap-1.5 shadow-[0_0_12px_rgba(16,185,129,0.3)]">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
            SEGUIMIENTO ACTIVO (TRACKING)
          </span>
        );
      case 'APPROACHING_ZONE':
        return (
          <span className="px-2.5 py-1 rounded-full text-[11px] font-mono font-bold bg-blue-500/20 text-blue-300 border border-blue-500/40 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
            APROXIMÁNDOSE (0.25%)
          </span>
        );
      case 'ENTRY_VALIDATED':
      case 'ALERT_SENT':
        return (
          <span className="px-2.5 py-1 rounded-full text-[11px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
            AUTORIZADA / ESPERANDO ENTRADA
          </span>
        );
      default:
        return (
          <span className="px-2.5 py-1 rounded-full text-[11px] font-mono font-bold bg-slate-800 text-slate-300 border border-slate-700">
            {state}
          </span>
        );
    }
  };

  const formatDuration = (ms?: number) => {
    if (!ms || ms <= 0) return '< 1m';
    const totalMinutes = Math.floor(ms / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  };

  return (
    <div className="rounded-2xl border border-slate-800 bg-[#0f1422] p-4 sm:p-5 shadow-xl">
      {/* Card Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800/80 mb-4">
        <div className="flex items-center gap-2.5">
          <Activity className="w-5 h-5 text-emerald-400" />
          <h3 className="font-display font-bold text-base text-slate-100 uppercase tracking-wider">
            Monitor 24/7 · Ciclo de Vida de Señales & Paper Trading
          </h3>
          <span className="px-2 py-0.5 rounded-full text-xs font-mono font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            {activeSignals.length} en seguimiento
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs font-mono text-slate-400">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            Worker Event-Driven Activo
          </span>
        </div>
      </div>

      {/* Signals List */}
      {activeSignals.length === 0 ? (
        <div className="p-8 text-center rounded-xl border border-dashed border-slate-800 bg-slate-900/40">
          <Crosshair className="w-10 h-10 text-slate-600 mx-auto mb-2 opacity-50" />
          <p className="text-sm font-medium text-slate-400 mb-1">
            No hay señales en seguimiento en este momento
          </p>
          <p className="text-xs font-mono text-slate-500 max-w-md mx-auto">
            El motor cuantitativo y el worker 24/7 monitorean BTCUSDT en tiempo real.
            Cuando se detecte una confluencia con R:R neto ≥ 1:4 y doble consenso de IA, aparecerá aquí.
            <br />
            <strong className="text-slate-400 mt-1 block">
              "No operar es una decisión válida y a menudo la mejor."
            </strong>
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {activeSignals.map((signal) => {
            const isLong = signal.direction === 'LONG';
            const mfeR = signal.mfeR ?? 0;
            const maeR = signal.maeR ?? 0;

            return (
              <div
                key={signal.id}
                className="rounded-xl border border-slate-800/90 bg-[#141a29] p-4 hover:border-slate-700 transition-all shadow-md"
              >
                <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-2 py-0.5 rounded font-mono text-xs font-bold ${
                        isLong
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                          : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                      }`}
                    >
                      {isLong ? 'LONG ↗' : 'SHORT ↘'} #{signal.symbol}
                    </span>
                    <span className="text-xs font-mono text-slate-400">
                      {signal.strategy} · {signal.timeframe}
                    </span>
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                      {signal.entryMode || 'PAPER_TRADING'}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    {getStateBadge(signal.state)}
                    {onCancelSignal && (
                      <button
                        onClick={() => onCancelSignal(signal.id)}
                        className="px-2 py-1 rounded text-[11px] font-mono text-rose-400 hover:bg-rose-500/20 border border-rose-500/30 transition-colors"
                        title="Cancelar y descartar señal manualmente"
                      >
                        Descartar
                      </button>
                    )}
                  </div>
                </div>

                {/* Targets Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-3 font-mono text-xs">
                  <div className="p-2 rounded-lg bg-slate-900/60 border border-slate-800">
                    <span className="text-[10px] text-slate-500 block uppercase">Entrada</span>
                    <span className="font-bold text-slate-200">
                      ${signal.entryPrice.toLocaleString('en-US', { minimumFractionDigits: 1 })}
                    </span>
                  </div>
                  <div className="p-2 rounded-lg bg-slate-900/60 border border-slate-800">
                    <span className="text-[10px] text-slate-500 block uppercase">Stop Loss</span>
                    <span className="font-bold text-rose-400">
                      ${signal.stopLossPrice.toLocaleString('en-US', { minimumFractionDigits: 1 })}
                    </span>
                  </div>
                  <div className="p-2 rounded-lg bg-slate-900/60 border border-slate-800">
                    <span className="text-[10px] text-slate-500 block uppercase">Take Profit</span>
                    <span className="font-bold text-emerald-400">
                      ${signal.takeProfitPrice.toLocaleString('en-US', { minimumFractionDigits: 1 })}
                    </span>
                  </div>
                  <div className="p-2 rounded-lg bg-slate-900/60 border border-slate-800">
                    <span className="text-[10px] text-slate-500 block uppercase">R:R Neto / Duración</span>
                    <span className="font-bold text-amber-400">
                      1:{signal.netRR.toFixed(2)}
                    </span>
                    <span className="text-slate-400 ml-1.5 text-[11px]">
                      ({formatDuration(signal.durationMs)})
                    </span>
                  </div>
                </div>

                {/* MFE / MAE Excursion Gauge (Only when tracking) */}
                {signal.state === 'TRACKING' && (
                  <div className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800 font-mono text-xs">
                    <div className="flex justify-between items-center text-[11px] mb-1">
                      <span className="text-rose-400 flex items-center gap-1">
                        <TrendingDown className="w-3.5 h-3.5" />
                        MAE Máx Adverso: {maeR.toFixed(2)}R
                      </span>
                      <span className="text-emerald-400 flex items-center gap-1 font-bold">
                        <TrendingUp className="w-3.5 h-3.5" />
                        MFE Máx Favorable: +{mfeR.toFixed(2)}R
                      </span>
                    </div>

                    {/* Progress indicator */}
                    <div className="w-full bg-slate-800 rounded-full h-2 relative overflow-hidden">
                      <div
                        className="bg-emerald-500 h-2 rounded-full transition-all duration-300"
                        style={{
                          width: `${Math.min(100, Math.max(5, (mfeR / signal.netRR) * 100))}%`,
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
