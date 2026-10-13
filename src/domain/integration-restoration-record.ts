import type { IntegrationRepairAssessment, MechanicalApprovalSource } from './integration-approval-restoration.js';

const OUTCOMES = new Set(['restored', 'mission-change-differs', 'gate-evidence-missing', 'gate-failed', 'comparison-error']);
const SOURCE_FIELDS = ['approvedRevision', 'candidateRevision', 'failedGate', 'validationRevision', 'validationReference', 'validatedAt'] as const;
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) { throw new Error('Invalid restoration record'); }
  return value as Record<string, unknown>;
}
function text(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== 'string' || !value) { throw new Error(`Invalid restoration ${key}`); }
  return value;
}
function measured(row: Record<string, unknown>, key: string): number | undefined {
  const value = row[key];
  if (value === undefined) { return undefined; }
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) { throw new Error(`Invalid restoration ${key}`); }
  return value;
}
export function parseMechanicalApprovalSource(raw: string): MechanicalApprovalSource {
  const row = record(JSON.parse(raw) as unknown);
  if (row.kind !== 'mechanical-restoration' || !SOURCE_FIELDS.every(key => typeof row[key] === 'string' && row[key])) {
    throw new Error('Invalid mechanical approval source');
  }
  return { kind: 'mechanical-restoration', approvedRevision: text(row, 'approvedRevision'), candidateRevision: text(row, 'candidateRevision'),
    failedGate: text(row, 'failedGate'), validationRevision: text(row, 'validationRevision'),
    validationReference: text(row, 'validationReference'), validatedAt: text(row, 'validatedAt') };
}
export function parseIntegrationRepairAssessment(raw: string): IntegrationRepairAssessment {
  const row = record(JSON.parse(raw) as unknown);
  const outcome = text(row, 'outcome');
  if (!OUTCOMES.has(outcome) || (row.failedGate !== null && typeof row.failedGate !== 'string')) { throw new Error('Invalid restoration assessment'); }
  const normalReviewMs = measured(row, 'normalReviewMs'), normalReviewCostUsd = measured(row, 'normalReviewCostUsd');
  return { assessedAt: text(row, 'assessedAt'), approvedRevision: text(row, 'approvedRevision'), candidateRevision: text(row, 'candidateRevision'),
    failedGate: row.failedGate as string | null, outcome: outcome as IntegrationRepairAssessment['outcome'],
    ...(row.source ? { source: parseMechanicalApprovalSource(JSON.stringify(row.source)) } : {}),
    ...(normalReviewMs === undefined ? {} : { normalReviewMs }), ...(normalReviewCostUsd === undefined ? {} : { normalReviewCostUsd }) };
}
