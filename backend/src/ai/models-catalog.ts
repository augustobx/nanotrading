import { AiProvider } from './types.js';

export type ModelLifecycleStatus = 'ACTIVE' | 'DEPRECATED' | 'RETIRED';

export type FreeTierGroup = 'MAIN' | 'SMALL' | 'NONE';

export interface ModelMetadata {
  id: string;
  provider: AiProvider;
  displayName: string;
  status: ModelLifecycleStatus;
  pricingEffectiveDate: string; // ISO date format YYYY-MM-DD
  estimatedInputCostPerMillion: number;
  estimatedCachedInputCostPerMillion?: number;
  estimatedCacheWriteCostPerMillion?: number;
  estimatedOutputCostPerMillion: number;
  costNote: string;
  maxTokens: number;
  temperature: number;
  supportsStructuredJson: boolean;
  supportsReasoningEffort?: boolean;
  reasoningEffortDefault?: 'low' | 'medium' | 'high';
  supportsResponsesApi?: boolean;
  freeTierGroup?: FreeTierGroup; // Data Sharing Program daily free tokens group
  isDefault: boolean;
}

export const OPENAI_FREE_TIER_LIMITS = {
  MAIN_GROUP_DAILY_TOKENS: 250_000,   // Grupo principal (gpt-4o, gpt-6-luna)
  SMALL_GROUP_DAILY_TOKENS: 2_500_000, // Grupo modelos pequeños (gpt-5.4-mini, gpt-5.4-nano, gpt-5-mini, o4-mini, gpt-4o-mini)
  DEFAULT_MAIN_MODELS: ['gpt-6-luna', 'gpt-4o'],
  DEFAULT_SMALL_MODELS: ['gpt-5.4-mini', 'gpt-5.4-nano', 'gpt-5-mini', 'o4-mini', 'gpt-4o-mini'],
};

