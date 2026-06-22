const test = require('node:test');
const assert = require('node:assert/strict');
const repairHandoff = require('../lib/commands/repair-handoff');

test('repairHandoff auto-commits safe mission files', async () => {
  const adds = [];
  const commits = [];
  const logs = [];

  const gitFn = (args) => {
    if (args.includes('status')) {
      return { 
        status: 0, 
        stdout: [
          ' M missions/task-1037/MISSION.md',
          '?? missions/task-1037/CP-1.md',
          ' M backlog/tasks/task-1037 - some task.md'
        ].join('\n')
      };
    }
    if (args.includes('add')) {
      adds.push(args[args.length - 1]);
      return { status: 0 };
    }
    if (args.includes('commit')) {
      commits.push(args[args.indexOf('-m') + 1]);
      return { status: 0 };
    }
    return { status: 0 };
  };

  const { repaired, blocker } = await repairHandoff('task-1037', '/tmp/worktree', 'MISSION.md is modified but uncommitted', {
    taskFile: '/tmp/worktree/backlog/tasks/task-1037 - some task.md',
    gitFn,
    log: (msg) => logs.push(msg)
  });

  assert.equal(repaired, true, 'repairHandoff should return repaired:true when it committed files');
  assert.equal(blocker, null);
  assert.equal(adds.length, 3);
  assert.ok(adds.includes('missions/task-1037/MISSION.md'));
  assert.ok(adds.includes('missions/task-1037/CP-1.md'));
  assert.ok(adds.includes('backlog/tasks/task-1037 - some task.md'));
  assert.equal(commits.length, 1);
  assert.match(commits[0], /auto-commit mission artifacts/);
});

test('repairHandoff stages renamed mission files by destination path', async () => {
  const adds = [];
  const commits = [];

  const gitFn = (args) => {
    if (args.includes('status')) {
      return {
        status: 0,
        stdout: [
          'R  missions/task-1037/CP-1.md -> missions/task-1037/CP-1-renamed.md'
        ].join('\n')
      };
    }
    if (args.includes('add')) {
      adds.push(args[args.length - 1]);
      return { status: 0 };
    }
    if (args.includes('commit')) {
      commits.push(true);
      return { status: 0 };
    }
    return { status: 0 };
  };

  const { repaired, blocker } = await repairHandoff('task-1037', '/tmp/worktree', 'MISSION.md is modified but uncommitted', {
    gitFn,
    log: () => {}
  });

  assert.equal(repaired, true);
  assert.equal(blocker, null);
  assert.deepEqual(adds, ['missions/task-1037/CP-1-renamed.md']);
  assert.equal(commits.length, 1);
});

test('repairHandoff refuses to commit when unsafe files are dirty', async () => {
  const adds = [];
  const logs = [];

  const gitFn = (args) => {
    if (args.includes('status')) {
      return { 
        status: 0, 
        stdout: [
          ' M missions/task-1037/MISSION.md',
          ' M server/src/main/java/visual/App.java'
        ].join('\n')
      };
    }
    if (args.includes('add')) {
      adds.push(args[args.length - 1]);
      return { status: 0 };
    }
    return { status: 0 };
  };

  const { repaired, blocker } = await repairHandoff('task-1037', '/tmp/worktree', 'MISSION.md is modified but uncommitted', {
    gitFn,
    log: (msg) => logs.push(msg)
  });

  assert.equal(repaired, false, 'repairHandoff should return repaired:false when unsafe files are dirty');
  assert.ok(blocker && blocker.includes('server/src/main/java/visual/App.java'));
  assert.equal(adds.length, 0, 'No files should be added if unsafe files are present');
  assert.ok(logs.some(l => l.includes('dirty files include non-mission paths')));
  assert.ok(logs.some(l => l.includes('server/src/main/java/visual/App.java')));
});

