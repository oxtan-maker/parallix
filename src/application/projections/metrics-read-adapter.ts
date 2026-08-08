import type { UsageRecord, UsageRepository } from '../ports/mission-measurements.js';
import type { BoardLaneEventEntry, BoardLaneEventRepository } from '../ports/operation-history.js';
import type { MissionId, MissionStatus } from '../../domain/mission.js';
import type { MissionTransition } from '../../domain/mission-workflow.js';
import type { MissionOutcome } from '../../domain/usage.js';
import type { RepositoryId } from '../../domain/repository.js';
import type { BoardMetrics } from './board.js';
import type { AgentAvailabilityRow } from './agent-status.js';
import { buildMetrics } from './metrics.js';

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

  constructor(options: ConcreteMetricsReadAdapterOptions) {
    this.laneEventRepo = options.laneEventRepo;
    this.usageRepo = options.usageRepo;
    this.repositoryId = options.repositoryId;
  }

  async buildMetrics(
    initialStates: ReadonlyMap<MissionId, MissionStatus>,
    agentAvailability: readonly AgentAvailabilityRow[] = [],
  ): Promise<BoardMetrics> {
    const [entries, usageRecords] = await Promise.all([
      this.laneEventRepo.findByRepositoryId(this.repositoryId),
      this.usageRepo.findAll(),
    ]);

    const transitions = this.entriesToTransitions(entries);
    const outcomes = this.usageRecordsToOutcomes(usageRecords, this.repositoryId);

    // Derive instants from transition timestamps
    const instants = this.deriveInstants(transitions, usageRecords);

    return buildMetrics({
      initialStates,
      transitions,
      outcomes,
      instants,
      agentAvailability,
      asOf: instants.at(-1),
    });
  }

  // -----------------------------------------------------------------------
  // board_lane_events → MissionTransition[]
  // -----------------------------------------------------------------------

  private entriesToTransitions(
    entries: readonly BoardLaneEventEntry[],
  ): readonly MissionTransition[] {
    return entries
      .map((entry) => entryToMissionTransition(entry))
      .filter((t): t is MissionTransition => t !== null);
  }

  // -----------------------------------------------------------------------
  // usage_statistics → MissionOutcome[]
  // -----------------------------------------------------------------------

  private usageRecordsToOutcomes(
    records: readonly UsageRecord[],
    repositoryId: RepositoryId,
  ): readonly MissionOutcome[] {
    // Filter to this repository's records
    const scopedRecords = records.filter(
      (r) => (r.repo ?? '') === repositoryId,
    );

    const outcomeMap = new Map<string, {
      missionId: MissionId;
      repositoryId: RepositoryId;
      cycleTimeMinutes: number;
      reviewFixRounds: number;
    }>();

    for (const record of scopedRecords) {
      if (!record.mission) {
        continue;
      }
      // Key by (repository, mission) so same mission slug in different repos
      // does not collide. Precedent: statsMissionKey in stats.ts:438.
      const key = `${repositoryId}::${record.mission}`;
      const existing = outcomeMap.get(key);
      if (existing) {
        // Aggregate multiple records for the same (repo, mission)
        existing.cycleTimeMinutes = existing.cycleTimeMinutes + (record.duration_minutes ?? 0);
        existing.reviewFixRounds = Math.max(existing.reviewFixRounds, record.pr_fix_rounds ?? 0);
      } else {
        outcomeMap.set(key, {
          missionId: record.mission as MissionId,
          repositoryId,
          cycleTimeMinutes: record.duration_minutes ?? 0,
          reviewFixRounds: record.pr_fix_rounds ?? 0,
        });
      }
    }

    return [...outcomeMap.values()].map((o) => ({
      ...o,
      runs: [],
    }));
  }

  // -----------------------------------------------------------------------
  // Derive evaluation instants from event timestamps
  // -----------------------------------------------------------------------

  private deriveInstants(
    transitions: readonly MissionTransition[],
    usageRecords: readonly UsageRecord[],
  ): readonly string[] {
    const seen = new Set<string>();

    // Add transition timestamps (truncated to hour for granularity)
    for (const t of transitions) {
      const hour = t.occurredAt.slice(0, 13); // "2026-07-24T08"
      seen.add(hour + ':00:00Z');
    }

    // Add usage record dates
    for (const r of usageRecords) {
      if (r.date) {
        seen.add(r.date + 'T00:00:00Z');
      }
    }

    // If no instants, use a single now() so metrics are never empty
    if (seen.size === 0) {
      return [new Date().toISOString()];
    }

    return [...seen].sort();
  }
}

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

/** Convert a BoardLaneEventEntry row to a MissionTransition. */
function entryToMissionTransition(
  entry: BoardLaneEventEntry,
): MissionTransition | null {
  if (!entry.missionId || !entry.toStatus || !entry.trigger) {
    return null;
  }
  return {
    missionId: entry.missionId as MissionId,
    from: (entry.fromStatus ?? entry.toStatus) as MissionStatus,
    to: entry.toStatus as MissionStatus,
    trigger: entry.trigger as MissionTransition['trigger'],
    actor: entry.agent,
    occurredAt: entry.occurredAt,
  };
}
