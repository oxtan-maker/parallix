// task-2433-web-mutation — real-socket proof of the guarded mutation route
// (TASK-2433, ADR 0055).
//
// Binds the actual Fastify host from src/interfaces/web/host.ts on loopback
// port 0 and drives POST /api/commands with an injected dispatcher spy and
// an injected projection builder. It proves the full negative matrix
// (malformed JSON, unknown field, unknown action kind, action not enabled,
// unavailable capability, mission absent, stale state, bad
// Origin/session/CSRF, effect failure) plus the happy path: exactly one
// dispatch, a host-generated operation ID, the single-kind capability set,
// and one SSE progress event carrying the dispatched operation ID. Network
// access is loopback-only; nothing launches an agent or contacts Forgejo.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadWebAssets } from '../src/adapters/web/asset-store.js';
import {
  createWebHost,
  WEB_COMMANDS_PATH,
  WEB_SNAPSHOT_PATH,
  type WebAssets,
  type WebHost,
  type WebHostInfo,
  type WebHostOptions,
} from '../src/interfaces/web/host.js';
import {
  validateWebCommandResult,
  validateWebProgressEvent,
} from '../src/interfaces/web/transport.js';
import { completed, failure, type ProgressEvent } from '../src/application/contracts.js';
import {
  staleConflict,
  type BoardCommandDispatcher,
  type BoardCommandRequest,
  type BoardCommandResult,
} from '../src/application/controller/board-command.js';
import { makeCard, makeProjection } from './fixtures/board-projection.js';
import type { CommandAvailability, MissionCard } from '../src/application/projections/mission-board.js';
import type { MissionId } from '../src/domain/mission.js';

let assets: WebAssets;
let assetDir: string;

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

test.before(() => {
  assetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'px-web-mutation-'));
  const assetsDir = path.join(assetDir, 'assets');
  fs.mkdirSync(assetsDir, { recursive: true });
  const html = '<!doctype html><html><head><title>shell</title>'
    + '<script type="module" src="/assets/app.js"></script></head>'
    + '<body><div id="root"></div></body></html>';
  const js = 'console.log("web shell");\n';
  fs.writeFileSync(path.join(assetDir, 'index.html'), html);
  fs.writeFileSync(path.join(assetDir, 'assets', 'app.js'), js);
  fs.writeFileSync(path.join(assetDir, 'manifest.json'), JSON.stringify({
    version: 1,
    files: {
      'index.html': { size: html.length, sha256: sha256(html), contentType: 'text/html; charset=utf-8' },
      'assets/app.js': { size: js.length, sha256: sha256(js), contentType: 'text/javascript' },
    },
  }, null, 2));
  assets = loadWebAssets(assetDir);
});

test.after(() => {
  fs.rmSync(assetDir, { recursive: true, force: true });
});

async function withHost(
  options: Omit<WebHostOptions, 'assets'> = {},
  fn: (info: WebHostInfo, host: WebHost) => Promise<void>,
): Promise<void> {
  const host = createWebHost({ assets, ...options });
  const info = await host.start();
  try {
    await fn(info, host);
  } finally {
    await host.close();
  }
}

/** The one card this suite drives: task-2433 in the active lane. */
function commandCard(
  commands: readonly CommandAvailability[] = [{ command: 'handoff', enabled: true, reason: null }],
): MissionCard {
  return makeCard({ id: 'task-2433' as MissionId, commands });
}

