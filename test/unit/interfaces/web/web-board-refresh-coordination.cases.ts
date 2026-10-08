/**
 * Refresh-coordination contract for the browser shell (TASK-2655): every
 * snapshot read — initial load, SSE invalidate/progress, connection open and
 * reconnect, and the Board's awaited onRefresh — converges on the newest
 * authoritative snapshot, superseded or obsolete responses never roll the
 * board back, connection loss is shown honestly, and transient live progress
 * survives snapshot replacement.
 *
 * The real Shell renders into happy-dom; the network is a scripted fetch
 * double whose reads stay pending until the case settles them, the SSE
 * boundary is an EventSource double, and the coalescing window runs on fake
 * timers.
 */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { Window, HTMLButtonElement as DomButton } from 'happy-dom';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import React from 'react';
import { Shell } from '../../../../web/src/shell.js';
import { COMMANDS_PATH } from '../../../../web/src/board-data.js';
import { createRefreshCoordinator } from '../../../../web/src/refresh-coordinator.js';
import { EMPTY_LIVE_PROGRESS, OPERATION_LOG_LIMIT, observeStreamId, recordProgress, withLiveProgress } from '../../../../web/src/operation-log.js';
import { toWebBoardSnapshot, toWebProgressEvent, WEB_TRANSPORT_VERSION } from '../../../../src/interfaces/web/transport.js';
import { makeCard, makeProjection } from '../../../fixtures/board-projection.js';
import { missionId } from '../../../../src/domain/mission.js';

/** The window after which a burst of stream events becomes one read. */
const COALESCE_MS = 150;

type Listener = (event: { readonly data?: string; readonly lastEventId?: string }) => void;

/** The SSE boundary: records every connection and lets a case emit native events. */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  readonly url: string;
  readyState = FakeEventSource.CONNECTING;
  readonly listeners = new Map<string, Set<Listener>>();
  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  addEventListener(name: string, listener: Listener) {
    const set = this.listeners.get(name) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(name, set);
  }
  removeEventListener(name: string, listener: Listener) {
    this.listeners.get(name)?.delete(listener);
  }
  close() { this.readyState = FakeEventSource.CLOSED; }
  listenerCount() {
    return [...this.listeners.values()].reduce((total, set) => total + set.size, 0);
  }
  emit(name: string, event: { readonly data?: string; readonly lastEventId?: string } = {}) {
    if (name === 'open') { this.readyState = FakeEventSource.OPEN; }
    for (const listener of [...(this.listeners.get(name) ?? [])]) { listener(event); }
  }
}

interface PendingRead {
  /** Server truth at the moment the host received the request. */
  readonly truth: string;
  settled: boolean;
  respond(response: Response): void;
}

/** `id` names one mission, or several separated by commas, each an active card. */
const boardOf = (id: string, operationLog: readonly { readonly operationId: string; readonly message: string; readonly sequence?: number }[] = []) => {
  const handoff = { command: 'handoff', enabled: true, reason: null, targetLane: 'review' } as const;
  const snapshot = toWebBoardSnapshot(makeProjection({ active: id.split(',').map(card => makeCard({ id: missionId(card), status: 'active', lane: 'active', commands: [handoff] })) }));
  return {
    ...snapshot,
    operationLog: operationLog.map(entry => ({ phase: 'run', timestamp: '2026-10-06T10:00:00.000Z', ...entry })),
  };
};

const ok = (payload: unknown) => new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });

const progressData = (operationId: string, sequence: number, message: string) => JSON.stringify(toWebProgressEvent({
  operationId, sequence, phase: 'run', message, timestamp: '2026-10-06T10:00:01.000Z',
} as Parameters<typeof toWebProgressEvent>[0]));

const invalidateData = JSON.stringify({ kind: 'projection-invalidated', transportVersion: WEB_TRANSPORT_VERSION });

async function flush() {
  await act(async () => { for (let turn = 0; turn < 5; turn += 1) { await Promise.resolve(); } });
}

