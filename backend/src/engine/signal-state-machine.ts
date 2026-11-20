import { EventEmitter } from 'events';
import { DatabaseService } from '../storage/database.js';
import { SetupCandidate } from './strategy-a-trend.js';
import { ConsensusResult, AiEvaluationMode } from '../ai/types.js';
import { Scenario } from '../ai/scenario-types.js';

export type SignalState =
  | 'OBSERVING'
  | 'SETUP_DETECTED'
  | 'APPROACHING_ZONE'
  | 'IN_ZONE'
  | 'WAITING_CONFIRMATION'
  | 'AI_REVIEW'
  | 'ENTRY_VALIDATED'
  | 'ALERT_SENT'
  | 'ENTRY_TRIGGERED'
  | 'TRACKING'
  | 'COMPLETED_TP'
  | 'COMPLETED_SL'
  | 'EXPIRED'
  | 'INVALIDATED'
  | 'CANCELLED'
  | 'DATA_UNAVAILABLE'
  | 'ERROR';

export type EntryMode = 'EMITTED_SIGNAL' | 'SIMULATED_PAPER_ENTRY' | 'MANUAL_DECLARED_ENTRY';

export interface SignalInstance {
  id: string;
  setupId: string;
  symbol: string;
  strategy: string;
  direction: 'LONG' | 'SHORT';
  timeframe: string;
  entryPrice: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  grossRR: number;
  netRR: number;
  riskUsdt: number;
  state: SignalState;
  entryMode: EntryMode;
  rrMode?: 'RR_1_2' | 'RR_1_4';
  evaluationMode?: AiEvaluationMode;
  simulatedEntryTime?: number;
  exitTime?: number;
  durationMs?: number;
  exitPrice?: number;
  mfePrice?: number;
  mfeR?: number;
  maePrice?: number;
  maeR?: number;
  realizedNetR?: number;
  realizedNetPnlUsdt?: number;
  createdAt: number;
  lastStateChangeTimestamp: number;
  consensusResult?: ConsensusResult;
  reason?: string;
}

export const VALID_TRANSITIONS: Record<SignalState, SignalState[]> = {
  OBSERVING: ['SETUP_DETECTED', 'DATA_UNAVAILABLE', 'ERROR', 'CANCELLED'],
  SETUP_DETECTED: ['APPROACHING_ZONE', 'IN_ZONE', 'AI_REVIEW', 'WAITING_CONFIRMATION', 'EXPIRED', 'INVALIDATED', 'CANCELLED', 'DATA_UNAVAILABLE'],
  APPROACHING_ZONE: ['IN_ZONE', 'ALERT_SENT', 'ENTRY_TRIGGERED', 'WAITING_CONFIRMATION', 'AI_REVIEW', 'EXPIRED', 'INVALIDATED', 'CANCELLED', 'DATA_UNAVAILABLE'],
  IN_ZONE: ['WAITING_CONFIRMATION', 'AI_REVIEW', 'ENTRY_VALIDATED', 'ALERT_SENT', 'ENTRY_TRIGGERED', 'EXPIRED', 'INVALIDATED', 'CANCELLED', 'DATA_UNAVAILABLE'],
  WAITING_CONFIRMATION: ['AI_REVIEW', 'ENTRY_VALIDATED', 'ALERT_SENT', 'IN_ZONE', 'EXPIRED', 'INVALIDATED', 'CANCELLED', 'DATA_UNAVAILABLE'],
  AI_REVIEW: ['ENTRY_VALIDATED', 'WAITING_CONFIRMATION', 'INVALIDATED', 'CANCELLED', 'DATA_UNAVAILABLE', 'ERROR'],
  ENTRY_VALIDATED: ['ALERT_SENT', 'APPROACHING_ZONE', 'IN_ZONE', 'ENTRY_TRIGGERED', 'EXPIRED', 'INVALIDATED', 'CANCELLED', 'DATA_UNAVAILABLE'],
  ALERT_SENT: ['APPROACHING_ZONE', 'IN_ZONE', 'ENTRY_TRIGGERED', 'EXPIRED', 'INVALIDATED', 'CANCELLED', 'DATA_UNAVAILABLE'],
  ENTRY_TRIGGERED: ['TRACKING', 'COMPLETED_TP', 'COMPLETED_SL', 'CANCELLED', 'DATA_UNAVAILABLE', 'ERROR'],
  TRACKING: ['COMPLETED_TP', 'COMPLETED_SL', 'CANCELLED', 'DATA_UNAVAILABLE', 'ERROR'],
  COMPLETED_TP: [],
  COMPLETED_SL: [],
  EXPIRED: [],
  INVALIDATED: [],
  CANCELLED: [],
  DATA_UNAVAILABLE: ['OBSERVING', 'SETUP_DETECTED', 'TRACKING', 'CANCELLED', 'ERROR'],
  ERROR: ['CANCELLED', 'OBSERVING'],
};

