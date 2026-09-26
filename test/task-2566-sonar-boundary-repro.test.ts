// TASK-2566 — red-to-green regression: the repository-owned total-code
// HIGH/BLOCKER assertion is a LOCAL MISSION verification and must apply only
// to local `mission/*` candidates. A `github-publish/<sha>` publication
// candidate is not a Parallix mission: it runs the shared scanner and the
// provider quality gate, and nothing else.
//
// Red at the pre-fix tree: the pre-fix composition (`resolveIssueScope` +
// `assertNoOpenHighOrBlockerIssues`, what the pre-fix `scan` entrypoint ran)
// applies the mission check to every resolved branch scope, so case A
// (GitHub publication) and case C (arbitrary local branch) both invoke the
// forbidden branch-type lookup and fail. The same file is green after the
// fix, where the exported `assertMissionTotalCode` orchestrator classifies
// positively via the configured mission branch prefix.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sonar = await import('../scripts/sonar-local.js');

type PostScanAssertion = (options: { token: string, rootDir?: string, request?: typeof fetch, backoffMs?: number }) => Promise<void>;

// The post-scan assertion the `scan` entrypoint runs after `runSonar()`.
// Post-fix this is the exported orchestrator; pre-fix the same orchestration
// is composed from the pre-fix exports so this file is red at the parent
// commit for the behavioural reason (the mission check is attempted) rather
// than an import error.
async function postScanAssertion(token: string, rootDir: string, request: typeof fetch, backoffMs?: number): Promise<void> {
  const mod = sonar as Record<string, unknown>;
  if (typeof mod.assertMissionTotalCode === 'function') {
    return (mod.assertMissionTotalCode as PostScanAssertion)({ token, rootDir, request, backoffMs });
  }
  const preFix = sonar as unknown as {
    resolveIssueScope: (rootDir: string) => { branch?: string, pullRequest?: string } | undefined;
    assertNoOpenHighOrBlockerIssues: (options: { token: string, scope?: unknown, request?: typeof fetch }) => Promise<void>;
  };
  const scope = preFix.resolveIssueScope(rootDir);
  return preFix.assertNoOpenHighOrBlockerIssues({ token, scope, request });
}

// Records every provider API call the assertion path attempts.
function fetchSpy(responder: (url: string) => unknown): { calls: string[], request: typeof fetch } {
  const calls: string[] = [];
  const request = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    return new Response(JSON.stringify(responder(url)));
  }) as typeof fetch;
  return { calls, request };
}

function fakeSpawn(status: number): typeof spawnSync {
  return ((command: string, args: string[]) => ({ status })) as unknown as typeof spawnSync;
}

