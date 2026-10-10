import type { DecisionAnswer, DecisionData, DecisionPort, DecisionRequest, DecisionResult } from '../ports/decision.js';
import { EvidenceOverBudgetError } from '../ports/review-evidence.js';
import { PANEL_POLICY_VERSION } from '../../domain/classifier-review.js';
import { PANEL_QUESTIONS, PANEL_PROMPT_VERSION, type PanelQuestionId } from './panel-questions.js';
import type { ClassificationRoute } from './routing-policy.js';

export interface PanelMember {
  readonly question: PanelQuestionId;
  readonly questionHash: string;
  readonly provider: string;
  readonly configuredModel: string;
  readonly model: string | null;
  readonly selected: string | null;
  readonly probabilities: Readonly<Record<string, number>> | null;
  readonly vote: 'approve' | 'reject' | null;
  readonly failure: string | null;
  readonly usage: DecisionResult['usage'] | null;
}
export interface PanelMeasurement {
  readonly policyVersion: string;
  readonly promptVersion: string;
  readonly calls: number;
  readonly members: readonly PanelMember[];
  readonly outcome: ClassificationRoute['route'];
  readonly reason: string;
}
const labels = ['addresses', 'does_not_address', 'insufficient_evidence'];

function validChoice(answer: DecisionAnswer | undefined): answer is Extract<DecisionAnswer, { type: 'choice' }> {
  if (!answer || answer.type !== 'choice' || !labels.includes(answer.selected)) { return false; }
  const probability = (n: number) => Number.isFinite(n) && n >= 0 && n <= 1;
  return probability(answer.confidence) && Object.keys(answer.probabilities).length === 3
    && labels.every(label => probability(answer.probabilities[label]))
    && Math.abs(labels.reduce((sum, label) => sum + answer.probabilities[label], 0) - 1) <= 0.02;
}

/** All probabilities are schema checked; confidence never determines the vote. */
function validIdentity(result: DecisionResult): boolean {
  return [result.provider, result.model].every(value => typeof value === 'string' && value.trim().length > 0 && value.length <= 256);
}

export function panelVote(id: PanelQuestionId, result: DecisionResult): Pick<PanelMember, 'selected' | 'probabilities' | 'vote' | 'failure'> {
  const answer = result.answers.resolution;
  if (Object.keys(result.answers).length !== 1 || !validIdentity(result) || !validChoice(answer)) {
    return { selected: null, probabilities: null, vote: null, failure: 'invalid-answer' };
  }
  const score = answer.probabilities[answer.selected];
  const vote = answer.selected === 'addresses' && id !== 'original' && score >= (id === 'v3' ? 0.51 : 0.80)
    ? 'approve' : answer.selected === 'does_not_address' && id !== 'v3' && score >= 0.89 ? 'reject' : null;
  return { selected: answer.selected, probabilities: { ...answer.probabilities }, vote, failure: null };
}

export function aggregatePanel(members: readonly PanelMember[]): ClassificationRoute {
  if (members.length !== 3 || new Set(members.map(m => m.question)).size !== 3 || members.some(m => m.failure)) {
    return { route: 'reviewer', label: null, score: null, reason: 'classifier-failure' };
  }
  const approves = members.filter(m => m.vote === 'approve');
  const rejects = members.filter(m => m.vote === 'reject');
  if (approves.length && rejects.length) { return { route: 'reviewer', label: null, score: null, reason: 'panel-conflict' }; }
  const chosen = (approves.length ? approves : rejects)[0];
  if (!chosen) { return { route: 'reviewer', label: null, score: null, reason: 'abstention' }; }
  return { route: approves.length ? 'clear' : 'implementer', label: chosen.selected,
    score: chosen.probabilities![chosen.selected!], reason: approves.length ? 'resolved-threshold' : 'unresolved-threshold' };
}

function freezeData(value: DecisionData): DecisionData {
  if (value && typeof value === 'object') { Object.values(value).forEach(freezeData); Object.freeze(value); }
  return value;
}

/** Admit all requests first, await all members, and retain one panel decision. */
export async function runPanel(state: DecisionData, port: DecisionPort, route: { provider: string; model: string }, hash: (_text: string) => string) {
  const immutable = freezeData(JSON.parse(JSON.stringify(state)) as DecisionData);
  const requests = (Object.keys(PANEL_QUESTIONS) as PanelQuestionId[]).map(question => ({ question,
    request: { state: immutable, questions: { resolution: PANEL_QUESTIONS[question] } } satisfies DecisionRequest }));
  for (const { request } of requests) {
    const b = port.requestBudget(request);
    if (![b.requestBytes, b.inputTokens, b.contextTokens, b.maxRequestBytes, b.maxInputTokens, b.maxContextTokens].every(n => Number.isFinite(n) && n >= 0)
      || !b.tokenizerModel || b.requestBytes > b.maxRequestBytes || b.inputTokens > Math.min(32000, b.maxInputTokens)
      || b.contextTokens > Math.min(30000, b.maxContextTokens)) { throw new EvidenceOverBudgetError('Panel request exceeds frozen admission limits'); }
  }
  const members = await Promise.all(requests.map(async ({ question, request }): Promise<PanelMember> => {
    const base = { question, questionHash: hash(JSON.stringify(request.questions.resolution)), provider: route.provider, configuredModel: route.model };
    try {
      const result = await port.decide(request);
      const usage = result.usage ?? null;
      const invalidUsage = usage && Object.entries(usage).some(([key, value]) => !Number.isFinite(value) || value < 0
        || (key !== 'cost' && !Number.isSafeInteger(value)));
      return { ...base, model: validIdentity(result) ? result.model : null, ...panelVote(question, result), usage: invalidUsage ? null : usage,
        ...(invalidUsage ? { failure: 'invalid-usage', vote: null } : {}) };
    } catch { return { ...base, model: null, selected: null, probabilities: null, vote: null, failure: 'provider-failure', usage: null }; }
  }));
  const selected = aggregatePanel(members);
  const measurement: PanelMeasurement = { policyVersion: PANEL_POLICY_VERSION, promptVersion: PANEL_PROMPT_VERSION,
    calls: requests.length, members, outcome: selected.route, reason: selected.reason };
  const witness = members.find(m => m.vote === (selected.route === 'clear' ? 'approve' : 'reject'));
  return { selected, measurement, provider: witness?.provider ?? route.provider, model: witness?.model ?? route.model };
}
