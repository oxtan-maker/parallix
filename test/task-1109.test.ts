
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'node:os';
import path from 'path';
import { mockModule, installModuleMocks } from './lib/module-mock.js';
import { createRequire } from 'node:module';
const _require = createRequire(import.meta.url);
const gitModule = mockModule<typeof import('../src/adapters/git/git.js')>('../src/adapters/git/git.js', import.meta.url);
const missionUtilsModule = mockModule<typeof import('../src/adapters/filesystem/mission-utils.js')>('../src/adapters/filesystem/mission-utils.js', import.meta.url);
const backlogModule = mockModule<typeof import('../src/adapters/backlog/backlog.js')>('../src/adapters/backlog/backlog.js', import.meta.url);
const forgejoModule = mockModule<typeof import('../src/adapters/forgejo/forgejo.js')>('../src/adapters/forgejo/forgejo.js', import.meta.url);
const runtimeMatrixModule = mockModule<typeof import('../src/adapters/agents/runtime-matrix.js')>('../src/adapters/agents/runtime-matrix.js', import.meta.url);
const statsModule = mockModule<typeof import('../src/adapters/cli/commands/stats.js')>('../src/adapters/cli/commands/stats.js', import.meta.url);
const __mm1 = mockModule<typeof import('../src/composition/application-services.js')>('../src/composition/application-services.js', import.meta.url);
const __mm2 = mockModule<typeof import('../src/adapters/cli/commands/integrate.js')>('../src/adapters/cli/commands/integrate.js', import.meta.url);
await installModuleMocks();
const { mock } = test;

const git = gitModule;
const missionUtils = missionUtilsModule;
const backlog = backlogModule;
const forgejo = forgejoModule;
const runtimeMatrix = runtimeMatrixModule;
const stats = statsModule;
const composition = __mm1;

const TEST_SLUG = 'task-integrate-v2';
const FAKE_ROOT = path.join(os.tmpdir(), `integrate-v2-root-${process.pid}`);
let statsCalls = [];

// The integrate module's command entry point is its default export; its
// helpers are named exports. Expose both through the ESM mock facade so the
// existing call sites (`integrate([...])` and `integrate.resolveConflicts...`)
// keep working without a writable CommonJS `exports` object.
function loadIntegrate() {
// @ts-expect-error -- TASK-2328: partial test double after ESM seam migration
  return Object.assign((...args) => __mm2.default(...args), __mm2);
}

