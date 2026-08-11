import test from 'node:test';
import assert from 'node:assert/strict';
import { setLogger } from '../src/application/presentation/cli-format.js';
import { RebaseCommandUseCase } from '../src/application/rebase-command-use-case.js';
import type { GitCommandResult, RebaseWorkflowPort } from '../src/application/ports/rebase-workflow.js';
import {
  createRebaseCommand,
  createRebaseCommandForUseCase,
  parseRebaseCliRequest,
  renderUnknownRebaseOptions,
} from '../src/interfaces/cli/rebase.js';

const OK: GitCommandResult = { status: 0, stdout: '', stderr: '' };

/** Strip the leading `-C <root>` / `-c <key=value>` globals so index 0 is the subcommand. */
function subcommand(args: string[]): string[] {
  let index = 0;
  while (index + 1 < args.length && (args[index] === '-C' || args[index] === '-c')) { index += 2; }
  return args.slice(index);
}

interface Harness {
  port: RebaseWorkflowPort;
  lines: string[];
  gitCalls: string[][];
  exitCodes: number[];
  agentLaunches: Array<{ step: string; options: Record<string, unknown> }>;
  pushes: number;
}

/**
 * Fully mocked `RebaseWorkflowPort`. Every method is a double, so these tests
 * exercise the application workflow with no real git, Forgejo, agent, backlog,
 * or filesystem access.
 */
function harness(overrides: Partial<RebaseWorkflowPort> = {}): Harness {
  const lines: string[] = [];
  const gitCalls: string[][] = [];
  const exitCodes: number[] = [];
  const agentLaunches: Array<{ step: string; options: Record<string, unknown> }> = [];
  const state = { pushes: 0 };
  const port: RebaseWorkflowPort = {
    git: (args: string[]) => { gitCalls.push(args); return OK; },
    detectRebaseState: () => ({ inProgress: false, unmergedFiles: [] }),
    getCurrentBranch: () => 'mission/task-2332.12',

    cwd: () => '/repo',
    inferSlug: (explicitSlug?: string) => explicitSlug ?? 'task-2332.12',
    findMissionDir: () => '/worktree/missions/task-2332.12',
    findMissionArea: () => 'docs',
    resolveWorktree: () => '/worktree',
    conventionalWorktreePath: () => '/worktrees/task-2332.12',
    missionBranchName: () => 'mission/task-2332.12',
    resolveMissionBaseBranch: () => 'main',
    missionConflictPathPrefix: () => 'missions/task-2332.12/',
    resolvePromptBaseBranch: () => 'main',

    startAgent: async (step: string, options: Record<string, unknown>) => {
      agentLaunches.push({ step, options });
      return { agent: 'test-agent', result: { status: 0 } };
    },
    selectAgent: () => 'test-agent',
    workflowLauncherStatus: () => ({ available: true, agent: 'test-agent' }),
    applyAgentFallback: async () => 'test-agent',

    createPr: () => { state.pushes += 1; return { ok: true }; },
    readToken: () => 'token',
    resolveForgejoUser: (user: string | null) => user ?? 'tester',
    fetchReviewBranch: () => OK,

    resolveTaskFile: () => ({ ok: true, taskFile: '/worktree/backlog/tasks/task-2332.12.md', task: {} }),
    getTaskImplementer: () => 'tester',
    transitionTask: async () => undefined,

    resolveReviewIdentity: () => ({ forgejoUser: 'tester' }),
    readReviewState: () => ({ metadata: {} }),
    writeReviewState: () => undefined,
    persistReviewState: async () => undefined,

    isForgejoReviewEnabled: () => false,

    formatVerificationCommand: () => 'npm test',

    resolveConflictsForMission: () => ({ ok: true, conflictFiles: [], missionSpecificFiles: [], sharedFiles: [] }),

    missionServices: null,
    exit: (code: number) => { exitCodes.push(code); },
    ...overrides,
  };
  return {
    port, lines, gitCalls, exitCodes, agentLaunches,
    get pushes() { return state.pushes; },
  };
}

/** Run the use case with the workflow's terminal output captured. */
async function run(h: Harness, args: string[] = ['task-2332.12']): Promise<void> {
  const previous = setLogger({ log: (...parts: unknown[]) => h.lines.push(parts.join(' ')) });
  try {
    await new RebaseCommandUseCase(h.port).execute(args);
  } finally {
    setLogger(previous);
  }
}

