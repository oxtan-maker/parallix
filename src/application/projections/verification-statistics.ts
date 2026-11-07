import type { OperationalHistoryEntry, BoardLaneEventEntry } from '../ports/operation-history.js';
import type { VerificationMeasurement } from '../ports/verification-observation.js';
import type { WorkflowOperation } from '../../domain/workflow-operation.js';
import { flowElapsedOwnership, type FlowElapsedOwnership } from './flow-elapsed-ownership.js';
import { firstRebaseCollection, observedFlowMissions, type ObservedFlowMission } from './flow-mission-facts.js';
import type { ControlledVerificationComparison } from '../ports/verification-profile.js';
import type { ProcessTreeCpuObservation, ProviderResourceObservation, RunRecord } from '../run-history-types.js';
import { observedAttempts, observedRebases, type RebaseMeasurement } from './verification-observation-reader.js';
export type { RebaseMeasurement } from './verification-observation-reader.js';

type Interval = readonly [number, number];
export interface VerificationStatisticsInput {
  readonly repositoryId: string;
  readonly history: readonly OperationalHistoryEntry[];
  readonly operations: readonly WorkflowOperation[];
  readonly lifecycle: readonly BoardLaneEventEntry[];
  readonly runs?: readonly RunRecord[];
  /** Storage rows excluded from the readable measured subset, already named by the owning adapter. */
  readonly collectionDefects?: readonly string[];
}
export interface VerificationCost {
  readonly wallMs: number | null;
  readonly cpuUs: number | null;
  readonly cpuObservations: number;
}
export interface VerificationStatistics {
  readonly attempts: readonly VerificationMeasurement[];
  readonly attemptCount: number;
  readonly failureCount: number;
  readonly infrastructureFailureCount: number;
  readonly reusedProofCount: number;
  readonly incompleteCount: number;
  readonly endToEndMs: number | null;
  readonly executionMs: number | null;
  readonly waitingMs: number | null;
  readonly overlapMs: number | null;
  readonly cpuUs: number | null;
  readonly cpuObservations: number;
  readonly rerunCount: number;
  readonly rerun: VerificationCost;
  /** Failure to next successful execution; includes repairs, waits and reruns. */
  readonly recovery: VerificationCost;
  readonly repairMs: number | null;
  readonly reReviewMs: number | null;
  readonly criticalPathMs: number | null;
  readonly dependencyPath: { readonly durationMs: number; readonly nodeIds: readonly string[] } | null;
  readonly elapsedOwnership: FlowElapsedOwnership | null;
  readonly agentResources: {
    readonly cpuUs: number | null;
    readonly cpuObservations: number;
    readonly runs: readonly { readonly runId: string; readonly missionId: string; readonly role: string;
      readonly family: string | null; readonly model: string | null; readonly cpu: ProcessTreeCpuObservation | null;
      readonly provider: ProviderResourceObservation | null }[];
  };
  /** Per-completion raw FLOW facts; review provenance is joined by the shared cohort projection. */
  readonly flowMissions: readonly ObservedFlowMission[];
  readonly rebases: readonly RebaseMeasurement[];
  readonly batches: readonly { batchId: string; criticalPathMs: number | null }[];
  readonly ranked: readonly { gate: string; attempts: number; wallMs: number | null; cpuUs: number | null }[];
  readonly completedMissions: number;
  readonly unknowns: readonly string[];
  readonly profileReferences: readonly string[];
  readonly comparisons: readonly { gate: string; before: string; after: string; beforeN: number; afterN: number;
    configurationEquivalent: boolean | null; workloadEquivalent: 'unobserved'; beforeWallMs: number | null; afterWallMs: number | null }[];
  readonly controlledComparisons: readonly ControlledVerificationComparison[];
}

type DependencyNode = { readonly id: string; readonly dependencies: readonly string[] | null; readonly durationMs: number };

