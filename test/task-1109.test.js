const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { mock } = test;

const git = require('../lib/core/git');
const missionUtils = require('../lib/core/mission-utils');
const backlog = require('../lib/tools/backlog');
const forgejo = require('../lib/tools/forgejo');
const runtimeMatrix = require('../lib/core/runtime-matrix');
const stats = require('../lib/commands/stats');

const TEST_SLUG = 'task-integrate-v2';
const FAKE_ROOT = '/tmp/integrate-v2-root';
let statsCalls = [];

function loadIntegrate() {
  delete require.cache[require.resolve('../lib/commands/integrate')];
  return require('../lib/commands/integrate');
}

function setupMocks() {
  statsCalls = [];
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
    return { status: 0, stdout: '', stderr: '' };
  });
  mock.method(backlog, 'resolveTaskFile', () => ({ ok: true, taskFile: path.join(FAKE_ROOT, 'backlog/tasks/task.md') }));
  mock.method(backlog, 'getTaskStatus', () => 'ready-for-integration');
  mock.method(backlog, 'getTaskAssignee', () => 'claude');
  mock.method(backlog, 'setTaskStatus', () => true);
  mock.method(backlog, 'completeTask', () => true);
  mock.method(forgejo, 'getPrStatus', () => ({ exists: true, state: 'open', merged: false, number: 41 }));
  mock.method(forgejo, 'getLatestReviewDecision', () => ({ ok: true, reviewState: 'APPROVED' }));
  mock.method(forgejo, 'readToken', () => 'token');
  mock.method(forgejo, 'resolveTokenFile', () => 'token-file');
  mock.method(forgejo, 'syncMerged', () => ({ ok: true }));
  mock.method(stats, 'recordIntegrationStats', (args) => {
    statsCalls.push(args);
    return {
      changed: false,
      row: { mission: TEST_SLUG },
      data: { rows: [] },
      report: 'Current week (2026-05-12 → 2026-05-18)\nnone',
    };
  });
  mock.method(stats, 'resolveMissionClassification', () => ({ classification: 'ai_sdlc' }));
  mock.method(forgejo, 'resolveTrackingBranchSha', () => ({ ok: true, ref: 'refs/remotes/origin/main', sha: 'deadbeef' }));
  mock.method(process, 'cwd', () => FAKE_ROOT);
  mock.method(process, 'exit', () => {});
  
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
  
  integrate([TEST_SLUG]);
  
  assert.ok(logs.some(l => l.includes('Selecting integration variant: Variant B')));
  assert.ok(logs.some(l => l.includes('Integration completed successfully')));
  assert.equal(statsCalls.length, 1);
  
  console.log = originalLog;
  cleanup();
});

test('integrate Variant B preserves soft-reset backlog noise across squash merge', () => {
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
    return { status: 0, stdout: '', stderr: '' };
  });
  const integrate = loadIntegrate();

  integrate([TEST_SLUG]);

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

test('integrate resolves PR and approval using the task assignee Forgejo identity', () => {
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
    captured.prForgejoUser = options.forgejoUser || null;
    if (options.forgejoUser !== 'gemini') {
      return { exists: false, error: 'api-failed', raw: 'failed to resolve PR for mission/task-integrate-v2' };
    }
    return { exists: true, state: 'open', merged: false, number: 41 };
  });
  mock.method(forgejo, 'getLatestReviewDecision', (_branch, options = {}) => {
    captured.approvalForgejoUser = options.forgejoUser || null;
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
    integrate([TEST_SLUG, '--dry-run']);

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

test('integrate passes the pre-resolved Forgejo token into syncMerged', () => {
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
    captured.prToken = options.token || null;
    return { exists: true, state: 'open', merged: false, number: 41 };
  });
  mock.method(forgejo, 'getLatestReviewDecision', (_branch, options = {}) => {
    captured.approvalToken = options.token || null;
    return { ok: true, reviewState: 'APPROVED' };
  });

  const integrate = loadIntegrate();
  const logs = [];
  const originalLog = console.log;
  console.log = (msg) => logs.push(msg);

  try {
    integrate([TEST_SLUG]);

    assert.equal(captured.prToken, 'preflight-token');
    assert.equal(captured.approvalToken, 'preflight-token');
    assert.equal(readTokenCalls, 2);
    assert.ok(logs.some(l => l.includes('Integration completed successfully')));
  } finally {
    console.log = originalLog;
    cleanup();
  }
});

