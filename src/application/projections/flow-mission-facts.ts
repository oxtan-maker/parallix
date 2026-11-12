import type { LifecycleHistoryEntry } from '../ports/operation-history.js';
import type { VerificationMeasurement } from '../ports/verification-observation.js';
import type { RunRecord } from '../run-history-types.js';
import { agentRunModel, MAX_RUNS_PER_MISSION } from '../run-history-types.js';
import { isOpenWorkflow, type WorkflowOperation } from '../../domain/workflow-operation.js';
import { compareCodeUnits } from '../../domain/comparators.js';
import { isRetainedRebaseOutcome, isTerminalRebaseOutcome, REBASE_OBSERVATION_STAGES,
  type RebaseObservationStage, type RetainedRebaseOutcome } from '../ports/rebase-workflow.js';
import type { FlowElapsedOwnership, FlowOwnershipRow } from './flow-elapsed-ownership.js';
import type { RebaseMeasurement, RebaseObservationCutovers } from './verification-observation-reader.js';
import type { ObservationDiagnostic } from './verification-diagnostic.js';

export type FlowRebaseStage = RebaseObservationStage;
export const FLOW_REBASE_STAGE_STATES = ['measured', 'absent', 'running', 'interrupted',
  'inapplicable', 'historical-unavailable'] as const;
export type FlowRebaseStageState = typeof FLOW_REBASE_STAGE_STATES[number];

/** One gate batch with at least one execution, settled by its worst executed result. */
export interface FlowGateRun {
  readonly id: string;
  readonly phase: string;
  readonly result: 'passed' | 'failed' | 'running';
}
/** One rebase identity with its settled outcomes in attempt order; `running` publications are not outcomes. */
export interface FlowRebaseRun {
  readonly id: string;
  readonly operationId: string;
  readonly stage: RebaseMeasurement['stage'];
  readonly outcomes: readonly RetainedRebaseOutcome[];
}
/** One configured stage's observation state, with the retained identity that proves it. */
export interface FlowRebaseStageFact {
  readonly stage: FlowRebaseStage;
  readonly state: FlowRebaseStageState;
  readonly operationId: string | null;
  readonly sourceId: string | null;
  readonly reason: string;
  readonly outcomes: readonly RetainedRebaseOutcome[];
}

export interface ScopedFlowRebaseStageFact extends FlowRebaseStageFact {
  readonly repositoryId: string;
  readonly missionId: string;
}

export function scopeFlowRebaseStages(facts: readonly {
  readonly repositoryId: string;
  readonly missionId: string;
  readonly rebaseStages?: readonly FlowRebaseStageFact[];
}[]): ScopedFlowRebaseStageFact[] {
  return facts.flatMap(fact => (fact.rebaseStages ?? []).map(stage => ({
    repositoryId: fact.repositoryId, missionId: fact.missionId, ...stage,
  })));
}

export const DIRECT_REBASE_NOT_REQUESTED = 'no direct rebase workflow was requested';
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
  readonly rebaseStages: readonly FlowRebaseStageFact[];
  readonly lead: FlowLeadEpisodes;
  readonly actualAgentLaunches: number | null;
  /** Retention reached its cap, so the launch count is an observed lower bound. */
  readonly agentLaunchesLowerBound: boolean;
  readonly agentLaunches: readonly { readonly runId: string; readonly startedAt: string;
    readonly family: string | null; readonly model: string | null }[];
  readonly observedDisqualifiers: readonly string[] | null;
  readonly diagnostics: readonly ObservationDiagnostic[];
}

export const EMPTY_FLOW_MISSION_OBSERVATION: Omit<ObservedFlowMission, 'missionId'> = {
  diagramNodeIds: [], diagramEdgeIds: [], ownership: [], window: null, gateRuns: [], rebaseRuns: [],
  rebaseStages: [], diagnostics: [],
  lead: { queued: 0, recoveries: 0, escalations: 0 }, actualAgentLaunches: null, agentLaunches: [],
  observedDisqualifiers: null, agentLaunchesLowerBound: false,
};

/** Extract per-mission diagram, launch, disqualifier and ownership facts before review evidence is joined. */
export function observedFlowMissions(input: { readonly repositoryId: string;
  readonly lifecycle: readonly LifecycleHistoryEntry[]; readonly operations: readonly WorkflowOperation[];
  readonly runs?: readonly RunRecord[] },
ownership: FlowElapsedOwnership | null, attempts: readonly VerificationMeasurement[],
rebases: readonly RebaseMeasurement[], firstRebaseObservedAt = firstRebaseObservations(rebases),
diagnostics: readonly ObservationDiagnostic[] = []): ObservedFlowMission[] {
  const completed = input.lifecycle.filter(event => event.repositoryId === input.repositoryId && event.toStatus === 'done');
  return [...new Set(completed.map(event => event.missionId))]
    .map(missionId => observedFlowMission(input, ownership, attempts, rebases, firstRebaseObservedAt,
      diagnostics, missionId));
}

