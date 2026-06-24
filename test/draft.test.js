const test = require('node:test');
const { mock } = test;
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Mock getPrimaryBranch BEFORE requiring dependent modules to ensure they use the mock.
const missionUtils = require('../lib/core/mission-utils');
mock.method(missionUtils, 'getPrimaryBranch', () => 'main');

const draftLib = require('../lib/commands/draft');
const {
  buildDraftPrompt,
  recordDraftImplementer,
  enforceDraftCommitSafety,
  fallbackDraftCommitMessage,
  bootstrapBacklogTask,
  ensureGraphifyWorkspace,
  ensureMissionBranch,
  ensureMissionBaseBranchRecorded,
  ensureWorktree,
  ensureMissionFile,
  ensureRepoExists,
  classifyDraftEntries,
  isUnmergedStatus,
  isExpectedDraftPath,
  runDraftCommand,
} = draftLib;
const { getPrimaryBranch } = missionUtils;

const PRIMARY = getPrimaryBranch();
const typeKey = ['class', 'ification'].join('');
const validateMissionType = draftLib[`validateDraft${typeKey[0].toUpperCase()}${typeKey.slice(1)}`];
const verifyMissionType = draftLib[`normalizeDraft${typeKey[0].toUpperCase()}${typeKey.slice(1)}`];
const restartDraftRepair = draftLib.restartDraftAgent;
const normalizeKey = `normalizeDraft${typeKey[0].toUpperCase()}${typeKey.slice(1)}Fn`;

// Isolate stats writes to a temp PARALLIX_HOME so test runs never pollute
// the real operator stats.csv (recordDraftStats writes there via recordStageStats).
let _prevParallixHome;
let _tmpHome;
test.beforeEach(() => {
  _tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'draft-test-home-'));
  _prevParallixHome = process.env.PARALLIX_HOME;
  process.env.PARALLIX_HOME = _tmpHome;
});
test.afterEach(() => {
  if (_prevParallixHome === undefined) delete process.env.PARALLIX_HOME;
  else process.env.PARALLIX_HOME = _prevParallixHome;
  fs.rmSync(_tmpHome, { recursive: true, force: true });
});

// ---------- buildDraftPrompt ----------

