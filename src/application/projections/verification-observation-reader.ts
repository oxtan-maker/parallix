import type { OperationalHistoryEntry } from '../ports/operation-history.js';
import { VERIFICATION_MEASUREMENT_EVENT, type VerificationMeasurement } from '../ports/verification-observation.js';
import { workflowObservationAuthorization, type WorkflowOperation } from '../../domain/workflow-operation.js';
import { REBASE_OBSERVATION_OUTCOMES, REBASE_OBSERVATION_STAGES,
  type RebaseObservationOutcome, type RebaseObservationStage } from '../ports/rebase-workflow.js';
import { compareCodeUnits } from '../../domain/comparators.js';
import type { ObservationDiagnostic } from './verification-diagnostic.js';

interface ObservationReaderInput {
  readonly repositoryId: string;
  readonly history: readonly OperationalHistoryEntry[];
  readonly operations: readonly WorkflowOperation[];
}

export type RebaseObservationCutovers = Readonly<Partial<Record<RebaseObservationStage, string>>>;

/** The first structurally identifiable retained row proves stage instrumentation,
 * even when its workflow join is rejected from the measured population. */
export function observedRebaseCutovers(input: Pick<ObservationReaderInput, 'repositoryId' | 'history'>): RebaseObservationCutovers {
  const cutovers: Partial<Record<RebaseObservationStage, string>> = {};
  for (const entry of input.history) {
    if (entry.eventType !== 'flow.rebase') { continue; }
    let value: Partial<RebaseMeasurement>;
    try { value = JSON.parse(entry.eventData) as Partial<RebaseMeasurement>; }
    catch { continue; }
    if (value.repositoryId !== input.repositoryId || !value.stage || !REBASE_OBSERVATION_STAGES.includes(value.stage)
      || typeof value.occurredAt !== 'string' || !value.occurredAt) { continue; }
    const prior = cutovers[value.stage];
    if (!prior || compareCodeUnits(value.occurredAt, prior) < 0) { cutovers[value.stage] = value.occurredAt; }
  }
  return cutovers;
}

export interface RebaseMeasurement {
  readonly id: string; readonly repositoryId: string; readonly missionId: string;
  readonly operationId: string | null; readonly generation: number | null; readonly sourceId: string;
  readonly stage: RebaseObservationStage; readonly attempt: number;
  readonly outcome: RebaseObservationOutcome;
  readonly inapplicability?: string;
  readonly revisionBefore: string | null; readonly revisionAfter: string | null;
  readonly conflicts: readonly string[]; readonly occurredAt: string;
}

export function observedRebases(input: ObservationReaderInput, unknowns: Set<string>, diagnostics: ObservationDiagnostic[] = []): RebaseMeasurement[] {
  const snapshots = new Map<string, RebaseMeasurement>();
  const operations = new Map(input.operations.map(value => [value.id, value]));
  for (const entry of input.history) {
    if (entry.eventType !== 'flow.rebase') { continue; }
    const value = readRebase(entry.eventData, input.repositoryId, operations, unknowns, diagnostics);
    if (value) { snapshots.set(`${value.id}:${value.attempt}:${value.outcome}`, value); }
  }
  return [...snapshots.values()].sort((a, b) => compareCodeUnits(a.occurredAt, b.occurredAt)
    || compareCodeUnits(a.id, b.id) || a.attempt - b.attempt || compareCodeUnits(a.outcome, b.outcome));
}

function readRebase(eventData: string, repositoryId: string, operations: ReadonlyMap<string, WorkflowOperation>,
  unknowns: Set<string>, diagnostics: ObservationDiagnostic[]): RebaseMeasurement | null {
  let value: RebaseMeasurement;
  try { value = JSON.parse(eventData) as RebaseMeasurement; }
  catch { unknowns.add('Unreadable rebase observation'); return null; }
  if (value.repositoryId !== repositoryId) { return null; }
  if (!validRebase(value)) {
    recordMalformedRebase(value, repositoryId, unknowns, diagnostics);
    return null;
  }
  const operation = value.operationId ? operations.get(value.operationId) : null;
  if (!matchingRebaseOperation(value, operation)) {
    const message = `Rebase workflow join missing for ${value.missionId} source ${value.sourceId}`;
    diagnostics.push(observationDiagnostic(value, 'identity', 'absent', value.stage, message,
      'inspect retained workflow operation identity')); return null;
  }
  return value;
}

