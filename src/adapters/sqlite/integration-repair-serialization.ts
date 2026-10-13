import type { IntegrationRepairAssessment, MechanicalApprovalSource } from '../../domain/integration-approval-restoration.js';

/** Invalid provenance never becomes a local approval on reload. */
export function mechanicalSource(assessment: IntegrationRepairAssessment, revision: string): MechanicalApprovalSource {
  const source = assessment.source;
  if (assessment.outcome !== 'restored' || !source || source.kind !== 'mechanical-restoration' || source.candidateRevision !== revision
    || source.candidateRevision !== assessment.candidateRevision || source.approvedRevision !== assessment.approvedRevision
    || source.failedGate !== assessment.failedGate
    || !source.validationReference || !source.validationRevision
    || !Number.isFinite(Date.parse(assessment.assessedAt)) || !Number.isFinite(Date.parse(source.validatedAt)) || Date.parse(source.validatedAt) >= Date.parse(assessment.assessedAt)) {
    throw new Error('Invalid persisted mechanical restoration provenance');
  }
  return source;
}