function observedDagDependencyPath(input: VerificationStatisticsInput,
  attempts: readonly VerificationMeasurement[]): VerificationStatistics['dependencyPath'] {
  const nodes: DependencyNode[] = attempts.map(value => ({ id: value.id,
    dependencies: value.dependencies === undefined ? null : value.dependencies,
    durationMs: execution(value).reduce((sum, [start, end]) => sum + end - start, 0) }));
  nodes.push(...observedActivityNodes(input));
  if (!completeDependencyNodes(nodes)) { return null; }
  return longestDependencyPath(nodes);
}

function observedActivityNodes(input: VerificationStatisticsInput): DependencyNode[] {
  const activities = new Map<string, { dependencies: readonly string[] | null; startedAt: string | null; finishedAt: string | null }>();
  for (const entry of input.history) {
    if (entry.eventType !== 'mission.current-work' && entry.eventType !== 'flow.activity') { continue; }
    try {
      const value = JSON.parse(entry.eventData) as { repositoryId?: string; observationId?: string;
        sourceId?: string; dependencies?: readonly string[] | null; state?: string };
      const observationId = value.observationId ?? value.sourceId;
      if (value.repositoryId !== input.repositoryId || !observationId) { continue; }
      const prior = activities.get(observationId) ?? { dependencies: value.dependencies ?? null, startedAt: null, finishedAt: null };
      activities.set(observationId, { dependencies: value.dependencies ?? prior.dependencies,
        startedAt: value.state === 'running' ? prior.startedAt ?? entry.createdAt : prior.startedAt,
        finishedAt: value.state === 'ended' ? entry.createdAt : prior.finishedAt });
    } catch { /* malformed activity is diagnosed by its owning projection */ }
  }
  return [...activities].map(([id, value]) => {
    const measured = interval(value.startedAt, value.finishedAt);
    return { id, dependencies: value.dependencies, durationMs: measured.length ? measured[0][1] - measured[0][0] : NaN };
  });
}

function completeDependencyNodes(nodes: readonly DependencyNode[]): boolean {
  if (!nodes.length || nodes.some(node => node.dependencies === null || !Number.isFinite(node.durationMs))) { return false; }
  const byId = new Map(nodes.map(node => [node.id, node]));
  return byId.size === nodes.length && !nodes.some(node => node.dependencies!.some(id => !byId.has(id)));
}

function longestDependencyPath(nodes: readonly DependencyNode[]): VerificationStatistics['dependencyPath'] {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const memo = new Map<string, { durationMs: number; nodeIds: readonly string[] }>();
  const visiting = new Set<string>();
  const visit = (id: string): { durationMs: number; nodeIds: readonly string[] } | null => {
    const cached = memo.get(id); if (cached) { return cached; }
    if (visiting.has(id)) { return null; }
    const node = byId.get(id); if (!node) { return null; }
    visiting.add(id);
    const predecessors = node.dependencies!.map(visit);
    visiting.delete(id);
    if (predecessors.some(value => value === null)) { return null; }
    const prior = (predecessors as { durationMs: number; nodeIds: readonly string[] }[])
      .sort((a, b) => b.durationMs - a.durationMs || a.nodeIds.join('\0').localeCompare(b.nodeIds.join('\0')))[0];
    const result = { durationMs: (prior?.durationMs ?? 0) + node.durationMs,
      nodeIds: [...(prior?.nodeIds ?? []), id] };
    memo.set(id, result); return result;
  };
  const paths = nodes.map(node => visit(node.id));
  if (paths.some(value => value === null)) { return null; }
  return (paths as NonNullable<VerificationStatistics['dependencyPath']>[])
    .sort((a, b) => b.durationMs - a.durationMs || a.nodeIds.join('\0').localeCompare(b.nodeIds.join('\0')))[0] ?? null;
}