function setupMocks() {
  statsCalls = [];
  // TASK-2322.12: Allow --no-integration-gates in tests
  process.env.PARALLIX_TEST_ALLOW_INTEGRATION_GATE_BYPASS = '1';
  mock.method(backlog, 'getTaskClassification', () => 'ai_sdlc');
  mock.method(missionUtils, 'getPrimaryBranch', () => 'main');
  mock.method(missionUtils, 'inferSlug', (s) => s || TEST_SLUG);
  mock.method(missionUtils, 'findMissionDir', () => path.join(FAKE_ROOT, 'docs/missions/2026', TEST_SLUG));
  mock.method(missionUtils, 'findMissionArea', () => 'docs');
  mock.method(missionUtils, 'getPrimaryWorktree', () => FAKE_ROOT);
  mock.method(missionUtils, 'conventionalWorktreePath', () => path.join(FAKE_ROOT, '..', TEST_SLUG));
  mock.method(missionUtils, 'resolveMainRepo', () => FAKE_ROOT);
  mock.method(missionUtils, 'missionTitle', () => 'Test Mission');
  mock.method(missionUtils, 'updateGraphifyKnowledgeGraph', () => false);
  mock.method(git, 'getCurrentBranch', () => 'mission/' + TEST_SLUG);
  mock.method(git, 'git', (args) => {
    if (args.includes('branch') && args.includes('--list')) return { status: 0, stdout: 'main\n', stderr: '' };
    if (args.includes('branch') && args.includes('--show-current')) return { status: 0, stdout: 'main', stderr: '' };
    if (args.includes('status')) return { status: 0, stdout: '', stderr: '' };
    if (args.includes('merge')) return { status: 0, stdout: '', stderr: '' };
    if (args.includes('rev-parse')) return { status: 0, stdout: 'deadbeef', stderr: '' };
    if (args.includes('show')) return { status: 0, stdout: '2026-05-15T12:00:00+02:00\n', stderr: '' };
    return { status: 0, stdout: '', stderr: '' };
  });
  mock.method(backlog, 'resolveTaskFile', () => ({ ok: true, taskFile: path.join(FAKE_ROOT, 'backlog/tasks/task.md') }));
  mock.method(backlog, 'getTaskStatus', () => 'approved');
  mock.method(backlog, 'getTaskAssignee', () => 'claude');
  mock.method(backlog, 'setTaskStatus', () => true);
  mock.method(backlog, 'completeTask', () => true);
  mock.method(forgejo, 'getPrStatus', () => ({ exists: true, state: 'open', merged: false, number: 41 }));
  mock.method(forgejo, 'listOpenPrsForSlug', () => []);
  mock.method(forgejo, 'getLatestReviewDecision', () => ({ ok: true, reviewState: 'APPROVED' }));
  mock.method(forgejo, 'readToken', () => 'token');
  mock.method(forgejo, 'resolveTokenFile', () => 'token-file');
  mock.method(forgejo, 'syncMerged', () => ({ ok: true }));
  mock.method(stats, 'recordIntegrationStats', (args) => {
    statsCalls.push(args);
    return Promise.resolve({
      changed: false,
      row: { mission: TEST_SLUG },
      data: { rows: [] },
      report: 'Current week (2026-05-12 → 2026-05-18)\nnone',
    });
  });
  mock.method(stats, 'resolveMissionClassification', () => ({ classification: 'ai_sdlc' }));
  mock.method(forgejo, 'resolveTrackingBranchSha', () => ({ ok: true, ref: 'refs/remotes/origin/main', sha: 'deadbeef' }));
  mock.method(process, 'cwd', () => FAKE_ROOT);
  mock.method(process, 'exit', () => {});

  // SC3: Mock createMissionApplicationServices for SQLite-first transitions.
  mock.method(composition, 'createMissionApplicationServices', async () => ({
    store: {
      _repoId: 'default',
      load: async () => ({ kind: 'found', mission: {
        status: 'review', assignee: 'claude', review: {
          rounds: [{
            number: 1,
            subject: { change: { kind: 'local-branch', sourceBranch: `mission/${TEST_SLUG}`, targetBranch: 'main' }, revision: 'fixture' },
            reviewer: 'codex', implementer: 'claude', startedAt: '2026-05-15T10:00:00Z',
            decision: { kind: 'approved', decidedAt: '2026-05-15T10:30:00Z', comment: null, source: { kind: 'local' } },
            response: null, phase: 'approved', disposition: 'APPROVED', reviewerRetryCount: 0, implementerRetryCount: 0,
          }], intervention: null, stageLaunches: [], reviewEvents: [],
        },
      }, version: 1 }),
    },
   lifecycle: {
     transition: async () => ({ status: 'completed', value: { to: 'review', version: 2 } }),
   },
    integration: {
      decideIntegration: async () => ({ status: 'completed' }),
    },
    handoff: {
      recordNel: async () => ({}),
    },
  }));
  
  if (!fs.existsSync(FAKE_ROOT)) fs.mkdirSync(FAKE_ROOT, { recursive: true });
  fs.writeFileSync(path.join(FAKE_ROOT, 'workflow.config.json'), JSON.stringify({
    adapters: { review: { provider: 'forgejo', baseUrl: 'http://localhost:3300', remote: 'review', repo: 'magnus/visualboard' }, verification: { command: 'true' } },
  }), 'utf8');
}

function cleanup() {
  mock.reset();
  if (fs.existsSync(FAKE_ROOT)) fs.rmSync(FAKE_ROOT, { recursive: true, force: true });
}

test('integrate full squash-merge (Variant B) success path', async (t) => {
  setupMocks();
  const integrate = loadIntegrate();
  const originalLog = console.log;
  const logs = [];
  console.log = (msg) => logs.push(msg);

  try {
    await integrate([TEST_SLUG, '--no-integration-gates'], { missionServicesFn: composition.createMissionApplicationServices });
  } catch { /* expected */ }

  assert.ok(logs.some(l => l.includes('Selecting integration variant: Variant B')));
  assert.ok(logs.some(l => l.includes('Integration completed successfully')));
  assert.equal(statsCalls.length, 1);

  console.log = originalLog;
  cleanup();
});

