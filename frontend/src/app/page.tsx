'use client';

import React, { useEffect, useState, useRef } from 'react';
import { PaletteSelector } from '../nanolabs-components/PaletteSelector';
import { useERPTheme } from '../nanolabs-components/ThemeContext';
import { CandleChart, Timeframe, CandleData } from '../components/CandleChart';
import { OrderBookWidget } from '../components/OrderBookWidget';
import { MultiTimeframeMatrix } from '../components/MultiTimeframeMatrix';
import { AiAnalystsCard } from '../components/AiAnalystsCard';
import { SignalLifecycleMonitor } from '../components/SignalLifecycleMonitor';
import { NotificationsModal } from '../components/NotificationsModal';
import { ConfigCenterModal } from '../components/config/ConfigCenterModal';
import { AiTradingIntelligence } from '../components/AiTradingIntelligence';
import TradingLaboratory from '../components/TradingLaboratory';
import {
  Activity,
  Shield,
  Clock,
  ArrowUpRight,
  ArrowDownRight,
  Layers,
  Database,
  RefreshCw,
  Sun,
  Moon,
  TrendingUp,
  AlertTriangle,
  Bell,
  Power,
  Radio,
  Settings,
  Radar,
  Crosshair,
  Brain,
  ShieldCheck,
  DollarSign,
  Zap,
  CheckCircle2,
  XCircle,
  Eye,
  LayoutDashboard,
  Filter,
} from 'lucide-react';

interface TickerData {
  symbol: string;
  lastPrice: number;
  markPrice: number;
  indexPrice: number;
  bid1Price: number;
  ask1Price: number;
  spread: number;
  spreadPcnt: number;
  highPrice24h: number;
  lowPrice24h: number;
  price24hPcnt: number;
  volume24h: number;
  turnover24h: number;
  fundingRate: number;
  openInterest: number;
}

import { getApiBaseUrl, getWebSocketLiveUrl, getAdminMutationHeaders } from '../utils/api-config';

const getApiBase = getApiBaseUrl;
const getWsUrl = getWebSocketLiveUrl;

type MainTab = 'terminal' | 'scenarios' | 'signals' | 'analysts' | 'audit' | 'lab';