function ownershipDependencyPath(ownership: FlowElapsedOwnership | null, runs: readonly RunRecord[]): VerificationStatistics['dependencyPath'] {
  if (!ownership || ownership.unexplainedMs !== 0 || ownership.segments.length === 0) { return null; }
  const byMission = new Map<string, typeof ownership.segments>();
  for (const segment of ownership.segments) {
    byMission.set(segment.missionId, [...(byMission.get(segment.missionId) ?? []), segment]);
  }
  const paths = [...byMission.entries()].map(([missionId, segments]) => {
    const inserted = new Set<string>();
    const nodeIds: string[] = [];
    for (const segment of segments) {
      nodeIds.push(segment.id);
      const start = Date.parse(segment.startedAt), end = Date.parse(segment.finishedAt);
      for (const run of runs.filter(value => value.missionId === missionId && value.endedAt
        && Date.parse(value.startedAt) < end && Date.parse(value.endedAt!) > start
        && (segment.actor === value.family || ['implement', 'agent-review', 'repair', 'recovery'].includes(segment.step)))) {
        if (!inserted.has(run.runId)) { nodeIds.push(`run:${run.runId}`); inserted.add(run.runId); }
      }
    }
    return { durationMs: segments.reduce((total, segment) => total + segment.durationMs, 0), nodeIds };
  });
  return paths.sort((left, right) => right.durationMs - left.durationMs
    || left.nodeIds.join('\0').localeCompare(right.nodeIds.join('\0')))[0] ?? null;
}

function interval(start: string | null, end: string | null): Interval[] {
  const a = start === null ? NaN : Date.parse(start), b = end === null ? NaN : Date.parse(end);
  return Number.isFinite(a) && Number.isFinite(b) && b >= a ? [[a, b]] : [];
}

/** Union measure, including measured zero; null belongs to the caller's coverage. */
export function intervalUnionMs(intervals: readonly Interval[]): number {
  let total = 0, start = 0, end = 0, seen = false;
  for (const [a, b] of [...intervals].sort((left, right) => left[0] - right[0])) {
    if (!seen || a > end) { if (seen) {total += end - start;} start = a; end = b; seen = true; }
    else {end = Math.max(end, b);}
  }
  return total + (seen ? end - start : 0);
}

function execution(attempt: VerificationMeasurement): Interval[] {
  return attempt.result === 'reused' ? [] : interval(attempt.startedAt, attempt.finishedAt);
}

function observedCpuCost(observations: readonly ProcessTreeCpuObservation[], unknowns?: Set<string>): { cpuUs: number | null; cpuObservations: number } {
  const boundaries = new Map(observations.filter(cpu => Number.isFinite(cpu.userUs) && cpu.userUs >= 0
    && Number.isFinite(cpu.systemUs) && cpu.systemUs >= 0).map(cpu => [cpu.boundary, cpu]));
  let total = 0;
  let valid = 0;
  for (const cpu of boundaries.values()) {
    const ancestors = new Set([cpu.boundary]);
    let parent = cpu.parent;
    let cycle = false;
    while (parent && boundaries.has(parent)) {
      if (ancestors.has(parent)) { cycle = true; break; }
      ancestors.add(parent); parent = boundaries.get(parent)!.parent;
    }
    if (cycle) { unknowns?.add('Cyclic CPU boundary excluded'); continue; }
    valid++;
    // A counted parent already includes its waited descendants. Never add a nested observation twice.
    if (cpu.parent && boundaries.has(cpu.parent)) {continue;}
    total += cpu.userUs + cpu.systemUs;
  }
  return { cpuUs: valid ? total : null, cpuObservations: valid };
}

function cpuCost(attempts: readonly VerificationMeasurement[], unknowns?: Set<string>): { cpuUs: number | null; cpuObservations: number } {
  return observedCpuCost(attempts.flatMap(attempt => attempt.cpu ? [attempt.cpu] : []), unknowns);
}

function agentResources(input: VerificationStatisticsInput, missions: ReadonlySet<string> | undefined, unknowns: Set<string>): VerificationStatistics['agentResources'] {
  const retained = uniqueAgentRuns(input, missions, unknowns);
  const runs = retained.map(run => ({ runId: run.runId, missionId: run.missionId, role: run.role, family: run.family,
    model: run.configuredModel ?? run.resources?.provider?.model ?? null,
    cpu: run.resources?.localProcessTreeCpu ?? null, provider: run.resources?.provider ?? null }));
  if (input.runs !== undefined) { diagnoseAgentRuns(retained, unknowns); }
  const cpu = observedCpuCost(runs.flatMap(run => run.cpu ? [run.cpu] : []), unknowns);
  return { ...cpu, runs };
}

