import { MarketSnapshot, AiEvaluationResult } from './types.js';
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

  constructor(options: GeminiAdapterOptions = {}) {
    this.apiKey = options.apiKey || process.env.GEMINI_API_KEY || '';
    this.model = getValidatedModel(options.model || process.env.GEMINI_MODEL || 'gemini-2.0-flash', 'GEMINI');
    this.timeoutMs = options.timeoutMs || 8000;
    this.mockEvaluator = options.mockEvaluator;
  }

  public setMockEvaluator(fn?: (snapshot: MarketSnapshot) => Promise<Partial<AiEvaluationResult>>): void {
    this.mockEvaluator = fn;
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
      };
    }

    if (!this.apiKey) {
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
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
      };
    } catch (err: any) {
      clearTimeout(timeoutId);
      const latencyMs = Date.now() - startTime;
      return {
        provider: 'GEMINI',
        model: this.model,
        verdict: 'WAIT',
        confidence: 0,
        reasoning: `Error al consultar Gemini: ${err.message}`,
        argumentsFor: [],
        argumentsAgainst: [`Fallo en la consulta: ${err.message}`],
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
        error: err.message,
      };
    }
  }

  public getModel(): string {
    return this.model;
  }
}
