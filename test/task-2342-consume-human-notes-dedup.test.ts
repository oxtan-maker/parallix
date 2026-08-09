// @ts-nocheck -- TASK-2328: partial test doubles from ESM seam migration; resolve in follow-up
import test from 'node:test';
import assert from 'node:assert/strict';

import { consumeHumanNotes } from '../src/adapters/review/review-events.js';

function makeComment(user, created, body) {
  return { user, created, body };
}

test('consumeHumanNotes dedup by comment body on re-invocation', async () => {
  let eventsCreated = 0;
  let storedMetadata: Record<string, unknown> = {};

  const comments = [
    makeComment('alice', '2026-01-01T00:00:00Z', 'Please fix the typo in line 42'),
    makeComment('bob', '2026-01-01T01:00:00Z', 'LGTM overall'),
    makeComment('alice', '2026-01-01T02:00:00Z', 'Also check the edge case'),
  ];

  const getCommentsFn = async () => comments;
  const createEventFn = async () => {
    eventsCreated += 1;
    return { ok: true, path: `/tmp/event-${eventsCreated}.md` };
  };
  const readReviewStateFn = async () => ({
    round: 1,
    phase: 'reviewing',
    metadata: storedMetadata,
  });
  const writeReviewStateFn = async (_slug, state) => {
    storedMetadata = state.metadata;
    return { outcome: 'committed' };
  };
  const readTokenFn = () => 'test-token';

  // First invocation: all 3 comments processed
  const result1 = await consumeHumanNotes('task-2342', 'alice', {
    getCommentsFn,
    createEventFn,
    readReviewStateFn,
    writeReviewStateFn,
    readTokenFn,
    reviewIdentity: 'alice',
  });

  assert.equal(result1.created.length, 3, 'first call should create 3 events');
  assert.equal(result1.skipped.length, 0, 'first call should skip 0');
  assert.equal(eventsCreated, 3, 'createEventFn called 3 times');

  // Verify processedCommentBodies persisted to metadata
  assert.ok(Array.isArray(storedMetadata.processedCommentBodies), 'processedCommentBodies should be array');
  assert.equal((storedMetadata.processedCommentBodies as string[]).length, 3, '3 bodies tracked');

  // Second invocation: same comments, all skipped as already-processed (via metadata)
  const result2 = await consumeHumanNotes('task-2342', 'alice', {
    getCommentsFn,
    createEventFn,
    readReviewStateFn,
    writeReviewStateFn,
    readTokenFn,
    reviewIdentity: 'alice',
  });

  assert.equal(result2.created.length, 0, 'second call should create 0 events (dedup by body)');
  assert.equal(result2.skipped.length, 3, 'second call should skip 3 (already-processed)');
  assert.equal(eventsCreated, 3, 'createEventFn still called only 3 times total');
});

test('consumeHumanNotes dedup survives across invocations via metadata', async () => {
  let eventsCreated = 0;
  let storedMetadata: Record<string, unknown> = {};

  const comments = [
    makeComment('alice', '2026-01-01T00:00:00Z', 'Fix this'),
  ];

  const getCommentsFn = async () => comments;
  const createEventFn = async () => {
    eventsCreated += 1;
    return { ok: true, path: `/tmp/event-${eventsCreated}.md` };
  };
  const readReviewStateFn = async () => ({
    round: 1,
    phase: 'reviewing',
    metadata: storedMetadata,
  });
  const writeReviewStateFn = async (_slug, state) => {
    storedMetadata = state.metadata;
    return { outcome: 'committed' };
  };
  const readTokenFn = () => 'test-token';

  // First call: comment processed
  await consumeHumanNotes('task-2342', 'alice', {
    getCommentsFn,
    createEventFn,
    readReviewStateFn,
    writeReviewStateFn,
    readTokenFn,
    reviewIdentity: 'alice',
  });
  assert.equal(eventsCreated, 1, 'first call creates 1 event');

  // Second call: same comment body, dedup via persisted metadata
  await consumeHumanNotes('task-2342', 'alice', {
    getCommentsFn,
    createEventFn,
    readReviewStateFn,
    writeReviewStateFn,
    readTokenFn,
    reviewIdentity: 'alice',
  });
  assert.equal(eventsCreated, 1, 'second call deduped by metadata (no new event)');
});