test('rebase use case completes a clean rebase through mocked ports', async () => {
  const h = harness();
  await run(h);
  assert.deepEqual(h.exitCodes, [0]);
  assert.match(h.lines.join('\n'), /Rebase completed cleanly/);
  assert.ok(h.gitCalls.some(args => subcommand(args)[0] === 'merge-base' && subcommand(args)[1] === '--is-ancestor'),
    'the clean path must verify the local base ancestry postcondition');
});

test('rebase use case auto-resolves mission-specific conflicts with --theirs', async () => {
  const conflicted = 'missions/task-2332.12/CP-1.md';
  const gitCalls: string[][] = [];
  const h = harness({
    git: (args: string[]) => {
      gitCalls.push(args);
      const tail = subcommand(args);
      if (tail[0] === 'rebase' && tail[1] === 'main') {
        return { status: 1, stdout: '', stderr: `CONFLICT (content): Merge conflict in ${conflicted}\n` };
      }
      return OK;
    },
    resolveConflictsForMission: () => ({
      ok: true,
      conflictFiles: [conflicted],
      missionSpecificFiles: [conflicted],
      sharedFiles: [],
    }),
  });
  await run(h);
  assert.deepEqual(h.exitCodes, [0]);
  assert.ok(gitCalls.some(args => subcommand(args).join(' ') === `checkout --theirs ${conflicted}`),
    'mission-owned conflicts must be resolved with --theirs');
  assert.match(h.lines.join('\n'), /Mission-specific conflicts resolved/);
});

