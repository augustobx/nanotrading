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
import { getApiBaseUrl, getWebSocketLiveUrl, getAdminMutationHeaders } from '../utils/api-config';

export interface ObservableLevel {
  price: number;
  timeframe: string;
  levelType: string;
  evidence: string;
  sourceTimestamp?: number;
  distancePct: number;
  relevanceToHorizon: 'HIGH' | 'MEDIUM' | 'LOW' | 'INCOMPATIBLE';
  isVerified: boolean;
}

interface Scenario {
  id: string;
  symbol: string;
  direction: 'LONG' | 'SHORT' | 'NEUTRAL';
  kind?: 'TRADE_SCENARIO' | 'NEUTRAL_OBSERVATION';
  triggerSource?: 'AUTOMATIC_SCHEDULER' | 'MANUAL_TRIGGER' | 'NEUTRAL_BREAKOUT' | 'HISTORIC_REPLAY';
  verifiedLevels?: ObservableLevel[];
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
  watchPlan?: any;
  aiMarketThesis?: string;
  horizon?: string;
  missingConditions?: string[];
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
  const [allSignals, setAllSignals] = useState<any[]>([]);
  const [paperTab, setPaperTab] = useState<'ACTIVE' | 'CLOSED'>('ACTIVE');
  const [selectedScenarioId, setSelectedScenarioId] = useState<string | null>(null);
  const [scenarioDetail, setScenarioDetail] = useState<ScenarioDetail | null>(null);
  const [filterRR, setFilterRR] = useState<'ALL' | 'RR_BOTH' | 'RR_1_2' | 'RR_1_4'>('ALL');
  const [filterKind, setFilterKind] = useState<'ALL' | 'TRADE_SCENARIO' | 'NEUTRAL_OBSERVATION' | 'COMPLETED' | 'INACTIVE'>('ALL');
  const [showCostAudit, setShowCostAudit] = useState(false);
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
    } catch { }
  };

  const fetchMarketIntel = async () => {
    try {
      const res = await fetch(`${apiBase}/api/v1/discovery/market-intelligence`);
      if (res.ok) {
        const data = await res.json();
        setMarketIntel(data.data || null);
      }
    } catch { }
  };

  const fetchSchedulerStatus = async () => {
    try {
      const res = await fetch(`${apiBase}/api/v1/discovery/scheduler/status`);
      if (res.ok) {
        const data = await res.json();
        setSchedulerStatus(data.data || null);
      }
    } catch { }
  };

  const fetchConfigSummary = async () => {
    try {
      const res = await fetch(`${apiBase}/api/v1/config/summary`);
      if (res.ok) {
        const data = await res.json();
        setConfigSummary(data.data || null);
      }
    } catch { }
  };

  const fetchActiveSignals = async () => {
    try {
      const [resActive, resAll] = await Promise.all([
        fetch(`${apiBase}/api/v1/signals/active`),
        fetch(`${apiBase}/api/v1/signals?limit=50`),
      ]);
      if (resActive.ok) {
        const data = await resActive.json();
        setActiveSignals(data.data || []);
      }
      if (resAll.ok) {
        const dataAll = await resAll.json();
        setAllSignals(dataAll.data || []);
      }
    } catch { }
  };

  const fetchDetail = async (id: string) => {
    try {
      const res = await fetch(`${apiBase}/api/v1/discovery/scenarios/${id}`);
      if (res.ok) {
        const data = await res.json();
        setScenarioDetail(data.data);
      }
    } catch { }
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
        headers: await getAdminMutationHeaders(),
        credentials: 'include',
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
        headers: await getAdminMutationHeaders(),
        credentials: 'include',
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
    const isNeutral = s.kind === 'NEUTRAL_OBSERVATION' || s.direction === 'NEUTRAL';
    const isCompleted = s.status === 'COMPLETED';
    const isInactive = ['INVALIDATED', 'EXPIRED', 'CANCELLED'].includes(s.status);

    if (filterKind === 'TRADE_SCENARIO') {
      if (isNeutral || isCompleted || isInactive) return false;
    } else if (filterKind === 'NEUTRAL_OBSERVATION') {
      if (!isNeutral || isCompleted || isInactive) return false;
    } else if (filterKind === 'COMPLETED') {
      if (!isCompleted) return false;
    } else if (filterKind === 'INACTIVE') {
      if (!isInactive) return false;
    }

    if (filterRR === 'ALL') return true;
    if (filterRR === 'RR_BOTH') return s.rrModeAvailable === 'RR_BOTH';
    if (filterRR === 'RR_1_2') return s.rrModeAvailable === 'RR_1_2' || s.rrModeAvailable === 'RR_BOTH';
    if (filterRR === 'RR_1_4') return s.rrModeAvailable === 'RR_1_4' || s.rrModeAvailable === 'RR_BOTH';
    return true;
  });

  const activeCount = scenarios.filter((s) => !['INVALIDATED', 'EXPIRED', 'CANCELLED', 'COMPLETED'].includes(s.status)).length;
  const inZoneCount = scenarios.filter((s) => s.status === 'IN_ZONE' || s.status === 'REVALIDATION_REQUESTED').length;
  const approachingCount = scenarios.filter((s) => s.status === 'APPROACHING_ZONE').length;
  const validatedCount = scenarios.filter((s) => s.status === 'ENTRY_VALIDATED').length;
  const totalAiCost = scenarios.reduce((acc, s) => acc + (s.aiCostUsd || 0), 0);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'NO_TRADE_OBSERVATION':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-700/60 text-slate-200 border border-slate-500/60">OBSERVACIÓN: ESPERAR (NEUTRAL)</span>;
      case 'COMPLETED':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">COMPLETADO · RUPTURA CONFIRMADA</span>;
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
          className={`p-3 rounded-xl text-xs flex items-center justify-between ${message.type === 'success'
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
            className={`px-3 py-1.5 rounded-t-lg text-xs font-mono font-bold transition-all cursor-pointer flex items-center gap-1.5 ${activeTab === 'scenarios'
              ? 'bg-slate-800 text-orange-400 border-t-2 border-orange-500'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/40'
              }`}
          >
            <Crosshair className="w-3.5 h-3.5" />
            Escenarios Detectados ({scenarios.length})
          </button>

          <button
            onClick={() => setActiveTab('market_intelligence')}
            className={`px-3 py-1.5 rounded-t-lg text-xs font-mono font-bold transition-all cursor-pointer flex items-center gap-1.5 ${activeTab === 'market_intelligence'
              ? 'bg-slate-800 text-orange-400 border-t-2 border-orange-500'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/40'
              }`}
          >
            <Layers className="w-3.5 h-3.5" />
            Panorama Multitemporal (6TF)
          </button>

          <button
            onClick={() => setActiveTab('watcher_stats')}
            className={`px-3 py-1.5 rounded-t-lg text-xs font-mono font-bold transition-all cursor-pointer flex items-center gap-1.5 ${activeTab === 'watcher_stats'
              ? 'bg-slate-800 text-orange-400 border-t-2 border-orange-500'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/40'
              }`}
          >
            <Radar className="w-3.5 h-3.5" />
            Monitor Algorítmico 24/7
          </button>

          <button
            onClick={() => setActiveTab('paper_trading')}
            className={`px-3 py-1.5 rounded-t-lg text-xs font-mono font-bold transition-all cursor-pointer flex items-center gap-1.5 ${activeTab === 'paper_trading'
              ? 'bg-slate-800 text-orange-400 border-t-2 border-orange-500'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/40'
              }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            Paper Trading ({activeSignals.length})
          </button>
        </div>

        {/* Filter by Kind and R:R Mode in Scenarios tab */}
        {activeTab === 'scenarios' && (
          <div className="space-y-1.5 pb-1.5">
            <div className="flex items-center flex-wrap gap-2.5">
              <div className="flex items-center gap-1">
                <span className="text-[11px] text-slate-500 font-mono">Filtro:</span>
                <button
                  onClick={() => setFilterKind('ALL')}
                  className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${filterKind === 'ALL' ? 'bg-orange-500 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                    }`}
                >
                  TODOS ({scenarios.length})
                </button>
                <button
                  onClick={() => setFilterKind('TRADE_SCENARIO')}
                  className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${filterKind === 'TRADE_SCENARIO' ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                    }`}
                >
                  TRADES ({scenarios.filter((s) => s.kind !== 'NEUTRAL_OBSERVATION' && s.direction !== 'NEUTRAL' && !['COMPLETED', 'INVALIDATED', 'EXPIRED', 'CANCELLED'].includes(s.status)).length})
                </button>
                <button
                  onClick={() => setFilterKind('NEUTRAL_OBSERVATION')}
                  className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${filterKind === 'NEUTRAL_OBSERVATION' ? 'bg-amber-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                    }`}
                >
                  OBSERVACIONES ({scenarios.filter((s) => (s.kind === 'NEUTRAL_OBSERVATION' || s.direction === 'NEUTRAL') && !['COMPLETED', 'INVALIDATED', 'EXPIRED', 'CANCELLED'].includes(s.status)).length})
                </button>
                <button
                  onClick={() => setFilterKind('COMPLETED')}
                  className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${filterKind === 'COMPLETED' ? 'bg-cyan-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                    }`}
                >
                  COMPLETADOS ({scenarios.filter((s) => s.status === 'COMPLETED').length})
                </button>
                <button
                  onClick={() => setFilterKind('INACTIVE')}
                  className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${filterKind === 'INACTIVE' ? 'bg-rose-800 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                    }`}
                >
                  INVALIDADOS ({scenarios.filter((s) => ['INVALIDATED', 'EXPIRED', 'CANCELLED'].includes(s.status)).length})
                </button>
              </div>

              <div className="h-3.5 w-px bg-slate-800" />

              <div className="flex items-center gap-1">
                <span className="text-[11px] text-slate-500 font-mono">Modo R:R:</span>
                <button
                  onClick={() => setFilterRR('ALL')}
                  className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${filterRR === 'ALL' ? 'bg-orange-500 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                    }`}
                >
                  TODOS
                </button>
                <button
                  onClick={() => setFilterRR('RR_BOTH')}
                  className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${filterRR === 'RR_BOTH' ? 'bg-purple-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                    }`}
                >
                  1:2 Y 1:4
                </button>
                <button
                  onClick={() => setFilterRR('RR_1_2')}
                  className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${filterRR === 'RR_1_2' ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                    }`}
                >
                  1:2
                </button>
                <button
                  onClick={() => setFilterRR('RR_1_4')}
                  className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${filterRR === 'RR_1_4' ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                    }`}
                >
                  1:4
                </button>
              </div>

              <div className="h-3.5 w-px bg-slate-800" />

              <button
                onClick={() => setShowCostAudit(!showCostAudit)}
                className={`px-2.5 py-0.5 rounded text-[10px] font-mono font-bold flex items-center gap-1 ${showCostAudit
                  ? 'bg-purple-600 text-white'
                  : 'bg-slate-900 border border-purple-500/30 text-purple-300 hover:bg-purple-950/40'
                  }`}
              >
                <DollarSign className="w-3 h-3" />
                Auditoría Costos IA (${totalAiCost.toFixed(4)})
              </button>
            </div>
            <p className="text-[11px] text-slate-400 font-mono italic">
              * Los escenarios son hipótesis de análisis técnico bajo vigilancia algorítmica 24/7, no operaciones ejecutadas.
            </p>
          </div>
        )}
      </div>

      {/* Cost Audit Panel (Reconciled Expenditures) */}
      {showCostAudit && (
        <div className="p-3.5 rounded-xl border border-purple-500/40 bg-purple-950/20 text-xs font-mono space-y-2">
          <div className="flex items-center justify-between pb-1 border-b border-purple-500/20 flex-wrap gap-2">
            <span className="font-bold text-purple-300 flex items-center gap-1.5">
              <DollarSign className="w-3.5 h-3.5" />
              RECONCILIACIÓN Y AUDITORÍA DE COSTOS DE IA (FASE 5C.3)
            </span>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-purple-400 font-bold">LÍMITE DIARIO ESTRICTO: $0.50 USD</span>
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-500/20 text-purple-300 border border-purple-500/40">
                SALDO RESTANTE: ${(configSummary?.aiAccounting?.dailyRemainingBalanceUsd ?? configSummary?.budgetRemainingUsd ?? 0.5).toFixed(4)} USD
              </span>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 pt-1">
            <div className="p-2.5 rounded-lg bg-slate-900/90 border border-slate-800 space-y-1">
              <div className="flex items-center justify-between text-slate-400">
                <span>Gasto Bruto Hoy:</span>
                <span className="text-slate-200 font-bold">${(configSummary?.aiAccounting?.todayGrossSpendUsd ?? configSummary?.spentTodayUsd ?? 0).toFixed(4)} USD</span>
              </div>
              <div className="flex items-center justify-between text-slate-400 text-[11px]">
                <span>Gasto Neto Hoy:</span>
                <span className="text-emerald-400 font-bold">${(configSummary?.aiAccounting?.todayNetSpendUsd ?? configSummary?.spentTodayUsd ?? 0).toFixed(4)} USD</span>
              </div>
              <p className="text-[10px] text-slate-500">
                Consumo exacto hoy en Bybit snapshots.
              </p>
            </div>

            <div className="p-2.5 rounded-lg bg-slate-900/90 border border-slate-800 space-y-1">
              <div className="flex items-center justify-between text-slate-400">
                <span>Descuento Promo:</span>
                <span className="text-amber-400 font-bold">${(configSummary?.aiAccounting?.estimatedPromoDiscountUsd ?? 0).toFixed(4)} USD</span>
              </div>
              <div className="flex items-center justify-between text-slate-400 text-[11px]">
                <span>Facturado Confirmado:</span>
                <span className="text-blue-400 font-bold">${(configSummary?.aiAccounting?.confirmedBilledDiscountUsd ?? 0).toFixed(4)} USD</span>
              </div>
              <p className="text-[10px] text-slate-500">
                Data Sharing OpenAI. No infla límites.
              </p>
            </div>

            <div className="p-2.5 rounded-lg bg-slate-900/90 border border-slate-800 space-y-1">
              <div className="flex items-center justify-between text-slate-400">
                <span>Gasto Bruto Histórico:</span>
                <span className="text-slate-300 font-bold">${(configSummary?.aiAccounting?.lifetimeGrossSpendUsd ?? totalAiCost).toFixed(4)} USD</span>
              </div>
              <div className="flex items-center justify-between text-slate-400 text-[11px]">
                <span>Gasto Neto Histórico:</span>
                <span className="text-purple-300 font-bold">${(configSummary?.aiAccounting?.lifetimeNetSpendUsd ?? totalAiCost).toFixed(4)} USD</span>
              </div>
              <p className="text-[10px] text-slate-500">
                Historial completo persistido en SQLite.
              </p>
            </div>

            <div className="p-2.5 rounded-lg bg-slate-900/90 border border-slate-800 space-y-1">
              <div className="flex items-center justify-between text-slate-400">
                <span>Reservas Pendientes:</span>
                <span className="text-amber-300 font-bold">${(configSummary?.aiAccounting?.pendingReservationsUsd ?? 0).toFixed(4)} USD</span>
              </div>
              <div className="flex items-center justify-between text-slate-400 text-[11px]">
                <span>% Presupuesto Usado:</span>
                <span className="text-slate-200 font-bold">{(configSummary?.aiAccounting?.dailyPercentUsed ?? 0).toFixed(1)}%</span>
              </div>
              <p className="text-[10px] text-slate-500">
                0 tokens gastados en ticks. Watcher determinista.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* TAB 1: SCENARIOS TABLE */}
      {activeTab === 'scenarios' && (
        <div className="space-y-4">
          {filteredScenarios.length > 0 ? (
            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full text-left font-mono text-xs min-w-[1050px]">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-500 text-[11px]">
                    <th className="pb-2">ID / Hora</th>
                    <th className="pb-2">Tipo / Origen</th>
                    <th className="pb-2">Dirección</th>
                    <th className="pb-2">Zona Operativa</th>
                    <th className="pb-2">Niveles Verif.</th>
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
                    const isNeutral = sc.direction === 'NEUTRAL' || sc.kind === 'NEUTRAL_OBSERVATION';
                    const isSelected = selectedScenarioId === sc.id;
                    const trigger = sc.triggerSource || 'AUTOMATIC_SCHEDULER';
                    const verifiedCount = sc.verifiedLevels?.length || 0;

                    return (
                      <tr
                        key={sc.id}
                        className={`hover:bg-slate-900/60 transition-colors ${isSelected ? 'bg-slate-900/80 border-l-2 border-orange-500' : ''
                          }`}
                      >
                        <td className="py-2.5 text-slate-300">
                          <div className="font-bold">{sc.id}</div>
                          <div className="text-[10px] text-slate-500">
                            {new Date(sc.discoveryTimestamp).toLocaleTimeString('es-AR')}
                          </div>
                        </td>
                        <td className="py-2.5">
                          <div className="flex flex-col gap-0.5">
                            <span
                              className={`px-1.5 py-0.2 rounded text-[9px] font-bold inline-block w-fit ${isNeutral
                                ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                                : 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                                }`}
                            >
                              {isNeutral ? 'NEUTRAL_WATCH' : 'TRADE'}
                            </span>
                            <span className="text-[9px] text-slate-500">
                              {trigger === 'MANUAL_TRIGGER'
                                ? 'MANUAL'
                                : trigger === 'NEUTRAL_BREAKOUT'
                                  ? 'BREAKOUT'
                                  : 'AUTO'}
                            </span>
                          </div>
                        </td>
                        <td className="py-2.5">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${isNeutral
                              ? 'bg-slate-700/50 text-slate-300'
                              : isLong
                                ? 'bg-emerald-500/15 text-emerald-400'
                                : 'bg-rose-500/15 text-rose-400'
                              }`}
                          >
                            {sc.direction} · {sc.timeframe}
                          </span>
                        </td>
                        <td className="py-2.5 text-slate-200 font-semibold">
                          {isNeutral ? (
                            <span className="text-amber-300 font-mono text-[11px]">
                              Rango [${sc.entryZoneMin.toFixed(1)} - ${sc.entryZoneMax.toFixed(1)}]
                            </span>
                          ) : (
                            <span>${sc.entryZoneMin.toFixed(1)} - ${sc.entryZoneMax.toFixed(1)}</span>
                          )}
                        </td>
                        <td className="py-2.5">
                          {verifiedCount > 0 ? (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-500/15 text-blue-300 border border-blue-500/30 flex items-center gap-1 w-fit">
                              <ShieldCheck className="w-3 h-3 text-blue-400" />
                              {verifiedCount} Verif.
                            </span>
                          ) : (
                            <span className="text-slate-600 text-[10px]">---</span>
                          )}
                        </td>
                        <td className="py-2.5">
                          {isNeutral ? (
                            <span className="text-slate-500 font-bold text-[10px]">N/A (Observación)</span>
                          ) : (
                            <span className="text-rose-400 font-semibold">${sc.stopLossPrice.toFixed(1)}</span>
                          )}
                        </td>
                        <td className="py-2.5">
                          {isNeutral ? (
                            <span className="text-slate-600">---</span>
                          ) : sc.target12Price ? (
                            <div>
                              <span className="text-blue-300 font-bold">${sc.target12Price.toFixed(1)}</span>
                              <span className="text-[10px] text-blue-400/80 ml-1">({sc.netRR12}R)</span>
                            </div>
                          ) : (
                            <span className="text-slate-600">---</span>
                          )}
                        </td>
                        <td className="py-2.5">
                          {isNeutral ? (
                            <span className="text-slate-600">---</span>
                          ) : sc.target14Price ? (
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
                                className={`h-full ${(sc.distanceToZonePct || 0) <= 0.35 ? 'bg-amber-400' : 'bg-blue-400'
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
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${scenarioDetail.scenario.kind === 'NEUTRAL_OBSERVATION' ? 'bg-amber-500/20 text-amber-300' : 'bg-emerald-500/20 text-emerald-300'
                    }`}>
                    {scenarioDetail.scenario.kind || 'TRADE_SCENARIO'}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {scenarioDetail.scenario.kind !== 'NEUTRAL_OBSERVATION' && (
                    <button
                      onClick={() => handleManualRevalidate(scenarioDetail.scenario.id)}
                      disabled={isRevalidating}
                      className="px-2.5 py-1 rounded bg-purple-600/30 hover:bg-purple-600/50 text-purple-300 border border-purple-500/40 font-bold text-xs transition-colors cursor-pointer"
                    >
                      {isRevalidating ? 'Reevaluando...' : 'Reevaluar Ahora'}
                    </button>
                  )}
                  <button
                    onClick={() => setSelectedScenarioId(null)}
                    className="text-slate-400 hover:text-white px-2 py-1 text-xs"
                  >
                    ✕ Cerrar
                  </button>
                </div>
              </div>

              {/* Range Observation Notice if NEUTRAL */}
              {(scenarioDetail.scenario.kind === 'NEUTRAL_OBSERVATION' || scenarioDetail.scenario.direction === 'NEUTRAL') && (
                <div className="p-3.5 rounded-lg bg-amber-950/20 border border-amber-500/40 space-y-2 text-xs font-mono">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-amber-400 flex items-center gap-1.5">
                      <Radar className="w-4 h-4 text-amber-400" />
                      OBSERVACIÓN CUALITATIVA DE RANGO (CONSOLIDACIÓN)
                    </span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                      SIN ENTRADA OPERATIVA · ZERO RIESGO
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <div className="p-2 rounded bg-slate-950/70 border border-slate-800">
                      <span className="text-slate-400 text-[10px] uppercase">Piso de Consolidación (Soporte):</span>
                      <p className="text-emerald-400 font-extrabold text-sm mt-0.5">${scenarioDetail.scenario.entryZoneMin.toFixed(1)}</p>
                    </div>
                    <div className="p-2 rounded bg-slate-950/70 border border-slate-800">
                      <span className="text-slate-400 text-[10px] uppercase">Techo de Consolidación (Resistencia):</span>
                      <p className="text-rose-400 font-extrabold text-sm mt-0.5">${scenarioDetail.scenario.entryZoneMax.toFixed(1)}</p>
                    </div>
                  </div>
                  <p className="text-slate-300 text-[11px] italic">
                    * Esta hipótesis es una observación cualitativa de rango. No tiene Stop Loss, Take Profit ni R:R comercial. El vigilante algorítmico monitorea una posible ruptura confirmada sobre el techo o piso para solicitar un nuevo análisis autónomo de IA.
                  </p>
                </div>
              )}

              {/* Verified Levels Inspector Table */}
              {scenarioDetail.scenario.verifiedLevels && scenarioDetail.scenario.verifiedLevels.length > 0 && (
                <div className="p-3.5 rounded-lg bg-slate-950/70 border border-blue-500/30 space-y-2 text-xs font-mono">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-blue-400 flex items-center gap-1.5">
                      <ShieldCheck className="w-3.5 h-3.5" />
                      NIVELES TÉCNICOS VERIFICADOS EN SNAPSHOT ({scenarioDetail.scenario.verifiedLevels.length})
                    </span>
                    <span className="text-[10px] text-slate-400">Auditoría Cuantitativa Automática</span>
                  </div>
                  <div className="overflow-x-auto custom-scrollbar">
                    <table className="w-full text-left text-[11px] min-w-[700px]">
                      <thead>
                        <tr className="text-slate-500 border-b border-slate-800">
                          <th className="pb-1.5">Precio ($)</th>
                          <th className="pb-1.5">TF</th>
                          <th className="pb-1.5">Tipo de Nivel</th>
                          <th className="pb-1.5">Evidencia en Snapshot</th>
                          <th className="pb-1.5">Distancia</th>
                          <th className="pb-1.5">Relevancia</th>
                          <th className="pb-1.5 text-right">Estado</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/40 text-slate-300">
                        {scenarioDetail.scenario.verifiedLevels.map((lvl, i) => (
                          <tr key={i} className="hover:bg-slate-900/40">
                            <td className="py-1.5 font-bold text-slate-100">${lvl.price.toFixed(1)}</td>
                            <td className="py-1.5">{lvl.timeframe}</td>
                            <td className="py-1.5">
                              <span className="px-1.5 py-0.2 rounded bg-slate-800 text-blue-300 font-bold text-[9px]">
                                {lvl.levelType}
                              </span>
                            </td>
                            <td className="py-1.5 text-slate-400">{lvl.evidence}</td>
                            <td className="py-1.5">{lvl.distancePct.toFixed(2)}%</td>
                            <td className="py-1.5">
                              <span className={`px-1.5 py-0.2 rounded text-[9px] font-bold ${lvl.relevanceToHorizon === 'HIGH'
                                ? 'bg-emerald-500/20 text-emerald-400'
                                : lvl.relevanceToHorizon === 'MEDIUM'
                                  ? 'bg-blue-500/20 text-blue-400'
                                  : 'bg-slate-800 text-slate-400'
                                }`}>
                                {lvl.relevanceToHorizon}
                              </span>
                            </td>
                            <td className="py-1.5 text-right">
                              {lvl.isVerified ? (
                                <span className="text-emerald-400 font-bold flex items-center justify-end gap-1">
                                  <CheckCircle2 className="w-3 h-3" /> VERIFICADO
                                </span>
                              ) : (
                                <span className="text-rose-400 font-bold">NO VINCULADO</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* AI Watch Plan Contract & Sequential Conditions */}
              {scenarioDetail.scenario.watchPlan && (
                <div className="p-3.5 rounded-lg bg-orange-950/20 border border-orange-500/30 space-y-2 text-xs font-mono">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-orange-400 flex items-center gap-1.5">
                      <Crosshair className="w-3.5 h-3.5" />
                      CONTRATO DE VIGILANCIA: {scenarioDetail.scenario.watchPlan.id}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <span className="px-2 py-0.5 rounded text-[10px] bg-slate-800 text-slate-300 font-bold">
                        HORIZONTE: {scenarioDetail.scenario.watchPlan.horizon || 'INTRADAY'}
                      </span>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${scenarioDetail.scenario.watchPlan.automatable ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                        }`}>
                        {scenarioDetail.scenario.watchPlan.automatable ? 'AUTOMATABLE DETERMINISTA' : 'REQUIERE CONFIRMACIÓN MANUAL'}
                      </span>
                    </div>
                  </div>
                  {scenarioDetail.scenario.aiMarketThesis && (
                    <p className="text-slate-300 text-xs italic">
                      "{scenarioDetail.scenario.aiMarketThesis}"
                    </p>
                  )}

                  {/* Sequential Conditions with Next Awaited Event Tracker */}
                  {scenarioDetail.scenario.watchPlan.observableConditions?.length > 0 && (
                    <div className="pt-2 border-t border-slate-800/80 space-y-1.5">
                      <span className="text-[10px] uppercase font-bold text-slate-400">
                        Secuencia Ordenada de Confirmaciones del Algoritmo:
                      </span>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-1">
                        {(() => {
                          const sorted = [...scenarioDetail.scenario.watchPlan.observableConditions].sort(
                            (a: any, b: any) => (a.sequenceOrder || 1) - (b.sequenceOrder || 1)
                          );
                          const firstUnmetIdx = sorted.findIndex((c: any) => !c.isMet);

                          return sorted.map((cond: any, idx: number) => {
                            const isNextAwaited = idx === firstUnmetIdx;
                            return (
                              <div
                                key={idx}
                                className={`flex items-start gap-2 p-2 rounded text-[11px] border ${cond.isMet
                                  ? 'bg-emerald-950/20 border-emerald-500/40'
                                  : isNextAwaited
                                    ? 'bg-amber-950/20 border-amber-500/50 shadow-md shadow-amber-500/10 animate-pulse'
                                    : 'bg-slate-900 border-slate-800 opacity-60'
                                  }`}
                              >
                                <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold shrink-0 ${cond.isMet ? 'bg-emerald-500 text-slate-950' : 'bg-slate-800 text-slate-300'
                                  }`}>
                                  Paso {cond.sequenceOrder || idx + 1}
                                </span>
                                <div className="space-y-0.5 min-w-0 flex-1">
                                  <div className="flex items-center gap-1.5">
                                    <span className="px-1.5 py-0.2 rounded bg-slate-800 text-orange-300 font-bold text-[9px]">{cond.operator}</span>
                                    {cond.isMet ? (
                                      <span className="text-emerald-400 font-bold text-[9px] flex items-center gap-0.5">
                                        <CheckCircle2 className="w-2.5 h-2.5" /> CUMPLIDA {cond.metTimestamp ? `(${new Date(cond.metTimestamp).toLocaleTimeString('es-AR')})` : ''}
                                      </span>
                                    ) : isNextAwaited ? (
                                      <span className="text-amber-400 font-bold text-[9px]">⚡ PRÓXIMO EVENTO ESPERADO</span>
                                    ) : (
                                      <span className="text-slate-500 text-[9px]">PENDIENTE</span>
                                    )}
                                  </div>
                                  <p className="text-slate-300 truncate">{cond.description}</p>
                                </div>
                              </div>
                            );
                          });
                        })()}
                      </div>
                    </div>
                  )}
                </div>
              )}

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

              {/* Dual Interpretation Comparison with Full Market Analysis */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800/80 space-y-2">
                  <div className="flex items-center justify-between text-[11px] font-mono pb-1 border-b border-slate-800">
                    <span className="font-bold text-emerald-400 flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5" />
                      Interpretación OpenAI ({scenarioDetail.scenario.openaiInterpretation?.model || 'gpt-4o'})
                    </span>
                    <span className="text-slate-400 font-mono text-[10px]">
                      ${(scenarioDetail.scenario.openaiInterpretation?.costUsd || 0).toFixed(5)} USD
                    </span>
                  </div>
                  <div className="space-y-1 font-mono text-[11px]">
                    <div className="flex justify-between">
                      <span className="text-slate-500">Sesgo:</span>
                      <span className="font-bold text-slate-200">{scenarioDetail.scenario.openaiInterpretation?.bias || 'NEUTRAL'}</span>
                    </div>
                    {scenarioDetail.scenario.openaiInterpretation?.promptTokens && (
                      <div className="flex justify-between text-[10px] text-slate-500">
                        <span>Tokens:</span>
                        <span>{scenarioDetail.scenario.openaiInterpretation.promptTokens} in / {scenarioDetail.scenario.openaiInterpretation.completionTokens} out</span>
                      </div>
                    )}
                  </div>
                  <p className="text-slate-300 text-xs">
                    {scenarioDetail.scenario.openaiInterpretation?.reasoning || 'Sin reporte individual registrado'}
                  </p>
                  {scenarioDetail.scenario.openaiInterpretation?.marketAnalysis && (
                    <div className="space-y-1 text-[11px] text-slate-400 pt-1 border-t border-slate-900">
                      <p><strong className="text-slate-300">Acción del Mercado:</strong> {scenarioDetail.scenario.openaiInterpretation.marketAnalysis.whatMarketIsDoing}</p>
                      <p><strong className="text-slate-300">Tesis Causal:</strong> {scenarioDetail.scenario.openaiInterpretation.marketAnalysis.whyMarketIsDoingIt}</p>
                      {scenarioDetail.scenario.openaiInterpretation.marketAnalysis.noTradeJustification && (
                        <p className="text-amber-400/90"><strong className="text-amber-300">Justificación No Operar:</strong> {scenarioDetail.scenario.openaiInterpretation.marketAnalysis.noTradeJustification}</p>
                      )}
                    </div>
                  )}
                </div>

                <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800/80 space-y-2">
                  <div className="flex items-center justify-between text-[11px] font-mono pb-1 border-b border-slate-800">
                    <span className="font-bold text-blue-400 flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5" />
                      Interpretación Gemini ({scenarioDetail.scenario.geminiInterpretation?.model || 'gemini-2.5-flash'})
                    </span>
                    <span className="text-slate-400 font-mono text-[10px]">
                      ${(scenarioDetail.scenario.geminiInterpretation?.costUsd || 0).toFixed(5)} USD
                    </span>
                  </div>
                  <div className="space-y-1 font-mono text-[11px]">
                    <div className="flex justify-between">
                      <span className="text-slate-500">Sesgo:</span>
                      <span className="font-bold text-slate-200">{scenarioDetail.scenario.geminiInterpretation?.bias || 'NEUTRAL'}</span>
                    </div>
                    {scenarioDetail.scenario.geminiInterpretation?.promptTokens && (
                      <div className="flex justify-between text-[10px] text-slate-500">
                        <span>Tokens:</span>
                        <span>{scenarioDetail.scenario.geminiInterpretation.promptTokens} in / {scenarioDetail.scenario.geminiInterpretation.completionTokens} out</span>
                      </div>
                    )}
                  </div>
                  <p className="text-slate-300 text-xs">
                    {scenarioDetail.scenario.geminiInterpretation?.reasoning || 'Sin reporte individual registrado'}
                  </p>
                  {scenarioDetail.scenario.geminiInterpretation?.marketAnalysis && (
                    <div className="space-y-1 text-[11px] text-slate-400 pt-1 border-t border-slate-900">
                      <p><strong className="text-slate-300">Acción del Mercado:</strong> {scenarioDetail.scenario.geminiInterpretation.marketAnalysis.whatMarketIsDoing}</p>
                      <p><strong className="text-slate-300">Tesis Causal:</strong> {scenarioDetail.scenario.geminiInterpretation.marketAnalysis.whyMarketIsDoingIt}</p>
                      {scenarioDetail.scenario.geminiInterpretation.marketAnalysis.noTradeJustification && (
                        <p className="text-amber-400/90"><strong className="text-amber-300">Justificación No Operar:</strong> {scenarioDetail.scenario.geminiInterpretation.marketAnalysis.noTradeJustification}</p>
                      )}
                    </div>
                  )}
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
                      className={`px-1.5 py-0.2 rounded text-[10px] font-mono font-bold ${data.trend === 'BULLISH'
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
          <div className="p-3.5 rounded-xl bg-slate-900/70 border border-slate-800 flex items-center justify-between flex-wrap gap-2">
            <div>
              <h4 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                Seguimiento Prospectivo de Papel (Paper Trading 24/7)
              </h4>
              <p className="text-xs text-slate-400 mt-0.5">
                Las hipótesis validadas por IA en zona inician seguimiento en vivo con saldo virtual de referencia ($100 USDT de riesgo). Modo SIGNALS_ONLY. Cero órdenes reales en Bybit.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
                <button
                  onClick={() => setPaperTab('ACTIVE')}
                  className={`px-2.5 py-1 rounded text-[11px] font-mono font-bold ${paperTab === 'ACTIVE' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'}`}
                >
                  EN CURSO ({activeSignals.length})
                </button>
                <button
                  onClick={() => setPaperTab('CLOSED')}
                  className={`px-2.5 py-1 rounded text-[11px] font-mono font-bold ${paperTab === 'CLOSED' ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-white'}`}
                >
                  CERRADAS ({allSignals.filter((s: any) => ['COMPLETED_TP', 'COMPLETED_SL', 'EXPIRED', 'INVALIDATED', 'CANCELLED'].includes(s.state || s.status)).length})
                </button>
              </div>
              <button
                onClick={fetchActiveSignals}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                title="Actualizar posiciones"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {paperTab === 'ACTIVE' ? (
            activeSignals.length === 0 ? (
              <div className="p-8 text-center text-slate-500 font-mono text-xs border border-dashed border-slate-800 rounded-xl bg-slate-950/40">
                No hay posiciones virtuales activas en seguimiento en este momento. Las posiciones se inician automáticamente al validar una hipótesis en zona.
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
            )
          ) : (
            (() => {
              const closed = allSignals.filter((s: any) => ['COMPLETED_TP', 'COMPLETED_SL', 'EXPIRED', 'INVALIDATED', 'CANCELLED'].includes(s.state || s.status));
              return closed.length === 0 ? (
                <div className="p-8 text-center text-slate-500 font-mono text-xs border border-dashed border-slate-800 rounded-xl bg-slate-950/40">
                  Sin historial de posiciones cerradas aún.
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
                        <th className="py-2.5 px-3 text-right">Resultado</th>
                        <th className="py-2.5 px-3 text-center">Estado Final</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {closed.map((sig: any) => {
                        const st = sig.state || sig.status;
                        const isTp = st === 'COMPLETED_TP';
                        const isSl = st === 'COMPLETED_SL';
                        return (
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
                            <td className="py-2.5 px-3 text-right font-bold">
                              {isTp ? (
                                <span className="text-emerald-400">+{sig.netRR?.toFixed(2) || '2.00'}R</span>
                              ) : isSl ? (
                                <span className="text-rose-400">-1.00R</span>
                              ) : (
                                <span className="text-slate-500">0.00R</span>
                              )}
                            </td>
                            <td className="py-2.5 px-3 text-center">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                isTp ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' :
                                isSl ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40' :
                                'bg-slate-800 text-slate-400'
                              }`}>
                                {st}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })()
          )}
        </div>
      )}
    </div>
  );
}
