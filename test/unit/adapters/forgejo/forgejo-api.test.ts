/* global setImmediate */

import test from 'node:test';
import assert from 'node:assert/strict';
import EventEmitter from 'events';
import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';

class MockRequest extends EventEmitter {
  write(_data: string): void {}
  end(): void {}
  destroy(): void {}
}
import { mockModule, installModuleMocks } from '../../../lib/module-mock.js';

// Register all modules that participate in the dependency chain.
// forgejo-api.ts imports from node:child_process, node:http, node:https, and forgejo-auth.ts.
// Registering them with mockModule ensures re-linked forgejo-api.ts sees facades.
const forgejoApiModule = mockModule<typeof import('../../../../src/adapters/forgejo/forgejo-api.js')>(
  '../../../../src/adapters/forgejo/forgejo-api.js', import.meta.url);
const forgejoAuthModule = mockModule<typeof import('../../../../src/adapters/forgejo/forgejo-auth.js')>(
  '../../../../src/adapters/forgejo/forgejo-auth.js', import.meta.url);
const childProcessModule = mockModule<typeof import('node:child_process')>('node:child_process', import.meta.url);
const httpModule = mockModule<typeof import('node:http')>('node:http', import.meta.url);
const httpsModule = mockModule<typeof import('node:https')>('node:https', import.meta.url);

const { mock } = test;
await installModuleMocks();

// Use the mock handles (not direct imports) so re-linked modules see mocked deps.
const { forgejoApi, forgejoApiAsync, HTTP_REQUEST_TIMEOUT, codexSandboxHint } = forgejoApiModule;

// --- Helpers ---

function mockResolveForgejoSettings() {
  mock.method(forgejoAuthModule, 'resolveForgejoSettings', (_rootDir: Parameters<(typeof forgejoAuthModule)["resolveForgejoSettings"]>[0]) => ({
    url: 'http://localhost:3300',
    repo: 'magnus/testproj',
  }));
}

function createMockResponse(statusCode: number, body: unknown) {
  const res = new IncomingMessage(new Socket());
  res.statusCode = statusCode;
  setImmediate(() => {
    if (body !== undefined && body !== null) {
      res.emit('data', typeof body === 'string' ? body : JSON.stringify(body));
    }
    res.emit('end');
  });
  return res;
}

function createMockError(code: string, message: string) {
  const req = new MockRequest();
  req.write = () => {};
  req.end = () => {};
  req.destroy = () => {};
  setImmediate(() => {
    const err = Object.assign(new Error(message || code), { code });
    req.emit('error', err);
  });
  return req;
}

function createMockTimeout() {
  const req = new MockRequest();
  req.write = () => {};
  req.end = () => {};
  req.destroy = () => {};
  setImmediate(() => {
    req.emit('timeout');
  });
  return req;
}

// --- Sync transport tests (forgejoApi) ---

test('forgejoApi returns ok with parsed JSON on 200', () => {
  mockResolveForgejoSettings();
  const mockSpawnSync = mock.method(childProcessModule, 'spawnSync', () => ({
    status: 0,
    stdout: '{"id":1,"title":"test"}\n200',
    stderr: null,
  }));

  try {
    const result = forgejoApi('GET', '/pulls/1', 'token-123', undefined, { rootDir: '/tmp' });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.statusCode, 200);
    assert.deepStrictEqual(result.data, { id: 1, title: 'test' });
    assert.strictEqual(result.error, null);
  } finally {
    mockSpawnSync.mock.restore();
  }
});

