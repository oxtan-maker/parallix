import type { UsageRecord } from '../ports/mission-measurements.js';

import type { BoardLaneEventEntry } from '../ports/operation-history.js';

import type { MissionId, MissionLabel } from '../../domain/mission.js';

import { missionLabels } from '../../domain/mission.js';

import type {
  AgentRunMeasurement,
  AgentRole,
  AgentWorkStage,
  Measurement,
  MissionOutcome,
} from '../../domain/usage.js';

import {
  AGENT_WORK_STAGES,
  modelInvolvement,
  sumMeasured,
  totalInputAndOutputTokens,
} from '../../domain/usage.js';

import type { AgentFamily } from '../../domain/agents.js';

import { agentFamily } from '../../domain/agents.js';

import type { RepositoryId } from '../../domain/repository.js';

import { statisticsMissionKey } from '../services/statistics-service.js';

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
export function usageRecordsToOutcomes(
  records: readonly UsageRecord[],
  repositoryId: RepositoryId,
  entries: readonly BoardLaneEventEntry[],
): { readonly outcomes: readonly MissionOutcome[]; readonly rejected: number } {
  // Filter to this repository's records
  const scopedRecords = records.filter(
    (r) => (r.repo ?? '') === repositoryId,
  );
  const lifecycles = missionLifecycles(entries, repositoryId);

  const outcomeMap = new Map<string, OutcomeAccumulator>()

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
      // A NULL row carries no observation, so it never contributes to the
      // mission's maximum — otherwise `Math.max(-1, null)` would turn two
      // unknown rows into a measured zero (TASK-2369 Part D carry-forward).
      existing.reviewFixRounds = record.pr_fix_rounds === null || record.pr_fix_rounds === undefined
        ? existing.reviewFixRounds
        : Math.max(existing.reviewFixRounds ?? -1, record.pr_fix_rounds);
      existing.createdAt = existing.createdAt < timestamp ? existing.createdAt : timestamp;
      existing.labelValues.push(...recordLabelValues(record));
      existing.runs.push(usageRecordToRun(record));
    } else {
      outcomeMap.set(key, {
        missionId: record.mission as MissionId,
        repositoryId,
        createdAt: timestamp,
        closedAt: null,
        cycleTimeMinutes: 0,
        reviewFixRounds: record.pr_fix_rounds ?? null,
        labelValues: [...recordLabelValues(record)],
        runs: [usageRecordToRun(record)],
      });
    }
  }

  return { outcomes: outcomesFromLifecycle(outcomeMap, lifecycles, repositoryId), rejected };
}

