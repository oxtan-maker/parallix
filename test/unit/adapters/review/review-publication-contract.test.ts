import test from 'node:test';
import assert from 'node:assert/strict';
import { approvedReview, fixtureMission, inMemoryTransitionStore, pendingReview } from '../../../fixtures/mission-builders.js';
import { missionExecutionContext } from '../../../fixtures/mission-execution-context.js';
import { postWorkflowComment, recoverReviewPublications } from '../../../../src/adapters/review/review-workflow-posting.js';
import { createEvent } from '../../../../src/adapters/review/review-events.js';
import {
  parseReviewPublication,
  parseReviewPublicationBody,
  reviewPublicationBody,
  reviewPublicationReference,
  type ReviewPublicationIdentity,
} from '../../../../src/adapters/review/review-publication.js';
import { changeRevision } from '../../../../src/domain/review.js';
import { agentFamily } from '../../../../src/domain/agents.js';

const slug = 'task-97782';
const publication: ReviewPublicationIdentity = {
  slug,
  round: 11,
  actor: 'custom',
  revision: 'abc123',
  eventType: 'reviewer_findings',
  target: 'comment',
};

function publicationStore() {
  const pending = pendingReview(slug);
  const review = { ...pending, rounds: [{ ...pending.rounds[0]!, number: 11,
    subject: { ...pending.rounds[0]!.subject, revision: changeRevision('abc123') } }] as typeof pending.rounds };
  return inMemoryTransitionStore(fixtureMission(slug, { review: {
    ...review,
    reviewEvents: [{
      position: 0,
      eventType: 'reviewer_findings',
      roundNumber: 11,
      phase: 'reviewing',
      actor: 'custom',
      content: '## F1: provider gap',
      disposition: null,
      verdict: null,
      itemDispositions: null,
      blockedReason: null,
      followUpReference: reviewPublicationReference(publication),
      createdAt: '2026-11-13T00:00:00.000Z',
    }],
  } }));
}

function postingOptions(store: ReturnType<typeof publicationStore>, comments: { body: string }[]) {
  return {
    executionContext: missionExecutionContext({ missionId: slug, missionWorktree: '/controlled-review-worktree' }),
    missionStore: store,
    reviewIdentity: 'custom',
    readTokenFn: () => 'token',
    getCommentsFn: async () => comments,
    buildMetadataFooterFn: () => '',
    publication,
    log: () => {},
    error: () => {},
  };
}

test('provider rejection preserves the event and records a visible failed gap (PX-0054.02)', async () => {
  const store = publicationStore();
  const result = await postWorkflowComment(slug, '## F1: provider gap', {
    ...postingOptions(store, []),
    postCommentFn: () => ({ ok: false as const, data: null, status: 503, statusCode: 503, stderr: null, error: 'provider rejected' }),
  });

  assert.equal(result.ok, false);
  const event = store.mission().review!.reviewEvents[0];
  assert.match(event.content, /provider gap/);
  assert.deepEqual(parseReviewPublication(event.followUpReference), { ...publication, key: parseReviewPublication(event.followUpReference)!.key, state: 'failed', error: 'provider rejected' });
});

test('accepted-then-interrupted publication recovers once from the provider marker (PX-0054.02)', async () => {
  const store = publicationStore();
  const comments: { body: string }[] = [];
  let posts = 0;
  const interrupted = await postWorkflowComment(slug, '## F1: provider gap', {
    ...postingOptions(store, comments),
    postCommentFn: (_branch, _token, body) => {
      posts += 1;
      comments.push({ body });
      throw new Error('connection closed after acceptance');
    },
  });
  assert.equal(interrupted.ok, false);
  assert.equal(parseReviewPublication(store.mission().review!.reviewEvents[0].followUpReference)?.state, 'failed');

  const recovered = await recoverReviewPublications(slug, {
    ...postingOptions(store, comments),
    postCommentFn: () => { posts += 1; return { ok: true as const, data: null, status: 201, statusCode: 201, stderr: null, error: null }; },
  });
  assert.deepEqual(recovered, { ok: true, pending: 1 });
  assert.equal(posts, 1, 'provider acceptance is reconciled instead of posted twice');
  assert.equal(parseReviewPublication(store.mission().review!.reviewEvents[0].followUpReference)?.state, 'completed');

  const repeated = await recoverReviewPublications(slug, { ...postingOptions(store, comments) });
  assert.deepEqual(repeated, { ok: true, pending: 0 });
  assert.equal(posts, 1);
});

