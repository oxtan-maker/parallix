import type { Review, ReviewFinding, ReviewRevocationCause } from './review.js';
import { changeRevision, currentReviewRound, replaceCurrentRound, reviewFindingId } from './review.js';

export const CLASSIFIER_POLICY_VERSION = 'repeat-findings-52-89-v2';
export const INTEGRATION_REPAIR_POLICY_VERSION = 'integration-repair-52-67-v1';
export const CONSECUTIVE_REPAIR_POLICY_VERSION = 'integration-repair-52-81-v1';
export const LEGACY_CLASSIFIER_POLICY_VERSION = 'repeat-findings-51-90-v1';

/** Versions retain the interpretation of historical applied decisions. */
export function classifierPolicyThresholds(version: string): { clear: number; unresolved: number } {
  if (version === CLASSIFIER_POLICY_VERSION) { return { clear: 0.52, unresolved: 0.89 }; }
  if (version === INTEGRATION_REPAIR_POLICY_VERSION) { return { clear: 0.52, unresolved: 0.67 }; }
  if (version === CONSECUTIVE_REPAIR_POLICY_VERSION) { return { clear: 0.52, unresolved: 0.81 }; }
  if (version === LEGACY_CLASSIFIER_POLICY_VERSION) { return { clear: 0.51, unresolved: 0.9 }; }
  throw new Error('Unknown classifier review policy');
}

/** A Jev return retains the synthetic gate obligation, never an unrelated finding set. */
function continuedGateRepair(prior: Review['rounds'][number]['decision']): boolean {
  if (prior?.kind !== 'changes-requested' || prior.findings.length !== 1
    || prior.findings[0].id !== 'integration-gate-repair' || !prior.classifier) { return false; }
  return Boolean(prior.classifier.integrationRepair)
    || [INTEGRATION_REPAIR_POLICY_VERSION, CONSECUTIVE_REPAIR_POLICY_VERSION].includes(prior.classifier.policyVersion);
}

/** Only withdrawn gate obligations and their consecutive repairs use the tuned policy. */
export function classifierPolicyForReview(review: Review): string {
  const prior = review.rounds.at(-2)?.decision;
  const gateRepair = prior?.kind === 'approved' && prior.revocation?.cause?.kind === 'integration-gate-failure';
  if (!gateRepair && !continuedGateRepair(prior ?? null)) { return CLASSIFIER_POLICY_VERSION; }
  return prior?.classifier ? CONSECUTIVE_REPAIR_POLICY_VERSION : INTEGRATION_REPAIR_POLICY_VERSION;
}

/** Typed provenance within the existing review authority, never an agent family. */
export interface ClassifierReviewSource {
  readonly kind: 'classifier';
  readonly identity: 'jev';
  readonly decisionId: string;
  readonly provider: string;
  readonly model: string;
  readonly packetHash: string;
  readonly priorRevision: string;
  readonly candidateRevision: string;
  /** Implementer revision which resolved the findings before verified setup advanced HEAD. */
  readonly responseRevision?: string;
  /** Verified repair of this exact withdrawn approval, rather than finding resolutions. */
  readonly integrationRepair?: { readonly revokedAt: string; readonly gate: string | null };
  /** Round with no answered prior findings: `priorRevision` equals the candidate and the success criteria are judged against the diff from `baseRef`. */
  readonly successCriteria?: { readonly baseRef: string };
  readonly findingIds: readonly string[];
  readonly policyVersion: string;
  readonly label: string;
  readonly score: number;
}

export function assertClassifierReviewSource(value: unknown): asserts value is ClassifierReviewSource {
  if (!value || typeof value !== 'object') { throw new Error('Invalid classifier review provenance'); }
  const source = value as ClassifierReviewSource;
  const thresholds = classifierPolicyThresholds(source.policyVersion);
  if (source.kind !== 'classifier' || source.identity !== 'jev'
    || ![source.decisionId, source.provider, source.model, source.policyVersion].every(v => typeof v === 'string' && v.trim().length)
    || !/^[a-f0-9]{64}$/.test(source.packetHash) || !/^[a-f0-9]{40,64}$/.test(source.priorRevision)
    || !/^[a-f0-9]{40,64}$/.test(source.candidateRevision) || (source.responseRevision !== undefined && !/^[a-f0-9]{40,64}$/.test(source.responseRevision)) || !Array.isArray(source.findingIds) || !source.findingIds.length
    || !source.findingIds.every(v => typeof v === 'string' && v.length) || new Set(source.findingIds).size !== source.findingIds.length
    || (source.successCriteria !== undefined && (source.integrationRepair !== undefined
      || typeof source.successCriteria?.baseRef !== 'string' || !source.successCriteria.baseRef.trim()))
    || (source.integrationRepair !== undefined && (!source.integrationRepair
      || typeof source.integrationRepair.revokedAt !== 'string'
      || !Number.isFinite(Date.parse(source.integrationRepair.revokedAt))
      || (source.integrationRepair.gate !== null && typeof source.integrationRepair.gate !== 'string')))
    || !Number.isFinite(source.score) || source.score > 1
    || (source.label === 'addresses' ? source.score < thresholds.clear : source.label !== 'does_not_address' || source.score < thresholds.unresolved)) {
    throw new Error('Invalid classifier review provenance');
  }
}

