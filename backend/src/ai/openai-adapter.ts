import { MarketSnapshot, AiEvaluationResult } from './types.js';
import { calculateCallCost } from './models-catalog.js';

export interface OpenAiAdapterOptions {
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  mockEvaluator?: (snapshot: MarketSnapshot) => Promise<Partial<AiEvaluationResult>>;
}

export class OpenAiAdapter {
  private apiKey: string;
  private model: string;
  private timeoutMs: number;
  private mockEvaluator?: (snapshot: MarketSnapshot) => Promise<Partial<AiEvaluationResult>>;

  constructor(options: OpenAiAdapterOptions = {}) {
    this.apiKey = options.apiKey || process.env.OPENAI_API_KEY || '';
    this.model = options.model || process.env.OPENAI_MODEL || 'gpt-4o';
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
      const promptTokens = mockRes.tokensPrompt || 650;
      const completionTokens = mockRes.tokensCompletion || 280;
      const estimatedCostUsd = calculateCallCost(this.model, promptTokens, completionTokens);

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
      };
    }

    if (!this.apiKey) {
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
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0.1,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
        }),
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
      const estimatedCostUsd = calculateCallCost(this.model, promptTokens, completionTokens);

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
      };
    } catch (err: any) {
      clearTimeout(timeoutId);
      const latencyMs = Date.now() - startTime;
      return {
        provider: 'OPENAI',
        model: this.model,
        verdict: 'WAIT',
        confidence: 0,
        reasoning: `Error al consultar OpenAI: ${err.message}`,
        argumentsFor: [],
        argumentsAgainst: [`Fallo en la consulta: ${err.message}`],
        riskAssessment: {
          riskLevel: 'HIGH',
          primaryRisks: ['Fallo de comunicación con modelo'],
          invalidationTrigger: 'Reintentar consulta o verificar rate-limits',
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
