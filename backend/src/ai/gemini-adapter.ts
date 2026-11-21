import { MarketSnapshot, AiEvaluationResult, AiAvailabilityStatus } from './types.js';
import { calculateCallCost, getValidatedModel } from './models-catalog.js';

export interface GeminiAdapterOptions {
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  mockEvaluator?: (snapshot: MarketSnapshot) => Promise<Partial<AiEvaluationResult>>;
}

export class GeminiAdapter {
  private apiKey: string;
  private model: string;
  private timeoutMs: number;
  private mockEvaluator?: (snapshot: MarketSnapshot) => Promise<Partial<AiEvaluationResult>>;
  private lastSuccessTimestamp: number | null = null;
  private lastError: string | null = null;
  private lastAvailabilityStatus: AiAvailabilityStatus = 'AVAILABLE';

  constructor(options: GeminiAdapterOptions = {}) {
    this.apiKey = options.apiKey !== undefined ? options.apiKey : (process.env.GEMINI_API_KEY || '');
    this.model = getValidatedModel(options.model || process.env.GEMINI_MODEL || 'gemini-2.5-flash', 'GEMINI');
    this.timeoutMs = options.timeoutMs || 25000;
    this.mockEvaluator = options.mockEvaluator;
    if (!this.apiKey && !this.mockEvaluator) {
      this.lastAvailabilityStatus = 'UNCONFIGURED';
      this.lastError = 'GEMINI_API_KEY no configurada';
    }
  }

  public setMockEvaluator(fn?: (snapshot: MarketSnapshot) => Promise<Partial<AiEvaluationResult>>): void {
    this.mockEvaluator = fn;
  }

  public updateCredentials(apiKey: string, model?: string): void {
    this.apiKey = apiKey ? apiKey.trim() : '';
    if (model) {
      this.model = getValidatedModel(model, 'GEMINI');
    }
    if (this.apiKey) {
      this.lastAvailabilityStatus = 'AVAILABLE';
      this.lastError = null;
    } else {
      this.lastAvailabilityStatus = 'UNCONFIGURED';
      this.lastError = 'GEMINI_API_KEY no configurada';
    }
  }

