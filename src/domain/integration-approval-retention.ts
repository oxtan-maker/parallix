import type { HistoricalMechanicalApprovalSource } from './integration-repair-record.js';
import type { IntegrationValidationMarker } from './integration-validation-policy.js';

export type RetentionBlockReason = 'mission-change-differs' | 'gate-evidence-missing' | 'gate-failed' | 'comparison-error';
export interface RetentionValidation extends IntegrationValidationMarker {
  readonly createdAt: string;
  readonly reference: string;
  readonly baseline: string | null;
  readonly failed?: boolean;
}
export interface IntegrationRepairAssessment {
  readonly assessedAt: string;
  readonly approvedRevision: string;
  readonly candidateRevision: string;
  readonly failedGate: string | null;
  readonly outcome: 'pending' | 'retained' | 'restored' | RetentionBlockReason;
  readonly repair?: { readonly startedAt: string; readonly cause: Extract<import('./review.js').ReviewRevocationCause, { kind: 'integration-gate-failure' }> };
  readonly validation?: RetentionValidation;
  /** Original restoration provenance belongs to the judged decision, independently of later repair. */
  readonly priorRestoration?: Omit<IntegrationRepairAssessment, 'priorRestoration'>;
  readonly source?: HistoricalMechanicalApprovalSource;
  readonly normalReviewMs?: number;
  readonly normalReviewCostUsd?: number;
}

/** A judgment's patch equivalence and a gate's committed-tree evidence are separate facts. */
export function retentionEvidenceMatches(assessment: Pick<IntegrationRepairAssessment,
  'assessedAt' | 'candidateRevision' | 'failedGate' | 'repair' | 'validation'>, mission?: string, candidateBaseline?: string): boolean {
  const { validation: v, repair, failedGate, candidateRevision, assessedAt } = assessment;
  return Boolean(v && !v.failed && v.missionId && (!mission || v.missionId === mission)
    && (candidateBaseline === undefined || Boolean(candidateBaseline) && v.baseline === candidateBaseline)
    && v.sha === candidateRevision && failedGate && v.hooks.includes(failedGate) && v.reference
    && repair && repair.cause.gate === failedGate && retentionTimesMatch(repair.startedAt, v.createdAt, assessedAt));
}

function retentionTimesMatch(startedAt: string, validatedAt: string, assessedAt: string): boolean {
  const times = [startedAt, validatedAt, assessedAt].map(Date.parse);
  return times.every(Number.isFinite) && times[1] >= times[0] && times[1] <= times[2];
}
