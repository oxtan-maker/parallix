import { analyzeRequestTokens, getEncoding, type JsonValue, type Questions } from 'jevtok-ts';
import type { DecisionRequestBudget } from '../../application/ports/decision.js';

/** Existing provider aliases name the pinned Jev family; other models are unsupported. */
export function supportsDecisionBudget(model: string): boolean {
  return ['jev-latest', 'typesafe/jev-latest', 'typesafe-ai/jev', 'jev-1.13', 'jev-1.13.0',
    'jev-1.13-20260917', 'typesafe/jev-1.13', 'typesafe/jev-1.13.0', 'typesafe/jev-1.13-20260917'].includes(model);
}

/** The pinned Jev tokenizer owns provider accounting, including structured state. */
export function measureDecisionBudget(body: string, model: string): DecisionRequestBudget {
  if (!supportsDecisionBudget(model)) { throw new Error('Unsupported decision tokenizer'); }
  const encoding = getEncoding('jev-1.13');
  const payload = JSON.parse(body) as { state: JsonValue; questions: Questions };
  const analysis = analyzeRequestTokens(payload.state, payload.questions, {
    encoding, limits: { total: 64_000, stateAndLongestQuestion: 30_000 },
  });
  return { requestBytes: Buffer.byteLength(body), inputTokens: analysis.totalTokens,
    contextTokens: analysis.stateTokens + analysis.longestQuestionTokens,
    maxRequestBytes: 1_000_000, maxInputTokens: analysis.limits.total,
    maxContextTokens: analysis.limits.stateAndLongestQuestion, tokenizerModel: analysis.modelVersion };
}