function observedFlowMission(input: { readonly repositoryId: string;
  readonly lifecycle: readonly LifecycleHistoryEntry[]; readonly operations: readonly WorkflowOperation[];
  readonly runs?: readonly RunRecord[] },
ownership: FlowElapsedOwnership | null, attempts: readonly VerificationMeasurement[], rebases: readonly RebaseMeasurement[],
firstRebaseObservedAt: RebaseObservationCutovers, diagnostics: readonly ObservationDiagnostic[],
missionId: string): ObservedFlowMission {
  const missionOwnership = ownershipFacts(ownership, missionId);
  const runs = input.runs?.filter(run => run.repositoryId === input.repositoryId && run.missionId === missionId);
  const scopedAttempts = attempts.filter(attempt => attempt.missionId === missionId);
  const scopedRebases = rebases.filter(rebase => rebase.missionId === missionId);
  const retainedRebaseRuns = rebaseRuns(scopedRebases);
  const launches = launchFacts(runs);
  const scopedDiagnostics = [
    ...diagnostics.filter(diagnostic => diagnostic.repositoryId === input.repositoryId
      && diagnostic.missionId === missionId),
    ...laneReturnDiagnostics(input.repositoryId, input.lifecycle, missionId),
  ];
  return { missionId, diagramNodeIds: missionOwnership.nodeIds, diagramEdgeIds: missionOwnership.edgeIds,
    ownership: missionOwnership.rows, diagnostics: scopedDiagnostics,
    window: missionOwnership.window, gateRuns: gateRuns(scopedAttempts), rebaseRuns: retainedRebaseRuns,
    rebaseStages: rebaseStageFacts(input.operations, missionId, scopedRebases,
      retainedRebaseRuns, firstRebaseObservedAt, scopedDiagnostics),
    lead: leadEpisodes(missionOwnership.segments), actualAgentLaunches: launches.count,
    agentLaunchesLowerBound: launches.lowerBound,
    agentLaunches: (runs ?? []).map(run => ({ runId: run.runId, startedAt: run.startedAt,
      family: run.family, model: agentRunModel(run) })),
    observedDisqualifiers: missionOwnership.segments.length > 0 && input.runs !== undefined ? [
      ...scopedAttempts.filter(attempt => attempt.result === 'failed').map(attempt => `gate:${attempt.id}`),
      ...scopedRebases.filter(rebase => ['conflict', 'failed'].includes(rebase.outcome)).map(rebase => `rebase:${rebase.id}:${rebase.outcome}`),
    ] : null };
}

function laneReturnDiagnostics(repositoryId: string, lifecycle: readonly LifecycleHistoryEntry[],
  missionId: string): ObservationDiagnostic[] {
  return lifecycle.filter(event => event.repositoryId === repositoryId && event.missionId === missionId
    && event.returnIdentityDefect).map(event => ({ kind: 'provenance', state: 'absent', repositoryId, missionId,
    operationId: null, sourceId: event.idempotencyKey, stage: 'return', message: event.returnIdentityDefect!,
    recovery: 'inspect the retained lane return identity' }));
}

function ownershipFacts(ownership: FlowElapsedOwnership | null, missionId: string) {
  const segments = ownership?.segments.filter(segment => segment.missionId === missionId) ?? [];
  const window = ownership?.windows.find(value => value.missionId === missionId) ?? null;
  const grouped = new Map<string, FlowOwnershipRow>();
  for (const segment of segments) {
    const key = `${segment.step}\0${segment.actor}\0${segment.model ?? ''}\0${segment.state}`;
    const prior = grouped.get(key);
    const offset = window ? Date.parse(segment.startedAt) - Date.parse(window.startedAt) : undefined;
    grouped.set(key, prior ? { ...prior, durationMs: prior.durationMs + segment.durationMs }
      : { step: segment.step, actor: segment.actor, model: segment.model, state: segment.state, durationMs: segment.durationMs,
        ...(offset === undefined ? {} : { firstOffsetMs: offset }) });
  }
  return { segments, window, rows: [...grouped.values()], nodeIds: [...new Set(segments.map(segment => segment.id))],
    edgeIds: [...new Set(segments.slice(1).map((segment, index) => `${segments[index]!.id}->${segment.id}`))] };
}

function launchFacts(runs: readonly RunRecord[] | undefined): { readonly count: number | null; readonly lowerBound: boolean } {
  return { count: runs ? new Set(runs.map(run => run.runId)).size : null,
    lowerBound: Boolean(runs && runs.length >= MAX_RUNS_PER_MISSION) };
}