function uniqueAgentRuns(input: VerificationStatisticsInput, missions: ReadonlySet<string> | undefined,
  unknowns: Set<string>): RunRecord[] {
  const unique = new Map<string, RunRecord>();
  for (const run of (input.runs ?? []).filter(value => value.captureKind !== 'coordinator'
    && value.repositoryId === input.repositoryId && (!missions || missions.has(value.missionId)))) {
    const prior = unique.get(run.runId);
    if (prior && JSON.stringify(prior) !== JSON.stringify(run)) {
      unknowns.add(`Conflicting agent run copies for ${run.missionId} run ${run.runId}`);
    } else { unique.set(run.runId, run); }
  }
  return [...unique.values()];
}

function diagnoseAgentRuns(runs: readonly RunRecord[], unknowns: Set<string>): void {
  for (const run of runs) {
    if (incompleteAgentRunIdentity(run)) {
      unknowns.add(`Agent run identity incomplete for ${run.missionId} source ${run.sourceId ?? run.runId}; rerun the affected workflow with FLOW collection enabled`);
    }
    if (missingAgentCpu(run)) {
      unknowns.add(`Agent waited-tree CPU missing for ${run.missionId} run ${run.runId}; rerun the affected workflow with FLOW collection enabled`);
    }
    if (missingAgentModel(run)) {
      unknowns.add(`Concrete model identity missing for ${run.missionId} run ${run.runId}; rerun the affected workflow with FLOW collection enabled`);
    }
  }
}

function incompleteAgentRunIdentity(run: RunRecord): boolean {
  return !run.operationId || run.operationGeneration === null || run.operationGeneration === undefined
    || !run.sourceId || !run.revision;
}

function missingAgentCpu(run: RunRecord): boolean {
  return run.resources !== undefined && run.state === 'exited' && Boolean(run.execution)
    && run.family !== 'pi' && !run.resources.localProcessTreeCpu;
}

function missingAgentModel(run: RunRecord): boolean {
  return run.resources !== undefined && run.state === 'exited' && run.exitCode === 0
    && !run.configuredModel && !run.resources.provider?.model;
}

function cost(attempts: readonly VerificationMeasurement[]): VerificationCost {
  const intervals = attempts.flatMap(execution);
  return { wallMs: intervals.length ? intervalUnionMs(intervals) : null, ...cpuCost(attempts) };
}

/** Observed gate DAG cost only; admission/agent/wait dependencies are not invented. */
function criticalPath(attempts: readonly VerificationMeasurement[]): number | null {
  const nodes = new Map(attempts.map(a => [a.gate, a]));
  if (nodes.size !== attempts.length) {return null;}
  if (attempts.some(a => !a.plan || a.plan.some(key => !nodes.has(key)))) {return null;}
  const values = new Map<string, number>(), visiting = new Set<string>();
  function visit(key: string): number | null {
    if (values.has(key)) {return values.get(key)!;}
    const node = nodes.get(key);
    if (!node || node.after === null || !Array.isArray(node.after) || visiting.has(key)) {return null;}
    const times = execution(node);
    if (node.result !== 'reused' && times.length === 0) {return null;}
    visiting.add(key);
    const predecessors = node.after.map(visit);
    visiting.delete(key);
    if (predecessors.some(value => value === null)) {return null;}
    const duration = times.length ? times[0][1] - times[0][0] : 0;
    const value = duration + Math.max(0, ...predecessors as number[]);
    values.set(key, value);
    return value;
  }
  const paths = attempts.map(a => visit(a.gate));
  return paths.length && paths.every(value => value !== null) ? Math.max(...paths as number[]) : null;
}

type ActivityEvent = { repositoryId?: string; missionId: string; operationId: string;
  operationGeneration?: number | null; sourceId?: string; revision?: string | null; attempt?: number | null;
  phase: string; state: string; purpose?: 'repair' };

