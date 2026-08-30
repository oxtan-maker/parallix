// web-stream — hermetic proof of the SSE event stream's boundedness rules.
//
// No sockets, no timers, no sleeps: the id counter, the replay buffer and the
// listener registry from src/interfaces/web/stream.ts are exercised directly,
// so the high-volume case runs without a real agent process. The socket-level
// wiring is proven separately by test/web-host.integration.test.ts.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createWebEventStream,
  formatSseFrame,
  WEB_EVENT_BUFFER_LIMIT,
  type WebStreamFrame,
} from '../src/interfaces/web/stream.js';
import { toWebProgressEvent, validateWebProgressEvent, WEB_TRANSPORT_VERSION } from '../src/interfaces/web/transport.js';

function progress(operationId: string, sequence: number): ReturnType<typeof toWebProgressEvent> {
  return toWebProgressEvent({
    operationId,
    sequence,
    phase: 'implement',
    message: `step ${String(sequence)}`,
    timestamp: '2026-08-28T00:00:00.000Z',
  });
}

test('web stream: one counter issues strictly increasing ids across every event name', () => {
  const stream = createWebEventStream();
  const ids = [
    stream.publishProgress(progress('op-1', 1)).id,
    stream.publishInvalidation().id,
    stream.publishProgress(progress('op-1', 2)).id,
    stream.publishError({ kind: 'unavailable', message: 'database is locked' }).id,
    stream.publishInvalidation().id,
  ];
  assert.deepEqual(ids, [1, 2, 3, 4, 5]);
  const names = stream.buffered().map(frame => frame.name);
  assert.deepEqual(names, ['progress', 'invalidate', 'progress', 'error', 'invalidate']);
});

test('web stream: progress frames carry the command boundary operationId and sequence unchanged', () => {
  const stream = createWebEventStream();
  const frame = stream.publishProgress(progress('op-7', 42));
  const validation = validateWebProgressEvent(frame.payload);
  assert.equal(validation.ok, true, `progress payload rejected: ${JSON.stringify(validation)}`);
  assert.ok(validation.ok);
  assert.equal(validation.value.operationId, 'op-7');
  assert.equal(validation.value.sequence, 42);
  assert.equal(validation.value.transportVersion, WEB_TRANSPORT_VERSION);
});

test('web stream: an invalidation carries no board payload, only a refetch signal', () => {
  const stream = createWebEventStream();
  const frame = stream.publishInvalidation();
  assert.deepEqual(frame.payload, { kind: 'projection-invalidated', transportVersion: WEB_TRANSPORT_VERSION });
  assert.match(formatSseFrame(frame), /^id: 1\nevent: invalidate\ndata: \{.*\}\n\n$/);
});

test('web stream: reconnect with Last-Event-ID replays only newer events', () => {
  const stream = createWebEventStream();
  const seen: WebStreamFrame[] = [];
  const unsubscribe = stream.subscribe(frame => seen.push(frame));
  for (let sequence = 1; sequence <= 4; sequence += 1) { stream.publishProgress(progress('op-1', sequence)); }
  unsubscribe();
  // Disconnected: events keep flowing to the buffer with nobody listening.
  for (let sequence = 5; sequence <= 7; sequence += 1) { stream.publishProgress(progress('op-1', sequence)); }

  const lastSeen = seen[seen.length - 1];
  assert.ok(lastSeen);
  const replayed = stream.replayAfter(String(lastSeen.id));
  assert.deepEqual(replayed.map(frame => frame.id), [5, 6, 7]);

  const key = (frame: WebStreamFrame): string => JSON.stringify([
    (frame.payload as { operationId?: string }).operationId,
    (frame.payload as { sequence?: number }).sequence,
  ]);
  const before = new Set(seen.map(key));
  const duplicates = replayed.filter(frame => before.has(key(frame)));
  assert.deepEqual(duplicates, [], 'a reconnect must not repeat an operationId+sequence pair');
});

test('web stream: an absent or malformed Last-Event-ID replays nothing', () => {
  const stream = createWebEventStream();
  stream.publishProgress(progress('op-1', 1));
  assert.deepEqual(stream.replayAfter(undefined), []);
  assert.deepEqual(stream.replayAfter('not-a-number'), []);
  assert.deepEqual(stream.replayAfter('1.5'), []);
  assert.deepEqual(stream.replayAfter('0').map(frame => frame.id), [1]);
});

test('web stream: the replay buffer stops at the exported bound and evicts oldest first', () => {
  const stream = createWebEventStream();
  const total = WEB_EVENT_BUFFER_LIMIT + 50;
  for (let sequence = 1; sequence <= total; sequence += 1) { stream.publishProgress(progress('op-1', sequence)); }

  assert.equal(stream.bufferedCount(), WEB_EVENT_BUFFER_LIMIT);
  const buffered = stream.buffered();
  assert.equal(buffered[0]?.id, total - WEB_EVENT_BUFFER_LIMIT + 1, 'the oldest 50 must have been evicted');
  assert.equal(buffered[buffered.length - 1]?.id, total);
  assert.deepEqual(stream.replayAfter(String(total)), [], 'a fully caught-up client replays nothing');
});

test('web stream: high-volume progress keeps the buffer and listener count constant', () => {
  const stream = createWebEventStream();
  let delivered = 0;
  const unsubscribe = stream.subscribe(() => { delivered += 1; });
  assert.equal(stream.listenerCount(), 1);

  const total = 1_000;
  for (let sequence = 1; sequence <= total; sequence += 1) {
    stream.publishProgress(progress('op-load', sequence));
    assert.ok(stream.bufferedCount() <= WEB_EVENT_BUFFER_LIMIT, 'the buffer must never exceed its bound');
    assert.equal(stream.listenerCount(), 1, 'publishing must not accumulate listeners');
  }
  assert.equal(delivered, total, 'every event reaches the connected client');
  assert.equal(stream.bufferedCount(), WEB_EVENT_BUFFER_LIMIT);

  unsubscribe();
  assert.equal(stream.listenerCount(), 0);
  stream.publishProgress(progress('op-load', total + 1));
  assert.equal(delivered, total, 'an unsubscribed listener receives nothing');
});

test('web stream: clearListeners drops every subscriber', () => {
  const stream = createWebEventStream();
  stream.subscribe(() => {});
  stream.subscribe(() => {});
  assert.equal(stream.listenerCount(), 2);
  stream.clearListeners();
  assert.equal(stream.listenerCount(), 0);
});

test('web stream: a non-positive buffer bound is refused', () => {
  assert.throws(() => createWebEventStream(0), /positive integer/);
  assert.throws(() => createWebEventStream(-1), /positive integer/);
  assert.throws(() => createWebEventStream(1.5), /positive integer/);
});
