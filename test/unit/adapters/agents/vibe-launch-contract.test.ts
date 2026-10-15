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
