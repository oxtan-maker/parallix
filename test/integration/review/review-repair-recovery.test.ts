// Real CLI repair verification owns independent successful and failed checks,
// plus entry-point parity: the CLI and the board enter review through one owner.
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { retainedRepairCase } from '../../fixtures/review-repair-recovery.js';
import { parityCase, type ParityScenario } from '../../fixtures/review-entry-parity.js';
import { reviewStatus } from '../../../src/domain/review.js';

// Recovery and a failed original check run through the CLI and the board entry:
// both reach the same review owner, so the observable outcome must be identical.
for (const phase of ['recovery', 'failed-check'] as const) {
  it(`running CLI ${phase} with inferred slug (TASK-2766)`, { timeout: 10000 }, async t => {
    await retainedRepairCase(phase, true, t);
  });
  it(`board handoff ${phase} reaches the shared review owner (TASK-2817)`, { timeout: 10000 }, async t => {
    await retainedRepairCase(phase, false, t, false, 'board');
  });
}

// Each scenario is asserted per entry against the same literal outcome, with real
// round and lane-event counts: no duplicate round, no duplicate lane event, and an
// approval only where a reviewer launch recorded one (TASK-2817).
const HANDOFF_LANES = ['active>review', 'review>integration'];
const PARITY: ReadonlyArray<{ scenario: ParityScenario; rounds: number; launches: string[]; lanes: string[]; code: number; status: string }> = [
  { scenario: 'first-handoff', rounds: 1, launches: ['review'], lanes: HANDOFF_LANES, code: 0, status: 'integration' },
  { scenario: 'interrupted-pending-review', rounds: 1, launches: ['review'], lanes: HANDOFF_LANES, code: 0, status: 'integration' },
  { scenario: 'findings-resolution', rounds: 2, launches: ['review', 'implement', 'review'], lanes: ['active>review', 'review>active', 'active>review', 'review>integration'], code: 0, status: 'integration' },
  { scenario: 'human-intervention', rounds: 1, launches: [], lanes: [], code: 1, status: 'active' },
];
for (const expected of PARITY) {
  for (const entry of ['cli', 'board'] as const) {
    it(`${entry} entry for ${expected.scenario} leaves the shared review outcome (TASK-2817)`, { timeout: 10000 }, async t => {
      const outcome = await parityCase(expected.scenario, entry, t);
      assert.equal(outcome.code, expected.code, outcome.messages);
      assert.equal(outcome.mission.status, expected.status);
      assert.equal(outcome.mission.review!.rounds.length, expected.rounds, 'no duplicate round');
      assert.deepEqual(outcome.launches, expected.launches);
      assert.deepEqual(outcome.laneEvents.map(event => `${event.from_status}>${event.to_status}`), expected.lanes, 'no duplicate lane event');
      if (expected.scenario === 'human-intervention') {
        assert.notEqual(outcome.mission.review!.intervention ?? null, null, 'an automatic entry cannot clear the stop');
      } else {
        assert.equal(reviewStatus(outcome.mission.review!), 'approved', 'approval came from the reviewer launch');
      }
    });
  }
}

for (const entry of ['cli', 'board'] as const) {
  it(`${entry} entry gives an already-approved Mission no fabricated approval (TASK-2817)`, { timeout: 10000 }, async t => {
    const outcome = await parityCase('already-approved', entry, t);
    assert.equal(outcome.code, 0, outcome.messages);
    const decisions = outcome.mission.review!.rounds.map(round => round.decision?.kind);
    assert.equal(decisions[0], 'approved');
    assert.equal(decisions.filter(kind => kind === 'approved').length, 1 + outcome.launches.filter(kind => kind === 'review').length, 'every approval beyond the seeded one has a reviewer launch');
  });
}
