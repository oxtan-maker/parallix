import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyHookFailure, handleHookFailureAutoBounce } from '../src/adapters/cli/commands/rebase.js';
import rebase from '../src/adapters/cli/commands/rebase.js';
import { classifyHookFailure as classifyHookFailureIntegrate, handleHookFailureAutoBounce as handleHookFailureAutoBounceIntegrate } from '../src/adapters/cli/commands/integrate.js';
import { handleGateFailureAutoBounce } from '../src/adapters/review/review-loop.js';
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

describe('handleHookFailureAutoBounce (rebase.ts) — SC3/SC5/SC6', () => {
  // Common mocks for implementer resolution
  const mockWorkflowStatus = () => ({ available: true, agent: 'claude' });
  const mockSelectAgent = () => 'claude';
  const mockTransitionTask = async () => {};
  const mockApplyFallback = async () => 'claude';

  it('returns true (should retry) when under retry budget', async () => {
    let metadataWritten: any = null;
    const writeReviewStateFn = async (_slug: string, state: any, _worktree: string) => {
      metadataWritten = state.metadata;
    };
    const readReviewStateFn = async () => ({ metadata: {} });
    const startAgentFn = async () => ({ agent: 'claude', result: { status: 0 } });

    const result = await handleHookFailureAutoBounce(
      'test-slug',
      '/worktree',
      'pre-commit: lint error',
      { hookType: 'pre-commit' },
      { startAgentFn, readReviewStateFn, writeReviewStateFn, workflowLauncherStatusFn: mockWorkflowStatus, selectAgentFn: mockSelectAgent, transitionTaskFn: mockTransitionTask, applyAgentFallbackFn: mockApplyFallback }
    );

    assert.ok(result);
    assert.equal(metadataWritten.hookFailureRetryCount, 1);
  });

  it('returns false (stranded) when max retries exceeded', async () => {
    const readReviewStateFn = async () => ({ metadata: { hookFailureRetryCount: 2 } });
    const writeReviewStateFn = async () => {};
    const startAgentFn = async () => ({ agent: 'claude', result: { status: 0 } });

    const result = await handleHookFailureAutoBounce(
      'test-slug',
      '/worktree',
      'pre-commit: lint error',
      { hookType: 'pre-commit' },
      { startAgentFn, readReviewStateFn, writeReviewStateFn, workflowLauncherStatusFn: mockWorkflowStatus, selectAgentFn: mockSelectAgent, transitionTaskFn: mockTransitionTask, applyAgentFallbackFn: mockApplyFallback }
    );

    assert.ok(!result);
  });

  it('increments retry count on each bounce', async () => {
    let currentRetry = 0;
    const readReviewStateFn = async () => ({ metadata: { hookFailureRetryCount: currentRetry } });
    let metadataWritten: any = null;
    const writeReviewStateFn = async (_slug: string, state: any, _worktree: string) => {
      metadataWritten = state.metadata;
    };
    const startAgentFn = async () => ({ agent: 'claude', result: { status: 0 } });

    // First bounce
    await handleHookFailureAutoBounce(
      'test-slug', '/worktree', 'pre-commit: error', { hookType: 'pre-commit' },
      { startAgentFn, readReviewStateFn, writeReviewStateFn, workflowLauncherStatusFn: mockWorkflowStatus, selectAgentFn: mockSelectAgent, transitionTaskFn: mockTransitionTask, applyAgentFallbackFn: mockApplyFallback }
    );
    assert.equal(metadataWritten.hookFailureRetryCount, 1);
    currentRetry = 1;

    // Second bounce
    await handleHookFailureAutoBounce(
      'test-slug', '/worktree', 'pre-commit: error', { hookType: 'pre-commit' },
      { startAgentFn, readReviewStateFn, writeReviewStateFn, workflowLauncherStatusFn: mockWorkflowStatus, selectAgentFn: mockSelectAgent, transitionTaskFn: mockTransitionTask, applyAgentFallbackFn: mockApplyFallback }
    );
    assert.equal(metadataWritten.hookFailureRetryCount, 2);
    currentRetry = 2;

    // Third call - should strand
    const result = await handleHookFailureAutoBounce(
      'test-slug', '/worktree', 'pre-commit: error', { hookType: 'pre-commit' },
      { startAgentFn, readReviewStateFn, writeReviewStateFn, workflowLauncherStatusFn: mockWorkflowStatus, selectAgentFn: mockSelectAgent, transitionTaskFn: mockTransitionTask, applyAgentFallbackFn: mockApplyFallback }
    );
    assert.ok(!result);
  });

  it('returns false when agent launch fails', async () => {
    const readReviewStateFn = async () => ({ metadata: {} });
    const writeReviewStateFn = async () => {};
    const startAgentFn = async () => { throw new Error('agent not available'); };
    let exitCode: number | null = null;
    const exitFn = (code: number) => { exitCode = code; };

    const result = await handleHookFailureAutoBounce(
      'test-slug', '/worktree', 'pre-commit: error', { hookType: 'pre-commit' },
      { startAgentFn, readReviewStateFn, writeReviewStateFn, exitFn, workflowLauncherStatusFn: mockWorkflowStatus, selectAgentFn: mockSelectAgent, transitionTaskFn: mockTransitionTask, applyAgentFallbackFn: mockApplyFallback }
    );

    assert.ok(!result);
    assert.equal(exitCode, 1);
  });

  it('returns false when agent exits with non-zero status', async () => {
    const readReviewStateFn = async () => ({ metadata: {} });
    const writeReviewStateFn = async () => {};
    const startAgentFn = async () => ({ agent: 'claude', result: { status: 1 } });

    const result = await handleHookFailureAutoBounce(
      'test-slug', '/worktree', 'pre-commit: error', { hookType: 'pre-commit' },
      { startAgentFn, readReviewStateFn, writeReviewStateFn, workflowLauncherStatusFn: mockWorkflowStatus, selectAgentFn: mockSelectAgent, transitionTaskFn: mockTransitionTask, applyAgentFallbackFn: mockApplyFallback }
    );

    assert.ok(!result);
  });

  it('creates metadata when no persisted state exists', async () => {
    const readReviewStateFn = async () => null;
    let metadataWritten: any = null;
    const writeReviewStateFn = async (_slug: string, state: any, _worktree: string) => {
      metadataWritten = state.metadata;
    };
    const startAgentFn = async () => ({ agent: 'claude', result: { status: 0 } });

    const result = await handleHookFailureAutoBounce(
      'test-slug', '/worktree', 'pre-commit: error', { hookType: 'pre-commit' },
      { startAgentFn, readReviewStateFn, writeReviewStateFn, workflowLauncherStatusFn: mockWorkflowStatus, selectAgentFn: mockSelectAgent, transitionTaskFn: mockTransitionTask, applyAgentFallbackFn: mockApplyFallback }
    );

    assert.ok(result);
    assert.equal(metadataWritten.hookFailureRetryCount, 1);
  });
});

