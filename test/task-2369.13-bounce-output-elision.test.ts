/**
 * TASK-2369.13 CP-3: auto-bounce prompts must embed bounded gate/hook output.
 *
 * Regression: a 545 KB gate diagnostic (rebase log + full test suite + full
 * bundle) was embedded verbatim in a bounce prompt, pushing the resumed pi
 * session past its 128k-token context window. Pi then clamped max_tokens to
 * 1 on every turn and the mission silently timed out on every retry.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  elideBounceOutput,
  BOUNCE_OUTPUT_MAX_CHARS,
} from '../src/application/output-elision.js';
import { rebound } from '../src/application/rebound-kernel.js';
import { reboundPreReviewFailure, gateFailureReason } from '../src/adapters/review/review-gate-handling.js';

describe('elideBounceOutput', () => {
  it('passes through output at or under the cap unchanged', () => {
    const short = 'pre-commit: ESLint found 3 errors';
    assert.equal(elideBounceOutput(short), short);
    const exact = 'x'.repeat(BOUNCE_OUTPUT_MAX_CHARS);
    assert.equal(elideBounceOutput(exact), exact);
  });

  it('elides oversized output to bounded head+tail with a marker', () => {
    const output = `HEAD-LINE-1\n` + 'm'.repeat(100_000) + '\nMIDDLE-NEEDLE\n' + 'm'.repeat(100_000) + `\nTAIL-ERROR: hook failed`;
    const elided = elideBounceOutput(output);
    assert.ok(elided.length <= BOUNCE_OUTPUT_MAX_CHARS + 200, `elided output must be bounded, got ${elided.length}`);
    assert.ok(elided.startsWith('HEAD-LINE-1'), 'head preserved');
    assert.ok(elided.endsWith('TAIL-ERROR: hook failed'), 'tail (failure) preserved');
    assert.match(elided, /chars elided/, 'elision marker present');
    assert.ok(!elided.includes('MIDDLE-NEEDLE'), 'middle content dropped');
  });
});

describe('hook-failure bounce prompt embeds bounded output', () => {
  // TASK-2377.05: the hook bounce moved from the deleted standalone policy to
  // the rebound kernel. The elision contract is unchanged — the kernel's one
  // fix-prompt builder runs the same `elideBounceOutput`.
  it('stays bounded with 500 KB of hook output and keeps head+tail', async () => {
    const hookOutput = 'pre-commit: gate start\n' + 'x'.repeat(500_000) + '\nfinal: ESLint found 3 errors';
    let capturedPrompt = '';
    const outcome = await rebound(
      { kind: 'hook-failure', hook: 'pre-commit', operation: 'squash commit', output: hookOutput },
      {
        slug: 'test-slug',
        worktree: '/worktree',
        implementer: 'claude',
        startAgent: async (_step, opts: Record<string, unknown>) => {
          const slot = opts.prompt;
          capturedPrompt = typeof slot === 'function' ? slot('claude') : String(slot);
          return { agent: 'claude', result: { status: 0 } };
        },
        verify: () => ({ ok: true }),
        log: () => {},
        error: () => {},
      },
    );
    assert.equal(outcome.outcome, 'fixed', 'bounce succeeded');
    assert.ok(capturedPrompt.includes('pre-commit: gate start'), 'head of hook output preserved');
    assert.ok(capturedPrompt.includes('final: ESLint found 3 errors'), 'tail (failure) of hook output preserved');
    assert.ok(capturedPrompt.length < 100_000, `prompt must stay small, got ${capturedPrompt.length}`);
  });
});

describe('pre-review gate bounce prompt embeds bounded output', () => {
  it('stays bounded with 500 KB of gate stdout and keeps head+tail', async () => {
    const stdout =
      '[INFO] Rebasing mission/task-2369.13 onto local main...\n' +
      '[pre-commit] running pre-review safety commit\n' +
      't'.repeat(500_000) +
      '\n> 2 of 2320 tests failed';
    let capturedPrompt = '';
    const result = await reboundPreReviewFailure('task-2369.13', '/worktree', gateFailureReason({
      ok: false,
      area: 'all',
      command: './scripts/verify-local.sh all',
      exitCode: 1,
      stdout,
      stderr: '',
    }), 'claude', {
      verifyFn: () => ({ ok: true }),
      readReviewStateFn: () => null,
      writeReviewStateFn: async () => ({ outcome: 'unchanged' }),
      transitionTaskFn: async () => true,
      startAgentFn: async (_mode, opts: any) => {
        capturedPrompt = typeof opts.prompt === 'function' ? opts.prompt('claude') : String(opts.prompt);
        return { agent: 'claude', invocation: null, result: { status: 0 } };
      },
      applyAgentFallbackFn: async () => 'claude',
      log: () => {},
      error: () => {},
    } as any);
    assert.equal(result.bounced, true);
    assert.ok(capturedPrompt.includes('[INFO] Rebasing mission/task-2369.13'), 'head of gate output preserved');
    assert.ok(capturedPrompt.includes('2 of 2320 tests failed'), 'tail (failure) of gate output preserved');
    assert.ok(capturedPrompt.length < 100_000, `prompt must stay small, got ${capturedPrompt.length}`);
  });
});
