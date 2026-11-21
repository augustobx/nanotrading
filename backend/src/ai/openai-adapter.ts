import { MarketSnapshot, AiEvaluationResult, AiAvailabilityStatus } from './types.js';
import { calculateCallCost, getValidatedModel } from './models-catalog.js';

export interface OpenAiAdapterOptions {
  apiKey?: string;
  model?: string;
  reasoningEffort?: 'low' | 'medium' | 'high';
  timeoutMs?: number;
  mockEvaluator?: (snapshot: MarketSnapshot) => Promise<Partial<AiEvaluationResult>>;
}

export class OpenAiAdapter {
  private apiKey: string;
  private model: string;
  private reasoningEffort: 'low' | 'medium' | 'high';
  private timeoutMs: number;
  private mockEvaluator?: (snapshot: MarketSnapshot) => Promise<Partial<AiEvaluationResult>>;
  private lastSuccessTimestamp: number | null = null;
  private lastError: string | null = null;
  private lastAvailabilityStatus: AiAvailabilityStatus = 'AVAILABLE';

  constructor(options: OpenAiAdapterOptions = {}) {
    this.apiKey = options.apiKey !== undefined ? options.apiKey : (process.env.OPENAI_API_KEY || '');
    this.model = getValidatedModel(options.model || process.env.OPENAI_MODEL || 'gpt-4o', 'OPENAI');
    this.reasoningEffort = options.reasoningEffort || 'medium';
    this.timeoutMs = options.timeoutMs || 25000;
    this.mockEvaluator = options.mockEvaluator;
    if (!this.apiKey && !this.mockEvaluator) {
      this.lastAvailabilityStatus = 'UNCONFIGURED';
      this.lastError = 'OPENAI_API_KEY no configurada';
    }
  }

  public setMockEvaluator(fn?: (snapshot: MarketSnapshot) => Promise<Partial<AiEvaluationResult>>): void {
    this.mockEvaluator = fn;
  }

  public updateCredentials(apiKey: string, model?: string, reasoningEffort?: 'low' | 'medium' | 'high'): void {
    this.apiKey = apiKey ? apiKey.trim() : '';
    if (model) {
      this.model = getValidatedModel(model, 'OPENAI');
    }
    if (reasoningEffort) {
      this.reasoningEffort = reasoningEffort;
    }
    if (this.apiKey) {
      this.lastAvailabilityStatus = 'AVAILABLE';
      this.lastError = null;
    } else {
      this.lastAvailabilityStatus = 'UNCONFIGURED';
      this.lastError = 'OPENAI_API_KEY no configurada';
    }
  }