function tempRepo(branch: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2566-sonar-'));
  // The mission boundary reads the repository's configured mission branch
  // prefix, so the temp worktree carries the same configuration the real
  // repository root has.
  fs.writeFileSync(path.join(dir, 'workflow.config.json'), JSON.stringify({ adapters: { missions: { branchPrefix: 'mission/' } } }));
  execFileSync('git', ['init', '-b', branch], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  execFileSync('git', ['commit', '--allow-empty', '-m', 'initial'], { cwd: dir });
  return dir;
}

async function withEnv(vars: Record<string, string | undefined>, fn: () => Promise<void>): Promise<void> {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) saved[key] = process.env[key];
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try { await fn(); } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('task-2566 A: a github-publish candidate scans through the provider gate without the mission total-code path', async () => {
  const publishBranch = 'github-publish/4be2630651c7c26e02c1c0f07192926f855b54a0';
  // The branch exists on the provider as SHORT (publication refs are never
  // LONG); if the mission path is attempted it must fail here.
  const spy = fetchSpy(() => ({ branches: [{ name: publishBranch, type: 'SHORT' }], component: { measures: [] } }));

  await withEnv({
    GITHUB_ACTIONS: 'true',
    GITHUB_REF: `refs/heads/${publishBranch}`,
    GITHUB_REF_NAME: publishBranch,
    SONAR_TOKEN: 'ci-token',
  }, async () => {
    // The shared scanner still runs for the publication candidate, and a
    // failed provider gate (non-zero scanner exit under
    // sonar.qualitygate.wait=true) still fails the verification.
    assert.throws(
      () => (sonar as { runSonar: (options: { rootDir?: string, spawn?: typeof spawnSync }) => unknown }).runSonar({ rootDir: repoRoot, spawn: fakeSpawn(1) }),
      /analysis or quality gate failed/,
    );
    // And no mission branch-type lookup, no LONG requirement, no total-code
    // metrics call may occur after the scan.
    await postScanAssertion('ci-token', repoRoot, spy.request);
  });

  assert.equal(spy.calls.length, 0, `no Sonar API call may occur for a publication candidate, got: ${spy.calls.join(', ')}`);
});

test('task-2566 B: a local mission candidate keeps the fail-closed total-code HIGH/BLOCKER check', async () => {
  const repo = tempRepo('mission/task-2550');
  try {
    await withEnv({ GITHUB_ACTIONS: undefined, GITHUB_REF: undefined, GITHUB_REF_NAME: undefined }, async () => {
      // A SHORT mission branch cannot provide the total-code proof: fail
      // clearly, never skip silently.
      const short = fetchSpy((url) => (url.includes('project_branches/list')
        ? { branches: [{ name: 'mission/task-2550', type: 'SHORT' }] }
        : { component: { measures: [] } }));
      await assert.rejects(postScanAssertion('t', repo, short.request), /must be analysed as LONG/);
      assert.ok(short.calls.some((url) => url.includes('project_branches/list')), 'the branch form is checked fail-closed');

      // A LONG mission branch with zero total-code HIGH/BLOCKER impacts
      // passes after the total-code metrics are actually queried.
      const clean = fetchSpy((url) => (url.includes('project_branches/list')
        ? { branches: [{ name: 'mission/task-2550', type: 'LONG' }] }
        : { component: { measures: [{ value: '{"HIGH":0,"BLOCKER":0}' }, { value: '{"HIGH":0,"BLOCKER":0}' }, { value: '{"HIGH":0,"BLOCKER":0}' }] } }));
      await postScanAssertion('t', repo, clean.request);
      assert.ok(clean.calls.some((url) => url.includes('measures/component')), 'the total-code metrics are queried for the mission candidate');

      // A LONG mission branch with any HIGH or BLOCKER impact fails.
      const dirty = fetchSpy((url) => (url.includes('project_branches/list')
        ? { branches: [{ name: 'mission/task-2550', type: 'LONG' }] }
        : { component: { measures: [{ value: '{"HIGH":1,"BLOCKER":0}' }, { value: '{}' }, { value: '{}' }] } }));
      await assert.rejects(postScanAssertion('t', repo, dirty.request), /unresolved HIGH\/BLOCKER impacts/);
    });
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('task-2566 C: a local non-mission branch is not classified as a mission', async () => {
  const repo = tempRepo('experiment/foo');
  try {
    const spy = fetchSpy(() => ({ branches: [{ name: 'experiment/foo', type: 'SHORT' }], component: { measures: [] } }));
    await withEnv({ GITHUB_ACTIONS: undefined, GITHUB_REF: undefined, GITHUB_REF_NAME: undefined }, async () => {
      await postScanAssertion('t', repo, spy.request);
    });
    assert.equal(spy.calls.length, 0, `not running on GitHub is not a mission; got calls: ${spy.calls.join(', ')}`);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('task-2566 D: pull-request analysis gets no mission total-code call', async () => {
  const spy = fetchSpy(() => ({ branches: [], component: { measures: [] } }));
  await withEnv({ GITHUB_ACTIONS: 'true', GITHUB_REF: 'refs/pull/123/merge', GITHUB_REF_NAME: 'main' }, async () => {
    await postScanAssertion('ci-token', repoRoot, spy.request);
  });
  assert.equal(spy.calls.length, 0, `pull requests are diff-only; got calls: ${spy.calls.join(', ')}`);
});

// A provider read stub that fails with 502 on the first call (fail='first')
// or every call (fail='always'), and otherwise answers the branch list and
// total-code metrics for a clean LONG mission branch.
function flakyRequest(fail: 'first' | 'always'): { count: number, request: typeof fetch } {
  let count = 0;
  const request = (async (input: string | URL | Request) => {
    count += 1;
    if (fail === 'always' || count === 1) { return new Response('bad gateway', { status: 502 }); }
    const url = String(input);
    return new Response(JSON.stringify(url.includes('project_branches/list')
      ? { branches: [{ name: 'mission/task-2550', type: 'LONG' }] }
      : { component: { measures: [{ value: '{"HIGH":0,"BLOCKER":0}' }, { value: '{"HIGH":0,"BLOCKER":0}' }, { value: '{"HIGH":0,"BLOCKER":0}' }] } }));
  }) as typeof fetch;
  return { get count() { return count; }, request };
}

test('task-2566 E: a transient provider 5xx is retried and a persistent one still fails closed', async () => {
  const repo = tempRepo('mission/task-2550');
  try {
    await withEnv({ GITHUB_ACTIONS: undefined, GITHUB_REF: undefined, GITHUB_REF_NAME: undefined }, async () => {
      // A single 502 on the first read is retried; the assertion passes and
      // the metrics read then runs once.
      const transient = flakyRequest('first');
      await postScanAssertion('t', repo, transient.request, 0);
      assert.equal(transient.count, 3, `branch list (502, ok) + metrics (ok); got ${transient.count} calls`);

      // A persistent 502 is retried the bounded number of times, then fails
      // closed on the branch lookup.
      const persistent = flakyRequest('always');
      await assert.rejects(postScanAssertion('t', repo, persistent.request, 0), /branch lookup failed \(HTTP 502\)/);
      assert.equal(persistent.count, 3, `bounded attempts, then fail closed; got ${persistent.count} calls`);
    });
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
