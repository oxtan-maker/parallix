import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewStatistics } from '../../../../src/application/services/review-statistics.js';
import { changeRevision } from '../../../../src/domain/review.js';
import type { Review, ReviewEventRecord, ReviewRound } from '../../../../src/domain/review.js';
import { agentFamily } from '../../../../src/domain/agents.js';
import { repeatReview } from '../../../fixtures/repeat-review.js';

function round(number: number, overrides: Partial<ReviewRound> = {}): ReviewRound {
  const base = repeatReview().rounds[0];
  const revision = changeRevision(String(number).padStart(40, '0'));
  return { ...base, number, subject: { ...base.subject, revision },
    decision: base.decision ? { ...base.decision, revision } : null, ...overrides };
}
function event(position: number, overrides: Partial<ReviewEventRecord> = {}): ReviewEventRecord {
  return { position, eventType: 'reviewer_outcome', roundNumber: 1, phase: 'reviewing',
    actor: 'claude', content: 'Repair required', disposition: 'REQUEST_CHANGES', verdict: 'request-changes',
    itemDispositions: null, blockedReason: null, followUpReference: null, createdAt: '2026-10-01T00:01:00Z', ...overrides };
}
function review(rounds: Review['rounds'], reviewEvents: Review['reviewEvents'] = []): Review {
  return { ...repeatReview(), rounds, reviewEvents };
}
const approval = { kind: 'approved' as const, decidedAt: '2026-10-01T00:01:00Z', comment: null,
  source: { kind: 'local' as const } };

test('counts human corrections without reviewer outcomes (TASK-2818)', () => {
  assert.equal(reviewStatistics(review([round(1, { decision: approval })], [
    event(1, { eventType: 'human_note', actor: 'operator' }),
  ])).prFixRounds, 1);
});

test('operator-attributed decisions remain one human repair with duplicated publications', () => {
  const rejected = round(1);
  assert.equal(rejected.decision?.kind, 'changes-requested');
  const result = reviewStatistics(review([{ ...rejected, decision: {
    ...rejected.decision!, kind: 'changes-requested', source: { kind: 'operator', author: 'human' }, findings: [],
  } }], [event(1), event(2, { eventType: 'human_note' })]));
  assert.equal(result.prFixRounds, 1);
  assert.deepEqual(result.obligations.map(value => value.cause), ['human']);
  assert.deepEqual(result.byImplementer, { codex: 1 });
});

test('counts integration repair returns after approval (TASK-2818)', () => {
  assert.equal(reviewStatistics(review([round(1, { decision: { ...approval, revocation: {
    revokedAt: '2026-10-01T00:02:00Z', revokedBy: 'integration', reason: 'Repair failing assertion',
    cause: { kind: 'integration-gate-failure', gate: 'unit', log: 'AssertionError: wrong output' },
  } } })])).prFixRounds, 1);
});

test('deduplicates reviewer and unknown actor outcomes for one rejected round (TASK-2818)', () => {
  assert.equal(reviewStatistics(review([round(1)], [event(1), event(2, { actor: null })])).prFixRounds, 1);
});

test('reconciles partial events with all recorded decisions (TASK-2818)', () => {
  assert.equal(reviewStatistics(review([round(1), round(2), round(3)], [event(1)])).prFixRounds, 3);
});

test('keeps rejected work with its author after implementer replacement (TASK-2818)', () => {
  const result = reviewStatistics(review([
    round(1, { implementer: agentFamily('custom') }), round(2), round(3),
  ]));
  assert.equal(result.prFixRounds, 3);
  assert.deepEqual('byImplementer' in result ? result.byImplementer : null, { custom: 1, codex: 2 });
});

test('missing judged provenance keeps attribution unknown while preserving mission total', () => {
  const result = reviewStatistics(review([round(1, { decision: { ...round(1).decision!, revision: null } })]));
  assert.equal(result.prFixRounds, 1);
  assert.deepEqual(result.byImplementer, { codex: null });
  assert.equal(result.obligations[0].implementer, null);
});

