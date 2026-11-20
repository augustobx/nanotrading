import { EventEmitter } from 'events';
import { DatabaseService } from '../storage/database.js';
import {
  Scenario,
  ScenarioLifecycleEvent,
  ScenarioStatus,
  ScenarioRRMode,
} from '../ai/scenario-types.js';

export class ScenarioRegistry extends EventEmitter {
  private scenarios: Map<string, Scenario> = new Map();
  private db: DatabaseService;

  constructor(db: DatabaseService) {
    super();
    this.db = db;
    this.loadFromDatabase();
  }

  private loadFromDatabase(): void {
    const active = this.db.getScenarios({
      status: [
        'SCENARIO_PROPOSED',
        'SCENARIO_REGISTERED',
        'SCENARIO_MONITORING',
        'APPROACHING_ZONE',
        'IN_ZONE',
        'REVALIDATION_REQUESTED',
        'AI_REVALIDATING',
        'ENTRY_VALIDATED',
      ],
      limit: 100,
    });
    for (const sc of active) {
      this.scenarios.set(sc.id, sc);
    }
  }

  public registerScenario(scenario: Scenario): Scenario {
    // Check for similar active scenario to group / avoid duplicates
    const existing = this.findSimilarScenario(scenario);
    if (existing) {
      // Merge models and interpretations
      const updatedModels = Array.from(new Set([...existing.modelsUsed, ...scenario.modelsUsed]));
      const updated: Scenario = {
        ...existing,
        modelsUsed: updatedModels,
        proposedBy: existing.proposedBy !== scenario.proposedBy ? 'CONSENSUS' : existing.proposedBy,
        openaiInterpretation: scenario.openaiInterpretation || existing.openaiInterpretation,
        geminiInterpretation: scenario.geminiInterpretation || existing.geminiInterpretation,
        argumentsFor: Array.from(new Set([...existing.argumentsFor, ...scenario.argumentsFor])),
        argumentsAgainst: Array.from(new Set([...existing.argumentsAgainst, ...scenario.argumentsAgainst])),
        updatedAt: Date.now(),
      };
      this.scenarios.set(existing.id, updated);
      this.db.saveScenario(updated);
      this.emit('scenario_updated', updated);
      return updated;
    }

    this.scenarios.set(scenario.id, scenario);
    this.db.saveScenario(scenario);
    this.logLifecycle({
      scenarioId: scenario.id,
      fromStatus: 'SCENARIO_PROPOSED',
      toStatus: scenario.status,
      timestamp: Date.now(),
      reason: 'Registro inicial de escenario descubierto por IA',
    });

    this.emit('scenario_registered', scenario);
    return scenario;
  }

  public getScenario(id: string): Scenario | null {
    const mem = this.scenarios.get(id);
    if (mem) return mem;
    return this.db.getScenarioById(id);
  }

  public getAllActive(): Scenario[] {
    return Array.from(this.scenarios.values());
  }

  public getAll(options?: { status?: ScenarioStatus | ScenarioStatus[]; rrMode?: ScenarioRRMode; limit?: number }): Scenario[] {
    const list = this.db.getScenarios({ status: options?.status, limit: options?.limit });
    if (options?.rrMode && options.rrMode !== 'NONE') {
      return list.filter((s) => s.rrModeAvailable === options.rrMode || s.rrModeAvailable === 'RR_BOTH');
    }
    return list;
  }

  public transitionStatus(
    id: string,
    toStatus: ScenarioStatus,
    reason?: string,
    metadata?: Record<string, any>
  ): Scenario | null {
    const scenario = this.scenarios.get(id) || this.db.getScenarioById(id);
    if (!scenario) return null;

    const fromStatus = scenario.status;
    if (fromStatus === toStatus) return scenario;

    const updated: Scenario = {
      ...scenario,
      status: toStatus,
      rejectionReason: reason ?? scenario.rejectionReason,
      updatedAt: Date.now(),
      ...(metadata?.currentPrice ? { currentPrice: metadata.currentPrice } : {}),
      ...(metadata?.distanceToZonePct !== undefined ? { distanceToZonePct: metadata.distanceToZonePct } : {}),
    };

    if (updated.watchPlan) {
      if (toStatus === 'ENTRY_VALIDATED') updated.watchPlan.status = 'ENTRY_VALIDATED';
      else if (toStatus === 'INVALIDATED') updated.watchPlan.status = 'INVALIDATED';
      else if (toStatus === 'EXPIRED') updated.watchPlan.status = 'EXPIRED';
      else if (toStatus === 'CANCELLED') updated.watchPlan.status = 'CANCELLED';
      else if (toStatus === 'IN_ZONE' || toStatus === 'REVALIDATION_REQUESTED') updated.watchPlan.status = 'TRIGGERED';
      else if (toStatus === 'AI_REVALIDATING') updated.watchPlan.status = 'REVALIDATING';
      this.db.saveWatchPlan(updated.watchPlan);
    }

    // If final status, remove from active map
    if (['INVALIDATED', 'EXPIRED', 'CANCELLED', 'SIGNAL_GENERATED'].includes(toStatus)) {
      this.scenarios.delete(id);
    } else {
      this.scenarios.set(id, updated);
    }

    this.db.updateScenarioStatus(id, toStatus, reason, updated);
    this.logLifecycle({
      scenarioId: id,
      fromStatus,
      toStatus,
      timestamp: Date.now(),
      reason,
      metadata,
    });

    this.emit('scenario_status_changed', {
      scenario: updated,
      fromStatus,
      toStatus,
      reason,
      metadata,
    });

    return updated;
  }

  public updateMetrics(id: string, updates: Partial<Scenario>): Scenario | null {
    const sc = this.scenarios.get(id) || this.db.getScenarioById(id);
    if (!sc) return null;

    const updated: Scenario = {
      ...sc,
      ...updates,
      updatedAt: Date.now(),
    };
    this.scenarios.set(id, updated);
    this.db.saveScenario(updated);
    this.emit('scenario_updated', updated);
    return updated;
  }

  public logLifecycle(event: ScenarioLifecycleEvent): void {
    this.db.logScenarioLifecycle(event);
    this.emit('scenario_lifecycle', event);
  }

  public getLifecycle(scenarioId: string): ScenarioLifecycleEvent[] {
    return this.db.getScenarioLifecycle(scenarioId);
  }

  private findSimilarScenario(candidate: Scenario): Scenario | null {
    for (const sc of this.scenarios.values()) {
      if (
        sc.symbol === candidate.symbol &&
        sc.direction === candidate.direction &&
        sc.status !== 'INVALIDATED' &&
        sc.status !== 'EXPIRED' &&
        sc.status !== 'CANCELLED'
      ) {
        // Overlap in entry zones (within 0.5%)
        const avgEntryA = (sc.entryZoneMin + sc.entryZoneMax) / 2;
        const avgEntryB = (candidate.entryZoneMin + candidate.entryZoneMax) / 2;
        const diffPct = Math.abs(avgEntryA - avgEntryB) / avgEntryA;
        if (diffPct < 0.005) {
          return sc;
        }
      }
    }
    return null;
  }
}
