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
  ])).total, 1);
});

test('operator-attributed decisions remain one human repair with duplicated publications', () => {
  const rejected = round(1);
  assert.equal(rejected.decision?.kind, 'changes-requested');
  const result = reviewStatistics(review([{ ...rejected, decision: {
    ...rejected.decision!, kind: 'changes-requested', source: { kind: 'operator', author: 'human' }, findings: [],
  } }], [event(1), event(2, { eventType: 'human_note' })]));
  assert.equal(result.total, 1);
  assert.deepEqual(result.byImplementer, { codex: 1 });
});

test('counts integration repair returns after approval (TASK-2818)', () => {
  assert.equal(reviewStatistics(review([round(1, { decision: { ...approval, revocation: {
    revokedAt: '2026-10-01T00:02:00Z', revokedBy: 'integration', reason: 'Repair failing assertion',
    cause: { kind: 'integration-gate-failure', gate: 'unit', log: 'AssertionError: wrong output' },
  } } })])).total, 1);
});

test('deduplicates reviewer and unknown actor outcomes for one rejected round (TASK-2818)', () => {
  assert.equal(reviewStatistics(review([round(1)], [event(1), event(2, { actor: null })])).total, 1);
});

test('reconciles partial events with all recorded decisions (TASK-2818)', () => {
  assert.equal(reviewStatistics(review([round(1), round(2), round(3)], [event(1)])).total, 3);
});

test('keeps rejected work with its author after implementer replacement (TASK-2818)', () => {
  const result = reviewStatistics(review([
    round(1, { implementer: agentFamily('custom') }), round(2), round(3),
  ]));
  assert.equal(result.total, 3);
  assert.deepEqual(result.byImplementer, { custom: 1, codex: 2 });
});

test('missing judged provenance keeps attribution unknown while preserving mission total', () => {
  const result = reviewStatistics(review([round(1, { decision: { ...round(1).decision!, revision: null } })]));
  assert.equal(result.total, 1);
  assert.deepEqual(result.byImplementer, { codex: 1 }, 'the round under judgment names the author when no revision proof exists');
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
  assert.equal(result.total, 1);
});

test('infrastructure retries on one revision remain one return', () => {
  const failed = { ...approval, revision: round(1).subject.revision, revocation: {
    revokedAt: '2026-10-01T00:02:00Z', revokedBy: 'integration', reason: 'gate failed',
    cause: { kind: 'integration-gate-failure' as const, gate: 'build', log: 'ENOSPC: No space left on device' },
  } };
  const result = reviewStatistics(review([round(1, { decision: failed }), round(2, { decision: failed })]));
  assert.equal(result.total, 1);
});

test('unknown gate failure cause is a known return, never excluded or zero', () => {
  const result = reviewStatistics(review([round(1, { decision: { ...approval, revocation: {
    revokedAt: '2026-10-01T00:02:00Z', revokedBy: 'integration', reason: 'gate failed',
    cause: { kind: 'integration-gate-failure', gate: 'build' },
  } } })]));
  assert.equal(result.total, 1);
});

test('pushback counts as a return while unchanged-tree approvals count zero', () => {
  const result = reviewStatistics(review([round(1, { disposition: 'PUSHBACK_ALL' }),
    round(2, { decision: { ...approval, revision: round(2).subject.revision } }),
    round(3, { decision: { ...approval, revision: round(2).subject.revision } })]));
  assert.equal(result.total, 1);
});