test('consumeHumanNotes skips workflow-generated comments and dedup by body', async () => {
  const comments = [
    makeComment('alice', '2026-01-01T00:00:00Z', 'Human note\n\n---\n`[workflow-round:1, workflow-phase:reviewing]`'),
    makeComment('bob', '2026-01-01T01:00:00Z', 'Real human comment'),
  ];

  const getCommentsFn = async () => comments;
  let eventsCreated = 0;
  const createEventFn = async () => {
    eventsCreated += 1;
    return { ok: true, path: `/tmp/event-${eventsCreated}.md` };
  };
  const readReviewStateFn = async () => ({ round: 1, phase: 'reviewing', metadata: {} });
  const writeReviewStateFn = async () => ({ outcome: 'committed' });
  const readTokenFn = () => 'test-token';

  const result = await consumeHumanNotes('task-2342', 'alice', {
    getCommentsFn,
    createEventFn,
    readReviewStateFn,
    writeReviewStateFn,
    readTokenFn,
    reviewIdentity: 'alice',
  });

  assert.equal(result.created.length, 1, 'only real human comment creates event');
  assert.equal(result.skipped.length, 1, 'workflow comment skipped');
  assert.equal(eventsCreated, 1, 'createEventFn called once');
});

test('consumeHumanNotes merges dedup into currentState in-place', async () => {
  let eventsCreated = 0;
  const comments = [
    makeComment('alice', '2026-01-01T00:00:00Z', 'First comment'),
  ];

  const getCommentsFn = async () => comments;
  const createEventFn = async () => {
    eventsCreated += 1;
    return { ok: true, path: `/tmp/event-${eventsCreated}.md` };
  };
  const readTokenFn = () => 'test-token';

  // Pass currentState — dedup metadata merged in-place (N1 fix)
  // No writeReviewStateFn needed — caller owns the persist.
  const state: { round: number; phase: string; metadata: Record<string, unknown> } = { round: 1, phase: 'reviewing', metadata: {} };
  const result = await consumeHumanNotes('task-2342', 'alice', {
    getCommentsFn,
    createEventFn,
    readTokenFn,
    reviewIdentity: 'alice',
    currentState: state,
  });

  assert.equal(result.created.length, 1, 'event created');
  assert.ok(Array.isArray(state.metadata.processedCommentBodies), 'metadata merged in-place');
  assert.equal((state.metadata.processedCommentBodies as string[]).length, 1, 'one dedup key stored');
});

test('consumeHumanNotes dedup key includes author (N4)', async () => {
  let eventsCreated = 0;

  // Two different authors post identical text
  const comments = [
    makeComment('alice', '2026-01-01T00:00:00Z', 'LGTM'),
    makeComment('bob', '2026-01-01T01:00:00Z', 'LGTM'),
  ];

  const getCommentsFn = async () => comments;
  const createEventFn = async () => {
    eventsCreated += 1;
    return { ok: true, path: `/tmp/event-${eventsCreated}.md` };
  };
  const readReviewStateFn = async () => ({ round: 1, phase: 'reviewing', metadata: {} });
  const writeReviewStateFn = async () => ({ outcome: 'committed' });
  const readTokenFn = () => 'test-token';

  const result = await consumeHumanNotes('task-2342', 'alice', {
    getCommentsFn,
    createEventFn,
    readReviewStateFn,
    writeReviewStateFn,
    readTokenFn,
    reviewIdentity: 'alice',
  });

  assert.equal(result.created.length, 2, 'both authors create events (different dedup keys)');
  assert.equal(result.skipped.length, 0, 'no collisions');
  assert.equal(eventsCreated, 2, 'createEventFn called twice');
});

