import type { WorkflowOperation } from '../../domain/workflow-operation.js';
import type { ExecutionActivity } from '../../domain/execution-activity.js';
export type WorkflowOwnerRead = (_id: string) => Promise<WorkflowOperation | null>;

/** Composition installs the process owner's authorization before workflow effects. */
export interface MissionWriteAuthorization {
  readonly operationId: string;
  readonly start?: import('../execution-start-service.js').ExecutionStart;
  /** Child CLI writes are fenced by the parent, without inheriting control of it. */
  readonly inherited?: boolean;
  assert(_missionId: string, _read?: WorkflowOwnerRead): Promise<void>;
  providerStarted?(_agent: string): Promise<void>;
  activity?(_event: ExecutionActivity, _sourceId: string): Promise<void>;
}
let authorization: MissionWriteAuthorization | null = null;
export function configureMissionWriteAuthorization(port: MissionWriteAuthorization | null): void { authorization = port; }
export async function authorizeMissionWrite(missionId: string, read?: WorkflowOwnerRead): Promise<void> { await authorization?.assert(missionId, read); }

export async function reportAuthorizedActivity(event: ExecutionActivity, sourceId: string): Promise<boolean> {
  if (!authorization?.activity) { return false; }
  await authorization.activity(event, sourceId);
  return true;
}
export function inheritedMissionWrite(): boolean { return authorization?.inherited === true; }

export function hasMissionWriteAuthorization(): boolean { return authorization !== null; }
export function authorizedOperationId(): string | null { return authorization?.operationId ?? null; }

export async function reportWorkflowProviderStarted(agent: string): Promise<void> { await authorization?.providerStarted?.(agent); }

/** An agent may write its assigned evidence or verdict, but cannot run its parent's lifecycle. */
export function assertWorkflowControl(): void {
  if (authorization?.inherited) {
    throw new Error("The parent workflow owns execution, review preparation, review and integration. Complete your assigned work and return to it; an inherited agent CLI cannot start or resume execution, review or integration. Report a recorded stop for the operator.");
  }
}

export function authorizedExecutionStart() { return authorization?.start; }