/** Mount the real Shell with the fetch and EventSource doubles installed. */
async function mountShell(t: TestContext) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const window = new Window();
  const previous = {
    window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch,
    EventSource: globalThis.EventSource, IS_REACT_ACT_ENVIRONMENT: globalThis.IS_REACT_ACT_ENVIRONMENT,
  };
  FakeEventSource.instances = [];
  const reads: PendingRead[] = [];
  const server = { truth: 'task-a' };
  Object.assign(globalThis, { window, document: window.document, EventSource: FakeEventSource });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const commandResult = { kind: 'command-result', transportVersion: WEB_TRANSPORT_VERSION, status: 'completed', value: null, error: null, durableEvidence: [] };
  globalThis.fetch = ((url: RequestInfo | URL) => String(url) === COMMANDS_PATH ? Promise.resolve(ok(commandResult)) : new Promise<Response>((resolve) => {
    const read: PendingRead = { truth: server.truth, settled: false, respond(response) { read.settled = true; resolve(response); } };
    reads.push(read);
  })) as typeof fetch;
  const mount = window.document.createElement('div');
  window.document.body.append(mount);
  let root: Root | null = createRoot(mount);
  await act(async () => { root!.render(React.createElement(Shell)); });
  const page = {
    window, mount, server,
    /** Snapshot reads only; command requests answer immediately and are not listed. */
    reads,
    text: () => mount.textContent ?? '',
    pending: () => reads.filter(read => !read.settled),
    source: () => FakeEventSource.instances.at(-1)!,
    async settle(read: PendingRead, response: Response = ok(boardOf(read.truth))) {
      read.respond(response);
      await flush();
    },
    /** Answer every outstanding read, oldest first, with the truth it was asked for. */
    async drain() {
      for (let guard = 0; guard < 20 && page.pending().length > 0; guard += 1) { await page.settle(page.pending()[0]); }
    },
    async emit(name: string, event: { readonly data?: string; readonly lastEventId?: string } = {}) {
      await act(async () => { page.source().emit(name, event); });
      await flush();
    },
    async tick(ms = COALESCE_MS) {
      await act(async () => { t.mock.timers.tick(ms); });
      await flush();
    },
    async unmount() {
      if (root === null) { return; }
      const current = root;
      root = null;
      await act(async () => { current.unmount(); });
    },
    async close() {
      await page.unmount();
      Object.assign(globalThis, previous);
      await window.happyDOM.close();
    },
  };
  return page;
}

/** Mount, accept the first snapshot, and establish the subscription. */
async function mountLive(t: TestContext) {
  const page = await mountShell(t);
  await page.drain();
  assert.ok(FakeEventSource.instances.length > 0, 'the shell subscribes to the board event stream');
  await page.emit('open');
  await page.drain();
  return page;
}

test('an invalidate event with no progress revalidates the snapshot and renders the changed mission state (TASK-2655)', async (t) => {
  const page = await mountLive(t);
  try {
    assert.match(page.text(), /task-a/);
    page.server.truth = 'task-b';
    await page.emit('invalidate', { data: invalidateData, lastEventId: '7' });
    await page.tick();
    assert.equal(page.pending().length, 1, 'the invalidation starts one snapshot read');
    await page.drain();
    assert.match(page.text(), /task-b/);
    assert.doesNotMatch(page.text(), /task-a/);
  } finally {
    await page.close();
  }
});

test('a superseded snapshot response settling last never rolls back newer accepted state (TASK-2655)', async (t) => {
  const page = await mountLive(t);
  try {
    page.server.truth = 'task-b';
    await page.emit('progress', { data: progressData('op-1', 1, 'first'), lastEventId: '1' });
    await page.tick();
    page.server.truth = 'task-c';
    await page.emit('progress', { data: progressData('op-1', 2, 'second'), lastEventId: '2' });
    await page.tick();
    // Adversarial order: answer the newest outstanding read first.
    const shown: string[] = [];
    while (page.pending().length > 0) {
      await page.settle(page.pending().at(-1)!);
      shown.push(page.text().includes('task-c') ? 'c' : page.text().includes('task-b') ? 'b' : 'other');
    }
    assert.match(page.text(), /task-c/, 'the newest truth is displayed');
    assert.equal(shown.indexOf('b', shown.indexOf('c') === -1 ? shown.length : shown.indexOf('c')), -1, `older state never follows newer: ${shown.join(',')}`);
  } finally {
    await page.close();
  }
});

