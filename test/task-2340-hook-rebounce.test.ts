import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyHookFailure } from '../src/adapters/cli/commands/rebase.js';
import { classifyHookFailure as classifyHookFailureIntegrate } from '../src/adapters/cli/commands/integrate.js';
import { classifyHookFailure as classifyHookFailureShared } from '../src/application/hook-failure-workflow.js';
import { rebound, DEFAULT_REBOUND_ATTEMPTS } from '../src/application/rebound-kernel.js';
import { reboundPreReviewFailure, gateFailureReason, hookFailureReason } from '../src/adapters/review/review-loop.js';
import { ReviewState } from '../src/adapters/review/review-state.js';

describe('classifyHookFailure (rebase.ts) — SC1/SC7', () => {
  it('detects pre-commit hook failure', () => {
    const result = classifyHookFailure('pre-commit: hook failed');
    assert.ok(result.isHookFailure);
    assert.equal(result.hookType, 'pre-commit');
  });

  it('detects pre-push hook failure', () => {
    const result = classifyHookFailure('pre-push: rejected');
    assert.ok(result.isHookFailure);
    assert.equal(result.hookType, 'pre-push');
  });

  it('detects post-commit hook failure', () => {
    const result = classifyHookFailure('post-commit hook exited with error');
    assert.ok(result.isHookFailure);
    assert.equal(result.hookType, 'post-commit');
  });

  it('detects generic hook keyword', () => {
    const result = classifyHookFailure('The git hook failed with exit code 1');
    assert.ok(result.isHookFailure);
    assert.equal(result.hookType, 'hook');
  });

  it('returns false for non-hook output', () => {
    const result = classifyHookFailure('CONFLICT (content): Merge conflict in file.ts');
    assert.ok(!result.isHookFailure);
    assert.equal(result.hookType, null);
  });

  it('returns false for empty output', () => {
    const result = classifyHookFailure('');
    assert.ok(!result.isHookFailure);
    assert.equal(result.hookType, null);
  });

  it('returns false for undefined output', () => {
    const result = classifyHookFailure(undefined as any);
    assert.ok(!result.isHookFailure);
    assert.equal(result.hookType, null);
  });

  it('pre-commit takes priority over generic hook', () => {
    const result = classifyHookFailure('pre-commit hook failed');
    assert.ok(result.isHookFailure);
    assert.equal(result.hookType, 'pre-commit');
  });

  it('handles case-insensitive matching', () => {
    const result = classifyHookFailure('PRE-COMMIT: Hook Failed');
    assert.ok(result.isHookFailure);
    assert.equal(result.hookType, 'pre-commit');
  });
});

describe('classifyHookFailure (integrate.ts) — SC2/SC8', () => {
  it('detects pre-commit hook failure', () => {
    const result = classifyHookFailureIntegrate('pre-commit: lint errors found');
    assert.ok(result.isHookFailure);
    assert.equal(result.hookType, 'pre-commit');
  });

  it('detects pre-push hook failure', () => {
    const result = classifyHookFailureIntegrate('pre-push: branch not up to date');
    assert.ok(result.isHookFailure);
    assert.equal(result.hookType, 'pre-push');
  });

  it('detects generic hook keyword', () => {
    const result = classifyHookFailureIntegrate('hook failed with exit code 1');
    assert.ok(result.isHookFailure);
    assert.equal(result.hookType, 'hook');
  });

  it('returns false for non-hook output', () => {
    const result = classifyHookFailureIntegrate('Merge conflict in package.json');
    assert.ok(!result.isHookFailure);
    assert.equal(result.hookType, null);
  });
});

describe('Non-hook rebase errors do not trigger bounce — SC9', () => {
  it('repository lock (status 128) is not classified as hook failure', () => {
    const result = classifyHookFailure('fatal: Unable to create lock file');
    assert.ok(!result.isHookFailure);
  });

  it('merge conflict output is not classified as hook failure', () => {
    const result = classifyHookFailure('CONFLICT (content): Merge conflict in file.ts');
    assert.ok(!result.isHookFailure);
  });

  it('invalid upstream is not classified as hook failure', () => {
    const result = classifyHookFailure('fatal: invalid upstream origin/main');
    assert.ok(!result.isHookFailure);
  });

  it('state machine error is not classified as hook failure', () => {
    const result = classifyHookFailure('Error: transition not allowed from review to active');
    assert.ok(!result.isHookFailure);
  });
});

