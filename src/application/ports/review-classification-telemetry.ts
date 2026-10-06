import type { ClassifierRoute } from '../review-classification/routing-policy.js';

/** Call measurements carry deduplication metadata; no durable launch or retry entity. */
export interface ClassifierCallMeasurement {
  readonly decisionId: string;
  readonly fingerprint: string;
  readonly repository: string;
  readonly mission: string;
  readonly round: number;
  readonly observedAt: string;
  readonly priorRevision: string;
  readonly candidateRevision: string;
  readonly findingIds: readonly string[];
  readonly packetHash: string | null;
  readonly packetVersion: string;
  readonly promptVersion: string;
  readonly policyVersion: string;
  readonly provider: string | null;
  readonly model: string | null;
  readonly implementer: string;
  readonly reviewer: string;
  readonly label: string | null;
  readonly score: number | null;
  readonly route: ClassifierRoute;
  readonly reason: string;
  readonly shadow: boolean;
  readonly preparationMs: number | null;
  readonly classificationMs: number | null;
}
export interface AppliedClassifierDecision {
  readonly decisionId: string;
  readonly decidedAt: string;
  readonly route: 'clear' | 'implementer';
}
export interface ClassifierObservation {
  readonly decisionId: string;
  readonly revision: string;
  readonly findingIds: readonly string[];
  readonly observedAt: string;
  readonly originalFindings: 'resolved' | 'unresolved' | 'unobserved';
  readonly newFindings: number | null;
  readonly cycleMs: number | null;
  readonly ordinaryReviewMs: number | null;
}
/** Operator-local measurements only; never a review or approval write authority. */
export interface ReviewClassificationTelemetryPort {
  recordCall(_attempt: ClassifierCallMeasurement): Promise<void>;
  recordObservation(_observation: ClassifierObservation): Promise<void>;
  calls(_repository: string): Promise<readonly ClassifierCallMeasurement[]>;
  observations(_repository: string): Promise<readonly ClassifierObservation[]>;
}

export interface ClassifierStatisticsReadPort {
  read(): Promise<import('../review-classification/statistics.js').ClassifierStatisticsInput>;
}
