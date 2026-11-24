import type { FlowGraphFacts } from './flow-graph.js';
import type { FlowVerificationRound } from './flow-verification-round.js';
import type { ReviewEpisode, ReviewStatistics } from '../services/review-statistics.js';

type ReviewActor = ReviewEpisode['actor'];
type RecordedReturn = ReviewStatistics['returns'][number];

export function flowReviewInputs(facts: readonly FlowGraphFacts[], actor: ReviewActor) {
  const totals = { concurrent: 0, otherRequests: 0, reviewEpisodes: 0, observedMissions: 0 };
  for (const fact of facts) {
    const rounds = fact.verificationRounds ?? [];
    const starts = new Set<string>();
    const concurrent = new Set<string>();
    for (const round of rounds) {
      const request = round.requests[actor];
      if (!request) { continue; }
      starts.add(request.startKey);
      if (round.execution === 'pilot' && round.concurrent) { concurrent.add(request.startKey); }
    }
    const episodes = (fact.reviewStatistics.episodes ?? []).filter(episode => episode.actor === actor);
    totals.concurrent += concurrent.size;
    totals.otherRequests += starts.size - concurrent.size;
    totals.reviewEpisodes += episodes.filter(episode => !rounds.some(round => matchesReviewRequest(episode, round))).length;
    totals.observedMissions += starts.size > 0 || episodes.length > 0 ? 1 : 0;
  }
  return totals;
}

function matchesReviewRequest(episode: ReviewEpisode, round: FlowVerificationRound): boolean {
  const request = round.requests[episode.actor];
  if (!request) { return false; }
  if (episode.identity === `review:${round.round}`) { return true; }
  // A retained handoff starts when approval moves the mission to integration.
  return episode.actor === 'human' && episode.identity.startsWith('human-handoff:') && round.human.approvedAt !== null
    && round.human.answeredAt !== null && Date.parse(episode.startedAt) === Date.parse(round.human.answeredAt);
}

export interface FlowRoundRepair {
  readonly fact: FlowGraphFacts;
  readonly kind: 'gate' | 'agent' | 'joint';
  readonly returnIdentity: string;
}

export function flowRoundRepairs(facts: readonly FlowGraphFacts[]): FlowRoundRepair[] {
  const repairs: FlowRoundRepair[] = [];
  for (const fact of facts) {
    const rounds = (fact.verificationRounds ?? []).map(round => ({ round, startedAt: roundStartedAt(round) }))
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    const claimed = new Set<string>();
    const returns = [...fact.reviewStatistics.returns].sort((a, b) => (a.at ?? '').localeCompare(b.at ?? ''));
    for (const [index, { round, startedAt }] of rounds.entries()) {
      if (round.execution !== 'pilot' || !round.concurrent || !round.join || round.join.passed) { continue; }
      const nextStart = rounds[index + 1]?.startedAt;
      const returned = returns.find(item => !claimed.has(item.identity) && matchesRepair(item, round, startedAt, nextStart));
      if (!returned) { continue; }
      claimed.add(returned.identity);
      const failed = round.join.failed;
      repairs.push({ fact, returnIdentity: returned.identity,
        kind: failed.length === 2 ? 'joint' : failed.includes('tests') ? 'gate' : 'agent' });
    }
  }
  return repairs;
}

export function roundStartedAt(round: FlowVerificationRound): string {
  return Object.values(round.requests).flatMap(request => request ? [request.startedAt] : [])
    .sort((left, right) => left.localeCompare(right))[0]!;
}

function matchesRepair(item: RecordedReturn, round: FlowVerificationRound, startedAt: string, nextStart: string | undefined): boolean {
  if (!item.at || !round.join || item.at < startedAt || (nextStart && item.at >= nextStart)) { return false; }
  return isIntegrationFailure(item.origin)
    ? matchesIntegrationRepair(item.origin, item.at, round, round.join.at)
    : matchesAgentRepair(item.origin, item.at, round, round.join.at);
}

function isIntegrationFailure(origin: RecordedReturn['origin']): boolean {
  return origin.stage === 'integration-gates'
    || (origin.stage === 'workflow' && origin.cause === 'integration-gate-failure');
}

function matchesIntegrationRepair(origin: RecordedReturn['origin'], at: string, round: FlowVerificationRound,
  joinAt: string): boolean {
  if (!round.join?.failed.includes('tests')) { return false; }
  const tests = round.requests.tests;
  return origin.operationId ? origin.operationId === round.operationId && tests !== null && at >= tests.startedAt : at >= joinAt;
}

function matchesAgentRepair(origin: RecordedReturn['origin'], at: string, round: FlowVerificationRound, joinAt: string): boolean {
  if (origin.stage !== 'agent-review' || !round.join?.failed.includes('agent')) { return false; }
  const reviewNumber = /^review:(\d+)$/.exec(origin.decisionIdentity ?? '')?.[1];
  // The agent decision may be persisted while the tests are still settling.
  if (reviewNumber !== undefined) { return Number(reviewNumber) === round.round; }
  return at >= joinAt && (!origin.operationId || origin.operationId === round.operationId);
}
