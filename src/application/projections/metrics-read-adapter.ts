import { usageRecordsToOutcomes } from './metrics-outcomes.js';
import type { UsageRecord, UsageRepository } from '../ports/mission-measurements.js';
import type { BoardLaneEventEntry, BoardLaneEventRepository, OperationalHistoryRepository } from '../ports/operation-history.js';
import type { Mission, MissionId, MissionLabel, MissionStatus } from '../../domain/mission.js';

import { compareCodeUnits } from '../../domain/comparators.js';
import type { MissionTransition } from '../../domain/mission-workflow.js';
import type { MissionOutcome } from '../../domain/usage.js';

import type { AgentFamily } from '../../domain/agents.js';
import { agentFamily } from '../../domain/agents.js';
import type { RepositoryId } from '../../domain/repository.js';
import type { BoardMetrics, MetricsProvenance, StatisticsHealth } from './board.js';
import type { AgentAvailabilityRow } from './agent-status.js';
import { buildMetrics } from './metrics.js';
import { compareCohorts, type CohortDimension } from './cohorts.js';
import { utcHourBucket } from '../services/statistics-service.js';
import { weeklyDecisionWindows } from '../../domain/decision-window.js';

/** Delivery belongs to the recorded final review implementer, never an attempt. */
export function missionCohortMetadata(missions: readonly Mission[]) {
  return new Map(missions.map(mission => {
    const finalImplementer = mission.review?.rounds.at(-1)?.implementer;
    return [mission.id, { labels: mission.labels,
      assignee: finalImplementer ? agentFamily(finalImplementer) : mission.assignee }] as const;
  }));
}

// ---------------------------------------------------------------------------
// MetricsReadAdapter — derives BoardMetrics from event history
// ---------------------------------------------------------------------------

/**
 * Application port that derives time-based board metrics from recorded
 * lane-transition events and usage statistics.
 *
 * Replaces the optional _options.metrics pattern so metrics are always
 * computed from actual data rather than falling back to empty defaults.
 */
export interface MetricsReadAdapter {
  /** Canonical first-DONE delivery outcomes; absent means history is unavailable. */
  readOutcomes?(): Promise<readonly MissionOutcome[]>;
  /**
   * Build metrics from the current event history.
   * @param initialStates — current mission statuses (from MissionReadAdapter)
   */
  buildMetrics(_initialStates: ReadonlyMap<MissionId, MissionStatus>, _agentAvailability?: readonly AgentAvailabilityRow[]): Promise<BoardMetrics>;
}

// ---------------------------------------------------------------------------
// Concrete implementation — reads board_lane_events + usage_statistics
// ---------------------------------------------------------------------------

export interface ConcreteMetricsReadAdapterOptions {
  readonly laneEventRepo: BoardLaneEventRepository;
  readonly usageRepo: UsageRepository;
  /** Repository this projection is scoped to. Lane events and usage records
      for other repositories are excluded. */
  readonly repositoryId: RepositoryId;
  /** Projection clock — returns ISO timestamp for deterministic `asOf`.
      Defaults to wall-clock `Date.now()`. Tests pin this to a fixed value. */
  readonly clock?: () => string;
  /** Operational history for lifecycle entry timestamps of missions without transitions. */
  readonly historyRepo?: OperationalHistoryRepository;
  /**
   * The experiment dimension the board's cohort comparison slices on.
   * Defaults to `label`, the dimension the mission board already carries.
   */
  readonly cohortDimension?: CohortDimension;
  /**
   * Net engineering lines per mission, read by the caller from `ClosedMission`
   * data. Called once per projection build. Absent when the composition has no
   * mission adapter; the cohort then reports no NEL rather than a fabricated
   * one.
   */
  readonly netEngineeringLines?: () => Promise<ReadonlyMap<MissionId, number | null>>;
  /** Canonical Mission metadata for cohort labels and implementers. */
  readonly cohortMetadata?: () => Promise<ReadonlyMap<MissionId, { readonly labels: readonly MissionLabel[]; readonly assignee: AgentFamily | null }>>;
}

/**
 * Concrete `MetricsReadAdapter` that reads from `BoardLaneEventRepository`
 * and `UsageRepository`, converts their rows to domain types, and feeds
 * them into `buildMetrics()`.
 */
export class ConcreteMetricsReadAdapter implements MetricsReadAdapter {
  private readonly laneEventRepo: BoardLaneEventRepository;
  private readonly usageRepo: UsageRepository;
  private readonly repositoryId: RepositoryId;
  private readonly clock: () => string;
  private readonly historyRepo: OperationalHistoryRepository | undefined;
  private readonly cohortDimension: CohortDimension;
  private readonly netEngineeringLines: () => Promise<ReadonlyMap<MissionId, number | null>>;
  private readonly cohortMetadata: () => Promise<ReadonlyMap<MissionId, { readonly labels: readonly MissionLabel[]; readonly assignee: AgentFamily | null }>>;

