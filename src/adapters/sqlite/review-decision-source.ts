/** Decode decision provenance before assembling the persisted Review aggregate. */
import { parseIntegrationRepairAssessment, parseHistoricalApprovalSource } from '../../domain/integration-repair-record.js';
import { assertClassifierReviewSource, clearingLabel, type ClassifierReviewSource } from '../../domain/classifier-review.js';
import type { OperatorReviewSource, ReviewerDecision } from '../../domain/review.js';
import type { MissionReviewRoundRecord } from './mission-serialization.js';

export function operatorSourceFor(row: MissionReviewRoundRecord): { source?: OperatorReviewSource } {
  if (row.operator_author !== undefined && row.operator_author !== null
    && (row.decision_kind !== 'changes-requested' || row.classifier_source || row.mechanical_source)) {
    throw new Error('Invalid persisted operator decision source');
  }
  if (row.operator_author === undefined || row.operator_author === null) { return {}; }
  if (!row.operator_author.trim()) { throw new Error('Persisted Mission operator author must not be empty'); }
  return { source: { kind: 'operator', author: row.operator_author } };
}

function mechanicalDecisionFor(row: MissionReviewRoundRecord, stored: ReviewerDecision | null): ReviewerDecision | null {
  if (!row.mechanical_source) { return stored; }
  if (!row.integration_repair_assessment || stored?.kind !== 'approved' || row.classifier_source) { throw new Error('Invalid persisted mechanical source'); }
  const assessment = parseIntegrationRepairAssessment(row.integration_repair_assessment);
  const source = parseHistoricalApprovalSource(row.mechanical_source, assessment.priorRestoration ?? assessment, row.decided_revision ?? undefined);
  return { ...stored, source };
}

export function decisionSourceFor(row: MissionReviewRoundRecord, stored: ReviewerDecision | null): ReviewerDecision | null {
  const decision = mechanicalDecisionFor(row, stored);
  if (!decision || !row.classifier_source) { return decision; }
  const source = JSON.parse(row.classifier_source) as ClassifierReviewSource;
  assertClassifierReviewSource(source);
  if (source.candidateRevision !== (row.decided_revision ?? source.candidateRevision) || clearingLabel(source) !== (decision.kind === 'approved')) {
    throw new Error('Invalid persisted classifier provenance');
  }
  return { ...decision, classifier: source };
}

