'use client';

import React, { useState } from 'react';
import {
  Ban,
  AlertOctagon,
  Clock,
  Eye,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Filter,
} from 'lucide-react';
import {
  formatArgentinaDateTime,
  formatPrice,
  formatTimeAgo,
} from '../../utils/formatters';
import { getScenarioNarrative } from '../../utils/operational-taxonomy';

interface DiscardedWithoutTradeSectionProps {
  scenarios: any[];
  onSelectScenario: (scenarioId: string) => void;
}

export function DiscardedWithoutTradeSection({
  scenarios,
  onSelectScenario,
}: DiscardedWithoutTradeSectionProps) {
  const [filterSubcategory, setFilterSubcategory] = useState<
    'ALL' | 'NEUTRAL_COMPLETED' | 'INVALIDATED' | 'EXPIRED' | 'CANCELLED'
  >('ALL');

  // Filter only scenarios that ended WITHOUT trade
  const discardedScenarios = scenarios.filter((s) => {
    const isNeutral = s.kind === 'NEUTRAL_OBSERVATION' || s.direction === 'NEUTRAL';
    const status = s.status || '';

    if (['INVALIDATED', 'EXPIRED', 'CANCELLED', 'NO_TRADE_OBSERVATION'].includes(status)) return true;
    if (status === 'COMPLETED' && isNeutral) return true;
    return false;
  });

  const filteredList = discardedScenarios.filter((s) => {
    const isNeutral = s.kind === 'NEUTRAL_OBSERVATION' || s.direction === 'NEUTRAL';
    const status = s.status || '';

    if (filterSubcategory === 'NEUTRAL_COMPLETED') {
      return isNeutral && (status === 'COMPLETED' || status === 'NO_TRADE_OBSERVATION');
    }
    if (filterSubcategory === 'INVALIDATED') {
      return status === 'INVALIDATED';
    }
    if (filterSubcategory === 'EXPIRED') {
      return status === 'EXPIRED';
    }
    if (filterSubcategory === 'CANCELLED') {
      return status === 'CANCELLED';
    }
    return true;
  });

  const neutralCompletedCount = discardedScenarios.filter(
    (s) => (s.kind === 'NEUTRAL_OBSERVATION' || s.direction === 'NEUTRAL') && s.status === 'COMPLETED'
  ).length;

  const invalidatedCount = discardedScenarios.filter((s) => s.status === 'INVALIDATED').length;
  const expiredCount = discardedScenarios.filter((s) => s.status === 'EXPIRED').length;
  const cancelledCount = discardedScenarios.filter((s) => s.status === 'CANCELLED').length;

  return (
    <div className="space-y-4">
      {/* Section Header */}
      <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1422] shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-slate-500/15 text-slate-600 dark:text-slate-400 flex items-center justify-center font-bold">
            <Ban className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-display font-extrabold text-sm sm:text-base text-slate-900 dark:text-white uppercase tracking-wider">
                Finalizados Sin Trade
              </h3>
              <span className="px-2 py-0.5 rounded-full text-xs font-mono font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700">
                {discardedScenarios.length} archivados
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Hipótesis y observaciones que concluyeron sin abrir ninguna operación ni arriesgar saldo.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs font-mono bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800/40 text-emerald-700 dark:text-emerald-400 px-3 py-1.5 rounded-xl self-start sm:self-auto">
          <ShieldCheck className="w-4 h-4 text-emerald-500" />
          <span>Capital Arriesgado: <strong>$0.00 USDT</strong></span>
        </div>
      </div>

      {/* Subcategory Filter Buttons */}
      <div className="flex items-center flex-wrap gap-1.5 pb-1">
        <button
          onClick={() => setFilterSubcategory('ALL')}
          className={`px-3 py-1.5 rounded-xl text-xs font-mono font-bold transition-all ${
            filterSubcategory === 'ALL'
              ? 'bg-slate-800 text-white shadow-sm'
              : 'bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          TODOS ({discardedScenarios.length})
        </button>

        <button
          onClick={() => setFilterSubcategory('NEUTRAL_COMPLETED')}
          className={`px-3 py-1.5 rounded-xl text-xs font-mono font-bold transition-all ${
            filterSubcategory === 'NEUTRAL_COMPLETED'
              ? 'bg-amber-600 text-white shadow-sm'
              : 'bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          Observación Concluida / Ruptura ({neutralCompletedCount})
        </button>

        <button
          onClick={() => setFilterSubcategory('INVALIDATED')}
          className={`px-3 py-1.5 rounded-xl text-xs font-mono font-bold transition-all ${
            filterSubcategory === 'INVALIDATED'
              ? 'bg-rose-700 text-white shadow-sm'
              : 'bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          Invalidación Estructural ({invalidatedCount})
        </button>

        <button
          onClick={() => setFilterSubcategory('EXPIRED')}
          className={`px-3 py-1.5 rounded-xl text-xs font-mono font-bold transition-all ${
            filterSubcategory === 'EXPIRED'
              ? 'bg-slate-600 text-white shadow-sm'
              : 'bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          Tiempo Agotado ({expiredCount})
        </button>

        <button
          onClick={() => setFilterSubcategory('CANCELLED')}
          className={`px-3 py-1.5 rounded-xl text-xs font-mono font-bold transition-all ${
            filterSubcategory === 'CANCELLED'
              ? 'bg-purple-700 text-white shadow-sm'
              : 'bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          Cancelado por IA o Riesgo ({cancelledCount})
        </button>
      </div>

      {/* Discarded Scenarios Table */}
      {filteredList.length === 0 ? (
        <div className="p-8 text-center rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40 space-y-2">
          <Ban className="w-9 h-9 text-slate-400 dark:text-slate-600 mx-auto" />
          <h4 className="font-display font-bold text-slate-700 dark:text-slate-300 text-sm">
            No hay escenarios archivados en esta categoría
          </h4>
        </div>
      ) : (
        <div className="overflow-x-auto custom-scrollbar rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1422] shadow-sm">
          <table className="w-full text-left font-mono text-xs min-w-[1000px]">
            <thead className="bg-slate-50 dark:bg-slate-900/60 text-slate-500 text-[11px] border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="py-3 px-4">ID Escenario</th>
                <th className="py-3 px-3">Fecha Descubrimiento</th>
                <th className="py-3 px-2">Tipo / Dir</th>
                <th className="py-3 px-3">Zona / Rango</th>
                <th className="py-3 px-4">Motivo de Fin / Descarte</th>
                <th className="py-3 px-3 text-center">Riesgo Real</th>
                <th className="py-3 px-3 text-center">Resultado</th>
                <th className="py-3 px-4 text-right">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 text-slate-700 dark:text-slate-300">
              {filteredList.map((sc) => {
                const narrative = getScenarioNarrative(sc);
                const isNeutral = narrative.isNeutral;
                return (
                  <tr key={sc.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/50 transition-colors">
                    <td className="py-3 px-4">
                      <div className="font-bold text-slate-900 dark:text-white">{sc.id}</div>
                      <div className="text-[10px] text-slate-500">{sc.timeframe} · {sc.structureType || 'SMC'}</div>
                    </td>
                    <td className="py-3 px-3 text-[11px]">
                      <div>{formatArgentinaDateTime(sc.discoveryTimestamp)}</div>
                      <div className="text-[10px] text-slate-500">{formatTimeAgo(sc.discoveryTimestamp)}</div>
                    </td>
                    <td className="py-3 px-2">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        isNeutral
                          ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-700'
                          : sc.direction === 'LONG'
                          ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                          : 'bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300'
                      }`}>
                        {sc.direction}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-slate-800 dark:text-slate-200">
                      ${sc.entryZoneMin?.toFixed(1)} - ${sc.entryZoneMax?.toFixed(1)}
                    </td>
                    <td className="py-3 px-4 max-w-xs text-xs font-sans leading-snug">
                      <span className="text-slate-800 dark:text-slate-200 font-semibold block">
                        {narrative.porQueTermino}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-center">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300">
                        $0.00 USDT
                      </span>
                    </td>
                    <td className="py-3 px-3 text-center">
                      <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold ${
                        isNeutral
                          ? 'bg-cyan-100 dark:bg-cyan-950/60 text-cyan-700 dark:text-cyan-300 border border-cyan-300 dark:border-cyan-700'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-400 border border-slate-300 dark:border-slate-700'
                      }`}>
                        {isNeutral ? 'OBSERVACIÓN FIN (SIN TRADE)' : 'DESCARTADO (SIN TRADE)'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        onClick={() => onSelectScenario(sc.id)}
                        className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-orange-600 dark:text-orange-400 font-bold text-xs transition-colors cursor-pointer"
                      >
                        Ver Detalle
                      </button>
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
