import { missionId, missionLabels } from '../../src/domain/mission.js';
import { agentFamily } from '../../src/domain/agents.js';
import type { ReviewStatistics } from '../../src/application/services/review-statistics.js';
import type { StatsRow } from '../../src/application/services/statistics-row.js';
import { statisticsMissionKey } from '../../src/application/services/statistics-service.js';

/** Explicit observation inputs for presentation contracts, never persisted data. */
export function reviewStatisticsObservation(implementer: string, count: number | null,
  byImplementer: Readonly<Record<string, number>> = implementer === 'unknown' || count === null ? {} : { [implementer]: count }): ReviewStatistics {
  const returns = Object.entries(byImplementer).flatMap(([author, n]) => Array.from({ length: n }, (_, index) => ({ identity: `fixture:${author}:${index}`, author, at: null,
    origin: { actor: 'agent' as const, stage: 'agent-review' as const, decisionIdentity: `fixture:${author}:${index}`,
      revision: `fixture-revision-${index}`, sender: 'fixture-reviewer' } })));
  const eligible = count === null ? null : Math.max(1, count);
  const episodes = Array.from({ length: eligible ?? 0 }, (_, index) => ({ identity: `fixture:episode:${index}`,
    actor: 'agent' as const, stage: 'agent-review' as const, startedAt: `2026-01-01T00:00:0${index}Z`,
    endedAt: `2026-01-01T00:00:1${index}Z`, revision: `fixture-revision-${index}`, sender: 'fixture-reviewer' }));
  return { implementer, total: count, byImplementer, returns, episodes,
    sendBacks: {
      agent: count === null
        ? { numerator: null, eligibleEpisodes: null, coverage: 0, rate: { state: 'missing-provenance', value: null } }
        : { numerator: count, eligibleEpisodes: eligible, coverage: 1, rate: { state: 'measured', value: count / eligible! } },
      human: count === null
        ? { numerator: null, eligibleEpisodes: null, coverage: 0, rate: { state: 'missing-provenance', value: null } }
        : { numerator: 0, eligibleEpisodes: 0, coverage: 1, rate: { state: 'no-eligible-population', value: null } },
    }, source: 'review-aggregate' };
}

export function fixtureReviewObservations(rows: readonly Pick<StatsRow, 'repo' | 'mission' | 'date' | 'stage' | 'implementer' | 'pr_fix_rounds' | 'classification'>[]) {
  return new Map(rows.filter(row => (row.stage || 'default') === 'default').map(row => [statisticsMissionKey(row),
    reviewStatisticsObservation(String(row.implementer), row.pr_fix_rounds == null || row.pr_fix_rounds === '' ? null : Number(row.pr_fix_rounds))]));
}

/** Explicit Mission observations for projection fixtures; usage rows do not vote. */
export function fixtureCohortMetadata(rows: readonly Pick<StatsRow, 'repo' | 'mission' | 'date' | 'stage' | 'implementer' | 'pr_fix_rounds' | 'classification'>[]) {
  const observations = fixtureReviewObservations(rows);
  return new Map(rows.map(row => [missionId(String(row.mission)), {
    labels: missionLabels([row.classification || 'ai_sdlc']), assignee: agentFamily(row.implementer || 'claude'),
    reviewStatistics: observations.get(statisticsMissionKey(row)),
  }]));
}