test('rebase use case launches an agent for shared-file conflicts', async () => {
  const shared = 'src/adapters/git/git.ts';
  const h = harness({
    git: (args: string[]) => {
      const tail = subcommand(args);
      if (tail[0] === 'rebase' && tail[1] === 'main') {
        return { status: 1, stdout: '', stderr: `CONFLICT (content): Merge conflict in ${shared}\n` };
      }
      return OK;
    },
    resolveConflictsForMission: () => ({
      ok: true,
      conflictFiles: [shared],
      missionSpecificFiles: [],
      sharedFiles: [shared],
    }),
  });
  await run(h);
  assert.deepEqual(h.exitCodes, [0]);
  assert.equal(h.agentLaunches.length, 1);
  assert.equal(h.agentLaunches[0].step, 'conflict-resolution');
  assert.match(String(h.agentLaunches[0].options.prompt), new RegExp(shared.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(h.lines.join('\n'), /completed conflict resolution/);
});

/** Harness variant whose shared-file conflict forces the agent-assisted path. */
function sharedConflictHarness(shared: string, overrides: Partial<RebaseWorkflowPort> = {}): Harness {
  return harness({
    git: (args: string[]) => {
      const tail = subcommand(args);
      if (tail[0] === 'rebase' && tail[1] === 'main') {
        return { status: 1, stdout: '', stderr: `CONFLICT (content): Merge conflict in ${shared}\n` };
      }
      return OK;
    },
    resolveConflictsForMission: () => ({
      ok: true,
      conflictFiles: [shared],
      missionSpecificFiles: [],
      sharedFiles: [shared],
    }),
    ...overrides,
  });
}

test('rebase use case pins the recorded mission implementer for shared-file conflicts', async () => {
  const shared = 'src/adapters/git/git.ts';
  const h = sharedConflictHarness(shared, {
    getTaskImplementer: () => 'vibe',
    selectAgent: () => 'pool-selected',
  });
  await run(h);

  assert.deepEqual(h.exitCodes, [0]);
  assert.equal(h.agentLaunches.length, 1);
  // SC2: the conflict launch carries the implementer, not a pool selection.
  assert.equal(h.agentLaunches[0].options.agent, 'vibe');
  // SC7: usage stays attributable to (conflict-resolution stage, implementer role).
  assert.equal(h.agentLaunches[0].options.slug, 'task-2332.12');
  assert.equal(h.agentLaunches[0].options.role, 'implementer');
  // AC #3: no substitute family may be selected after a failure.
  assert.equal(h.agentLaunches[0].options.pinnedAgent, true);
});

test('rebase use case exits non-zero when the pinned implementer launcher is unavailable', async () => {
  const shared = 'src/adapters/git/git.ts';
  const h = sharedConflictHarness(shared, {
    getTaskImplementer: () => 'vibe',
    startAgent: async () => {
      throw Object.assign(
        new Error('Pinned agent "vibe" cannot run this step: Agent "vibe" launcher is not available'),
        { code: 'PINNED_AGENT_UNAVAILABLE' },
      );
    },
  });
  await run(h);

  // SC5: names the implementer family and leaves a recoverable git state.
  assert.deepEqual(h.exitCodes, [1]);
  const output = h.lines.join('\n');
  assert.match(output, /vibe/);
  assert.match(output, /does not substitute another agent family/i);
  assert.match(output, /git rebase --abort/);
});

test('rebase use case exits non-zero when the mission has no recorded implementer', async () => {
  const shared = 'src/adapters/git/git.ts';
  const h = sharedConflictHarness(shared, {
    resolveTaskFile: () => ({ ok: false }),
    getTaskImplementer: () => null,
  });
  await run(h);

  assert.deepEqual(h.exitCodes, [1]);
  assert.equal(h.agentLaunches.length, 0, 'no agent may be launched without a recorded implementer');
  assert.match(h.lines.join('\n'), /no recorded implementer/i);
});

test('rebase use case passes any configured implementer family through unchanged', async () => {
  const shared = 'src/adapters/git/git.ts';
  for (const family of ['claude', 'codex', 'custom', 'vibe', 'future-family']) {
    const h = sharedConflictHarness(shared, { getTaskImplementer: () => family });
    await run(h);
    // AC #4: the conflict path adds no built-in family names.
    assert.equal(h.agentLaunches[0].options.agent, family);
  }
});

test('rebase use case auto-bounces a hook failure and retries the rebase', async () => {
  const bounces: Array<{ hookType: string | null; missionStore: unknown }> = [];
  let continues = 0;
  const h = harness({
    git: (args: string[]) => {
      const tail = subcommand(args);
      if (tail[0] === 'rebase' && tail[1] === 'main') {
        return { status: 1, stdout: '', stderr: 'error: pre-commit hook failed' };
      }
      if (tail[0] === 'rebase' && tail[1] === '--continue') {
        continues += 1;
        return OK;
      }
      return OK;
    },
    missionServices: async () => ({ store: { id: 'store' } }),
    handleHookFailureAutoBounce: async (_slug, _worktree, _output, classification, options) => {
      bounces.push({ hookType: classification.hookType, missionStore: options.missionStore });
      return true;
    },
  });
  await run(h);
  assert.equal(bounces.length, 1);
  assert.equal(bounces[0].hookType, 'pre-commit');
  assert.deepEqual(bounces[0].missionStore, { id: 'store' });
  assert.equal(continues, 1);
  assert.deepEqual(h.exitCodes, [0]);
  assert.match(h.lines.join('\n'), /Rebase completed after hook fix/);
});

test('rebase use case rejects a selected root that is not on the mission branch', async () => {
  const gitCalls: string[][] = [];
  const h = harness({
    getCurrentBranch: () => 'main',
    git: (args: string[]) => { gitCalls.push(args); return OK; },
  });
  await run(h);
  assert.deepEqual(h.exitCodes, [1]);
  assert.match(h.lines.join('\n'), /Expected branch mission\/task-2332\.12, found main/);
  assert.ok(!gitCalls.some(args => subcommand(args)[0] === 'rebase'),
    'a wrong-branch invocation must not start a rebase');
});

test('rebase CLI interface parses the positional slug and --push without adapter state', () => {
  assert.deepEqual(parseRebaseCliRequest(['task-2332.12', '--push']),
    { explicitSlug: 'task-2332.12', push: true, unknownFlags: [] });
  assert.deepEqual(parseRebaseCliRequest([]),
    { explicitSlug: undefined, push: false, unknownFlags: [] });
  assert.deepEqual(renderUnknownRebaseOptions(parseRebaseCliRequest(['--bogus'])),
    'Ignoring unrecognized rebase option(s): --bogus. Usage: px rebase [<slug>] [--push]');
});

test('rebase CLI interface delegates the unchanged argv to its application use case', async () => {
  const seen: string[][] = [];
  const h = harness();
  const command = createRebaseCommandForUseCase(
    new RebaseCommandUseCase({ ...h.port, inferSlug: (slug?: string) => { seen.push([slug ?? '']); return slug ?? 'task-2332.12'; } }),
  );
  const previous = setLogger({ log: () => {} });
  try {
    await command(['task-2332.12', '--push'], { exitFn: () => {} });
  } finally {
    setLogger(previous);
  }
  assert.deepEqual(seen, [['task-2332.12']]);
});

test('rebase CLI interface maps the workflow exit code onto the command result', async () => {
  const command = createRebaseCommand((_args, options) => {
    (options.exitFn as (_code: number) => void)(1);
  });
  const previous = setLogger({ log: () => {} });
  try {
    assert.equal(await command(['task-2332.12'], { exitFn: () => {} }), 1);
  } finally {
    setLogger(previous);
  }
});
