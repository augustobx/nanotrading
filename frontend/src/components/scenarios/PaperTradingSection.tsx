'use client';

import React, { useState } from 'react';
import {
  ShieldCheck,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Clock,
  CheckCircle2,
  XCircle,
  Activity,
  RefreshCw,
  BarChart3,
} from 'lucide-react';
import {
  formatArgentinaDateTime,
  formatPrice,
  formatUsd,
  formatPercent,
  formatDurationMs,
  formatTimeAgo,
} from '../../utils/formatters';

interface PaperTradingSectionProps {
  signals: any[];
  onRefresh?: () => void;
}

export function PaperTradingSection({ signals, onRefresh }: PaperTradingSectionProps) {
  const [tab, setTab] = useState<'OPEN' | 'CLOSED'>('OPEN');

  const openPositions = signals.filter(
    (s) => ['TRACKING', 'ENTRY_TRIGGERED'].includes(s.state || s.status) && !!s.simulatedEntryTime
  );

  const closedPositions = signals.filter(
    (s) => ['COMPLETED_TP', 'COMPLETED_SL'].includes(s.state || s.status)
  );

  // Calculate Net Metrics
  const totalClosed = closedPositions.length;
  const tpCount = closedPositions.filter((s) => (s.state || s.status) === 'COMPLETED_TP').length;
  const slCount = closedPositions.filter((s) => (s.state || s.status) === 'COMPLETED_SL').length;
  const winRate = totalClosed > 0 ? (tpCount / totalClosed) * 100 : 0;

  const totalRealizedPnl = closedPositions.reduce((sum, s) => sum + (s.realizedNetPnlUsdt || 0), 0);
  const totalRealizedR = closedPositions.reduce((sum, s) => {
    if (s.realizedNetR !== undefined) return sum + s.realizedNetR;
    return sum + ((s.state || s.status) === 'COMPLETED_TP' ? 4.0 : -1.0);
  }, 0);

  return (
    <div className="space-y-4">
      {/* Top Paper Metrics Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-3">
        <div className="p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1422] shadow-sm">
          <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider block">
            Posiciones Abiertas
          </span>
          <div className="text-xl font-mono font-extrabold text-emerald-600 dark:text-emerald-400 mt-1 flex items-center gap-1.5">
            {openPositions.length > 0 && <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />}
            {openPositions.length}
          </div>
          <span className="text-[10px] font-mono text-slate-400 mt-0.5 block">
            En seguimiento activo
          </span>
        </div>

        <div className="p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1422] shadow-sm">
          <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider block">
            Trades Cerrados
          </span>
          <div className="text-xl font-mono font-extrabold text-slate-900 dark:text-white mt-1">
            {totalClosed}
          </div>
          <span className="text-[10px] font-mono text-slate-400 mt-0.5 block">
            {tpCount} TP · {slCount} SL
          </span>
        </div>

        <div className="p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1422] shadow-sm">
          <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider block">
            PnL Neto Realizado
          </span>
          <div className={`text-xl font-mono font-extrabold mt-1 ${
            totalRealizedPnl >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
          }`}>
            {totalRealizedPnl >= 0 ? '+' : ''}${totalRealizedPnl.toFixed(2)} USD
          </div>
          <span className="text-[10px] font-mono text-slate-400 mt-0.5 block">
            Saldo virtual ref. $100
          </span>
        </div>

        <div className="p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1422] shadow-sm">
          <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider block">
            R Neto Acumulado
          </span>
          <div className={`text-xl font-mono font-extrabold mt-1 ${
            totalRealizedR >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
          }`}>
            {totalRealizedR >= 0 ? '+' : ''}{totalRealizedR.toFixed(2)}R
          </div>
          <span className="text-[10px] font-mono text-slate-400 mt-0.5 block">
            Normalizado por riesgo
          </span>
        </div>

        <div className="p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1422] shadow-sm col-span-2 sm:col-span-4 lg:col-span-1">
          <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider block">
            Win Rate (TP/SL)
          </span>
          <div className="text-xl font-mono font-extrabold text-blue-600 dark:text-blue-400 mt-1">
            {winRate.toFixed(1)}%
          </div>
          <span className="text-[10px] font-mono text-slate-400 mt-0.5 block">
            {totalClosed > 0 ? `${tpCount} de ${totalClosed} trades` : 'Sin cierres aún'}
          </span>
        </div>
      </div>

      {/* Tabs Switcher & Disclaimer */}
      <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1422] shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-900/80 p-1 rounded-xl border border-slate-200 dark:border-slate-800 self-start sm:self-auto">
          <button
            onClick={() => setTab('OPEN')}
            className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-all ${
              tab === 'OPEN'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            Posiciones Abiertas ({openPositions.length})
          </button>
          <button
            onClick={() => setTab('CLOSED')}
            className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-all ${
              tab === 'CLOSED'
                ? 'bg-purple-600 text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            Operaciones Cerradas ({closedPositions.length})
          </button>
        </div>

        <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 flex items-center gap-2">
          <span>Modo: <strong className="text-emerald-600 dark:text-emerald-400">SIGNALS_ONLY</strong></span>
          <span>·</span>
          <span>Ejecución Real: <strong className="text-rose-500">DESHABILITADA</strong></span>
        </div>
      </div>

      {/* Tables Content */}
      {tab === 'OPEN' ? (
        openPositions.length === 0 ? (
          <div className="p-8 text-center rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40 space-y-2">
            <ShieldCheck className="w-9 h-9 text-slate-400 dark:text-slate-600 mx-auto" />
            <h4 className="font-display font-bold text-slate-700 dark:text-slate-300 text-sm">
              No hay posiciones paper abiertas en este momento
            </h4>
            <p className="text-xs font-mono text-slate-500 max-w-md mx-auto">
              Las posiciones virtuales se inician únicamente cuando una señal autorizada es alcanzada por el precio en tiempo real.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto custom-scrollbar rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1422] shadow-sm">
            <table className="w-full text-left font-mono text-xs min-w-[950px]">
              <thead className="bg-slate-50 dark:bg-slate-900/60 text-slate-500 text-[11px] border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="py-3 px-4">ID Señal</th>
                  <th className="py-3 px-3">Fecha/Hora Entrada</th>
                  <th className="py-3 px-2">Dir</th>
                  <th className="py-3 px-3 text-right">Entrada</th>
                  <th className="py-3 px-3 text-right">Stop Loss</th>
                  <th className="py-3 px-3 text-right">Take Profit</th>
                  <th className="py-3 px-3 text-right">R:R Neto Proyectado</th>
                  <th className="py-3 px-3 text-right">MFE (R)</th>
                  <th className="py-3 px-3 text-right">MAE (R)</th>
                  <th className="py-3 px-4 text-center">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 text-slate-700 dark:text-slate-300">
                {openPositions.map((pos) => {
                  const isLong = pos.direction === 'LONG';
                  return (
                    <tr key={pos.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/50 transition-colors">
                      <td className="py-3 px-4 font-bold text-slate-900 dark:text-white">{pos.id}</td>
                      <td className="py-3 px-3 text-[11px]">
                        <div>{formatArgentinaDateTime(pos.simulatedEntryTime)}</div>
                        <div className="text-[10px] text-slate-500">{formatTimeAgo(pos.simulatedEntryTime)}</div>
                      </td>
                      <td className="py-3 px-2">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          isLong
                            ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700'
                            : 'bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-300 dark:border-rose-700'
                        }`}>
                          {pos.direction}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-right font-bold text-slate-900 dark:text-slate-100">
                        ${pos.entryPrice?.toFixed(1)}
                      </td>
                      <td className="py-3 px-3 text-right text-rose-600 dark:text-rose-400">
                        ${pos.stopLossPrice?.toFixed(1)}
                      </td>
                      <td className="py-3 px-3 text-right text-emerald-600 dark:text-emerald-400 font-bold">
                        ${pos.takeProfitPrice?.toFixed(1)}
                      </td>
                      <td className="py-3 px-3 text-right text-amber-500 font-bold">
                        +{pos.netRR?.toFixed(2) || '4.00'}R
                      </td>
                      <td className="py-3 px-3 text-right text-emerald-500 font-bold">
                        +{pos.mfeR?.toFixed(2) || '0.00'}R
                      </td>
                      <td className="py-3 px-3 text-right text-rose-500">
                        -{pos.maeR?.toFixed(2) || '0.00'}R
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700 animate-pulse">
                          TRACKING ACTIVO
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      ) : (
        closedPositions.length === 0 ? (
          <div className="p-8 text-center rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40 space-y-2">
            <CheckCircle2 className="w-9 h-9 text-slate-400 dark:text-slate-600 mx-auto" />
            <h4 className="font-display font-bold text-slate-700 dark:text-slate-300 text-sm">
              Sin operaciones paper cerradas aún
            </h4>
            <p className="text-xs font-mono text-slate-500 max-w-md mx-auto">
              Cuando una posición virtual alcance su Take Profit o Stop Loss, quedará registrada aquí con su resultado auditado.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto custom-scrollbar rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1422] shadow-sm">
            <table className="w-full text-left font-mono text-xs min-w-[950px]">
              <thead className="bg-slate-50 dark:bg-slate-900/60 text-slate-500 text-[11px] border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="py-3 px-4">ID Señal</th>
                  <th className="py-3 px-3">Fecha/Hora Cierre</th>
                  <th className="py-3 px-2">Dir</th>
                  <th className="py-3 px-3 text-right">Precio Entrada</th>
                  <th className="py-3 px-3 text-right">Precio Salida</th>
                  <th className="py-3 px-3 text-right">PnL Neto</th>
                  <th className="py-3 px-3 text-right">R Neto</th>
                  <th className="py-3 px-3 text-center">Duración</th>
                  <th className="py-3 px-4 text-center">Resultado Final</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 text-slate-700 dark:text-slate-300">
                {closedPositions.map((pos) => {
                  const isTp = (pos.state || pos.status) === 'COMPLETED_TP';
                  const isLong = pos.direction === 'LONG';
                  return (
                    <tr key={pos.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/50 transition-colors">
                      <td className="py-3 px-4 font-bold text-slate-900 dark:text-white">{pos.id}</td>
                      <td className="py-3 px-3 text-[11px]">
                        <div>{formatArgentinaDateTime(pos.exitTime || pos.timestamp)}</div>
                        <div className="text-[10px] text-slate-500">{formatTimeAgo(pos.exitTime || pos.timestamp)}</div>
                      </td>
                      <td className="py-3 px-2">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          isLong
                            ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700'
                            : 'bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-300 dark:border-rose-700'
                        }`}>
                          {pos.direction}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-right">${pos.entryPrice?.toFixed(1)}</td>
                      <td className="py-3 px-3 text-right">${pos.exitPrice?.toFixed(1) || '---'}</td>
                      <td className="py-3 px-3 text-right font-bold">
                        <span className={isTp ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}>
                          {pos.realizedNetPnlUsdt !== undefined
                            ? `${pos.realizedNetPnlUsdt >= 0 ? '+' : ''}$${pos.realizedNetPnlUsdt.toFixed(2)} USD`
                            : isTp ? '+$400.00 USD' : '-$100.00 USD'}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-right font-bold">
                        <span className={isTp ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}>
                          {pos.realizedNetR !== undefined
                            ? `${pos.realizedNetR >= 0 ? '+' : ''}${pos.realizedNetR.toFixed(2)}R`
                            : isTp ? '+4.00R' : '-1.00R'}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-center text-slate-500 text-[11px]">
                        {formatDurationMs(pos.durationMs)}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold ${
                          isTp
                            ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700'
                            : 'bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-300 dark:border-rose-700'
                        }`}>
                          {isTp ? 'TAKE PROFIT (+)' : 'STOP LOSS (-)'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
}
