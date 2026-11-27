'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, ArrowUpRight, BarChart3, CheckCircle2, CircleAlert,
  Clock3, FileSearch, Moon, Radio, RefreshCw, Settings2,
  ShieldCheck, Sun, TrendingDown, TrendingUp,
} from 'lucide-react';
import { CandleChart, type CandleData, type Timeframe } from './CandleChart';
import { ConfigCenterModal } from './config/ConfigCenterModal';
import { useERPTheme } from '../nanolabs-components/ThemeContext';
import { getApiBaseUrl } from '../utils/api-config';

type Symbol = 'BTCUSDT' | 'ETHUSDT';
type QuantDecision = {
  id: string; candleTimestamp: number; regime: string; strategy: string | null;
  direction: 'LONG' | 'SHORT' | null; outcome: string; reason: string;
  entryPrice: number | null; stopLoss: number | null; takeProfit: number | null;
  netRR: number | null; metadata: { alternative2NetRR?: number; alternative4NetRR?: number; violations?: string[] };
};
type QuantResponse = {
  mode: 'SHADOW' | 'PAPER';
  summary: {
    evaluatedCandles: number;
    outcomes: Record<string, number>;
    strategies: Record<string, number>;
    latest?: QuantDecision | null;
  };
  decisions: QuantDecision[];
  executionMode: string;
};
type MarketDirectory = {
  symbol: string; wsConnected: boolean; candle15mStale?: boolean;
  lastPrice: number | null; last15mClosedAt?: number | null;
};
const money = (n: number | undefined | null) => n != null && Number.isFinite(n)
  ? '$' + new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(n) : '—';
const time = (n: number | undefined | null) => n
  ? new Date(n).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires',
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  : '—';
const outcomeText: Record<string, string> = {
  NO_PATTERN: 'Sin patrón', DATA_NOT_READY: 'Datos insuficientes',
  REJECTED_RISK: 'Rechazada por riesgo / R:R',
  SHADOW_QUALIFIED: 'Apta en sombra', PAPER_SIGNAL: 'Señal paper emitida',
  SIGNAL_ERROR: 'Error al registrar señal',
};
const regimeText: Record<string, string> = {
  BULL_TREND: 'Tendencia alcista', BEAR_TREND: 'Tendencia bajista',
  RANGE_OR_TRANSITION: 'Rango / transición', DATA_NOT_READY: 'Esperando datos',
};
const strategyText: Record<string, string> = {
  QUANT_TREND_PULLBACK: 'Retroceso en tendencia',
  QUANT_LIQUIDITY_SWEEP: 'Barrido de liquidez',
};
const pendingStates = new Set(['ENTRY_VALIDATED', 'ALERT_SENT', 'APPROACHING_ZONE', 'IN_ZONE']);
const closedStates = new Set(['COMPLETED_TP', 'COMPLETED_SL', 'CANCELLED', 'EXPIRED', 'INVALIDATED']);

