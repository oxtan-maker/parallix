// web-host.integration — real-socket proof of the loopback web host wiring.
//
// Binds the actual Fastify host from src/interfaces/web/host.ts on
// 127.0.0.1 / ::1 port 0 only, and drives it over loopback. It is the
// wiring proof for the policy covered hermetically by
// test/web-security-policy.test.ts: wrong Host, wrong Origin, missing/bad
// session, missing/bad CSRF, wrong method, oversized body, wrong content
// type, and manifest-allowlisted asset serving. Network access is
// loopback-only; nothing contacts the internet.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadWebAssets } from '../src/adapters/web/asset-store.js';
import { createWebHost, PROTECTION_HEADERS, WEB_EVENTS_PATH, WEB_SNAPSHOT_PATH, type WebAssets, type WebHostInfo, type WebHostOptions } from '../src/interfaces/web/host.js';
import { validateWebBoardSnapshot, validateWebProgressEvent, WEB_TRANSPORT_VERSION } from '../src/interfaces/web/transport.js';
import { WEB_EVENT_BUFFER_LIMIT } from '../src/interfaces/web/stream.js';
import type { WebHost } from '../src/interfaces/web/host.js';
import type { BoardProjection } from '../src/application/projections/board.js';
import type { BoardProgressSink } from '../src/application/controller/board-command.js';
import { runWebCommand } from '../src/interfaces/cli/web.js';
import { setLogger } from '../src/application/presentation/cli-format.js';
import { makeCards, makeProjection } from './fixtures/board-projection.js';

let assets: WebAssets;
let assetDir: string;

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

test.before(() => {
  assetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'px-web-host-'));
  const assetsDir = path.join(assetDir, 'assets');
  fs.mkdirSync(assetsDir, { recursive: true });
  const html = '<!doctype html><html><head><title>shell</title>'
    + '<script type="module" src="/assets/app.js"></script></head>'
    + '<body><div id="root"></div></body></html>';
  const js = 'console.log("web shell");\n';
  const secret = 'secret-not-in-manifest';
  fs.writeFileSync(path.join(assetDir, 'index.html'), html);
  fs.writeFileSync(path.join(assetDir, 'assets', 'app.js'), js);
  fs.writeFileSync(path.join(assetDir, 'secret.txt'), secret);
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

/**
 * A manual timer seam for the shared projection subscription: tests advance
 * the rebuild loop explicitly, so nothing here waits on a real clock.
 */
function manualTimers() {
  let pending: (() => void) | null = null;
  let sets = 0;
  let clears = 0;
  return {
    options: {
      intervalMs: 1,
      setTimer: (callback: () => void) => { sets += 1; pending = callback; return sets; },
      clearTimer: () => { clears += 1; pending = null; },
    },
    /** Fire the scheduled rebuild and drain the microtasks it queues. */
    async tick(): Promise<void> {
      const callback = pending;
      pending = null;
      callback?.();
      for (let i = 0; i < 8; i += 1) { await new Promise(resolve => setImmediate(resolve)); }
    },
    get scheduled(): boolean { return pending !== null; },
    get setCount(): number { return sets; },
    get clearCount(): number { return clears; },
  };
}

interface SseFrame { id: number; event: string; data: Record<string, unknown> }

