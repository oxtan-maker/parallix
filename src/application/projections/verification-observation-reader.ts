import type { OperationalHistoryEntry } from '../ports/operation-history.js';
import { VERIFICATION_MEASUREMENT_EVENT, type VerificationMeasurement } from '../ports/verification-observation.js';
import type { WorkflowOperation } from '../../domain/workflow-operation.js';

interface ObservationReaderInput {
  readonly repositoryId: string;
  readonly history: readonly OperationalHistoryEntry[];
  readonly operations: readonly WorkflowOperation[];
}

export interface RebaseMeasurement {
  readonly id: string; readonly repositoryId: string; readonly missionId: string;
  readonly operationId: string | null; readonly generation: number | null; readonly sourceId: string;
  readonly stage: 'direct-rebase' | 'pre-review-rebase' | 'integration-rebase'; readonly attempt: number;
  readonly outcome: 'running' | 'no-op' | 'clean' | 'conflict' | 'resolved' | 'failed';
  readonly revisionBefore: string | null; readonly revisionAfter: string | null;
  readonly conflicts: readonly string[]; readonly occurredAt: string;
}

export function observedRebases(input: ObservationReaderInput, unknowns: Set<string>): RebaseMeasurement[] {
  const snapshots = new Map<string, RebaseMeasurement>();
  const operations = new Map(input.operations.map(value => [value.id, value]));
  for (const entry of input.history) {
    if (entry.eventType !== 'flow.rebase') { continue; }
    const value = readRebase(entry.eventData, input.repositoryId, operations, unknowns);
    if (value) { snapshots.set(`${value.id}:${value.attempt}:${value.outcome}`, value); }
  }
  return [...snapshots.values()].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)
    || a.id.localeCompare(b.id) || a.attempt - b.attempt || a.outcome.localeCompare(b.outcome));
}

function readRebase(eventData: string, repositoryId: string, operations: ReadonlyMap<string, WorkflowOperation>,
  unknowns: Set<string>): RebaseMeasurement | null {
  let value: RebaseMeasurement;
  try { value = JSON.parse(eventData) as RebaseMeasurement; }
  catch { unknowns.add('Unreadable rebase observation'); return null; }
  if (value.repositoryId !== repositoryId) { return null; }
  if (!validRebase(value)) {
    unknowns.add(`Malformed rebase observation for ${value.missionId || 'unknown mission'}`); return null;
  }
  const operation = value.operationId ? operations.get(value.operationId) : null;
  if (!operation || operation.missionId !== value.missionId
    || operation.repositoryId !== value.repositoryId || operation.generation !== value.generation) {
    unknowns.add(`Rebase workflow join missing for ${value.missionId} source ${value.sourceId}`); return null;
  }
  return value;
}

function validRebase(value: RebaseMeasurement): boolean {
  return Boolean(value.id && value.missionId && value.sourceId && value.operationId) && Number.isSafeInteger(value.attempt)
    && ['direct-rebase', 'pre-review-rebase', 'integration-rebase'].includes(value.stage)
    && ['running', 'no-op', 'clean', 'conflict', 'resolved', 'failed'].includes(value.outcome);
}

export function observedAttempts(input: ObservationReaderInput, unknowns: Set<string>): VerificationMeasurement[] {
  const latest = new Map<string, VerificationMeasurement>();
  const operations = new Map(input.operations.map(op => [op.id, op]));
  for (const entry of input.history) {
    if (entry.eventType !== VERIFICATION_MEASUREMENT_EVENT) {continue;}
    const value = readAttempt(entry.eventData, input.repositoryId, operations, unknowns);
    if (!value) { continue; }
    const prior = latest.get(value.id);
    if (prior && !sameIdentity(prior, value)) {
      unknowns.add('Conflicting attempt identity excluded'); latest.delete(value.id); continue;
    }
    latest.set(value.id, value);
  }
  return [...latest.values()].sort((a, b) => a.requestedAt.localeCompare(b.requestedAt) || a.id.localeCompare(b.id));
}

function readAttempt(eventData: string, repositoryId: string, operations: ReadonlyMap<string, WorkflowOperation>,
  unknowns: Set<string>): VerificationMeasurement | null {
  let value: VerificationMeasurement;
  try { value = JSON.parse(eventData) as VerificationMeasurement; }
  catch { unknowns.add('Unreadable attempt observation excluded'); return null; }
  if (value.repositoryId !== repositoryId) { return null; }
  const operation = value.operationId ? operations.get(value.operationId) : null;
  if (mismatchedAttemptOperation(value, operation)) {
    unknowns.add('Attempt workflow identity mismatch excluded'); return null;
  }
  if (value.operationId && (!operation || operation.generation !== value.operationGeneration)) {
    unknowns.add(`Gate workflow join missing for ${value.missionId ?? 'unknown mission'} operation ${value.operationId} source ${value.sourceId ?? 'unknown'}; rerun the affected workflow with FLOW collection enabled`);
  }
  if (!value.sourceId) {
    unknowns.add(`Gate source identity missing for ${value.missionId ?? 'unknown mission'} operation ${value.operationId ?? 'unknown'}; rerun the affected workflow with FLOW collection enabled`);
  }
  if (!validAttempt(value)) { unknowns.add('Malformed attempt observations excluded'); return null; }
  return value;
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
