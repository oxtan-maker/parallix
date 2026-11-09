import type { MissionRevision } from './review-evidence.js';
import type { RetentionValidation } from '../../domain/integration-approval-retention.js';
import type { CompletedRebaseLineage } from '../../domain/integration-validation-policy.js';

/** Revision-pinned comparison and existing integration evidence, never review authority. */
export interface IntegrationApprovalEvidencePort {
  samePatch(_approved: MissionRevision, _candidate: MissionRevision): Promise<boolean>;
  validation(_missionId: string): Promise<RetentionValidation | null>;
  /** Completed rebases of the checked-out branch that carry `from` to `to`; absent or null runs gates normally. */
  completedRebaseLineage?(_from: string, _to: string): CompletedRebaseLineage | null;
  /** Current provider decisions, reconciled by the shared review feedback owner. */
  reconcileHumanFeedback(_mission: import('../../domain/mission.js').Mission, _store: import('../domain-ports.js').MissionStore): Promise<boolean>;
  now(): string;
}