/** A spy dispatcher: records every request, emits like the controller would. */
function makeDispatcherSpy(emit?: (event: ProgressEvent) => void) {
  const requests: BoardCommandRequest[] = [];
  let outcome: BoardCommandResult<unknown> = completed({ dispatched: true });
  const dispatcher: BoardCommandDispatcher = {
    canExecute: () => true,
    // The spy returns a fixed outcome for any requested value type; the cast
    // is the test's, the interface's generic is the production contract.
    dispatch: <T = unknown>(request: BoardCommandRequest): Promise<BoardCommandResult<T>> => {
      requests.push(request);
      emit?.({
        operationId: request.operationId,
        sequence: 0,
        phase: 'dispatch',
        message: `dispatching ${request.kind} for ${request.missionId}`,
        timestamp: '2026-08-28T00:00:00.000Z',
      });
      return Promise.resolve(outcome as BoardCommandResult<T>);
    },
  };
  return {
    requests,
    dispatcher,
    setOutcome(next: BoardCommandResult<unknown>): void { outcome = next; },
  };
}

/** Read the per-launch session value the shell issues (cookie = CSRF meta). */
async function launchValue(info: WebHostInfo): Promise<string> {
  const res = await fetch(`${info.origin}/`);
  assert.equal(res.status, 200);
  const cookie = res.headers.get('set-cookie') ?? '';
  const match = cookie.match(/px_session=([^;]+)/);
  assert.ok(match, `expected a px_session cookie in: ${cookie}`);
  return match[1];
}

/** A valid-credential POST to the command route; `mutate` forgeries a header. */
async function postCommand(
  info: WebHostInfo,
  value: string,
  body: unknown,
  mutate?: (headers: Record<string, string>) => void,
): Promise<Response> {
  const headers: Record<string, string> = {
    origin: info.origin,
    cookie: `px_session=${value}`,
    'x-px-csrf': value,
    'content-type': 'application/json',
  };
  mutate?.(headers);
  return fetch(`${info.origin}${WEB_COMMANDS_PATH}`, {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers,
  });
}

interface SseFrame { id: number; event: string; data: Record<string, unknown> }

/** A raw-socket EventSource: reads frames as they arrive, before the response ends. */
function openSse(info: WebHostInfo) {
  const frames: SseFrame[] = [];
  let headerText = '';
  let body = '';
  let headersDone = false;
  const waiters: (() => void)[] = [];
  let signalReady = (): void => {};
  const ready = new Promise<void>(resolve => { signalReady = resolve; });
  const socket = net.connect(info.port, '127.0.0.1', () => {
    socket.write([
      `GET /api/events HTTP/1.1`,
      `Host: 127.0.0.1:${info.port}`,
      'Accept: text/event-stream',
      '',
      '',
    ].join('\r\n'));
  });
  socket.on('data', chunk => {
    body += String(chunk);
    if (!headersDone) {
      const split = body.indexOf('\r\n\r\n');
      if (split < 0) { return; }
      headerText = body.slice(0, split);
      body = body.slice(split + 4);
      headersDone = true;
      signalReady();
    }
    let boundary = body.indexOf('\n\n');
    while (boundary >= 0) {
      const block = body.slice(0, boundary);
      body = body.slice(boundary + 2);
      const fields = new Map(block.split('\n').map(line => {
        const at = line.indexOf(': ');
        return [line.slice(0, at), line.slice(at + 2)] as const;
      }));
      frames.push({
        id: Number(fields.get('id')),
        event: fields.get('event') ?? '',
        data: JSON.parse(fields.get('data') ?? '{}') as Record<string, unknown>,
      });
      boundary = body.indexOf('\n\n');
    }
    while (waiters.length > 0) { waiters.pop()?.(); }
  });
  return {
    frames,
    ready,
    async waitFor(count: number): Promise<void> {
      while (frames.length < count) { await new Promise<void>(resolve => waiters.push(resolve)); }
    },
    async close(): Promise<void> {
      socket.destroy();
      await new Promise(resolve => socket.once('close', resolve));
      for (let i = 0; i < 8; i += 1) { await new Promise(resolve => setImmediate(resolve)); }
    },
  };
}

