import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fixtureMission, approvedReview } from '../../../fixtures/mission-builders.js';
import type { getComments } from '../../../../src/adapters/forgejo/forgejo.js';
import { missionVersion } from '../../../../src/application/domain-ports.js';
import { changeRevision as fixtureRevision } from '../../../../src/domain/review.js';
import { ReviewState } from '../../../../src/adapters/review/review-state.js';
import { reviewStateDataFrom } from '../../../../src/adapters/review/review-state-mapping.js';
import { resolveConfiguration } from '../../../../src/composition/config.js';

// Provider approval retention and read-only corrections, independent of prompt rendering.
import { composeHumanFeedback } from '../../../../src/adapters/review/review-loop-human-feedback.js';

test('retention reads shared human corrections without consuming them and fails closed when unreadable (TASK-2820)', async () => {
  let writes = 0, token: string | null = 'token';
  const configuration = resolveConfiguration({ FORGEJO_HOME: '/isolated/forgejo' });
  let comments: NonNullable<Awaited<ReturnType<typeof getComments>>> | null = [
    { kind: 'review', id: 'new-human-decision', user: 'operator', isBot: false, state: 'REQUEST_CHANGES', body: 'Keep the validation.', created: '2026-10-25T10:00:00Z', updated: '2026-10-25T10:00:00Z' },
  ];
  const feedback = composeHumanFeedback({ slug: 'task-retention', branch: 'mission/task-retention', worktree: '/fixture',
    providerEnabled: true, strict: true, readOnly: true, missionStore: null, configuration, log() {}, error() {},
    fetchComments: async (_branch, _token, options) => { assert.strictEqual(options?.configuration, configuration); return comments; },
    tokenFor: (_identity, options) => { assert.strictEqual(options?.configuration, configuration); return token; },
    recordHumanNote: async () => { writes++; return { ok: true, path: null }; } });
  const state = new ReviewState('task-retention', { reviewer: 'claude', implementer: 'codex', phase: 'approved', round: 1 });
  assert.equal((await feedback.reconcile(state))?.disposition, 'REQUEST_CHANGES');
  assert.equal((await feedback.reconcile(state))?.disposition, 'REQUEST_CHANGES', 'a retry still sees the correction');
  comments = [{ kind: 'review', id: 'human-approval', user: 'operator', isBot: false, state: 'APPROVED', dismissed: true, body: '', created: '2026-10-25T10:00:00Z', updated: '2026-10-25T10:00:00Z' }];
  assert.equal((await feedback.reconcile(state))?.state, 'dismissed');
  comments = null;
  await assert.rejects(feedback.reconcile(state), /unavailable/);
  token = null;
  await assert.rejects(feedback.reconcile(state), /unavailable/);
  assert.equal(writes, 0);
});


import { createIntegrationApprovalEvidence } from '../../../../src/adapters/review/integration-approval-evidence.js';
import { getComments as readProviderComments } from '../../../../src/adapters/forgejo/forgejo.js';
import { forgejoApiFixture } from '../../../fixtures/forgejo-api.js';

test('retention and landing distinguish dismissed approvals from withdrawn change requests (TASK-2820)', async () => {
  const review = approvedReview('task-retention'), round = review.rounds[0];
  assert.ok(round.decision?.kind === 'approved');
  const mission = fixtureMission('task-retention', { status: 'integration', review: { ...review, rounds: [
    { ...round, decision: { ...round.decision, revision: fixtureRevision('judged-A') } },
  ] } });
  let comments = [{ kind: 'review', id: 'codex-approval', user: 'codex', isBot: false, state: 'APPROVED',
    dismissed: false, commitId: 'judged-A', body: '', updated: '2026-10-25T10:00:00Z', created: '2026-10-25T10:00:00Z' }];
  let readWire = true;
  const evidence = createIntegrationApprovalEvidence(path.resolve(import.meta.dirname, '..', '..', '..', '..'), async () => null, undefined, { providerEnabled: () => true,
    tokenFor: () => 'test-token', fetchComments: (branch, token) => readWire ? readProviderComments(branch, token, {
      apiCall: forgejoApiFixture((method, route) => {
        assert.equal(method, 'GET');
        if (route.includes('/mission/task-retention')) { return { ok: true as const, data: { number: 7, state: 'open' } }; }
        if (route === '/pulls/7/reviews') { return { ok: true as const, data: comments.map((comment, index) => ({
          id: index + 1, user: { login: comment.user }, state: comment.state, dismissed: comment.dismissed,
          commit_id: comment.commitId, submitted_at: comment.created,
        })) }; }
        return { ok: true as const, data: [] };
      }),
    }) : Promise.resolve(comments) });
  const store = { load: async () => ({ kind: 'found' as const, mission, version: missionVersion(1) }),
    save: async () => { throw new Error('read-only provider validation cannot write a decision'); } };
  assert.equal(await evidence.reconcileHumanFeedback(mission, store), true, 'wire normalization preserves the standing approval identity');
  readWire = false; comments[0] = { ...comments[0], dismissed: true };
  assert.equal(await evidence.reconcileHumanFeedback(mission, store), false, 'human dismissal invalidates an agent-authored approval');
  comments.push({ ...comments[0], id: 'unrelated', commitId: 'other-B', dismissed: false, created: '2026-10-25T11:00:00Z' });
  assert.equal(await evidence.reconcileHumanFeedback(mission, store), false, 'a different revision cannot replace the dismissed approval');
  comments[0] = { ...comments[0], dismissed: false };
  assert.equal(await evidence.reconcileHumanFeedback(mission, store), true, 'matching standing approval remains usable');
  const standing = comments[0];
  comments.push({ ...standing, id: 'legacy', commitId: '', created: 'unreadable' });
  assert.equal(await evidence.reconcileHumanFeedback(mission, store), true, 'unidentified legacy review cannot invalidate a matching standing approval');
  comments = [standing];
  for (const author of ['operator', 'codex']) {
    comments = [standing, { ...standing, id: 'request', user: author, state: 'REQUEST_CHANGES', dismissed: false, created: '2026-10-25T12:00:00Z' }];
    assert.equal(await evidence.reconcileHumanFeedback(mission, store), false, 'a current request still blocks');
    comments[1] = { ...comments[1], dismissed: true };
    assert.equal(await evidence.reconcileHumanFeedback(mission, store), true, 'withdrawing a request reveals the standing approval');
    comments[1] = { ...comments[1], commitId: '', created: 'unreadable' };
    assert.equal(await evidence.reconcileHumanFeedback(mission, store), true, 'withdrawn requests are excluded before decision metadata checks');
    comments[0] = { ...standing, dismissed: true };
    assert.equal(await evidence.reconcileHumanFeedback(mission, store), false, 'withdrawing a request cannot revive a dismissed approval');
    comments = comments.slice(1);
    assert.equal(await evidence.reconcileHumanFeedback(mission, store), false, 'withdrawing a request cannot create an approval');
  }
  comments = [];
  assert.equal(await evidence.reconcileHumanFeedback(mission, store), false, 'missing provider approval fails closed');
});
