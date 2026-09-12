/**
 * TASK-2494 reproduction tests.
 *
 * Bug: when a pinned implementer hits an agent usage limit during the `px
 * rebase` shared-file conflict path, `startAgent` records the AgentBlock and
 * refuses a family fallback (pinned work has no fallback), so `rebase-workflow`
 * hard-refused with "Parallix does not substitute another agent family" and the
 * resulting pinned-agent error fell through `classifyError`'s catch-all default
 * to `InfraBlocker`/`HumanOnly` — mislabeling an agent-capacity event as an
 * infra/Forgejo failure.
 *
 * These assertions fail on the parent commit and pass once the rebase-handoff
 * fallback and the ADR 0048 classifier are fixed. All ports are in-memory fakes;
 * no real Git/Forgejo/launcher is touched.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { runRebaseWorkflow } from '../src/application/rebase-workflow.js';
import { classifyError, hasExplicitHumanOnlyDiagnostic, FailureClass, DispatchAction } from '../src/application/failure-classification.js';
import { setLogger } from '../src/application/presentation/cli-format.js';
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

/** A `startAgent` that throws a PinnedAgentUnavailable-style usage-block for the pinned family. */
function usageBlockStartAgent(
  launches: Array<{ step: string; options: Record<string, unknown> }>,
  opts: { replacement?: string | null; onReplacement?: (_options: Record<string, unknown>) => { agent: string } },
): RebaseWorkflowPort['startAgent'] {
  return async (step: string, options: Record<string, unknown>) => {
    launches.push({ step, options });
    const pinned = String(options.agent ?? '');
    if (options.pinnedAgent && pinned && pinned !== opts.replacement) {
      throw new Error(
        `Pinned agent "${pinned}" cannot run this step: usage limit hit; blocked until 2026-09-12 13:00`,
      );
    }
    const replacement = opts.onReplacement?.(options);
    return { agent: replacement?.agent ?? String(options.agent ?? 'pool-selected'), result: { status: 0 } };
  };
}

function makePort(overrides: Partial<RebaseWorkflowPort> & { startAgent: RebaseWorkflowPort['startAgent'] }): RebaseWorkflowPort {
  const shared = 'src/adapters/git/git.ts';
  const base: Omit<RebaseWorkflowPort, 'startAgent'> = {
    git: (args: string[]) => {
      const tail = subcommand(args);
      if (tail[0] === 'rebase' && tail[1] === 'main') {
        return { status: 1, stdout: '', stderr: `CONFLICT (content): Merge conflict in ${shared}\n` };
      }
      return OK;
    },
    detectRebaseState: () => ({ inProgress: false, unmergedFiles: [] }),
    getCurrentBranch: () => 'mission/task-2494',

    cwd: () => '/repo',
    inferSlug: (explicitSlug?: string) => explicitSlug ?? 'task-2494',
    findMissionDir: () => '/worktree/missions/task-2494',
    findMissionArea: () => 'docs',
    resolveWorktree: () => '/worktree',
    conventionalWorktreePath: () => '/worktrees/task-2494',
    missionBranchName: () => 'mission/task-2494',
    resolveMissionBaseBranch: () => 'main',
    missionConflictPathPrefix: () => 'missions/task-2494/',
    resolvePromptBaseBranch: () => 'main',

    selectAgent: () => null,
    workflowLauncherStatus: (_agent: string) => ({ supported: true, agent: _agent }),
    applyAgentFallback: async () => 'codex',

    createPr: () => ({ ok: true }),
    readToken: () => 'token',
    resolveForgejoUser: (user: string | null) => user ?? 'tester',
    fetchReviewBranch: () => OK,

    resolveTaskFile: () => ({ ok: true, taskFile: '/worktree/backlog/tasks/task-2494.md' }),
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
    exit: (_code: number) => undefined,
  };
  return { ...base, ...overrides } as RebaseWorkflowPort;
}

test('TASK-2494 repro: usage-blocked pinned implementer during rebase conflict names the usage block and reset time, never infra/Forgejo', async () => {
  const launches: Array<{ step: string; options: Record<string, unknown> }> = [];
  const exited: number[] = [];
  let output = '';

  const port = makePort({
    startAgent: usageBlockStartAgent(launches, { replacement: null }),
    selectAgent: () => null,
    exit: (code: number) => { exited.push(code); },
  });

  await captured(async () => {
    await runRebaseWorkflow(['task-2494'], port);
  }).then((lines) => { output = lines.join('\n'); });

  // The usage block is named with its reset time...
  assert.match(output, /usage limit/i);
  assert.match(output, /2026-09-12 13:00/);
  // ...and the diagnostic never mislabels it as infra / Forgejo / credential,
  // and never repeats the old hard-refusal phrase.
  const lowered = output.toLowerCase();
  assert.ok(!/forgejo/.test(lowered), 'diagnostic must not mention forgejo');
  assert.ok(!/infrastructure/.test(lowered), 'diagnostic must not mention infrastructure');
  assert.ok(!/credential/.test(lowered), 'diagnostic must not mention credential');
  assert.ok(!/does not substitute/.test(output), 'must not emit the old hard-refusal phrase');
  assert.equal(exited.length, 1);
  assert.ok(exited[0] !== 0);
});