test('web mutation: an enabled action dispatches exactly once with a host-generated operation ID and a matching SSE progress event', async () => {
  // The spy is created once the host exists so its emit is the host's SSE
  // sink, exactly where the production controller's progressPort lands.
  let spy: ReturnType<typeof makeDispatcherSpy> | null = null;
  await withHost({
    buildProjection: async () => makeProjection({ active: [commandCard()] }),
    commandDispatcher: () => (spy === null ? null : spy.dispatcher),
  }, async (info, host) => {
    spy = makeDispatcherSpy((event) => host.progress(event));
    const value = await launchValue(info);
    const client = openSse(info);
    await client.ready;
    const res = await postCommand(info, value, {
      missionId: 'task-2433',
      kind: 'handoff:record',
      missionStatusAtRequest: 'active',
      payload: { netEngineeringLines: 120, capturedAt: '2026-08-28T00:00:00.000Z' },
    });
    assert.equal(res.status, 200);
    const bodyText = await res.text();
    const validation = validateWebCommandResult(JSON.parse(bodyText));
    assert.ok(validation.ok, `result rejected: ${bodyText}`);
    assert.equal(validation.value.status, 'completed');
    assert.equal(validation.value.error, null);

    assert.equal(spy.requests.length, 1, 'exactly one dispatch');
    const dispatched = spy.requests[0];
    assert.ok(dispatched, 'the dispatch must have been recorded');
    assert.ok(dispatched.operationId.length > 0, 'the host must generate a non-empty operation ID');
    assert.match(dispatched.operationId,
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      'the operation ID must be a fresh UUID');
    assert.notEqual(dispatched.operationId, 'client-supplied-operation-id',
      'a client candidate can never become the operation ID');
    assert.deepEqual([...dispatched.capabilities], ['handoff:record'],
      'the capability set is exactly the requested kind');
    assert.equal(dispatched.missionId, 'task-2433');
    assert.equal(dispatched.missionStatusAtRequest, 'active');
    assert.equal(dispatched.agent, undefined, 'there is no agent wire key');
    assert.deepEqual(dispatched.payload, {
      kind: 'handoff:record',
      netEngineeringLines: 120,
      capturedAt: '2026-08-28T00:00:00.000Z',
    }, 'the payload maps to the domain handoff shape minus expectedVersion');

    // The controller's progress sink is the host's SSE sink: the dispatched
    // operation ID reaches the stream, not a second identity.
    await client.waitFor(1);
    const frame = client.frames[0];
    assert.ok(frame, 'one progress event must arrive on the SSE stream');
    assert.equal(frame.event, 'progress');
    assert.equal(frame.data.operationId, dispatched.operationId,
      'the SSE progress event carries the dispatched operation ID');
    const progressValidation = validateWebProgressEvent(frame.data);
    assert.ok(progressValidation.ok, `progress frame rejected: ${JSON.stringify(progressValidation)}`);
    assert.equal(client.frames.length, 1, 'exactly one progress event for the one dispatch');
    await client.close();
  });
});

test('web mutation: a malformed JSON body is 400 with a command-result body and zero dispatch', async () => {
  const spy = makeDispatcherSpy();
  await withHost({
    buildProjection: async () => makeProjection({ active: [commandCard()] }),
    commandDispatcher: () => spy.dispatcher,
  }, async info => {
    const value = await launchValue(info);
    const res = await postCommand(info, value, 'not-json');
    assert.equal(res.status, 400);
    const bodyText = await res.text();
    const validation = validateWebCommandResult(JSON.parse(bodyText));
    assert.ok(validation.ok, `result rejected: ${bodyText}`);
    assert.equal(validation.value.status, 'rejected');
    assert.equal(validation.value.error?.kind, 'validation');
    assert.equal(spy.requests.length, 0, 'a schema violation must dispatch nothing');
  });
});

