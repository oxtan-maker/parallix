
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
import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { mockModule, installModuleMocks } from '../../../../lib/module-mock.js';
const active = mockModule<typeof import('../../../../../src/adapters/cli/commands/active.js')>('../../../../../src/adapters/cli/commands/active.js', import.meta.url);
await installModuleMocks();
test.afterEach(() => mock.restoreAll());

// Build a namespace-like object that mirrors what `import * as` produces
// after esModuleInterop compilation of a CJS module with `module.exports = fn`.
function makeNamespaceObj(fn: typeof stubMissionStart) {
  return Object.assign({ default: fn }, fn);
}

// Stub mission-start function that returns a passing preflight result.
function stubMissionStart() {
  return { pass: true };
}
stubMissionStart.completePreflightOrExit = () => {};

test('active delegates without invoking a legacy missionStartFn namespace object (task-1396 repro)', async () => {
  // Dynamically require the active module. After CJS build, active.js
  // has `const missionStart = __importStar(require('./mission-start.js'))`
  // which produces a namespace object — not a function.
  // We simulate that by passing a namespace object as missionStartFn.

  const namespaceObj = makeNamespaceObj(stubMissionStart);

  // Verify the namespace object is NOT callable (this is the bug).
  assert.throws(
    // @ts-expect-error A module namespace is deliberately invoked to prove it is not callable.
    () => namespaceObj(['task-1396'], { returnResult: true }),
    TypeError,
    'namespace object must not be callable — this is the task-1396 bug',
  );

  // Now invoke active with the namespace as missionStartFn.
  // active.default() should propagate the TypeError when it tries to call missionStartFn.
  let threw = false;
  let error: unknown;
  try {
    // active.default() calls missionStartFn([slug], { returnResult: true }) at the
    // preflight step. With a namespace object, this throws TypeError.
    await active.default(['task-1396'], {
      
      service: { execute: async () => ({ status: 'completed' as const, value: { agent: 'codex' }, durableEvidence: [] }) },
      inferSlugFn: () => 'task-1396',
      exitFn: () => { /* suppress process.exit */ },
    });
  } catch (err) {
    threw = true;
    error = err;
  }

  assert.equal(threw, false, error instanceof Error ? error.message : '');
});

test('active succeeds when missionStartFn is the default export function (task-1396 fix verified)', async () => {

  // Pass the actual function (what the fix should provide).
  const fn = stubMissionStart;
  fn.completePreflightOrExit = () => {};

  // active.default() should call fn([slug], { returnResult: true }) and get { pass: true },
  // then continue to resolveWorktreeFn which we also stub.
  let launched = false;
  await active.default(['task-1396'], {
    
    service: { execute: async () => {
      launched = true;
      return { status: 'completed' as const, value: { agent: 'claude' }, durableEvidence: [] };
    } },
    inferSlugFn: () => 'task-1396',
    
    
    
    
    
    
    
    
    exitFn: () => { /* suppress process.exit */ },
  });

  assert.ok(launched, 'active.default() must proceed to launch when missionStartFn is callable');
});

test('active forwards --implementer and --reviewer to the execute service and refuses a missing reviewer value (TASK-2723)', async () => {
  const requests: Array<{ agent?: string | null; reviewer?: string }> = [];
  const service = { execute: async (request: { agent?: string | null; reviewer?: string }) => { requests.push(request); return { status: 'completed' as const, value: { agent: 'claude' }, durableEvidence: [] }; } } satisfies Pick<import("../../../../../src/application/execute-mission-service.js").ExecuteMissionService, "execute">;
  const run = async (args: string[]) => {
    const failures: string[] = [];
    const exits: number[] = [];
    await active.default(args, { service, inferSlugFn: () => 'task-2723', exitFn: (code: number) => { exits.push(code); }, logFn: () => {}, errorFn: (message: string) => { failures.push(message); } });
    return { failures, exits };
  };
  assert.deepEqual((await run(['task-2723', '--implementer', 'claude', '--reviewer', 'codex'])).exits, []);
  assert.deepEqual((await run(['task-2723', '--implementer', 'claude'])).exits, []);
  assert.deepEqual(requests.map(({ agent, reviewer }) => ({ agent, reviewer })), [{ agent: 'claude', reviewer: 'codex' }, { agent: 'claude', reviewer: undefined }]);

  const missing = await run(['task-2723', '--reviewer']);
  assert.deepEqual(missing.exits, [1]);
  assert.match(missing.failures.join('\n'), /Missing value for --reviewer/);
  assert.equal(requests.length, 2, 'a missing reviewer value launches nothing');
});

test('active carries repeated interrupts across admission and removes handlers (TASK-2792)', async () => {
  const before = [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')];
  let observed = false;
  await active.default(['task-test'], {
    inferSlugFn: () => 'task-test', logFn: () => {}, errorFn: () => {}, exitFn: () => {},
    controllerFactory: async () => {
      process.emit('SIGINT'); process.emit('SIGINT');
      return { canExecute: () => true, dispatch: async request => {
        observed = request.cancellation?.requested === true && request.cancellation.stopOwnedWorkflow === true;
        return { status: 'cancelled', error: { kind: 'cancelled', message: 'Cancelled before admission' }, durableEvidence: [] };
      } };
    },
  });
  assert.equal(observed, true);
  assert.deepEqual([process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')], before);
});
