import type { UsageRecord, UsageRepository } from '../ports/mission-measurements.js';
import type { BoardLaneEventEntry, BoardLaneEventRepository, OperationalHistoryRepository } from '../ports/operation-history.js';
import type { MissionId, MissionStatus } from '../../domain/mission.js';
import type { MissionTransition } from '../../domain/mission-workflow.js';
import type {
  AgentRunMeasurement,
  AgentRole,
  AgentWorkStage,
  Measurement,
  MissionOutcome,
} from '../../domain/usage.js';
import { AGENT_WORK_STAGES } from '../../domain/usage.js';
import type { AgentFamily } from '../../domain/agents.js';
import { agentFamily } from '../../domain/agents.js';
import type { RepositoryId } from '../../domain/repository.js';
import type { BoardMetrics, MetricsProvenance, StatisticsHealth } from './board.js';
import type { AgentAvailabilityRow } from './agent-status.js';
import { buildMetrics } from './metrics.js';
import {
  isCompletedStatisticsRow,
  statisticsMissionKey,
  utcHourBucket,
} from '../services/statistics-service.js';

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
  /** Projection clock — returns ISO timestamp for deterministic `asOf`.
      Defaults to wall-clock `Date.now()`. Tests pin this to a fixed value. */
  readonly clock?: () => string;
  /** Operational history for lifecycle entry timestamps of missions without transitions. */
  readonly historyRepo?: OperationalHistoryRepository;
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

  constructor(options: ConcreteMetricsReadAdapterOptions) {
    this.laneEventRepo = options.laneEventRepo;
    this.usageRepo = options.usageRepo;
    this.repositoryId = options.repositoryId;
    this.clock = options.clock ?? (() => new Date().toISOString());
    this.historyRepo = options.historyRepo;
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
    const outcomeRows = this.usageRecordsToOutcomes(usageRecords, this.repositoryId, entries);
    const transitions = transitionRows.transitions;
    const outcomes = outcomeRows.outcomes;
    const scopedUsageRecords = usageRecords.filter((record) => record.repo === this.repositoryId);

    // Derive instants from transition timestamps
    const instants = this.deriveInstants(transitions, scopedUsageRecords, outcomes);

    // Build lifecycle entry map for missions without transitions
    const lifecycleEntries = await this.deriveLifecycleEntries(initialStates, transitions);

    const metrics = buildMetrics({
      initialStates,
      transitions,
      outcomes,
      instants,
      agentAvailability,
      asOf: this.clock(),
      lifecycleEntries,
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
    return { ...metrics, health, provenance };
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
    return this.usageRecordsToOutcomes(usageRecords, this.repositoryId, entries).outcomes;
  }

  /**
   * Build one `MissionOutcome` per completed mission.
   *
   * Cycle time is the mission's wall-clock lifetime — the span from its first
   * recorded lane event to the event that put it in `done` — not the sum of its
   * agents' execution minutes. Those minutes stay on `runs`, one
   * `AgentRunMeasurement` per usage record, so agent efficiency and
   * delivery-system efficiency can be read as the separate quantities they are.
   *
   * When a mission has no lane events (telemetry imported before lane
   * recording existed), the span falls back to the first and last usage-row
   * dates as a best-effort estimate.
   */
  private usageRecordsToOutcomes(
    records: readonly UsageRecord[],
    repositoryId: RepositoryId,
    entries: readonly BoardLaneEventEntry[],
  ): { readonly outcomes: readonly MissionOutcome[]; readonly rejected: number } {
    // Filter to this repository's records
    const scopedRecords = records.filter(
      (r) => (r.repo ?? '') === repositoryId,
    );
    const lifecycles = missionLifecycles(entries, repositoryId);

    const outcomeMap = new Map<string, {
      missionId: MissionId;
      repositoryId: RepositoryId;
      createdAt: string;
      closedAt: string | null;
      cycleTimeMinutes: number;
      reviewFixRounds: number;
      runs: AgentRunMeasurement[];
    }>();

    let rejected = 0;
    for (const record of scopedRecords) {
      if (!record.mission) {
        rejected += 1;
        continue;
      }
      if (!record.date) {
        continue;
      }
      const key = statisticsMissionKey({ repo: repositoryId, mission: record.mission });
      const existing = outcomeMap.get(key);
      const timestamp = `${record.date}T00:00:00Z`;
      if (existing) {
        // Aggregate multiple records for the same (repo, mission)
        existing.reviewFixRounds = Math.max(existing.reviewFixRounds, record.pr_fix_rounds ?? 0);
        existing.createdAt = existing.createdAt < timestamp ? existing.createdAt : timestamp;
        if (isCompletedStatisticsRow(record)) {
          existing.closedAt = existing.closedAt === null || existing.closedAt < timestamp ? timestamp : existing.closedAt;
        }
        existing.runs.push(usageRecordToRun(record));
      } else {
        outcomeMap.set(key, {
          missionId: record.mission as MissionId,
          repositoryId,
          createdAt: timestamp,
          closedAt: isCompletedStatisticsRow(record) ? timestamp : null,
          cycleTimeMinutes: 0,
          reviewFixRounds: record.pr_fix_rounds ?? 0,
          runs: [usageRecordToRun(record)],
        });
      }
    }

    const outcomes = [...outcomeMap.values()]
      .filter((outcome): outcome is Omit<typeof outcome, 'closedAt'> & { closedAt: string } => outcome.closedAt !== null)
      .map((outcome) => {
        // Lane events are the lifecycle authority, but only when they describe
        // a whole window. Taking the opening from lane events and the closure
        // from a usage date mixes clocks and can invert the span, so a mission
        // whose closure was never recorded as a lane event falls back to usage
        // dates for both ends.
        const lifecycle = lifecycles.get(outcome.missionId);
        const laneWindow = lifecycle !== undefined && lifecycle.closedAt !== null ? lifecycle : null;
        const createdAt = laneWindow?.createdAt ?? outcome.createdAt;
        const closedAt = laneWindow?.closedAt ?? outcome.closedAt;
        return {
          ...outcome,
          createdAt,
          closedAt,
          cycleTimeMinutes: elapsedMinutes(createdAt, closedAt),
          runs: outcome.runs as readonly AgentRunMeasurement[],
        };
      });
    return { outcomes, rejected };
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
    ])].sort();
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

    for (const missionId of missionsWithoutTransitions) {
      // Find earliest history entry for this mission
      const missionEntries = historyEntries
        .filter((entry) => {
          try {
            const data = JSON.parse(entry.eventData);
            return data.missionId === missionId;
          } catch {
            return false;
          }
        })
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

      if (missionEntries.length > 0) {
        entries.set(missionId, missionEntries[0]!.createdAt);
      }
    }

    return entries;
  }
}

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

