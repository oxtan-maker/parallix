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
      requestFn(method: string, url: string, options: { token?: string; body?: Record<string, unknown> }) {
        calls.push(`${method} ${new URL(url).pathname}`);
        assert.equal(options.token, 'owner-token');
        if (method === 'GET' && url.endsWith('/users/parallix')) return { ok: false, statusCode: 404 };
        if (url.endsWith('/admin/users')) {
          assert.equal(options.body?.username, 'parallix');
          assert.equal(options.body?.must_change_password, false);
          assert.ok(String(options.body?.password).length >= 32);
          return { ok: true, statusCode: 201 };
        }
        if (method === 'PUT') assert.equal(options.body?.permission, 'admin');
        if (url.endsWith('/users/parallix/tokens')) {
          assert.ok(!(options.body?.scopes as string[]).includes('write:admin'), 'the service token receives repository privileges only');
          return { ok: true, statusCode: 201, data: { sha1: 'service-token' } };
        }
        return { ok: true, statusCode: 200 };
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
    return { ok: false, statusCode: 403, data: {} };
  }, { ownerToken: 'old-token' });
  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /failed to check Forgejo user parallix \(HTTP 403\)/);
  assert.equal(calls, 1);
});