test('web mutation: an unknown top-level field is 400 with zero dispatch', async () => {
  const spy = makeDispatcherSpy();
  await withHost({
    buildProjection: async () => makeProjection({ active: [commandCard()] }),
    commandDispatcher: () => spy.dispatcher,
  }, async info => {
    const value = await launchValue(info);
    const res = await postCommand(info, value, {
      missionId: 'task-2433',
      kind: 'active:execute',
      missionStatusAtRequest: 'active',
      operationId: 'client-op',
      capabilities: ['active:execute'],
      agent: 'custom',
    });
    assert.equal(res.status, 400);
    const bodyText = await res.text();
    const validation = validateWebCommandResult(JSON.parse(bodyText));
    assert.ok(validation.ok, `result rejected: ${bodyText}`);
    assert.equal(validation.value.error?.kind, 'validation');
    assert.ok(bodyText.includes('operationId') && bodyText.includes('agent'),
      'the rejection must name the unknown keys');
    assert.equal(spy.requests.length, 0, 'a schema violation must dispatch nothing');
  });
});

test('web mutation: a kind that is not card-advertised is 400 with zero dispatch', async () => {
  const spy = makeDispatcherSpy();
  await withHost({
    buildProjection: async () => makeProjection({ active: [commandCard()] }),
    commandDispatcher: () => spy.dispatcher,
  }, async info => {
    const value = await launchValue(info);
    for (const kind of ['mission:intake', 'checkpoint:record', 'approve:review', 'review:act-on-findings', 'board:nuke']) {
      const res = await postCommand(info, value, {
        missionId: 'task-2433',
        kind,
        missionStatusAtRequest: 'active',
      });
      assert.equal(res.status, 400, `${kind} must be rejected`);
      const validation = validateWebCommandResult(await res.json());
      assert.ok(validation.ok, `${kind}: the rejection must be a command-result body`);
      assert.equal(validation.value.error?.kind, 'validation');
    }
    assert.equal(spy.requests.length, 0, 'an unsupported kind must dispatch nothing');
  });
});

test('web mutation: rejects an action not currently enabled for the mission with 409 and zero dispatch', async () => {
  const spy = makeDispatcherSpy();
  const card = commandCard([{ command: 'handoff', enabled: false, reason: 'mission is not in a handoff lane' }]);
  await withHost({
    buildProjection: async () => makeProjection({ active: [card] }),
    commandDispatcher: () => spy.dispatcher,
  }, async info => {
    const value = await launchValue(info);
    const res = await postCommand(info, value, {
      missionId: 'task-2433',
      kind: 'handoff:record',
      missionStatusAtRequest: 'active',
      payload: { netEngineeringLines: 120, capturedAt: '2026-08-28T00:00:00.000Z' },
    });
    assert.equal(res.status, 409);
    const bodyText = await res.text();
    const validation = validateWebCommandResult(JSON.parse(bodyText));
    assert.ok(validation.ok, `result rejected: ${bodyText}`);
    assert.equal(validation.value.status, 'failed');
    assert.equal(validation.value.error?.kind, 'conflict');
    assert.match(validation.value.error?.message ?? '', /not in a handoff lane/);
    assert.equal(spy.requests.length, 0, 'a non-enabled action must dispatch nothing');
  });
});

test('web mutation: rejects an unavailable capability with 409 even when the domain availability is enabled', async () => {
  const spy = makeDispatcherSpy();
  const card = commandCard([{ command: 'review', enabled: true, reason: null }]);
  await withHost({
    buildProjection: async () => makeProjection({ active: [card] }),
    commandDispatcher: () => spy.dispatcher,
  }, async info => {
    const value = await launchValue(info);
    const res = await postCommand(info, value, {
      missionId: 'task-2433',
      kind: 'review:submit',
      missionStatusAtRequest: 'active',
    });
    assert.equal(res.status, 409, 'unavailable outranks domain eligibility');
    const validation = validateWebCommandResult(await res.json());
    assert.ok(validation.ok, 'the rejection must be a command-result body');
    assert.equal(validation.value.error?.kind, 'conflict');
    assert.equal(spy.requests.length, 0, 'an unavailable capability must dispatch nothing');
  });
});

