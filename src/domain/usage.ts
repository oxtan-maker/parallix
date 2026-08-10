import type { AgentFamily } from './agents.js';
import type { ClosedMission, MissionId, MissionLabel } from './mission.js';
import type { RepositoryId } from './repository.js';

export type Measurement<T> =
  | { readonly kind: 'measured'; readonly value: T }
  | { readonly kind: 'unavailable'; readonly reason: string };

export const ATTRIBUTED_AGENT_WORK_STAGES = [
  'draft',
  'execute',
  'review-preparation',
  'review',
  'review-response',
  'conflict-resolution',
  'integration-verification',
] as const;
export type AttributedAgentWorkStage = (typeof ATTRIBUTED_AGENT_WORK_STAGES)[number];

/**
 * `default` is a debt sentinel for imported measurements whose producer did
 * not declare a stage. Known token-using work must map to an attributed stage.
 */
export const AGENT_WORK_STAGES = [...ATTRIBUTED_AGENT_WORK_STAGES, 'default'] as const;
export type AgentWorkStage = (typeof AGENT_WORK_STAGES)[number];

export type TokenUsingAgentActivity =
  | 'draft'
  | 'draft-repair'
  | 'execute'
  | 'handoff-repair'
  | 'pre-review-gate-repair'
  | 'static-review-repair'
  | 'review'
  | 'review-retry'
  | 'review-response'
  | 'review-response-retry'
  | 'conflict-resolution'
  | 'integration-verification';

/**
 * Adapter contract derived from current token-consuming launch paths. No
 * known activity is allowed to disappear into `default`.
 */
export const AGENT_WORK_STAGE_BY_ACTIVITY = {
  draft: 'draft',
  'draft-repair': 'draft',
  execute: 'execute',
  'handoff-repair': 'review-preparation',
  'pre-review-gate-repair': 'review-preparation',
  'static-review-repair': 'review-preparation',
  review: 'review',
  'review-retry': 'review',
  'review-response': 'review-response',
  'review-response-retry': 'review-response',
  'conflict-resolution': 'conflict-resolution',
  'integration-verification': 'integration-verification',
} as const satisfies Readonly<Record<TokenUsingAgentActivity, AttributedAgentWorkStage>>;

export type AgentRole = 'implementer' | 'reviewer';

export interface AgentRuntimeIdentity {
  readonly provider: Measurement<string>;
  readonly model: Measurement<string>;
}

export interface TokenMeasurements {
  readonly input: Measurement<number>;
  readonly output: Measurement<number>;
  readonly cached: Measurement<number>;
  /** Session total used as the current coarse context-size signal. */
  readonly context: Measurement<number>;
}

export interface ProviderUsageMeasurements {
  readonly beforePercent: Measurement<number>;
  readonly afterPercent: Measurement<number>;
  readonly deltaPercent: Measurement<number>;
}

/** One agent's measured work, retaining the dimensions used by statistics. */
export interface AgentRunMeasurement {
  readonly recordedOn: string;
  readonly stage: AgentWorkStage;
  readonly role: AgentRole;
  readonly agent: AgentFamily;
  readonly runtime: AgentRuntimeIdentity;
  readonly durationMinutes: Measurement<number>;
  readonly tokens: TokenMeasurements;
  readonly toolCalls: Measurement<number>;
  readonly providerUsage: ProviderUsageMeasurements;
  readonly costUsd: Measurement<number>;
}

/**
 * Outcome measurements that do not duplicate mission-owned facts.
 *
 * The cohort dimensions (`labels`, `implementer`, `modelsInvolved`) and the
 * per-mission totals are carried here rather than recomputed by every reader,
 * so a comparison can slice completed missions without re-reading telemetry.
 */
export interface MissionOutcome {
  readonly missionId: MissionId;
  readonly repositoryId: RepositoryId;
  /** Earliest dated telemetry recorded for this completed mission. */
  readonly createdAt: string;
  /** Date on the telemetry row that records this mission's closure. */
  readonly closedAt: string;
  readonly cycleTimeMinutes: number;
  /** Number of request-changes rounds, persisted today as pr_fix_rounds. */
  readonly reviewFixRounds: number;
  /** Backlog labels carried by this mission's telemetry; the first cohort dimension. */
  readonly labels: readonly MissionLabel[];
  /** Agent family that owned the implementation work, or null when unnamed. */
  readonly implementer: AgentFamily | null;
  /** Every provider/model pairing observed on this mission's runs. */
  readonly modelsInvolved: readonly ModelInvolvement[];
  /** Null rather than a partial sum when any run lacks a token measurement. */
  readonly totalInputAndOutputTokens: number | null;
  readonly totalCostUsd: number | null;
  readonly totalToolCalls: number | null;
  readonly runs: readonly AgentRunMeasurement[];
}

