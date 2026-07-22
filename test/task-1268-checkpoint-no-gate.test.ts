
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('checkpoint has no --no-gate escape hatch', () => {
  const src = fs.readFileSync(require.resolve('../src/platform/runtime/lib/commands/checkpoint.ts'), 'utf8');
  assert.ok(!src.includes('--no-gate'));
  assert.ok(!src.includes('skipGate'));
});

test('checkpoint runs the gate even when passed a stray --no-gate flag', async (t) => {
  const { mock } = t;
  const missionUtils = require('../dist/lib/core/mission-utils');
  const git = require('../dist/lib/core/git');
  const verification = require('../dist/lib/core/verification');
  const checkpoint = require('../dist/lib/commands/checkpoint');
  mock.method(missionUtils, 'findMissionDir', () => '/tmp/fake-mission-dir');
  mock.method(missionUtils, 'findMissionArea', () => 'lib');
  mock.method(missionUtils, 'resolveWorktree', () => '/tmp/fake-mission-root');
  const gateMock = mock.method(verification, 'runVerificationGate', () => ({ status: 1 }));
  const gitAddMock = mock.method(git, 'git', () => ({ status: 0 }));
  class FakeExit extends Error {}
  mock.method(process, 'exit', (code) => { throw new FakeExit(code); });

  await assert.rejects(
    async () => checkpoint(['task-1268', 'cp-name', 'next action', '--no-gate']),
    FakeExit
  );
  assert.equal(gateMock.mock.calls.length, 1);
  assert.equal(gitAddMock.mock.calls.length, 0);
});

test('checkpoint preserves the selected mission root for verification and Git', async (t) => {
  const { mock } = t;
  const missionUtils = require('../dist/lib/core/mission-utils');
  const git = require('../dist/lib/core/git');
  const verification = require('../dist/lib/core/verification');
  const checkpoint = require('../dist/lib/commands/checkpoint');
  const missionRoot = '/tmp/mission-tree';
  mock.method(missionUtils, 'resolveWorktree', () => missionRoot);
  mock.method(missionUtils, 'findMissionDir', (_slug, root) => root === missionRoot ? '/tmp/mission-tree/missions/task-1268' : null);
  mock.method(missionUtils, 'findMissionArea', () => 'workflow');
  const gateMock = mock.method(verification, 'runVerificationGate', () => ({ status: 0 }));
  const gitMock = mock.method(git, 'git', () => ({ status: 0 }));

  checkpoint(['task-1268', 'CP-1', 'continue target-root hardening']);

  assert.equal(gateMock.mock.calls[0].arguments[1].rootDir, missionRoot);
  assert.deepEqual(gitMock.mock.calls[0].arguments[0].slice(0, 2), ['-C', missionRoot]);
  assert.deepEqual(gitMock.mock.calls[1].arguments[0].slice(0, 2), ['-C', missionRoot]);
});