test('forgejoApi returns ok on 201 with body payload', () => {
  mockResolveForgejoSettings();
  const mockSpawnSync = mock.method(childProcessModule, 'spawnSync', (_cmd: Parameters<(typeof childProcessModule)["spawnSync"]>[0], args: Parameters<(typeof childProcessModule)["spawnSync"]>[1], opts: Parameters<(typeof childProcessModule)["spawnSync"]>[2]) => {
    assert.ok(args != null);
    assert.ok(args.includes('--data-binary'), 'should include --data-binary for body');
    assert.ok(args.includes('@-'), 'should include @- for stdin body');
    assert.ok(opts != null);
    assert.strictEqual(opts.input, '{"key":"value"}', 'body should be JSON-stringified');
    return {
      status: 0,
      stdout: '{"number":42}\n201',
      stderr: null,
    };
  });

  try {
    const result = forgejoApi('POST', '/pulls', 'token-123', { key: 'value' }, { rootDir: '/tmp' });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.statusCode, 201);
    assert.deepStrictEqual(result.data, { number: 42 });
  } finally {
    mockSpawnSync.mock.restore();
  }
});

test('forgejoApi returns ok=false on 404', () => {
  mockResolveForgejoSettings();
  const mockSpawnSync = mock.method(childProcessModule, 'spawnSync', () => ({
    status: 0,
    stdout: '{"message":"Not Found"}\n404',
    stderr: null,
  }));

  try {
    const result = forgejoApi('GET', '/pulls/999', 'token-123', undefined, { rootDir: '/tmp' });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.statusCode, 404);
    assert.deepStrictEqual(result.data, { message: 'Not Found' });
    assert.strictEqual(result.error, null);
  } finally {
    mockSpawnSync.mock.restore();
  }
});

test('forgejoApi returns ok=false on 401 with data preserved', () => {
  mockResolveForgejoSettings();
  const mockSpawnSync = mock.method(childProcessModule, 'spawnSync', () => ({
    status: 0,
    stdout: '{"message":"unauthorized"}\n401',
    stderr: null,
  }));

  try {
    const result = forgejoApi('GET', '/pulls/1', 'bad-token', undefined, { rootDir: '/tmp' });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.statusCode, 401);
    assert.ok(result.data);
  } finally {
    mockSpawnSync.mock.restore();
  }
});

test('forgejoApi handles malformed JSON response gracefully', () => {
  mockResolveForgejoSettings();
  const mockSpawnSync = mock.method(childProcessModule, 'spawnSync', () => ({
    status: 0,
    stdout: 'not-json-at-all\n200',
    stderr: null,
  }));

  try {
    const result = forgejoApi('GET', '/pulls/1', 'token-123', undefined, { rootDir: '/tmp' });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.statusCode, 200);
    assert.strictEqual(result.data, null);
    assert.strictEqual(result.error, null);
  } finally {
    mockSpawnSync.mock.restore();
  }
});

test('forgejoApi returns error on curl spawn failure (status 7 = sandbox)', () => {
  mockResolveForgejoSettings();
  const mockSpawnSync = mock.method(childProcessModule, 'spawnSync', () => ({
    status: 7,
    stdout: null,
    stderr: 'curl: (7) Failed to connect',
  }));

  try {
    const result = forgejoApi('GET', '/pulls/1', 'token-123', undefined, { rootDir: '/tmp' });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.status, 7);
    assert.strictEqual(result.statusCode, null);
    assert.strictEqual(result.data, null);
    assert.ok(typeof result.error === 'string');
    assert.match(result.error, /Codex runtime cannot reach local Forgejo/);
  } finally {
    mockSpawnSync.mock.restore();
  }
});

test('forgejoApi returns error on curl spawn failure (generic status)', () => {
  mockResolveForgejoSettings();
  const mockSpawnSync = mock.method(childProcessModule, 'spawnSync', () => ({
    status: 28,
    stdout: null,
    stderr: 'curl: (28) Operation timed out',
  }));

  try {
    const result = forgejoApi('GET', '/pulls/1', 'token-123', undefined, { rootDir: '/tmp' });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.status, 28);
    assert.strictEqual(result.statusCode, null);
    assert.strictEqual(result.error, null);
    assert.strictEqual(result.stderr, 'curl: (28) Operation timed out');
  } finally {
    mockSpawnSync.mock.restore();
  }
});

