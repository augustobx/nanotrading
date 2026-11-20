import { Timeframe } from '../types/market.js';
import { SetupCandidate } from '../engine/strategy-a-trend.js';

export type AiProvider = 'OPENAI' | 'GEMINI';

export type AiVerdict = 'APPROVE' | 'WAIT' | 'REJECT';

export type ConsensusVerdict = 'AUTHORIZED' | 'WAITING_CONDITIONS' | 'DISCARDED';

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type AiAvailabilityStatus =
  | 'AVAILABLE'
  | 'UNCONFIGURED'
  | 'TIMEOUT'
  | 'AUTH_ERROR'
  | 'RATE_LIMIT_EXCEEDED'
  | 'PROVIDER_ERROR'
  | 'INVALID_RESPONSE';

export type AiEvaluationMode =
  | 'DUAL_AI'
  | 'SINGLE_AI_OPENAI'
  | 'SINGLE_AI_GEMINI'
  | 'AI_UNAVAILABLE'
  | 'AI_BUDGET_EXCEEDED';

export interface MarketSnapshotOrderBookLevel {
  price: number;
  size: number;
}

export interface MarketSnapshotTimeframeSummary {
  timeframe: Timeframe;
  trend: 'BULLISH' | 'BEARISH' | 'RANGING';
  rsi: number;
  atr: number;
  lastClose: number;
  ema20?: number;
  ema50?: number;
  ema200?: number;
  ema200Ready: boolean;
  relativeVolume: number;
  lastSwingHighPrice?: number;
  lastSwingLowPrice?: number;
  activeFvgsCount: number;
  activeObsCount: number;
}

export interface MarketSnapshot {
  snapshotId: string;
  timestamp: number;
  symbol: string;
  ticker: {
    lastPrice: number;
    markPrice: number;
    indexPrice: number;
    bid1Price: number;
    ask1Price: number;
    spread: number;
    spreadPcnt: number;
    fundingRate: number;
    openInterest: number;
  };
  orderBook: {
    bestBid: number;
    bestAsk: number;
    spread: number;
    spreadPcnt: number;
    imbalance: number;
    bidsTop5: MarketSnapshotOrderBookLevel[];
    asksTop5: MarketSnapshotOrderBookLevel[];
    isSynced: boolean;
  };
  multiTimeframe: Record<string, MarketSnapshotTimeframeSummary>;
  candidateSetup: SetupCandidate;
  dataIntegrity: {
    wsConnected: boolean;
    isOrderBookSynced: boolean;
    gapsDetectedCount: number;
    lastWsMessageAgeMs: number;
    status: string;
  };
}

export interface AiEvaluationResult {
  provider: AiProvider;
  model: string;
  verdict: AiVerdict;
  confidence: number; // 0 to 100
  reasoning: string;
  argumentsFor: string[];
  argumentsAgainst: string[];
  riskAssessment: {
    riskLevel: RiskLevel;
    primaryRisks: string[];
    invalidationTrigger: string;
  };
  structuralTargetRealistic: boolean;
  alternativeScenario: string;
  recommendedAction: 'ENTER_LIMIT' | 'ENTER_CONFIRMATION' | 'DO_NOT_TRADE';
  latencyMs: number;
  tokensPrompt: number;
  tokensCompletion: number;
  estimatedCostUsd: number;
  rawResponse?: any;
  error?: string;
  availabilityStatus?: AiAvailabilityStatus;
}

export interface ConsensusResult {
  signalId: string;
  setupId: string;
  timestamp: number;
  symbol: string;
  strategy: string;
  direction: 'LONG' | 'SHORT';
  timeframe: Timeframe;
  entryPrice: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  grossRR: number;
  netRR: number;
  consensusVerdict: ConsensusVerdict;
  status: 'ACTIVE' | 'EXPIRED' | 'INVALIDATED' | 'DISCARDED';
  rejectionReason?: string;
  openaiReview?: AiEvaluationResult;
  geminiReview?: AiEvaluationResult;
  snapshotId: string;
  executionMode: 'SIGNALS_ONLY'; // Strictly guaranteed live trading disabled
  evaluationMode?: AiEvaluationMode;
  ruleViolations: string[];
  confidenceScore: number;
  confidenceDisclaimer?: string;
  dynamicDrift?: { allowedUsdt: number; actualUsdt: number };
  evaluatedAt: number;
}

export interface AiReviewRecord {
  id: string;
  setupId: string;
  provider: AiProvider;
  model: string;
  verdict: AiVerdict;
  confidence: number;
  reasoning: string;
  argumentsFor: string[];
  argumentsAgainst: string[];
  invalidationTrigger?: string;
  riskScore: number;
  latencyMs: number;
  tokensUsed: number;
  costUsd: number;
  rawResponse?: string;
  timestamp: number;
}
