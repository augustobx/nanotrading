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
  Crosshair,
  TrendingUp,
  AlertTriangle,
  Bell,
  Power,
  Radio,
  Settings,
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

import { getApiBaseUrl, getWebSocketLiveUrl } from '../utils/api-config';

const getApiBase = getApiBaseUrl;
const getWsUrl = getWebSocketLiveUrl;

export default function DashboardPage() {
  const { palette, isDark, toggleDarkMode } = useERPTheme();

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

  // Phase 2 Quantitative Engine State
  const [analyses, setAnalyses] = useState<Record<string, any>>({});
  const [setups, setSetups] = useState<any[]>([]);

  // Phase 3 Dual AI & Consensus State
  const [aiStatus, setAiStatus] = useState<any | null>(null);
  const [signals, setSignals] = useState<any[]>([]);
  const [aiReviews, setAiReviews] = useState<any[]>([]);

  // Phase 4 State Machine & Notifications
  const [activeSignals, setActiveSignals] = useState<any[]>([]);
  const [isNotificationsModalOpen, setIsNotificationsModalOpen] = useState<boolean>(false);
  const [killSwitchActive, setKillSwitchActive] = useState<boolean>(false);

  // Phase 4.5 Configuration Center & AI Router
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
      await fetch(`${getApiBase()}/api/v1/signals/${signalId}/cancel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
      });
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
        headers: {
          'Content-Type': 'application/json',
        },
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
      const [anRes, setRes, aiRes, sigRes, revRes, actSigRes, stRes] = await Promise.all([
        fetch(`${getApiBase()}/api/v1/market/analysis`),
        fetch(`${getApiBase()}/api/v1/market/setups`),
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
      if (setRes.ok) {
        const setData = await setRes.json();
        if (setData.success) setSetups(setData.data);
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
      const res = await fetch(`${getApiBase()}/api/v1/events?limit=8`);
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
            } else if (msg.type === 'setup_detected') {
              setSetups((prev) => [msg.data, ...prev]);
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
      ? 'bg-emerald-500/20 text-emerald-300'
      : priceFlash === 'down'
      ? 'bg-rose-500/20 text-rose-300'
      : 'text-white';

  const is24hPositive = (ticker?.price24hPcnt || 0) >= 0;

  // Active TF analysis
  const currentTfAnalysis = analyses[timeframe];
  const swings = currentTfAnalysis?.structure?.swings || [];
  const structureBreaks = currentTfAnalysis?.structure?.structureBreaks || [];
  const fvgs = currentTfAnalysis?.structure?.fvgs || [];

  return (
    <div className="min-h-screen bg-[#0c0f17] text-slate-100 flex flex-col">
      {/* NanoLabs Header Oficial (80px standard) */}
      <header className="h-20 border-b border-slate-800/80 bg-[#0f1422]/90 backdrop-blur-md px-4 sm:px-6 flex items-center justify-between sticky top-0 z-40">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3">
            <div
              className="w-11 h-11 rounded-2xl flex items-center justify-center shadow-lg transition-transform hover:rotate-6 cursor-pointer"
              style={{ background: palette.gradient }}
            >
              <Activity className="w-6 h-6 text-white stroke-[2.5]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-display font-extrabold text-base sm:text-lg text-white tracking-wide">
                  NanoLabs AI Trading
                </h1>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-slate-300">
                  Fase 4 Activa
                </span>
              </div>
              <p className="text-[11px] text-slate-400 font-mono">
                BTCUSDT Perpetual · Motor Cuantitativo & IA 24/7
              </p>
            </div>
          </div>

          <div className="hidden md:flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/80 px-3 py-1.5 font-mono text-xs">
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                wsConnected ? 'bg-emerald-500 pulse-live shadow-emerald-500/50' : 'bg-rose-500'
              }`}
            />
            <span className="text-slate-300 font-semibold">
              {wsConnected ? 'Bybit WS Activo' : 'Reconectando...'}
            </span>
            {wsConnected && (
              <span className="text-slate-500 text-[10px]">({wsLatency}ms)</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <button
            onClick={() => setIsConfigModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-orange-500/30 bg-orange-500/10 hover:bg-orange-500/20 text-orange-400 hover:text-orange-300 transition-all cursor-pointer text-xs font-semibold shadow-sm"
            title="Centro de Configuración y Riesgo (Fase 4.5)"
          >
            <Settings className="w-4 h-4" />
            <span className="hidden sm:inline">Configuración</span>
            {configSummary?.routerMode && (
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-orange-950/80 border border-orange-800 text-orange-300">
                {configSummary.routerMode === 'AUTOMATIC' ? 'AUTO' : configSummary.routerMode}
              </span>
            )}
          </button>

          <button
            onClick={() => setIsNotificationsModalOpen(true)}
            className="p-2 rounded-xl border border-slate-800 bg-slate-900/80 text-amber-400 hover:text-amber-300 hover:border-slate-700 transition-all cursor-pointer relative"
            title="Centro de Notificaciones 24/7 (Telegram & Web Push PWA)"
          >
            <Bell className="w-4 h-4" />
          </button>

          <div className="hidden lg:flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-900/80 px-3 py-1.5 font-mono text-xs text-slate-300">
            <Clock className="w-3.5 h-3.5 text-slate-400" />
            <span>{argentinaTime || 'Hora AR'}</span>
            <span className="text-[10px] text-slate-500">ART</span>
          </div>

          <PaletteSelector />

          <button
            onClick={toggleDarkMode}
            className="p-2 rounded-xl border border-slate-800 bg-slate-900/80 text-slate-300 hover:text-white transition-all cursor-pointer"
            title="Alternar tema claro/oscuro"
          >
            {isDark ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-slate-400" />}
          </button>
        </div>
      </header>

      {/* Operational Security Bar */}
      <div className="bg-slate-900/90 border-b border-slate-800/80 px-4 sm:px-6 py-2 flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-emerald-400">
            <Shield className="w-4 h-4" />
            <span className="font-bold">MODO: SIGNALS_ONLY</span>
          </div>
          <span className="text-slate-600 hidden sm:inline">|</span>
          <span className="text-slate-400 hidden sm:inline">
            Ejecución Real: <strong className="text-rose-400">DESHABILITADA</strong>
          </span>
          <span className="text-slate-600 hidden md:inline">|</span>
          <button
            onClick={handleToggleKillSwitch}
            className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-mono font-bold transition-all cursor-pointer ${
              killSwitchActive
                ? 'bg-rose-500/20 text-rose-400 border border-rose-500/40 animate-pulse'
                : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20'
            }`}
            title="Hacer clic para activar o desactivar parada de emergencia"
          >
            <Power className="w-3.5 h-3.5" />
            Kill Switch: <strong>{killSwitchActive ? 'ACTIVADO (BLOQUEO)' : 'STANDBY OK'}</strong>
          </button>
        </div>
        <div className="flex items-center flex-wrap gap-3 text-slate-400">
          <div className="hidden lg:flex items-center gap-1.5 text-slate-300">
            <span className="text-slate-500">Router:</span>
            <span className="text-orange-400 font-bold">{configSummary?.routerMode || 'AUTOMATIC'}</span>
            <span className="text-[11px] text-slate-500">({configSummary?.activeProfile || 'BALANCED'})</span>
          </div>
          <span className="text-slate-600 hidden lg:inline">|</span>
          <div className="hidden xl:flex items-center gap-1.5 text-slate-300">
            <span className="text-slate-500">Presupuesto IA:</span>
            <span className="text-white font-mono">${(configSummary?.spentTodayUsd || 0).toFixed(3)}</span>
            <span className="text-slate-500">/ ${configSummary?.dailyBudgetUsd || 0.50}</span>
            {(configSummary?.isBudgetBlocked || aiStatus?.isBudgetBlocked) && (
              <span className="px-1.5 py-0.5 rounded text-[10px] bg-red-950 text-red-300 border border-red-700 font-bold animate-pulse">
                AGOTADO
              </span>
            )}
          </div>
          <span className="text-slate-600 hidden xl:inline">|</span>
          <span>Riesgo Máx: <strong className="text-slate-200">{configSummary?.maxRiskPerTradePercentage || 0.5}% (${configSummary?.maxRiskPerTradeUsdt || 50} USDT)</strong></span>
          <span className="text-slate-600 hidden sm:inline">|</span>
          <span>Tope SL: <strong className="text-amber-400">≤ {configSummary?.maxStopLossPercentage || 1.5}%</strong></span>
          <span className="text-slate-600 hidden sm:inline">|</span>
          <span>R:R Neto: <strong className="text-emerald-400">≥ 1:{configSummary?.minNetRiskReward || 4.0}</strong></span>
        </div>
      </div>

      {/* Main Content Area */}
      <main className="flex-1 p-4 sm:p-6 space-y-5 max-w-[1700px] w-full mx-auto">
        {/* Hard Budget Limit Suspension Banner (Fase 4.6) */}
        {(configSummary?.isBudgetBlocked || aiStatus?.isBudgetBlocked || aiStatus?.currentMode === 'AI_BUDGET_EXCEEDED') && (
          <div className="p-3.5 rounded-2xl bg-red-950/40 border border-red-700/60 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs text-red-200 shadow-md">
            <div className="flex items-center gap-2.5">
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 animate-pulse" />
              <span>
                <strong>Límite Presupuestario de IA Alcanzado:</strong> Las llamadas a OpenAI/Gemini están detenidas preventivamente (Fase 4.6). El motor de Bybit, gráficos, detección técnica de setups y gestión de riesgo permanecen 100% operativos.
              </span>
            </div>
            <button
              onClick={() => setIsConfigModalOpen(true)}
              className="px-3 py-1 rounded bg-red-900 hover:bg-red-800 text-white font-bold text-xs shrink-0 cursor-pointer"
            >
              Ajustar / Reactivar Presupuesto
            </button>
          </div>
        )}
        {/* Ticker Ribbon */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="rounded-2xl border border-slate-800 bg-[#0f1422] p-3.5 shadow-md">
            <p className="text-[11px] font-mono text-slate-400 uppercase tracking-wider mb-1">
              Precio Last
            </p>
            <div className={`text-xl sm:text-2xl font-mono font-extrabold transition-all rounded px-1 -mx-1 ${priceColor}`}>
              ${ticker ? ticker.lastPrice.toLocaleString('en-US', { minimumFractionDigits: 1 }) : '---'}
            </div>
            <div className="flex items-center gap-1 mt-1 text-xs font-mono">
              <span className={`flex items-center font-bold ${is24hPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
                {is24hPositive ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
                {ticker ? `${(ticker.price24hPcnt * 100).toFixed(2)}%` : '0.00%'}
              </span>
              <span className="text-slate-500 text-[10px]">24h</span>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-[#0f1422] p-3.5 shadow-md">
            <p className="text-[11px] font-mono text-slate-400 uppercase tracking-wider mb-1">
              Mark / Index Price
            </p>
            <div className="text-base sm:text-lg font-mono font-bold text-slate-200">
              ${ticker ? ticker.markPrice.toFixed(1) : '---'}
            </div>
            <p className="text-xs font-mono text-slate-400 mt-1">
              Index: ${ticker ? ticker.indexPrice.toFixed(1) : '---'}
            </p>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-[#0f1422] p-3.5 shadow-md">
            <p className="text-[11px] font-mono text-slate-400 uppercase tracking-wider mb-1">
              Spread Bid-Ask
            </p>
            <div className="text-base sm:text-lg font-mono font-bold text-amber-400">
              ${ticker ? ticker.spread.toFixed(2) : '---'}
            </div>
            <p className="text-xs font-mono text-slate-400 mt-1">
              {ticker ? `${ticker.spreadPcnt.toFixed(4)}%` : '---'}
            </p>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-[#0f1422] p-3.5 shadow-md">
            <p className="text-[11px] font-mono text-slate-400 uppercase tracking-wider mb-1">
              Indicadores ({timeframe})
            </p>
            <div className="text-xs font-mono text-slate-200 font-semibold">
              RSI: <span className="text-amber-400">{currentTfAnalysis?.rsi || '50.0'}</span>
            </div>
            <div className="text-xs font-mono text-slate-400 mt-1">
              ATR: ${currentTfAnalysis?.atr || '---'} | RVOL: {currentTfAnalysis?.relativeVolume || '1.0'}x
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-[#0f1422] p-3.5 shadow-md">
            <p className="text-[11px] font-mono text-slate-400 uppercase tracking-wider mb-1">
              Funding Rate
            </p>
            <div className="text-base sm:text-lg font-mono font-bold text-purple-400">
              {ticker ? `${(ticker.fundingRate * 100).toFixed(4)}%` : '---'}
            </div>
            <p className="text-xs font-mono text-slate-400 mt-1">
              Intervalo 8h Bybit
            </p>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-[#0f1422] p-3.5 shadow-md">
            <p className="text-[11px] font-mono text-slate-400 uppercase tracking-wider mb-1">
              Open Interest
            </p>
            <div className="text-base sm:text-lg font-mono font-bold text-blue-400">
              {ticker ? `${ticker.openInterest.toFixed(0)} BTC` : '---'}
            </div>
            <p className="text-xs font-mono text-slate-400 mt-1">
              Vol: {ticker ? `${(ticker.volume24h / 1000).toFixed(1)}k BTC` : '---'}
            </p>
          </div>
        </div>

        {/* Central Grid: Interactive Chart + Order Book */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2 space-y-5">
            <CandleChart
              candles={candles}
              currentCandle={currentCandles[timeframe]}
              timeframe={timeframe}
              onTimeframeChange={setTimeframe}
              swings={swings}
              structureBreaks={structureBreaks}
              fvgs={fvgs}
              setups={setups}
              symbol="BTCUSDT"
              isDark={isDark}
            />
          </div>

          <div className="lg:col-span-1 space-y-5">
            <OrderBookWidget orderBook={orderBook} />
          </div>
        </div>

        {/* Oportunidades & Setups Cuantitativos (Fase 2) */}
        <div className="rounded-2xl border border-slate-800 bg-[#0f1422] p-4 shadow-xl">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800/80 mb-3">
            <div className="flex items-center gap-2">
              <Crosshair className="w-4 h-4 text-[var(--color-brand,#FF6600)]" />
              <h3 className="font-display font-bold text-sm text-slate-200 uppercase tracking-wider">
                Oportunidades & Setups Cuantitativos (Estrategias A y B)
              </h3>
            </div>
            <span className="text-[11px] font-mono bg-amber-500/10 text-amber-300 font-bold px-2 py-0.5 rounded border border-amber-500/30">
              Filtro Estricto R:R $\ge$ 1:4 Neto
            </span>
          </div>

          {setups.length > 0 ? (
            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full text-left font-mono text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-500 text-[11px]">
                    <th className="pb-2">Estrategia</th>
                    <th className="pb-2">Dirección</th>
                    <th className="pb-2">Entrada</th>
                    <th className="pb-2">Stop Loss</th>
                    <th className="pb-2">Take Profit</th>
                    <th className="pb-2">R:R Neto</th>
                    <th className="pb-2">Estado</th>
                    <th className="pb-2">Justificación Técnica</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/50">
                  {setups.map((s, i) => (
                    <tr key={s.id || i} className="hover:bg-slate-900/40">
                      <td className="py-2.5 font-bold text-slate-300">
                        {s.strategy === 'STRATEGY_A_TREND_CONTINUATION'
                          ? 'Estrategia A (Tendencia)'
                          : 'Estrategia B (Barrido)'}
                      </td>
                      <td className="py-2.5">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            s.direction === 'LONG'
                              ? 'bg-emerald-500/15 text-emerald-400'
                              : 'bg-rose-500/15 text-rose-400'
                          }`}
                        >
                          {s.direction}
                        </span>
                      </td>
                      <td className="py-2.5 text-slate-100 font-semibold">${s.entryPrice.toFixed(1)}</td>
                      <td className="py-2.5 text-rose-400 font-semibold">${s.stopLoss.toFixed(1)}</td>
                      <td className="py-2.5 text-emerald-400 font-semibold">${s.takeProfit.toFixed(1)}</td>
                      <td className="py-2.5 font-bold text-amber-400">
                        1:{s.rrRatio?.toFixed(1) || '4.0'}
                      </td>
                      <td className="py-2.5">
                        <span className="px-2 py-0.5 rounded text-[10px] bg-emerald-500/10 text-emerald-300 font-bold border border-emerald-500/20">
                          {s.status}
                        </span>
                      </td>
                      <td className="py-2.5 text-slate-400 text-[11px] max-w-xs truncate">
                        {s.evidence?.triggerReason || 'Confluencia técnica multitemporal'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="py-6 px-4 rounded-xl border border-slate-800/60 bg-slate-900/40 text-center">
              <p className="text-sm font-semibold text-slate-300 mb-1">
                Estado Actual: <span className="text-amber-400">ESPERAR (Sin setups 1:4 con confluencia)</span>
              </p>
              <p className="text-xs text-slate-500 font-mono max-w-2xl mx-auto">
                El sistema no fuerza operaciones. No se detectó confluencia técnica estricta con R:R neto $\ge$ 1:4 sobre velas cerradas. No operar es una decisión válida y deliberada.
              </p>
            </div>
          )}
        </div>

        {/* Multi-Timeframe Matrix */}
        <MultiTimeframeMatrix
          currentCandles={currentCandles}
          lastClosedCandles={lastClosedCandles}
          activeTimeframe={timeframe}
          onSelectTimeframe={setTimeframe}
        />

        {/* Signal Lifecycle 24/7 Monitor (Phase 4) */}
        <SignalLifecycleMonitor
          activeSignals={activeSignals}
          onCancelSignal={handleCancelSignal}
          onRefresh={fetchAnalysisAndSetups}
        />

        {/* AI Analysts Panel */}
        <AiAnalystsCard aiStatus={aiStatus} signals={signals} aiReviews={aiReviews} />

        {/* Audit & System Event Log */}
        <div className="rounded-2xl border border-slate-800 bg-[#0f1422] p-4 shadow-xl">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800/80 mb-3">
            <div className="flex items-center gap-2">
              <Database className="w-4 h-4 text-slate-400" />
              <h3 className="font-display font-bold text-sm text-slate-200 uppercase tracking-wider">
                Registro de Eventos del Sistema & Auditoría
              </h3>
            </div>
            <span className="text-[11px] font-mono text-slate-500">
              Persistencia SQLite WAL / PostgreSQL
            </span>
          </div>

          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full text-left font-mono text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-500 text-[11px]">
                  <th className="pb-2">Hora</th>
                  <th className="pb-2">Nivel</th>
                  <th className="pb-2">Componente</th>
                  <th className="pb-2">Mensaje</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {systemEvents.length > 0 ? (
                  systemEvents.map((ev, i) => (
                    <tr key={ev.id || i} className="hover:bg-slate-900/40">
                      <td className="py-2 text-slate-400 whitespace-nowrap">
                        {new Date(ev.timestamp).toLocaleTimeString('es-AR')}
                      </td>
                      <td className="py-2">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                            ev.level === 'CRITICAL'
                              ? 'bg-rose-500/20 text-rose-400'
                              : ev.level === 'ERROR'
                              ? 'bg-rose-500/10 text-rose-400'
                              : ev.level === 'WARN'
                              ? 'bg-amber-500/10 text-amber-400'
                              : 'bg-emerald-500/10 text-emerald-400'
                          }`}
                        >
                          {ev.level}
                        </span>
                      </td>
                      <td className="py-2 text-slate-300 font-semibold">{ev.component}</td>
                      <td className="py-2 text-slate-400">{ev.message}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className="py-4 text-center text-slate-600">
                      No hay eventos recientes registrados.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {/* Footer Oficial NanoLabs */}
      <footer className="border-t border-slate-800/80 bg-[#0f1422] py-4 px-6 text-center text-xs text-slate-500 font-mono flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-500" />
          <span>NanoLabs AI Trading · Motor Cuantitativo 24/7</span>
        </div>
        <div>
          <span>Powered by <strong>NanoLabs</strong></span>
        </div>
      </footer>

      {/* Notifications Modal (Phase 4) */}
      <NotificationsModal
        isOpen={isNotificationsModalOpen}
        onClose={() => setIsNotificationsModalOpen(false)}
      />

      {/* Configuration & Risk Center Modal (Phase 4.5) */}
      <ConfigCenterModal
        isOpen={isConfigModalOpen}
        onClose={() => setIsConfigModalOpen(false)}
        onConfigChanged={fetchConfigSummary}
      />
    </div>
  );
}