export const AI_MODELS_CATALOG: Record<string, ModelMetadata> = {
  // ---------------------------------------------------------------------------
  // OpenAI Models (Official OpenAI API - Verified as of 2026)
  // ---------------------------------------------------------------------------
  'gpt-6-luna': {
    id: 'gpt-6-luna',
    provider: 'OPENAI',
    displayName: 'OpenAI GPT-6 Luna',
    status: 'ACTIVE',
    pricingEffectiveDate: '2026-03-01',
    estimatedInputCostPerMillion: 0.10,        // US$0,10 por millón de tokens entrada
    estimatedCachedInputCostPerMillion: 0.01,  // US$0,01 por millón entrada cacheada
    estimatedCacheWriteCostPerMillion: 0.125,  // US$0,125 por millón escritura de caché
    estimatedOutputCostPerMillion: 0.50,       // US$0,50 por millón salida (incluye razonamiento)
    costNote: 'Tarifa oficial OpenAI GPT-6 Luna. Elegible para programa Data Sharing OpenAI (Grupo Principal - 250.000 tokens/día compartidos). Entrada: $0.10/1M, Caché: $0.01/1M, Escritura Caché: $0.125/1M, Salida: $0.50/1M. Soporta Responses API y reasoning effort.',
    maxTokens: 16384,
    temperature: 0.2,
    supportsStructuredJson: true,
    supportsReasoningEffort: true,
    reasoningEffortDefault: 'medium',
    supportsResponsesApi: true,
    freeTierGroup: 'MAIN',
    isDefault: false,
  },
  'gpt-4o': {
    id: 'gpt-4o',
    provider: 'OPENAI',
    displayName: 'OpenAI GPT-4o (Omni)',
    status: 'ACTIVE',
    pricingEffectiveDate: '2025-01-01',
    estimatedInputCostPerMillion: 2.50,
    estimatedOutputCostPerMillion: 10.00,
    costNote: 'Tarifa oficial pública OpenAI. Elegible para programa Data Sharing OpenAI (Grupo Principal - 250.000 tokens/día compartidos). Costo estimado sin considerar descuentos por prompt caching o impuestos.',
    maxTokens: 4096,
    temperature: 0.1,
    supportsStructuredJson: true,
    freeTierGroup: 'MAIN',
    isDefault: true,
  },
  'gpt-5.4-mini': {
    id: 'gpt-5.4-mini',
    provider: 'OPENAI',
    displayName: 'OpenAI GPT-5.4 Mini',
    status: 'ACTIVE',
    pricingEffectiveDate: '2026-01-01',
    estimatedInputCostPerMillion: 0.15,
    estimatedOutputCostPerMillion: 0.60,
    costNote: 'Modelo oficial vigente elegible para programa Data Sharing OpenAI (Grupo Modelos Pequeños - 2.500.000 tokens/día compartidos). Óptima capacidad de síntesis técnica.',
    maxTokens: 8192,
    temperature: 0.1,
    supportsStructuredJson: true,
    freeTierGroup: 'SMALL',
    isDefault: false,
  },
  'gpt-5.4-nano': {
    id: 'gpt-5.4-nano',
    provider: 'OPENAI',
    displayName: 'OpenAI GPT-5.4 Nano',
    status: 'ACTIVE',
    pricingEffectiveDate: '2026-01-01',
    estimatedInputCostPerMillion: 0.05,
    estimatedOutputCostPerMillion: 0.20,
    costNote: 'Modelo ultra ligero oficial elegible para programa Data Sharing OpenAI (Grupo Modelos Pequeños - 2.500.000 tokens/día compartidos). Latencia ultra baja.',
    maxTokens: 4096,
    temperature: 0.1,
    supportsStructuredJson: true,
    freeTierGroup: 'SMALL',
    isDefault: false,
  },
  'gpt-5-mini': {
    id: 'gpt-5-mini',
    provider: 'OPENAI',
    displayName: 'OpenAI GPT-5 Mini',
    status: 'ACTIVE',
    pricingEffectiveDate: '2025-08-01',
    estimatedInputCostPerMillion: 0.15,
    estimatedOutputCostPerMillion: 0.60,
    costNote: 'Modelo eficiente oficial elegible para programa Data Sharing OpenAI (Grupo Modelos Pequeños - 2.500.000 tokens/día compartidos).',
    maxTokens: 8192,
    temperature: 0.1,
    supportsStructuredJson: true,
    freeTierGroup: 'SMALL',
    isDefault: false,
  },
  'o4-mini': {
    id: 'o4-mini',
    provider: 'OPENAI',
    displayName: 'OpenAI o4-mini',
    status: 'ACTIVE',
    pricingEffectiveDate: '2026-01-01',
    estimatedInputCostPerMillion: 1.10,
    estimatedOutputCostPerMillion: 4.40,
    costNote: 'Modelo de razonamiento vigente oficial elegible para programa Data Sharing OpenAI (Grupo Modelos Pequeños - 2.500.000 tokens/día compartidos). Inferencia con reasoning tokens.',
    maxTokens: 16384,
    temperature: 1.0,
    supportsStructuredJson: true,
    supportsReasoningEffort: true,
    reasoningEffortDefault: 'medium',
    freeTierGroup: 'SMALL',
    isDefault: false,
  },
  'gpt-4o-mini': {
    id: 'gpt-4o-mini',
    provider: 'OPENAI',
    displayName: 'OpenAI GPT-4o Mini',
    status: 'ACTIVE',
    pricingEffectiveDate: '2025-01-01',
    estimatedInputCostPerMillion: 0.15,
    estimatedOutputCostPerMillion: 0.60,
    costNote: 'Tarifa oficial pública OpenAI. Elegible para programa Data Sharing OpenAI (Grupo Modelos Pequeños - 2.500.000 tokens/día compartidos). Costo estimado sin considerar descuentos por prompt caching o impuestos.',
    maxTokens: 4096,
    temperature: 0.1,
    supportsStructuredJson: true,
    freeTierGroup: 'SMALL',
    isDefault: false,
  },
  'o3-mini': {
    id: 'o3-mini',
    provider: 'OPENAI',
    displayName: 'OpenAI o3-mini',
    status: 'ACTIVE',
    pricingEffectiveDate: '2025-01-31',
    estimatedInputCostPerMillion: 1.10,
    estimatedOutputCostPerMillion: 4.40,
    costNote: 'Tarifa estándar OpenAI para modelo de razonamiento. EXCLUIDO de la promoción Data Sharing (no elegible para tokens gratuitos sin confirmación específica). Inferencia con reasoning tokens estándar.',
    maxTokens: 8192,
    temperature: 1.0,
    supportsStructuredJson: true,
    freeTierGroup: 'NONE',
    isDefault: false,
  },
  'gpt-4-turbo': {
    id: 'gpt-4-turbo',
    provider: 'OPENAI',
    displayName: 'OpenAI GPT-4 Turbo',
    status: 'DEPRECATED',
    pricingEffectiveDate: '2024-04-09',
    estimatedInputCostPerMillion: 10.00,
    estimatedOutputCostPerMillion: 30.00,
    costNote: 'Modelo de generación anterior. EXCLUIDO del descuento promocional de tokens gratuitos de OpenAI Data Sharing (no elegible). Se recomienda migrar a gpt-4o o gpt-6-luna.',
    maxTokens: 4096,
    temperature: 0.1,
    supportsStructuredJson: true,
    freeTierGroup: 'NONE',
    isDefault: false,
  },
  'gpt-3.5-turbo': {
    id: 'gpt-3.5-turbo',
    provider: 'OPENAI',
    displayName: 'OpenAI GPT-3.5 Turbo',
    status: 'RETIRED',
    pricingEffectiveDate: '2023-11-06',
    estimatedInputCostPerMillion: 1.50,
    estimatedOutputCostPerMillion: 2.00,
    costNote: 'Modelo retirado para análisis cuantitativo. Incompatible con razonamiento SMC avanzado.',
    maxTokens: 2048,
    temperature: 0.2,
    supportsStructuredJson: false,
    freeTierGroup: 'NONE',
    isDefault: false,
  },

  // ---------------------------------------------------------------------------
  // Google Gemini Models (Official Google GenAI API - Verified as of 2025)
  // ---------------------------------------------------------------------------
  'gemini-2.0-flash': {
    id: 'gemini-2.0-flash',
    provider: 'GEMINI',
    displayName: 'Google Gemini 2.0 Flash',
    status: 'ACTIVE',
    pricingEffectiveDate: '2025-02-01',
    estimatedInputCostPerMillion: 0.10,
    estimatedOutputCostPerMillion: 0.40,
    costNote: 'Tarifa oficial Google AI Studio / Vertex AI. Optimizado para latencia ultrabaja y JSON estructurado.',
    maxTokens: 4096,
    temperature: 0.1,
    supportsStructuredJson: true,
    isDefault: true,
  },
  'gemini-1.5-flash': {
    id: 'gemini-1.5-flash',
    provider: 'GEMINI',
    displayName: 'Google Gemini 1.5 Flash',
    status: 'ACTIVE',
    pricingEffectiveDate: '2024-09-24',
    estimatedInputCostPerMillion: 0.075,
    estimatedOutputCostPerMillion: 0.30,
    costNote: 'Tarifa oficial Google AI Studio para contextos <= 128k tokens.',
    maxTokens: 4096,
    temperature: 0.1,
    supportsStructuredJson: true,
    isDefault: false,
  },
  'gemini-1.5-pro': {
    id: 'gemini-1.5-pro',
    provider: 'GEMINI',
    displayName: 'Google Gemini 1.5 Pro',
    status: 'ACTIVE',
    pricingEffectiveDate: '2024-09-24',
    estimatedInputCostPerMillion: 1.25,
    estimatedOutputCostPerMillion: 5.00,
    costNote: 'Tarifa oficial Google AI Studio para análisis de razonamiento profundo.',
    maxTokens: 8192,
    temperature: 0.1,
    supportsStructuredJson: true,
    isDefault: false,
  },
  'gemini-1.0-pro': {
    id: 'gemini-1.0-pro',
    provider: 'GEMINI',
    displayName: 'Google Gemini 1.0 Pro',
    status: 'RETIRED',
    pricingEffectiveDate: '2024-02-15',
    estimatedInputCostPerMillion: 0.50,
    estimatedOutputCostPerMillion: 1.50,
    costNote: 'Modelo retirado por Google en favor de la familia Gemini 1.5/2.0.',
    maxTokens: 2048,
    temperature: 0.2,
    supportsStructuredJson: false,
    isDefault: false,
  },
};