test('publication recovery retires a superseded round without another provider mutation (TASK-2855)', async () => {
  const store = publicationStore();
  const loaded = await store.load();
  const review = loaded.mission.review!;
  await store.save({ ...loaded.mission, review: { ...review, rounds: [{ ...review.rounds[0]!,
    number: 12, subject: { ...review.rounds[0]!.subject, revision: changeRevision('new-head') },
  }] as typeof review.rounds } }, loaded.version);
  let posts = 0;
  const options = {
    ...postingOptions(store, []),
    postCommentFn: () => { posts += 1; return { ok: true as const, data: null, status: 201, statusCode: 201, stderr: null, error: null }; },
  };

  assert.deepEqual(await recoverReviewPublications(slug, options), { ok: true, pending: 1 });
  assert.equal(posts, 0);
  assert.equal(parseReviewPublication(store.mission().review!.reviewEvents[0]!.followUpReference)?.state, 'completed');
  assert.deepEqual(await recoverReviewPublications(slug, options), { ok: true, pending: 0 });
  assert.equal(posts, 0, 'repeated recovery cannot replay the superseded verdict');
});

test('publication recovery keeps a selected reviewer obligation when the primary reviewer differs (TASK-2855 F2)', async () => {
  const store = publicationStore();
  const loaded = await store.load();
  const review = loaded.mission.review!;
  await store.save({ ...loaded.mission, review: { ...review, rounds: [{ ...review.rounds[0]!,
    reviewer: agentFamily('claude'), reviewerPolicy: {
      revision: changeRevision('abc123'), mode: 'two-independent', requiredApprovals: 2,
      selected: [agentFamily('custom'), agentFamily('claude')], independentAvailable: 2,
      unavailable: [], rerouted: [], fallbackReason: null,
    },
  }] as typeof review.rounds } }, loaded.version);
  let posts = 0;

  assert.deepEqual(await recoverReviewPublications(slug, {
    ...postingOptions(store, []),
    postCommentFn: () => { posts += 1; return { ok: true as const, data: null, status: 201, statusCode: 201, stderr: null, error: null }; },
  }), { ok: true, pending: 1 });
  assert.equal(posts, 1, 'the selected reviewer publication remains current even when round.reviewer names its peer');
  assert.equal(parseReviewPublication(store.mission().review!.reviewEvents[0]!.followUpReference)?.state, 'completed');
});

test('publication recovery keeps a reviewer obligation at the governed revision (TASK-2855 F8)', async () => {
  const store = publicationStore();
  const loaded = await store.load();
  const review = loaded.mission.review!;
  const governed = { ...publication, revision: 'reviewed-head' };
  await store.save({ ...loaded.mission, review: {
    ...review,
    rounds: [{ ...review.rounds[0]!, reviewerPolicy: {
      revision: changeRevision(governed.revision), mode: 'two-independent', requiredApprovals: 2,
      selected: [agentFamily('custom'), agentFamily('claude')], independentAvailable: 2,
      unavailable: [], rerouted: [], fallbackReason: null,
    } }] as typeof review.rounds,
    reviewEvents: [{ ...review.reviewEvents[0]!, followUpReference: reviewPublicationReference(governed) }],
  } }, loaded.version);
  let posts = 0;

  assert.equal(store.mission().review!.rounds[0]!.subject.revision, changeRevision('abc123'),
    'the round-open subject remains distinct from the governed review revision');
  assert.deepEqual(await recoverReviewPublications(slug, {
    ...postingOptions(store, []),
    postCommentFn: () => { posts += 1; return { ok: true as const, data: null, status: 201, statusCode: 201, stderr: null, error: null }; },
  }), { ok: true, pending: 1 });
  assert.equal(posts, 1, 'the current governed-revision publication is posted instead of falsely retired');
  assert.equal(parseReviewPublication(store.mission().review!.reviewEvents[0]!.followUpReference)?.state, 'completed');
});

