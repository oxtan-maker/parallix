import type { DecisionResult } from '../ports/decision.js';

import { CLASSIFIER_POLICY_VERSION, classifierPolicyThresholds } from '../../domain/classifier-review.js';

export const ROUTING_POLICY_VERSION = CLASSIFIER_POLICY_VERSION;
export type ClassifierRoute = 'clear' | 'implementer' | 'reviewer';
export interface ClassificationRoute {
  readonly route: ClassifierRoute;
  readonly label: string | null;
  readonly score: number | null;
  readonly reason: string;
}
/** Selected-choice scores are routing signals, never correctness probabilities. */
export function classifyFindings(result: DecisionResult, policyVersion = ROUTING_POLICY_VERSION): ClassificationRoute {
  const thresholds = classifierPolicyThresholds(policyVersion);
  const answer = result.answers.resolution;
  if (!answer || answer.type !== 'choice') {
    return { route: 'reviewer', label: null, score: null, reason: 'invalid-answer' };
  }
  const score = answer.probabilities[answer.selected];
  if (!Number.isFinite(score) || score < 0 || score > 1) {
    return { route: 'reviewer', label: answer.selected, score: null, reason: 'invalid-score' };
  }
  if (answer.selected === 'addresses' && score >= thresholds.clear) {
    return { route: 'clear', label: answer.selected, score, reason: 'resolved-threshold' };
  }
  if (answer.selected === 'does_not_address' && score >= thresholds.unresolved) {
    return { route: 'implementer', label: answer.selected, score, reason: 'unresolved-threshold' };
  }
  return { route: 'reviewer', label: answer.selected, score, reason: 'abstention' };
}