describe('Generic hook match narrowed — F7', () => {
  it('bare "hook" substring in file path does not trigger', () => {
    // A path containing "hook" but no failure phrasing
    const result = classifyHookFailure('error: src/adapters/process/post-integrate-hook.ts');
    assert.ok(!result.isHookFailure, 'file path with "hook" should not match without failure phrasing');
  });

  it('hook with failure phrasing triggers', () => {
    const result = classifyHookFailure('The git hook failed with exit code 1');
    assert.ok(result.isHookFailure);
    assert.equal(result.hookType, 'hook');
  });

  it('hook with error phrasing triggers', () => {
    const result = classifyHookFailure('hook error: process exited');
    assert.ok(result.isHookFailure);
    assert.equal(result.hookType, 'hook');
  });

  it('hook with failure phrasing triggers in integrate', () => {
    const result = classifyHookFailureIntegrate('custom hook failure: lint check');
    assert.ok(result.isHookFailure);
    assert.equal(result.hookType, 'hook');
  });

  it('integrate bare hook in path does not trigger', () => {
    // Uses a path with "hook" but no pre-commit/pre-push keyword and no failure phrasing
    const result = classifyHookFailureIntegrate('modified: src/adapters/process/post-integrate-hook.ts');
    assert.ok(!result.isHookFailure, 'path with "hook" should not match without failure phrasing');
  });
});

describe('Pre-review lifecycle hook rebounce', () => {
  // TASK-2377.03: the pre-review hook path passes the rebound kernel a
  // structured hook-failure reason instead of a synthesized gate result, and
  // the per-occurrence budget lives in memory — so no retry counter is
  // persisted and a gate failure is never relabelled from its output text.
  it('uses the hook-specific prompt and persists no retry counter for a pre-review hook failure', async () => {
    const stateWrites: any[] = [];
    let prompt = '';
    const result = await reboundPreReviewFailure(
      'task-2340',
      '/worktree',
      hookFailureReason('pre-commit hook failed: lint error', 'pre-review safety commit'),
      'claude',
      {
        verifyFn: () => ({ ok: true }),
        readReviewStateFn: async () => new ReviewState('task-2340', { metadata: {} }),
        writeReviewStateFn: async (_slug: string, state: any) => {
          stateWrites.push(state);
          return { outcome: 'committed' as const };
        },
        transitionTaskFn: async () => true,
        startAgentFn: async (_step: string, options: any) => {
          prompt = options.prompt('claude');
          return { agent: 'claude', invocation: {}, result: { status: 0 } };
        },
        applyAgentFallbackFn: async ({ original }: any) => original,
        taskResolution: { ok: true, taskFile: '/worktree/backlog/tasks/task-2340.md' },
        log: () => {}, error: () => {},
      } as any,
    );
    assert.equal(result.bounced, true);
    assert.equal(result.outcome, 'fixed');
    assert.deepEqual(stateWrites, [], 'the kernel keeps its budget in memory');
    assert.match(prompt, /GIT HOOK FAILURE/);
    assert.match(prompt, /Hook type: pre-commit/);
  });

  it('keeps a declared gate failure a gate failure even when its output mentions a hook', async () => {
    let prompt = '';
    const result = await reboundPreReviewFailure(
      'task-2340',
      '/worktree',
      gateFailureReason({
        ok: false,
        area: 'docs',
        command: './scripts/verify-local.sh docs',
        exitCode: 1,
        stdout: 'pre-commit hook failed: lint error',
        stderr: '',
      }),
      'claude',
      {
        verifyFn: () => ({ ok: true }),
        readReviewStateFn: async () => new ReviewState('task-2340', { metadata: {} }),
        writeReviewStateFn: async () => ({ outcome: 'committed' as const }),
        transitionTaskFn: async () => true,
        startAgentFn: async (_step: string, options: any) => {
          prompt = options.prompt('claude');
          return { agent: 'claude', invocation: {}, result: { status: 0 } };
        },
        applyAgentFallbackFn: async ({ original }: any) => original,
        log: () => {}, error: () => {},
      } as any,
    );
    assert.equal(result.bounced, true);
    assert.match(prompt, /PRE-REVIEW GATE FAILURE/);
    assert.match(prompt, /Classification: GateFailure — AutoSendBack/);
  });
});

describe('Shared hook-failure-workflow module — TASK-2369.17', () => {
  it('exports classifyHookFailure identical to rebase and integrate copies', () => {
    assert.equal(classifyHookFailureShared('pre-commit: error').hookType, 'pre-commit');
    assert.equal(classifyHookFailureShared('hook failed').hookType, 'hook');
    assert.equal(classifyHookFailureShared('CONFLICT').isHookFailure, false);
    // Verify same function via re-export chain
    assert.equal(classifyHookFailureShared('pre-commit: x').hookType, classifyHookFailure('pre-commit: x').hookType);
    assert.equal(classifyHookFailureShared('pre-commit: x').hookType, classifyHookFailureIntegrate('pre-commit: x').hookType);
  });

  it('integrate wrapper delegates to shared module (same classification)', () => {
    // Both paths use same classifyHookFailure — verify re-export chain
    assert.strictEqual(classifyHookFailureIntegrate, classifyHookFailureShared);
  });

  it('no longer exports the deleted auto-bounce policy', async () => {
    const shared: Record<string, unknown> = await import('../src/application/hook-failure-workflow.js');
    assert.deepEqual(Object.keys(shared).sort(), ['classifyHookFailure']);
  });
});