test('forgejoApi constructs correct URL from settings', () => {
  mockResolveForgejoSettings();
  let capturedArgs: { value: readonly string[] | undefined | null } = { value: null };
  const mockSpawnSync = mock.method(childProcessModule, 'spawnSync', (_cmd: Parameters<(typeof childProcessModule)["spawnSync"]>[0], args: Parameters<(typeof childProcessModule)["spawnSync"]>[1]) => {
    capturedArgs.value = args;
    return { status: 0, stdout: '{}\n200', stderr: null };
  });

  try {
    forgejoApi('GET', '/pulls/1', 'token-123', undefined, { rootDir: '/tmp' });
    assert.ok(capturedArgs.value != null);
    assert.ok(capturedArgs.value.includes('http://localhost:3300/api/v1/repos/magnus/testproj/pulls/1'),
      `URL should be constructed correctly. Args: ${capturedArgs.value.join(' | ')}`);
    assert.ok(capturedArgs.value.includes('Authorization: token token-123'),
      'Authorization header should be set');
    assert.ok(capturedArgs.value.includes('Content-Type: application/json'),
      'Content-Type header should be set');
  } finally {
    mockSpawnSync.mock.restore();
  }
});

test('forgejoApi uses rootDir option for settings resolution', () => {
  let capturedRootDir: { value: string | undefined | null } = { value: null };
  mock.method(forgejoAuthModule, 'resolveForgejoSettings', (rootDir: Parameters<(typeof forgejoAuthModule)["resolveForgejoSettings"]>[0]) => {
    capturedRootDir.value = rootDir;
    return { url: 'http://localhost:3300', repo: 'magnus/testproj' };
  });
  const mockSpawnSync = mock.method(childProcessModule, 'spawnSync', () => ({
    status: 0, stdout: '{}\n200', stderr: null,
  }));

  try {
    forgejoApi('GET', '/pulls/1', 'token-123', undefined, { rootDir: '/custom/root' });
    assert.strictEqual(capturedRootDir.value, '/custom/root');
  } finally {
    mockSpawnSync.mock.restore();
  }
});

// --- Async transport tests (forgejoApiAsync) ---

test('forgejoApiAsync returns ok with parsed JSON on 200', async () => {
  mockResolveForgejoSettings();
  const mockRequest = mock.method(httpModule, 'request', (_url: Parameters<(typeof httpModule)["request"]>[0], _opts: Parameters<(typeof httpModule)["request"]>[1], callback: Parameters<(typeof httpModule)["request"]>[2]) => {
    assert.ok(callback);
    const req = new MockRequest();
    req.write = () => {};
    req.end = () => { setImmediate(() => callback(createMockResponse(200, { id: 1, title: 'test' }))); };
    return req;
  });

  try {
    const result = await forgejoApiAsync('GET', '/pulls/1', 'token-123', undefined, { rootDir: '/tmp' });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.statusCode, 200);
    assert.deepStrictEqual(result.data, { id: 1, title: 'test' });
    assert.strictEqual(result.error, null);
  } finally {
    mockRequest.mock.restore();
  }
});

test('forgejoApiAsync sends body payload on POST', async () => {
  mockResolveForgejoSettings();
  let capturedPayload: { value: string | null } = { value: null };
  const mockRequest = mock.method(httpModule, 'request', (_url: Parameters<(typeof httpModule)["request"]>[0], _opts: Parameters<(typeof httpModule)["request"]>[1], callback: Parameters<(typeof httpModule)["request"]>[2]) => {
    assert.ok(callback);
    const req = new MockRequest();
    req.write = (data) => { capturedPayload.value = data; };
    req.end = () => { setImmediate(() => callback(createMockResponse(201, { number: 5 }))); };
    return req;
  });

  try {
    const result = await forgejoApiAsync('POST', '/pulls', 'token-123', { title: 'PR' }, { rootDir: '/tmp' });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.statusCode, 201);
    assert.strictEqual(capturedPayload.value, '{"title":"PR"}');
  } finally {
    mockRequest.mock.restore();
  }
});