export class SignalStateMachine extends EventEmitter {
  private signals: Map<string, SignalInstance> = new Map();
  private db: DatabaseService;

  constructor(db: DatabaseService) {
    super();
    this.db = db;
  }

  public registerSignalFromConsensus(consensus: ConsensusResult): SignalInstance {
    const existing = this.signals.get(consensus.signalId);
    if (existing) return existing;

    const riskDistance = Math.abs(consensus.entryPrice - consensus.stopLossPrice);
    const riskUsdt = 100; // Standard 100 USDT reference risk for paper tracking

    const instance: SignalInstance = {
      id: consensus.signalId,
      setupId: consensus.setupId,
      symbol: consensus.symbol,
      strategy: consensus.strategy,
      direction: consensus.direction,
      timeframe: consensus.timeframe,
      entryPrice: consensus.entryPrice,
      stopLossPrice: consensus.stopLossPrice,
      takeProfitPrice: consensus.takeProfitPrice,
      grossRR: consensus.grossRR,
      netRR: consensus.netRR,
      riskUsdt,
      state: consensus.consensusVerdict === 'AUTHORIZED' ? 'ENTRY_VALIDATED' : 'WAITING_CONFIRMATION',
      entryMode: 'EMITTED_SIGNAL',
      evaluationMode: consensus.evaluationMode || 'DUAL_AI',
      mfePrice: consensus.entryPrice,
      mfeR: 0,
      maePrice: consensus.entryPrice,
      maeR: 0,
      createdAt: consensus.timestamp,
      lastStateChangeTimestamp: consensus.timestamp,
      consensusResult: consensus,
    };

    this.signals.set(instance.id, instance);

    this.db.saveSignal({
      id: instance.id,
      setupId: instance.setupId,
      timestamp: instance.createdAt,
      symbol: instance.symbol,
      strategy: instance.strategy,
      direction: instance.direction,
      timeframe: instance.timeframe,
      entryPrice: instance.entryPrice,
      stopLoss: instance.stopLossPrice,
      takeProfit: instance.takeProfitPrice,
      rrNet: instance.netRR,
      consensusVerdict: consensus.consensusVerdict,
      openaiVerdict: consensus.openaiReview?.verdict,
      geminiVerdict: consensus.geminiReview?.verdict,
      status: instance.state,
      rejectionReason: consensus.rejectionReason,
      snapshotId: consensus.snapshotId,
      evaluationMode: instance.evaluationMode,
      createdAt: instance.createdAt,
    });

    this.db.recordSignalTransition({
      signalId: instance.id,
      fromState: 'SETUP_DETECTED',
      toState: instance.state,
      timestamp: instance.lastStateChangeTimestamp,
      reason: `Consenso de IA: ${consensus.consensusVerdict}`,
      metadata: { verdict: consensus.consensusVerdict, confidence: consensus.confidenceScore },
    });

    this.emit('signal_created', instance);
    return instance;
  }

  public registerSignalFromScenario(
    scenario: Scenario,
    currentPrice: number,
    ratioTarget: 'RR_1_2' | 'RR_1_4',
    takeProfitPrice: number,
    netRR: number
  ): SignalInstance {
    const id = `sig_${scenario.id}_${ratioTarget}`;
    const existing = this.signals.get(id);
    if (existing) return existing;

    const riskUsdt = 100; // Standard 100 USDT reference risk for paper tracking
    const instance: SignalInstance = {
      id,
      setupId: scenario.id,
      symbol: scenario.symbol,
      strategy: `AI_DISCOVERY_${scenario.structureType}`,
      direction: scenario.direction as 'LONG' | 'SHORT',
      timeframe: scenario.timeframe,
      entryPrice: currentPrice,
      stopLossPrice: scenario.stopLossPrice,
      takeProfitPrice,
      grossRR: netRR,
      netRR,
      riskUsdt,
      state: 'ENTRY_TRIGGERED',
      entryMode: 'SIMULATED_PAPER_ENTRY',
      rrMode: ratioTarget,
      evaluationMode: 'DUAL_AI',
      simulatedEntryTime: Date.now(),
      mfePrice: currentPrice,
      mfeR: 0,
      maePrice: currentPrice,
      maeR: 0,
      createdAt: Date.now(),
      lastStateChangeTimestamp: Date.now(),
      reason: `Entrada validada por IA y motor cuantitativo para ${ratioTarget}`,
    };

    this.signals.set(instance.id, instance);

    this.db.saveSignal({
      id: instance.id,
      setupId: instance.setupId,
      timestamp: instance.createdAt,
      symbol: instance.symbol,
      strategy: instance.strategy,
      direction: instance.direction,
      timeframe: instance.timeframe,
      entryPrice: instance.entryPrice,
      stopLoss: instance.stopLossPrice,
      takeProfit: instance.takeProfitPrice,
      rrNet: instance.netRR,
      consensusVerdict: 'AUTHORIZED',
      status: instance.state,
      evaluationMode: instance.evaluationMode,
      createdAt: instance.createdAt,
    });

    this.db.recordSignalTransition({
      signalId: instance.id,
      fromState: 'ENTRY_VALIDATED',
      toState: 'ENTRY_TRIGGERED',
      timestamp: instance.lastStateChangeTimestamp,
      reason: `Ejecución paper trading iniciada (${ratioTarget})`,
      metadata: { scenarioId: scenario.id, ratioTarget, currentPrice, netRR },
    });

    // Automatically transition to TRACKING
    this.transition(instance.id, 'TRACKING', `Paper trading tracking en curso para ${ratioTarget}`);

    this.emit('signal_created', instance);
    return instance;
  }

