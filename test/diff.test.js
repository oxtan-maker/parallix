const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

// Mock child_process and other dependencies
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
  const diff = require('../lib/commands/diff');
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

  await diff(['task-1147'], {
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
  const diff = require('../lib/commands/diff');
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

  await diff(['task-1147'], {
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
  const diff = require('../lib/commands/diff');
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

  await diff(['task-1147'], {
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
  const diff = require('../lib/commands/diff');
  const calls = [];

  const gitFn = mockGit([
    [/config --get diff.tool/, { status: 1, stdout: '' }],
    [/config --get pager.diff/, { status: 1, stdout: '' }],
    [/config --get core.pager/, { status: 0, stdout: 'less -FRX\n' }],
    [/branch --list --format/, { status: 0, stdout: 'main\n' }]
  ]);

  await diff(['task-1147'], {
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
  const diff = require('../lib/commands/diff');
  const calls = [];

  const gitFn = mockGit([
    [/config --get diff.tool/, { status: 0, stdout: 'difftastic\n' }],
    [/branch --list --format/, { status: 0, stdout: 'main\n' }]
  ]);

  await diff(['task-1147'], {
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
  const diff = require('../lib/commands/diff');
  const calls = [];

  const gitFn = mockGit([
    [/config --get diff.tool/, { status: 0, stdout: 'difftastic\n' }],
    [/branch --list --format/, { status: 0, stdout: 'main\n' }]
  ]);

  await diff(['task-1147'], {
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
  const diff = require('../lib/commands/diff');
  const calls = [];

  await diff([], {
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
  const diff = require('../lib/commands/diff');
  const calls = [];

  await diff(['task-1147'], {
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
  const diff = require('../lib/commands/diff');
  const calls = [];

  const gitFn = mockGit([
    [/config --get diff.tool/, { status: 1, stdout: '' }],
    [/config --get pager.diff/, { status: 1, stdout: '' }],
    [/config --get core.pager/, { status: 0, stdout: 'less\n' }]
  ]);

  await diff(['task-1147'], {
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
  const diff = require('../lib/commands/diff');
  const calls = [];

  await diff(['task-1147'], {
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
