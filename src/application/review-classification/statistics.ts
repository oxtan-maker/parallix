import { reportingWindowContains, type ReportingWindow } from '../../domain/decision-window.js';
import type { AppliedClassifierDecision, ClassifierObservation, ClassifierCallMeasurement } from '../ports/review-classification-telemetry.js';

export interface PrDecisionFact {
  readonly id: string;
  readonly decidedAt: string;
  readonly source: 'classifier' | 'reviewer';
  readonly outcome: 'clear' | 'implementer';
}
export interface ClassifierStatisticsInput {
  readonly decisions: readonly PrDecisionFact[];
  readonly attempts: readonly ClassifierCallMeasurement[];
  readonly observations: readonly ClassifierObservation[];
  readonly applied: readonly AppliedClassifierDecision[];
  readonly coverage: 'complete' | 'partial' | 'unavailable';
  readonly missions?: readonly { mission: string; closedAt: string | null; reviewRounds: number; fixRounds: number }[];
  readonly agentModels?: readonly { mission: string; role: 'implementer' | 'reviewer'; family: string; provider: string | null; model: string | null }[];
}

/** Count applied verdicts, not calls or completed missions, within the shared reporting-day windows. */
export function classifierStatistics(input: ClassifierStatisticsInput, window: ReportingWindow) {
  const inside = (at: string): boolean => reportingWindowContains(window, at);
  const unique = new Map(input.decisions.map(d => [d.id, d]));
  const decisions = [...unique.values()].filter(d => inside(d.decidedAt));
  const classifiers = decisions.filter(d => d.source === 'classifier');
  const attempts = input.attempts.filter(a => inside(a.observedAt));
  const applied = input.applied.filter(d => inside(d.decidedAt));
  const latestObservation = new Map(input.observations.map(o => [o.decisionId, o]));
  const matchedObservation = (sample: ClassifierCallMeasurement) => {
    const observation = latestObservation.get(sample.decisionId);
    return observation?.revision === sample.candidateRevision
      && JSON.stringify([...observation.findingIds].sort()) === JSON.stringify([...sample.findingIds].sort()) ? observation : null;
  };
  let falseClears = 0, falseReturns = 0, unobserved = 0;
  for (const decision of applied) {
    const attempt = input.attempts.find(a => a.decisionId === decision.decisionId);
    const observation = latestObservation.get(decision.decisionId);
    if (!attempt || !observation || observation.revision !== attempt.candidateRevision
      || JSON.stringify([...observation.findingIds].sort()) !== JSON.stringify([...attempt.findingIds].sort())
      || observation.originalFindings === 'unobserved') { unobserved++; continue; }
    if (decision.route === 'clear' && observation.originalFindings === 'unresolved') { falseClears++; }
    if (decision.route === 'implementer' && observation.originalFindings === 'resolved') { falseReturns++; }
  }
  const elapsed = (key: 'preparationMs' | 'classificationMs') => {
    const values = attempts.map(a => a[key]).filter((n): n is number => n !== null);
    return { totalMs: values.length ? values.reduce((a, b) => a + b, 0) : null, observed: values.length };
  };
  const shadowDecisions = [...new Map(attempts.filter(a => a.shadow).map(a => [a.decisionId, a])).values()];
  const shadowUnobserved = shadowDecisions.filter(a => !matchedObservation(a)
    || matchedObservation(a)!.originalFindings === 'unobserved').length;
  const shadowFalseClears = shadowDecisions.filter(a => a.route === 'clear' && matchedObservation(a)?.originalFindings === 'unresolved').length;
  const shadowFalseReturns = shadowDecisions.filter(a => a.route === 'implementer' && matchedObservation(a)?.originalFindings === 'resolved').length;
  const observed = [...new Set(attempts.map(a => a.decisionId))].flatMap(id => {
    const sample = attempts.find(a => a.decisionId === id)!;
    const observation = matchedObservation(sample);
    return observation ? [observation] : [];
  });
  return {
    coverage: input.coverage, total: decisions.length, classifier: classifiers.length,
    percentage: decisions.length && input.coverage === 'complete' ? 100 * classifiers.length / decisions.length : null,
    clears: classifiers.filter(d => d.outcome === 'clear').length,
    returns: classifiers.filter(d => d.outcome === 'implementer').length,
    calls: attempts.filter(a => a.classificationMs !== null).length,
    attempts: attempts.length, eligibleDecisions: new Set(attempts.map(a => a.decisionId)).size,
    shadows: attempts.filter(a => a.shadow).length,
    fallbacks: attempts.filter(a => a.route === 'reviewer').length,
    falseClears, falseReturns, unobserved,
    shadowFalseClears, shadowFalseReturns, shadowUnobserved,
    newFindings: observed.reduce((n, o) => n + (o.newFindings ?? 0), 0),
    newFindingObservations: observed.filter(o => o.newFindings !== null).length,
    fallbackReasons: Object.fromEntries([...new Set(attempts.filter(a => a.route === 'reviewer').map(a => a.reason))]
      .map(reason => [reason, attempts.filter(a => a.route === 'reviewer' && a.reason === reason).length])),
    preparation: elapsed('preparationMs'), classification: elapsed('classificationMs'),
  };
}