test('consumeHumanNotes retains all dedup keys (no cap)', async () => {
  let eventsCreated = 0;

  // 250 unique comments — all tracked, no cap
  const comments = Array.from({ length: 250 }, (_, i) =>
    makeComment(`user-${i}`, `2026-01-01T00:00:00Z`, `Comment body ${i}`)
  );

  const getCommentsFn = async () => comments;
  const createEventFn = async () => {
    eventsCreated += 1;
    return { ok: true, path: `/tmp/event-${eventsCreated}.md` };
  };
  const readTokenFn = () => 'test-token';

  const state: { round: number; phase: string; metadata: Record<string, unknown> } = { round: 1, phase: 'reviewing', metadata: {} };
  const result = await consumeHumanNotes('task-2342', 'alice', {
    getCommentsFn,
    createEventFn,
    readTokenFn,
    reviewIdentity: 'alice',
    currentState: state,
  });

  assert.equal(result.created.length, 250, 'all 250 comments create events');
  assert.equal((state.metadata.processedCommentBodies as string[]).length, 250, 'all 250 tracked (no cap)');
});

test('consumeHumanNotes dedup works for 201+ comments (two invocations)', async () => {
  let eventsCreated = 0;
  let persistedState = null;

  // 205 unique comments
  const comments = Array.from({ length: 205 }, (_, i) =>
    makeComment(`user-${i}`, `2026-01-01T00:00:00Z`, `Comment body ${i}`)
  );

  const getCommentsFn = async () => comments;
  const createEventFn = async () => {
    eventsCreated += 1;
    return { ok: true, path: `/tmp/event-${eventsCreated}.md` };
  };
  const readReviewStateFn = async () => persistedState;
  const writeReviewStateFn = async (_slug, state) => {
    persistedState = state;
    return { outcome: 'committed' };
  };
  const readTokenFn = () => 'test-token';

  // First invocation: all 205 created
  const result1 = await consumeHumanNotes('task-2342', 'alice', {
    getCommentsFn,
    createEventFn,
    readReviewStateFn,
    writeReviewStateFn,
    readTokenFn,
    reviewIdentity: 'alice',
  });
  assert.equal(result1.created.length, 205, 'first call creates 205 events');

  // Second invocation: zero duplicates
  const result2 = await consumeHumanNotes('task-2342', 'alice', {
    getCommentsFn,
    createEventFn,
    readReviewStateFn,
    writeReviewStateFn,
    readTokenFn,
    reviewIdentity: 'alice',
  });
  assert.equal(result2.created.length, 0, 'second call creates 0 events (no duplicates)');
  assert.equal(eventsCreated, 205, 'total events still 205');
});

test('consumeHumanNotes dedup durable from first invocation (no prior state)', async () => {
  let eventsCreated = 0;
  let persistedState = null;

  const comments = [
    makeComment('alice', '2026-01-01T00:00:00Z', 'First comment'),
  ];

  const getCommentsFn = async () => comments;
  const createEventFn = async () => {
    eventsCreated += 1;
    return { ok: true, path: `/tmp/event-${eventsCreated}.md` };
  };
  const readReviewStateFn = async () => persistedState;
  const writeReviewStateFn = async (_slug, state) => {
    persistedState = state;
    return { outcome: 'committed' };
  };
  const readTokenFn = () => 'test-token';

  // First call: no prior state — creates events and persists dedup keys
  const result1 = await consumeHumanNotes('task-2342', 'alice', {
    getCommentsFn,
    createEventFn,
    readReviewStateFn,
    writeReviewStateFn,
    readTokenFn,
    reviewIdentity: 'alice',
  });

  assert.equal(result1.created.length, 1, 'first call creates 1 event');
  assert.equal(eventsCreated, 1, 'createEventFn called once');
  assert.ok(persistedState, 'state persisted on first call');
  assert.ok(Array.isArray(persistedState.metadata.processedCommentBodies), 'dedup keys persisted');

  // Second call: same comment, dedup via persisted metadata
  const result2 = await consumeHumanNotes('task-2342', 'alice', {
    getCommentsFn,
    createEventFn,
    readReviewStateFn,
    writeReviewStateFn,
    readTokenFn,
    reviewIdentity: 'alice',
  });

  assert.equal(result2.created.length, 0, 'second call creates 0 events (dedup from first run)');
  assert.equal(eventsCreated, 1, 'createEventFn still called only once total');
});
