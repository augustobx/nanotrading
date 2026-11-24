'use client';

import React from 'react';
import {
  Layers,
  ArrowRight,
  TrendingUp,
  Brain,
  Crosshair,
  ShieldCheck,
  Zap,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  Filter,
} from 'lucide-react';
import { calculateFunnelMetrics } from '../../utils/operational-taxonomy';

interface ScenarioFunnelViewProps {
  scenarios: any[];
  signals: any[];
  totalAutonomousRuns?: number;
}

export function ScenarioFunnelView({
  scenarios,
  signals,
  totalAutonomousRuns = 0,
}: ScenarioFunnelViewProps) {
  const metrics = calculateFunnelMetrics(scenarios, signals);

  const stages = [
    {
      id: 'analisis',
      title: '1. Análisis Ejecutados',
      count: Math.max(totalAutonomousRuns, scenarios.length > 0 ? 1 : 0),
      label: 'Ciclos de Descubrimiento',
      desc: 'Escaneos multitemporales de BTCUSDT 24/7',
      color: 'border-blue-500/40 bg-blue-950/20 text-blue-400',
      badge: 'MOTOR ACTIVO',
    },
    {
      id: 'escenarios',
      title: '2. Escenarios Creados',
      count: metrics.totalScenarios,
      label: 'Hipótesis Detectadas',
      desc: `${metrics.neutralObservations} rangos neutrales + ${metrics.directionalScenarios} direccionales`,
      color: 'border-indigo-500/40 bg-indigo-950/20 text-indigo-400',
      badge: `${metrics.totalScenarios} REGISTRADOS`,
    },
    {
      id: 'direccionales',
      title: '3. Hipótesis Direccionales',
      count: metrics.directionalScenarios,
      label: 'Con Ventaja Causal',
      desc: 'Setups LONG/SHORT con Stop y TP estructural',
      color: 'border-cyan-500/40 bg-cyan-950/20 text-cyan-400',
      badge: `${metrics.totalScenarios > 0 ? ((metrics.directionalScenarios / metrics.totalScenarios) * 100).toFixed(0) : 0}% DEL TOTAL`,
    },
    {
      id: 'zonas',
      title: '4. Zonas Alcanzadas',
      count: metrics.zonesReached,
      label: 'Mitigación en Mercado',
      desc: 'Precio tocó o entró en la zona de entrada',
      color: 'border-amber-500/40 bg-amber-950/20 text-amber-400',
      badge: `${metrics.directionalScenarios > 0 ? ((metrics.zonesReached / metrics.directionalScenarios) * 100).toFixed(0) : 0}% ALCANZARON`,
    },
    {
      id: 'revalidaciones',
      title: '5. Revalidaciones IA',
      count: metrics.revalidationsTriggered,
      label: 'Consultas Snapshot',
      desc: 'Evaluación dual con OpenAI y Gemini en zona',
      color: 'border-purple-500/40 bg-purple-950/20 text-purple-400',
      badge: 'SNAP & RISK',
    },
    {
      id: 'senales',
      title: '6. Señales Aprobadas',
      count: metrics.signalsApproved,
      label: 'Consenso Favorable',
      desc: 'Doble APPROVE y R:R neto estricto ≥ 1:4',
      color: 'border-emerald-500/40 bg-emerald-950/20 text-emerald-400',
      badge: `${metrics.revalidationsTriggered > 0 ? ((metrics.signalsApproved / metrics.revalidationsTriggered) * 100).toFixed(0) : 0}% APROBADAS`,
    },
    {
      id: 'entradas',
      title: '7. Entradas Paper',
      count: metrics.paperEntriesExecuted,
      label: 'Posiciones Virtuales',
      desc: 'Tick de mercado ejecutó entrada ($100 virtual)',
      color: 'border-teal-500/40 bg-teal-950/20 text-teal-400',
      badge: 'MODO SIGNALS',
    },
    {
      id: 'cierres',
      title: '8. Cierres TP / SL',
      count: metrics.paperClosedTp + metrics.paperClosedSl,
      label: 'Trades Completados',
      desc: `${metrics.paperClosedTp} TP (+) / ${metrics.paperClosedSl} SL (-)`,
      color: 'border-slate-500/40 bg-slate-900/60 text-slate-300',
      badge: `${metrics.paperClosedTp} TP / ${metrics.paperClosedSl} SL`,
    },
  ];

  return (
    <div className="space-y-4">
      {/* Funnel Header */}
      <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1422] shadow-sm space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-orange-500/15 text-orange-600 dark:text-orange-400 flex items-center justify-center font-bold">
              <Filter className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-display font-extrabold text-sm text-slate-900 dark:text-slate-100 uppercase tracking-wider">
                Embudo Operativo · Flujo de Decisión de Extremo a Extremo
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Visualización clara del embudo: dónde se originan los análisis y en qué etapa se detienen o avanzan.
              </p>
            </div>
          </div>
          <div className="text-xs font-mono text-slate-500 dark:text-slate-400 flex items-center gap-2">
            <span>Regla R:R: <strong>≥ 1:4 Neto</strong></span>
            <span>·</span>
            <span>Riesgo Real: <strong className="text-emerald-600 dark:text-emerald-400">0.00 USDT (Deshabilitado)</strong></span>
          </div>
        </div>

        {/* Funnel Pipeline Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8 gap-2.5 pt-2">
          {stages.map((stage, idx) => (
            <div
              key={stage.id}
              className={`p-3 rounded-xl border ${stage.color} flex flex-col justify-between relative group hover:scale-[1.02] transition-all`}
            >
              <div>
                <div className="flex items-center justify-between text-[10px] font-mono font-bold mb-1">
                  <span>{stage.title}</span>
                  {idx < stages.length - 1 && (
                    <ArrowRight className="w-3 h-3 text-slate-400 dark:text-slate-600 hidden xl:block absolute -right-2 top-1/2 -translate-y-1/2 z-10" />
                  )}
                </div>
                <div className="text-2xl font-mono font-extrabold text-slate-900 dark:text-white my-1">
                  {stage.count}
                </div>
                <div className="text-[11px] font-semibold text-slate-700 dark:text-slate-200 truncate">
                  {stage.label}
                </div>
                <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">
                  {stage.desc}
                </p>
              </div>
              <div className="mt-2 pt-2 border-t border-slate-200 dark:border-slate-800/80 flex items-center justify-between text-[9px] font-mono">
                <span className="font-bold">{stage.badge}</span>
                <span className="text-slate-400">Etapa {idx + 1}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Diagnostic Insight Banner */}
        <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 text-xs text-slate-700 dark:text-slate-300 space-y-1.5 font-mono">
          <div className="flex items-center gap-2 font-bold text-slate-900 dark:text-white">
            <HelpCircle className="w-4 h-4 text-orange-500" />
            <span>Diagnóstico Operativo: ¿Por qué no hay trades forzados?</span>
          </div>
          <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed font-sans">
            De los <strong>{metrics.totalScenarios} escenarios registrados</strong>:
            {' '}<strong>{metrics.neutralObservations}</strong> fueron observaciones de rango neutral (el mercado consolidó sin tendencia clara).
            {' '}De las <strong>{metrics.directionalScenarios} hipótesis direccionales</strong>, ninguna avanzó a señal autorizada porque no alcanzaron confluencia de vela cerrada o no cumplieron el ratio estricto <strong>R:R ≥ 1:4 neto</strong>.
            {' '}El sistema protegió el capital sin realizar llamadas inútiles de IA. <strong>"No operar es una decisión válida y a menudo la mejor."</strong>
          </p>
        </div>
      </div>
    </div>
  );
}