export type RoundKind = 'all' | 'first review' | 're-review';
/** Round 1 has no earlier round; every historical telemetry row is round 2 or later, so it stays a re-review. */
export const roundKindOf = (round: number): Exclude<RoundKind, 'all'> => round === 1 ? 'first review' : 're-review';

/**
 * Review rounds of one kind, not call samples: a retried round keeps one entry (its latest
 * sample decides the outcome) while any of its samples may show the classifier ran.
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
  const applied = input.applied.filter(decision => inside(decision.decidedAt)
    && ofKind(input.attempts.find(a => a.decisionId === decision.decisionId)?.round ?? 0));
  const unobserved = applied.filter(decision => {
    const sample = input.attempts.find(a => a.decisionId === decision.decisionId);
    const observation = input.observations.find(o => o.decisionId === decision.decisionId);
    return !sample || !observation || observation.revision !== sample.candidateRevision || observation.originalFindings === 'unobserved';
  }).length;
  const wrong = applied.filter(decision => {
    const observation = input.observations.find(o => o.decisionId === decision.decisionId);
    return (decision.route === 'clear' && observation?.originalFindings === 'unresolved')
      || (decision.route === 'implementer' && observation?.originalFindings === 'resolved');
  }).length;
  const cleared = rounds.filter(round => decided(round, 'clear')).length;
  const returned = rounds.filter(round => decided(round, 'implementer')).length;
  return {
    coverage: input.coverage, rounds: rounds.length,
    notAttempted: rounds.filter(round => round.latest.provider === null).length,
    fellBack: reviewerRounds.filter(round => round.latest.provider !== null).length,
    called: rounds.filter(round => round.called).length, cleared, returned, jevDecisions: cleared + returned,
    appliedDecisions: applied.length, observedDecisions: applied.length - unobserved, wrong,
    reasons: Object.fromEntries([...new Set(reviewerRounds.map(round => round.latest.reason))].sort((a, b) => a.localeCompare(b))
      .map(reason => [reason, reviewerRounds.filter(round => round.latest.reason === reason).length])),
  };
}

/** Agent-family/model comparison uses the same decisions and full-history samples. */
export function classifierGroups(input: ClassifierStatisticsInput, window: ReportingWindow) {
  if (!input.missions) { return null; }
  const cohort = input.missions.filter(m => m.closedAt !== null && reportingWindowContains(window, m.closedAt));
  const missionIds = new Set(cohort.map(m => m.mission));
  const history = input.attempts.filter(s => missionIds.has(s.mission));
  const keys = [...new Set(history.map(s => JSON.stringify([s.implementer, s.reviewer, s.provider, s.model])))];
  return keys.map(key => {
    const [implementer, reviewer, provider, model] = JSON.parse(key) as (string | null)[];
    const attempts = history.filter(s => JSON.stringify([s.implementer, s.reviewer, s.provider, s.model]) === key);
    const ids = new Set(attempts.map(s => s.decisionId));
    const statistics = classifierStatistics({ ...input, attempts, decisions: input.decisions.filter(d => ids.has(d.id)),
      applied: input.applied.filter(d => ids.has(d.decisionId)), observations: input.observations.filter(o => ids.has(o.decisionId)) },
      { start: new Date('0001-01-01T00:00:00Z'), end: new Date('9999-12-31T23:59:59Z') });
    const observations = input.observations.filter(o => ids.has(o.decisionId) && attempts.some(a =>
      a.decisionId === o.decisionId && a.candidateRevision === o.revision
      && JSON.stringify([...a.findingIds].sort()) === JSON.stringify([...o.findingIds].sort())));
    const cycleMs = observations.map(o => o.cycleMs).filter((n): n is number => n !== null);
    const ordinaryMs = observations.map(o => o.ordinaryReviewMs).filter((n): n is number => n !== null);
    const measured = observations.filter(o => o.cycleMs !== null && o.ordinaryReviewMs !== null);
    const represented = new Set(attempts.map(s => s.mission));
    const missions = cohort.filter(m => represented.has(m.mission));
    const modelsFor = (role: 'implementer' | 'reviewer', family: string | null) => [...new Set((input.agentModels ?? [])
      .filter(m => represented.has(m.mission) && m.role === role && m.family === family)
      .map(m => `${m.provider ?? 'unavailable'}/${m.model ?? 'unavailable'}`))];
    return { implementer, reviewer, provider, model, statistics, missions: missions.length,
      implementerModels: modelsFor('implementer', implementer), reviewerModels: modelsFor('reviewer', reviewer),
      reviewRounds: missions.reduce((n, m) => n + m.reviewRounds, 0), fixRounds: missions.reduce((n, m) => n + m.fixRounds, 0),
      matchedCycles: measured.length, measuredNetMs: measured.length ? measured.reduce((n, o) => n + o.ordinaryReviewMs! - o.cycleMs!, 0) : null,
      measuredCycles: cycleMs.length, totalCycleMs: cycleMs.length ? cycleMs.reduce((a, b) => a + b, 0) : null,
      totalOrdinaryMs: ordinaryMs.length ? ordinaryMs.reduce((a, b) => a + b, 0) : null };
  }).filter(group => group.statistics.attempts > 0);
}