test('an obsolete error response settling last never replaces a newer successful snapshot (TASK-2655)', async (t) => {
  const page = await mountLive(t);
  try {
    await page.emit('progress', { data: progressData('op-1', 1, 'first'), lastEventId: '1' });
    await page.tick();
    const failing = page.pending()[0];
    page.server.truth = 'task-c';
    await page.emit('invalidate', { data: invalidateData, lastEventId: '2' });
    await page.tick();
    const newer = page.pending().filter(read => read !== failing);
    for (const read of newer) { await page.settle(read); }
    await page.settle(failing, new Response('{}', { status: 503, statusText: 'Service Unavailable' }));
    await page.drain();
    assert.match(page.text(), /task-c/);
    assert.doesNotMatch(page.text(), /SNAPSHOT REQUEST FAILED/);
  } finally {
    await page.close();
  }
});

test('a live progress entry survives a snapshot replacement that lacks it (TASK-2655)', async (t) => {
  const page = await mountLive(t);
  try {
    await page.emit('progress', { data: progressData('op-live', 1, 'live step in flight'), lastEventId: '3' });
    assert.match(page.text(), /live step in flight/);
    await page.tick();
    await page.drain();
    assert.match(page.text(), /task-a/, 'the replacement snapshot committed');
    assert.match(page.text(), /live step in flight/, 'the transient entry is still presented');
  } finally {
    await page.close();
  }
});

test('concurrent invalidations and progress show the newest snapshot within 200 ms and keep live progress (TASK-2681)', async (t) => {
  const page = await mountLive(t);
  try {
    let elapsed = 0;
    const advance = async (ms: number) => { elapsed += ms; await page.tick(ms); };
    page.server.truth = 'task-b';
    await page.emit('progress', { data: progressData('op-live', 1, 'live step in flight'), lastEventId: '1' });
    // The first signal starts its read without waiting out the coalescing window.
    assert.equal(page.pending().length, 1, 'the read starts at the signal, not after the window');
    await advance(50);
    page.server.truth = 'task-c';
    await page.emit('invalidate', { data: invalidateData, lastEventId: '2' });
    await page.emit('invalidate', { data: invalidateData, lastEventId: '3' });
    await page.settle(page.pending()[0]);
    assert.match(page.text(), /task-b/, 'the first read is displayed as soon as it settles');
    await advance(COALESCE_MS - 50);
    await page.drain();
    assert.match(page.text(), /task-c/, 'the newest authoritative snapshot is displayed');
    assert.match(page.text(), /live step in flight/, 'live progress survives the replacement');
    assert.ok(elapsed <= 200, `the newest snapshot is displayed within the 200 ms contract: ${elapsed} ms`);
  } finally {
    await page.close();
  }
});

// ---------------------------------------------------------------------------
// One coordinator: queued reads, coalescing, awaited callers
// ---------------------------------------------------------------------------

test('an invalidate arriving during an active read causes one later authoritative read, never an overlapping one (TASK-2655)', async (t) => {
  const page = await mountLive(t);
  try {
    await page.emit('invalidate', { data: invalidateData, lastEventId: '1' });
    await page.tick();
    assert.equal(page.pending().length, 1);
    page.server.truth = 'task-b';
    await page.emit('invalidate', { data: invalidateData, lastEventId: '2' });
    await page.tick();
    assert.equal(page.pending().length, 1, 'the second read waits for the active one');
    await page.settle(page.pending()[0]);
    assert.equal(page.pending().length, 1, 'the queued read starts after the active one settles');
    assert.equal(page.pending()[0].truth, 'task-b', 'and reads the newer projection');
    await page.drain();
    assert.match(page.text(), /task-b/);
  } finally {
    await page.close();
  }
});

test('a burst of invalidate and progress events coalesces into a bounded number of reads without starving refresh (TASK-2655)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let loads = 0;
  const coordinator = createRefreshCoordinator<number>({
    load: async () => ++loads,
    apply: () => true,
    coalesceMs: COALESCE_MS,
  });
  // 24 frames, 25 ms apart (600 ms): a debounce that restarts on every frame
  // would never fire. This is a coordinator contract, so it need not spend the
  // unit-test CPU budget rendering the complete browser shell for each frame.
  const FRAMES = 24;
  for (let frame = 0; frame < FRAMES; frame += 1) {
    coordinator.schedule();
    t.mock.timers.tick(25);
    await Promise.resolve();
    if (frame === 8) { assert.ok(loads > 0, 'a read starts during the burst, not only after it'); }
  }
  t.mock.timers.tick(COALESCE_MS);
  await Promise.resolve();
  const maximumReads = Math.ceil((FRAMES * 25) / COALESCE_MS) + 2;
  assert.ok(loads >= 1 && loads <= maximumReads, `reads stay bounded by the window: ${loads}`);
  coordinator.dispose();
});

