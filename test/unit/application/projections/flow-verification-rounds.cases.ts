import test from 'node:test';
import assert from 'node:assert/strict';

import { verificationStatistics } from '../../../../src/application/projections/verification-statistics.js';
import { approvalSubmission, approvalTransition, policyStart, policyOutcome, policyHistory, completed,
  retainedRound } from '../../../fixtures/flow-policy-rounds.js';
import { missionId } from '../../../../src/domain/mission.js';
import { repositoryId } from '../../../../src/domain/repository.js';

// Retained verification-round evidence hardening: reviewer legs, classifier rounds, approval completion and outcome
// identity. Imported by flow-statistics.test.ts so the declared focused gate runs them with the core fork, join and cohort cases.

function splitReviewers(mission: string, failFirst: boolean) {
  const rows = retainedRound(mission, null).filter(row => !row.eventData.includes('"actualAction":"agent"'));
  const reviewer = (name: string, sequence: number, startedAt: string, passed: boolean, decidedAt: string) => {
    const start = { ...policyStart(mission, 'agent', sequence, startedAt), verdictCorrelation: `review:1:agent:${name}-verdict`,
      agentRunId: `${mission}-${name}` };
    return [policyHistory('verification.review-start-decision', start),
      policyHistory('verification.review-start-outcome', policyOutcome(start, decidedAt, passed))];
  };
  return [...rows, ...reviewer('codex', 3, '2026-11-03T10:02:00Z', !failFirst, '2026-11-03T10:06:00Z'),
    ...reviewer('claude', 4, '2026-11-03T10:02:30Z', failFirst, '2026-11-03T10:06:30Z')];
}

test('an approval attempt counts only once its committed transition follows it, timed at the commit (PX-0066 round 19 F3-F4)', () => {
  const approvalOf = (mission: string, lifecycle: ReturnType<typeof approvalTransition>[]) => {
    const history = [...retainedRound(mission, null), approvalSubmission(mission, '2026-11-03T10:20:00Z')];
    const observed = verificationStatistics({ repositoryId: 'repo', history, operations: [], lifecycle: [completed(mission), ...lifecycle] });
    return observed.flowMissions.find(item => item.missionId === mission)!.verificationRounds![0]!.human;
  };
  const failed = approvalOf('refused-submission', []);
  assert.deepEqual([failed.state, failed.approvedAt], ['pending', null], 'a retained attempt with no commit is no approval');
  const agentFirst = approvalOf('agent-approved-earlier', [approvalTransition('agent-approved-earlier', '2026-11-03T10:07:00Z')]);
  assert.equal(agentFirst.approvedAt, null, 'a transition before the attempt belongs to no human submission');
  const laterReviewer = approvalOf('failed-then-reviewer', [approvalTransition('failed-then-reviewer', '2026-11-03T10:30:00Z', 2)]);
  assert.equal(laterReviewer.approvedAt, null, 'a failed attempt followed by another round\'s reviewer approval is not its completion');
  const replayed = approvalOf('replayed-submission', [approvalTransition('replayed-submission', '2026-11-03T10:40:00Z')]);
  assert.deepEqual([replayed.state, replayed.approvedAt], ['later', '2026-11-03T10:40:00Z'],
    'a replayed attempt keeps its first row, so the answer is timed at the retry that committed');
});

test('a later round attempt and approval never credit an earlier round whose next start is missing (PX-0066 round 21 F1)', () => {
  const history = [...retainedRound('repeated-integrate', null), approvalSubmission('repeated-integrate', '2026-11-03T10:20:00Z', 2)];
  const observed = verificationStatistics({ repositoryId: 'repo', history, operations: [],
    lifecycle: [completed('repeated-integrate'), approvalTransition('repeated-integrate', '2026-11-03T10:20:30Z', 2)] });
  assert.equal(observed.flowMissions[0]!.verificationRounds![0]!.human.approvedAt, null, 'the attempt names review round 2, not round 1');
});

