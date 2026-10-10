import assert from 'node:assert/strict';
import test from 'node:test';
import { commandInvocation } from '../../../src/composition/command-invocation.js';

for (const status of [0, 1, 23]) {
  test(`command exit ${status} stops work and returns through cleanup (TASK-2696)`, async () => {
    const effects: string[] = [];
    const result = await commandInvocation(async exit => {
      try {
        exit(status);
        effects.push('unreachable');
      } finally {
        effects.push('cleanup');
      }
    });
    assert.equal(result, status);
    assert.deepEqual(effects, ['cleanup']);
  });
}

test('nested invocations own their exits without terminating the outer command (TASK-2696)', async () => {
  const result = await commandInvocation(async exit => {
    assert.equal(await commandInvocation(innerExit => innerExit(17)), 17);
    exit(0);
  });
  assert.equal(result, 0);
});

test('unexpected command and cleanup errors remain failures (TASK-2696)', async () => {
  const unexpected = new Error('unexpected failure');
  await assert.rejects(commandInvocation(() => { throw unexpected; }), error => error === unexpected);
  await assert.rejects(commandInvocation(exit => {
    try { exit(0); } finally { throw unexpected; }
  }), error => error === unexpected);
});