test('repairHandoff reports staging failures and stops before commit', async () => {
  const adds = [];
  const commits = [];
  const errors = [];

  const gitFn = (args) => {
    if (args.includes('status')) {
      return {
        status: 0,
        stdout: [
          ' M missions/task-1037/MISSION.md'
        ].join('\n')
      };
    }
    if (args.includes('add')) {
      adds.push(args[args.length - 1]);
      return { status: 1, stderr: 'permission denied' };
    }
    if (args.includes('commit')) {
      commits.push(true);
      return { status: 0 };
    }
    return { status: 0 };
  };

  const { repaired, blocker } = await repairHandoff('task-1037', '/tmp/worktree', 'MISSION.md is modified but uncommitted', {
    gitFn,
    error: (msg) => errors.push(msg),
    log: () => {}
  });

  assert.equal(repaired, false);
  assert.match(blocker, /failed to stage mission artifacts/);
  assert.match(blocker, /permission denied/);
  assert.equal(commits.length, 0);
  assert.ok(errors.some(line => line.includes('failed to stage mission artifacts')));
});

test('repairHandoff refuses to commit when mission files are conflicted', async () => {
  const adds = [];
  const logs = [];

  const gitFn = (args) => {
    if (args.includes('status')) {
      return { 
        status: 0, 
        stdout: [
          'UU missions/task-1037/MISSION.md'
        ].join('\n')
      };
    }
    return { status: 0 };
  };

  const { repaired, blocker } = await repairHandoff('task-1037', '/tmp/worktree', 'MISSION.md is modified but uncommitted', {
    gitFn,
    log: (msg) => logs.push(msg)
  });

  assert.equal(repaired, false);
  assert.match(blocker, /Conflicted files detected/);
  assert.match(blocker, /missions\/task-1037\/MISSION\.md/);
  assert.equal(adds.length, 0);
  assert.ok(logs.some(l => l.includes('Cannot auto-commit: Conflicted files detected')));
});

test('repairHandoff calls rebase when branch is behind', async () => {
  const logs = [];
  let rebaseCalled = false;

  const gitFn = (args) => {
    if (args.includes('status')) return { status: 0, stdout: '' };
    return { status: 0 };
  };

  const rebaseFn = async (args, opts) => {
    rebaseCalled = true;
    assert.equal(args[0], 'task-1037');
    opts.exitFn(0);
  };

  const { repaired, blocker } = await repairHandoff('task-1037', '/tmp/worktree', 'git push failed: Updates were rejected', {
    gitFn,
    rebaseFn,
    log: (msg) => logs.push(msg)
  });

  assert.equal(repaired, true, 'repairHandoff should return repaired:true when rebase succeeded');
  assert.equal(blocker, null);
  assert.equal(rebaseCalled, true);
  assert.ok(logs.some(l => l.includes('Branch appears behind primary branch')));
});

test('repairHandoff returns false when rebase fails', async () => {
  const logs = [];
  const errors = [];

  const gitFn = (args) => {
    if (args.includes('status')) return { status: 0, stdout: '' };
    return { status: 0 };
  };

  const rebaseFn = async (args, opts) => {
    opts.exitFn(1);
  };

  const { repaired, blocker } = await repairHandoff('task-1037', '/tmp/worktree', 'git push failed: Updates were rejected', {
    gitFn,
    rebaseFn,
    log: (msg) => logs.push(msg),
    error: (msg) => errors.push(msg)
  });

  assert.equal(repaired, false, 'repairHandoff should return repaired:false when rebase failed');
  assert.match(blocker, /Auto-rebase failed: rebase exited with code 1/);
  assert.ok(errors.some(l => l.includes('Auto-rebase failed')));
});

test('repairHandoff auto-commits safe mission files including completed tasks', async () => {
  const adds = [];
  const gitFn = (args) => {
    if (args.includes('status')) {
      return { 
        status: 0, 
        stdout: [
          ' M backlog/completed/task-1037 - some task.md'
        ].join('\n')
      };
    }
    if (args.includes('add')) {
      adds.push(args[args.length - 1]);
      return { status: 0 };
    }
    return { status: 0 };
  };

  const { repaired } = await repairHandoff('task-1037', '/tmp/worktree', 'MISSION.md is modified but uncommitted', {
    taskFile: '/tmp/worktree/backlog/completed/task-1037 - some task.md',
    gitFn,
    log: () => {}
  });

  assert.equal(repaired, true);
  assert.ok(adds.includes('backlog/completed/task-1037 - some task.md'));
});

