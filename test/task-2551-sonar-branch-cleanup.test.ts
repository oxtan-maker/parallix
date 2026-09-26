// TASK-2551 — post-integration deletion of the integrated mission's SonarQube
// Cloud branch analysis (ADR 0060). Hermetic: the request function is
// injected, and the CLI path is exercised through the same entrypoint the
// `delete-branch` subcommand calls plus one real subprocess without a token
// (so no network is ever reached).
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { deleteSonarBranch, deleteMissionBranch } from '../scripts/sonar-local.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function captureRequest(status: number, body: unknown = {}) {
  const calls: Array<{ url: string, init?: { method?: string, headers?: unknown } }> = [];
  const request: typeof fetch = (url, init) => {
    calls.push({ url: String(url), init });
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  };
  return { request, calls };
}

test('deleteSonarBranch issues project_branches/delete for the parallix project and exactly the mission branch', async () => {
  const { request, calls } = captureRequest(200, { deleted: true });
  await deleteSonarBranch({ token: 'operator-token', branch: 'mission/task-2551', request });
  assert.equal(calls.length, 1);
  const [call] = calls;
  assert.equal(call.url, 'https://sonarcloud.io/api/project_branches/delete?project=parallix&branch=mission%2Ftask-2551');
  assert.equal(call.init?.method, 'POST');
  assert.deepEqual(call.init?.headers, { Authorization: `Basic ${Buffer.from('operator-token:').toString('base64')}` });
});

test('deleteSonarBranch treats an already-absent branch as an idempotent no-op', async () => {
  const { request, calls } = captureRequest(404, { errors: [{ msg: 'Branch not found' }] });
  await assert.doesNotReject(deleteSonarBranch({ token: 'operator-token', branch: 'mission/gone', request }));
  assert.equal(calls.length, 1);
});

test('deleteSonarBranch surfaces any other failure', async () => {
  const { request } = captureRequest(500, { errors: [{ msg: 'boom' }] });
  await assert.rejects(
    deleteSonarBranch({ token: 'operator-token', branch: 'mission/task-2551', request }),
    /SonarQube Cloud branch deletion failed \(HTTP 500\)\./,
  );
});

test('deleteMissionBranch resolves the branch from the hook slug and the configured branch prefix', async () => {
  const { request, calls } = captureRequest(200, { deleted: true });
  const emitted: string[] = [];
  const result = await deleteMissionBranch({ slug: 'task-2551', branchPrefix: 'mission/', token: 'operator-token', request, emit: (message) => emitted.push(message) });
  assert.deepEqual(result, { ok: true });
  assert.equal(emitted.length, 0);
  assert.equal(calls[0].url, 'https://sonarcloud.io/api/project_branches/delete?project=parallix&branch=mission%2Ftask-2551');
  assert.equal(calls[1].url, 'https://sonarcloud.io/api/project_branches/delete?project=parallix&branch=candidate%2Fmission%2Ftask-2551');
});

test('deleteMissionBranch with a missing token surfaces a clear error and never invokes the request', async () => {
  const { request, calls } = captureRequest(200);
  const emitted: string[] = [];
  const result = await deleteMissionBranch({ slug: 'task-2551', branchPrefix: 'mission/', token: undefined, request, emit: (message) => emitted.push(message) });
  assert.equal(result.ok, false);
  assert.match(result.error || '', /SONAR_TOKEN is not set/);
  assert.deepEqual(emitted, [result.error]);
  assert.equal(calls.length, 0);
});

test('deleteMissionBranch surfaces a failed deletion without throwing so the hook chain stays green', async () => {
  const { request } = captureRequest(500, { errors: [{ msg: 'boom' }] });
  const emitted: string[] = [];
  const result = await deleteMissionBranch({ slug: 'task-2551', branchPrefix: 'mission/', token: 'operator-token', request, emit: (message) => emitted.push(message) });
  assert.equal(result.ok, false);
  assert.match(result.error || '', /HTTP 500/);
  assert.deepEqual(emitted, [result.error]);
});

test('the delete-branch subcommand exits 0 with a surfaced error when SONAR_TOKEN is missing', () => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', path.join(repoRoot, 'scripts', 'sonar-local.ts'), 'delete-branch'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, INTEGRATE_HOOK_SLUG: 'task-2551', SONAR_TOKEN: '' },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /SONAR_TOKEN is not set/);
});
