import { AiProvider } from './types.js';

export type ModelLifecycleStatus = 'ACTIVE' | 'DEPRECATED' | 'RETIRED';

export interface ModelMetadata {
  id: string;
  provider: AiProvider;
  displayName: string;
  status: ModelLifecycleStatus;
  pricingEffectiveDate: string; // ISO date format YYYY-MM-DD
  estimatedInputCostPerMillion: number;
  estimatedOutputCostPerMillion: number;
  costNote: string;
  maxTokens: number;
  temperature: number;
  supportsStructuredJson: boolean;
  isDefault: boolean;
}

export const AI_MODELS_CATALOG: Record<string, ModelMetadata> = {
  // ---------------------------------------------------------------------------
  // OpenAI Models (Official OpenAI API - Verified as of 2025)
  // ---------------------------------------------------------------------------
  'gpt-4o': {
    id: 'gpt-4o',
    provider: 'OPENAI',
    displayName: 'OpenAI GPT-4o (Omni)',
    status: 'ACTIVE',
    pricingEffectiveDate: '2025-01-01',
    estimatedInputCostPerMillion: 2.50,
    estimatedOutputCostPerMillion: 10.00,
    costNote: 'Tarifa oficial pública OpenAI. Costo estimado sin considerar descuentos por prompt caching o impuestos.',
    maxTokens: 4096,
    temperature: 0.1,
    supportsStructuredJson: true,
    isDefault: true,
  },
  'gpt-4o-mini': {
    id: 'gpt-4o-mini',
    provider: 'OPENAI',
    displayName: 'OpenAI GPT-4o Mini',
    status: 'ACTIVE',
    pricingEffectiveDate: '2025-01-01',
    estimatedInputCostPerMillion: 0.15,
    estimatedOutputCostPerMillion: 0.60,
    costNote: 'Tarifa oficial pública OpenAI. Costo estimado sin considerar descuentos por prompt caching o impuestos.',
    maxTokens: 4096,
    temperature: 0.1,
    supportsStructuredJson: true,
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
    costNote: 'Tarifa oficial OpenAI para modelo de razonamiento. Inferencia con reasoning tokens.',
    maxTokens: 8192,
    temperature: 1.0,
    supportsStructuredJson: true,
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
    costNote: 'Modelo de generación anterior. Se recomienda migrar a gpt-4o.',
    maxTokens: 4096,
    temperature: 0.1,
    supportsStructuredJson: true,
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
      isDefault: false,
    }
  );
}

/**
 * Calculates estimated USD cost for a model call.
 * Note: Costs are estimates based on published token prices.
 */
export function calculateCallCost(modelId: string, promptTokens: number, completionTokens: number): number {
  const meta = getModelMetadata(modelId);
  const inputCost = (promptTokens / 1_000_000) * meta.estimatedInputCostPerMillion;
  const outputCost = (completionTokens / 1_000_000) * meta.estimatedOutputCostPerMillion;
  return parseFloat((inputCost + outputCost).toFixed(6));
}
