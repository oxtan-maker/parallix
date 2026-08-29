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
import { createWebHost, type WebAssets, type WebHostInfo, type WebHostOptions } from '../src/interfaces/web/host.js';

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

async function withHost(options: Omit<WebHostOptions, 'assets'> = {}, fn: (info: WebHostInfo) => Promise<void>): Promise<void> {
  const host = createWebHost({ assets, ...options });
  const info = await host.start();
  try {
    await fn(info);
  } finally {
    await host.close();
  }
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
