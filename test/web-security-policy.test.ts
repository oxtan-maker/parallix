// web-security-policy — hermetic unit tests for the loopback web host policy.
//
// These tests exercise the pure decision functions in
// src/interfaces/web/security.ts without any socket, so the security
// negative cases stay in the fast default suite. The real-socket wiring is
// proven separately by test/web-host.integration.test.ts.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  actualOrigin,
  cookieValue,
  evaluateContentLength,
  evaluateContentType,
  evaluateHostHeader,
  evaluateMutationAuthorization,
  expectedHostHeader,
  isLoopbackHost,
  isReadOnlyMethod,
  resolveAssetPath,
  type AssetManifest,
} from '../src/interfaces/web/security.js';

const BINDING = { host: '127.0.0.1' as const, port: 41723 };
const ORIGIN = 'http://127.0.0.1:41723';
const LAUNCH_VALUE = 'launch-value-0123456789abcdef0123456789abcdef';

test('web security: isLoopbackHost accepts only explicit loopback literals', () => {
  assert.equal(isLoopbackHost('127.0.0.1'), true);
  assert.equal(isLoopbackHost('::1'), true);
  for (const nonLoopback of ['0.0.0.0', '::', 'localhost', '192.168.1.5', '10.0.0.1', 'example.com', '127.0.0.2', '']) {
    assert.equal(isLoopbackHost(nonLoopback), false, `${nonLoopback} must not be treated as loopback`);
  }
});

test('web security: expected Host header matches only actual loopback host and bound port', () => {
  assert.equal(expectedHostHeader(BINDING), '127.0.0.1:41723');
  assert.equal(actualOrigin(BINDING), ORIGIN);
  assert.equal(expectedHostHeader({ host: '::1', port: 5000 }), '[::1]:5000');
  assert.equal(actualOrigin({ host: '::1', port: 5000 }), 'http://[::1]:5000');

  assert.equal(evaluateHostHeader('127.0.0.1:41723', BINDING), 'ok');
  assert.equal(evaluateHostHeader('127.0.0.1:9999', BINDING), 'reject', 'a different port must not match');
  assert.equal(evaluateHostHeader('127.0.0.2:41723', BINDING), 'reject', 'a different loopback address must not match');
  assert.equal(evaluateHostHeader('localhost:41723', BINDING), 'reject', 'localhost is not the explicit bind literal');
  assert.equal(evaluateHostHeader('attacker.example', BINDING), 'reject');
  assert.equal(evaluateHostHeader('127.0.0.1', BINDING), 'reject', 'a missing port must not match');
  assert.equal(evaluateHostHeader(undefined, BINDING), 'reject');
  assert.equal(evaluateHostHeader('', BINDING), 'reject');
});

test('web security: mutation authorization rejects an absent or wrong Origin', () => {
  const base = { sessionCookie: LAUNCH_VALUE, csrfHeader: LAUNCH_VALUE };
  assert.deepEqual(evaluateMutationAuthorization({ ...base, origin: undefined }, ORIGIN, LAUNCH_VALUE), { result: 'reject', reason: 'absent-origin' });
  assert.deepEqual(evaluateMutationAuthorization({ ...base, origin: '' }, ORIGIN, LAUNCH_VALUE), { result: 'reject', reason: 'absent-origin' });
  assert.deepEqual(evaluateMutationAuthorization({ ...base, origin: 'http://evil.example' }, ORIGIN, LAUNCH_VALUE), { result: 'reject', reason: 'wrong-origin' });
  assert.deepEqual(evaluateMutationAuthorization({ ...base, origin: 'http://127.0.0.1:9999' }, ORIGIN, LAUNCH_VALUE), { result: 'reject', reason: 'wrong-origin' });
});

test('web security: mutation authorization rejects an absent or wrong session cookie', () => {
  const base = { origin: ORIGIN, csrfHeader: LAUNCH_VALUE };
  assert.deepEqual(evaluateMutationAuthorization({ ...base, sessionCookie: undefined }, ORIGIN, LAUNCH_VALUE), { result: 'reject', reason: 'absent-session' });
  assert.deepEqual(evaluateMutationAuthorization({ ...base, sessionCookie: '' }, ORIGIN, LAUNCH_VALUE), { result: 'reject', reason: 'absent-session' });
  assert.deepEqual(evaluateMutationAuthorization({ ...base, sessionCookie: 'stale-or-forged' }, ORIGIN, LAUNCH_VALUE), { result: 'reject', reason: 'wrong-session' });
});

test('web security: mutation authorization rejects an absent or wrong CSRF header', () => {
  const base = { origin: ORIGIN, sessionCookie: LAUNCH_VALUE };
  assert.deepEqual(evaluateMutationAuthorization({ ...base, csrfHeader: undefined }, ORIGIN, LAUNCH_VALUE), { result: 'reject', reason: 'absent-csrf' });
  assert.deepEqual(evaluateMutationAuthorization({ ...base, csrfHeader: '' }, ORIGIN, LAUNCH_VALUE), { result: 'reject', reason: 'absent-csrf' });
  assert.deepEqual(evaluateMutationAuthorization({ ...base, csrfHeader: 'stale-or-forged' }, ORIGIN, LAUNCH_VALUE), { result: 'reject', reason: 'wrong-csrf' });
});