test('later judgment of unchanged work retains its earlier author', () => {
  const submitted = round(1, { implementer: agentFamily('custom'), decision: null });
  const later = { ...round(2), subject: submitted.subject, decision: round(1).decision };
  const result = reviewStatistics(review([submitted, later]));
  assert.deepEqual(result.byImplementer, { custom: 1, codex: 0 });
});

test('human provider publication and its approval revocation are one correction', () => {
  const result = reviewStatistics(review([round(1, { decision: { ...approval, revocation: {
    revokedAt: '2026-10-01T00:02:00Z', revokedBy: 'human', reason: 'Human change request forgejo:review:17: repair output', cause: { kind: 'operator' },
  } } }), round(2, { decision: null })], [event(1, { eventType: 'human_note', roundNumber: 2, followUpReference: 'forgejo:review:17:; state=current' })]));
  assert.equal(result.prFixRounds, 1);
});

test('infrastructure retries on one revision remain one infrastructure incident', () => {
  const failed = { ...approval, revision: round(1).subject.revision, revocation: {
    revokedAt: '2026-10-01T00:02:00Z', revokedBy: 'integration', reason: 'gate failed',
    cause: { kind: 'integration-gate-failure' as const, gate: 'build', log: 'ENOSPC: No space left on device' },
  } };
  const result = reviewStatistics(review([round(1, { decision: failed }), round(2, { decision: failed })]));
  assert.equal(result.prFixRounds, 0);
  assert.deepEqual(result.obligations.map(value => value.cause), ['infrastructure']);
});

test('unknown gate failure cause is not invented as a coding fix or measured zero', () => {
  const result = reviewStatistics(review([round(1, { decision: { ...approval, revocation: {
    revokedAt: '2026-10-01T00:02:00Z', revokedBy: 'integration', reason: 'gate failed',
    cause: { kind: 'integration-gate-failure', gate: 'build' },
  } } })]));
  assert.equal(result.prFixRounds, null);
  assert.equal(result.obligations[0].cause, 'unknown');
});

test('pushback and unchanged-tree approvals remain separate from fixes', () => {
  const result = reviewStatistics(review([round(1, { disposition: 'PUSHBACK_ALL' }),
    round(2, { decision: { ...approval, revision: round(2).subject.revision } }),
    round(3, { decision: { ...approval, revision: round(2).subject.revision } })]));
  assert.equal(result.prFixRounds, 0);
  assert.deepEqual(result.obligations.map(value => value.cause), ['pushback', 'mechanical']);
});

test('absent and undecided reviews are unknown measurements', () => {
  assert.equal(reviewStatistics(null).prFixRounds, null);
  assert.equal(reviewStatistics(review([round(1, { decision: null })])).prFixRounds, null);
});

