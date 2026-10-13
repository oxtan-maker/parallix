import type { IntegrationValidationMarker } from './integration-validation-policy.js';

export type RestorationFallback = 'mission-change-differs' | 'gate-evidence-missing' | 'gate-failed' | 'comparison-error';
export interface RestorationValidation extends IntegrationValidationMarker {
  readonly createdAt: string;
  readonly reference: string;
  readonly baseline: string | null;
  readonly failed?: boolean;
}
export interface MechanicalApprovalSource {
  readonly kind: 'mechanical-restoration';
  readonly approvedRevision: string;
  readonly candidateRevision: string;
  readonly failedGate: string;
  readonly validationRevision: string;
  readonly validationReference: string;
  readonly validatedAt: string;
}
export interface IntegrationRepairAssessment {
  readonly assessedAt: string;
  readonly approvedRevision: string;
  readonly candidateRevision: string;
  readonly failedGate: string | null;
  readonly outcome: 'restored' | RestorationFallback;
  readonly source?: MechanicalApprovalSource;
  readonly normalReviewMs?: number;
  readonly normalReviewCostUsd?: number;
}

/** Facts only: a green whitelist is useful only for this incident and an equivalent candidate. */
interface EligibilityInput {
  missionId: string; approvedRevision: string; candidateRevision: string; failedGate: string | null;
  withdrawnAt: string; decidedAt: string; patchEqual: boolean | null;
  validation: RestorationValidation | null; validationEqual: boolean | null;
}
export function restorationEligibility(input: EligibilityInput): IntegrationRepairAssessment {
  const { validation: v, failedGate: gate } = input;
  const base = { assessedAt: input.decidedAt, approvedRevision: input.approvedRevision,
    candidateRevision: input.candidateRevision, failedGate: gate };
  const fallback = (outcome: RestorationFallback): IntegrationRepairAssessment => ({ ...base, outcome });
  if (input.patchEqual === null) { return fallback('comparison-error'); }
  if (!input.patchEqual) { return fallback('mission-change-differs'); }
  if (v?.failed) { return fallback('gate-failed'); }
  if (!matchingGreenEvidence(input)) { return fallback('gate-evidence-missing'); }
  if (input.validationEqual === null) { return fallback('comparison-error'); }
  if (!input.validationEqual) { return fallback('gate-evidence-missing'); }
  return { ...base, outcome: 'restored', source: { kind: 'mechanical-restoration',
    approvedRevision: input.approvedRevision, candidateRevision: input.candidateRevision, failedGate: gate!,
    validationRevision: v!.sha, validationReference: v!.reference, validatedAt: v!.createdAt } };
}

function matchingGreenEvidence(input: EligibilityInput): boolean {
  const { validation: v, failedGate: gate } = input;
  if (!v || v.missionId !== input.missionId || !gate || !v.hooks.includes(gate)
    || !v.reference || !Number.isFinite(Date.parse(input.withdrawnAt)) || !Number.isFinite(Date.parse(input.decidedAt))
    || !Number.isFinite(Date.parse(v.createdAt))
    || Date.parse(v.createdAt) < Date.parse(input.withdrawnAt)
    || Date.parse(v.createdAt) >= Date.parse(input.decidedAt)) { return false; }
  return true;
}
