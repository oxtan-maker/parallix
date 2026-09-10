/**
 * TASK-2377.02: the pre-review rebase runs in-process through
 * `RebaseWorkflowPort` and reports typed gate / hook evidence.
 *
 * These tests pin the two defects behind the task-2369.13 incident:
 *   1. a push-time verification-gate failure whose output contains `pre-push`
 *      was classified as a Git hook failure by a parent-side regex, and
 *   2. the nested CLI spent the hook-retry budget the parent also read.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setLogger } from '../src/application/presentation/cli-format.js';
import { runRebaseWorkflow } from '../src/application/rebase-workflow.js';
import { rebaseBeforeReviewRound } from '../src/adapters/review/rebase.js';
import { startReviewLoop } from '../src/adapters/review/review-loop.js';
import type { RebaseWorkflowPort } from '../src/application/ports/rebase-workflow.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REBASE_MODULE = path.join(REPO_ROOT, 'src', 'adapters', 'review', 'rebase.ts');
const SLUG = 'task-2377.02';
const BRANCH = `mission/${SLUG}`;
const WORKTREE = '/tmp/task-2377-02-worktree';
// `signal` keeps this assignable to both the port's GitCommandResult and the
// git adapter's GitResult, so one double serves the port and the `gitFn` seam.
const OK = { status: 0, stdout: '', stderr: '', signal: null };

/** A push-time gate run whose captured output is full of hook-like words. */
const GATE_OUTPUT_WITH_PRE_PUSH = [
  'pre-push: running ./scripts/verify-local.sh all',
  '✖ pre-push hook budget check (unit suite)',
  'ℹ fail 1',
  'FAIL: verification gate failed with exit code 1',
].join('\n');

/**
 * Fully mocked `RebaseWorkflowPort`; the real `runRebaseWorkflow` drives it, so
 * these tests exercise the in-process path with no git, Forgejo, or agent access.
 */
function stubPort(overrides: Partial<RebaseWorkflowPort> = {}): RebaseWorkflowPort {
  return {
    git: () => OK,
    detectRebaseState: () => ({ inProgress: false, unmergedFiles: [] }),
    getCurrentBranch: () => BRANCH,

    cwd: () => WORKTREE,
    inferSlug: (explicitSlug?: string) => explicitSlug ?? SLUG,
    findMissionDir: () => `${WORKTREE}/missions/${SLUG}`,
    findMissionArea: () => 'lib',
    resolveWorktree: () => WORKTREE,
    conventionalWorktreePath: () => WORKTREE,
    missionBranchName: () => BRANCH,
    resolveMissionBaseBranch: () => 'main',
    missionConflictPathPrefix: () => `missions/${SLUG}/`,
    resolvePromptBaseBranch: () => 'main',

    startAgent: async () => ({ agent: 'test-agent', result: { status: 0 } }),
    selectAgent: () => 'test-agent',
    workflowLauncherStatus: (_agent: string) => ({ supported: true, agent: 'test-agent' }),
    applyAgentFallback: async () => 'test-agent',

    createPr: () => ({ ok: true }),
    readToken: () => 'token',
    resolveForgejoUser: (user: string | null) => user ?? 'tester',
    fetchReviewBranch: () => OK,

    resolveTaskFile: () => ({ ok: true, taskFile: `${WORKTREE}/backlog/tasks/${SLUG}.md`, task: {} }),
    getTaskImplementer: () => 'tester',
    transitionTask: async () => undefined,

    resolveReviewIdentity: () => ({ forgejoUser: 'tester' }),
    readReviewState: () => ({ metadata: {} }),
    writeReviewState: () => undefined,
    persistReviewState: async () => undefined,

    isForgejoReviewEnabled: () => true,

    formatVerificationCommand: (area: string) => `./scripts/verify-local.sh ${area}`,

    resolveConflictsForMission: () => ({ ok: true, conflictFiles: [], missionSpecificFiles: [], sharedFiles: [] }),

    missionServices: null,
    exit: () => {},
    ...overrides,
  };
}

