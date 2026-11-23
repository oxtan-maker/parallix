import { forgejoApiFixture, forgejoAsyncApiFixture } from '../../fixtures/forgejo-api.js';
// Local publication delegates verification to explicit lifecycle gates and CI.
// Real Git fixture; remote pushes and Forgejo calls remain isolated doubles.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { initCommittedRepository } from '../../fixtures/git-repository.js';
import { resolveConfiguration } from '../../../src/composition/config.js';
import { runPhaseGates } from '../../../src/adapters/config/repository-gates.js';
import { createIntegrationVerificationEvidencePort } from '../../../src/adapters/verification/integration-verification-proof.js';
import { missionId } from '../../../src/domain/mission.js';
import { mockModule, installModuleMocks } from '../../lib/module-mock.js';
const git = mockModule<typeof import('../../../src/adapters/git/git.js')>('../../../src/adapters/git/git.js', import.meta.url);
const pr = mockModule<typeof import('../../../src/adapters/forgejo/forgejo-pr.js')>('../../../src/adapters/forgejo/forgejo-pr.js', import.meta.url);
await installModuleMocks();

test('PR publication mirrors baseline without running implicit verification (TASK-2715)', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'px-local-publication-'));
  const marker = path.join(root, 'unexpected-verification');
  const pushes: string[][] = [];
  try {
    initCommittedRepository(root, {
      'workflow.config.json': JSON.stringify({ adapters: {
        verification: { command: 'node -e "require(\'fs\').writeFileSync(\'unexpected-verification\',\'ran\');process.exit(7)"' },
        missions: { primaryBranch: 'main' },
        review: { provider: 'forgejo', baseUrl: 'http://localhost:3300', remote: 'review', repo: 'test-org/test-repo' },
      } }),
    });
    t.mock.method(git, 'git', (args: string[]) => {
      if (args.includes('push')) { pushes.push(args); return { status: 0, signal: null, stdout: '', stderr: '' }; }
      const result = spawnSync('git', args, { encoding: 'utf8' });
      return { ...result, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
    });
    const result = pr.createPr('mission/task-9999', 'fixture', 'fixture-token', {
      rootDir: root, log: () => {},
      apiCall: forgejoApiFixture((method: string) => method === 'GET'
        ? { ok: true, data: [] }
        : { ok: true, data: { number: 1, html_url: 'http://localhost:3300/test-org/test-repo/pulls/1' } }),
    });
    assert.equal(result.ok, true, result.error ?? 'PR creation failed');
    assert.equal(fs.existsSync(marker), false, 'publication must not execute the configured verifier');
    assert.equal(pushes.length, 2, 'mirror primary and push mission without another test gate');
    assert.ok(pushes.some(args => args.includes('main:main')));
    assert.ok(pushes.some(args => args.includes('mission/task-9999')));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

for (const author of ['codex', 'claude', 'test-org']) {
  test(`existing PR author ${author} survives implementation ownership changes (TASK-2804)`, t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'px-pr-author-'));
    try {
      initCommittedRepository(root, { 'workflow.config.json': JSON.stringify({ adapters: {
        review: { provider: 'forgejo', baseUrl: 'http://localhost:3300', remote: 'review', repo: 'test-org/test-repo' },
      } }) });
      t.mock.method(git, 'git', (args: string[]) => {
        if (args.includes('push')) { return { status: 0, signal: null, stdout: '', stderr: '' }; }
        const result = spawnSync('git', args, { encoding: 'utf8' });
        return { ...result, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
      });
      const existing = { number: 739, html_url: 'http://fixture/pulls/739', user: { login: author },
        head: { ref: 'mission/task-9999' }, base: { ref: 'main' } };
      const result = pr.createPr('mission/task-9999', 'codex', 'codex-token', {
        rootDir: root, log: () => {}, apiCall: forgejoApiFixture((method, endpoint) => {
          assert.equal(method, 'GET', 'do not create duplicate PRs');
          return { ok: true, data: endpoint === '/pulls/739' ? existing : [existing] };
        }),
      });
      assert.equal(result.ok, true, result.error ?? 'publication result');
      assert.equal(result.prNumber, 739);
      assert.equal(result.url, existing.html_url);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
}

type Posted = { method: string; endpoint: string; body: { state?: string; context?: string; description?: string; body?: string } };

/** A recording Forgejo double: commit statuses per sha, one open PR for the mission branch, and its comments. */
function gateReportForgejo(branch: string, head: () => string, faults: {
  otherPulls?: number; unreadable?: RegExp;
  /** Blocks the first matching call until `until` settles, standing in for a publication that overlaps another run. */
  pause?: { matches: (_method: string, _endpoint: string, _body: Posted['body']) => boolean; onArrive: () => void; until: Promise<void> };
} = {}) {
  const posts: Posted[] = [];
  const statuses = new Map<string, { context: string; state: string; description: string }[]>();
  const comments: { id: number; body: string }[] = [];
  let paused = false;
  const apiCall = forgejoAsyncApiFixture(async (method, endpoint, _token, body) => {
    const payload = (body ?? {}) as Posted['body'];
    if (!paused && faults.pause?.matches(method, endpoint, payload)) {
      paused = true;
      faults.pause.onArrive();
      await faults.pause.until;
    }
    if (method !== 'GET') { posts.push({ method, endpoint, body: payload }); }
    if (method === 'GET' && faults.unreadable?.test(endpoint)) { return { ok: false, error: 'unreadable' }; }
    const page = Number(/page=(\d+)/.exec(endpoint)?.[1] ?? 1);
    const sha = /\/(?:commits|statuses)\/([0-9a-f]{40})/.exec(endpoint)?.[1];
    // Forgejo lists a commit's statuses oldest first and names each state `status` (measured on 14.0.3).
    if (method === 'GET' && sha) {
      return { ok: true, data: (statuses.get(sha) ?? []).map(entry => ({ context: entry.context, status: entry.state, description: entry.description })) };
    }
    if (method === 'POST' && sha) { statuses.set(sha, [...(statuses.get(sha) ?? []), payload as { context: string; state: string; description: string }]); return { ok: true, data: {} }; }
    if (method === 'GET' && endpoint.startsWith('/pulls')) {
      const open = [...Array.from({ length: faults.otherPulls ?? 0 }, (_, index) => ({ number: 100 + index, head: { ref: `mission/other-${index}` } })),
        { number: 7, head: { ref: branch, sha: head() } }];
      return { ok: true, data: open.slice((page - 1) * 50, page * 50) };
    }
    if (method === 'GET' && endpoint.startsWith('/issues/7/comments')) { return { ok: true, data: comments }; }
    if (method === 'POST' && endpoint === '/issues/7/comments') { comments.push({ id: comments.length + 1, body: payload.body! }); return { ok: true, data: {} }; }
    const edited = /^\/issues\/comments\/(\d+)$/.exec(endpoint);
    if (method === 'PATCH' && edited) { comments[Number(edited[1]) - 1]!.body = payload.body!; return { ok: true, data: {} }; }
    return { ok: false, error: `unexpected ${method} ${endpoint}` };
  });
  return { apiCall, posts, statuses, comments };
}

const REPORT_GATES = [
  { key: 'verification', command: 'verify', order: 1 },
  { key: 'quality-gate', command: 'quality', order: 2 },
  { key: 'integration-ci', command: 'ci', order: 3, after: ['quality-gate'] },
];

/** A real checkout with the three-gate plan, a Forgejo double and the production publisher over it. */
async function gateReportRun(t: TestContext, qualityExit: number, planned = REPORT_GATES) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'px-gate-report-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const slug = 'task-2870';
  const repo = initCommittedRepository(root, { 'workflow.config.json': JSON.stringify({ adapters: {
    gates: { preIntegration: REPORT_GATES },
    review: { provider: 'forgejo', baseUrl: 'http://localhost:3300', remote: 'review', repo: 'test-org/test-repo' },
  } }) });
  const forgejoHome = path.join(root, '.git', 'forgejo-home');
  fs.mkdirSync(path.join(forgejoHome, 'tokens'), { recursive: true });
  fs.writeFileSync(path.join(forgejoHome, 'tokens', 'parallix'), 'fixture-token\n');
  const base = resolveConfiguration({ ...process.env, PARALLIX_HOME: path.join(root, '.git', 'home') });
  const configuration = { ...base, forgejo: { ...base.forgejo, home: forgejoHome } };
  const forgejo = gateReportForgejo(`mission/${slug}`, () => repo.git('rev-parse', 'HEAD').trim());
  const { createGateRunReportPublisher } = await import('../../../src/adapters/review/review-adapter.js');
  const commandRunner = (command: string) => command === 'quality' && qualityExit !== 0
    ? { status: qualityExit, stdout: '', stderr: `token=abcdefghijklmnopqrstuvwxyz123456\n${'x'.repeat(3000)}` }
    : { status: 0, stdout: '', stderr: '' };
  const result = () => runPhaseGates('integration', { slug, checkoutPath: root, gates: planned, commandRunner, configuration, log: () => {}, error: () => {},
    verificationEvidence: createIntegrationVerificationEvidencePort(configuration, null, undefined, createGateRunReportPublisher(configuration, forgejo.apiCall)) });
  return { repo, forgejo, root, result };
}

test('a failed concurrent gate run publishes one revision-bound result naming every configured gate (TASK-2870.01)', async t => {
  const { repo, forgejo, result } = await gateReportRun(t, 3);
  const tested = repo.git('rev-parse', 'HEAD').trim();
  assert.equal((await result()).ok, false);
  const statuses = forgejo.statuses.get(tested) ?? [];
  assert.deepEqual(statuses.map(status => status.state), ['pending', 'failure'], 'one result on the tested revision settles from pending to failure');
  assert.ok(statuses.every(status => status.context === 'parallix/pre-integration'));
  assert.match(statuses[1]!.description, /^Failed: quality-gate · run [0-9a-f]{8} @ /, 'the failed gate is named by its configured key');
  assert.equal(forgejo.comments.length, 1, 'the run owns one comment that settles in place');
  const comment = forgejo.comments[0]!.body;
  assert.match(comment, new RegExp(`Tested revision \`${tested.slice(0, 12)}\``));
  assert.match(comment, /\| verification \| ✓ passed \|/);
  assert.match(comment, /\| quality-gate \| ✗ failed \(exit 3\) \|/);
  assert.match(comment, /\| integration-ci \| ⊘ blocked by quality-gate \|/, 'a blocked gate is not a failed gate');
  assert.doesNotMatch(comment, /abcdefghijklmnopqrstuvwxyz123456/, 'credentials are redacted');
  assert.ok(comment.length < 2000, 'diagnostics are bounded');
});

test('a passing repair run publishes on its own revision and leaves the earlier verdict alone (TASK-2870.01)', async t => {
  const { repo, forgejo, root, result } = await gateReportRun(t, 0);
  const earlier = repo.git('rev-parse', 'HEAD').trim();
  const prior = { context: 'parallix/pre-integration', state: 'failure', description: 'Failed: quality-gate · run 00000000 @ 2026-01-01T00:00:00.000Z' };
  forgejo.statuses.set(earlier, [prior]);
  fs.writeFileSync(path.join(root, 'repair.txt'), 'fix\n');
  repo.git('add', 'repair.txt');
  repo.git('commit', '-m', 'repair');
  const repaired = repo.git('rev-parse', 'HEAD').trim();
  assert.equal((await result()).ok, true);
  assert.deepEqual((forgejo.statuses.get(repaired) ?? []).map(status => status.state), ['pending', 'success']);
  assert.deepEqual(forgejo.statuses.get(earlier), [prior], 'the earlier revision keeps its own verdict');
  assert.match(forgejo.comments[0]!.body, /Pre-integration gates: passed/);
});

test('a late older gate run cannot supersede a newer run on the same revision (TASK-2870.01)', async () => {
  const { publishGateRunReport } = await import('../../../src/adapters/forgejo/forgejo-gate-report.js');
  const revision = 'a'.repeat(40);
  const forgejo = gateReportForgejo('mission/task-2870', () => revision);
  const options = { branch: 'mission/task-2870', token: 'fixture-token', apiCall: forgejo.apiCall };
  const report = (gateRunId: string, startedAt: string, state: 'running' | 'passed' | 'failed') => ({
    missionId: missionId('task-2870'), gateRunId, revision, startedAt, finishedAt: null, state,
    gates: [{ key: 'verification', outcome: state === 'failed' ? 'failed' as const : 'pending' as const, exitCode: null, blockedBy: [], diagnostics: null }],
  });
  await publishGateRunReport(report('11111111-aaaa', '2026-11-23T10:05:00.000Z', 'running'), options);
  const before = forgejo.posts.length;
  await publishGateRunReport(report('00000000-bbbb', '2026-11-23T10:00:00.000Z', 'failed'), options);
  assert.equal(forgejo.posts.length, before, 'the older run publishes nothing after the newer run reported');
  assert.deepEqual((forgejo.statuses.get(revision) ?? []).map(status => status.state), ['pending']);
});

test('an older run overlapping a newer publication holds the revision slot so the newer verdict stands (TASK-2870.01)', async () => {
  const { publishGateRunReport } = await import('../../../src/adapters/forgejo/forgejo-gate-report.js');
  const revision = 'd'.repeat(40);
  let markArrived!: () => void;
  const arrived = new Promise<void>(resolve => { markArrived = resolve; });
  let release!: () => void;
  const forgejo = gateReportForgejo('mission/task-2870', () => revision, {
    pause: {
      matches: (method, endpoint, body) => method === 'POST' && endpoint === `/statuses/${revision}`
        && body.description?.includes('run 00000000') === true,
      onArrive: markArrived,
      until: new Promise<void>(resolve => { release = resolve; }),
    },
  });
  const options = { branch: 'mission/task-2870', token: 'fixture-token', apiCall: forgejo.apiCall };
  // The older run is inside its status write; a newer publication must not slip its verdict in beside it.
  const older = publishGateRunReport(gateRunReportOn(revision, '00000000-bbbb', '2026-11-23T10:00:00.000Z', 'failed'), options);
  await arrived;
  const newer = publishGateRunReport(gateRunReportOn(revision, '11111111-aaaa', '2026-11-23T10:05:00.000Z', 'running'), options);
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.deepEqual(statusPosts(forgejo, revision), [], 'the newer run waits for the slot instead of interleaving with the older write');
  release();
  assert.equal((await older).ok, true, 'the older run still reports its own publication');
  assert.equal((await newer).ok, true);
  assert.deepEqual(statusPosts(forgejo, revision), ['00000000', '11111111'], 'the two publications land one after the other');
  assert.deepEqual((forgejo.statuses.get(revision) ?? []).map(status => status.state), ['failure', 'pending']);
  const shown = (forgejo.statuses.get(revision) ?? []).at(-1)!;
  assert.equal(shown.state, 'pending');
  assert.match(shown.description, /run 11111111 @ /, 'the newest run keeps the verdict Forgejo shows');
});

test('an older run replays nothing over the newest run\'s settled verdict (TASK-2870.01)', async () => {
  const { publishGateRunReport } = await import('../../../src/adapters/forgejo/forgejo-gate-report.js');
  const revision = 'e'.repeat(40);
  const forgejo = gateReportForgejo('mission/task-2870', () => revision);
  forgejo.statuses.set(revision, [
    { context: 'parallix/pre-integration', state: 'pending', description: 'Running · run 11111111 @ 2026-11-23T10:05:00.000Z' },
    { context: 'parallix/pre-integration', state: 'success', description: 'Passed · run 11111111 @ 2026-11-23T10:05:00.000Z' },
  ]);
  const result = await publishGateRunReport(gateRunReportOn(revision, '00000000-bbbb', '2026-11-23T10:00:00.000Z', 'failed'),
    { branch: 'mission/task-2870', token: 'fixture-token', apiCall: forgejo.apiCall });
  assert.equal(result.ok, true, 'a superseded run reports its publication without touching the slot');
  assert.deepEqual((forgejo.statuses.get(revision) ?? []).map(status => status.state), ['pending', 'success'],
    'no cached status is written back over the settled verdict');
  assert.equal(forgejo.comments.length, 0);
});

/** Which runs wrote a status on this revision, in write order. */
function statusPosts(forgejo: { posts: Posted[] }, revision: string): (string | undefined)[] {
  return forgejo.posts.filter(post => post.endpoint === `/statuses/${revision}`)
    .map(post => /run ([0-9a-f]{8})/.exec(post.body.description ?? '')?.[1]);
}

test('a run replaced before it settled is reported interrupted (TASK-2870.01)', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'px-gate-report-interrupted-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const gates = [{ key: 'verification', command: 'true' }];
  initCommittedRepository(root, { 'workflow.config.json': JSON.stringify({ adapters: { gates: { preIntegration: gates.map((gate, order) => ({ ...gate, order })) } } }) });
  const reports: { gateRunId: string; state: string }[] = [];
  const port = createIntegrationVerificationEvidencePort(undefined, null, undefined, { publish: async (_root, report) => { reports.push(report); } });
  const context = { missionId: missionId('task-2870'), operatorInvocation: false };
  await port.start(root, gates, context);
  await port.start(root, gates, context);
  assert.deepEqual(reports.map(report => report.state), ['running', 'interrupted', 'running']);
  assert.equal(reports[0]!.gateRunId, reports[1]!.gateRunId);
  assert.notEqual(reports[2]!.gateRunId, reports[0]!.gateRunId);
});

test('an interrupted partial explicit-integration run still lists every configured gate (TASK-2870.01)', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'px-gate-report-interrupted-partial-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const configured = [{ key: 'verification', command: 'true' }, { key: 'quality-gate', command: 'true' }, { key: 'integration-ci', command: 'true' }];
  initCommittedRepository(root, { 'workflow.config.json': JSON.stringify({ adapters: {
    gates: { preIntegration: configured.map((gate, order) => ({ ...gate, order })) },
  } }) });
  const reports: { state: string; gates: readonly { key: string; outcome: string }[] }[] = [];
  const port = createIntegrationVerificationEvidencePort(undefined, null, undefined, { publish: async (_root, report) => { reports.push(report); } });
  const context = { missionId: missionId('task-2870'), operatorInvocation: false };
  // An explicit integration reruns one configured gate; a newer run replaces that run before it settles.
  await port.start(root, [configured[2]!], context);
  await port.start(root, configured, context);
  const interrupted = reports.find(report => report.state === 'interrupted')!;
  assert.deepEqual(interrupted.gates.map(gate => `${gate.key}=${gate.outcome}`),
    ['verification=validated', 'quality-gate=validated', 'integration-ci=not-run'],
    'an interrupted run stays readable as the full configured plan, not only the gate it reran');
});

