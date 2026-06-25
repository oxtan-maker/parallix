const test = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('child_process');
const { mock } = test;

const git = require('../lib/core/git');

test('git returns successful output when spawnSync reports status 0 with a non-fatal error object', () => {
  const spawnMock = mock.method(childProcess, 'spawnSync', () => ({
    status: 0,
    stdout: 'abc\n',
    stderr: '',
    error: new Error('EPERM')
  }));

  const result = git.git(['status']);

  assert.equal(result.stdout, 'abc\n');
  assert.equal(spawnMock.mock.calls.length, 1);
});

test('run throws when spawnSync reports an error without a status', () => {
  mock.method(childProcess, 'spawnSync', () => ({
    status: null,
    stdout: '',
    stderr: '',
    error: new Error('ENOENT')
  }));

  assert.throws(() => git.run('node', ['--version']), /ENOENT/);
});

test('getCurrentBranch trims stdout', () => {
  mock.method(childProcess, 'spawnSync', () => ({
    status: 0,
    stdout: 'mission/task-1031\n',
    stderr: ''
  }));

  assert.equal(git.getCurrentBranch('/tmp/repo'), 'mission/task-1031');
});

test('getWorktreeStatus returns trimmed non-empty lines', () => {
  mock.method(childProcess, 'spawnSync', () => ({
    status: 0,
    stdout: ' M file-a.js  \n?? file-b.js\n\n',
    stderr: ''
  }));

  assert.deepEqual(git.getWorktreeStatus('/tmp/repo'), [' M file-a.js', '?? file-b.js']);
});

test('isDirty reflects porcelain output presence', () => {
  const responses = [
    { status: 0, stdout: '', stderr: '' },
    { status: 0, stdout: ' M file-a.js\n', stderr: '' }
  ];
  mock.method(childProcess, 'spawnSync', () => responses.shift());

  assert.equal(git.isDirty('/tmp/repo'), false);
  assert.equal(git.isDirty('/tmp/repo'), true);
});

test('getUncommittedCount counts lines and returns zero when clean', () => {
  const responses = [
    { status: 0, stdout: ' M file-a.js\n?? file-b.js\n', stderr: '' },
    { status: 0, stdout: '\n', stderr: '' }
  ];
  mock.method(childProcess, 'spawnSync', () => responses.shift());

  assert.equal(git.getUncommittedCount('/tmp/repo'), 2);
  assert.equal(git.getUncommittedCount('/tmp/repo'), 0);
});

test('detectRebaseState reports active rebase with detached head and unmerged files', () => {
  const fsModule = {
    existsSync(target) {
      return target === '/tmp/repo/.git/rebase-merge';
    }
  };
  const pathModule = require('path');
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
    pathModule: require('path'),
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
    pathModule: require('path'),
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

test('getLastCommit parses sha, date, and subject', () => {
  mock.method(childProcess, 'spawnSync', () => ({
    status: 0,
    stdout: 'abcdef123|2026-04-30|Fix workflow gate\n',
    stderr: ''
  }));

  assert.deepEqual(git.getLastCommit(), {
    sha: 'abcdef123',
    date: '2026-04-30',
    subject: 'Fix workflow gate'
  });
});

test('getLastThreeCommits splits commit subjects', () => {
  mock.method(childProcess, 'spawnSync', () => ({
    status: 0,
    stdout: 'one\ntwo\nthree\n',
    stderr: ''
  }));

  assert.deepEqual(git.getLastThreeCommits(), ['one', 'two', 'three']);
});