class ActivityCosts {
  readonly sources = new Map<string, { phase: string; start: string }>();
  readonly repair: Interval[] = [];
  readonly review: Interval[] = [];
  readonly waiting: Interval[] = [];
  private readonly seenReview = new Set<string>();
  accept(event: ActivityEvent, at: string): void {
    const key = JSON.stringify([event.operationId, event.sourceId]);
    const prior = this.sources.get(key);
    if (prior) { this.close(prior, at); }
    if (event.state !== 'running') { this.sources.delete(key); return; }
    const phase = this.reviewPhase(event, prior?.phase);
    this.sources.set(key, { phase, start: at });
  }
  private close(prior: { phase: string; start: string }, at: string): void {
    const times = interval(prior.start, at);
    if (['repair', 'review-response', 'recovery'].includes(prior.phase)) { this.repair.push(...times); }
    if (prior.phase === 're-review') { this.review.push(...times); }
    if (prior.phase === 'waiting') { this.waiting.push(...times); }
  }
  private reviewPhase(event: ActivityEvent, prior?: string): string {
    if (event.purpose === 'repair') { return 'repair'; }
    if (event.phase !== 'review') { return event.phase; }
    const repeated = this.seenReview.has(event.missionId) && !['review', 're-review'].includes(prior ?? '');
    this.seenReview.add(event.missionId);
    return repeated || prior === 're-review' ? 're-review' : 'review';
  }
}

function activityCosts(input: VerificationStatisticsInput, missions: ReadonlySet<string> | undefined,
  unknowns: Set<string>): { repairMs: number | null; reReviewMs: number | null; waiting: Interval[] } {
  const costs = new ActivityCosts();
  const publications = new Set<string>();
  for (const entry of input.history) {
    if (entry.eventType !== 'mission.current-work') { continue; }
    const event = readActivityEvent(entry.eventData, input.repositoryId, missions, unknowns);
    if (!event?.sourceId) { continue; }
    const publication = JSON.stringify([event.operationId, event.operationGeneration, event.sourceId, event.phase, event.state, entry.createdAt]);
    if (publications.has(publication)) { continue; }
    publications.add(publication);
    costs.accept(event, entry.createdAt);
  }
  if (costs.sources.size) { unknowns.add('Open activity intervals excluded'); }
  return { repairMs: costs.repair.length ? intervalUnionMs(costs.repair) : null,
    reReviewMs: costs.review.length ? intervalUnionMs(costs.review) : null, waiting: costs.waiting };
}

function readActivityEvent(eventData: string, repositoryId: string, missions: ReadonlySet<string> | undefined,
  unknowns: Set<string>): ActivityEvent | null {
  let event: ActivityEvent;
  try { event = JSON.parse(eventData) as ActivityEvent; }
  catch { unknowns.add('Unreadable activity boundaries'); return null; }
  if (event.repositoryId !== repositoryId || missions && !missions.has(event.missionId)) { return null; }
  if (!event.sourceId || !event.operationId || event.operationGeneration === null || event.operationGeneration === undefined
    || event.state === 'running' && !event.revision) {
    unknowns.add(`Activity identity incomplete for ${event.missionId || 'unknown mission'} operation ${event.operationId || 'unknown'} source ${event.sourceId ?? 'unknown'}; rerun the affected workflow with FLOW collection enabled`);
  }
  return event;
}

function attemptRecovery(executed: readonly VerificationMeasurement[], unknowns: Set<string>) {
  const seen = new Set<string>(), reruns: VerificationMeasurement[] = [], recoveries: Interval[] = [];
  const failed = new Map<string, string>();
  for (const attempt of executed) {
    if (!attempt.missionId) { continue; }
    const key = JSON.stringify([attempt.missionId, attempt.phase, attempt.gate, attempt.command]);
    if (seen.has(key)) { reruns.push(attempt); }
    seen.add(key);
    if (attempt.result === 'failed' && attempt.finishedAt && !failed.has(key)) { failed.set(key, attempt.finishedAt); }
    if (attempt.result === 'passed' && failed.has(key)) {
      recoveries.push(...interval(failed.get(key)!, attempt.finishedAt)); failed.delete(key);
    }
  }
  if (failed.size) { unknowns.add('Recovery remains open after failure'); }
  return { reruns, recoveries };
}

