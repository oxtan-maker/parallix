import test from 'node:test';
import assert from 'node:assert/strict';
import { approvedReview, fixtureMission, inMemoryTransitionStore, pendingReview } from '../../../fixtures/mission-builders.js';
import { missionExecutionContext } from '../../../fixtures/mission-execution-context.js';
import { postWorkflowComment, recoverReviewPublications } from '../../../../src/adapters/review/review-workflow-posting.js';
import { createEvent } from '../../../../src/adapters/review/review-events.js';
import {
  claimReviewPublication,
  parseReviewPublication,
  parseReviewPublicationBody,
  reviewPublicationBody,
  reviewPublicationKey,
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
    subject: { ...pending.rounds[0]!.subject, revision: changeRevision('abc123') },
    reviewerPolicy: {
      revision: changeRevision('abc123'), mode: 'two-independent' as const, requiredApprovals: 2 as const,
      selected: [agentFamily('custom'), agentFamily('claude')], independentAvailable: 2,
      unavailable: [], rerouted: [], fallbackReason: null,
    } }] as typeof pending.rounds };
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

function compareAndSwapPublicationStore() {
  const store = publicationStore();
  let priorSave = Promise.resolve();
  return {
    ...store,
    async save(
      mission: Parameters<typeof store.save>[0],
      expectedVersion: Parameters<typeof store.save>[1],
    ) {
      const waitFor = priorSave;
      let release!: () => void;
      priorSave = new Promise<void>(resolve => { release = resolve; });
      await waitFor;
      try {
        const current = await store.load();
        if (expectedVersion !== current.version) {
          const stale = new Error(`stale publication write: expected ${expectedVersion}, found ${current.version}`) as Error & { disposition: string };
          stale.disposition = 'stale-write';
          throw stale;
        }
        return await store.save(mission, expectedVersion);
      } finally {
        release();
      }
    },
  };
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

test('recovery settles the exact obligation when an earlier revision shares its coordinates (TASK-2870.02 F1)', async () => {
  const store = publicationStore();
  const loaded = await store.load();
  const review = loaded.mission.review!;
  const later = { ...publication, revision: 'reported-later' };
  await store.save({ ...loaded.mission, review: { ...review, reviewEvents: [
    { ...review.reviewEvents[0]!, followUpReference: reviewPublicationReference(publication, 'completed') },
    { ...review.reviewEvents[0]!, position: 1, followUpReference: reviewPublicationReference(later) },
  ] } }, loaded.version);
  const comments = [{ body: reviewPublicationBody('## F1: provider gap', publication) }];
  let posts = 0;
  const options = {
    ...postingOptions(store, comments),
    postCommentFn: () => {
      posts += 1;
      return { ok: true as const, data: null, status: 201, statusCode: 201, stderr: null, error: null };
    },
  };

  assert.deepEqual(await recoverReviewPublications(slug, options), { ok: true, pending: 1 });
  assert.equal(posts, 0, 'the accepted marker settles the calling obligation without another provider entry');
  assert.equal(comments.length, 1);
  const durable = store.mission().review!.reviewEvents.map(event => parseReviewPublication(event.followUpReference)!);
  assert.deepEqual(durable.map(entry => entry.state), ['completed', 'completed']);
  assert.deepEqual(durable.map(entry => entry.revision), ['abc123', 'abc123']);
  assert.deepEqual(await recoverReviewPublications(slug, options), { ok: true, pending: 0 });
});

test('overlapping initial and recovery publishers share one durable claim after lost acknowledgement (TASK-2870.02)', async () => {
  const store = compareAndSwapPublicationStore();
  const comments: { body: string }[] = [];
  let reads = 0;
  let releaseReads!: () => void;
  const bothReadersArrived = new Promise<void>(resolve => { releaseReads = resolve; });
  const getCommentsFn = async () => {
    reads += 1;
    if (reads === 2) { releaseReads(); }
    if (reads <= 2) { await bothReadersArrived; }
    return [...comments];
  };
  let posts = 0;
  const postCommentFn: NonNullable<Parameters<typeof postWorkflowComment>[2]['postCommentFn']> = (_branch, _token, body) => {
    posts += 1;
    comments.push({ body });
    if (posts === 1) { throw new Error('connection closed after provider acceptance'); }
    return { ok: true as const, data: null, status: 201, statusCode: 201, stderr: null, error: null };
  };
  const options = { ...postingOptions(store, comments), getCommentsFn, postCommentFn };

  const [initial, overlappingRecovery] = await Promise.all([
    postWorkflowComment(slug, '## F1: provider gap', options),
    recoverReviewPublications(slug, options),
  ]);

  assert.equal(initial.ok, false, 'a lost acknowledgement is not reported as provider success');
  assert.equal(overlappingRecovery.ok, false, 'a busy claim is pending, not provider success');
  assert.equal(posts, 1, 'overlap cannot pass the provider marker check twice');
  assert.equal(comments.length, 1, 'the accepted event has one visible provider entry');

  assert.deepEqual(await recoverReviewPublications(slug, options), { ok: true, pending: 1 });
  assert.equal(posts, 1, 'the marker reconciles the lost acknowledgement without another post');
  assert.equal(parseReviewPublication(store.mission().review!.reviewEvents[0]!.followUpReference)?.state, 'completed');
});

test('a tokenless result cannot clear or complete another publisher claim (TASK-2870.02 F1)', async () => {
  const store = publicationStore();
  assert.equal(await claimReviewPublication(store, slug, publication, 'claim-owner'), 'acquired');

  const unreadable = await postWorkflowComment(slug, '## F1: provider gap', {
    ...postingOptions(store, []),
    getCommentsFn: async () => null,
  });
  assert.equal(unreadable.ok, false);
  assert.match(unreadable.error ?? '', /claim changed/);
  let durable = parseReviewPublication(store.mission().review!.reviewEvents[0]!.followUpReference)!;
  assert.equal(durable.state, 'publishing');
  assert.equal(durable.claim, 'claim-owner');

  const accepted = await postWorkflowComment(slug, '## F1: provider gap', {
    ...postingOptions(store, []),
    getCommentsFn: async () => [{ body: reviewPublicationBody('accepted', publication) }],
  });
  assert.equal(accepted.ok, false);
  assert.match(accepted.error ?? '', /claim changed/);
  durable = parseReviewPublication(store.mission().review!.reviewEvents[0]!.followUpReference)!;
  assert.equal(durable.state, 'publishing');
  assert.equal(durable.claim, 'claim-owner');
});

test('initial publication reconciles an ungoverned revision before identity creation (TASK-2870.02)', async () => {
  const store = publicationStore();
  const loaded = await store.load();
  const review = loaded.mission.review!;
  const ungoverned = { ...publication, revision: 'missing-revision' };
  await store.save({ ...loaded.mission, review: {
    ...review,
    rounds: [{ ...review.rounds[0]!, reviewerPolicy: {
      revision: changeRevision('governed-revision'), mode: 'two-independent', requiredApprovals: 2,
      selected: [agentFamily('custom'), agentFamily('claude')], independentAvailable: 2,
      unavailable: [], rerouted: [], fallbackReason: null,
    } }] as typeof review.rounds,
    reviewEvents: [{ ...review.reviewEvents[0]!, followUpReference: reviewPublicationReference(ungoverned) }],
  } }, loaded.version);
  const bodies: string[] = [];

  const result = await postWorkflowComment(slug, '## F1: provider gap', {
    ...postingOptions(store, []), publication: ungoverned,
    postCommentFn: (_branch, _token, body) => {
      bodies.push(body);
      return { ok: true as const, data: null, status: 201, statusCode: 201, stderr: null, error: null };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(bodies.length, 1);
  assert.match(bodies[0]!, /revision governed-revision/);
  assert.doesNotMatch(bodies[0]!, /missing-revision/);
  const durable = parseReviewPublication(store.mission().review!.reviewEvents[0]!.followUpReference)!;
  assert.equal(durable.revision, 'governed-revision', 'the durable key is rebound to aggregate authority');
  assert.equal(durable.state, 'completed');
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

test('publication recovery cannot retire a superseded event under another live claim (TASK-2870.02 F1)', async () => {
  const store = publicationStore();
  assert.equal(await claimReviewPublication(store, slug, publication, 'claim-owner'), 'acquired');
  const loaded = await store.load();
  const review = loaded.mission.review!;
  await store.save({ ...loaded.mission, review: { ...review, rounds: [{ ...review.rounds[0]!,
    number: 12, subject: { ...review.rounds[0]!.subject, revision: changeRevision('new-head') },
  }] as typeof review.rounds } }, loaded.version);

  assert.deepEqual(await recoverReviewPublications(slug, postingOptions(store, [])), { ok: false, pending: 1 });
  const durable = parseReviewPublication(store.mission().review!.reviewEvents[0]!.followUpReference)!;
  assert.equal(durable.state, 'publishing');
  assert.equal(durable.claim, 'claim-owner');
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

for (const verdict of ['approve', 'request-changes', 'comment']) {
  test(`restart publishes the original PR author's ${verdict} without changing the current round`, async () => {
    const review = pendingReview(slug);
    const identity: ReviewPublicationIdentity = {
      slug, round: 1, actor: 'claude', revision: 'fixture-revision', eventType: 'reviewer_outcome', target: 'review',
    };
    const store = inMemoryTransitionStore(fixtureMission(slug, { review: {
      ...review,
      reviewEvents: [{ position: 0, eventType: 'reviewer_outcome', roundNumber: 1, phase: 'reviewing',
        actor: 'claude', content: `Retained ${verdict}`, verdict, disposition: null, itemDispositions: null,
        blockedReason: null, followUpReference: reviewPublicationReference(identity), createdAt: '2026-11-13T00:00:00.000Z' }],
    } }));
    const before = structuredClone(store.mission().review!.rounds);
    const comments: { body: string }[] = [];
    const options = {
      executionContext: missionExecutionContext({ missionId: slug, missionWorktree: '/controlled-review-worktree' }),
      missionStore: store, readTokenFn: () => 'token', getCommentsFn: async () => comments,
      getPrAuthorFn: () => 'claude',
      postReviewFn: () => assert.fail('Forgejo forbids formal reviews from the PR author'),
      postCommentFn: (_branch: string, _token: string, body: string) => {
        comments.push({ body });
        return { ok: true as const, data: null, status: 201, statusCode: 201, stderr: null, error: null };
      },
      log: () => {}, error: () => {},
    };
    assert.deepEqual(await recoverReviewPublications(slug, options), { ok: true, pending: 1 });
    assert.deepEqual(await recoverReviewPublications(slug, options), { ok: true, pending: 0 });
    assert.equal(comments.length, 1);
    assert.ok(comments[0]!.body.startsWith(`Verdict: ${verdict}\n`));
    assert.match(comments[0]!.body, /round 1; actor claude; revision fixture-revision/);
    assert.deepEqual(store.mission().review!.rounds, before, 'publication cannot rewrite decisions or implementer responses');
    assert.equal(store.mission().status, 'active', 'publication cannot advance the Mission');
    assert.equal(parseReviewPublication(store.mission().review!.reviewEvents[0]!.followUpReference)?.state, 'completed');
  });
}

test('an interrupted PR-author comment recovers its marker without a duplicate verdict or decision', async () => {
  const review = pendingReview(slug);
  const identity: ReviewPublicationIdentity = {
    slug, round: 1, actor: 'claude', revision: 'fixture-revision', eventType: 'reviewer_outcome', target: 'review',
  };
  const store = inMemoryTransitionStore(fixtureMission(slug, { review: { ...review, reviewEvents: [{
    position: 0, eventType: 'reviewer_outcome', roundNumber: 1, phase: 'reviewing', actor: 'claude',
    content: 'Changes required', verdict: 'request-changes', disposition: null, itemDispositions: null,
    blockedReason: null, followUpReference: reviewPublicationReference(identity), createdAt: '2026-11-13T00:00:00.000Z',
  }] } }));
  const before = structuredClone(store.mission().review!.rounds);
  const comments: { body: string }[] = [];
  let posts = 0;
  const options = {
    executionContext: missionExecutionContext({ missionId: slug, missionWorktree: '/controlled-review-worktree' }),
    missionStore: store, readTokenFn: () => 'token', getCommentsFn: async () => comments,
    getPrAuthorFn: () => 'claude', postReviewFn: () => assert.fail('PR author must publish a comment'),
    postCommentFn: (_branch: string, _token: string, body: string): never => {
      posts++;
      comments.push({ body });
      throw new Error('connection closed after acceptance');
    },
    log: () => {}, error: () => {},
  };
  assert.deepEqual(await recoverReviewPublications(slug, options), { ok: false, pending: 1 });
  assert.equal(parseReviewPublication(store.mission().review!.reviewEvents[0]!.followUpReference)?.state, 'failed');
  assert.deepEqual(await recoverReviewPublications(slug, options), { ok: true, pending: 1 });
  assert.equal(posts, 1);
  assert.equal(store.mission().review!.reviewEvents.length, 1);
  assert.deepEqual(store.mission().review!.rounds, before);
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

test('publication identity preserves distinct native attempts and event types with identical prose (TASK-2870.02)', () => {
  const firstAttempt = { ...publication, attempt: 'native-run-1' };
  const secondAttempt = { ...publication, attempt: 'native-run-2' };
  const outcome = { ...firstAttempt, eventType: 'reviewer_outcome' as const, target: 'review' as const };

  assert.notEqual(reviewPublicationKey(firstAttempt), reviewPublicationKey(secondAttempt));
  assert.notEqual(reviewPublicationKey(firstAttempt), reviewPublicationKey(outcome));
  assert.equal(parseReviewPublication(reviewPublicationReference(firstAttempt))?.attempt, 'native-run-1');
  assert.equal(reviewPublicationBody('identical prose', firstAttempt).startsWith('identical prose'), true);
  assert.equal(reviewPublicationBody('identical prose', outcome).startsWith('identical prose'), true);
});

test('publication recovery retains the native attempt identity (TASK-2870.02)', async () => {
  const store = publicationStore();
  const loaded = await store.load();
  const attempted = { ...publication, attempt: 'native-run-recovery' };
  await store.save({ ...loaded.mission, review: { ...loaded.mission.review!, reviewEvents: [
    { ...loaded.mission.review!.reviewEvents[0]!, followUpReference: reviewPublicationReference(attempted) },
  ] } }, loaded.version);
  const bodies: string[] = [];

  assert.deepEqual(await recoverReviewPublications(slug, {
    ...postingOptions(store, []),
    postCommentFn: (_branch, _token, body) => {
      bodies.push(body);
      return { ok: true as const, data: null, status: 201, statusCode: 201, stderr: null, error: null };
    },
  }), { ok: true, pending: 1 });
  assert.equal(parseReviewPublicationBody(bodies[0]!)?.attempt, 'native-run-recovery');
  assert.equal(parseReviewPublication(store.mission().review!.reviewEvents[0]!.followUpReference)?.attempt, 'native-run-recovery');
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