  constructor(options: ConcreteMetricsReadAdapterOptions) {
    this.laneEventRepo = options.laneEventRepo;
    this.usageRepo = options.usageRepo;
    this.repositoryId = options.repositoryId;
    this.clock = options.clock ?? (() => new Date().toISOString());
    this.historyRepo = options.historyRepo;
    this.cohortDimension = options.cohortDimension ?? 'label';
    this.netEngineeringLines = options.netEngineeringLines ?? (async () => new Map());
    this.cohortMetadata = options.cohortMetadata ?? (async () => new Map());
  }

  async buildMetrics(
    initialStates: ReadonlyMap<MissionId, MissionStatus>,
    agentAvailability: readonly AgentAvailabilityRow[] = [],
  ): Promise<BoardMetrics> {
    const [entries, usageRecords] = await Promise.all([
      this.laneEventRepo.findByRepositoryId(this.repositoryId),
      this.usageRepo.findAll(),
    ]);

    const transitionRows = this.entriesToTransitions(entries);
    const outcomeRows = usageRecordsToOutcomes(usageRecords, this.repositoryId, entries);
    const transitions = transitionRows.transitions;
    const outcomes = this.withCanonicalCohortMetadata(outcomeRows.outcomes, await this.cohortMetadata());
    const scopedUsageRecords = usageRecords.filter((record) => record.repo === this.repositoryId);

    // Derive instants from transition timestamps
    const instants = this.deriveInstants(transitions, scopedUsageRecords, outcomes);

    // Build lifecycle entry map for missions without transitions
    const lifecycleEntries = await this.deriveLifecycleEntries(initialStates, transitions);

    // One clock reading feeds both the `asOf` of the current-state metrics and
    // the rolling decision windows, so the board cannot report a window that
    // disagrees with the instant it was evaluated at.
    const asOf = this.clock();
    const decisionWindows = weeklyDecisionWindows(asOf);
    const metrics = buildMetrics({
      initialStates,
      transitions,
      outcomes,
      instants,
      agentAvailability,
      asOf,
      lifecycleEntries,
      decisionWindows,
    });
    const timestamps = this.eventTimestamps(entries, scopedUsageRecords);
    const rejectedOrMissingIdentityRowCount = transitionRows.rejected + outcomeRows.rejected;
    const completedMissions = [...initialStates.values()].filter((status) => status === 'done').length;
    const health: StatisticsHealth = {
      state: rejectedOrMissingIdentityRowCount > 0 ? 'partial'
        : timestamps.length === 0 && completedMissions > 0 ? 'pre-lifecycle'
          : timestamps.length === 0 ? 'no-telemetry'
            : outcomes.length === 0 ? 'no-completions' : 'healthy',
    };
    const provenance: MetricsProvenance = {
      repositoryId: this.repositoryId,
      evaluatedWindow: { startedAt: timestamps[0] ?? null, endedAt: timestamps.at(-1) ?? null },
      sampleSize: outcomes.length,
      newestEventTimestamp: timestamps.at(-1) ?? null,
      rejectedOrMissingIdentityRowCount,
      adapterSucceeded: true,
    };
    const cohorts = compareCohorts({
      outcomes,
      transitions,
      dimension: this.cohortDimension,
      netEngineeringLines: await this.netEngineeringLines(),
      window: decisionWindows.current,
    });
    return { ...metrics, health, provenance, cohorts };
  }

  // -----------------------------------------------------------------------
  // board_lane_events → MissionTransition[]
  // -----------------------------------------------------------------------

  private entriesToTransitions(
    entries: readonly BoardLaneEventEntry[],
  ): { readonly transitions: readonly MissionTransition[]; readonly rejected: number } {
    const mapped = entries.map((entry) => entryToMissionTransition(entry));
    return { transitions: mapped.filter((t): t is MissionTransition => t !== null), rejected: mapped.filter((t) => t === null).length };
  }

  // -----------------------------------------------------------------------
  // usage_statistics → MissionOutcome[]
  // -----------------------------------------------------------------------

  /**
   * The completed-mission outcomes this projection derives, exposed so callers
   * (and tests) can assert the lifecycle/runtime split directly rather than
   * only through the aggregated metric series.
   */
  async readOutcomes(): Promise<readonly MissionOutcome[]> {
    const [entries, usageRecords] = await Promise.all([
      this.laneEventRepo.findByRepositoryId(this.repositoryId),
      this.usageRepo.findAll(),
    ]);
    return this.withCanonicalCohortMetadata(
      usageRecordsToOutcomes(usageRecords, this.repositoryId, entries).outcomes,
      await this.cohortMetadata(),
    );
  }