test('contradictory or foreign outcome rows are quarantined, never decided by row order (PX-0066 round 21 F2)', () => {
  const tests = policyStart('conflicting-outcomes', 'tests', 2, '2026-11-03T10:01:00Z');
  const conflicting = policyHistory('verification.review-start-outcome', policyOutcome(tests, '2026-11-03T10:09:00Z', false));
  const foreign = (row: ReturnType<typeof policyHistory>) => row.eventData.includes('"startKey":"foreign-outcome:1:tests:2"')
    ? policyHistory(row.eventType, { ...JSON.parse(row.eventData), changeIdentity: 'another-change' }) : row;
  for (const history of [[...retainedRound('conflicting-outcomes', null), conflicting],
    [conflicting, ...retainedRound('conflicting-outcomes', null)], retainedRound('foreign-outcome', null).map(foreign)]) {
    const mission = verificationStatistics({ repositoryId: 'repo', history, operations: [],
      lifecycle: [completed('conflicting-outcomes'), completed('foreign-outcome')] }).flowMissions.find(item => item.verificationRounds?.length)!;
    assert.equal(mission.verificationRounds![0]!.join, null, 'the tests leg has no operative outcome, so no join forms');
    assert.ok(mission.diagnostics.some(item => /Contradictory duplicate|names another mission/.test(item.message)));
  }
});

test('an outcome row owned by another repository is never this repository evidence (PX-0066 round 23 F1)', () => {
  const tests = policyStart('foreign-repository', 'tests', 2, '2026-11-03T10:01:00Z');
  const foreign = policyHistory('verification.review-start-outcome',
    { ...policyOutcome(tests, '2026-11-03T10:04:00Z', false), repositoryId: 'another-repository' });
  const own = retainedRound('foreign-repository', null);
  const read = (history: ReturnType<typeof policyHistory>[]) => verificationStatistics({ repositoryId: 'repo', history, operations: [],
    lifecycle: [completed('foreign-repository')] }).flowMissions.find(item => item.verificationRounds?.length)!;
  assert.equal(read([foreign, ...own]).verificationRounds![0]!.join?.passed, true, 'the foreign verdict neither replaces nor contradicts the own one');
  const withoutOwnTests = own.filter(row => !row.eventData.includes('"startKey":"foreign-repository:1:tests:2"'));
  assert.equal(read([foreign, ...withoutOwnTests]).verificationRounds![0]!.join, null, 'a foreign verdict cannot complete this repository join');
});

test('a reviewer start with no retained outcome leaves the join unsettled with a named diagnostic (PX-0066 round 19 F6)', () => {
  const rows = splitReviewers('unsettled-reviewer', false).filter(row => !row.eventData.includes('"startKey":"unsettled-reviewer:1:agent:4"'));
  const observed = verificationStatistics({ repositoryId: 'repo', history: rows, operations: [], lifecycle: [completed('unsettled-reviewer')] });
  const mission = observed.flowMissions[0]!;
  assert.equal(mission.verificationRounds![0]!.join, null);
  assert.ok(mission.diagnostics.some(item => item.message.includes('unsettled-reviewer:1:agent:4 has no retained outcome')));
});

test('two independent reviewers settle one agent leg whichever start is written first (PX-0066 round 18 F1)', () => {
  for (const [mission, failFirst, reversed] of [['pass-first', false, false], ['fail-first', true, true]] as const) {
    const rows = splitReviewers(mission, failFirst);
    const observed = verificationStatistics({ repositoryId: 'repo', history: reversed ? [...rows].reverse() : rows,
      operations: [], lifecycle: [completed(mission)] });
    const round = observed.flowMissions[0]!.verificationRounds![0]!;
    assert.equal(round.execution, 'pilot');
    assert.equal(round.concurrent, true, 'every reviewer start precedes the first automated outcome');
    assert.deepEqual(round.join && { passed: round.join.passed, failed: round.join.failed }, { passed: false, failed: ['agent'] },
      'one failing reviewer fails the leg in either write order');
    assert.equal(round.requests.agent?.passed, false);
  }
});

test('a pinned round with no agent start is unobserved, never silently historical (PX-0066 round 18 F2)', () => {
  const classified = retainedRound('classifier-settled', null).filter(row => !row.eventData.includes('"actualAction":"agent"'));
  const sequentialHandoff = [policyHistory('verification.review-start-decision',
    policyStart('sequential-handoff', 'human', 1, '2026-11-03T10:00:00Z', { execution: 'fallback' }))];
  const observed = verificationStatistics({ repositoryId: 'repo', history: [...classified, ...sequentialHandoff],
    operations: [], lifecycle: [completed('classifier-settled'), completed('sequential-handoff')] });
  const round = observed.flowMissions.find(item => item.missionId === 'classifier-settled')!;
  assert.equal(round.verificationRounds?.[0]?.execution, 'unobserved');
  assert.equal(round.verificationRounds?.[0]?.requests.agent, null);
  assert.ok(round.diagnostics.some(item => item.message.includes('no retained agent start')));
  assert.equal(observed.flowMissions.find(item => item.missionId === 'sequential-handoff')?.verificationRounds?.length ?? 0, 0,
    'an unpinned sequential human handoff is not a verification round');
});
