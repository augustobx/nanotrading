'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { CandleChart, CandleData, Timeframe } from './CandleChart';
import { OrderBookWidget } from './OrderBookWidget';
import { getApiBaseUrl } from '../utils/api-config';

type MarketSummary = {
  symbol: string;
  status: string;
  lastPrice: number | null;
  wsConnected: boolean;
  schedulerEnabled: boolean;
  activeWatchedScenarios: number;
};
type MarketStats = {
  symbol: string;
  totalScenarios: number;
  neutralObservations: number;
  directionalScenarios: number;
  paperEntries: number;
  paperClosed: number;
  netRRealized: number;
};

const PRICE = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
const fmt = (value: number | null | undefined) =>
  Number.isFinite(value) ? PRICE.format(value as number) : '—';

export function EthMarketPanel({ isDark = true }: { isDark?: boolean }) {
  const [timeframe, setTimeframe] = useState<Timeframe>('15m');
  const [state, setState] = useState<any>(null);
  const [candles, setCandles] = useState<CandleData[]>([]);
  const [analyses, setAnalyses] = useState<Record<string, any>>({});
  const [scenarios, setScenarios] = useState<any[]>([]);
  const [selectedScenarioId, setSelectedScenarioId] = useState<string | null>(null);
  const [scheduler, setScheduler] = useState<any>(null);
  const [audits, setAudits] = useState<any[]>([]);
  const [stats, setStats] = useState<Record<string, MarketStats>>({});
  const [directory, setDirectory] = useState<MarketSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastSync, setLastSync] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const request = useCallback(async (resource: string, symbol = 'ETHUSDT') => {
    const res = await fetch(`${getApiBaseUrl()}/api/v1/markets/${symbol}/${resource}`,
      { cache: 'no-store' });
    const json = await res.json();
    if (!res.ok || !json.success) throw new Error(`${symbol}/${resource}: HTTP ${res.status}`);
    return json.data;
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [marketState, marketCandles, analysis, liveScenarios, schedule, recentAudits,
        btcStats, ethStats, marketDirectory] = await Promise.all([
        request('state'),
        request(`candles?timeframe=${timeframe}&limit=150`),
        request('analysis'),
        request('scenarios?limit=100'),
        request('scheduler'),
        request('audits?limit=8'),
        request('stats', 'BTCUSDT'),
        request('stats', 'ETHUSDT'),
        fetch(`${getApiBaseUrl()}/api/v1/markets`, { cache: 'no-store' }).then(async r => {
          if (!r.ok) throw new Error(`Listado de mercados: HTTP ${r.status}`);
          return (await r.json()).data as MarketSummary[];
        }),
      ]);
      setState(marketState);
      setCandles(marketCandles);
      setAnalyses(analysis);
      setScenarios(liveScenarios);
      setScheduler(schedule);
      setAudits(recentAudits);
      setStats({ BTCUSDT: btcStats, ETHUSDT: ethStats });
      setDirectory(marketDirectory);
      setError(null);
      setLastSync(Date.now());
    } catch (err: any) {
      setError(err?.message || 'No se pudo consultar ETHUSDT');
    } finally {
      setLoading(false);
    }
  }, [request, timeframe]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 12000);
    return () => clearInterval(timer);
  }, [refresh]);

  const currentAnalysis = analyses[timeframe];
  const liveScenario = scenarios.filter(s =>
    !['EXPIRED', 'INVALIDATED', 'CANCELLED', 'COMPLETED', 'DISCARDED', 'SIGNAL_GENERATED']
      .includes(s.status) && (!s.validUntilTimestamp || s.validUntilTimestamp > Date.now()));
  const eth = directory.find(s => s.symbol === 'ETHUSDT');

  return (
    <section className="space-y-4" aria-label="Terminal independiente ETHUSDT">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1422] p-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-extrabold text-xl text-slate-900 dark:text-white">ETHUSDT</h2>
            <span className={`rounded-lg px-2 py-1 text-xs font-semibold ${state?.wsConnected
              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
              : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'}`}>
              {state?.wsConnected ? 'Bybit conectado' : 'Esperando datos Bybit'}
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Mercado independiente · Modo SIGNALS_ONLY · Presupuesto IA compartido BTC + ETH
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <div className="text-right">
            <p className="text-xs text-slate-500">Último precio</p>
            <p className="text-xl font-mono font-bold text-slate-900 dark:text-white">
              $${fmt(state?.ticker?.lastPrice)}
            </p>
          </div>
          <button type="button" onClick={() => void refresh()}
            className="rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800">
            Actualizar sin usar IA
          </button>
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-600 dark:text-amber-400">
          {error}. {lastSync ? 'Mostrando los últimos datos conocidos.' : 'BTCUSDT continúa independiente.'}
        </p>
      )}

      {loading ? (
        <p className="p-6 text-center text-sm text-slate-500">Cargando los datos del mercado ETHUSDT…</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              { label: 'Scheduler ETH', value: scheduler?.enabled && scheduler?.isRunning ? 'Activo' : 'Sin actividad' },
              { label: 'Zonas direccionales', value: String(scheduler?.activeWatchedScenarios ?? 0) },
              { label: 'Descubrimientos (reinicio)', value: String(scheduler?.totalAutonomousRuns ?? 0) },
              { label: 'Observaciones neutrales', value: String(liveScenario.filter(s => s.direction === 'NEUTRAL').length) },
            ].map(metric => (
              <div key={metric.label} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1422] p-3">
                <p className="text-[11px] text-slate-500">{metric.label}</p>
                <p className="mt-1 text-sm font-bold text-slate-900 dark:text-white">{metric.value}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <CandleChart candles={candles} currentCandle={state?.currentCandle?.[timeframe] || null}
                timeframe={timeframe} onTimeframeChange={setTimeframe}
                swings={currentAnalysis?.structure?.swings || []}
                structureBreaks={currentAnalysis?.structure?.structureBreaks || []}
                fvgs={currentAnalysis?.structure?.fvgs || []}
                scenarios={scenarios} selectedScenarioId={selectedScenarioId}
                onSelectScenario={setSelectedScenarioId} symbol="ETHUSDT" isDark={isDark} />
            </div>
            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1422] p-4">
                <h3 className="mb-3 text-sm font-bold text-slate-900 dark:text-white">Vigilancia ETH</h3>
                {liveScenario.length === 0 ? (
                  <p className="text-xs text-slate-500">Sin observaciones vigentes. El scheduler analiza cambios relevantes.</p>
                ) : liveScenario.slice(0, 5).map(sc => (
                  <button type="button" key={sc.id} onClick={() => setSelectedScenarioId(sc.id)}
                    className={`mb-2 w-full rounded-lg border p-3 text-left text-xs ${selectedScenarioId === sc.id
                      ? 'border-amber-500 bg-amber-500/10' : 'border-slate-200 dark:border-slate-800 hover:border-amber-400'}`}>
                    <div className="flex justify-between gap-2">
                      <span className="font-bold text-slate-900 dark:text-white">{sc.direction}</span>
                      <span className="text-slate-500">{sc.status}</span>
                    </div>
                    <p className="mt-1 font-mono text-slate-600 dark:text-slate-300">
                      {sc.direction === 'NEUTRAL'
                        ? `Piso $${fmt(sc.entryZoneMin)} · Techo $${fmt(sc.entryZoneMax)}`
                        : `Entrada $${fmt(sc.targetEntry)} · SL $${fmt(sc.stopLossPrice)}`}
                    </p>
                    <span className="mt-1 inline-block text-amber-600 dark:text-amber-400">Ver niveles en gráfico</span>
                  </button>
                ))}
              </div>
              <OrderBookWidget orderBook={state?.orderBook || null} />
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1422] p-4">
            <h3 className="mb-2 text-sm font-bold text-slate-900 dark:text-white">Comparación paper BTC / ETH</h3>
            <p className="mb-3 text-xs text-slate-500">R realizado en operaciones cerradas, sin mezclar los activos. No representa rendimiento garantizado.</p>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead><tr className="border-b border-slate-200 dark:border-slate-700 text-slate-500">
                  <th className="py-2">Mercado</th><th>Escenarios direccionales</th>
                  <th>Entradas paper</th><th>Cierres</th><th>R neto realizado</th><th>Datos</th>
                </tr></thead>
                <tbody>{['BTCUSDT','ETHUSDT'].map(symbol => (
                  <tr key={symbol} className="border-b border-slate-100 dark:border-slate-800 text-slate-700 dark:text-slate-200">
                    <td className="py-2 font-bold">{symbol}</td>
                    <td>{stats[symbol]?.directionalScenarios ?? '—'}</td>
                    <td>{stats[symbol]?.paperEntries ?? '—'}</td>
                    <td>{stats[symbol]?.paperClosed ?? '—'}</td>
                    <td className="font-mono">{stats[symbol] ? stats[symbol].netRRealized.toFixed(2) : '—'}</td>
                    <td>{directory.find(s => s.symbol === symbol)?.wsConnected ? 'En vivo' : 'Sin WS'}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1422] p-4">
            <h3 className="mb-2 text-sm font-bold text-slate-900 dark:text-white">Auditoría reciente de descubrimiento ETH</h3>
            {audits.length === 0 ? (
              <p className="text-xs text-slate-500">Todavía no hay análisis ETH registrados.</p>
            ) : (
              <div className="space-y-2">{audits.slice(0, 5).map(a => (
                <div key={a.id} className="flex flex-wrap justify-between gap-2 border-b border-slate-100 dark:border-slate-800 py-2 text-xs">
                  <span className="text-slate-500">{new Date(a.timestamp).toLocaleString('es-AR')}</span>
                  <span className="font-semibold text-slate-700 dark:text-slate-200">{a.outcome}</span>
                  <span className="text-slate-500">
                    OpenAI: {a.providers?.OPENAI?.status || '—'} · Gemini: {a.providers?.GEMINI?.status || '—'}
                  </span>
                </div>
              ))}</div>
            )}
          </div>
          {lastSync && <p className="text-right text-[11px] text-slate-500">Actualizado: {new Date(lastSync).toLocaleTimeString('es-AR')}</p>}
        </>
      )}
    </section>
  );
}
