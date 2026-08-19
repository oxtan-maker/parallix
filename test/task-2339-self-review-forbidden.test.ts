import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ConfiguredReviewerEligibility,
  beginNextReviewRound,
  changeRevision,
  startReview,
} from '../src/domain/review.js';
import { resolveHandoffReviewAssignment } from '../src/adapters/cli/commands/handoff.js';

const SUBJECT = {
  change: { kind: 'local-branch', sourceBranch: 'mission/task-9001', targetBranch: 'main' },
  revision: changeRevision('handoff-1'),
};
const STARTED_AT = '2026-08-04T09:00:00.000Z';

function eligibility(families: string[]) {
// @ts-expect-error -- TASK-2328: partial test double after ESM seam migration
  return ConfiguredReviewerEligibility.fromReviewStep({ eligible: families, strategy: 'random' });
}

// ---------------------------------------------------------------------------
// Domain rule
// ---------------------------------------------------------------------------

test('startReview rejects a reviewer who is the implementer while other families are eligible', () => {
  assert.throws(
// @ts-expect-error -- TASK-2328: partial test double after ESM seam migration
    () => startReview(SUBJECT, 'claude', 'claude', STARTED_AT, eligibility(['codex', 'claude', 'custom', 'vibe'])),
    /may not review its own work/,
  );
});

test('startReview allows self-review only when the implementer is the sole eligible family', () => {
// @ts-expect-error -- TASK-2328: partial test double after ESM seam migration
  const review = startReview(SUBJECT, 'claude', 'claude', STARTED_AT, eligibility(['claude']));
  assert.equal(review.rounds[0].reviewer, 'claude');
  assert.equal(review.rounds[0].implementer, 'claude');
});

test('beginNextReviewRound rejects a self-reviewing round the same way', () => {
  const readyForNextRound = {
    rounds: [{
      number: 1,
      subject: SUBJECT,
      reviewer: 'codex',
      implementer: 'claude',
      startedAt: STARTED_AT,
      decision: { kind: 'changes-requested', decidedAt: STARTED_AT, comment: null, findings: [] },
      response: { resultingRevision: changeRevision('handoff-2'), respondedAt: STARTED_AT },
      phase: 'fixing',
      disposition: 'CHANGES_MADE',
      reviewerRetryCount: 0,
      implementerRetryCount: 0,
    }],
    intervention: null,
    stageLaunches: [],
    reviewEvents: [],
  };

  assert.throws(
// @ts-expect-error -- TASK-2328: partial test double after ESM seam migration
    () => beginNextReviewRound(readyForNextRound, 'claude', 'claude', STARTED_AT, eligibility(['codex', 'claude'])),
    /may not review its own work/,
  );
});

// ---------------------------------------------------------------------------
// Handoff assignment
// ---------------------------------------------------------------------------

function assignment(overrides: Record<string, unknown> = {}) {
  const logged: string[] = [];
  const result = resolveHandoffReviewAssignment('claude', {
    worktree: '/does/not/matter',
    eligibleAgentsForStepFn: () => ['codex', 'claude', 'custom', 'vibe'],
    log: (msg: string) => logged.push(msg),
    ...overrides,
  });
  return { result, logged };
}

test('handoff assigns a reviewer from another family when one is available', () => {
  const { result, logged } = assignment({ selectAgentFn: () => 'custom' });
  assert.equal(result.reviewer, 'custom');
  assert.equal(result.implementer, 'claude');
  assert.deepEqual([...result.reviewerEligibility.reviewers], ['codex', 'claude', 'custom', 'vibe']);
  assert.deepEqual(logged, []);
});

test('handoff falls back to self-review only on an exhausted pool, and records that eligibility', () => {
  const { result, logged } = assignment({
    selectAgentFn: () => {
      throw new Error('All eligible agents for step "review" are exhausted (limit-hit or excluded). Tried: claude.');
    },
  });

  assert.equal(result.reviewer, 'claude');
  // The recorded eligibility is the one that actually applied. Keeping the
  // four-family policy here is what let a self-reviewed round look legitimate.
  assert.deepEqual([...result.reviewerEligibility.reviewers], ['claude']);
  assert.match(logged.join('\n'), /falling back to self-review/i);
// @ts-expect-error -- TASK-2328: partial test double after ESM seam migration
  assert.doesNotThrow(() => startReview(SUBJECT, result.reviewer, result.implementer, STARTED_AT, result.reviewerEligibility));
});

test('handoff propagates a misconfigured selector instead of reviewing its own work', () => {
  assert.throws(
    () => assignment({
      selectAgentFn: () => {
        throw new Error('No eligible agents have a working launcher for step "review".');
      },
    }),
    /No eligible agents have a working launcher/,
  );
});

test('handoff propagates an unreadable agent policy instead of reviewing its own work', () => {
  assert.throws(
    () => assignment({
      selectAgentFn: () => { throw new Error('Invalid agent config: unexpected token'); },
    }),
    /Invalid agent config/,
  );
});