// ── TASK-2377.05: the hook bounce is the rebound kernel's, not a standalone
// policy. These replace the deleted `handleHookFailureAutoBounce` describes:
// the retry-budget cases (which pinned the removed `hookFailureRetryCount`
// metadata writes and `MAX_HOOK_RETRY`), the bounce-prompt case, and the
// transition-before-launch case. ────────────────────────────────────────────

describe('Hook bounce on the rebound kernel — TASK-2377.05', () => {
  const hookReason = (output: string) =>
    ({ kind: 'hook-failure', hook: 'pre-commit', operation: 'squash commit', output }) as const;

  it('reports fixed only when the failing check re-runs and passes', async () => {
    let launches = 0;
    let verifies = 0;
    const outcome = await rebound(hookReason('pre-commit: lint error'), {
      slug: 'test-slug',
      worktree: '/worktree',
      implementer: 'claude',
      startAgent: async () => { launches++; return { agent: 'claude', result: { status: 0 } }; },
      verify: () => { verifies++; return { ok: true }; },
      log: () => {},
      error: () => {},
    });

    assert.equal(outcome.outcome, 'fixed');
    assert.equal(launches, 1);
    assert.equal(verifies, 1, 'the kernel re-runs the failing check before believing the fix');
  });

  it('strands after the per-occurrence budget without persisting a counter', async () => {
    let launches = 0;
    const outcome = await rebound(hookReason('pre-commit: lint error'), {
      slug: 'test-slug',
      worktree: '/worktree',
      implementer: 'claude',
      startAgent: async () => { launches++; return { agent: 'claude', result: { status: 0 } }; },
      verify: () => ({ ok: false, diagnostic: 'pre-commit: still failing' }),
      log: () => {},
      error: () => {},
    });

    assert.equal(outcome.outcome, 'exhausted');
    assert.equal(launches, DEFAULT_REBOUND_ATTEMPTS);
    assert.equal(outcome.diagnostic, 'pre-commit: still failing', 'the last re-run diagnostic is carried, not the original');
  });

  it('starts a second occurrence in the same process from a full budget', async () => {
    const spend = async () => {
      let launches = 0;
      await rebound(hookReason('pre-commit: lint error'), {
        slug: 'test-slug',
        worktree: '/worktree',
        implementer: 'claude',
        startAgent: async () => { launches++; return { agent: 'claude', result: { status: 0 } }; },
        verify: () => ({ ok: false }),
        log: () => {},
        error: () => {},
      });
      return launches;
    };
    assert.deepEqual([await spend(), await spend()], [DEFAULT_REBOUND_ATTEMPTS, DEFAULT_REBOUND_ATTEMPTS]);
  });

  it('embeds the hook output and hook type in the fix prompt', async () => {
    const hookOutput = 'pre-commit: formatting check failed';
    let capturedPrompt = '';
    await rebound(hookReason(hookOutput), {
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
    });

    assert.ok(capturedPrompt.includes(hookOutput), 'prompt must contain hook output');
    assert.ok(capturedPrompt.includes('pre-commit'), 'prompt must contain hook type');
  });

  it('transitions the task to the implementer phase before launching, and pins the agent', async () => {
    let transitioned = '';
    let pinnedAgent: unknown;
    let fallbackCalled = false;
    await rebound(hookReason('pre-commit: error'), {
      slug: 'test-slug',
      worktree: '/worktree',
      implementer: 'claude',
      transitionToImplementer: async (slug: string) => { transitioned = slug; },
      startAgent: async (_step, opts: Record<string, unknown>) => {
        assert.ok(transitioned, 'task must transition before launch');
        pinnedAgent = opts.agent;
        return { agent: opts.agent as string, result: { status: 0 } };
      },
      applyAgentFallback: async ({ original }: { original: string }) => { fallbackCalled = true; return original; },
      verify: () => ({ ok: true }),
      log: () => {},
      error: () => {},
    });

    assert.equal(transitioned, 'test-slug');
    assert.equal(pinnedAgent, 'claude', 'implementer agent must be pinned in the launch call');
    assert.ok(fallbackCalled, 'applyAgentFallback must be called after launch');
  });
});
