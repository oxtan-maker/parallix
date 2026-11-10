import type { ProcessIdentity } from './process-identity.js';

/** Shared admission persistence; contains no mission, credential or session state. */
export interface CustomAgentLeaseRepository {
  acquire(_repositoryRoot: string, _capacity: number, _launcher: ProcessIdentity): Promise<string | null>;
  bindChild(_leaseId: string, _child: ProcessIdentity): void;
  release(_leaseId: string): void;
}

export interface CustomCapacityReservation {
  bindChild(_pid: number | undefined): void;
  release(): void;
}