export function firstRebaseObservations(rebases: readonly RebaseMeasurement[]): RebaseObservationCutovers {
  return Object.fromEntries(REBASE_OBSERVATION_STAGES.flatMap(stage => {
    const occurredAt = rebases.filter(rebase => rebase.stage === stage).map(rebase => rebase.occurredAt)
      .sort(compareCodeUnits)[0];
    return occurredAt ? [[stage, occurredAt]] : [];
  }));
}

const REBASE_STAGE_CONFIG: Readonly<Record<FlowRebaseStage, {
  readonly missingOwnerCommands: readonly WorkflowOperation['command'][];
  readonly canInferMissing: (operation: WorkflowOperation) => boolean;
}>> = {
  'direct-rebase': { missingOwnerCommands: ['rebase:run'], canInferMissing: () => true },
  'pre-review-rebase': { missingOwnerCommands: ['review:submit'],
    canInferMissing: operation => operation.providerStarted },
  'integration-rebase': { missingOwnerCommands: ['integrate:merge'], canInferMissing: () => true },
};

function rebaseStageFacts(operations: readonly WorkflowOperation[], missionId: string,
  rebases: readonly RebaseMeasurement[], retainedRuns: readonly FlowRebaseRun[],
  firstRebaseObservedAt: RebaseObservationCutovers,
  diagnostics: readonly ObservationDiagnostic[]): FlowRebaseStageFact[] {
  return REBASE_OBSERVATION_STAGES.flatMap(stage => rebaseFactsForStage(
    operations, missionId, rebases, retainedRuns, firstRebaseObservedAt, diagnostics, stage));
}

function rebaseFactsForStage(operations: readonly WorkflowOperation[], missionId: string,
  rebases: readonly RebaseMeasurement[], retainedRuns: readonly FlowRebaseRun[],
  firstRebaseObservedAt: RebaseObservationCutovers, diagnostics: readonly ObservationDiagnostic[],
  stage: FlowRebaseStage): FlowRebaseStageFact[] {
  const config = REBASE_STAGE_CONFIG[stage];
  const rows = rebases.filter(row => row.stage === stage);
  const observedOperationIds = new Set(rows.flatMap(row => row.operationId ? [row.operationId] : []));
  const candidates = operations.filter(operation => operation.missionId === missionId
    && (observedOperationIds.has(operation.id) || config.missingOwnerCommands.includes(operation.command)
      && (stage === 'direct-rebase' || operation.phase === 'completed')))
    .sort((left, right) => compareCodeUnits(left.createdAt, right.createdAt) || compareCodeUnits(left.id, right.id));
  const selectedOperationIds = new Set(observedOperationIds);
  for (const operation of candidates) {
    if (config.missingOwnerCommands.includes(operation.command) && config.canInferMissing(operation)) {
      selectedOperationIds.add(operation.id);
    }
  }
  const matchingOperations = candidates.filter(operation => selectedOperationIds.has(operation.id));
  if (matchingOperations.length === 0) {
    const rejectedEvidence = diagnostics.find(diagnostic => diagnostic.stage === stage
      && diagnostic.kind === 'identity' && (diagnostic.operationId !== null || diagnostic.sourceId !== null));
    return [unownedRebaseStageFact(stage, firstRebaseObservedAt[stage] ?? null, rejectedEvidence)];
  }
  return matchingOperations.map(operation => rebaseFactForOperation(
    stage, operation, rows, retainedRuns, firstRebaseObservedAt));
}

function unownedRebaseStageFact(stage: FlowRebaseStage, stageCutover: string | null,
  rejectedEvidence: ObservationDiagnostic | undefined): FlowRebaseStageFact {
  if (rejectedEvidence && stageCutover) {
    return { stage, state: 'absent', operationId: rejectedEvidence.operationId, sourceId: rejectedEvidence.sourceId,
      reason: 'retained rebase evidence has no matching workflow identity', outcomes: [] };
  }
  return { stage, state: stage === 'direct-rebase' ? 'inapplicable' : 'historical-unavailable',
    operationId: null, sourceId: null,
    reason: stage === 'direct-rebase' ? DIRECT_REBASE_NOT_REQUESTED : 'owning workflow identity is not retained', outcomes: [] };
}