test('a replaced run keeps the plan it started on when the configured gates change (TASK-2870.01)', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'px-gate-report-plan-change-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const planOf = (keys: string[]) => keys.map((key, order) => ({ key, command: 'true', order }));
  const config = (gates: { key: string; command: string; order: number }[]) =>
    JSON.stringify({ adapters: { gates: { preIntegration: gates } } });
  const before = planOf(['verification', 'integration-ci']);
  const after = planOf(['integration-ci', 'security-scan']);
  initCommittedRepository(root, { 'workflow.config.json': config(before) });
  const reports: { state: string; gates: readonly { key: string; outcome: string }[] }[] = [];
  const port = createIntegrationVerificationEvidencePort(undefined, null, undefined, { publish: async (_root, report) => { reports.push(report); } });
  const context = { missionId: missionId('task-2870'), operatorInvocation: false };
  // A partial rerun stays unsettled while a later revision reconfigures the plan and replaces it.
  await port.start(root, [before[1]!], context);
  fs.writeFileSync(path.join(root, 'workflow.config.json'), config(after));
  await port.start(root, after, context);
  const interrupted = reports.find(report => report.state === 'interrupted')!;
  assert.deepEqual(interrupted.gates.map(gate => `${gate.key}=${gate.outcome}`), ['verification=validated', 'integration-ci=not-run'],
    'the replaced run is reported on its own plan: no prior key is dropped and no later key is credited to it');
});

