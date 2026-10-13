import type { MissionRevision } from './review-evidence.js';
import type { RestorationValidation } from '../../domain/integration-approval-restoration.js';

/** Revision-pinned comparison and existing integration evidence, never review authority. */
export interface IntegrationApprovalRestorationPort {
  samePatch(_approved: MissionRevision, _candidate: MissionRevision): Promise<boolean>;
  validation(_missionId: string): Promise<RestorationValidation | null>;
  now(): string;
  clock(): number;
}
