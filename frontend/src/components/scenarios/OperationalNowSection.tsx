'use client';

import React from 'react';
import {
  Activity,
  Radar,
  ArrowRight,
  TrendingUp,
  TrendingDown,
  Clock,
  Crosshair,
  ShieldCheck,
  AlertTriangle,
  Eye,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import {
  formatArgentinaDateTime,
  formatPrice,
  formatPercent,
  formatTimeAgo,
} from '../../utils/formatters';
import { getScenarioNarrative } from '../../utils/operational-taxonomy';

interface OperationalNowSectionProps {
  scenarios: any[];
  onSelectScenario: (scenarioId: string) => void;
  onTriggerDiscovery?: () => void;
  isDiscovering?: boolean;
}

export function OperationalNowSection({
  scenarios,
  onSelectScenario,
  onTriggerDiscovery,
  isDiscovering = false,
}: OperationalNowSectionProps) {
  // Filter only what is alive right now
  const liveScenarios = scenarios.filter((s) => {
    const status = s.status || '';
    return !['INVALIDATED', 'EXPIRED', 'CANCELLED', 'COMPLETED', 'COMPLETED_TP', 'COMPLETED_SL'].includes(status);
  });

  return (
    <div className="space-y-4">
      {/* Section Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1422] shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400 flex items-center justify-center font-bold">
            <Activity className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-display font-extrabold text-sm sm:text-base text-slate-900 dark:text-white uppercase tracking-wider">
                En Proceso Ahora
              </h3>
              <span className="px-2 py-0.5 rounded-full text-xs font-mono font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                {liveScenarios.length} vivos
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Únicamente hipótesis y observaciones activas que el algoritmo está vigilando en este momento.
            </p>
          </div>
        </div>

        {onTriggerDiscovery && (
          <button
            onClick={onTriggerDiscovery}
            disabled={isDiscovering}
            className="flex items-center justify-center gap-2 px-3.5 py-2 rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white font-bold text-xs shadow-md shadow-orange-500/20 transition-all cursor-pointer disabled:opacity-50 shrink-0"
          >
            <Sparkles className={`w-3.5 h-3.5 ${isDiscovering ? 'animate-spin' : ''}`} />
            {isDiscovering ? 'Analizando mercado...' : 'Ejecutar Descubrimiento IA'}
          </button>
        )}
      </div>

      {/* Live Scenarios Grid */}
      {liveScenarios.length === 0 ? (
        <div className="p-8 text-center rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40 space-y-3">
          <Radar className="w-10 h-10 text-slate-400 dark:text-slate-600 mx-auto" />
          <h4 className="font-display font-bold text-slate-700 dark:text-slate-200 text-sm">
            No hay escenarios en vigilancia activa en este instante
          </h4>
          <p className="text-xs font-mono text-slate-500 max-w-lg mx-auto leading-relaxed">
            El motor cuantitativo vigila BTCUSDT las 24 horas sin consumir tokens.
            Cuando el precio cierre velas relevantes o quiebre estructuras previas, se disparará una evaluación automática.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {liveScenarios.map((sc) => {
            const narrative = getScenarioNarrative(sc);
            const isNeutral = narrative.isNeutral;
            const isLong = sc.direction === 'LONG';
            const dist = sc.distanceToZonePct !== undefined ? sc.distanceToZonePct : null;

            return (
              <div
                key={sc.id}
                className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1422] shadow-sm flex flex-col justify-between hover:border-orange-500/50 transition-all space-y-3"
              >
                {/* Card Top: Direction, Type & Badge */}
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className={`px-2 py-0.5 rounded-lg text-xs font-mono font-bold flex items-center gap-1 ${
                        isNeutral
                          ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-700'
                          : isLong
                          ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700'
                          : 'bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-300 dark:border-rose-700'
                      }`}>
                        {isNeutral ? <Radar className="w-3.5 h-3.5" /> : isLong ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                        {sc.direction} · {sc.timeframe}
                      </span>
                      <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400">
                        {sc.id}
                      </span>
                    </div>
                    <div className="text-xs font-bold text-slate-800 dark:text-slate-100">
                      {narrative.humaneType}
                    </div>
                  </div>

                  <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400 border border-amber-300 dark:border-amber-700 animate-pulse">
                    EN VIVO
                  </span>
                </div>

                {/* What is it waiting for? */}
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 space-y-1">
                  <span className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider block">
                    ¿Qué está esperando?
                  </span>
                  <p className="text-xs text-slate-800 dark:text-slate-200 font-sans leading-snug">
                    {narrative.queEstaEsperando}
                  </p>
                </div>

                {/* Distance & Levels */}
                <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                  <div className="p-2 rounded-lg bg-slate-100 dark:bg-slate-900/80">
                    <span className="text-[10px] text-slate-500 uppercase block">Zona:</span>
                    <span className="font-bold text-slate-800 dark:text-slate-200 truncate block">
                      ${sc.entryZoneMin?.toFixed(1)} - ${sc.entryZoneMax?.toFixed(1)}
                    </span>
                  </div>

                  <div className="p-2 rounded-lg bg-slate-100 dark:bg-slate-900/80">
                    <span className="text-[10px] text-slate-500 uppercase block">Distancia:</span>
                    <span className={`font-bold ${dist !== null && dist <= 0.35 ? 'text-amber-500 font-extrabold' : 'text-slate-700 dark:text-slate-300'}`}>
                      {dist !== null ? `${dist.toFixed(2)}%` : '---'}
                    </span>
                  </div>
                </div>

                {/* Last Event & Vencimiento */}
                <div className="space-y-1 text-[11px] font-mono text-slate-500 dark:text-slate-400 pt-1 border-t border-slate-100 dark:border-slate-800">
                  <div className="flex justify-between">
                    <span>Descubierto:</span>
                    <span>{formatArgentinaDateTime(sc.discoveryTimestamp)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Vigencia:</span>
                    <span>
                      {sc.validUntilTimestamp ? formatTimeAgo(sc.validUntilTimestamp) : 'Indefinida'}
                    </span>
                  </div>
                </div>

                {/* Card Action */}
                <button
                  onClick={() => onSelectScenario(sc.id)}
                  className="w-full py-2 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 hover:text-slate-900 dark:text-slate-200 dark:hover:text-white font-bold text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                >
                  <Eye className="w-3.5 h-3.5 text-orange-500" />
                  <span>Ver Detalle Operativo</span>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
