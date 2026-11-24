'use client';

import React, { useState } from 'react';
import {
  Search,
  Filter,
  Eye,
  TrendingUp,
  TrendingDown,
  Radar,
  ShieldCheck,
  Ban,
  Clock,
  ArrowRight,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RotateCcw,
} from 'lucide-react';
import {
  formatArgentinaDateTime,
  formatPrice,
  formatPercent,
  formatTimeAgo,
} from '../../utils/formatters';
import {
  getScenarioNarrative,
  PR41_DEPLOY_TIMESTAMP,
} from '../../utils/operational-taxonomy';

interface FullAuditTableSectionProps {
  scenarios: any[];
  onSelectScenario: (scenarioId: string) => void;
}

export function FullAuditTableSection({
  scenarios,
  onSelectScenario,
}: FullAuditTableSectionProps) {
  // Filters State
  const [searchQuery, setSearchQuery] = useState('');
  const [lifeFilter, setLifeFilter] = useState<'ALL' | 'ACTIVE' | 'FINISHED' | 'NO_TRADE' | 'WITH_PAPER' | 'CLOSED'>('ALL');
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'NEUTRAL' | 'LONG' | 'SHORT' | 'SIGNALS' | 'PAPER'>('ALL');
  const [resultFilter, setResultFilter] = useState<'ALL' | 'NO_ENTRY' | 'OPEN_ENTRY' | 'CLOSED_TP' | 'CLOSED_SL' | 'REJECTED' | 'EXPIRED' | 'INVALIDATED' | 'CANCELLED'>('ALL');
  const [periodFilter, setPeriodFilter] = useState<'ALL' | 'TODAY' | '24H' | '7D' | '30D'>('ALL');
  const [versionFilter, setVersionFilter] = useState<'ALL' | 'POST_FIXES' | 'PRE_FIXES'>('ALL');

  // Filter application
  const filteredScenarios = scenarios.filter((sc) => {
    const narrative = getScenarioNarrative(sc);
    const status = sc.status || '';
    const isNeutral = narrative.isNeutral;
    const now = Date.now();

    // Search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchId = sc.id?.toLowerCase().includes(q);
      const matchTf = sc.timeframe?.toLowerCase().includes(q);
      const matchStruct = sc.structureType?.toLowerCase().includes(q);
      const matchStatus = narrative.humaneStatus?.toLowerCase().includes(q);
      const matchWhy = narrative.porQueTermino?.toLowerCase().includes(q);
      if (!matchId && !matchTf && !matchStruct && !matchStatus && !matchWhy) return false;
    }

    // 1. Life Filter
    if (lifeFilter === 'ACTIVE' && !narrative.isAlive) return false;
    if (lifeFilter === 'FINISHED' && narrative.isAlive) return false;
    if (lifeFilter === 'NO_TRADE' && (narrative.hasPaperTrade || ['COMPLETED_TP', 'COMPLETED_SL'].includes(status))) return false;
    if (lifeFilter === 'WITH_PAPER' && !narrative.hasPaperTrade) return false;
    if (lifeFilter === 'CLOSED' && !['COMPLETED', 'COMPLETED_TP', 'COMPLETED_SL'].includes(status)) return false;

    // 2. Type Filter
    if (typeFilter === 'NEUTRAL' && !isNeutral) return false;
    if (typeFilter === 'LONG' && sc.direction !== 'LONG') return false;
    if (typeFilter === 'SHORT' && sc.direction !== 'SHORT') return false;
    if (typeFilter === 'SIGNALS' && !['ENTRY_VALIDATED', 'ALERT_SENT'].includes(status)) return false;
    if (typeFilter === 'PAPER' && !['TRACKING', 'ENTRY_TRIGGERED', 'COMPLETED_TP', 'COMPLETED_SL'].includes(status)) return false;

    // 3. Result Filter
    if (resultFilter === 'NO_ENTRY' && narrative.hasPaperTrade) return false;
    if (resultFilter === 'OPEN_ENTRY' && !['TRACKING', 'ENTRY_TRIGGERED'].includes(status)) return false;
    if (resultFilter === 'CLOSED_TP' && status !== 'COMPLETED_TP' && !(status === 'COMPLETED' && !isNeutral)) return false;
    if (resultFilter === 'CLOSED_SL' && status !== 'COMPLETED_SL') return false;
    if (resultFilter === 'REJECTED' && !['CANCELLED', 'NO_TRADE_OBSERVATION'].includes(status)) return false;
    if (resultFilter === 'EXPIRED' && status !== 'EXPIRED') return false;
    if (resultFilter === 'INVALIDATED' && status !== 'INVALIDATED') return false;
    if (resultFilter === 'CANCELLED' && status !== 'CANCELLED') return false;

    // 4. Period Filter
    const discTime = sc.discoveryTimestamp || 0;
    if (periodFilter === '24H' && now - discTime > 24 * 3600 * 1000) return false;
    if (periodFilter === '7D' && now - discTime > 7 * 24 * 3600 * 1000) return false;
    if (periodFilter === '30D' && now - discTime > 30 * 24 * 3600 * 1000) return false;
    if (periodFilter === 'TODAY') {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (discTime < today.getTime()) return false;
    }

    // 5. Version Filter
    if (versionFilter === 'POST_FIXES' && discTime < PR41_DEPLOY_TIMESTAMP) return false;
    if (versionFilter === 'PRE_FIXES' && discTime >= PR41_DEPLOY_TIMESTAMP) return false;

    return true;
  });

  const resetFilters = () => {
    setSearchQuery('');
    setLifeFilter('ALL');
    setTypeFilter('ALL');
    setResultFilter('ALL');
    setPeriodFilter('ALL');
    setVersionFilter('ALL');
  };

  const isFiltered =
    searchQuery ||
    lifeFilter !== 'ALL' ||
    typeFilter !== 'ALL' ||
    resultFilter !== 'ALL' ||
    periodFilter !== 'ALL' ||
    versionFilter !== 'ALL';

  return (
    <div className="space-y-4">
      {/* Filters Card */}
      <div className="p-4 sm:p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1422] shadow-sm space-y-3.5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-orange-500" />
            <h3 className="font-display font-bold text-sm text-slate-900 dark:text-white uppercase tracking-wider">
              Filtros Avanzados de Auditoría
            </h3>
            <span className="text-xs font-mono text-slate-500">
              ({filteredScenarios.length} de {scenarios.length} resultados)
            </span>
          </div>

          {isFiltered && (
            <button
              onClick={resetFilters}
              className="flex items-center gap-1.5 text-xs font-mono text-orange-600 dark:text-orange-400 hover:underline cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Limpiar filtros
            </button>
          )}
        </div>

        {/* Search Bar */}
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar por ID, estructura, estado o motivo de descarte..."
            className="w-full pl-9 pr-4 py-2 rounded-xl text-xs font-mono bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500"
          />
        </div>

        {/* Filter Rows */}
        <div className="space-y-2 text-xs font-mono">
          {/* Row 1: Estado de vida */}
          <div className="flex items-center flex-wrap gap-1.5">
            <span className="text-[11px] text-slate-400 font-semibold mr-1 w-24 shrink-0">Vida:</span>
            {[
              { id: 'ALL', label: 'Todos' },
              { id: 'ACTIVE', label: 'Vivos / En Proceso' },
              { id: 'FINISHED', label: 'Finalizados' },
              { id: 'NO_TRADE', label: 'Sin Trade' },
              { id: 'WITH_PAPER', label: 'Con Trade Paper' },
              { id: 'CLOSED', label: 'Cerrados' },
            ].map((f) => (
              <button
                key={f.id}
                onClick={() => setLifeFilter(f.id as any)}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all ${
                  lifeFilter === f.id
                    ? 'bg-orange-500 text-white shadow-sm'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Row 2: Tipo */}
          <div className="flex items-center flex-wrap gap-1.5">
            <span className="text-[11px] text-slate-400 font-semibold mr-1 w-24 shrink-0">Tipo:</span>
            {[
              { id: 'ALL', label: 'Todos' },
              { id: 'NEUTRAL', label: 'Observaciones Neutrales' },
              { id: 'LONG', label: 'Hipótesis LONG' },
              { id: 'SHORT', label: 'Hipótesis SHORT' },
              { id: 'SIGNALS', label: 'Señales Aprobadas' },
              { id: 'PAPER', label: 'Trades Paper' },
            ].map((f) => (
              <button
                key={f.id}
                onClick={() => setTypeFilter(f.id as any)}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all ${
                  typeFilter === f.id
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Row 3: Período & Versión */}
          <div className="flex items-center flex-wrap gap-3 pt-1 border-t border-slate-100 dark:border-slate-800/80">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-slate-400 font-semibold mr-1">Período:</span>
              {[
                { id: 'ALL', label: 'Todo el historial' },
                { id: 'TODAY', label: 'Hoy' },
                { id: '24H', label: '24 Horas' },
                { id: '7D', label: '7 Días' },
                { id: '30D', label: '30 Días' },
              ].map((p) => (
                <button
                  key={p.id}
                  onClick={() => setPeriodFilter(p.id as any)}
                  className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all ${
                    periodFilter === p.id
                      ? 'bg-slate-700 text-white font-extrabold'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <div className="h-3 w-px bg-slate-200 dark:bg-slate-700" />

            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-slate-400 font-semibold mr-1">Versión / Fixes:</span>
              <button
                onClick={() => setVersionFilter('ALL')}
                className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                  versionFilter === 'ALL' ? 'bg-slate-700 text-white font-extrabold' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                }`}
              >
                Todos
              </button>
              <button
                onClick={() => setVersionFilter('POST_FIXES')}
                className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                  versionFilter === 'POST_FIXES' ? 'bg-emerald-600 text-white font-extrabold' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                }`}
                title="Escenarios tras despliegue de PR 4.1 (commit dd23db1)"
              >
                PR 4.1+ (Actual)
              </button>
              <button
                onClick={() => setVersionFilter('PRE_FIXES')}
                className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                  versionFilter === 'PRE_FIXES' ? 'bg-slate-600 text-white font-extrabold' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                }`}
              >
                Histórico Previo
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Redesigned 14-Column Audit Table */}
      {filteredScenarios.length === 0 ? (
        <div className="p-8 text-center rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1422] space-y-2">
          <Radar className="w-9 h-9 text-slate-400 dark:text-slate-600 mx-auto" />
          <h4 className="font-display font-bold text-slate-700 dark:text-slate-300 text-sm">
            No se encontraron escenarios con los filtros seleccionados
          </h4>
          <button
            onClick={resetFilters}
            className="text-xs font-mono font-bold text-orange-600 dark:text-orange-400 hover:underline mt-2 inline-block"
          >
            Restablecer todos los filtros
          </button>
        </div>
      ) : (
        <div className="overflow-x-auto custom-scrollbar rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1422] shadow-sm">
          <table className="w-full text-left font-mono text-xs min-w-[1350px]">
            <thead className="bg-slate-50 dark:bg-slate-900/60 text-slate-500 text-[11px] border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="py-3 px-3">1. ID</th>
                <th className="py-3 px-3">2. Creación</th>
                <th className="py-3 px-2">3. Tipo</th>
                <th className="py-3 px-2">4. Dir</th>
                <th className="py-3 px-3">5. Estado Operativo</th>
                <th className="py-3 px-3">6. Resultado Final</th>
                <th className="py-3 px-4 min-w-[200px]">7. Qué está esperando / Qué pasó</th>
                <th className="py-3 px-3 text-right">8. Zona</th>
                <th className="py-3 px-3 text-right">9. Stop</th>
                <th className="py-3 px-3 text-right">10. Objetivo</th>
                <th className="py-3 px-3">11. Distancia</th>
                <th className="py-3 px-3">12. Último Evento</th>
                <th className="py-3 px-3">13. Actualización</th>
                <th className="py-3 px-3 text-right">14. Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 text-slate-700 dark:text-slate-300">
              {filteredScenarios.map((sc) => {
                const narrative = getScenarioNarrative(sc);
                const isNeutral = narrative.isNeutral;
                const isLong = sc.direction === 'LONG';
                const dist = sc.distanceToZonePct !== undefined ? sc.distanceToZonePct : null;

                return (
                  <tr
                    key={sc.id}
                    className="hover:bg-slate-50 dark:hover:bg-slate-900/50 transition-colors"
                  >
                    {/* 1. ID */}
                    <td className="py-3 px-3">
                      <div className="font-bold text-slate-900 dark:text-white">{sc.id}</div>
                      <div className="text-[10px] text-slate-400">{sc.timeframe} · {sc.structureType || 'SMC'}</div>
                    </td>

                    {/* 2. Fecha/hora creación */}
                    <td className="py-3 px-3 text-[11px]">
                      <div className="text-slate-900 dark:text-slate-200 font-medium">
                        {formatArgentinaDateTime(sc.discoveryTimestamp)}
                      </div>
                      <div className="text-[10px] text-slate-400">
                        {formatTimeAgo(sc.discoveryTimestamp)}
                      </div>
                    </td>

                    {/* 3. Tipo */}
                    <td className="py-3 px-2">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        isNeutral
                          ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-700'
                          : 'bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-300 dark:border-blue-700'
                      }`}>
                        {isNeutral ? 'OBSERVACIÓN' : 'HIPÓTESIS'}
                      </span>
                    </td>

                    {/* 4. Dirección */}
                    <td className="py-3 px-2">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        isNeutral
                          ? 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                          : isLong
                          ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                          : 'bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300'
                      }`}>
                        {sc.direction}
                      </span>
                    </td>

                    {/* 5. Estado Operativo (Human) */}
                    <td className="py-3 px-3">
                      <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold inline-block leading-tight ${
                        narrative.statusColor === 'emerald'
                          ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700'
                          : narrative.statusColor === 'amber'
                          ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-700'
                          : narrative.statusColor === 'purple'
                          ? 'bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border border-purple-300 dark:border-purple-700'
                          : narrative.statusColor === 'rose'
                          ? 'bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-300 dark:border-rose-700'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700'
                      }`}>
                        {narrative.humaneStatus}
                      </span>
                    </td>

                    {/* 6. Resultado Final (Human) */}
                    <td className="py-3 px-3">
                      <span className={`font-semibold text-xs ${
                        narrative.humaneOutcome.includes('Take Profit')
                          ? 'text-emerald-600 dark:text-emerald-400 font-bold'
                          : narrative.humaneOutcome.includes('Stop Loss')
                          ? 'text-rose-600 dark:text-rose-400 font-bold'
                          : 'text-slate-500 dark:text-slate-400'
                      }`}>
                        {narrative.humaneOutcome}
                      </span>
                    </td>

                    {/* 7. Qué está esperando / qué pasó */}
                    <td className="py-3 px-4 font-sans text-xs leading-snug">
                      <div className="text-slate-800 dark:text-slate-200">
                        {narrative.isAlive ? narrative.queEstaEsperando : narrative.porQueTermino}
                      </div>
                    </td>

                    {/* 8. Zona */}
                    <td className="py-3 px-3 text-right font-bold text-slate-800 dark:text-slate-200">
                      ${sc.entryZoneMin?.toFixed(1)} - ${sc.entryZoneMax?.toFixed(1)}
                    </td>

                    {/* 9. Stop Loss */}
                    <td className="py-3 px-3 text-right">
                      {isNeutral ? (
                        <span className="text-slate-400 text-[10px]">N/A</span>
                      ) : (
                        <span className="text-rose-600 dark:text-rose-400 font-semibold">
                          ${sc.stopLossPrice?.toFixed(1) || '---'}
                        </span>
                      )}
                    </td>

                    {/* 10. Objetivo */}
                    <td className="py-3 px-3 text-right">
                      {isNeutral ? (
                        <span className="text-slate-400 text-[10px]">N/A</span>
                      ) : sc.target14Price ? (
                        <div>
                          <span className="text-emerald-600 dark:text-emerald-400 font-bold">
                            ${sc.target14Price.toFixed(1)}
                          </span>
                          <span className="text-[10px] text-emerald-500 ml-1">
                            ({sc.netRR14 ? `${sc.netRR14.toFixed(1)}R` : '4R'})
                          </span>
                        </div>
                      ) : (
                        <span className="text-slate-400">---</span>
                      )}
                    </td>

                    {/* 11. Distancia */}
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-1.5">
                        <div className="w-12 bg-slate-200 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden">
                          <div
                            className={`h-full ${dist !== null && dist <= 0.35 ? 'bg-amber-400' : 'bg-blue-400'}`}
                            style={{ width: `${Math.min(100, Math.max(5, 100 - (dist || 0) * 20))}%` }}
                          />
                        </div>
                        <span className="text-[10px] text-slate-600 dark:text-slate-300">
                          {dist !== null ? `${dist.toFixed(2)}%` : '---'}
                        </span>
                      </div>
                    </td>

                    {/* 12. Último evento */}
                    <td className="py-3 px-3 text-[11px] text-slate-500 dark:text-slate-400">
                      <div>{sc.watchPlan?.horizon || 'INTRADAY'}</div>
                      <div className="text-[10px]">{sc.triggerSource || 'SCHEDULER'}</div>
                    </td>

                    {/* 13. Última actualización */}
                    <td className="py-3 px-3 text-[11px] text-slate-500 dark:text-slate-400">
                      <div>{formatArgentinaDateTime(sc.lastCheckedTimestamp || sc.discoveryTimestamp)}</div>
                      <div className="text-[10px]">{formatTimeAgo(sc.lastCheckedTimestamp || sc.discoveryTimestamp)}</div>
                    </td>

                    {/* 14. Acción */}
                    <td className="py-3 px-3 text-right">
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