  public canTransition(from: SignalState, to: SignalState): boolean {
    if (from === to) return true;
    const allowed = VALID_TRANSITIONS[from];
    return allowed ? allowed.includes(to) : false;
  }

  public transition(
    signalId: string,
    toState: SignalState,
    reason?: string,
    metadata?: any
  ): SignalInstance {
    const signal = this.signals.get(signalId);
    if (!signal) {
      throw new Error(`Señal con ID ${signalId} no encontrada`);
    }

    if (signal.state === toState) {
      return signal; // Idempotent
    }

    if (!this.canTransition(signal.state, toState)) {
      throw new Error(
        `Transición inválida de estado: de ${signal.state} a ${toState} no está permitida en la máquina de estados`
      );
    }

    const fromState = signal.state;
    const now = Date.now();
    signal.state = toState;
    signal.lastStateChangeTimestamp = now;
    if (reason) signal.reason = reason;

    // State specific updates
    if (toState === 'ENTRY_TRIGGERED') {
      signal.simulatedEntryTime = now;
      signal.entryMode = 'SIMULATED_PAPER_ENTRY';
      signal.mfePrice = signal.entryPrice;
      signal.mfeR = 0;
      signal.maePrice = signal.entryPrice;
      signal.maeR = 0;
    } else if (toState === 'COMPLETED_TP') {
      signal.exitTime = now;
      signal.exitPrice = signal.takeProfitPrice;
      signal.durationMs = signal.simulatedEntryTime ? now - signal.simulatedEntryTime : 0;
      signal.realizedNetR = signal.netRR;
      signal.realizedNetPnlUsdt = parseFloat((signal.riskUsdt * signal.netRR).toFixed(2));
      signal.mfePrice = signal.takeProfitPrice;
      signal.mfeR = signal.netRR;
    } else if (toState === 'COMPLETED_SL') {
      signal.exitTime = now;
      signal.exitPrice = signal.stopLossPrice;
      signal.durationMs = signal.simulatedEntryTime ? now - signal.simulatedEntryTime : 0;
      signal.realizedNetR = -1.0;
      signal.realizedNetPnlUsdt = -signal.riskUsdt;
      signal.maePrice = signal.stopLossPrice;
      signal.maeR = -1.0;
    } else if (toState === 'CANCELLED' || toState === 'EXPIRED' || toState === 'INVALIDATED') {
      if (signal.simulatedEntryTime && !signal.exitTime) {
        signal.exitTime = now;
        signal.durationMs = now - signal.simulatedEntryTime;
      }
    }

    // Persist transition in DB
    this.db.recordSignalTransition({
      signalId,
      fromState,
      toState,
      timestamp: now,
      reason,
      metadata,
    });

    // Update signal row in DB
    this.db.updateSignalMetrics(signalId, {
      status: signal.state,
      simulatedEntryTime: signal.simulatedEntryTime,
      exitTime: signal.exitTime,
      durationMs: signal.durationMs,
      exitPrice: signal.exitPrice,
      mfePrice: signal.mfePrice,
      mfeR: signal.mfeR,
      maePrice: signal.maePrice,
      maeR: signal.maeR,
      realizedNetR: signal.realizedNetR,
      realizedNetPnlUsdt: signal.realizedNetPnlUsdt,
      entryMode: signal.entryMode,
    });

    this.emit('state_changed', { signal, fromState, toState, reason, metadata });

    if (toState === 'COMPLETED_TP' || toState === 'COMPLETED_SL') {
      this.emit('signal_completed', signal);
    } else if (toState === 'INVALIDATED') {
      this.emit('signal_invalidated', signal);
    }

    return signal;
  }

