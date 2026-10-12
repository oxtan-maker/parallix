import { reportingWindowContains, type ReportingWindow } from '../../domain/decision-window.js';
import { WEAKENING_POLICY_VERSION, WEAKENING_THRESHOLD } from './weakening-policy.js';
import type { ClassifierCallMeasurement } from '../ports/review-classification-telemetry.js';
import type { ClassifierStatisticsInput } from './statistics.js';

/** What happened to an approval which the weakening question restored, read from later review rounds of the same mission. */
export interface RepairClearFact {
  readonly decisionId: string;
  readonly decidedAt: string;
  readonly outcome: 'revoked-by-human' | 'changes-requested-later' | 'landed' | 'open';
}

export const FALLBACK_CATEGORIES = ['no fact', 'below threshold', 'weakens', 'insufficient evidence', 'failure', 'over budget', 'other'] as const;
export type FallbackCategory = typeof FALLBACK_CATEGORIES[number];

const NO_FACT = new Set(['weakening-no-fact', 'weakening-fact-after-round-start', 'weakening-gate-not-validated', 'weakening-code-after-validated-sha']);
const FAILURE = new Set(['weakening-failure', 'provider-unavailable', 'provider-key-missing']);

export function fallbackCategory(reason: string): FallbackCategory {
  if (NO_FACT.has(reason)) { return 'no fact'; }
  if (FAILURE.has(reason)) { return 'failure'; }
  const named: Record<string, FallbackCategory> = { 'weakening-below-threshold': 'below threshold', 'weakening-weakens': 'weakens',
    'weakening-insufficient-evidence': 'insufficient evidence', 'weakening-over-budget': 'over budget' };
  return named[reason] ?? 'other';
}

export const PRESERVES_BUCKETS = ['>= 0.60', '0.40-0.60', '< 0.40'] as const;
export const bucketOf = (score: number): typeof PRESERVES_BUCKETS[number] =>
  score >= WEAKENING_THRESHOLD ? PRESERVES_BUCKETS[0] : score >= 0.4 ? PRESERVES_BUCKETS[1] : PRESERVES_BUCKETS[2];

/** Integration-repair review rounds, one per (mission, round): the latest sample decides the outcome. */
export function integrationRepairStatistics(input: ClassifierStatisticsInput, window: ReportingWindow) {
  const byRound = new Map<string, ClassifierCallMeasurement[]>();
  for (const sample of input.attempts.filter(a => a.policyVersion === WEAKENING_POLICY_VERSION)) {
    const key = JSON.stringify([sample.repository, sample.mission, sample.round]);
    byRound.set(key, [...(byRound.get(key) ?? []), sample]);
  }
  const rounds = [...byRound.values()].map(samples => ({
    latest: samples.reduce((a, b) => Date.parse(b.observedAt) >= Date.parse(a.observedAt) ? b : a, samples[0]),
    factAdmitted: samples.some(s => s.admissibleFact === true), called: samples.some(s => s.classificationMs !== null),
  })).filter(round => reportingWindowContains(window, round.latest.observedAt));
  const cleared = rounds.filter(r => !r.latest.shadow && r.latest.route === 'clear');
  const fellBack = rounds.filter(r => r.latest.shadow || r.latest.route === 'reviewer');
  const reasons = Object.fromEntries(FALLBACK_CATEGORIES.map(category => [category,
    fellBack.filter(r => fallbackCategory(r.latest.reason) === category).length])) as Record<FallbackCategory, number>;
  const distribution = (set: typeof rounds) => Object.fromEntries(PRESERVES_BUCKETS.map(bucket => [bucket,
    set.filter(r => r.latest.score !== null && bucketOf(r.latest.score) === bucket).length])) as Record<typeof PRESERVES_BUCKETS[number], number>;
  const clears = (input.repairClears ?? []).filter(fact => reportingWindowContains(window, fact.decidedAt));
  const wrong = clears.filter(c => c.outcome === 'revoked-by-human' || c.outcome === 'changes-requested-later').length;
  const unobserved = clears.filter(c => c.outcome === 'open').length;
  return { coverage: input.coverage, rounds: rounds.length, withFact: rounds.filter(r => r.factAdmitted).length, calls: rounds.filter(r => r.called).length,
    clears: cleared.length, reasons, clearScores: distribution(cleared), fallbackScores: distribution(fellBack),
    clearsRecorded: clears.length, observedClears: clears.length - unobserved, unobservedClears: unobserved, wrongClears: wrong };
}
