// TASK-2603 — integration rebounds must retain the identity persistence context
// that ordinary review-loop fallbacks receive.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createIntegrationGateStep } from '../src/application/integrate/gates.js';
import { createSquashLanding } from '../src/application/integrate/squash.js';

const slug = 'task-2603-fixture';
const missionStore = { load: async () => ({ kind: 'found', mission: { status: 'integration' }, version: 1 }) };
const reviewState = { implementer: 'claude', reviewer: 'codex', phase: 'approved', round: 2 };
const taskResolution = { ok: true, taskFile: '/worktree/backlog/tasks/task-2603.md' };

function assertFallbackContext(options: Record<string, unknown>, worktree: string) {
  assert.equal(options.role, 'implementer');
  assert.equal(options.slug, slug);
  assert.equal(options.worktree, worktree);
  assert.equal(options.state, reviewState);
  assert.equal(options.missionStore, missionStore);
  assert.equal(options.taskResolution, taskResolution);
  assert.equal(options.original, 'claude');
  assert.equal((options.launchResult as { agent: string }).agent, 'codex');
  return 'codex';
}

test('TASK-2603: integration-gate rebound binds active mission context before persisting a fallback implementer', async () => {
  const { runRequiredLocalGates } = createIntegrationGateStep({
    gates: {
      resolveIntegrationVerificationWorktree: () => '/mission-worktree',
      captureFinalIntegrationTree: () => ({ ok: true, rootDir: '/mission-worktree', commit: 'c', tree: 't' }),
      loadPhaseGates: () => [{ key: 'required', command: 'false', order: 1 }],
      loadRequirePreIntegration: () => false,
      runPhaseGates: async () => ({ ok: false, skipped: false, cancelled: false, failedGate: { key: 'required' }, error: 'red' }),
    },
    landing: { createAbort: () => new Error('abort') },
    verification: { formatVerificationCommand: () => 'npm test' },
  } as never);

  await runRequiredLocalGates({
    slug, context: { baseWorktree: '/base', taskAssignee: 'claude', branch: `mission/${slug}`, approval: {}, configuredReviewer: null, task: taskResolution, reviewState },
    missionLoad: { kind: 'found', mission: { repositoryId: 'repo' } }, missionServices: { store: missionStore, lifecycle: { transition: async () => ({ status: 'completed' }) } },
    dryRun: false, noIntegrationGates: false, realAgent: null, realAgentModel: null,
    seams: {
      startAgentFn: async () => ({ agent: 'codex', result: { status: 0 } }), transitionTaskFn: () => true,
      applyAgentFallbackFn: (options: Record<string, unknown>) => assertFallbackContext(options, '/mission-worktree'),
      routeIntegrationGateFailureFn: async (options: Record<string, any>) => {
        await options.applyAgentFallbackFn({ original: 'claude', launchResult: { agent: 'codex' } });
        return { route: 'fixed', rebounds: 1 };
      },
    },
  } as never);
});

test('TASK-2603: squash-hook rebound binds the same active mission context before persisting a fallback implementer', async () => {
  let commits = 0;
  const { squashAndLand } = createSquashLanding({
    git: { git: (args: string[]) => {
      if (args.includes('commit')) { commits += 1; return commits === 1 ? { status: 1, stdout: '', stderr: 'pre-commit: failed' } : { status: 0, stdout: '', stderr: '' }; }
      if (args.includes('diff')) { return { status: 0, stdout: 'fixture.ts\0', stderr: '' }; }
      return { status: 0, stdout: 'commit\n', stderr: '' };
    } },
    backlog: { checkBacklogIntegrity: () => [] }, fileSystem: { existsSync: () => false },
    missionPaths: { softResetTrailingBacklogNoise: () => false },
    gates: { isIntendedPayloadAtHead: () => false }, verification: { captureVerifiedTreeProof: () => ({ ok: true, proof: {} }), assertVerifiedTreeProof: () => ({ ok: true }) },
    productConfig: { isForgejoReviewEnabled: () => false },
    landing: { classifyHookFailure: () => ({ isHookFailure: true, hookType: 'pre-commit' }), createAbort: () => new Error('abort') },
  } as never, { promoteTaskForIntegrationIfNeeded: async () => {} });

  await assert.rejects(() => squashAndLand({
    slug, context: { area: 'all', taskAssignee: 'claude', task: taskResolution, reviewState }, missionServices: { store: missionStore },
    baseWorktree: '/base', baseBranch: 'main', state: { temporaryStash: null, nextActionMessage: null },
    seams: { startAgentFn: async () => ({ agent: 'codex', result: { status: 0 } }), transitionTaskFn: () => true,
      applyAgentFallbackFn: (options: Record<string, unknown>) => assertFallbackContext(options, '/base') },
  } as never, { branch: `mission/${slug}`, summary: 'fixture', landedFromSha: 'before', mainTaskFile: '/missing' }));
  assert.equal(commits, 2, 'the hook repair re-verifies the same squash commit');
});
