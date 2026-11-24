'use client';
import { useEffect, useState } from 'react';

interface AuditData {
  policy: { short: number; extended: number; mode: string };
  funnel: {
    neutral: number; longs: number; shorts: number; legacyScenarios: number; neutralBreakouts: number;
    authorizedSignals: number; paperEntries: number; paperClosed: number;
    analyses: { outcome: string; count: number }[];
    candidates: { reason: string; count: number }[];
    zoneConfirmed: { direction: string; count: number }[];
    revalidations: { direction: string; verdict: string; count: number }[];
  };
  analyses: {
    id: string; timestamp: number; outcome: string; policyVersion?: number;
    providers: Record<string, { status: string; failure?: string }>;
    candidates: { provider: string; reason: string; details?: unknown }[];
  }[];
}
const labels: Record<string, string> = {
  AI_NO_TRADE: 'Sin propuesta operable de IA', CANDIDATES_REJECTED: 'Candidatos rechazados por validación',
  DIRECTIONAL_ACCEPTED: 'Hipótesis direccional aceptada', PROVIDER_UNAVAILABLE: 'Proveedor no disponible',
  DATA_UNAVAILABLE: 'Datos insuficientes', BUDGET_BLOCKED: 'Presupuesto bloqueado', ERROR: 'Análisis incompleto / error',
  RUNNING: 'Análisis iniciado (pendiente de resultado)',
};
export default function DiscoveryAuditPanel({ apiBase }: { apiBase: string }) {
  const [data, setData] = useState<AuditData | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const refresh = async () => {
      try {
        const res = await fetch(`${apiBase}/api/v1/discovery/audit?limit=10`, { signal: controller.signal });
        if (!res.ok) throw new Error('Audit unavailable');
        setData((await res.json()).data); setError(false);
      } catch { if (!controller.signal.aborted) setError(true); }
    };
    void refresh(); const timer = setInterval(refresh, 30000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [apiBase]);
  if (!data) return <p className="text-xs text-slate-400">{error ? 'Auditoría no disponible' : 'Cargando embudo de análisis…'}</p>;
  const f = data.funnel;
  const cards: [string, number][] = [
    ['Análisis registrados', f.analyses.reduce((n, a) => n + a.count, 0)],
    ['Observaciones neutrales', f.neutral], ['Hipótesis LONG / SHORT', f.longs + f.shorts],
    ['Zona confirmada (direccionales)', f.zoneConfirmed.filter(r => r.direction !== 'NEUTRAL').reduce((n, r) => n + r.count, 0)],
    ['Revalidaciones direccionales', f.revalidations.filter(r => r.direction !== 'NEUTRAL').reduce((n, r) => n + r.count, 0)],
    ['Señales autorizadas', f.authorizedSignals], ['Entradas paper', f.paperEntries], ['Operaciones paper cerradas', f.paperClosed],
  ];
  return <section className="rounded-xl border border-slate-700 bg-slate-900/60 p-4 space-y-3">
    <h3 className="font-semibold text-slate-100">Embudo y motivos de descarte</h3>
    <p className="text-xs text-slate-300">Política vigente: mínimo neto {data.policy.short}R para objetivo corto y {data.policy.extended}R para extendido.
      {' '}Objetivos habilitados: {data.policy.mode === 'RR_1_2' ? 'corto' : data.policy.mode === 'RR_1_4' ? 'extendido' : 'ambos'}.</p>
    {error && <p className="text-xs text-amber-300">Actualización fallida; se muestran los últimos datos recibidos.</p>}
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">{cards.map(([label, count]) =>
      <div key={label}><div className="text-xl font-mono text-slate-100">{count ?? 0}</div><div className="text-xs text-slate-400">{label}</div></div>)}</div>
    <p className="text-xs text-slate-400">{f.neutralBreakouts ?? 0} observaciones finalizaron por ruptura: no son operaciones cerradas.
      {' '}{f.legacyScenarios ?? 0} escenarios históricos no tienen auditoría de candidatos. Los análisis registrados cuentan desde esta actualización.</p>
    <details className="text-xs text-slate-300"><summary className="cursor-pointer">Motivos acumulados de los candidatos</summary>
      {f.candidates.map(c => <p key={c.reason} className="mt-1">{c.reason}: {c.count}</p>)}
      {!f.candidates.length && <p>No hay candidatos auditados todavía.</p>}
    </details>
    {data.analyses.map(a => <details key={a.id} className="rounded border border-slate-700 p-2 text-xs text-slate-300">
      <summary className="cursor-pointer">{new Date(a.timestamp).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })} ART · {labels[a.outcome] || a.outcome}</summary>
      <p className="mt-2">Política: versión {a.policyVersion ?? 'no registrada'}</p>
      {Object.entries(a.providers).map(([provider, status]) => <p key={provider}>{provider}: {status.status}{status.failure ? ` (${status.failure})` : ''}</p>)}
      {a.candidates.map((c, i) => <div key={i} className="mt-2"><p>{c.provider}: {c.reason}</p>
        {c.details !== undefined && <pre className="overflow-x-auto whitespace-pre-wrap break-words text-[11px]">{JSON.stringify(c.details, null, 2)}</pre>}</div>)}
    </details>)}
  </section>;
}