test('an awaited Board onRefresh settles only after its own revalidation commits, not with an earlier active read (TASK-2655)', async (t) => {
  const page = await mountLive(t);
  try {
    await page.emit('invalidate', { data: invalidateData, lastEventId: '1' });
    await page.tick();
    const active = page.pending()[0];
    // The dispatching card stays on the board: Board prunes the outcome of a
    // mission whose card leaves the snapshot (TASK-2657).
    page.server.truth = 'task-a,task-b';
    const button = page.mount.querySelector<DomButton>('button[aria-label*=" — enabled"]')!;
    await act(async () => { button.click(); });
    await flush();
    await page.settle(active);
    assert.doesNotMatch(page.text(), / started\./, 'the earlier read does not settle the command refresh');
    assert.equal(page.pending().length, 1, 'the command refresh is queued behind the active read');
    await page.drain();
    assert.match(page.text(), /task-b/);
    assert.match(page.text(), / started\./, 'the caller settles once its own read committed');
  } finally {
    await page.close();
  }
});

test('coalesced coordinator callers all settle once a read started after their request is applied (TASK-2655)', async () => {
  const loads: ((value: string) => void)[] = [];
  const applied: string[] = [];
  const sync = createRefreshCoordinator<string>({
    load: () => new Promise<string>((resolve) => { loads.push(resolve); }),
    apply: (result) => { applied.push(result); return true; },
    coalesceMs: COALESCE_MS,
  });
  const settled: string[] = [];
  void sync.request().then(() => settled.push('first'));
  await Promise.resolve();
  void sync.request().then(() => settled.push('second'));
  void sync.request().then(() => settled.push('third'));
  loads[0]('one');
  await new Promise<void>((resolve) => { setImmediate(resolve); });
  assert.deepEqual(settled, ['first'], 'callers queued during a read wait for the next one');
  assert.equal(loads.length, 2, 'the two queued callers share one read');
  loads[1]('two');
  await new Promise<void>((resolve) => { setImmediate(resolve); });
  assert.deepEqual(settled, ['first', 'second', 'third']);
  assert.deepEqual(applied, ['one', 'two']);
  void sync.request().then(() => settled.push('disposed'));
  sync.dispose();
  await new Promise<void>((resolve) => { setImmediate(resolve); });
  loads[2]('late');
  await new Promise<void>((resolve) => { setImmediate(resolve); });
  assert.ok(settled.includes('disposed'), 'disposal releases pending callers');
  assert.deepEqual(applied, ['one', 'two'], 'nothing is applied after disposal');
});

test('a declined obsolete result keeps its callers waiting for the queued read (TASK-2655)', async () => {
  const loads: ((value: string) => void)[] = [];
  const sync = createRefreshCoordinator<string>({
    load: () => new Promise<string>((resolve) => { loads.push(resolve); }),
    apply: (result, superseded) => !(result === 'error' && superseded),
    coalesceMs: COALESCE_MS,
  });
  const settled: string[] = [];
  void sync.request().then(() => settled.push('early'));
  await Promise.resolve();
  void sync.request().then(() => settled.push('late'));
  loads[0]('error');
  await new Promise<void>((resolve) => { setImmediate(resolve); });
  assert.deepEqual(settled, [], 'an obsolete error settles nobody');
  loads[1]('ready');
  await new Promise<void>((resolve) => { setImmediate(resolve); });
  assert.deepEqual(settled, ['early', 'late']);
  sync.dispose();
});

// ---------------------------------------------------------------------------
// Connection lifecycle and honest freshness
// ---------------------------------------------------------------------------

test('a projection change between the first read and the subscription is displayed without another event (TASK-2655)', async (t) => {
  const page = await mountShell(t);
  try {
    assert.equal(page.pending().length, 1, 'the initial read is in flight');
    page.server.truth = 'task-b';
    await page.emit('open');
    await page.drain();
    assert.match(page.text(), /task-b/, 'connection open refetched the newer truth');
  } finally {
    await page.close();
  }
});

