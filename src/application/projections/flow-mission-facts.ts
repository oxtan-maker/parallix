import type { LifecycleHistoryEntry } from '../ports/operation-history.js';
import type { VerificationMeasurement } from '../ports/verification-observation.js';
import type { RunRecord } from '../run-history-types.js';
import { MAX_RUNS_PER_MISSION } from '../run-history-types.js';
import type { WorkflowOperation } from '../../domain/workflow-operation.js';
import type { FlowElapsedOwnership, FlowOwnershipRow } from './flow-elapsed-ownership.js';
import type { RebaseMeasurement } from './verification-observation-reader.js';

/** One gate batch with at least one execution, settled by its worst executed result. */
export interface FlowGateRun {
  readonly id: string;
  readonly phase: string;
  readonly result: 'passed' | 'failed' | 'running';
}
/** One rebase identity with its settled outcomes in attempt order; `running` publications are not outcomes. */
export interface FlowRebaseRun {
  readonly id: string;
  readonly stage: RebaseMeasurement['stage'];
  readonly outcomes: readonly Exclude<RebaseMeasurement['outcome'], 'running'>[];
}
/** Distinct px lead ownership observations: queued actionable work, active recovery, and escalations to a human. */
export interface FlowLeadEpisodes {
  readonly queued: number;
  readonly recoveries: number;
  readonly escalations: number;
}

export interface ObservedFlowMission {
  readonly missionId: string;
  readonly diagramNodeIds: readonly string[];
  readonly diagramEdgeIds: readonly string[];
  readonly ownership: readonly FlowOwnershipRow[];
  /** Refined-to-first-delivery interval from lifecycle; null when either boundary is missing. */
  readonly window: { readonly startedAt: string; readonly finishedAt: string } | null;
  readonly gateRuns: readonly FlowGateRun[];
  readonly rebaseRuns: readonly FlowRebaseRun[];
  /** Stages whose owning workflow began after collection was proven active and reached its lifecycle boundary. */
  readonly rebaseExpected: Readonly<Record<'preReview' | 'integration', boolean>>;
  readonly lead: FlowLeadEpisodes;
  readonly actualAgentLaunches: number | null;
  /** Retention reached its cap, so the launch count is an observed lower bound. */
  readonly agentLaunchesLowerBound: boolean;
  readonly agentLaunches: readonly { readonly runId: string; readonly startedAt: string;
    readonly family: string | null; readonly model: string | null }[];
  readonly observedDisqualifiers: readonly string[] | null;
  readonly collectionDefects?: readonly string[];
}

/** Extract per-mission diagram, launch, disqualifier and ownership facts before review evidence is joined. */
export function observedFlowMissions(input: { readonly repositoryId: string;
  readonly lifecycle: readonly LifecycleHistoryEntry[]; readonly operations: readonly WorkflowOperation[];
  readonly runs?: readonly RunRecord[]; readonly collectionDefects?: readonly string[] },
ownership: FlowElapsedOwnership | null, attempts: readonly VerificationMeasurement[],
rebases: readonly RebaseMeasurement[], collectionStartedAt = firstRebaseCollection(rebases)): ObservedFlowMission[] {
  const completed = input.lifecycle.filter(event => event.repositoryId === input.repositoryId && event.toStatus === 'done');
  return [...new Set(completed.map(event => event.missionId))].map(missionId => {
    const segments = ownership?.segments.filter(segment => segment.missionId === missionId) ?? [];
    const window = ownership?.windows.find(value => value.missionId === missionId) ?? null;
    const nodeIds = [...new Set(segments.map(segment => segment.id))];
    const edgeIds = [...new Set(segments.slice(1).map((segment, index) => `${segments[index]!.id}->${segment.id}`))];
    const grouped = new Map<string, FlowOwnershipRow>();
    for (const segment of segments) {
      const key = `${segment.step}\0${segment.actor}\0${segment.model ?? ''}\0${segment.state}`;
      const prior = grouped.get(key);
      const offset = window ? Date.parse(segment.startedAt) - Date.parse(window.startedAt) : undefined;
      grouped.set(key, prior ? { ...prior, durationMs: prior.durationMs + segment.durationMs }
        : { step: segment.step, actor: segment.actor, model: segment.model, state: segment.state, durationMs: segment.durationMs,
          ...(offset === undefined ? {} : { firstOffsetMs: offset }) });
    }
    const runs = input.runs?.filter(run => run.repositoryId === input.repositoryId && run.missionId === missionId);
    const scopedAttempts = attempts.filter(attempt => attempt.missionId === missionId);
    const scopedRebases = rebases.filter(rebase => rebase.missionId === missionId);
    const observed = segments.length > 0 && input.runs !== undefined;
    const launches = launchFacts(runs);
    return { missionId, diagramNodeIds: nodeIds, diagramEdgeIds: edgeIds, ownership: [...grouped.values()],
      collectionDefects: input.collectionDefects,
      window, gateRuns: gateRuns(scopedAttempts), rebaseRuns: rebaseRuns(scopedRebases),
      rebaseExpected: {
        preReview: workflowBoundaryAfter(input.operations, input.lifecycle, missionId,
          ['active:execute', 'review:submit'], 'review', collectionStartedAt),
        integration: workflowBoundaryAfter(input.operations, input.lifecycle, missionId,
          ['integrate:merge'], 'done', collectionStartedAt),
      },
      lead: leadEpisodes(segments),
      actualAgentLaunches: launches.count,
      agentLaunchesLowerBound: launches.lowerBound,
      agentLaunches: (runs ?? []).map(run => ({ runId: run.runId, startedAt: run.startedAt,
        family: run.family, model: run.configuredModel ?? run.resources?.provider?.model ?? null })),
      observedDisqualifiers: observed ? [
        ...scopedAttempts.filter(attempt => attempt.result === 'failed').map(attempt => `gate:${attempt.id}`),
        ...scopedRebases.filter(rebase => ['conflict', 'failed'].includes(rebase.outcome)).map(rebase => `rebase:${rebase.id}:${rebase.outcome}`),
      ] : null };
  });
}