describe('handleHookFailureAutoBounce (integrate.ts) — SC4/SC5/SC6', () => {
  const mockWorkflowStatus = () => ({ available: true, agent: 'claude' });
  const mockSelectAgent = () => 'claude';
  const mockTransitionTask = async () => {};
  const mockApplyFallback = async () => 'claude';

  it('returns true (should retry) when under retry budget', async () => {
    let metadataWritten: any = null;
    const writeReviewStateFn = async (_slug: string, state: any, _worktree: string) => {
      metadataWritten = state.metadata;
    };
    const readReviewStateFn = async () => ({ metadata: {} });
    const startAgentFn = async () => ({ agent: 'claude', result: { status: 0 } });

    const result = await handleHookFailureAutoBounceIntegrate(
      'test-slug',
      '/worktree',
      'pre-commit: lint error',
      { hookType: 'pre-commit' },
      { startAgentFn, readReviewStateFn, writeReviewStateFn, workflowLauncherStatusFn: mockWorkflowStatus, selectAgentFn: mockSelectAgent, transitionTaskFn: mockTransitionTask, applyAgentFallbackFn: mockApplyFallback }
    );

    assert.ok(result);
    assert.equal(metadataWritten.hookFailureRetryCount, 1);
  });

  it('returns false (stranded) when max retries exceeded', async () => {
    const readReviewStateFn = async () => ({ metadata: { hookFailureRetryCount: 2 } });
    const writeReviewStateFn = async () => {};
    const startAgentFn = async () => ({ agent: 'claude', result: { status: 0 } });

    const result = await handleHookFailureAutoBounceIntegrate(
      'test-slug', '/worktree', 'pre-commit: error', { hookType: 'pre-commit' },
      { startAgentFn, readReviewStateFn, writeReviewStateFn, workflowLauncherStatusFn: mockWorkflowStatus, selectAgentFn: mockSelectAgent, transitionTaskFn: mockTransitionTask, applyAgentFallbackFn: mockApplyFallback }
    );

    assert.ok(!result);
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

describe('Bounce prompt includes hook output — SC9(c)', () => {
  const mockWorkflowStatus = () => ({ available: true, agent: 'claude' });
  const mockSelectAgent = () => 'claude';
  const mockTransitionTask = async () => {};
  const mockApplyFallback = async () => 'claude';

  it('rebase handler prompt contains hook output text', async () => {
    const hookOutput = 'pre-commit: ESLint found 3 errors';
    let capturedPrompt: string | undefined;
    const startAgentFn = async (step: string, opts: any) => {
      capturedPrompt = typeof opts.prompt === 'function' ? opts.prompt('claude') : opts.prompt;
      return { agent: 'claude', result: { status: 0 } };
    };
    const readReviewStateFn = async () => ({ metadata: {} });
    const writeReviewStateFn = async () => {};

    await handleHookFailureAutoBounce(
      'test-slug',
      '/worktree',
      hookOutput,
      { hookType: 'pre-commit' },
      { startAgentFn, readReviewStateFn, writeReviewStateFn, transitionTaskFn: mockTransitionTask, applyAgentFallbackFn: mockApplyFallback, workflowLauncherStatusFn: mockWorkflowStatus, selectAgentFn: mockSelectAgent }
    );

    assert.ok(capturedPrompt, 'prompt must be captured');
    assert.ok(capturedPrompt.includes(hookOutput), 'prompt must contain hook output');
    assert.ok(capturedPrompt.includes('pre-commit'), 'prompt must contain hook type');
    assert.ok(capturedPrompt.includes('Retry attempt'), 'prompt must contain retry count');
  });

  it('integrate handler prompt contains hook output text', async () => {
    const hookOutput = 'pre-commit: formatting check failed';
    let capturedPrompt: string | undefined;
    const startAgentFn = async (step: string, opts: any) => {
      capturedPrompt = typeof opts.prompt === 'function' ? opts.prompt('claude') : opts.prompt;
      return { agent: 'claude', result: { status: 0 } };
    };
    const readReviewStateFn = async () => ({ metadata: {} });
    const writeReviewStateFn = async () => {};

    await handleHookFailureAutoBounceIntegrate(
      'test-slug',
      '/worktree',
      hookOutput,
      { hookType: 'pre-commit' },
      { startAgentFn, readReviewStateFn, writeReviewStateFn, transitionTaskFn: mockTransitionTask, applyAgentFallbackFn: mockApplyFallback, workflowLauncherStatusFn: mockWorkflowStatus, selectAgentFn: mockSelectAgent }
    );

    assert.ok(capturedPrompt, 'prompt must be captured');
    assert.ok(capturedPrompt.includes(hookOutput), 'prompt must contain hook output');
    assert.ok(capturedPrompt.includes('pre-commit'), 'prompt must contain hook type');
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

describe('Handler mirrors reference pattern — F4', () => {
  const mockWorkflowStatus = () => ({ available: true, agent: 'claude' });
  const mockSelectAgent = () => 'claude';

  it('rebase handler transitions task before launch', async () => {
    let taskTransitioned = false;
    const transitionTaskFn = async (_slug: string, status: string) => {
      taskTransitioned = true;
      assert.equal(status, 'active');
    };
    let implementerPinned = false;
    const startAgentFn = async (step: string, opts: any) => {
      implementerPinned = opts.agent !== undefined;
      return { agent: opts.agent, result: { status: 0 } };
    };
    let fallbackCalled = false;
    const applyAgentFallbackFn = async () => {
      fallbackCalled = true;
      return 'claude';
    };
    const readReviewStateFn = async () => ({ metadata: {} });
    const writeReviewStateFn = async () => {};

    await handleHookFailureAutoBounce(
      'test-slug',
      '/worktree',
      'pre-commit: error',
      { hookType: 'pre-commit' },
      { startAgentFn, readReviewStateFn, writeReviewStateFn, transitionTaskFn, applyAgentFallbackFn, workflowLauncherStatusFn: mockWorkflowStatus, selectAgentFn: mockSelectAgent }
    );

    assert.ok(taskTransitioned, 'task must transition to active before launch');
    assert.ok(implementerPinned, 'implementer agent must be pinned in startAgent call');
    assert.ok(fallbackCalled, 'applyAgentFallback must be called after launch');
  });

  it('integrate handler transitions task before launch', async () => {
    let taskTransitioned = false;
    const transitionTaskFn = async (_slug: string, status: string) => {
      taskTransitioned = true;
      assert.equal(status, 'active');
    };
    let implementerPinned = false;
    const startAgentFn = async (step: string, opts: any) => {
      implementerPinned = opts.agent !== undefined;
      return { agent: opts.agent, result: { status: 0 } };
    };
    let fallbackCalled = false;
    const applyAgentFallbackFn = async () => {
      fallbackCalled = true;
      return 'claude';
    };
    const readReviewStateFn = async () => ({ metadata: {} });
    const writeReviewStateFn = async () => {};

    await handleHookFailureAutoBounceIntegrate(
      'test-slug',
      '/worktree',
      'pre-commit: error',
      { hookType: 'pre-commit' },
      { startAgentFn, readReviewStateFn, writeReviewStateFn, transitionTaskFn, applyAgentFallbackFn, workflowLauncherStatusFn: mockWorkflowStatus, selectAgentFn: mockSelectAgent }
    );

    assert.ok(taskTransitioned, 'task must transition to active before launch');
    assert.ok(implementerPinned, 'implementer agent must be pinned in startAgent call');
    assert.ok(fallbackCalled, 'applyAgentFallback must be called after launch');
  });
});

describe('Rebase retry budget — regression coverage', () => {
  const rebaseOptions = (gitFn: Function, handleHookFailureAutoBounceFn: Function, exitFn: (_code: number) => void) => ({
    inferSlugFn: () => 'task-2340',
    findMissionDirFn: () => '/worktree/missions/task-2340',
    findMissionAreaFn: () => 'docs',
    getCurrentBranchFn: () => 'mission/task-2340',
    resolveWorktreeFn: () => '/worktree',
    resolveMissionBaseBranchFn: () => 'main',
    detectRebaseStateFn: () => ({ inProgress: false, unmergedFiles: [] }),
    resolveConflictsFn: () => ({
      ok: true,
      conflictFiles: ['missions/task-2340/MISSION.md'],
      missionSpecificFiles: ['missions/task-2340/MISSION.md'],
      sharedFiles: [],
    }),
    isForgejoReviewEnabledFn: () => false,
    missionServicesFn: async () => ({ store: {} }),
    gitFn,
    handleHookFailureAutoBounceFn,
    exitFn,
  });

  it('rebounces a second initial-rebase hook failure before stranding at the budget', async () => {
    let bounces = 0;
    let exitCode: number | null = null;
    await rebase(['task-2340'], rebaseOptions(
      (args: string[]) => args.includes('--continue')
        ? { status: 1, stdout: '', stderr: 'pre-commit hook failed' }
        : { status: 1, stdout: '', stderr: 'pre-commit hook failed' },
      async () => (++bounces < 3),
      (code: number) => { exitCode = code; },
    ));
    assert.equal(bounces, 3);
    assert.equal(exitCode, 1);
  });

  it('rebounces every failed rebase --continue until the persisted budget strands', async () => {
    let bounces = 0;
    let exitCode: number | null = null;
    await rebase(['task-2340'], rebaseOptions(
      (args: string[]) => args.includes('--continue')
        ? { status: 1, stdout: '', stderr: 'pre-commit hook failed' }
        : { status: 1, stdout: '', stderr: 'CONFLICT (content): Merge conflict in missions/task-2340/MISSION.md' },
      async () => (++bounces < 3),
      (code: number) => { exitCode = code; },
    ));
    assert.equal(bounces, 3);
    assert.equal(exitCode, null);
  });
});

describe('Pre-review lifecycle hook rebounce', () => {
  it('uses the hook retry budget and hook-specific prompt for a gate-stage hook failure', async () => {
    let persistedMetadata: any;
    let prompt = '';
    const result = await handleGateFailureAutoBounce('task-2340', '/worktree', {
      ok: false,
      area: 'docs',
      command: './scripts/verify-local.sh docs',
      exitCode: 1,
      stdout: 'pre-commit hook failed: lint error',
      stderr: '',
    }, 'claude', {
      readReviewStateFn: async () => new ReviewState('task-2340', { metadata: {} }),
      writeReviewStateFn: async (_slug: string, state: any) => {
        persistedMetadata = state.metadata;
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
    });
    assert.deepEqual(result, { bounced: true, stranded: false });
    assert.equal(persistedMetadata.hookFailureRetryCount, 1);
    assert.equal(persistedMetadata.gateFailureRetryCount, undefined);
    assert.match(prompt, /GIT HOOK FAILURE/);
  });
});