/** Options that keep `rebaseBeforeReviewRound` off the real filesystem. */
function preReviewOptions(port: RebaseWorkflowPort, extra: Record<string, unknown> = {}) {
  return {
    worktree: WORKTREE,
    isForgejoReviewEnabledFn: () => true,
    gitFn: () => OK,
    createRebaseWorkflowPortFn: () => port,
    log: () => {},
    error: () => {},
    ...extra,
  };
}

test('pre-review rebase module spawns no CLI subprocess', () => {
  const source = fs.readFileSync(REBASE_MODULE, 'utf8');
  assert.equal(/spawnSync/.test(source), false, 'rebase.ts must not use spawnSync');
  assert.equal(/child_process/.test(source), false, 'rebase.ts must not import child_process');
  assert.equal(/'rebase',\s*slug/.test(source), false, 'rebase.ts must not construct px rebase argv');
});

test('pre-review rebase drives the rebase workflow port in-process exactly once', async () => {
  let portsCreated = 0;
  let workflowRuns = 0;
  let workflowArgs: string[] = [];

  const result = await rebaseBeforeReviewRound(SLUG, preReviewOptions(stubPort(), {
    createRebaseWorkflowPortFn: () => { portsCreated += 1; return stubPort(); },
    runRebaseWorkflowFn: async (args: string[], port: RebaseWorkflowPort) => {
      workflowRuns += 1;
      workflowArgs = args;
      port.exit(0);
    },
  }));

  assert.deepEqual(result, { ok: true, sharedFileConflicts: false, hookFailure: false });
  assert.equal(portsCreated, 1, 'exactly one rebase workflow port per pre-review rebase');
  assert.equal(workflowRuns, 1, 'exactly one in-process workflow run per pre-review rebase');
  assert.deepEqual(workflowArgs, [SLUG, '--push'], 'the workflow runs the mission with --push');
});

test('push-time gate failure whose output contains pre-push classifies as a gate failure', async () => {
  const port = stubPort({ createPr: () => ({ ok: false, error: GATE_OUTPUT_WITH_PRE_PUSH }) });
  const previousLogger = setLogger({ log: () => {} });
  let result;
  try {
    result = await rebaseBeforeReviewRound(SLUG, preReviewOptions(port, {
      runRebaseWorkflowFn: runRebaseWorkflow,
    }));
  } finally {
    setLogger(previousLogger);
  }

  assert.equal(result.ok, false);
  assert.equal(result.hookFailure, false, 'gate output containing "pre-push" is never a hook failure');
  assert.equal(result.failure?.kind, 'gate');
  assert.equal(result.failure?.operation, 'push');
  const gate = result.failure?.kind === 'gate' ? result.failure.gate : null;
  assert.ok(gate, 'gate evidence is present');
  assert.equal(gate!.area, 'lib');
  assert.equal(gate!.command, './scripts/verify-local.sh lib');
  assert.equal(typeof gate!.exitCode, 'number');
  assert.notEqual(gate!.exitCode, 0);
  assert.match(gate!.stderr, /pre-push/, 'the raw gate output is preserved for the fix prompt');
});

test('genuine hook failure during the pre-review rebase reports hook identity and output', async () => {
  const hookOutput = 'error: failed to push some refs\npre-commit hook rejected the commit: lint error';
  const port = stubPort({
    git: (args: string[]) => (args.includes('rebase') && !args.includes('--show-current')
      ? { status: 1, stdout: '', stderr: hookOutput }
      : OK),
  });
  const previousLogger = setLogger({ log: () => {} });
  let result;
  try {
    result = await rebaseBeforeReviewRound(SLUG, preReviewOptions(port, {
      runRebaseWorkflowFn: runRebaseWorkflow,
    }));
  } finally {
    setLogger(previousLogger);
  }

  assert.equal(result.ok, false);
  assert.equal(result.hookFailure, true);
  assert.equal(result.failure?.kind, 'hook');
  const hook = result.failure?.kind === 'hook' ? result.failure.hook : null;
  assert.equal(hook!.hook, 'pre-commit', 'hook identity comes from the failing git operation');
  assert.match(hook!.output, /pre-commit hook rejected the commit/);
  assert.equal(result.hookOutput, hook!.output, 'raw hook output stays available to prompt builders');
});