test('forgejoApiAsync returns ok=false on 404', async () => {
  mockResolveForgejoSettings();
  const mockRequest = mock.method(httpModule, 'request', (_url: Parameters<(typeof httpModule)["request"]>[0], _opts: Parameters<(typeof httpModule)["request"]>[1], callback: Parameters<(typeof httpModule)["request"]>[2]) => {
    assert.ok(callback);
    const req = new MockRequest();
    req.end = () => { setImmediate(() => callback(createMockResponse(404, { message: 'Not Found' }))); };
    return req;
  });

  try {
    const result = await forgejoApiAsync('GET', '/pulls/999', 'token-123', undefined, { rootDir: '/tmp' });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.statusCode, 404);
    assert.deepStrictEqual(result.data, { message: 'Not Found' });
  } finally {
    mockRequest.mock.restore();
  }
});

test('forgejoApiAsync handles malformed JSON gracefully', async () => {
  mockResolveForgejoSettings();
  const mockRequest = mock.method(httpModule, 'request', (_url: Parameters<(typeof httpModule)["request"]>[0], _opts: Parameters<(typeof httpModule)["request"]>[1], callback: Parameters<(typeof httpModule)["request"]>[2]) => {
    assert.ok(callback);
    const req = new MockRequest();
    req.end = () => { setImmediate(() => callback(createMockResponse(200, 'plain text response'))); };
    return req;
  });

  try {
    const result = await forgejoApiAsync('GET', '/pulls/1', 'token-123', undefined, { rootDir: '/tmp' });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.statusCode, 200);
    assert.strictEqual(result.data, null);
  } finally {
    mockRequest.mock.restore();
  }
});

test('forgejoApiAsync returns error on ECONNREFUSED with sandbox hint', async () => {
  mockResolveForgejoSettings();
  const mockRequest = mock.method(httpModule, 'request', (_url: Parameters<(typeof httpModule)["request"]>[0], _opts: Parameters<(typeof httpModule)["request"]>[1], callback: Parameters<(typeof httpModule)["request"]>[2]) => {
    assert.ok(callback);
    return createMockError('ECONNREFUSED', 'connect ECONNREFUSED 127.0.0.1:3300');
  });

  try {
    const result = await forgejoApiAsync('GET', '/pulls/1', 'token-123', undefined, { rootDir: '/tmp' });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.statusCode, null);
    assert.strictEqual(result.status, null);
    assert.ok(typeof result.error === 'string');
    assert.match(result.error, /Codex runtime cannot reach local Forgejo/);
  } finally {
    mockRequest.mock.restore();
  }
});

test('forgejoApiAsync returns error on ENOTFOUND', async () => {
  mockResolveForgejoSettings();
  const mockRequest = mock.method(httpModule, 'request', (_url: Parameters<(typeof httpModule)["request"]>[0], _opts: Parameters<(typeof httpModule)["request"]>[1], callback: Parameters<(typeof httpModule)["request"]>[2]) => {
    assert.ok(callback);
    return createMockError('ENOTFOUND', 'getaddrinfo ENOTFOUND forgejo.local');
  });

  try {
    const result = await forgejoApiAsync('GET', '/pulls/1', 'token-123', undefined, { rootDir: '/tmp' });
    assert.strictEqual(result.ok, false);
    assert.ok(typeof result.error === 'string');
    assert.match(result.error, /Codex runtime cannot reach local Forgejo/);
  } finally {
    mockRequest.mock.restore();
  }
});

test('forgejoApiAsync returns error on generic request failure without sandbox hint', async () => {
  mockResolveForgejoSettings();
  const mockRequest = mock.method(httpModule, 'request', (_url: Parameters<(typeof httpModule)["request"]>[0], _opts: Parameters<(typeof httpModule)["request"]>[1], callback: Parameters<(typeof httpModule)["request"]>[2]) => {
    assert.ok(callback);
    return createMockError('EPIPE', 'write EPIPE');
  });

  try {
    const result = await forgejoApiAsync('GET', '/pulls/1', 'token-123', undefined, { rootDir: '/tmp' });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, null);
    assert.strictEqual(result.stderr, 'write EPIPE');
  } finally {
    mockRequest.mock.restore();
  }
});

