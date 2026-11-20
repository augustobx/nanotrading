'use client';

import React, { useState, useEffect } from 'react';
import {
  FlaskConical,
  Play,
  Download,
  Database,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  ShieldAlert,
  Target,
  BarChart3,
  CheckCircle2,
  XCircle,
  Clock,
  Layers,
  ArrowUpRight,
  ArrowDownRight,
  Filter,
} from 'lucide-react';
import { getApiBaseUrl } from '../utils/api-config';

interface MetricGroup {
  totalTrades: number;
  wins: number;
  losses: number;
  expired: number;
  winRate: number;
  profitFactor: number;
  expectancyR: number;
  maxDrawdownPct: number;
  maxDrawdownR: number;
  netPnlUsdt: number;
  netPnlR: number;
  avgDurationHours: number;
  avgMfeR: number;
  avgMaeR: number;
}

interface BacktestReport {
  id: string;
  symbol: string;
  startTimestamp: number;
  endTimestamp: number;
  inSampleEndTimestamp: number;
  status: 'COMPLETED' | 'FAILED';
  totalTrades: number;
  winRate: number;
  profitFactor: number;
  expectancyR: number;
  maxDrawdownPct: number;
  netPnlUsdt: number;
  netPnlR: number;
  inSampleMetrics: MetricGroup;
  outSampleMetrics: MetricGroup;
  breakdown: {
    strategyA_Long_12: MetricGroup;
    strategyA_Long_14: MetricGroup;
    strategyA_Short_12: MetricGroup;
    strategyA_Short_14: MetricGroup;
    strategyB_Long_12: MetricGroup;
    strategyB_Long_14: MetricGroup;
    strategyB_Short_12: MetricGroup;
    strategyB_Short_14: MetricGroup;
    combinedPortfolio: MetricGroup;
  };
  config: any;
  createdAt: number;
}

interface Trade {
  id: string;
  runId: string;
  symbol: string;
  strategy: string;
  direction: 'LONG' | 'SHORT';
  ratioTarget: 'RR_1_2' | 'RR_1_4';
  timeframe: string;
  entryTimestamp: number;
  exitTimestamp: number;
  entryPrice: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  exitPrice: number;
  outcome: 'TAKE_PROFIT' | 'STOP_LOSS' | 'EXPIRED';
  realizedNetPnlUsdt: number;
  realizedNetR: number;
  mfeR: number;
  maeR: number;
  durationMs: number;
  isInSample: boolean;
  feesUsdt: number;
  expectedNetRR?: number;
  structuralJustification?: string;
  exclusionReason?: string;
}

