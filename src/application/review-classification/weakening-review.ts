import type { DecisionAnswer, DecisionResult, DecisionRequest } from '../ports/decision.js';
import { EvidenceOverBudgetError } from '../ports/review-evidence.js';
import type { LoopContext, ReviewRound } from '../review-loop/round.js';
import { WEAKENING_DECISION_SOURCE, type ClassifierReviewSource } from '../../domain/classifier-review.js';
import type { ReviewScope, Decision } from './classify-review.js';
import { admitGateFact, relateToCandidate } from './gate-fact.js';
import type { ReviewClassificationPorts } from '../ports/review-classification.js';
import type { RoundTelemetry } from './round-telemetry.js';
import { buildWeakeningPacket } from './weakening-packet.js';
import { WEAKENING_V5, WEAKENING_V5_PROMPT_VERSION, WEAKENING_LABELS, WEAKENING_PACKET_VERSION, WEAKENING_PROMPT_VERSION, WEAKENING_POLICY_VERSION, WEAKENING_THRESHOLD } from './weakening-policy.js';

/** A weakening decision can only clear, so its packet and provenance are all a caller needs to commit it. */
export type WeakeningDecision = Decision & { readonly weakening: NonNullable<ClassifierReviewSource['weakening']> };

/** Probabilities must be a complete distribution over the three labels. */
function validAnswer(answer: DecisionAnswer | undefined): answer is Extract<DecisionAnswer, { type: 'choice' }> {
  if (!answer || answer.type !== 'choice' || !(WEAKENING_LABELS as readonly string[]).includes(answer.selected)) { return false; }
  const probabilities = WEAKENING_LABELS.map(label => answer.probabilities[label]);
  return Object.keys(answer.probabilities).length === WEAKENING_LABELS.length && probabilities.every(p => Number.isFinite(p) && p >= 0 && p <= 1)
    && Math.abs(probabilities.reduce((sum, p) => sum + p, 0) - 1) <= 0.02;
}

const validIdentity = (result: DecisionResult) => [result.provider, result.model].every(v => typeof v === 'string' && v.trim().length > 0 && v.length <= 256);

/** The single `resolution` answer of a well-formed result, or undefined when identity, shape or probabilities are invalid. */
function resolutionOf(result: DecisionResult): Extract<DecisionAnswer, { type: 'choice' }> | undefined {
  try {
    const answer = result.answers.resolution;
    return Object.keys(result.answers).length === 1 && validIdentity(result) && validAnswer(answer) ? answer : undefined;
  } catch { return undefined; }
}

/** Why an answer which did not reach the threshold goes to the reviewer. */
function fallbackReason(answer: Extract<DecisionAnswer, { type: 'choice' }>): string {
  if (answer.selected === 'weakens') { return 'weakening-weakens'; }
  return answer.selected === 'insufficient_evidence' ? 'weakening-insufficient-evidence' : 'weakening-below-threshold';
}

/** Sequential questions share evidence; failed or malformed V4 answers are non-clears too. */
async function askWeakening(request: DecisionRequest, ports: ReviewClassificationPorts, rows: RoundTelemetry) {
  const classifyStart = ports.clock();
  const ask = async (candidate: DecisionRequest) => {
    try { return await ports.decision.decide(candidate); }
    catch { return undefined; }
    finally { rows.note({ classificationMs: ports.clock() - classifyStart }); }
  };
  let result = await ask(request);
  let answer = result && resolutionOf(result);
  rows.note({ weakening: { v4: { preserves: answer ? answer.probabilities.preserves : null } } });
  let clearedBy: 'weakening-v4' | 'weakening-v5' = WEAKENING_PROMPT_VERSION;
  if (!answer || answer.selected !== 'preserves' || answer.probabilities.preserves < WEAKENING_THRESHOLD) {
    const v5Request = { state: request.state, questions: { resolution: WEAKENING_V5 } };
    const budget = ports.decision.requestBudget(v5Request);
    if (budget.inputTokens > budget.maxInputTokens || budget.contextTokens > budget.maxContextTokens) {
      throw new EvidenceOverBudgetError('Weakening V5 evidence exceeds the decision budget');
    }
    clearedBy = WEAKENING_V5_PROMPT_VERSION;
    rows.note({ weakening: { ...rows.current.weakening!, v5: { preserves: null, cleared: false } } });
    result = await ask(v5Request);
    answer = result && resolutionOf(result);
    rows.note({ weakening: { ...rows.current.weakening!, v5: {
      preserves: answer ? answer.probabilities.preserves : null,
      cleared: !!answer && answer.selected === 'preserves' && answer.probabilities.preserves >= WEAKENING_THRESHOLD,
    } } });
  }
  return { result, answer, clearedBy };
}

