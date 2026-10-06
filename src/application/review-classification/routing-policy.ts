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
export function classifyRepeatFindings(result: DecisionResult, policyVersion = ROUTING_POLICY_VERSION): ClassificationRoute {
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

/** Paths beyond cited evidence need general review; only status/date mirror edits are bookkeeping. */
export function hasBroaderReviewObligations(diff: string, paths: readonly string[], taskMirror?: string): boolean {
  const changed = [...diff.matchAll(/^\+\+\+ b\/(.+)$/gm)].map(m => m[1].split('\t')[0]);
  const mirror = taskMirror && diff.split(/^diff --git /m).find(block => block.split('\n')
    .some(line => line.startsWith('+++ b/') && line.slice(6).split('\t')[0] === taskMirror));
  const mirrorLines = mirror?.split('\n').filter(line => /^[+-]/.test(line) && !/^---|^\+\+\+/.test(line)) ?? [];
  const bookkeeping = mirrorLines.length > 0 && mirrorLines.every(line => /^[+-](?:status|updated_date):/.test(line));
  return !changed.length || changed.some(path => !(path === taskMirror && bookkeeping) && !paths.includes(path))
    || /^deleted file mode|^rename (from|to)|^Binary files/m.test(diff);
}