test('absent and undecided reviews are unknown measurements', () => {
  assert.equal(reviewStatistics(null).total, null);
  assert.equal(reviewStatistics(review([round(1, { decision: null })])).total, null);
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
  const modelled = [{ ...rows[0], model: 'gpt-6.1-sol' },
    { repo: 'r', mission: 'task-1', date: '2026-10-01', stage: 'active', implementer: 'custom', model: 'qwen3.8-flash-next-iq3_s' }];
  assert.deepEqual(summarizeAgentWindow(modelled, window, { completedMissionKeys: new Set(['r::task-1']),
    completedMissionOwners: new Map([['r::task-1', 'codex']]), reviewObservations: new Map([['r::task-1', reviewStatistics(reviewed)]]) }), [
    { model: 'gpt-6.1-sol', missions: 1, measuredMissions: 1, reimplementationRounds: 2, incomplete: false },
    { model: 'qwen3.8-flash-next-iq3_s', missions: 1, measuredMissions: 1, reimplementationRounds: 1, incomplete: false },
  ]);
  const repo = repositoryId('r');
  const entries = [{ missionId: missionId('task-1'), repositoryId: repo, fromStatus: 'integration' as const,
    toStatus: 'done' as const, trigger: 'integrate', agent: 'codex', idempotencyKey: 'replacement-fixture', occurredAt: '2026-10-01T12:00:00Z' }];
  const { outcomes } = usageRecordsToOutcomes([{ repo: 'r', mission: 'task-1', date: '2026-10-01',  classification: 'ai_sdlc', implementer: 'codex', pr_fix_rounds: 3 }], repo, entries);
  assert.equal(outcomes[0].reviewFixRounds, null, 'usage rows alone cannot supply a Review observation');
  const assigned = outcomes.map(outcome => ({ ...outcome, implementer: agentFamily('codex'), reviewFixRounds: reviewStatistics(reviewed).total, reviewFixRoundsByImplementer: reviewStatistics(reviewed).byImplementer }));
  const cohorts = compareCohorts({ outcomes: assigned, transitions: [], dimension: 'implementer' }).cohorts;
  assert.deepEqual(cohorts.map(cohort => [cohort.key, cohort.n, cohort.medianReviewFixRounds, cohort.observationCounts.reviewFixRounds]),
    [['codex', 1, 2, 1], ['custom', 0, 1, 1]]);
});

test('a human correction resolved by pushback is still one return', () => {
  const result = reviewStatistics(review([round(1, { decision: { ...approval, revocation: {
    revokedAt: '2026-10-01T00:02:00Z', revokedBy: 'human', reason: 'Human change request forgejo:review:17:', cause: { kind: 'operator' },
  } } }), round(2, { decision: null, disposition: 'PUSHBACK_ALL' })]));
  assert.equal(result.total, 1);
});

test('a moved judged head requires patch evidence before assigning authorship', () => {
  const submitted = round(1, { implementer: agentFamily('custom'), decision: null });
  const judged = changeRevision('f'.repeat(40));
  const later = round(2, { decision: { ...round(2).decision!, revision: judged } });
  const aggregate = review([submitted, later]);
  assert.deepEqual(reviewStatistics(aggregate).byImplementer, { custom: 0, codex: 1 });
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
  assert.equal(result.total, 1);
});

// TASK-2832: one all-cause reimplementation count. Cause never filters a return.
test('counts every cause as a reimplementation return (TASK-2832)', () => {
  const failed = (log: string | undefined, revision: ReturnType<typeof changeRevision>) => ({ ...approval, revision, revocation: {
    revokedAt: '2026-10-01T00:02:00Z', revokedBy: 'integration', reason: 'gate failed',
    cause: { kind: 'integration-gate-failure' as const, gate: 'build', log },
  } });
  const unknown = reviewStatistics(review([round(1, { decision: failed(undefined, round(1).subject.revision) })]));
  assert.equal(unknown.total, 1, 'unknown cause is a known return');
  const infrastructure = reviewStatistics(review([round(1, { decision: failed('ENOSPC', round(1).subject.revision) })]));
  assert.equal(infrastructure.total, 1);
  const pushback = reviewStatistics(review([round(1, { disposition: 'PUSHBACK_ALL' })]));
  assert.equal(pushback.total, 1);
});

test('repeated cycles with unchanged findings count separately; mechanical approvals count zero (TASK-2832)', () => {
  const repeated = reviewStatistics(review([round(1), round(2, { decision: round(1).decision })]));
  assert.equal(repeated.total, 2);
  const sameApproval = { ...approval, revision: round(2).subject.revision };
  assert.equal(reviewStatistics(review([round(1, { decision: sameApproval }), round(2, { decision: sameApproval })])).total, 0);
});

