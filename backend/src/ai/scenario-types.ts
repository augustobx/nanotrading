import { Timeframe } from '../types/market.js';
import { AiProvider, AiVerdict, ConsensusVerdict } from './types.js';

export type ScenarioStatus =
  | 'NO_TRADE_OBSERVATION'
  | 'SCENARIO_PROPOSED'
  | 'SCENARIO_REGISTERED'
  | 'SCENARIO_MONITORING'
  | 'APPROACHING_ZONE'
  | 'IN_ZONE'
  | 'REVALIDATION_REQUESTED'
  | 'AI_REVALIDATING'
  | 'WAITING_CONFIRMATION'
  | 'ENTRY_VALIDATED'
  | 'SIGNAL_GENERATED'
  | 'INVALIDATED'
  | 'EXPIRED'
  | 'CANCELLED';

export type ScenarioRRMode = 'RR_1_2' | 'RR_1_4' | 'RR_BOTH' | 'NONE';

export type UncertaintyLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export interface ScenarioInterpretation {
  provider: AiProvider;
  model: string;
  bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  reasoning: string;
  keyZones: string[];
  confidence: number;
}

export interface Scenario {
  id: string;
  symbol: string;
  direction: 'LONG' | 'SHORT' | 'NEUTRAL';
  timeframe: Timeframe;
  structureType: string;
  proposedBy: AiProvider | 'CONSENSUS' | 'STRATEGY';
  modelsUsed: string[];
  snapshotId: string;
  discoveryTimestamp: number;
  entryZoneMin: number;
  entryZoneMax: number;
  targetEntry: number;
  stopLossPrice: number;
  target12Price?: number;
  target14Price?: number;
  netRR12?: number;
  netRR14?: number;
  rrModeAvailable: ScenarioRRMode;
  uncertaintyLevel: UncertaintyLevel;
  status: ScenarioStatus;
  rejectionReason?: string;
  validUntilTimestamp: number;
  aiCostUsd: number;
  activationConditions: string[];
  invalidationTriggers: string[];
  argumentsFor: string[];
  argumentsAgainst: string[];
  openaiInterpretation?: ScenarioInterpretation;
  geminiInterpretation?: ScenarioInterpretation;
  distanceToZonePct?: number;
  currentPrice?: number;
  lastCheckedTimestamp?: number;
  isSimulated?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ScenarioLifecycleEvent {
  id?: number;
  scenarioId: string;
  fromStatus: ScenarioStatus;
  toStatus: ScenarioStatus;
  timestamp: number;
  reason?: string;
  metadata?: Record<string, any>;
}

export interface ScenarioRevalidationRecord {
  id: string;
  scenarioId: string;
  timestamp: number;
  openaiVerdict?: AiVerdict;
  geminiVerdict?: AiVerdict;
  consensusVerdict: ConsensusVerdict;
  priceAtRevalidation: number;
  details: {
    openaiReasoning?: string;
    geminiReasoning?: string;
    changesObserved?: string[];
    rr12Confirmed?: boolean;
    rr14Confirmed?: boolean;
    invalidationTrigger?: string;
    costUsd?: number;
    tokensUsed?: number;
  };
}

export interface MarketIntelligenceSummary {
  symbol: string;
  timestamp: number;
  currentPrice: number;
  timeframes: Record<Timeframe, {
    trend: 'BULLISH' | 'BEARISH' | 'RANGING';
    rsi: number;
    atr: number;
    ema20?: number;
    ema50?: number;
    ema200?: number;
    vwap?: number;
    volumeRelative: number;
    activeSwings: { high?: number; low?: number };
    bosCount: number;
    chochCount: number;
    activeFvgs: number;
    activeObs: number;
  }>;
  orderBook: {
    spread: number;
    spreadPcnt: number;
    imbalance: number;
    bestBid: number;
    bestAsk: number;
  };
  marketContext: {
    fundingRate: number;
    openInterest: number;
    volatility24hPct: number;
    high24h: number;
    low24h: number;
  };
  openaiBias?: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  geminiBias?: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  lastDiscoveryTimestamp?: number;
  lastRevalidationTimestamp?: number;
}
