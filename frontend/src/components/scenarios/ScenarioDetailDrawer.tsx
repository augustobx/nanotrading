'use client';

import React from 'react';
import {
  Eye,
  X,
  Clock,
  Crosshair,
  TrendingUp,
  TrendingDown,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Sparkles,
  DollarSign,
  ArrowRight,
  Layers,
  Activity,
  Radar,
  HelpCircle,
  RefreshCw,
} from 'lucide-react';
import {
  formatArgentinaDateTime,
  formatPrice,
  formatPercent,
  formatUsd,
  formatTimeAgo,
} from '../../utils/formatters';
import { getScenarioNarrative } from '../../utils/operational-taxonomy';

interface ScenarioDetailDrawerProps {
  scenarioDetail: {
    scenario: any;
    lifecycle: any[];
    revalidations: any[];
  } | null;
  onClose: () => void;
  onManualRevalidate?: (scenarioId: string) => void;
  onShowOnChart?: (scenarioId: string) => void;
  isRevalidating?: boolean;
}

export function ScenarioDetailDrawer({
  scenarioDetail,
  onClose,
  onManualRevalidate,
  onShowOnChart,
  isRevalidating = false,
}: ScenarioDetailDrawerProps) {
  if (!scenarioDetail) return null;

  const { scenario, lifecycle, revalidations } = scenarioDetail;
  const narrative = getScenarioNarrative(scenario);
  const isNeutral = narrative.isNeutral;
  const isLong = scenario.direction === 'LONG';

  // Construct chronological timeline events
  const timelineEvents: Array<{
    timestamp: number;
    title: string;
    description: string;
    type: 'DISCOVERY' | 'MONITOR' | 'ZONE' | 'AI' | 'SIGNAL' | 'PAPER' | 'CLOSE' | 'DISCARD';
  }> = [];

  // 1. Discovery
  timelineEvents.push({
    timestamp: scenario.discoveryTimestamp,
    title: 'Análisis Multitemporal Creado',
    description: isNeutral
      ? 'Detección de rango de consolidación sin sesgo direccional. Activación de vigilancia de límites.'
      : `Hipótesis ${scenario.direction} detectada en timeframe ${scenario.timeframe} basada en ${scenario.structureType}.`,
    type: 'DISCOVERY',
  });

  // 2. Watcher Activated
  timelineEvents.push({
    timestamp: scenario.discoveryTimestamp + 500,
    title: 'Algorithmic Watcher Activado (24/7)',
    description: isNeutral
      ? `Vigilando techo $${scenario.entryZoneMax.toFixed(1)} y piso $${scenario.entryZoneMin.toFixed(1)} sin consumo de tokens.`
      : `Vigilando aproximación a zona [$${scenario.entryZoneMin.toFixed(1)} - $${scenario.entryZoneMax.toFixed(1)}].`,
    type: 'MONITOR',
  });

  // 3. Lifecycle transitions from DB
  if (lifecycle && Array.isArray(lifecycle)) {
    lifecycle.forEach((ev: any) => {
      let title = `Transición a ${ev.toStatus}`;
      let desc = ev.reason || 'Actualización registrada por el motor de estados.';
      let type: any = 'MONITOR';

      if (ev.toStatus === 'APPROACHING_ZONE') {
        title = 'Precio Próximo a Zona (≤ 0.35%)';
        desc = 'Alerta temprana emitida. El precio se acercó al umbral operativo.';
        type = 'ZONE';
      } else if (ev.toStatus === 'IN_ZONE' || ev.toStatus === 'REVALIDATION_REQUESTED') {
        title = 'Precio Entró en Zona Operativa';
        desc = 'Mitigación de zona detectada. Disparo automático de snapshot y reevaluación IA.';
        type = 'ZONE';
      } else if (ev.toStatus === 'AI_REVALIDATING') {
        title = 'Revalidación Dual IA en Ejecución';
        desc = 'Consultando a OpenAI y Gemini con el snapshot del libro de órdenes y velas.';
        type = 'AI';
      } else if (ev.toStatus === 'ENTRY_VALIDATED' || ev.toStatus === 'ALERT_SENT') {
        title = 'Señal Aprobada por IA';
        desc = 'Consenso dual afirmativo y R:R neto ≥ 1:4 verificado. Señal autorizada pendiente de tick.';
        type = 'SIGNAL';
      } else if (ev.toStatus === 'TRACKING' || ev.toStatus === 'ENTRY_TRIGGERED') {
        title = 'Entrada Paper Ejecutada';
        desc = 'El precio de mercado ejecutó la entrada simulada. Riesgo virtual de $100 activo en seguimiento.';
        type = 'PAPER';
      } else if (ev.toStatus === 'COMPLETED_TP') {
        title = 'Take Profit Alcanzado';
        desc = 'La posición paper tocó el objetivo con ganancia realizada neta.';
        type = 'CLOSE';
      } else if (ev.toStatus === 'COMPLETED_SL') {
        title = 'Stop Loss Ejecutado';
        desc = 'La posición paper tocó el nivel de protección con pérdida acotada (-1R).';
        type = 'CLOSE';
      } else if (ev.toStatus === 'COMPLETED' && isNeutral) {
        title = 'Ruptura de Rango Observada';
        desc = 'El precio rompió el rango con vela cerrada. Concluyó la observación sin riesgo ni trade forzado.';
        type = 'CLOSE';
      } else if (['INVALIDATED', 'EXPIRED', 'CANCELLED'].includes(ev.toStatus)) {
        title = `Descartada: ${ev.toStatus}`;
        desc = ev.reason || 'Escenario archivado antes de entrada. 0 capital arriesgado.';
        type = 'DISCARD';
      }

      timelineEvents.push({
        timestamp: ev.timestamp,
        title,
        description: desc,
        type,
      });
    });
  }

  // 4. Sort timeline chronologically
  timelineEvents.sort((a, b) => a.timestamp - b.timestamp);

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex justify-end animate-fadeIn">
      <div className="w-full max-w-3xl bg-white dark:bg-[#0c101b] border-l border-slate-200 dark:border-slate-800 shadow-2xl h-full flex flex-col overflow-hidden">
        {/* Drawer Header */}
        <div className="p-4 sm:p-5 border-b border-slate-200 dark:border-slate-800/80 flex items-center justify-between gap-3 bg-slate-50 dark:bg-slate-900/60 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-orange-500/15 text-orange-600 dark:text-orange-400 flex items-center justify-center font-bold">
              <Eye className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-extrabold text-orange-600 dark:text-orange-400">
                  {scenario.id}
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                  {scenario.timeframe}
                </span>
                {narrative.isPostFix && (
                  <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                    PR 4.1+ ACTUAL
                  </span>
                )}
              </div>
              <h2 className="text-base font-display font-bold text-slate-900 dark:text-white mt-0.5">
                {narrative.humaneType} · {scenario.symbol || 'BTCUSDT'}
              </h2>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            {onShowOnChart && (
              <button
                type="button"
                onClick={() => onShowOnChart(scenario.id)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 font-bold text-xs transition-colors"
              >
                <Crosshair className="w-3.5 h-3.5" />
                Ver niveles en gráfico
              </button>
            )}
            {!isNeutral && narrative.isAlive && onManualRevalidate && (
              <button
                onClick={() => onManualRevalidate(scenario.id)}
                disabled={isRevalidating}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs shadow-sm transition-all cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isRevalidating ? 'animate-spin' : ''}`} />
                {isRevalidating ? 'Reevaluando...' : 'Reevaluar Ahora'}
              </button>
            )}
            <button
              onClick={onClose}
              className="p-2 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              title="Cerrar detalle"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Drawer Scrollable Content */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-4 sm:p-6 space-y-6 text-slate-700 dark:text-slate-300">
          {/* 1. Visual Progress Stepper */}
          <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40 space-y-3">
            <span className="text-xs font-mono font-bold text-slate-500 uppercase tracking-wider block">
              Secuencia Operativa del Escenario:
            </span>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
              {narrative.steps.map((st, i) => {
                const isCurr = st.status === 'CURRENT';
                const isComp = st.status === 'COMPLETED';
                const isDisc = st.status === 'DISCARDED';
                const isSkip = st.status === 'SKIPPED';

                return (
                  <div
                    key={st.id}
                    className={`p-2.5 rounded-xl border text-center transition-all ${
                      isCurr
                        ? 'border-amber-500 bg-amber-500/10 dark:bg-amber-500/20 shadow-md shadow-amber-500/10'
                        : isComp
                        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                        : isDisc
                        ? 'border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-400'
                        : isSkip
                        ? 'border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900/40 opacity-50'
                        : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/20 text-slate-400'
                    }`}
                  >
                    <div className="text-[10px] font-mono font-bold">
                      {isCurr && <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse mr-1" />}
                      {isComp && <CheckCircle2 className="w-3 h-3 text-emerald-500 inline mr-1" />}
                      {isDisc && <XCircle className="w-3 h-3 text-rose-500 inline mr-1" />}
                      {st.label}
                    </div>
                    <div className="text-[9px] text-slate-500 dark:text-slate-400 mt-1 truncate">
                      {isDisc ? 'Detenido aquí' : isSkip ? 'Omitido (Neutral)' : st.sublabel}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 2. Four Operational Clarity Questions */}
          <div className="p-4 sm:p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1422] shadow-sm space-y-4">
            <h3 className="font-display font-extrabold text-sm text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-2">
              <HelpCircle className="w-4 h-4 text-orange-500" />
              Lectura Operativa Humana
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 text-xs font-mono">
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 space-y-1">
                <span className="text-[11px] font-bold text-orange-600 dark:text-orange-400 uppercase">
                  1. ¿Qué está pasando ahora?
                </span>
                <p className="text-slate-700 dark:text-slate-300 text-xs font-sans leading-relaxed">
                  {narrative.queEstaPasando}
                </p>
              </div>

              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 space-y-1">
                <span className="text-[11px] font-bold text-sky-600 dark:text-sky-400 uppercase">
                  2. ¿Qué está esperando?
                </span>
                <p className="text-slate-700 dark:text-slate-300 text-xs font-sans leading-relaxed">
                  {narrative.queEstaEsperando}
                </p>
              </div>

              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 space-y-1">
                <span className="text-[11px] font-bold text-amber-600 dark:text-amber-400 uppercase">
                  3. ¿Qué falta para avanzar?
                </span>
                <p className="text-slate-700 dark:text-slate-300 text-xs font-sans leading-relaxed">
                  {narrative.queFaltaParaAvanzar}
                </p>
              </div>

              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 space-y-1">
                <span className="text-[11px] font-bold text-purple-600 dark:text-purple-400 uppercase">
                  4. ¿Por qué terminó o no avanzó?
                </span>
                <p className="text-slate-700 dark:text-slate-300 text-xs font-sans leading-relaxed">
                  {narrative.porQueTermino}
                </p>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800/40 text-xs flex items-center justify-between">
              <span className="font-bold text-emerald-800 dark:text-emerald-300">
                Resultado Operativo:
              </span>
              <span className="font-mono font-bold text-emerald-700 dark:text-emerald-400">
                {narrative.humaneOutcome}
              </span>
            </div>
          </div>

          {/* 3. Chronological Human & Technical Timeline */}
          <div className="p-4 sm:p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1422] shadow-sm space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-slate-800">
              <h3 className="font-display font-extrabold text-sm text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-2">
                <Clock className="w-4 h-4 text-sky-500" />
                Línea de Tiempo Cronológica ({timelineEvents.length} eventos)
              </h3>
              <span className="text-xs font-mono text-slate-500">Horario Argentina (ART)</span>
            </div>

            <div className="relative pl-6 space-y-4 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200 dark:before:bg-slate-800">
              {timelineEvents.map((ev, idx) => (
                <div key={idx} className="relative group">
                  <div className={`absolute -left-6 top-1 w-2.5 h-2.5 rounded-full border-2 bg-white dark:bg-slate-900 ${
                    ev.type === 'SIGNAL' || ev.type === 'PAPER'
                      ? 'border-emerald-500'
                      : ev.type === 'DISCARD'
                      ? 'border-rose-500'
                      : ev.type === 'ZONE' || ev.type === 'AI'
                      ? 'border-purple-500'
                      : 'border-orange-500'
                  }`} />
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 space-y-1">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span className="text-xs font-mono font-bold text-slate-900 dark:text-white">
                        {ev.title}
                      </span>
                      <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                        {formatArgentinaDateTime(ev.timestamp)} ({formatTimeAgo(ev.timestamp)})
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed font-sans">
                      {ev.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 4. Technical Levels & Risk Parameters */}
          <div className="p-4 sm:p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1422] shadow-sm space-y-3">
            <h3 className="font-display font-extrabold text-sm text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-2">
              <Crosshair className="w-4 h-4 text-emerald-500" />
              Niveles Técnicos & Métricas de Riesgo
            </h3>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 font-mono text-xs">
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800">
                <span className="text-[10px] text-slate-500 uppercase">Zona Operativa:</span>
                <p className="text-sm font-bold text-slate-900 dark:text-slate-100 mt-1">
                  ${scenario.entryZoneMin?.toFixed(1)} - ${scenario.entryZoneMax?.toFixed(1)}
                </p>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  Distancia: {scenario.distanceToZonePct !== undefined ? `${scenario.distanceToZonePct.toFixed(2)}%` : '---'}
                </p>
              </div>

              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800">
                <span className="text-[10px] text-slate-500 uppercase">Stop Loss:</span>
                <p className="text-sm font-bold text-rose-600 dark:text-rose-400 mt-1">
                  {isNeutral ? 'N/A (Observación)' : `$${scenario.stopLossPrice?.toFixed(1) || '---'}`}
                </p>
                <p className="text-[10px] text-slate-400 mt-0.5">Estructural sin forzar</p>
              </div>

              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800">
                <span className="text-[10px] text-slate-500 uppercase">Objetivo 1:4 (R:R):</span>
                <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400 mt-1">
                  {isNeutral ? 'N/A' : scenario.target14Price ? `$${scenario.target14Price.toFixed(1)}` : '---'}
                </p>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  Neto: {scenario.netRR14 ? `1:${scenario.netRR14.toFixed(1)}` : '---'}
                </p>
              </div>

              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800">
                <span className="text-[10px] text-slate-500 uppercase">Modelos & Costo IA:</span>
                <p className="text-sm font-bold text-slate-900 dark:text-slate-100 mt-1">
                  {scenario.modelsUsed?.join(', ') || 'OpenAI + Gemini'}
                </p>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  Costo: {formatUsd(scenario.aiCostUsd || 0)}
                </p>
              </div>
            </div>

            {/* AI Thesis */}
            {scenario.aiMarketThesis && (
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 text-xs italic text-slate-600 dark:text-slate-400">
                "{scenario.aiMarketThesis}"
              </div>
            )}
          </div>

          {/* 5. Dual AI Reasoning (OpenAI & Gemini) */}
          <div className="p-4 sm:p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1422] shadow-sm space-y-3">
            <h3 className="font-display font-extrabold text-sm text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-purple-500" />
              Consenso de Analistas IA (Snapshot Idéntico)
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              {/* OpenAI */}
              <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 space-y-2">
                <div className="flex items-center justify-between font-mono pb-1 border-b border-slate-200 dark:border-slate-800">
                  <span className="font-bold text-emerald-600 dark:text-emerald-400">
                    OpenAI ({scenario.openaiInterpretation?.model || 'gpt-4o'})
                  </span>
                  <span className="text-[10px] text-slate-500">
                    Sesgo: <strong>{scenario.openaiInterpretation?.bias || 'NEUTRAL'}</strong>
                  </span>
                </div>
                <p className="text-slate-700 dark:text-slate-300 leading-relaxed font-sans">
                  {scenario.openaiInterpretation?.reasoning || 'Evaluación registrada en snapshot.'}
                </p>
              </div>

              {/* Gemini */}
              <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 space-y-2">
                <div className="flex items-center justify-between font-mono pb-1 border-b border-slate-200 dark:border-slate-800">
                  <span className="font-bold text-blue-600 dark:text-blue-400">
                    Google Gemini ({scenario.geminiInterpretation?.model || 'gemini-2.5-flash'})
                  </span>
                  <span className="text-[10px] text-slate-500">
                    Sesgo: <strong>{scenario.geminiInterpretation?.bias || 'NEUTRAL'}</strong>
                  </span>
                </div>
                <p className="text-slate-700 dark:text-slate-300 leading-relaxed font-sans">
                  {scenario.geminiInterpretation?.reasoning || 'Evaluación registrada en snapshot.'}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
