/** Identity prevents a recycled PID from retaining an admission slot. */
export interface AdmissionProcessIdentity {
  readonly pid: number;
  readonly startId: string | null;
}

/** Shared admission persistence; contains no mission, credential or session state. */
export interface CustomAgentLeaseRepository {
  acquire(_repositoryRoot: string, _capacity: number, _launcher: AdmissionProcessIdentity): Promise<string | null>;
  bindChild(_leaseId: string, _child: AdmissionProcessIdentity): void;
  release(_leaseId: string): void;
}

export interface CustomCapacityReservation {
  bindChild(_pid: number | undefined): void;
  release(): void;
}