/**
 * The two weakening questions for an integration repair: Parallix's recorded green gate answers whether the
 * failure is fixed, so the classifier only judges whether the repair weakened the checked obligation. Every
 * outcome other than `preserves` at the threshold returns null and leaves the round to the general reviewer.
 */
export async function decideWeakening(context: LoopContext, round: ReviewRound, scope: ReviewScope, rows: RoundTelemetry, started: number): Promise<WeakeningDecision | null> {
  const ports = context.ports.classification!;
  const fallback = async (reason: string) => { await rows.finish(reason); context.emit({ kind: 'reviewer-classification', reason }); return null; };
  rows.note({ policyVersion: WEAKENING_POLICY_VERSION, promptVersion: WEAKENING_PROMPT_VERSION, packetVersion: WEAKENING_PACKET_VERSION, panel: undefined });
  const { prior, current, repairCause, candidateRevision, missionRange } = scope;
  let validations: Awaited<ReturnType<typeof ports.validations>>;
  try { validations = await ports.validations(context.slug); } catch { return await fallback('weakening-failure'); }
  const admitted = await admitGateFact({ validations, gate: repairCause!.gate, roundStartedAt: current.startedAt, candidate: candidateRevision,
    relate: sha => relateToCandidate(sha, candidateRevision, ports.evidence, round.reviewBaseline ?? null, current.subject.change.targetBranch) });
  if (admitted.admitted === false) { return await fallback(admitted.reason === 'relation-unavailable' ? 'weakening-failure' : `weakening-${admitted.reason}`); }
  rows.note({ admissibleFact: true });
  if (!missionRange) { return await fallback('weakening-failure'); }
  try {
    const availability = await ports.decision.available();
    if (availability.status !== 'available') { return await fallback(availability.cause === 'credentials-missing' ? 'provider-key-missing' : 'provider-unavailable'); }
    rows.note({ provider: availability.provider, model: availability.model });
    const request = await buildWeakeningPacket({ gate: admitted.fact.gate, log: repairCause!.log ?? null, approved: missionRange.approved, candidate: missionRange.candidate,
      fact: admitted.fact }, ports.evidence, candidate => ports.decision.requestBudget(candidate));
    const packetHash = ports.hash(JSON.stringify(request.state));
    rows.note({ preparationMs: ports.clock() - started, packetHash });
    const { result, answer, clearedBy } = await askWeakening(request, ports, rows);
    if (!answer || !result) { return await fallback('weakening-failure'); }
    const preserves = answer.probabilities.preserves;
    rows.note({ label: answer.selected, score: preserves, provider: result.provider, model: result.model });
    if (answer.selected !== 'preserves' || preserves < WEAKENING_THRESHOLD) { return await fallback(fallbackReason(answer)); }
    if (ports.mode === 'shadow') { await rows.finish('weakening-preserves', { route: 'clear' }); context.emit({ kind: 'reviewer-classification', reason: 'shadow fallback' }); return null; }
    const { fact } = admitted;
    return { selected: { route: 'clear', label: 'preserves', score: preserves, reason: 'weakening-preserves' }, provider: result.provider, model: result.model, packetHash,
      weakening: { decisionSource: WEAKENING_DECISION_SOURCE, approvedRevision: String(prior!.subject.revision), gate: fact.gate, validationSha: fact.validationSha,
        validationRecordedAt: fact.recordedAt, relation: fact.relation,
        question: { clearedBy, preserves, versions: [WEAKENING_PROMPT_VERSION, WEAKENING_V5_PROMPT_VERSION] } } };
  } catch (error) {
    return await fallback(error instanceof EvidenceOverBudgetError ? 'weakening-over-budget' : 'weakening-failure');
  }
}