test('integrate Variant B promotes and completes a review-approved task in the landed closeout', async () => {
  setupMocks();
  const taskFile = path.join(FAKE_ROOT, 'backlog/tasks/task.md');
  fs.mkdirSync(path.dirname(taskFile), { recursive: true });
  fs.writeFileSync(taskFile, '---\nstatus: review\n---\n', 'utf8');
  const events = [];
  mock.method(backlog, 'getTaskStatus', () => 'review');
  mock.method(backlog, 'setTaskStatus', () => {
    events.push('promote');
    return true;
  });
  mock.method(backlog, 'completeTask', () => {
    events.push('complete');
    return true;
  });
  mock.method(git, 'git', (args) => {
    if (args.includes('branch') && args.includes('--list')) return { status: 0, stdout: 'main\n', stderr: '' };
    if (args.includes('branch') && args.includes('--show-current')) return { status: 0, stdout: 'main', stderr: '' };
    if (args.includes('status')) return { status: 0, stdout: '', stderr: '' };
    if (args.includes('merge') && args.includes('--abort')) {
      events.push('abort');
      return { status: 0, stdout: '', stderr: '' };
    }
    if (args.includes('merge') && args.includes('--squash')) {
      events.push('squash');
      return { status: 0, stdout: '', stderr: '' };
    }
    if (args.includes('commit')) {
      events.push('commit');
      return { status: 0, stdout: '', stderr: '' };
    }
    if (args.includes('merge')) return { status: 0, stdout: '', stderr: '' };
    if (args.includes('rev-parse')) return { status: 0, stdout: 'deadbeef', stderr: '' };
    if (args.includes('show')) return { status: 0, stdout: '2026-05-15T12:00:00+02:00\n', stderr: '' };
    return { status: 0, stdout: '', stderr: '' };
  });
  const integrate = loadIntegrate();

  try {
    await integrate([TEST_SLUG, '--no-integration-gates'], { missionServicesFn: composition.createMissionApplicationServices });
  } catch { /* expected */ }

  assert.deepEqual(events, ['abort', 'squash', 'promote', 'complete', 'commit']);
  cleanup();
});

test('integrate Variant B preserves soft-reset backlog noise across squash merge', async () => {
  setupMocks();
  const gitCalls = [];
  mock.method(missionUtils, 'softResetTrailingBacklogNoise', () => true);
  mock.method(git, 'git', (args) => {
    gitCalls.push(args.join(' '));
    if (args.includes('branch') && args.includes('--list')) return { status: 0, stdout: 'main\n', stderr: '' };
    if (args.includes('branch') && args.includes('--show-current')) return { status: 0, stdout: 'main', stderr: '' };
    if (args.includes('status')) return { status: 0, stdout: '', stderr: '' };
    if (args.includes('diff') && args.includes('--cached') && args.includes('--binary')) {
      return { status: 0, stdout: 'diff --git a/backlog/tasks/task.md b/backlog/tasks/task.md\n', stderr: '' };
    }
    if (args.includes('reset') && args.includes('--hard')) return { status: 0, stdout: '', stderr: '' };
    if (args.includes('merge')) return { status: 0, stdout: '', stderr: '' };
    if (args.includes('apply') && args.includes('--index')) return { status: 0, stdout: '', stderr: '' };
    if (args.includes('rev-parse')) return { status: 0, stdout: 'deadbeef', stderr: '' };
    if (args.includes('show')) return { status: 0, stdout: '2026-05-15T12:00:00+02:00\n', stderr: '' };
    return { status: 0, stdout: '', stderr: '' };
  });
  const integrate = loadIntegrate();

  try {
    await integrate([TEST_SLUG, '--no-integration-gates'], { missionServicesFn: composition.createMissionApplicationServices });
  } catch { /* expected */ }

  const diffIndex = gitCalls.findIndex(call => call.includes('diff --cached --binary'));
  const resetIndex = gitCalls.findIndex(call => call.includes('reset --hard HEAD'));
  const squashIndex = gitCalls.findIndex(call => call.includes('merge --squash'));
  const applyIndex = gitCalls.findIndex(call => call.includes('apply --index'));

  assert.ok(diffIndex !== -1, 'expected staged backlog-noise patch capture');
  assert.ok(resetIndex !== -1, 'expected clean reset after capturing backlog-noise patch');
  assert.ok(squashIndex !== -1, 'expected squash merge to run');
  assert.ok(applyIndex !== -1, 'expected backlog-noise patch restore');
  assert.ok(diffIndex < resetIndex && resetIndex < squashIndex && squashIndex < applyIndex);

  cleanup();
});

