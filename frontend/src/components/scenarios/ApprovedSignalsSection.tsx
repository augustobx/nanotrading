'use client';

import React, { useState } from 'react';
import {
  TrendingUp,
  TrendingDown,
  ShieldCheck,
  Clock,
  Crosshair,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ArrowRight,
  Eye,
  RefreshCw,
} from 'lucide-react';
import {
  formatArgentinaDateTime,
  formatPrice,
  formatPercent,
  formatTimeAgo,
} from '../../utils/formatters';

interface ApprovedSignalsSectionProps {
  signals: any[];
  scenarios: any[];
  onSelectScenario?: (scenarioId: string) => void;
  onRefresh?: () => void;
}

export function ApprovedSignalsSection({
  signals,
  scenarios,
  onSelectScenario,
  onRefresh,
}: ApprovedSignalsSectionProps) {
  const [subTab, setSubTab] = useState<'PENDING' | 'EXECUTED' | 'CLOSED'>('PENDING');

  // Categorize signals
  const pendingSignals = signals.filter(
    (s) => ['ENTRY_VALIDATED', 'ALERT_SENT'].includes(s.state || s.status) && !s.simulatedEntryTime
  );

  const executedSignals = signals.filter(
    (s) => ['TRACKING', 'ENTRY_TRIGGERED'].includes(s.state || s.status) || !!s.simulatedEntryTime && !['COMPLETED_TP', 'COMPLETED_SL'].includes(s.state || s.status)
  );

  const closedSignals = signals.filter(
    (s) => ['COMPLETED_TP', 'COMPLETED_SL'].includes(s.state || s.status)
  );

  const displayedList =
    subTab === 'PENDING'
      ? pendingSignals
      : subTab === 'EXECUTED'
      ? executedSignals
      : closedSignals;

  return (
    <div className="space-y-4">
      {/* Header with Sub-tabs */}
      <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1422] shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-bold">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-display font-extrabold text-sm sm:text-base text-slate-900 dark:text-white uppercase tracking-wider">
              Señales Aprobadas
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Setups que superaron estrictamente el doble consenso de IA y R:R neto ≥ 1:4.
            </p>
          </div>
        </div>

        {/* Sub-tabs pills */}
        <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-900/80 p-1 rounded-xl border border-slate-200 dark:border-slate-800 self-start sm:self-auto">
          <button
            onClick={() => setSubTab('PENDING')}
            className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-all ${
              subTab === 'PENDING'
                ? 'bg-amber-500 text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            Aprobada, Esperando Entrada ({pendingSignals.length})
          </button>
          <button
            onClick={() => setSubTab('EXECUTED')}
            className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-all ${
              subTab === 'EXECUTED'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            Entrada Ejecutada ({executedSignals.length})
          </button>
          <button
            onClick={() => setSubTab('CLOSED')}
            className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-all ${
              subTab === 'CLOSED'
                ? 'bg-purple-600 text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            Cerrada ({closedSignals.length})
          </button>
        </div>
      </div>

      {/* Signals List / Table */}
      {displayedList.length === 0 ? (
        <div className="p-8 text-center rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40 space-y-2">
          <ShieldCheck className="w-9 h-9 text-slate-400 dark:text-slate-600 mx-auto" />
          <h4 className="font-display font-bold text-slate-700 dark:text-slate-300 text-sm">
            {subTab === 'PENDING'
              ? 'No hay señales aprobadas esperando entrada en este momento'
              : subTab === 'EXECUTED'
              ? 'No hay señales con entrada ejecutada en este momento'
              : 'No hay señales históricas cerradas en este estado'}
          </h4>
          <p className="text-xs font-mono text-slate-500 max-w-md mx-auto">
            El sistema sólo autoriza señales ante estricto cumplimiento de R:R neto ≥ 1:4 y confluencia de análisis causal.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto custom-scrollbar rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1422] shadow-sm">
          <table className="w-full text-left font-mono text-xs min-w-[900px]">
            <thead className="bg-slate-50 dark:bg-slate-900/60 text-slate-500 text-[11px] border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="py-3 px-4">ID Señal / Setup</th>
                <th className="py-3 px-3">Fecha/Hora Autorización</th>
                <th className="py-3 px-2">Dir</th>
                <th className="py-3 px-3 text-right">Precio Entrada</th>
                <th className="py-3 px-3 text-right">Stop Loss</th>
                <th className="py-3 px-3 text-right">Take Profit</th>
                <th className="py-3 px-3 text-right">R:R Neto</th>
                <th className="py-3 px-3 text-center">Estado de Señal</th>
                <th className="py-3 px-4 text-right">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 text-slate-700 dark:text-slate-300">
              {displayedList.map((sig) => {
                const isLong = sig.direction === 'LONG';
                return (
                  <tr key={sig.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/50 transition-colors">
                    <td className="py-3 px-4">
                      <div className="font-bold text-slate-900 dark:text-white">{sig.id}</div>
                      <div className="text-[10px] text-slate-500">Setup: {sig.setupId || '---'}</div>
                    </td>
                    <td className="py-3 px-3 text-[11px]">
                      <div>{formatArgentinaDateTime(sig.createdAt || sig.timestamp)}</div>
                      <div className="text-[10px] text-slate-500">{formatTimeAgo(sig.createdAt || sig.timestamp)}</div>
                    </td>
                    <td className="py-3 px-2">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        isLong
                          ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700'
                          : 'bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-300 dark:border-rose-700'
                      }`}>
                        {sig.direction}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right font-bold text-slate-900 dark:text-slate-100">
                      ${sig.entryPrice?.toFixed(1) || '---'}
                    </td>
                    <td className="py-3 px-3 text-right text-rose-600 dark:text-rose-400">
                      ${sig.stopLossPrice?.toFixed(1) || '---'}
                    </td>
                    <td className="py-3 px-3 text-right text-emerald-600 dark:text-emerald-400 font-bold">
                      ${sig.takeProfitPrice?.toFixed(1) || '---'}
                    </td>
                    <td className="py-3 px-3 text-right text-amber-500 dark:text-amber-400 font-bold">
                      {sig.netRR ? `1:${sig.netRR.toFixed(1)}` : '≥ 1:4.0'}
                    </td>
                    <td className="py-3 px-3 text-center">
                      <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold ${
                        subTab === 'PENDING'
                          ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-700 animate-pulse'
                          : subTab === 'EXECUTED'
                          ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700'
                          : 'bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border border-purple-300 dark:border-purple-700'
                      }`}>
                        {subTab === 'PENDING'
                          ? 'AUTORIZADA · ESPERANDO TICK'
                          : subTab === 'EXECUTED'
                          ? 'ENTRADA EJECUTADA'
                          : 'CERRADA'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      {onSelectScenario && sig.setupId && (
                        <button
                          onClick={() => onSelectScenario(sig.setupId)}
                          className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-orange-600 dark:text-orange-400 font-bold text-xs transition-colors cursor-pointer"
                        >
                          Ver Setup
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
