import { reviewObligations } from './review-obligations.js';
import type { Review, ReviewRound, ReviewFinding, ReviewRevocationCause } from './review.js';
import { changeRevision, currentReviewRound, replaceCurrentRound, reviewFindingId } from './review.js';

export const OBLIGATION_POLICY_VERSION = 'general-obligations-97-97-v1';
export const OBLIGATION_THRESHOLD = 0.97;

export const PANEL_POLICY_VERSION = 'jev-three-question-51-80-89-omissions-v2';
export const WEAKENING_PACKET_VERSION = 'optional-gate-fact-fitted-repair-v3';
export const REPAIR_PACKET_VERSION = 'fitted-repair-token-budget-v2';
export const ARCHIVED_PACKING_VERSION = 'mission-interdiff-fitted-token-admission-v3';
export const CLASSIFIER_POLICY_VERSION = 'repeat-findings-52-89-v2';
export const INTEGRATION_REPAIR_POLICY_VERSION = 'integration-repair-52-67-v1';
export const CONSECUTIVE_REPAIR_POLICY_VERSION = 'integration-repair-52-81-v1';
export const LEGACY_CLASSIFIER_POLICY_VERSION = 'repeat-findings-51-90-v1';
/** Versioned with the I13 v4 question and its 0.60 `preserves` threshold; changing either needs a new version. */
export const WEAKENING_POLICY_VERSION = 'integration-repair-weakening-v4-preserves-0.60-optional-fact-v3';
export const WEAKENING_THRESHOLD = 0.60;
/** Decision source of an approval restored by a non-weakening repair; integration gates remain mandatory. */
export const WEAKENING_DECISION_SOURCE = 'integration-repair-weakening';

/** Versions retain the interpretation of historical applied decisions. */
export function classifierPolicyThresholds(version: string): { clear: number; unresolved: number } {
  if (version === OBLIGATION_POLICY_VERSION) { return { clear: OBLIGATION_THRESHOLD, unresolved: OBLIGATION_THRESHOLD }; }
  if (version === PANEL_POLICY_VERSION || version === 'jev-three-question-51-80-89-v1') { return { clear: 0.51, unresolved: 0.89 }; }
  if (version === CLASSIFIER_POLICY_VERSION) { return { clear: 0.52, unresolved: 0.89 }; }
  if (version === INTEGRATION_REPAIR_POLICY_VERSION) { return { clear: 0.52, unresolved: 0.67 }; }
  if (version === CONSECUTIVE_REPAIR_POLICY_VERSION) { return { clear: 0.52, unresolved: 0.81 }; }
  if (version === LEGACY_CLASSIFIER_POLICY_VERSION) { return { clear: 0.51, unresolved: 0.9 }; }
  // The weakening question can only restore an approval; no probability returns a mission.
  if (version === WEAKENING_POLICY_VERSION || version === 'integration-repair-weakening-v4-preserves-0.60-omissions-v2' || version === 'integration-repair-weakening-v4-preserves-0.60') { return { clear: WEAKENING_THRESHOLD, unresolved: Number.POSITIVE_INFINITY }; }
  throw new Error('Unknown classifier review policy');
}

/** New decisions use the frozen panel; historical threshold versions remain readable. */
export function classifierPolicyForReview(_review: Review): string {
  return PANEL_POLICY_VERSION;
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
  /** Non-weakening repair decision, with validation provenance only when a fact was admitted. */
  readonly weakening?: {
    readonly decisionSource: typeof WEAKENING_DECISION_SOURCE;
    readonly approvedRevision: string;
    readonly gate: string;
    readonly factAdmitted?: boolean;
    readonly validationSha?: string;
    readonly validationRecordedAt?: string;
    readonly relation?: 'same' | 'backlog-only' | 'rebase-only';
    /** Absent on historical single-question decisions. */
    readonly question?: {
      readonly clearedBy: 'weakening-v4' | 'weakening-v5' | 'weakening-v4-optional-fact-v1' | 'weakening-v5-optional-fact-v1';
      readonly preserves: number;
      readonly versions: readonly ['weakening-v4', 'weakening-v5'] | readonly ['weakening-v4-optional-fact-v1', 'weakening-v5-optional-fact-v1'];
    };
  };
  readonly obligations?: { readonly generalRound: number; readonly failingIds: readonly string[] };
  readonly findingIds: readonly string[];
  readonly policyVersion: string;
  readonly label: string;
  readonly score: number;
}

