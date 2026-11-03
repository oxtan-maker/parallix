import type { OperationalHistoryEntry, BoardLaneEventEntry } from '../ports/operation-history.js';
import { VERIFICATION_MEASUREMENT_EVENT, type VerificationMeasurement } from '../ports/verification-observation.js';
import type { WorkflowOperation } from '../../domain/workflow-operation.js';
import { missionLifecycles } from './metrics-outcomes.js';
import type { RepositoryId } from '../../domain/repository.js';

type Interval = readonly [number, number];
export interface VerificationStatisticsInput {
  readonly repositoryId: string;
  readonly history: readonly OperationalHistoryEntry[];
  readonly operations: readonly WorkflowOperation[];
  readonly lifecycle: readonly BoardLaneEventEntry[];
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
  readonly batches: readonly { batchId: string; criticalPathMs: number | null }[];
  readonly ranked: readonly { gate: string; attempts: number; wallMs: number | null; cpuUs: number | null }[];
  readonly completedMissions: number;
  readonly unknowns: readonly string[];
  readonly profileReferences: readonly string[];
  readonly comparisons: readonly { gate: string; before: string; after: string; beforeN: number; afterN: number;
    configurationEquivalent: boolean | null; workloadEquivalent: 'unknown'; beforeWallMs: number | null; afterWallMs: number | null }[];
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

function observedAttempts(input: VerificationStatisticsInput, unknowns: Set<string>): VerificationMeasurement[] {
  const latest = new Map<string, VerificationMeasurement>();
  const operations = new Map(input.operations.map(op => [op.id, op]));
  for (const entry of input.history) {
    if (entry.eventType !== VERIFICATION_MEASUREMENT_EVENT) {continue;}
    try {
      const value = JSON.parse(entry.eventData) as VerificationMeasurement;
      if (value.repositoryId !== input.repositoryId) {continue;}
      const operation = value.operationId ? operations.get(value.operationId) : null;
      if (operation && (operation.repositoryId !== value.repositoryId || operation.missionId !== value.missionId)) {
        unknowns.add('Attempt workflow identity mismatch excluded'); continue;
      }
      if (value.operationId && !operation) {unknowns.add('Workflow join unavailable for some attempts');}
      if (!validAttempt(value)) { unknowns.add('Malformed attempt observations excluded'); continue; }
      const prior = latest.get(value.id);
      if (prior && !sameIdentity(prior, value)) {
        unknowns.add('Conflicting attempt identity excluded'); latest.delete(value.id); continue;
      }
      latest.set(value.id, value);
    } catch { unknowns.add('Unreadable attempt observation excluded'); }
  }
  return [...latest.values()].sort((a, b) => a.requestedAt.localeCompare(b.requestedAt) || a.id.localeCompare(b.id));
}

function validAttempt(value: VerificationMeasurement): boolean {
  return [value.id, value.gate, value.batchId, value.command].every(field => typeof field === 'string')
    && ['running', 'passed', 'failed', 'interrupted', 'reused'].includes(value.result)
    && Number.isFinite(Date.parse(value.requestedAt));
}
function sameIdentity(a: VerificationMeasurement, b: VerificationMeasurement): boolean {
  return a.repositoryId === b.repositoryId && a.missionId === b.missionId && a.operationId === b.operationId
    && a.gate === b.gate && a.revision === b.revision;
}

function execution(attempt: VerificationMeasurement): Interval[] {
  return attempt.result === 'reused' ? [] : interval(attempt.startedAt, attempt.finishedAt);
}

function cpuCost(attempts: readonly VerificationMeasurement[], unknowns?: Set<string>): { cpuUs: number | null; cpuObservations: number } {
  const boundaries = new Map(attempts.filter(a => a.cpu && Number.isFinite(a.cpu.userUs) && a.cpu.userUs >= 0
    && Number.isFinite(a.cpu.systemUs) && a.cpu.systemUs >= 0).map(a => [a.cpu!.boundary, a.cpu!]));
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
  sourceId?: string; phase: string; state: string; purpose?: 'repair' };

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
  const operations = new Map(input.operations.filter(op => op.repositoryId === input.repositoryId).map(op => [op.id, op]));
  const costs = new ActivityCosts();
  for (const entry of input.history) {
    if (entry.eventType !== 'mission.current-work') { continue; }
    try {
      const event = JSON.parse(entry.eventData) as ActivityEvent;
      if (event.repositoryId !== input.repositoryId && !operations.has(event.operationId)) { continue; }
      if (missions && !missions.has(event.missionId)) { continue; }
      if (!event.sourceId) { unknowns.add('Historical activity lacks source boundaries'); continue; }
      costs.accept(event, entry.createdAt);
    } catch { unknowns.add('Unreadable activity boundaries'); }
  }
  if (costs.sources.size) { unknowns.add('Open activity intervals excluded'); }
  return { repairMs: costs.repair.length ? intervalUnionMs(costs.repair) : null,
    reReviewMs: costs.review.length ? intervalUnionMs(costs.review) : null, waiting: costs.waiting };
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
  const lifecycles = missionLifecycles(scoped, input.repositoryId as RepositoryId);
  const lifetimes: Interval[] = [];
  let completedMissions = 0;
  for (const [mission, lifecycle] of lifecycles) {
    if (lifecycle.completedAt) { completedMissions++; }
    const hasIntake = scoped.some(e => e.repositoryId === input.repositoryId && e.missionId === mission && e.fromStatus === null);
    if (hasIntake && lifecycle.completedAt) { lifetimes.push(...interval(lifecycle.createdAt, lifecycle.completedAt)); }
    else { unknowns.add('End-to-end lifetime missing intake or completion'); }
  }
  return { endToEndMs: lifetimes.length ? intervalUnionMs(lifetimes) : null, completedMissions };
}

