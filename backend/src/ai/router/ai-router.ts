import { AiProvider } from '../types.js';
import { AI_MODELS_CATALOG, ModelMetadata, getValidatedModel } from '../models-catalog.js';

export type AiTaskType =
  | 'MARKET_SUMMARY'
  | 'TECHNICAL_CONTEXT'
  | 'SETUP_EVALUATION'
  | 'RISK_AUDIT'
  | 'CONSENSUS_REVIEW'
  | 'ALERT_EXPLANATION'
  | 'POST_TRADE_ANALYSIS';

export type RouterSelectionMode = 'AUTOMATIC' | 'MANUAL_GLOBAL' | 'MANUAL_BY_TASK' | 'HYBRID';

export type RouterProfile = 'ECONOMIC' | 'BALANCED' | 'MAX_QUALITY' | 'CUSTOM';

export interface TaskAssignment {
  openaiModel: string;
  geminiModel: string;
}

export interface RouterConfig {
  mode: RouterSelectionMode;
  profile: RouterProfile;
  manualGlobal: {
    openaiModel: string;
    geminiModel: string;
  };
  manualByTask: Partial<Record<AiTaskType, TaskAssignment>>;
  dailyBudgetLimitUsd: number;
  monthlyBudgetLimitUsd: number;
  updatedAt: number;
}

export interface RouterDecision {
  task: AiTaskType;
  provider: AiProvider;
  selectedModel: string;
  selectionMode: RouterSelectionMode;
  profile: RouterProfile;
  consideredAlternatives: string[];
  selectionReason: string;
  estimatedCostPer1kTokensUsd: number;
  timestamp: number;
}

export interface RouterAuditRecord extends RouterDecision {
  id: string;
  latencyMs?: number;
  tokensPrompt?: number;
  tokensCompletion?: number;
  recordedCostUsd?: number;
  status: 'SUCCESS' | 'ERROR' | 'FALLBACK';
  error?: string;
  fallbackUsed?: boolean;
}

export const DEFAULT_ROUTER_CONFIG: RouterConfig = {
  mode: 'AUTOMATIC',
  profile: 'BALANCED',
  manualGlobal: {
    openaiModel: 'gpt-4o',
    geminiModel: 'gemini-2.0-flash',
  },
  manualByTask: {
    SETUP_EVALUATION: { openaiModel: 'gpt-4o', geminiModel: 'gemini-2.0-flash' },
    RISK_AUDIT: { openaiModel: 'gpt-4o', geminiModel: 'gemini-2.5-flash' },
    CONSENSUS_REVIEW: { openaiModel: 'gpt-4o', geminiModel: 'gemini-2.0-flash' },
    ALERT_EXPLANATION: { openaiModel: 'gpt-4o-mini', geminiModel: 'gemini-2.0-flash' },
    MARKET_SUMMARY: { openaiModel: 'gpt-4o-mini', geminiModel: 'gemini-2.0-flash' },
    TECHNICAL_CONTEXT: { openaiModel: 'gpt-4o-mini', geminiModel: 'gemini-2.0-flash' },
    POST_TRADE_ANALYSIS: { openaiModel: 'gpt-4o', geminiModel: 'gemini-2.5-pro' },
  },
  dailyBudgetLimitUsd: 5.0,
  monthlyBudgetLimitUsd: 50.0,
  updatedAt: Date.now(),
};

export interface FreeTierRouterContext {
  enabled?: boolean;
  verified?: boolean;
  mainRemainingTokens?: number;
  smallRemainingTokens?: number;
}

export class AiModelRouter {
  private config: RouterConfig;
  private decisionHistory: RouterAuditRecord[] = [];
  private maxHistoryLength: number = 200;
  private freeTierContext?: FreeTierRouterContext;

  constructor(initialConfig?: RouterConfig) {
    this.config = initialConfig ? { ...DEFAULT_ROUTER_CONFIG, ...initialConfig } : { ...DEFAULT_ROUTER_CONFIG };
  }

  public setFreeTierContext(context: FreeTierRouterContext): void {
    this.freeTierContext = context;
  }

  public getConfig(): RouterConfig {
    return { ...this.config };
  }