function outcomesFromLifecycle(outcomeMap: ReadonlyMap<string, OutcomeAccumulator>, lifecycles: ReadonlyMap<MissionId, MissionLifecycle>, repositoryId: RepositoryId): MissionOutcome[] {
  const outcomes: MissionOutcome[] = [];
  // Lifecycle is the delivery authority. A mission that reaches `done`
  // counts even when no agent emitted telemetry; telemetry cannot complete a
  // mission whose lifecycle exists but has not reached done.
  const missionIds = new Set<MissionId>([
    ...[...outcomeMap.values()].map((outcome) => outcome.missionId),
    ...lifecycles.keys(),
  ]);
  for (const missionId of missionIds) {
    const outcome = outcomeMap.get(statisticsMissionKey({ repo: repositoryId, mission: missionId }));
    const lifecycle = lifecycles.get(missionId);
    const completedAt = lifecycle?.completedAt ?? null;
    if (completedAt === null) { continue; }
    if (!outcome) {
      outcomes.push({
        missionId,
        repositoryId,
        createdAt: lifecycle!.createdAt,
        closedAt: completedAt,
        cycleTimeMinutes: elapsedMinutes(lifecycle!.createdAt, completedAt),
        reviewFixRounds: null,
        labels: [],
        implementer: null,
        modelsInvolved: [],
        totalInputAndOutputTokens: null,
        totalCostUsd: null,
        totalToolCalls: null,
        runs: [],
      });
      continue;
    }
    // Lane events are the lifecycle authority, but only when they describe
    // a whole window. Taking the opening from lane events and the closure
    // from a usage date mixes clocks and can invert the span, so a mission
    // whose closure was never recorded as a lane event falls back to usage
    // dates for both ends.
    const laneWindow = lifecycle !== undefined && lifecycle.completedAt !== null ? lifecycle : null;
    const createdAt = laneWindow?.createdAt ?? outcome.createdAt;
    const closedAt = laneWindow?.completedAt ?? completedAt;
    const runs = outcome.runs;
    const { labelValues: _labelValues, ...identity } = outcome;
    outcomes.push({
      ...identity,
      createdAt,
      closedAt,
      cycleTimeMinutes: elapsedMinutes(createdAt, closedAt),
      labels: outcomeLabels(outcome.labelValues),
      implementer: null,
      modelsInvolved: modelInvolvement(runs),
      totalInputAndOutputTokens: totalInputAndOutputTokens(runs),
      totalCostUsd: sumMeasured(runs.map((run) => run.costUsd)),
      totalToolCalls: sumMeasured(runs.map((run) => run.toolCalls)),
      runs,
    });
  }
  return outcomes;
}

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

/** The wall-clock span a mission occupied, read from its lane events. */
interface MissionLifecycle {
  readonly createdAt: string;
  readonly completedAt: string | null;
}

/**
 * Index each mission's lifecycle window: the earliest lane event it has, and
 * the first event that moved it to `done`. Both are lane facts, so cycle time never
 * depends on how much telemetry an agent happened to emit.
 */
function missionLifecycles(
  entries: readonly BoardLaneEventEntry[],
  repositoryId: RepositoryId,
): ReadonlyMap<MissionId, MissionLifecycle> {
  const lifecycles = new Map<MissionId, { createdAt: string; completedAt: string | null }>();
  for (const entry of [...entries].sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt))) {
    if (!entry.missionId || !Number.isFinite(Date.parse(entry.occurredAt)) || entry.repositoryId !== repositoryId) {
      continue;
    }
    const occurredAt = new Date(entry.occurredAt).toISOString();
    const id = entry.missionId as MissionId;
    const existing = lifecycles.get(id);
    const completedAt = entry.fromStatus !== 'done' && entry.toStatus === 'done'
      ? occurredAt
      : null;
    if (!existing) {
      lifecycles.set(id, { createdAt: occurredAt, completedAt });
      continue;
    }
    if (occurredAt < existing.createdAt) {
      existing.createdAt = occurredAt;
    }
    // Administrative close and a later reopen never move delivery completion.
    if (completedAt !== null && existing.completedAt === null) {
      existing.completedAt = completedAt;
    }
  }
  return lifecycles;
}

/**
 * The mission labels a usage row carries. `classification` is where the board's
 * label dimension (`ai_sdlc`, `user_value`, …) reaches telemetry, so it is the
 * label source; an unclassified row contributes nothing rather than a guess.
 */
function recordLabelValues(record: UsageRecord): readonly string[] {
  const classification = (record.classification ?? '').trim();
  return classification.length === 0 ? [] : [classification];
}

/** Distinct, normalised labels; an unlabelled mission gets an empty list. */
function outcomeLabels(values: readonly string[]): readonly MissionLabel[] {
  return missionLabels(values.filter((value) => value.trim().length > 0));
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
interface OutcomeAccumulator {
  missionId: MissionId;
  repositoryId: RepositoryId;
  createdAt: string;
  closedAt: string | null;
  cycleTimeMinutes: number;
  reviewFixRounds: number | null;
  /** Raw classification strings; normalised to `MissionLabel` on emit. */
  labelValues: string[];
  runs: AgentRunMeasurement[];
}