test('a disconnect marks the shown board stale and a reconnect claims revalidation only after its refetch commits (TASK-2655)', async (t) => {
  const page = await mountLive(t);
  try {
    assert.equal(page.mount.querySelector('[data-board-freshness]'), null, 'a live, validated board carries no stale notice');
    await page.emit('error');
    assert.match(page.text(), /CONNECTION LOST · RECONNECTING/);
    assert.match(page.text(), /last validated snapshot/);
    assert.match(page.text(), /task-a/, 'the last validated board stays visible, marked stale');
    page.server.truth = 'task-b';
    await page.emit('open');
    assert.equal(page.pending().length, 1, 'reconnect alone triggers a revalidation read');
    assert.match(page.text(), /RECONNECTED · REVALIDATING/, 'no revalidation is claimed before the read commits');
    await page.drain();
    assert.match(page.text(), /task-b/);
    assert.equal(page.mount.querySelector('[data-board-freshness]'), null, 'the notice clears once the refetch committed');
  } finally {
    await page.close();
  }
});

test('a connection the browser stops retrying is reported as stopped, and the shell opens no reconnect loop of its own (TASK-2655)', async (t) => {
  const page = await mountLive(t);
  try {
    page.source().readyState = 2;
    await page.emit('error');
    assert.match(page.text(), /LIVE UPDATES STOPPED/);
    await page.tick(60_000);
    assert.equal(FakeEventSource.instances.length, 1, 'no second EventSource is created');
    assert.equal(page.pending().length, 0, 'no polling read starts');
  } finally {
    await page.close();
  }
});

test('a failed refresh keeps the last validated board marked stale until a later read succeeds (TASK-2655)', async (t) => {
  const page = await mountLive(t);
  try {
    await page.emit('invalidate', { data: invalidateData, lastEventId: '1' });
    await page.tick();
    await page.settle(page.pending()[0], new Response('{}', { status: 503, statusText: 'Service Unavailable' }));
    assert.match(page.text(), /SNAPSHOT REFRESH FAILED/);
    assert.match(page.text(), /HTTP 503/);
    assert.match(page.text(), /task-a/);
    page.server.truth = 'task-b';
    await page.emit('invalidate', { data: invalidateData, lastEventId: '2' });
    await page.tick();
    await page.drain();
    assert.match(page.text(), /task-b/);
    assert.equal(page.mount.querySelector('[data-board-freshness]'), null);
  } finally {
    await page.close();
  }
});

test('malformed and incompatible refresh payloads keep their distinct rejection screens and malformed progress is ignored (TASK-2655)', async (t) => {
  const page = await mountLive(t);
  try {
    await page.emit('progress', { data: '{not json', lastEventId: '1' });
    await page.emit('progress', { data: JSON.stringify({ kind: 'progress', transportVersion: WEB_TRANSPORT_VERSION }), lastEventId: '2' });
    await page.tick();
    assert.equal(page.pending().length, 0, 'malformed progress triggers no read');
    assert.doesNotMatch(page.text(), /undefined/);
    await page.emit('invalidate', { data: invalidateData, lastEventId: '3' });
    await page.tick();
    await page.settle(page.pending()[0], ok({ ...boardOf('task-a'), stages: 'six' }));
    assert.match(page.text(), /SNAPSHOT REJECTED/);
    assert.doesNotMatch(page.text(), /task-a/, 'nothing invalid is rendered as board data');
    await page.emit('invalidate', { data: invalidateData, lastEventId: '4' });
    await page.tick();
    await page.settle(page.pending()[0], ok({ ...boardOf('task-a'), transportVersion: WEB_TRANSPORT_VERSION + 1 }));
    assert.match(page.text(), /INCOMPATIBLE TRANSPORT VERSION/);
    assert.doesNotMatch(page.text(), /SNAPSHOT REJECTED/);
  } finally {
    await page.close();
  }
});

// ---------------------------------------------------------------------------
// Live progress identity, bounds and reset
// ---------------------------------------------------------------------------

const progressEvent = (operationId: string, sequence: number, message: string) => JSON.parse(progressData(operationId, sequence, message)) as Parameters<typeof recordProgress>[1];

