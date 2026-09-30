// TASK-2620 AC7: stale approvals are dismissed by the dedicated `parallix`
// Forgejo login through the review dismissal API, and setup provisions that
// login with the repository admin permission dismissal requires. Forgejo HTTP
// is injected; nothing leaves the process.
import test from 'node:test';
import assert from 'node:assert/strict';

import { dismissStandingApprovals } from '../src/adapters/forgejo/forgejo.js';
import { PARALLIX_FORGEJO_USER, suggestedForgejoUsers } from '../src/adapters/review/setup-review-repository.js';

test('every standing approval is dismissed with the reason; nothing is posted as a review', () => {
  const calls: Array<{ method: string; path: string; token: string; body: unknown }> = [];
  const apiCall = (method: string, path: string, token: string, body?: unknown) => {
    calls.push({ method, path, token, body });
    if (method === 'GET' && /^\/pulls\/[^/]+\/mission\/task-2620$/.test(path)) { return { ok: true, data: { number: 7, state: 'open' } }; }
    if (method === 'GET' && path === '/pulls/7/reviews') {
      return { ok: true, data: [
        { id: 1, state: 'APPROVED', dismissed: false, user: { login: 'codex' } },
        { id: 2, state: 'APPROVED', dismissed: true, user: { login: 'claude' } },
        { id: 3, state: 'REQUEST_CHANGES', dismissed: false, user: { login: 'custom' } },
        { id: 4, state: 'APPROVED', dismissed: false, user: { login: 'human' } },
      ] };
    }
    if (method === 'POST' && /\/dismissals$/.test(path)) { return { ok: true, data: {} }; }
    return { ok: false, statusCode: 500, data: null };
  };

  const result = dismissStandingApprovals('mission/task-2620', 'parallix-token', 'integration gate failed', { apiCall, forgejoUser: PARALLIX_FORGEJO_USER, rootDir: process.cwd() });

  assert.deepEqual(result, { ok: true, dismissed: ['codex', 'human'], errors: [] });
  const writes = calls.filter((call) => call.method !== 'GET');
  assert.deepEqual(writes.map((call) => call.path), ['/pulls/7/reviews/1/dismissals', '/pulls/7/reviews/4/dismissals']);
  assert.ok(writes.every((call) => call.token === 'parallix-token'), 'every dismissal uses the parallix token');
  assert.ok(writes.every((call) => (call.body as { message: string }).message === 'integration gate failed'));
});

test('a refused dismissal is reported, never skipped', () => {
  const apiCall = (method: string, path: string) => {
    if (method === 'GET' && /^\/pulls\/[^/]+\/mission\/task-2620$/.test(path)) { return { ok: true, data: { number: 7, state: 'open' } }; }
    if (method === 'GET') { return { ok: true, data: [{ id: 1, state: 'APPROVED', dismissed: false, user: { login: 'codex' } }] }; }
    return { ok: false, statusCode: 403, data: null };
  };
  const result = dismissStandingApprovals('mission/task-2620', 'parallix-token', 'reason', { apiCall, rootDir: process.cwd() });
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /codex's approval failed \(HTTP 403\)/);
});

test('setup provisions the parallix login alongside the agent logins', () => {
  assert.ok(suggestedForgejoUsers().includes(PARALLIX_FORGEJO_USER));
});
