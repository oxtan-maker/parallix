import test from 'node:test';
import assert from 'node:assert/strict';
import { COMMANDS_PATH, loadSnapshot, sendCommand, SNAPSHOT_PATH } from '../web/src/board-data.js';
import { toWebBoardSnapshot, WEB_TRANSPORT_VERSION } from '../src/interfaces/web/transport.js';
import { makeProjection } from './fixtures/board-projection.js';

const validSnapshot = (): unknown => JSON.parse(JSON.stringify(toWebBoardSnapshot(makeProjection())));

interface Call { readonly url: string; readonly method: string | undefined; readonly body: string | null }

/** Swap the global fetch for one scripted response, recording every call. */
async function withFetch<T>(
  impl: (url: string) => Promise<Response> | Response,
  body: (calls: Call[]) => Promise<T>,
): Promise<T> {
  const calls: Call[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), method: init?.method, body: typeof init?.body === 'string' ? init.body : null });
    return impl(String(input));
  }) as typeof fetch;
  try {
    return await body(calls);
  } finally {
    globalThis.fetch = original;
  }
}

const jsonResponse = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });

test('a validated snapshot response becomes the ready state', async () => {
  const state = await withFetch(() => jsonResponse(validSnapshot()), async () => loadSnapshot());
  assert.equal(state.kind, 'ready');
});

test('the client reads the snapshot path exactly once with no mutating method', async () => {
  const calls = await withFetch(
    () => jsonResponse(validSnapshot()),
    async (recorded) => { await loadSnapshot(); return recorded; },
  );
  assert.deepEqual(calls.map((call) => call.url), [SNAPSHOT_PATH]);
  assert.deepEqual(calls.map((call) => call.method), [undefined]);
});

test('a non-ok snapshot response becomes an explicit request-failure state', async () => {
  const state = await withFetch(
    () => new Response('{}', { status: 503, statusText: 'Service Unavailable' }),
    async () => loadSnapshot(),
  );
  assert.equal(state.kind, 'request-failed');
  assert.match(state.kind === 'request-failed' ? state.detail : '', /503/);
});

test('a transport-level network error becomes an explicit request-failure state', async () => {
  const state = await withFetch(
    () => { throw new Error('connection refused'); },
    async () => loadSnapshot(),
  );
  assert.equal(state.kind, 'request-failed');
  assert.match(state.kind === 'request-failed' ? state.detail : '', /connection refused/);
});

test('a response body that is not JSON becomes an explicit malformed state', async () => {
  const state = await withFetch(
    () => new Response('<html>not json</html>', { status: 200 }),
    async () => loadSnapshot(),
  );
  assert.equal(state.kind, 'malformed');
  assert.match(state.kind === 'malformed' ? state.problems.join(' ') : '', /not JSON/);
});

test('a contract-violating payload becomes an explicit malformed state carrying the problems', async () => {
  const broken = { ...(validSnapshot() as Record<string, unknown>), stages: 'six' };
  const state = await withFetch(() => jsonResponse(broken), async () => loadSnapshot());
  assert.equal(state.kind, 'malformed');
  assert.ok((state.kind === 'malformed' ? state.problems : []).some((p) => p.includes('stages')));
});

test('an unsupported transport version becomes an explicit incompatible state, not a malformed one', async () => {
  const future = { ...(validSnapshot() as Record<string, unknown>), transportVersion: WEB_TRANSPORT_VERSION + 1 };
  const state = await withFetch(() => jsonResponse(future), async () => loadSnapshot());
  assert.equal(state.kind, 'incompatible');
  if (state.kind === 'incompatible') {
    assert.equal(state.received, WEB_TRANSPORT_VERSION + 1);
    assert.deepEqual([...state.supported], [WEB_TRANSPORT_VERSION]);
  }
});

test('no settled snapshot state is the loading state', async () => {
  const state = await withFetch(() => jsonResponse(validSnapshot()), async () => loadSnapshot());
  assert.notEqual(state.kind as string, 'loading');
});

test('the command client sends one typed request to the guarded route', async () => {
  const originalDocument = globalThis.document;
  Object.defineProperty(globalThis, 'document', { configurable: true, value: undefined });
  try {
    const calls = await withFetch(
      () => jsonResponse({ kind: 'command-result', transportVersion: 2, status: 'completed', error: null, durableEvidence: [] }),
      async recorded => {
        await sendCommand({ missionId: 'task-2433', kind: 'active:execute', missionStatusAtRequest: 'active' });
        return recorded;
      },
    );
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], {
      url: COMMANDS_PATH,
      method: 'POST',
      body: JSON.stringify({ missionId: 'task-2433', kind: 'active:execute', missionStatusAtRequest: 'active' }),
    });
  } finally {
    Object.defineProperty(globalThis, 'document', { configurable: true, value: originalDocument });
  }
});
