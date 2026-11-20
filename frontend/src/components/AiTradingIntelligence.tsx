'use client';

import React, { useState, useEffect } from 'react';
import {
  Brain,
  Radar,
  Eye,
  Crosshair,
  TrendingUp,
  TrendingDown,
  Clock,
  Sparkles,
  Layers,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Search,
  Filter,
  DollarSign,
  ChevronRight,
  Activity,
  ArrowRight,
  HelpCircle,
  Zap,
} from 'lucide-react';
import { getApiBaseUrl, getWebSocketLiveUrl } from '../utils/api-config';

interface Scenario {
  id: string;
  symbol: string;
  direction: 'LONG' | 'SHORT';
  timeframe: string;
  structureType: string;
  proposedBy: string;
  modelsUsed: string[];
  snapshotId: string;
  discoveryTimestamp: number;
  entryZoneMin: number;
  entryZoneMax: number;
  targetEntry: number;
  stopLossPrice: number;
  target12Price?: number;
  target14Price?: number;
  netRR12?: number;
  netRR14?: number;
  rrModeAvailable: 'RR_1_2' | 'RR_1_4' | 'RR_BOTH' | 'NONE';
  uncertaintyLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  status: string;
  rejectionReason?: string;
  validUntilTimestamp: number;
  aiCostUsd: number;
  activationConditions: string[];
  invalidationTriggers: string[];
  argumentsFor: string[];
  argumentsAgainst: string[];
  openaiInterpretation?: any;
  geminiInterpretation?: any;
  distanceToZonePct?: number;
  currentPrice?: number;
  lastCheckedTimestamp?: number;
  isSimulated?: boolean;
}

interface MarketIntelligence {
  symbol: string;
  timestamp: number;
  currentPrice: number;
  timeframes: Record<string, any>;
  orderBook: {
    spread: number;
    spreadPcnt: number;
    imbalance: number;
    bestBid: number;
    bestAsk: number;
  };
  marketContext: {
    fundingRate: number;
    openInterest: number;
    volatility24hPct: number;
    high24h: number;
    low24h: number;
  };
  openaiBias?: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  geminiBias?: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  lastDiscoveryTimestamp?: number;
}

interface ScenarioDetail {
  scenario: Scenario;
  lifecycle: any[];
  revalidations: any[];
}