test('web security: mutation authorization passes with matching Origin, session, and CSRF', () => {
  assert.deepEqual(
    evaluateMutationAuthorization({ origin: ORIGIN, sessionCookie: LAUNCH_VALUE, csrfHeader: LAUNCH_VALUE }, ORIGIN, LAUNCH_VALUE),
    { result: 'ok' },
  );
});

test('web security: only GET and HEAD are read-only methods', () => {
  assert.equal(isReadOnlyMethod('GET'), true);
  assert.equal(isReadOnlyMethod('HEAD'), true);
  assert.equal(isReadOnlyMethod('get'), true);
  for (const mutating of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'TRACE', 'CONNECT']) {
    assert.equal(isReadOnlyMethod(mutating), false, `${mutating} must be treated as state-changing`);
  }
});

test('web security: a content length over the configured limit is rejected', () => {
  const limit = 1024;
  assert.deepEqual(evaluateContentLength('1024', limit), { result: 'ok' });
  assert.deepEqual(evaluateContentLength('0', limit), { result: 'ok' });
  assert.deepEqual(evaluateContentLength('1025', limit), { result: 'reject', status: 413 });
  assert.deepEqual(evaluateContentLength('99999999', limit), { result: 'reject', status: 413 });
  assert.deepEqual(evaluateContentLength(undefined, limit), { result: 'reject', status: 411 }, 'absent length (chunked) must not queue an unbounded body');
  assert.deepEqual(evaluateContentLength('abc', limit), { result: 'reject', status: 400 });
  assert.deepEqual(evaluateContentLength('-1', limit), { result: 'reject', status: 400 });
  assert.deepEqual(evaluateContentLength(['1025'], limit), { result: 'reject', status: 413 });
});

test('web security: a non-JSON content type is rejected for state-changing requests', () => {
  assert.deepEqual(evaluateContentType('POST', 'application/json'), { result: 'ok' });
  assert.deepEqual(evaluateContentType('POST', 'application/json; charset=utf-8'), { result: 'ok' });
  assert.deepEqual(evaluateContentType('POST', 'application/json;charset=utf-8'), { result: 'ok' });
  assert.deepEqual(evaluateContentType('POST', 'text/plain'), { result: 'reject', status: 415 });
  assert.deepEqual(evaluateContentType('POST', 'multipart/form-data; boundary=x'), { result: 'reject', status: 415 });
  assert.deepEqual(evaluateContentType('POST', undefined), { result: 'reject', status: 415 }, 'a mutation without a declared JSON type is rejected');
  // Read-only methods carry no body semantics here.
  assert.deepEqual(evaluateContentType('GET', 'text/html'), { result: 'ok' });
});

test('web security: cookie extraction reads the session cookie from a raw header', () => {
  assert.equal(cookieValue('px_session=abc', 'px_session'), 'abc');
  assert.equal(cookieValue('other=1; px_session=abc; x=2', 'px_session'), 'abc');
  assert.equal(cookieValue('  px_session = abc  ', 'px_session'), 'abc');
  assert.equal(cookieValue('px_session=', 'px_session'), undefined, 'an empty value is treated as absent');
  assert.equal(cookieValue('other=1', 'px_session'), undefined);
  assert.equal(cookieValue(undefined, 'px_session'), undefined);
  assert.equal(cookieValue('', 'px_session'), undefined);
});

const MANIFEST: AssetManifest = {
  'index.html': { size: 10, contentType: 'text/html; charset=utf-8' },
  'assets/app.js': { size: 20, contentType: 'text/javascript' },
};

test('web security: asset path resolution serves exact manifest entries with the manifest content type', () => {
  const shell = resolveAssetPath('/index.html', MANIFEST);
  assert.equal(shell.result, 'ok');
  if (shell.result === 'ok') {
    assert.equal(shell.relativePath, 'index.html');
    assert.equal(shell.contentType, 'text/html; charset=utf-8');
    assert.equal(shell.size, 10);
  }
  const app = resolveAssetPath('/assets/app.js', MANIFEST);
  assert.equal(app.result, 'ok');
  if (app.result === 'ok') {
    assert.equal(app.relativePath, 'assets/app.js');
    assert.equal(app.contentType, 'text/javascript');
  }
});

test('web security: asset path resolution rejects traversal and non-allowlisted paths', () => {
  const traversal: Array<[string, 400 | 404]> = [
    ['/', 404],
    ['/..', 400],
    ['/../package.json', 400],
    ['/assets/../../package.json', 400],
    ['/assets/..%2f..%2fpackage.json', 400],
    ['/%2e%2e/%2e%2e/package.json', 400],
    ['/%252e%252e%252fpackage.json', 404],
    ['/assets/..\\..\\secret', 400],
    ['/%00', 400],
    ['/a%00b', 400],
    ['//assets/app.js', 400],
    ['/./assets/app.js', 400],
    ['/assets//app.js', 400],
    ['/assets', 404],
    ['/assets/app.js.map', 404],
    ['/nope.txt', 404],
  ];
  for (const [rawPath, expected] of traversal) {
    const result = resolveAssetPath(rawPath, MANIFEST);
    assert.equal(result.result, 'reject', `${rawPath} must not resolve`);
    if (result.result === 'reject') {
      assert.equal(result.status, expected, `${rawPath} must be ${expected}`);
    }
  }
  // Not a path at all.
  assert.equal(resolveAssetPath('assets/app.js', MANIFEST).result, 'reject');
});