  public updateConfig(updates: Partial<RouterConfig>): RouterConfig {
    this.config = {
      ...this.config,
      ...updates,
      manualGlobal: {
        ...this.config.manualGlobal,
        ...(updates.manualGlobal || {}),
      },
      manualByTask: {
        ...this.config.manualByTask,
        ...(updates.manualByTask || {}),
      },
      updatedAt: Date.now(),
    };
    return this.getConfig();
  }

  /**
   * Routes a task to the most appropriate model for a given provider.
   */
  public routeModel(
    task: AiTaskType,
    provider: AiProvider,
    remainingBudgetUsd: number = 5.0,
    perCallFreeTierContext?: FreeTierRouterContext
  ): RouterDecision {
    const { mode, profile, manualGlobal, manualByTask } = this.config;
    const catalog = (Object.values(AI_MODELS_CATALOG) as ModelMetadata[]).filter((m) => m.provider === provider && m.status === 'ACTIVE');
    const freeTier = perCallFreeTierContext || this.freeTierContext;

    let selectedModel: string;
    let selectionReason: string;
    const consideredAlternatives = catalog.map((m) => m.id);

    // 1. MANUAL_GLOBAL
    if (mode === 'MANUAL_GLOBAL') {
      const target = provider === 'OPENAI' ? manualGlobal.openaiModel : manualGlobal.geminiModel;
      selectedModel = getValidatedModel(target, provider);
      selectionReason = `Selección manual global configurada por el administrador (${selectedModel}).`;
    }
    // 2. MANUAL_BY_TASK
    else if (mode === 'MANUAL_BY_TASK') {
      const taskAssignment = manualByTask[task];
      const target = taskAssignment
        ? provider === 'OPENAI'
          ? taskAssignment.openaiModel
          : taskAssignment.geminiModel
        : provider === 'OPENAI'
        ? manualGlobal.openaiModel
        : manualGlobal.geminiModel;
      selectedModel = getValidatedModel(target, provider);
      selectionReason = `Selección manual por categoría de tarea '${task}' (${selectedModel}).`;
    }
    // 3. HYBRID
    else if (mode === 'HYBRID') {
      const taskAssignment = manualByTask[task];
      if (taskAssignment) {
        const target = provider === 'OPENAI' ? taskAssignment.openaiModel : taskAssignment.geminiModel;
        selectedModel = getValidatedModel(target, provider);
        selectionReason = `Excepción manual híbrida para tarea '${task}' (${selectedModel}).`;
      } else {
        const auto = this.resolveAutomatic(task, provider, profile, remainingBudgetUsd, catalog, freeTier);
        selectedModel = auto.model;
        selectionReason = auto.reason;
      }
    }
    // 4. AUTOMATIC
    else {
      const auto = this.resolveAutomatic(task, provider, profile, remainingBudgetUsd, catalog, freeTier);
      selectedModel = auto.model;
      selectionReason = auto.reason;
    }

    const modelInfo = AI_MODELS_CATALOG[selectedModel];
    const estimatedCostPer1kTokensUsd = modelInfo ? modelInfo.estimatedInputCostPerMillion / 1000 : 0.001;

    const decision: RouterDecision = {
      task,
      provider,
      selectedModel,
      selectionMode: mode,
      profile,
      consideredAlternatives,
      selectionReason,
      estimatedCostPer1kTokensUsd,
      timestamp: Date.now(),
    };

    return decision;
  }

