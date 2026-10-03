import test from 'node:test';
import assert from 'node:assert/strict';
import { assertGithubPublicationProof, findGithubPublicationProof, githubApiRequest } from '../scripts/verify-github-publication-proof.js';

const sha = 'a'.repeat(40);
const beforeMain = '2026-09-26T10:00:00Z';

function proofRun(overrides: Record<string, unknown> = {}) {
  return {
    id: 123,
    path: '.github/workflows/ci-required.yml',
    event: 'push',
    head_sha: sha,
    head_branch: `github-publish/${sha}`,
    status: 'completed',
    conclusion: 'success',
    updated_at: '2026-09-26T09:59:59Z',
    ...overrides,
  };
}

function requestFor(run: Record<string, unknown> | null, jobs: unknown = { jobs: [{ name: 'ci-required', status: 'completed', conclusion: 'success', completed_at: '2026-09-26T09:59:58Z' }] }) {
  return async (apiPath: string): Promise<unknown> => {
    if (apiPath.includes(`/actions/runs/456`)) {
      return { id: 456, path: '.github/workflows/ci-required.yml', event: 'push', head_sha: sha, head_branch: 'main', created_at: beforeMain };
    }
    if (apiPath.includes('/workflows/ci-required.yml/runs')) return { workflow_runs: run ? [run] : [] };
    if (apiPath.includes('/actions/runs/123/jobs')) return jobs;
    throw new Error(`unexpected path ${apiPath}`);
  };
}

async function proof(run: Record<string, unknown> | null, jobs?: unknown) {
  return assertGithubPublicationProof({ repository: 'oxtan-maker/parallix', sha, currentRunId: '456', request: requestFor(run, jobs) });
}

test('task-2585: accepts only an earlier successful exact github-publish ci-required proof', async () => {
  assert.deepEqual(await proof(proofRun()), { runId: 123 });
});

test('task-2585: rejects wrong workflow identity, event, SHA, branch, status, and timing', async () => {
  for (const change of [
    { path: '.github/workflows/other.yml' },
    { event: 'pull_request' },
    { head_sha: 'b'.repeat(40) },
    { head_branch: 'main' },
    { status: 'in_progress', conclusion: null },
    { conclusion: 'cancelled' },
    { updated_at: beforeMain },
  ]) {
    await assert.rejects(proof(proofRun(change)), /proof was not found/);
  }
});

test('task-2585: refuses to treat a pull request or non-main current run as release authority', async () => {
  for (const current of [
    { id: 456, path: '.github/workflows/ci-required.yml', event: 'pull_request', head_sha: sha, head_branch: 'main', created_at: beforeMain },
    { id: 456, path: '.github/workflows/ci-required.yml', event: 'push', head_sha: sha, head_branch: 'github-publish/x', created_at: beforeMain },
  ]) {
    await assert.rejects(assertGithubPublicationProof({
      repository: 'oxtan-maker/parallix', sha, currentRunId: '456', request: async (apiPath) => apiPath.includes('/actions/runs/456') ? current : { workflow_runs: [] },
    }), /current main push/);
  }
});

test('task-2585: rejects a same-name job that is pending, failed, cancelled, or missing', async () => {
  for (const jobs of [
    { jobs: [] },
    { jobs: [{ name: 'ci-required', status: 'in_progress', conclusion: null }] },
    { jobs: [{ name: 'ci-required', status: 'completed', conclusion: 'failure' }] },
    { jobs: [{ name: 'ci-required', status: 'completed', conclusion: 'cancelled' }] },
  ]) {
    await assert.rejects(proof(proofRun(), jobs), /proof was not found/);
  }
});

test('task-2585: rejects missing proof and unavailable or malformed GitHub API data', async () => {
  await assert.rejects(proof(null), /proof was not found/);
  await assert.rejects(assertGithubPublicationProof({
    repository: 'oxtan-maker/parallix', sha, currentRunId: '456', request: async () => { throw new Error('offline'); },
  }), /lookup failed: offline/);
  await assert.rejects(assertGithubPublicationProof({
    repository: 'oxtan-maker/parallix', sha, currentRunId: '456', request: async () => ({ unexpected: true }),
  }), /invalid workflow-run data/);
});

test('task-2585: GitHub API client is read-only and fails closed on provider errors', async () => {
  let method: string | undefined;
  const request = githubApiRequest('token', async (_url, init) => {
    method = init?.method;
    return new Response('unavailable', { status: 503 });
  });
  await assert.rejects(request('/repos/oxtan-maker/parallix/actions/runs/1'), /HTTP 503/);
  assert.equal(method, undefined, 'the proof reader makes no mutating HTTP request');
});

test('task-2585: ordinary PR merge has no reusable proof and requires full main verification', async () => {
  assert.equal(await findGithubPublicationProof({ repository: 'oxtan-maker/parallix', sha, currentRunId: '456', request: requestFor(null) }), null);
  assert.equal(await findGithubPublicationProof({ repository: 'oxtan-maker/parallix', sha, currentRunId: '456', request: requestFor(proofRun({ event: 'pull_request' })) }), null);
});

test('task-2585: accepts API workflow paths with ref suffix and real job completion evidence', async () => {
  assert.deepEqual(await proof(proofRun({ path: '.github/workflows/ci-required.yml@github-publish/' + sha })), { runId: 123 });
  await assert.rejects(proof(proofRun(), { jobs: [{ name: 'ci-required', status: 'completed', conclusion: 'success', completed_at: beforeMain }] }), /proof was not found/);
  await assert.rejects(proof(proofRun({ updated_at: undefined })), /timestamp is unavailable/);
});