test('recording, agent reporting and cohort observations preserve replacement history (TASK-2818)', async () => {
  const { StatsRecordingUseCase } = await import('../../../../src/application/stats-recording-use-case.js');
  const { summarizeAgentWindow } = await import('../../../../src/adapters/cli/commands/stats.js');
  const { usageRecordsToOutcomes } = await import('../../../../src/application/projections/metrics-outcomes.js');
  const { compareCohorts } = await import('../../../../src/application/projections/cohorts.js');
  const { repositoryId } = await import('../../../../src/domain/repository.js');
  const { missionId } = await import('../../../../src/domain/mission.js');
  const reviewed = review([round(1, { implementer: agentFamily('custom') }), round(2), round(3)]);
  const rows: import('../../../../src/application/services/statistics-row.js').StatsRow[] = [];
  const useCase = new StatsRecordingUseCase({ repositoryName: 'r', readClassification: () => ({ classification: 'ai_sdlc' }),
    readStoredClassification: async () => 'ai_sdlc', readReview: async () => reviewed, readReviewEvidence: async () => ({ equivalentSubmissions: {} }), readMeasurements: () => rows,
    upsert: row => { rows.push(row); return { changed: true, row, data: { rows, headers: [] } }; }, readMissionFlow: async () => [] });
  await useCase.recordIntegration({ slug: 'task-1', date: '2026-10-01' });
  const window = { start: new Date('2026-10-01'), end: new Date('2026-10-02') };
  assert.equal(rows[0].pr_fix_rounds, '3');
  assert.deepEqual(summarizeAgentWindow(rows, window, { completedMissionKeys: new Set(['r::task-1']), reviewObservations: new Map([['r::task-1', reviewStatistics(reviewed)]]) }), [
    { implementer: 'codex', missions: 1, averageFixRounds: '2.00', prFixObservationCount: 1 },
    { implementer: 'custom', missions: 0, averageFixRounds: '1.00', prFixObservationCount: 1 },
  ]);
  const repo = repositoryId('r');
  const entries = [{ missionId: missionId('task-1'), repositoryId: repo, fromStatus: 'integration' as const,
    toStatus: 'done' as const, trigger: 'integrate', agent: 'codex', idempotencyKey: 'replacement-fixture', occurredAt: '2026-10-01T12:00:00Z' }];
  const { outcomes } = usageRecordsToOutcomes([{ repo: 'r', mission: 'task-1', date: '2026-10-01',  classification: 'ai_sdlc', implementer: 'codex', pr_fix_rounds: 3 }], repo, entries);
  assert.equal(outcomes[0].reviewFixRounds, null, 'usage rows alone cannot supply a Review observation');
  const assigned = outcomes.map(outcome => ({ ...outcome, implementer: agentFamily('codex'), reviewFixRounds: reviewStatistics(reviewed).prFixRounds, reviewFixRoundsByImplementer: reviewStatistics(reviewed).byImplementer }));
  const cohorts = compareCohorts({ outcomes: assigned, transitions: [], dimension: 'implementer' }).cohorts;
  assert.deepEqual(cohorts.map(cohort => [cohort.key, cohort.n, cohort.medianReviewFixRounds, cohort.observationCounts.reviewFixRounds]),
    [['codex', 1, 2, 1], ['custom', 0, 1, 1]]);
});

test('a human correction resolved by pushback is not a coding fix', () => {
  const result = reviewStatistics(review([round(1, { decision: { ...approval, revocation: {
    revokedAt: '2026-10-01T00:02:00Z', revokedBy: 'human', reason: 'Human change request forgejo:review:17:', cause: { kind: 'operator' },
  } } }), round(2, { decision: null, disposition: 'PUSHBACK_ALL' })]));
  assert.equal(result.prFixRounds, 0);
  assert.equal(result.obligations[0].cause, 'pushback');
});

test('unchanged-tree repetitions of the same findings are mechanical re-reviews', () => {
  const result = reviewStatistics(review([round(1), round(2, { decision: round(1).decision })]));
  assert.equal(result.prFixRounds, 1);
  assert.deepEqual(result.obligations.map(value => value.cause), ['review', 'mechanical']);
});

test('a moved judged head requires patch evidence before assigning authorship', () => {
  const submitted = round(1, { implementer: agentFamily('custom'), decision: null });
  const judged = changeRevision('f'.repeat(40));
  const later = round(2, { decision: { ...round(2).decision!, revision: judged } });
  const aggregate = review([submitted, later]);
  assert.deepEqual(reviewStatistics(aggregate).byImplementer, { custom: null, codex: null });
  const proven = reviewStatistics(aggregate, { equivalentSubmissions: { [judged]: [submitted.subject.revision] } });
  assert.deepEqual(proven.byImplementer, { custom: 1, codex: 0 });
});

test('gate retries with proven equivalent bookkeeping heads form one obligation', () => {
  const first = changeRevision('c'.repeat(40)), second = changeRevision('d'.repeat(40));
  const approved = (revision: typeof first) => ({ ...approval, revision, revocation: {
    revokedAt: '2026-10-01T00:02:00Z', revokedBy: 'integration', reason: 'gate failed',
    cause: { kind: 'integration-gate-failure' as const, gate: 'unit', log: 'AssertionError: incorrect output' },
  } });
  const aggregate = review([round(1, { decision: approved(first) }), round(2, { decision: approved(second) })]);
  const submission = aggregate.rounds[0].subject.revision;
  const result = reviewStatistics(aggregate, { equivalentSubmissions: { [first]: [submission], [second]: [submission] } });
  assert.equal(result.prFixRounds, 1);
  assert.equal(result.obligations.length, 1);
});
