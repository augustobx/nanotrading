import { AiProvider } from './types.js';

export interface ModelMetadata {
  id: string;
  provider: AiProvider;
  displayName: string;
  inputCostPerMillion: number;
  outputCostPerMillion: number;
  maxTokens: number;
  temperature: number;
  supportsStructuredJson: boolean;
  isDefault: boolean;
}

export const AI_MODELS_CATALOG: Record<string, ModelMetadata> = {
  // OpenAI Models
  'gpt-4o': {
    id: 'gpt-4o',
    provider: 'OPENAI',
    displayName: 'OpenAI GPT-4o',
    inputCostPerMillion: 2.50,
    outputCostPerMillion: 10.00,
    maxTokens: 4096,
    temperature: 0.1,
    supportsStructuredJson: true,
    isDefault: true,
  },
  'gpt-4o-mini': {
    id: 'gpt-4o-mini',
    provider: 'OPENAI',
    displayName: 'OpenAI GPT-4o Mini',
    inputCostPerMillion: 0.15,
    outputCostPerMillion: 0.60,
    maxTokens: 4096,
    temperature: 0.1,
    supportsStructuredJson: true,
    isDefault: false,
  },
  'o3-mini': {
    id: 'o3-mini',
    provider: 'OPENAI',
    displayName: 'OpenAI o3-mini',
    inputCostPerMillion: 1.10,
    outputCostPerMillion: 4.40,
    maxTokens: 8192,
    temperature: 1.0,
    supportsStructuredJson: true,
    isDefault: false,
  },

  // Google Gemini Models
  'gemini-2.5-flash': {
    id: 'gemini-2.5-flash',
    provider: 'GEMINI',
    displayName: 'Google Gemini 2.5 Flash',
    inputCostPerMillion: 0.075,
    outputCostPerMillion: 0.30,
    maxTokens: 4096,
    temperature: 0.1,
    supportsStructuredJson: true,
    isDefault: true,
  },
  'gemini-1.5-pro': {
    id: 'gemini-1.5-pro',
    provider: 'GEMINI',
    displayName: 'Google Gemini 1.5 Pro',
    inputCostPerMillion: 1.25,
    outputCostPerMillion: 5.00,
    maxTokens: 8192,
    temperature: 0.1,
    supportsStructuredJson: true,
    isDefault: false,
  },
  'gemini-2.0-flash': {
    id: 'gemini-2.0-flash',
    provider: 'GEMINI',
    displayName: 'Google Gemini 2.0 Flash',
    inputCostPerMillion: 0.10,
    outputCostPerMillion: 0.40,
    maxTokens: 4096,
    temperature: 0.1,
    supportsStructuredJson: true,
    isDefault: false,
  },
};

export function getModelMetadata(modelId: string): ModelMetadata {
  return (
    AI_MODELS_CATALOG[modelId] || {
      id: modelId,
      provider: modelId.startsWith('gemini') ? 'GEMINI' : 'OPENAI',
      displayName: modelId,
      inputCostPerMillion: 1.0,
      outputCostPerMillion: 3.0,
      maxTokens: 4096,
      temperature: 0.1,
      supportsStructuredJson: true,
      isDefault: false,
    }
  );
}

export function calculateCallCost(modelId: string, promptTokens: number, completionTokens: number): number {
  const meta = getModelMetadata(modelId);
  const inputCost = (promptTokens / 1_000_000) * meta.inputCostPerMillion;
  const outputCost = (completionTokens / 1_000_000) * meta.outputCostPerMillion;
  return parseFloat((inputCost + outputCost).toFixed(6));
}