/** `addresses` clears findings; `preserves` clears a weakening question and only with its own provenance. */
export const clearingLabel = (source: Pick<ClassifierReviewSource, 'label'>): boolean => source.label === 'addresses' || source.label === 'preserves';

type WeakeningSource = NonNullable<ClassifierReviewSource['weakening']>;

function validWeakeningQuestion(question: WeakeningSource['question'], score: number): boolean {
  if (question === undefined) { return true; }
  const versions = [JSON.stringify(['weakening-v4', 'weakening-v5']),
    JSON.stringify(['weakening-v4-optional-fact-v1', 'weakening-v5-optional-fact-v1'])];
  return Array.isArray(question.versions) && versions.includes(JSON.stringify(question.versions))
    && (question.versions as readonly string[]).includes(question.clearedBy) && question.preserves === score;
}

function validWeakeningFact(w: WeakeningSource, policy: string): boolean {
  if (w.factAdmitted === false) {
    return policy === WEAKENING_POLICY_VERSION && w.validationSha === undefined && w.validationRecordedAt === undefined
      && w.relation === undefined && w.question !== undefined;
  }
  return (w.factAdmitted === undefined || w.factAdmitted === true) && /^[a-f0-9]{40,64}$/.test(w.validationSha ?? '')
    && Number.isFinite(Date.parse(w.validationRecordedAt ?? '')) && ['same', 'backlog-only', 'rebase-only'].includes(w.relation ?? '');
}

function validWeakening(source: ClassifierReviewSource): boolean {
  const isWeakeningPolicy = [WEAKENING_POLICY_VERSION, 'integration-repair-weakening-v4-preserves-0.60-omissions-v2', 'integration-repair-weakening-v4-preserves-0.60'].includes(source.policyVersion);
  if (isWeakeningPolicy !== (source.weakening !== undefined) || isWeakeningPolicy !== (source.label === 'preserves')) { return false; }
  const w = source.weakening;
  if (!w) { return true; }
  return w.decisionSource === WEAKENING_DECISION_SOURCE && source.integrationRepair !== undefined && source.integrationRepair.gate === w.gate
    && w.approvedRevision === source.priorRevision && /^[a-f0-9]{40,64}$/.test(w.approvedRevision)
    && validWeakeningQuestion(w.question, source.score) && validWeakeningFact(w, source.policyVersion);
}

export function assertClassifierReviewSource(value: unknown): asserts value is ClassifierReviewSource {
  if (!value || typeof value !== 'object') { throw new Error('Invalid classifier review provenance'); }
  const source = value as ClassifierReviewSource;
  const thresholds = classifierPolicyThresholds(source.policyVersion);
  if (invalidClassifierIdentity(source) || invalidClassifierRevisions(source) || invalidClassifierFindings(source) || invalidClassifierScope(source) || invalidClassifierScore(source, thresholds)) {
    throw new Error('Invalid classifier review provenance');
  }
}

function invalidClassifierIdentity(source: ClassifierReviewSource): boolean {
  return source.kind !== 'classifier' || source.identity !== 'jev'
    || ![source.decisionId, source.provider, source.model, source.policyVersion].every(v => typeof v === 'string' && v.trim().length)
    ;
}

function invalidClassifierRevisions(source: ClassifierReviewSource): boolean {
  return !/^[a-f0-9]{64}$/.test(source.packetHash) || !/^[a-f0-9]{40,64}$/.test(source.priorRevision)
    || !/^[a-f0-9]{40,64}$/.test(source.candidateRevision) || (source.responseRevision !== undefined && !/^[a-f0-9]{40,64}$/.test(source.responseRevision));
}

function invalidClassifierFindings(source: ClassifierReviewSource): boolean {
  return !Array.isArray(source.findingIds) || !source.findingIds.length
    || !source.findingIds.every(v => typeof v === 'string' && v.length) || new Set(source.findingIds).size !== source.findingIds.length
    ;
}

function invalidClassifierScope(source: ClassifierReviewSource): boolean {
  return invalidSuccessCriteriaScope(source) || invalidIntegrationRepairScope(source)
    || invalidObligationScope(source) || (source.policyVersion === OBLIGATION_POLICY_VERSION && !source.obligations);
}

function invalidSuccessCriteriaScope(source: ClassifierReviewSource): boolean {
  return source.successCriteria !== undefined && (source.integrationRepair !== undefined
    || typeof source.successCriteria?.baseRef !== 'string' || !source.successCriteria.baseRef.trim());
}