function launchFacts(runs: readonly RunRecord[] | undefined): { readonly count: number | null; readonly lowerBound: boolean } {
  return { count: runs ? new Set(runs.map(run => run.runId)).size : null,
    lowerBound: Boolean(runs && runs.length >= MAX_RUNS_PER_MISSION) };
}

export function firstRebaseCollection(rebases: readonly RebaseMeasurement[]): string | null {
  return rebases.filter(rebase => rebase.stage === 'pre-review-rebase').map(rebase => rebase.occurredAt)
    .sort((left, right) => left.localeCompare(right))[0] ?? null;
}

function workflowBoundaryAfter(operations: readonly WorkflowOperation[], events: readonly LifecycleHistoryEntry[], missionId: string,
  commands: readonly WorkflowOperation['command'][], toStatus: LifecycleHistoryEntry['toStatus'], startedAt: string | null): boolean {
  return startedAt !== null && operations.some(operation => operation.missionId === missionId
    && commands.includes(operation.command) && operation.createdAt >= startedAt
    && events.some(event => event.missionId === missionId && event.toStatus === toStatus
      && event.occurredAt >= operation.createdAt && event.occurredAt <= operation.updatedAt));
}

function gateRuns(attempts: readonly VerificationMeasurement[]): FlowGateRun[] {
  const batches = new Map<string, VerificationMeasurement[]>();
  for (const attempt of attempts) { batches.set(attempt.batchId, [...(batches.get(attempt.batchId) ?? []), attempt]); }
  return [...batches].flatMap(([id, rows]) => {
    const executed = rows.filter(row => row.result !== 'reused');
    return executed.length === 0 ? [] : [{ id, phase: executed[0]!.phase,
      result: executed.some(row => row.result === 'running') ? 'running' as const
        : executed.some(row => row.result === 'failed' || row.result === 'interrupted') ? 'failed' as const : 'passed' as const }];
  })
    .sort((a, b) => a.id.localeCompare(b.id));
}

function rebaseRuns(rebases: readonly RebaseMeasurement[]): FlowRebaseRun[] {
  const runs = new Map<string, RebaseMeasurement[]>();
  for (const rebase of rebases) { runs.set(rebase.id, [...(runs.get(rebase.id) ?? []), rebase]); }
  return [...runs].map(([id, rows]) => ({ id, stage: rows[0]!.stage,
    outcomes: [...rows].sort((a, b) => a.attempt - b.attempt || a.occurredAt.localeCompare(b.occurredAt))
      .flatMap(row => row.outcome === 'running' ? [] : [row.outcome]) }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function leadEpisodes(segments: FlowElapsedOwnership['segments']): FlowLeadEpisodes {
  const distinct = (predicate: (segment: FlowElapsedOwnership['segments'][number]) => boolean) =>
    new Set(segments.filter(predicate).map(segment => segment.id)).size;
  return { queued: distinct(segment => segment.actor === 'lead' && segment.state === 'waiting'),
    recoveries: distinct(segment => segment.actor === 'lead' && segment.state === 'working'),
    escalations: distinct(segment => segment.step === 'lead-escalation') };
}
