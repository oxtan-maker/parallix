import type { HistoricalMechanicalApprovalSource } from './integration-repair-record.js';
import type { CompletedRebaseLineage, IntegrationValidationMarker } from './integration-validation-policy.js';

export type RetentionBlockReason = 'mission-change-differs' | 'gate-evidence-missing' | 'gate-failed' | 'comparison-error';
export interface RetentionValidation extends IntegrationValidationMarker {
  readonly createdAt: string;
  readonly reference: string;
  readonly baseline: string | null;
  readonly failed?: boolean;
  /** The later candidate and base completed rebases carried this validation to; the original fields stay as executed. */
  readonly carried?: CarriedValidation;
}
export interface CarriedValidation {
  readonly revision: string;
  readonly baseline: string | null;
  readonly lineage: CompletedRebaseLineage;
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

export type RetentionAssessmentFacts = Omit<IntegrationRepairAssessment, 'outcome' | 'validation'> & {
  readonly validation?: RetentionValidation;
};

/** Classify observed patch and gate facts without performing either observation. */
export function assessApprovalRetention(facts: RetentionAssessmentFacts, patchEquivalent: boolean | null,
  mission?: string, candidateBaseline?: string): IntegrationRepairAssessment {
  const { validation, ...assessment } = facts;
  const validatedCandidate = retentionEvidenceMatches(facts, mission, candidateBaseline);
  const outcome = patchEquivalent === null ? 'comparison-error'
    : !patchEquivalent ? 'mission-change-differs'
    : validatedCandidate ? 'retained'
    : validation?.failed ? 'gate-failed' : 'gate-evidence-missing';
  // Validation and patch equivalence answer different questions. Preserve a
  // candidate-bound green marker even when the changed patch dismisses the old
  // approval; later review fixes must not be mistaken for the revision it ran on.
  return { ...assessment, outcome, ...(validatedCandidate && validation ? { validation } : {}) };
}

/** A judgment's patch equivalence and a gate's committed-tree evidence are separate facts. The
 * gate evidence covers the revision it ran on, or the candidate completed rebases carried it to. */
export function retentionEvidenceMatches(assessment: Pick<IntegrationRepairAssessment,
  'assessedAt' | 'candidateRevision' | 'failedGate' | 'repair' | 'validation'>, mission?: string, candidateBaseline?: string): boolean {
  const { validation: v, repair, failedGate, candidateRevision, assessedAt } = assessment;
  const covers = (revision: string, baseline: string | null) => revision === candidateRevision
    && (candidateBaseline === undefined || Boolean(candidateBaseline) && baseline === candidateBaseline);
  return Boolean(v && !v.failed && v.missionId && (!mission || v.missionId === mission)
    && (covers(v.sha, v.baseline) || Boolean(v.carried?.lineage.length) && covers(v.carried!.revision, v.carried!.baseline))
    && failedGate && v.hooks.includes(failedGate) && v.reference
    && repair && repair.cause.gate === failedGate && retentionTimesMatch(repair.startedAt, v.createdAt, assessedAt));
}

function retentionTimesMatch(startedAt: string, validatedAt: string, assessedAt: string): boolean {
  const times = [startedAt, validatedAt, assessedAt].map(Date.parse);
  return times.every(Number.isFinite) && times[1] >= times[0] && times[1] <= times[2];
}