  /**
   * Automatic selection logic based on task, profile, remaining budget, and OpenAI Free Tier benefits.
   */
  private resolveAutomatic(
    task: AiTaskType,
    provider: AiProvider,
    profile: RouterProfile,
    remainingBudgetUsd: number,
    catalog: any[],
    freeTier?: FreeTierRouterContext
  ): { model: string; reason: string } {
    // High reasoning tasks: SETUP_EVALUATION, RISK_AUDIT, CONSENSUS_REVIEW
    const isCriticalEvaluation =
      task === 'SETUP_EVALUATION' || task === 'RISK_AUDIT' || task === 'CONSENSUS_REVIEW' || task === 'POST_TRADE_ANALYSIS';

    // Fast/lightweight tasks: ALERT_EXPLANATION, MARKET_SUMMARY, TECHNICAL_CONTEXT
    const isLightweight =
      task === 'ALERT_EXPLANATION' || task === 'MARKET_SUMMARY' || task === 'TECHNICAL_CONTEXT';

    // Priorización inteligente de tokens gratuitos de OpenAI (Data Sharing Program)
    if (provider === 'OPENAI' && freeTier?.enabled && freeTier?.verified) {
      const mainRemaining = freeTier.mainRemainingTokens ?? 0;
      const smallRemaining = freeTier.smallRemainingTokens ?? 0;

      // Si es evaluación crítica y hay cupo en Grupo Principal (250k)
      if (isCriticalEvaluation && mainRemaining >= 3000) {
        return {
          model: 'gpt-4o',
          reason: `Beneficio OpenAI Free Tier activo (Grupo Principal con ${mainRemaining.toLocaleString()} tokens disponibles): priorizando gpt-4o para máxima calidad cuantitativa sin costo neto.`,
        };
      }

      // Si es tarea ligera y hay cupo en Grupo Modelos Pequeños (2.5M)
      if (isLightweight && smallRemaining >= 1500) {
        return {
          model: 'gpt-4o-mini',
          reason: `Beneficio OpenAI Free Tier activo (Grupo Modelos Pequeños con ${smallRemaining.toLocaleString()} tokens disponibles): priorizando gpt-4o-mini sin costo neto.`,
        };
      }

      // Si el cupo del grupo principal está agotado pero queda en pequeños para tareas intermedias
      if (isCriticalEvaluation && mainRemaining < 3000 && remainingBudgetUsd < 0.5) {
        return {
          model: 'gpt-4o-mini',
          reason: `Cupo Free Tier Grupo Principal agotado (${mainRemaining} tokens) y presupuesto bajo ($${remainingBudgetUsd.toFixed(2)}): fallback a gpt-4o-mini para preservar presupuesto.`,
        };
      }
    }

    if (profile === 'ECONOMIC' || remainingBudgetUsd < 0.5) {
      if (provider === 'OPENAI') {
        return {
          model: 'gpt-4o-mini',
          reason: `Perfil económico / presupuesto bajo ($${remainingBudgetUsd.toFixed(2)} restantes): seleccionando gpt-4o-mini para minimizar costo.`,
        };
      } else {
        return {
          model: 'gemini-2.0-flash',
          reason: `Perfil económico / presupuesto bajo: seleccionando gemini-2.0-flash por costo ultra-eficiente y baja latencia.`,
        };
      }
    }

    if (profile === 'MAX_QUALITY') {
      if (provider === 'OPENAI') {
        return {
          model: 'gpt-4o',
          reason: 'Perfil de máxima calidad: seleccionando gpt-4o con razonamiento cuantitativo superior.',
        };
      } else {
        return {
          model: isCriticalEvaluation ? 'gemini-2.5-pro' : 'gemini-2.5-flash',
          reason: `Perfil de máxima calidad: asignando ${isCriticalEvaluation ? 'gemini-2.5-pro' : 'gemini-2.5-flash'} para auditoría crítica de alta profundidad.`,
        };
      }
    }

    // BALANCED (default)
    if (provider === 'OPENAI') {
      const model = isLightweight ? 'gpt-4o-mini' : 'gpt-4o';
      return {
        model,
        reason: `Perfil balanceado: ${isLightweight ? 'modelo ligero gpt-4o-mini para síntesis' : 'gpt-4o para evaluación cuantitativa estructurada'}.`,
      };
    } else {
      const model = isCriticalEvaluation ? 'gemini-2.0-flash' : 'gemini-2.0-flash';
      return {
        model,
        reason: 'Perfil balanceado: gemini-2.0-flash por óptimo equilibrio de razonamiento y costo.',
      };
    }
  }

  /**
   * Logs a completed router execution for auditing and quality comparison.
   */
  public logExecution(record: RouterAuditRecord): void {
    this.decisionHistory.unshift(record);
    if (this.decisionHistory.length > this.maxHistoryLength) {
      this.decisionHistory.pop();
    }
  }

  public getHistory(limit: number = 50): RouterAuditRecord[] {
    return this.decisionHistory.slice(0, limit);
  }
}
