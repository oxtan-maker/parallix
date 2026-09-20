// TASK-2520 SC6 / AC7: `px rebase` must never report "Rebase completed cleanly"
// while the mission worktree still has a rebase in progress. The shared rebase
// workflow treats a non-empty `rebase --show-current` after a status-0
// rebase as incomplete and must skip the clean-completion result. Hermetic: the
// rebase-workflow port is an injected double, so no worktree, real Forgejo, or
// agent is touched.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { mockModule, installModuleMocks } from './lib/module-mock.js';

const rebaseWorkflow = mockModule<typeof import('../src/application/rebase-workflow.js')>('../src/application/rebase-workflow.js', import.meta.url);
await installModuleMocks();
test.afterEach(() => mock.restoreAll());

const { runRebaseWorkflow } = await import('../src/application/rebase-workflow.js');

const SLUG = 'task-2520-rebase';
const BRANCH = `mission/${SLUG}`;
const WORKTREE = '/tmp/task-2520-rebase-worktree';

/**
 * Build a minimal RebaseWorkflowPort. The rebase command succeeds (status 0) but
 * `rebase --show-current` reports the worktree is still mid-rebase, which is the
 * exact SC6 trap: a status-0 rebase that has not actually finished.
 */
function buildPort({ inProgress }: { inProgress: boolean }, exitCodes: { value: number[] }) {
  const port: any = {
    git: (args: string[]) => {
      if (args.includes('--show-current')) {
        return { status: 0, stdout: inProgress ? SLUG : '', stderr: '' };
      }
      if (args.includes('rebase')) { return { status: 0, stdout: '', stderr: '' }; }
      return { status: 0, stdout: '', stderr: '' };
    },
    detectRebaseState: () => ({ inProgress: false, rebaseHead: null, unmergedFiles: [] }),
    getCurrentBranch: () => BRANCH,
    cwd: () => WORKTREE,
    inferSlug: () => SLUG,
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
    workflowLauncherStatus: () => ({ supported: true, agent: 'test-agent' }),
    applyAgentFallback: async () => 'test-agent',
    createPr: () => ({ ok: true }),
    readToken: () => 'token',
    resolveForgejoUser: (user: string | null) => user ?? 'tester',
    fetchReviewBranch: () => ({ status: 0, stdout: '', stderr: '' }),
    resolveTaskFile: () => ({ ok: true, taskFile: `${WORKTREE}/backlog/tasks/${SLUG}.md`, task: {} }),
    getTaskImplementer: () => 'tester',
    transitionTask: async () => undefined,
    resolveReviewIdentity: () => ({ forgejoUser: 'tester' }),
    readReviewState: () => ({ metadata: {} }),
    writeReviewState: () => undefined,
    persistReviewState: async () => undefined,
    isForgejoReviewEnabled: () => true,
    formatVerificationCommand: () => './scripts/verify-local.sh lib',
    resolveConflictsForMission: () => ({ ok: true, conflictFiles: [], missionSpecificFiles: [], sharedFiles: [] }),
    missionServices: null,
    exit: (code: number) => { exitCodes.value.push(code); },
  };
  return port;
}

test('px rebase does not report clean completion while a rebase is in progress (SC6)', async () => {
  const logs: string[] = [];
  mock.method(console, 'log', (chunk: unknown) => { logs.push(String(chunk)); return true; });
  mock.method(console, 'error', (chunk: unknown) => { logs.push(String(chunk)); return true; });

  const exitCodes: number[] = [];
  const port = buildPort({ inProgress: true }, { value: exitCodes });

  await runRebaseWorkflow([SLUG], port);

  const joined = logs.join('\n');
  assert.match(joined, /still in progress/, 'a mid-rebase rebase must be reported as still in progress');
  assert.doesNotMatch(joined, /Rebase completed cleanly/, 'must not emit the clean-completion result while a rebase is active');
  assert.deepEqual(exitCodes, [0], 'exits 0 to hand the worktree back to the operator to continue the rebase');
});

test('px rebase reports clean completion only when no rebase is active (SC6)', async () => {
  const logs: string[] = [];
  mock.method(console, 'log', (chunk: unknown) => { logs.push(String(chunk)); return true; });
  mock.method(console, 'error', (chunk: unknown) => { logs.push(String(chunk)); return true; });

  const exitCodes: number[] = [];
  const port = buildPort({ inProgress: false }, { value: exitCodes });

  await runRebaseWorkflow([SLUG], port);

  const joined = logs.join('\n');
  assert.match(joined, /Rebase completed cleanly/, 'a finished rebase reports clean completion');
});