export default function TradingLaboratory() {
  const [dataStatus, setDataStatus] = useState<any>(null);
  const [runs, setRuns] = useState<any[]>([]);
  const [selectedRun, setSelectedRun] = useState<BacktestReport | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'metrics' | 'trades' | 'insample'>('metrics');
  const [tradeFilter, setTradeFilter] = useState<'ALL' | 'TAKE_PROFIT' | 'STOP_LOSS'>('ALL');

  // Backtest options
  const [days, setDays] = useState<number>(90);
  const [inSampleDays, setInSampleDays] = useState<number>(60);
  const [strategyFilter, setStrategyFilter] = useState<string>('ALL');
  const [directionFilter, setDirectionFilter] = useState<string>('ALL');
  const [ratioFilter, setRatioFilter] = useState<string>('ALL');

  const apiBase = getApiBaseUrl();

  const fetchStatusAndRuns = async () => {
    try {
      // 1. Data Status
      const stRes = await fetch(`${apiBase}/api/v1/backtest/data/status`);
      if (stRes.ok) {
        const j = await stRes.json();
        if (j.success) setDataStatus(j.data);
      }

      // 2. Runs list
      const rRes = await fetch(`${apiBase}/api/v1/backtest/runs?limit=10`);
      if (rRes.ok) {
        const j = await rRes.json();
        if (j.success && j.data.length > 0) {
          setRuns(j.data);
          if (!selectedRun) {
            setSelectedRun(j.data[0]);
            fetchRunTrades(j.data[0].id);
          }
        }
      }
    } catch {}
  };

  const fetchRunTrades = async (runId: string) => {
    try {
      const res = await fetch(`${apiBase}/api/v1/backtest/runs/${runId}/trades?limit=1000`);
      if (res.ok) {
        const j = await res.json();
        if (j.success) setTrades(j.data);
      }
    } catch {}
  };

  useEffect(() => {
    fetchStatusAndRuns();
  }, []);

  const handleRunBacktest = async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${apiBase}/api/v1/backtest/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: 'BTCUSDT',
          days,
          inSampleDays,
          strategyFilter,
          directionFilter,
          ratioFilter,
          accountBalance: 10000,
          riskPercent: 1.0,
        }),
      });

      if (res.ok) {
        const j = await res.json();
        if (j.success) {
          setSelectedRun(j.data);
          fetchStatusAndRuns();
          fetchRunTrades(j.data.id);
        }
      }
    } catch (err: any) {
      alert(`Error ejecutando backtest: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleImportData = async () => {
    setIsImporting(true);
    try {
      const res = await fetch(`${apiBase}/api/v1/backtest/data/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days }),
      });
      if (res.ok) {
        const j = await res.json();
        if (j.success) {
          setDataStatus(j.data);
          alert('Importación histórica de Bybit completada con éxito.');
        }
      }
    } catch (err: any) {
      alert(`Error en importación: ${err.message}`);
    } finally {
      setIsImporting(false);
    }
  };

  const filteredTrades = trades.filter((t) => {
    if (tradeFilter === 'ALL') return true;
    return t.outcome === tradeFilter;
  });

  const b = selectedRun?.breakdown;

  const breakdownRows = b
    ? [
        { name: 'Estrategia A (Trend Continuation)', dir: 'LONG', ratio: '1:2', m: b.strategyA_Long_12 },
        { name: 'Estrategia A (Trend Continuation)', dir: 'LONG', ratio: '1:4', m: b.strategyA_Long_14 },
        { name: 'Estrategia A (Trend Continuation)', dir: 'SHORT', ratio: '1:2', m: b.strategyA_Short_12 },
        { name: 'Estrategia A (Trend Continuation)', dir: 'SHORT', ratio: '1:4', m: b.strategyA_Short_14 },
        { name: 'Estrategia B (Liquidity Sweep & Rev)', dir: 'LONG', ratio: '1:2', m: b.strategyB_Long_12 },
        { name: 'Estrategia B (Liquidity Sweep & Rev)', dir: 'LONG', ratio: '1:4', m: b.strategyB_Long_14 },
        { name: 'Estrategia B (Liquidity Sweep & Rev)', dir: 'SHORT', ratio: '1:2', m: b.strategyB_Short_12 },
        { name: 'Estrategia B (Liquidity Sweep & Rev)', dir: 'SHORT', ratio: '1:4', m: b.strategyB_Short_14 },
        { name: 'CARTERA COMBINADA (Sin Exposición Duplicada)', dir: 'AMBAS', ratio: 'MIXTO', m: b.combinedPortfolio, isHighlight: true },
      ]
    : [];

  return (
    <div className="space-y-6">
      {/* Top Banner & Control Deck */}
      <div className="bg-[#131722] border border-[#2b3347] rounded-xl p-5 shadow-lg">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-[#FF6600]/15 flex items-center justify-center border border-[#FF6600]/30 text-[#FF6600]">
              <FlaskConical className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold text-white tracking-wide font-sans">
                  Trading Laboratory · Backtesting Cuantitativo 90 Días
                </h2>
                <span className="px-2 py-0.5 text-xs font-semibold rounded bg-[#FF6600]/20 text-[#FF6600] border border-[#FF6600]/40">
                  Bybit V5 Linear · BTCUSDT
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Evaluación determinista sin look-ahead bias con comisiones maker (0.02%), taker (0.055%), spread y slippage real.
              </p>
            </div>
          </div>

          {/* Quick Data Stats & Actions */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleImportData}
              disabled={isImporting}
              className="px-3.5 py-2 rounded-lg bg-[#181c28] hover:bg-[#202636] border border-[#2b3347] text-slate-200 text-xs font-medium flex items-center gap-1.5 transition-all shadow-sm disabled:opacity-50"
            >
              <Database className={`w-3.5 h-3.5 text-[#FF6600] ${isImporting ? 'animate-spin' : ''}`} />
              {isImporting ? 'Descargando...' : 'Actualizar Klines Bybit'}
            </button>

            <button
              onClick={handleRunBacktest}
              disabled={isLoading}
              className="px-4 py-2 rounded-lg bg-[#FF6600] hover:bg-[#ff771a] text-white text-xs font-bold flex items-center gap-2 transition-all shadow-md shadow-[#FF6600]/20 disabled:opacity-50"
            >
              <Play className={`w-4 h-4 fill-white ${isLoading ? 'animate-spin' : ''}`} />
              {isLoading ? 'Simulando...' : 'Ejecutar Backtest'}
            </button>
          </div>
        </div>

        {/* Filter bar */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-4 pt-4 border-t border-[#2b3347]/60 text-xs">
          <div>
            <label className="text-[11px] text-slate-400 block mb-1">Período Total</label>
            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="w-full bg-[#181c28] border border-[#2b3347] rounded-lg px-2.5 py-1.5 text-slate-200 focus:outline-none focus:border-[#FF6600]"
            >
              <option value={90}>90 Días Completos</option>
              <option value={60}>60 Días</option>
              <option value={30}>30 Días</option>
            </select>
          </div>

          <div>
            <label className="text-[11px] text-slate-400 block mb-1">Muestra In-Sample</label>
            <select
              value={inSampleDays}
              onChange={(e) => setInSampleDays(Number(e.target.value))}
              className="w-full bg-[#181c28] border border-[#2b3347] rounded-lg px-2.5 py-1.5 text-slate-200 focus:outline-none focus:border-[#FF6600]"
            >
              <option value={60}>60 Días (In) / 30d (Out)</option>
              <option value={45}>45 Días (In) / 45d (Out)</option>
              <option value={70}>70 Días (In) / 20d (Out)</option>
            </select>
          </div>

          <div>
            <label className="text-[11px] text-slate-400 block mb-1">Estrategia</label>
            <select
              value={strategyFilter}
              onChange={(e) => setStrategyFilter(e.target.value)}
              className="w-full bg-[#181c28] border border-[#2b3347] rounded-lg px-2.5 py-1.5 text-slate-200 focus:outline-none focus:border-[#FF6600]"
            >
              <option value="ALL">Todas (A & B)</option>
              <option value="STRATEGY_A">Estrategia A (Trend)</option>
              <option value="STRATEGY_B">Estrategia B (Sweep)</option>
            </select>
          </div>

          <div>
            <label className="text-[11px] text-slate-400 block mb-1">Dirección</label>
            <select
              value={directionFilter}
              onChange={(e) => setDirectionFilter(e.target.value)}
              className="w-full bg-[#181c28] border border-[#2b3347] rounded-lg px-2.5 py-1.5 text-slate-200 focus:outline-none focus:border-[#FF6600]"
            >
              <option value="ALL">Ambas (LONG & SHORT)</option>
              <option value="LONG">Solo LONG</option>
              <option value="SHORT">Solo SHORT</option>
            </select>
          </div>

          <div>
            <label className="text-[11px] text-slate-400 block mb-1">Ratio Beneficio/Riesgo</label>
            <select
              value={ratioFilter}
              onChange={(e) => setRatioFilter(e.target.value)}
              className="w-full bg-[#181c28] border border-[#2b3347] rounded-lg px-2.5 py-1.5 text-slate-200 focus:outline-none focus:border-[#FF6600]"
            >
              <option value="ALL">Ambos (1:2 & 1:4)</option>
              <option value="RR_1_2">1:2 Corto</option>
              <option value="RR_1_4">1:4 Extendido</option>
            </select>
          </div>
        </div>

        {/* Banner de Auditoría y Conciliación Contable */}
        <div className="mt-4 p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-start gap-3">
          <ShieldAlert className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div className="text-xs text-amber-200/90 leading-relaxed">
            <div className="font-bold text-amber-300 flex items-center gap-2">
              <span>Resultados históricos pendientes de conciliación contable</span>
              <span className="px-1.5 py-0.5 rounded bg-amber-400/20 text-amber-300 text-[10px] font-mono">Auditoría Fase 5B / 5C</span>
            </div>
            <p className="mt-1">
              Se detectaron asimetrías de costos en el histórico previo: las pérdidas computaban -1.0R nominal pero debitaban -$175 USDT en caja por comisiones taker y slippage, mientras que los beneficios salían en swings extendidos. Se conserva el histórico anterior como evidencia y el motor canónico actualiza 1R = netLossUSDT real para garantizar conciliación exacta trade-a-trade sin alterar datos.
            </p>
          </div>
        </div>
      </div>

      {/* KPI Cards Strip */}
      {selectedRun && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="bg-[#131722] border border-[#2b3347] rounded-xl p-3.5">
            <span className="text-[11px] text-slate-400 font-medium block">Operaciones</span>
            <div className="text-xl font-bold font-mono text-white mt-1">
              {selectedRun.totalTrades}
            </div>
            <span className="text-[10px] text-slate-400 mt-1 block">
              90 Días evaluados
            </span>
          </div>

          <div className="bg-[#131722] border border-[#2b3347] rounded-xl p-3.5">
            <span className="text-[11px] text-slate-400 font-medium block">Tasa de Acierto</span>
            <div className="text-xl font-bold font-mono text-white mt-1">
              {selectedRun.winRate.toFixed(1)}%
            </div>
            <span className="text-[10px] text-slate-400 mt-1 block">
              Global acumulada
            </span>
          </div>

          <div className="bg-[#131722] border border-[#2b3347] rounded-xl p-3.5">
            <span className="text-[11px] text-slate-400 font-medium block">PnL Neto Total</span>
            <div className={`text-xl font-bold font-mono mt-1 ${selectedRun.netPnlR >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {selectedRun.netPnlR >= 0 ? '+' : ''}{selectedRun.netPnlR.toFixed(1)}R
            </div>
            <span className="text-[10px] text-slate-400 mt-1 block font-mono">
              ${selectedRun.netPnlUsdt >= 0 ? '+' : ''}{selectedRun.netPnlUsdt.toFixed(1)} USDT
            </span>
          </div>

          <div className="bg-[#131722] border border-[#2b3347] rounded-xl p-3.5">
            <span className="text-[11px] text-slate-400 font-medium block">Esperanza Matemática</span>
            <div className={`text-xl font-bold font-mono mt-1 ${selectedRun.expectancyR >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {selectedRun.expectancyR >= 0 ? '+' : ''}{selectedRun.expectancyR.toFixed(2)}R
            </div>
            <span className="text-[10px] text-slate-400 mt-1 block">
              Retorno esperado por trade
            </span>
          </div>

          <div className="bg-[#131722] border border-[#2b3347] rounded-xl p-3.5">
            <span className="text-[11px] text-slate-400 font-medium block">Profit Factor</span>
            <div className={`text-xl font-bold font-mono mt-1 ${selectedRun.profitFactor >= 1.0 ? 'text-emerald-400' : 'text-amber-400'}`}>
              {selectedRun.profitFactor.toFixed(2)}
            </div>
            <span className="text-[10px] text-slate-400 mt-1 block">
              Ganancia bruta / Pérdida
            </span>
          </div>

          <div className="bg-[#131722] border border-[#2b3347] rounded-xl p-3.5">
            <span className="text-[11px] text-slate-400 font-medium block">Máximo Drawdown</span>
            <div className="text-xl font-bold font-mono text-rose-400 mt-1">
              -{selectedRun.maxDrawdownPct.toFixed(1)}%
            </div>
            <span className="text-[10px] text-slate-400 mt-1 block">
              Caída pico-valle
            </span>
          </div>
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="flex items-center justify-between border-b border-[#2b3347]">
        <div className="flex items-center gap-4">
          <button
            onClick={() => setActiveTab('metrics')}
            className={`pb-3 text-xs font-semibold transition-all border-b-2 flex items-center gap-1.5 ${
              activeTab === 'metrics'
                ? 'border-[#FF6600] text-[#FF6600]'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5" />
            Tabla de Rendimiento A vs B (1:2 & 1:4)
          </button>

          <button
            onClick={() => setActiveTab('insample')}
            className={`pb-3 text-xs font-semibold transition-all border-b-2 flex items-center gap-1.5 ${
              activeTab === 'insample'
                ? 'border-[#FF6600] text-[#FF6600]'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            In-Sample (60d) vs Out-of-Sample (30d)
          </button>

          <button
            onClick={() => setActiveTab('trades')}
            className={`pb-3 text-xs font-semibold transition-all border-b-2 flex items-center gap-1.5 ${
              activeTab === 'trades'
                ? 'border-[#FF6600] text-[#FF6600]'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Filter className="w-3.5 h-3.5" />
            Inspección Individual de Trades ({trades.length})
          </button>
        </div>

        {selectedRun && (
          <div className="flex items-center gap-2 pb-2">
            <a
              href={`${apiBase}/api/v1/backtest/runs/${selectedRun.id}/export?format=csv`}
              download
              className="px-2.5 py-1 rounded bg-[#181c28] hover:bg-[#202636] border border-[#2b3347] text-slate-300 text-[11px] font-medium flex items-center gap-1"
            >
              <Download className="w-3 h-3 text-[#FF6600]" />
              CSV
            </a>
            <a
              href={`${apiBase}/api/v1/backtest/runs/${selectedRun.id}/export?format=json`}
              download
              className="px-2.5 py-1 rounded bg-[#181c28] hover:bg-[#202636] border border-[#2b3347] text-slate-300 text-[11px] font-medium flex items-center gap-1"
            >
              <Download className="w-3 h-3 text-[#FF6600]" />
              JSON
            </a>
          </div>
        )}
      </div>

      {/* TAB 1: Performance Matrix (Mandatory Table) */}
      {activeTab === 'metrics' && (
        <div className="bg-[#131722] border border-[#2b3347] rounded-xl overflow-hidden shadow-lg">
          <div className="p-4 border-b border-[#2b3347] flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-white">
                Desglose Estadístico Obligatorio por Estrategia, Dirección y Ratio
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Simulación determinista basada en velas reales de Bybit V5 Linear.
              </p>
            </div>
            <span className="text-xs font-mono text-slate-400">
              Run ID: {selectedRun?.id || 'N/A'}
            </span>
          </div>

          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-[#0f1422] text-slate-400 border-b border-[#2b3347] text-[11px] uppercase tracking-wider font-semibold">
                <tr>
                  <th className="py-3 px-4">Estrategia</th>
                  <th className="py-3 px-3">Dirección</th>
                  <th className="py-3 px-3">Ratio</th>
                  <th className="py-3 px-3 text-right">Trades</th>
                  <th className="py-3 px-3 text-right">Win Rate</th>
                  <th className="py-3 px-3 text-right">Resultado Neto ($)</th>
                  <th className="py-3 px-3 text-right">Neto R</th>
                  <th className="py-3 px-3 text-right">Expectancy</th>
                  <th className="py-3 px-3 text-right">Max DD</th>
                  <th className="py-3 px-4 text-right">Profit Factor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#2b3347]/50 font-mono">
                {breakdownRows.map((row, idx) => {
                  const m = row.m;
                  const isPositive = m.netPnlR >= 0;
                  const isCombined = row.isHighlight;

                  return (
                    <tr
                      key={idx}
                      className={`hover:bg-[#181c28]/70 transition-colors ${
                        isCombined ? 'bg-[#FF6600]/10 font-bold text-white' : ''
                      }`}
                    >
                      <td className="py-3 px-4 font-sans font-medium text-slate-200">
                        {row.name}
                      </td>
                      <td className="py-3 px-3">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            row.dir === 'LONG'
                              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                              : row.dir === 'SHORT'
                              ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                              : 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                          }`}
                        >
                          {row.dir}
                        </span>
                      </td>
                      <td className="py-3 px-3">
                        <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-[#2b3347]/60 text-slate-300">
                          {row.ratio}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-right">{m.totalTrades}</td>
                      <td className="py-3 px-3 text-right">
                        <span className={m.winRate >= 20 ? 'text-emerald-400' : 'text-slate-300'}>
                          {m.winRate.toFixed(1)}%
                        </span>
                      </td>
                      <td className={`py-3 px-3 text-right ${m.netPnlUsdt >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {m.netPnlUsdt >= 0 ? '+' : ''}{m.netPnlUsdt.toFixed(1)}$
                      </td>
                      <td className={`py-3 px-3 text-right ${isPositive ? 'text-emerald-400 font-bold' : 'text-rose-400'}`}>
                        {m.netPnlR >= 0 ? '+' : ''}{m.netPnlR.toFixed(1)}R
                      </td>
                      <td className={`py-3 px-3 text-right ${m.expectancyR >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {m.expectancyR.toFixed(2)}R
                      </td>
                      <td className="py-3 px-3 text-right text-rose-400">
                        -{m.maxDrawdownPct.toFixed(1)}%
                      </td>
                      <td className="py-3 px-4 text-right">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[11px] ${
                            m.profitFactor >= 1.0
                              ? 'bg-emerald-500/20 text-emerald-300'
                              : 'bg-amber-500/10 text-amber-300'
                          }`}
                        >
                          {m.profitFactor.toFixed(2)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: In-Sample vs Out-of-Sample */}
      {activeTab === 'insample' && selectedRun && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* In-Sample Card */}
          <div className="bg-[#131722] border border-[#2b3347] rounded-xl p-5 shadow-lg">
            <div className="flex items-center justify-between pb-3 border-b border-[#2b3347]">
              <div>
                <span className="px-2 py-0.5 text-xs font-bold rounded bg-blue-500/20 text-blue-400 border border-blue-500/30">
                  Muestra In-Sample (Días 1 - 60)
                </span>
                <h4 className="text-sm font-bold text-white mt-2">
                  Entrenamiento y Calibración Estructural
                </h4>
              </div>
              <Layers className="w-5 h-5 text-blue-400" />
            </div>

            <div className="grid grid-cols-2 gap-3 mt-4 text-xs font-mono">
              <div className="bg-[#181c28] p-3 rounded-lg border border-[#2b3347]/60">
                <span className="text-[10px] text-slate-400 block font-sans">Total Operaciones</span>
                <span className="text-base font-bold text-white mt-1 block">
                  {selectedRun.inSampleMetrics.totalTrades}
                </span>
              </div>
              <div className="bg-[#181c28] p-3 rounded-lg border border-[#2b3347]/60">
                <span className="text-[10px] text-slate-400 block font-sans">Win Rate</span>
                <span className="text-base font-bold text-white mt-1 block">
                  {selectedRun.inSampleMetrics.winRate.toFixed(1)}%
                </span>
              </div>
              <div className="bg-[#181c28] p-3 rounded-lg border border-[#2b3347]/60">
                <span className="text-[10px] text-slate-400 block font-sans">PnL Neto</span>
                <span className={`text-base font-bold mt-1 block ${selectedRun.inSampleMetrics.netPnlR >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {selectedRun.inSampleMetrics.netPnlR >= 0 ? '+' : ''}{selectedRun.inSampleMetrics.netPnlR.toFixed(1)}R (${selectedRun.inSampleMetrics.netPnlUsdt})
                </span>
              </div>
              <div className="bg-[#181c28] p-3 rounded-lg border border-[#2b3347]/60">
                <span className="text-[10px] text-slate-400 block font-sans">Expectancy</span>
                <span className="text-base font-bold text-white mt-1 block">
                  {selectedRun.inSampleMetrics.expectancyR.toFixed(2)}R
                </span>
              </div>
              <div className="bg-[#181c28] p-3 rounded-lg border border-[#2b3347]/60">
                <span className="text-[10px] text-slate-400 block font-sans">Profit Factor</span>
                <span className="text-base font-bold text-white mt-1 block">
                  {selectedRun.inSampleMetrics.profitFactor.toFixed(2)}
                </span>
              </div>
              <div className="bg-[#181c28] p-3 rounded-lg border border-[#2b3347]/60">
                <span className="text-[10px] text-slate-400 block font-sans">Max Drawdown</span>
                <span className="text-base font-bold text-rose-400 mt-1 block">
                  -{selectedRun.inSampleMetrics.maxDrawdownPct.toFixed(1)}%
                </span>
              </div>
            </div>
          </div>

          {/* Out-of-Sample Card */}
          <div className="bg-[#131722] border border-[#2b3347] rounded-xl p-5 shadow-lg">
            <div className="flex items-center justify-between pb-3 border-b border-[#2b3347]">
              <div>
                <span className="px-2 py-0.5 text-xs font-bold rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                  Muestra Out-of-Sample (Días 61 - 90)
                </span>
                <h4 className="text-sm font-bold text-white mt-2">
                  Validación Ciega Independiente (Últimos 30 Días)
                </h4>
              </div>
              <ShieldAlert className="w-5 h-5 text-emerald-400" />
            </div>

            <div className="grid grid-cols-2 gap-3 mt-4 text-xs font-mono">
              <div className="bg-[#181c28] p-3 rounded-lg border border-[#2b3347]/60">
                <span className="text-[10px] text-slate-400 block font-sans">Total Operaciones</span>
                <span className="text-base font-bold text-white mt-1 block">
                  {selectedRun.outSampleMetrics.totalTrades}
                </span>
              </div>
              <div className="bg-[#181c28] p-3 rounded-lg border border-[#2b3347]/60">
                <span className="text-[10px] text-slate-400 block font-sans">Win Rate</span>
                <span className="text-base font-bold text-emerald-400 mt-1 block">
                  {selectedRun.outSampleMetrics.winRate.toFixed(1)}%
                </span>
              </div>
              <div className="bg-[#181c28] p-3 rounded-lg border border-[#2b3347]/60">
                <span className="text-[10px] text-slate-400 block font-sans">PnL Neto</span>
                <span className={`text-base font-bold mt-1 block ${selectedRun.outSampleMetrics.netPnlR >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {selectedRun.outSampleMetrics.netPnlR >= 0 ? '+' : ''}{selectedRun.outSampleMetrics.netPnlR.toFixed(1)}R (${selectedRun.outSampleMetrics.netPnlUsdt})
                </span>
              </div>
              <div className="bg-[#181c28] p-3 rounded-lg border border-[#2b3347]/60">
                <span className="text-[10px] text-slate-400 block font-sans">Expectancy</span>
                <span className="text-base font-bold text-white mt-1 block">
                  {selectedRun.outSampleMetrics.expectancyR.toFixed(2)}R
                </span>
              </div>
              <div className="bg-[#181c28] p-3 rounded-lg border border-[#2b3347]/60">
                <span className="text-[10px] text-slate-400 block font-sans">Profit Factor</span>
                <span className="text-base font-bold text-white mt-1 block">
                  {selectedRun.outSampleMetrics.profitFactor.toFixed(2)}
                </span>
              </div>
              <div className="bg-[#181c28] p-3 rounded-lg border border-[#2b3347]/60">
                <span className="text-[10px] text-slate-400 block font-sans">Max Drawdown</span>
                <span className="text-base font-bold text-rose-400 mt-1 block">
                  -{selectedRun.outSampleMetrics.maxDrawdownPct.toFixed(1)}%
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: Trades Inspector */}
      {activeTab === 'trades' && (
        <div className="bg-[#131722] border border-[#2b3347] rounded-xl overflow-hidden shadow-lg">
          <div className="p-4 border-b border-[#2b3347] flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-white">
                Registro Individual de Operaciones Simuladas ({filteredTrades.length})
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Seguimiento barra a barra con cálculo de MFE, MAE y resolución conservadora.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setTradeFilter('ALL')}
                className={`px-2.5 py-1 text-xs rounded font-medium ${
                  tradeFilter === 'ALL' ? 'bg-[#FF6600] text-white' : 'bg-[#181c28] text-slate-400'
                }`}
              >
                Todas ({trades.length})
              </button>
              <button
                onClick={() => setTradeFilter('TAKE_PROFIT')}
                className={`px-2.5 py-1 text-xs rounded font-medium ${
                  tradeFilter === 'TAKE_PROFIT' ? 'bg-emerald-600 text-white' : 'bg-[#181c28] text-slate-400'
                }`}
              >
                TP Hits ({trades.filter((t) => t.outcome === 'TAKE_PROFIT').length})
              </button>
              <button
                onClick={() => setTradeFilter('STOP_LOSS')}
                className={`px-2.5 py-1 text-xs rounded font-medium ${
                  tradeFilter === 'STOP_LOSS' ? 'bg-rose-600 text-white' : 'bg-[#181c28] text-slate-400'
                }`}
              >
                SL Hits ({trades.filter((t) => t.outcome === 'STOP_LOSS').length})
              </button>
            </div>
          </div>

          <div className="overflow-x-auto custom-scrollbar max-h-[500px]">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-[#0f1422] text-slate-400 sticky top-0 border-b border-[#2b3347] text-[11px] uppercase tracking-wider font-semibold z-10">
                <tr>
                  <th className="py-3 px-4">Fecha Entrada</th>
                  <th className="py-3 px-3">Estrategia</th>
                  <th className="py-3 px-2">Dir</th>
                  <th className="py-3 px-2">Ratio</th>
                  <th className="py-3 px-3 text-right">Entrada</th>
                  <th className="py-3 px-3 text-right">Stop Loss</th>
                  <th className="py-3 px-3 text-right">Take Profit</th>
                  <th className="py-3 px-3 text-right">R:R Esp.</th>
                  <th className="py-3 px-3 text-left">Justificación Estructural</th>
                  <th className="py-3 px-3 text-right">Salida</th>
                  <th className="py-3 px-3 text-center">Resultado</th>
                  <th className="py-3 px-3 text-right">PnL Neto ($)</th>
                  <th className="py-3 px-3 text-right">Neto R</th>
                  <th className="py-3 px-3 text-right">MFE (R)</th>
                  <th className="py-3 px-3 text-right">MAE (R)</th>
                  <th className="py-3 px-4 text-center">Muestra</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#2b3347]/50 font-mono">
                {filteredTrades.map((t) => (
                  <tr key={t.id} className="hover:bg-[#181c28]/70 transition-colors">
                    <td className="py-2.5 px-4 text-slate-400 font-sans text-[11px]">
                      {new Date(t.entryTimestamp).toLocaleString('es-AR', {
                        timeZone: 'America/Argentina/Buenos_Aires',
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="py-2.5 px-3 font-sans text-slate-200">
                      {t.strategy === 'STRATEGY_A_TREND_CONTINUATION' ? 'Strat A (Trend)' : 'Strat B (Sweep)'}
                    </td>
                    <td className="py-2.5 px-2">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          t.direction === 'LONG' ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {t.direction}
                      </span>
                    </td>
                    <td className="py-2.5 px-2 text-slate-400 text-[10px]">
                      {t.ratioTarget === 'RR_1_2' ? '1:2' : '1:4'}
                    </td>
                    <td className="py-2.5 px-3 text-right text-slate-200">${t.entryPrice.toFixed(1)}</td>
                    <td className="py-2.5 px-3 text-right text-rose-400/80">${t.stopLossPrice.toFixed(1)}</td>
                    <td className="py-2.5 px-3 text-right text-emerald-400/80">${t.takeProfitPrice.toFixed(1)}</td>
                    <td className="py-2.5 px-3 text-right text-amber-400 font-bold font-mono text-xs">
                      {t.expectedNetRR ? `+${t.expectedNetRR.toFixed(1)}R` : '-'}
                    </td>
                    <td className="py-2.5 px-3 text-left text-slate-300 font-sans text-[11px] truncate max-w-[200px]" title={t.structuralJustification}>
                      {t.structuralJustification || 'Nivel SMC'}
                    </td>
                    <td className="py-2.5 px-3 text-right text-slate-300">${t.exitPrice.toFixed(1)}</td>
                    <td className="py-2.5 px-3 text-center">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          t.outcome === 'TAKE_PROFIT'
                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                            : t.outcome === 'STOP_LOSS'
                            ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                            : 'bg-slate-500/20 text-slate-400 border border-slate-500/30'
                        }`}
                      >
                        {t.outcome === 'TAKE_PROFIT' ? 'TP HIT' : t.outcome === 'STOP_LOSS' ? 'SL HIT' : 'EXP'}
                      </span>
                    </td>
                    <td className={`py-2.5 px-3 text-right ${t.realizedNetPnlUsdt >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {t.realizedNetPnlUsdt >= 0 ? '+' : ''}{t.realizedNetPnlUsdt.toFixed(1)}$
                    </td>
                    <td className={`py-2.5 px-3 text-right font-bold ${t.realizedNetR >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {t.realizedNetR >= 0 ? '+' : ''}{t.realizedNetR.toFixed(1)}R
                    </td>
                    <td className="py-2.5 px-3 text-right text-slate-400">+{t.mfeR.toFixed(1)}R</td>
                    <td className="py-2.5 px-3 text-right text-slate-400">-{t.maeR.toFixed(1)}R</td>
                    <td className="py-2.5 px-4 text-center">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[9px] font-semibold ${
                          t.isInSample ? 'bg-blue-500/20 text-blue-400' : 'bg-emerald-500/20 text-emerald-400'
                        }`}
                      >
                        {t.isInSample ? 'IN-SAMPLE' : 'OUT-OF-SAMPLE'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