test('TASK-2494 repro: usage-blocked pinned implementer substitutes an eligible replacement family when policy permits', async () => {
  const launches: Array<{ step: string; options: Record<string, unknown> }> = [];
  const exited: number[] = [];
  const selectionCalls: Array<{ step: string; exclude: Set<string> }> = [];

  const port = makePort({
    startAgent: usageBlockStartAgent(launches, {
      replacement: 'mistral',
      onReplacement: () => ({ agent: 'mistral' }),
    }),
    // Honors the production `selectAgent(step, { exclude })` contract: must be
    // invoked with the real workflow step and an exclusion set. Returns the
    // replacement only when it is not the excluded (blocked) implementer.
    selectAgent: (step: string, options: { exclude?: Set<string> } = {}) => {
      selectionCalls.push({ step, exclude: options.exclude ?? new Set() });
      return options.exclude?.has('mistral') ? null : 'mistral';
    },
    workflowLauncherStatus: (_agent: string) => ({ supported: true, agent: _agent }),
    exit: (code: number) => { exited.push(code); },
  });

  await captured(async () => {
    await runRebaseWorkflow(['task-2494'], port);
  });

  // The pinned codex hit a usage limit; the replacement family ran the
  // conflict-resolution step unpinned instead of being refused.
  const replacementLaunch = launches.find((l) => l.options.agent === 'mistral');
  assert.ok(replacementLaunch, 'a replacement-family launch must occur');
  assert.equal(replacementLaunch?.step, 'conflict-resolution');
  assert.equal(replacementLaunch?.options.pinnedAgent, undefined, 'substitution launches unpinned');
  // Contract exercised: selector called with policy key `active` (the
  // config/agents.json key that owns implementation work) and the pinned
  // implementer excluded from eligibility (F1). An unknown key would fall back
  // to every workflow family, bypassing configured eligibility.
  assert.equal(selectionCalls.length, 1);
  assert.equal(selectionCalls[0]?.step, 'active');
  assert.ok(selectionCalls[0]?.exclude.has('codex'), 'blocked implementer must be excluded from selection');
  assert.equal(exited.length, 1);
  assert.equal(exited[0], 0, 'rebase completes cleanly after substitution');
});

test('TASK-2494 repro: selector never returns the excluded pinned implementer', async () => {
  const launches: Array<{ step: string; options: Record<string, unknown> }> = [];
  const selectionCalls: Array<{ step: string; exclude: Set<string> }> = [];

  const port = makePort({
    startAgent: usageBlockStartAgent(launches, { replacement: null }),
    selectAgent: (step: string, options: { exclude?: Set<string> } = {}) => {
      selectionCalls.push({ step, exclude: options.exclude ?? new Set() });
      // Even a selector that would otherwise pick the pinned family must not
      // return it once it is excluded (F1 policy-gated replacement).
      return 'codex';
    },
    workflowLauncherStatus: (_agent: string) => ({ supported: true, agent: _agent }),
    exit: () => undefined,
  });

  await captured(async () => {
    await runRebaseWorkflow(['task-2494'], port);
  });

  assert.equal(selectionCalls[0]?.exclude.has('codex'), true, 'pinned implementer excluded');
  assert.equal(selectionCalls[0]?.step, 'active', 'policy key `active` used, not a fallback key');
});

test('TASK-2494 repro: selector exhaustion emits the reset-time diagnostic, not a throw', async () => {
  const launches: Array<{ step: string; options: Record<string, unknown> }> = [];
  const exited: number[] = [];
  let output = '';

  // No non-pinned family is eligible: the selector throws (pool exhaustion /
  // all blocked). That must be treated as no replacement so the workflow
  // reaches the reset-time diagnostic (F2, SC2) instead of escaping the catch.
  const port = makePort({
    startAgent: usageBlockStartAgent(launches, { replacement: null }),
    selectAgent: () => { throw new Error('No agents are eligible for workflow step: active'); },
    exit: (code: number) => { exited.push(code); },
  });

  await captured(async () => {
    await runRebaseWorkflow(['task-2494'], port);
  }).then((lines) => { output = lines.join('\n'); });

  assert.match(output, /usage limit/i);
  assert.match(output, /2026-09-12 13:00/);
  const lowered = output.toLowerCase();
  assert.ok(!/forgejo/.test(lowered), 'diagnostic must not mention forgejo');
  assert.ok(!/infrastructure/.test(lowered), 'diagnostic must not mention infrastructure');
  assert.equal(exited.length, 1);
  assert.ok(exited[0] !== 0);
});