test('repairHandoff returns repaired:false when rebase fails after successful auto-commit', async () => {
  const gitFn = (args) => {
    if (args.includes('status')) {
      return { status: 0, stdout: ' M missions/task-1037/MISSION.md' };
    }
    if (args.includes('add')) return { status: 0 };
    if (args.includes('commit')) return { status: 0 };
    return { status: 0 };
  };

  const rebaseFn = async (args, opts) => {
    opts.exitFn(1); // Rebase fails
  };

  const { repaired, blocker } = await repairHandoff('task-1037', '/tmp/worktree', 'Updates were rejected', {
    gitFn,
    rebaseFn,
    log: () => {},
    error: () => {}
  });

  assert.equal(repaired, false, 'Should be false because rebase failed');
  assert.match(blocker, /Auto-rebase failed/);
});

test('repairHandoff returns repaired:false for generic git push failed (auth/transport)', async () => {
  const { repaired } = await repairHandoff('task-1037', '/tmp/worktree', 'git push failed with status 128: fatal: Authentication failed', {
    log: () => {}
  });

  assert.equal(repaired, false);
});

// CP-1 tests for isRelaunchableError and buildRelaunchPrompt

test('isRelaunchableError returns true for goal-check table missing evidence rows error', () => {
  const { isRelaunchableError } = repairHandoff;
  const errorMsg = 'The final checkpoint at docs/missions/2026/task-1121/CP-3.md has a "## Goal Check" section but no evidence rows. A goal-check table with real evidence is required before handoff.';
  assert.equal(isRelaunchableError(errorMsg), true);
});

test('isRelaunchableError returns false for non-relaunchable errors', () => {
  const { isRelaunchableError } = repairHandoff;
  
  assert.equal(isRelaunchableError(null), false);
  assert.equal(isRelaunchableError(undefined), false);
  assert.equal(isRelaunchableError(123), false);
  assert.equal(isRelaunchableError(''), false);
  assert.equal(isRelaunchableError('Some other error'), false);
  assert.equal(isRelaunchableError('MISSION.md is modified but uncommitted'), false);
  assert.equal(isRelaunchableError('git push failed'), false);
});

test('isRelaunchableError returns false for partial match', () => {
  const { isRelaunchableError } = repairHandoff;
  
  // Missing the second part of the required message
  assert.equal(isRelaunchableError('has a "## Goal Check" section but no evidence rows'), false);
  // Missing the first part
  assert.equal(isRelaunchableError('A goal-check table with real evidence is required before handoff'), false);
});

test('buildRelaunchPrompt returns string containing Goal Check table and mission slug', () => {
  const { buildRelaunchPrompt } = repairHandoff;
  const errorMsg = 'The final checkpoint at docs/missions/2026/task-1121/CP-3.md has a "## Goal Check" section but no evidence rows. A goal-check table with real evidence is required before handoff.';
  const prompt = buildRelaunchPrompt(errorMsg, 'task-1124', '/tmp/worktree');
  
  assert.ok(typeof prompt === 'string', 'Prompt should be a string');
  assert.ok(prompt.includes('Goal Check table'), 'Prompt should contain "Goal Check table"');
  assert.ok(prompt.includes('task-1124'), 'Prompt should contain the mission slug');
  assert.ok(prompt.includes('file:line'), 'Prompt should mention file:line references');
  assert.ok(prompt.includes('test names'), 'Prompt should mention test names');
});

test('buildRelaunchPrompt includes example table', () => {
  const { buildRelaunchPrompt } = repairHandoff;
  const errorMsg = 'The final checkpoint at docs/missions/2026/task-1121/CP-3.md has a "## Goal Check" section but no evidence rows. A goal-check table with real evidence is required before handoff.';
  const prompt = buildRelaunchPrompt(errorMsg, 'task-1124', '/tmp/worktree');
  
  assert.ok(prompt.includes('| Goal Check | Evidence | Status |'), 'Prompt should include example table header');
  assert.ok(prompt.includes('|---|---|---|'), 'Prompt should include example table separator');
});