test('integrate fast-path (Variant A) success path', async (t) => {
  setupMocks();
  mock.method(forgejo, 'getPrStatus', () => ({ exists: true, state: 'closed', merged: true, number: 41 }));
  const integrate = loadIntegrate();
  const originalLog = console.log;
  const logs = [];
  console.log = (msg) => logs.push(msg);
  
  integrate([TEST_SLUG]);
  
  assert.ok(logs.some(l => l.includes('Selecting integration variant: Variant A')));
  assert.ok(logs.some(l => l.includes('Variant A integration completed')));
  assert.equal(statsCalls.length, 1);
  
  console.log = originalLog;
  cleanup();
});

test('integrate warns that --no-gate is ignored', () => {
  setupMocks();
  const integrate = loadIntegrate();
  const logs = [];
  const originalLog = console.log;
  console.log = (msg) => logs.push(msg);

  integrate([TEST_SLUG, '--dry-run', '--no-gate']);

  assert.ok(logs.some(l => l.includes('integrate ignores --no-gate')));
  assert.equal(statsCalls.length, 0);

  console.log = originalLog;
  cleanup();
});

test('integrate exits non-zero when post-integration stats recording fails', () => {
  setupMocks();
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

  integrate([TEST_SLUG]);

  assert.equal(statsCalls.length, 1);
  assert.ok(errors.some(l => l.includes('Post-integration workflow stats failed')));
  assert.ok(errors.some(l => l.includes('stats write failed')));
  assert.equal(exitCodes.at(-1), 1);

  console.error = originalError;
  cleanup();
});

test('integrate Variant A reports closeout commit failure guidance', () => {
  setupMocks();
  mock.method(forgejo, 'getPrStatus', () => ({ exists: true, state: 'closed', merged: true, number: 41 }));
  mock.method(git, 'git', (args) => {
    if (args.includes('branch') && args.includes('--list')) return { status: 0, stdout: 'main\n', stderr: '' };
    if (args.includes('branch') && args.includes('--show-current')) return { status: 0, stdout: 'main', stderr: '' };
    if (args.includes('status')) return { status: 0, stdout: '', stderr: '' };
    if (args.includes('diff') && args.includes('--cached')) return { status: 1, stdout: '', stderr: '' };
    if (args[2] === 'commit') return { status: 1, stdout: '', stderr: 'hook failed' };
    return { status: 0, stdout: '', stderr: '' };
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

  integrate([TEST_SLUG]);

  assert.ok(errors.some(l => l.includes('Variant A closeout failed (commit-failed).')));
  assert.ok(errors.some(l => l.includes('hook failed')));
  assert.ok(logs.some(l => l.includes('the relevant verification command is')));
  assert.equal(statsCalls.length, 0);
  assert.equal(exitCodes.at(-1), 1);

  console.log = originalLog;
  console.error = originalError;
  cleanup();
});

test('integrate Variant B stops when dry-run merge cannot be aborted cleanly', () => {
  setupMocks();
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

  integrate([TEST_SLUG]);

  assert.ok(errors.some(l => l.includes('Dry-run merge could not be aborted cleanly')));
  assert.equal(statsCalls.length, 0);
  assert.equal(exitCodes.at(-1), 1);

  console.error = originalError;
  cleanup();
});

test('integrate Variant B resumed partial state prints sync diagnostics on sync failure', () => {
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

  integrate([TEST_SLUG]);

  assert.ok(logs.some(l => l.includes('Resuming from sync-merged step')));
  assert.ok(errors.some(l => l.includes('Forgejo sync-merged failed (api-failed: 500).')));
  assert.ok(logs.some(l => l.includes('Node sync-merged Diagnostic Table')));
  assert.equal(statsCalls.length, 0);
  assert.equal(exitCodes.at(-1), 1);

  console.log = originalLog;
  console.error = originalError;
  cleanup();
});

test('integrate Variant B conflict path prints conflicting files and helper guidance', () => {
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

  integrate([TEST_SLUG]);

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
    pr: { merged: true },
    approval: { ok: false }
  });
  assert.strictEqual(res1.ok, true);
  assert.match(res1.message, /already merged/);

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

test('recordPostIntegrationStats keeps operator-owned stats outside git', () => {
  setupMocks();
  const gitCalls = [];
  const FAKE_ROOT = '/tmp/integrate-v2-root';

  try {
    const { recordPostIntegrationStats } = loadIntegrate();
    const outcome = recordPostIntegrationStats('task-1109', {
      rootDir: FAKE_ROOT,
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