test('forgejoApiAsync returns timeout error', async () => {
  mockResolveForgejoSettings();
  const mockRequest = mock.method(httpModule, 'request', (_url: Parameters<(typeof httpModule)["request"]>[0], _opts: Parameters<(typeof httpModule)["request"]>[1], callback: Parameters<(typeof httpModule)["request"]>[2]) => {
    assert.ok(callback);
    return createMockTimeout();
  });

  try {
    const result = await forgejoApiAsync('GET', '/pulls/1', 'token-123', undefined, { rootDir: '/tmp', timeout: 100 });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.statusCode, null);
    assert.strictEqual(result.status, null);
    assert.strictEqual(result.stderr, 'request timeout');
    assert.strictEqual(result.error, null);
  } finally {
    mockRequest.mock.restore();
  }
});

test('forgejoApiAsync uses custom timeout from options', async () => {
  mockResolveForgejoSettings();
  let capturedTimeout: { value: number | undefined | null } = { value: null };
  const mockRequest = mock.method(httpModule, 'request', (_url: Parameters<(typeof httpModule)["request"]>[0], opts: Parameters<(typeof httpModule)["request"]>[1], callback: Parameters<(typeof httpModule)["request"]>[2]) => {
    assert.ok(callback);
    capturedTimeout.value = opts.timeout;
    const req = new MockRequest();
    req.end = () => { setImmediate(() => callback(createMockResponse(200, {}))); };
    return req;
  });

  try {
    await forgejoApiAsync('GET', '/pulls/1', 'token-123', undefined, { rootDir: '/tmp', timeout: 15000 });
    assert.strictEqual(capturedTimeout.value, 15000);
  } finally {
    mockRequest.mock.restore();
  }
});

test('forgejoApiAsync uses default HTTP_REQUEST_TIMEOUT when no timeout option', async () => {
  mockResolveForgejoSettings();
  let capturedTimeout: { value: number | undefined | null } = { value: null };
  const mockRequest = mock.method(httpModule, 'request', (_url: Parameters<(typeof httpModule)["request"]>[0], opts: Parameters<(typeof httpModule)["request"]>[1], callback: Parameters<(typeof httpModule)["request"]>[2]) => {
    assert.ok(callback);
    capturedTimeout.value = opts.timeout;
    const req = new MockRequest();
    req.end = () => { setImmediate(() => callback(createMockResponse(200, {}))); };
    return req;
  });

  try {
    await forgejoApiAsync('GET', '/pulls/1', 'token-123', undefined, { rootDir: '/tmp' });
    assert.strictEqual(capturedTimeout.value, HTTP_REQUEST_TIMEOUT);
  } finally {
    mockRequest.mock.restore();
  }
});

test('forgejoApiAsync uses https transport for https URLs', async () => {
  mock.method(forgejoAuthModule, 'resolveForgejoSettings', () => ({
    url: 'https://forgejo.example.com',
    repo: 'owner/repo',
  }));
  let usedHttps = false;
  const mockHttpsRequest = mock.method(httpsModule, 'request', (_url: Parameters<(typeof httpsModule)["request"]>[0], _opts: Parameters<(typeof httpsModule)["request"]>[1], callback: Parameters<(typeof httpsModule)["request"]>[2]) => {
    assert.ok(callback);
    usedHttps = true;
    const req = new MockRequest();
    req.end = () => { setImmediate(() => callback(createMockResponse(200, {}))); };
    return req;
  });

  try {
    const result = await forgejoApiAsync('GET', '/pulls/1', 'token-123', undefined, { rootDir: '/tmp' });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(usedHttps, true, 'should use https module for https URLs');
  } finally {
    mockHttpsRequest.mock.restore();
  }
});