test('an explicit integration that skipped validated gates still lists every configured gate (TASK-2870.01)', async t => {
  const { forgejo, result } = await gateReportRun(t, 0, [{ key: 'integration-ci', command: 'ci', order: 3 }]);
  assert.equal((await result()).ok, true);
  for (const comment of forgejo.comments) {
    assert.match(comment.body, /\| verification \| ✓ validated earlier, not rerun \|/);
    assert.match(comment.body, /\| quality-gate \| ✓ validated earlier, not rerun \|/);
    assert.match(comment.body, /\| integration-ci \| ✓ passed \|/);
  }
  assert.equal(forgejo.comments.length, 1);
});

/** A report for one run on one revision; `startedAt` orders it against other runs. */
function gateRunReportOn(revision: string, gateRunId: string, startedAt: string, state: 'running' | 'passed' | 'failed') {
  return { missionId: missionId('task-2870'), gateRunId, revision, startedAt, finishedAt: null, state,
    gates: [{ key: 'verification', outcome: state === 'failed' ? 'failed' as const : 'pending' as const, exitCode: null, blockedBy: [], diagnostics: null }] };
}

test('an unreadable provider read publishes nothing instead of guessing (TASK-2870.01)', async () => {
  const { publishGateRunReport } = await import('../../../src/adapters/forgejo/forgejo-gate-report.js');
  const revision = 'b'.repeat(40);
  for (const unreadable of [/commits\/.*\/statuses/, /^\/pulls/, /^\/issues\/7\/comments/]) {
    const forgejo = gateReportForgejo('mission/task-2870', () => revision, { unreadable });
    const result = await publishGateRunReport(gateRunReportOn(revision, '22222222-cccc', '2026-11-23T10:00:00.000Z', 'running'),
      { branch: 'mission/task-2870', token: 'fixture-token', apiCall: forgejo.apiCall });
    assert.equal(result.ok, false, `${unreadable} must fail the publication`);
    assert.deepEqual(forgejo.posts, [], `${unreadable} leaves no partial status or duplicate comment`);
  }
});

test('the mission pull request is found beyond the first page of open pulls (TASK-2870.01)', async () => {
  const { publishGateRunReport } = await import('../../../src/adapters/forgejo/forgejo-gate-report.js');
  const revision = 'c'.repeat(40);
  const forgejo = gateReportForgejo('mission/task-2870', () => revision, { otherPulls: 60 });
  const options = { branch: 'mission/task-2870', token: 'fixture-token', apiCall: forgejo.apiCall };
  assert.equal((await publishGateRunReport(gateRunReportOn(revision, '33333333-dddd', '2026-11-23T10:00:00.000Z', 'running'), options)).ok, true);
  assert.equal((await publishGateRunReport(gateRunReportOn(revision, '33333333-dddd', '2026-11-23T10:00:00.000Z', 'passed'), options)).ok, true);
  assert.equal(forgejo.comments.length, 1, 'the run comment settles in place on the later page');
  assert.match(forgejo.comments[0]!.body, /Pre-integration gates: passed/);
});
