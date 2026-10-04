import test from 'node:test';
import assert from 'node:assert/strict';
import { runReviewLoop } from '../../../../src/application/review-loop/review-loop.js';
import { renderReviewVerdict } from '../../../../src/adapters/review/review-loop-presentation.js';
import type { ReviewerArtifactFacts } from '../../../../src/application/ports/review-round.js';
import { fakeReviewLoopPorts } from '../../../helpers/review-loop-ports.js';

/**
 * Focused correction-presentation tests for TASK-2478. These drive the review
 * loop through the REQUEST_CHANGES → act-on-review seam so the operator-facing
 * correction chain (finding named before the implementer launch) is asserted
 * without launching real agents. maxAttempts=1 keeps the run in round 1.
 */
function requestChanges(consumeReviewer?: () => Promise<ReviewerArtifactFacts>) {
  let head = 0;
  return fakeReviewLoopPorts({
    slug: 'task-999',
    routing: { eligibleFamilies: () => ['codex'] },
    // provider-disabled --start performs the handoff transition.
    handoff: { handoff: async () => ({ ok: true }) },
    task: { implementer: () => 'claude' },
    artifacts: {
      consumeReviewer: consumeReviewer ?? (async () => ({
        consumed: true, ok: true, reviewState: 'REQUEST_CHANGES',
        reviewFindings: [
          { id: 'F1', summary: 'fractional input accepted instead of rejected' },
          { id: 'F2', summary: 'negative input dropped' },
        ],
      })),
      consumeImplementer: async () => ({ consumed: true, ok: true, disposition: 'CHANGES_MADE' }),
    },
    agents: { launch: async () => ({ result: {} }) },
    preReview: { head: () => `head-${++head}` },
    output: { exit: (code: number) => { throw new Error(`exit(${code})`); } },
  });
}

test('ACTING ON REVIEW restates the concrete findings before the implementer launch', async () => {
  const fake = requestChanges();
  await runReviewLoop({ slug: 'task-999', reviewer: 'codex', maxAttempts: 1 }, fake.ports);
  const { logs, errors } = fake;

  const idxActingOn = logs.findIndex((m) => m.includes('ACTING ON REVIEW'));
  const idxLaunch = logs.findIndex((m) => m.includes('launching implementer') && m.includes('act-on-review'));
  assert.ok(idxActingOn !== -1, 'ACTING ON REVIEW presentation present before implementer launch');
  assert.ok(idxLaunch !== -1, 'implementer launched for act-on-review (live response not mocked away)');
  assert.ok(idxActingOn < idxLaunch, 'findings presented before the implementer is launched');
  assert.match(logs[idxActingOn + 1], /Finding F1: fractional input accepted instead of rejected/);
  assert.match(logs[idxActingOn + 2], /Finding F2: negative input dropped/);
  assert.ok(errors.length === 0, `no errors: ${errors.join(' | ')}`);
});

test('APPROVED verdict carries the round number on a re-round (criterion 9)', () => {
  const round2: string[] = [];
  renderReviewVerdict('APPROVED', [], (l) => round2.push(l), false, 2);
  const approved = round2.find((m) => /APPROVED/.test(m) && m.includes('===='));
  assert.ok(approved && /round 2/.test(approved), `re-round approval names the round: ${approved}`);

  const round1: string[] = [];
  renderReviewVerdict('APPROVED', [], (l) => round1.push(l), false, 1);
  const first = round1.find((m) => /APPROVED/.test(m) && m.includes('===='));
  assert.ok(first && !/round/.test(first), 'round 1 approval is not suffixed');
});

test('re-round reruns verification against the revised tree and approves round 2 (criterion 6/7/9)', async () => {
  let reviewCalls = 0;
  const fake = requestChanges(async () => {
    reviewCalls += 1;
    return reviewCalls === 1
      ? { consumed: true, ok: true, reviewState: 'REQUEST_CHANGES', reviewFindings: [{ id: 'F1', summary: 'fractional input accepted' }] }
      : { consumed: true, ok: true, reviewState: 'APPROVED', reviewFindings: [] };
  });
  // Round 1 -> REQUEST_CHANGES; round 2 -> APPROVED on the revised tree.
  await runReviewLoop({ slug: 'task-999', reviewer: 'codex', maxAttempts: 2 }, fake.ports);
  const { logs, errors } = fake;

  const verifiedIdx = logs.findIndex((m) => m.includes('verification passed against the revised tree'));
  assert.ok(verifiedIdx !== -1, `round-2 verification rerun presented: ${logs.filter((m) => m.includes('verification passed'))}`);
  assert.match(logs[verifiedIdx], /round 2/);
  const approvedIdx = logs.findIndex((m) => /APPROVED/.test(m) && m.includes('====') && /round 2/.test(m));
  assert.ok(approvedIdx !== -1, `final approval associated with round 2: ${logs[approvedIdx]}`);
  assert.ok(errors.length === 0, `no errors: ${errors.join(' | ')}`);
  assert.deepEqual(fake.mirrors.slice(-1), ['approved'], 'the approval is mirrored onto the Backlog task');
});

test('REQUEST_CHANGES still emits no APPROVED verdict line', async () => {
  const fake = requestChanges();
  await runReviewLoop({ slug: 'task-999', reviewer: 'codex', maxAttempts: 1 }, fake.ports);
  assert.ok(!fake.logs.some((m) => /APPROVED/.test(m) && m.includes('====')), 'no APPROVED verdict for a request-changes run');
});
