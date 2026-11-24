import type { MarketIntelligenceSummary, TriggerSource } from './scenario-types.js';

export type DiscoveryOutcome = 'AI_NO_TRADE' | 'CANDIDATES_REJECTED' | 'DIRECTIONAL_ACCEPTED' |
  'PROVIDER_UNAVAILABLE' | 'DATA_UNAVAILABLE' | 'BUDGET_BLOCKED' | 'RUNNING' | 'ERROR';

export interface CandidateDecision {
  provider: string;
  direction?: string;
  levels: Record<string, number | null>;
  accepted: boolean;
  reason: string;
  details?: Record<string, unknown>;
  scenarioId?: string;
}

export interface DiscoveryAudit {
  id: string;
  timestamp: number;
  completedAt?: number;
  triggerSource: TriggerSource;
  outcome: DiscoveryOutcome;
  reason?: string;
  snapshot: MarketIntelligenceSummary;
  policy: Record<string, unknown> | null;
  providers: Record<string, {
    status: 'SUCCESS' | 'UNAVAILABLE' | 'NOT_CONFIGURED' | 'PAUSED' | 'NOT_REQUESTED';
    model?: string;
    bias?: string;
    candidateCount?: number;
    failure?: string;
    retryNotBefore?: number;
  }>;
  candidates: CandidateDecision[];
  scenarioIds: string[];
}

export function classifyDiscovery(candidates: CandidateDecision[], hasResponse: boolean): DiscoveryOutcome {
  if (!hasResponse) return 'PROVIDER_UNAVAILABLE';
  if (candidates.some(c => c.accepted)) return 'DIRECTIONAL_ACCEPTED';
  return candidates.length ? 'CANDIDATES_REJECTED' : 'AI_NO_TRADE';
}
