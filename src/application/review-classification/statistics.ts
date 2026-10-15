import { reportingWindowContains, type ReportingWindow } from '../../domain/decision-window.js';
import type { ClassifierCallMeasurement } from '../ports/review-classification-telemetry.js';

export interface PrDecisionFact {
  /** Stable repository/mission/round identity, independent of classifier attempts. */
  readonly id: string;
  readonly repository?: string;
  readonly mission?: string;
  readonly round: number;
  readonly decidedAt: string;
  readonly source: 'classifier' | 'mechanical' | 'reviewer';
  readonly outcome: 'clear' | 'implementer';
}
export interface ClassifierStatisticsInput {
  readonly decisions: readonly PrDecisionFact[];
  readonly attempts: readonly ClassifierCallMeasurement[];
  readonly coverage: 'complete' | 'partial' | 'unavailable';
}

export type RoundKind = 'all' | 'first review' | 're-review';
/** Round 1 has no earlier round; every historical telemetry row is round 2 or later, so it stays a re-review. */
export const roundKindOf = (round: number): Exclude<RoundKind, 'all'> => round === 1 ? 'first review' : 're-review';

/**
 * Stored verdicts own decided totals; samples independently describe attempts.
 * Retried samples count once per round, with any timed invocation counted as called.
 */
export function reviewRounds(input: ClassifierStatisticsInput, window: ReportingWindow, kind: RoundKind = 'all') {
  const inside = (at: string): boolean => reportingWindowContains(window, at);
  const ofKind = (round: number) => kind === 'all' || roundKindOf(round) === kind;
  const byRound = new Map<string, ClassifierCallMeasurement[]>();
  for (const sample of input.attempts) {
    const key = JSON.stringify([sample.repository, sample.mission, sample.round]);
    byRound.set(key, [...(byRound.get(key) ?? []), sample]);
  }
  const rounds = [...byRound.values()].map(samples => ({
    latest: samples.reduce((a, b) => Date.parse(b.observedAt) >= Date.parse(a.observedAt) ? b : a, samples[0]),
    called: samples.some(sample => sample.classificationMs !== null),
  })).filter(round => inside(round.latest.observedAt) && ofKind(round.latest.round));
  const decided = (round: { latest: ClassifierCallMeasurement }, route: ClassifierCallMeasurement['route']) =>
    !round.latest.shadow && round.latest.route === route;
  const reviewerRounds = rounds.filter(round => round.latest.route === 'reviewer' || round.latest.shadow);
  const decisions = [...new Map(input.decisions.map(d => [d.id, d])).values()]
    .filter(d => inside(d.decidedAt) && ofKind(d.round));
  const cleared = decisions.filter(d => d.source === 'classifier' && d.outcome === 'clear').length;
  const returned = decisions.filter(d => d.source === 'classifier' && d.outcome === 'implementer').length;
  const firstSampleAt = input.attempts.map(a => a.observedAt).sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? null;
  const missingSamples = decisions.some(d => !input.attempts.some(a => a.decisionId === d.id
    || (d.repository === a.repository && d.mission === a.mission && d.round === a.round)));
  const coverage = input.coverage === 'complete' && firstSampleAt !== null
    && Date.parse(firstSampleAt) <= window.start.getTime() && !missingSamples ? 'complete' : 'partial';
  return {
    coverage, firstSampleAt, rounds: decisions.length, sampleRounds: rounds.length,
    mechanical: decisions.filter(d => d.source === 'mechanical').length,
    reviewer: decisions.filter(d => d.source === 'reviewer').length,
    notAttempted: rounds.filter(round => round.latest.provider === null).length,
    fellBack: reviewerRounds.filter(round => round.latest.provider !== null).length,
    clearsWithOmissions: rounds.filter(round => decided(round, 'clear') && ((round.latest.omittedDiffCount ?? 0) > 0 || (round.latest.omittedTokens ?? 0) > 0)).length,
    clearsWithoutOmissions: rounds.filter(round => decided(round, 'clear') && round.latest.omittedDiffCount === 0 && round.latest.omittedTokens === 0).length,
    clearsOmissionsUnknown: rounds.filter(round => decided(round, 'clear') && round.latest.omittedDiffCount === undefined).length,
    called: rounds.filter(round => round.called).length, cleared, returned, jevDecisions: cleared + returned,
    reasons: Object.fromEntries([...new Set(reviewerRounds.map(round => round.latest.reason))].sort((a, b) => a.localeCompare(b))
      .map(reason => [reason, reviewerRounds.filter(round => round.latest.reason === reason).length])),
  };
}