test('live progress deduplicates only on operationId and sequence and keeps distinct events with matching text (TASK-2655)', () => {
  let live = recordProgress(EMPTY_LIVE_PROGRESS, progressEvent('op-1', 1, 'same text'));
  live = recordProgress(live, progressEvent('op-1', 2, 'same text'));
  live = recordProgress(live, progressEvent('op-2', 1, 'same text'));
  live = recordProgress(live, progressEvent('op-1', 1, 'replayed'));
  assert.deepEqual(live.entries.map(entry => `${entry.operationId}#${entry.sequence}`), ['op-1#1', 'op-1#2', 'op-2#1']);
  const persisted = boardOf('task-a', [{ operationId: 'op-1', sequence: 2, message: 'same text' }, { operationId: 'op-2', message: 'same text' }]);
  const shown = withLiveProgress(persisted as Parameters<typeof withLiveProgress>[0], live).operationLog;
  assert.deepEqual(
    shown.map(entry => `${entry.operationId}#${entry.sequence ?? '-'}`),
    ['op-1#2', 'op-2#-', 'op-1#1', 'op-2#1'],
    'the snapshot log comes first in server order; a persisted entry without a sequence is never correlated',
  );
});

test('live progress and its identity metadata stay bounded and reset when the host restarts (TASK-2655)', () => {
  let live = observeStreamId(EMPTY_LIVE_PROGRESS, '1');
  for (let sequence = 1; sequence <= OPERATION_LOG_LIMIT * 2; sequence += 1) {
    live = recordProgress(observeStreamId(live, String(sequence + 1)), progressEvent('op-long', sequence, 'tick'));
  }
  assert.equal(live.entries.length, OPERATION_LOG_LIMIT, 'oldest entries are evicted');
  assert.equal(live.entries[0].sequence, OPERATION_LOG_LIMIT + 1);
  const replayed = observeStreamId(live, String(OPERATION_LOG_LIMIT * 2 + 2));
  assert.equal(replayed.entries.length, OPERATION_LOG_LIMIT, 'a reconnect replay with advancing ids keeps live entries');
  const restarted = observeStreamId(replayed, '1');
  assert.deepEqual(restarted.entries, [], 'a regressed stream id means a restarted host: live state resets');
  assert.equal(recordProgress(restarted, progressEvent('op-long', 1, 'new run')).entries.length, 1, 'a reused identity after restart is a new event');
});

test('the shell keeps a live entry beside a persisted entry with matching text and collapses a replayed frame (TASK-2655)', async (t) => {
  const page = await mountLive(t);
  try {
    await page.emit('progress', { data: progressData('op-p', 4, 'same words'), lastEventId: '5' });
    await page.emit('progress', { data: progressData('op-p', 4, 'same words'), lastEventId: '6' });
    await page.tick();
    await page.settle(page.pending()[0], ok(boardOf('task-a', [{ operationId: 'op-p', message: 'same words' }])));
    assert.equal(page.text().split('same words').length - 1, 2, 'the uncorrelated persisted entry and the one live entry both show');
  } finally {
    await page.close();
  }
});

// ---------------------------------------------------------------------------
// Unmount and remount
// ---------------------------------------------------------------------------

test('unmount and remount leak no connection, listener, timer, or state-committing read (TASK-2655)', async (t) => {
  const page = await mountLive(t);
  const errors: unknown[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => { errors.push(args); };
  try {
    const first = page.source();
    await page.emit('invalidate', { data: invalidateData, lastEventId: '1' });
    await page.tick();
    const inFlight = page.pending()[0];
    await page.emit('progress', { data: progressData('op-u', 1, 'after'), lastEventId: '2' });
    await page.unmount();
    assert.equal(first.readyState, FakeEventSource.CLOSED, 'the connection is closed');
    assert.equal(first.listenerCount(), 0, 'every listener is removed');
    await page.tick(60_000);
    await page.settle(inFlight);
    assert.equal(page.pending().length, 0, 'no timer starts a read after unmount');
    assert.deepEqual(errors, [], 'no state is committed after unmount');
    const root = createRoot(page.mount);
    await act(async () => { root.render(React.createElement(Shell)); });
    assert.equal(FakeEventSource.instances.filter(source => source.readyState !== FakeEventSource.CLOSED).length, 1, 'remount holds exactly one subscription');
    await page.drain();
    await act(async () => { root.unmount(); });
    assert.ok(FakeEventSource.instances.every(source => source.readyState === FakeEventSource.CLOSED));
  } finally {
    console.error = originalError;
    await page.close();
  }
});
