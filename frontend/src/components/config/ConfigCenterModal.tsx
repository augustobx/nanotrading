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
  Sparkles,
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
  const [csrfToken, setCsrfToken] = useState<string>('');
  const [authError, setAuthError] = useState<string>('');
  const [isLoggingIn, setIsLoggingIn] = useState<boolean>(false);

  // Setup Wizard State (when backend is uninitialized)
  const [isInitialized, setIsInitialized] = useState<boolean>(true);
  const [setupPassword, setSetupPassword] = useState<string>('');
  const [setupConfirm, setSetupConfirm] = useState<string>('');
  const [setupError, setSetupError] = useState<string>('');
  const [isSettingUp, setIsSettingUp] = useState<boolean>(false);

  // AI Connection Test (Phase 4.6.1)
  const [testingAi, setTestingAi] = useState<'openai' | 'gemini' | null>(null);
  const [aiTestResults, setAiTestResults] = useState<{ openai?: any; gemini?: any }>({});

  // Safe Budget Reactivation (Phase 4.6.1)
  const [reactivateDailyLimit, setReactivateDailyLimit] = useState<number>(1.00);

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
  const [openaiReasoningEffort, setOpenaiReasoningEffort] = useState<'low' | 'medium' | 'high'>('medium');
  const [showOpenaiKey, setShowOpenaiKey] = useState<boolean>(false);
  const [geminiKey, setGeminiKey] = useState<string>('');
  const [geminiModel, setGeminiModel] = useState<string>('gemini-2.0-flash');
  const [showGeminiKey, setShowGeminiKey] = useState<boolean>(false);
  const [geminiAvailableModels, setGeminiAvailableModels] = useState<any[]>([]);
  const [loadingGeminiModels, setLoadingGeminiModels] = useState<boolean>(false);
  const [savingAiCreds, setSavingAiCreds] = useState<boolean>(false);
  const [aiCredsMsg, setAiCredsMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // AI Router
  const [routerConfig, setRouterConfig] = useState<any>(DEFAULT_ROUTER_CONFIG);
  const [savingRouter, setSavingRouter] = useState<boolean>(false);
  const [routerMsg, setRouterMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // AI Consumption & Hard Budget
  const [consumptionStats, setConsumptionStats] = useState<any>(null);
  const [consumptionFetchError, setConsumptionFetchError] = useState<string | null>(null);
  const [budgetFetchError, setBudgetFetchError] = useState<string | null>(null);
  const [consumptionLogs, setConsumptionLogs] = useState<any[]>([]);
  const [selectedProviderFilter, setSelectedProviderFilter] = useState<string>('ALL');

  // Hard Budget Limit (Fase 4.6)
  const [hardBudgetSummary, setHardBudgetSummary] = useState<any>(null);
  const [hardBudgetForm, setHardBudgetForm] = useState({
    dailyBudgetLimitUsd: 0.50,
    monthlyBudgetLimitUsd: 10.00,
    maxCostPerRequestUsd: 0.05,
    autoResetPeriod: true,
  });
  const [savingBudget, setSavingBudget] = useState<boolean>(false);
  const [reactivatingBudget, setReactivatingBudget] = useState<boolean>(false);
  const [budgetMsg, setBudgetMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // OpenAI Free Tier (Data Sharing)
  const [verifyingFreeTier, setVerifyingFreeTier] = useState<boolean>(false);
  const [freeTierMsg, setFreeTierMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Security & Audit
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [loadingAudit, setLoadingAudit] = useState<boolean>(false);
  const [confirmKillSwitch, setConfirmKillSwitch] = useState<boolean>(false);

  // Check authentication status on mount (HttpOnly session cookie + CSRF)
  useEffect(() => {
    checkAuthStatus();
  }, []);

  const checkAuthStatus = async () => {
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/v1/auth/status`, {
        credentials: 'include',
      });
      if (res.ok) {
        const json = await res.json();
        setIsInitialized(json.initialized !== false);
        setIsAdminAuthenticated(!!json.authenticated);
        if (json.csrfToken) setCsrfToken(json.csrfToken);
      }
    } catch {}
  };

  useEffect(() => {
    if (isOpen) {
      fetchSummary();
      fetchRiskPolicy();
      fetchBybitConfig();
      fetchAiCredentials();
      fetchRouterConfig();
      fetchConsumptionData();
      fetchHardBudget();
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
    if (csrfToken) {
      headers['x-csrf-token'] = csrfToken;
    }
    return headers;
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
        credentials: 'include',
        body: JSON.stringify({ key: adminKeyInput.trim() }),
      });
      const json = await res.json();
      if (json.success) {
        if (json.csrfToken) setCsrfToken(json.csrfToken);
        setIsAdminAuthenticated(true);
        setAdminKeyInput('');
        setShowUnlockModal(false);
        fetchAuditLogs();
        fetchSummary();
        fetchRiskPolicy();
        fetchBybitConfig();
        fetchAiCredentials();
        fetchRouterConfig();
        fetchHardBudget();
      } else {
        setAuthError(json.error || 'Credenciales incorrectas');
      }
    } catch (err: any) {
      setAuthError(err.message || 'Error de conexión');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleInitialSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!setupPassword) {
      setSetupError('Ingrese una contraseña administrativa');
      return;
    }
    if (setupPassword.length < 10) {
      setSetupError('La contraseña debe tener al menos 10 caracteres');
      return;
    }
    if (setupPassword !== setupConfirm) {
      setSetupError('Las contraseñas no coinciden');
      return;
    }
    setIsSettingUp(true);
    setSetupError('');
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/v1/auth/setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ password: setupPassword }),
      });
      const json = await res.json();
      if (json.success) {
        if (json.csrfToken) setCsrfToken(json.csrfToken);
        setIsInitialized(true);
        setIsAdminAuthenticated(true);
        setShowUnlockModal(false);
        setSetupPassword('');
        setSetupConfirm('');
        fetchAuditLogs();
        fetchSummary();
        fetchRiskPolicy();
        fetchBybitConfig();
        fetchAiCredentials();
        fetchRouterConfig();
        fetchHardBudget();
      } else {
        setSetupError(json.error || 'Error al configurar administrador');
      }
    } catch (err: any) {
      setSetupError(err.message || 'Error de conexión');
    } finally {
      setIsSettingUp(false);
    }
  };

  const handleAdminLogout = async () => {
    try {
      await fetch(`${getApiBaseUrl()}/api/v1/auth/logout`, {
        method: 'POST',
        headers: getHeaders(true),
        credentials: 'include',
      });
    } catch {}
    setCsrfToken('');
    setIsAdminAuthenticated(false);
  };

  const fetchSummary = async () => {
    setLoadingSummary(true);
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/v1/config/summary`, { credentials: 'include' });
      if (res.ok) {
        const json = await res.json();
        if (json.success) setConfigSummary(json.data);
      }
    } catch {}
    setLoadingSummary(false);
  };

  const fetchRiskPolicy = async () => {
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/v1/config/risk`, { credentials: 'include' });
      if (res.ok) {
        const json = await res.json();
        if (json.success && json.data) {
          setRiskPolicy((prev: any) => ({
            ...DEFAULT_RISK_POLICY,
            ...json.data,
            stopLossCeilings: {
              ...DEFAULT_RISK_POLICY.stopLossCeilings,
              ...(json.data.stopLossCeilings || {}),
            },
            marketRestrictions: {
              ...DEFAULT_RISK_POLICY.marketRestrictions,
              ...(json.data.marketRestrictions || {}),
            },
          }));
        }
      }
    } catch {}
  };

  const fetchBybitConfig = async () => {
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/v1/config/bybit`, { credentials: 'include' });
      if (res.ok) {
        const json = await res.json();
        if (json.success) setBybitConfig(json.data);
      }
    } catch {}
  };

  const fetchAiCredentials = async () => {
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/v1/config/ai/credentials`, { credentials: 'include' });
      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          setAiCreds(json.data);
          if (json.data?.gemini?.model) {
            setGeminiModel(json.data.gemini.model);
          }
          if (json.data?.openai?.model) {
            setOpenaiModel(json.data.openai.model);
          }
        }
      }
    } catch {}
    fetchGeminiModels();
  };

  const fetchGeminiModels = async () => {
    setLoadingGeminiModels(true);
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/v1/config/ai/gemini/models`, { credentials: 'include' });
      if (res.ok) {
        const json = await res.json();
        if (json.models && Array.isArray(json.models)) {
          setGeminiAvailableModels(json.models);
        }
      }
    } catch {}
    setLoadingGeminiModels(false);
  };

  const fetchRouterConfig = async () => {
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/v1/config/ai/router`, { credentials: 'include' });
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
      const res = await fetch(`${getApiBaseUrl()}/api/v1/config/ai/consumption?limit=50`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error(res.status === 401
        ? 'Iniciá sesión como administrador para consultar el consumo de IA.'
        : `No se pudo consultar el consumo (HTTP ${res.status}).`);
      const json = await res.json();
      if (!json.success || !json.data?.stats) throw new Error('La API no devolvió datos válidos de consumo.');
      setConsumptionStats(json.data.stats);
      setConsumptionLogs(json.data.logs || []);
      setConsumptionFetchError(null);
    } catch (err: any) {
      setConsumptionStats(null);
      setConsumptionLogs([]);
      setConsumptionFetchError(err.message || 'Datos de consumo no disponibles.');
    }
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
      if (json.success && json.data?.valid) {
        setBybitTestResult(json.data);
        if (json.data.detectedEnvironment && json.data.detectedEnvironment !== bybitEnv) {
          setBybitEnv(json.data.detectedEnvironment);
        }
        setBybitMsg({ type: 'success', text: `Verificación exitosa: conexión y permisos de Bybit (${json.data.detectedEnvironment || bybitEnv}) validados correctamente.` });
      } else {
        setBybitTestResult(null);
        setBybitMsg({ type: 'error', text: json.data?.error || json.error || 'Fallo en verificación Bybit. Verifique API key, secret y entorno.' });
      }
    } catch (err: any) {
      setBybitTestResult(null);
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
        if (json.warning) {
          setBybitMsg({ type: 'error', text: `Credenciales guardadas y cifradas. Aviso: ${json.warning}` });
        } else {
          setBybitMsg({ type: 'success', text: 'Credenciales Bybit cifradas y guardadas con éxito en base de datos.' });
        }
        setBybitApiKey('');
        setBybitApiSecret('');
        setBybitTestResult(null);
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

  const fetchHardBudget = async () => {
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/v1/config/budget`, { credentials: 'include' });
      if (!res.ok) throw new Error(res.status === 401
        ? 'Iniciá sesión como administrador para ver el presupuesto de IA.'
        : `No se pudo consultar el presupuesto (HTTP ${res.status}).`);
      const json = await res.json();
      if (!json.success || !json.data) throw new Error('Respuesta de presupuesto inválida.');
      setHardBudgetSummary(json.data);
      setHardBudgetForm({
        dailyBudgetLimitUsd: json.data.dailyBudgetLimitUsd ?? 0.50,
        monthlyBudgetLimitUsd: json.data.monthlyBudgetLimitUsd ?? 10.00,
        maxCostPerRequestUsd: json.data.maxCostPerRequestUsd ?? 0.05,
        autoResetPeriod: true,
      });
      setBudgetFetchError(null);
    } catch (err: any) {
      setHardBudgetSummary(null);
      setBudgetFetchError(err.message || 'Presupuesto no disponible.');
    }
  };

  const handleSaveBudget = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdminAuthenticated) return;
    setSavingBudget(true);
    setBudgetMsg(null);
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/v1/config/budget`, {
        method: 'POST',
        headers: getHeaders(true),
        body: JSON.stringify(hardBudgetForm),
      });
      const json = await res.json();
      if (json.success) {
        setHardBudgetSummary(json.data);
        setBudgetMsg({ type: 'success', text: 'Límites de presupuesto estricto actualizados y activos.' });
        fetchSummary();
        onConfigChanged?.();
      } else {
        setBudgetMsg({ type: 'error', text: json.error || 'Error al guardar límites de presupuesto.' });
      }
    } catch (err: any) {
      setBudgetMsg({ type: 'error', text: err.message || 'Error de conexión' });
    }
    setSavingBudget(false);
  };

  const handleReactivateBudget = async () => {
    if (!isAdminAuthenticated) return;
    setReactivatingBudget(true);
    setBudgetMsg(null);
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/v1/config/budget/reactivate`, {
        method: 'POST',
        headers: getHeaders(true),
        credentials: 'include',
        body: JSON.stringify({
          newDailyLimitUsd: reactivateDailyLimit,
        }),
      });
      const json = await res.json();
      if (json.success) {
        setHardBudgetSummary(json.data);
        setBudgetMsg({
          type: 'success',
          text: `Presupuesto reactivado exitosamente. Nuevo límite diario: $${(json.data?.dailyBudgetLimitUsd || reactivateDailyLimit).toFixed(2)} USD. Evaluaciones de IA reanudadas.`,
        });
        fetchSummary();
        fetchHardBudget();
        onConfigChanged?.();
      } else {
        setBudgetMsg({ type: 'error', text: json.error || 'Error al reactivar presupuesto' });
      }
    } catch (err: any) {
      setBudgetMsg({ type: 'error', text: err.message || 'Error de conexión' });
    } finally {
      setReactivatingBudget(false);
    }
  };

  const handleVerifyFreeTier = async () => {
    if (!isAdminAuthenticated) return;
    setVerifyingFreeTier(true);
    setFreeTierMsg(null);
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/v1/config/ai/openai/verify-free-tier`, {
        method: 'POST',
        headers: getHeaders(true),
        credentials: 'include',
        body: JSON.stringify({ adminDeclaration: true, dataSharingConfirmed: true }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        setFreeTierMsg({
          type: 'success',
          text: json.message || 'Beneficio de tokens gratuitos verificado exitosamente.',
        });
        fetchHardBudget();
      } else {
        setFreeTierMsg({
          type: 'error',
          text: json.error || 'No se pudo verificar el acceso a tokens gratuitos con OpenAI.',
        });
      }
    } catch (err: any) {
      setFreeTierMsg({ type: 'error', text: err.message || 'Error de conexión verificando beneficio.' });
    } finally {
      setVerifyingFreeTier(false);
    }
  };

  const handleToggleFreeTier = async (enabled: boolean) => {
    if (!isAdminAuthenticated) return;
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/v1/config/budget`, {
        method: 'POST',
        headers: getHeaders(true),
        credentials: 'include',
        body: JSON.stringify({
          openaiFreeTier: {
            ...hardBudgetSummary?.openaiFreeTier,
            enabled,
          },
        }),
      });
      if (res.ok) {
        fetchHardBudget();
      }
    } catch {}
  };

  const handleTestAiConnection = async (provider: 'openai' | 'gemini') => {
    if (!isAdminAuthenticated) {
      setShowUnlockModal(true);
      return;
    }
    setTestingAi(provider);
    setAiCredsMsg(null);
    try {
      const model = provider === 'openai' ? openaiModel : geminiModel;
      const res = await fetch(`${getApiBaseUrl()}/api/v1/config/ai/test`, {
        method: 'POST',
        headers: getHeaders(true),
        credentials: 'include',
        body: JSON.stringify({
          provider,
          model,
          reasoningEffort: provider === 'openai' ? openaiReasoningEffort : undefined,
        }),
      });
      const json = await res.json();
      const testData = json.data || json;
      setAiTestResults((prev) => ({
        ...prev,
        [provider]: testData,
      }));
      if (json.success && (testData.valid || testData.success)) {
        setAiCredsMsg({
          type: 'success',
          text: `Prueba en vivo exitosa con ${provider.toUpperCase()} (${testData.model || model}): Latencia ${testData.latencyMs}ms, Costo real $${(testData.costUsd || 0).toFixed(5)} USD.`,
        });
      } else {
        setAiCredsMsg({
          type: 'error',
          text: `Fallo en prueba ${provider.toUpperCase()}: ${testData.error || json.error || 'Error al conectar con la API'}`,
        });
      }
      fetchAiCredentials();
      fetchHardBudget();
      fetchSummary();
      onConfigChanged?.();
    } catch (err: any) {
      setAiTestResults((prev) => ({
        ...prev,
        [provider]: { success: false, valid: false, error: err.message || 'Error de red' },
      }));
      setAiCredsMsg({
        type: 'error',
        text: `Error de red al conectar con ${provider.toUpperCase()}: ${err.message}`,
      });
    } finally {
      setTestingAi(null);
    }
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
        body: JSON.stringify({
          provider,
          apiKey: key.trim(),
          model,
          reasoningEffort: provider === 'openai' ? openaiReasoningEffort : undefined,
        }),
      });
      const json = await res.json();
      if (json.success) {
        setAiCredsMsg({ type: 'success', text: `Clave de ${provider.toUpperCase()} cifrada y aplicada en tiempo real.` });
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

                  {bybitTestResult && bybitTestResult.valid && (
                    <div className="p-3.5 rounded-lg bg-[#0a0d14] border border-emerald-800/60 space-y-2 text-xs">
                      <div className="flex items-center justify-between text-emerald-400 font-bold">
                        <span className="flex items-center gap-1.5">
                          <CheckCircle2 className="w-4 h-4" /> Conexión verificada exitosamente
                        </span>
                        <span className="text-[11px] font-mono uppercase text-slate-400">
                          {bybitTestResult.detectedEnvironment || bybitEnv}
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
                    <div className="flex items-center gap-2">
                      {(() => {
                        const status = aiCreds?.openai?.status || (aiCreds?.openai?.configured ? 'CONFIGURED' : 'UNCONFIGURED');
                        switch (status) {
                          case 'VERIFIED':
                            return (
                              <span className="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-emerald-950 text-emerald-300 border border-emerald-600 flex items-center gap-1">
                                <CheckCircle2 className="w-3 h-3 text-emerald-400" /> VERIFIED (Conexión Real Verificada)
                              </span>
                            );
                          case 'AVAILABLE':
                            return <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-emerald-950/80 text-emerald-300 border border-emerald-700">AVAILABLE</span>;
                          case 'DEGRADED':
                            return <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-amber-950 text-amber-300 border border-amber-800">DEGRADED</span>;
                          case 'RATE_LIMITED':
                            return <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-purple-950 text-purple-300 border border-purple-800">RATE_LIMITED</span>;
                          case 'BUDGET_EXCEEDED':
                            return <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-red-950 text-red-300 border border-red-800">BUDGET_EXCEEDED</span>;
                          case 'AUTH_ERROR':
                            return <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-red-950 text-red-300 border border-red-800">AUTH_ERROR (Clave Inválida)</span>;
                          case 'CONFIGURED':
                            return <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-blue-950 text-blue-300 border border-blue-800">CONFIGURED (Sin Verificar)</span>;
                          default:
                            return <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-slate-800 text-slate-400">NO CONFIGURADO</span>;
                        }
                      })()}
                      {aiCreds?.openai?.apiKeyMasked && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-slate-800 text-slate-300">
                          {aiCreds.openai.apiKeyMasked}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Data Sharing Benefit Indicator */}
                  <div className="p-3 rounded bg-[#0a0d14] border border-[#1f2638] flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-emerald-400 shrink-0" />
                      <span className="text-slate-300">Programa OpenAI Data Sharing:</span>
                      {hardBudgetSummary?.openaiFreeTier?.enabled ? (
                        hardBudgetSummary?.openaiFreeTier?.verificationStatus === 'CONFIRMED_BILLED' ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-950 text-emerald-300 border border-emerald-600">
                            COMPROBADO EN FACTURACIÓN (250k / 2.5M)
                          </span>
                        ) : hardBudgetSummary?.openaiFreeTier?.verificationStatus === 'DECLARED_BY_ADMIN' || hardBudgetSummary?.openaiFreeTier?.verified ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-950 text-amber-300 border border-amber-600">
                            DECLARADO POR ADMIN (Descuento Estimado)
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-slate-800 text-slate-400 border border-slate-700">
                            SIN VERIFICAR (Estimación Conservadora)
                          </span>
                        )
                      ) : (
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-slate-800 text-slate-400">
                          DESACTIVADO
                        </span>
                      )}
                    </div>
                    {isAdminAuthenticated && (
                      <button
                        type="button"
                        onClick={handleVerifyFreeTier}
                        disabled={verifyingFreeTier}
                        className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-emerald-300 text-[11px] font-medium border border-slate-700 flex items-center gap-1.5 self-start sm:self-auto cursor-pointer"
                      >
                        {verifyingFreeTier ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                        <span>Verificar Tokens Gratuitos</span>
                      </button>
                    )}
                  </div>

                  {aiCreds?.openai?.lastVerifiedAt && (
                    <div className="text-[11px] text-slate-400 font-mono flex items-center gap-2">
                      <span>Última verificación exitosa:</span>
                      <strong className="text-slate-200">
                        {new Date(aiCreds.openai.lastVerifiedAt).toLocaleString('es-AR')}
                      </strong>
                    </div>
                  )}

                  {aiCreds?.openai?.lastError && (
                    <div className="p-2.5 rounded bg-red-950/40 border border-red-800/60 text-xs text-red-200 flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                      <div>
                        <strong>Último error reportado:</strong> {aiCreds.openai.lastError}
                      </div>
                    </div>
                  )}

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
                        <option value="gpt-6-luna">OpenAI GPT-6 Luna (Responses API · US$0.10/1M · Razonamiento Cuantitativo)</option>
                        <option value="gpt-4o">OpenAI GPT-4o (Recomendado Clásico - Razonamiento Superior)</option>
                        <option value="gpt-4o-mini">OpenAI GPT-4o-mini (Económico - Ultrarrápido)</option>
                        <option value="o3-mini">OpenAI o3-mini (Razonamiento Lógico)</option>
                        <option value="gpt-4-turbo">OpenAI GPT-4 Turbo</option>
                      </select>
                    </div>

                    {openaiModel === 'gpt-6-luna' && (
                      <div className="p-3.5 rounded bg-[#0a0d14] border border-orange-500/30 space-y-3">
                        <div className="flex items-center justify-between">
                          <label className="block text-xs font-semibold text-orange-400">
                            Esfuerzo de Razonamiento (Reasoning Effort)
                          </label>
                          <span className="text-[10px] font-mono bg-orange-950 text-orange-300 border border-orange-800 px-2 py-0.5 rounded">
                            GPT-6 Luna Oficial
                          </span>
                        </div>
                        <select
                          disabled={!isAdminAuthenticated}
                          value={openaiReasoningEffort}
                          onChange={(e) => setOpenaiReasoningEffort(e.target.value as 'low' | 'medium' | 'high')}
                          className="w-full bg-[#111624] border border-[#21283b] rounded px-3 py-1.5 text-xs text-white font-mono focus:border-orange-500 focus:outline-none"
                        >
                          <option value="low">Bajo (Low) — Menor latencia, menor consumo de tokens de razonamiento</option>
                          <option value="medium">Medio (Medium - Recomendado) — Balance óptimo para confirmación de estructura</option>
                          <option value="high">Alto (High) — Análisis exhaustivo de libro de órdenes y trampas de liquidez</option>
                        </select>

                        <div className="p-2.5 rounded bg-slate-900 border border-slate-800 text-[11px] text-slate-300 space-y-1">
                          <div className="font-semibold text-emerald-400">Tarifas Vigentes OpenAI GPT-6 Luna (por millón de tokens):</div>
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono text-[10px] text-slate-300 pt-0.5">
                            <div>Entrada: <strong className="text-white">$0.10</strong></div>
                            <div>Caché Entrada: <strong className="text-emerald-400">$0.01</strong></div>
                            <div>Caché Escritura: <strong className="text-white">$0.125</strong></div>
                            <div>Salida: <strong className="text-amber-400">$0.50</strong>*</div>
                          </div>
                          <p className="text-[10px] text-slate-400">
                            *Los tokens internos de razonamiento se computan dentro de los tokens de salida facturables. Compatible con Responses API.
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Live Test Results Card */}
                    {aiTestResults.openai && (
                      <div
                        className={`p-3.5 rounded-lg border text-xs space-y-2 ${
                          aiTestResults.openai.valid || aiTestResults.openai.success
                            ? 'bg-emerald-950/30 border-emerald-700/60 text-emerald-200'
                            : 'bg-red-950/40 border-red-700 text-red-200'
                        }`}
                      >
                        <div className="flex items-center justify-between font-bold">
                          <span className="flex items-center gap-1.5">
                            {aiTestResults.openai.valid || aiTestResults.openai.success ? (
                              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                            ) : (
                              <AlertTriangle className="w-4 h-4 text-red-400" />
                            )}
                            {aiTestResults.openai.valid || aiTestResults.openai.success
                              ? `Verificación Exitosa con OpenAI (${aiTestResults.openai.model})`
                              : `Fallo en Verificación OpenAI (${aiTestResults.openai.model || openaiModel})`}
                          </span>
                          <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-black/40">
                            {aiTestResults.openai.status}
                          </span>
                        </div>

                        {aiTestResults.openai.valid || aiTestResults.openai.success ? (
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] font-mono pt-1 text-slate-300">
                            <div>Latencia: <strong className="text-white">{aiTestResults.openai.latencyMs}ms</strong></div>
                            <div>Tokens: <strong className="text-white">{aiTestResults.openai.tokensPrompt + aiTestResults.openai.tokensCompletion}</strong></div>
                            <div>Costo Real: <strong className="text-emerald-400">${aiTestResults.openai.costUsd?.toFixed(6)}</strong></div>
                            <div>Respuesta: <strong className="text-white">{aiTestResults.openai.parsedResponse?.status || 'OK'}</strong></div>
                          </div>
                        ) : (
                          <div className="text-xs text-red-300 space-y-1 pt-1">
                            <div><strong>Error de la API:</strong> {aiTestResults.openai.error}</div>
                            {aiTestResults.openai.errorCode && (
                              <div className="font-mono text-[10px] text-red-400">Código: {aiTestResults.openai.errorCode}</div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {isAdminAuthenticated && (
                    <div className="flex items-center justify-end gap-3 pt-2">
                      <button
                        type="button"
                        onClick={() => handleTestAiConnection('openai')}
                        disabled={testingAi === 'openai'}
                        className="px-4 py-1.5 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 text-xs font-medium border border-slate-700 flex items-center gap-2 cursor-pointer"
                        title="Realiza una llamada mínima real validada por Hard Budget para comprobar conectividad y modelo"
                      >
                        {testingAi === 'openai' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Power className="w-3.5 h-3.5 text-orange-400" />}
                        <span>Probar Conexión en Vivo</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSaveAiKey('openai')}
                        disabled={savingAiCreds}
                        className="px-4 py-1.5 rounded bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white text-xs font-semibold shadow-md flex items-center gap-2 cursor-pointer"
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
                    <div className="flex items-center gap-2">
                      {(() => {
                        const status = aiCreds?.gemini?.status || (aiCreds?.gemini?.configured ? 'CONFIGURED' : 'UNCONFIGURED');
                        switch (status) {
                          case 'VERIFIED':
                            return (
                              <span className="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-emerald-950 text-emerald-300 border border-emerald-600 flex items-center gap-1">
                                <CheckCircle2 className="w-3 h-3 text-emerald-400" /> VERIFIED (Conexión Real Verificada)
                              </span>
                            );
                          case 'AVAILABLE':
                            return <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-emerald-950/80 text-emerald-300 border border-emerald-700">AVAILABLE</span>;
                          case 'DEGRADED':
                            return <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-amber-950 text-amber-300 border border-amber-800">DEGRADED</span>;
                          case 'RATE_LIMITED':
                            return <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-purple-950 text-purple-300 border border-purple-800">RATE_LIMITED</span>;
                          case 'BUDGET_EXCEEDED':
                            return <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-red-950 text-red-300 border border-red-800">BUDGET_EXCEEDED</span>;
                          case 'AUTH_ERROR':
                            return <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-red-950 text-red-300 border border-red-800">AUTH_ERROR (Clave Inválida)</span>;
                          case 'CONFIGURED':
                            return <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-blue-950 text-blue-300 border border-blue-800">CONFIGURED (Sin Verificar)</span>;
                          default:
                            return <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-slate-800 text-slate-400">NO CONFIGURADO</span>;
                        }
                      })()}
                      {aiCreds?.gemini?.apiKeyMasked && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-slate-800 text-slate-300">
                          {aiCreds.gemini.apiKeyMasked}
                        </span>
                      )}
                    </div>
                  </div>

                  {aiCreds?.gemini?.lastVerifiedAt && (
                    <div className="text-[11px] text-slate-400 font-mono flex items-center gap-2">
                      <span>Última verificación exitosa:</span>
                      <strong className="text-slate-200">
                        {new Date(aiCreds.gemini.lastVerifiedAt).toLocaleString('es-AR')}
                      </strong>
                    </div>
                  )}

                  {aiCreds?.gemini?.lastError && (
                    <div className="p-2.5 rounded bg-red-950/40 border border-red-800/60 text-xs text-red-200 flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                      <div>
                        <strong>Último error reportado:</strong> {aiCreds.gemini.lastError}
                      </div>
                    </div>
                  )}

                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">API Key Google GenAI (AIzaSy...)</label>
                      <div className="relative">
                        <input
                          type={showGeminiKey ? 'text' : 'password'}
                          disabled={!isAdminAuthenticated}
                          placeholder={aiCreds?.gemini?.configured ? '••••••••••••••••' : 'AIzaSy... (Google AI Studio)'}
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
                      <p className="text-[11px] text-slate-500 mt-1">
                        Las claves oficiales provienen de Google AI Studio y comienzan con <code className="text-amber-400 font-mono">AIzaSy...</code>. Obtenga su clave gratuita en{' '}
                        <a
                          href="https://aistudio.google.com/app/apikey"
                          target="_blank"
                          rel="noreferrer"
                          className="text-orange-400 hover:underline"
                        >
                          aistudio.google.com/app/apikey
                        </a>.
                      </p>
                      {geminiKey && !geminiKey.startsWith('AIzaSy') && (
                        <div className="mt-1 text-[11px] text-amber-300 bg-amber-950/40 border border-amber-800/50 rounded px-2.5 py-1 flex items-center gap-1.5">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-400" />
                          <span>Atención: La clave ingresada no parece comenzar con 'AIzaSy...'. Verifique que sea de Google AI Studio.</span>
                        </div>
                      )}
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs text-slate-400">Modelo Seleccionado para Auditoría Crítica</label>
                        <button
                          type="button"
                          onClick={fetchGeminiModels}
                          disabled={loadingGeminiModels}
                          className="text-[11px] text-orange-400 hover:text-orange-300 flex items-center gap-1 cursor-pointer disabled:opacity-50"
                          title="Consultar en vivo los modelos habilitados para su API Key en Google AI Studio"
                        >
                          <RefreshCw className={`w-3 h-3 ${loadingGeminiModels ? 'animate-spin' : ''}`} />
                          <span>{loadingGeminiModels ? 'Sincronizando...' : 'Sincronizar Modelos'}</span>
                        </button>
                      </div>
                      <select
                        disabled={!isAdminAuthenticated}
                        value={geminiModel}
                        onChange={(e) => setGeminiModel(e.target.value)}
                        className="w-full bg-[#0a0d14] border border-[#21283b] rounded px-3 py-1.5 text-xs text-white font-mono focus:border-orange-500 focus:outline-none"
                      >
                        {geminiAvailableModels.length > 0 ? (
                          geminiAvailableModels.map((m: any) => (
                            <option key={m.id} value={m.id}>
                              {m.displayName || m.id} {m.isDefault ? '⭐ (Recomendado)' : m.isRecommended ? '✓' : ''}
                            </option>
                          ))
                        ) : (
                          <>
                            <option value="gemini-2.0-flash">Google Gemini 2.0 Flash (Recomendado - Baja latencia)</option>
                            <option value="gemini-2.0-flash-lite">Google Gemini 2.0 Flash Lite (Alta frecuencia / Económico)</option>
                            <option value="gemini-1.5-flash">Google Gemini 1.5 Flash (Multimodal 1M tokens)</option>
                            <option value="gemini-1.5-flash-8b">Google Gemini 1.5 Flash 8B (Ultra Ligero)</option>
                            <option value="gemini-1.5-pro">Google Gemini 1.5 Pro (Razonamiento profundo 2M tokens)</option>
                            <option value="gemini-2.0-pro-exp-02-05">Google Gemini 2.0 Pro Experimental</option>
                          </>
                        )}
                      </select>
                    </div>

                    {/* Live Test Results Card */}
                    {aiTestResults.gemini && (
                      <div
                        className={`p-3.5 rounded-lg border text-xs space-y-2 ${
                          aiTestResults.gemini.valid || aiTestResults.gemini.success
                            ? 'bg-emerald-950/30 border-emerald-700/60 text-emerald-200'
                            : 'bg-red-950/40 border-red-700 text-red-200'
                        }`}
                      >
                        <div className="flex items-center justify-between font-bold">
                          <span className="flex items-center gap-1.5">
                            {aiTestResults.gemini.valid || aiTestResults.gemini.success ? (
                              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                            ) : (
                              <AlertTriangle className="w-4 h-4 text-red-400" />
                            )}
                            {aiTestResults.gemini.valid || aiTestResults.gemini.success
                              ? `Verificación Exitosa con Google Gemini (${aiTestResults.gemini.model})`
                              : `Fallo en Verificación Gemini (${aiTestResults.gemini.model || geminiModel})`}
                          </span>
                          <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-black/40">
                            {aiTestResults.gemini.status}
                          </span>
                        </div>

                        {aiTestResults.gemini.valid || aiTestResults.gemini.success ? (
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] font-mono pt-1 text-slate-300">
                            <div>Latencia: <strong className="text-white">{aiTestResults.gemini.latencyMs}ms</strong></div>
                            <div>Tokens: <strong className="text-white">{aiTestResults.gemini.tokensPrompt + aiTestResults.gemini.tokensCompletion}</strong></div>
                            <div>Costo Real: <strong className="text-emerald-400">${aiTestResults.gemini.costUsd?.toFixed(6)}</strong></div>
                            <div>Respuesta: <strong className="text-white">{aiTestResults.gemini.parsedResponse?.status || 'OK'}</strong></div>
                          </div>
                        ) : (
                          <div className="text-xs text-red-300 space-y-1.5 pt-1">
                            <div><strong>Diagnóstico:</strong> {aiTestResults.gemini.error}</div>
                            {aiTestResults.gemini.errorCode && (
                              <div className="font-mono text-[10px] text-red-400">Código de API: {aiTestResults.gemini.errorCode}</div>
                            )}
                            {aiTestResults.gemini.status === 'AUTH_ERROR' && (
                              <div className="p-2 rounded bg-red-900/40 border border-red-700/50 text-[11px] text-red-200">
                                💡 <strong>Instrucción para resolver:</strong> Genere una nueva clave en{' '}
                                <a
                                  href="https://aistudio.google.com/app/apikey"
                                  target="_blank"
                                  rel="noreferrer"
                                  className="underline text-orange-400 font-semibold"
                                >
                                  Google AI Studio
                                </a>{' '}
                                (formato <code className="text-amber-300">AIzaSy...</code> de 39 caracteres), péguela en el campo de arriba y haga clic en <strong>Guardar Credenciales Gemini</strong>.
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {isAdminAuthenticated && (
                    <div className="flex items-center justify-end gap-3 pt-2">
                      <button
                        type="button"
                        onClick={() => handleTestAiConnection('gemini')}
                        disabled={testingAi === 'gemini'}
                        className="px-4 py-1.5 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 text-xs font-medium border border-slate-700 flex items-center gap-2 cursor-pointer"
                        title="Realiza una llamada mínima real validada por Hard Budget para comprobar conectividad y modelo"
                      >
                        {testingAi === 'gemini' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Power className="w-3.5 h-3.5 text-orange-400" />}
                        <span>Probar Conexión en Vivo</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSaveAiKey('gemini')}
                        disabled={savingAiCreds}
                        className="px-4 py-1.5 rounded bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white text-xs font-semibold shadow-md flex items-center gap-2 cursor-pointer"
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
                    <h3 className="text-base font-semibold text-white">Control Estricto de Presupuesto y Gastos de IA</h3>
                    <p className="text-xs text-slate-400">
                      Hard budget limit obligatorio (Fase 4.6), alertas en tiempo real (50%, 80%, 95%, 100%) y desglose de tokens de razonamiento.
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

                {budgetMsg && (
                  <div
                    className={`p-3 rounded text-xs flex items-center gap-2 ${
                      budgetMsg.type === 'success'
                        ? 'bg-emerald-950/60 text-emerald-200 border border-emerald-800'
                        : 'bg-red-950/60 text-red-200 border border-red-800'
                    }`}
                  >
                    {budgetMsg.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
                    <span>{budgetMsg.text}</span>
                  </div>
                )}

                {(consumptionFetchError || budgetFetchError) && (
                  <div role="alert" className="rounded-lg border border-amber-700/60 bg-amber-950/30 p-3 text-xs text-amber-200">
                    {consumptionFetchError || budgetFetchError}
                    {' '}Los datos no disponibles se muestran como no disponibles, no como gasto cero.
                  </div>
                )}
                {!hardBudgetSummary?.isBlocked && hardBudgetSummary?.lastBudgetDenial &&
                  Date.now() - hardBudgetSummary.lastBudgetDenial.timestamp < 2 * 60 * 60 * 1000 && (
                    <div className="rounded-lg border border-amber-700/60 bg-amber-950/30 p-3 text-xs text-amber-200">
                      <strong>Una solicitud de IA fue rechazada por su límite individual o por saldo insuficiente, no por dinero gastado.</strong>{' '}
                      {hardBudgetSummary.lastBudgetDenial.reason}
                    </div>
                  )}
                {/* Status Alert Banner */}
                {hardBudgetSummary?.isBlocked ? (
                  <div className="p-4 rounded-xl bg-red-950/50 border border-red-700/80 text-red-200 space-y-3 shadow-lg">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 font-bold text-sm text-red-300">
                        <AlertTriangle className="w-5 h-5 text-red-400 animate-pulse" />
                        <span>PAUSA DE IA: protección presupuestaria activa</span>
                      </div>
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-red-900 text-red-100 border border-red-600">
                        AI_BUDGET_EXCEEDED
                      </span>
                    </div>
                    <p className="text-xs text-red-300/90 leading-relaxed">
                      Las llamadas de IA están detenidas por una protección presupuestaria.
                      Gasto bruto de hoy: ${(hardBudgetSummary?.todayGrossSpendUsd ?? 0).toFixed(4)} USD;
                      reservado: ${(hardBudgetSummary?.reservedPendingUsd ?? 0).toFixed(4)} USD;
                      límite diario: ${(hardBudgetSummary?.dailyBudgetLimitUsd ?? 0.50).toFixed(2)} USD.
                      No implica que el gasto ya haya alcanzado el límite.
                      <strong> El monitoreo continuo de Bybit, la ingesta de velas, los indicadores cuantitativos y la gestión de órdenes existentes continúan 100% operativos.</strong>
                    </p>
                    <div className="p-2.5 rounded bg-black/40 border border-red-900/60 text-xs text-red-300 space-y-1">
                      <div><strong>Motivo del bloqueo:</strong> {hardBudgetSummary?.blockedReason || 'Protección presupuestaria configurada; ver estado de consumo y reservas.'}</div>
                      <div><strong>Regla Inviolable:</strong> El gasto confirmado es inmutable en base de datos. No se puede reducir ni resetear manualmente sin avanzar el período.</div>
                    </div>

                    {isAdminAuthenticated && (
                      <div className="pt-2 border-t border-red-900/60 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                        <div className="text-xs text-slate-300">
                          Para reactivar hoy, aumente explícitamente el límite diario:
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            step="0.10"
                            min={(hardBudgetSummary?.todaySpendUsd || 0.5) + 0.05}
                            value={reactivateDailyLimit}
                            onChange={(e) => setReactivateDailyLimit(parseFloat(e.target.value) || 1.00)}
                            className="w-24 bg-[#0a0d14] border border-[#21283b] rounded px-2.5 py-1 text-xs text-white font-mono"
                          />
                          <span className="text-xs text-slate-400">USD</span>
                          <button
                            type="button"
                            onClick={handleReactivateBudget}
                            disabled={reactivatingBudget || reactivateDailyLimit <= (hardBudgetSummary?.todaySpendUsd || 0)}
                            className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-xs shadow-md flex items-center gap-2 cursor-pointer transition-all"
                          >
                            {reactivatingBudget ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Power className="w-3.5 h-3.5" />}
                            <span>Reactivar con Nuevo Límite</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ) : hardBudgetSummary?.status === 'CRITICAL_95' ? (
                  <div className="p-3.5 rounded-lg bg-orange-950/50 border border-orange-700 text-orange-200 text-xs flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-orange-400" />
                      <span>Alerta Crítica: Se ha consumido más del 95% del presupuesto diario asignado (${hardBudgetSummary.todaySpendUsd?.toFixed(4)} / ${hardBudgetSummary.dailyBudgetLimitUsd?.toFixed(2)} USD).</span>
                    </div>
                  </div>
                ) : hardBudgetSummary?.status === 'WARNING_80' ? (
                  <div className="p-3.5 rounded-lg bg-amber-950/40 border border-amber-700/60 text-amber-200 text-xs flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-400" />
                    <span>Advertencia: El consumo diario superó el 80% del límite fijado.</span>
                  </div>
                ) : null}

                {/* Restablecimiento Automático Card */}
                <div className="p-4 rounded-lg bg-[#111624] border border-[#21283b] grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs font-mono">
                  <div className="space-y-1">
                    <span className="text-slate-400 block text-[10px] uppercase font-bold text-orange-400">
                      Próximo Restablecimiento Diario
                    </span>
                    <div className="text-slate-200">
                      UTC: <strong className="text-white">{hardBudgetSummary?.nextDailyResetUtc || '00:00:00 UTC'}</strong>
                    </div>
                    <div className="text-slate-400 text-[11px]">
                      Buenos Aires (ART): <strong className="text-orange-300">{hardBudgetSummary?.nextDailyResetAr || '21:00:00 ART'}</strong>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <span className="text-slate-400 block text-[10px] uppercase font-bold text-blue-400">
                      Próximo Restablecimiento Mensual
                    </span>
                    <div className="text-slate-200">
                      UTC: <strong className="text-white">{hardBudgetSummary?.nextMonthlyResetUtc || '01 del mes'}</strong>
                    </div>
                    <div className="text-slate-400 text-[11px]">
                      Buenos Aires (ART): <strong className="text-blue-300">{hardBudgetSummary?.nextMonthlyResetAr || 'Fin de mes'}</strong>
                    </div>
                  </div>
                </div>

                {/* Quick Metrics Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="p-3.5 rounded-lg bg-[#111624] border border-[#21283b]">
                    <span className="text-[10px] text-slate-400 uppercase font-mono block">Disponible Hoy</span>
                    <span className="text-base font-bold font-mono text-emerald-400">
                      ${hardBudgetSummary ? hardBudgetSummary.remainingDailyUsd.toFixed(4) : '—'}
                    </span>
                    <span className="text-[10px] text-slate-500 block">USD libres para gastar</span>
                  </div>
                  <div className="p-3.5 rounded-lg bg-[#111624] border border-[#21283b]">
                    <span className="text-[10px] text-slate-400 uppercase font-mono block">En Tránsito / Reservado</span>
                    <span className="text-base font-bold font-mono text-amber-400">
                      ${hardBudgetSummary ? hardBudgetSummary.reservedPendingUsd.toFixed(4) : '—'}
                    </span>
                    <span className="text-[10px] text-slate-500 block">Margen + safety</span>
                  </div>
                  <div className="p-3.5 rounded-lg bg-[#111624] border border-[#21283b]">
                    <span className="text-[10px] text-slate-400 uppercase font-mono block">Gasto neto hoy (registrado)</span>
                    <span className="text-base font-bold font-mono text-white">
                      ${hardBudgetSummary ? hardBudgetSummary.todaySpendUsd.toFixed(4) : '—'}
                    </span>
                    <span className="text-[10px] text-slate-500 block">Bruto: ${hardBudgetSummary ? hardBudgetSummary.todayGrossSpendUsd.toFixed(4) : '—'} USD</span>
                  </div>
                  <div className="p-3.5 rounded-lg bg-[#111624] border border-[#21283b]">
                    <span className="text-[10px] text-slate-400 uppercase font-mono block">Gasto Mensual</span>
                    <span className="text-base font-bold font-mono text-white">
                      ${hardBudgetSummary ? hardBudgetSummary.monthSpendUsd.toFixed(4) : '—'}
                    </span>
                    <span className="text-[10px] text-slate-500 block">Acumulado mes en curso</span>
                  </div>
                </div>


                {/* Provider sublimits are independent hard stops, not a share of the global balance. */}
                {hardBudgetSummary?.providerDaily && (
                  <div className="rounded-lg border border-[#21283b] bg-[#111624] p-4 space-y-3">
                    <div>
                      <h4 className="text-xs font-bold uppercase tracking-wide text-white">Sublímites diarios por proveedor</h4>
                      <p className="text-[11px] text-slate-400 mt-1">
                        Un saldo global disponible NO garantiza que OpenAI o Gemini puedan reservar otra solicitud.
                        Estos valores incluyen gasto bruto y reservas pendientes. Tener remanente no garantiza que alcance para la próxima reserva. No se modifican límites.
                      </p>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {(['OPENAI', 'GEMINI'] as const).map((provider) => {
                        const item = hardBudgetSummary.providerDaily?.[provider];
                        if (!item) return null;
                        const hasLimit = typeof item.limitUsd === 'number';
                        const remaining = typeof item.remainingUsd === 'number' ? item.remainingUsd : null;
                        return (
                          <div key={provider} className="rounded-lg bg-[#0a0d14] border border-[#21283b] p-3 space-y-1 text-xs">
                            <div className="flex justify-between items-center">
                              <span className="text-slate-200 font-bold">{provider}</span>
                              <span className={hasLimit && remaining === 0 ? 'text-amber-300 font-bold' : 'text-slate-300'}>
                                {hasLimit ? (remaining === 0 ? 'SUBLÍMITE AGOTADO' : 'REMANENTE PARCIAL') : 'SIN SUBLÍMITE'}
                              </span>
                            </div>
                            <div className="font-mono text-slate-200">
                              Bruto hoy: ${item.grossSpentUsd.toFixed(4)} USD
                              {hasLimit && <> / ${item.limitUsd.toFixed(4)} USD</>}
                            </div>
                            <div className="text-slate-400 font-mono">
                              Reservado: ${item.reservedUsd.toFixed(4)} USD
                              {' · '}Disponible: {remaining === null ? 'sujeto a límites globales' : ('$' + remaining.toFixed(4) + ' USD')}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    {hardBudgetSummary.lastBudgetDenial?.code?.startsWith('PROVIDER_') && (
                      <div className="text-[11px] text-amber-300 border-t border-[#21283b] pt-2">
                        Última denegación por proveedor ({new Date(hardBudgetSummary.lastBudgetDenial.timestamp).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}):
                        {' '}{hardBudgetSummary.lastBudgetDenial.reason}
                        <span className="text-slate-400"> · Registro histórico, no implica bloqueo vigente.</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Progress Bars Section */}
                <div className="p-5 rounded-lg bg-[#111624] border border-[#21283b] space-y-5">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-orange-400 flex items-center gap-2">
                    <TrendingUp className="w-4 h-4" /> Ejecución Presupuestaria en Tiempo Real
                  </h4>

                  {/* Daily Progress */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs font-mono">
                      <span className="text-slate-300">Presupuesto Diario Global:</span>
                      <span className="text-white font-bold">
                        ${(hardBudgetSummary?.effectiveTodaySpendUsd ?? consumptionStats?.todaySpendUsd ?? 0).toFixed(4)} / ${hardBudgetSummary?.dailyBudgetLimitUsd?.toFixed(2) || '0.50'} USD
                        <span className="ml-2 text-slate-400 font-normal">
                          ({hardBudgetSummary?.dailyPercentUsed ?? 0}%)
                        </span>
                      </span>
                    </div>
                    <div className="w-full h-3 rounded-full bg-[#0a0d14] border border-[#21283b] overflow-hidden relative">
                      <div
                        className={`h-full transition-all duration-500 rounded-full ${
                          (hardBudgetSummary?.dailyPercentUsed ?? 0) >= 100
                            ? 'bg-red-500'
                            : (hardBudgetSummary?.dailyPercentUsed ?? 0) >= 95
                            ? 'bg-orange-500'
                            : (hardBudgetSummary?.dailyPercentUsed ?? 0) >= 80
                            ? 'bg-amber-500'
                            : 'bg-emerald-500'
                        }`}
                        style={{ width: `${Math.min(100, hardBudgetSummary?.dailyPercentUsed ?? 0)}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-[10px] text-slate-500 font-mono px-0.5">
                      <span>0%</span>
                      <span>50%</span>
                      <span>80% (Warning)</span>
                      <span>95% (Crítico)</span>
                      <span>100% (Hard Stop)</span>
                    </div>
                  </div>

                  {/* Monthly Progress */}
                  <div className="space-y-2 pt-2 border-t border-[#1b2234]">
                    <div className="flex items-center justify-between text-xs font-mono">
                      <span className="text-slate-300">Presupuesto Mensual Global:</span>
                      <span className="text-white font-bold">
                        ${(hardBudgetSummary?.effectiveMonthSpendUsd ?? consumptionStats?.monthSpendUsd ?? 0).toFixed(4)} / ${hardBudgetSummary?.monthlyBudgetLimitUsd?.toFixed(2) || '10.00'} USD
                        <span className="ml-2 text-slate-400 font-normal">
                          ({hardBudgetSummary?.monthlyPercentUsed ?? 0}%)
                        </span>
                      </span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-[#0a0d14] border border-[#21283b] overflow-hidden">
                      <div
                        className="h-full bg-blue-500 rounded-full transition-all duration-500"
                        style={{ width: `${Math.min(100, hardBudgetSummary?.monthlyPercentUsed ?? 0)}%` }}
                      />
                    </div>
                  </div>
                </div>

                {/* OpenAI Free Tier (Data Sharing Program) Card */}
                <div className="p-5 rounded-lg bg-[#111624] border border-[#21283b] space-y-5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-emerald-400" />
                      <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-400">
                        Programa de Tokens Gratuitos de OpenAI (Data Sharing)
                      </h4>
                    </div>
                    <div className="flex items-center gap-2">
                      {hardBudgetSummary?.openaiFreeTier?.enabled ? (
                        hardBudgetSummary?.openaiFreeTier?.verificationStatus === 'CONFIRMED_BILLED' ? (
                          <span className="px-2.5 py-0.5 rounded text-[11px] font-mono font-bold bg-emerald-950 text-emerald-300 border border-emerald-600 flex items-center gap-1.5 shadow-sm">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> COMPROBADO EN FACTURACIÓN
                          </span>
                        ) : hardBudgetSummary?.openaiFreeTier?.verificationStatus === 'DECLARED_BY_ADMIN' || hardBudgetSummary?.openaiFreeTier?.verified ? (
                          <span className="px-2.5 py-0.5 rounded text-[11px] font-mono font-bold bg-amber-950 text-amber-300 border border-amber-600 flex items-center gap-1.5 shadow-sm">
                            <Shield className="w-3.5 h-3.5 text-amber-400" /> DECLARADO POR ADMIN (Estimado)
                          </span>
                        ) : (
                          <span className="px-2.5 py-0.5 rounded text-[11px] font-mono font-bold bg-slate-800 text-slate-400 border border-slate-700 flex items-center gap-1.5 shadow-sm">
                            <AlertTriangle className="w-3.5 h-3.5 text-slate-400" /> SIN VERIFICAR (Estimación Conservadora)
                          </span>
                        )
                      ) : (
                        <span className="px-2.5 py-0.5 rounded text-[11px] font-mono bg-slate-800 text-slate-400 border border-slate-700">
                          DESACTIVADO (Sin Participación)
                        </span>
                      )}
                    </div>
                  </div>

                  <p className="text-xs text-slate-400 leading-relaxed">
                    Beneficio oficial de OpenAI que otorga tokens diarios gratuitos a proyectos que optan por compartir entradas y salidas (Data Sharing). 
                    El sistema mantiene dos contadores independientes con reinicio estricto a las <strong>00:00 UTC</strong>.
                  </p>

                  {/* Warning / Overage Rules Banner */}
                  <div className="p-3 rounded-lg bg-[#0a0d14] border border-[#1f2638] space-y-2 text-xs">
                    <div className="flex items-start gap-2 text-amber-300 font-semibold">
                      <Shield className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                      <span>Regla Oficial de Exceso &amp; Salvaguarda Presupuestaria Inviolable:</span>
                    </div>
                    <ul className="list-disc list-inside text-slate-300 text-[11px] space-y-1 pl-1">
                      <li>
                        <strong>Regla de Exceso 100%:</strong> Una solicitud que supera el cupo remanente de su grupo se factura completamente como costo bruto (cero descuento).
                      </li>
                      <li>
                        <strong>Límite Económico Intocable:</strong> Nunca se supera el límite monetario configurado (${hardBudgetSummary?.dailyBudgetLimitUsd?.toFixed(2) || '0.50'} USD) asumiendo incorrectamente gratuidad.
                      </li>
                      <li>
                        <strong>Cupo Compartido Organizacional:</strong> El saldo diario pertenece a la organización OpenAI. Si otras claves o proyectos consumen cupo, el saldo local es estimado y aplica un colchón de reserva conservadora.
                      </li>
                      <li>
                        <strong>Google Gemini:</strong> Permanece 100% independiente con presupuesto y contabilidad separados.
                      </li>
                    </ul>
                  </div>

                  {freeTierMsg && (
                    <div
                      className={`p-3 rounded text-xs flex items-center gap-2 ${
                        freeTierMsg.type === 'success'
                          ? 'bg-emerald-950/60 text-emerald-200 border border-emerald-800'
                          : 'bg-red-950/60 text-red-200 border border-red-800'
                      }`}
                    >
                      {freeTierMsg.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
                      <span>{freeTierMsg.text}</span>
                    </div>
                  )}

                  {/* Quota Progress Bars */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Main Group: 250k */}
                    <div className="p-3.5 rounded-lg bg-[#0a0d14] border border-[#1f2638] space-y-2.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold text-white flex items-center gap-1.5">
                          <Layers className="w-3.5 h-3.5 text-orange-400" /> Grupo Principal (Flagship)
                        </span>
                        <span className="font-mono text-slate-300 text-[11px]">
                          <strong>{(hardBudgetSummary?.openaiFreeTier?.mainGroup?.usedTokens || 0).toLocaleString()}</strong> / {(hardBudgetSummary?.openaiFreeTier?.mainGroup?.limitTokens || 250000).toLocaleString()} tokens
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-400 font-mono">
                        Modelos compartidos: <span className="text-orange-300">{hardBudgetSummary?.openaiFreeTier?.mainGroup?.models?.join(', ') || 'gpt-4o, gpt-6-luna'}</span>
                      </div>
                      <div className="w-full h-2.5 rounded-full bg-[#111624] border border-[#21283b] overflow-hidden">
                        <div
                          className={`h-full transition-all duration-500 rounded-full ${
                            (hardBudgetSummary?.openaiFreeTier?.mainGroup?.percentUsed || 0) >= 100
                              ? 'bg-red-500'
                              : (hardBudgetSummary?.openaiFreeTier?.mainGroup?.percentUsed || 0) >= 95
                              ? 'bg-orange-500'
                              : (hardBudgetSummary?.openaiFreeTier?.mainGroup?.percentUsed || 0) >= 80
                              ? 'bg-amber-500'
                              : 'bg-emerald-500'
                          }`}
                          style={{ width: `${Math.min(100, hardBudgetSummary?.openaiFreeTier?.mainGroup?.percentUsed || 0)}%` }}
                        />
                      </div>
                      <div className="flex justify-between text-[10px] font-mono text-slate-500">
                        <span>Restantes: <strong className="text-slate-200">{(hardBudgetSummary?.openaiFreeTier?.mainGroup?.remainingTokens ?? 250000).toLocaleString()}</strong></span>
                        <span>{hardBudgetSummary?.openaiFreeTier?.mainGroup?.percentUsed || 0}% consumido</span>
                      </div>
                    </div>

                    {/* Small Group: 2.5M */}
                    <div className="p-3.5 rounded-lg bg-[#0a0d14] border border-[#1f2638] space-y-2.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold text-white flex items-center gap-1.5">
                          <Cpu className="w-3.5 h-3.5 text-blue-400" /> Grupo Modelos Pequeños (Mini)
                        </span>
                        <span className="font-mono text-slate-300 text-[11px]">
                          <strong>{(hardBudgetSummary?.openaiFreeTier?.smallGroup?.usedTokens || 0).toLocaleString()}</strong> / {(hardBudgetSummary?.openaiFreeTier?.smallGroup?.limitTokens || 2500000).toLocaleString()} tokens
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-400 font-mono">
                        Modelos compartidos: <span className="text-blue-300">{hardBudgetSummary?.openaiFreeTier?.smallGroup?.models?.join(', ') || 'gpt-5.4-mini, gpt-5.4-nano, gpt-5-mini, o4-mini, gpt-4o-mini'}</span>
                      </div>
                      <div className="w-full h-2.5 rounded-full bg-[#111624] border border-[#21283b] overflow-hidden">
                        <div
                          className={`h-full transition-all duration-500 rounded-full ${
                            (hardBudgetSummary?.openaiFreeTier?.smallGroup?.percentUsed || 0) >= 100
                              ? 'bg-red-500'
                              : (hardBudgetSummary?.openaiFreeTier?.smallGroup?.percentUsed || 0) >= 95
                              ? 'bg-orange-500'
                              : (hardBudgetSummary?.openaiFreeTier?.smallGroup?.percentUsed || 0) >= 80
                              ? 'bg-amber-500'
                              : 'bg-emerald-500'
                          }`}
                          style={{ width: `${Math.min(100, hardBudgetSummary?.openaiFreeTier?.smallGroup?.percentUsed || 0)}%` }}
                        />
                      </div>
                      <div className="flex justify-between text-[10px] font-mono text-slate-500">
                        <span>Restantes: <strong className="text-slate-200">{(hardBudgetSummary?.openaiFreeTier?.smallGroup?.remainingTokens ?? 2500000).toLocaleString()}</strong></span>
                        <span>{hardBudgetSummary?.openaiFreeTier?.smallGroup?.percentUsed || 0}% consumido</span>
                      </div>
                    </div>
                  </div>

                  {/* Financial & Token Breakdown Metrics Grid (Item 8) */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
                    <div className="p-3 rounded-lg bg-[#0a0d14] border border-[#1f2638]">
                      <span className="text-[10px] text-slate-400 uppercase font-mono block">Tokens Gratuitos</span>
                      <span className="text-sm font-bold font-mono text-emerald-400">
                        {(hardBudgetSummary?.openaiFreeTier?.financialsToday?.freeTokensConsumed || 0).toLocaleString()}
                      </span>
                      <span className="text-[10px] text-slate-500 block">Bonificados hoy</span>
                    </div>

                    <div className="p-3 rounded-lg bg-[#0a0d14] border border-[#1f2638]">
                      <span className="text-[10px] text-slate-400 uppercase font-mono block">Costo Bruto Teórico</span>
                      <span className="text-sm font-bold font-mono text-slate-300">
                        ${(hardBudgetSummary?.openaiFreeTier?.financialsToday?.grossSpendUsd || 0).toFixed(4)}
                      </span>
                      <span className="text-[10px] text-slate-500 block">Tarifa estándar</span>
                    </div>

                    <div className="p-3 rounded-lg bg-[#0a0d14] border border-[#1f2638]">
                      <span className="text-[10px] text-slate-400 uppercase font-mono block">Descuento Aplicado</span>
                      <span className="text-sm font-bold font-mono text-emerald-300">
                        -${(hardBudgetSummary?.openaiFreeTier?.financialsToday?.discountUsd || 0).toFixed(4)}
                      </span>
                      <span className="text-[10px] text-slate-500 block">Ahorro Data Sharing</span>
                    </div>

                    <div className="p-3 rounded-lg bg-[#0a0d14] border border-[#1f2638]">
                      <span className="text-[10px] text-slate-400 uppercase font-mono block">Costo Neto Facturable</span>
                      <span className="text-sm font-bold font-mono text-white">
                        ${(hardBudgetSummary?.openaiFreeTier?.financialsToday?.netSpendUsd || 0).toFixed(4)}
                      </span>
                      <span className="text-[10px] text-slate-500 block">Impacto en presupuesto</span>
                    </div>
                  </div>

                  {/* Actions & Verification Controls */}
                  {isAdminAuthenticated && (
                    <div className="pt-3 border-t border-[#1f2638] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-300">
                        <input
                          type="checkbox"
                          checked={!!hardBudgetSummary?.openaiFreeTier?.enabled}
                          onChange={(e) => handleToggleFreeTier(e.target.checked)}
                          className="accent-emerald-500 w-4 h-4 rounded"
                        />
                        <span>Habilitar participación en programa de tokens gratuitos (Data Sharing)</span>
                      </label>

                      <button
                        type="button"
                        onClick={handleVerifyFreeTier}
                        disabled={verifyingFreeTier}
                        className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold shadow-md flex items-center gap-2 cursor-pointer transition-all"
                      >
                        {verifyingFreeTier ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                        <span>Verificar Beneficio con OpenAI</span>
                      </button>
                    </div>
                  )}
                </div>

                {/* Form to Edit Hard Budget Limits */}
                <form onSubmit={handleSaveBudget} className="p-5 rounded-lg bg-[#111624] border border-[#21283b] space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-orange-400 flex items-center gap-2">
                      <Shield className="w-4 h-4" /> Configuración de Límites Económicos Estrictos
                    </h4>
                    <span className="text-[11px] font-mono text-emerald-400">Protección Activa de Capital</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">Presupuesto Diario (USD)</label>
                      <input
                        type="number"
                        step="0.05"
                        disabled={!isAdminAuthenticated}
                        value={hardBudgetForm.dailyBudgetLimitUsd}
                        onChange={(e) => setHardBudgetForm({ ...hardBudgetForm, dailyBudgetLimitUsd: parseFloat(e.target.value) || 0.50 })}
                        className="w-full bg-[#0a0d14] border border-[#21283b] rounded px-3 py-1.5 text-xs text-white font-mono focus:border-orange-500 focus:outline-none"
                      />
                      <span className="text-[10px] text-slate-500 mt-1 block">Estándar Fase 4.6: $0.50 USD</span>
                    </div>

                    <div>
                      <label className="block text-xs text-slate-400 mb-1">Presupuesto Mensual (USD)</label>
                      <input
                        type="number"
                        step="0.50"
                        disabled={!isAdminAuthenticated}
                        value={hardBudgetForm.monthlyBudgetLimitUsd}
                        onChange={(e) => setHardBudgetForm({ ...hardBudgetForm, monthlyBudgetLimitUsd: parseFloat(e.target.value) || 10.00 })}
                        className="w-full bg-[#0a0d14] border border-[#21283b] rounded px-3 py-1.5 text-xs text-white font-mono focus:border-orange-500 focus:outline-none"
                      />
                      <span className="text-[10px] text-slate-500 mt-1 block">Estándar: $10.00 USD</span>
                    </div>

                    <div>
                      <label className="block text-xs text-slate-400 mb-1">Máx. por Solicitud (USD)</label>
                      <input
                        type="number"
                        step="0.01"
                        disabled={!isAdminAuthenticated}
                        value={hardBudgetForm.maxCostPerRequestUsd}
                        onChange={(e) => setHardBudgetForm({ ...hardBudgetForm, maxCostPerRequestUsd: parseFloat(e.target.value) || 0.05 })}
                        className="w-full bg-[#0a0d14] border border-[#21283b] rounded px-3 py-1.5 text-xs text-white font-mono focus:border-orange-500 focus:outline-none"
                      />
                      <span className="text-[10px] text-slate-500 mt-1 block">Tope individual por inferencia</span>
                    </div>
                  </div>

                  {isAdminAuthenticated && (
                    <div className="flex justify-end pt-2">
                      <button
                        type="submit"
                        disabled={savingBudget}
                        className="px-5 py-2 rounded-lg bg-orange-600 hover:bg-orange-500 text-white text-xs font-semibold shadow-md flex items-center gap-2 cursor-pointer"
                      >
                        {savingBudget ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
                        <span>Guardar Nuevos Límites de Presupuesto</span>
                      </button>
                    </div>
                  )}
                </form>

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
                      <h4 className="text-sm font-bold">
                        {!isInitialized ? 'Configuración Inicial de Administrador' : 'Autenticación de Administrador Requerida'}
                      </h4>
                    </div>
                    <p className="text-xs text-slate-300">
                      {!isInitialized
                        ? 'El sistema no cuenta con credenciales previas. Defina una contraseña administrativa segura (mínimo 10 caracteres) para proteger el sistema.'
                        : 'Para modificar políticas de riesgo, credenciales Bybit o parámetros de IA, ingrese su contraseña de administrador.'}
                    </p>

                    {(authError || setupError) && (
                      <div className="p-3 rounded bg-red-950/60 border border-red-800 text-red-200 text-xs flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                        <span>{authError || setupError}</span>
                      </div>
                    )}

                    {!isInitialized ? (
                      <form onSubmit={handleInitialSetup} className="space-y-3">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs text-slate-400 mb-1">Nueva Contraseña (mínimo 10 caracteres)</label>
                            <input
                              type="password"
                              value={setupPassword}
                              onChange={(e) => setSetupPassword(e.target.value)}
                              placeholder="••••••••••••••••"
                              className="w-full bg-[#0a0d14] border border-[#21283b] rounded px-3 py-1.5 text-xs text-white font-mono focus:border-orange-500 focus:outline-none"
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-slate-400 mb-1">Confirmar Contraseña</label>
                            <input
                              type="password"
                              value={setupConfirm}
                              onChange={(e) => setSetupConfirm(e.target.value)}
                              placeholder="••••••••••••••••"
                              className="w-full bg-[#0a0d14] border border-[#21283b] rounded px-3 py-1.5 text-xs text-white font-mono focus:border-orange-500 focus:outline-none"
                            />
                          </div>
                        </div>
                        <div className="flex justify-end pt-1">
                          <button
                            type="submit"
                            disabled={isSettingUp || !setupPassword || setupPassword.length < 10}
                            className="px-5 py-2 rounded-lg bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white text-xs font-bold shadow-md flex items-center gap-2 cursor-pointer"
                          >
                            {isSettingUp ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
                            <span>Crear Administrador y Desbloquear</span>
                          </button>
                        </div>
                      </form>
                    ) : (
                      <form onSubmit={handleAdminLogin} className="space-y-2">
                        <div className="flex gap-2">
                          <input
                            type="password"
                            placeholder="Contraseña de administración"
                            value={adminKeyInput}
                            onChange={(e) => setAdminKeyInput(e.target.value)}
                            className="flex-1 bg-[#0a0d14] border border-[#21283b] rounded px-3 py-1.5 text-xs text-white font-mono focus:border-orange-500 focus:outline-none"
                          />
                          <button
                            type="submit"
                            disabled={isLoggingIn || !adminKeyInput.trim()}
                            className="px-4 py-1.5 rounded bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white text-xs font-semibold cursor-pointer"
                          >
                            {isLoggingIn ? 'Verificando...' : 'Acceder'}
                          </button>
                        </div>
                      </form>
                    )}
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

      {/* Unlock / Initial Setup Dialog Modal */}
      {showUnlockModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="relative w-full max-w-md bg-[#111624] border border-orange-500/40 rounded-xl shadow-2xl p-6 text-slate-200">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-orange-500/20 border border-orange-500/40 flex items-center justify-center text-orange-400">
                  <Key className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">
                    {!isInitialized ? 'Configuración Inicial de Administrador' : 'Desbloquear Edición'}
                  </h3>
                  <p className="text-xs text-slate-400">
                    {!isInitialized ? 'Alta de seguridad requerida' : 'Autenticación de administrador'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => { setShowUnlockModal(false); setAuthError(''); setSetupError(''); }}
                className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-300 mb-4 leading-relaxed">
              {!isInitialized
                ? 'El sistema no cuenta con credenciales previas. Defina una contraseña administrativa segura (mínimo 10 caracteres) para desbloquear y proteger el sistema.'
                : 'Ingrese su clave administrativa para modificar parámetros de riesgo, claves de Bybit e IAs, o ajustar el router inteligente.'}
            </p>

            {(authError || setupError) && (
              <div className="mb-4 p-3 rounded-lg bg-red-950/70 border border-red-800 text-red-200 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                <span>{authError || setupError}</span>
              </div>
            )}

            {!isInitialized ? (
              <form onSubmit={handleInitialSetup} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Nueva Contraseña de Administrador (mínimo 10 caracteres)
                  </label>
                  <input
                    type="password"
                    autoFocus
                    placeholder="••••••••••••••••"
                    value={setupPassword}
                    onChange={(e) => setSetupPassword(e.target.value)}
                    className="w-full bg-[#0a0d14] border border-[#21283b] rounded-lg px-3.5 py-2 text-xs text-white font-mono focus:border-orange-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Confirmar Contraseña
                  </label>
                  <input
                    type="password"
                    placeholder="••••••••••••••••"
                    value={setupConfirm}
                    onChange={(e) => setSetupConfirm(e.target.value)}
                    className="w-full bg-[#0a0d14] border border-[#21283b] rounded-lg px-3.5 py-2 text-xs text-white font-mono focus:border-orange-500 focus:outline-none"
                  />
                </div>

                <div className="flex gap-2 justify-end pt-2">
                  <button
                    type="button"
                    onClick={() => { setShowUnlockModal(false); setAuthError(''); setSetupError(''); }}
                    className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={isSettingUp || !setupPassword || setupPassword.length < 10}
                    className="px-5 py-2 rounded-lg bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white text-xs font-bold shadow-lg shadow-orange-600/30 flex items-center gap-2 cursor-pointer"
                  >
                    {isSettingUp ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
                    <span>Crear Administrador</span>
                  </button>
                </div>
              </form>
            ) : (
              <form onSubmit={handleAdminLogin} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Contraseña de Administrador
                  </label>
                  <input
                    type="password"
                    autoFocus
                    placeholder="••••••••••••••••"
                    value={adminKeyInput}
                    onChange={(e) => setAdminKeyInput(e.target.value)}
                    className="w-full bg-[#0a0d14] border border-[#21283b] rounded-lg px-3.5 py-2 text-xs text-white font-mono focus:border-orange-500 focus:outline-none"
                  />
                </div>

                <div className="flex gap-2 justify-end pt-2">
                  <button
                    type="button"
                    onClick={() => { setShowUnlockModal(false); setAuthError(''); setSetupError(''); }}
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
            )}
          </div>
        </div>
      )}
    </div>
  );
}