function measurementUnknowns(attempts: readonly VerificationMeasurement[], unknowns: Set<string>): void {
  if (!attempts.length) { unknowns.add('No retained attempts; historical work is unavailable, not zero'); }
  if (attempts.some(a => !a.operationId)) { unknowns.add('Some attempts have no workflow operation'); }
  if (attempts.some(a => !a.revision)) { unknowns.add('Some attempts have no observed revision'); }
  if (attempts.some(a => !a.missionId)) { unknowns.add('Some attempts have no mission identity'); }
  const executed = attempts.filter(a => a.result !== 'reused');
  if (executed.some(a => !a.finishedAt)) { unknowns.add('Unsettled or interrupted attempts have partial timing only'); }
  if (executed.some(a => !a.cpu)) { unknowns.add('OS CPU missing for some attempts; observed CPU is partial'); }
  unknowns.add('Repair and re-review agent CPU unavailable; gate CPU is not agent CPU');
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
      workloadEquivalent: 'unknown', beforeWallMs: cost(left).wallMs, afterWallMs: cost(right).wallMs });
  }
  return comparisons;
}

export function verificationStatistics(input: VerificationStatisticsInput,
  missions?: ReadonlySet<string>): VerificationStatistics {
  const unknowns = new Set<string>();
  const attempts = observedAttempts(input, unknowns).filter(a => !missions || a.missionId !== null && missions.has(a.missionId));
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
  const cpu = cpuCost(executed, unknowns);
  measurementUnknowns(attempts, unknowns);
  if (batches.length !== 1 || batches.some(b => b.criticalPathMs === null)) {
    unknowns.add('End-to-end critical path unknown; only complete observed gate DAGs are measured');
  }
  const recoveryAttempts = executed.filter(a => execution(a).some(([start, end]) => recoveries.some(([a, b]) => start >= a && end <= b)));
  const comparisons = revisionComparisons(executed);
  return { attempts, attemptCount: executed.length, failureCount: executed.filter(a => a.result === 'failed').length,
    infrastructureFailureCount: executed.filter(a => a.failureReason?.code === 'infrastructure').length,
    reusedProofCount: attempts.length - executed.length, incompleteCount: executed.filter(a => !a.finishedAt).length,
    ...lifecycle, executionMs, waitingMs,
    overlapMs: intervals.length ? intervals.reduce((sum, [a, b]) => sum + b - a, 0) - intervalUnionMs(intervals) : null,
    ...cpu, rerunCount: reruns.length, rerun: cost(reruns),
    recovery: { ...cpuCost(recoveryAttempts), wallMs: recoveries.length ? intervalUnionMs(recoveries) : null },
    repairMs: activity.repairMs, reReviewMs: activity.reReviewMs,
    criticalPathMs: batches.length === 1 ? batches[0].criticalPathMs : null, batches,
    ranked: [...new Set(executed.map(a => a.gate))].map(gate => {
      const rows = executed.filter(a => a.gate === gate);
      const c = cost(rows); return { gate, attempts: rows.length, wallMs: c.wallMs, cpuUs: c.cpuUs };
    }).sort((a, b) => (b.wallMs ?? -1) - (a.wallMs ?? -1)),
    unknowns: [...unknowns], comparisons,
    profileReferences: [...new Set(attempts.flatMap(a => a.profile ? [a.profile.reference] : []))] };
}
