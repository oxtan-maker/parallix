// @ts-nocheck -- TASK-2328: partial test doubles from ESM seam migration; resolve in follow-up
// Behavior-owned suite (TASK-2622.09): the Git and mission-path adapter contract — porcelain/plumbing
// wrappers, pure helpers, diff target resolution, and mission path/worktree resolution. Sections keep
// their legacy case names and name their source files. Unit tier: Git and the filesystem are recorded
// doubles; real-Git adapter contracts live in the integration suites.
import test, { mock, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as childProcess from 'node:child_process';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import pathModule from 'node:path';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import { mockModule, installModuleMocks, moduleMockOptions } from './lib/module-mock.js';
import * as git from '../src/adapters/git/git.js';
import { mkdtemp as registeredMkdtemp } from './helpers/temp-dir.js';

// Declaration order is load-bearing: installModuleMocks relinks modules in this order, so a
// module must be declared after the modules it depends on (merged from every section below).
mockModule('../src/adapters/git/git.js', import.meta.url);
mockModule('../src/adapters/cli/commands/diff.js', import.meta.url);
mockModule('../src/adapters/filesystem/mission-paths.js', import.meta.url);
mockModule('../src/adapters/filesystem/mission-utils.js', import.meta.url);
await installModuleMocks();

// ---- git adapter wrappers (consolidated from test/git.test.ts, TASK-2622.09) ----
describe("git adapter wrappers", () => {
  test.afterEach(() => mock.restoreAll());


  const _require = createRequire(import.meta.url);
  const git = mockModule<typeof import('../src/adapters/git/git.js')>('../src/adapters/git/git.js', import.meta.url);

  const { mock } = test;

  function mockSpawnSync(fake: (...args: unknown[]) => Record<string, unknown>): void {
    mock.restoreAll();
    mock.module('node:child_process', {
      fallback: true,
      ...moduleMockOptions({ ...childProcess, spawnSync: fake }),
    });
  }

  test('git returns successful output when spawnSync reports status 0 with a non-fatal error object', async () => {
    let callCount = 0;
    mockSpawnSync(() => {
      callCount++;
      return { status: 0, stdout: 'abc\n', stderr: '', error: new Error('EPERM') };
    });

    // Re-import git to pick up the mocked child_process
    const { git: gitFn } = await import('../src/adapters/git/git.js?mock=' + Date.now());
    const result = gitFn(['status']);

    assert.equal(result.stdout, 'abc\n');
    assert.equal(callCount, 1);
  });

  test('run throws when spawnSync reports an error without a status', async () => {
    mockSpawnSync(() => ({
      status: null,
      stdout: '',
      stderr: '',
      error: new Error('ENOENT')
    }));

    const { run } = await import('../src/adapters/git/git.js?mock=' + Date.now());
    assert.throws(() => run('node', ['--version']), /ENOENT/);
  });

  test('getCurrentBranch trims stdout', async () => {
    mockSpawnSync(() => ({
      status: 0,
      stdout: 'mission/task-1031\n',
      stderr: ''
    }));

    const { getCurrentBranch } = await import('../src/adapters/git/git.js?mock=' + Date.now());
    assert.equal(getCurrentBranch('/tmp/repo'), 'mission/task-1031');
  });

  test('getWorktreeStatus returns trimmed non-empty lines', async () => {
    mockSpawnSync(() => ({
      status: 0,
      stdout: ' M file-a.js  \n?? file-b.js\n\n',
      stderr: ''
    }));

    const { getWorktreeStatus } = await import('../src/adapters/git/git.js?mock=' + Date.now());
    assert.deepEqual(getWorktreeStatus('/tmp/repo'), [' M file-a.js', '?? file-b.js']);
  });

  test('isDirty reflects porcelain output presence', async () => {
    const responses = [
      { status: 0, stdout: '', stderr: '' },
      { status: 0, stdout: ' M file-a.js\n', stderr: '' }
    ];
    mockSpawnSync(() => responses.shift());

    const { isDirty } = await import('../src/adapters/git/git.js?mock=' + Date.now());
    assert.equal(isDirty('/tmp/repo'), false);
    assert.equal(isDirty('/tmp/repo'), true);
  });

  test('getUncommittedCount counts lines and returns zero when clean', async () => {
    const responses = [
      { status: 0, stdout: ' M file-a.js\n?? file-b.js\n', stderr: '' },
      { status: 0, stdout: '\n', stderr: '' }
    ];
    mockSpawnSync(() => responses.shift());

    const { getUncommittedCount } = await import('../src/adapters/git/git.js?mock=' + Date.now());
    assert.equal(getUncommittedCount('/tmp/repo'), 2);
    assert.equal(getUncommittedCount('/tmp/repo'), 0);
  });

  test('detectRebaseState reports active rebase with detached head and unmerged files', () => {
    const fsModule = {
      existsSync(target) {
        return target === '/tmp/repo/.git/rebase-merge';
      }
    };
    const calls = [];

    const result = git.detectRebaseState('/tmp/repo', {
      fsModule,
      pathModule,
      gitRunner(args) {
        calls.push(args);
        if (args.includes('rev-parse')) {
          return { status: 0, stdout: '.git\n', stderr: '' };
        }
        if (args.includes('symbolic-ref')) {
          return { status: 1, stdout: '', stderr: 'fatal: ref HEAD is not a symbolic ref' };
        }
        if (args.includes('rebase') && args.includes('--show-current')) {
          return { status: 0, stdout: 'abc123def456\n', stderr: '' };
        }
        if (args.includes('ls-files') && args.includes('-u')) {
          return {
            status: 0,
            stdout: [
              '100644 aaaaa 1\tbacklog/tasks/task-1322 - prevent-backlog-task-id-recycling-collision.md',
              '100644 bbbbb 2\tmissions/task-1322/review-state.json',
              '100644 ccccc 3\tmissions/task-1322/CP-4.md'
            ].join('\n'),
            stderr: ''
          };
        }
        throw new Error(`Unexpected git args: ${args.join(' ')}`);
      }
    });

    assert.deepEqual(result, {
      inProgress: true,
      rebaseHead: 'abc123def456',
      detached: true,
      unmergedFiles: [
        'backlog/tasks/task-1322 - prevent-backlog-task-id-recycling-collision.md',
        'missions/task-1322/review-state.json',
        'missions/task-1322/CP-4.md'
      ],
      rebaseDir: '/tmp/repo/.git/rebase-merge'
    });
    assert.equal(calls.length, 4);
  });

  test('detectRebaseState reports false for a clean worktree with no rebase activity', () => {
    const result = git.detectRebaseState('/tmp/repo', {
      fsModule: { existsSync: () => false },
      pathModule: _require('path'),
      gitRunner(args) {
        if (args.includes('rev-parse')) {
          return { status: 0, stdout: '.git\n', stderr: '' };
        }
        if (args.includes('symbolic-ref')) {
          return { status: 0, stdout: 'mission/task-1328\n', stderr: '' };
        }
        if (args.includes('rebase') && args.includes('--show-current')) {
          return { status: 0, stdout: '\n', stderr: '' };
        }
        if (args.includes('ls-files') && args.includes('-u')) {
          return { status: 0, stdout: '', stderr: '' };
        }
        throw new Error(`Unexpected git args: ${args.join(' ')}`);
      }
    });

    assert.deepEqual(result, {
      inProgress: false,
      rebaseHead: '',
      detached: false,
      unmergedFiles: [],
      rebaseDir: null
    });
  });

  test('detectRebaseState reports false once rebase metadata is gone and head is attached', () => {
    const result = git.detectRebaseState('/tmp/repo', {
      fsModule: { existsSync: () => false },
      pathModule: _require('path'),
      gitRunner(args) {
        if (args.includes('rev-parse')) {
          return { status: 0, stdout: '.git\n', stderr: '' };
        }
        if (args.includes('symbolic-ref')) {
          return { status: 0, stdout: 'mission/task-1328\n', stderr: '' };
        }
        if (args.includes('rebase') && args.includes('--show-current')) {
          return { status: 0, stdout: '', stderr: '' };
        }
        if (args.includes('ls-files') && args.includes('-u')) {
          return { status: 0, stdout: '', stderr: '' };
        }
        throw new Error(`Unexpected git args: ${args.join(' ')}`);
      }
    });

    assert.equal(result.inProgress, false);
    assert.equal(result.detached, false);
    assert.equal(result.rebaseDir, null);
    assert.deepEqual(result.unmergedFiles, []);
  });

  test('getLastCommit parses sha, date, and subject', async () => {
    mockSpawnSync(() => ({
      status: 0,
      stdout: 'abcdef123|2026-04-30|Fix workflow gate\n',
      stderr: ''
    }));

    const { getLastCommit } = await import('../src/adapters/git/git.js?mock=' + Date.now());
    assert.deepEqual(getLastCommit(), {
      sha: 'abcdef123',
      date: '2026-04-30',
      subject: 'Fix workflow gate'
    });
  });

  test('getLastThreeCommits splits commit subjects', async () => {
    mockSpawnSync(() => ({
      status: 0,
      stdout: 'one\ntwo\nthree\n',
      stderr: ''
    }));

    const { getLastThreeCommits } = await import('../src/adapters/git/git.js?mock=' + Date.now());
    assert.deepEqual(getLastThreeCommits(), ['one', 'two', 'three']);
  });
});

// ---- git pure helpers (consolidated from test/git-pure.test.ts, TASK-2622.09) ----
describe("git pure helpers", () => {
  // mockModule/@ts-nocheck pattern in test/stats-backfill.test.ts.

  function tempDir(prefix = 'git-pure-') {
    return registeredMkdtemp(prefix);
  }
  function cleanup(dir) { fs.rmSync(dir, { recursive: true, force: true }); }

  // ---------- parseUnmergedFiles (pure: returns the second porcelain column) ----------

  test('parseUnmergedFiles extracts the second column from porcelain -u output', () => {
    // git ls-files -u columns are <sha>\t<path>\t<more>; the helper reads column 1.
    const output = 'deadbeef\ta.txt\ndeadbeef\tb.txt\n';
    assert.deepEqual(git.parseUnmergedFiles(output), ['a.txt', 'b.txt']);
  });

  test('parseUnmergedFiles dedupes identical rows and skips blank lines', () => {
    const output = 'sha\ta.txt\nsha\ta.txt\n\n';
    assert.deepEqual(git.parseUnmergedFiles(output), ['a.txt']);
  });

  test('parseUnmergedFiles returns an empty array for empty output', () => {
    assert.deepEqual(git.parseUnmergedFiles(''), []);
  });

  // ---------- detectRebaseState (injected gitRunner + fsModule) ----------

  test('detectRebaseState reports in-progress when a rebase-merge directory exists', () => {
    const state = git.detectRebaseState('/nonexistent', {
      gitRunner: () => ({ status: 0, stdout: '.git' }),
      fsModule: { existsSync: () => true },
      pathModule: { isAbsolute: (p) => p.startsWith('/'), join: (...p) => p.join('/') },
    });
    assert.equal(state.inProgress, true);
    assert.equal(state.rebaseDir != null, true);
  });

  test('detectRebaseState reports a clean, attached HEAD when no rebase is running', () => {
    const state = git.detectRebaseState('/nonexistent', {
      gitRunner: (args) => {
        if (args.includes('--git-dir')) return { status: 0, stdout: '.git' };
        if (args.includes('symbolic-ref')) return { status: 0, stdout: 'main' };
        return { status: 1, stdout: '' }; // show-current + ls-files: nothing in progress
      },
      fsModule: { existsSync: () => false },
      pathModule: { isAbsolute: (p) => p.startsWith('/'), join: (...p) => p.join('/') },
    });
    assert.equal(state.inProgress, false);
    assert.equal(state.detached, false);
    assert.equal(state.rebaseDir, null);
  });

  test('detectRebaseState reports detached HEAD when symbolic-ref fails', () => {
    const state = git.detectRebaseState('/nonexistent', {
      gitRunner: (args) => {
        if (args.includes('--git-dir')) return { status: 0, stdout: '.git' };
        if (args.includes('symbolic-ref')) return { status: 1, stdout: '' };
        return { status: 1, stdout: '' };
      },
      fsModule: { existsSync: () => false },
      pathModule: { isAbsolute: (p) => p.startsWith('/'), join: (...p) => p.join('/') },
    });
    assert.equal(state.detached, true);
  });

  // ---------- findIgnoredSourceFiles (injected gitFn over a real temp tree) ----------

  test('findIgnoredSourceFiles returns source files that the injected git function reports as ignored', () => {
    const dir = tempDir();
    try {
      fs.writeFileSync(path.join(dir, 'ignored.ts'), '// x\n');
      fs.writeFileSync(path.join(dir, 'tracked.ts'), '// y\n');
      const gitFn = (args) => ({
        status: args.includes('ignored.ts') ? 0 : 1,
        stdout: '',
      });
      const files = git.findIgnoredSourceFiles(dir, gitFn);
      assert.deepEqual(files, ['ignored.ts']);
    } finally { cleanup(dir); }
  });

  test('findIgnoredSourceFiles returns an empty list when the directory cannot be read', () => {
    const gitFn = () => ({ status: 0, stdout: '' });
    assert.deepEqual(git.findIgnoredSourceFiles('/definitely-missing-dir-12345', gitFn), []);
  });
});

// ---- diff adapter (consolidated from test/diff.test.ts, TASK-2622.09) ----
describe("diff adapter", () => {
  // Mock child_process and other dependencies

  const diff = mockModule<typeof import('../src/adapters/cli/commands/diff.js')>('../src/adapters/cli/commands/diff.js', import.meta.url);

  test.afterEach(() => mock.restoreAll());
  const mockGit = (responses) => (args, options = {}) => {
    const cmd = args.join(' ');
    for (const [pattern, response] of responses) {
      if (pattern instanceof RegExp ? pattern.test(cmd) : cmd.includes(pattern)) {
        return response;
      }
    }
    return { status: 0, stdout: '', stderr: '' };
  };

  test('node parallix diff resolves correct target branches', async (t) => {
    const calls = [];
    const worktree = '/tmp/mission-task-1147';

    const gitFn = mockGit([
      [/config --get diff.tool/, { status: 0, stdout: 'difftastic\n' }],
      [/branch --list --format/, { status: 0, stdout: 'main\n' }]
    ]);

    const spawnSync = (cmd, args, opts) => {
      calls.push({ cmd, args, opts });
      return { status: 0 };
    };

    await diff.default(['task-1147'], {
      gitFn,
      spawnSyncFn: spawnSync,
      inferSlugFn: () => 'task-1147',
      resolveWorktreeFn: () => worktree,
      getPrimaryBranchFn: () => 'main',
      missionBranchNameFn: (slug) => `mission/${slug}`,
      exitFn: (code) => calls.push(['exit', code])
    });

    const diffCall = calls.find(c => c.cmd === 'git');
    assert.ok(diffCall, 'should have called git');
    assert.deepEqual(diffCall.args, ['difftool', '-d', '--no-prompt', 'main..HEAD']);
    assert.equal(diffCall.opts.cwd, worktree);
  });

  test('node parallix diff detects pager.diff', async (t) => {
    const calls = [];
    const worktree = '/tmp/mission-task-1147';

    const gitFn = mockGit([
      [/config --get diff.tool/, { status: 1, stdout: '' }],
      [/config --get pager.diff/, { status: 0, stdout: 'delta\n' }],
      [/branch --list --format/, { status: 0, stdout: 'main\n' }]
    ]);

    const spawnSync = (cmd, args, opts) => {
      calls.push({ cmd, args, opts });
      return { status: 0 };
    };

    await diff.default(['task-1147'], {
      gitFn,
      spawnSyncFn: spawnSync,
      inferSlugFn: () => 'task-1147',
      resolveWorktreeFn: () => worktree,
      getPrimaryBranchFn: () => 'main',
      missionBranchNameFn: (slug) => `mission/${slug}`,
      exitFn: (code) => calls.push(['exit', code])
    });

    const diffCall = calls.find(c => c.cmd === 'git');
    assert.ok(diffCall, 'should have called git');
    assert.deepEqual(diffCall.args, ['diff', 'main..HEAD']);
    assert.equal(diffCall.opts.cwd, worktree);
  });

  test('node parallix diff detects core.pager', async (t) => {
    const calls = [];
    const worktree = '/tmp/mission-task-1147';

    const gitFn = mockGit([
      [/config --get diff.tool/, { status: 1, stdout: '' }],
      [/config --get pager.diff/, { status: 1, stdout: '' }],
      [/config --get core.pager/, { status: 0, stdout: 'delta\n' }],
      [/branch --list --format/, { status: 0, stdout: 'main\n' }]
    ]);

    const spawnSync = (cmd, args, opts) => {
      calls.push({ cmd, args, opts });
      return { status: 0 };
    };

    await diff.default(['task-1147'], {
      gitFn,
      spawnSyncFn: spawnSync,
      inferSlugFn: () => 'task-1147',
      resolveWorktreeFn: () => worktree,
      getPrimaryBranchFn: () => 'main',
      missionBranchNameFn: (slug) => `mission/${slug}`,
      exitFn: (code) => calls.push(['exit', code])
    });

    const diffCall = calls.find(c => c.cmd === 'git');
    assert.ok(diffCall, 'should have called git');
    assert.deepEqual(diffCall.args, ['diff', 'main..HEAD']);
    assert.equal(diffCall.opts.cwd, worktree);
  });

  test('node parallix diff rejects less variants', async (t) => {
    const calls = [];

    const gitFn = mockGit([
      [/config --get diff.tool/, { status: 1, stdout: '' }],
      [/config --get pager.diff/, { status: 1, stdout: '' }],
      [/config --get core.pager/, { status: 0, stdout: 'less -FRX\n' }],
      [/branch --list --format/, { status: 0, stdout: 'main\n' }]
    ]);

    await diff.default(['task-1147'], {
      gitFn,
      spawnSyncFn: () => ({ status: 0 }),
      inferSlugFn: () => 'task-1147',
      resolveWorktreeFn: () => '/tmp/mission-task-1147',
      getPrimaryBranchFn: () => 'main',
      missionBranchNameFn: (slug) => `mission/${slug}`,
      exitFn: (code) => calls.push(['exit', code]),
      failFn: (msg) => calls.push(['fail', msg])
    });

    assert.deepEqual(calls.find(c => c[0] === 'exit'), ['exit', 1]);
    assert.ok(calls.find(c => c[0] === 'fail')?.toString().includes('No specialized local diff tool'), 'should have failed with specialized tool message');
  });

  test('node parallix diff fails on spawn error', async (t) => {
    const calls = [];

    const gitFn = mockGit([
      [/config --get diff.tool/, { status: 0, stdout: 'difftastic\n' }],
      [/branch --list --format/, { status: 0, stdout: 'main\n' }]
    ]);

    await diff.default(['task-1147'], {
      gitFn,
      spawnSyncFn: () => ({ error: new Error('spawn failed'), status: null }),
      inferSlugFn: () => 'task-1147',
      resolveWorktreeFn: () => '/tmp/mission-task-1147',
      getPrimaryBranchFn: () => 'main',
      missionBranchNameFn: (slug) => `mission/${slug}`,
      exitFn: (code) => calls.push(['exit', code]),
      failFn: (msg) => calls.push(['fail', msg])
    });

    assert.deepEqual(calls.find(c => c[0] === 'exit'), ['exit', 1]);
    assert.ok(calls.find(c => c[0] === 'fail')?.toString().includes('Failed to launch'), 'should have logged spawn failure');
  });

  test('node parallix diff fails on spawn signal', async (t) => {
    const calls = [];

    const gitFn = mockGit([
      [/config --get diff.tool/, { status: 0, stdout: 'difftastic\n' }],
      [/branch --list --format/, { status: 0, stdout: 'main\n' }]
    ]);

    await diff.default(['task-1147'], {
      gitFn,
      spawnSyncFn: () => ({ signal: 'SIGKILL', status: null }),
      inferSlugFn: () => 'task-1147',
      resolveWorktreeFn: () => '/tmp/mission-task-1147',
      getPrimaryBranchFn: () => 'main',
      missionBranchNameFn: (slug) => `mission/${slug}`,
      exitFn: (code) => calls.push(['exit', code]),
      failFn: (msg) => calls.push(['fail', msg])
    });

    assert.deepEqual(calls.find(c => c[0] === 'exit'), ['exit', 1]);
    assert.ok(calls.find(c => c[0] === 'fail')?.toString().includes('terminated by signal'), 'should have logged signal termination');
  });

  test('node parallix diff fails when slug cannot be inferred', async (t) => {
    const calls = [];

    await diff.default([], {
      gitFn: () => ({ status: 0 }),
      spawnSyncFn: () => ({ status: 0 }),
      inferSlugFn: () => null,
      exitFn: (code) => calls.push(['exit', code]),
      failFn: (msg) => calls.push(['fail', msg])
    });

    assert.deepEqual(calls.find(c => c[0] === 'exit'), ['exit', 1]);
    assert.ok(calls.find(c => c[0] === 'fail'), 'should have logged a failure');
  });

  test('node parallix diff fails when primary branch detection fails', async (t) => {
    const calls = [];

    await diff.default(['task-1147'], {
      gitFn: () => ({ status: 0 }),
      spawnSyncFn: () => ({ status: 0 }),
      inferSlugFn: () => 'task-1147',
      resolveWorktreeFn: () => '/tmp/mission-task-1147',
      getPrimaryBranchFn: () => { throw new Error('detection failed'); },
      exitFn: (code) => calls.push(['exit', code]),
      failFn: (msg) => calls.push(['fail', msg])
    });

    assert.deepEqual(calls.find(c => c[0] === 'exit'), ['exit', 1]);
    assert.ok(calls.find(c => c[0] === 'fail'), 'should have logged a failure');
  });

  test('node parallix diff fails when no tool is configured', async (t) => {
    const calls = [];

    const gitFn = mockGit([
      [/config --get diff.tool/, { status: 1, stdout: '' }],
      [/config --get pager.diff/, { status: 1, stdout: '' }],
      [/config --get core.pager/, { status: 0, stdout: 'less\n' }]
    ]);

    await diff.default(['task-1147'], {
      gitFn,
      spawnSyncFn: () => ({ status: 0 }),
      inferSlugFn: () => 'task-1147',
      resolveWorktreeFn: () => '/tmp/mission-task-1147',
      getPrimaryBranchFn: () => 'main',
      missionBranchNameFn: (slug) => `mission/${slug}`,
      exitFn: (code) => calls.push(['exit', code]),
      failFn: (msg) => calls.push(['fail', msg])
    });

    assert.deepEqual(calls.find(c => c[0] === 'exit'), ['exit', 1]);
    assert.ok(calls.find(c => c[0] === 'fail'), 'should have logged a failure');
  });

  test('node parallix diff fails when mission worktree cannot be resolved', async (t) => {
    const calls = [];

    await diff.default(['task-1147'], {
      gitFn: () => ({ status: 0 }),
      spawnSyncFn: () => ({ status: 0 }),
      inferSlugFn: () => 'task-1147',
      resolveWorktreeFn: () => null,
      getPrimaryBranchFn: () => 'main',
      exitFn: (code) => calls.push(['exit', code]),
      failFn: (msg) => calls.push(['fail', msg])
    });

    assert.deepEqual(calls.find(c => c[0] === 'exit'), ['exit', 1]);
    assert.ok(calls.find(c => c[0] === 'fail')?.[1].includes('Mission worktree not found'));
  });
});

// ---- mission path resolution (consolidated from test/mission-utils-paths.test.ts, TASK-2622.09) ----
describe("mission path resolution", () => {
  const git = mockModule<typeof import('../src/adapters/git/git.js')>('../src/adapters/git/git.js', import.meta.url);
  mockModule<typeof import('../src/adapters/filesystem/mission-paths.js')>('../src/adapters/filesystem/mission-paths.js', import.meta.url);
  const __mm1 = mockModule<typeof import('../src/adapters/filesystem/mission-utils.js')>('../src/adapters/filesystem/mission-utils.js', import.meta.url);

  test.afterEach(() => mock.restoreAll());
  const {
    findMissionDir,
    findCheckpoints,
    missionTitle,
    detectMissionAreaFromContent,
    findMissionArea,
    missionPathForSlug,
    missionDirForSlug,
    normalizeVerifyArea,
    inferSlug,
    getMissionYear,
  } = __mm1;

  const FAKE_ROOT = '/tmp/mission';

  function withTempRepo(fn) {
    const previous = process.cwd();
    const root = fs.realpathSync(registeredMkdtemp('workflow-mission-utils-'));
    process.chdir(root);
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({
      adapters: { missions: { baseDir: 'docs/missions' } },
    }));

    try {
      fn(root);
    } finally {
      process.chdir(previous);
      fs.rmSync(root, { recursive: true, force: true });
    }
  }

  test('findCheckpoints supports CP-* and CHECKPOINT_* naming', () => {
    withTempRepo(root => {
      const missionDir = path.join(root, 'docs', 'missions', '2026', 'task-081');
      fs.mkdirSync(missionDir, { recursive: true });
      fs.writeFileSync(path.join(missionDir, 'MISSION.md'), '# Mission: Example\n');
      fs.writeFileSync(path.join(missionDir, 'CP-2.md'), '# CP-2\n');
      fs.writeFileSync(path.join(missionDir, 'CHECKPOINT_10.md'), '# CP-10\n');
      fs.writeFileSync(path.join(missionDir, 'CP-1.md'), '# CP-1\n');

      const resolvedDir = findMissionDir('task-081');
      assert.equal(resolvedDir, missionDir);
      assert.deepEqual(
        findCheckpoints(missionDir).map(file => path.basename(file)),
        ['CP-1.md', 'CP-2.md', 'CHECKPOINT_10.md']
      );
      assert.equal(missionTitle('task-081'), 'Example');
    });
  });

  test('inferSlug identifies slug from explicit arg, current branch, directory name, or worktree', () => {
    const originalBranch = git.getCurrentBranch;
    const originalGit = git.git;
    const originalCwd = process.cwd;

    try {
      // 1. Explicit arg wins
      assert.equal(inferSlug('task-081'), 'task-081');
      assert.equal(inferSlug('TASK-081'), 'task-081');
      assert.equal(inferSlug('adhoc-hello-world'), 'adhoc-hello-world');

      // 2. Inference from mission branch
      mock.method(git, 'getCurrentBranch', () => 'mission/task-118');
      assert.equal(inferSlug(), 'task-118');

      // 3. Inference from non-mission branch falls back to directory
      mock.method(git, 'getCurrentBranch', () => 'main');
      process.cwd = () => `/tmp/anyProject-task-119`;
      assert.equal(inferSlug(), 'task-119');

      mock.method(git, 'getCurrentBranch', () => 'main');
      process.cwd = () => `/tmp/anyProject-adhoc-hello-world`;
      assert.equal(inferSlug(), 'adhoc-hello-world');

      // 4. Inference from worktree registry
      mock.method(git, 'getCurrentBranch', () => 'detached');
      process.cwd = () => '/tmp/random-dir';
      mock.method(git, 'git', (args) => {
        if (args.includes('worktree') && args.includes('list')) {
          return {
            stdout: `worktree ${FAKE_ROOT}\nbranch refs/heads/master\n\nworktree /tmp/random-dir\nbranch refs/heads/mission/task-120\n\n`
          };
        }
        return { stdout: '' };
      });
      assert.equal(inferSlug(), 'task-120');

      // 5. Mixed case branch
      mock.method(git, 'getCurrentBranch', () => 'mission/TASK-099');
      process.cwd = () => FAKE_ROOT;
      assert.equal(inferSlug(), 'task-099');
    } finally {
      git.getCurrentBranch = originalBranch;
      git.git = originalGit;
      process.cwd = originalCwd;
    }
  });

  test('detectMissionAreaFromContent uses repo gates deterministically', () => {
    withTempRepo(root => {
      assert.equal(detectMissionAreaFromContent('- [ ] ./scripts/verify-local.sh docs'), 'docs');
      assert.equal(detectMissionAreaFromContent('- [ ] ./scripts/verify-local.sh auth-server'), 'auth');
      assert.equal(detectMissionAreaFromContent('No explicit gate'), 'docs');
      // Generalized beyond ./scripts/verify-local.sh: any relative-path script works.
      assert.equal(detectMissionAreaFromContent('- [ ] ./scripts/ci.sh server'), 'server');
      assert.equal(detectMissionAreaFromContent('- [ ] ../tools/gate.bash web'), 'web');
      assert.equal(detectMissionAreaFromContent('- [ ] ./gate workflow'), 'workflow');
      // Bare-filename prose must NOT be mistaken for a gate invocation (no ./ or ../ prefix).
      assert.equal(detectMissionAreaFromContent('Please make sure the build is green'), 'docs');
      assert.equal(detectMissionAreaFromContent('make sure to run gate.bash web'), 'docs');
      assert.equal(detectMissionAreaFromContent('using bash tooling/gate.bash web'), 'docs');
      // Regression: prose containing ./-prefixed paths must not yield false-positive areas (task-1297)
      assert.equal(detectMissionAreaFromContent('We should run ./scripts/deploy.sh server before merging'), 'docs');
    });
  });

  test('normalizeVerifyArea preserves supported gates and remaps auth-server', () => {
    assert.equal(normalizeVerifyArea('auth-server'), 'auth');
    assert.equal(normalizeVerifyArea('docs'), 'docs');
    assert.equal(normalizeVerifyArea('workflow'), 'workflow');
    assert.equal(normalizeVerifyArea('web'), 'web');
    assert.equal(normalizeVerifyArea('server'), 'server');
    assert.equal(normalizeVerifyArea('auth'), 'auth');
    assert.equal(normalizeVerifyArea('android'), 'android');
    assert.equal(normalizeVerifyArea('k8s'), 'k8s');
    assert.equal(normalizeVerifyArea('deps'), 'deps');
    assert.equal(normalizeVerifyArea('all'), 'all');
  });

  test('findMissionDir and getMissionYear handle year rollover and prior-year missions', () => {
    withTempRepo(root => {
      // Current year is 2026 (based on the session context)
      const currentYear = new Date().getFullYear().toString();
      const priorYear = (parseInt(currentYear) - 1).toString();

      const priorYearDir = path.join(root, 'docs', 'missions', priorYear, 'task-prior');
      fs.mkdirSync(priorYearDir, { recursive: true });
      fs.writeFileSync(path.join(priorYearDir, 'MISSION.md'), '# Mission: Prior Year\n');

      // Should find the mission in the prior year
      assert.equal(getMissionYear('task-prior'), priorYear);
      assert.equal(findMissionDir('task-prior'), priorYearDir);

      // New mission should default to current year
      assert.equal(getMissionYear('task-new'), currentYear);

      // Override should be respected
      process.env.MISSION_YEAR_OVERRIDE = '2025';
      assert.equal(getMissionYear('task-any'), '2025');
      delete process.env.MISSION_YEAR_OVERRIDE;
    });
  });

  test('missionDirForSlug and missionPathForSlug honor configured year-tier mission paths', () => {
    const root = registeredMkdtemp('workflow-mission-path-');
    try {
      fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({
        adapters: {
          missions: { baseDir: 'docs/missions' },
        },
      }));

      assert.equal(missionDirForSlug(root, 'task-130'), path.join(root, 'docs', 'missions', new Date().getFullYear().toString(), 'task-130'));
      assert.equal(missionPathForSlug(root, 'task-130'), path.join(root, 'docs', 'missions', new Date().getFullYear().toString(), 'task-130', 'MISSION.md'));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('findMissionArea returns docs when MISSION.md is missing and parses verify gate when present', () => {
    withTempRepo(root => {
      const missionDir = path.join(root, 'docs', 'missions', '2026', 'task-132');
      fs.mkdirSync(missionDir, { recursive: true });
      assert.equal(findMissionArea(missionDir), 'docs');

      fs.writeFileSync(path.join(missionDir, 'MISSION.md'), 'Gate: ./scripts/verify-local.sh workflow\n');
      assert.equal(findMissionArea(missionDir), 'workflow');
    });
  });

  test('findMissionDir and missionTitle handle null/undefined slug without throwing', () => {
    withTempRepo(root => {
      // findMissionDir(null) should return null, not throw
      const result1 = findMissionDir(null, root);
      assert.equal(result1, null, 'findMissionDir(null) should return null');

      const result2 = findMissionDir(undefined, root);
      assert.equal(result2, null, 'findMissionDir(undefined) should return null');

      // missionTitle(null) should return null, not throw
      const result3 = missionTitle(null);
      assert.equal(result3, null, 'missionTitle(null) should return null');

      const result4 = missionTitle(undefined);
      assert.equal(result4, null, 'missionTitle(undefined) should return null');
    });
  });

  test('getMissionYear resolves year from a configured non-default baseDir (task-1209 SC1)', () => {
    withTempRepo(root => {
      // Configure a non-default mission baseDir ('missions') with nested year dirs.
      fs.writeFileSync(
        path.join(root, 'workflow.config.json'),
        JSON.stringify({ product: {}, adapters: { missions: { baseDir: 'missions' } } })
      );
      fs.mkdirSync(path.join(root, 'missions', '2026', 'task-xyz'), { recursive: true });

      // The hardcoded `docs/missions` traversal would never find the mission and
      // would fall back to the current year; baseDir-aware resolution returns 2026.
      assert.equal(getMissionYear('task-xyz', root), '2026');
    });
  });

  test('getMissionYear ignores year dirs under the default path when baseDir is customized (task-1209 SC1)', () => {
    withTempRepo(root => {
      fs.writeFileSync(
        path.join(root, 'workflow.config.json'),
        JSON.stringify({ product: {}, adapters: { missions: { baseDir: 'missions' } } })
      );
      // A decoy mission under the default docs/missions path must not be consulted.
      fs.mkdirSync(path.join(root, 'docs', 'missions', '2024', 'task-xyz'), { recursive: true });
      fs.mkdirSync(path.join(root, 'missions', '2026', 'task-xyz'), { recursive: true });

      assert.equal(getMissionYear('task-xyz', root), '2026');
    });
  });

  test('getMissionYear handles non-directory baseDir without throwing', () => {
    withTempRepo(root => {
      // Create baseDir as a file instead of a directory
      const baseDir = path.join(root, 'docs', 'missions');
      fs.mkdirSync(path.dirname(baseDir), { recursive: true });
      fs.writeFileSync(baseDir, 'this is a file, not a directory');

      // With the bug, fs.readdirSync throws ENOTDIR when baseDir is a file
      // After fix, it should return current year string
      const year = getMissionYear('task-any', root);
      assert.equal(typeof year, 'string', 'getMissionYear should return a string year');
      assert.ok(/^\d{4}$/.test(year), 'year should be a 4-digit number');
    });
  });
});