  private withCanonicalCohortMetadata(
    outcomes: readonly MissionOutcome[],
    metadata: ReadonlyMap<MissionId, { readonly labels: readonly MissionLabel[]; readonly assignee: AgentFamily | null }>,
  ): readonly MissionOutcome[] {
    return outcomes.map((outcome) => {
      const canonical = metadata.get(outcome.missionId);
      return canonical === undefined
        ? outcome
        : { ...outcome, labels: canonical.labels, implementer: canonical.assignee };
    });
  }

  // -----------------------------------------------------------------------
  // Derive evaluation instants from event timestamps
  // -----------------------------------------------------------------------

  private deriveInstants(
    transitions: readonly MissionTransition[],
    usageRecords: readonly UsageRecord[],
    outcomes: readonly MissionOutcome[] = [],
  ): readonly string[] {
    const seen = new Set<string>();

    // Add transition timestamps normalized to UTC-hour granularity.
    for (const t of transitions) {
      const hour = utcHourBucket(t.occurredAt);
      if (hour !== null) { seen.add(hour); }
    }

    // Add usage record dates
    for (const r of usageRecords) {
      if (r.date) {
        seen.add(r.date + 'T00:00:00Z');
      }
    }

    // Add each closure instant exactly. Truncating a closure to its hour would
    // place it before the outcome it closes, so the mission would be missing
    // from the very series that reports its cycle time.
    for (const outcome of outcomes) {
      seen.add(outcome.closedAt);
    }

    // If no instants, use a single now() so metrics are never empty
    if (seen.size === 0) {
      return [new Date().toISOString()];
    }

    // Closure instants stay exact so a completion appears in the point that
    // closes it; only event timestamps above are UTC-hour bucketed.
    return [...seen].sort((left, right) => left.localeCompare(right));
  }

  private eventTimestamps(entries: readonly BoardLaneEventEntry[], usageRecords: readonly UsageRecord[]): readonly string[] {
    return [...new Set([
      ...entries.map((entry) => entry.occurredAt).filter(Boolean),
      ...usageRecords.filter((record) => record.date).map((record) => `${record.date}T00:00:00Z`),
    ])].sort(compareCodeUnits);
  }

  // -----------------------------------------------------------------------
  // Derive lifecycle entry timestamps for missions without transitions
  // -----------------------------------------------------------------------

  private async deriveLifecycleEntries(
    initialStates: ReadonlyMap<MissionId, MissionStatus>,
    transitions: readonly MissionTransition[],
  ): Promise<Map<MissionId, string>> {
    if (!this.historyRepo) {
      return new Map();
    }
    // Find missions with no transitions
    const missionIdsWithTransitions = new Set(transitions.map((t) => t.missionId));
    const missionsWithoutTransitions = [...initialStates.keys()].filter(
      (id) => !missionIdsWithTransitions.has(id),
    );

    if (missionsWithoutTransitions.length === 0) {
      return new Map();
    }

    // Query operational history for entry timestamps
    const historyEntries = await this.historyRepo.findAll();
    const entries = new Map<MissionId, string>();

    const wanted = new Set(missionsWithoutTransitions);
    // Index once: parsing every history row again for every legacy mission
    // makes a cold board proportional to missions times all operational events.
    for (const entry of historyEntries) {
      try {
        const data = JSON.parse(entry.eventData) as { missionId?: MissionId; repositoryId?: string };
        if (data.repositoryId !== this.repositoryId || !data.missionId || !wanted.has(data.missionId)) { continue; }
        const earliest = entries.get(data.missionId);
        if (earliest === undefined || entry.createdAt.localeCompare(earliest) < 0) {
          entries.set(data.missionId, entry.createdAt);
        }
      } catch { /* Malformed history cannot establish a lifecycle entry. */ }
    }

    return entries;
  }
}

/** Convert a BoardLaneEventEntry row to a MissionTransition. */
function entryToMissionTransition(
  entry: BoardLaneEventEntry,
): MissionTransition | null {
  if (!entry.missionId || !entry.toStatus || !entry.trigger || !Number.isFinite(Date.parse(entry.occurredAt))) {
    return null;
  }
  return {
    missionId: entry.missionId as MissionId,
    // A persisted NULL `from_status` is the mission's intake. Carry it through
    // as null; collapsing it onto `to` would erase the only record of when the
    // mission first existed.
    from: (entry.fromStatus ?? null) as MissionStatus | null,
    to: entry.toStatus as MissionStatus,
    trigger: entry.trigger as MissionTransition['trigger'],
    actor: entry.agent,
    occurredAt: new Date(entry.occurredAt).toISOString(),
  };
}
