import type { MissionId, MissionStatus } from './mission.js';
import type { RepositoryId } from './repository.js';

/** One admitted command, encompassing preparation, launches and verification. */
export type WorkflowCommand = 'active:execute' | 'draft:create' | 'review:submit' | 'rebase:run' | 'integrate:merge';
export const isWorkflowCommand = (kind: string): kind is WorkflowCommand =>
  ['active:execute', 'draft:create', 'review:submit', 'rebase:run', 'integrate:merge'].includes(kind);
export type WorkflowPhase = 'accepted' | 'executing' | 'stopping' | 'completed' | 'blocked' | 'interrupted' | 'stopped';
export interface WorkflowOperation {
  /** Version of the checked activation; compensation may only undo that write. */
  readonly activationVersion?: number;
  readonly id: string;
  readonly repositoryId: RepositoryId;
  readonly missionId: MissionId;
  readonly requestKey: string;
  readonly command: WorkflowCommand;
  readonly generation: number;
  readonly phase: WorkflowPhase;
  readonly providerStarted: boolean;
  readonly agent: string | null;
  readonly reviewer: string | null;
  readonly originalStatus: MissionStatus;
  readonly previousAssignee: string | null;
  readonly owner: { readonly pid: number; readonly identity: string } | null;
  /** Supervisor reservation prevents duplicate capture/dispatch before executor claim. */
  readonly launcher?: { readonly pid: number; readonly identity: string } | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly reason: string | null;
}

export const isOpenWorkflow = (operation: WorkflowOperation): boolean =>
  ['accepted', 'executing', 'stopping'].includes(operation.phase);

export function requireWorkflowOwner(operation: WorkflowOperation, generation: number): void {
  if (operation.generation !== generation || operation.phase !== 'executing' || !operation.owner) {
    throw new WorkflowOwnershipError('Workflow ownership was fenced or stopped');
  }
}

/**
 * The exact generation that produced retained observations. This is a read of
 * lifecycle history, not current write authority: `requireWorkflowOwner`
 * admits writes only while executing, whereas settled observations remain
 * joinable. A settled stop advances its fence once, so its retained producer
 * is the preceding generation. No earlier or merely-lower generation passes.
 */
function historicalObservationGeneration(operation: WorkflowOperation): number | null {
  if (!Number.isSafeInteger(operation.generation) || operation.generation < 1 || operation.phase === 'accepted') {
    return null;
  }
  if (operation.phase === 'stopped') {
    return operation.generation > 1 ? operation.generation - 1 : null;
  }
  return operation.generation;
}

export interface WorkflowObservationReference {
  readonly repositoryId: string | null | undefined;
  readonly missionId: string | null | undefined;
  readonly operationId: string | null | undefined;
  readonly generation: number | null | undefined;
}

export type WorkflowObservationAuthorization = 'authorized' | 'incomplete' | 'unavailable' | 'rejected';

/** One owner for every current or historical observation-to-operation authorization. */
export function workflowObservationAuthorization(operation: WorkflowOperation | null | undefined,
  identity: WorkflowObservationReference): WorkflowObservationAuthorization {
  if (!identity.repositoryId || !identity.missionId || !identity.operationId
    || identity.generation === null || identity.generation === undefined) {
    return 'incomplete';
  }
  if (!operation) { return 'unavailable'; }
  return operation.id === identity.operationId
    && operation.repositoryId === identity.repositoryId
    && operation.missionId === identity.missionId
    && historicalObservationGeneration(operation) === identity.generation
    ? 'authorized' : 'rejected';
}

/** Distinguishes ownership rejection from validation or persistence failures. */
export class WorkflowOwnershipError extends Error {}

export function finishWorkflow(operation: WorkflowOperation, generation: number, success: boolean, reason: string | null, now: string): WorkflowOperation {
  requireWorkflowOwner(operation, generation);
  return { ...operation, phase: success ? 'completed' : 'blocked', reason, updatedAt: now };
}

export function requestWorkflowStop(operation: WorkflowOperation, now: string): WorkflowOperation {
  if (!isOpenWorkflow(operation)) { throw new Error('Workflow is already settled'); }
  return { ...operation, phase: 'stopping', updatedAt: now };
}

export function loseWorkflowOwner(operation: WorkflowOperation, generation: number, liveness: false | null, now: string): WorkflowOperation {
  requireWorkflowOwner(operation, generation);
  return { ...operation, phase: liveness === false ? 'interrupted' : 'stopping', updatedAt: now,
    reason: liveness === false ? 'Workflow owner exited; reconcile external effects before explicitly resuming'
      : 'Workflow ownership is uncertain; replacement is refused until termination is confirmed' };
}

/** An admitted command has no executing owner until one process claims it. */
export function workflowOperation(operation: WorkflowOperation): WorkflowOperation {
  if (!operation.id.trim() || operation.id.length > 128 || !operation.requestKey.trim() || operation.requestKey.length > 128) {
    throw new Error('Workflow identity and request key must contain 1–128 characters');
  }
  if (operation.phase !== 'accepted' || operation.owner !== null || operation.generation !== 0 || operation.providerStarted) {
    throw new Error('New workflow operations must be unclaimed accepted intent');
  }
  return Object.freeze(operation);
}

/** One process wins the claim. Provider launches do not mint workflow owners. */
export function claimWorkflow(operation: WorkflowOperation, owner: NonNullable<WorkflowOperation['owner']>, now: string): WorkflowOperation {
  if (operation.phase !== 'accepted' || operation.owner) { throw new Error('Workflow is already claimed or settled'); }
  if (!Number.isSafeInteger(owner.pid) || owner.pid < 1 || !owner.identity.trim()) { throw new Error('Workflow owner requires observed process identity'); }
  return { ...operation, owner, generation: operation.generation + 1, phase: 'executing', updatedAt: now };
}

/** Settling stop revokes the old generation before another command can admit. */
export function settleWorkflowStop(operation: WorkflowOperation, now: string): WorkflowOperation {
  if (operation.phase !== 'stopping') { throw new Error('Workflow termination must be requested and confirmed first'); }
  return { ...operation, generation: operation.generation + 1, phase: 'stopped', reason: 'Stopped by operator', updatedAt: now };
}