test('forgejoApiAsync constructs correct authorization header', async () => {
  mockResolveForgejoSettings();
  let capturedHeaders: { value: readonly string[] | import("node:http").OutgoingHttpHeaders | undefined | null } = { value: null };
  const mockRequest = mock.method(httpModule, 'request', (_url: Parameters<(typeof httpModule)["request"]>[0], opts: Parameters<(typeof httpModule)["request"]>[1], callback: Parameters<(typeof httpModule)["request"]>[2]) => {
    assert.ok(callback);
    capturedHeaders.value = opts.headers;
    const req = new MockRequest();
    req.end = () => { setImmediate(() => callback(createMockResponse(200, {}))); };
    return req;
  });

  try {
    await forgejoApiAsync('GET', '/pulls/1', 'my-secret-token', undefined, { rootDir: '/tmp' });
    assert.ok(capturedHeaders.value != null);
    assert.ok('Authorization' in capturedHeaders.value);
    assert.ok('Content-Type' in capturedHeaders.value);
    assert.strictEqual(capturedHeaders.value.Authorization, 'token my-secret-token');
    assert.strictEqual(capturedHeaders.value['Content-Type'], 'application/json');
  } finally {
    mockRequest.mock.restore();
  }
});

test('forgejoApiAsync sets Content-Length when body is present', async () => {
  mockResolveForgejoSettings();
  let capturedHeaders: { value: readonly string[] | import("node:http").OutgoingHttpHeaders | undefined | null } = { value: null };
  const mockRequest = mock.method(httpModule, 'request', (_url: Parameters<(typeof httpModule)["request"]>[0], opts: Parameters<(typeof httpModule)["request"]>[1], callback: Parameters<(typeof httpModule)["request"]>[2]) => {
    assert.ok(callback);
    capturedHeaders.value = opts.headers;
    const req = new MockRequest();
    req.write = () => {};
    req.end = () => { setImmediate(() => callback(createMockResponse(201, {}))); };
    return req;
  });

  try {
    const body = { title: 'test' };
    await forgejoApiAsync('POST', '/pulls', 'token', body, { rootDir: '/tmp' });
    assert.ok(capturedHeaders.value != null);
    assert.ok('Content-Length' in capturedHeaders.value, 'Content-Length should be set for body');
    assert.strictEqual(capturedHeaders.value['Content-Length'], Buffer.byteLength(JSON.stringify(body)));
  } finally {
    mockRequest.mock.restore();
  }
});

test('forgejoApiAsync omits Content-Length when no body', async () => {
  mockResolveForgejoSettings();
  let capturedHeaders: { value: readonly string[] | import("node:http").OutgoingHttpHeaders | undefined | null } = { value: null };
  const mockRequest = mock.method(httpModule, 'request', (_url: Parameters<(typeof httpModule)["request"]>[0], opts: Parameters<(typeof httpModule)["request"]>[1], callback: Parameters<(typeof httpModule)["request"]>[2]) => {
    assert.ok(callback);
    capturedHeaders.value = opts.headers;
    const req = new MockRequest();
    req.end = () => { setImmediate(() => callback(createMockResponse(200, {}))); };
    return req;
  });

  try {
    await forgejoApiAsync('GET', '/pulls', 'token', undefined, { rootDir: '/tmp' });
    assert.ok(capturedHeaders.value != null);
    assert.ok(!('Content-Length' in capturedHeaders.value), 'Content-Length should be omitted for no body');
  } finally {
    mockRequest.mock.restore();
  }
});

// --- Utility tests ---

test('codexSandboxHint returns expected message', () => {
  const hint = codexSandboxHint();
  assert.ok(hint.includes('Codex runtime'), 'hint should mention Codex runtime');
  assert.ok(hint.includes('local Forgejo'), 'hint should mention local Forgejo');
});

test('HTTP_REQUEST_TIMEOUT is 5000', () => {
  assert.strictEqual(HTTP_REQUEST_TIMEOUT, 5000);
});
