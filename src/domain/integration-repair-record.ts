import { retentionEvidenceMatches } from './integration-approval-retention.js';
import type { IntegrationRepairAssessment } from './integration-approval-retention.js';

/** Read compatibility for decisions written by the retired restore workflow. */
export interface HistoricalMechanicalApprovalSource {
  readonly kind: 'mechanical-restoration';
  readonly approvedRevision: string;
  readonly candidateRevision: string;
  readonly failedGate: string;
  readonly validationRevision: string;
  readonly validationReference: string;
  readonly validatedAt: string;
}

/** Preserve the original restoration assessment when a later incident replaces the current assessment. */
export function preserveHistoricalRestoration(assessment: IntegrationRepairAssessment | undefined) {
  const prior = assessment?.outcome === 'restored' ? assessment : assessment?.priorRestoration;
  return prior ? { priorRestoration: prior } : {};
}

const OUTCOMES = new Set(['pending', 'retained', 'restored', 'mission-change-differs', 'gate-evidence-missing', 'gate-failed', 'comparison-error']);
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
export function parseHistoricalApprovalSource(raw: string, assessment?: IntegrationRepairAssessment, revision?: string): HistoricalMechanicalApprovalSource {
  const row = record(JSON.parse(raw) as unknown);
  if (row.kind !== 'mechanical-restoration' || !SOURCE_FIELDS.every(key => typeof row[key] === 'string' && row[key])) {
    throw new Error('Invalid mechanical approval source');
  }
  const source: HistoricalMechanicalApprovalSource = { kind: 'mechanical-restoration', approvedRevision: text(row, 'approvedRevision'), candidateRevision: text(row, 'candidateRevision'),
    failedGate: text(row, 'failedGate'), validationRevision: text(row, 'validationRevision'),
    validationReference: text(row, 'validationReference'), validatedAt: text(row, 'validatedAt') };
  if (assessment && (assessment.outcome !== 'restored' || JSON.stringify(source) !== JSON.stringify(assessment.source)
    || source.candidateRevision !== (revision ?? source.candidateRevision) || source.candidateRevision !== assessment.candidateRevision
    || source.approvedRevision !== assessment.approvedRevision || source.failedGate !== assessment.failedGate
    || !Number.isFinite(Date.parse(assessment.assessedAt)) || !Number.isFinite(Date.parse(source.validatedAt))
    || Date.parse(source.validatedAt) >= Date.parse(assessment.assessedAt))) { throw new Error('Invalid persisted mechanical restoration provenance'); }
  return source;
}
export function parseIntegrationRepairAssessment(raw: string): IntegrationRepairAssessment {
  const row = record(JSON.parse(raw) as unknown);
  const outcome = text(row, 'outcome');
  if (!OUTCOMES.has(outcome) || (row.failedGate !== null && typeof row.failedGate !== 'string')) { throw new Error('Invalid restoration assessment'); }
  const repair = row.repair === undefined ? undefined : parseRepair(row.repair);
  if ((outcome === 'pending' || outcome === 'retained') && !repair) { throw new Error('Missing integration repair incident'); }
  const validation = row.validation ? parseValidation(row.validation) : undefined;
  const assessment: IntegrationRepairAssessment = { assessedAt: text(row, 'assessedAt'), approvedRevision: text(row, 'approvedRevision'), candidateRevision: text(row, 'candidateRevision'),
    failedGate: row.failedGate as string | null, outcome: outcome as IntegrationRepairAssessment['outcome'],
    ...(repair ? { repair } : {}),
    ...(validation ? { validation } : {}),
    ...(row.source ? { source: parseHistoricalApprovalSource(JSON.stringify(row.source)) } : {}),
    ...restorationMeasurements(row), ...restorationArchive(row) };
  if (outcome === 'retained' && !retentionEvidenceMatches(assessment)) { throw new Error('Invalid retained approval evidence'); }
  return assessment;
}

function restorationMeasurements(row: Record<string, unknown>) {
  const normalReviewMs = measured(row, 'normalReviewMs'), normalReviewCostUsd = measured(row, 'normalReviewCostUsd');
  return { ...(normalReviewMs === undefined ? {} : { normalReviewMs }), ...(normalReviewCostUsd === undefined ? {} : { normalReviewCostUsd }) };
}

function parseRepair(raw: unknown): NonNullable<IntegrationRepairAssessment['repair']> {
  const incident = record(raw), cause = record(incident.cause);
  if (cause.kind !== 'integration-gate-failure' || (cause.gate !== null && typeof cause.gate !== 'string')
    || !Number.isFinite(Date.parse(text(incident, 'startedAt')))
    || [cause.command, cause.log].some(v => v !== undefined && v !== null && typeof v !== 'string')) { throw new Error('Invalid integration repair incident'); }
  return { startedAt: text(incident, 'startedAt'), cause: { kind: 'integration-gate-failure', gate: cause.gate as string | null,
    command: cause.command as string | null | undefined, log: cause.log as string | null | undefined } };
}

function parseValidation(raw: unknown): NonNullable<IntegrationRepairAssessment['validation']> {
  const row = record(raw);
  if (!Array.isArray(row.hooks) || !row.hooks.length || row.hooks.some(h => typeof h !== 'string' || !h)
    || (row.baseline !== null && typeof row.baseline !== 'string')
    || (row.failed !== undefined && typeof row.failed !== 'boolean')
    || !Number.isFinite(Date.parse(text(row, 'createdAt')))) { throw new Error('Invalid retained validation'); }
  return { missionId: text(row, 'missionId'), sha: text(row, 'sha'), hooks: row.hooks as string[], baseline: row.baseline as string | null,
    createdAt: text(row, 'createdAt'), reference: text(row, 'reference'), ...(row.failed === undefined ? {} : { failed: row.failed as boolean }),
    ...(row.carried === undefined ? {} : { carried: parseCarried(row.carried) }) };
}

function parseCarried(raw: unknown): NonNullable<NonNullable<IntegrationRepairAssessment['validation']>['carried']> {
  const row = record(raw);
  if ((row.baseline !== null && typeof row.baseline !== 'string') || !Array.isArray(row.lineage) || !row.lineage.length) {
    throw new Error('Invalid carried validation');
  }
  const lineage = row.lineage.map(step => { const value = record(step); return { from: text(value, 'from'), to: text(value, 'to') }; });
  return { revision: text(row, 'revision'), baseline: row.baseline as string | null, lineage };
}

function restorationArchive(row: Record<string, unknown>): Pick<IntegrationRepairAssessment, 'priorRestoration'> {
  if (row.priorRestoration === undefined) { return {}; }
  const historical = record(row.priorRestoration);
  if (historical.outcome !== 'restored' || historical.priorRestoration !== undefined || !historical.source) {
    throw new Error('Invalid historical restoration assessment');
  }
  return { priorRestoration: parseIntegrationRepairAssessment(JSON.stringify(historical)) };
}