/** The wall-clock span a mission occupied, read from its lane events. */
interface MissionLifecycle {
  readonly createdAt: string;
  readonly closedAt: string | null;
}

/**
 * Index each mission's lifecycle window: the earliest lane event it has, and
 * the event that moved it to `done`. Both are lane facts, so cycle time never
 * depends on how much telemetry an agent happened to emit.
 */
function missionLifecycles(
  entries: readonly BoardLaneEventEntry[],
  repositoryId: RepositoryId,
): ReadonlyMap<MissionId, MissionLifecycle> {
  const lifecycles = new Map<MissionId, { createdAt: string; closedAt: string | null }>();
  for (const entry of entries) {
    if (!entry.missionId || !entry.occurredAt || entry.repositoryId !== repositoryId) {
      continue;
    }
    const id = entry.missionId as MissionId;
    const existing = lifecycles.get(id);
    const closedAt = entry.toStatus === 'done' ? entry.occurredAt : null;
    if (!existing) {
      lifecycles.set(id, { createdAt: entry.occurredAt, closedAt });
      continue;
    }
    if (entry.occurredAt < existing.createdAt) {
      existing.createdAt = entry.occurredAt;
    }
    // A mission can be reopened and closed again; the last closure wins.
    if (closedAt !== null && (existing.closedAt === null || closedAt > existing.closedAt)) {
      existing.closedAt = closedAt;
    }
  }
  return lifecycles;
}

/** Whole minutes between two ISO instants, never negative. */
function elapsedMinutes(from: string, to: string): number {
  const start = Date.parse(from);
  const end = Date.parse(to);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return 0;
  }
  return Math.round((end - start) / 60000);
}

function measured<T>(value: T): Measurement<T> {
  return { kind: 'measured', value };
}

/** An absent column is unavailable, never a fabricated zero. */
function optional<T>(value: T | undefined | null, column: string): Measurement<T> {
  return value === undefined || value === null
    ? { kind: 'unavailable', reason: `${column} missing on usage record` }
    : measured(value);
}

function runStage(stage: string | undefined): AgentWorkStage {
  const candidate = (stage ?? '').trim();
  return (AGENT_WORK_STAGES as readonly string[]).includes(candidate)
    ? candidate as AgentWorkStage
    : 'default';
}

/** Review-stage work is the reviewer's; everything else is the implementer's. */
function runRole(stage: AgentWorkStage): AgentRole {
  return stage === 'review' ? 'reviewer' : 'implementer';
}

/** Usage rows carry free-text agent names; unparseable ones become `unknown`. */
function toAgentFamily(value: string | undefined): AgentFamily {
  try {
    return agentFamily((value ?? '').toLowerCase());
  } catch {
    return agentFamily('unknown');
  }
}

/** Map one usage row to the run measurement it records. */
function usageRecordToRun(record: UsageRecord): AgentRunMeasurement {
  const stage = runStage(record.stage);
  const role = runRole(stage);
  const agent = role === 'reviewer'
    ? record.reviewer_agent ?? record.implementer_agent ?? record.implementer
    : record.implementer_agent ?? record.implementer;
  return {
    recordedOn: record.date ?? '',
    stage,
    role,
    agent: toAgentFamily(agent),
    runtime: {
      provider: optional(record.provider, 'provider'),
      model: optional(record.model, 'model'),
    },
    durationMinutes: optional(record.duration_minutes, 'duration_minutes'),
    tokens: {
      input: optional(record.input_tokens, 'input_tokens'),
      output: optional(record.output_tokens, 'output_tokens'),
      cached: optional(record.cached_tokens, 'cached_tokens'),
      context: optional(record.context_tokens, 'context_tokens'),
    },
    toolCalls: optional(record.tool_calls, 'tool_calls'),
    providerUsage: {
      beforePercent: optional(record.openai_usage_before, 'openai_usage_before'),
      afterPercent: optional(record.openai_usage_after, 'openai_usage_after'),
      deltaPercent: optional(record.openai_usage_delta, 'openai_usage_delta'),
    },
    costUsd: optional(record.cost_usd, 'cost_usd'),
  };
}

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
