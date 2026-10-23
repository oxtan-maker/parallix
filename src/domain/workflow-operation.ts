import type { MissionId, MissionStatus } from './mission.js';
import type { RepositoryId } from './repository.js';
import type { ReviewOperation } from './review-command-policy.js';

/** One admitted command, encompassing preparation, launches and verification. */
export type WorkflowCommand = 'active:execute' | 'draft:create' | 'handoff:record' | 'review:submit' | 'integrate:merge';
export const isWorkflowCommand = (kind: string): kind is WorkflowCommand =>
  ['active:execute', 'draft:create', 'handoff:record', 'review:submit', 'integrate:merge'].includes(kind);
export type WorkflowPhase = 'accepted' | 'preparing' | 'waiting' | 'running' | 'checking' | 'stopping' | 'completed' | 'blocked' | 'interrupted' | 'stopped';
export interface WorkflowOperation {
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
  ['accepted', 'preparing', 'waiting', 'running', 'checking', 'stopping'].includes(operation.phase);

export function requireWorkflowOwner(operation: WorkflowOperation, generation: number): void {
  if (operation.generation !== generation || !isOpenWorkflow(operation) || operation.phase === 'stopping') {
    throw new Error('Workflow ownership was fenced or stopped');
  }
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
  return { ...operation, owner, generation: operation.generation + 1, phase: 'preparing', updatedAt: now };
}

/** Settling stop revokes the old generation before another command can admit. */
export function settleWorkflowStop(operation: WorkflowOperation, now: string): WorkflowOperation {
  if (operation.phase !== 'stopping') { throw new Error('Workflow termination must be requested and confirmed first'); }
  return { ...operation, generation: operation.generation + 1, phase: 'stopped', reason: 'Stopped by operator', updatedAt: now };
}

/** Admission eligibility is independent of board projections and native hosts. */
export function workflowEligible(command: WorkflowCommand, status: MissionStatus, approvedReview = false, fixingReview = false, reviewMode?: ReviewOperation): boolean {
  switch (command) {
    case 'active:execute': return status === 'refined' || status === 'active' || status === 'review' && fixingReview;
    case 'draft:create': return status === 'backlog';
    case 'handoff:record': return status === 'active';
    case 'review:submit': return reviewWorkflowEligible(status, reviewMode);
    case 'integrate:merge': return status === 'integration' || approvedReview && (status === 'active' || status === 'review');
  }
}

function reviewWorkflowEligible(status: MissionStatus, mode: ReviewOperation | undefined): boolean {
  return status === 'review' || status === 'integration' && mode === 'enter';
}