/** A raw-socket EventSource: reads frames as they arrive, before the response ends. */
function openSse(info: WebHostInfo, lastEventId?: string) {
  const frames: SseFrame[] = [];
  let headerText = '';
  let body = '';
  let headersDone = false;
  const waiters: (() => void)[] = [];
  let signalReady = (): void => {};
  // Resolves once the response headers have arrived, which is also the moment
  // the server has registered this client's listener. Without it a test could
  // publish before the subscription exists and wait forever.
  const ready = new Promise<void>(resolve => { signalReady = resolve; });
  const socket = net.connect(info.port, '127.0.0.1', () => {
    const lines = [`GET ${WEB_EVENTS_PATH} HTTP/1.1`, `Host: 127.0.0.1:${info.port}`, 'Accept: text/event-stream'];
    if (lastEventId !== undefined) { lines.push(`Last-Event-ID: ${lastEventId}`); }
    socket.write(`${lines.join('\r\n')}\r\n\r\n`);
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
    /** Resolve once at least `count` frames have arrived. Event-driven, no sleep. */
    async waitFor(count: number): Promise<void> {
      while (frames.length < count) { await new Promise<void>(resolve => waiters.push(resolve)); }
    },
    header(name: string): string | undefined {
      return headerText.split('\r\n')
        .find(line => line.toLowerCase().startsWith(`${name}:`))
        ?.slice(name.length + 1).trim();
    },
    status(): number { return Number(headerText.split(' ')[1] ?? '0'); },
    async close(): Promise<void> {
      socket.destroy();
      await new Promise(resolve => socket.once('close', resolve));
      // Let the server observe the socket close before the test asserts.
      for (let i = 0; i < 8; i += 1) { await new Promise(resolve => setImmediate(resolve)); }
    },
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

/** Raw HTTP/1.1 request, so the Host header can be forged (fetch cannot). */
function rawRequest(info: WebHostInfo, hostHeader: string | null, targetPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(info.port, '127.0.0.1', () => {
      const lines = [`GET ${targetPath} HTTP/1.1`];
      if (hostHeader !== null) { lines.push(`Host: ${hostHeader}`); }
      lines.push('Connection: close');
      socket.write(`${lines.join('\r\n')}\r\n\r\n`);
    });
    let data = '';
    socket.on('data', chunk => { data += chunk; });
    socket.on('end', () => resolve(Number(data.split(' ')[1] ?? '0')));
    socket.on('error', reject);
  });
}

test('web host: binds explicit loopback and reports the actual origin', async () => {
  await withHost({}, async info => {
    assert.equal(info.host, '127.0.0.1');
    assert.match(info.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.notEqual(info.port, 0, 'the OS must have selected the real port');
    const res = await fetch(`${info.origin}/`);
    assert.equal(res.status, 200);
  });
  await withHost({ host: '::1' }, async info => {
    assert.match(info.origin, /^http:\/\/\[::1\]:\d+$/);
    const res = await fetch(`${info.origin}/`);
    assert.equal(res.status, 200);
  });
});

test('web host: rejects non-loopback bind configuration before any listener', async () => {
  for (const host of ['0.0.0.0', '::', 'localhost', '192.168.1.10', '2001:db8::1']) {
    assert.throws(
      () => createWebHost({ assets, host: host as '127.0.0.1' }),
      /refuses to bind/,
      `${host} must be refused`,
    );
  }
  assert.throws(() => createWebHost({ assets, port: 70000 }), /port must be an integer/);
  assert.throws(() => createWebHost({ assets, port: -1 }), /port must be an integer/);
});

test('web host: a failing bind rejects start() and close() stays clean', async () => {
  // Occupy a real loopback port so the host's own bind fails with EADDRINUSE.
  // A listen failure must reject start() (so the web command's
  // catch-close-throw path runs), not escape as an uncaught exception.
  const blocker = net.createServer();
  await new Promise<void>(resolve => blocker.listen(0, '127.0.0.1', resolve));
  const blockerAddr = blocker.address();
  assert.ok(blockerAddr && typeof blockerAddr !== 'string', 'the blocker must report a port');
  try {
    const host = createWebHost({ assets, port: blockerAddr.port });
    await assert.rejects(host.start(), /EADDRINUSE/, 'binding an occupied port must reject start()');
    await host.close(); // the half-started host must still close cleanly
  } finally {
    blocker.close();
  }
});

test('web host: serves the shell on the actual origin with the full protection header set', async () => {
  await withHost({}, async info => {
    const res = await fetch(`${info.origin}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /text\/html/);
    const csp = res.headers.get('content-security-policy') ?? '';
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /script-src 'self'/);
    assert.match(csp, /style-src 'self'/);
    assert.match(csp, /connect-src 'self'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
    assert.doesNotMatch(csp, /https?:\/\//);
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
    assert.match(res.headers.get('cache-control') ?? '', /no-store/);

    const html = await res.text();
    // No inline executable script, no remote reference.
    assert.doesNotMatch(html, /<script(?![^>]*src=)[^>]*>/i);
    assert.doesNotMatch(html, /https?:\/\//);

    const cookie = res.headers.get('set-cookie') ?? '';
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    assert.match(cookie, /Path=\//);
    const value = cookie.match(/px_session=([^;]+)/)?.[1];
    assert.ok(value && value.length >= 32, 'the session value must be unguessable-length');
    const meta = html.match(/<meta name="px-csrf" content="([^"]+)"/);
    assert.ok(meta, 'the shell must carry the CSRF meta tag');
    assert.equal(meta[1], value, 'CSRF meta must equal the session cookie (double-submit)');

    const assetRes = await fetch(`${info.origin}/assets/app.js`);
    assert.equal(assetRes.status, 200);
    assert.equal(assetRes.headers.get('content-type'), 'text/javascript');
    assert.match(assetRes.headers.get('cache-control') ?? '', /immutable/);
    assert.equal(await assetRes.text(), 'console.log("web shell");\n');
  });
});

test('web host: rejects Host header that is not the actual loopback origin', async () => {
  await withHost({}, async info => {
    assert.equal(await rawRequest(info, `127.0.0.1:${info.port}`, '/'), 200, 'the actual origin must pass');
    assert.equal(await rawRequest(info, 'attacker.example', '/'), 403, 'a rebinding name must be rejected');
    assert.equal(await rawRequest(info, `127.0.0.1:${info.port + 1}`, '/'), 403, 'a different port must be rejected');
    assert.equal(await rawRequest(info, `127.0.0.2:${info.port}`, '/'), 403, 'a different address must be rejected');
    assert.equal(await rawRequest(info, `[::1]:${info.port}`, '/'), 403, 'the other loopback literal must not match a v4 bind');
    // A syntactically absent Host is refused by the transport itself (400);
    // a present-but-wrong Host is refused by the host policy (403, unit-
    // covered via evaluateHostHeader(undefined)). Either way it is rejected.
    const absent = await rawRequest(info, null, '/');
    assert.ok(absent === 400 || absent === 403, `an absent Host must be rejected, got ${absent}`);
  });
});

test('web host: rejects a state-changing request with an absent or wrong Origin', async () => {
  await withHost({}, async info => {
    const value = await launchValue(info);
    const base = {
      cookie: `px_session=${value}`,
      'x-px-csrf': value,
      'content-type': 'application/json',
    };
    const absent = await fetch(`${info.origin}/`, { method: 'POST', body: '{}', headers: base });
    assert.equal(absent.status, 403, 'an absent Origin must be rejected');
    const wrong = await fetch(`${info.origin}/`, { method: 'POST', body: '{}', headers: { ...base, origin: 'http://evil.example' } });
    assert.equal(wrong.status, 403, 'a foreign Origin must be rejected');
  });
});

test('web host: rejects a state-changing request with a missing or wrong session', async () => {
  await withHost({}, async info => {
    const value = await launchValue(info);
    const absent = await fetch(`${info.origin}/`, {
      method: 'POST',
      body: '{}',
      headers: { origin: info.origin, 'x-px-csrf': value, 'content-type': 'application/json' },
    });
    assert.equal(absent.status, 403, 'a missing session cookie must be rejected');
    const wrong = await fetch(`${info.origin}/`, {
      method: 'POST',
      body: '{}',
      headers: { origin: info.origin, cookie: 'px_session=forged-value-0123456789abcdef', 'x-px-csrf': value, 'content-type': 'application/json' },
    });
    assert.equal(wrong.status, 403, 'a wrong session value must be rejected');
  });
});

test('web host: rejects a state-changing request with a missing or wrong CSRF', async () => {
  await withHost({}, async info => {
    const value = await launchValue(info);
    const absent = await fetch(`${info.origin}/`, {
      method: 'POST',
      body: '{}',
      headers: { origin: info.origin, cookie: `px_session=${value}`, 'content-type': 'application/json' },
    });
    assert.equal(absent.status, 403, 'a missing CSRF header must be rejected');
    const wrong = await fetch(`${info.origin}/`, {
      method: 'POST',
      body: '{}',
      headers: { origin: info.origin, cookie: `px_session=${value}`, 'x-px-csrf': 'forged-csrf-0123456789abcdef', 'content-type': 'application/json' },
    });
    assert.equal(wrong.status, 403, 'a wrong CSRF value must be rejected');
  });
});

test('web host: rejects unsupported methods even with valid Origin, session, and CSRF', async () => {
  await withHost({}, async info => {
    const value = await launchValue(info);
    const headers = {
      origin: info.origin,
      cookie: `px_session=${value}`,
      'x-px-csrf': value,
      'content-type': 'application/json',
    };
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']) {
      const res = await fetch(`${info.origin}/`, { method, body: '{}', headers });
      assert.equal(res.status, 405, `${method} must be unsupported before mutation routes exist`);
      assert.equal(res.headers.get('allow'), 'GET, HEAD', `${method} must advertise the allowed read-only methods`);
    }
  });
});

test('web host: rejects a body over the configured limit', async () => {
  await withHost({ bodyLimitBytes: 1024 }, async info => {
    const value = await launchValue(info);
    const headers = {
      origin: info.origin,
      cookie: `px_session=${value}`,
      'x-px-csrf': value,
      'content-type': 'application/json',
    };
    const under = JSON.stringify({ pad: 'x'.repeat(900) });
    const over = JSON.stringify({ pad: 'x'.repeat(2000) });
    assert.ok(under.length <= 1024 && over.length > 1024, 'fixture sizes must straddle the limit');
    const underRes = await fetch(`${info.origin}/`, { method: 'POST', body: under, headers });
    assert.equal(underRes.status, 405, 'a body within the limit must pass the size gate and hit 405');
    const overRes = await fetch(`${info.origin}/`, { method: 'POST', body: over, headers });
    assert.equal(overRes.status, 413, 'a body over the limit must be rejected');
  });
});

test('web host: rejects an invalid JSON body with 400', async () => {
  await withHost({}, async info => {
    const value = await launchValue(info);
    const res = await fetch(`${info.origin}/`, {
      method: 'POST',
      body: 'not-json',
      headers: {
        origin: info.origin,
        cookie: `px_session=${value}`,
        'x-px-csrf': value,
        'content-type': 'application/json',
      },
    });
    assert.equal(res.status, 400, 'a non-JSON body must be rejected before any mutation route could see it');
  });
});

test('web host: rejects a non-JSON content type for state-changing requests', async () => {
  await withHost({}, async info => {
    const value = await launchValue(info);
    const res = await fetch(`${info.origin}/`, {
      method: 'POST',
      body: 'a=b',
      headers: {
        origin: info.origin,
        cookie: `px_session=${value}`,
        'x-px-csrf': value,
        'content-type': 'application/x-www-form-urlencoded',
      },
    });
    assert.equal(res.status, 415, 'a non-JSON content type must be rejected');
  });
});

test('web host: rejects asset traversal and serves only manifest allowlisted entries', async () => {
  await withHost({}, async info => {
    const rawTraversal = await rawRequest(info, `127.0.0.1:${info.port}`, '/assets/../secret.txt');
    assert.equal(rawTraversal, 400, 'a literal dotdot segment must be rejected');
    const encoded = await fetch(`${info.origin}/..%2fsecret.txt`);
    assert.ok(encoded.status === 400 || encoded.status === 404, `encoded traversal must not serve the file, got ${encoded.status}`);
    const unlisted = await fetch(`${info.origin}/secret.txt`);
    assert.equal(unlisted.status, 404, 'a file absent from the manifest must not be served');
    const manifestItself = await fetch(`${info.origin}/manifest.json`);
    assert.equal(manifestItself.status, 404, 'the manifest itself is not a served asset');
    const allowed = await fetch(`${info.origin}/assets/app.js`);
    assert.equal(allowed.status, 200);
    assert.equal(await allowed.text(), 'console.log("web shell");\n');
  });
});

test('web host: session value differs per launch and is unavailable after close', async () => {
  const first = createWebHost({ assets });
  const firstInfo = await first.start();
  const firstValue = await launchValue(firstInfo);
  await first.close();

  const second = createWebHost({ assets });
  const secondInfo = await second.start();
  const secondValue = await launchValue(secondInfo);
  assert.notEqual(firstValue, secondValue, 'each launch must mint its own unguessable value');
  await assert.rejects(() => fetch(`${firstInfo.origin}/`), 'the first launch must be unreachable after close');
  await second.close();
});

test('web host: GET routes do not mutate launch state', async () => {
  await withHost({}, async info => {
    const first = await fetch(`${info.origin}/`);
    const firstHtml = await first.text();
    const firstCookie = first.headers.get('set-cookie') ?? '';
    const second = await fetch(`${info.origin}/`);
    const secondHtml = await second.text();
    const secondCookie = second.headers.get('set-cookie') ?? '';
    assert.equal(secondCookie, firstCookie, 'the per-launch session value must be stable across GETs');
    assert.equal(secondHtml, firstHtml, 'GET responses must be read-only and deterministic');
  });
});

// ---------------------------------------------------------------------------
// Read-only snapshot route (TASK-2432, ADR 0055)
// ---------------------------------------------------------------------------

test('web host: snapshot route returns a valid versioned board snapshot', async () => {
  const projection = makeProjection({ active: makeCards(2, 'active') });
  await withHost({ buildProjection: async () => projection }, async info => {
    const res = await fetch(`${info.origin}${WEB_SNAPSHOT_PATH}`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /^application\/json/);
    const validation = validateWebBoardSnapshot(await res.json());
    assert.equal(validation.ok, true, `snapshot rejected: ${JSON.stringify(validation)}`);
    assert.ok(validation.ok);
    assert.equal(validation.value.kind, 'board-snapshot');
    assert.equal(validation.value.transportVersion, WEB_TRANSPORT_VERSION);
    assert.equal(validation.value.projectionVersion, projection.version);
    assert.equal(validation.value.stages.find(stage => stage.lane === 'active')?.count, 2);
  });
});

test('web host: snapshot route answers 200 without cookie, CSRF header, or Origin', async () => {
  await withHost({ buildProjection: async () => makeProjection() }, async info => {
    // A bare GET: no credentials of any kind. These read routes are not an
    // authentication surface; loopback bind plus exact-Host is the boundary.
    const res = await fetch(`${info.origin}${WEB_SNAPSHOT_PATH}`, { headers: { accept: 'application/json' } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-security-policy'), PROTECTION_HEADERS['content-security-policy']);
  });
});

test('web host: snapshot route rejects a Host header that is not the bound loopback origin', async () => {
  await withHost({ buildProjection: async () => makeProjection() }, async info => {
    assert.equal(await rawRequest(info, 'evil.example', WEB_SNAPSHOT_PATH), 403);
    assert.equal(await rawRequest(info, `127.0.0.1:${info.port + 1}`, WEB_SNAPSHOT_PATH), 403);
    assert.equal(await rawRequest(info, `127.0.0.1:${info.port}`, WEB_SNAPSHOT_PATH), 200);
  });
});

test('web host: a failing projection build surfaces an error, never an empty board', async () => {
  let attempts = 0;
  const projection = makeProjection({ active: makeCards(3, 'active') });
  await withHost({
    buildProjection: async () => {
      attempts += 1;
      if (attempts === 1) { throw new Error('database is locked'); }
      return projection;
    },
  }, async info => {
    const failed = await fetch(`${info.origin}${WEB_SNAPSHOT_PATH}`);
    assert.equal(failed.status, 503);
    const body = await failed.json() as { kind: string; error: { kind: string; message: string } };
    assert.equal(body.kind, 'board-snapshot-error');
    assert.equal(body.error.kind, 'unavailable');
    assert.match(body.error.message, /database is locked/);
    // The failure is transient: the very next read recovers with real cards.
    const recovered = await fetch(`${info.origin}${WEB_SNAPSHOT_PATH}`);
    assert.equal(recovered.status, 200);
    const validation = validateWebBoardSnapshot(await recovered.json());
    assert.ok(validation.ok);
    assert.equal(validation.value.stages.find(stage => stage.lane === 'active')?.count, 3);
  });
});

// ---------------------------------------------------------------------------
// Server-Sent Events stream (TASK-2432, ADR 0055)
// ---------------------------------------------------------------------------

const PROGRESS = {
  operationId: 'op-1',
  sequence: 1,
  phase: 'implement',
  message: 'writing tests',
  timestamp: '2026-08-28T00:00:00.000Z',
} as const;

test('web host: SSE stream sends streaming and protection headers and frames before the response ends', async () => {
  await withHost({ buildProjection: async () => makeProjection() }, async (info, host) => {
    const client = openSse(info);
    await client.ready;
    host.progress(PROGRESS);
    await client.waitFor(1);
    assert.equal(client.status(), 200);
    assert.match(client.header('content-type') ?? '', /^text\/event-stream/);
    assert.equal(client.header('cache-control'), 'no-store');
    assert.equal(client.header('content-security-policy'), PROTECTION_HEADERS['content-security-policy']);
    assert.match(client.header('content-security-policy') ?? '', /connect-src 'self'/);
    assert.equal(client.header('x-content-type-options'), 'nosniff');
    // No content-length and no terminator: the response is still open.
    assert.equal(client.header('content-length'), undefined);
    const frame = client.frames[0];
    assert.ok(frame);
    assert.equal(frame.event, 'progress');
    assert.equal(frame.id, 1);
    const validation = validateWebProgressEvent(frame.data);
    assert.ok(validation.ok, `progress frame rejected: ${JSON.stringify(validation)}`);
    assert.equal(validation.value.operationId, PROGRESS.operationId);
    assert.equal(validation.value.sequence, PROGRESS.sequence);
    await client.close();
  });
});

test('web host: SSE route answers without cookie, CSRF header, or Origin but rejects a wrong Host', async () => {
  await withHost({ buildProjection: async () => makeProjection() }, async info => {
    // openSse sends no cookie, no x-px-csrf and no Origin.
    const client = openSse(info);
    await client.ready;
    assert.equal(client.status(), 200, 'a bare SSE GET needs no cookie, CSRF header, or Origin');
    assert.equal(await rawRequest(info, 'evil.example', WEB_EVENTS_PATH), 403);
    await client.close();
  });
});

test('web host: SSE ids strictly increase across progress and invalidation events', async () => {
  const timers = manualTimers();
  let cards = 1;
  await withHost({
    buildProjection: async () => makeProjection({ active: makeCards(cards, 'active') }),
    subscription: timers.options,
  }, async (info, host) => {
    const client = openSse(info);
    await client.ready;
    host.progress(PROGRESS);
    await client.waitFor(1);
    await timers.tick();               // first rebuild: fingerprint changes from nothing
    await client.waitFor(2);
    host.progress({ ...PROGRESS, sequence: 2 });
    await client.waitFor(3);
    cards = 2;
    await timers.tick();               // board changed: another invalidation
    await client.waitFor(4);

    assert.deepEqual(client.frames.map(frame => frame.event), ['progress', 'invalidate', 'progress', 'invalidate']);
    assert.deepEqual(client.frames.map(frame => frame.id), [1, 2, 3, 4]);
    // The invalidation is a refetch signal, not a second copy of the board.
    assert.deepEqual(client.frames[1]?.data, { kind: 'projection-invalidated', transportVersion: WEB_TRANSPORT_VERSION });
    await client.close();
  });
});

test('web host: SSE reconnect with Last-Event-ID replays only newer events', async () => {
  await withHost({ buildProjection: async () => makeProjection() }, async (info, host) => {
    const first = openSse(info);
    await first.ready;
    host.progress(PROGRESS);
    host.progress({ ...PROGRESS, sequence: 2 });
    await first.waitFor(2);
    const lastSeen = first.frames[first.frames.length - 1];
    assert.ok(lastSeen);
    await first.close();

    // Missed while disconnected.
    host.progress({ ...PROGRESS, sequence: 3 });
    host.progress({ ...PROGRESS, sequence: 4 });

    const second = openSse(info, String(lastSeen.id));
    await second.ready;
    await second.waitFor(2);
    assert.deepEqual(second.frames.map(frame => frame.id), [3, 4]);

    const key = (data: Record<string, unknown>): string => JSON.stringify([data.operationId, data.sequence]);
    const before = new Set(first.frames.map(frame => key(frame.data)));
    const repeated = second.frames.filter(frame => before.has(key(frame.data)));
    assert.deepEqual(repeated, [], 'a reconnect must repeat no operationId+sequence pair');
    await second.close();
  });
});

test('web host: a failed rebuild emits a typed stream error and the next tick still invalidates', async () => {
  const timers = manualTimers();
  let attempts = 0;
  await withHost({
    buildProjection: async () => {
      attempts += 1;
      if (attempts === 1) { throw new Error('database is locked'); }
      return makeProjection({ active: makeCards(1, 'active') });
    },
    subscription: timers.options,
  }, async info => {
    const client = openSse(info);
    await client.ready;
    await timers.tick();
    await client.waitFor(1);
    assert.equal(client.frames[0]?.event, 'error');
    assert.deepEqual(client.frames[0]?.data, {
      kind: 'stream-error',
      transportVersion: WEB_TRANSPORT_VERSION,
      error: { kind: 'unavailable', message: 'database is locked' },
    });
    // The subscription survived the failure: it rescheduled and recovers.
    assert.equal(timers.scheduled, true, 'a failed rebuild must not tear the subscription down');
    await timers.tick();
    await client.waitFor(2);
    assert.equal(client.frames[1]?.event, 'invalidate');
    await client.close();
  });
});

test('web host: a disconnect removes that client, and close() unsubscribes the projection', async () => {
  const timers = manualTimers();
  const host = createWebHost({
    assets,
    buildProjection: async () => makeProjection(),
    subscription: timers.options,
  });
  const info = await host.start();
  try {
    assert.equal(host.clientCount(), 0);
    const first = openSse(info);
    const second = openSse(info);
    await first.ready;
    await second.ready;
    host.progress(PROGRESS);
    await first.waitFor(1);
    await second.waitFor(1);
    assert.equal(host.clientCount(), 2);

    await first.close();
    assert.equal(host.clientCount(), 1, 'a disconnected client must leave no listener behind');
    host.progress({ ...PROGRESS, sequence: 2 });
    await second.waitFor(2);
    assert.equal(first.frames.length, 1, 'a disconnected client receives nothing further');

    const setsBeforeClose = timers.setCount;
    await second.close();
    assert.equal(host.clientCount(), 0);
    await host.close();
    assert.equal(timers.clearCount, 1, 'close() must unsubscribe the shared projection subscription');
    assert.equal(timers.scheduled, false, 'no timer may remain scheduled after close()');
    assert.equal(timers.setCount, setsBeforeClose, 'close() must not schedule another rebuild');
  } finally {
    await host.close();
  }
});

test('web host: 1000 synthetic progress events keep one listener and a bounded buffer', async () => {
  await withHost({ buildProjection: async () => makeProjection() }, async (info, host) => {
    const client = openSse(info);
    await client.ready;
    host.progress(PROGRESS);
    await client.waitFor(1);
    const total = 1_000;
    for (let sequence = 2; sequence <= total; sequence += 1) {
      host.progress({ ...PROGRESS, sequence });
    }
    await client.waitFor(total);
    assert.equal(host.clientCount(), 1, 'high volume must not accumulate clients');
    assert.deepEqual(client.frames.map(frame => frame.id).slice(-3), [total - 2, total - 1, total]);

    // The buffer is bounded, so a very stale cursor replays at most the bound.
    const late = openSse(info, '0');
    await late.ready;
    await late.waitFor(WEB_EVENT_BUFFER_LIMIT);
    assert.equal(late.frames.length, WEB_EVENT_BUFFER_LIMIT, 'replay is capped at the exported buffer bound');
    assert.equal(late.frames[0]?.id, total - WEB_EVENT_BUFFER_LIMIT + 1, 'oldest events were evicted first');
    await late.close();
    await client.close();
  });
});

// ---------------------------------------------------------------------------
// `px web` command wiring (TASK-2432 CP-4)
// ---------------------------------------------------------------------------

test('web cli: createBoardSource gets the host sink, its build port serves, close runs on stop', async () => {
  const lines: string[] = [];
  const oldLogger = setLogger({ log: line => { lines.push(String(line)); }, error: line => { lines.push(String(line)); } });
  try {
    let stop: () => void = () => {};
    const stopped = new Promise<void>(resolve => { stop = resolve; });
    let sink: BoardProgressSink | null = null;
    let sourceClosed = false;
    const command = runWebCommand([], {
      assets,
      createBoardSource: (progress) => {
        sink = progress;
        return Promise.resolve({
          buildProjection: async () => makeProjection(),
          close: async () => { sourceClosed = true; },
        });
      },
      waitForStop: () => stopped,
    });
    // The host announces the actual ephemeral origin; event-driven wait, no sleep.
    let origin = '';
    while (!origin) {
      await new Promise(resolve => setImmediate(resolve));
      for (const line of lines) {
        origin = /listening on (http:\/\/[\w.]+:\d+)\/ /.exec(line)?.[1] ?? origin;
      }
    }
    // The source's build port is what the snapshot route serves.
    const res = await fetch(`${origin}/api/board`);
    assert.equal(res.status, 200);
    assert.ok(validateWebBoardSnapshot(await res.json()).ok, 'the wired build port must serve a valid snapshot');
    // The sink handed to the source is the host's SSE sink: publishing on it
    // reaches a fresh client through the replay buffer.
    assert.ok(sink, 'createBoardSource must receive the host progress sink');
    sink({ operationId: 'op-cli', sequence: 7, phase: 'implement', message: 'wired', timestamp: '2026-08-28T00:00:00.000Z' });
    const client = openSse({ host: '127.0.0.1', port: Number(new URL(origin).port), origin }, '0');
    await client.ready;
    await client.waitFor(1);
    assert.equal(client.frames[0]?.event, 'progress');
    assert.equal(client.frames[0]?.data.operationId, 'op-cli');
    assert.equal(client.frames[0]?.data.sequence, 7);
    await client.close();
    stop();
    await command;
    assert.equal(sourceClosed, true, 'the board source must be released when the command exits');
  } finally {
    setLogger(oldLogger);
  }
});
