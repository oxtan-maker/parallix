import type { InvalidContractBlocker } from '../../domain/rebound-policy.js';

/** Harness-owned durable repair boundary, composed once for all rebound consumers. */
export interface RepairCheckpointPort {
  open(_request: { slug: string; incidentId: string; command: string; attempt: number }): Promise<{ name: string; version: number } | null>;
  readBlocker(_slug: string, _name: string): Promise<InvalidContractBlocker | undefined>;
  verify(_slug: string, _name: string): Promise<void>;
}

let productionPort: RepairCheckpointPort | undefined;
export function configureRepairCheckpoints(port: RepairCheckpointPort | undefined): void { productionPort = port; }
export function repairCheckpointPort(): RepairCheckpointPort | undefined { return productionPort; }
