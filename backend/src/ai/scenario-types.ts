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
  | 'COMPLETED'
  | 'INVALIDATED'
  | 'EXPIRED'
  | 'CANCELLED';

export type ScenarioKind = 'TRADE_SCENARIO' | 'NEUTRAL_OBSERVATION';

export type ScenarioRRMode = 'RR_1_2' | 'RR_1_4' | 'RR_BOTH' | 'NONE';

export type UncertaintyLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export type WatchHorizon = 'SCALP' | 'INTRADAY' | 'SWING';

export type TriggerSource = 'AUTOMATIC_SCHEDULER' | 'MANUAL_TRIGGER' | 'NEUTRAL_BREAKOUT' | 'HISTORIC_REPLAY';

export interface ObservableLevel {
  price: number;
  timeframe: Timeframe;
  levelType: 'SWING_HIGH' | 'SWING_LOW' | 'FVG' | 'FVG_TOP' | 'FVG_BOTTOM' | 'ORDER_BLOCK' | 'SUPPORT' | 'RESISTANCE' | 'DYNAMIC_INDICATOR' | 'DYNAMIC_EMA' | 'VWAP' | 'RANGE_BOUNDARY' | 'PRICE_ACTION';
  evidence: string;
  sourceTimestamp?: number;
  distancePct: number;
  relevanceToHorizon: 'HIGH' | 'MEDIUM' | 'LOW' | 'INCOMPATIBLE';
  isVerified: boolean;
}

export type WatchOperator =
  | 'PRICE_CROSS_ABOVE'
  | 'PRICE_CROSS_BELOW'
  | 'PRICE_IN_RANGE'
  | 'PRICE_TOUCH_LEVEL'
  | 'RSI_THRESHOLD'
  | 'VOLUME_SPIKE'
  | 'SPREAD_TOLERANCE'
  | 'ORDERBOOK_IMBALANCE'
  | 'CANDLE_CLOSE_ABOVE'
  | 'CANDLE_CLOSE_BELOW'
  | 'SWEEP_CONFIRMED'
  | 'STRUCTURE_BREAK'
  | 'TIME_ELAPSED'
  | 'CANDLE_PATTERN'
  | 'LEVEL_REJECTION_WICK'
  | 'STRUCTURE_CLOSE'
  | 'BREAK_AND_RETEST'
  | 'SWEEP_AND_RECLAIM'
  | 'VOLUME_EXPANSION'
  | 'BOS_CONFIRMED'
  | 'CHOCH_CONFIRMED';

export type WatchPlanStatus =
  | 'PENDING'
  | 'ACTIVE'
  | 'TRIGGERED'
  | 'REVALIDATING'
  | 'ENTRY_VALIDATED'
  | 'INVALIDATED'
  | 'EXPIRED'
  | 'COMPLETED'
  | 'CANCELLED';

export interface WatchConditionParams {
  level?: number;
  minLevel?: number;
  maxLevel?: number;
  timeframe?: Timeframe;
  threshold?: number;
  direction?: 'BULLISH' | 'BEARISH';
  comparison?: 'GREATER_THAN' | 'LESS_THAN' | 'EQUALS';
  tolerancePct?: number;
  pattern?: 'BEARISH_ENGULFING' | 'BULLISH_ENGULFING' | 'PIN_BAR' | 'SHOOTING_STAR' | 'HAMMER' | 'INVERTED_HAMMER';
  minWickRatio?: number;
  volumeThresholdRvol?: number;
  maxStepDurationMs?: number;
}

export interface WatchCondition {
  id: string;
  description: string;
  operator: WatchOperator;
  params: WatchConditionParams;
  isMet?: boolean;
  metTimestamp?: number;
  metDetails?: string;
  automatable: boolean;
  sequenceOrder?: number;
}

export interface WatchTriggerEvent {
  event: 'ZONE_TOUCH' | 'CONFIRMATION_COMPLETED' | 'STRUCTURE_SHIFT' | 'VOLATILITY_EXPANSION' | 'ORDERBOOK_IMBALANCE';
  description: string;
  timeframe?: Timeframe;
}

export interface AiWatchPlan {
  id: string;
  scenarioId: string;
  symbol: string;
  direction: 'LONG' | 'SHORT' | 'NEUTRAL';
  marketThesis: string;
  horizon: WatchHorizon;
  primaryTimeframe: Timeframe;
  watchZone: {
    minPrice: number;
    maxPrice: number;
    targetEntry: number;
  };
  candidateStopLoss: number;
  candidateTakeProfits: {
    tp12?: number;
    tp14?: number;
    structuralTarget?: number;
  };
  rrEligibility: ScenarioRRMode;
  observableConditions: WatchCondition[];
  confirmationSequence: string[];
  invalidationConditions: WatchCondition[];
  expirationTimestamp: number;
  reevaluationTriggers: WatchTriggerEvent[];
  reasoningVersion: string;
  status: WatchPlanStatus;
  automatable: boolean;
  nonAutomatableConditions?: string[];
  lastEvaluatedTimestamp?: number;
  createdAt: number;
  updatedAt: number;
}

