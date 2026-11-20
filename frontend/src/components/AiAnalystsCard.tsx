'use client';

import React, { useState } from 'react';
import {
  Brain,
  Cpu,
  ShieldCheck,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Clock,
  Sparkles,
  ChevronDown,
  ChevronUp,
  DollarSign,
  Layers,
} from 'lucide-react';

interface AiAnalystsCardProps {
  aiStatus?: {
    providers?: {
      openai?: { configured: boolean; model: string; role: string };
      gemini?: { configured: boolean; model: string; role: string };
    };
    costTracker?: {
      dailySpendUsd: number;
      monthlySpendUsd: number;
      dailyBudgetUsd: number;
      dailyBudgetRemainingUsd: number;
      totalCalls: number;
      totalTokens: number;
      callsByProvider: { OPENAI: number; GEMINI: number };
    };
    consensusRule?: string;
    executionMode?: string;
  } | null;
  signals?: any[];
  aiReviews?: any[];
}

export function AiAnalystsCard({ aiStatus, signals = [], aiReviews = [] }: AiAnalystsCardProps) {
  const [selectedSignal, setSelectedSignal] = useState<any | null>(null);
  const [activeTab, setActiveTab] = useState<'status' | 'signals' | 'reviews'>('status');

  const openaiConfig = aiStatus?.providers?.openai;
  const geminiConfig = aiStatus?.providers?.gemini;
  const costTracker = aiStatus?.costTracker;

  return (
    <div className="rounded-2xl border border-slate-800 bg-[#0f1422] p-4 shadow-xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between pb-3 border-b border-slate-800/80 mb-3 gap-2">
        <div className="flex items-center gap-2">
          <Brain className="w-4 h-4 text-[var(--color-brand,#FF6600)]" />
          <h3 className="font-display font-bold text-sm text-slate-200 uppercase tracking-wider">
            Doble Inteligencia Artificial & Motor de Consenso (Fase 3 Activa)
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono bg-purple-500/10 text-purple-300 border border-purple-500/30 px-2 py-0.5 rounded font-bold">
            Modo: {aiStatus?.executionMode || 'SIGNALS_ONLY'}
          </span>
          <span className="text-[10px] font-mono bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded font-semibold">
            Doble Consenso Requerido
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 mb-3">
        <button
          onClick={() => setActiveTab('status')}
          className={`px-3 py-1 text-xs font-mono rounded-lg transition-colors ${
            activeTab === 'status'
              ? 'bg-[var(--color-brand,#FF6600)] text-white font-bold'
              : 'bg-slate-800/60 text-slate-400 hover:text-slate-200'
          }`}
        >
          Modelos & Presupuesto
        </button>
        <button
          onClick={() => setActiveTab('signals')}
          className={`px-3 py-1 text-xs font-mono rounded-lg transition-colors flex items-center gap-1.5 ${
            activeTab === 'signals'
              ? 'bg-[var(--color-brand,#FF6600)] text-white font-bold'
              : 'bg-slate-800/60 text-slate-400 hover:text-slate-200'
          }`}
        >
          Señales Evaluadas ({signals.length})
        </button>
        <button
          onClick={() => setActiveTab('reviews')}
          className={`px-3 py-1 text-xs font-mono rounded-lg transition-colors ${
            activeTab === 'reviews'
              ? 'bg-[var(--color-brand,#FF6600)] text-white font-bold'
              : 'bg-slate-800/60 text-slate-400 hover:text-slate-200'
          }`}
        >
          Auditorías Históricas ({aiReviews.length})
        </button>
      </div>

      {activeTab === 'status' && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* OpenAI Card */}
            <div className="p-3.5 rounded-xl border border-slate-800 bg-slate-900/60 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
                      <Brain className="w-3.5 h-3.5 text-emerald-400" />
                    </div>
                    <div>
                      <h4 className="font-display font-bold text-xs text-white">OpenAI</h4>
                      <p className="text-[10px] text-slate-400 font-mono">
                        {openaiConfig?.model || 'gpt-4o'} (Analista Técnico Cuantitativo)
                      </p>
                    </div>
                  </div>
                  <span
                    className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold ${
                      openaiConfig?.configured
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                        : 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                    }`}
                  >
                    {openaiConfig?.configured ? 'ACTIVO' : 'SIN API KEY (STANDBY)'}
                  </span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed mb-3">
                  Evalúa la confluencia de estructura multitemporal, zonas Premium/Discount, retrocesos a FVG/OB y verosimilitud del ratio R:R $\ge$ 1:4.
                </p>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-slate-800 text-[10px] font-mono text-slate-500">
                <span>Llamadas: {costTracker?.callsByProvider?.OPENAI || 0}</span>
                <span>Rol: Analista Estructural</span>
              </div>
            </div>

            {/* Gemini Card */}
            <div className="p-3.5 rounded-xl border border-slate-800 bg-slate-900/60 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-lg bg-blue-500/10 border border-blue-500/30 flex items-center justify-center">
                      <Cpu className="w-3.5 h-3.5 text-blue-400" />
                    </div>
                    <div>
                      <h4 className="font-display font-bold text-xs text-white">Google Gemini</h4>
                      <p className="text-[10px] text-slate-400 font-mono">
                        {geminiConfig?.model || 'gemini-2.5-flash'} (Auditor Crítico de Riesgos)
                      </p>
                    </div>
                  </div>
                  <span
                    className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold ${
                      geminiConfig?.configured
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                        : 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                    }`}
                  >
                    {geminiConfig?.configured ? 'ACTIVO' : 'SIN API KEY (STANDBY)'}
                  </span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed mb-3">
                  Actúa como abogado del diablo independiente. Busca contradicciones, trampas de liquidez, absorción adversa en el libro de órdenes y razones para descartar el setup.
                </p>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-slate-800 text-[10px] font-mono text-slate-500">
                <span>Llamadas: {costTracker?.callsByProvider?.GEMINI || 0}</span>
                <span>Rol: Auditor de Riesgos</span>
              </div>
            </div>
          </div>

          {/* Cost Tracker Bar */}
          <div className="p-3 rounded-xl bg-slate-900/40 border border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
            <div className="flex items-center gap-2 text-slate-300">
              <DollarSign className="w-4 h-4 text-emerald-400" />
              <span>Gasto Diario:</span>
              <strong className="text-white">${costTracker?.dailySpendUsd?.toFixed(4) || '0.0000'}</strong>
              <span className="text-slate-500">/ ${costTracker?.dailyBudgetUsd?.toFixed(2) || '5.00'} límite</span>
            </div>

            <div className="flex items-center gap-3 text-slate-400 text-[11px]">
              <span>Tokens totales: <strong className="text-slate-200">{costTracker?.totalTokens || 0}</strong></span>
              <span>Consultas totales: <strong className="text-slate-200">{costTracker?.totalCalls || 0}</strong></span>
              <span>Disponible hoy: <strong className="text-emerald-400">${costTracker?.dailyBudgetRemainingUsd?.toFixed(4) || '5.0000'}</strong></span>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'signals' && (
        <div className="space-y-3">
          {signals.length === 0 ? (
            <div className="p-6 text-center text-xs font-mono text-slate-500 rounded-xl border border-slate-800/80 bg-slate-900/30">
              No hay señales de consenso registradas aún. El motor cuantitativo evaluará automáticamente ante cada setup confirmado.
            </div>
          ) : (
            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full text-left font-mono text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-500 text-[11px]">
                    <th className="pb-2">Fecha (UTC)</th>
                    <th className="pb-2">Setup / Estrategia</th>
                    <th className="pb-2">Dirección</th>
                    <th className="pb-2">Entrada</th>
                    <th className="pb-2">R:R Neto</th>
                    <th className="pb-2">OpenAI</th>
                    <th className="pb-2">Gemini</th>
                    <th className="pb-2">Consenso</th>
                    <th className="pb-2">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/50">
                  {signals.map((sig) => (
                    <tr key={sig.id} className="hover:bg-slate-900/40">
                      <td className="py-2.5 text-slate-400">
                        {new Date(sig.timestamp).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="py-2.5 text-slate-200 font-bold">{sig.strategy}</td>
                      <td className="py-2.5">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            sig.direction === 'LONG'
                              ? 'bg-emerald-500/15 text-emerald-400'
                              : 'bg-rose-500/15 text-rose-400'
                          }`}
                        >
                          {sig.direction}
                        </span>
                      </td>
                      <td className="py-2.5 text-white font-semibold">${sig.entryPrice?.toFixed(1)}</td>
                      <td className="py-2.5 text-amber-400 font-bold">1:{sig.rrNet?.toFixed(1) || '4.0'}</td>
                      <td className="py-2.5">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                            sig.openaiVerdict === 'APPROVE'
                              ? 'bg-emerald-500/15 text-emerald-400'
                              : sig.openaiVerdict === 'REJECT'
                              ? 'bg-rose-500/15 text-rose-400'
                              : 'bg-amber-500/15 text-amber-400'
                          }`}
                        >
                          {sig.openaiVerdict || 'STANDBY'}
                        </span>
                      </td>
                      <td className="py-2.5">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                            sig.geminiVerdict === 'APPROVE'
                              ? 'bg-emerald-500/15 text-emerald-400'
                              : sig.geminiVerdict === 'REJECT'
                              ? 'bg-rose-500/15 text-rose-400'
                              : 'bg-amber-500/15 text-amber-400'
                          }`}
                        >
                          {sig.geminiVerdict || 'STANDBY'}
                        </span>
                      </td>
                      <td className="py-2.5">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            sig.consensusVerdict === 'AUTHORIZED'
                              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                              : sig.consensusVerdict === 'WAITING_CONDITIONS'
                              ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                              : 'bg-rose-500/20 text-rose-400 border border-rose-500/40'
                          }`}
                        >
                          {sig.consensusVerdict}
                        </span>
                      </td>
                      <td className="py-2.5">
                        <button
                          onClick={() => setSelectedSignal(selectedSignal?.id === sig.id ? null : sig)}
                          className="px-2 py-1 rounded bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 text-[11px]"
                        >
                          {selectedSignal?.id === sig.id ? 'Ocultar' : 'Detalles'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Selected Signal Detail Modal / Card */}
          {selectedSignal && (
            <div className="p-4 rounded-xl border border-slate-700 bg-slate-900/90 space-y-3 mt-3 animate-fadeIn">
              <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                <h4 className="font-display font-bold text-sm text-white">
                  Auditoría Detallada de Consenso: {selectedSignal.id}
                </h4>
                <span className="text-xs font-mono text-slate-400">
                  {selectedSignal.rejectionReason ? `Motivo: ${selectedSignal.rejectionReason}` : 'Autorizada sin restricciones'}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs font-mono">
                <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800">
                  <h5 className="font-bold text-emerald-400 mb-1">OpenAI ({selectedSignal.openaiVerdict})</h5>
                  <p className="text-slate-300 text-[11px] leading-relaxed">
                    {selectedSignal.openaiReview?.reasoning || 'Evaluación cuantitativa registrada.'}
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800">
                  <h5 className="font-bold text-blue-400 mb-1">Gemini ({selectedSignal.geminiVerdict})</h5>
                  <p className="text-slate-300 text-[11px] leading-relaxed">
                    {selectedSignal.geminiReview?.reasoning || 'Auditoría crítica de invalidaciones registrada.'}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'reviews' && (
        <div className="space-y-3">
          {aiReviews.length === 0 ? (
            <div className="p-6 text-center text-xs font-mono text-slate-500 rounded-xl border border-slate-800/80 bg-slate-900/30">
              No hay revisiones almacenadas aún.
            </div>
          ) : (
            <div className="space-y-2">
              {aiReviews.slice(0, 6).map((rev) => (
                <div key={rev.id} className="p-3 rounded-xl border border-slate-800 bg-slate-900/50 flex flex-col gap-1.5 text-xs font-mono">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-white flex items-center gap-1.5">
                      {rev.provider === 'OPENAI' ? <Brain className="w-3.5 h-3.5 text-emerald-400" /> : <Cpu className="w-3.5 h-3.5 text-blue-400" />}
                      {rev.provider} ({rev.model})
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        rev.verdict === 'APPROVE'
                          ? 'bg-emerald-500/15 text-emerald-400'
                          : rev.verdict === 'REJECT'
                          ? 'bg-rose-500/15 text-rose-400'
                          : 'bg-amber-500/15 text-amber-400'
                      }`}
                    >
                      {rev.verdict} ({rev.confidence}%)
                    </span>
                  </div>
                  <p className="text-slate-300 text-[11px] leading-relaxed">{rev.reasoning}</p>
                  <div className="flex items-center justify-between text-[10px] text-slate-500 pt-1 border-t border-slate-800/60">
                    <span>Latencia: {rev.latencyMs}ms | Tokens: {rev.tokensUsed}</span>
                    <span>Costo: ${rev.costUsd?.toFixed(5) || '0.00000'} USD</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Operational Footer Warning */}
      <div className="mt-3 p-2.5 rounded-xl bg-amber-500/5 border border-amber-500/20 flex items-center gap-2 text-xs text-amber-300">
        <AlertCircle className="w-4 h-4 shrink-0 text-amber-400" />
        <span>
          <strong>Garantía Determinista:</strong> Modo de operación exclusivamente <code className="bg-amber-500/20 px-1 py-0.5 rounded font-mono text-[11px]">SIGNALS_ONLY</code>. La ejecución real de órdenes con dinero está inhabilitada. Ninguna IA tiene acceso a claves de trading.
        </span>
      </div>
    </div>
  );
}