function invalidIntegrationRepairScope(source: ClassifierReviewSource): boolean {
  return source.integrationRepair !== undefined && (!source.integrationRepair
    || typeof source.integrationRepair.revokedAt !== 'string'
    || !Number.isFinite(Date.parse(source.integrationRepair.revokedAt))
    || (source.integrationRepair.gate !== null && typeof source.integrationRepair.gate !== 'string'));
}

function invalidObligationScope(source: ClassifierReviewSource): boolean {
  return source.obligations !== undefined && (source.policyVersion !== OBLIGATION_POLICY_VERSION
    || !Number.isSafeInteger(source.obligations.generalRound) || source.obligations.generalRound < 1
    || !Array.isArray(source.obligations.failingIds) || source.obligations.failingIds.some(id => typeof id !== 'string')
    || source.integrationRepair !== undefined || source.successCriteria !== undefined || source.weakening !== undefined);
}

function invalidClassifierScore(source: ClassifierReviewSource, thresholds: ReturnType<typeof classifierPolicyThresholds>): boolean {
  return !Number.isFinite(source.score) || source.score > 1 || !validWeakening(source)
    || (clearingLabel(source) ? source.score < thresholds.clear : source.label !== 'does_not_address' || source.score < thresholds.unresolved);
}

/** The gate failure is retained as a bounded review obligation, never an invented repair. */
export function integrationRepairFinding(cause: Extract<ReviewRevocationCause, { kind: 'integration-gate-failure' }>): ReviewFinding {
  const location = cause.log?.replace(/\bfile:\/\/(?=\/)/g, '').match(/(?<![A-Za-z0-9_./-])([A-Za-z0-9_./-]+):(\d+)/);
  return {
    id: reviewFindingId('integration-gate-repair'), summary: `${cause.gate}: ${cause.log ?? 'integration gate failure'}`,
    location: location ? `${location[1]}:${location[2]}` : null
  };
}

/** The mission success criteria as bounded obligations for a round with no answered prior findings. */
export function successCriteriaFindings(criteria: readonly string[]): readonly ReviewFinding[] {
  return criteria.map((text, index) => ({ id: reviewFindingId(`success-criterion-${index + 1}`), summary: `Success criterion ${index + 1}: ${text}`, location: null }));
}

/** Complete prior findings, the exact withdrawn gate, or the mission success criteria. Broader obligations require general review. */
export function applyClassifierReview(review: Review, source: ClassifierReviewSource, route: 'clear' | 'implementer', at: string,
  criteria: readonly ReviewFinding[] = [], verifiedRevision: string = currentReviewRound(review).subject.revision): Review {
  assertClassifierReviewSource(source);
  const thresholds = classifierPolicyThresholds(source.policyVersion);
  const current = currentReviewRound(review);
  const prior = review.rounds.at(-2);
  assertClassifierRoundScope(review, current, prior, source, verifiedRevision);
  const findings = classifierFindings(review, prior, source, criteria, route);
  const ids = findings.map(f => f.id).sort((left, right) => left.localeCompare(right));
  assertClassifierCoverage(ids, prior, source);
  assertClassifierDecision(current, ids, source, route, at, thresholds);
  const w = source.weakening;
  const comment = w ? `Approval of ${w.approvedRevision} restored: gate ${w.gate} ${w.factAdmitted === false ? 'has no admitted re-run fact; mandatory integration gates still apply' : `re-ran green at ${w.validationSha} (${w.relation})`} and the repair preserves the checked obligation (${source.score})${w.question ? `; cleared by ${w.question.clearedBy}, preserves ${w.question.preserves}, questions ${w.question.versions.join(', ')}` : ''}.`
    : route === 'clear' ? 'Classifier cleared the complete prior finding set.'
      : source.obligations ? `Unresolved prior obligations: ${source.obligations.failingIds.join(', ')}. Make changes or request general review.`
      : 'Classifier reports likely unresolved prior findings. Make changes or request general review; no repair instructions supplied.';
  const decision = route === 'clear'
    ? { kind: 'approved' as const, decidedAt: at, revision: changeRevision(source.candidateRevision), comment, source: { kind: 'provider' as const, provider: 'forgejo' }, classifier: source }
    : { kind: 'changes-requested' as const, decidedAt: at, revision: changeRevision(source.candidateRevision), comment, findings, classifier: source };
  return {
    ...review, rounds: replaceCurrentRound(review, {
      ...current, decision, phase: route === 'clear' ? 'approved' : 'fixing', disposition: route === 'clear' ? 'APPROVED' : 'REQUEST_CHANGES',
    })
  };
}

