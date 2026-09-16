// TASK-2517 SC4: `px active` and `px review` refuse a mission whose payload
// already landed on the base branch and point at the closeout command.
//
// Red before the fix: neither command checks for a landed payload, so an
// operator re-runs `px active`/`px review` against a mission the rebound already
// delivered, relaunching an implementer for work that is done. The guard is an
// opt-in seam (`payloadLandedFn`) so direct unit callers that do not set it keep
// their existing behaviour (the 300+ active/review tests that omit the seam
// still proceed); the composition root wires it for the real CLI.
import test from 'node:test';
import assert from 'node:assert/strict';

const active = (await import('../src/adapters/cli/commands/active.js')).default;
const { ReviewWorkflowAdapter } = await import('../src/adapters/review/review-workflow-adapter.js');
const { ReviewCommandUseCase } = await import('../src/application/review-command-use-case.js');

test('SC4: px active refuses a landed payload and names the closeout command', async () => {
  const errors = [];
  const exits = [];
  await active(['task-2517-landed'], {
    inferSlugFn: (s) => s,
    errorFn: (m) => errors.push(m),
    exitFn: (c) => exits.push(c),
    payloadLandedFn: async () => true,
  });
  assert.deepEqual(exits, [1], 'active exits non-zero for a landed payload');
  assert.ok(errors.some((m) => m.includes('--recover-landed')), 'active hints the closeout command');
});

test('SC4: px review refuses a landed payload', async () => {
  const errors: string[] = [];
  const exits: number[] = [];
  const command = new ReviewCommandUseCase(new ReviewWorkflowAdapter({
    payloadLandedFn: async () => true,
    error: (message) => errors.push(message),
    exit: ((code: number) => { exits.push(code); }) as unknown as typeof process.exit,
  }));
  await command.execute(['task-2517-landed']);
  assert.deepEqual(exits, [1], 'review exits non-zero for a landed payload');
  assert.ok(errors.some((message) => message.includes('--recover-landed')), 'review hints the closeout command');
});
