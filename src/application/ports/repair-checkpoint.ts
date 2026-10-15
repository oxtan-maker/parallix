import type { InvalidContractBlocker } from '../../domain/rebound-policy.js';

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
  open(_request: { slug: string; incidentId: string; command: string; attempt: number }): Promise<{ name: string; version: number } | null>;
  readBlocker(_slug: string, _name: string): Promise<InvalidContractBlocker | undefined>;
  verify(_slug: string, _name: string): Promise<void>;
}

let productionPort: RepairCheckpointPort | undefined;
export function configureRepairCheckpoints(port: RepairCheckpointPort | undefined): void { productionPort = port; }
export function repairCheckpointPort(): RepairCheckpointPort | undefined { return productionPort; }