test('integrate resolves PR and approval using the task assignee Forgejo identity', async () => {
  setupMocks();
  const previousUser = process.env.FORGEJO_USER;
  const previousAgent = process.env.WORKFLOW_AGENT;
  process.env.FORGEJO_USER = 'claude'; // authorized
  delete process.env.WORKFLOW_AGENT;

  const captured = {
    prForgejoUser: null,
    approvalForgejoUser: null
  };
  mock.method(backlog, 'getTaskAssignee', () => 'gemini');
  mock.method(forgejo, 'getPrStatus', (_branch, _rootDir, options = {}) => {
// @ts-expect-error -- Legacy fixture intentionally accesses runtime-only `prForgejoUser` absent from its inferred mock shape.
    captured.prForgejoUser = options.forgejoUser || null;
// @ts-expect-error -- Legacy fixture intentionally accesses runtime-only `forgejoUser` absent from its inferred mock shape.
    if (options.forgejoUser !== 'gemini') {
      return { exists: false, error: 'api-failed', raw: 'failed to resolve PR for mission/task-integrate-v2' };
    }
    return { exists: true, state: 'open', merged: false, number: 41 };
  });
  mock.method(forgejo, 'getLatestReviewDecision', (_branch, options = {}) => {
// @ts-expect-error -- Legacy fixture intentionally accesses runtime-only `approvalForgejoUser` absent from its inferred mock shape.
    captured.approvalForgejoUser = options.forgejoUser || null;
// @ts-expect-error -- Legacy fixture intentionally accesses runtime-only `forgejoUser` absent from its inferred mock shape.
    if (options.forgejoUser !== 'gemini') {
      return { ok: false, error: 'api-failed', reviewState: null };
    }
    return { ok: true, reviewState: 'APPROVED' };
  });

  const integrate = loadIntegrate();
  const logs = [];
  const errors = [];
  const exitCodes = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (msg) => logs.push(msg);
  console.error = (msg) => errors.push(msg);
  mock.method(process, 'exit', (code) => exitCodes.push(code));

  try {
    await integrate([TEST_SLUG, '--dry-run', '--no-integration-gates'], { missionServicesFn: composition.createMissionApplicationServices });

    assert.equal(captured.prForgejoUser, 'gemini');
    assert.equal(captured.approvalForgejoUser, 'gemini');
    assert.ok(logs.some(l => l.includes('Forgejo PR: PR #41 open')));
    assert.ok(logs.some(l => l.includes('Forgejo approval: latest formal review state is APPROVED')));
    assert.ok(!exitCodes.includes(1));
  } finally {
    console.log = originalLog;
    console.error = originalError;
    if (previousUser === undefined) delete process.env.FORGEJO_USER; else process.env.FORGEJO_USER = previousUser;
    if (previousAgent === undefined) delete process.env.WORKFLOW_AGENT; else process.env.WORKFLOW_AGENT = previousAgent;
    cleanup();
  }
});

test('integrate passes the pre-resolved Forgejo token into syncMerged', async () => {
  setupMocks();
  let readTokenCalls = 0;
  const captured = {
    prToken: null,
    approvalToken: null
  };

  mock.method(forgejo, 'readToken', () => {
    readTokenCalls += 1;
    return readTokenCalls <= 2 ? 'preflight-token' : null;
  });
  mock.method(forgejo, 'getPrStatus', (_branch, _rootDir, options = {}) => {
// @ts-expect-error -- Legacy fixture intentionally accesses runtime-only `prToken` absent from its inferred mock shape.
    captured.prToken = options.token || null;
    return { exists: true, state: 'open', merged: false, number: 41 };
  });
  mock.method(forgejo, 'getLatestReviewDecision', (_branch, options = {}) => {
// @ts-expect-error -- Legacy fixture intentionally accesses runtime-only `approvalToken` absent from its inferred mock shape.
    captured.approvalToken = options.token || null;
    return { ok: true, reviewState: 'APPROVED' };
  });

  const integrate = loadIntegrate();
  const logs = [];
  const originalLog = console.log;
  console.log = (msg) => logs.push(msg);

  try {
    await integrate([TEST_SLUG, '--no-integration-gates'], { missionServicesFn: composition.createMissionApplicationServices });

    assert.equal(captured.prToken, 'preflight-token');
    assert.equal(captured.approvalToken, 'preflight-token');
    assert.equal(readTokenCalls, 2);
    assert.ok(logs.some(l => l.includes('Integration completed successfully')));
  } finally {
    console.log = originalLog;
    cleanup();
  }
});