  public async evaluate(snapshot: MarketSnapshot): Promise<AiEvaluationResult> {
    const startTime = Date.now();

    // Check mock evaluator for deterministic unit tests
    if (this.mockEvaluator) {
      const mockRes = await this.mockEvaluator(snapshot);
      const latencyMs = Date.now() - startTime;
      const promptTokens = mockRes.tokensPrompt || 620;
      const completionTokens = mockRes.tokensCompletion || 260;
      const estimatedCostUsd = calculateCallCost(this.model, promptTokens, completionTokens);
      const availabilityStatus: AiAvailabilityStatus = mockRes.availabilityStatus || (mockRes.error ? 'PROVIDER_ERROR' : 'AVAILABLE');

      this.lastAvailabilityStatus = availabilityStatus;
      if (availabilityStatus === 'AVAILABLE') {
        this.lastSuccessTimestamp = Date.now();
        this.lastError = null;
      } else {
        this.lastError = mockRes.error || 'Error simulado de Gemini';
      }

      return {
        provider: 'GEMINI',
        model: this.model,
        verdict: mockRes.verdict || 'APPROVE',
        confidence: mockRes.confidence ?? 80,
        reasoning: mockRes.reasoning || 'Auditoría crítica de riesgo Gemini completada sin anomalías estructurales severas.',
        argumentsFor: mockRes.argumentsFor || ['Relación R:R neta verificada >= 4.0', 'No se detecta trampa de liquidez inmediata'],
        argumentsAgainst: mockRes.argumentsAgainst || ['Monitorear libro de órdenes por absorción'],
        riskAssessment: mockRes.riskAssessment || {
          riskLevel: 'LOW',
          primaryRisks: ['Riesgo de deslizamiento en salida por stop'],
          invalidationTrigger: `Ruptura del mínimo de mecha en ${snapshot.candidateSetup.stopLossPrice}`,
        },
        structuralTargetRealistic: mockRes.structuralTargetRealistic ?? true,
        alternativeScenario: mockRes.alternativeScenario || 'Rango extendido en 15m.',
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
      this.lastError = 'GEMINI_API_KEY no configurada';
      return {
        provider: 'GEMINI',
        model: this.model,
        verdict: 'WAIT',
        confidence: 0,
        reasoning: 'GEMINI_API_KEY no configurada. Auditoría crítica de Gemini en espera.',
        argumentsFor: [],
        argumentsAgainst: ['Falta clave de API de Gemini'],
        riskAssessment: {
          riskLevel: 'CRITICAL',
          primaryRisks: ['Credencial no configurada'],
          invalidationTrigger: 'Configurar GEMINI_API_KEY en variables de entorno',
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

    const systemInstruction = `Actúa como Auditor Crítico de Riesgos Cuantitativos y Especialista en Detección de Trampas de Liquidez para NanoLabs AI Trading.
Tu rol es actuar como un "abogado del diablo" independiente e hipercrítico sobre el setup propuesto de BTCUSDT Perpetual.
Cuestiona rigurosamente:
1. ¿El Take Profit es un objetivo estructural genuino o está inflado para forzar un R:R de 1:4?
2. ¿Hay desequilibrio adverso en el libro de órdenes o falta de sincronización?
3. ¿Existe riesgo inminente de trampa de liquidez (barrido falso o absorción institucional)?
4. Si hay la menor contradicción relevante, emite WAIT o REJECT. "No operar es una decisión válida y a menudo la mejor".
Responde obligatoriamente en JSON estricto.`;

    const promptText = `Analiza con máximo rigor el siguiente snapshot de mercado y setup propuesto:\n${JSON.stringify(snapshot, null, 2)}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const apiKeyTrimmed = (this.apiKey || '').trim();
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent?key=${encodeURIComponent(apiKeyTrimmed)}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKeyTrimmed,
        },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [{ text: `${systemInstruction}\n\n${promptText}` }],
            },
          ],
          generationConfig: {
            temperature: 0.1,
            responseMimeType: 'application/json',
          },
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Gemini API error (${response.status}): ${errText}`);
      }

      const data = (await response.json()) as any;
      const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
      const parsed = JSON.parse(rawText || '{}');
      const latencyMs = Date.now() - startTime;

      const promptTokens = data.usageMetadata?.promptTokenCount || 750;
      const completionTokens = data.usageMetadata?.candidatesTokenCount || 280;
      const estimatedCostUsd = calculateCallCost(this.model, promptTokens, completionTokens);

      this.lastAvailabilityStatus = 'AVAILABLE';
      this.lastSuccessTimestamp = Date.now();
      this.lastError = null;

      return {
        provider: 'GEMINI',
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
      } else if (/401|403|API_KEY_INVALID|invalid_api_key|api key not valid|key not valid|unauthorized/i.test(errMsg)) {
        availabilityStatus = 'AUTH_ERROR';
      } else if (/429|RESOURCE_EXHAUSTED|quota|rate_limit/i.test(errMsg)) {
        availabilityStatus = 'RATE_LIMIT_EXCEEDED';
      } else if (/404|not found|models\//i.test(errMsg)) {
        availabilityStatus = 'MODEL_NOT_FOUND';
      } else if (/json|syntaxerror|unexpected token/i.test(errMsg)) {
        availabilityStatus = 'INVALID_RESPONSE';
      }

      this.lastAvailabilityStatus = availabilityStatus;
      this.lastError = errMsg;

      return {
        provider: 'GEMINI',
        model: this.model,
        verdict: 'WAIT',
        confidence: 0,
        reasoning: `Error al consultar Gemini: ${errMsg}`,
        argumentsFor: [],
        argumentsAgainst: [`Fallo en la consulta: ${errMsg}`],
        riskAssessment: {
          riskLevel: 'HIGH',
          primaryRisks: ['Fallo de comunicación con modelo Gemini'],
          invalidationTrigger: 'Reintentar consulta o verificar cuota',
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
    const activeModel = getValidatedModel(this.model, 'GEMINI');
    const effectiveTimeoutMs = Math.max(this.timeoutMs, 25000);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), effectiveTimeoutMs);
    try {
      const apiKeyTrimmed = (this.apiKey || '').trim();
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(activeModel)}:generateContent?key=${encodeURIComponent(apiKeyTrimmed)}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKeyTrimmed,
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.1,
            responseMimeType: 'application/json',
          },
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (!response.ok) {
        const errText = await response.text();
        console.error(`[Gemini evaluateWithCustomPrompt] HTTP ${response.status}: ${errText}`);
        return null;
      }
      const data: any = await response.json();
      let text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        console.warn(`[Gemini evaluateWithCustomPrompt] No candidates/text in response`);
        return null;
      }
      text = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '').trim();
      const parsed = JSON.parse(text);
      const usage = data.usageMetadata || {};
      const promptTokens = usage.promptTokenCount || 0;
      const completionTokens = usage.candidatesTokenCount || 0;
      const costUsd = calculateCallCost(activeModel, promptTokens, completionTokens);
      return { ...parsed, costUsd, promptTokens, completionTokens };
    } catch (err: any) {
      clearTimeout(timeoutId);
      console.error(`[Gemini evaluateWithCustomPrompt] Exception:`, err.message || err);
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
    provider: 'GEMINI';
    configured: boolean;
    model: string;
    lastSuccessTimestamp: number | null;
    lastError: string | null;
    availabilityStatus: AiAvailabilityStatus;
    role: string;
  } {
    return {
      provider: 'GEMINI',
      configured: !!this.apiKey,
      model: this.model,
      lastSuccessTimestamp: this.lastSuccessTimestamp,
      lastError: this.lastError,
      availabilityStatus: this.lastAvailabilityStatus,
      role: 'Auditor Crítico de Riesgos e Invalidación',
    };
  }
}
