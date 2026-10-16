import type { WorkflowOperation } from '../../domain/workflow-operation.js';
export type WorkflowOwnerRead = (_id: string) => Promise<WorkflowOperation | null>;

/** Composition installs the process owner's authorization before workflow effects. */
export interface MissionWriteAuthorization {
  readonly operationId: string;
  assert(_missionId: string, _read?: WorkflowOwnerRead): Promise<void>;
  providerStarted?(_agent: string): Promise<void>;
  progress?(_phase: string, _summary: string, _agent?: string | null): Promise<void>;
}
let authorization: MissionWriteAuthorization | null = null;
export function configureMissionWriteAuthorization(port: MissionWriteAuthorization | null): void { authorization = port; }
export async function authorizeMissionWrite(missionId: string, read?: WorkflowOwnerRead): Promise<void> { await authorization?.assert(missionId, read); }

export async function reportAuthorizedProgress(phase: string, summary: string, agent?: string | null): Promise<void> { await authorization?.progress?.(phase, summary, agent); }

export function hasMissionWriteAuthorization(): boolean { return authorization !== null; }
export function authorizedOperationId(): string | null { return authorization?.operationId ?? null; }

export async function reportWorkflowProviderStarted(agent: string): Promise<void> { await authorization?.providerStarted?.(agent); }