test('a pre-review rebase hook failure requests the hook bounce at most once', async () => {
  const hookOutput = 'pre-commit hook rejected the commit: lint error';
  const continueCalls: string[][] = [];
  const port = stubPort({
    git: (args: string[]) => {
      if (args.includes('--continue')) { continueCalls.push(args); }
      return args.includes('rebase') && !args.includes('--show-current')
        ? { status: 1, stdout: '', stderr: hookOutput }
        : OK;
    },
  });
  const previousLogger = setLogger({ log: () => {} });
  let result;
  try {
    result = await rebaseBeforeReviewRound(SLUG, preReviewOptions(port, {
      runRebaseWorkflowFn: runRebaseWorkflow,
    }));
  } finally {
    setLogger(previousLogger);
  }

  const bounceRequests = result.failure?.kind === 'hook' ? result.failure.bounceRequests : -1;
  assert.equal(bounceRequests, 1, 'the in-process workflow requests the bounce exactly once');
  assert.deepEqual(continueCalls, [], 'no in-child retry: the caller owns the hook-retry budget');
});

test('genuine pre-commit failure on the pre-review safety commit reports hook evidence', async () => {
  const result = await rebaseBeforeReviewRound(SLUG, preReviewOptions(stubPort(), {
    gitFn: (args: string[]) => {
      if (args.includes('status')) { return { status: 0, stdout: ` M missions/${SLUG}/MISSION.md\0`, stderr: '' }; }
      if (args.includes('commit')) { return { status: 1, stdout: '', stderr: 'pre-commit hook failed: lint error' }; }
      return OK;
    },
  }));

  assert.equal(result.ok, false);
  assert.equal(result.hookFailure, true);
  assert.equal(result.failure?.kind, 'hook');
  assert.equal(result.failure?.operation, 'commit');
  const hook = result.failure?.kind === 'hook' ? result.failure.hook : null;
  assert.equal(hook!.hook, 'pre-commit');
  assert.match(hook!.output, /pre-commit hook failed/);
});

test('review loop rebounces a pre-review rebase gate failure as a gate failure, not a hook bounce', async () => {
  const gateOutput = GATE_OUTPUT_WITH_PRE_PUSH;
  const logs: string[] = [];
  const exits: number[] = [];
  let preReviewBounces = 0;
  let reviewerLaunches = 0;

  const reviewOpts = {
    worktree: WORKTREE,
    implementer: 'codex',
    reviewer: 'claude',
    maxAttempts: 1,
    resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task-2377-02.md', matches: [] }),
    getTaskStatusFn: () => 'review',
    eligibleAgentsForStepFn: () => ['codex', 'claude'],
    workflowLauncherStatusFn: () => ({ supported: true, agent: 'codex', detail: null }),
    isForgejoReviewEnabledFn: () => true,
    forgejoAvailableFn: async () => true,
    getPrStatusFn: () => ({ exists: true, state: 'open', number: 2377, url: 'http://forgejo.invalid/pr/2377' }),
    resolveForgejoUserFn: () => 'reviewer',
    readTokenFn: () => 'test-token',
    maybeUpdateGraphifyBeforeReviewFn: () => {},
    readReviewStateFn: () => null,
    writeReviewStateFn: async () => ({ outcome: 'committed' as const }),
    transitionTaskFn: async () => true,
    rebaseBeforeReviewRoundFn: async () => ({
      ok: false,
      sharedFileConflicts: false,
      hookFailure: false,
      failure: {
        kind: 'gate' as const,
        operation: 'push' as const,
        gate: {
          area: 'lib',
          command: './scripts/verify-local.sh lib',
          exitCode: 1,
          stdout: gateOutput,
          stderr: gateOutput,
        },
      },
    }),
    runPreReviewGateFn: async () => ({ ok: true, area: 'lib', command: 'true', exitCode: 0, stdout: '', stderr: '' }),
    reboundPreReviewFailureFn: async () => {
      preReviewBounces += 1;
      return { bounced: false, stranded: true, attempts: 0, outcome: 'exhausted' as const, diagnostic: 'gate still failing', implementer: 'codex' };
    },
    startAgentFn: async (step: string, options: any) => {
      if (step === 'review') { reviewerLaunches += 1; }
      return { agent: options.agent, result: { status: 0 } } as any;
    },
    applyAgentFallbackFn: async ({ original }: any) => original,
    consumeReviewerArtifactsFn: async () => ({ consumed: false }),
    consumeImplementerArtifactsFn: async () => ({ consumed: false }),
    buildCompactReviewPromptFn: () => 'review prompt',
    buildCompactActOnReviewPromptFn: () => 'implementer repair prompt',
    recordStageStatsSafeFn: () => {},
    gitFn: () => ({ stdout: 'main\n', stderr: '', status: 0 }) as any,
    log: (line: string) => logs.push(line),
    error: (line: string) => logs.push(line),
    exit: ((code: number) => { exits.push(code); }) as any,
  };

  await startReviewLoop(SLUG, reviewOpts);

  assert.equal(preReviewBounces, 1, 'a pre-review rebase gate failure must use the rebound path');
  assert.equal(reviewerLaunches, 0, 'no reviewer launches after a failed pre-review rebase');
  assert.deepEqual(exits, [1], 'the loop exits on the gate failure');
  assert.ok(
    logs.some(line => line.includes('Pre-review rebase gate failed for area "lib"')),
    `expected a gate-classified diagnostic, got: ${logs.join(' | ')}`,
  );
  assert.ok(
    logs.every(line => !line.includes('Git hook failure')),
    `a gate failure must never be reported as a hook failure, got: ${logs.join(' | ')}`,
  );
});

