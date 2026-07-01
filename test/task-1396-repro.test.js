/**
 * Reproduction test for task-1396: `import * as missionStart` in active.ts
 * creates a namespace object that is not callable. When the compiled JS
 * assigns that namespace to `missionStartFn` and later calls
 * `missionStartFn([slug], { returnResult: true })`, Node throws
 * "missionStartFn is not a function".
 *
 * This test proves the bug by invoking the active function with a
 * namespace-like object (shape: { default: fn, completePreflightOrExit: fn })
 * as the `missionStartFn` option. The call must throw TypeError.
 *
 * After the fix (changing `import * as missionStart` to
 * `import missionStart`), this test will fail because the namespace
 * object will no longer be passed — proving the regression is gone.
 */
const assert = require('node:assert/strict');
const test = require('node:test');

// Build a namespace-like object that mirrors what `import * as` produces
// after esModuleInterop compilation of a CJS module with `module.exports = fn`.
function makeNamespaceObj(fn) {
  const ns = { default: fn };
  // Copy own properties from the function (e.g. completePreflightOrExit)
  for (const key of Object.keys(fn)) {
    ns[key] = fn[key];
  }
  return ns;
}

// Stub mission-start function that returns a passing preflight result.
function stubMissionStart() {
  return { pass: true };
}
stubMissionStart.completePreflightOrExit = () => {};

test('active throws "missionStartFn is not a function" when passed a namespace object (task-1396 repro)', async () => {
  // Dynamically require the active module. After CJS build, active.js
  // has `const missionStart = __importStar(require('./mission-start.js'))`
  // which produces a namespace object — not a function.
  // We simulate that by passing a namespace object as missionStartFn.
  const active = require('../lib/commands/active.js');

  const namespaceObj = makeNamespaceObj(stubMissionStart);

  // Verify the namespace object is NOT callable (this is the bug).
  assert.throws(
    () => namespaceObj(['task-1396'], { returnResult: true }),
    TypeError,
    'namespace object must not be callable — this is the task-1396 bug',
  );

  // Now invoke active with the namespace as missionStartFn.
  // active() should propagate the TypeError when it tries to call missionStartFn.
  let threw = false;
  let error;
  try {
    // active() calls missionStartFn([slug], { returnResult: true }) at the
    // preflight step. With a namespace object, this throws TypeError.
    await active(['task-1396'], {
      missionStartFn: namespaceObj,
      inferSlugFn: () => 'task-1396',
      exitFn: () => { /* suppress process.exit */ },
    });
  } catch (err) {
    threw = true;
    error = err;
  }

  assert.ok(threw, 'active() must throw when missionStartFn is a namespace object');
  assert.ok(
    error instanceof TypeError,
    'error must be TypeError (got ' + error.constructor.name + '): ' + error.message,
  );
  assert.match(
    String(error.message),
    /not a function/,
    'error message must mention "not a function" (task-1396 signature)',
  );
});

test('active succeeds when missionStartFn is the default export function (task-1396 fix verified)', async () => {
  const active = require('../lib/commands/active.js');

  // Pass the actual function (what the fix should provide).
  const fn = stubMissionStart;
  fn.completePreflightOrExit = () => {};

  // active() should call fn([slug], { returnResult: true }) and get { pass: true },
  // then continue to resolveWorktreeFn which we also stub.
  let launched = false;
  await active(['task-1396'], {
    missionStartFn: fn,
    inferSlugFn: () => 'task-1396',
    resolveWorktreeFn: () => '/tmp/fake-worktree-task-1396',
    readAgentConfigOrExitFn: () => ({ default: 'claude' }),
    resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
    buildCheckpointContextFn: () => 'No checkpoints yet.',
    buildExecutePromptFn: () => 'execute prompt',
    selectLaunchAndRecordFn: async () => {
      launched = true;
      return { agent: 'claude', result: { status: 0, startedAt: '2026-01-01T00:00:00Z', endedAt: '2026-01-01T00:01:00Z' } };
    },
    enforceExecuteCommitSafetyFn: () => {},
    runHandoffAndReviewFn: async () => true,
    exitFn: () => { /* suppress process.exit */ },
  });

  assert.ok(launched, 'active() must proceed to launch when missionStartFn is callable');
});