/** The gate failure is retained as a bounded review obligation, never an invented repair. */
export function integrationRepairFinding(cause: Extract<ReviewRevocationCause, { kind: 'integration-gate-failure' }>): ReviewFinding {
  const location = cause.log?.replace(/\bfile:\/\/(?=\/)/g, '').match(/(?<![A-Za-z0-9_./-])([A-Za-z0-9_./-]+):(\d+)/);
  return { id: reviewFindingId('integration-gate-repair'), summary: `${cause.gate}: ${cause.log ?? 'integration gate failure'}`,
    location: location ? `${location[1]}:${location[2]}` : null };
}

/** The mission success criteria as bounded obligations for a round with no answered prior findings. */
export function successCriteriaFindings(criteria: readonly string[]): readonly ReviewFinding[] {
  return criteria.map((text, index) => ({ id: reviewFindingId(`success-criterion-${index + 1}`), summary: `Success criterion ${index + 1}: ${text}`, location: null }));
}

/** Complete prior findings, the exact withdrawn gate, or the mission success criteria. Broader obligations require general review. */
export function applyClassifierReview(review: Review, source: ClassifierReviewSource, route: 'clear' | 'implementer', at: string,
  criteria: readonly ReviewFinding[] = []): Review {
  assertClassifierReviewSource(source);
  if (source.policyVersion !== classifierPolicyForReview(review)) { throw new Error('Classifier review must use the current policy for this scope'); }
  const thresholds = classifierPolicyThresholds(source.policyVersion);
  const current = currentReviewRound(review);
  const prior = review.rounds.at(-2);
  if (current.decision || current.phase !== 'reviewing' || current.subject.revision !== source.candidateRevision
    || (source.successCriteria ? source.priorRevision !== source.candidateRevision : prior?.subject.revision !== source.priorRevision)
    || (prior?.decision?.classifier && source.policyVersion === CLASSIFIER_POLICY_VERSION)) { throw new Error('Classifier review scope or revision is stale'); }
  let findings: readonly ReviewFinding[];
  if (source.successCriteria) {
    findings = criteria;
  } else if (!prior) {
    throw new Error('Classifier review scope or revision is stale');
  } else if (source.integrationRepair) {
    const revocation = prior.decision?.kind === 'approved' ? prior.decision.revocation : undefined;
    if (revocation?.cause?.kind !== 'integration-gate-failure'
      || revocation.revokedAt !== source.integrationRepair.revokedAt || revocation.cause.gate !== source.integrationRepair.gate
      || !source.responseRevision) { throw new Error('Classifier integration repair scope is stale'); }
    findings = [integrationRepairFinding(revocation.cause)];
  } else {
    if (prior.decision?.kind !== 'changes-requested' || !prior.response
      || prior.response.resultingRevision !== (source.responseRevision ?? source.candidateRevision)) {
      throw new Error('Classifier review scope or revision is stale');
    }
    findings = prior.decision.findings;
  }
  const ids = findings.map(f => f.id).sort((left, right) => left.localeCompare(right));
  if (JSON.stringify(ids) !== JSON.stringify([...new Set(source.findingIds)].sort((left, right) => left.localeCompare(right)))
    || (!source.integrationRepair && !source.successCriteria && JSON.stringify(ids) !== JSON.stringify(prior!.response!.resolutions.map(r => r.findingId).sort((left, right) => left.localeCompare(right))))) {
    throw new Error('Classifier review must cover the complete original finding set');
  }
  if (current.subject.change.kind !== 'pull-request' || current.subject.change.provider !== 'forgejo' || !ids.length
    || !Number.isFinite(Date.parse(at))
    || (route === 'clear' ? source.label !== 'addresses' || source.score < thresholds.clear : source.label !== 'does_not_address' || source.score < thresholds.unresolved)) {
    throw new Error('Classifier review provenance or threshold is invalid');
  }
  const comment = route === 'clear' ? 'Classifier cleared the complete prior finding set.'
    : 'Classifier reports likely unresolved prior findings. Make changes or request general review; no repair instructions supplied.';
  const decision = route === 'clear'
    ? { kind: 'approved' as const, decidedAt: at, comment, source: { kind: 'provider' as const, provider: 'forgejo' }, classifier: source }
    : { kind: 'changes-requested' as const, decidedAt: at, comment, findings, classifier: source };
  return { ...review, rounds: replaceCurrentRound(review, {
    ...current, decision, phase: route === 'clear' ? 'approved' : 'fixing', disposition: route === 'clear' ? 'APPROVED' : 'REQUEST_CHANGES',
  }) };
}

/** The current round re-pinned to the verified candidate revision when setup advanced HEAD past the recorded one. */
export function reviewAtCandidateRevision(review: Review, candidateRevision: string): Review {
  const current = currentReviewRound(review);
  if (candidateRevision === current.subject.revision) { return review; }
  return { ...review, rounds: replaceCurrentRound(review, {
    ...current, subject: { ...current.subject, revision: changeRevision(candidateRevision) },
  }) };
}