test('TASK-2494 repro: selector returns a family with no working launcher emits the diagnostic', async () => {
  const launches: Array<{ step: string; options: Record<string, unknown> }> = [];
  const exited: number[] = [];
  let output = '';

  // The selector returns a replacement, but no launcher can run it. That is a
  // no-replacement state: emit the reset-time diagnostic (F2, SC2).
  const port = makePort({
    startAgent: usageBlockStartAgent(launches, { replacement: null }),
    selectAgent: () => 'qwen',
    workflowLauncherStatus: (_agent: string) => ({ supported: false, agent: _agent }),
    exit: (code: number) => { exited.push(code); },
  });

  await captured(async () => {
    await runRebaseWorkflow(['task-2494'], port);
  }).then((lines) => { output = lines.join('\n'); });

  assert.match(output, /usage limit/i);
  assert.match(output, /2026-09-12 13:00/);
  const lowered = output.toLowerCase();
  assert.ok(!/forgejo/.test(lowered), 'diagnostic must not mention forgejo');
  assert.ok(!/infrastructure/.test(lowered), 'diagnostic must not mention infrastructure');
  assert.equal(exited.length, 1);
  assert.ok(exited[0] !== 0);
});

test('TASK-2494 repro: usage-block diagnostic classifies as a non-InfraBlocker, non-HumanOnly class', () => {
  const diagnostic = "you've hit your weekly usage limit (resets 2026-09-12 13:00)";
  const { failureClass, dispatchAction } = classifyError(diagnostic);
  assert.notEqual(failureClass, FailureClass.InfraBlocker);
  assert.notEqual(dispatchAction, DispatchAction.HumanOnly);
  assert.equal(hasExplicitHumanOnlyDiagnostic(diagnostic), false);
});

test('TASK-2494 repro: classifier must not widen the HumanOnly catch-all to generic limit / infra markers', () => {
  // A genuine infra failure that mentions a token/forgejo/network limit is still
  // an infrastructure blocker, not an agent-capacity event.
  const infra = 'Forgejo token expired; network error pushing the review branch';
  const { failureClass, dispatchAction } = classifyError(infra);
  assert.equal(failureClass, FailureClass.InfraBlocker);
  assert.equal(dispatchAction, DispatchAction.HumanOnly);
  assert.equal(hasExplicitHumanOnlyDiagnostic(infra), true);
});

test('TASK-2494 repro: infra marker beats agent-capacity quota marker (F1)', () => {
  // The quota marker must NOT steal a genuine Forgejo/network diagnostic. These
  // name "quota" but carry an explicit infra marker, so they stay InfraBlocker.
  const cases = [
    'Forgejo quota exceeded while creating the review branch',
    'network error: quota exhausted pushing the review branch',
  ];
  for (const message of cases) {
    const { failureClass, dispatchAction } = classifyError(message);
    assert.equal(failureClass, FailureClass.InfraBlocker, `${message} stays InfraBlocker`);
    assert.equal(dispatchAction, DispatchAction.HumanOnly, `${message} stays HumanOnly`);
    assert.equal(hasExplicitHumanOnlyDiagnostic(message), true, `${message} is explicit human-only`);
  }
});

test('TASK-2494 repro: a pure agent usage limit still classifies as AgentCapacity', () => {
  // Sanity: the usage-block rule still fires when no infra marker is present.
  const usage = "you've hit your weekly usage limit (resets 2026-09-12 13:00)";
  const { failureClass, dispatchAction } = classifyError(usage);
  assert.equal(failureClass, FailureClass.AgentCapacity);
  assert.equal(dispatchAction, DispatchAction.AutoRepair);
  assert.equal(hasExplicitHumanOnlyDiagnostic(usage), false);
});

test('TASK-2494 repro: agent-branded rate limits classify as AgentCapacity (F1 round 4)', () => {
  // Agent-branded / provider rate limits follow agent-limit.ts and are
  // agent-capacity, not infrastructure.
  const agents = [
    'Codex rate limit exceeded',
    'Codex rate_limit exceeded',
    'Claude rate limit reached',
    'mistral rate limit exceeded',
    '429 Requests rate limit exceeded',
  ];
  for (const message of agents) {
    const { failureClass, dispatchAction } = classifyError(message);
    assert.equal(failureClass, FailureClass.AgentCapacity, `${message} is AgentCapacity`);
    assert.equal(dispatchAction, DispatchAction.AutoRepair, `${message} is AutoRepair`);
    assert.equal(hasExplicitHumanOnlyDiagnostic(message), false, `${message} is not human-only`);
  }
});

test('TASK-2494 repro: infra-branded rate limit still classifies as InfraBlocker', () => {
  // An infra-branded rate limit (carrying a network/infrastructure marker)
  // stays InfraBlocker even though it mentions a rate limit.
  const infra = 'network error: rate limit exceeded while pushing the review branch';
  const { failureClass, dispatchAction } = classifyError(infra);
  assert.equal(failureClass, FailureClass.InfraBlocker);
  assert.equal(dispatchAction, DispatchAction.HumanOnly);
  assert.equal(hasExplicitHumanOnlyDiagnostic(infra), true);
});
