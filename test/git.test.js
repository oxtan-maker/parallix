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