test('pre-review workflow returns count once per identity and belong to the round under work (TASK-2832)', () => {
  const result = reviewStatistics(review([round(1, { decision: approval })]), { equivalentSubmissions: {}, workflowReturns: [
    { identity: 'lane:a', author: 'custom', at: '2026-10-01T00:00:10Z', source: 'judgment' }, { identity: 'lane:a', author: 'custom', at: '2026-10-01T00:00:10Z', source: 'judgment' },
    { identity: 'lane:b', author: 'custom', at: '2026-10-01T00:00:20Z', source: 'judgment' },
  ] });
  assert.equal(result.total, 2);
  assert.deepEqual(result.byImplementer, { codex: 2 }, 'the launcher is only a fallback; the round implementer authored the work');
});

test('a return nothing can attribute is counted under unknown, never dropped or zeroed (TASK-2832)', () => {
  const result = reviewStatistics(null, { equivalentSubmissions: {},
    workflowReturns: [{ identity: 'lane:a', author: null, at: '2026-10-01T00:00:10Z', source: 'judgment' }, { identity: 'lane:b', author: 'claude', at: '2026-10-01T00:00:20Z', source: 'judgment' }] });
  assert.equal(result.total, 2);
  assert.deepEqual(result.byImplementer, { unknown: 1, claude: 1 });
  assert.equal(reviewStatistics(null).total, null);
});

test('a reviewer lane move is its own Review decision; a gate repair never is (TASK-2832)', () => {
  const decided = (at: string) => ({ ...round(1).decision!, decidedAt: at });
  const result = reviewStatistics(review([round(1, { decision: decided('2026-10-01T00:01:00Z') }), round(2, { decision: decided('2026-10-01T00:10:00Z') })]), { equivalentSubmissions: {}, workflowReturns: [
    { identity: 'lane:review', author: 'codex', at: '2026-10-01T00:01:05Z', source: 'judgment' },
    { identity: 'repair:gate', author: 'codex', at: '2026-10-01T00:09:00Z', source: 'repair' },
  ] });
  assert.equal(result.total, 3, 'two reviewer rejections plus the independent gate return');
});

test('a stale judgment never absorbs a later independent return (TASK-2832)', () => {
  const yesterday = { ...round(1).decision!, decidedAt: '2026-09-30T10:00:00Z' };
  const result = reviewStatistics(review([round(1, { decision: yesterday })]), { equivalentSubmissions: {}, workflowReturns: [
    { identity: 'lane:rebound', author: 'codex', at: '2026-10-01T09:00:00Z', source: 'rebound' },
  ] });
  assert.equal(result.total, 2, 'yesterday rejection and today separate gate rebound');
});

test('a gate rebound is the integration-gate revocation recorded after it, once (TASK-2832)', () => {
  const failed = { ...approval, decidedAt: '2026-10-01T09:00:00Z', revocation: { revokedAt: '2026-10-01T09:12:00Z', revokedBy: 'integration',
    reason: 'gate failed', cause: { kind: 'integration-gate-failure' as const, gate: 'unit', log: 'AssertionError' } } };
  const result = reviewStatistics(review([round(1, { decision: failed })]), { equivalentSubmissions: {}, workflowReturns: [
    { identity: 'lane:rebound', author: 'codex', at: '2026-10-01T09:00:30Z', source: 'rebound' } ] });
  assert.equal(result.total, 1);
});

test('a later assignment cannot establish who authored earlier rejected work (TASK-2832)', () => {
  const later = round(1, { implementer: agentFamily('claude'), startedAt: '2026-10-01T12:00:00Z', decision: null });
  const result = reviewStatistics(review([later]), { equivalentSubmissions: {}, workflowReturns: [
    { identity: 'repair:pre', author: 'codex', at: '2026-10-01T10:00:00Z', source: 'repair' } ] });
  assert.equal(result.total, 1);
  assert.deepEqual(result.byImplementer, { claude: 0, codex: 1 }, 'the pre-review return stays with the evidenced launcher');
});