  public updatePriceMetrics(
    signalId: string,
    currentPrice: number,
    highPrice?: number,
    lowPrice?: number
  ): void {
    const signal = this.signals.get(signalId);
    if (!signal || signal.state !== 'TRACKING') return;

    const high = highPrice !== undefined ? highPrice : currentPrice;
    const low = lowPrice !== undefined ? lowPrice : currentPrice;
    const riskDistance = Math.abs(signal.entryPrice - signal.stopLossPrice);
    if (riskDistance <= 0) return;

    if (signal.direction === 'LONG') {
      // MFE: highest price reached
      if (signal.mfePrice === undefined || high > signal.mfePrice) {
        signal.mfePrice = high;
        signal.mfeR = parseFloat(((high - signal.entryPrice) / riskDistance).toFixed(2));
      }
      // MAE: lowest price reached (adverse)
      if (signal.maePrice === undefined || low < signal.maePrice) {
        signal.maePrice = low;
        signal.maeR = parseFloat(((low - signal.entryPrice) / riskDistance).toFixed(2));
      }
    } else {
      // SHORT
      // MFE: lowest price reached
      if (signal.mfePrice === undefined || low < signal.mfePrice) {
        signal.mfePrice = low;
        signal.mfeR = parseFloat(((signal.entryPrice - low) / riskDistance).toFixed(2));
      }
      // MAE: highest price reached (adverse)
      if (signal.maePrice === undefined || high > signal.maePrice) {
        signal.maePrice = high;
        signal.maeR = parseFloat(((signal.entryPrice - high) / riskDistance).toFixed(2));
      }
    }

    if (signal.simulatedEntryTime) {
      signal.durationMs = Date.now() - signal.simulatedEntryTime;
    }

    // Persist live metrics
    this.db.updateSignalMetrics(signalId, {
      durationMs: signal.durationMs,
      mfePrice: signal.mfePrice,
      mfeR: signal.mfeR,
      maePrice: signal.maePrice,
      maeR: signal.maeR,
    });

    this.emit('metrics_updated', signal);
  }

  public recoverActiveSignals(): number {
    try {
      const activeRows = this.db.getActiveSignalsForRecovery();
      let recoveredCount = 0;

      for (const row of activeRows) {
        if (!this.signals.has(row.id)) {
          const instance: SignalInstance = {
            id: row.id,
            setupId: row.setupId,
            symbol: row.symbol,
            strategy: row.strategy,
            direction: row.direction,
            timeframe: row.timeframe,
            entryPrice: row.entryPrice,
            stopLossPrice: row.stopLoss,
            takeProfitPrice: row.takeProfit,
            grossRR: row.rrNet,
            netRR: row.rrNet,
            riskUsdt: 100,
            state: (row.status as SignalState) || 'ENTRY_VALIDATED',
            entryMode: (row.entryMode as EntryMode) || 'EMITTED_SIGNAL',
            evaluationMode: (row.evaluationMode as AiEvaluationMode) || 'DUAL_AI',
            simulatedEntryTime: row.simulatedEntryTime,
            exitTime: row.exitTime,
            durationMs: row.durationMs,
            exitPrice: row.exitPrice,
            mfePrice: row.mfePrice,
            mfeR: row.mfeR,
            maePrice: row.maePrice,
            maeR: row.maeR,
            realizedNetR: row.realizedNetR,
            realizedNetPnlUsdt: row.realizedNetPnlUsdt,
            createdAt: row.createdAt || row.timestamp,
            lastStateChangeTimestamp: row.createdAt || row.timestamp,
          };
          this.signals.set(instance.id, instance);
          recoveredCount++;
        }
      }
      return recoveredCount;
    } catch {
      return 0;
    }
  }

  public getSignal(signalId: string): SignalInstance | undefined {
    return this.signals.get(signalId);
  }

  public getActiveSignals(): SignalInstance[] {
    return Array.from(this.signals.values()).filter(
      (s) => !['COMPLETED_TP', 'COMPLETED_SL', 'EXPIRED', 'INVALIDATED', 'CANCELLED'].includes(s.state)
    );
  }

  public getAllSignals(): SignalInstance[] {
    return Array.from(this.signals.values());
  }

  public cancelSignal(signalId: string, reason: string = 'MANUAL_CANCELLATION'): SignalInstance {
    return this.transition(signalId, 'CANCELLED', reason);
  }

  public cancelAll(reason: string = 'KILL_SWITCH_ACTIVE'): number {
    let count = 0;
    for (const [id, signal] of this.signals.entries()) {
      if (!['COMPLETED_TP', 'COMPLETED_SL', 'EXPIRED', 'INVALIDATED', 'CANCELLED'].includes(signal.state)) {
        try {
          this.transition(id, 'CANCELLED', reason);
          count++;
        } catch {}
      }
    }
    return count;
  }
}