export interface ModelInvolvement {
  readonly recordedOn: string;
  readonly stage: AgentWorkStage;
  readonly role: AgentRole;
  readonly agent: AgentFamily;
  readonly provider: string | null;
  readonly model: string | null;
}

export interface CompletedMissionStatistics {
  readonly missionId: MissionId;
  readonly repositoryId: RepositoryId;
  readonly labels: readonly MissionLabel[];
  readonly closedAt: string;
  readonly implementer: AgentFamily | null;
  readonly modelsInvolved: readonly ModelInvolvement[];
  readonly totalDurationMinutes: number | null;
  readonly totalCostUsd: number | null;
  readonly totalInputAndOutputTokens: number | null;
  readonly totalCachedTokens: number | null;
  readonly totalContextTokens: number | null;
  readonly totalToolCalls: number | null;
  readonly reviewFixRounds: number;
  readonly netEngineeringLines: number;
}

export class StatisticsRuleViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StatisticsRuleViolation';
  }
}

/**
 * Sum only when every value was measured. A partial sum would read as a smaller
 * true total, so an unmeasured run makes the whole quantity unavailable.
 */
export function sumMeasured(values: readonly Measurement<number>[]): number | null {
  if (values.length === 0) { return null; }
  const measured = values.filter(
    (value): value is { readonly kind: 'measured'; readonly value: number } => value.kind === 'measured',
  );
  return measured.length === values.length
    ? measured.reduce((sum, value) => sum + value.value, 0)
    : null;
}

export function measuredValue<T>(measurement: Measurement<T>): T | null {
  return measurement.kind === 'measured' ? measurement.value : null;
}

/** The provider/model pairings a set of runs used, in run order. */
export function modelInvolvement(
  runs: readonly AgentRunMeasurement[],
): readonly ModelInvolvement[] {
  return runs.map((run) => ({
    recordedOn: run.recordedOn,
    stage: run.stage,
    role: run.role,
    agent: run.agent,
    provider: measuredValue(run.runtime.provider),
    model: measuredValue(run.runtime.model),
  }));
}

/** Input plus output tokens across runs; cached and context stay separate. */
export function totalInputAndOutputTokens(
  runs: readonly AgentRunMeasurement[],
): number | null {
  return sumMeasured(runs.flatMap((run) => [run.tokens.input, run.tokens.output]));
}

export function completedMissionStatistics(
  mission: ClosedMission,
  outcome: MissionOutcome,
): CompletedMissionStatistics {
  if (mission.id !== outcome.missionId || mission.repositoryId !== outcome.repositoryId) {
    throw new StatisticsRuleViolation('Mission outcome identity does not match the closed mission');
  }
  if (mission.netEngineeringLines === null) {
    throw new StatisticsRuleViolation(`Mission ${mission.id} has no NEL measurement`);
  }
  return {
    missionId: outcome.missionId,
    repositoryId: mission.repositoryId,
    labels: mission.labels,
    closedAt: mission.closedAt,
    implementer: mission.assignee,
    modelsInvolved: modelInvolvement(outcome.runs),
    totalDurationMinutes: sumMeasured(outcome.runs.map((run) => run.durationMinutes)),
    totalCostUsd: sumMeasured(outcome.runs.map((run) => run.costUsd)),
    totalInputAndOutputTokens: totalInputAndOutputTokens(outcome.runs),
    totalCachedTokens: sumMeasured(outcome.runs.map((run) => run.tokens.cached)),
    totalContextTokens: sumMeasured(outcome.runs.map((run) => run.tokens.context)),
    totalToolCalls: sumMeasured(outcome.runs.map((run) => run.toolCalls)),
    reviewFixRounds: outcome.reviewFixRounds,
    netEngineeringLines: mission.netEngineeringLines,
  };
}