test('web mutation: rejects a mission absent from the projection with 409 and zero dispatch', async () => {
  const spy = makeDispatcherSpy();
  await withHost({
    buildProjection: async () => makeProjection({ active: [commandCard()] }),
    commandDispatcher: () => spy.dispatcher,
  }, async info => {
    const value = await launchValue(info);
    const res = await postCommand(info, value, {
      missionId: 'task-9999',
      kind: 'active:execute',
      missionStatusAtRequest: 'active',
    });
    assert.equal(res.status, 409);
    const validation = validateWebCommandResult(await res.json());
    assert.ok(validation.ok, 'the rejection must be a command-result body');
    assert.equal(validation.value.error?.kind, 'conflict');
    assert.match(validation.value.error?.message ?? '', /not on the board/);
    assert.equal(spy.requests.length, 0, 'an absent mission must dispatch nothing');
  });
});

test('web mutation: a stale status after the snapshot is a wire conflict with exactly one attempt', async () => {
  const spy = makeDispatcherSpy();
  // The controller's authoritative stale guard (TASK-2425) produced this
  // outcome; the wire must carry it verbatim and never retry.
  spy.setOutcome(staleConflict('active', 'review'));
  await withHost({
    buildProjection: async () => makeProjection({ active: [commandCard()] }),
    commandDispatcher: () => spy.dispatcher,
  }, async info => {
    const value = await launchValue(info);
    const res = await postCommand(info, value, {
      missionId: 'task-2433',
      kind: 'handoff:record',
      missionStatusAtRequest: 'active',
      payload: { netEngineeringLines: 120, capturedAt: '2026-08-28T00:00:00.000Z' },
    });
    assert.equal(res.status, 200, 'a dispatched outcome answers 200; the wire status carries the meaning');
    const validation = validateWebCommandResult(await res.json());
    assert.ok(validation.ok, 'the conflict must be a command-result body');
    assert.equal(validation.value.status, 'failed');
    assert.equal(validation.value.error?.kind, 'conflict');
    assert.match(validation.value.error?.message ?? '', /expected active/);
    assert.match(validation.value.error?.message ?? '', /got review/);
    assert.equal(spy.requests.length, 1, 'no server-side retry, no auto-re-dispatch');
  });
});

test('web mutation: a wrong Origin, session, or CSRF is 403 with a command-result body and zero dispatch', async () => {
  const spy = makeDispatcherSpy();
  await withHost({
    buildProjection: async () => makeProjection({ active: [commandCard()] }),
    commandDispatcher: () => spy.dispatcher,
  }, async info => {
    const value = await launchValue(info);
    const body = {
      missionId: 'task-2433',
      kind: 'active:execute',
      missionStatusAtRequest: 'active',
    };
    const forgeries: { name: string; mutate: (headers: Record<string, string>) => void }[] = [
      { name: 'absent origin', mutate: (h) => { delete h.origin; } },
      { name: 'wrong origin', mutate: (h) => { h.origin = 'http://evil.example'; } },
      { name: 'absent session', mutate: (h) => { delete h.cookie; } },
      { name: 'wrong session', mutate: (h) => { h.cookie = 'px_session=forged-0123456789abcdef'; } },
      { name: 'absent csrf', mutate: (h) => { delete h['x-px-csrf']; } },
      { name: 'wrong csrf', mutate: (h) => { h['x-px-csrf'] = 'forged-0123456789abcdef'; } },
    ];
    for (const { name, mutate } of forgeries) {
      const res = await postCommand(info, value, body, mutate);
      assert.equal(res.status, 403, `${name} must be rejected`);
      const validation = validateWebCommandResult(await res.json());
      assert.ok(validation.ok, `${name}: the rejection must be a command-result body`);
      assert.equal(validation.value.status, 'rejected');
      assert.equal(validation.value.error?.kind, 'capability');
    }
    assert.equal(spy.requests.length, 0, 'a security rejection must dispatch nothing');
  });
});

