import type { InvalidContractBlocker } from '../../domain/rebound-policy.js';
import type { CoveredRepairOccurrence, ExactSuccessCoverage } from '../../domain/repair-coverage.js';

export interface RepairVerificationSnapshot {
  readonly missionId: string;
  readonly command: string;
  readonly worktree: string;
  readonly executionRevision: string;
  readonly executionMissionRevision: number;
  readonly checkpointEvidenceRevision: number;
  readonly authorizedGates: readonly string[];
  readonly authorizedCriteria: readonly string[];
  readonly verifiedOccurrence: CoveredRepairOccurrence;
  readonly coveredOccurrences: readonly CoveredRepairOccurrence[];
}

export interface RepairVerificationProof {
  readonly snapshot: RepairVerificationSnapshot;
  readonly command: string;
  readonly revisionAfter: string | null;
  readonly execution: ExactSuccessCoverage['execution'];
}

export interface OpenRepairCheckpoint {
  readonly slug: string;
  readonly incidentId: string;
  readonly command: string;
  readonly attempt: number;
  readonly worktree?: string;
  readonly failureRevision?: string | null;
  readonly failureEvidenceId?: string;
}

/**
 * What an explicit operator resume changed on the recorded repair stops.
 * Names checkpoints, never evidence claims: clearing a stop proves nothing
 * about the repair (TASK-2756).
 */
export interface OperatorResumeVerdict {
  /** Checkpoints whose retained contract stop the operator acknowledged and cleared. */
  readonly cleared: readonly string[];
  /** Checkpoints whose repair authorization was refreshed to the current recorded contract. */
  readonly refreshed: readonly string[];
  /** The prior blockers in checkpoint order, so the operator output can name them. */
  readonly priorBlockers: readonly InvalidContractBlocker[];
}

/** Harness-owned durable repair boundary, composed once for all rebound consumers. */
export interface RepairCheckpointPort {
  open(_request: OpenRepairCheckpoint): Promise<{ name: string; version: number } | null>;
  readBlocker(_slug: string, _name: string): Promise<InvalidContractBlocker | undefined>;
  /** Snapshot accepted evidence and occurrences before execution. Legacy adapters produce no coverage. */
  prepareVerification?(_slug: string, _name: string, _scope: { worktree: string; executionRevision: string | null }): Promise<RepairVerificationSnapshot | undefined>;
  verify(_slug: string, _name: string, _proof?: RepairVerificationProof): Promise<void>;
}

let productionPort: RepairCheckpointPort | undefined;
export function configureRepairCheckpoints(port: RepairCheckpointPort | undefined): void { productionPort = port; }
export function repairCheckpointPort(): RepairCheckpointPort | undefined { return productionPort; }
