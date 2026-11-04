import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { bootstrapReviewSurface } from '../../../../src/adapters/review/setup-review.js';
import { ensureForgejoUser } from '../../../../src/adapters/review/setup-review-repository.js';
import { mkdtemp } from '../../../helpers/temp-dir.js';

test('owner-token setup creates a missing parallix account before granting admin and minting its token', async () => {
  const root = mkdtemp('setup-owner-');
  const calls: string[] = [];
  const home = path.join(root, '.forgejo-local');
  fs.mkdirSync(path.join(home, 'tokens'), { recursive: true });
  fs.writeFileSync(path.join(home, 'tokens', 'human'), 'owner-token');
  fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({
    adapters: { review: { provider: 'forgejo', baseUrl: 'http://fixture', repo: 'human/project', remote: 'review' } },
  }));
  try {
    const result = await bootstrapReviewSurface(root, {
      baseUrl: 'http://fixture', repo: 'human/project', ownerLogin: 'human',
      agentPasswords: [{ user: 'parallix', password: '' }],
    }, {
      interactive: false, forgejoHome: home, reviewRemoteUrlFn: () => null, log: () => {},
      requestFn(method, url, options) {
        assert.ok(options);
        calls.push(`${method} ${new URL(url).pathname}`);
        if (!url.endsWith('/users/parallix/tokens')) assert.equal(options.token, 'owner-token');
        if (method === 'GET' && url.endsWith('/users/parallix')) return { error: null, data: null,  ok: false as const, statusCode: 404 };
        if (url.endsWith('/admin/users')) {
          assert.ok(options.body && typeof options.body === 'object' && 'username' in options.body && 'must_change_password' in options.body && 'password' in options.body);
          assert.equal(options.body?.username, 'parallix');
          assert.equal(options.body?.must_change_password, false);
          assert.ok(String(options.body?.password).length >= 32);
          return { error: null, data: null,  ok: true as const, statusCode: 201 };
        }
        if (method === 'PUT') {
          assert.ok(options.body && typeof options.body === 'object' && 'permission' in options.body);
          assert.equal(options.body.permission, 'admin');
        }
        if (url.endsWith('/users/parallix/tokens')) {
          assert.equal(options.basicAuth?.user, 'parallix');
          assert.ok((options.basicAuth?.password.length ?? 0) >= 32);
          assert.equal(options.token, undefined);
          assert.ok(options.body && typeof options.body === 'object' && 'scopes' in options.body && Array.isArray(options.body.scopes));
          assert.ok(!options.body.scopes.includes('write:admin'), 'the service token receives repository privileges only');
          return { error: null,  ok: true as const, statusCode: 201, data: { sha1: 'service-token' } };
        }
        return { error: null, data: null,  ok: true as const, statusCode: 200 };
      },
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(fs.readFileSync(path.join(home, 'tokens', 'parallix'), 'utf8').trim(), 'service-token');
    assert.ok(calls.indexOf('POST /api/v1/admin/users') < calls.indexOf('PUT /api/v1/repos/human/project/collaborators/parallix'));
    assert.ok(calls.indexOf('PUT /api/v1/repos/human/project/collaborators/parallix') < calls.indexOf('POST /api/v1/users/parallix/tokens'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a rejected user lookup stops bootstrap without attempting account creation', () => {
  let calls = 0;
  const result = ensureForgejoUser('http://fixture', 'parallix', 'human', '', 'unused', () => {
    calls++;
    return { error: null,  ok: false as const, statusCode: 403, data: {} };
  }, { ownerToken: 'old-token' });
  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /failed to check Forgejo user parallix \(HTTP 403\)/);
  assert.equal(calls, 1);
});

test('setup suggests a dedicated Jev review identity without making it a coding family (TASK-2658)', async () => {
  const { suggestedForgejoUsers } = await import('../../../../src/adapters/review/setup-review-repository.js');
  const users = suggestedForgejoUsers();
  assert.ok(users.includes('jev'));
  assert.equal(users.filter(user => user === 'jev').length, 1);
});


test('owner-token provisioning reports token persistence failure without exposing it (px-0016)', async () => {
  const { tokenCreateViaOwnerToken } = await import('../../../../src/adapters/review/setup-review-auth.js');
  const result = tokenCreateViaOwnerToken('http://fixture', 'human/project', 'owner-secret',
    [{ user: 'codex', password: '' }], { owner: 'human', repo: 'project' }, {
      forgejoHome: '/fixture',
      requestFn: () => ({ ok: true, statusCode: 201, error: null, data: { sha1: 'agent-secret' } }),
      writeTokenFn: () => { throw new Error('EACCES agent-secret'); },
    });
  assert.equal(result.ok, false);
  assert.deepEqual(result.createdTokens, []);
  assert.match(result.error ?? '', /persist.*codex.*permissions.*setup-review/);
  assert.doesNotMatch(JSON.stringify(result), /agent-secret|owner-secret/);
});


test('setup provisions into the same configured Forgejo home used for lookup (px-0016)', async () => {
  const { resolveBootstrapForgejoHome } = await import('../../../../src/adapters/review/setup-review-auth.js');
  const { DEFAULT_CONFIGURATION } = await import('../../../../src/application/ports/configuration.js');
  const configuration = { ...DEFAULT_CONFIGURATION, forgejo: { ...DEFAULT_CONFIGURATION.forgejo, home: '/configured/forgejo' } };
  assert.equal(resolveBootstrapForgejoHome('/mission', undefined, configuration), '/configured/forgejo');
  assert.equal(resolveBootstrapForgejoHome('/mission', '/explicit', configuration), '/explicit');
});


test('owner-only token recovery explains a provider BasicAuth requirement without leaking its payload (px-0016)', async () => {
  const { tokenCreateViaOwnerToken } = await import('../../../../src/adapters/review/setup-review-auth.js');
  const result = tokenCreateViaOwnerToken('http://fixture', 'human/project', 'owner-secret',
    [{ user: 'codex', password: '' }], { owner: 'human', repo: 'project' }, {
      forgejoHome: '/fixture',
      requestFn: () => ({ ok: false, statusCode: 401, error: null, data: { message: 'owner-secret' } }),
      writeTokenFn: () => { throw new Error('must not persist'); },
    });
  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /Basic.*codex.*setup-review/);
  assert.doesNotMatch(JSON.stringify(result), /owner-secret/);
});


test('setup refuses unreadable token storage with an actionable diagnostic (px-0016)', async () => {
  const root = mkdtemp('setup-token-permission-');
  try {
    const home = path.join(root, 'forgejo');
    fs.mkdirSync(path.join(home, 'tokens', 'human'), { recursive: true });
    const result = await bootstrapReviewSurface(root, { baseUrl: 'http://fixture', repo: 'human/project', ownerLogin: 'human' }, {
      forgejoHome: home, interactive: false, log: () => {},
      requestFn: () => { throw new Error('must not reach provider'); },
    });
    assert.equal(result.ok, false);
    assert.match('error' in result ? result.error ?? '' : '', /permissions.*setup-review/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
