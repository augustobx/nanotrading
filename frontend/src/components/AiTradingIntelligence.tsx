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
  Ban,
  FileText,
} from 'lucide-react';
import { getApiBaseUrl, getWebSocketLiveUrl, getAdminMutationHeaders } from '../utils/api-config';
import { ScenarioFunnelView } from './scenarios/ScenarioFunnelView';
import { ScenarioDetailDrawer } from './scenarios/ScenarioDetailDrawer';
import { OperationalNowSection } from './scenarios/OperationalNowSection';
import { ApprovedSignalsSection } from './scenarios/ApprovedSignalsSection';
import { PaperTradingSection } from './scenarios/PaperTradingSection';
import { DiscardedWithoutTradeSection } from './scenarios/DiscardedWithoutTradeSection';
import { FullAuditTableSection } from './scenarios/FullAuditTableSection';
import DiscoveryAuditPanel from './DiscoveryAuditPanel';
import { formatUsd, formatArgentinaDateTime } from '../utils/formatters';

export function AiTradingIntelligence({
  onShowScenarioOnChart,
  marketSymbol = 'BTCUSDT',
}: {
  onShowScenarioOnChart?: (scenarioId: string) => void;
  marketSymbol?: 'BTCUSDT' | 'ETHUSDT';
} = {}) {
  const [activeTab, setActiveTab] = useState<
    'en_proceso' | 'senales' | 'paper' | 'sin_trade' | 'historial' | 'funnel' | 'market_intelligence' | 'watcher_stats'
  >('en_proceso');

  const [scenarios, setScenarios] = useState<any[]>([]);
  const [marketIntel, setMarketIntel] = useState<any | null>(null);
  const [schedulerStatus, setSchedulerStatus] = useState<any | null>(null);
  const [configSummary, setConfigSummary] = useState<any | null>(null);
  const [activeSignals, setActiveSignals] = useState<any[]>([]);
  const [allSignals, setAllSignals] = useState<any[]>([]);
  const [selectedScenarioId, setSelectedScenarioId] = useState<string | null>(null);
  const [scenarioDetail, setScenarioDetail] = useState<any | null>(null);
  const [showCostAudit, setShowCostAudit] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [isRevalidating, setIsRevalidating] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const apiBase = getApiBaseUrl();
  const marketBase = marketSymbol === 'ETHUSDT' ? `${apiBase}/api/v1/markets/ETHUSDT` : null;

  const fetchScenarios = async () => {
    try {
      const res = await fetch(marketBase ? `${marketBase}/scenarios` : `${apiBase}/api/v1/discovery/scenarios`);
      if (res.ok) {
        const data = await res.json();
        setScenarios(data.data || []);
      }
    } catch {}
  };

  const fetchMarketIntel = async () => {
    try {
      const res = await fetch(marketBase ? `${marketBase}/market-intelligence` : `${apiBase}/api/v1/discovery/market-intelligence`);
      if (res.ok) {
        const data = await res.json();
        setMarketIntel(data.data || null);
      }
    } catch {}
  };

  const fetchSchedulerStatus = async () => {
    try {
      const res = await fetch(marketBase ? `${marketBase}/scheduler` : `${apiBase}/api/v1/discovery/scheduler/status`);
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
      const res = await fetch(marketBase ? `${marketBase}/signals/active` : `${apiBase}/api/v1/signals/active`);
      if (res.ok) {
        const data = await res.json();
        setActiveSignals(data.data || []);
      }
      const resHistory = await fetch(marketBase ? `${marketBase}/signals?limit=100` : `${apiBase}/api/v1/signals?limit=100`);
      if (resHistory.ok) {
        const dataH = await resHistory.json();
        setAllSignals(dataH.data || []);
      }
    } catch {}
  };

  const fetchDetail = async (id: string) => {
    try {
      const res = await fetch(marketBase ? `${marketBase}/scenarios/${id}` : `${apiBase}/api/v1/discovery/scenarios/${id}`);
      if (res.ok) {
        const data = await res.json();
        setScenarioDetail(data.data || null);
      }
    } catch {}
  };

  useEffect(() => {
    fetchScenarios();
    fetchMarketIntel();
    fetchSchedulerStatus();
    fetchConfigSummary();
    fetchActiveSignals();

    const interval = setInterval(() => {
      fetchScenarios();
      fetchSchedulerStatus();
      fetchConfigSummary();
      fetchActiveSignals();
    }, 15000);

    return () => clearInterval(interval);
  }, [marketSymbol]);

  useEffect(() => {
    if (!selectedScenarioId) {
      setScenarioDetail(null);
      return;
    }
    // A detail drawer can remain open through several candle closes.
    // Refresh persisted lifecycle/progress instead of showing a frozen snapshot.
    void fetchDetail(selectedScenarioId);
    const refresh = setInterval(() => {
      void fetchDetail(selectedScenarioId);
    }, 15000);
    return () => clearInterval(refresh);
  }, [selectedScenarioId, marketSymbol]);

  useEffect(() => {
    setSelectedScenarioId(null);
    setScenarioDetail(null);
  }, [marketSymbol]);

  const handleTriggerDiscovery = async () => {
    setIsDiscovering(true);
    setMessage(null);
    try {
      const headers = await getAdminMutationHeaders();
      const res = await fetch(marketBase ? `${marketBase}/discovery/trigger` : `${apiBase}/api/v1/discovery/trigger`, {
        method: 'POST',
        headers,
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setMessage({ text: 'Descubrimiento IA ejecutado correctamente.', type: 'success' });
        fetchScenarios();
        fetchSchedulerStatus();
        fetchConfigSummary();
      } else {
        setMessage({ text: data.error || 'No se pudo ejecutar descubrimiento.', type: 'error' });
      }
    } catch (err: any) {
      setMessage({ text: err.message || 'Error de conexión', type: 'error' });
    } finally {
      setIsDiscovering(false);
    }
  };

  const handleManualRevalidate = async (id: string) => {
    setIsRevalidating(true);
    try {
      const headers = await getAdminMutationHeaders();
      const res = await fetch(marketBase ? `${marketBase}/scenarios/${id}/revalidate` : `${apiBase}/api/v1/discovery/scenarios/${id}/revalidate`, {
        method: 'POST',
        headers,
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setMessage({ text: 'Reevaluación de escenario completada.', type: 'success' });
        fetchScenarios();
        if (selectedScenarioId === id) fetchDetail(id);
      } else {
        setMessage({ text: data.error || 'Error al reevaluar escenario', type: 'error' });
      }
    } catch (err: any) {
      setMessage({ text: err.message || 'Error de conexión', type: 'error' });
    } finally {
      setIsRevalidating(false);
    }
  };

  // Operational counts
  const liveCount = scenarios.filter((s) => {
    const status = s.status || '';
    return !['INVALIDATED', 'EXPIRED', 'CANCELLED', 'COMPLETED', 'COMPLETED_TP', 'COMPLETED_SL'].includes(status);
  }).length;

  const approvedSignalsCount = scenarios.filter((s) =>
    ['ENTRY_VALIDATED', 'ALERT_SENT'].includes(s.status)
  ).length;

  const paperOpenCount = activeSignals.filter(
    (s) => ['TRACKING', 'ENTRY_TRIGGERED'].includes(s.state) && !!s.simulatedEntryTime
  ).length;

  const discardedCount = scenarios.filter((s) => {
    const isNeutral = s.kind === 'NEUTRAL_OBSERVATION' || s.direction === 'NEUTRAL';
    const status = s.status || '';
    if (['INVALIDATED', 'EXPIRED', 'CANCELLED', 'NO_TRADE_OBSERVATION'].includes(status)) return true;
    if (status === 'COMPLETED' && isNeutral) return true;
    return false;
  }).length;

  const totalAiCost = configSummary?.aiAccounting?.lifetimeGrossSpendUsd ?? null;

  return (
    <div className="space-y-4">
      {/* 1. Control Center Header */}
      <div className="p-4 sm:p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1422] shadow-sm flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-orange-500 to-amber-500 flex items-center justify-center text-white shadow-lg shadow-orange-500/20">
            <Brain className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="font-display font-extrabold text-base sm:text-lg text-slate-900 dark:text-white tracking-wide uppercase">
                Centro de Inteligencia & Control Autónomo · {marketSymbol}
              </h2>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-orange-500/15 text-orange-600 dark:text-orange-400 border border-orange-500/30">
                FASE 5C.3
              </span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                SIGNALS_ONLY
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Descubrimiento causal, vigilancia 24/7 sin IA y validación determinista de setups con R:R neto ≥ 1:4.
            </p>
          </div>
        </div>

        {/* Action Controls & Biases */}
        <div className="flex items-center flex-wrap gap-2.5">
          {marketIntel?.openaiBias && (
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs font-mono">
              <span className="text-slate-400">OpenAI:</span>
              <span className={`font-bold ${
                marketIntel.openaiBias === 'BULLISH' ? 'text-emerald-600 dark:text-emerald-400' :
                marketIntel.openaiBias === 'BEARISH' ? 'text-rose-600 dark:text-rose-400' : 'text-amber-500 dark:text-amber-400'
              }`}>
                {marketIntel.openaiBias}
              </span>
            </div>
          )}

          {marketIntel?.geminiBias && (
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs font-mono">
              <span className="text-slate-400">Gemini:</span>
              <span className={`font-bold ${
                marketIntel.geminiBias === 'BULLISH' ? 'text-emerald-600 dark:text-emerald-400' :
                marketIntel.geminiBias === 'BEARISH' ? 'text-rose-600 dark:text-rose-400' : 'text-amber-500 dark:text-amber-400'
              }`}>
                {marketIntel.geminiBias}
              </span>
            </div>
          )}

          <button
            onClick={handleTriggerDiscovery}
            disabled={isDiscovering}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white font-bold text-xs shadow-md shadow-orange-500/20 transition-all cursor-pointer disabled:opacity-50"
            title="Analiza el panorama actual y descubre hipótesis de trading"
          >
            <Sparkles className={`w-3.5 h-3.5 ${isDiscovering ? 'animate-spin' : ''}`} />
            {isDiscovering ? 'Analizando...' : 'Ejecutar Descubrimiento IA'}
          </button>
        </div>
      </div>

      {/* 2. Provider & Budget Status Banner */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 text-xs font-mono">
        <div className="p-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1422] shadow-sm flex items-center justify-between">
          <span className="text-slate-500 dark:text-slate-400">OpenAI Provider:</span>
          {configSummary?.openaiConfigured ? (
            <span className="text-emerald-600 dark:text-emerald-400 font-bold flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" /> ACTIVO
            </span>
          ) : (
            <span className="text-amber-500 font-bold flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5" /> PENDIENTE
            </span>
          )}
        </div>

        <div className="p-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1422] shadow-sm flex items-center justify-between">
          <span className="text-slate-500 dark:text-slate-400">Gemini Provider:</span>
          {configSummary?.geminiConfigured ? (
            <span className="text-emerald-600 dark:text-emerald-400 font-bold flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" /> ACTIVO
            </span>
          ) : (
            <span className="text-amber-500 font-bold flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5" /> PENDIENTE
            </span>
          )}
        </div>

        <div className="p-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1422] shadow-sm flex items-center justify-between">
          <span className="text-slate-500 dark:text-slate-400">Scheduler Autónomo:</span>
          {schedulerStatus?.isRunning && schedulerStatus?.enabled ? (
            <span className="text-emerald-600 dark:text-emerald-400 font-bold flex items-center gap-1">
              <Activity className="w-3.5 h-3.5" />
              {schedulerStatus.activeWatchedScenarios > 0
                ? `${schedulerStatus.activeWatchedScenarios} ZONA(S) (SIN IA)`
                : schedulerStatus.discoveryInFlight
                ? 'DESCUBRIENDO...'
                : schedulerStatus.providerFailureBackoffUntil &&
                    schedulerStatus.providerFailureBackoffUntil > Date.now()
                ? 'BACKOFF PROVEEDOR'
                : 'VIGILANDO 24/7'}
            </span>
          ) : (
            <span className="text-slate-400 font-bold">DESACTIVADO</span>
          )}
        </div>

        <div className="p-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1422] shadow-sm flex items-center justify-between">
          <span className="text-slate-500 dark:text-slate-400">Presupuesto IA Hoy:</span>
          <span className="font-bold text-slate-800 dark:text-slate-200">
            ${(configSummary?.grossSpentTodayUsd ?? 0).toFixed(4)} / ${(configSummary?.dailyBudgetUsd ?? 0.5).toFixed(2)}
          </span>
        </div>
      </div>

      {/* Message Banner */}
      {message && (
        <div
          className={`p-3.5 rounded-2xl text-xs flex items-center justify-between ${
            message.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200 border border-emerald-300 dark:border-emerald-700'
              : 'bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-200 border border-rose-300 dark:border-rose-700'
          }`}
        >
          <span>{message.text}</span>
          <button onClick={() => setMessage(null)} className="font-bold ml-2">✕</button>
        </div>
      )}

      {/* 3. Primary Functional Section Navigation Tabs */}
      <div className="flex items-center gap-1.5 sm:gap-2 pb-2 border-b border-slate-200 dark:border-slate-800 overflow-x-auto custom-scrollbar">
        <button
          onClick={() => setActiveTab('en_proceso')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-mono font-bold transition-all cursor-pointer whitespace-nowrap ${
            activeTab === 'en_proceso'
              ? 'bg-amber-500 text-white shadow-md'
              : 'bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <Activity className="w-4 h-4" />
          <span>En Proceso Ahora</span>
          <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${
            activeTab === 'en_proceso' ? 'bg-white/20 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
          }`}>
            {liveCount}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('senales')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-mono font-bold transition-all cursor-pointer whitespace-nowrap ${
            activeTab === 'senales'
              ? 'bg-emerald-600 text-white shadow-md'
              : 'bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <ShieldCheck className="w-4 h-4" />
          <span>Señales Aprobadas</span>
          <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${
            activeTab === 'senales' ? 'bg-white/20 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
          }`}>
            {approvedSignalsCount}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('paper')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-mono font-bold transition-all cursor-pointer whitespace-nowrap ${
            activeTab === 'paper'
              ? 'bg-teal-600 text-white shadow-md'
              : 'bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <TrendingUp className="w-4 h-4" />
          <span>Paper Trading</span>
          <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${
            activeTab === 'paper' ? 'bg-white/20 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
          }`}>
            {paperOpenCount}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('sin_trade')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-mono font-bold transition-all cursor-pointer whitespace-nowrap ${
            activeTab === 'sin_trade'
              ? 'bg-slate-700 text-white shadow-md'
              : 'bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <Ban className="w-4 h-4" />
          <span>Finalizados Sin Trade</span>
          <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${
            activeTab === 'sin_trade' ? 'bg-white/20 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
          }`}>
            {discardedCount}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('historial')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-mono font-bold transition-all cursor-pointer whitespace-nowrap ${
            activeTab === 'historial'
              ? 'bg-orange-600 text-white shadow-md'
              : 'bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <FileText className="w-4 h-4" />
          <span>Historial Completo ({scenarios.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('funnel')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-mono font-bold transition-all cursor-pointer whitespace-nowrap ${
            activeTab === 'funnel'
              ? 'bg-purple-600 text-white shadow-md'
              : 'bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <Filter className="w-4 h-4" />
          <span>Embudo / Pipeline</span>
        </button>

        <button
          onClick={() => setActiveTab('market_intelligence')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-mono font-bold transition-all cursor-pointer whitespace-nowrap ${
            activeTab === 'market_intelligence'
              ? 'bg-blue-600 text-white shadow-md'
              : 'bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <Layers className="w-4 h-4" />
          <span>Panorama 6TF</span>
        </button>

        <button
          onClick={() => setActiveTab('watcher_stats')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-mono font-bold transition-all cursor-pointer whitespace-nowrap ${
            activeTab === 'watcher_stats'
              ? 'bg-indigo-600 text-white shadow-md'
              : 'bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <Radar className="w-4 h-4" />
          <span>Watcher 24/7</span>
        </button>
      </div>

      {/* 4. Active Tab Content Rendering */}
      {activeTab === 'en_proceso' && (
        <OperationalNowSection
          scenarios={scenarios}
          onSelectScenario={setSelectedScenarioId}
          onTriggerDiscovery={handleTriggerDiscovery}
          isDiscovering={isDiscovering}
        />
      )}

      {activeTab === 'senales' && (
        <ApprovedSignalsSection
          signals={allSignals.length > 0 ? allSignals : activeSignals}
          scenarios={scenarios}
          onSelectScenario={setSelectedScenarioId}
          onRefresh={fetchActiveSignals}
        />
      )}

      {activeTab === 'paper' && (
        <PaperTradingSection
          signals={allSignals.length > 0 ? allSignals : activeSignals}
          onRefresh={fetchActiveSignals}
        />
      )}

      {activeTab === 'sin_trade' && (
        <DiscardedWithoutTradeSection
          scenarios={scenarios}
          onSelectScenario={setSelectedScenarioId}
        />
      )}

      {activeTab === 'historial' && (
        <FullAuditTableSection
          scenarios={scenarios}
          onSelectScenario={setSelectedScenarioId}
        />
      )}

      {activeTab === 'funnel' && (
        <div className="space-y-5">
          <ScenarioFunnelView
            scenarios={scenarios}
            signals={allSignals.length > 0 ? allSignals : activeSignals}
            totalAutonomousRuns={schedulerStatus?.totalAutonomousRuns || 0}
          />
          {marketSymbol === 'BTCUSDT' ? <DiscoveryAuditPanel apiBase={apiBase} /> : (
            <p className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 p-4 text-xs text-slate-500">
              La auditoría de ETHUSDT está disponible en su terminal independiente.
            </p>
          )}
        </div>
      )}

      {activeTab === 'market_intelligence' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {marketIntel?.timeframes &&
              Object.entries(marketIntel.timeframes).map(([tf, data]: [string, any]) => (
                <div key={tf} className="p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1422] shadow-sm space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-extrabold text-sm text-slate-900 dark:text-white">{tf.toUpperCase()}</span>
                    <span className={`px-1.5 py-0.2 rounded text-[10px] font-mono font-bold ${
                      data.trend === 'BULLISH'
                        ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400'
                        : data.trend === 'BEARISH'
                        ? 'bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-400'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                    }`}>
                      {data.trend}
                    </span>
                  </div>

                  <div className="text-xs font-mono space-y-1 text-slate-500 dark:text-slate-400">
                    <div className="flex justify-between">
                      <span>RSI (14):</span>
                      <span className="font-bold text-slate-800 dark:text-slate-200">{data.rsi}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>ATR:</span>
                      <span className="text-slate-800 dark:text-slate-200">${data.atr}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>FVGs / OBs:</span>
                      <span className="text-amber-500 font-bold">{data.activeFvgs} / {data.activeObs}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>BOS / CHoCH:</span>
                      <span className="text-purple-500 font-bold">{data.bosCount} / {data.chochCount}</span>
                    </div>
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {activeTab === 'watcher_stats' && (
        <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1422] shadow-sm space-y-3">
          <div className="flex items-center gap-2">
            <Radar className="w-5 h-5 text-emerald-500" />
            <h4 className="font-display font-bold text-sm text-slate-900 dark:text-white uppercase">
              Algorithmic Zone Watcher (24/7)
            </h4>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed font-sans">
            El <strong>Algorithmic Watcher</strong> opera permanentemente en background desacoplado del frontend. Monitorea cada tick del WebSocket y cada cierre de vela <strong>sin consumir tokens de IA</strong> hasta que el precio mitiga la zona identificada:
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2 text-xs font-mono">
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-1">
              <span className="text-amber-500 font-bold">1. APROXIMACIÓN (≤ 0.35%)</span>
              <p className="text-slate-500 text-[11px] font-sans">
                Alerta temprana sin coste de inferencia. Prepara el sistema y emite evento local.
              </p>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-1">
              <span className="text-purple-500 font-bold">2. MITIGACIÓN EN ZONA</span>
              <p className="text-slate-500 text-[11px] font-sans">
                Dispara solicitud de reevaluación. Consulta a OpenAI y Gemini con el snapshot idéntico.
              </p>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-1">
              <span className="text-rose-500 font-bold">3. INVALIDACIÓN ESTRUCTURAL</span>
              <p className="text-slate-500 text-[11px] font-sans">
                Si el precio rompe el Stop Loss o nivel contrario antes de mitigar, cancela la hipótesis deterministamente.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* 5. Detailed Scenario Drawer */}
      {selectedScenarioId && (
        <ScenarioDetailDrawer
          scenarioDetail={scenarioDetail}
          onClose={() => setSelectedScenarioId(null)}
          onManualRevalidate={handleManualRevalidate}
          onShowOnChart={onShowScenarioOnChart}
          isRevalidating={isRevalidating}
        />
      )}
    </div>
  );
}