export default function DashboardPage() {
  const { palette, isDark, toggleDarkMode } = useERPTheme();

  const [activeMainTab, setActiveMainTab] = useState<MainTab>('terminal');
  const [selectedScenarioId, setSelectedScenarioId] = useState<string | null>(null);
  const [auditFilter, setAuditFilter] = useState<'ALL' | 'CRITICAL' | 'ERROR' | 'WARN' | 'INFO'>('ALL');

  const [timeframe, setTimeframe] = useState<Timeframe>('15m');
  const [ticker, setTicker] = useState<TickerData | null>(null);
  const [priceFlash, setPriceFlash] = useState<'up' | 'down' | null>(null);
  const [orderBook, setOrderBook] = useState<any>(null);
  const [candles, setCandles] = useState<CandleData[]>([]);
  const [currentCandles, setCurrentCandles] = useState<Record<Timeframe, CandleData | null>>({
    '1m': null,
    '5m': null,
    '15m': null,
    '1h': null,
    '4h': null,
    '1d': null,
  });
  const [lastClosedCandles, setLastClosedCandles] = useState<Record<Timeframe, CandleData | null>>({
    '1m': null,
    '5m': null,
    '15m': null,
    '1h': null,
    '4h': null,
    '1d': null,
  });

  const [wsConnected, setWsConnected] = useState<boolean>(false);
  const [wsLatency, setWsLatency] = useState<number>(0);
  const [systemEvents, setSystemEvents] = useState<any[]>([]);
  const [argentinaTime, setArgentinaTime] = useState<string>('');

  // Autonomous Quantitative Engine & Scenarios State
  const [analyses, setAnalyses] = useState<Record<string, any>>({});
  const [scenarios, setScenarios] = useState<any[]>([]);

  // Dual AI & Consensus State
  const [aiStatus, setAiStatus] = useState<any | null>(null);
  const [signals, setSignals] = useState<any[]>([]);
  const [aiReviews, setAiReviews] = useState<any[]>([]);

  // State Machine & Notifications
  const [activeSignals, setActiveSignals] = useState<any[]>([]);
  const [isNotificationsModalOpen, setIsNotificationsModalOpen] = useState<boolean>(false);
  const [killSwitchActive, setKillSwitchActive] = useState<boolean>(false);

  // Configuration Center & AI Router
  const [isConfigModalOpen, setIsConfigModalOpen] = useState<boolean>(false);
  const [configSummary, setConfigSummary] = useState<any>(null);

  const fetchConfigSummary = async () => {
    try {
      const res = await fetch(`${getApiBase()}/api/v1/config/summary`);
      if (res.ok) {
        const json = await res.json();
        if (json.success) setConfigSummary(json.data);
      }
    } catch {}
  };

  useEffect(() => {
    fetchConfigSummary();
    const interval = setInterval(fetchConfigSummary, 15000);
    return () => clearInterval(interval);
  }, []);

  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }, []);

  const handleCancelSignal = async (signalId: string) => {
    try {
      const response = await fetch(`${getApiBase()}/api/v1/signals/${signalId}/cancel`, {
        method: 'POST',
        headers: await getAdminMutationHeaders(),
        credentials: 'include',
      });
      if (!response.ok) throw new Error('No se pudo cancelar la señal');
      setActiveSignals((prev) => prev.filter((s) => s.id !== signalId));
    } catch {}
  };

  const handleToggleKillSwitch = async () => {
    const nextState = !killSwitchActive;
    const confirmMsg = nextState
      ? '¿Confirmás activar el KILL SWITCH de emergencia? Se cancelarán todas las señales activas y se suspenderá la generación de nuevas señales.'
      : '¿Confirmás desactivar el Kill Switch y volver a modo de observación 24/7?';

    if (!window.confirm(confirmMsg)) return;

    try {
      const res = await fetch(`${getApiBase()}/api/v1/kill-switch`, {
        method: 'POST',
        headers: await getAdminMutationHeaders(),
        credentials: 'include',
        body: JSON.stringify({ active: nextState, reason: 'Acción manual panel usuario' }),
      });
      if (res.ok) {
        setKillSwitchActive(nextState);
        fetchAnalysisAndSetups();
      }
    } catch {}
  };

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setArgentinaTime(
        now.toLocaleTimeString('es-AR', {
          timeZone: 'America/Argentina/Buenos_Aires',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })
      );
    };
    updateTime();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, []);

  const fetchCandles = async (tf: Timeframe) => {
    try {
      const res = await fetch(`${getApiBase()}/api/v1/market/candles?timeframe=${tf}&limit=150`);
      if (res.ok) {
        const json = await res.json();
        if (json.success && json.data) {
          setCandles(json.data);
        }
      }
    } catch {}
  };

  const fetchAnalysisAndSetups = async () => {
    try {
      const [anRes, scRes, aiRes, sigRes, revRes, actSigRes, stRes] = await Promise.all([
        fetch(`${getApiBase()}/api/v1/market/analysis`),
        fetch(`${getApiBase()}/api/v1/discovery/scenarios`),
        fetch(`${getApiBase()}/api/v1/ai/status`),
        fetch(`${getApiBase()}/api/v1/signals`),
        fetch(`${getApiBase()}/api/v1/ai/reviews`),
        fetch(`${getApiBase()}/api/v1/signals/active`),
        fetch(`${getApiBase()}/api/v1/market/state`),
      ]);
      if (anRes.ok) {
        const anData = await anRes.json();
        if (anData.success) setAnalyses(anData.data);
      }
      if (scRes.ok) {
        const scData = await scRes.json();
        if (scData.success) setScenarios(scData.data || []);
      }
      if (aiRes.ok) {
        const aiData = await aiRes.json();
        if (aiData.success) setAiStatus(aiData.data);
      }
      if (sigRes.ok) {
        const sigData = await sigRes.json();
        if (sigData.success) setSignals(sigData.data);
      }
      if (revRes.ok) {
        const revData = await revRes.json();
        if (revData.success) setAiReviews(revData.data);
      }
      if (actSigRes.ok) {
        const actData = await actSigRes.json();
        if (actData.success) setActiveSignals(actData.data);
      }
      if (stRes.ok) {
        const stData = await stRes.json();
        if (stData.success && stData.data) {
          setKillSwitchActive(stData.data.killSwitchActive || false);
        }
      }
    } catch {}
  };

  const fetchEvents = async () => {
    try {
      const res = await fetch(`${getApiBase()}/api/v1/events?limit=25`);
      if (res.ok) {
        const json = await res.json();
        if (json.success && json.data) {
          setSystemEvents(json.data);
        }
      }
    } catch {}
  };

  useEffect(() => {
    fetchCandles(timeframe);
  }, [timeframe]);

  useEffect(() => {
    fetchEvents();
    fetchAnalysisAndSetups();
    const timer = setInterval(() => {
      fetchEvents();
      fetchAnalysisAndSetups();
    }, 8000);
    return () => clearInterval(timer);
  }, []);

  // WebSocket Live Connection
  useEffect(() => {
    let isSubscribed = true;

    const connectWs = () => {
      try {
        const ws = new WebSocket(getWsUrl());
        wsRef.current = ws;

        ws.onopen = () => {
          if (!isSubscribed) return;
          setWsConnected(true);
        };

        ws.onmessage = (event) => {
          if (!isSubscribed) return;
          try {
            const msg = JSON.parse(event.data);

            if (msg.type === 'initial_state') {
              const state = msg.data;
              if (state.ticker) setTicker(state.ticker);
              if (state.orderBook) setOrderBook(state.orderBook);
              if (state.currentCandle) setCurrentCandles(state.currentCandle);
              if (state.lastClosedCandle) setLastClosedCandles(state.lastClosedCandle);
              setWsLatency(state.wsLatencyMs || 0);
            } else if (msg.type === 'ticker') {
              setTicker((prev) => {
                if (prev && msg.data.lastPrice !== prev.lastPrice) {
                  setPriceFlash(msg.data.lastPrice > prev.lastPrice ? 'up' : 'down');
                  setTimeout(() => setPriceFlash(null), 800);
                }
                return msg.data;
              });
            } else if (msg.type === 'candle_updated') {
              const c = msg.data;
              setCurrentCandles((prev) => ({ ...prev, [c.timeframe]: c }));
              if (c.timeframe === timeframe) {
                setCandles((prev) => {
                  const idx = prev.findIndex((item) => item.timestamp === c.timestamp);
                  if (idx >= 0) {
                    const next = [...prev];
                    next[idx] = c;
                    return next;
                  }
                  return [...prev, c];
                });
              }
            } else if (msg.type === 'candle_closed') {
              const c = msg.data;
              setLastClosedCandles((prev) => ({ ...prev, [c.timeframe]: c }));
              setCurrentCandles((prev) => ({ ...prev, [c.timeframe]: null }));
              if (c.timeframe === timeframe) {
                setCandles((prev) => {
                  const idx = prev.findIndex((item) => item.timestamp === c.timestamp);
                  if (idx >= 0) {
                    const next = [...prev];
                    next[idx] = c;
                    return next;
                  }
                  return [...prev, c];
                });
              }
            } else if (msg.type === 'orderbook') {
              setOrderBook(msg.data);
            } else if (msg.type === 'state') {
              if (msg.data?.killSwitchActive !== undefined) {
                setKillSwitchActive(msg.data.killSwitchActive);
              }
            } else if (msg.type === 'scenario_registered') {
              setScenarios((prev) => [msg.data, ...prev.filter((s) => s.id !== msg.data.id)]);
            } else if (
              msg.type === 'scenario_status_changed' ||
              msg.type === 'scenario_updated' ||
              msg.type === 'scenario_entry_validated'
            ) {
              const updated = msg.data?.scenario || msg.data;
              if (updated && updated.id) {
                setScenarios((prev) => {
                  const idx = prev.findIndex((s) => s.id === updated.id);
                  if (idx >= 0) {
                    const next = [...prev];
                    next[idx] = { ...next[idx], ...updated };
                    return next;
                  }
                  return [updated, ...prev];
                });
              }
            } else if (msg.type === 'signal_evaluated') {
              setSignals((prev) => [msg.data, ...prev.filter((s) => s.id !== msg.data.id)]);
            } else if (msg.type === 'signal_state_changed') {
              const { signal } = msg.data;
              setActiveSignals((prev) => {
                if (['COMPLETED_TP', 'COMPLETED_SL', 'EXPIRED', 'INVALIDATED', 'CANCELLED'].includes(signal.state)) {
                  return prev.filter((s) => s.id !== signal.id);
                }
                const idx = prev.findIndex((s) => s.id === signal.id);
                if (idx >= 0) {
                  const next = [...prev];
                  next[idx] = signal;
                  return next;
                }
                return [signal, ...prev];
              });
              setSignals((prev) => [signal, ...prev.filter((s) => s.id !== signal.id)]);
            } else if (msg.type === 'signal_metrics_updated') {
              const signal = msg.data;
              setActiveSignals((prev) => {
                const idx = prev.findIndex((s) => s.id === signal.id);
                if (idx >= 0) {
                  const next = [...prev];
                  next[idx] = { ...next[idx], ...signal };
                  return next;
                }
                return prev;
              });
            }
          } catch {}
        };

        ws.onclose = () => {
          if (!isSubscribed) return;
          setWsConnected(false);
          setTimeout(connectWs, 3000);
        };

        ws.onerror = () => {
          ws.close();
        };
      } catch {
        setTimeout(connectWs, 3000);
      }
    };

    connectWs();

    return () => {
      isSubscribed = false;
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [timeframe]);

  const priceColor =
    priceFlash === 'up'
      ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-300'
      : priceFlash === 'down'
      ? 'bg-rose-500/20 text-rose-600 dark:text-rose-300'
      : 'text-slate-900 dark:text-white';

  const is24hPositive = (ticker?.price24hPcnt || 0) >= 0;

  // Active TF analysis
  const currentTfAnalysis = analyses[timeframe];
  const swings = currentTfAnalysis?.structure?.swings || [];
  const structureBreaks = currentTfAnalysis?.structure?.structureBreaks || [];
  const fvgs = currentTfAnalysis?.structure?.fvgs || [];

  // Scenarios actively being watched by AlgorithmicWatcher
  const activeMonitoredScenarios = scenarios.filter(
    (s) =>
      ['SCENARIO_MONITORING', 'APPROACHING_ZONE', 'IN_ZONE', 'REVALIDATION_REQUESTED', 'AI_REVALIDATING', 'ENTRY_VALIDATED'].includes(s.status) &&
      s.direction !== 'NEUTRAL'
  );

  // Calculate closest distance to zone among active scenarios
  let closestPct: number | null = null;
  if (ticker?.lastPrice && activeMonitoredScenarios.length > 0) {
    for (const sc of activeMonitoredScenarios) {
      if (Number.isFinite(sc.targetEntry)) {
        const dist = (Math.abs(ticker.lastPrice - sc.targetEntry) / ticker.lastPrice) * 100;
        if (closestPct === null || dist < closestPct) {
          closestPct = dist;
        }
      }
    }
  }

  // Count longs / shorts in active scenarios
  const longScenariosCount = scenarios.filter((s) => s.direction === 'LONG').length;
  const shortScenariosCount = scenarios.filter((s) => s.direction === 'SHORT').length;

  // Filtered system events for audit tab
  const filteredEvents = systemEvents.filter((ev) => {
    if (auditFilter === 'ALL') return true;
    return ev.level === auditFilter;
  });

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#0c0f17] text-slate-800 dark:text-slate-100 flex flex-col font-sans transition-colors duration-150">
      {/* ========================================================================= */}
      {/* 1. NanoLabs Header Oficial (80px standard)                                */}
      {/* ========================================================================= */}
      <header className="h-20 border-b border-slate-200 dark:border-slate-800/80 bg-white/95 dark:bg-[#0f1422]/90 backdrop-blur-md px-4 sm:px-6 flex items-center justify-between sticky top-0 z-40 shadow-sm">
        <div className="flex items-center gap-3 sm:gap-4">
          <div className="flex items-center gap-3">
            <div
              className="w-11 h-11 rounded-2xl flex items-center justify-center shadow-lg transition-transform hover:rotate-6 cursor-pointer shrink-0"
              style={{ background: palette.gradient }}
            >
              <Activity className="w-6 h-6 text-white stroke-[2.5]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-display font-extrabold text-base sm:text-lg text-slate-900 dark:text-white tracking-wide">
                  NanoLabs AI Trading
                </h1>
                <span className="hidden sm:inline-block text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300">
                  Centro de Control Autónomo
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                BTCUSDT Perpetual · Motor Cuantitativo & Doble IA 24/7
              </p>
            </div>
          </div>

          {/* Bybit WS Status Pill */}
          <div className="hidden md:flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900/80 px-3 py-1.5 font-mono text-xs">
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                wsConnected ? 'bg-emerald-500 pulse-live shadow-emerald-500/50' : 'bg-rose-500'
              }`}
            />
            <span className="text-slate-700 dark:text-slate-300 font-semibold">
              {wsConnected ? 'Bybit WS Conectado' : 'Reconectando...'}
            </span>
            {wsConnected && (
              <span className="text-slate-400 dark:text-slate-500 text-[10px]">({wsLatency}ms)</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2.5">
          {/* Emergency Kill Switch Button */}
          <button
            onClick={handleToggleKillSwitch}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-mono font-bold transition-all cursor-pointer border ${
              killSwitchActive
                ? 'bg-rose-500/20 text-rose-600 dark:text-rose-400 border-rose-500/40 animate-pulse'
                : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20'
            }`}
            title="Hacer clic para activar o desactivar parada de emergencia de señales"
          >
            <Power className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Kill Switch:</span>
            <span>{killSwitchActive ? 'ACTIVADO' : 'STANDBY OK'}</span>
          </button>

          {/* Config Center Button */}
          <button
            onClick={() => setIsConfigModalOpen(true)}
            className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl border border-orange-500/30 bg-orange-500/10 hover:bg-orange-500/20 text-orange-600 dark:text-orange-400 transition-all cursor-pointer text-xs font-semibold shadow-sm"
            title="Centro de Configuración y Riesgo"
          >
            <Settings className="w-4 h-4" />
            <span className="hidden md:inline">Configuración</span>
            {configSummary?.routerMode && (
              <span className="hidden lg:inline text-[10px] font-mono px-1.5 py-0.5 rounded bg-orange-100 dark:bg-orange-950/80 border border-orange-300 dark:border-orange-800 text-orange-700 dark:text-orange-300">
                {configSummary.routerMode === 'AUTOMATIC' ? 'AUTO' : configSummary.routerMode}
              </span>
            )}
          </button>

          {/* Notifications Modal Button */}
          <button
            onClick={() => setIsNotificationsModalOpen(true)}
            className="p-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900/80 text-amber-500 dark:text-amber-400 hover:text-amber-600 dark:hover:text-amber-300 transition-all cursor-pointer"
            title="Centro de Notificaciones 24/7 (Telegram & Web Push PWA)"
          >
            <Bell className="w-4 h-4" />
          </button>

          {/* ART Clock */}
          <div className="hidden xl:flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900/80 px-3 py-1.5 font-mono text-xs text-slate-700 dark:text-slate-300">
            <Clock className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" />
            <span>{argentinaTime || 'Hora AR'}</span>
            <span className="text-[10px] text-slate-400 dark:text-slate-500">ART</span>
          </div>

          {/* NanoLabs Official Palette Selector */}
          <PaletteSelector />

          {/* Light / Dark Mode Toggle */}
          <button
            onClick={toggleDarkMode}
            className="p-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900/80 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-all cursor-pointer"
            title="Alternar tema claro/oscuro (Theme 2 oficial)"
          >
            {isDark ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-slate-600" />}
          </button>
        </div>
      </header>

      {/* ========================================================================= */}
      {/* 2. Operational Security & Mode Bar                                        */}
      {/* ========================================================================= */}
      <div className="bg-slate-100/90 dark:bg-slate-900/90 border-b border-slate-200 dark:border-slate-800/80 px-4 sm:px-6 py-2 flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
            <Shield className="w-4 h-4" />
            <span className="font-bold">MODO: SIGNALS_ONLY</span>
          </div>
          <span className="text-slate-300 dark:text-slate-600 hidden sm:inline">|</span>
          <span className="text-slate-500 dark:text-slate-400 hidden sm:inline">
            Ejecución Real: <strong className="text-rose-500 dark:text-rose-400">DESHABILITADA (Paper Trading)</strong>
          </span>
          <span className="text-slate-300 dark:text-slate-600 hidden md:inline">|</span>
          <span className="text-slate-500 dark:text-slate-400 hidden md:inline">
            Vigilancia Algorítmica: <strong className="text-sky-500 dark:text-sky-400">LOCAL (0 tokens por tick)</strong>
          </span>
        </div>

        <div className="flex items-center flex-wrap gap-2.5 sm:gap-3 text-slate-600 dark:text-slate-400">
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400 dark:text-slate-500">Presupuesto IA:</span>
            <span className="font-bold text-slate-800 dark:text-slate-200">
              ${(configSummary?.grossSpentTodayUsd ?? 0).toFixed(4)}
            </span>
            <span className="text-amber-500 dark:text-amber-400 text-[11px]">
              +${(configSummary?.reservedPendingUsd ?? 0).toFixed(4)} res
            </span>
            <span className="text-slate-400 dark:text-slate-500">
              / ${(configSummary?.dailyBudgetUsd ?? 0.50).toFixed(2)}
            </span>
            {(configSummary?.isBudgetBlocked || aiStatus?.isBudgetBlocked) && (
              <span className="px-1.5 py-0.5 rounded text-[10px] bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-300 border border-red-300 dark:border-red-700 font-bold">
                PAUSADO
              </span>
            )}
          </div>
          <span className="text-slate-300 dark:text-slate-600 hidden sm:inline">|</span>
          <span>Riesgo: <strong className="text-slate-700 dark:text-slate-200">{configSummary?.maxRiskPerTradePercentage || 0.5}%</strong></span>
          <span className="text-slate-300 dark:text-slate-600 hidden sm:inline">|</span>
          <span>Tope SL: <strong className="text-amber-500 dark:text-amber-400">≤ {configSummary?.maxStopLossPercentage || 1.5}%</strong></span>
          <span className="text-slate-300 dark:text-slate-600 hidden sm:inline">|</span>
          <span>R:R Neto: <strong className="text-emerald-600 dark:text-emerald-400">≥ 1:{configSummary?.minNetRiskReward || 4.0}</strong></span>
        </div>
      </div>

      {/* Main Body */}
      <main className="flex-1 p-4 sm:p-6 space-y-5 max-w-[1720px] w-full mx-auto">
        {/* ========================================================================= */}
        {/* 3. Budget Limit Alert Banners (if active)                                  */}
        {/* ========================================================================= */}
        {(configSummary?.isBudgetBlocked || aiStatus?.isBudgetBlocked) && (
          <div className="p-3.5 rounded-2xl bg-red-50 dark:bg-red-950/40 border border-red-300 dark:border-red-700/60 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs text-red-800 dark:text-red-200 shadow-sm">
            <div className="flex items-center gap-2.5">
              <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
              <span>
                <strong>IA pausada por control de presupuesto diario.</strong> {' '}
                {configSummary?.budgetBlockedReason || aiStatus?.blockedReason || 'Revisá el límite en Configuración.'} {' '}
                Gasto bruto hoy: ${(configSummary?.grossSpentTodayUsd ?? 0).toFixed(4)};
                reservas: ${(configSummary?.reservedPendingUsd ?? 0).toFixed(4)};
                límite: ${(configSummary?.dailyBudgetUsd ?? 0.50).toFixed(2)} USD.
                Bybit, el motor SMC y el monitoreo técnico continúan 100% operativos.
              </span>
            </div>
            <button
              onClick={() => setIsConfigModalOpen(true)}
              className="px-3 py-1 rounded-lg bg-red-600 hover:bg-red-700 text-white font-bold text-xs shrink-0 cursor-pointer shadow-sm"
            >
              Ajustar Presupuesto
            </button>
          </div>
        )}

        {/* ========================================================================= */}
        {/* 4. Executive KPI Ribbon (Answers the 6 Core Acceptance Questions)          */}
        {/* ========================================================================= */}
        <section aria-label="Cinta Ejecutiva del Centro de Control">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
            {/* Pregunta 1: ¿Qué está haciendo NanoTrading? */}
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1422] p-3.5 shadow-sm">
              <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-1">
                <span className="text-[10px] font-mono uppercase tracking-wider font-semibold">1. Estado Operativo</span>
                <Activity className="w-3.5 h-3.5 text-emerald-500" />
              </div>
              <div className="text-sm font-display font-extrabold text-slate-900 dark:text-white truncate">
                {killSwitchActive ? 'PAUSADO (Kill Switch)' : wsConnected ? 'Vigilando BTCUSDT 24/7' : 'Reconectando stream'}
              </div>
              <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400 mt-1 truncate">
                {activeSignals.length > 0 ? `${activeSignals.length} señal(es) en tracking` : '0 llamadas IA por ticks'}
              </p>
            </div>

            {/* Pregunta 2: ¿Qué detectó la IA? */}
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1422] p-3.5 shadow-sm">
              <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-1">
                <span className="text-[10px] font-mono uppercase tracking-wider font-semibold">2. Tesis de IA</span>
                <Brain className="w-3.5 h-3.5 text-purple-500" />
              </div>
              <div className="text-sm font-display font-extrabold text-slate-900 dark:text-white truncate">
                {longScenariosCount > shortScenariosCount
                  ? 'Sesgo Alza (Bullish)'
                  : shortScenariosCount > longScenariosCount
                  ? 'Sesgo Baja (Bearish)'
                  : 'Consenso Neutral'}
              </div>
              <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400 mt-1 truncate">
                {longScenariosCount} Long · {shortScenariosCount} Short detectados
              </p>
            </div>

            {/* Pregunta 3: ¿Qué zonas está vigilando? */}
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1422] p-3.5 shadow-sm">
              <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-1">
                <span className="text-[10px] font-mono uppercase tracking-wider font-semibold">3. Zonas en Vigilancia</span>
                <Radar className="w-3.5 h-3.5 text-sky-500" />
              </div>
              <div className="text-sm font-display font-extrabold text-slate-900 dark:text-white truncate">
                {activeMonitoredScenarios.length} Zonas Activas
              </div>
              <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400 mt-1 truncate">
                {closestPct !== null ? `Más próxima a ${closestPct.toFixed(2)}%` : 'Sin zonas inmediatas'}
              </p>
            </div>

            {/* Pregunta 4: ¿Qué necesita para confirmar una entrada? */}
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1422] p-3.5 shadow-sm">
              <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-1">
                <span className="text-[10px] font-mono uppercase tracking-wider font-semibold">4. Criterio de Entrada</span>
                <ShieldCheck className="w-3.5 h-3.5 text-amber-500" />
              </div>
              <div className="text-sm font-display font-extrabold text-slate-900 dark:text-white truncate">
                Retesteo + R:R ≥ 1:4
              </div>
              <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400 mt-1 truncate">
                Velas 5m/15m confirmadas
              </p>
            </div>

            {/* Pregunta 5: ¿Cuánto está gastando? */}
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1422] p-3.5 shadow-sm">
              <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-1">
                <span className="text-[10px] font-mono uppercase tracking-wider font-semibold">5. Consumo IA</span>
                <DollarSign className="w-3.5 h-3.5 text-emerald-500" />
              </div>
              <div className="text-sm font-mono font-extrabold text-slate-900 dark:text-white truncate">
                ${(configSummary?.grossSpentTodayUsd ?? 0).toFixed(4)} USD
              </div>
              <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400 mt-1 truncate">
                Tope: ${(configSummary?.dailyBudgetUsd ?? 0.50).toFixed(2)} · {configSummary?.isBudgetBlocked ? 'Pausado' : 'Dentro de cuota'}
              </p>
            </div>

            {/* Pregunta 6: ¿Qué señales generó y cómo evolucionaron? */}
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1422] p-3.5 shadow-sm">
              <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-1">
                <span className="text-[10px] font-mono uppercase tracking-wider font-semibold">6. Señales & Paper</span>
                <TrendingUp className="w-3.5 h-3.5 text-indigo-500" />
              </div>
              <div className="text-sm font-display font-extrabold text-slate-900 dark:text-white truncate">
                {activeSignals.length} en Tracking
              </div>
              <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400 mt-1 truncate">
                {signals.length} señales registradas históricas
              </p>
            </div>
          </div>
        </section>

        {/* ========================================================================= */}
        {/* 5. Live Market Ticker Ribbon                                               */}
        {/* ========================================================================= */}
        <section aria-label="Cotizaciones de Mercado en Tiempo Real">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1422] p-3.5 shadow-sm">
              <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">
                Precio Last
              </p>
              <div className={`text-xl sm:text-2xl font-mono font-extrabold transition-all rounded px-1 -mx-1 ${priceColor}`}>
                ${ticker ? ticker.lastPrice.toLocaleString('en-US', { minimumFractionDigits: 1 }) : '---'}
              </div>
              <div className="flex items-center gap-1 mt-1 text-xs font-mono">
                <span className={`flex items-center font-bold ${is24hPositive ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                  {is24hPositive ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
                  {ticker ? `${(ticker.price24hPcnt * 100).toFixed(2)}%` : '0.00%'}
                </span>
                <span className="text-slate-400 dark:text-slate-500 text-[10px]">24h</span>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1422] p-3.5 shadow-sm">
              <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">
                Mark / Index Price
              </p>
              <div className="text-base sm:text-lg font-mono font-bold text-slate-800 dark:text-slate-200">
                ${ticker ? ticker.markPrice.toFixed(1) : '---'}
              </div>
              <p className="text-xs font-mono text-slate-500 dark:text-slate-400 mt-1">
                Index: ${ticker ? ticker.indexPrice.toFixed(1) : '---'}
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1422] p-3.5 shadow-sm">
              <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">
                Spread Bid-Ask
              </p>
              <div className="text-base sm:text-lg font-mono font-bold text-amber-500 dark:text-amber-400">
                ${ticker ? ticker.spread.toFixed(2) : '---'}
              </div>
              <p className="text-xs font-mono text-slate-500 dark:text-slate-400 mt-1">
                {ticker ? `${ticker.spreadPcnt.toFixed(4)}%` : '---'}
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1422] p-3.5 shadow-sm">
              <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">
                Indicadores ({timeframe})
              </p>
              <div className="text-xs font-mono text-slate-800 dark:text-slate-200 font-semibold">
                RSI: <span className="text-amber-500 dark:text-amber-400">{currentTfAnalysis?.rsi || '50.0'}</span>
              </div>
              <div className="text-xs font-mono text-slate-500 dark:text-slate-400 mt-1">
                ATR: ${currentTfAnalysis?.atr || '---'} | RVOL: {currentTfAnalysis?.relativeVolume || '1.0'}x
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1422] p-3.5 shadow-sm">
              <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">
                Funding Rate
              </p>
              <div className="text-base sm:text-lg font-mono font-bold text-purple-600 dark:text-purple-400">
                {ticker ? `${(ticker.fundingRate * 100).toFixed(4)}%` : '---'}
              </div>
              <p className="text-xs font-mono text-slate-500 dark:text-slate-400 mt-1">
                Intervalo 8h Bybit
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1422] p-3.5 shadow-sm">
              <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">
                Open Interest
              </p>
              <div className="text-base sm:text-lg font-mono font-bold text-blue-600 dark:text-blue-400">
                {ticker ? `${ticker.openInterest.toFixed(0)} BTC` : '---'}
              </div>
              <p className="text-xs font-mono text-slate-500 dark:text-slate-400 mt-1">
                Vol: {ticker ? `${(ticker.volume24h / 1000).toFixed(1)}k BTC` : '---'}
              </p>
            </div>
          </div>
        </section>

        {/* ========================================================================= */}
        {/* 6. Navigation Tabs Bar (Zero Unsolicited AI Token Consumption)             */}
        {/* ========================================================================= */}
        <nav aria-label="Navegación del Centro de Control" className="flex items-center gap-1.5 sm:gap-2 border-b border-slate-200 dark:border-slate-800 pb-2 overflow-x-auto custom-scrollbar">
          <button
            onClick={() => setActiveMainTab('terminal')}
            className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-display font-bold transition-all cursor-pointer whitespace-nowrap ${
              activeMainTab === 'terminal'
                ? 'bg-[var(--color-brand,#FF6600)] text-white shadow-md'
                : 'bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <LayoutDashboard className="w-4 h-4" />
            <span>Terminal Operativo</span>
          </button>

          <button
            onClick={() => setActiveMainTab('scenarios')}
            className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-display font-bold transition-all cursor-pointer whitespace-nowrap ${
              activeMainTab === 'scenarios'
                ? 'bg-[var(--color-brand,#FF6600)] text-white shadow-md'
                : 'bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Radar className="w-4 h-4" />
            <span>Escenarios IA</span>
            <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
              activeMainTab === 'scenarios' ? 'bg-white/20 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
            }`}>
              {scenarios.length}
            </span>
          </button>

          <button
            onClick={() => setActiveMainTab('signals')}
            className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-display font-bold transition-all cursor-pointer whitespace-nowrap ${
              activeMainTab === 'signals'
                ? 'bg-[var(--color-brand,#FF6600)] text-white shadow-md'
                : 'bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <TrendingUp className="w-4 h-4" />
            <span>Señales & Paper</span>
            {activeSignals.length > 0 && (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono bg-emerald-500 text-white animate-pulse">
                {activeSignals.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveMainTab('analysts')}
            className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-display font-bold transition-all cursor-pointer whitespace-nowrap ${
              activeMainTab === 'analysts'
                ? 'bg-[var(--color-brand,#FF6600)] text-white shadow-md'
                : 'bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Brain className="w-4 h-4" />
            <span>Análisis IA & Consenso</span>
          </button>

          <button
            onClick={() => setActiveMainTab('audit')}
            className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-display font-bold transition-all cursor-pointer whitespace-nowrap ${
              activeMainTab === 'audit'
                ? 'bg-[var(--color-brand,#FF6600)] text-white shadow-md'
                : 'bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Database className="w-4 h-4" />
            <span>Auditoría & Eventos</span>
            <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
              activeMainTab === 'audit' ? 'bg-white/20 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
            }`}>
              {systemEvents.length}
            </span>
          </button>

          <button
            onClick={() => setActiveMainTab('lab')}
            className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-display font-bold transition-all cursor-pointer whitespace-nowrap ${
              activeMainTab === 'lab'
                ? 'bg-[var(--color-brand,#FF6600)] text-white shadow-md'
                : 'bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Zap className="w-4 h-4" />
            <span>Laboratorio</span>
          </button>
        </nav>

        {/* ========================================================================= */}
        {/* 7. Tab View 1: TERMINAL OPERATIVO (Chart + Watcher + OrderBook + MTF)     */}
        {/* ========================================================================= */}
        {activeMainTab === 'terminal' && (
          <div className="space-y-5">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
              {/* Left Column (lg: 2/3): CandleChart */}
              <div className="lg:col-span-2 space-y-5">
                <CandleChart
                  candles={candles}
                  currentCandle={currentCandles[timeframe]}
                  timeframe={timeframe}
                  onTimeframeChange={setTimeframe}
                  swings={swings}
                  structureBreaks={structureBreaks}
                  fvgs={fvgs}
                  scenarios={scenarios}
                  selectedScenarioId={selectedScenarioId}
                  onSelectScenario={setSelectedScenarioId}
                  symbol="BTCUSDT"
                  isDark={isDark}
                />
              </div>

              {/* Right Column (lg: 1/3): Watcher Sidebar + OrderBook L2 */}
              <div className="lg:col-span-1 space-y-5">
                {/* Watcher de Zonas en Vivo */}
                <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1422] p-4 shadow-xl">
                  <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800/80 mb-3">
                    <div className="flex items-center gap-2">
                      <Radar className="w-4 h-4 text-sky-500 animate-pulse" />
                      <h3 className="font-display font-bold text-sm text-slate-800 dark:text-slate-200 uppercase tracking-wider">
                        Watcher de Zonas ({activeMonitoredScenarios.length})
                      </h3>
                    </div>
                    <span className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                      Algorítmico Local
                    </span>
                  </div>

                  {activeMonitoredScenarios.length === 0 ? (
                    <div className="p-4 text-center rounded-xl border border-dashed border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40">
                      <Crosshair className="w-8 h-8 text-slate-400 dark:text-slate-600 mx-auto mb-1.5 opacity-60" />
                      <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                        Sin zonas activas bajo vigilancia
                      </p>
                      <p className="text-[11px] font-mono text-slate-500 mt-1">
                        El motor SMC y las IAs evalúan el mercado en cada intervalo programado sin consumo continuo de tokens.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2.5 max-h-[320px] overflow-y-auto custom-scrollbar pr-1">
                      {activeMonitoredScenarios.map((sc) => {
                        const isSelected = selectedScenarioId === sc.id;
                        const distPct = ticker?.lastPrice && sc.targetEntry
                          ? ((Math.abs(ticker.lastPrice - sc.targetEntry) / ticker.lastPrice) * 100).toFixed(2)
                          : null;
                        const isLong = sc.direction === 'LONG';

                        return (
                          <div
                            key={sc.id}
                            onClick={() => setSelectedScenarioId(isSelected ? null : sc.id)}
                            className={`p-2.5 rounded-xl border transition-all cursor-pointer ${
                              isSelected
                                ? 'border-[var(--color-brand,#FF6600)] bg-orange-50/60 dark:bg-slate-900 ring-1 ring-[var(--color-brand,#FF6600)]/40 shadow-sm'
                                : 'border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 hover:bg-slate-100 dark:hover:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700'
                            }`}
                          >
                            <div className="flex items-center justify-between mb-1.5">
                              <div className="flex items-center gap-1.5">
                                <span
                                  className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold ${
                                    isLong
                                      ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
                                      : 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30'
                                  }`}
                                >
                                  {sc.direction}
                                </span>
                                <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400">
                                  {sc.timeframe || '15m'}
                                </span>
                              </div>
                              <span
                                className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${
                                  sc.status === 'ENTRY_VALIDATED'
                                    ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-300 border border-emerald-500/40'
                                    : sc.status === 'IN_ZONE'
                                    ? 'bg-purple-500/20 text-purple-600 dark:text-purple-300 border border-purple-500/40 animate-pulse'
                                    : 'bg-sky-500/15 text-sky-600 dark:text-sky-300 border border-sky-500/30'
                                }`}
                              >
                                {sc.status === 'ENTRY_VALIDATED'
                                  ? 'AUTORIZADO'
                                  : sc.status === 'IN_ZONE'
                                  ? 'EN ZONA'
                                  : 'VIGILANDO'}
                              </span>
                            </div>

                            <div className="grid grid-cols-3 gap-1.5 font-mono text-[11px] mb-1.5">
                              <div>
                                <span className="text-[9px] text-slate-400 dark:text-slate-500 block">ENTRADA</span>
                                <span className="font-bold text-slate-800 dark:text-slate-200">${sc.targetEntry?.toFixed(1)}</span>
                              </div>
                              <div>
                                <span className="text-[9px] text-slate-400 dark:text-slate-500 block">STOP LOSS</span>
                                <span className="font-bold text-rose-500 dark:text-rose-400">${sc.stopLossPrice?.toFixed(1)}</span>
                              </div>
                              <div>
                                <span className="text-[9px] text-slate-400 dark:text-slate-500 block">TP 1:4</span>
                                <span className="font-bold text-emerald-600 dark:text-emerald-400">
                                  {sc.target14Price ? `$${sc.target14Price.toFixed(1)}` : '---'}
                                </span>
                              </div>
                            </div>

                            <div className="flex items-center justify-between text-[10px] font-mono pt-1.5 border-t border-slate-200 dark:border-slate-800/80 text-slate-500">
                              <span>Distancia: <strong className="text-slate-700 dark:text-slate-300">{distPct ? `${distPct}%` : '---'}</strong></span>
                              <span className="text-[var(--color-brand,#FF6600)] font-semibold flex items-center gap-0.5">
                                <Eye className="w-3 h-3" />
                                {isSelected ? 'Viendo en gráfico' : 'Clic para resaltar'}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Order Book Widget */}
                <OrderBookWidget orderBook={orderBook} />
              </div>
            </div>

            {/* Multi-Timeframe Matrix */}
            <MultiTimeframeMatrix
              currentCandles={currentCandles}
              lastClosedCandles={lastClosedCandles}
              activeTimeframe={timeframe}
              onSelectTimeframe={setTimeframe}
            />
          </div>
        )}

        {/* ========================================================================= */}
        {/* 8. Tab View 2: ESCENARIOS IA & INTELIGENCIA (AiTradingIntelligence)       */}
        {/* ========================================================================= */}
        {activeMainTab === 'scenarios' && (
          <div className="space-y-4">
            <AiTradingIntelligence />
          </div>
        )}

        {/* ========================================================================= */}
        {/* 9. Tab View 3: SEÑALES & PAPER TRADING (SignalLifecycleMonitor)           */}
        {/* ========================================================================= */}
        {activeMainTab === 'signals' && (
          <div className="space-y-4">
            <SignalLifecycleMonitor
              activeSignals={activeSignals}
              onCancelSignal={handleCancelSignal}
              onRefresh={fetchAnalysisAndSetups}
            />
          </div>
        )}

        {/* ========================================================================= */}
        {/* 10. Tab View 4: ANÁLISIS IA & CONSENSO (AiAnalystsCard)                   */}
        {/* ========================================================================= */}
        {activeMainTab === 'analysts' && (
          <div className="space-y-4">
            <AiAnalystsCard aiStatus={aiStatus} signals={signals} aiReviews={aiReviews} />
          </div>
        )}

        {/* ========================================================================= */}
        {/* 11. Tab View 5: AUDITORÍA & EVENTOS DEL SISTEMA                           */}
        {/* ========================================================================= */}
        {activeMainTab === 'audit' && (
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1422] p-4 sm:p-5 shadow-xl space-y-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800/80 gap-3">
              <div className="flex items-center gap-2.5">
                <Database className="w-5 h-5 text-slate-500 dark:text-slate-400" />
                <div>
                  <h3 className="font-display font-bold text-sm sm:text-base text-slate-800 dark:text-slate-200 uppercase tracking-wider">
                    Registro de Eventos del Sistema & Auditoría
                  </h3>
                  <p className="text-[11px] font-mono text-slate-500">
                    Persistencia garantizada en SQLite WAL / PostgreSQL
                  </p>
                </div>
              </div>

              {/* Log Level Filter Toolbar */}
              <div className="flex items-center gap-1.5 flex-wrap">
                {(['ALL', 'CRITICAL', 'ERROR', 'WARN', 'INFO'] as const).map((lvl) => (
                  <button
                    key={lvl}
                    onClick={() => setAuditFilter(lvl)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-mono font-bold transition-all cursor-pointer ${
                      auditFilter === lvl
                        ? 'bg-[var(--color-brand,#FF6600)] text-white shadow-sm'
                        : 'bg-slate-100 dark:bg-slate-800/60 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    {lvl}
                  </button>
                ))}
              </div>
            </div>

            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full text-left font-mono text-xs min-w-[700px]">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-400 dark:text-slate-500 text-[11px]">
                    <th className="pb-2.5">Hora (ART)</th>
                    <th className="pb-2.5">Nivel</th>
                    <th className="pb-2.5">Componente</th>
                    <th className="pb-2.5">Mensaje</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/50">
                  {filteredEvents.length > 0 ? (
                    filteredEvents.map((ev, i) => (
                      <tr key={ev.id || i} className="hover:bg-slate-50 dark:hover:bg-slate-900/40">
                        <td className="py-2.5 text-slate-500 dark:text-slate-400 whitespace-nowrap">
                          {new Date(ev.timestamp).toLocaleTimeString('es-AR', {
                            timeZone: 'America/Argentina/Buenos_Aires',
                          })}
                        </td>
                        <td className="py-2.5">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                              ev.level === 'CRITICAL'
                                ? 'bg-rose-500/20 text-rose-600 dark:text-rose-400 border border-rose-500/40'
                                : ev.level === 'ERROR'
                                ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20'
                                : ev.level === 'WARN'
                                ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20'
                                : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                            }`}
                          >
                            {ev.level}
                          </span>
                        </td>
                        <td className="py-2.5 text-slate-700 dark:text-slate-300 font-semibold">{ev.component}</td>
                        <td className="py-2.5 text-slate-600 dark:text-slate-400">{ev.message}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={4} className="py-8 text-center text-slate-400 dark:text-slate-600">
                        No hay eventos registrados para el filtro seleccionado.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* 12. Tab View 6: LABORATORIO CUANTITATIVO (TradingLaboratory)              */}
        {/* ========================================================================= */}
        {activeMainTab === 'lab' && (
          <div className="space-y-4">
            <TradingLaboratory />
          </div>
        )}
      </main>

      {/* ========================================================================= */}
      {/* 13. Footer Oficial NanoLabs                                               */}
      {/* ========================================================================= */}
      <footer className="border-t border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0f1422] py-4 px-6 text-center text-xs text-slate-500 font-mono flex flex-wrap items-center justify-between gap-3 mt-8">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-500" />
          <span>NanoLabs AI Trading · Motor Cuantitativo 24/7 · Bybit V5 Linear</span>
        </div>
        <div>
          <span>Powered by <strong>NanoLabs</strong></span>
        </div>
      </footer>

      {/* ========================================================================= */}
      {/* 14. Modales Globales                                                      */}
      {/* ========================================================================= */}
      <NotificationsModal
        isOpen={isNotificationsModalOpen}
        onClose={() => setIsNotificationsModalOpen(false)}
      />

      <ConfigCenterModal
        isOpen={isConfigModalOpen}
        onClose={() => setIsConfigModalOpen(false)}
        onConfigChanged={fetchConfigSummary}
      />
    </div>
  );
}