export interface AiMarketAnalysis {
  whatMarketIsDoing: string;
  whyMarketIsDoingIt: string;
  evidenceList: string[];
  bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  preferredHorizon: WatchHorizon;
  recommendedTimeframe: Timeframe;
  noTradeJustification?: string;
  confidenceDisclaimer?: string;
}

export interface ScenarioInterpretation {
  provider: AiProvider;
  model: string;
  bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  reasoning: string;
  keyZones: string[];
  confidence: number;
  marketAnalysis?: AiMarketAnalysis;
  promptTokens?: number;
  completionTokens?: number;
  costUsd?: number;
}

export type NeutralBreakoutState =
  | 'WAITING_RANGE'
  | 'OUTSIDE_AWAITING_CLOSE'
  | 'OUTSIDE_CLOSED_LOW_VOLUME'
  | 'OUTSIDE_CLOSED_INSUFFICIENT_DATA'
  | 'BACK_INSIDE_RANGE'
  | 'BREAKOUT_CONFIRMED';

export interface NeutralBreakoutProgress {
  state: NeutralBreakoutState;
  side?: 'CEILING' | 'FLOOR';
  price?: number;
  observedAt: number;
  candleTimestamp?: number;
  relativeVolume?: number;
  baselineCount?: number;
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
  neutralBreakoutProgress?: NeutralBreakoutProgress;
  neutralLastEvaluatedCandleTimestamp?: number;
  lastCheckedTimestamp?: number;
  lastRevalidationTimestamp?: number;
  isSimulated?: boolean;
  kind?: ScenarioKind;
  triggerSource?: TriggerSource;
  verifiedLevels?: ObservableLevel[];
  // New Architecture Fields:
  watchPlan?: AiWatchPlan;
  aiMarketThesis?: string;
  horizon?: WatchHorizon;
  missingConditions?: string[];
  confidenceDisclaimer?: string;
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
    marketEvolutionSummary?: string;
    watchPlanId?: string;
  };
}

export interface MarketDataAvailability {
  wsConnected: boolean;
  orderBookSynced: boolean;
  klinesAvailable: Record<Timeframe, boolean>;
  liquidationsAvailable: boolean;
  openInterestAvailable: boolean;
  fundingRateAvailable: boolean;
  allCriticalDataPresent: boolean;
  missingDataNotice?: string;
}

export interface AlgorithmicReferenceSetup {
  strategy: string;
  direction: 'LONG' | 'SHORT';
  timeframe: Timeframe;
  entryPrice: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  netRR: number;
  evidence: string[];
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
    ema200Ready: boolean;
    vwap?: number;
    volumeRelative: number;
    activeSwings: {
      high?: { price: number; timestamp?: number; label?: string };
      low?: { price: number; timestamp?: number; label?: string };
    };
    recentSwings: Array<{ type: 'HIGH' | 'LOW'; price: number; label?: string }>;
    bosCount: number;
    chochCount: number;
    recentStructureBreaks: Array<{ type: 'BOS' | 'CHoCH'; direction: 'BULLISH' | 'BEARISH'; level: number }>;
    activeFvgs: number;
    activeFvgDetails: Array<{ type: 'BULLISH' | 'BEARISH'; top: number; bottom: number; size: number }>;
    activeObs: number;
    activeObDetails: Array<{ type: 'BULLISH' | 'BEARISH'; top: number; bottom: number }>;
    recentSweeps: Array<{ direction: 'BULLISH' | 'BEARISH'; sweptLevel: number; poolType: string }>;
  }>;
  orderBook: {
    spread: number;
    spreadPcnt: number;
    imbalance: number;
    bestBid: number;
    bestAsk: number;
    bidsTop5?: Array<{ price: number; size: number }>;
    asksTop5?: Array<{ price: number; size: number }>;
  };
  marketContext: {
    fundingRate: number;
    openInterest: number;
    volatility24hPct: number;
    high24h: number;
    low24h: number;
  };
  dataAvailability: MarketDataAvailability;
  algorithmicReferenceSetups?: AlgorithmicReferenceSetup[];
  openaiBias?: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  geminiBias?: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  openaiAnalysis?: AiMarketAnalysis;
  geminiAnalysis?: AiMarketAnalysis;
  lastDiscoveryTimestamp?: number;
  lastRevalidationTimestamp?: number;
  confidenceDisclaimer?: string;
}