function recordMalformedRebase(value: RebaseMeasurement, repositoryId: string, unknowns: Set<string>,
  diagnostics: ObservationDiagnostic[]): void {
  const scopedMission = typeof value.missionId === 'string' && value.missionId ? value.missionId : null;
  const message = `Malformed rebase observation for ${scopedMission ?? 'unknown mission'}`;
  if (!scopedMission) { unknowns.add(message); return; }
  diagnostics.push({ kind: 'identity', state: 'absent', repositoryId,
    missionId: scopedMission, operationId: typeof value.operationId === 'string' ? value.operationId : null,
    sourceId: typeof value.sourceId === 'string' ? value.sourceId : null,
    stage: typeof value.stage === 'string' ? value.stage : 'rebase', message,
    recovery: 'inspect retained rebase observation' });
}

function matchingRebaseOperation(value: RebaseMeasurement, operation: WorkflowOperation | null | undefined): boolean {
  return workflowObservationAuthorization(operation, { repositoryId: value.repositoryId,
    missionId: value.missionId, operationId: value.operationId, generation: value.generation }) === 'authorized';
}

function validRebase(value: RebaseMeasurement): boolean {
  return Boolean(value.id && value.missionId && value.sourceId && value.operationId) && Number.isSafeInteger(value.attempt)
    && REBASE_OBSERVATION_STAGES.includes(value.stage)
    && REBASE_OBSERVATION_OUTCOMES.includes(value.outcome)
    && (value.outcome !== 'inapplicable' || Boolean(value.inapplicability));
}

export function observedAttempts(input: ObservationReaderInput, unknowns: Set<string>, diagnostics: ObservationDiagnostic[] = []): VerificationMeasurement[] {
  const latest = new Map<string, VerificationMeasurement>();
  const operations = new Map(input.operations.map(op => [op.id, op]));
  for (const entry of input.history) {
    if (entry.eventType !== VERIFICATION_MEASUREMENT_EVENT) {continue;}
    const value = readAttempt(entry.eventData, input.repositoryId, operations, unknowns, diagnostics);
    if (!value) { continue; }
    const prior = latest.get(value.id);
    if (prior && !sameIdentity(prior, value)) {
      unknowns.add('Conflicting attempt identity excluded'); latest.delete(value.id); continue;
    }
    latest.set(value.id, value);
  }
  return [...latest.values()].sort((a, b) => compareCodeUnits(a.requestedAt, b.requestedAt) || compareCodeUnits(a.id, b.id));
}

function readAttempt(eventData: string, repositoryId: string, operations: ReadonlyMap<string, WorkflowOperation>,
  unknowns: Set<string>, diagnostics: ObservationDiagnostic[]): VerificationMeasurement | null {
  let value: VerificationMeasurement;
  try { value = JSON.parse(eventData) as VerificationMeasurement; }
  catch { unknowns.add('Unreadable attempt observation excluded'); return null; }
  if (value.repositoryId !== repositoryId) { return null; }
  const operation = value.operationId ? operations.get(value.operationId) : null;
  if (mismatchedAttemptOperation(value, operation)) {
    recordScopedAttemptDiagnostic(value, 'Attempt workflow identity mismatch excluded',
      'inspect retained workflow operation identity', unknowns, diagnostics);
    return null;
  }
  if (!recordAttemptIdentityDiagnostic(value, operation, unknowns, diagnostics)) { return null; }
  if (!validAttempt(value)) {
    recordScopedAttemptDiagnostic(value, 'Malformed attempt observations excluded',
      'inspect retained gate observation', unknowns, diagnostics);
    return null;
  }
  return value;
}

