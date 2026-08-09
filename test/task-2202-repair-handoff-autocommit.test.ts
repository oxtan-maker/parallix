


import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { mockModule, installModuleMocks } from './lib/module-mock.js';
const repairHandoff = mockModule<typeof import('../src/adapters/cli/commands/repair-handoff.js')>('../src/adapters/cli/commands/repair-handoff.js', import.meta.url);
await installModuleMocks();
test.afterEach(() => mock.restoreAll());
test('repairHandoff auto-commits bounded implementation files for active-step handoff repair', async () => {
  const adds = [];
  const commits = [];
  const logs = [];

  const gitFn = (args) => {
    if (args.includes('status')) {
      return {
        status: 0,
        stdout: [
          ' M missions/task-2202/MISSION.md',
          ' M backlog/tasks/task-2202 - parallix-autocommit-seems-to-exclude-some-files.md',
          ' M lib/commands/repair-handoff.ts',
          ' M px.ts',
          '?? test/task-2202-repair-handoff-autocommit.test.js'
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

  const { repaired, blocker } = await repairHandoff.default(
    'task-2202',
    '/tmp/worktree',
    'MISSION.md is modified but uncommitted',
    {
      gitFn,
      log: (msg) => logs.push(msg)
    }
  );

  assert.equal(repaired, true, `expected active-step repair to auto-commit bounded implementation files; blocker was: ${blocker}`);
  assert.equal(blocker, null);
  assert.deepEqual(adds, [
    'missions/task-2202/MISSION.md',
    'backlog/tasks/task-2202 - parallix-autocommit-seems-to-exclude-some-files.md',
    'lib/commands/repair-handoff.ts',
    'px.ts',
    'test/task-2202-repair-handoff-autocommit.test.js'
  ]);
  assert.deepEqual(commits, [
    'workflow(task-2202): auto-commit mission artifacts before handoff'
  ]);
  assert.ok(logs.some(line => line.includes('Auto-committing mission artifacts')));
});