test('integrate rejects a Forgejo PR that is already merged', async () => {
  setupMocks();
  mock.method(forgejo, 'getPrStatus', () => ({ exists: true, state: 'closed', merged: true, number: 41 }));
  const integrate = loadIntegrate();
  const logs = [];
  const errors = [];
  const exitCodes = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (msg) => logs.push(msg);
  console.error = (msg) => errors.push(msg);
  mock.method(process, 'exit', (code) => exitCodes.push(code));

  try {
    await integrate([TEST_SLUG, '--no-integration-gates'], { missionServicesFn: composition.createMissionApplicationServices });
  } catch { /* expected */ }
  
  const output = [...logs, ...errors].join('\n');
  assert.match(output, /Forgejo PR: PR #41 is already marked merged/);
  assert.match(output, /re-sync the local base branch/);
  assert.match(output, new RegExp(`px integrate ${TEST_SLUG} --dry-run`));
  assert.equal(statsCalls.length, 0);
  assert.equal(exitCodes.at(-1), 1);

  console.log = originalLog;
  console.error = originalError;
  cleanup();
});

test('integrate warns that --no-gate is ignored', async () => {
  setupMocks();
  const integrate = loadIntegrate();
  const logs = [];
  const originalLog = console.log;
  console.log = (msg) => logs.push(msg);

  try {
    await integrate([TEST_SLUG, '--dry-run', '--no-gate', '--no-integration-gates'], { missionServicesFn: composition.createMissionApplicationServices });
  } catch { /* expected */ }

  assert.ok(logs.some(l => l.includes('integrate ignores --no-gate')));
  assert.equal(statsCalls.length, 0);

  console.log = originalLog;
  cleanup();
});

test('integrate exits non-zero when post-integration stats recording fails', async () => {
  setupMocks();
// @ts-expect-error -- TASK-2328: partial test double after ESM seam migration
  stats.recordIntegrationStats.mock.mockImplementation((args) => {
    statsCalls.push(args);
    throw new Error('stats write failed');
  });
  const integrate = loadIntegrate();
  const errors = [];
  const exitCodes = [];
  const originalError = console.error;
  console.error = (msg) => errors.push(msg);
  mock.method(process, 'exit', (code) => exitCodes.push(code));

  try {
    await integrate([TEST_SLUG, '--no-integration-gates'], { missionServicesFn: composition.createMissionApplicationServices });
  } catch { /* expected */ }

  assert.equal(statsCalls.length, 1);
  assert.ok(errors.some(l => l.includes('Post-integration workflow stats failed')));
  assert.ok(errors.some(l => l.includes('stats write failed')));
  assert.equal(exitCodes.at(-1), 1);

  console.error = originalError;
  cleanup();
});

test('integrate reports merged-PR recovery guidance before any closeout work', async () => {
  setupMocks();
  mock.method(forgejo, 'getPrStatus', () => ({ exists: true, state: 'closed', merged: true, number: 41 }));
  const integrate = loadIntegrate();
  const logs = [];
  const errors = [];
  const exitCodes = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (msg) => logs.push(msg);
  console.error = (msg) => errors.push(msg);
  mock.method(process, 'exit', (code) => exitCodes.push(code));

  try {
    await integrate([TEST_SLUG, '--no-integration-gates'], { missionServicesFn: composition.createMissionApplicationServices });
  } catch { /* expected */ }

  const output = [...logs, ...errors].join('\n');
  assert.match(output, /Integration preflight failed\./);
  assert.match(output, /Forgejo PR: PR #41 is already marked merged/);
  assert.ok(output.includes(`git -C ${FAKE_ROOT} checkout main`));
  assert.equal(statsCalls.length, 0);
  assert.equal(exitCodes.at(-1), 1);

  console.log = originalLog;
  console.error = originalError;
  cleanup();
});

test('integrate Variant B stops when dry-run merge cannot be aborted cleanly', async () => {
  setupMocks();
  let taskStatusMutations = 0;
  mock.method(backlog, 'getTaskStatus', () => 'review');
  mock.method(backlog, 'setTaskStatus', () => {
    taskStatusMutations++;
    return true;
  });
  mock.method(git, 'git', (args) => {
    if (args.includes('branch') && args.includes('--list')) return { status: 0, stdout: 'main\n', stderr: '' };
    if (args.includes('branch') && args.includes('--show-current')) return { status: 0, stdout: 'main', stderr: '' };
    if (args.includes('status')) return { status: 0, stdout: '', stderr: '' };
    if (args.includes('merge') && args.includes('--no-commit')) return { status: 0, stdout: '', stderr: '' };
    if (args.includes('merge') && args.includes('--abort')) return { status: 1, stdout: '', stderr: 'fatal: abort failed' };
    return { status: 0, stdout: '', stderr: '' };
  });
  const integrate = loadIntegrate();
  const errors = [];
  const exitCodes = [];
  const originalError = console.error;
  console.error = (msg) => errors.push(msg);
  mock.method(process, 'exit', (code) => exitCodes.push(code));

  try {
    await integrate([TEST_SLUG, '--no-integration-gates'], { missionServicesFn: composition.createMissionApplicationServices });
  } catch { /* expected */ }

  assert.ok(errors.some(l => l.includes('Dry-run merge could not be aborted cleanly')));
  assert.equal(taskStatusMutations, 0, 'must not promote the task before the probe merge abort succeeds');
  assert.equal(statsCalls.length, 0);
  assert.equal(exitCodes.at(-1), 1);

  console.error = originalError;
  cleanup();
});

test('integrate Variant B resumed partial state prints sync diagnostics on sync failure', async () => {
  setupMocks();
  mock.method(git, 'git', (args) => {
    if (args.includes('branch') && args.includes('--list')) return { status: 0, stdout: 'main\n', stderr: '' };
    if (args.includes('branch') && args.includes('--show-current')) return { status: 0, stdout: 'main', stderr: '' };
    if (args.includes('status')) return { status: 0, stdout: '', stderr: '' };
    if (args.includes('merge') && args.includes('--no-commit')) return { status: 1, stdout: 'conflict', stderr: 'conflict' };
    if (args.includes('merge') && args.includes('--abort')) return { status: 1, stdout: '', stderr: 'There is no merge to abort' };
    if (args.includes('log') && args.includes('--format=%H %s')) return { status: 0, stdout: `deadbeef mission/${TEST_SLUG}: Test Mission\n`, stderr: '' };
    return { status: 0, stdout: '', stderr: '' };
  });
  mock.method(forgejo, 'syncMerged', () => ({ ok: false, error: 'api-failed', statusCode: 500 }));
  const integrate = loadIntegrate();
  const logs = [];
  const errors = [];
  const exitCodes = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (msg) => logs.push(msg);
  console.error = (msg) => errors.push(msg);
  mock.method(process, 'exit', (code) => exitCodes.push(code));

  try {
    await integrate([TEST_SLUG, '--no-integration-gates'], { missionServicesFn: composition.createMissionApplicationServices });
  } catch { /* expected */ }

  assert.ok(logs.some(l => l.includes('Resuming from sync-merged step')));
  assert.ok(errors.some(l => l.includes('Forgejo sync-merged failed (api-failed: 500).')));
  assert.ok(logs.some(l => l.includes('Node sync-merged Diagnostic Table')));
  assert.equal(statsCalls.length, 0);
  assert.equal(exitCodes.at(-1), 1);

  console.log = originalLog;
  console.error = originalError;
  cleanup();
});

test('integrate Variant B conflict path prints conflicting files and helper guidance', async () => {
  setupMocks();
  mock.method(git, 'git', (args) => {
    if (args.includes('branch') && args.includes('--list')) return { status: 0, stdout: 'main\n', stderr: '' };
    if (args.includes('branch') && args.includes('--show-current')) return { status: 0, stdout: 'main', stderr: '' };
    if (args.includes('status')) return { status: 0, stdout: '', stderr: '' };
    if (args.includes('merge') && args.includes('--no-commit')) return { status: 1, stdout: 'conflict', stderr: 'conflict' };
    if (args.includes('merge') && args.includes('--abort')) return { status: 1, stdout: '', stderr: 'There is no merge to abort' };
    if (args.includes('log') && args.includes('--format=%H %s')) return { status: 0, stdout: 'deadbeef unrelated commit\n', stderr: '' };
    return { status: 0, stdout: '', stderr: '' };
  });
  mock.method(missionUtils, 'parseConflictFilesFromMergeOutput', () => ['workflow/lib/commands/integrate.js', 'docs/index.md']);
  mock.method(runtimeMatrix, 'buildAutonomousReviewMatrix', () => ({}));
  mock.method(runtimeMatrix, 'formatMatrixSummary', () => ['matrix-line']);
  const integrate = loadIntegrate();
  const logs = [];
  const errors = [];
  const exitCodes = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (msg) => logs.push(msg);
  console.error = (msg) => errors.push(msg);
  mock.method(process, 'exit', (code) => exitCodes.push(code));

  try {
    await integrate([TEST_SLUG, '--no-integration-gates'], { missionServicesFn: composition.createMissionApplicationServices });
  } catch { /* expected */ }

  assert.ok(errors.some(l => l.includes('Merge conflicts detected. Rebase the mission branch before integrating.')));
  assert.ok(logs.some(l => l.includes('Conflicting files (2):')));
  assert.ok(logs.some(l => l.includes('matrix-line')));
  assert.ok(logs.some(l => l.includes('Conflict resolution options:')));
  assert.equal(statsCalls.length, 0);
  assert.equal(exitCodes.at(-1), 1);

  console.log = originalLog;
  console.error = originalError;
  cleanup();
});

test('evaluateTaskStatusForIntegration edge cases', (t) => {
  setupMocks();
  const integrate = loadIntegrate();
  const { evaluateTaskStatusForIntegration } = integrate;

  // Case 1: Status review, PR merged
  const res1 = evaluateTaskStatusForIntegration({
    taskStatus: 'review',
    pr: { state: 'merged', merged: true },
    approval: { ok: false }
  });
  assert.strictEqual(res1.ok, false);
  assert.match(res1.message, /approved Forgejo PR/);

  // Case 2: Status review, review approved
  const res2 = evaluateTaskStatusForIntegration({
    taskStatus: 'review',
    pr: { merged: false },
    approval: { ok: true, reviewState: 'APPROVED' }
  });
  assert.strictEqual(res2.ok, true);
  assert.match(res2.message, /latest formal review state is APPROVED/);

  // Case 3: Other status
  const res3 = evaluateTaskStatusForIntegration({
    taskStatus: 'active',
    pr: { merged: false },
    approval: { ok: true, reviewState: 'APPROVED' }
  });
  assert.strictEqual(res3.ok, false);
});

test('recordPostIntegrationStats keeps operator-owned stats outside git', async () => {
  setupMocks();
  const gitCalls = [];

  try {
    const { recordPostIntegrationStats } = loadIntegrate();
    const outcome = await recordPostIntegrationStats('task-1109', {
      rootDir: FAKE_ROOT,
// @ts-expect-error -- TASK-2328: partial test double after ESM seam migration
      gitRunner(args) {
        gitCalls.push(args);
        if (args.join(' ').includes('log -1 --format=%cs')) {
          return { status: 0, stdout: '2026-05-18\n', stderr: '' };
        }
        if (args.includes('add') || args.includes('commit') || args.includes('push') || args.includes('reset')) {
          throw new Error(`unexpected git args: ${JSON.stringify(args)}`);
        }
        return { status: 0, stdout: '', stderr: '' };
      },
      recordIntegrationStatsFn() {
        return {
          changed: true,
          row: {
            mission: 'task-1109',
            implementer: 'gemini',
            pr_fix_rounds: '0',
            classification: 'ai_sdlc',
            date: '2026-05-18',
          },
          report: 'weekly report',
        };
      }
    });

    assert.equal(outcome.changed, true);
    assert.ok(!gitCalls.some(args => args.includes('add')));
    assert.ok(!gitCalls.some(args => args.includes('commit')));
    assert.ok(!gitCalls.some(args => args.includes('push')));
    assert.ok(!gitCalls.some(args => args.includes('reset')));
  } finally {
    cleanup();
  }
});
