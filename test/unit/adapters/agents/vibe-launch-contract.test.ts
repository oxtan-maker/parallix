import test from 'node:test';
import assert from 'node:assert/strict';
import { buildVibeInvocation } from '../../../../src/adapters/agents/vibe.js';

// Vibe invocation syntax has no existing unit owner; process delivery belongs
// to tmux-terminal-host, and telemetry has a separate adapter contract.
test('Vibe delivers oversized stdin under its existing fresh-only session policy (TASK-2761)', () => {
  const prompt = '  café contract 🌍\n'.repeat(12000);
  for (const resume of [false, true]) {
    for (const sessionId of [null, 'ignored-session']) {
      const invocation = buildVibeInvocation({ prompt, worktree: '/tmp', resume, sessionId });
      assert.equal(invocation.options.input, prompt);
      assert.ok(invocation.args.includes('--prompt'));
      assert.ok(!JSON.stringify({ args: invocation.args, env: invocation.options.env }).includes(prompt));
      assert.ok(!invocation.args.includes('ignored-session'));
      assert.ok(!invocation.args.includes('--resume'));
      assert.ok(!invocation.args.includes('--continue'));
    }
  }
});

test('Vibe text output exposes no structured overload event, so overload wording is not a block (TASK-2871)', async () => {
  const { normalizeProviderFailure } = await import('../../../../src/adapters/process/failure-normalization.js');
  const { detectLimitHit } = await import('../../../../src/application/services/agent-limit.js');
  const invocation = buildVibeInvocation({ prompt: 'p', worktree: '/tmp', resume: false, sessionId: null });
  assert.deepEqual(invocation.args.slice(invocation.args.indexOf('--output'), invocation.args.indexOf('--output') + 2), ['--output', 'text']);
  const stdout = 'Error: 503 Service Unavailable (overloaded)';
  const failureReason = normalizeProviderFailure({ status: 1, stdout });
  assert.equal(failureReason?.code, 'process-failed');
  assert.equal(detectLimitHit({ agent: 'vibe', status: 1, stdout, failureReason }), null);
});