/**
 * Checks compatibility and status of requested model
 */
export function isModelCompatible(modelId: string): { compatible: boolean; reason?: string } {
  const meta = AI_MODELS_CATALOG[modelId];
  if (!meta) {
    return {
      compatible: false,
      reason: `Modelo '${modelId}' no reconocido en el catálogo oficial de NanoLabs AI Trading`,
    };
  }
  if (meta.status === 'RETIRED') {
    return {
      compatible: false,
      reason: `El modelo '${modelId}' ha sido retirado oficialmente por su proveedor y no debe utilizarse`,
    };
  }
  if (!meta.supportsStructuredJson) {
    return {
      compatible: false,
      reason: `El modelo '${modelId}' no garantiza compatibilidad estricta con esquemas JSON estructurados requeridos para el consenso`,
    };
  }
  return { compatible: true };
}

/**
 * Validates requested model and falls back safely to default active model if incompatible
 */
export function getValidatedModel(requestedModel: string, provider: AiProvider): string {
  const check = isModelCompatible(requestedModel);
  if (check.compatible) {
    return requestedModel;
  }

  // Fallback to provider default active model
  const defaultModel = provider === 'OPENAI' ? 'gpt-4o' : 'gemini-2.0-flash';
  return defaultModel;
}

export function getModelMetadata(modelId: string): ModelMetadata {
  return (
    AI_MODELS_CATALOG[modelId] || {
      id: modelId,
      provider: modelId.startsWith('gemini') ? 'GEMINI' : 'OPENAI',
      displayName: modelId,
      status: 'ACTIVE',
      pricingEffectiveDate: '2025-01-01',
      estimatedInputCostPerMillion: 1.0,
      estimatedOutputCostPerMillion: 3.0,
      costNote: 'Costo estimado general de referencia',
      maxTokens: 4096,
      temperature: 0.1,
      supportsStructuredJson: true,
      freeTierGroup: 'NONE',
      isDefault: false,
    }
  );
}