export function AiTradingIntelligence() {
  const [activeTab, setActiveTab] = useState<'scenarios' | 'market_intelligence' | 'watcher_stats' | 'paper_trading'>('scenarios');
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [marketIntel, setMarketIntel] = useState<MarketIntelligence | null>(null);
  const [schedulerStatus, setSchedulerStatus] = useState<any>(null);
  const [configSummary, setConfigSummary] = useState<any>(null);
  const [activeSignals, setActiveSignals] = useState<any[]>([]);
  const [selectedScenarioId, setSelectedScenarioId] = useState<string | null>(null);
  const [scenarioDetail, setScenarioDetail] = useState<ScenarioDetail | null>(null);
  const [filterRR, setFilterRR] = useState<'ALL' | 'RR_BOTH' | 'RR_1_2' | 'RR_1_4'>('ALL');
  const [isLoading, setIsLoading] = useState(false);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [isRevalidating, setIsRevalidating] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const apiBase = getApiBaseUrl();

  const fetchScenarios = async () => {
    try {
      const res = await fetch(`${apiBase}/api/v1/discovery/scenarios`);
      if (res.ok) {
        const data = await res.json();
        setScenarios(data.data || []);
      }
    } catch {}
  };

  const fetchMarketIntel = async () => {
    try {
      const res = await fetch(`${apiBase}/api/v1/discovery/market-intelligence`);
      if (res.ok) {
        const data = await res.json();
        setMarketIntel(data.data || null);
      }
    } catch {}
  };

  const fetchSchedulerStatus = async () => {
    try {
      const res = await fetch(`${apiBase}/api/v1/discovery/scheduler/status`);
      if (res.ok) {
        const data = await res.json();
        setSchedulerStatus(data.data || null);
      }
    } catch {}
  };

  const fetchConfigSummary = async () => {
    try {
      const res = await fetch(`${apiBase}/api/v1/config/summary`);
      if (res.ok) {
        const data = await res.json();
        setConfigSummary(data.data || null);
      }
    } catch {}
  };

  const fetchActiveSignals = async () => {
    try {
      const res = await fetch(`${apiBase}/api/v1/signals/active`);
      if (res.ok) {
        const data = await res.json();
        setActiveSignals(data.data || []);
      }
    } catch {}
  };

  const fetchDetail = async (id: string) => {
    try {
      const res = await fetch(`${apiBase}/api/v1/discovery/scenarios/${id}`);
      if (res.ok) {
        const data = await res.json();
        setScenarioDetail(data.data);
      }
    } catch {}
  };

  useEffect(() => {
    fetchScenarios();
    fetchMarketIntel();
    fetchSchedulerStatus();
    fetchConfigSummary();
    fetchActiveSignals();
    const timer = setInterval(() => {
      fetchScenarios();
      fetchMarketIntel();
      fetchSchedulerStatus();
      fetchConfigSummary();
      fetchActiveSignals();
    }, 15000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (selectedScenarioId) {
      fetchDetail(selectedScenarioId);
    } else {
      setScenarioDetail(null);
    }
  }, [selectedScenarioId]);

  const handleTriggerDiscovery = async () => {
    setIsDiscovering(true);
    setMessage(null);
    try {
      const res = await fetch(`${apiBase}/api/v1/discovery/trigger`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setMessage({
          text: `Descubrimiento IA completado: ${data.scenariosDiscovered} escenarios identificados.`,
          type: 'success',
        });
        fetchScenarios();
        fetchMarketIntel();
      } else {
        setMessage({
          text: data.error || 'No se pudo ejecutar el descubrimiento de IA',
          type: 'error',
        });
      }
    } catch (err: any) {
      setMessage({ text: err.message, type: 'error' });
    } finally {
      setIsDiscovering(false);
    }
  };

  const handleManualRevalidate = async (id: string) => {
    setIsRevalidating(true);
    try {
      const res = await fetch(`${apiBase}/api/v1/discovery/scenarios/${id}/revalidate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setMessage({
          text: `Reevaluación completada: Veredicto ${data.data.consensus}.`,
          type: 'success',
        });
        fetchScenarios();
        if (selectedScenarioId === id) fetchDetail(id);
      } else {
        setMessage({ text: data.error || 'Error al reevaluar escenario', type: 'error' });
      }
    } catch (err: any) {
      setMessage({ text: err.message, type: 'error' });
    } finally {
      setIsRevalidating(false);
    }
  };

  // Filter scenarios
  const filteredScenarios = scenarios.filter((s) => {
    if (filterRR === 'ALL') return true;
    if (filterRR === 'RR_BOTH') return s.rrModeAvailable === 'RR_BOTH';
    if (filterRR === 'RR_1_2') return s.rrModeAvailable === 'RR_1_2' || s.rrModeAvailable === 'RR_BOTH';
    if (filterRR === 'RR_1_4') return s.rrModeAvailable === 'RR_1_4' || s.rrModeAvailable === 'RR_BOTH';
    return true;
  });

  const activeCount = scenarios.filter((s) => !['INVALIDATED', 'EXPIRED', 'CANCELLED'].includes(s.status)).length;
  const inZoneCount = scenarios.filter((s) => s.status === 'IN_ZONE' || s.status === 'REVALIDATION_REQUESTED').length;
  const approachingCount = scenarios.filter((s) => s.status === 'APPROACHING_ZONE').length;
  const validatedCount = scenarios.filter((s) => s.status === 'ENTRY_VALIDATED').length;
  const totalAiCost = scenarios.reduce((acc, s) => acc + (s.aiCostUsd || 0), 0);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'NO_TRADE_OBSERVATION':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-700/60 text-slate-200 border border-slate-500/60">DECISIÓN: ESPERAR (NEUTRAL)</span>;
      case 'APPROACHING_ZONE':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 animate-pulse">APROXIMÁNDOSE (≤0.35%)</span>;
      case 'IN_ZONE':
      case 'REVALIDATION_REQUESTED':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-500/20 text-purple-300 border border-purple-500/40 animate-pulse">EN ZONA · REEVALUANDO</span>;
      case 'ENTRY_VALIDATED':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">ENTRADA VALIDADA</span>;
      case 'SCENARIO_REGISTERED':
      case 'SCENARIO_MONITORING':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-500/15 text-blue-300 border border-blue-500/30">EN VIGILANCIA</span>;
      case 'WAITING_CONFIRMATION':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30">ESPERANDO CONFIRMACIÓN</span>;
      case 'INVALIDATED':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/15 text-rose-400 border border-rose-500/30">INVALIDADO (SL TOCADO)</span>;
      case 'EXPIRED':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-700/40 text-slate-400 border border-slate-700">CADUCADO (TIEMPO)</span>;
      case 'CANCELLED':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/15 text-rose-300 border border-rose-500/20">CANCELADO</span>;
      default:
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-300">{status}</span>;
    }
  };

  return (
    <div className="rounded-2xl border border-slate-800 bg-[#0f1422] p-4 sm:p-5 shadow-2xl space-y-4">
      {/* Top Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-3 border-b border-slate-800/80">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-orange-500 to-amber-500 flex items-center justify-center text-white shadow-lg shadow-orange-500/20">
            <Brain className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-display font-extrabold text-base text-slate-100 tracking-wide uppercase">
                AI Trading Intelligence
              </h2>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-orange-500/15 text-orange-400 border border-orange-500/30">
                FASE 5C
              </span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                SIGNALS_ONLY
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Descubrimiento autónomo de escenarios multitemporales por OpenAI & Gemini con vigilancia algorítmica continua, objetivos 1:2 / 1:4 y paper trading 24/7.
            </p>
          </div>
        </div>

        {/* Action Controls & AI Biases */}
        <div className="flex items-center flex-wrap gap-2.5">
          {marketIntel?.openaiBias && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-slate-900 border border-slate-800 text-[11px] font-mono">
              <span className="text-slate-500">OpenAI:</span>
              <span className={`font-bold ${marketIntel.openaiBias === 'BULLISH' ? 'text-emerald-400' : marketIntel.openaiBias === 'BEARISH' ? 'text-rose-400' : 'text-amber-400'}`}>
                {marketIntel.openaiBias}
              </span>
            </div>
          )}

          {marketIntel?.geminiBias && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-slate-900 border border-slate-800 text-[11px] font-mono">
              <span className="text-slate-500">Gemini:</span>
              <span className={`font-bold ${marketIntel.geminiBias === 'BULLISH' ? 'text-emerald-400' : marketIntel.geminiBias === 'BEARISH' ? 'text-rose-400' : 'text-amber-400'}`}>
                {marketIntel.geminiBias}
              </span>
            </div>
          )}

          <button
            onClick={handleTriggerDiscovery}
            disabled={isDiscovering}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-500 hover:to-amber-500 text-white font-bold text-xs shadow-md shadow-orange-600/20 transition-all cursor-pointer disabled:opacity-50"
            title="Analiza el panorama actual y descubre hipótesis de trading"
          >
            <Sparkles className={`w-3.5 h-3.5 ${isDiscovering ? 'animate-spin' : ''}`} />
            {isDiscovering ? 'Analizando...' : 'Ejecutar Descubrimiento IA'}
          </button>
        </div>
      </div>

      {/* Provider & Scheduler Live Status Banner */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 text-xs font-mono">
        <div className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800 flex items-center justify-between">
          <span className="text-slate-400">OpenAI Provider:</span>
          {configSummary?.openaiConfigured ? (
            <span className="text-emerald-400 font-bold flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> CONECTADO</span>
          ) : (
            <span className="text-amber-400/90 font-bold flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> PENDIENTE</span>
          )}
        </div>
        <div className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800 flex items-center justify-between">
          <span className="text-slate-400">Gemini Provider:</span>
          {configSummary?.geminiConfigured ? (
            <span className="text-emerald-400 font-bold flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> CONECTADO</span>
          ) : (
            <span className="text-amber-400/90 font-bold flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> PENDIENTE</span>
          )}
        </div>
        <div className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800 flex items-center justify-between">
          <span className="text-slate-400">Scheduler Autónomo:</span>
          {schedulerStatus?.isRunning ? (
            <span className="text-emerald-400 font-bold flex items-center gap-1"><Activity className="w-3.5 h-3.5 text-emerald-400 animate-pulse" /> ACTIVO</span>
          ) : (
            <span className="text-slate-400 font-bold">EN ESPERA</span>
          )}
        </div>
        <div className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800 flex items-center justify-between">
          <span className="text-slate-400">Presupuesto Hoy:</span>
          <span className="text-slate-200 font-bold">
            ${configSummary?.spentTodayUsd !== undefined ? Number(configSummary.spentTodayUsd).toFixed(3) : '0.000'} / ${configSummary?.dailyBudgetUsd || '5.00'}
          </span>
        </div>
      </div>

      {/* Notification / Alert banner */}
      {message && (
        <div
          className={`p-3 rounded-xl text-xs flex items-center justify-between ${
            message.type === 'success'
              ? 'bg-emerald-950/40 text-emerald-300 border border-emerald-500/40'
              : 'bg-rose-950/40 text-rose-300 border border-rose-500/40'
          }`}
        >
          <span>{message.text}</span>
          <button onClick={() => setMessage(null)} className="text-slate-400 hover:text-white ml-2">
            ✕
          </button>
        </div>
      )}

      {/* Metrics Ribbon */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
        <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800">
          <p className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">Escenarios Activos</p>
          <p className="text-xl font-mono font-extrabold text-slate-100 mt-0.5">{activeCount}</p>
          <p className="text-[10px] text-slate-500 font-mono mt-0.5">En vigilancia 24/7</p>
        </div>

        <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800">
          <p className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">Próximos a Zona</p>
          <p className="text-xl font-mono font-extrabold text-amber-400 mt-0.5">{approachingCount}</p>
          <p className="text-[10px] text-amber-500/80 font-mono mt-0.5">Distancia ≤ 0.35%</p>
        </div>

        <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800">
          <p className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">En Zona / Reevaluando</p>
          <p className="text-xl font-mono font-extrabold text-purple-400 mt-0.5">{inZoneCount}</p>
          <p className="text-[10px] text-purple-400/80 font-mono mt-0.5">Consulta de IA en curso</p>
        </div>

        <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800">
          <p className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">Entradas Validadas</p>
          <p className="text-xl font-mono font-extrabold text-emerald-400 mt-0.5">{validatedCount}</p>
          <p className="text-[10px] text-emerald-500/80 font-mono mt-0.5">Consenso aprobado</p>
        </div>

        <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800">
          <p className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">Gasto Total IA</p>
          <p className="text-xl font-mono font-extrabold text-slate-200 mt-0.5">${totalAiCost.toFixed(4)}</p>
          <p className="text-[10px] text-slate-500 font-mono mt-0.5">Descubrimiento + Reval.</p>
        </div>

        <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800">
          <p className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">Algorithmic Watcher</p>
          <div className="flex items-center gap-1.5 mt-1">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
            <span className="text-xs font-mono font-bold text-emerald-400">ACTIVO</span>
          </div>
          <p className="text-[10px] text-slate-500 font-mono mt-0.5">0 tokens consumidos/tick</p>
        </div>
      </div>

      {/* Tabs Navigation */}
      <div className="flex items-center justify-between flex-wrap gap-2 pt-2 border-b border-slate-800/80">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setActiveTab('scenarios')}
            className={`px-3 py-1.5 rounded-t-lg text-xs font-mono font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'scenarios'
                ? 'bg-slate-800 text-orange-400 border-t-2 border-orange-500'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/40'
            }`}
          >
            <Crosshair className="w-3.5 h-3.5" />
            Escenarios Detectados ({scenarios.length})
          </button>

          <button
            onClick={() => setActiveTab('market_intelligence')}
            className={`px-3 py-1.5 rounded-t-lg text-xs font-mono font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'market_intelligence'
                ? 'bg-slate-800 text-orange-400 border-t-2 border-orange-500'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/40'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            Panorama Multitemporal (6TF)
          </button>

          <button
            onClick={() => setActiveTab('watcher_stats')}
            className={`px-3 py-1.5 rounded-t-lg text-xs font-mono font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'watcher_stats'
                ? 'bg-slate-800 text-orange-400 border-t-2 border-orange-500'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/40'
            }`}
          >
            <Radar className="w-3.5 h-3.5" />
            Monitor Algorítmico 24/7
          </button>

          <button
            onClick={() => setActiveTab('paper_trading')}
            className={`px-3 py-1.5 rounded-t-lg text-xs font-mono font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'paper_trading'
                ? 'bg-slate-800 text-orange-400 border-t-2 border-orange-500'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/40'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            Paper Trading ({activeSignals.length})
          </button>
        </div>

        {/* Filter by R:R Mode in Scenarios tab */}
        {activeTab === 'scenarios' && (
          <div className="flex items-center gap-1.5 pb-1.5">
            <span className="text-[11px] text-slate-500 font-mono">Modo R:R:</span>
            <button
              onClick={() => setFilterRR('ALL')}
              className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                filterRR === 'ALL' ? 'bg-orange-500 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
              }`}
            >
              TODOS
            </button>
            <button
              onClick={() => setFilterRR('RR_BOTH')}
              className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                filterRR === 'RR_BOTH' ? 'bg-purple-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
              }`}
            >
              1:2 Y 1:4 (AMBOS)
            </button>
            <button
              onClick={() => setFilterRR('RR_1_2')}
              className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                filterRR === 'RR_1_2' ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
              }`}
            >
              1:2 CORTO
            </button>
            <button
              onClick={() => setFilterRR('RR_1_4')}
              className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                filterRR === 'RR_1_4' ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
              }`}
            >
              1:4 EXTENDIDO
            </button>
          </div>
        )}
      </div>

      {/* TAB 1: SCENARIOS TABLE */}
      {activeTab === 'scenarios' && (
        <div className="space-y-4">
          {filteredScenarios.length > 0 ? (
            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full text-left font-mono text-xs min-w-[950px]">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-500 text-[11px]">
                    <th className="pb-2">ID / Hora</th>
                    <th className="pb-2">Dirección</th>
                    <th className="pb-2">Zona Operativa</th>
                    <th className="pb-2">Stop Loss</th>
                    <th className="pb-2">Target 1:2</th>
                    <th className="pb-2">Target 1:4</th>
                    <th className="pb-2">Distancia</th>
                    <th className="pb-2">Estado</th>
                    <th className="pb-2">Modelos / Costo</th>
                    <th className="pb-2 text-right">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/50">
                  {filteredScenarios.map((sc) => {
                    const isLong = sc.direction === 'LONG';
                    const isSelected = selectedScenarioId === sc.id;
                    return (
                      <tr
                        key={sc.id}
                        className={`hover:bg-slate-900/60 transition-colors ${
                          isSelected ? 'bg-slate-900/80 border-l-2 border-orange-500' : ''
                        }`}
                      >
                        <td className="py-2.5 text-slate-300">
                          <div className="font-bold">{sc.id}</div>
                          <div className="text-[10px] text-slate-500">
                            {new Date(sc.discoveryTimestamp).toLocaleTimeString('es-AR')}
                          </div>
                        </td>
                        <td className="py-2.5">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              isLong ? 'bg-emerald-500/15 text-emerald-400' : 'bg-rose-500/15 text-rose-400'
                            }`}
                          >
                            {sc.direction} · {sc.timeframe}
                          </span>
                        </td>
                        <td className="py-2.5 text-slate-200 font-semibold">
                          ${sc.entryZoneMin.toFixed(1)} - ${sc.entryZoneMax.toFixed(1)}
                        </td>
                        <td className="py-2.5 text-rose-400 font-semibold">
                          ${sc.stopLossPrice.toFixed(1)}
                        </td>
                        <td className="py-2.5">
                          {sc.target12Price ? (
                            <div>
                              <span className="text-blue-300 font-bold">${sc.target12Price.toFixed(1)}</span>
                              <span className="text-[10px] text-blue-400/80 ml-1">({sc.netRR12}R)</span>
                            </div>
                          ) : (
                            <span className="text-slate-600">---</span>
                          )}
                        </td>
                        <td className="py-2.5">
                          {sc.target14Price ? (
                            <div>
                              <span className="text-emerald-300 font-bold">${sc.target14Price.toFixed(1)}</span>
                              <span className="text-[10px] text-emerald-400/80 ml-1">({sc.netRR14}R)</span>
                            </div>
                          ) : (
                            <span className="text-slate-600">---</span>
                          )}
                        </td>
                        <td className="py-2.5">
                          <div className="flex items-center gap-1.5">
                            <div className="w-16 bg-slate-800 h-1.5 rounded-full overflow-hidden">
                              <div
                                className={`h-full ${
                                  (sc.distanceToZonePct || 0) <= 0.35 ? 'bg-amber-400' : 'bg-blue-400'
                                }`}
                                style={{ width: `${Math.min(100, Math.max(5, 100 - (sc.distanceToZonePct || 0) * 20))}%` }}
                              />
                            </div>
                            <span className="text-[11px] text-slate-300">
                              {sc.distanceToZonePct !== undefined ? `${sc.distanceToZonePct.toFixed(2)}%` : '---'}
                            </span>
                          </div>
                        </td>
                        <td className="py-2.5">{getStatusBadge(sc.status)}</td>
                        <td className="py-2.5 text-[11px] text-slate-400">
                          <div>{sc.modelsUsed.join(', ')}</div>
                          <div className="text-[10px] text-slate-500">${(sc.aiCostUsd || 0).toFixed(4)} USD</div>
                        </td>
                        <td className="py-2.5 text-right">
                          <button
                            onClick={() => setSelectedScenarioId(isSelected ? null : sc.id)}
                            className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-orange-400 hover:text-orange-300 font-bold text-xs transition-colors cursor-pointer"
                          >
                            {isSelected ? 'Cerrar' : 'Ver Detalle'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="py-10 px-4 rounded-xl border border-slate-800/80 bg-slate-900/30 text-center space-y-2">
              <Radar className="w-8 h-8 text-slate-600 mx-auto" />
              <p className="text-sm font-semibold text-slate-300">
                Sin escenarios registrados en este momento
              </p>
              <p className="text-xs text-slate-500 font-mono max-w-lg mx-auto">
                Las IA monitorean el mercado por eventos. Podés pulsar <strong>"Ejecutar Descubrimiento IA"</strong> para solicitar una auditoría multitemporal inmediata sobre el snapshot actual.
              </p>
            </div>
          )}

          {/* Detailed Scenario Modal/Drawer */}
          {scenarioDetail && (
            <div className="p-4 rounded-xl border border-orange-500/30 bg-slate-900/90 shadow-2xl space-y-4">
              <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <Eye className="w-4 h-4 text-orange-400" />
                  <h3 className="font-display font-bold text-sm text-slate-200">
                    Detalle del Escenario: <span className="font-mono text-orange-400">{scenarioDetail.scenario.id}</span>
                  </h3>
                  {getStatusBadge(scenarioDetail.scenario.status)}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleManualRevalidate(scenarioDetail.scenario.id)}
                    disabled={isRevalidating}
                    className="px-2.5 py-1 rounded bg-purple-600/30 hover:bg-purple-600/50 text-purple-300 border border-purple-500/40 font-bold text-xs transition-colors cursor-pointer"
                  >
                    {isRevalidating ? 'Reevaluando...' : 'Reevaluar Ahora'}
                  </button>
                  <button
                    onClick={() => setSelectedScenarioId(null)}
                    className="text-slate-400 hover:text-white px-2 py-1 text-xs"
                  >
                    ✕ Cerrar
                  </button>
                </div>
              </div>

              {/* Rationale & Hypotheses */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs font-mono">
                <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800/80 space-y-1.5">
                  <p className="text-slate-400 font-bold uppercase text-[10px]">Condiciones de Activación</p>
                  <ul className="list-disc list-inside text-slate-300 space-y-0.5">
                    {scenarioDetail.scenario.activationConditions?.map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ul>
                </div>

                <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800/80 space-y-1.5">
                  <p className="text-rose-400 font-bold uppercase text-[10px]">Triggers de Invalidación</p>
                  <ul className="list-disc list-inside text-rose-300 space-y-0.5">
                    {scenarioDetail.scenario.invalidationTriggers?.map((inv, i) => (
                      <li key={i}>{inv}</li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Dual Interpretation Comparison */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800/80 space-y-1">
                  <div className="flex items-center justify-between text-[11px] font-mono mb-1">
                    <span className="font-bold text-emerald-400">Interpretación OpenAI</span>
                    <span className="text-slate-500">{scenarioDetail.scenario.openaiInterpretation?.model || 'gpt-4o'}</span>
                  </div>
                  <p className="text-slate-300 text-xs">
                    {scenarioDetail.scenario.openaiInterpretation?.reasoning || 'Sin reporte individual registrado'}
                  </p>
                </div>

                <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800/80 space-y-1">
                  <div className="flex items-center justify-between text-[11px] font-mono mb-1">
                    <span className="font-bold text-blue-400">Interpretación Gemini</span>
                    <span className="text-slate-500">{scenarioDetail.scenario.geminiInterpretation?.model || 'gemini-2.0-flash'}</span>
                  </div>
                  <p className="text-slate-300 text-xs">
                    {scenarioDetail.scenario.geminiInterpretation?.reasoning || 'Sin reporte individual registrado'}
                  </p>
                </div>
              </div>

              {/* Lifecycle & Revalidations History */}
              <div className="space-y-2 pt-2 border-t border-slate-800">
                <p className="text-xs font-mono font-bold text-slate-400 uppercase">
                  Línea Temporal de Ciclo de Vida ({scenarioDetail.lifecycle.length} eventos)
                </p>
                <div className="flex items-center flex-wrap gap-2 text-xs font-mono">
                  {scenarioDetail.lifecycle.map((ev, i) => (
                    <div key={i} className="flex items-center gap-1.5 bg-slate-950 px-2 py-1 rounded border border-slate-800">
                      <span className="text-slate-500 text-[10px]">{new Date(ev.timestamp).toLocaleTimeString('es-AR')}</span>
                      <span className="text-slate-400">{ev.fromStatus}</span>
                      <ArrowRight className="w-3 h-3 text-slate-600" />
                      <span className="text-orange-400 font-bold">{ev.toStatus}</span>
                      {ev.reason && <span className="text-[10px] text-slate-500">({ev.reason})</span>}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: MARKET INTELLIGENCE MULTI-TIMEFRAME */}
      {activeTab === 'market_intelligence' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {marketIntel?.timeframes &&
              Object.entries(marketIntel.timeframes).map(([tf, data]: [string, any]) => (
                <div key={tf} className="p-3.5 rounded-xl bg-slate-900/70 border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-extrabold text-sm text-slate-100">{tf.toUpperCase()}</span>
                    <span
                      className={`px-1.5 py-0.2 rounded text-[10px] font-mono font-bold ${
                        data.trend === 'BULLISH'
                          ? 'bg-emerald-500/20 text-emerald-400'
                          : data.trend === 'BEARISH'
                          ? 'bg-rose-500/20 text-rose-400'
                          : 'bg-slate-700 text-slate-300'
                      }`}
                    >
                      {data.trend}
                    </span>
                  </div>

                  <div className="text-xs font-mono space-y-1 text-slate-400">
                    <div className="flex justify-between">
                      <span>RSI (14):</span>
                      <span className="text-slate-200 font-bold">{data.rsi}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>ATR:</span>
                      <span className="text-slate-200">${data.atr}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>EMA 20/50:</span>
                      <span className="text-slate-200">{data.ema20 || '---'} / {data.ema50 || '---'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>EMA 200:</span>
                      <span className="text-slate-200">{data.ema200 || '---'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>FVGs / OBs:</span>
                      <span className="text-amber-400 font-bold">{data.activeFvgs} / {data.activeObs}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>BOS / CHoCH:</span>
                      <span className="text-purple-400 font-bold">{data.bosCount} / {data.chochCount}</span>
                    </div>
                  </div>
                </div>
              ))}
          </div>

          <div className="p-3.5 rounded-xl bg-slate-900/40 border border-slate-800/80 flex items-center justify-between text-xs font-mono text-slate-400">
            <span>Última captura cuantitativa: {marketIntel ? new Date(marketIntel.timestamp).toLocaleTimeString('es-AR') : '---'}</span>
            <span>Funding Rate: {marketIntel ? (marketIntel.marketContext.fundingRate * 100).toFixed(4) : '---'}%</span>
            <span>Open Interest: {marketIntel ? `${marketIntel.marketContext.openInterest} BTC` : '---'}</span>
            <span>Spread L2: {marketIntel ? `${marketIntel.orderBook.spreadPcnt.toFixed(4)}%` : '---'}</span>
          </div>
        </div>
      )}

      {/* TAB 3: ALGORITHMIC WATCHER 24/7 */}
      {activeTab === 'watcher_stats' && (
        <div className="space-y-4">
          <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-3">
            <div className="flex items-center gap-2">
              <Radar className="w-5 h-5 text-emerald-400" />
              <h4 className="font-display font-bold text-sm text-slate-200 uppercase">
                Arquitectura del Vigilante Algorítmico 24/7
              </h4>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              El <strong>Algorithmic Watcher</strong> opera permanentemente en background desacoplado del frontend. Monitorea cada tick del WebSocket y cada cierre de vela <strong>sin consumir tokens de IA</strong> hasta que se cumplen las condiciones precisas:
            </p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2 text-xs font-mono">
              <div className="p-3 rounded-lg bg-slate-950 border border-slate-800/80 space-y-1">
                <span className="text-amber-400 font-bold">1. APROXIMACIÓN (≤ 0.35%)</span>
                <p className="text-slate-400 text-[11px]">
                  Alerta temprana sin coste de inferencia. Prepara el sistema y notifica al usuario vía Telegram/Push.
                </p>
              </div>

              <div className="p-3 rounded-lg bg-slate-950 border border-slate-800/80 space-y-1">
                <span className="text-purple-400 font-bold">2. MITIGACIÓN EN ZONA</span>
                <p className="text-slate-400 text-[11px]">
                  Dispara la solicitud de reevaluación. Consulta a OpenAI y Gemini con el snapshot actual y el escenario original.
                </p>
              </div>

              <div className="p-3 rounded-lg bg-slate-950 border border-slate-800/80 space-y-1">
                <span className="text-rose-400 font-bold">3. INVALIDACIÓN DETERMINISTA</span>
                <p className="text-slate-400 text-[11px]">
                  Si el precio vulnera el Stop Loss o nivel estructural antes de mitigar, cancela inmediatamente la hipótesis.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: PAPER TRADING PROSPECTIVO */}
      {activeTab === 'paper_trading' && (
        <div className="space-y-4">
          <div className="p-3.5 rounded-xl bg-slate-900/70 border border-slate-800 flex items-center justify-between">
            <div>
              <h4 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                Seguimiento Prospectivo de Papel (Paper Trading 24/7)
              </h4>
              <p className="text-xs text-slate-400 mt-0.5">
                Las hipótesis validadas por IA en zona inician seguimiento en vivo con saldo virtual de referencia ($100 USDT de riesgo). Modo SIGNALS_ONLY. Cero órdenes reales en Bybit.
              </p>
            </div>
            <button
              onClick={fetchActiveSignals}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
              title="Actualizar posiciones"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>

          {activeSignals.length === 0 ? (
            <div className="p-8 text-center text-slate-500 font-mono text-xs border border-dashed border-slate-800 rounded-xl bg-slate-950/40">
              No hay posiciones activas en seguimiento en este momento. Las posiciones se inician automáticamente al validar una hipótesis en zona.
            </div>
          ) : (
            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full text-left text-xs font-mono text-slate-300">
                <thead className="bg-[#0b0e17] text-slate-400 text-[11px] uppercase tracking-wider border-b border-slate-800">
                  <tr>
                    <th className="py-2.5 px-3">ID Señal</th>
                    <th className="py-2.5 px-2">Dir</th>
                    <th className="py-2.5 px-3 text-right">Entrada</th>
                    <th className="py-2.5 px-3 text-right">Stop Loss</th>
                    <th className="py-2.5 px-3 text-right">Take Profit</th>
                    <th className="py-2.5 px-3 text-right">R:R Neto</th>
                    <th className="py-2.5 px-3 text-right">MFE (R)</th>
                    <th className="py-2.5 px-3 text-right">MAE (R)</th>
                    <th className="py-2.5 px-3 text-center">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {activeSignals.map((sig: any) => (
                    <tr key={sig.id} className="hover:bg-slate-900/60 transition-colors">
                      <td className="py-2.5 px-3 text-slate-300 font-sans text-xs">{sig.id}</td>
                      <td className="py-2.5 px-2">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${sig.direction === 'LONG' ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {sig.direction}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right text-slate-100">${sig.entryPrice?.toFixed(1)}</td>
                      <td className="py-2.5 px-3 text-right text-rose-400/80">${sig.stopLossPrice?.toFixed(1)}</td>
                      <td className="py-2.5 px-3 text-right text-emerald-400/80">${sig.takeProfitPrice?.toFixed(1)}</td>
                      <td className="py-2.5 px-3 text-right text-amber-400 font-bold">+{sig.netRR?.toFixed(2)}R</td>
                      <td className="py-2.5 px-3 text-right text-slate-300">+{sig.mfeR?.toFixed(2)}R</td>
                      <td className="py-2.5 px-3 text-right text-slate-400">-{sig.maeR?.toFixed(2)}R</td>
                      <td className="py-2.5 px-3 text-center">
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-500/20 text-purple-300 border border-purple-500/40">
                          {sig.state}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
