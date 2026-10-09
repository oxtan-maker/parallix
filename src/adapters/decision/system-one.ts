import type { DecisionAnswer, DecisionPort, DecisionRequest, DecisionResult } from '../../application/ports/decision.js';
import { DecisionError } from '../../application/ports/decision.js';
import type { DecisionResolution } from './provider.js';
import { measureDecisionBudget, supportsDecisionBudget } from './token-budget.js';
import { decisionHttpError } from './provider-errors.js';

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function invalid(): never { throw new DecisionError('invalid-response', 'Decision provider returned an invalid response.'); }
function finite(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) { return invalid(); }
  return value;
}
function probability(value: unknown): number {
  const number = finite(value);
  if (number < 0 || number > 1) { return invalid(); }
  return number;
}
function distribution(value: unknown, labels: readonly string[]): Record<string, number> {
  if (!record(value) || Object.keys(value).length !== labels.length) { return invalid(); }
  const entries = labels.map(label => [label, probability(value[label])] as const);
  const total = entries.reduce((sum, [, number]) => sum + number, 0);
  if (Math.abs(total - 1) > 0.02) { return invalid(); }
  return Object.fromEntries(entries);
}

function decode(body: unknown, request: DecisionRequest, provider: string): DecisionResult {
  if (!record(body) || !record(body.answers) || typeof body.model !== 'string' || !body.model.trim()) { return invalid(); }
  if (Object.keys(body.answers).length !== Object.keys(request.questions).length) { return invalid(); }
  const answers: Record<string, DecisionAnswer> = Object.create(null);
  for (const [id, question] of Object.entries(request.questions)) {
    const answer = body.answers[id];
    if (!record(answer)) { return invalid(); }
    switch (question.type) {
      case 'boolean':
        if (answer.type !== 'noul') { return invalid(); }
        answers[id] = { type: 'boolean', probability: probability(answer.noul) };
        break;
      case 'choice': {
        if (answer.type !== 'choice' || typeof answer.choice !== 'string' || !Object.hasOwn(question.criteria, answer.choice)) { return invalid(); }
        answers[id] = { type: 'choice', selected: answer.choice,
          probabilities: distribution(answer.probabilities, Object.keys(question.criteria)), confidence: probability(answer.confidence) };
        break;
      }
      case 'score': {
        if (answer.type !== 'score' || !record(answer.legend)) { return invalid(); }
        const score = finite(answer.score);
        if (score < 0 || score > question.criteria.length - 1) { return invalid(); }
        const labels = question.criteria.map((_, index) => String(index));
        if (Object.keys(answer.legend).length !== labels.length || labels.some(label => !Object.hasOwn(answer.legend as object, label))) { return invalid(); }
        answers[id] = { type: 'score', score,
          levels: Object.fromEntries(question.criteria.map((level, index) => [String(index), level])),
          ...(answer.probabilities === undefined ? {} : { probabilities: distribution(answer.probabilities, labels) }),
          confidence: probability(answer.confidence) };
        break;
      }
    }
  }
  let usage: DecisionResult['usage'];
  if (body.usage !== undefined) {
    if (!record(body.usage)) { return invalid(); }
    const count = (value: unknown): number => {
      const number = finite(value);
      if (!Number.isSafeInteger(number) || number < 0) { return invalid(); }
      return number;
    };
    usage = {
      ...(body.usage.input_tokens === undefined ? {} : { inputTokens: count(body.usage.input_tokens) }),
      ...(body.usage.output_tokens === undefined ? {} : { outputTokens: count(body.usage.output_tokens) }),
      ...(body.usage.cost === undefined ? {} : { cost: finite(body.usage.cost) }),
    };
    if (usage.cost !== undefined && usage.cost < 0) { return invalid(); }
  }
  return { provider, model: body.model, answers, ...(usage ? { usage } : {}) };
}

