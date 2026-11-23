// Real CLI repair verification owns independent successful and failed checks,
// plus entry-point parity: the CLI and the board enter review through one owner.
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { retainedRepairCase } from '../../fixtures/review-repair-recovery.js';
import { concurrentPolicyCase, parityCase, type ParityScenario } from '../../fixtures/review-entry-parity.js';
import { reviewStatus } from '../../../src/domain/review.js';
import { reviewStatistics } from '../../../src/application/services/review-statistics.js';

// Recovery and a failed original check run through the CLI and the board entry:
// both reach the same review owner, so the observable outcome must be identical.
for (const phase of ['recovery', 'failed-check'] as const) {
  it(`running CLI ${phase} with inferred slug (TASK-2766)`, { timeout: 10000 }, async t => {
    await retainedRepairCase(phase, true, t);
  });
  it(`board review preparation ${phase} reaches the shared review owner (TASK-2817)`, { timeout: 10000 }, async t => {
    await retainedRepairCase(phase, false, t, false, 'board');
  });
}

// Each scenario is asserted per entry against the same literal outcome, with real
// round and lane-event counts: no duplicate round, no duplicate lane event, and an
// approval only where a reviewer launch recorded one (TASK-2817).
const HANDOFF_LANES = ['active>review', 'review>integration'];
const PARITY: ReadonlyArray<{ scenario: ParityScenario; rounds: number; launches: string[]; lanes: string[]; code: number; status: string; returns: number | null }> = [
  { scenario: "first-review preparation", rounds: 1, launches: ['review'], lanes: HANDOFF_LANES, code: 0, status: 'integration', returns: 0 },
  { scenario: 'interrupted-pending-review', rounds: 1, launches: ['review'], lanes: HANDOFF_LANES, code: 0, status: 'integration', returns: 0 },
  { scenario: 'findings-resolution', rounds: 2, launches: ['review', 'implement', 'review'], lanes: ['active>review', 'review>active', 'active>review', 'review>integration'], code: 0, status: 'integration', returns: 1 },
  { scenario: 'human-intervention', rounds: 1, launches: [], lanes: [], code: 1, status: 'active', returns: null },
];
for (const expected of PARITY) {
  for (const entry of ['cli', 'board'] as const) {
    it(`${entry} entry for ${expected.scenario} leaves the shared review outcome (TASK-2817)`, { timeout: 10000 }, async t => {
      const outcome = await parityCase(expected.scenario, entry, t);
      // Board review:submit carries admitted operator-resume authority; the
      // automatic CLI fixture deliberately does not and must retain the stop.
      const admittedBoardResume = expected.scenario === 'human-intervention' && entry === 'board';
      const entryExpected = admittedBoardResume
        ? { ...expected, code: 0, status: 'integration', launches: ['review'], lanes: HANDOFF_LANES, returns: 0 }
        : expected;
      assert.equal(outcome.code, entryExpected.code, outcome.messages);
      assert.equal(outcome.mission.status, entryExpected.status);
      assert.equal(outcome.mission.review!.rounds.length, entryExpected.rounds, 'no duplicate round');
      assert.deepEqual(outcome.launches, entryExpected.launches);
      assert.deepEqual(outcome.laneEvents.map(event => `${event.from_status}>${event.to_status}`), entryExpected.lanes, 'no duplicate lane event');
      assert.equal(reviewStatistics(outcome.mission.review!).total, entryExpected.returns,
        'the public entry preserves the fixed-sequence statistics trace (TASK-2859.11)');
      if (expected.scenario === 'human-intervention' && entry === 'cli') {
        assert.notEqual(outcome.mission.review!.intervention ?? null, null, 'an automatic entry cannot clear the stop');
      } else {
        assert.equal(reviewStatus(outcome.mission.review!), 'approved', 'approval came from the reviewer launch');
      }
      // The fixed sequence owes its integration tests to the human turn, not to
      // agent approval: neither review entry may run them (TASK-2859.17).
      assert.equal(outcome.gateRunStatus, null, 'no review entry runs the integration tests before the human approves');
    });
  }
}

for (const entry of ['cli', 'board'] as const) {
  it(`${entry} entry gives an already-approved Mission no fabricated approval (TASK-2817)`, { timeout: 10000 }, async t => {
    const outcome = await parityCase('already-approved', entry, t);
    assert.equal(outcome.code, 0, outcome.messages);
    const decisions = outcome.mission.review!.rounds.map(round => round.decision?.kind);
    assert.equal(decisions[0], 'approved');
    assert.equal(outcome.mission.status, 'integration', 'the recorded approval settles its interrupted lifecycle boundary');
    assert.equal(outcome.mission.review!.rounds.length, 1);
    assert.deepEqual(outcome.launches, [], 'a terminal approval launches no agent');
    assert.deepEqual(outcome.laneEvents.map(event => `${event.from_status}>${event.to_status}`), ['review>integration']);
    // Agent approval moved the candidate to the integration lane; only the
    // human verdict may start its tests (TASK-2859.17).
    assert.equal(outcome.gateRunStatus, null, 'an approved landing candidate gains no gate run from the review entry');
    assert.equal(reviewStatistics(outcome.mission.review!).total, 0,
      'retained approval adds no repair return to existing statistics (TASK-2859.11)');
    assert.equal(decisions.filter(kind => kind === 'approved').length, 1 + outcome.launches.filter(kind => kind === 'review').length, 'every approval beyond the seeded one has a reviewer launch');
  });
}

it('public px review runs the pinned rule-(a) starts concurrently before either automated verdict (TASK-2867.08)', { timeout: 10000 }, async t => {
  const outcome = await concurrentPolicyCase(t);
  assert.equal(outcome.code, 0, outcome.messages);
  assert.equal(outcome.gateRunStatus, 'passed');
  assert.ok(['human', 'tests', 'agent'].every(action => outcome.startsBeforeVerdict.includes(action)), outcome.startsBeforeVerdict.join(','));
  assert.equal(outcome.mission.status, 'integration', 'all-pass remains human-controlled in the integration lane');
});

it('public px review withdraws a red round and sends both automated findings to one repair (TASK-2867.08)', { timeout: 10000 }, async t => {
  const outcome = await concurrentPolicyCase(t, true);
  assert.equal(outcome.code, 0, outcome.messages);
  assert.equal(outcome.gateRunStatus, 'failed', `the red-round evidence remains attached to the repaired revision\n${outcome.messages.slice(-5000)}`);
  assert.equal(outcome.withdrawals, 1, 'the failed round withdraws its human request exactly once');
  assert.deepEqual(outcome.launches, ['review', 'implement'], 'dual failure has exactly one joint repair attempt');
  assert.equal((outcome.jointRepairPrompt ?? '').includes('Joint automated repair evidence'), true);
  assert.match(outcome.jointRepairPrompt ?? '', /unit: .*test -f fix\.txt.*exit 1/s);
  assert.match(outcome.jointRepairPrompt ?? '', /A1: agent finding/);
  assert.equal(outcome.mission.status, 'active', 'the repaired change awaits a fresh public review entry');
});

for (const inferred of [false, true]) {
  it(`completed repair with settled children reaches its next lifecycle action (${inferred ? 'inferred' : 'explicit'} slug, TASK-2806)`, { timeout: 20000 }, async t => {
    await retainedRepairCase('settled-descendant', inferred, t);
  });
}
