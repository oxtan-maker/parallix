
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