function serialize(request: DecisionRequest, model: string): string {
  if (!record(request.questions) || !Object.keys(request.questions).length) { throw new Error('Decision request requires named questions.'); }
  const questions = Object.fromEntries(Object.entries(request.questions).map(([id, question]) => {
    if (!id.trim() || !record(question) || !['boolean', 'choice', 'score'].includes(question.type)
      || question.instructions === undefined || question.instructions === null || question.instructions === '') {
      throw new Error('Decision questions require a supported type and instructions.');
    }
    if (question.type === 'choice' && (!record(question.criteria) || Object.keys(question.criteria).length < 2 || Object.keys(question.criteria).length > 255)) {
      throw new Error('Choice questions require between 2 and 255 options.');
    }
    if (question.type === 'score' && (!Array.isArray(question.criteria) || question.criteria.length < 2)) {
      throw new Error('Score questions require at least two ordered levels.');
    }
    if (question.type === 'boolean' && question.criteria !== undefined && !record(question.criteria)) {
      throw new Error('Boolean criteria must describe true and false.');
    }
    return [id, { ...question, type: question.type === 'boolean' ? 'noul' : question.type }];
  }));
  // Reject non-JSON inputs rather than silently dropping undefined or coercing NaN.
  let body: string;
  try {
    body = JSON.stringify({ model, state: request.state, questions }, (_key, value: unknown) => {
      if (value === undefined || typeof value === 'function' || typeof value === 'symbol'
        || (typeof value === 'number' && !Number.isFinite(value))) { throw new Error('non-JSON'); }
      return value;
    });
  } catch { throw new Error('Decision request must contain JSON data.'); }
  return body;
}

function encode(request: DecisionRequest, model: string): string {
  const body = serialize(request, model);
  if (Buffer.byteLength(body) > 1_000_000) { throw new Error('Decision request exceeds the one megabyte limit.'); }
  return body;
}

/** No subprocess, repository lookup, credential persistence, or implicit provider fallback. */
export class SystemOneDecisionAdapter implements DecisionPort {
  private readonly resolution: DecisionResolution;
  private readonly transport: typeof fetch;
  constructor(resolution: DecisionResolution, transport: typeof fetch = fetch) {
    this.resolution = resolution;
    this.transport = transport;
  }

  available() { return this.resolution.availability; }

  requestBytes(request: DecisionRequest): number {
    return Buffer.byteLength(serialize(request, this.resolution.route?.model ?? ''));
  }

  requestBudget(request: DecisionRequest) {
    try { return measureDecisionBudget(serialize(request, this.resolution.route?.model ?? ''), this.resolution.route?.model ?? ''); }
    catch { throw new DecisionError('invalid-request', 'Decision request token budget cannot be measured.'); }
  }

  async decide(request: DecisionRequest): Promise<DecisionResult> {
    const route = this.resolution.route;
    if (!route) { throw new DecisionError('setup-required', this.resolution.availability.status === 'setup-required'
      ? this.resolution.availability.reason : 'Decision setup required.'); }
    let body: string;
    try {
      body = encode(request, route.model);
      const budget = supportsDecisionBudget(route.model) ? this.requestBudget(request) : null;
      if (budget && (budget.inputTokens > budget.maxInputTokens || budget.contextTokens > budget.maxContextTokens)) {
        throw new Error('Decision request exceeds model token limits');
      }
    }
    catch { throw new DecisionError('invalid-request', 'Decision request is invalid.'); }
    let response: Response;
    try {
      response = await this.transport(route.endpoint, {
        method: 'POST', redirect: 'error', signal: globalThis.AbortSignal.timeout(route.timeoutMs),
        headers: { Authorization: `Bearer ${route.apiKey}`, 'Content-Type': 'application/json' }, body,
      });
    } catch {
      // Never relay remote bodies or transport errors which may echo credentials/state.
      throw new DecisionError('unavailable', 'Decision provider request failed or timed out.', route.provider);
    }
    if (!response.ok) { throw await decisionHttpError(response, route.provider); }
    let payload: unknown;
    try { payload = await response.json(); }
    catch { throw new DecisionError('invalid-response', 'Decision provider returned invalid JSON.', route.provider); }
    try { return decode(payload, request, route.provider); }
    catch { throw new DecisionError('invalid-response', 'Decision provider returned an invalid response.', route.provider); }
  }
}