function recordAttemptIdentityDiagnostic(value: VerificationMeasurement, operation: WorkflowOperation | null | undefined,
  unknowns: Set<string>, diagnostics: ObservationDiagnostic[]): boolean {
  const authorization = workflowObservationAuthorization(operation, { repositoryId: value.repositoryId,
    missionId: value.missionId, operationId: value.operationId, generation: value.operationGeneration });
  const incompleteIdentity = incompleteAttemptIdentity(value);
  if (incompleteIdentity) {
    const message = `Gate identity incomplete for ${value.missionId ?? 'unknown mission'} operation ${value.operationId ?? 'unknown'} source ${value.sourceId ?? 'unknown'}`;
    const recovery = 'inspect the retained gate and workflow identities';
    recordScopedAttemptDiagnostic(value, message, recovery, unknowns, diagnostics, `${message}; ${recovery}`);
  } else if (authorization === 'unavailable') {
    const message = `Gate workflow join missing for ${value.missionId ?? 'unknown mission'} operation ${value.operationId} source ${value.sourceId ?? 'unknown'}`;
    const recovery = 'inspect the retained gate and workflow identities';
    recordScopedAttemptDiagnostic(value, message, recovery, unknowns, diagnostics, `${message}; ${recovery}`);
  }
  if (operation && authorization !== 'authorized') {
    if (!incompleteIdentity) {
      const message = `Gate workflow generation rejected for ${value.missionId ?? 'unknown mission'} operation ${value.operationId} source ${value.sourceId ?? 'unknown'}`;
      recordScopedAttemptDiagnostic(value, message, 'inspect retained workflow operation identity', unknowns, diagnostics);
    }
    return false;
  }
  return true;
}

const incompleteAttemptIdentity = (value: VerificationMeasurement): boolean => !value.operationId
  || value.operationGeneration === null || value.operationGeneration === undefined || !value.sourceId;

function recordScopedAttemptDiagnostic(value: VerificationMeasurement, message: string, recovery: string,
  unknowns: Set<string>, diagnostics: ObservationDiagnostic[], unknownMessage = message): void {
  if (typeof value.missionId === 'string' && value.missionId) {
    diagnostics.push(observationDiagnostic(value, 'identity', 'absent', 'gate', message, recovery));
  } else { unknowns.add(unknownMessage); }
}

function observationDiagnostic(value: { readonly repositoryId: string; readonly missionId: string | null;
  readonly operationId?: string | null; readonly sourceId?: string | null }, kind: ObservationDiagnostic['kind'],
state: ObservationDiagnostic['state'], stage: string, message: string, recovery: string): ObservationDiagnostic {
  return { kind, state, repositoryId: value.repositoryId, missionId: value.missionId ?? 'unknown',
    operationId: value.operationId ?? null, sourceId: value.sourceId ?? null, stage, message, recovery };
}

function mismatchedAttemptOperation(value: VerificationMeasurement, operation: WorkflowOperation | null | undefined): boolean {
  return Boolean(operation && (operation.repositoryId !== value.repositoryId || operation.missionId !== value.missionId));
}

function validAttempt(value: VerificationMeasurement): boolean {
  return [value.id, value.gate, value.batchId, value.command].every(field => typeof field === 'string')
    && ['running', 'passed', 'failed', 'interrupted', 'reused'].includes(value.result)
    && Number.isFinite(Date.parse(value.requestedAt));
}

function sameIdentity(a: VerificationMeasurement, b: VerificationMeasurement): boolean {
  return a.repositoryId === b.repositoryId && a.missionId === b.missionId && a.operationId === b.operationId
    && a.operationGeneration === b.operationGeneration && a.sourceId === b.sourceId
    && a.gate === b.gate && a.revision === b.revision;
}
