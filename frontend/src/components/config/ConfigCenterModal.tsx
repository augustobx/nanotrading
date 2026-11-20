'use client';

import React, { useState, useEffect } from 'react';
import {
  Settings,
  Shield,
  Sliders,
  Cpu,
  DollarSign,
  Bell,
  Lock,
  X,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Eye,
  EyeOff,
  Download,
  Calculator,
  Key,
  Layers,
  HelpCircle,
  Power,
  TrendingUp,
  Percent,
} from 'lucide-react';
import { getApiBaseUrl } from '../../utils/api-config';

interface ConfigCenterModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfigChanged?: () => void;
}

type TabType =
  | 'general'
  | 'risk'
  | 'bybit'
  | 'openai'
  | 'gemini'
  | 'router'
  | 'budget'
  | 'notifications'
  | 'security';

export function ConfigCenterModal({ isOpen, onClose, onConfigChanged }: ConfigCenterModalProps) {
  const [activeTab, setActiveTab] = useState<TabType>('general');
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState<boolean>(false);
  const [adminKeyInput, setAdminKeyInput] = useState<string>('');
  const [adminToken, setAdminToken] = useState<string>('');
  const [authError, setAuthError] = useState<string>('');
  const [isLoggingIn, setIsLoggingIn] = useState<boolean>(false);

  const [showUnlockModal, setShowUnlockModal] = useState<boolean>(false);

  // Default initial values so inputs are NEVER blank while fetching
  const DEFAULT_RISK_POLICY = {
    version: 1,
    capitalUsdt: 10000,
    maxRiskPerTradePercent: 0.5,
    maxRiskPerTradeUsdt: 50,
    maxDailyLossPercent: 1.5,
    maxDailyLossUsdt: 150,
    maxWeeklyLossPercent: 4.0,
    maxWeeklyLossUsdt: 400,
    maxSimultaneousExposureUsdt: 15000,
    maxActiveSignals: 3,
    maxDailyEntries: 5,
    maxConsecutiveLosses: 3,
    minNetRR: 4.0,
    stopLossCeilings: {
      maxSlDistancePercent: { enabled: true, value: 1.5 },
      maxSlDistanceUsdt: { enabled: true, value: 1000 },
      maxSlDistanceAtrMultiplier: { enabled: true, value: 3.0 },
      maxMonetaryLossUsdt: { enabled: true, value: 100 },
    },
    marketRestrictions: {
      maxSpreadPercent: 0.05,
      minAtrUsdt: 10,
      maxAtrUsdt: 450,
      maxDataStalenessMs: 10000,
      allowedSessions: ['ASIA', 'LONDON', 'NEW_YORK'],
      setupTtlMs: 1800000,
    },
  };

  const DEFAULT_CONFIG_SUMMARY = {
    systemMode: 'SIGNALS_ONLY',
    killSwitchActive: false,
    capitalUsdt: 10000,
    maxRiskUsdt: 50,
    minNetRR: 4.0,
    bybitConfigured: false,
    openaiConfigured: false,
    geminiConfigured: false,
    dailyBudgetUsd: 5.0,
    budgetRemainingUsd: 5.0,
  };

  const DEFAULT_ROUTER_CONFIG = {
    selectionMode: 'AUTOMATIC',
    performanceProfile: 'BALANCED',
    activeFallbackMode: 'DUAL_AI',
    taskAssignments: {
      MULTITIMEFRAME_ANALYSIS: 'gemini-2.0-flash',
      ORDER_BOOK_IMBALANCE: 'gemini-2.0-flash',
      VOLATILITY_EXPANSION: 'gemini-2.0-flash',
      STRUCTURE_BREAK_CONFIRMATION: 'gpt-4o',
      ENTRY_VALIDATION: 'gpt-4o',
      RISK_ASSESSMENT: 'gpt-4o',
      POST_MORTEM_EVALUATION: 'gpt-4o',
    },
    customWeights: { cost: 0.3, latency: 0.3, accuracy: 0.4 },
  };

  // General & Summary
  const [configSummary, setConfigSummary] = useState<any>(DEFAULT_CONFIG_SUMMARY);
  const [loadingSummary, setLoadingSummary] = useState<boolean>(false);

  // Risk Policy
  const [riskPolicy, setRiskPolicy] = useState<any>(DEFAULT_RISK_POLICY);
  const [savingRisk, setSavingRisk] = useState<boolean>(false);
  const [riskSaveMsg, setRiskSaveMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Interactive Calculator
  const [calcInput, setCalcInput] = useState({
    capitalUsdt: 10000,
    entryPrice: 60000,
    stopLossPrice: 59700,
    takeProfitPrice: 61500,
    direction: 'LONG',
    maxRiskPercent: 0.5,
    maxRiskUsdt: 50,
    spread: 0.2,
    slippageRate: 0.0002,
    tickSize: 0.1,
    qtyStep: 0.001,
  });
  const [calcResult, setCalcResult] = useState<any>(null);
  const [calcLoading, setCalcLoading] = useState<boolean>(false);

  // Bybit Config
  const [bybitConfig, setBybitConfig] = useState<any>(null);
  const [bybitApiKey, setBybitApiKey] = useState<string>('');
  const [bybitApiSecret, setBybitApiSecret] = useState<string>('');
  const [bybitEnv, setBybitEnv] = useState<'mainnet' | 'testnet'>('mainnet');
  const [bybitTesting, setBybitTesting] = useState<boolean>(false);
  const [bybitTestResult, setBybitTestResult] = useState<any>(null);
  const [bybitSaving, setBybitSaving] = useState<boolean>(false);
  const [bybitMsg, setBybitMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // AI Credentials & Catalog
  const [aiCreds, setAiCreds] = useState<any>(null);
  const [modelsCatalog, setModelsCatalog] = useState<any>({});
  const [openaiKey, setOpenaiKey] = useState<string>('');
  const [openaiModel, setOpenaiModel] = useState<string>('gpt-4o');
  const [showOpenaiKey, setShowOpenaiKey] = useState<boolean>(false);
  const [geminiKey, setGeminiKey] = useState<string>('');
  const [geminiModel, setGeminiModel] = useState<string>('gemini-2.0-flash');
  const [showGeminiKey, setShowGeminiKey] = useState<boolean>(false);
  const [savingAiCreds, setSavingAiCreds] = useState<boolean>(false);
  const [aiCredsMsg, setAiCredsMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // AI Router
  const [routerConfig, setRouterConfig] = useState<any>(DEFAULT_ROUTER_CONFIG);
  const [savingRouter, setSavingRouter] = useState<boolean>(false);
  const [routerMsg, setRouterMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // AI Consumption & Budget
  const [consumptionStats, setConsumptionStats] = useState<any>(null);
  const [consumptionLogs, setConsumptionLogs] = useState<any[]>([]);
  const [selectedProviderFilter, setSelectedProviderFilter] = useState<string>('ALL');

  // Security & Audit
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [loadingAudit, setLoadingAudit] = useState<boolean>(false);
  const [confirmKillSwitch, setConfirmKillSwitch] = useState<boolean>(false);

  // Check saved session on mount
  useEffect(() => {
    const savedToken = localStorage.getItem('nanolabs_admin_token');
    if (savedToken) {
      setAdminToken(savedToken);
      verifySavedToken(savedToken);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      fetchSummary();
      fetchRiskPolicy();
      fetchBybitConfig();
      fetchAiCredentials();
      fetchRouterConfig();
      fetchConsumptionData();
      if (isAdminAuthenticated) {
        fetchAuditLogs();
      }
    }
  }, [isOpen, isAdminAuthenticated]);

  // Recalculate interactive risk when inputs change
  useEffect(() => {
    calculateLiveRisk();
  }, [calcInput]);

  const getHeaders = (withAuth = false) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (withAuth && adminToken) {
      headers['Authorization'] = `Bearer ${adminToken}`;
    }
    return headers;
  };

  const verifySavedToken = async (token: string) => {
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/v1/auth/verify`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const json = await res.json();
        setIsAdminAuthenticated(json.authenticated);
        if (!json.authenticated) localStorage.removeItem('nanolabs_admin_token');
      }
    } catch {
      setIsAdminAuthenticated(false);
    }
  };

  const handleAdminLogin = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!adminKeyInput.trim()) return;
    setIsLoggingIn(true);
    setAuthError('');
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: adminKeyInput.trim() }),
      });
      const json = await res.json();
      if (json.success && json.token) {
        setAdminToken(json.token);
        localStorage.setItem('nanolabs_admin_token', json.token);
        setIsAdminAuthenticated(true);
        setAdminKeyInput('');
        setShowUnlockModal(false);
        fetchAuditLogs();
        fetchSummary();
        fetchRiskPolicy();
        fetchBybitConfig();
        fetchAiCredentials();
        fetchRouterConfig();
      } else {
        setAuthError(json.error || 'Credenciales incorrectas');
      }
    } catch (err: any) {
      setAuthError(err.message || 'Error de conexión');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleAdminLogout = async () => {
    try {
      await fetch(`${getApiBaseUrl()}/api/v1/auth/logout`, {
        method: 'POST',
        headers: getHeaders(true),
      });
    } catch {}
    setAdminToken('');
    localStorage.removeItem('nanolabs_admin_token');
    setIsAdminAuthenticated(false);
  };

  const fetchSummary = async () => {
    setLoadingSummary(true);
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/v1/config/summary`);
      if (res.ok) {
        const json = await res.json();
        if (json.success) setConfigSummary(json.data);
      }
    } catch {}
    setLoadingSummary(false);
  };

  const fetchRiskPolicy = async () => {
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/v1/config/risk`);
      if (res.ok) {
        const json = await res.json();
        if (json.success) setRiskPolicy(json.data);
      }
    } catch {}
  };

  const fetchBybitConfig = async () => {
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/v1/config/bybit`);
      if (res.ok) {
        const json = await res.json();
        if (json.success) setBybitConfig(json.data);
      }
    } catch {}
  };

  const fetchAiCredentials = async () => {
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/v1/config/ai/credentials`);
      if (res.ok) {
        const json = await res.json();
        if (json.success) setAiCreds(json.data);
      }
    } catch {}
  };

  const fetchRouterConfig = async () => {
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/v1/config/ai/router`);
      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          setRouterConfig(json.data.routerConfig);
          setModelsCatalog(json.data.modelsCatalog || {});
        }
      }
    } catch {}
  };

  const fetchConsumptionData = async () => {
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/v1/config/ai/consumption?limit=50`);
      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          setConsumptionStats(json.data.stats);
          setConsumptionLogs(json.data.logs);
        }
      }
    } catch {}
  };

  const fetchAuditLogs = async () => {
    setLoadingAudit(true);
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/v1/config/audit?limit=40`, {
        headers: getHeaders(true),
      });
      if (res.ok) {
        const json = await res.json();
        if (json.success) setAuditLogs(json.data);
      }
    } catch {}
    setLoadingAudit(false);
  };

  const calculateLiveRisk = async () => {
    setCalcLoading(true);
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/v1/risk/calculate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(calcInput),
      });
      if (res.ok) {
        const json = await res.json();
        if (json.success) setCalcResult(json.data);
      }
    } catch {}
    setCalcLoading(false);
  };

  const handleSaveRiskPolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdminAuthenticated) return;
    setSavingRisk(true);
    setRiskSaveMsg(null);
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/v1/config/risk`, {
        method: 'POST',
        headers: getHeaders(true),
        body: JSON.stringify(riskPolicy),
      });
      const json = await res.json();
      if (json.success) {
        setRiskPolicy(json.data);
        setRiskSaveMsg({ type: 'success', text: 'Política de riesgo actualizada y activa correctamente.' });
        fetchSummary();
        onConfigChanged?.();
      } else {
        setRiskSaveMsg({ type: 'error', text: json.error || 'Error al guardar política de riesgo.' });
      }
    } catch (err: any) {
      setRiskSaveMsg({ type: 'error', text: err.message || 'Error de red' });
    }
    setSavingRisk(false);
  };

  const handleTestBybit = async () => {
    if (!bybitApiKey.trim() || !bybitApiSecret.trim()) {
      setBybitMsg({ type: 'error', text: 'Ingrese API Key y Secret para probar la conexión.' });
      return;
    }
    setBybitTesting(true);
    setBybitTestResult(null);
    setBybitMsg(null);
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/v1/config/bybit/test`, {
        method: 'POST',
        headers: getHeaders(true),
        body: JSON.stringify({
          apiKey: bybitApiKey.trim(),
          apiSecret: bybitApiSecret.trim(),
          environment: bybitEnv,
        }),
      });
      const json = await res.json();
      if (json.success) {
        setBybitTestResult(json.data);
        setBybitMsg({ type: 'success', text: 'Verificación exitosa: conexión y permisos de Bybit validados correctamente.' });
      } else {
        setBybitMsg({ type: 'error', text: json.error || 'Fallo en verificación Bybit' });
      }
    } catch (err: any) {
      setBybitMsg({ type: 'error', text: err.message || 'Error de conexión' });
    }
    setBybitTesting(false);
  };

  const handleSaveBybit = async () => {
    if (!bybitApiKey.trim() || !bybitApiSecret.trim()) return;
    setBybitSaving(true);
    setBybitMsg(null);
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/v1/config/bybit`, {
        method: 'POST',
        headers: getHeaders(true),
        body: JSON.stringify({
          apiKey: bybitApiKey.trim(),
          apiSecret: bybitApiSecret.trim(),
          environment: bybitEnv,
        }),
      });
      const json = await res.json();
      if (json.success) {
        setBybitMsg({ type: 'success', text: 'Credenciales Bybit cifradas y guardadas con éxito.' });
        setBybitApiKey('');
        setBybitApiSecret('');
        fetchBybitConfig();
        fetchSummary();
        onConfigChanged?.();
      } else {
        setBybitMsg({ type: 'error', text: json.error || 'Error al guardar credenciales Bybit' });
      }
    } catch (err: any) {
      setBybitMsg({ type: 'error', text: err.message || 'Error de conexión' });
    }
    setBybitSaving(false);
  };

  const handleRevokeBybit = async () => {
    if (!confirm('¿Confirma que desea revocar y eliminar las credenciales de Bybit?')) return;
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/v1/config/bybit`, {
        method: 'DELETE',
        headers: getHeaders(true),
      });
      if (res.ok) {
        fetchBybitConfig();
        fetchSummary();
        setBybitMsg({ type: 'success', text: 'Credenciales Bybit revocadas.' });
        onConfigChanged?.();
      }
    } catch {}
  };

  const handleSaveAiKey = async (provider: 'openai' | 'gemini') => {
    const key = provider === 'openai' ? openaiKey : geminiKey;
    const model = provider === 'openai' ? openaiModel : geminiModel;
    if (!key.trim()) return;
    setSavingAiCreds(true);
    setAiCredsMsg(null);
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/v1/config/ai/credentials`, {
        method: 'POST',
        headers: getHeaders(true),
        body: JSON.stringify({ provider, apiKey: key.trim(), model }),
      });
      const json = await res.json();
      if (json.success) {
        setAiCredsMsg({ type: 'success', text: `Clave de ${provider.toUpperCase()} cifrada y guardada.` });
        if (provider === 'openai') setOpenaiKey('');
        if (provider === 'gemini') setGeminiKey('');
        fetchAiCredentials();
        fetchSummary();
        onConfigChanged?.();
      } else {
        setAiCredsMsg({ type: 'error', text: json.error || 'Error al guardar clave' });
      }
    } catch (err: any) {
      setAiCredsMsg({ type: 'error', text: err.message || 'Error de conexión' });
    }
    setSavingAiCreds(false);
  };

  const handleSaveRouterConfig = async () => {
    if (!isAdminAuthenticated) return;
    setSavingRouter(true);
    setRouterMsg(null);
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/v1/config/ai/router`, {
        method: 'POST',
        headers: getHeaders(true),
        body: JSON.stringify(routerConfig),
      });
      const json = await res.json();
      if (json.success) {
        setRouterConfig(json.data);
        setRouterMsg({ type: 'success', text: 'Configuración del Router de IA actualizada.' });
        fetchSummary();
        onConfigChanged?.();
      } else {
        setRouterMsg({ type: 'error', text: json.error || 'Error al actualizar router' });
      }
    } catch (err: any) {
      setRouterMsg({ type: 'error', text: err.message || 'Error de red' });
    }
    setSavingRouter(false);
  };

  const handleToggleKillSwitch = async () => {
    if (!isAdminAuthenticated) return;
    const nextState = !configSummary?.killSwitchActive;
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/v1/kill-switch`, {
        method: 'POST',
        headers: getHeaders(true),
        body: JSON.stringify({ active: nextState, reason: 'Acción manual desde Centro de Configuración' }),
      });
      if (res.ok) {
        setConfirmKillSwitch(false);
        fetchSummary();
        onConfigChanged?.();
      }
    } catch {}
  };

  const renderAdminBanner = () => {
    if (isAdminAuthenticated) return null;
    return (
      <div className="mb-4 p-3.5 rounded-lg bg-amber-950/40 border border-amber-600/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-amber-200 shadow-sm">
        <div className="flex items-center gap-2.5">
          <Lock className="w-4 h-4 text-amber-400 shrink-0" />
          <span>
            Visualizando en <strong>modo solo lectura</strong>. Para editar parámetros de riesgo, claves de API o enrutamiento de IA, desbloquee con su clave administrativa.
          </span>
        </div>
        <button
          type="button"
          onClick={() => setShowUnlockModal(true)}
          className="px-3.5 py-1.5 rounded bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs shrink-0 flex items-center gap-1.5 transition-colors shadow-sm self-start sm:self-auto cursor-pointer"
        >
          <Key className="w-3.5 h-3.5" />
          <span>Desbloquear Edición</span>
        </button>
      </div>
    );
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-2 sm:p-4 animate-in fade-in duration-200">
      <div className="relative w-full max-w-6xl h-[92vh] flex flex-col bg-[#0c0f17] border border-[#2b3347] rounded-xl shadow-2xl overflow-hidden text-slate-200 font-sans">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#1f2638] bg-[#111624]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-orange-500/10 border border-orange-500/30 flex items-center justify-center text-orange-500 shadow-sm">
              <Settings className="w-5 h-5 animate-spin-slow" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-white tracking-wide">Centro de Configuración y Riesgo</h2>
                <span className="px-2 py-0.5 text-xs font-mono rounded bg-slate-800 text-slate-300 border border-slate-700">
                  Fase 4.5
                </span>
                <span className="px-2 py-0.5 text-xs font-mono rounded bg-blue-950 text-blue-300 border border-blue-800">
                  SIGNALS_ONLY
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Gestión estricta de capital, techos de Stop Loss, claves Bybit/IA y router multimodelo
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {isAdminAuthenticated ? (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-emerald-950/80 border border-emerald-600/50 text-emerald-300 text-xs font-mono">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span>Admin Activo</span>
                <button
                  onClick={handleAdminLogout}
                  className="ml-2 hover:text-white text-slate-400 underline text-[11px] cursor-pointer"
                  title="Cerrar sesión de administrador"
                >
                  Bloquear
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowUnlockModal(true)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/50 text-amber-300 hover:text-amber-200 text-xs font-semibold transition-all shadow-sm cursor-pointer"
                title="Haga clic para ingresar clave administrativa y desbloquear edición"
              >
                <Lock className="w-3.5 h-3.5" />
                <span>Modo Lectura (Desbloquear)</span>
              </button>
            )}

            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800/80 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Body: 2-column sidebar + content layout */}
        <div className="flex-1 flex flex-row overflow-hidden min-h-0">
          {/* Tabs Navigation Sidebar: Fixed on the left */}
          <aside className="w-56 sm:w-64 border-r border-[#1f2638] bg-[#0e121d] flex flex-col p-2.5 gap-1.5 flex-shrink-0 overflow-y-auto custom-scrollbar">
            {[
              { id: 'general', label: 'General', icon: Sliders },
              { id: 'risk', label: 'Gestión de Riesgo', icon: Shield },
              { id: 'bybit', label: 'Bybit V5', icon: Key },
              { id: 'openai', label: 'OpenAI API', icon: Cpu },
              { id: 'gemini', label: 'Google Gemini', icon: Cpu },
              { id: 'router', label: 'Router de IA', icon: Layers },
              { id: 'budget', label: 'Gastos y Consumo', icon: DollarSign },
              { id: 'notifications', label: 'Notificaciones', icon: Bell },
              { id: 'security', label: 'Seguridad y Auditoría', icon: Lock },
            ].map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as TabType)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs font-medium transition-all text-left whitespace-nowrap cursor-pointer ${
                    isActive
                      ? 'bg-orange-500/20 text-orange-400 border border-orange-500/40 shadow-sm font-semibold'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 border border-transparent'
                  }`}
                >
                  <Icon className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-orange-400' : 'text-slate-500'}`} />
                  <span className="truncate">{tab.label}</span>
                </button>
              );
            })}
          </aside>

          {/* Tab Content Display */}
          <main className="flex-1 overflow-y-auto custom-scrollbar p-4 sm:p-6 bg-[#0a0d14] min-w-0">
            {/* TAB 1: GENERAL */}
            {activeTab === 'general' && (
              <div className="space-y-6 max-w-4xl">
                <div>
                  <h3 className="text-base font-semibold text-white">Parámetros Generales del Sistema</h3>
                  <p className="text-xs text-slate-400">
                    Resumen operativo, entorno de ejecución y estado de las conexiones vitales.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  <div className="p-4 rounded-lg bg-[#111624] border border-[#21283b] space-y-1">
                    <span className="text-[11px] text-slate-400 uppercase font-mono">Modo Operativo</span>
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 font-mono">
                        SIGNALS_ONLY
                      </span>
                      <span className="text-xs text-slate-500">Live trading desactivado</span>
                    </div>
                  </div>

                  <div className="p-4 rounded-lg bg-[#111624] border border-[#21283b] space-y-1">
                    <span className="text-[11px] text-slate-400 uppercase font-mono">Activo Monitoreado</span>
                    <div className="text-base font-bold font-mono text-white">BTCUSDT Perpetual</div>
                    <span className="text-[11px] text-slate-400">Bybit V5 Linear</span>
                  </div>

                  <div className="p-4 rounded-lg bg-[#111624] border border-[#21283b] space-y-1">
                    <span className="text-[11px] text-slate-400 uppercase font-mono">Zona Horaria Referencia</span>
                    <div className="text-sm font-semibold text-slate-200">America/Argentina/Buenos_Aires</div>
                    <span className="text-[11px] text-slate-400">UTC-3 estándar</span>
                  </div>

                  <div className="p-4 rounded-lg bg-[#111624] border border-[#21283b] space-y-1">
                    <span className="text-[11px] text-slate-400 uppercase font-mono">Presupuesto Diario IA</span>
                    <div className="text-base font-bold font-mono text-white">
                      ${configSummary?.dailyBudgetUsd?.toFixed(2) || '5.00'} USD
                    </div>
                    <span className="text-[11px] text-emerald-400">
                      Restante hoy: ${configSummary?.budgetRemainingUsd?.toFixed(2) || '5.00'} USD
                    </span>
                  </div>

                  <div className="p-4 rounded-lg bg-[#111624] border border-[#21283b] space-y-1">
                    <span className="text-[11px] text-slate-400 uppercase font-mono">Kill Switch de Emergencia</span>
                    <div className="flex items-center gap-2">
                      <span
                        className={`w-2.5 h-2.5 rounded-full ${
                          configSummary?.killSwitchActive ? 'bg-red-500 animate-ping' : 'bg-emerald-500'
                        }`}
                      />
                      <span
                        className={`text-sm font-bold font-mono ${
                          configSummary?.killSwitchActive ? 'text-red-400' : 'text-emerald-400'
                        }`}
                      >
                        {configSummary?.killSwitchActive ? 'BLOQUEO ACTIVO' : 'NORMAL / SEGURO'}
                      </span>
                    </div>
                  </div>

                  <div className="p-4 rounded-lg bg-[#111624] border border-[#21283b] space-y-1">
                    <span className="text-[11px] text-slate-400 uppercase font-mono">Integraciones IA</span>
                    <div className="flex items-center gap-2 text-xs">
                      <span
                        className={`px-2 py-0.5 rounded font-mono ${
                          configSummary?.openaiConfigured
                            ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                            : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        OpenAI {configSummary?.openaiConfigured ? '✓' : '✗'}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded font-mono ${
                          configSummary?.geminiConfigured
                            ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                            : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        Gemini {configSummary?.geminiConfigured ? '✓' : '✗'}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="p-4 rounded-lg bg-blue-950/20 border border-blue-900/50 flex items-start gap-3">
                  <HelpCircle className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
                  <div className="text-xs text-blue-200 leading-relaxed">
                    <strong>Principio de Determinismo sobre Inteligencia Artificial:</strong> Las IAs evalúan confluencias y riesgos, pero nunca pueden anular los filtros cuantitativos de R:R neto mínimo ($\ge 1:4.0$), techos de Stop Loss estructurales, desincronización de libro de órdenes o límites de presupuesto.
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: GESTIÓN DE RIESGO & CALCULADORA */}
            {activeTab === 'risk' && (
              <div className="space-y-6 max-w-4xl">
                {renderAdminBanner()}
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-base font-semibold text-white">Política Estricta de Riesgo de Capital</h3>
                    <p className="text-xs text-slate-400">
                      Topes de pérdida, límites de exposición y techos máximos de Stop Loss estructural.
                    </p>
                  </div>
                  {!isAdminAuthenticated && (
                    <button
                      type="button"
                      onClick={() => setShowUnlockModal(true)}
                      className="text-xs text-amber-400 bg-amber-950/60 hover:bg-amber-900/60 px-3 py-1 rounded border border-amber-800 cursor-pointer flex items-center gap-1.5"
                    >
                      <Lock className="w-3.5 h-3.5" />
                      <span>Desbloquear edición</span>
                    </button>
                  )}
                </div>

                {riskSaveMsg && (
                  <div
                    className={`p-3 rounded-lg text-xs flex items-center gap-2 ${
                      riskSaveMsg.type === 'success'
                        ? 'bg-emerald-950/60 text-emerald-200 border border-emerald-800'
                        : 'bg-red-950/60 text-red-200 border border-red-800'
                    }`}
                  >
                    {riskSaveMsg.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
                    <span>{riskSaveMsg.text}</span>
                  </div>
                )}

                {riskPolicy && (
                  <form onSubmit={handleSaveRiskPolicy} className="space-y-6">
                    {/* Capital & Limits */}
                    <div className="p-4 rounded-lg bg-[#111624] border border-[#21283b] space-y-4">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-orange-400 flex items-center gap-2">
                        <Shield className="w-4 h-4" /> Capital y Riesgo por Operación
                      </h4>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div>
                          <label className="block text-xs text-slate-400 mb-1">Capital Operativo (USDT)</label>
                          <input
                            type="number"
                            disabled={!isAdminAuthenticated}
                            value={riskPolicy.capitalUsdt || 10000}
                            onChange={(e) => setRiskPolicy({ ...riskPolicy, capitalUsdt: parseFloat(e.target.value) })}
                            className="w-full bg-[#0a0d14] border border-[#21283b] rounded px-3 py-1.5 text-xs text-white font-mono focus:border-orange-500 focus:outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-slate-400 mb-1">Riesgo Máx por Trade (%)</label>
                          <input
                            type="number"
                            step="0.1"
                            disabled={!isAdminAuthenticated}
                            value={riskPolicy.maxRiskPerTradePercent || 0.5}
                            onChange={(e) =>
                              setRiskPolicy({ ...riskPolicy, maxRiskPerTradePercent: parseFloat(e.target.value) })
                            }
                            className="w-full bg-[#0a0d14] border border-[#21283b] rounded px-3 py-1.5 text-xs text-white font-mono focus:border-orange-500 focus:outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-slate-400 mb-1">Riesgo Máx Absoluto (USDT)</label>
                          <input
                            type="number"
                            disabled={!isAdminAuthenticated}
                            value={riskPolicy.maxRiskPerTradeUsdt || 50}
                            onChange={(e) =>
                              setRiskPolicy({ ...riskPolicy, maxRiskPerTradeUsdt: parseFloat(e.target.value) })
                            }
                            className="w-full bg-[#0a0d14] border border-[#21283b] rounded px-3 py-1.5 text-xs text-white font-mono focus:border-orange-500 focus:outline-none"
                          />
                        </div>
                      </div>
                      <div className="p-2 rounded bg-slate-900 text-[11px] text-slate-400">
                        * Regla restrictiva: Se aplica automáticamente el menor entre el % de capital y el tope fijo en USDT (ej: min(100 USDT, 50 USDT) = 50 USDT).
                      </div>
                    </div>

                    {/* Circuit Breakers */}
                    <div className="p-4 rounded-lg bg-[#111624] border border-[#21283b] space-y-4">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-orange-400 flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4" /> Límites Diarios y Circuit Breakers
                      </h4>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div>
                          <label className="block text-xs text-slate-400 mb-1">Pérdida Máx Diaria (USDT)</label>
                          <input
                            type="number"
                            disabled={!isAdminAuthenticated}
                            value={riskPolicy.maxDailyLossUsdt || 150}
                            onChange={(e) => setRiskPolicy({ ...riskPolicy, maxDailyLossUsdt: parseFloat(e.target.value) })}
                            className="w-full bg-[#0a0d14] border border-[#21283b] rounded px-3 py-1.5 text-xs text-white font-mono focus:border-orange-500 focus:outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-slate-400 mb-1">Pérdida Máx Semanal (USDT)</label>
                          <input
                            type="number"
                            disabled={!isAdminAuthenticated}
                            value={riskPolicy.maxWeeklyLossUsdt || 400}
                            onChange={(e) => setRiskPolicy({ ...riskPolicy, maxWeeklyLossUsdt: parseFloat(e.target.value) })}
                            className="w-full bg-[#0a0d14] border border-[#21283b] rounded px-3 py-1.5 text-xs text-white font-mono focus:border-orange-500 focus:outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-slate-400 mb-1">Máx Pérdidas Consecutivas</label>
                          <input
                            type="number"
                            disabled={!isAdminAuthenticated}
                            value={riskPolicy.maxConsecutiveLosses || 3}
                            onChange={(e) =>
                              setRiskPolicy({ ...riskPolicy, maxConsecutiveLosses: parseInt(e.target.value, 10) })
                            }
                            className="w-full bg-[#0a0d14] border border-[#21283b] rounded px-3 py-1.5 text-xs text-white font-mono focus:border-orange-500 focus:outline-none"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Stop Loss Ceilings */}
                    <div className="p-4 rounded-lg bg-[#111624] border border-[#21283b] space-y-4">
                      <div className="flex items-center justify-between">
                        <h4 className="text-xs font-bold uppercase tracking-wider text-orange-400 flex items-center gap-2">
                          <Sliders className="w-4 h-4" /> Techos Máximos de Stop Loss
                        </h4>
                        <span className="text-[11px] text-red-400 bg-red-950/40 px-2 py-0.5 rounded border border-red-900">
                          Si el setup supera el tope: SE DESCARTA (NUNCA comprimir SL)
                        </span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="p-3 rounded bg-[#0a0d14] border border-[#1f2638] space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-slate-300 font-medium">Tope por Distancia (%)</span>
                            <input
                              type="checkbox"
                              disabled={!isAdminAuthenticated}
                              checked={riskPolicy.stopLossCeilings?.maxSlDistancePercent?.enabled ?? true}
                              onChange={(e) =>
                                setRiskPolicy({
                                  ...riskPolicy,
                                  stopLossCeilings: {
                                    ...riskPolicy.stopLossCeilings,
                                    maxSlDistancePercent: {
                                      ...riskPolicy.stopLossCeilings?.maxSlDistancePercent,
                                      enabled: e.target.checked,
                                    },
                                  },
                                })
                              }
                              className="accent-orange-500"
                            />
                          </div>
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              step="0.1"
                              disabled={!isAdminAuthenticated}
                              value={riskPolicy.stopLossCeilings?.maxSlDistancePercent?.value || 1.5}
                              onChange={(e) =>
                                setRiskPolicy({
                                  ...riskPolicy,
                                  stopLossCeilings: {
                                    ...riskPolicy.stopLossCeilings,
                                    maxSlDistancePercent: {
                                      ...riskPolicy.stopLossCeilings?.maxSlDistancePercent,
                                      value: parseFloat(e.target.value),
                                    },
                                  },
                                })
                              }
                              className="w-full bg-[#111624] border border-[#21283b] rounded px-3 py-1 text-xs text-white font-mono"
                            />
                            <span className="text-xs text-slate-400">%</span>
                          </div>
                        </div>

                        <div className="p-3 rounded bg-[#0a0d14] border border-[#1f2638] space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-slate-300 font-medium">Tope por Distancia Absoluta</span>
                            <input
                              type="checkbox"
                              disabled={!isAdminAuthenticated}
                              checked={riskPolicy.stopLossCeilings?.maxSlDistanceUsdt?.enabled ?? true}
                              onChange={(e) =>
                                setRiskPolicy({
                                  ...riskPolicy,
                                  stopLossCeilings: {
                                    ...riskPolicy.stopLossCeilings,
                                    maxSlDistanceUsdt: {
                                      ...riskPolicy.stopLossCeilings?.maxSlDistanceUsdt,
                                      enabled: e.target.checked,
                                    },
                                  },
                                })
                              }
                              className="accent-orange-500"
                            />
                          </div>
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              disabled={!isAdminAuthenticated}
                              value={riskPolicy.stopLossCeilings?.maxSlDistanceUsdt?.value || 1000}
                              onChange={(e) =>
                                setRiskPolicy({
                                  ...riskPolicy,
                                  stopLossCeilings: {
                                    ...riskPolicy.stopLossCeilings,
                                    maxSlDistanceUsdt: {
                                      ...riskPolicy.stopLossCeilings?.maxSlDistanceUsdt,
                                      value: parseFloat(e.target.value),
                                    },
                                  },
                                })
                              }
                              className="w-full bg-[#111624] border border-[#21283b] rounded px-3 py-1 text-xs text-white font-mono"
                            />
                            <span className="text-xs text-slate-400">USDT</span>
                          </div>
                        </div>

                        <div className="p-3 rounded bg-[#0a0d14] border border-[#1f2638] space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-slate-300 font-medium">Tope por Múltiplo de ATR</span>
                            <input
                              type="checkbox"
                              disabled={!isAdminAuthenticated}
                              checked={riskPolicy.stopLossCeilings?.maxSlDistanceAtrMultiplier?.enabled ?? true}
                              onChange={(e) =>
                                setRiskPolicy({
                                  ...riskPolicy,
                                  stopLossCeilings: {
                                    ...riskPolicy.stopLossCeilings,
                                    maxSlDistanceAtrMultiplier: {
                                      ...riskPolicy.stopLossCeilings?.maxSlDistanceAtrMultiplier,
                                      enabled: e.target.checked,
                                    },
                                  },
                                })
                              }
                              className="accent-orange-500"
                            />
                          </div>
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              step="0.1"
                              disabled={!isAdminAuthenticated}
                              value={riskPolicy.stopLossCeilings?.maxSlDistanceAtrMultiplier?.value || 3.0}
                              onChange={(e) =>
                                setRiskPolicy({
                                  ...riskPolicy,
                                  stopLossCeilings: {
                                    ...riskPolicy.stopLossCeilings,
                                    maxSlDistanceAtrMultiplier: {
                                      ...riskPolicy.stopLossCeilings?.maxSlDistanceAtrMultiplier,
                                      value: parseFloat(e.target.value),
                                    },
                                  },
                                })
                              }
                              className="w-full bg-[#111624] border border-[#21283b] rounded px-3 py-1 text-xs text-white font-mono"
                            />
                            <span className="text-xs text-slate-400">x ATR</span>
                          </div>
                        </div>

                        <div className="p-3 rounded bg-[#0a0d14] border border-[#1f2638] space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-slate-300 font-medium">Pérdida Monetaria Techo</span>
                            <input
                              type="checkbox"
                              disabled={!isAdminAuthenticated}
                              checked={riskPolicy.stopLossCeilings?.maxMonetaryLossUsdt?.enabled ?? true}
                              onChange={(e) =>
                                setRiskPolicy({
                                  ...riskPolicy,
                                  stopLossCeilings: {
                                    ...riskPolicy.stopLossCeilings,
                                    maxMonetaryLossUsdt: {
                                      ...riskPolicy.stopLossCeilings?.maxMonetaryLossUsdt,
                                      enabled: e.target.checked,
                                    },
                                  },
                                })
                              }
                              className="accent-orange-500"
                            />
                          </div>
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              disabled={!isAdminAuthenticated}
                              value={riskPolicy.stopLossCeilings?.maxMonetaryLossUsdt?.value || 100}
                              onChange={(e) =>
                                setRiskPolicy({
                                  ...riskPolicy,
                                  stopLossCeilings: {
                                    ...riskPolicy.stopLossCeilings,
                                    maxMonetaryLossUsdt: {
                                      ...riskPolicy.stopLossCeilings?.maxMonetaryLossUsdt,
                                      value: parseFloat(e.target.value),
                                    },
                                  },
                                })
                              }
                              className="w-full bg-[#111624] border border-[#21283b] rounded px-3 py-1 text-xs text-white font-mono"
                            />
                            <span className="text-xs text-slate-400">USDT</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {isAdminAuthenticated && (
                      <div className="flex justify-end">
                        <button
                          type="submit"
                          disabled={savingRisk}
                          className="px-5 py-2 rounded-lg bg-orange-600 hover:bg-orange-500 text-white text-xs font-semibold shadow-lg shadow-orange-600/20 transition-all flex items-center gap-2"
                        >
                          {savingRisk ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
                          <span>Guardar y Aplicar Política de Riesgo</span>
                        </button>
                      </div>
                    )}
                  </form>
                )}

                {/* Embedded Interactive Risk Calculator */}
                <div className="p-5 rounded-lg bg-[#111624] border border-orange-500/30 space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-orange-400 flex items-center gap-2">
                      <Calculator className="w-4 h-4" /> Calculadora Interactiva de Operación
                    </h4>
                    <span className="text-[11px] text-slate-400 font-mono">
                      TickSize: 0.1 | QtyStep: 0.001 BTC
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1">Precio Entrada</label>
                      <input
                        type="number"
                        value={calcInput.entryPrice}
                        onChange={(e) => setCalcInput({ ...calcInput, entryPrice: parseFloat(e.target.value) || 0 })}
                        className="w-full bg-[#0a0d14] border border-[#21283b] rounded px-2.5 py-1 text-xs text-white font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1">Stop Loss</label>
                      <input
                        type="number"
                        value={calcInput.stopLossPrice}
                        onChange={(e) => setCalcInput({ ...calcInput, stopLossPrice: parseFloat(e.target.value) || 0 })}
                        className="w-full bg-[#0a0d14] border border-[#21283b] rounded px-2.5 py-1 text-xs text-white font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1">Take Profit</label>
                      <input
                        type="number"
                        value={calcInput.takeProfitPrice}
                        onChange={(e) => setCalcInput({ ...calcInput, takeProfitPrice: parseFloat(e.target.value) || 0 })}
                        className="w-full bg-[#0a0d14] border border-[#21283b] rounded px-2.5 py-1 text-xs text-white font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1">Riesgo (%)</label>
                      <input
                        type="number"
                        step="0.1"
                        value={calcInput.maxRiskPercent}
                        onChange={(e) => setCalcInput({ ...calcInput, maxRiskPercent: parseFloat(e.target.value) || 0 })}
                        className="w-full bg-[#0a0d14] border border-[#21283b] rounded px-2.5 py-1 text-xs text-white font-mono"
                      />
                    </div>
                  </div>

                  {calcResult && (
                    <div className="p-3.5 rounded bg-[#0a0d14] border border-[#1f2638] grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                      <div>
                        <span className="text-[10px] text-slate-500 uppercase block">Posición Sugerida</span>
                        <span className="font-mono font-bold text-white text-sm">
                          {calcResult.positionSizeBTC} BTC
                        </span>
                        <span className="text-[10px] text-slate-400 block">
                          ${calcResult.notionalValueUSDT?.toFixed(1)} USDT
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-500 uppercase block">Distancia SL</span>
                        <span className="font-mono text-slate-200">
                          {calcResult.slDistanceUsdt} USDT ({calcResult.slDistancePercent}%)
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-500 uppercase block">R:R Bruto / NETO</span>
                        <span
                          className={`font-mono font-bold text-sm ${
                            calcResult.netRR >= 4.0 ? 'text-emerald-400' : 'text-red-400'
                          }`}
                        >
                          1:{calcResult.netRR?.toFixed(2)}
                        </span>
                        <span className="text-[10px] text-slate-400 block">
                          (Bruto 1:{calcResult.grossRR?.toFixed(2)})
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-500 uppercase block">Pérdida Neta SL</span>
                        <span className="font-mono text-red-400 font-semibold">
                          -${calcResult.netLossUSDT?.toFixed(2)} USDT
                        </span>
                        <span className="text-[10px] text-emerald-400 block font-mono">
                          Ganancia: +${calcResult.netRewardUSDT?.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  )}

                  {calcResult && (
                    <div className="flex justify-end pt-1">
                      <button
                        type="button"
                        disabled={!isAdminAuthenticated}
                        onClick={() => {
                          setRiskPolicy((prev: any) => ({
                            ...prev,
                            capitalUsdt: calcInput.capitalUsdt,
                            maxRiskPerTradePercent: calcInput.maxRiskPercent,
                            maxRiskPerTradeUsdt: calcInput.maxRiskUsdt,
                          }));
                          setRiskSaveMsg({
                            type: 'success',
                            text: 'Parámetros de capital y riesgo de la calculadora aplicados al formulario. Haga clic en Guardar para persistir.',
                          });
                        }}
                        className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-xs text-orange-400 font-medium border border-orange-500/30 transition-all flex items-center gap-1.5 cursor-pointer"
                        title={isAdminAuthenticated ? "Copiar valores de capital y riesgo a la política" : "Desbloquee modo admin para aplicar"}
                      >
                        <Sliders className="w-3.5 h-3.5" />
                        <span>Aplicar estos valores al formulario de Política</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB 3: BYBIT CREDENTIALS */}
            {activeTab === 'bybit' && (
              <div className="space-y-6 max-w-4xl">
                {renderAdminBanner()}
                <div>
                  <h3 className="text-base font-semibold text-white">Configuración de API Bybit V5 Linear</h3>
                  <p className="text-xs text-slate-400">
                    Conexión de cuenta Bybit (Mainnet o Testnet). La ejecución se controla centralmente desde el sistema.
                  </p>
                </div>

                {bybitConfig?.configured && (
                  <div className="p-4 rounded-lg bg-[#111624] border border-[#21283b] space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
                        <span className="text-sm font-semibold text-white">Clave Bybit Configurada y Cifrada</span>
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-slate-800 text-slate-300">
                          {bybitConfig.environment}
                        </span>
                        {bybitConfig.hasTradePermissions ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-amber-950/80 text-amber-300 border border-amber-800">
                            Trade Habilitado en API (Controlado en SIGNALS_ONLY)
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-950/80 text-emerald-300 border border-emerald-800">
                            Sólo Lectura
                          </span>
                        )}
                      </div>
                      {isAdminAuthenticated && (
                        <button
                          onClick={handleRevokeBybit}
                          className="px-3 py-1 rounded bg-red-950/80 hover:bg-red-900 text-red-200 text-xs border border-red-800"
                        >
                          Desconectar Clave
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
                      <div>
                        <span className="text-[10px] text-slate-500 block">API Key</span>
                        <span className="text-slate-300">{bybitConfig.apiKeyMasked}</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-500 block">Balance Cuenta</span>
                        <span className="text-white font-bold">
                          {bybitConfig.accountBalanceUsdt ? `$${bybitConfig.accountBalanceUsdt.toFixed(2)} USDT` : 'N/A'}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-500 block">Tarifa Maker/Taker</span>
                        <span className="text-slate-300">
                          {bybitConfig.actualMakerFeeRate
                            ? `${(bybitConfig.actualMakerFeeRate * 100).toFixed(3)}% / ${(bybitConfig.actualTakerFeeRate * 100).toFixed(3)}%`
                            : '0.020% / 0.055% (Default)'}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-500 block">Fuente Tarifas</span>
                        <span className="text-slate-400 text-[10px]">{bybitConfig.feeSource}</span>
                      </div>
                    </div>
                  </div>
                )}

                <div className="p-4 rounded-lg bg-[#111624] border border-[#21283b] space-y-4">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-orange-400">
                    {bybitConfig?.configured ? 'Actualizar Credenciales' : 'Conectar Nueva API Key'}
                  </h4>

                  {bybitMsg && (
                    <div
                      className={`p-3 rounded text-xs flex items-center gap-2 ${
                        bybitMsg.type === 'success'
                          ? 'bg-emerald-950/60 text-emerald-200 border border-emerald-800'
                          : 'bg-red-950/60 text-red-200 border border-red-800'
                      }`}
                    >
                      {bybitMsg.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
                      <span>{bybitMsg.text}</span>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">API Key</label>
                      <input
                        type="text"
                        disabled={!isAdminAuthenticated}
                        placeholder="Ej: fR78aK... (32 caracteres)"
                        value={bybitApiKey}
                        onChange={(e) => setBybitApiKey(e.target.value)}
                        className="w-full bg-[#0a0d14] border border-[#21283b] rounded px-3 py-1.5 text-xs text-white font-mono focus:border-orange-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">API Secret</label>
                      <input
                        type="password"
                        disabled={!isAdminAuthenticated}
                        placeholder="Secreto de la API Bybit"
                        value={bybitApiSecret}
                        onChange={(e) => setBybitApiSecret(e.target.value)}
                        className="w-full bg-[#0a0d14] border border-[#21283b] rounded px-3 py-1.5 text-xs text-white font-mono focus:border-orange-500 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="p-3 rounded bg-[#0a0d14] border border-[#21283b] space-y-2">
                    <span className="text-[11px] font-bold text-slate-300 uppercase tracking-wider block">
                      Entorno de la Clave API
                    </span>
                    <div className="flex items-center gap-6">
                      <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                        <input
                          type="radio"
                          name="bybitEnv"
                          value="mainnet"
                          checked={bybitEnv === 'mainnet'}
                          onChange={() => setBybitEnv('mainnet')}
                          className="accent-orange-500 cursor-pointer"
                        />
                        <span className="font-medium">Bybit Mainnet Real</span>
                      </label>
                      <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                        <input
                          type="radio"
                          name="bybitEnv"
                          value="testnet"
                          checked={bybitEnv === 'testnet'}
                          onChange={() => setBybitEnv('testnet')}
                          className="accent-orange-500 cursor-pointer"
                        />
                        <span className="font-semibold text-amber-400">Bybit Testnet</span>
                        <span className="px-1.5 py-0.5 text-[10px] rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 font-mono">
                          api-testnet.bybit.com
                        </span>
                      </label>
                    </div>
                  </div>

                  <div className="p-3 rounded bg-blue-950/30 border border-blue-800/50 text-[11px] text-blue-200 leading-relaxed">
                    <strong>Control de Ejecución Centralizado:</strong> Podés conectar claves API de Bybit con cualquier nivel de permisos. El sistema permite consultar balance y tarifas, y la ejecución de órdenes reales permanece estrictamente controlada desde la configuración del sistema (actualmente en modo protegido <strong>SIGNALS_ONLY</strong>).
                  </div>

                  {bybitTestResult && (
                    <div className="p-3.5 rounded-lg bg-[#0a0d14] border border-emerald-800/60 space-y-2 text-xs">
                      <div className="flex items-center justify-between text-emerald-400 font-bold">
                        <span className="flex items-center gap-1.5">
                          <CheckCircle2 className="w-4 h-4" /> Conexión verificada exitosamente
                        </span>
                        <span className="text-[11px] font-mono uppercase text-slate-400">
                          {bybitEnv}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px] font-mono text-slate-300 pt-1">
                        <div>
                          <span className="text-slate-500 block">Balance Wallet:</span>
                          <span className="text-white font-bold">
                            {bybitTestResult.accountBalanceUsdt !== undefined
                              ? `$${bybitTestResult.accountBalanceUsdt.toFixed(2)} USDT`
                              : 'Consultado OK'}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-500 block">Tarifa Maker/Taker:</span>
                          <span>
                            {bybitTestResult.makerFeeRate !== undefined
                              ? `${(bybitTestResult.makerFeeRate * 100).toFixed(3)}% / ${(bybitTestResult.takerFeeRate * 100).toFixed(3)}%`
                              : '0.020% / 0.055%'}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-500 block">Permisos en API:</span>
                          <span className={bybitTestResult.hasTradePermissions ? 'text-amber-400 font-bold' : 'text-slate-300'}>
                            {bybitTestResult.hasTradePermissions ? 'Comercio / Órdenes Habilitadas' : 'Sólo Lectura'}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  {isAdminAuthenticated && (
                    <div className="flex items-center justify-end gap-3 pt-2">
                      <button
                        type="button"
                        onClick={handleTestBybit}
                        disabled={bybitTesting}
                        className="px-4 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 flex items-center gap-2 cursor-pointer"
                      >
                        {bybitTesting && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                        <span>Probar Conexión y Permisos</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleSaveBybit}
                        disabled={bybitSaving}
                        className="px-4 py-1.5 rounded bg-orange-600 hover:bg-orange-500 text-white text-xs font-semibold shadow-md flex items-center gap-2 cursor-pointer"
                      >
                        {bybitSaving && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                        <span>Guardar Credenciales Cifradas</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB 4: OPENAI */}
            {activeTab === 'openai' && (
              <div className="space-y-6 max-w-4xl">
                {renderAdminBanner()}
                <div>
                  <h3 className="text-base font-semibold text-white">Configuración del Proveedor OpenAI</h3>
                  <p className="text-xs text-slate-400">
                    Analista cuantitativo primario. Salidas estructuradas JSON obligatorias para consenso.
                  </p>
                </div>

                {aiCredsMsg && (
                  <div
                    className={`p-3 rounded text-xs flex items-center gap-2 ${
                      aiCredsMsg.type === 'success'
                        ? 'bg-emerald-950/60 text-emerald-200 border border-emerald-800'
                        : 'bg-red-950/60 text-red-200 border border-red-800'
                    }`}
                  >
                    {aiCredsMsg.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
                    <span>{aiCredsMsg.text}</span>
                  </div>
                )}

                <div className="p-4 rounded-lg bg-[#111624] border border-[#21283b] space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase text-orange-400">Estado de Credenciales OpenAI</span>
                    <span
                      className={`px-2 py-0.5 rounded text-[11px] font-mono ${
                        aiCreds?.openai?.configured
                          ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {aiCreds?.openai?.configured ? `Activo (${aiCreds.openai.apiKeyMasked})` : 'No configurado'}
                    </span>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">API Key OpenAI (sk-proj-...)</label>
                      <div className="relative">
                        <input
                          type={showOpenaiKey ? 'text' : 'password'}
                          disabled={!isAdminAuthenticated}
                          placeholder={aiCreds?.openai?.configured ? '••••••••••••••••' : 'Ingrese clave OpenAI'}
                          value={openaiKey}
                          onChange={(e) => setOpenaiKey(e.target.value)}
                          className="w-full bg-[#0a0d14] border border-[#21283b] rounded px-3 py-1.5 text-xs text-white font-mono pr-10 focus:border-orange-500 focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => setShowOpenaiKey(!showOpenaiKey)}
                          className="absolute right-2.5 top-2 text-slate-500 hover:text-slate-300"
                        >
                          {showOpenaiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs text-slate-400 mb-1">Modelo Seleccionado para Tareas Críticas</label>
                      <select
                        disabled={!isAdminAuthenticated}
                        value={openaiModel}
                        onChange={(e) => setOpenaiModel(e.target.value)}
                        className="w-full bg-[#0a0d14] border border-[#21283b] rounded px-3 py-1.5 text-xs text-white font-mono focus:border-orange-500 focus:outline-none"
                      >
                        <option value="gpt-4o">OpenAI GPT-4o (Recomendado - Razonamiento Superior)</option>
                        <option value="gpt-4o-mini">OpenAI GPT-4o-mini (Económico - Ultrarrápido)</option>
                      </select>
                    </div>
                  </div>

                  {isAdminAuthenticated && (
                    <div className="flex justify-end pt-2">
                      <button
                        type="button"
                        onClick={() => handleSaveAiKey('openai')}
                        disabled={savingAiCreds}
                        className="px-4 py-1.5 rounded bg-orange-600 hover:bg-orange-500 text-white text-xs font-semibold shadow-md flex items-center gap-2"
                      >
                        {savingAiCreds && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                        <span>Guardar Credenciales OpenAI</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB 5: GEMINI */}
            {activeTab === 'gemini' && (
              <div className="space-y-6 max-w-4xl">
                {renderAdminBanner()}
                <div>
                  <h3 className="text-base font-semibold text-white">Configuración del Proveedor Google Gemini</h3>
                  <p className="text-xs text-slate-400">
                    Auditor crítico independiente. Verifica trampas de absorción y falsos quiebres.
                  </p>
                </div>

                <div className="p-4 rounded-lg bg-[#111624] border border-[#21283b] space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase text-orange-400">Estado de Credenciales Gemini</span>
                    <span
                      className={`px-2 py-0.5 rounded text-[11px] font-mono ${
                        aiCreds?.gemini?.configured
                          ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {aiCreds?.gemini?.configured ? `Activo (${aiCreds.gemini.apiKeyMasked})` : 'No configurado'}
                    </span>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">API Key Google GenAI (AIzaSy...)</label>
                      <div className="relative">
                        <input
                          type={showGeminiKey ? 'text' : 'password'}
                          disabled={!isAdminAuthenticated}
                          placeholder={aiCreds?.gemini?.configured ? '••••••••••••••••' : 'Ingrese clave Google GenAI'}
                          value={geminiKey}
                          onChange={(e) => setGeminiKey(e.target.value)}
                          className="w-full bg-[#0a0d14] border border-[#21283b] rounded px-3 py-1.5 text-xs text-white font-mono pr-10 focus:border-orange-500 focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => setShowGeminiKey(!showGeminiKey)}
                          className="absolute right-2.5 top-2 text-slate-500 hover:text-slate-300"
                        >
                          {showGeminiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs text-slate-400 mb-1">Modelo Seleccionado para Auditoría Crítica</label>
                      <select
                        disabled={!isAdminAuthenticated}
                        value={geminiModel}
                        onChange={(e) => setGeminiModel(e.target.value)}
                        className="w-full bg-[#0a0d14] border border-[#21283b] rounded px-3 py-1.5 text-xs text-white font-mono focus:border-orange-500 focus:outline-none"
                      >
                        <option value="gemini-2.0-flash">Google Gemini 2.0 Flash (Recomendado - Baja latencia)</option>
                        <option value="gemini-1.5-flash">Google Gemini 1.5 Flash</option>
                        <option value="gemini-1.5-pro">Google Gemini 1.5 Pro (Razonamiento profundo)</option>
                      </select>
                    </div>
                  </div>

                  {isAdminAuthenticated && (
                    <div className="flex justify-end pt-2">
                      <button
                        type="button"
                        onClick={() => handleSaveAiKey('gemini')}
                        disabled={savingAiCreds}
                        className="px-4 py-1.5 rounded bg-orange-600 hover:bg-orange-500 text-white text-xs font-semibold shadow-md flex items-center gap-2"
                      >
                        {savingAiCreds && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                        <span>Guardar Credenciales Gemini</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB 6: ROUTER DE IA */}
            {activeTab === 'router' && (
              <div className="space-y-6 max-w-4xl">
                {renderAdminBanner()}
                <div>
                  <h3 className="text-base font-semibold text-white">Router Inteligente Multimodelo</h3>
                  <p className="text-xs text-slate-400">
                    Enrutamiento adaptativo según criticidad de tarea, perfil de costo y presupuesto restante.
                  </p>
                </div>

                {routerMsg && (
                  <div
                    className={`p-3 rounded text-xs flex items-center gap-2 ${
                      routerMsg.type === 'success'
                        ? 'bg-emerald-950/60 text-emerald-200 border border-emerald-800'
                        : 'bg-red-950/60 text-red-200 border border-red-800'
                    }`}
                  >
                    {routerMsg.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
                    <span>{routerMsg.text}</span>
                  </div>
                )}

                {routerConfig && (
                  <div className="space-y-5">
                    {/* Mode & Profile Selector */}
                    <div className="p-4 rounded-lg bg-[#111624] border border-[#21283b] space-y-4">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-orange-400">
                        Estrategia de Selección y Perfil
                      </h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs text-slate-400 mb-1">Modo de Selección</label>
                          <select
                            disabled={!isAdminAuthenticated}
                            value={routerConfig.mode}
                            onChange={(e) => setRouterConfig({ ...routerConfig, mode: e.target.value })}
                            className="w-full bg-[#0a0d14] border border-[#21283b] rounded px-3 py-1.5 text-xs text-white font-mono"
                          >
                            <option value="AUTOMATIC">AUTOMATIC (Enrutamiento dinámico según tarea y costo)</option>
                            <option value="MANUAL_GLOBAL">MANUAL_GLOBAL (Mismo modelo fijo para todo)</option>
                            <option value="MANUAL_BY_TASK">MANUAL_BY_TASK (Asignación manual por tarea)</option>
                            <option value="HYBRID">HYBRID (Manual prioritario + fallback inteligente)</option>
                          </select>
                        </div>

                        <div>
                          <label className="block text-xs text-slate-400 mb-1">Perfil Operativo</label>
                          <select
                            disabled={!isAdminAuthenticated}
                            value={routerConfig.profile}
                            onChange={(e) => setRouterConfig({ ...routerConfig, profile: e.target.value })}
                            className="w-full bg-[#0a0d14] border border-[#21283b] rounded px-3 py-1.5 text-xs text-white font-mono"
                          >
                            <option value="BALANCED">BALANCED (Equilibrio óptimo calidad / costo)</option>
                            <option value="ECONOMIC">ECONOMIC (Modelos flash y mini de ultra bajo costo)</option>
                            <option value="MAX_QUALITY">MAX_QUALITY (Modelos pro para máxima confluencia)</option>
                            <option value="CUSTOM">CUSTOM (Personalizado)</option>
                          </select>
                        </div>
                      </div>
                    </div>

                    {/* Task Assignment Grid */}
                    <div className="p-4 rounded-lg bg-[#111624] border border-[#21283b] space-y-3">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-orange-400">
                        Asignación por Tarea Específica
                      </h4>
                      <div className="overflow-x-auto custom-scrollbar">
                        <table className="w-full text-xs text-left">
                          <thead className="bg-[#0e121d] text-slate-400 border-b border-[#21283b]">
                            <tr>
                              <th className="py-2 px-3">Tarea / Etapa</th>
                              <th className="py-2 px-3">Criticidad</th>
                              <th className="py-2 px-3">Modelo OpenAI</th>
                              <th className="py-2 px-3">Modelo Gemini</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#1b2234]">
                            {[
                              { id: 'SETUP_EVALUATION', label: 'Evaluación de Setup (SMC/ICT)', critical: 'ALTA' },
                              { id: 'RISK_AUDIT', label: 'Auditoría de Riesgo y Trampas', critical: 'CRÍTICA' },
                              { id: 'CONSENSUS_REVIEW', label: 'Revisión Final de Consenso', critical: 'ALTA' },
                              { id: 'ALERT_EXPLANATION', label: 'Explicación en Lenguaje Natural', critical: 'MEDIA' },
                              { id: 'MARKET_SUMMARY', label: 'Resumen Periódico de Mercado', critical: 'BAJA' },
                              { id: 'TECHNICAL_CONTEXT', label: 'Contexto Multitemporal', critical: 'MEDIA' },
                            ].map((row) => (
                              <tr key={row.id}>
                                <td className="py-2 px-3 font-medium text-slate-200">{row.label}</td>
                                <td className="py-2 px-3">
                                  <span
                                    className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                                      row.critical === 'CRÍTICA'
                                        ? 'bg-red-950 text-red-300'
                                        : row.critical === 'ALTA'
                                        ? 'bg-orange-950 text-orange-300'
                                        : 'bg-slate-800 text-slate-400'
                                    }`}
                                  >
                                    {row.critical}
                                  </span>
                                </td>
                                <td className="py-2 px-3 font-mono text-slate-300">
                                  {routerConfig.manualByTask?.[row.id]?.openaiModel || 'gpt-4o'}
                                </td>
                                <td className="py-2 px-3 font-mono text-slate-300">
                                  {routerConfig.manualByTask?.[row.id]?.geminiModel || 'gemini-2.0-flash'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {isAdminAuthenticated && (
                      <div className="flex justify-end pt-2">
                        <button
                          type="button"
                          onClick={handleSaveRouterConfig}
                          disabled={savingRouter}
                          className="px-5 py-2 rounded-lg bg-orange-600 hover:bg-orange-500 text-white text-xs font-semibold shadow-md flex items-center gap-2"
                        >
                          {savingRouter && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                          <span>Guardar Parámetros de Enrutamiento</span>
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* TAB 7: GASTOS Y PRESUPUESTOS */}
            {activeTab === 'budget' && (
              <div className="space-y-6 max-w-4xl">
                {renderAdminBanner()}
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-base font-semibold text-white">Consumo y Presupuestos de Inteligencia Artificial</h3>
                    <p className="text-xs text-slate-400">
                      Métricas de gasto por proveedor, auditoría de tokens y límites diarios.
                    </p>
                  </div>
                  <a
                    href={`${getApiBaseUrl()}/api/v1/config/ai/consumption/export`}
                    target="_blank"
                    rel="noreferrer"
                    className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 flex items-center gap-1.5"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Exportar CSV</span>
                  </a>
                </div>

                {/* Consumption Stats Cards */}
                {consumptionStats && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="p-3.5 rounded-lg bg-[#111624] border border-[#21283b]">
                      <span className="text-[10px] text-slate-400 uppercase font-mono block">Gasto Hoy</span>
                      <span className="text-lg font-bold font-mono text-white">
                        ${consumptionStats.todaySpendUsd?.toFixed(4) || '0.0000'}
                      </span>
                      <span className="text-[10px] text-slate-500 block">
                        {consumptionStats.todayCalls || 0} llamadas
                      </span>
                    </div>

                    <div className="p-3.5 rounded-lg bg-[#111624] border border-[#21283b]">
                      <span className="text-[10px] text-slate-400 uppercase font-mono block">Últimos 7 Días</span>
                      <span className="text-lg font-bold font-mono text-white">
                        ${consumptionStats.last7DaysSpendUsd?.toFixed(4) || '0.0000'}
                      </span>
                    </div>

                    <div className="p-3.5 rounded-lg bg-[#111624] border border-[#21283b]">
                      <span className="text-[10px] text-slate-400 uppercase font-mono block">Gasto del Mes</span>
                      <span className="text-lg font-bold font-mono text-white">
                        ${consumptionStats.monthSpendUsd?.toFixed(4) || '0.0000'}
                      </span>
                    </div>

                    <div className="p-3.5 rounded-lg bg-[#111624] border border-[#21283b]">
                      <span className="text-[10px] text-slate-400 uppercase font-mono block">Total Histórico</span>
                      <span className="text-lg font-bold font-mono text-white">
                        ${consumptionStats.totalSpendUsd?.toFixed(4) || '0.0000'}
                      </span>
                      <span className="text-[10px] text-slate-500 block">
                        {consumptionStats.totalCalls || 0} calls | {consumptionStats.avgLatencyMs || 0}ms avg
                      </span>
                    </div>
                  </div>
                )}

                {/* Consumption History Table */}
                <div className="p-4 rounded-lg bg-[#111624] border border-[#21283b] space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-orange-400">
                      Registro de Llamadas Recientes
                    </h4>
                    <span className="text-[11px] text-slate-400 font-mono">
                      Mostrando {consumptionLogs.length} llamadas
                    </span>
                  </div>

                  <div className="overflow-x-auto custom-scrollbar max-h-72">
                    <table className="w-full text-xs text-left">
                      <thead className="bg-[#0e121d] text-slate-400 sticky top-0 border-b border-[#21283b]">
                        <tr>
                          <th className="py-2 px-3">Fecha/Hora</th>
                          <th className="py-2 px-3">Proveedor</th>
                          <th className="py-2 px-3">Modelo</th>
                          <th className="py-2 px-3">Tokens</th>
                          <th className="py-2 px-3">Costo USD</th>
                          <th className="py-2 px-3">Latencia</th>
                          <th className="py-2 px-3">Estado</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#1b2234] font-mono">
                        {consumptionLogs.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="py-6 text-center text-slate-500">
                              No hay llamadas de IA registradas aún.
                            </td>
                          </tr>
                        ) : (
                          consumptionLogs.map((log) => (
                            <tr key={log.id} className="hover:bg-slate-900/40">
                              <td className="py-1.5 px-3 text-slate-400">
                                {new Date(log.timestamp).toLocaleTimeString('es-AR', { hour12: false })}
                              </td>
                              <td className="py-1.5 px-3 font-semibold text-white">{log.provider}</td>
                              <td className="py-1.5 px-3 text-slate-300">{log.model}</td>
                              <td className="py-1.5 px-3 text-slate-400">
                                {log.tokensPrompt + log.tokensCompletion}
                              </td>
                              <td className="py-1.5 px-3 text-emerald-400">${log.costUsd?.toFixed(5)}</td>
                              <td className="py-1.5 px-3 text-slate-400">{log.latencyMs}ms</td>
                              <td className="py-1.5 px-3">
                                <span
                                  className={`px-1.5 py-0.5 rounded text-[10px] ${
                                    log.status === 'SUCCESS' ? 'text-emerald-400' : 'text-red-400'
                                  }`}
                                >
                                  {log.status}
                                </span>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 8: NOTIFICACIONES */}
            {activeTab === 'notifications' && (
              <div className="space-y-6 max-w-4xl">
                <div>
                  <h3 className="text-base font-semibold text-white">Canales de Alerta y Notificación</h3>
                  <p className="text-xs text-slate-400">
                    Configuración de Telegram Bot y notificaciones Web Push PWA para móviles.
                  </p>
                </div>

                <div className="p-4 rounded-lg bg-[#111624] border border-[#21283b] space-y-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-orange-400 flex items-center gap-2">
                    <Bell className="w-4 h-4" /> Telegram Bot
                  </h4>
                  <p className="text-xs text-slate-300">
                    Envío de alertas instantáneas con gráficos ASCII multitemporales y desglose cuantitativo cuando se valida una entrada 1:4.
                  </p>
                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await fetch(`${getApiBaseUrl()}/api/v1/notifications/telegram/test`, { method: 'POST' });
                          alert('Alerta de prueba enviada a Telegram.');
                        } catch {}
                      }}
                      className="px-4 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700"
                    >
                      Enviar Mensaje de Prueba
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 9: SEGURIDAD Y AUDITORÍA */}
            {activeTab === 'security' && (
              <div className="space-y-6 max-w-4xl">
                <div>
                  <h3 className="text-base font-semibold text-white">Seguridad y Auditoría Administrativa</h3>
                  <p className="text-xs text-slate-400">
                    Control de acceso, Kill Switch de emergencia y registro cronológico inmutable de cambios.
                  </p>
                </div>

                {/* Authentication Form */}
                {!isAdminAuthenticated ? (
                  <div className="p-5 rounded-lg bg-slate-900 border border-amber-600/40 space-y-4">
                    <div className="flex items-center gap-2 text-amber-400">
                      <Lock className="w-5 h-5" />
                      <h4 className="text-sm font-bold">Autenticación de Administrador Requerida</h4>
                    </div>
                    <p className="text-xs text-slate-300">
                      Para modificar políticas de riesgo, credenciales Bybit o parámetros de IA, ingrese la clave administrativa.
                    </p>

                    {authError && (
                      <div className="p-3 rounded bg-red-950/60 border border-red-800 text-red-200 text-xs flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                        <span>{authError}</span>
                      </div>
                    )}

                    <form onSubmit={handleAdminLogin} className="space-y-2">
                      <div className="flex gap-2">
                        <input
                          type="password"
                          placeholder="Clave de administración"
                          value={adminKeyInput}
                          onChange={(e) => setAdminKeyInput(e.target.value)}
                          className="flex-1 bg-[#0a0d14] border border-[#21283b] rounded px-3 py-1.5 text-xs text-white font-mono focus:border-orange-500 focus:outline-none"
                        />
                        <button
                          type="submit"
                          disabled={isLoggingIn}
                          className="px-4 py-1.5 rounded bg-orange-600 hover:bg-orange-500 text-white text-xs font-semibold cursor-pointer"
                        >
                          {isLoggingIn ? 'Verificando...' : 'Acceder'}
                        </button>
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-slate-400">
                        <span>Clave local: <code className="text-orange-400 font-mono">nanolabs_admin_sec_2026</code></span>
                        <button
                          type="button"
                          onClick={() => setAdminKeyInput('nanolabs_admin_sec_2026')}
                          className="text-orange-400 hover:text-orange-300 underline font-medium cursor-pointer"
                        >
                          Completar
                        </button>
                      </div>
                    </form>
                  </div>
                ) : (
                  <div className="p-4 rounded-lg bg-emerald-950/30 border border-emerald-800/50 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Shield className="w-5 h-5 text-emerald-400" />
                      <div>
                        <span className="text-xs font-bold text-white block">Sesión de Administrador Autorizada</span>
                        <span className="text-[11px] text-emerald-300 font-mono">
                          Token activo con validación timing-safe
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={handleAdminLogout}
                      className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs"
                    >
                      Cerrar Sesión
                    </button>
                  </div>
                )}

                {/* Kill Switch Toggle */}
                <div className="p-4 rounded-lg bg-[#111624] border border-[#21283b] space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-xs font-bold uppercase tracking-wider text-red-400 flex items-center gap-2">
                        <Power className="w-4 h-4" /> Kill Switch de Emergencia Global
                      </h4>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Cancela inmediatamente todas las señales activas y bloquea toda nueva oportunidad.
                      </p>
                    </div>
                    {isAdminAuthenticated && (
                      <button
                        onClick={() => setConfirmKillSwitch(!confirmKillSwitch)}
                        className={`px-3 py-1.5 rounded text-xs font-semibold ${
                          configSummary?.killSwitchActive
                            ? 'bg-red-600 hover:bg-red-500 text-white'
                            : 'bg-slate-800 hover:bg-red-950 text-red-400 border border-red-900'
                        }`}
                      >
                        {configSummary?.killSwitchActive ? 'DESACTIVAR KILL SWITCH' : 'ACTIVAR KILL SWITCH'}
                      </button>
                    )}
                  </div>

                  {confirmKillSwitch && (
                    <div className="p-3 rounded bg-red-950/60 border border-red-800 text-xs text-red-200 space-y-2">
                      <p>¿Está absolutamente seguro de cambiar el estado del Kill Switch?</p>
                      <div className="flex gap-2">
                        <button
                          onClick={handleToggleKillSwitch}
                          className="px-3 py-1 rounded bg-red-600 text-white font-bold"
                        >
                          Confirmar
                        </button>
                        <button
                          onClick={() => setConfirmKillSwitch(false)}
                          className="px-3 py-1 rounded bg-slate-800 text-slate-300"
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Audit Logs Table */}
                <div className="p-4 rounded-lg bg-[#111624] border border-[#21283b] space-y-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-orange-400">
                    Historial de Auditoría de Configuración
                  </h4>

                  <div className="overflow-x-auto custom-scrollbar max-h-60">
                    <table className="w-full text-xs text-left">
                      <thead className="bg-[#0e121d] text-slate-400 sticky top-0 border-b border-[#21283b]">
                        <tr>
                          <th className="py-2 px-3">Fecha/Hora</th>
                          <th className="py-2 px-3">Categoría</th>
                          <th className="py-2 px-3">Acción</th>
                          <th className="py-2 px-3">Usuario / IP</th>
                          <th className="py-2 px-3">Detalles</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#1b2234] font-mono">
                        {auditLogs.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="py-6 text-center text-slate-500">
                              No hay registros de auditoría disponibles o se requiere inicio de sesión.
                            </td>
                          </tr>
                        ) : (
                          auditLogs.map((log) => (
                            <tr key={log.id} className="hover:bg-slate-900/40">
                              <td className="py-1.5 px-3 text-slate-400">
                                {new Date(log.timestamp).toLocaleTimeString('es-AR', { hour12: false })}
                              </td>
                              <td className="py-1.5 px-3 text-orange-400 font-semibold">{log.category}</td>
                              <td className="py-1.5 px-3 text-slate-200">{log.action}</td>
                              <td className="py-1.5 px-3 text-slate-400">
                                {log.adminUser} ({log.ipAddress || 'local'})
                              </td>
                              <td className="py-1.5 px-3 text-slate-400 truncate max-w-xs">
                                {JSON.stringify(log.details)}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </main>
        </div>
      </div>

      {/* Unlock Dialog Modal */}
      {showUnlockModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="relative w-full max-w-md bg-[#111624] border border-orange-500/40 rounded-xl shadow-2xl p-6 text-slate-200">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-orange-500/20 border border-orange-500/40 flex items-center justify-center text-orange-400">
                  <Key className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Desbloquear Edición</h3>
                  <p className="text-xs text-slate-400">Autenticación de administrador</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => { setShowUnlockModal(false); setAuthError(''); }}
                className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-300 mb-4 leading-relaxed">
              Ingrese su clave administrativa para modificar parámetros de riesgo, claves de Bybit e IAs, o ajustar el router inteligente.
            </p>

            {authError && (
              <div className="mb-4 p-3 rounded-lg bg-red-950/70 border border-red-800 text-red-200 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                <span>{authError}</span>
              </div>
            )}

            <form onSubmit={handleAdminLogin} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Clave de Administrador
                </label>
                <input
                  type="password"
                  autoFocus
                  placeholder="••••••••••••••••"
                  value={adminKeyInput}
                  onChange={(e) => setAdminKeyInput(e.target.value)}
                  className="w-full bg-[#0a0d14] border border-[#21283b] rounded-lg px-3.5 py-2 text-xs text-white font-mono focus:border-orange-500 focus:outline-none"
                />
                <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400">
                  <span>Clave local: <code className="text-orange-400 font-mono">nanolabs_admin_sec_2026</code></span>
                  <button
                    type="button"
                    onClick={() => setAdminKeyInput('nanolabs_admin_sec_2026')}
                    className="text-orange-400 hover:text-orange-300 underline font-medium cursor-pointer"
                  >
                    Completar
                  </button>
                </div>
              </div>

              <div className="flex gap-2 justify-end pt-2">
                <button
                  type="button"
                  onClick={() => { setShowUnlockModal(false); setAuthError(''); }}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isLoggingIn || !adminKeyInput.trim()}
                  className="px-5 py-2 rounded-lg bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white text-xs font-bold shadow-lg shadow-orange-600/30 flex items-center gap-2 cursor-pointer"
                >
                  {isLoggingIn ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
                  <span>Desbloquear</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