test('web mutation: an effect failure never sends a stack trace or filesystem path', async () => {
  const spy = makeDispatcherSpy();
  const effectError = new Error('handoff effect failed');
  effectError.stack = 'Error: handoff effect failed\n    at recordNel (/abs/path/fixture.js:12:34)';
  // The controller converts a thrown effect into its message only; the stack
  // and the path live on the Error object, which never crosses the wire.
  spy.setOutcome(failure('execution', effectError.message));
  await withHost({
    buildProjection: async () => makeProjection({ active: [commandCard()] }),
    commandDispatcher: () => spy.dispatcher,
  }, async info => {
    const value = await launchValue(info);
    const res = await postCommand(info, value, {
      missionId: 'task-2433',
      kind: 'handoff:record',
      missionStatusAtRequest: 'active',
      payload: { netEngineeringLines: 120, capturedAt: '2026-08-28T00:00:00.000Z' },
    });
    assert.equal(res.status, 200);
    const bodyText = await res.text();
    const validation = validateWebCommandResult(JSON.parse(bodyText));
    assert.ok(validation.ok, `result rejected: ${bodyText}`);
    assert.equal(validation.value.status, 'failed');
    assert.equal(validation.value.error?.kind, 'execution');
    assert.equal(validation.value.error?.message, 'handoff effect failed');
    assert.doesNotMatch(bodyText, /\/abs\/path\/fixture\.js/, 'the body must not contain the filesystem path');
    assert.doesNotMatch(bodyText, /at recordNel/, 'the body must not contain the stack trace');
    assert.equal(spy.requests.length, 1);
  });
});

test('web mutation: the 405 catch-all and the read routes are unchanged around the new path', async () => {
  await withHost({ buildProjection: async () => makeProjection({ active: [commandCard()] }) }, async info => {
    const value = await launchValue(info);
    const headers = {
      origin: info.origin,
      cookie: `px_session=${value}`,
      'x-px-csrf': value,
      'content-type': 'application/json',
    };
    for (const method of ['PUT', 'DELETE', 'PATCH', 'OPTIONS'] as const) {
      const res = await fetch(`${info.origin}${WEB_COMMANDS_PATH}`, { method, body: '{}', headers });
      assert.equal(res.status, 405, `${method} on the command path must be 405`);
      assert.equal(res.headers.get('allow'), 'GET, HEAD');
    }
    const otherPost = await fetch(`${info.origin}/api/other`, { method: 'POST', body: '{}', headers });
    assert.equal(otherPost.status, 405, 'a POST to any other path must be 405');
    assert.equal(otherPost.headers.get('allow'), 'GET, HEAD');
    const getCommand = await fetch(`${info.origin}${WEB_COMMANDS_PATH}`);
    assert.equal(getCommand.status, 404, 'GET on the command path is not an asset and stays 404');
    const snapshot = await fetch(`${info.origin}${WEB_SNAPSHOT_PATH}`);
    assert.equal(snapshot.status, 200, 'the read-only snapshot route is unchanged');
  });
});

test('web mutation: a read-only host without a dispatcher answers 503 and dispatches nothing', async () => {
  await withHost({ buildProjection: async () => makeProjection({ active: [commandCard()] }) }, async info => {
    const value = await launchValue(info);
    const res = await postCommand(info, value, {
      missionId: 'task-2433',
      kind: 'active:execute',
      missionStatusAtRequest: 'active',
    });
    assert.equal(res.status, 503, 'without a dispatcher the host stays read-only');
    const validation = validateWebCommandResult(await res.json());
    assert.ok(validation.ok, 'the rejection must be a command-result body');
    assert.equal(validation.value.error?.kind, 'unavailable');
  });
});