function assertClassifierCoverage(ids: readonly string[], prior: ReviewRound, source: ClassifierReviewSource): void {
  if (JSON.stringify(ids) !== JSON.stringify([...new Set(source.findingIds)].sort((left, right) => left.localeCompare(right)))
    || (!source.obligations && !source.integrationRepair && !source.successCriteria && JSON.stringify(ids) !== JSON.stringify(prior!.response!.resolutions.map(r => r.findingId).sort((left, right) => left.localeCompare(right))))) {
    throw new Error('Classifier review must cover the complete original finding set');
  }

}

function assertClassifierDecision(current: ReviewRound, ids: readonly string[], source: ClassifierReviewSource, route: 'clear' | 'implementer', at: string, thresholds: ReturnType<typeof classifierPolicyThresholds>): void {
  if (current.subject.change.kind !== 'pull-request' || current.subject.change.provider !== 'forgejo' || !ids.length
    || !Number.isFinite(Date.parse(at))
    || (route === 'clear' ? !clearingLabel(source) || source.score < thresholds.clear : source.weakening !== undefined || source.label !== 'does_not_address' || source.score < thresholds.unresolved)) {
    throw new Error('Classifier review provenance or threshold is invalid');
  }

}

function assertClassifierRoundScope(review: Review, current: ReviewRound, prior: ReviewRound | undefined, source: ClassifierReviewSource, verifiedRevision: string): asserts prior is ReviewRound {
  if (current.number === 1 || !prior) { throw new Error('First review requires the general reviewer'); }
  const obligation = source.obligations ? reviewObligations(review) : null;
  if (source.policyVersion !== expectedClassifierPolicy(review, source)) { throw new Error('Classifier review must use the current policy for this scope'); }
  if (current.decision || current.phase !== 'reviewing' || source.candidateRevision !== verifiedRevision
    || (source.successCriteria ? source.priorRevision !== source.candidateRevision : (obligation?.general ?? prior)?.decision?.revision !== source.priorRevision)) { throw new Error('Classifier review scope or revision is stale'); }

}

function expectedClassifierPolicy(review: Review, source: ClassifierReviewSource): string {
  return source.obligations ? OBLIGATION_POLICY_VERSION : source.weakening ? WEAKENING_POLICY_VERSION : classifierPolicyForReview(review);
}

function classifierFindings(review: Review, prior: ReviewRound, source: ClassifierReviewSource, criteria: readonly ReviewFinding[], route: 'clear' | 'implementer'): readonly ReviewFinding[] {
  let findings: readonly ReviewFinding[];
  if (source.obligations) {
    findings = classifierObligationFindings(review, source, source.obligations, route);
  } else if (source.successCriteria) {
    findings = criteria;
  } else if (!prior) {
    throw new Error('Classifier review scope or revision is stale');
  } else if (source.integrationRepair) {
    findings = classifierIntegrationRepairFindings(prior, source, source.integrationRepair);
  } else {
    if (prior.decision?.kind !== 'changes-requested' || !prior.response
      || prior.response.resultingRevision !== (source.responseRevision ?? source.candidateRevision)) {
      throw new Error('Classifier review scope or revision is stale');
    }
    findings = prior.decision.findings;
  }
  return findings;
}

function classifierObligationFindings(review: Review, source: ClassifierReviewSource,
  scope: NonNullable<ClassifierReviewSource['obligations']>, route: 'clear' | 'implementer'): readonly ReviewFinding[] {
  const obligation = reviewObligations(review);
  if (!obligation || obligation.general.number !== scope.generalRound || source.integrationRepair || source.successCriteria || source.weakening) {
    throw new Error('Classifier obligation scope is stale');
  }
  const findings = obligation.findings;
  const failed = scope.failingIds;
  if (new Set(failed).size !== failed.length || failed.some(id => !findings.some(f => f.id === id))
    || (route === 'clear' ? failed.length !== 0 : failed.length === 0)) { throw new Error('Invalid failing obligations'); }
  return findings;
}

function classifierIntegrationRepairFindings(prior: ReviewRound, source: ClassifierReviewSource, integrationRepair: NonNullable<ClassifierReviewSource['integrationRepair']>): readonly ReviewFinding[] {
  const revocation = prior.decision?.kind === 'approved' ? prior.decision.revocation : undefined;
  if (revocation?.cause?.kind !== 'integration-gate-failure'
    || revocation.revokedAt !== integrationRepair.revokedAt || revocation.cause.gate !== integrationRepair.gate
    || !source.responseRevision) { throw new Error('Classifier integration repair scope is stale'); }
  return [integrationRepairFinding(revocation.cause)];
}