function lifetimeCosts(input: VerificationStatisticsInput, missions: ReadonlySet<string> | undefined, unknowns: Set<string>) {
  const scoped = input.lifecycle.filter(e => !missions || missions.has(e.missionId));
  const missionIds = new Set(scoped.filter(e => e.repositoryId === input.repositoryId).map(e => e.missionId));
  let endToEndMs = 0;
  let measuredMissions = 0;
  let completedMissions = 0;
  for (const mission of missionIds) {
    const events = scoped.filter(e => e.repositoryId === input.repositoryId && e.missionId === mission)
      .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
    const refined = events.find(e => e.toStatus === 'refined');
    const completed = events.find(e => e.toStatus === 'done'
      && (!refined || Date.parse(e.occurredAt) >= Date.parse(refined.occurredAt)));
    if (completed) { completedMissions++; }
    const measured = interval(refined?.occurredAt ?? null, completed?.occurredAt ?? null);
    if (measured.length) { measuredMissions++; endToEndMs += measured[0]![1] - measured[0]![0]; }
    else { unknowns.add(`Refined-to-first-delivery boundary incomplete for ${mission}; rerun the affected fresh workflow with FLOW collection enabled`); }
  }
  return { endToEndMs: measuredMissions ? endToEndMs : null, completedMissions };
}

function measurementUnknowns(attempts: readonly VerificationMeasurement[], unknowns: Set<string>): void {
  if (!attempts.length) { unknowns.add('No retained attempts; historical work is unavailable, not zero'); }
  for (const attempt of attempts.filter(a => !a.operationId || a.operationGeneration === null || a.operationGeneration === undefined || !a.sourceId)) {
    unknowns.add(`Gate identity incomplete for ${attempt.missionId ?? 'unknown mission'} operation ${attempt.operationId ?? 'unknown'} source ${attempt.sourceId ?? 'unknown'}; rerun the affected workflow with FLOW collection enabled`);
  }
  if (attempts.some(a => !a.revision)) { unknowns.add('Some attempts have no observed revision'); }
  if (attempts.some(a => !a.missionId)) { unknowns.add('Some attempts have no mission identity'); }
  const executed = attempts.filter(a => a.result !== 'reused');
  if (executed.some(a => !a.finishedAt)) { unknowns.add('Unsettled or interrupted attempts have partial timing only'); }
  if (executed.some(a => !a.cpu)) { unknowns.add('OS CPU missing for some attempts; observed CPU is partial'); }
}

function revisionComparisons(executed: readonly VerificationMeasurement[]): VerificationStatistics['comparisons'] {
  const comparisons: VerificationStatistics['comparisons'][number][] = [];
  for (const gate of new Set(executed.map(a => a.gate))) {
    const rows = executed.filter(a => a.gate === gate && a.revision);
    const revisions = [...new Set(rows.map(a => a.revision!))];
    if (revisions.length < 2) { continue; }
    const before = revisions.at(-2)!, after = revisions.at(-1)!;
    const left = rows.filter(a => a.revision === before), right = rows.filter(a => a.revision === after);
    const configurations = [...left, ...right].map(a => a.configuration);
    comparisons.push({ gate, before, after, beforeN: left.length, afterN: right.length,
      configurationEquivalent: configurations.some(c => !c) ? null : new Set(configurations).size === 1,
      workloadEquivalent: 'unobserved', beforeWallMs: cost(left).wallMs, afterWallMs: cost(right).wallMs });
  }
  return comparisons;
}

function controlledComparisons(attempts: readonly VerificationMeasurement[], unknowns: Set<string>): ControlledVerificationComparison[] {
  const controlled = new Map<string, ControlledVerificationComparison>();
  for (const comparison of attempts.flatMap(attempt => attempt.profile?.controlledComparisons ?? [])) {
    const key = `${comparison.experimentId}:${comparison.coverage}`, prior = controlled.get(key);
    if (prior && JSON.stringify(prior) !== JSON.stringify(comparison)) {
      unknowns.add(`Conflicting controlled profile comparison ${comparison.experimentId} coverage=${comparison.coverage}`);
      controlled.delete(key);
    } else if (!prior) { controlled.set(key, comparison); }
  }
  return [...controlled.values()];
}