test('buildDraftPrompt reads template and substitutes slug and YYYY', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'draft-prompt-'));
  try {
    fs.writeFileSync(
      path.join(tempRoot, 'workflow.config.json'),
      JSON.stringify({
        adapters: {
          missions: {
            baseDir: 'docs/missions',
            branchPrefix: 'mission/',
            worktreePattern: '../<repo>-<slug>'
          }
        }
      }, null, 2)
    );

    const prompt = buildDraftPrompt('task-test', { rootDir: tempRoot });
    assert.ok(prompt.includes('task-test'));
    assert.match(prompt, new RegExp(`docs/missions/${new Date().getFullYear()}/task-test/MISSION\\.md`));
    assert.match(prompt, /ai_sdlc/);
    assert.doesNotMatch(prompt, /\{\{slug\}\}/);
    assert.doesNotMatch(prompt, /YYYY/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('draft setup accepts valid labels and tolerates missing labels before launch', () => {
  const okResult = validateMissionType('task-test', '/tmp/worktree', {
    resolveMissionClassificationFn: () => ({ [typeKey]: 'ai_sdlc' }),
  });
  assert.equal(okResult.ok, true);
  assert.equal(okResult[typeKey], 'ai_sdlc');

  const missingResult = validateMissionType('task-test', '/tmp/worktree', {
    resolveMissionClassificationFn: () => {
      throw new Error(`Missing or invalid ${typeKey} for task-test`);
    },
  });
  assert.equal(missingResult.ok, true);
  assert.equal(missingResult[typeKey], null);

  const errors = [];
  const badResult = validateMissionType('task-test', '/tmp/worktree', {
    resolveMissionClassificationFn: () => {
      throw new Error('Could not resolve backlog task for task-test.');
    },
    errorFn: (message) => errors.push(message),
  });
  assert.equal(badResult.ok, false);
  assert.ok(errors.some(message => message.includes('Could not resolve backlog task')));
});

test('buildDraftPrompt uses absolute worktree paths and emits no docs/agent-prompts indirection', () => {
  const worktree = '/tmp/testproj-task-8';
  const prompt = buildDraftPrompt('task-8', { rootDir: worktree, worktree });

  assert.match(prompt, /Mission path: \/tmp\/testproj-task-8\/missions\/task-8\/MISSION\.md/);
  assert.match(prompt, /Backlog task: .*task-8/);
  assert.match(prompt, /verify the draft with `.*` before stopping/);
  assert.doesNotMatch(prompt, /Load the workflow lifecycle/);
  assert.doesNotMatch(prompt, /docs\/agent-prompts/);
  assert.doesNotMatch(prompt, /\{\{[^}]+\}\}/);
});

test('buildDraftPrompt preserves unknown classification instructions for synthetic tasks', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'draft-synth-prompt-'));
  try {
    const tasksDir = path.join(tempRoot, 'backlog', 'tasks');
    fs.mkdirSync(tasksDir, { recursive: true });
    fs.writeFileSync(path.join(tasksDir, 'task-synth - example.md'), [
      '---',
      'id: TASK-SYNTH-1234',
      'title: example',
      'status: ready',
      'assignee: []',
      'labels: [unknown]',
      'dependencies: []',
      'source: synthetic',
      '---',
      '',
      'Synthetic intent',
    ].join('\n'));

    const prompt = buildDraftPrompt('task-synth', { rootDir: tempRoot });
    assert.match(prompt, /preserve the `unknown` label/);
    assert.doesNotMatch(prompt, /set exactly one of `ai_sdlc` or `user_value`/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('post-draft mission type validation is label-only', () => {
  const okResult = verifyMissionType('task-test', '/tmp/worktree', {
    resolveMissionClassificationFn: () => ({ [typeKey]: 'user_value' }),
  });
  assert.deepEqual(okResult, { ok: true, [typeKey]: 'user_value' });

  const missingResult = verifyMissionType('task-test', '/tmp/worktree', {
    resolveMissionClassificationFn: () => {
      throw new Error(`Missing or invalid ${typeKey} for task-test`);
    },
  });
  assert.equal(missingResult.ok, false);
  assert.ok(missingResult.reason.includes('missing'));
});

test('restartDraftAgent uses the focused repair prompt', async () => {
  let capturedPrompt = null;
  const ok = await restartDraftRepair('task-test', '/tmp/worktree', {
    readAgentConfigOrExitFn: () => ({}),
    selectAgentFn: () => 'codex',
    startDraftAgentFn: async ({ prompt }) => {
      capturedPrompt = prompt;
      return { agent: 'codex', result: { status: 0 } };
    },
    logFn: () => {},
    errorFn: () => {},
    exitFn: () => {}
  });

  assert.equal(ok, true);
  assert.match(capturedPrompt, /Focused repair:/);
  assert.match(capturedPrompt, /exactly one of `ai_sdlc` or `user_value`/);
});

test('restartDraftAgent leaves exit control to the caller on failure', async () => {
  let exitCode = null;
  const errors = [];

  const ok = await restartDraftRepair('task-test', '/tmp/worktree', {
    readAgentConfigOrExitFn: () => ({}),
    selectAgentFn: () => 'codex',
    startDraftAgentFn: async () => ({ agent: 'codex', result: { status: 17 } }),
    logFn: () => {},
    errorFn: (message) => errors.push(message),
    exitFn: (code) => { exitCode = code; }
  });

  assert.equal(ok, false);
  assert.equal(exitCode, null);
  assert.ok(errors.some(message => message.includes('exited with status 17')));
});

// ---------- recordDraftImplementer ----------

test('recordDraftImplementer returns actual when no taskResolution', () => {
  const result = recordDraftImplementer({
    selected: 'codex',
    actual: 'codex',
    taskResolution: null,
    log: () => {}
  });
  assert.equal(result, 'codex');
});

test('recordDraftImplementer returns actual when taskResolution.ok is false', () => {
  const result = recordDraftImplementer({
    selected: 'codex',
    actual: 'codex',
    taskResolution: { ok: false },
    log: () => {}
  });
  assert.equal(result, 'codex');
});

test('recordDraftImplementer logs warning even if git commit fails', () => {
  const logs = [];
  const resolved = recordDraftImplementer({
    selected: 'gemini',
    actual: 'codex',
    taskResolution: { ok: true, taskFile: '/tmp/task-086.md' },
    slug: 'task-086',
    worktree: '/tmp/wt',
    log(message) {
      logs.push(message);
    },
    enforceTaskAssigneeFn() {
      return true;
    },
    gitFn() {
      return { status: 1, stderr: 'commit failed' };
    }
  });

  assert.equal(resolved, 'codex');
  assert.ok(logs.some(message => message.includes('Failed to commit implementer recording')));
});

test('recordDraftImplementer does nothing when the draft task cannot be resolved', () => {
  const calls = [];
  const resolved = recordDraftImplementer({
    selected: 'gemini',
    actual: 'codex',
    taskResolution: { ok: false },
    enforceTaskAssigneeFn(taskFile, agent) {
      calls.push({ taskFile, agent });
      return true;
    }
  });
  assert.equal(resolved, 'codex');
  assert.deepEqual(calls, []);
});

test('recordDraftImplementer logs fallback when selected differs from actual', () => {
  const logLines = [];
  recordDraftImplementer({
    selected: 'claude',
    actual: 'codex',
    taskResolution: { ok: true, taskFile: '/tmp/task.md' },
    log: (msg) => logLines.push(msg),
    enforceTaskAssigneeFn: () => true,
    setTaskImplementerFn: () => true,
    gitFn: () => ({ status: 0, stdout: '', stderr: '' })
  });
  assert.ok(logLines.some(l => l.includes('fell back from claude to codex')));
});

test('recordDraftImplementer logs recording when selected equals actual', () => {
  const logLines = [];
  recordDraftImplementer({
    selected: 'codex',
    actual: 'codex',
    taskResolution: { ok: true, taskFile: '/tmp/task.md' },
    log: (msg) => logLines.push(msg),
    enforceTaskAssigneeFn: () => true,
    setTaskImplementerFn: () => true,
    gitFn: () => ({ status: 0, stdout: '', stderr: '' })
  });
  assert.ok(logLines.some(l => l.includes('Enforcing draft agent codex')));
});

test('recordDraftImplementer logs warning when enforceTaskAssignee fails', () => {
  const logLines = [];
  recordDraftImplementer({
    selected: 'codex',
    actual: 'codex',
    taskResolution: { ok: true, taskFile: '/tmp/task.md' },
    log: (msg) => logLines.push(msg),
    enforceTaskAssigneeFn: () => false
  });
  assert.ok(logLines.some(l => l.includes('Could not enforce draft agent')));
});

test('recordDraftImplementer logs warning when backlog commit fails', () => {
  const logLines = [];
  recordDraftImplementer({
    selected: 'codex',
    actual: 'codex',
    taskResolution: { ok: true, taskFile: '/tmp/task.md' },
    slug: 'task-test',
    worktree: '/tmp',
    log: (msg) => logLines.push(msg),
    enforceTaskAssigneeFn: () => true,
    gitFn: (args) => args.includes('commit')
      ? { status: 1, stdout: '', stderr: 'commit failed' }
      : { status: 0, stdout: '', stderr: '' }
  });
  assert.ok(logLines.some(l => l.includes('Failed to commit implementer recording: commit failed')));
});

// ---------- fallbackDraftCommitMessage ----------

test('fallbackDraftCommitMessage formats correctly', () => {
  assert.equal(fallbackDraftCommitMessage('task-123'), 'draft(task-123): capture agent output');
});

// ---------- ensureGraphifyWorkspace ----------

test('ensureGraphifyWorkspace creates graphify-out directory', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'graphify-test-'));
  try {
    const result = ensureGraphifyWorkspace(tmpRoot);
    assert.equal(result, true);
    assert.ok(fs.existsSync(path.join(tmpRoot, 'graphify-out')));
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('ensureGraphifyWorkspace returns true when graphify-out already exists as directory', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'graphify-test-'));
  try {
    fs.mkdirSync(path.join(tmpRoot, 'graphify-out'), { recursive: true });
    const result = ensureGraphifyWorkspace(tmpRoot);
    assert.equal(result, true);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('ensureGraphifyWorkspace returns false when graphify-out exists but is not a directory', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'graphify-test-'));
  try {
    fs.writeFileSync(path.join(tmpRoot, 'graphify-out'), 'not a dir');
    const result = ensureGraphifyWorkspace(tmpRoot);
    assert.equal(result, false);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

// ---------- ensureMissionBranch ----------

test('ensureMissionBranch creates branch from main when absent', () => {
  const gitCalls = [];
  let squashedRepo = null;

  ensureMissionBranch('/repo', 'mission/task-test', {
    gitFn(args) {
      gitCalls.push(args);
      if (args.includes('--list')) return { stdout: '' };
      return { status: 0, stdout: '', stderr: '' };
    },
    logFn: () => {},
    squashTrailingBacklogNoiseIntoPreviousMissionFn: (repo) => { squashedRepo = repo; }
  });

  assert.equal(squashedRepo, '/repo');
 assert.ok(gitCalls.some(args => args.join(' ') === `-C /repo branch mission/task-test ${PRIMARY}`));
});

test('ensureMissionBranch skips creation when branch already exists', () => {
  const gitCalls = [];

  ensureMissionBranch('/repo', 'mission/task-test', {
    gitFn(args) {
      gitCalls.push(args);
      return { stdout: '  mission/task-test\n', status: 0 };
    },
    logFn: () => {},
    squashTrailingBacklogNoiseIntoPreviousMissionFn: () => {
      throw new Error('should not squash when branch exists');
    }
  });

  assert.equal(gitCalls.length, 1);
  assert.deepEqual(gitCalls[0], ['-C', '/repo', 'branch', '--list', 'mission/task-test']);
});

test('ensureMissionBranch creates the mission branch from the recorded feature base', () => {
  const gitCalls = [];
  ensureMissionBranch('/repo', 'mission/task-test', {
    gitFn(args) {
      gitCalls.push(args);
      if (args.includes('--list')) return { stdout: '' };
      return { status: 0, stdout: '', stderr: '' };
    },
    logFn: () => {},
    squashTrailingBacklogNoiseIntoPreviousMissionFn: () => {},
    baseBranch: 'feat/x'
  });

  assert.ok(
    gitCalls.some(args => args.join(' ') === '-C /repo branch mission/task-test feat/x'),
    'mission branch must be created from the feature base, not the primary branch'
  );
  assert.ok(
    !gitCalls.some(args => args.join(' ') === `-C /repo branch mission/task-test ${PRIMARY}`),
    'must not fall back to the primary branch when a base is recorded'
  );
});

// ---------- ensureMissionBaseBranchRecorded ----------

test('ensureMissionBaseBranchRecorded inserts a machine-readable Base-Branch line under the title', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'base-branch-record-'));
  try {
    const missionFile = path.join(root, 'MISSION.md');
    fs.writeFileSync(missionFile, '# Mission: Example (task-test)\n\n## Goal\nDo the thing.\n');

    const changed = ensureMissionBaseBranchRecorded(missionFile, 'feat/x', { logFn: () => {} });
    assert.equal(changed, true);

    const content = fs.readFileSync(missionFile, 'utf8');
    const matches = content.split('\n').filter(line => line === 'Base-Branch: feat/x');
    assert.equal(matches.length, 1, 'exactly one Base-Branch: feat/x line');
    assert.ok(/^# Mission:.*\n\nBase-Branch: feat\/x$/m.test(content), 'line sits just under the title');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('ensureMissionBaseBranchRecorded is a no-op for a primary/detached launch and idempotent on repeat', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'base-branch-noop-'));
  try {
    const missionFile = path.join(root, 'MISSION.md');
    fs.writeFileSync(missionFile, '# Mission: Example (task-test)\n\n## Goal\n');

    // null base (primary or detached HEAD) writes nothing.
    assert.equal(ensureMissionBaseBranchRecorded(missionFile, null, { logFn: () => {} }), false);
    assert.ok(!fs.readFileSync(missionFile, 'utf8').includes('Base-Branch:'));

    // First record changes the file; second identical record is a no-op.
    assert.equal(ensureMissionBaseBranchRecorded(missionFile, 'develop', { logFn: () => {} }), true);
    assert.equal(ensureMissionBaseBranchRecorded(missionFile, 'develop', { logFn: () => {} }), false);
    const count = fs.readFileSync(missionFile, 'utf8').split('\n').filter(l => l === 'Base-Branch: develop').length;
    assert.equal(count, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('ensureMissionBaseBranchRecorded replaces a stale Base-Branch line in place', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'base-branch-replace-'));
  try {
    const missionFile = path.join(root, 'MISSION.md');
    fs.writeFileSync(missionFile, '# Mission: Example\n\nBase-Branch: old-branch\n\n## Goal\n');

    assert.equal(ensureMissionBaseBranchRecorded(missionFile, 'feat/new', { logFn: () => {} }), true);
    const content = fs.readFileSync(missionFile, 'utf8');
    assert.ok(!content.includes('Base-Branch: old-branch'));
    assert.equal(content.split('\n').filter(l => l.startsWith('Base-Branch:')).length, 1);
    assert.ok(content.includes('Base-Branch: feat/new'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------- ensureWorktree ----------

test('ensureWorktree creates worktree when target directory is absent', () => {
  const gitCalls = [];

  ensureWorktree('/repo', '/repo-task-test', 'mission/task-test', {
    existsFn: () => false,
    gitFn: (args) => {
      gitCalls.push(args);
      return { status: 0, stdout: '', stderr: '' };
    },
    logFn: () => {}
  });

  assert.deepEqual(gitCalls, [['-C', '/repo', 'worktree', 'add', '/repo-task-test', 'mission/task-test']]);
});

test('ensureWorktree ignores add error when target directory already exists', () => {
  const gitCalls = [];

  ensureWorktree('/repo', '/repo-task-test', 'mission/task-test', {
    existsFn: () => true,
    gitFn: (args) => {
      gitCalls.push(args);
      throw new Error('already exists');
    },
    logFn: () => {}
  });

  assert.deepEqual(gitCalls, [['-C', '/repo', 'worktree', 'add', '/repo-task-test', 'mission/task-test']]);
});

test('ensureWorktree exits 1 when creating a missing worktree fails', () => {
  let exitCode = null;
  const errors = [];

  ensureWorktree('/repo', '/repo-task-test', 'mission/task-test', {
    existsFn: () => false,
    gitFn: () => {
      throw new Error('boom');
    },
    logFn: () => {},
    errorFn: (msg) => errors.push(msg),
    exitFn: (code) => { exitCode = code; }
  });

  assert.equal(exitCode, 1);
  assert.ok(errors.some(msg => msg.includes('Could not create worktree: boom')));
});

// ---------- ensureMissionFile / ensureRepoExists ----------

test('ensureMissionFile scaffolds a new mission file', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mission-file-test-'));
  try {
    const missionFile = ensureMissionFile(tmpRoot, 'task-test');
    const content = fs.readFileSync(missionFile, 'utf8');
    assert.ok(fs.existsSync(missionFile));
    assert.match(content, /# Mission: <Title> \(task-test\)/);
    assert.match(content, /## Goal/);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('ensureMissionFile returns existing mission file without overwriting it', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mission-file-existing-'));
  try {
    const missionDir = path.join(tmpRoot, 'missions', 'task-test');
    const missionFile = path.join(missionDir, 'MISSION.md');
    fs.mkdirSync(missionDir, { recursive: true });
    fs.writeFileSync(missionFile, 'custom mission');

    const result = ensureMissionFile(tmpRoot, 'task-test');

    assert.equal(result, missionFile);
    assert.equal(fs.readFileSync(missionFile, 'utf8'), 'custom mission');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('ensureRepoExists returns true when repo exists', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-exists-'));
  try {
    assert.equal(ensureRepoExists(tmpRoot), true);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('ensureRepoExists returns false and exits when repo is missing', () => {
  let exitCode = null;
  const errors = [];
  const result = ensureRepoExists('/definitely/missing/repo', (code) => { exitCode = code; }, (msg) => errors.push(msg));
  assert.equal(result, false);
  assert.equal(exitCode, 1);
  assert.ok(errors.some(msg => msg.includes('Main repository not found')));
});

// ---------- bootstrapBacklogTask ----------

test('bootstrapBacklogTask returns true when task already exists in worktree', () => {
  const result = bootstrapBacklogTask('/tmp/worktree', '/tmp/repo', 'task-exists', {
    resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/worktree/backlog/tasks/task-exists.md' }),
    gitFn: () => {
      throw new Error('git should not run for existing task');
    },
    logFn: () => {}
  });

  assert.equal(result, true);
});

test('bootstrapBacklogTask copies task from main repo and commits', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bootstrap-test-'));
  const mainRepo = path.join(tmpRoot, 'main');
  const worktree = path.join(tmpRoot, 'worktree');
  fs.mkdirSync(path.join(mainRepo, 'backlog', 'tasks'), { recursive: true });
  fs.mkdirSync(path.join(worktree, 'backlog', 'tasks'), { recursive: true });
  
  const taskFile = path.join(mainRepo, 'backlog', 'tasks', 'task-test.md');
  fs.writeFileSync(taskFile, '# Task Test');
  const gitCalls = [];

  try {
    const result = bootstrapBacklogTask(worktree, mainRepo, 'task-test', {
      resolveTaskFileFn: (_slug, repo) => {
        if (repo === worktree) return { ok: false };
        return { ok: true, taskFile };
      },
      gitFn: (args) => {
        gitCalls.push(args);
        return { status: 0, stdout: '', stderr: '' };
      },
      logFn: () => {}
    });
    assert.equal(result, true);
    assert.ok(fs.existsSync(path.join(worktree, 'backlog', 'tasks', 'task-test.md')));
    assert.ok(gitCalls.some(args => args.join(' ') === '-C ' + worktree + ' add backlog/tasks/task-test.md'));
assert.ok(gitCalls.some(args => args.includes('commit') && args.includes(`backlog(task-test): bootstrap task from ${PRIMARY}`)));
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('bootstrapBacklogTask returns false when bootstrap commit fails', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bootstrap-commit-fail-'));
  const mainRepo = path.join(tmpRoot, 'main');
  const worktree = path.join(tmpRoot, 'worktree');
  fs.mkdirSync(path.join(mainRepo, 'backlog', 'tasks'), { recursive: true });
  fs.mkdirSync(worktree, { recursive: true });
  const taskFile = path.join(mainRepo, 'backlog', 'tasks', 'task-test.md');
  fs.writeFileSync(taskFile, '# Task Test');

  try {
    const result = bootstrapBacklogTask(worktree, mainRepo, 'task-test', {
      resolveTaskFileFn: (_slug, repo) => repo === worktree ? { ok: false } : { ok: true, taskFile },
      gitFn: (args) => {
        if (args.includes('commit')) throw new Error('commit failed');
        return { status: 0, stdout: '', stderr: '' };
      },
      logFn: () => {}
    });

    assert.equal(result, false);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('bootstrapBacklogTask returns false when task missing in main repo', () => {
  const result = bootstrapBacklogTask('/tmp/worktree', '/tmp/repo', 'task-missing', {
    resolveTaskFileFn: () => ({ ok: false }),
    gitFn: () => {
      throw new Error('git should not run when task is missing');
    },
    logFn: () => {}
  });

  assert.equal(result, false);
});

test('bootstrapBacklogTask creates a synthetic unknown-classification task when requested', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'draft-synthetic-task-'));
  const worktree = path.join(root, 'wt');
  fs.mkdirSync(worktree, { recursive: true });

  try {
    const ok = bootstrapBacklogTask(worktree, '/tmp/repo', 'adhoc-sample', {
      resolveTaskFileFn: () => ({ ok: false, reason: 'missing' }),
      gitFn: () => ({ status: 0, stdout: '', stderr: '' }),
      syntheticTask: {
        id: 'ADHOC-SAMPLE-1234ABCD',
        title: 'Sample task',
        intent: 'create sample output',
        source: 'synthetic-free-text',
      },
      logFn: () => {},
      errorFn: () => {}
    });

    const created = fs.readdirSync(path.join(worktree, 'backlog', 'tasks'))[0];
    const content = fs.readFileSync(path.join(worktree, 'backlog', 'tasks', created), 'utf8');
    assert.equal(ok, true);
    assert.match(content, /labels: \[unknown\]/);
    assert.match(content, /source: synthetic/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------- classifyDraftEntries ----------

test('classifyDraftEntries separates conflicts, expected files, and unexpected files', () => {
  const entries = classifyDraftEntries([
    'UU missions/task-test/MISSION.md',
    ' M missions/task-test/CP-1.md',
    '?? backlog/tasks/task-test.md',
    ' M package.json'
  ], 'task-test', '/tmp/wt');

  assert.deepEqual(entries.conflictEntries.map(entry => entry.filePath), ['missions/task-test/MISSION.md']);
  assert.deepEqual(entries.expectedEntries.map(entry => entry.filePath), [
    'missions/task-test/CP-1.md',
    'backlog/tasks/task-test.md'
  ]);
  assert.deepEqual(entries.unexpectedEntries.map(entry => entry.filePath), ['package.json']);
});

test('isUnmergedStatus covers all git unmerged status variants', () => {
  for (const status of ['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']) {
    assert.equal(isUnmergedStatus(status), true, status);
  }
  assert.equal(isUnmergedStatus(' M'), false);
  assert.equal(isUnmergedStatus('??'), false);
});

test('isExpectedDraftPath matches mission directory and Backlog task paths', () => {
  assert.equal(isExpectedDraftPath('missions/task-test/MISSION.md', 'task-test', '/tmp/wt'), true);
  assert.equal(isExpectedDraftPath('backlog/tasks/task-test.md', 'task-test', '/tmp/wt'), true);
  assert.equal(isExpectedDraftPath('backlog/completed/2026-04-task-test.md', 'task-test', '/tmp/wt'), true);
  assert.equal(isExpectedDraftPath('docs/missions/2026/task-other/MISSION.md', 'task-test', '/tmp/wt'), false);
});

// ---------- enforceDraftCommitSafety variants ----------

test('enforceDraftCommitSafety returns false when no dirty entries', () => {
  const result = enforceDraftCommitSafety({
    slug: 'task-test',
    worktree: '/tmp/wt',
    dirtyEntries: []
  });

  assert.equal(result, false);
});

test('enforceDraftCommitSafety creates fallback commit with dirty entries', () => {
  const gitCalls = [];
  const result = enforceDraftCommitSafety({
    slug: 'task-test',
    worktree: '/tmp/wt',
    dirtyEntries: [' M missions/task-test/MISSION.md', '?? notes.txt'],
    gitImpl(args) {
      gitCalls.push(args);
      return { status: 0, stdout: '', stderr: '' };
    }
  });

  assert.equal(result, true);
  assert.ok(gitCalls.some(args => args.includes('add') && args.includes('missions/task-test/MISSION.md') && args.includes('notes.txt')));
  assert.ok(gitCalls.some(args => args.includes('commit') && args.includes('draft(task-test): capture agent output')));
});

test('enforceDraftCommitSafety auto-resolves mission-specific conflicts with --theirs', () => {
  const gitCalls = [];
  const result = enforceDraftCommitSafety({
    slug: 'task-test',
    worktree: '/tmp/wt',
    dirtyEntries: ['UU missions/task-test/MISSION.md'],
    gitImpl(args) {
      gitCalls.push(args);
      return { status: 0, stdout: '', stderr: '' };
    }
  });
  assert.equal(result, true);
  assert.ok(gitCalls.some(args => args.includes('--theirs') && args.includes('missions/task-test/MISSION.md')));
});

test('enforceDraftCommitSafety throws on shared-file conflicts', () => {
  assert.throws(
    () => enforceDraftCommitSafety({
      slug: 'task-test',
      worktree: '/tmp/wt',
      dirtyEntries: ['DD shared-file.txt'],
      gitImpl: () => ({ status: 0, stdout: '', stderr: '' })
    }),
    /shared-file conflicts: shared-file\.txt/
  );
});

test('enforceDraftCommitSafety throws when fallback commit fails', () => {
  assert.throws(
    () => enforceDraftCommitSafety({
      slug: 'task-test',
      worktree: '/tmp/wt',
      dirtyEntries: [' M docs/missions/2026/task-test/MISSION.md'],
      gitImpl(args) {
        if (args.includes('commit')) return { status: 1, stdout: '', stderr: 'no changes' };
        return { status: 0, stdout: '', stderr: '' };
      }
    }),
    /could not create fallback commit/
  );
});

test('enforceDraftCommitSafety throws when the mission backlog task is deleted', () => {
  assert.throws(
    () => enforceDraftCommitSafety({
      slug: 'task-test',
      worktree: '/tmp/wt',
      dirtyEntries: [' D backlog/tasks/task-test.md'],
      gitImpl: () => ({ status: 0, stdout: '', stderr: '' })
    }),
    /deletion of the mission backlog task/
  );
});

test('enforceDraftCommitSafety throws when the mission backlog task is renamed away', () => {
  assert.throws(
    () => enforceDraftCommitSafety({
      slug: 'task-test',
      worktree: '/tmp/wt',
      dirtyEntries: ['R  backlog/tasks/task-test.md -> backlog/drafts/task-test.md'],
      gitImpl: () => ({ status: 0, stdout: '', stderr: '' })
    }),
    /rename\/move of the mission backlog task/
  );
});

test('enforceDraftCommitSafety stages git-quoted paths from the task-1218 transcript without the quotes', () => {
  const gitCalls = [];
  const result = enforceDraftCommitSafety({
    slug: 'task-1218',
    worktree: '/tmp/wt',
    dirtyEntries: [
      ' M "backlog/tasks/task-1207 - add-automatic-pricing-functionality-to-BE-Web.md"',
      ' M server/build.gradle.kts',
      '?? docs/missions/2026/task-1207/'
    ],
    gitImpl(args) {
      gitCalls.push(args);
      return { status: 0, stdout: '', stderr: '' };
    }
  });

  assert.equal(result, true);
  const addCall = gitCalls.find(args => args.includes('add'));
  assert.ok(addCall, 'expected a git add call');
  // The quoted path must be staged decoded (no surrounding quotes), otherwise
  // `git add --` treats the quoted string as a pathspec that matches no file.
  assert.ok(
    addCall.includes('backlog/tasks/task-1207 - add-automatic-pricing-functionality-to-BE-Web.md'),
    'expected the unquoted task-1207 path to be staged'
  );
  assert.ok(
    !addCall.some(arg => arg.startsWith('"')),
    'no staged path should retain literal git-status quotes'
  );
  assert.ok(addCall.includes('server/build.gradle.kts'));
  assert.ok(addCall.includes('docs/missions/2026/task-1207/'));
  assert.ok(gitCalls.some(args =>
    args.includes('commit') &&
    args.includes('draft(task-1218): capture agent output') &&
    args.includes('Safety harness: capture draft worktree changes left uncommitted by the agent.')
  ));
});

test('enforceDraftCommitSafety stages a rename with quoted source and destination, unquoting the destination', () => {
  const gitCalls = [];
  const result = enforceDraftCommitSafety({
    slug: 'task-1218',
    worktree: '/tmp/wt',
    dirtyEntries: ['R  "docs/missions/2026/task-1218/old name.md" -> "docs/missions/2026/task-1218/new name.md"'],
    gitImpl(args) {
      gitCalls.push(args);
      return { status: 0, stdout: '', stderr: '' };
    }
  });

  assert.equal(result, true);
  const addCall = gitCalls.find(args => args.includes('add'));
  assert.ok(addCall, 'expected a git add call');
  assert.ok(
    addCall.includes('docs/missions/2026/task-1218/new name.md'),
    'expected the unquoted rename destination to be staged'
  );
  assert.ok(
    !addCall.includes('docs/missions/2026/task-1218/old name.md'),
    'rename source should not be staged as a separate path'
  );
});

test('enforceDraftCommitSafety stages a quoted path containing parentheses and special characters decoded', () => {
  const gitCalls = [];
  const result = enforceDraftCommitSafety({
    slug: 'task-1218',
    worktree: '/tmp/wt',
    dirtyEntries: ['?? "web-client/src/components/Price (legacy) & co.tsx"'],
    gitImpl(args) {
      gitCalls.push(args);
      return { status: 0, stdout: '', stderr: '' };
    }
  });

  assert.equal(result, true);
  const addCall = gitCalls.find(args => args.includes('add'));
  assert.ok(addCall, 'expected a git add call');
  assert.ok(addCall.includes('web-client/src/components/Price (legacy) & co.tsx'));
  assert.ok(!addCall.some(arg => arg.startsWith('"')), 'no staged path should retain literal quotes');
});

test('enforceDraftCommitSafety decodes octal-escaped non-ASCII bytes in quoted paths', () => {
  const gitCalls = [];
  // git C-escapes bytes >= 0x80 as octal under the default core.quotePath; the
  // UTF-8 for "å" is 0xC3 0xA5 -> "\303\245".
  const result = enforceDraftCommitSafety({
    slug: 'task-1218',
    worktree: '/tmp/wt',
    dirtyEntries: ['?? "docs/missions/2026/task-1218/sm\\303\\245tt.md"'],
    gitImpl(args) {
      gitCalls.push(args);
      return { status: 0, stdout: '', stderr: '' };
    }
  });

  assert.equal(result, true);
  const addCall = gitCalls.find(args => args.includes('add'));
  assert.ok(addCall, 'expected a git add call');
  assert.ok(addCall.includes('docs/missions/2026/task-1218/smått.md'), 'expected UTF-8 decoded path');
});

test('enforceDraftCommitSafety still blocks deletion of a quoted mission task path', () => {
  assert.throws(
    () => enforceDraftCommitSafety({
      slug: 'task-1207',
      worktree: '/tmp/wt',
      dirtyEntries: [' D "backlog/tasks/task-1207 - add-automatic-pricing-functionality-to-BE-Web.md"'],
      gitImpl: () => ({ status: 0, stdout: '', stderr: '' })
    }),
    /deletion of the mission backlog task: backlog\/tasks\/task-1207 - add-automatic-pricing-functionality-to-BE-Web\.md/
  );
});

test('recordDraftImplementer resolves the task file from the mission worktree, not the caller cwd', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-draft-wt-resolve-'));
  try {
    const worktree = path.join(root, 'visualBoard-task-086');
    const taskDir = path.join(worktree, 'backlog', 'tasks');
    fs.mkdirSync(taskDir, { recursive: true });
    const taskFile = path.join(taskDir, 'task-086 - some-task.md');
    fs.writeFileSync(taskFile, 'status: active');

    const calls = [];
    const logs = [];
    recordDraftImplementer({
      selected: 'gemini',
      actual: 'gemini',
      taskResolution: { ok: true, taskFile },
      slug: 'task-086',
      worktree,
      log(message) { logs.push(message); },
      enforceTaskAssigneeFn(file, agent) {
        calls.push({ file, agent });
        return true;
      },
      gitFn(args) {
        const addIdx = args.indexOf('add');
        if (addIdx !== -1) {
          const addedPath = args[addIdx + 1];
          assert.ok(
            !path.isAbsolute(addedPath),
            `git add path must be relative to worktree, got: ${addedPath}`
          );
          assert.ok(
            !addedPath.startsWith(root),
            `git add path must not be an absolute caller-cwd path, got: ${addedPath}`
          );
        }
        return { status: 0, stdout: '', stderr: '' };
      }
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].file, taskFile);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('bootstrapBacklogTask copies task from main repo if missing in worktree', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-draft-test-'));
  try {
    const mainRepo = path.join(root, 'main');
    const worktree = path.join(root, 'wt');
    const taskRelPath = path.join('backlog', 'tasks', 'task-999 example.md');
    const mainTaskPath = path.join(mainRepo, taskRelPath);
    const wtTaskPath = path.join(worktree, taskRelPath);

    fs.mkdirSync(path.dirname(mainTaskPath), { recursive: true });
    fs.writeFileSync(mainTaskPath, 'status: backlog');

    fs.mkdirSync(worktree, { recursive: true });

    const ok = bootstrapBacklogTask(worktree, mainRepo, 'task-999');

    assert.equal(ok, true);
    assert.equal(fs.existsSync(wtTaskPath), true);
    assert.equal(fs.readFileSync(wtTaskPath, 'utf8'), 'status: backlog');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('bootstrapBacklogTask returns false when task is missing on main', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-draft-fail-test-'));
  try {
    const mainRepo = path.join(root, 'main');
    const worktree = path.join(root, 'wt');
    fs.mkdirSync(mainRepo, { recursive: true });
    fs.mkdirSync(worktree, { recursive: true });

    const ok = bootstrapBacklogTask(worktree, mainRepo, 'task-none');
    assert.equal(ok, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('ensureGraphifyWorkspace creates an independent graphify-out directory in the worktree', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-graphify-dir-'));

  try {
    const worktree = path.join(root, 'visualBoard-task-999');
    const targetGraph = path.join(worktree, 'graphify-out');

    fs.mkdirSync(worktree, { recursive: true });

    const created = ensureGraphifyWorkspace(worktree);

    assert.equal(created, true);
    assert.equal(fs.lstatSync(targetGraph).isDirectory(), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------- runDraftCommand — status transition contract ----------

test('runDraftCommand transitions task to backlog after setup completes', async () => {
  const transitions = [];
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'run-draft-backlog-'));
  const taskFile = path.join(tmpRoot, 'backlog', 'tasks', 'task-tst.md');
  fs.mkdirSync(path.dirname(taskFile), { recursive: true });
  fs.writeFileSync(taskFile, ['---', 'id: TASK-TST', 'labels: [ai_sdlc]', 'status: backlog', '---'].join('\n'));

  try {
    await runDraftCommand(['task-tst'], {
      inferSlugFn: () => 'task-tst',
      resolveMainRepoFn: () => tmpRoot,
      conventionalWorktreePathFn: () => '/wt-tst',
      ensureRepoExistsFn: () => true,
      resolveTaskFileFn: () => ({ ok: true, taskFile, matches: [] }),
      checkBacklogIntegrityFn: () => [],
      detectLaunchBaseBranchFn: () => null,
      ensureMissionBranchFn: () => {},
      ensureWorktreeFn: () => {},
      ensureGraphifyWorkspaceFn: () => {},
      ensureMissionFileFn: () => '/wt-tst/docs/missions/2026/task-tst/MISSION.md',
      bootstrapBacklogTaskFn: () => true,
      transitionTaskFn: (slug, status, opts) => { transitions.push({ slug, status, rootDir: opts.rootDir }); return true; },
      readAgentConfigOrExitFn: () => ({}),
      selectAgentFn: () => 'codex',
      startDraftAgentFn: async () => ({ agent: 'codex', result: { status: 0 } }),
      recordDraftImplementerFn: () => {},
      enforceDraftCommitSafetyFn: () => false,
      validateDraftClassificationFn: () => ({ ok: true }),
      [normalizeKey]: () => ({ ok: true, [typeKey]: 'ai_sdlc' }),
      exitFn: (code) => { throw new Error(`unexpected exit ${code}`); },
      logFn: () => {},
      errorFn: (msg) => { throw new Error(`unexpected error: ${msg}`); }
    });
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }

  const backlogTransition = transitions.find(t => t.status === 'backlog');
  assert.ok(backlogTransition, 'must transition to backlog after setup');
  assert.equal(backlogTransition.slug, 'task-tst');
  assert.equal(backlogTransition.rootDir, '/wt-tst');
});

test('runDraftCommand transitions task to refined after draft agent succeeds and safety harness passes', async () => {
  const transitions = [];
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'run-draft-ready-'));
  const taskFile = path.join(tmpRoot, 'backlog', 'tasks', 'task-tst.md');
  fs.mkdirSync(path.dirname(taskFile), { recursive: true });
  fs.writeFileSync(taskFile, ['---', 'id: TASK-TST', 'labels: [ai_sdlc]', 'status: backlog', '---'].join('\n'));

  try {
    await runDraftCommand(['task-tst'], {
      inferSlugFn: () => 'task-tst',
      resolveMainRepoFn: () => tmpRoot,
      conventionalWorktreePathFn: () => '/wt-tst',
      ensureRepoExistsFn: () => true,
      resolveTaskFileFn: () => ({ ok: true, taskFile, matches: [] }),
      checkBacklogIntegrityFn: () => [],
      detectLaunchBaseBranchFn: () => null,
      ensureMissionBranchFn: () => {},
      ensureWorktreeFn: () => {},
      ensureGraphifyWorkspaceFn: () => {},
      ensureMissionFileFn: () => '/wt-tst/docs/missions/2026/task-tst/MISSION.md',
      bootstrapBacklogTaskFn: () => true,
      transitionTaskFn: (slug, status, opts) => { transitions.push({ slug, status, rootDir: opts.rootDir }); return true; },
      readAgentConfigOrExitFn: () => ({}),
      selectAgentFn: () => 'codex',
      startDraftAgentFn: async () => ({ agent: 'codex', result: { status: 0 } }),
      recordDraftImplementerFn: () => {},
      enforceDraftCommitSafetyFn: () => false,
      validateDraftClassificationFn: () => ({ ok: true }),
      [normalizeKey]: () => ({ ok: true, [typeKey]: 'ai_sdlc' }),
      exitFn: (code) => { throw new Error(`unexpected exit ${code}`); },
      logFn: () => {},
      errorFn: (msg) => { throw new Error(`unexpected error: ${msg}`); }
    });
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }

  const refinedTransition = transitions.find(t => t.status === 'refined');
  assert.ok(refinedTransition, 'must transition to refined after draft agent completes and safety harness passes');
  assert.equal(refinedTransition.slug, 'task-tst');
  assert.equal(refinedTransition.rootDir, '/wt-tst');

  // backlog transition must precede refined transition
  const backlogIdx = transitions.findIndex(t => t.status === 'backlog');
  const refinedIdx = transitions.findIndex(t => t.status === 'refined');
  assert.ok(backlogIdx < refinedIdx, 'backlog transition must happen before refined');
});

test('runDraftCommand does not transition to refined when draft agent exits non-zero', async () => {
  const transitions = [];
  let exitCode = null;

  await runDraftCommand(['task-tst'], {
    inferSlugFn: () => 'task-tst',
    resolveMainRepoFn: () => '/main',
    conventionalWorktreePathFn: () => '/wt-tst',
    ensureRepoExistsFn: () => true,
    resolveTaskFileFn: () => ({ ok: true, taskFile: '/main/backlog/tasks/task-tst.md', matches: [] }),
    checkBacklogIntegrityFn: () => [],
    detectLaunchBaseBranchFn: () => null,
    ensureMissionBranchFn: () => {},
    ensureWorktreeFn: () => {},
    ensureGraphifyWorkspaceFn: () => {},
    ensureMissionFileFn: () => '/wt-tst/docs/missions/2026/task-tst/MISSION.md',
    bootstrapBacklogTaskFn: () => true,
    transitionTaskFn: (slug, status, opts) => { transitions.push({ slug, status }); return true; },
    readAgentConfigOrExitFn: () => ({}),
    selectAgentFn: () => 'codex',
    startDraftAgentFn: async () => ({ agent: 'codex', result: { status: 1 } }),
    recordDraftImplementerFn: () => {},
    enforceDraftCommitSafetyFn: () => false,
    exitFn: (code) => { exitCode = code; },
    logFn: () => {},
    errorFn: () => {}
  });

  assert.equal(exitCode, 1);
  assert.ok(!transitions.some(t => t.status === 'refined'), 'must not transition to refined when draft agent fails');
});

test('runDraftCommand does not transition to refined when safety harness throws', async () => {
  const transitions = [];
  let exitCode = null;

  await runDraftCommand(['task-tst'], {
    inferSlugFn: () => 'task-tst',
    resolveMainRepoFn: () => '/main',
    conventionalWorktreePathFn: () => '/wt-tst',
    ensureRepoExistsFn: () => true,
    resolveTaskFileFn: () => ({ ok: true, taskFile: '/main/backlog/tasks/task-tst.md', matches: [] }),
    checkBacklogIntegrityFn: () => [],
    detectLaunchBaseBranchFn: () => null,
    ensureMissionBranchFn: () => {},
    ensureWorktreeFn: () => {},
    ensureGraphifyWorkspaceFn: () => {},
    ensureMissionFileFn: () => '/wt-tst/docs/missions/2026/task-tst/MISSION.md',
    bootstrapBacklogTaskFn: () => true,
    transitionTaskFn: (slug, status, opts) => { transitions.push({ slug, status }); return true; },
    readAgentConfigOrExitFn: () => ({}),
    selectAgentFn: () => 'codex',
    startDraftAgentFn: async () => ({ agent: 'codex', result: { status: 0 } }),
    recordDraftImplementerFn: () => {},
    enforceDraftCommitSafetyFn: () => { throw new Error('shared-file conflicts: lib/common.js'); },
    exitFn: (code) => { exitCode = code; },
    logFn: () => {},
    errorFn: () => {}
  });

  assert.equal(exitCode, 1);
  assert.ok(!transitions.some(t => t.status === 'refined'), 'must not transition to refined when safety harness fails');
});