export function QuantCockpit() {
  const { isDark, toggleDarkMode } = useERPTheme();
  const [symbol, setSymbol] = useState<Symbol>('BTCUSDT');
  const [tf, setTf] = useState<Timeframe>('5m');
  const [quant, setQuant] = useState<QuantResponse | null>(null);
  const [markets, setMarkets] = useState<MarketDirectory[]>([]);
  const [candles, setCandles] = useState<CandleData[]>([]);
  const [marketState, setMarketState] = useState<any>(null);
  const [signals, setSignals] = useState<any[]>([]);
  const [configOpen, setConfigOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshTime, setRefreshTime] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const api = getApiBaseUrl();
    try {
      const [q, marketList, chart, state, signalData] = await Promise.all([
        fetch(`${api}/api/v1/markets/${symbol}/quant?limit=80`, { cache: 'no-store' }),
        fetch(`${api}/api/v1/markets`, { cache: 'no-store' }),
        fetch(`${api}/api/v1/markets/${symbol}/candles?timeframe=${tf}&limit=150`,
          { cache: 'no-store' }),
        fetch(`${api}/api/v1/markets/${symbol}/state`, { cache: 'no-store' }),
        fetch(`${api}/api/v1/markets/${symbol}/signals?limit=50`, { cache: 'no-store' }),
      ]);
      if (![q, marketList, chart, state, signalData].every(r => r.ok)) {
        throw new Error('El backend cuantitativo no respondió correctamente');
      }
      const json = await Promise.all([q, marketList, chart, state, signalData].map(r => r.json()));
      if (!json.every(x => x.success)) throw new Error('API devolvió una respuesta inválida');
      setQuant(json[0].data);
      setMarkets(json[1].data);
      setCandles(json[2].data);
      setMarketState(json[3].data);
      setSignals(json[4].data);
      setRefreshTime(Date.now());
      setError(null);
    } catch (err: any) {
      setError(err?.message || 'No se puede consultar el backend');
    } finally {
      setLoading(false);
    }
  }, [symbol, tf]);

  useEffect(() => {
    setLoading(true);
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 15000);
    return () => clearInterval(timer);
  }, [refresh]);

  const m = markets.find(x => x.symbol === symbol);
  const outcomes = quant?.summary?.outcomes || {};
  const qualified = (outcomes.SHADOW_QUALIFIED || 0) + (outcomes.PAPER_SIGNAL || 0);
  const rejected = (outcomes.REJECTED_RISK || 0) + (outcomes.SIGNAL_ERROR || 0);
  const candidates = qualified + rejected;
  const recent = quant?.decisions || [];
  const observedSignals = signals.filter(s => !closedStates.has(s.status));
  const latestCandidate = recent.find(d => d.strategy && d.entryPrice != null && d.stopLoss != null);
  const chartScenarios = useMemo(() => {
    if (!latestCandidate || !latestCandidate.entryPrice || !latestCandidate.stopLoss) return [];
    if (Date.now() - latestCandidate.candleTimestamp > 45 * 60000) return [];
    return [{
      id: latestCandidate.id, symbol, kind: 'TRADE_SCENARIO',
      direction: latestCandidate.direction, status: 'SCENARIO_MONITORING',
      timeframe: '5m', targetEntry: latestCandidate.entryPrice,
      entryZoneMin: latestCandidate.entryPrice,
      entryZoneMax: latestCandidate.entryPrice,
      stopLossPrice: latestCandidate.stopLoss,
      target14Price: latestCandidate.takeProfit,
      discoveryTimestamp: latestCandidate.candleTimestamp,
      validUntilTimestamp: latestCandidate.candleTimestamp + 45 * 60000,
    }];
  }, [latestCandidate, symbol]);

  const infoCards = [
    { title: 'Velas evaluadas · 24h', value: quant?.summary?.evaluatedCandles ?? '—', note: 'Una evaluación por cada cierre 5m', icon: Activity },
    { title: 'Patrones encontrados · 24h', value: candidates, note: 'Barridos + retrocesos', icon: FileSearch },
    { title: 'Candidatos aptos · 24h', value: qualified, note: 'Superaron las reglas de riesgo', icon: CheckCircle2 },
    { title: 'Rechazados · 24h', value: rejected, note: 'Motivo registrado por vela', icon: CircleAlert },
  ];

  return (
    <main className="min-h-screen bg-[#f5f7fa] dark:bg-[#0b101a] text-[#182235] dark:text-slate-100">
      <header className="border-b border-[#dfe6ef] dark:border-slate-800 bg-white/95 dark:bg-[#111a29] sticky top-0 z-30 backdrop-blur">
        <div className="mx-auto max-w-[1500px] px-4 sm:px-8 py-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex gap-3 items-center">
            <div className="rounded-2xl p-3 bg-[#172745] text-white"><Activity size={24}/></div>
            <div>
              <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight">NanoTrading</h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">Centro de oportunidades · Bybit Linear · SIGNALS_ONLY</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <a href="/legacy" className="inline-flex items-center gap-2 rounded-xl border border-slate-300 dark:border-slate-700 px-3 py-2 text-sm font-medium hover:bg-slate-100 dark:hover:bg-slate-800">Vista avanzada <ArrowUpRight size={14}/></a>
            <button onClick={() => setConfigOpen(true)} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 dark:border-slate-700 px-3 py-2 text-sm font-medium hover:bg-slate-100 dark:hover:bg-slate-800"><Settings2 size={15}/> Configuración</button>
            <button aria-label="Cambiar tema" onClick={toggleDarkMode} className="rounded-xl border border-slate-300 dark:border-slate-700 p-2.5 hover:bg-slate-100 dark:hover:bg-slate-800">{isDark ? <Sun size={17}/> : <Moon size={17}/>}</button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1500px] px-4 sm:px-8 py-7 space-y-6">
        <section className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold tracking-widest uppercase text-slate-500 dark:text-slate-400">Mercado seleccionado</p>
            <div className="flex items-center gap-3 mt-2">
              {(['BTCUSDT','ETHUSDT'] as const).map(code => (
                <button key={code} aria-pressed={code === symbol} onClick={() => setSymbol(code)}
                  className={`rounded-xl px-4 py-2.5 text-sm font-bold border transition ${code === symbol
                    ? 'bg-[#1d3357] text-white border-[#1d3357] shadow-sm'
                    : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-[#152031] hover:border-slate-500'}`}>
                  {code === 'BTCUSDT' ? '₿ BTC' : 'Ξ ETH'}
                </button>
              ))}
              <span className="font-mono text-lg sm:text-2xl font-bold ml-1">{money(m?.lastPrice)}</span>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`inline-flex items-center gap-2 rounded-full text-xs font-semibold px-3 py-2 ${m?.wsConnected && !m?.candle15mStale
              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300'
              : 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300'}`}>
              <Radio size={14}/> {m?.wsConnected && !m?.candle15mStale ? 'Datos conectados' : 'Revisar conexión / velas'}
            </span>
            <span className="inline-flex items-center gap-2 rounded-full bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300 text-xs font-semibold px-3 py-2">
              <ShieldCheck size={14}/> {quant?.mode === 'PAPER' ? 'Paper cuantitativo' : 'Motor en sombra'}
            </span>
            <button type="button" onClick={() => void refresh()} aria-label="Actualizar" className="rounded-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 p-2"><RefreshCw size={16}/></button>
          </div>
        </section>

        {error && <div role="alert" className="border border-rose-300 bg-rose-50 dark:bg-rose-950/30 rounded-xl px-4 py-3 text-sm text-rose-800 dark:text-rose-300">{error}. No se puede confirmar el estado del motor. {refreshTime && 'Los datos mostrados son anteriores.'}</div>}
        {m?.candle15mStale && <div role="alert" className="border border-amber-300 bg-amber-50 dark:bg-amber-900/20 rounded-xl px-4 py-3 text-sm text-amber-800 dark:text-amber-300">La última vela de 15m está desactualizada. El motor no debe operar con datos incompletos.</div>}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {infoCards.map(card => <div key={card.title} className="rounded-2xl bg-white dark:bg-[#131c2a] border border-[#e1e6ed] dark:border-slate-800 p-4 sm:p-5">
            <card.icon size={19} className="text-slate-500 dark:text-slate-400 mb-4"/>
            <div className="text-2xl sm:text-3xl font-bold tabular-nums">{card.value}</div>
            <div className="text-sm font-semibold mt-1">{card.title}</div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">{card.note}</div>
          </div>)}
        </div>

        <section className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.8fr)_minmax(330px,1fr)] gap-4">
          <div className="min-w-0 space-y-3">
            <CandleChart symbol={symbol} isDark={isDark} candles={candles}
              currentCandle={marketState?.currentCandle?.[tf] || null}
              timeframe={tf} onTimeframeChange={setTf} scenarios={chartScenarios}/>
            <p className="text-xs text-slate-500 dark:text-slate-400 px-1">El gráfico muestra los niveles del último candidato vigente. Los datos se actualizan automáticamente cada 15 segundos.</p>
          </div>

          <div className="space-y-4">
            <div className="rounded-2xl bg-white dark:bg-[#131c2a] border border-[#e1e6ed] dark:border-slate-800 p-5">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-base font-bold">¿Qué está haciendo el bot?</h2>
                <Clock3 size={17} className="text-slate-400"/>
              </div>
              <div className="mt-4 text-xs uppercase tracking-wider text-slate-500">Estado matemático del mercado</div>
              <div className="text-xl font-bold mt-1">{regimeText[quant?.summary?.latest?.regime || ''] || 'Esperando primera evaluación'}</div>
              <div className="text-xs text-slate-500 mt-1">Última vela evaluada: {time(quant?.summary?.latest ? quant.summary.latest.candleTimestamp + 300000 : null)}</div>
              <div className="border-t border-slate-200 dark:border-slate-800 mt-5 pt-4">
                <div className="text-xs uppercase tracking-wider text-slate-500">Última decisión</div>
                <div className="font-bold text-sm mt-1">{outcomeText[quant?.summary?.latest?.outcome || ''] || 'Sin evaluaciones todavía'}</div>
                <p className="text-sm text-slate-600 dark:text-slate-300 mt-2">{quant?.summary?.latest?.reason || 'Al cerrar la primera vela 5m, aparecerá aquí el motivo exacto.'}</p>
              </div>
            </div>

            <div className="rounded-2xl bg-white dark:bg-[#131c2a] border border-[#e1e6ed] dark:border-slate-800 p-5">
              <div className="flex items-center gap-2 mb-3"><BarChart3 size={18} className="text-slate-500"/><h2 className="font-bold">Último candidato</h2></div>
              {latestCandidate ? <>
                <div className="flex items-center gap-2 text-sm font-semibold">
                  {latestCandidate.direction === 'LONG'
                    ? <TrendingUp size={17} className="text-emerald-600"/> : <TrendingDown size={17} className="text-rose-600"/>}
                  {strategyText[latestCandidate.strategy || ''] || latestCandidate.strategy}
                  <span className="text-xs text-slate-500">· {latestCandidate.direction}</span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center mt-4">
                  {[['Entrada',latestCandidate.entryPrice],['Stop',latestCandidate.stopLoss],['Objetivo',latestCandidate.takeProfit]].map(([label,value]) =>
                    <div key={String(label)} className="bg-slate-100 dark:bg-slate-800 rounded-lg p-2"><div className="text-xs text-slate-500">{label}</div><div className="font-mono text-sm font-bold mt-1">{money(value as number)}</div></div>)}
                </div>
                <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">{outcomeText[latestCandidate.outcome] || latestCandidate.outcome}: {latestCandidate.reason}</p>
                <p className="mt-2 text-xs text-slate-500">R:R neto estimado: {latestCandidate.netRR?.toFixed(2) || '—'} · {time(latestCandidate.candleTimestamp + 300000)}</p>
              </> : <p className="text-sm text-slate-500">Todavía no hay patrones de entrada matemáticos detectados.</p>}
            </div>
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 text-xs text-slate-500 dark:text-slate-400">
              <strong className="block text-slate-700 dark:text-slate-200 mb-1">Regla de seguridad</strong>
              {quant?.mode === 'PAPER' ? 'Las señales matemáticas siguen sujetas a stop, R:R, límites de exposición, velas recientes y kill switch.' :
                'Modo sombra: el bot detecta y audita oportunidades, pero NO genera entradas nuevas. La activación paper requiere validar el backtest.'}
              {' '}El motor matemático no consume tokens IA.
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-[#e1e6ed] dark:border-slate-800 bg-white dark:bg-[#131c2a] overflow-hidden">
          <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between flex-wrap gap-2">
            <div><h2 className="font-bold text-lg">Bitácora de decisiones</h2><p className="text-xs text-slate-500 mt-1">Cada vela cerrada deja un resultado: sin patrón, candidato o descarte con motivo</p></div>
            <span className="text-xs text-slate-500">Última sincronización: {time(refreshTime)}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-[670px] w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/50 text-xs text-slate-500 text-left">
                <tr><th className="py-3 px-4">Cierre ART</th><th>Régimen</th><th>Estrategia</th><th>Resultado</th><th className="pr-4">Motivo</th></tr>
              </thead>
              <tbody>
                {recent.slice(0, 30).map(d => <tr key={d.id} className="border-t border-slate-100 dark:border-slate-800 align-top">
                  <td className="px-4 py-3 whitespace-nowrap font-mono text-xs">{time(d.candleTimestamp + 300000)}</td>
                  <td className="py-3 pr-3 whitespace-nowrap">{regimeText[d.regime] || d.regime}</td>
                  <td className="py-3 pr-3">{strategyText[d.strategy || ''] || '—'}</td>
                  <td className="py-3 pr-3 font-semibold">{outcomeText[d.outcome] || d.outcome}</td>
                  <td className="py-3 pr-4 max-w-[450px] text-slate-600 dark:text-slate-300">{d.reason}</td>
                </tr>)}
                {!recent.length && <tr><td colSpan={5} className="py-8 text-center text-slate-500">{loading ? 'Consultando motor cuantitativo…' : 'Sin evaluaciones registradas. Se alimenta en cada cierre de 5m.'}</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-2xl border border-[#e1e6ed] dark:border-slate-800 bg-white dark:bg-[#131c2a] p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h2 className="font-bold text-lg">Señales y seguimiento paper</h2><p className="text-xs text-slate-500 mt-1">Separado de los candidatos: una detección no significa una entrada ejecutada.</p></div>
            <span className="text-xs font-medium text-slate-500">{observedSignals.length} activas o pendientes</span>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {observedSignals.slice(0, 6).map(s => <div key={s.id} className="rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 p-4">
              <div className="flex items-center justify-between gap-2 text-sm font-bold">
                <span>{s.direction} · {s.strategy?.startsWith('QUANT') ? 'Matemática' : 'IA heredada'}</span>
                <span className="text-xs text-slate-500">{s.status}</span>
              </div>
              <p className="font-mono text-xs mt-2">Entrada {money(s.entryPrice)} · SL {money(s.stopLoss)}</p>
              <p className="text-xs text-slate-500 mt-1">TP {money(s.takeProfit)} · R neto {s.rrNet?.toFixed?.(2) || '—'}</p>
              <p className="text-xs text-slate-500 mt-2">{pendingStates.has(s.status) ? 'Pendiente de entrada' : 'Seguimiento en curso'}</p>
            </div>)}
            {observedSignals.length === 0 && <p className="text-sm text-slate-500 py-5">No hay señales paper abiertas.</p>}
          </div>
        </section>
      </div>
      <ConfigCenterModal isOpen={configOpen} onClose={() => setConfigOpen(false)} onConfigChanged={() => void refresh()}/>
    </main>
  );
}
