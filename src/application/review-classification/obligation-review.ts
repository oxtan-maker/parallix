import { OBLIGATION_POLICY_VERSION, OBLIGATION_THRESHOLD } from '../../domain/classifier-review.js';
import type { DecisionPort, DecisionQuestion, DecisionRequest, DecisionResult } from '../ports/decision.js';
import type { ReviewEvidencePort } from '../ports/review-evidence.js';
import { EvidenceOverBudgetError } from '../ports/review-evidence.js';
import { fitPacket } from './fit-packet.js';
import type { ReviewScope } from './classify-review.js';
import type { ClassificationRoute } from './routing-policy.js';

export const OBLIGATION_PROMPT_VERSION = 'px-0010-3b-reviewer-frozen-v1';
export const OBLIGATION_PACKET_VERSION = 'general-obligation-fitted-v1';
const BASE = 'A reviewer requested changes with the finding in state.finding. The implementer then produced the repair in state.repairDiff (prior revision to candidate, mission files only; Backlog records excluded) and answered in state.implementerResponse. Decide whether the candidate fixes this finding. The implementer response is a claim, not evidence. Choose insufficient_evidence when the fix cannot be judged from the supplied diff (for example it depends on a test run, a checkpoint record or files not shown).';
/** Exact reviewer arm from px-0010/oc/jev.mts, frozen before its validation calls. */
export const obligationQuestion = (text: string): DecisionQuestion => ({ type: 'choice',
  instructions: `${BASE} The reviewer who raised the finding saw the code and defined the obligation below; decide whether the repair satisfies exactly that obligation, including any change, guard or regression test the reviewer asked for. Obligation: ${text}`,
  criteria: { addresses: 'The supplied repair fixes the finding.', does_not_address: 'The supplied repair leaves the finding unfixed or only partly fixed.', insufficient_evidence: 'The supplied evidence cannot show whether the finding is fixed.' } });

export interface ObligationAnswer {
  readonly id: string;
  readonly selected: string | null;
  readonly probabilities: Readonly<Record<string, number>> | null;
  readonly failure: string | null;
}
const labels = ['addresses', 'does_not_address', 'insufficient_evidence'];
export function obligationAnswer(id: string, result: DecisionResult): ObligationAnswer {
  try {
    const answer = result.answers.resolution;
    if (Object.keys(result.answers).length !== 1 || answer.type !== 'choice' || !labels.includes(answer.selected)
      || ![result.provider, result.model].every(s => typeof s === 'string' && s.trim().length && s.length <= 256)
      || !Number.isFinite(answer.confidence) || answer.confidence < 0 || answer.confidence > 1
      || Object.keys(answer.probabilities).length !== 3
      || !labels.every(l => Number.isFinite(answer.probabilities[l]) && answer.probabilities[l] >= 0 && answer.probabilities[l] <= 1)
      || Math.abs(labels.reduce((n, l) => n + answer.probabilities[l], 0) - 1) > 0.02) { throw new Error('invalid'); }
    return { id, selected: answer.selected, probabilities: { ...answer.probabilities }, failure: null };
  } catch { return { id, selected: null, probabilities: null, failure: 'invalid-answer' }; }
}
export function aggregateObligations(ids: readonly string[], answers: readonly ObligationAnswer[]): ClassificationRoute {
  if (!ids.length || answers.length !== ids.length || new Set(ids).size !== ids.length
    || answers.some((a, i) => a.id !== ids[i] || a.failure || !a.probabilities)) {
    return { route: 'reviewer', label: null, score: null, reason: 'obligation-call-failure' };
  }
  const failed = answers.filter(a => a.selected === 'does_not_address' && a.probabilities!.does_not_address >= OBLIGATION_THRESHOLD);
  if (failed.length) { return { route: 'implementer', label: 'does_not_address', score: Math.max(...failed.map(a => a.probabilities!.does_not_address)), reason: `unresolved-obligations:${failed.map(a => a.id).join(',')}` }; }
  if (answers.every(a => a.selected === 'addresses' && a.probabilities!.addresses >= OBLIGATION_THRESHOLD)) {
    return { route: 'clear', label: 'addresses', score: Math.min(...answers.map(a => a.probabilities!.addresses)), reason: 'all-obligations-addressed' };
  }
  return { route: 'reviewer', label: null, score: null, reason: 'obligation-abstention' };
}

/** Full serialized question participates in every tokenizer and transport admission check. */
function measure(port: DecisionPort, request: DecisionRequest) {
  const b = port.requestBudget(request);
  if (![b.requestBytes, b.inputTokens, b.contextTokens, b.maxRequestBytes, b.maxInputTokens, b.maxContextTokens].every(n => Number.isFinite(n) && n >= 0)
    || !b.tokenizerModel) { throw new EvidenceOverBudgetError('Invalid or oversized obligation request'); }
  return { ...b, contextTokens: b.requestBytes > b.maxRequestBytes ? Math.min(30000, b.maxContextTokens) + 1 : b.contextTokens, maxInputTokens: Math.min(32000, b.maxInputTokens), maxContextTokens: Math.min(30000, b.maxContextTokens) };
}

export async function obligationPackets(scope: ReviewScope, evidence: ReviewEvidencePort, port: DecisionPort) {
  await evidence.tree(scope.baseRevision);
  const diff = await evidence.diff(scope.baseRevision, scope.candidateRevision, []);
  // Exclude workflow records by complete file boundaries, as in the frozen packet.
  const repairDiff = diff.split(/(?=^diff --git )/m).filter(part => !/^diff --git a\/backlog\//.test(part)).join('');
  return scope.findings.map(f => {
    const request: DecisionRequest = { state: { finding: f.summary, priorReviewComment: scope.evidenceComment,
      implementerResponse: scope.evidenceResponse, repairDiff }, questions: { resolution: obligationQuestion(f.summary) } };
    fitPacket(request, r => measure(port, r), { diffKey: 'repairDiff' });
    measure(port, request);
    return { id: String(f.id), request };
  });
}
export async function runObligations(packets: Awaited<ReturnType<typeof obligationPackets>>, port: DecisionPort) {
  const answers: ObligationAnswer[] = [];
  let identity = { provider: '', model: '' };
  for (const { id, request } of packets) {
    try {
      const result = await port.decide(request);
      const answer = obligationAnswer(id, result);
      answers.push(answer);
      if (!answer.failure) { identity = { provider: result.provider, model: result.model }; }
    } catch { answers.push({ id, selected: null, probabilities: null, failure: 'provider-failure' }); }
  }
  return { ...identity, answers, selected: aggregateObligations(packets.map(p => p.id), answers), policyVersion: OBLIGATION_POLICY_VERSION };
}