test('separate approval revocation cycles on identical work and gate are separate returns (TASK-2832)', () => {
  const failed = (revokedAt: string) => ({ ...approval, revision: round(1).subject.revision, revocation: { revokedAt, revokedBy: 'integration',
    reason: 'gate failed', cause: { kind: 'integration-gate-failure' as const, gate: 'unit', log: 'AssertionError' } } });
  const cycles = (second: string) => review([round(1, { decision: failed('2026-10-01T09:00:00Z') }), round(2, { decision: failed(second) })]);
  assert.equal(reviewStatistics(cycles('2026-10-02T09:00:00Z')).total, 2, 'two days apart');
  assert.equal(reviewStatistics(cycles('2026-10-01T09:00:00Z')).total, 1, 'one revocation recorded twice');
});

test('a later implementation launch, not an older round, owns a later gate return (TASK-2832)', () => {
  const older = round(1, { implementer: agentFamily('claude'), startedAt: '2026-10-01T08:00:00Z', decision: null });
  const result = reviewStatistics(review([older]), { equivalentSubmissions: {}, workflowReturns: [
    { identity: 'repair:gate', author: 'codex', authorSince: '2026-10-01T09:00:00Z', at: '2026-10-01T10:00:00Z', source: 'repair' }] });
  assert.deepEqual(result.byImplementer, { claude: 0, codex: 1 });
  const sameInstant = reviewStatistics(review([older]), { equivalentSubmissions: {}, workflowReturns: [
    { identity: 'repair:gate', author: 'codex', authorSince: '2026-10-01T08:00:00Z', at: '2026-10-01T10:00:00Z', source: 'repair' }] });
  assert.deepEqual(sameInstant.byImplementer, { claude: 1 }, 'a launch that is not later than the round does not override it');
});

test('a rebound is the approval revocation it opened whatever the cause (TASK-2832)', () => {
  const repaired = { ...approval, decidedAt: '2026-10-01T09:00:00Z', revocation: { revokedAt: '2026-10-01T09:05:00Z', revokedBy: 'workflow',
    reason: 'review repair', cause: { kind: 'review-repair' as const } } };
  const result = reviewStatistics(review([round(1, { decision: repaired })]), { equivalentSubmissions: {}, workflowReturns: [
    { identity: 'lane:rebound', author: 'codex', at: '2026-10-01T09:05:10Z', until: '2026-10-01T10:00:00Z', source: 'rebound' }] });
  assert.equal(result.total, 1);
  const operator = { ...repaired, revocation: { ...repaired.revocation, cause: { kind: 'operator' as const } } };
  const human = reviewStatistics(review([round(1, { decision: operator })]), { equivalentSubmissions: {}, workflowReturns: [
    { identity: 'lane:rebound', author: 'codex', at: '2026-10-01T09:05:10Z', until: '2026-10-01T10:00:00Z', source: 'rebound' }] });
  assert.equal(human.total, 2, 'an operator revocation is not a rebound');
});

test('a retained human correction on an undecided round is return evidence without workflow history (TASK-2832)', () => {
  const result = reviewStatistics(review([round(1, { decision: null })], [event(1, { eventType: 'human_note', actor: 'operator' })]));
  assert.equal(result.total, 1);
  assert.deepEqual(result.byImplementer, { codex: 1 });
});

test('returns carry their time so reports can attribute them to the model that wrote the work (TASK-2832)', () => {
  const result = reviewStatistics(review([round(1)]), { equivalentSubmissions: {}, workflowReturns: [
    { identity: 'lane:gate', author: 'codex', at: '2026-10-02T00:00:00Z', source: 'repair' }] });
  assert.deepEqual(result.returns.map(item => item.at), ['2026-10-01T00:01:00Z', '2026-10-02T00:00:00Z']);
});