export function getModelFreeTierGroup(
  modelId: string,
  customConfig?: { mainGroupModels?: string[]; smallGroupModels?: string[] }
): FreeTierGroup {
  if (customConfig?.mainGroupModels && customConfig.mainGroupModels.includes(modelId)) {
    return 'MAIN';
  }
  if (customConfig?.smallGroupModels && customConfig.smallGroupModels.includes(modelId)) {
    return 'SMALL';
  }
  const meta = getModelMetadata(modelId);
  return meta.freeTierGroup || 'NONE';
}

export interface DetailedTokenUsage {
  promptTokens: number;
  completionTokens: number;
  cachedTokens?: number;
  cachedPromptTokens?: number;
  reasoningTokens?: number;
  cacheWriteTokens?: number;
}

/**
 * Calculates estimated USD cost for a model call.
 * Accurately bills cached input tokens and internal reasoning tokens according to provider specs.
 */
export function calculateCallCost(
  modelId: string,
  promptTokensOrUsage: number | DetailedTokenUsage,
  completionTokens: number = 0
): number {
  const meta = getModelMetadata(modelId);
  let prompt = 0;
  let completion = 0;
  let cached = 0;
  let reasoning = 0;
  let cacheWrite = 0;

  if (typeof promptTokensOrUsage === 'object') {
    prompt = promptTokensOrUsage.promptTokens || 0;
    completion = promptTokensOrUsage.completionTokens || 0;
    cached = promptTokensOrUsage.cachedTokens ?? promptTokensOrUsage.cachedPromptTokens ?? 0;
    reasoning = promptTokensOrUsage.reasoningTokens || 0;
    cacheWrite = promptTokensOrUsage.cacheWriteTokens || 0;
  } else {
    prompt = promptTokensOrUsage || 0;
    completion = completionTokens || 0;
  }

  // Internal reasoning tokens are billed as output tokens according to OpenAI specifications
  const effectiveCompletionTokens = completion + reasoning;

  // Uncached prompt tokens
  const uncachedPromptTokens = Math.max(0, prompt - cached);

  const inputCost = (uncachedPromptTokens / 1_000_000) * meta.estimatedInputCostPerMillion;
  const cachedCost = (cached / 1_000_000) * (meta.estimatedCachedInputCostPerMillion ?? (meta.estimatedInputCostPerMillion * 0.5));
  const cacheWriteCost = (cacheWrite / 1_000_000) * (meta.estimatedCacheWriteCostPerMillion ?? 0);
  const outputCost = (effectiveCompletionTokens / 1_000_000) * meta.estimatedOutputCostPerMillion;

  return parseFloat((inputCost + cachedCost + cacheWriteCost + outputCost).toFixed(6));
}
