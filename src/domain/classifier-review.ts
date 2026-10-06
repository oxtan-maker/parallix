import type { Review } from './review.js';
import { currentReviewRound } from './review.js';

export const CLASSIFIER_POLICY_VERSION = 'repeat-findings-52-89-v2';
export const LEGACY_CLASSIFIER_POLICY_VERSION = 'repeat-findings-51-90-v1';

/** Versions retain the interpretation of historical applied decisions. */
export function classifierPolicyThresholds(version: string): { clear: number; unresolved: number } {
  if (version === CLASSIFIER_POLICY_VERSION) { return { clear: 0.52, unresolved: 0.89 }; }
  if (version === LEGACY_CLASSIFIER_POLICY_VERSION) { return { clear: 0.51, unresolved: 0.9 }; }
  throw new Error('Unknown classifier review policy');
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
    || !/^[a-f0-9]{40,64}$/.test(source.candidateRevision) || !Array.isArray(source.findingIds) || !source.findingIds.length
    || !source.findingIds.every(v => typeof v === 'string' && v.length) || new Set(source.findingIds).size !== source.findingIds.length
    || !Number.isFinite(source.score) || source.score > 1
    || (source.label === 'addresses' ? source.score < thresholds.clear : source.label !== 'does_not_address' || source.score < thresholds.unresolved)) {
    throw new Error('Invalid classifier review provenance');
  }
}

/** Complete original findings only. Broader obligations are screened by the application. */
export function applyClassifierReview(review: Review, source: ClassifierReviewSource, route: 'clear' | 'implementer', at: string): Review {
  assertClassifierReviewSource(source);
  if (source.policyVersion !== CLASSIFIER_POLICY_VERSION) { throw new Error('Classifier review must use the current policy'); }
  const thresholds = classifierPolicyThresholds(source.policyVersion);
  const current = currentReviewRound(review);
  const prior = review.rounds.at(-2);
  if (!prior || prior.decision?.kind !== 'changes-requested' || !prior.response
    || current.decision || current.phase !== 'reviewing' || review.intervention
    || prior.subject.revision !== source.priorRevision || current.subject.revision !== source.candidateRevision
    || prior.response.resultingRevision !== source.candidateRevision) { throw new Error('Classifier review scope or revision is stale'); }
  const ids = prior.decision.findings.map(f => f.id).sort((left, right) => left.localeCompare(right));
  if (JSON.stringify(ids) !== JSON.stringify([...new Set(source.findingIds)].sort((left, right) => left.localeCompare(right)))
    || JSON.stringify(ids) !== JSON.stringify(prior.response.resolutions.map(r => r.findingId).sort((left, right) => left.localeCompare(right)))) {
    throw new Error('Classifier review must cover the complete original finding set');
  }
  if (source.kind !== 'classifier' || source.identity !== 'jev' || current.subject.change.kind !== 'pull-request'
    || current.subject.change.provider !== 'forgejo' || !ids.length || new Set(source.findingIds).size !== source.findingIds.length
    || !source.decisionId || !source.provider || !source.model || !source.policyVersion || !/^[a-f0-9]{64}$/.test(source.packetHash)
    || !Number.isFinite(Date.parse(at)) || !Number.isFinite(source.score)
    || (route === 'clear' ? source.label !== 'addresses' || source.score < thresholds.clear : source.label !== 'does_not_address' || source.score < thresholds.unresolved)
    || source.score > 1) { throw new Error('Classifier review provenance or threshold is invalid'); }
  const comment = route === 'clear' ? 'Jev cleared the complete prior finding set.'
    : 'Jev reports likely unresolved prior findings. Make changes or request general review; no repair instructions supplied.';
  const decision = route === 'clear'
    ? { kind: 'approved' as const, decidedAt: at, comment, source: { kind: 'provider' as const, provider: 'forgejo' }, classifier: source }
    : { kind: 'changes-requested' as const, decidedAt: at, comment, findings: prior.decision.findings, classifier: source };
  const rounds = review.rounds.map(r => r.number === current.number ? {
    ...r, decision, phase: route === 'clear' ? 'approved' : 'fixing', disposition: route === 'clear' ? 'APPROVED' : 'REQUEST_CHANGES',
  } : r) as import('./review.js').ReviewRound[];
  return { ...review, rounds: [rounds[0], ...rounds.slice(1)] };
}
