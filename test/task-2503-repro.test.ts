/**
 * TASK-2503 reproduction test.
 *
 * Bug: shared-file conflict recovery during `px rebase` resolves the mission
 * implementer from the Backlog task file in the worktree. That file is part of
 * the history being replayed, so a stale mission branch exposes an older
 * assignee (implementer B) while the mission record — the review state, which
 * lives outside the replayed history — still names the implementer the mission
 * was dispatched with (implementer A). Recovery therefore launched B.
 *
 * The first assertion fails at the mission parent commit (recovery launches the
 * replayed assignee) and passes once the pre-replay mission record is the
 * capture source. The second test guards the classification of unavailable
 * local mission metadata: it is a local workflow condition, never a Forgejo or
 * network blocker.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { setLogger } from '../src/application/presentation/cli-format.js';
import { RebaseCommandUseCase } from '../src/application/rebase-command-use-case.js';
import type { GitCommandResult, RebaseWorkflowPort } from '../src/application/ports/rebase-workflow.js';

const OK: GitCommandResult = { status: 0, stdout: '', stderr: '' };
const SHARED_FILE = 'src/adapters/git/git.ts';

/** Strip the leading `-C <root>` / `-c <key=value>` globals so index 0 is the subcommand. */
function subcommand(args: string[]): string[] {
  let index = 0;
  while (index + 1 < args.length && (args[index] === '-C' || args[index] === '-c')) { index += 2; }
  return args.slice(index);
}

interface Harness {
  port: RebaseWorkflowPort;
  lines: string[];
  exitCodes: number[];
  agentLaunches: Array<{ step: string; options: Record<string, unknown> }>;
}

/**
 * Fully mocked `RebaseWorkflowPort` that pauses the rebase on a shared-file
 * conflict, so the run always reaches agent-assisted recovery. No real git,
 * Forgejo, agent, backlog, or filesystem access.
 */
function sharedConflictHarness(overrides: Partial<RebaseWorkflowPort> = {}): Harness {
  const lines: string[] = [];
  const exitCodes: number[] = [];
  const agentLaunches: Array<{ step: string; options: Record<string, unknown> }> = [];
  const port: RebaseWorkflowPort = {
    git: (args: string[]) => {
      const tail = subcommand(args);
      if (tail[0] === 'rebase' && tail[1] === 'main') {
        return { status: 1, stdout: '', stderr: `CONFLICT (content): Merge conflict in ${SHARED_FILE}\n` };
      }
      return OK;
    },
    detectRebaseState: () => ({ inProgress: false, unmergedFiles: [] }),
    getCurrentBranch: () => 'mission/task-2503',

    cwd: () => '/repo',
    inferSlug: (explicitSlug?: string) => explicitSlug ?? 'task-2503',
    findMissionDir: () => '/worktree/missions/task-2503',
    findMissionArea: () => 'docs',
    resolveWorktree: () => '/worktree',
    conventionalWorktreePath: () => '/worktrees/task-2503',
    missionBranchName: () => 'mission/task-2503',
    resolveMissionBaseBranch: () => 'main',
    missionConflictPathPrefix: () => 'missions/task-2503/',
    resolvePromptBaseBranch: () => 'main',

    startAgent: async (step: string, options: Record<string, unknown>) => {
      agentLaunches.push({ step, options });
      return { agent: String(options.agent ?? 'pool-selected'), result: { status: 0 } };
    },
    selectAgent: () => 'pool-selected',
    workflowLauncherStatus: (_agent: string) => ({ supported: true, agent: _agent }),
    applyAgentFallback: async () => 'pool-selected',

    createPr: () => ({ ok: true }),
    readToken: () => 'token',
    resolveForgejoUser: (user: string | null) => user ?? 'tester',
    fetchReviewBranch: () => OK,

    resolveTaskFile: () => ({ ok: true, taskFile: '/worktree/backlog/tasks/task-2503.md', task: {} }),
    getTaskImplementer: () => null,
    transitionTask: async () => undefined,

    resolveReviewIdentity: () => ({ forgejoUser: null }),
    readReviewState: () => null,
    writeReviewState: () => undefined,
    persistReviewState: async () => undefined,

    isForgejoReviewEnabled: () => false,

    formatVerificationCommand: () => 'npm test',

    resolveConflictsForMission: () => ({
      ok: true,
      conflictFiles: [SHARED_FILE],
      missionSpecificFiles: [],
      sharedFiles: [SHARED_FILE],
    }),

    missionServices: null,
    exit: (code: number) => { exitCodes.push(code); },
    ...overrides,
  };
  return { port, lines, exitCodes, agentLaunches };
}

/** Run the use case with the workflow's terminal output captured. */
async function run(h: Harness, args: string[] = ['task-2503']): Promise<void> {
  const previous = setLogger({ log: (...parts: unknown[]) => h.lines.push(parts.join(' ')) });
  try {
    await new RebaseCommandUseCase(h.port).execute(args);
  } finally {
    setLogger(previous);
  }
}

test('shared-file rebase recovery dispatches the implementer recorded before commit replay', async () => {
  // Implementer A: what the mission was dispatched with, recorded in the
  // mission's review state (outside the replayed Git history).
  // Implementer B: what the replayed Backlog task file exposes while the stale
  // mission branch is being rebased.
  let replayed = false;
  const h = sharedConflictHarness({
    readReviewState: () => ({ implementer: 'claude', metadata: {} }),
    git: (args: string[]) => {
      const tail = subcommand(args);
      if (tail[0] === 'rebase' && tail[1] === 'main') {
        replayed = true;
        return { status: 1, stdout: '', stderr: `CONFLICT (content): Merge conflict in ${SHARED_FILE}\n` };
      }
      return OK;
    },
    // Metadata changes during the rebase: stale before replay, different again
    // after it. Neither may replace the recorded implementer.
    getTaskImplementer: () => (replayed ? 'vibe' : 'qwen'),
  });

  await run(h);

  assert.equal(h.agentLaunches.length, 1);
  assert.equal(h.agentLaunches[0].step, 'conflict-resolution');
  assert.equal(h.agentLaunches[0].options.agent, 'claude',
    'recovery must dispatch the implementer recorded before commit replay, not the replayed task metadata');
  assert.equal(h.agentLaunches[0].options.role, 'implementer');
  assert.equal(h.agentLaunches[0].options.pinnedAgent, true);
});

test('unavailable local mission metadata is reported as a local workflow condition, not an infrastructure blocker', async () => {
  const h = sharedConflictHarness({
    readReviewState: () => null,
    resolveTaskFile: () => ({ ok: false, error: 'not-found' }),
    getTaskImplementer: () => null,
  });

  await run(h);

  const output = h.lines.join('\n');
  assert.equal(h.agentLaunches.length, 0);
  assert.deepEqual(h.exitCodes, [1]);
  assert.match(output, /No recorded implementer for .*task-2503/);
  assert.match(output, /Set the task assignee to a supported agent family/);
  assert.doesNotMatch(output, /forgejo|network|unreachable|connection refused/i,
    'a missing local mission record must never be attributed to Forgejo or the network');
});
