/**
 * TASK-2294.01 reproduction test.
 *
 * Bug: both conflict entry points (`px resolve-conflict` and the `px rebase`
 * shared-file conflict path) launched the `conflict-resolution` step without
 * pinning the mission's recorded implementer. `startAgent` therefore fell
 * through to pool selection driven by the `conflict-resolution` eligibility
 * list in `config/agents.json`, so conflict work — which is implementation
 * work owned by the mission implementer — could be handed to an unrelated
 * agent family.
 *
 * These assertions fail on the parent commit (no `agent` option is passed on
 * either launch) and pass once the implementer is pinned.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import resolveConflict from '../src/adapters/cli/commands/resolve-conflict.js';
import { setLogger } from '../src/application/presentation/cli-format.js';
import { RebaseCommandUseCase } from '../src/application/rebase-command-use-case.js';
import type { GitCommandResult, RebaseWorkflowPort } from '../src/application/ports/rebase-workflow.js';

const OK: GitCommandResult = { status: 0, stdout: '', stderr: '' };

/** Strip the leading `-C <root>` / `-c <key=value>` globals so index 0 is the subcommand. */
function subcommand(args: string[]): string[] {
  let index = 0;
  while (index + 1 < args.length && (args[index] === '-C' || args[index] === '-c')) { index += 2; }
  return args.slice(index);
}

/** Run a workflow body with terminal output captured instead of printed. */
async function captured(body: () => Promise<void>): Promise<string[]> {
  const lines: string[] = [];
  const previous = setLogger({ log: (...parts: unknown[]) => lines.push(parts.join(' ')) });
  const origLog = console.log;
  const origErr = console.error;
  console.log = (l: unknown) => { lines.push(String(l)); };
  console.error = (l: unknown) => { lines.push(String(l)); };
  try {
    await body();
  } finally {
    console.log = origLog;
    console.error = origErr;
    setLogger(previous);
  }
  return lines;
}

test('TASK-2294.01 repro: px resolve-conflict pins the mission implementer as the conflict agent', async () => {
  const launches: Array<{ step: string; options: Record<string, unknown> }> = [];
  let exitCode: number | null = null;

  await captured(async () => {
    await resolveConflict(['task-2294.01'], {
      rootDir: '/repo',
      resolveTaskFileFn: () => ({ ok: true, taskFile: '/repo/backlog/tasks/task-2294.01.md' }),
      getTaskImplementerFn: () => 'codex',
      resolveConflictsFn: () => ({
        ok: true,
        conflictFiles: ['missions/task-2294.01/CP-1.md'],
        sharedFiles: [],
        missionSpecificFiles: ['missions/task-2294.01/CP-1.md'],
        worktreePath: '/tmp/wt',
      }),
      startAgentFn: async (step: string, options: Record<string, unknown>) => {
        launches.push({ step, options });
        return { agent: options.agent ?? 'pool-selected', result: { status: 0 } };
      },
      exitFn: (code: number) => { exitCode = code; },
    });
  });

  assert.equal(exitCode, 0);
  assert.equal(launches.length, 1);
  assert.equal(launches[0].step, 'conflict-resolution');
  assert.equal(launches[0].options.agent, 'codex',
    'conflict resolution must launch as the mission implementer, not a pool-selected family');
  assert.equal(launches[0].options.slug, 'task-2294.01');
  assert.equal(launches[0].options.role, 'implementer');
});

test('TASK-2294.01 repro: px rebase shared-file conflict path pins the mission implementer', async () => {
  const shared = 'src/adapters/git/git.ts';
  const launches: Array<{ step: string; options: Record<string, unknown> }> = [];
  const exitCodes: number[] = [];
  const state = { pushes: 0 };

  const port: RebaseWorkflowPort = {
    git: (args: string[]) => {
      const tail = subcommand(args);
      if (tail[0] === 'rebase' && tail[1] === 'main') {
        return { status: 1, stdout: '', stderr: `CONFLICT (content): Merge conflict in ${shared}\n` };
      }
      return OK;
    },
    detectRebaseState: () => ({ inProgress: false, unmergedFiles: [] }),
    getCurrentBranch: () => 'mission/task-2294.01',

    cwd: () => '/repo',
    inferSlug: (explicitSlug?: string) => explicitSlug ?? 'task-2294.01',
    findMissionDir: () => '/worktree/missions/task-2294.01',
    findMissionArea: () => 'docs',
    resolveWorktree: () => '/worktree',
    conventionalWorktreePath: () => '/worktrees/task-2294.01',
    missionBranchName: () => 'mission/task-2294.01',
    resolveMissionBaseBranch: () => 'main',
    missionConflictPathPrefix: () => 'missions/task-2294.01/',
    resolvePromptBaseBranch: () => 'main',

    startAgent: async (step: string, options: Record<string, unknown>) => {
      launches.push({ step, options });
      return { agent: String(options.agent ?? 'pool-selected'), result: { status: 0 } };
    },
    selectAgent: () => 'pool-selected',
    workflowLauncherStatus: () => ({ available: true, agent: 'pool-selected' }),
    applyAgentFallback: async () => 'codex',

    createPr: () => { state.pushes += 1; return { ok: true }; },
    readToken: () => 'token',
    resolveForgejoUser: (user: string | null) => user ?? 'tester',
    fetchReviewBranch: () => OK,

    resolveTaskFile: () => ({ ok: true, taskFile: '/worktree/backlog/tasks/task-2294.01.md' }),
    getTaskImplementer: () => 'codex',
    transitionTask: async () => undefined,

    resolveReviewIdentity: () => ({ forgejoUser: 'tester' }),
    readReviewState: () => ({ metadata: {} }),
    writeReviewState: () => undefined,
    persistReviewState: async () => undefined,

    isForgejoReviewEnabled: () => false,

    formatVerificationCommand: () => 'npm test',

    resolveConflictsForMission: () => ({
      ok: true,
      conflictFiles: [shared],
      missionSpecificFiles: [],
      sharedFiles: [shared],
    }),

    missionServices: null,
    exit: (code: number) => { exitCodes.push(code); },
  };

  await captured(async () => {
    await new RebaseCommandUseCase(port).execute(['task-2294.01']);
  });

  assert.deepEqual(exitCodes, [0]);
  assert.equal(launches.length, 1);
  assert.equal(launches[0].step, 'conflict-resolution');
  assert.equal(launches[0].options.agent, 'codex',
    'shared-file conflict resolution must launch as the mission implementer');
  assert.equal(launches[0].options.slug, 'task-2294.01');
  assert.equal(launches[0].options.role, 'implementer');
});
