'use client';

import React from 'react';
import { Brain, Cpu, ShieldCheck, AlertCircle } from 'lucide-react';

export function AiAnalystsCard() {
  return (
    <div className="rounded-2xl border border-slate-800 bg-[#0f1422] p-4 shadow-xl">
      <div className="flex items-center justify-between pb-3 border-b border-slate-800/80 mb-3">
        <div className="flex items-center gap-2">
          <Brain className="w-4 h-4 text-[var(--color-brand,#FF6600)]" />
          <h3 className="font-display font-bold text-sm text-slate-200 uppercase tracking-wider">
            Analistas IA Independientes (Fase 3 Preparada)
          </h3>
        </div>
        <span className="text-[10px] font-mono bg-slate-800 text-slate-300 px-2 py-0.5 rounded-md font-semibold">
          Doble Consenso Requerido
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* OpenAI Card */}
        <div className="p-3.5 rounded-xl border border-slate-800 bg-slate-900/60">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
                <Brain className="w-3.5 h-3.5 text-emerald-400" />
              </div>
              <div>
                <h4 className="font-display font-bold text-xs text-white">OpenAI</h4>
                <p className="text-[10px] text-slate-400 font-mono">Analista Principal (gpt-4o)</p>
              </div>
            </div>
            <span className="text-[10px] font-mono bg-emerald-500/10 text-emerald-400 font-bold px-2 py-0.5 rounded">
              LISTO (STANDBY)
            </span>
          </div>

          <p className="text-xs text-slate-400 leading-relaxed mb-3">
            Evaluará estructura multitemporal, evidencias a favor/en contra, invalidaciones y relación riesgo/beneficio cuando el motor cuantitativo local detecte un setup calificado.
          </p>

          <div className="flex items-center justify-between pt-2 border-t border-slate-800 text-[10px] font-mono text-slate-500">
            <span>Llamadas hoy: 0</span>
            <span>Costo estimado: $0.00</span>
          </div>
        </div>

        {/* Gemini Card */}
        <div className="p-3.5 rounded-xl border border-slate-800 bg-slate-900/60">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-lg bg-blue-500/10 border border-blue-500/30 flex items-center justify-center">
                <Cpu className="w-3.5 h-3.5 text-blue-400" />
              </div>
              <div>
                <h4 className="font-display font-bold text-xs text-white">Google Gemini</h4>
                <p className="text-[10px] text-slate-400 font-mono">Evaluador Crítico (gemini-2.5-flash)</p>
              </div>
            </div>
            <span className="text-[10px] font-mono bg-blue-500/10 text-blue-400 font-bold px-2 py-0.5 rounded">
              LISTO (STANDBY)
            </span>
          </div>

          <p className="text-xs text-slate-400 leading-relaxed mb-3">
            Evaluará el mismo snapshot independientemente. Identificará riesgos ignorados, trampas de liquidez, contradicciones y razones explícitas para NO operar.
          </p>

          <div className="flex items-center justify-between pt-2 border-t border-slate-800 text-[10px] font-mono text-slate-500">
            <span>Llamadas hoy: 0</span>
            <span>Costo estimado: $0.00</span>
          </div>
        </div>
      </div>

      <div className="mt-3 p-2.5 rounded-xl bg-amber-500/5 border border-amber-500/20 flex items-center gap-2 text-xs text-amber-300">
        <AlertCircle className="w-4 h-4 shrink-0 text-amber-400" />
        <span>
          <strong>Principio Operativo:</strong> Cero datos simulados. Las IAs solo se consultarán ante setups reales que cumplan confluencia técnica estricta y R:R $\ge$ 1:4.
        </span>
      </div>
    </div>
  );
}
