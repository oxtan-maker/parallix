import type { FailureReason } from '../../domain/failure-reason.js';

/** Measurements are observations, never passing proof or workflow authority. */
export interface VerificationMeasurement {
  readonly id: string;
  readonly repositoryId: string;
  readonly missionId: string | null;
  readonly operationId: string | null;
  readonly revision: string | null;
  readonly configuration?: string | null;
  readonly runtime?: string;
  readonly batchId: string;
  readonly gate: string;
  readonly command: string;
  readonly phase: string;
  /** null means dependencies were not observed, [] means an observed root. */
  readonly after: readonly string[] | null;
  readonly plan?: readonly string[];
  readonly requestedAt: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly result: 'running' | 'passed' | 'failed' | 'interrupted' | 'reused';
  readonly failureReason: FailureReason | null;
  readonly exitCode: number | null;
  readonly wallMs: number | null;
  readonly cpu: { readonly userUs: number; readonly systemUs: number;
    readonly provenance: 'bash-time-waited-tree'; readonly boundary: string; readonly parent: string | null } | null;
  readonly profile: { readonly reference: string; readonly samples: number | null } | null;
}
export const VERIFICATION_MEASUREMENT_EVENT = 'verification.attempt';
export interface VerificationObservationInput {
  readonly root: string; readonly mission: string; readonly batchId: string;
  readonly gate: string; readonly command: string; readonly phase: string;
  readonly after: readonly string[] | null;
  readonly plan?: readonly string[];
}
export interface VerificationObservationPort {
  begin(_input: VerificationObservationInput): Promise<{
    started(): Promise<void>;
    complete(_result: Pick<VerificationMeasurement, 'result' | 'failureReason' | 'exitCode' | 'wallMs' | 'cpu'>): Promise<void>;
  } | null>;
}
let observation: VerificationObservationPort | null = null;
/** Composition owns this optional process capability, just like gate admission. */
export function configureVerificationObservation(port: VerificationObservationPort | null): void { observation = port; }
export function verificationObservation(): VerificationObservationPort | null { return observation; }