  public async evaluate(snapshot: MarketSnapshot): Promise<AiEvaluationResult> {
    const startTime = Date.now();

    // Check mock evaluator for deterministic unit tests
    if (this.mockEvaluator) {
      const mockRes = await this.mockEvaluator(snapshot);
      const latencyMs = Date.now() - startTime;
      const promptTokens = mockRes.tokensPrompt || 650;
      const completionTokens = mockRes.tokensCompletion || 280;
      const estimatedCostUsd = calculateCallCost(this.model, promptTokens, completionTokens);
      const availabilityStatus: AiAvailabilityStatus = mockRes.availabilityStatus || (mockRes.error ? 'PROVIDER_ERROR' : 'AVAILABLE');

      this.lastAvailabilityStatus = availabilityStatus;
      if (availabilityStatus === 'AVAILABLE') {
        this.lastSuccessTimestamp = Date.now();
        this.lastError = null;
      } else {
        this.lastError = mockRes.error || 'Error simulado de OpenAI';
      }

      return {
        provider: 'OPENAI',
        model: this.model,
        verdict: mockRes.verdict || 'APPROVE',
        confidence: mockRes.confidence ?? 85,
        reasoning: mockRes.reasoning || 'Evaluación cuantitativa OpenAI completada con confluencia técnica favorable.',
        argumentsFor: mockRes.argumentsFor || ['Tendencia mayor alineada', 'Estructura confirmada'],
        argumentsAgainst: mockRes.argumentsAgainst || ['Spread actual requiere orden límite pasiva'],
        riskAssessment: mockRes.riskAssessment || {
          riskLevel: 'LOW',
          primaryRisks: ['Volatilidad intradía'],
          invalidationTrigger: `Cierre de vela por debajo de ${snapshot.candidateSetup.stopLossPrice}`,
        },
        structuralTargetRealistic: mockRes.structuralTargetRealistic ?? true,
        alternativeScenario: mockRes.alternativeScenario || 'Retroceso más profundo antes de continuación.',
        recommendedAction: mockRes.recommendedAction || 'ENTER_LIMIT',
        latencyMs,
        tokensPrompt: promptTokens,
        tokensCompletion: completionTokens,
        estimatedCostUsd,
        error: mockRes.error,
        availabilityStatus,
      };
    }

    if (!this.apiKey) {
      this.lastAvailabilityStatus = 'UNCONFIGURED';
      this.lastError = 'OPENAI_API_KEY no configurada';
      return {
        provider: 'OPENAI',
        model: this.model,
        verdict: 'WAIT',
        confidence: 0,
        reasoning: 'OPENAI_API_KEY no configurada. Análisis de OpenAI en espera.',
        argumentsFor: [],
        argumentsAgainst: ['Falta clave de API de OpenAI'],
        riskAssessment: {
          riskLevel: 'CRITICAL',
          primaryRisks: ['Credencial no configurada'],
          invalidationTrigger: 'Configurar OPENAI_API_KEY en variables de entorno',
        },
        structuralTargetRealistic: false,
        alternativeScenario: 'Sin evaluación disponible',
        recommendedAction: 'DO_NOT_TRADE',
        latencyMs: 0,
        tokensPrompt: 0,
        tokensCompletion: 0,
        estimatedCostUsd: 0,
        error: 'API_KEY_MISSING',
        availabilityStatus: 'UNCONFIGURED',
      };
    }

    const systemPrompt = `Eres un Analista Cuantitativo Senior y Especialista en Estructura de Mercado (SMC/ICT) para NanoLabs AI Trading.
Tu objetivo es evaluar el snapshot de mercado y el setup propuesto para BTCUSDT Perpetual.
Reglas imperativas:
1. "No operar es una decisión válida y a menudo la mejor".
2. No fuerces señales ni apruebes operaciones con confluencia dudosa.
3. Verifica la coherencia de la estructura multitemporal (1D, 4H, 1H, 15m, 5m).
4. Verifica que el Take Profit sea un objetivo estructural alcanzable y no ficticio.
5. Responde estrictamente en formato JSON válido según el esquema solicitado.`;

    const userPrompt = `Evalúa el siguiente snapshot de mercado y el setup propuesto:\n${JSON.stringify(snapshot, null, 2)}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const isLuna = this.model === 'gpt-6-luna';
      const requestBody: any = {
        model: this.model,
        temperature: isLuna ? 0.2 : 0.1,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      };
      if (isLuna) {
        requestBody.reasoning_effort = this.reasoningEffort;
      }

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`OpenAI API error (${response.status}): ${errText}`);
      }

      const data = (await response.json()) as any;
      const content = data.choices[0]?.message?.content;
      const parsed = JSON.parse(content);
      const latencyMs = Date.now() - startTime;

      const promptTokens = data.usage?.prompt_tokens || 800;
      const completionTokens = data.usage?.completion_tokens || 300;
      const cachedTokens = data.usage?.prompt_tokens_details?.cached_tokens || 0;
      const reasoningTokens = data.usage?.completion_tokens_details?.reasoning_tokens || 0;
      const estimatedCostUsd = calculateCallCost(this.model, {
        promptTokens,
        completionTokens,
        cachedTokens,
        reasoningTokens,
      });

      this.lastAvailabilityStatus = 'AVAILABLE';
      this.lastSuccessTimestamp = Date.now();
      this.lastError = null;

      return {
        provider: 'OPENAI',
        model: this.model,
        verdict: parsed.verdict || 'WAIT',
        confidence: Number(parsed.confidence) || 50,
        reasoning: parsed.reasoning || '',
        argumentsFor: Array.isArray(parsed.argumentsFor) ? parsed.argumentsFor : [],
        argumentsAgainst: Array.isArray(parsed.argumentsAgainst) ? parsed.argumentsAgainst : [],
        riskAssessment: parsed.riskAssessment || {
          riskLevel: 'MEDIUM',
          primaryRisks: [],
          invalidationTrigger: '',
        },
        structuralTargetRealistic: parsed.structuralTargetRealistic ?? true,
        alternativeScenario: parsed.alternativeScenario || '',
        recommendedAction: parsed.recommendedAction || 'DO_NOT_TRADE',
        latencyMs,
        tokensPrompt: promptTokens,
        tokensCompletion: completionTokens,
        estimatedCostUsd,
        rawResponse: parsed,
        availabilityStatus: 'AVAILABLE',
      };
    } catch (err: any) {
      clearTimeout(timeoutId);
      const latencyMs = Date.now() - startTime;

      let availabilityStatus: AiAvailabilityStatus = 'PROVIDER_ERROR';
      const errMsg = String(err?.message || err);
      if (err.name === 'AbortError' || /abort|timeout/i.test(errMsg)) {
        availabilityStatus = 'TIMEOUT';
      } else if (/401|invalid_api_key|Incorrect API key|unauthorized/i.test(errMsg)) {
        availabilityStatus = 'AUTH_ERROR';
      } else if (/429|insufficient_quota|rate_limit|exceeded your current quota/i.test(errMsg)) {
        availabilityStatus = 'RATE_LIMIT_EXCEEDED';
      } else if (/json|syntaxerror|unexpected token/i.test(errMsg)) {
        availabilityStatus = 'INVALID_RESPONSE';
      }

      this.lastAvailabilityStatus = availabilityStatus;
      this.lastError = errMsg;

      return {
        provider: 'OPENAI',
        model: this.model,
        verdict: 'WAIT',
        confidence: 0,
        reasoning: `Error al consultar OpenAI: ${errMsg}`,
        argumentsFor: [],
        argumentsAgainst: [`Fallo en la consulta: ${errMsg}`],
        riskAssessment: {
          riskLevel: 'HIGH',
          primaryRisks: ['Fallo de comunicación con modelo'],
          invalidationTrigger: 'Reintentar consulta o verificar disponibilidad',
        },
        structuralTargetRealistic: false,
        alternativeScenario: 'N/A',
        recommendedAction: 'DO_NOT_TRADE',
        latencyMs,
        tokensPrompt: 0,
        tokensCompletion: 0,
        estimatedCostUsd: 0,
        error: errMsg,
        availabilityStatus,
      };
    }
  }

  public async evaluateWithCustomPrompt(prompt: string): Promise<any> {
    if (!this.apiKey) return null;
    const activeModel = getValidatedModel(this.model, 'OPENAI');
    const effectiveTimeoutMs = Math.max(this.timeoutMs, 25000);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), effectiveTimeoutMs);
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: activeModel,
          messages: [
            { role: 'system', content: 'Eres un analista de trading cuantitativo para NanoLabs. Responde estrictamente en JSON válido.' },
            { role: 'user', content: prompt },
          ],
          response_format: { type: 'json_object' },
          temperature: 0.1,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (!response.ok) {
        const errText = await response.text();
        console.error(`[OpenAI evaluateWithCustomPrompt] HTTP ${response.status}: ${errText}`);
        return null;
      }
      const data: any = await response.json();
      let content = data.choices?.[0]?.message?.content;
      if (!content) {
        console.warn(`[OpenAI evaluateWithCustomPrompt] No choices/content in response`);
        return null;
      }
      content = content.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '').trim();
      const parsed = JSON.parse(content);
      const usage = data.usage || {};
      const promptTokens = usage.prompt_tokens || 0;
      const completionTokens = usage.completion_tokens || 0;
      const costUsd = calculateCallCost(activeModel, promptTokens, completionTokens);
      return { ...parsed, costUsd, promptTokens, completionTokens };
    } catch (err: any) {
      clearTimeout(timeoutId);
      console.error(`[OpenAI evaluateWithCustomPrompt] Exception:`, err.message || err);
      return null;
    }
  }

  public isConfigured(): boolean {
    return !!this.apiKey;
  }

  public getModel(): string {
    return this.model;
  }

  public getStatus(): {
    provider: 'OPENAI';
    configured: boolean;
    model: string;
    reasoningEffort?: 'low' | 'medium' | 'high';
    lastSuccessTimestamp: number | null;
    lastError: string | null;
    availabilityStatus: AiAvailabilityStatus;
    role: string;
  } {
    return {
      provider: 'OPENAI',
      configured: !!this.apiKey,
      model: this.model,
      reasoningEffort: this.model === 'gpt-6-luna' ? this.reasoningEffort : undefined,
      lastSuccessTimestamp: this.lastSuccessTimestamp,
      lastError: this.lastError,
      availabilityStatus: this.lastAvailabilityStatus,
      role: 'Analista Cuantitativo y de Estructura de Mercado',
    };
  }
}