// F8 (task-2476 round 1): the shared-file rebase repair instruction must reach
// the operator. It is emitted at WARN so the `px active` operator-critical
// filter keeps it; emitting it at INFO (as before) would drop it and no test
// would fail. This test drives the real conflict branch and pins the WARN tag.
test('shared-file rebase conflict emits the repair instruction at WARN level', async () => {
  const logs: string[] = [];
  // Initial rebase onto `<branch>` lands on a shared-file conflict; the rest of
  // the git surface resolves cleanly so the workflow launches the conflict
  // agent and returns, letting the wrapper flag the shared-file conflict.
  // The workflow drives `port.git`; auto-commit uses the gitFn option, so keep
  // that clean and only make the workflow's rebase land on a shared conflict.
  const git = (args: string[]) => {
    if (args.includes('--show-current')) { return { status: 0, stdout: '', stderr: '' }; }
    if (args.includes('rebase') && args.includes('--continue')) { return OK; }
    if (args.includes('rebase')) {
      return { status: 1, stdout: 'Merge conflict in src/shared/common.ts', stderr: '' };
    }
    if (args.includes('merge-base')) { return { status: 0, stdout: '', stderr: '' }; }
    return OK;
  };
  // A conflict-agent that fails makes the workflow exit non-zero, which is the
  // path the wrapper flags as a shared-file conflict and emits the repair line.
  const startAgent = async (step: string) => (step === 'conflict-resolution'
    ? { agent: 'tester', result: { status: 1 } }
    : { agent: 'tester', result: { status: 0 } });

  const result = await rebaseBeforeReviewRound(SLUG, preReviewOptions(stubPort({
    git: git as any,
    startAgent: startAgent as any,
    resolveConflictsForMission: () => ({ ok: true, conflictFiles: [], missionSpecificFiles: [], sharedFiles: ['src/shared/common.ts'] }),
  }), {
    log: (line: string) => logs.push(line),
    error: (line: string) => logs.push(line),
  }));

  assert.equal(result.ok, false);
  assert.equal(result.sharedFileConflicts, true);
  const repair = logs.find(line => /Resolve the conflicts in the worktree/.test(line));
  assert.ok(repair, `expected a repair instruction in operator logs: ${logs.join(' | ')}`);
  // The operator-critical filter only keeps WARN/FAIL lines; an INFO-tagged
  // repair instruction would silently vanish. Pin the level so a revert fails.
  assert.match(repair!, /^\[WARN\]/, `repair instruction must be WARN-tagged, got: ${repair}`);
});
