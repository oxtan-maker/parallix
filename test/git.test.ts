// @ts-nocheck -- TASK-2328: partial test doubles from ESM seam migration; resolve in follow-up


import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'child_process';
import pathModule from 'path';
import { mockModule, installModuleMocks } from './lib/module-mock.js';
import { createRequire } from 'node:module';
const _require = createRequire(import.meta.url);
const git = mockModule<typeof import('../src/adapters/git/git.js')>('../src/adapters/git/git.js', import.meta.url);
await installModuleMocks();
const { mock } = test;

function mockSpawnSync(fake: (...args: unknown[]) => Record<string, unknown>): void {
  mock.restoreAll();
  mock.module('node:child_process', {
    fallback: true,
    exports: { ...childProcess, spawnSync: fake },
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