export function verificationStatistics(input: VerificationStatisticsInput,
  missions?: ReadonlySet<string>): VerificationStatistics {
  const unknowns = new Set<string>(input.collectionDefects ?? []);
  const attempts = observedAttempts(input, unknowns).filter(a => !missions || a.missionId !== null && missions.has(a.missionId));
  const allRebases = observedRebases(input, unknowns);
  const rebases = allRebases.filter(value => !missions || missions.has(value.missionId));
  const executed = attempts.filter(a => a.result !== 'reused');
  const intervals = executed.flatMap(execution);
  const { reruns, recoveries } = attemptRecovery(executed, unknowns);
  const activity = activityCosts(input, missions, unknowns);
  const waiting = [...executed.flatMap(a => interval(a.requestedAt, a.startedAt)), ...activity.waiting];
  // Waiting can overlap a nested command. Count only the portion outside execution.
  const executionMs = intervals.length ? intervalUnionMs(intervals) : null;
  const waitingMs = waiting.length ? intervalUnionMs([...waiting, ...intervals]) - intervalUnionMs(intervals) : null;
  const batches = [...new Set(attempts.map(a => a.batchId))].map(batchId => ({ batchId,
    criticalPathMs: criticalPath(attempts.filter(a => a.batchId === batchId)) }));
  const lifecycle = lifetimeCosts(input, missions, unknowns);
  const ownership = flowElapsedOwnership(input, unknowns, missions);
  const resources = agentResources(input, missions, unknowns);
  const scopedRuns = resources.runs.map(row => (input.runs ?? []).find(run => run.runId === row.runId)!).filter(Boolean);
  const dependencyPath = ownershipDependencyPath(ownership, scopedRuns) ?? observedDagDependencyPath(input, attempts);
  const cpu = cpuCost(executed, unknowns);
  measurementUnknowns(attempts, unknowns);
  if (!dependencyPath && (batches.length !== 1 || batches.some(b => b.criticalPathMs === null))) {
    unknowns.add('End-to-end critical path unknown; only complete observed gate DAGs are measured');
  }
  const recoveryAttempts = executed.filter(a => execution(a).some(([start, end]) => recoveries.some(([a, b]) => start >= a && end <= b)));
  const comparisons = revisionComparisons(executed), controlled = controlledComparisons(attempts, unknowns);
  const flowMissions = observedFlowMissions(input, ownership, attempts, rebases, firstRebaseCollection(allRebases));
  return { attempts, attemptCount: executed.length, failureCount: executed.filter(a => a.result === 'failed').length,
    infrastructureFailureCount: executed.filter(a => a.failureReason?.code === 'infrastructure').length,
    reusedProofCount: attempts.length - executed.length, incompleteCount: executed.filter(a => !a.finishedAt).length,
    ...lifecycle, executionMs, waitingMs,
    overlapMs: intervals.length ? intervals.reduce((sum, [a, b]) => sum + b - a, 0) - intervalUnionMs(intervals) : null,
    ...cpu, rerunCount: reruns.length, rerun: cost(reruns),
    recovery: { ...cpuCost(recoveryAttempts), wallMs: recoveries.length ? intervalUnionMs(recoveries) : null },
    repairMs: activity.repairMs, reReviewMs: activity.reReviewMs,
    criticalPathMs: dependencyPath?.durationMs ?? (batches.length === 1 ? batches[0].criticalPathMs : null),
    dependencyPath, elapsedOwnership: ownership, agentResources: resources, flowMissions, rebases, batches,
    ranked: [...new Set(executed.map(a => a.gate))].map(gate => { const rows = executed.filter(a => a.gate === gate);
      const c = cost(rows); return { gate, attempts: rows.length, wallMs: c.wallMs, cpuUs: c.cpuUs };
    }).sort((a, b) => (b.wallMs ?? -1) - (a.wallMs ?? -1)),
    unknowns: [...unknowns], comparisons, controlledComparisons: controlled,
    profileReferences: [...new Set(attempts.flatMap(a => a.profile ? [a.profile.reference] : []))] };
}