test('publication recovery keeps a current blocked implementer obligation without a response (TASK-2855 F1)', async () => {
  const base = pendingReview(slug);
  const round = { ...base.rounds[0]!, number: 11, disposition: 'BLOCKED' as const, response: null };
  const identity: ReviewPublicationIdentity = {
    slug, round: 11, actor: String(round.implementer), revision: 'blocked-head',
    eventType: 'implementer_disposition', target: 'comment',
  };
  const store = inMemoryTransitionStore(fixtureMission(slug, { review: {
    ...base,
    rounds: [round] as typeof base.rounds,
    reviewEvents: [{
      position: 0, eventType: 'implementer_disposition', roundNumber: 11, phase: 'fixing', actor: identity.actor,
      content: 'Autonomous review disposition: BLOCKED', disposition: 'BLOCKED', verdict: null,
      itemDispositions: null, blockedReason: 'external dependency',
      followUpReference: reviewPublicationReference(identity), createdAt: '2026-11-13T00:00:00.000Z',
    }],
  } }));
  let posts = 0;

  assert.deepEqual(await recoverReviewPublications(slug, {
    ...postingOptions(store, []),
    postCommentFn: () => { posts += 1; return { ok: true as const, data: null, status: 201, statusCode: 201, stderr: null, error: null }; },
  }), { ok: true, pending: 1 });
  assert.equal(posts, 1, 'the current blocked-round evidence is posted instead of falsely retired');
  assert.equal(parseReviewPublication(store.mission().review!.reviewEvents[0]!.followUpReference)?.state, 'completed');
});

test('restart recovery completes a same-agent self-author approval as one PR comment (PX-0054.02 F3)', async () => {
  const approved = approvedReview(slug);
  const actor = String(approved.rounds[0].reviewer);
  const identity: ReviewPublicationIdentity = {
    slug, round: 1, actor, revision: 'fixture-revision', eventType: 'reviewer_outcome', target: 'review',
  };
  const event = {
    position: 0, eventType: 'reviewer_outcome' as const, roundNumber: 1, phase: 'approved', actor,
    content: 'approved', disposition: null, verdict: 'approve', itemDispositions: null, blockedReason: null,
    followUpReference: reviewPublicationReference(identity), createdAt: '2026-11-13T00:00:00.000Z',
  };
  const review = {
    ...approved,
    rounds: [{ ...approved.rounds[0], implementer: approved.rounds[0].reviewer }] as typeof approved.rounds,
    reviewEvents: [event],
  };
  const store = inMemoryTransitionStore(fixtureMission(slug, { status: 'integration', review }));
  const comments: string[] = [];
  const recovered = await recoverReviewPublications(slug, {
    executionContext: missionExecutionContext({ missionId: slug, missionWorktree: '/controlled-review-worktree' }),
    missionStore: store,
    readTokenFn: () => 'token',
    getCommentsFn: async () => [],
    getPrAuthorFn: () => actor,
    postReviewFn: () => assert.fail('Forgejo self-approval reviews remain forbidden'),
    postCommentFn: (_branch, _token, body) => {
      comments.push(body);
      return { ok: true as const, data: null, status: 201, statusCode: 201, stderr: null, error: null };
    },
    log: () => {}, error: () => {},
  });

  assert.deepEqual(recovered, { ok: true, pending: 1 });
  assert.equal(comments.length, 1);
  assert.match(comments[0]!, /round 1; actor/);
  assert.equal(parseReviewPublication(store.mission().review?.reviewEvents[0]?.followUpReference)?.state, 'completed');
});

test('publication body carries visible round actor revision provenance and a stable marker (PX-0054.02)', () => {
  const first = reviewPublicationBody('finding', publication);
  const second = reviewPublicationBody('finding', publication);
  assert.equal(first, second);
  assert.match(first, /round 11; actor custom; revision abc123/);
  assert.match(first, /<!-- parallix-publication:/);
  assert.deepEqual(parseReviewPublicationBody(first), {
    slug, round: 11, actor: 'custom', revision: 'abc123', eventType: 'reviewer_findings',
  });
  assert.equal(parseReviewPublicationBody(first.replace('actor custom', 'actor codex')), null,
    'visible provenance cannot contradict the durable marker');
});

test('repeated local persistence keeps one event for the publication identity (PX-0054.02)', async () => {
  const store = publicationStore();
  const before = store.mission().review!.reviewEvents.length;
  for (const state of ['pending', 'failed'] as const) {
    const result = await createEvent(slug, 'reviewer_findings', {
      content: `retry ${state}`,
      round: publication.round,
      phase: 'reviewing',
      actor: publication.actor,
      followUpReference: reviewPublicationReference(publication, state, state === 'failed' ? 'rejected' : null),
    }, {
      executionContext: missionExecutionContext({ missionId: slug, missionWorktree: '/controlled-review-worktree' }),
      missionStore: store,
      log: () => {},
      error: () => {},
    });
    assert.equal(result.ok, true);
  }
  assert.equal(store.mission().review!.reviewEvents.length, before, 'the publication key is the local idempotency key');
});