function rebaseFactForOperation(stage: FlowRebaseStage, operation: WorkflowOperation,
  rows: readonly RebaseMeasurement[], retainedRuns: readonly FlowRebaseRun[],
  firstRebaseObservedAt: RebaseObservationCutovers): FlowRebaseStageFact {
  const operationRows = rows.filter(row => row.operationId === operation.id);
  const evidence = operationRows.at(-1);
  const outcomes = retainedRuns.filter(run => run.stage === stage && run.operationId === operation.id)
    .flatMap(run => run.outcomes);
  const fact = (state: FlowRebaseStageState, reason: string): FlowRebaseStageFact => ({ stage, state,
    operationId: operation.id, sourceId: evidence?.sourceId ?? null, reason, outcomes });
  const observed = observedRebaseState(operationRows, operation);
  if (observed) { return fact(observed.state, observed.reason); }
  const missing = missingRebaseState(stage, operation, operationRows, firstRebaseObservedAt[stage] ?? null);
  return fact(missing.state, missing.reason);
}

interface RebaseStageStatus { readonly state: FlowRebaseStageState; readonly reason: string }

function observedRebaseState(operationRows: readonly RebaseMeasurement[],
  operation: WorkflowOperation): RebaseStageStatus | null {
  if (operationRows.some(row => isTerminalRebaseOutcome(row.outcome))) {
    return { state: 'measured', reason: 'retained terminal rebase outcome' };
  }
  const inapplicable = operationRows.find(row => row.outcome === 'inapplicable');
  if (inapplicable) { return { state: 'inapplicable', reason: inapplicable.inapplicability! }; }
  const observedGenerations = operationRows.flatMap(row => row.generation === null ? [] : [row.generation]);
  const currentGenerationObserved = operationRows.some(row => row.generation === null || row.generation === operation.generation);
  if (observedGenerations.length > 0 && !currentGenerationObserved) {
    const superseded = observedGenerations.every(generation => generation < operation.generation);
    return { state: 'interrupted', reason: superseded
      ? 'retained non-terminal rebase observation belongs to a superseded workflow generation'
      : 'retained non-terminal rebase observation belongs to a different workflow generation' };
  }
  const runningObservation = operationRows.some(row => row.outcome === 'running');
  if (runningObservation || isOpenWorkflow(operation)) {
    const running = isOpenWorkflow(operation);
    return { state: running ? 'running' : 'interrupted', reason: running
      ? `owning workflow is still running${runningObservation ? '' : ' without a retained rebase observation'}`
      : 'running observation has no retained terminal outcome' };
  }
  return null;
}

function missingRebaseState(stage: FlowRebaseStage, operation: WorkflowOperation,
  operationRows: readonly RebaseMeasurement[], stageCutover: string | null): RebaseStageStatus {
  if (operationRows.length === 0 && (stageCutover === null || operation.createdAt < stageCutover)) {
    return { state: 'historical-unavailable', reason: 'owning workflow predates retained rebase observations' };
  }
  if (['blocked', 'interrupted', 'stopped'].includes(operation.phase)) {
    return { state: 'interrupted', reason: `owning workflow settled ${operation.phase} without a retained terminal rebase outcome` };
  }
  const reached = stage === 'direct-rebase' ? !isOpenWorkflow(operation) : operation.phase === 'completed';
  if (reached && stageCutover !== null && operation.createdAt >= stageCutover) {
    return { state: 'absent', reason: 'owning workflow completed after rebase observations were retained' };
  }
  return { state: 'historical-unavailable', reason: 'owning workflow completion is not retained' };
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
    .sort((a, b) => compareCodeUnits(a.id, b.id));
}

function rebaseRuns(rebases: readonly RebaseMeasurement[]): FlowRebaseRun[] {
  const runs = new Map<string, RebaseMeasurement[]>();
  for (const rebase of rebases) { runs.set(rebase.id, [...(runs.get(rebase.id) ?? []), rebase]); }
  return [...runs].map(([id, rows]) => ({ id, operationId: rows[0]!.operationId!, stage: rows[0]!.stage,
    outcomes: [...rows].sort((a, b) => a.attempt - b.attempt || compareCodeUnits(a.occurredAt, b.occurredAt))
      .flatMap(row => isRetainedRebaseOutcome(row.outcome) ? [row.outcome] : []),
    firstObservedAt: rows.map(row => row.occurredAt).sort(compareCodeUnits)[0]! }))
    .sort((a, b) => compareCodeUnits(a.firstObservedAt, b.firstObservedAt) || compareCodeUnits(a.id, b.id))
    .map(({ firstObservedAt: _firstObservedAt, ...run }) => run);
}

function leadEpisodes(segments: FlowElapsedOwnership['segments']): FlowLeadEpisodes {
  const distinct = (predicate: (segment: FlowElapsedOwnership['segments'][number]) => boolean) =>
    new Set(segments.filter(predicate).map(segment => segment.id)).size;
  return { queued: distinct(segment => segment.actor === 'lead' && segment.state === 'waiting'),
    recoveries: distinct(segment => segment.actor === 'lead' && segment.state === 'working'),
    escalations: distinct(segment => segment.step === 'lead-escalation') };
}
