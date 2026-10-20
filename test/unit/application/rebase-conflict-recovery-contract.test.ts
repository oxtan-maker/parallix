import { agentFamily } from '../../../src/domain/agents.js';
import { transitionRebaseRepair } from '../../../src/application/rebase-repair-lifecycle.js';
import type { StartAgentOptions } from '../../../src/adapters/agents/agent-launch-context.js';
import { fixtureMission, inMemoryTransitionStore } from '../../fixtures/mission-builders.js';
import { startReview, changeRevision, ConfiguredReviewerEligibility, applyReviewerCommand, applyImplementerCommand, reviewFindingId } from '../../../src/domain/review.js';
import { MissionLifecycleService } from '../../../src/application/mission-lifecycle-service.js';
import { rebaseWorkflowFixture } from '../../helpers/rebase-workflow-fixture.js';
import { rebaseHookRecoveryEligible, replacementImplementer, preContinueAction, postContinueAction, continueBudgetExceeded } from '../../../src/domain/rebase-policy.js';
// Historical regression provenance: TASK-2294.01, TASK-2503, TASK-2506, TASK-2494.
// Behavior-owned suite (TASK-2622.09): `px rebase`/`px resolve-conflict` conflict recovery over injected
// workflow ports — pinned implementer dispatch (task-2294.01, task-2503), usage-blocked implementer
// handling (task-2494), and integration rebase prediction (task-2506). Legacy case names unchanged.
import test, { describe } from 'node:test';
import { prepareRepairPrompt } from '../../../src/application/rebound-checkpoints.js';
import assert from 'node:assert/strict';
import resolveConflict from '../../../src/adapters/cli/commands/resolve-conflict.js';
import { setLogger } from '../../../src/application/presentation/cli-format.js';
import { RebaseCommandUseCase } from '../../../src/application/rebase-command-use-case.js';
import type { GitCommandResult, RebaseWorkflowPort } from '../../../src/application/ports/rebase-workflow.js';
import { predictIntegrationRebase } from '../../../src/adapters/cli/commands/integrate.js';
import { runRebaseWorkflow } from '../../../src/application/rebase-workflow.js';
import { classifyError, hasExplicitHumanOnlyDiagnostic, FailureClass, DispatchAction } from '../../../src/application/failure-classification.js';
// ---- task-2294.01 pinned conflict agent (consolidated from test/task-2294.01-repro.test.ts, TASK-2622.09) ----
describe("pinned conflict agent", () => {
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
    const launches: Array<{ step: string; options: StartAgentOptions }> = [];
    let exitCode: { value: number | null } = { value: null };
    await captured(async () => {
      await resolveConflict(['task-2294.01'], {
        rootDir: '/repo',
        resolveTaskFileFn: () => ({ matches: ['/repo/backlog/tasks/task-2294.01.md'],  ok: true as const, taskFile: '/repo/backlog/tasks/task-2294.01.md' }),
        getTaskImplementerFn: () => 'codex',
        resolveConflictsFn: () => ({
          ok: true as const,
          conflictFiles: ['missions/task-2294.01/CP-1.md'],
          sharedFiles: [],
          missionSpecificFiles: ['missions/task-2294.01/CP-1.md'],
          worktreePath: '/tmp/wt',
        }),
        startAgentFn: async (step, options = { prompt: '' }) => {
          launches.push({ step, options });
          return { agent: options.agent ?? 'pool-selected', result: { status: 0 } };
        },
        exitFn: (code: number) => { exitCode.value = code; },
      });
    });
    assert.equal(exitCode.value, 0);
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
    const port: RebaseWorkflowPort = rebaseWorkflowFixture({
      git: (args: string[]) => {
        const tail = subcommand(args);
        if (tail[0] === 'rebase' && tail[1] === 'main') {
          return { signal: null,  status: 1, stdout: '', stderr: `CONFLICT (content): Merge conflict in ${shared}\n` };
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
      workflowLauncherStatus: (_agent: string) => ({ supported: true, agent: 'pool-selected' }),
      applyAgentFallback: async () => 'codex',
      createPr: () => { state.pushes += 1; return { ok: true as const }; },
      readToken: () => 'token',
      resolveForgejoUser: (user: string | null) => user ?? 'tester',
      fetchReviewBranch: () => OK,
      resolveTaskFile: () => ({ ok: true as const, taskFile: '/worktree/backlog/tasks/task-2294.01.md' }),
      getTaskImplementer: () => 'codex',
      transitionTask: async () => undefined,
      resolveReviewIdentity: () => ({ forgejoUser: 'tester' }),
      readReviewState: async () => ({ metadata: {} }),
      writeReviewState: async () => ({ outcome: 'committed' as const }),
      persistReviewState: async () => ({ outcome: 'committed' as const }),
      isForgejoReviewEnabled: () => false,
      formatVerificationCommand: () => 'npm test',
      resolveConflictsForMission: () => ({
        ok: true as const,
        conflictFiles: [shared],
        missionSpecificFiles: [],
        sharedFiles: [shared],
      }),
      missionServices: null,
      exit: (code: number) => { exitCodes.push(code); },
    });
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
});
// ---- task-2503 recorded implementer dispatch (consolidated from test/task-2503-repro.test.ts, TASK-2622.09) ----
describe("recorded implementer dispatch", () => {
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
  function sharedConflictHarness(overrides: Partial<RebaseWorkflowPort> = {}): Harness {
    const lines: string[] = [];
    const exitCodes: number[] = [];
    const agentLaunches: Array<{ step: string; options: Record<string, unknown> }> = [];
    const port: RebaseWorkflowPort = rebaseWorkflowFixture({
      git: (args: string[]) => {
        const tail = subcommand(args);
        if (tail[0] === 'rebase' && tail[1] === 'main') {
          return { signal: null,  status: 1, stdout: '', stderr: `CONFLICT (content): Merge conflict in ${SHARED_FILE}\n` };
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
      createPr: () => ({ ok: true as const }),
      readToken: () => 'token',
      resolveForgejoUser: (user: string | null) => user ?? 'tester',
      fetchReviewBranch: () => OK,
      resolveTaskFile: () => ({ ok: true as const, taskFile: '/worktree/backlog/tasks/task-2503.md', task: {} }),
      getTaskImplementer: () => null,
      transitionTask: async () => undefined,
      resolveReviewIdentity: () => ({ forgejoUser: null }),
      readReviewState: async () => null,
      writeReviewState: async () => ({ outcome: 'committed' as const }),
      persistReviewState: async () => ({ outcome: 'committed' as const }),
      isForgejoReviewEnabled: () => false,
      formatVerificationCommand: () => 'npm test',
      resolveConflictsForMission: () => ({
        ok: true as const,
        conflictFiles: [SHARED_FILE],
        missionSpecificFiles: [],
        sharedFiles: [SHARED_FILE],
      }),
      missionServices: null,
      exit: (code: number) => { exitCodes.push(code); },
      ...overrides,
    });
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
  test('database-only pre-review Mission launches codex and recovers a shared conflict (TASK-2778)', async () => {
    const store = inMemoryTransitionStore(fixtureMission('task-2503', {
      assignee: agentFamily('codex'), review: null,
    }));
    const h = sharedConflictHarness({
      missionServices: async () => ({ store }),
      findMissionDir: () => null,
      readReviewState: async () => null,
      resolveTaskFile: () => ({ ok: false }),
      getTaskImplementer: () => assert.fail('no legacy identity exists'),
    });
    await run(h);
    assert.equal(h.agentLaunches.length, 1, h.lines.join('\n'));
    assert.equal(h.agentLaunches[0].options.agent, 'codex');
    assert.equal(h.agentLaunches[0].options.role, 'implementer');
    assert.deepEqual(h.exitCodes, [0], h.lines.join('\n'));
  });
  for (const family of ['codex', 'claude', 'custom']) {
    test(`database assignee ${family} overrides stale identity (TASK-2778)`, async () => {
      const store = inMemoryTransitionStore(fixtureMission('task-2503', { assignee: agentFamily(family) }));
      const h = sharedConflictHarness({ missionServices: async () => ({ store }),
        readReviewState: async () => assert.fail('review is not the identity authority'),
        resolveTaskFile: () => assert.fail('legacy file is not the identity authority') });
      await run(h);
      assert.equal(h.agentLaunches[0].options.agent, family);
      assert.deepEqual(h.exitCodes, [0]);
    });
  }
  test('missing database identity cannot use stale files (TASK-2778)', async () => {
    const store = inMemoryTransitionStore(fixtureMission('task-2503'));
    const h = sharedConflictHarness({ missionServices: async () => ({ store }),
      getTaskImplementer: () => 'claude' });
    await run(h);
    assert.equal(h.agentLaunches.length, 0);
    assert.deepEqual(h.exitCodes, [1]);
  });
  for (const failure of ['unavailable', 'throw'] as const) {
    test(`database read ${failure} stops before replay (TASK-2778)`, async () => {
      const store = inMemoryTransitionStore(fixtureMission('task-2503'));
      const h = sharedConflictHarness({ missionServices: async () => ({ store: { ...store,
        load: async () => { if (failure === 'throw') { throw new Error('database offline'); }
          return { kind: 'unavailable', reason: 'database offline' }; } } }),
        git: () => assert.fail('must not start replay'), getTaskImplementer: () => 'claude' });
      await assert.rejects(run(h), /database offline/);
      assert.equal(h.agentLaunches.length, 0);
    });
  }
  test('composed null store fails before replay or stale-agent launch (TASK-2778 F3)', async () => {
    const h = sharedConflictHarness({ missionServices: async () => ({ store: null }),
      git: () => assert.fail('must not start replay'), getTaskImplementer: () => 'claude' });
    await assert.rejects(run(h), /Mission persistence is unavailable/);
    assert.equal(h.agentLaunches.length, 0);
  });
  test('actual rebase fallback updates Mission/review identity and push credentials (TASK-2778 F1)', async () => {
    const review = startReview({ change: { kind: 'local-branch', sourceBranch: 'mission/task-2503', targetBranch: 'main' }, revision: changeRevision('head') },
      agentFamily('claude'), agentFamily('codex'), '2026-10-19T10:00:00Z',
      ConfiguredReviewerEligibility.fromReviewStep({ eligible: [agentFamily('claude')], strategy: 'random' }));
    const changed = applyReviewerCommand(review, { type: 'request-changes', decidedAt: '2026-10-19T10:01:00Z', comment: null, findings: [{ id: reviewFindingId('F1'), summary: 'fix shared file', location: null }] });
    const resolved = applyImplementerCommand(changed, { type: 'submit-resolution', respondedAt: '2026-10-19T10:02:00Z', resultingRevision: changeRevision('old-fix'), resolutions: [{ findingId: reviewFindingId('F1'), kind: 'fixed', evidence: 'old agent evidence' }] });
    const store = inMemoryTransitionStore(fixtureMission('task-2503', { assignee: agentFamily('codex'), review: resolved }));
    const published: string[] = [];
    const h = sharedConflictHarness({ missionServices: async () => ({ store, lifecycle: new MissionLifecycleService(store) }),
      startAgent: async () => ({ agent: 'custom', result: { status: 0 } }),
      isForgejoReviewEnabled: () => true, resolveReviewIdentity: () => ({ forgejoUser: 'claude' }),
      readToken: user => `${user}-token`, createPr: (_branch, user, token) => { published.push(`${user}:${token}`); return { ok: true }; },
    });
    await run(h, ['task-2503', '--push']);
    assert.deepEqual(h.exitCodes, [0], h.lines.join('\n'));
    assert.equal(store.mission().assignee, 'custom');
    assert.equal(store.mission().review!.rounds.at(-1)!.implementer, 'custom');
    assert.equal(store.mission().review!.rounds.at(-1)!.reviewer, 'claude');
    assert.equal(store.mission().review!.rounds.at(-1)!.response, null, 'a replacement cannot inherit another implementer resolution');
    assert.equal(store.mission().review!.rounds.at(-1)!.decision?.kind, 'changes-requested');
    assert.deepEqual(published, ['custom:custom-token']);
  });
  for (const failure of ['active', 'unmerged', 'wrong-branch', 'valid'] as const) {
    test(`rebounces unfinished agent checkout with stable exact target (${failure}, TASK-2728)`, async () => {
      let launches = 0;
      let branch = 'mission/task-2503';
      let active = false;
      let files: string[] = [];
      let targetReads = 0;
      const prompts: string[] = [];
      const h = sharedConflictHarness({
        readReviewState: async () => ({ implementer: 'codex' }),
        missionBranchName: () => { targetReads++; return targetReads === 1 ? 'mission/task-2503' : 'changed-target'; },
        getCurrentBranch: () => branch,
        detectRebaseState: () => ({ inProgress: active, unmergedFiles: files }),
        startAgent: async (_step, options) => {
          prompts.push(typeof options.prompt === 'function' ? options.prompt('codex') : String(options.prompt));
          launches++;
          active = launches === 1 && failure === 'active';
          files = launches === 1 && failure === 'unmerged' ? ['src/shared.ts'] : [];
          branch = launches === 1 && failure === 'wrong-branch' ? 'main' : 'mission/task-2503';
          return { agent: 'codex', result: { status: 0 } };
        },
      });
      await run(h);
      assert.deepEqual(h.exitCodes, [0], h.lines.join('\n'));
      assert.equal(launches, failure === 'valid' ? 1 : 2);
      assert.equal(targetReads, 1);
      if (failure !== 'valid') { assert.equal(prompts[1], 'complete the rebase, ensuring the checkout ends at mission/task-2503'); }
    });
  }
  test('exhausted completion recovery blocks push and advancement with one budget (TASK-2728)', async () => {
    let launches = 0;
    let pushes = 0;
    let resumes = 0;
    let branch = 'mission/task-2503';
    const prompts: string[] = [];
    const h = sharedConflictHarness({
      readReviewState: async () => ({ implementer: 'codex' }),
      getCurrentBranch: () => branch,
      startAgent: async (_step, options) => {
        launches++;
        prompts.push(typeof options.prompt === 'function' ? options.prompt('codex') : String(options.prompt));
        branch = 'main';
        return { agent: 'codex', result: { status: 0 } };
      },
      isForgejoReviewEnabled: () => true,
      createPr: () => { pushes++; return { ok: true as const }; },
      resumeReviewAfterRepair: async () => { resumes++; },
    });
    await run(h, ['task-2503', '--push']);
    assert.equal(launches, 3, 'initial resolver plus the existing two repair attempts');
    assert.deepEqual(prompts.slice(1), Array(2).fill('complete the rebase, ensuring the checkout ends at mission/task-2503'));
    assert.deepEqual(h.exitCodes, [1]);
    assert.equal(pushes, 0);
    assert.equal(resumes, 0);
    assert.match(h.lines.join('\n'), /Expected checkout mission\/task-2503, found main/);
    assert.match(h.lines.join('\n'), /git rebase --continue/);
  });
  test('Git completion prompt needs no code-repair checkpoint (TASK-2728)', async () => {
    const reason = { kind: 'artifact-incomplete', role: 'implementer', diagnostic: 'Rebase is still in progress.' } as const;
    const prepared = await prepareRepairPrompt({ occurrenceId: 'git-completion', reason, originalReason: reason,
      classification: { failureClass: FailureClass.IncompleteEvidence, dispatchAction: DispatchAction.AutoSendBack,
        isRelaunchable: true, label: 'INCOMPLETE ARTIFACTS' }, diagnostic: reason.diagnostic, originalDiagnostic: reason.diagnostic },
    { slug: 'task-2503', worktree: '/worktree', implementer: 'codex', verify: () => ({ ok: true as const }),
      startAgent: async () => null, repairPrompt: 'complete the rebase, ensuring the checkout ends at mission/task-2503',
      repairCheckpoints: { open: async () => { throw new Error('must not create code-repair evidence for Git completion'); },
        readBlocker: async () => undefined, verify: async () => undefined } }, 1, 2);
    assert.equal(prepared.fixPrompt, 'complete the rebase, ensuring the checkout ends at mission/task-2503');
    assert.equal(prepared.repairCheckpoint, null);
  });
  test('verifies active repaired rebase without APPROVED review (TASK-2673)', async () => {
    let repositoryChecks = 0;
    let integrationChecks = 0;
    const h = sharedConflictHarness({
      readReviewState: async () => ({ implementer: 'codex', status: 'active', metadata: {} }),
      startAgent: async (_step, options) => {
        const prompt = String(options.prompt);
        assert.match(prompt, /npm test/);
        repositoryChecks += 1; // Injected repository verifier succeeds on the repaired tree.
        if (/px integrate .*--dry-run/.test(prompt)) {
          integrationChecks += 1;
          return { agent: 'codex', result: { status: 1 } }; // Active, unapproved mission.
        }
        return { agent: 'codex', result: { status: 0 } };
      },
    });
    await run(h);
    assert.equal(repositoryChecks, 1);
    assert.equal(integrationChecks, 0, 'repair verification must not require integration eligibility');
    assert.deepEqual(h.exitCodes, [0]);
  });
  test('failed repository verification prevents repair completion and push (TASK-2673)', async () => {
    let pushes = 0;
    let resumes = 0;
    const h = sharedConflictHarness({
      readReviewState: async () => ({ implementer: 'codex', status: 'active' }),
      startAgent: async (_step, options) => {
        assert.match(String(options.prompt), /do not report completion until it passes/);
        return { agent: 'codex', result: { status: 1 } };
      },
      isForgejoReviewEnabled: () => true,
      createPr: () => { pushes += 1; return { ok: true as const }; },
      resumeReviewAfterRepair: async () => { resumes += 1; },
    });
    await run(h, ['task-2503', '--push']);
    assert.deepEqual(h.exitCodes, [1]);
    assert.equal(pushes, 0);
    assert.equal(resumes, 0);
    assert.doesNotMatch(h.lines.join('\n'), /completed conflict resolution/);
  });
  test('unfinished Git rebase prevents repair completion and push (TASK-2673)', async () => {
    let launched = false;
    let pushes = 0;
    let resumes = 0;
    const h = sharedConflictHarness({
      readReviewState: async () => ({ implementer: 'codex', status: 'active' }),
      startAgent: async () => {
        launched = true;
        return { agent: 'codex', result: { status: 0 } };
      },
      detectRebaseState: () => ({ inProgress: launched, unmergedFiles: [] }),
      isForgejoReviewEnabled: () => true,
      createPr: () => { pushes += 1; return { ok: true as const }; },
      resumeReviewAfterRepair: async () => { resumes += 1; },
    });
    await run(h, ['task-2503', '--push']);
    assert.deepEqual(h.exitCodes, [1]);
    assert.equal(pushes, 0);
    assert.equal(resumes, 0);
    assert.doesNotMatch(h.lines.join('\n'), /completed conflict resolution/);
  });
  for (const remaining of [
    { name: 'an active rebase', inProgress: true, unmergedFiles: [] },
    { name: 'unmerged files', inProgress: false, unmergedFiles: [SHARED_FILE] },
  ]) {
    test(`successful Git command with ${remaining.name} cannot finalize or publish repair (TASK-2673)`, async () => {
      let rebased = false;
      let pushes = 0;
      let branchMoves = 0;
      let resumes = 0;
      const h = sharedConflictHarness({
        git: (args) => {
          const tail = subcommand(args);
          if (tail[0] === 'rebase' && tail[1] === 'main') { rebased = true; }
          return OK;
        },
        detectRebaseState: () => rebased ? remaining : { inProgress: false, unmergedFiles: [] },
        isForgejoReviewEnabled: () => true,
        createPr: () => { pushes += 1; return { ok: true as const }; },
        recordBranchMove: async () => { branchMoves += 1; return null; },
        resumeReviewAfterRepair: async () => { resumes += 1; },
      });
      await run(h, ['task-2503', '--push']);
      assert.equal(rebased, true);
      assert.deepEqual(h.exitCodes, [1]);
      assert.equal(pushes, 0);
      assert.equal(branchMoves, 0);
      assert.equal(resumes, 0);
      assert.equal(h.agentLaunches.length, 0);
      assert.match(h.lines.join('\n'), /Rebase is unfinished\. Skipping automatic push/);
      assert.doesNotMatch(h.lines.join('\n'), /Rebase completed cleanly/);
    });
  }
  test('shared-file rebase recovery dispatches the implementer recorded before commit replay', async () => {
    let replayed = false;
    const h = sharedConflictHarness({
      readReviewState: async () => ({ implementer: 'claude', metadata: {} }),
      git: (args: string[]) => {
        const tail = subcommand(args);
        if (tail[0] === 'rebase' && tail[1] === 'main') {
          replayed = true;
          return { signal: null,  status: 1, stdout: '', stderr: `CONFLICT (content): Merge conflict in ${SHARED_FILE}\n` };
        }
        return OK;
      },
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
      readReviewState: async () => null,
      resolveTaskFile: () => ({ ok: false as const, error: 'not-found' }),
      getTaskImplementer: () => null,
    });
    await run(h);
    const output = h.lines.join('\n');
    assert.equal(h.agentLaunches.length, 0);
    assert.deepEqual(h.exitCodes, [1]);
    assert.match(output, /No recorded implementer for .*task-2503/);
    assert.match(output, /Assign the Mission to a configured agent/);
    assert.doesNotMatch(output, /forgejo|network|unreachable|connection refused/i,
      'a missing local mission record must never be attributed to Forgejo or the network');
  });
});
// ---- task-2506 dry-run rebase prediction (consolidated from test/task-2506-dry-run-rebase.test.ts, TASK-2622.09) ----
describe("dry-run rebase prediction", () => {
  // TASK-2506: `px integrate --dry-run` must report whether a rebase is needed
  const SLUG = 'task-2506-dry';
  const BRANCH = `mission/${SLUG}`;
  const ROOT = '/tmp/base';
  interface Case {
    name: string;
    missionSha: string;
    baseSha: string;
    mergeBase: string;
    mergeTreeStatus: number;
    expected: { needed: boolean, wouldConflict: boolean };
  }
  const CASES: Case[] = [
    {
      name: 'no rebase when the primary branch is already an ancestor of the mission',
      missionSha: 'mission', baseSha: 'base', mergeBase: 'base', mergeTreeStatus: 0,
      expected: { needed: false, wouldConflict: false },
    },
    {
      name: 'clean rebase when the primary advanced on an unrelated change',
      missionSha: 'mission', baseSha: 'main-advanced', mergeBase: 'base', mergeTreeStatus: 0,
      expected: { needed: true, wouldConflict: false },
    },
    {
      name: 'conflict when the primary advanced and the virtual merge conflicts',
      missionSha: 'mission', baseSha: 'main-advanced', mergeBase: 'base', mergeTreeStatus: 1,
      expected: { needed: true, wouldConflict: true },
    },
  ];
  function makeGit(c: Case) {
    return (_args: string[]) => {
      const joined = _args.join(' ');
      if (joined.includes('rev-parse') && joined.includes(BRANCH)) { return { status: 0, stdout: c.missionSha, stderr: '' }; }
      if (joined.includes('rev-parse')) { return { status: 0, stdout: c.baseSha, stderr: '' }; }
      if (joined.includes('merge-base')) { return { status: 0, stdout: c.mergeBase, stderr: '' }; }
      if (joined.includes('merge-tree')) { return { status: c.mergeTreeStatus, stdout: '', stderr: '' }; }
      return { status: 0, stdout: '', stderr: '' };
    };
  }
  for (const c of CASES) {
    test(`predicts ${JSON.stringify(c.expected)} — ${c.name}`, () => {
      const prediction = predictIntegrationRebase(SLUG, {
        baseWorktree: ROOT,
        baseBranch: 'main',
        git: makeGit(c),
      });
      assert.deepEqual(prediction, c.expected);
    });
  }
  test('predictIntegrationRebase falls back to main when no base branch is resolved', () => {
    const prediction = predictIntegrationRebase(SLUG, {
      baseWorktree: ROOT,
      baseBranch: '',
      git: makeGit(CASES[1] as Case),
    });
    assert.deepEqual(prediction, { needed: true, wouldConflict: false });
  });
});
// ---- task-2494 usage-blocked implementer (consolidated from test/task-2494-repro.test.ts, TASK-2622.09) ----
describe("usage-blocked implementer", () => {
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
          return { signal: null,  status: 1, stdout: '', stderr: `CONFLICT (content): Merge conflict in ${shared}\n` };
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
      createPr: () => ({ ok: true as const }),
      readToken: () => 'token',
      resolveForgejoUser: (user: string | null) => user ?? 'tester',
      fetchReviewBranch: () => OK,
      resolveTaskFile: () => ({ ok: true as const, taskFile: '/worktree/backlog/tasks/task-2494.md' }),
      getTaskImplementer: () => 'codex',
      transitionTask: async () => undefined,
      resolveReviewIdentity: () => ({ forgejoUser: 'tester' }),
      readReviewState: async () => ({ metadata: {} }),
      writeReviewState: async () => ({ outcome: 'committed' as const }),
      persistReviewState: async () => ({ outcome: 'committed' as const }),
      isForgejoReviewEnabled: () => false,
      formatVerificationCommand: () => 'npm test',
      resolveConflictsForMission: () => ({
        ok: true as const,
        conflictFiles: [shared],
        missionSpecificFiles: [],
        sharedFiles: [shared],
      }),
      missionServices: null,
      exit: (_code: number) => undefined,
    };
    return rebaseWorkflowFixture({ ...base, ...overrides }) as RebaseWorkflowPort;
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
    assert.match(output, /usage limit/i);
    assert.match(output, /2026-09-12 13:00/);
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
    const replacementLaunch = launches.find((l) => l.options.agent === 'mistral');
    assert.ok(replacementLaunch, 'a replacement-family launch must occur');
    assert.equal(replacementLaunch?.step, 'conflict-resolution');
    assert.equal(replacementLaunch?.options.pinnedAgent, undefined, 'substitution launches unpinned');
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
});
// ---- successive normal conflict stops (TASK-2668.02 / TASK-2672 follow-up) ----
describe("rebase through successive conflict stops", () => {
  const OK: GitCommandResult = { status: 0, stdout: '', stderr: '' };
  const HANDOFF = 'missions/task-2672/handoff.ts';
  const PKG = 'package.json';
  const PKGLCK = 'package-lock.json';
  function subcommand(args: string[]): string[] {
    let index = 0;
    while (index + 1 < args.length && (args[index] === '-C' || args[index] === '-c')) { index += 2; }
    return args.slice(index);
  }
  // Explicit Git state: conflicts remain until every path is resolved and staged.
  function successiveConflictHarness() {
    const lines: string[] = [];
    const exitCodes: number[] = [];
    const agentLaunches: Array<{ step: string; options: Record<string, unknown> }> = [];
    const state = { inProgress: false, unmerged: [] as string[], staged: [] as string[],
      continueSets: [] as string[][], rebaseCall: 0, continueCall: 0, classifyCall: 0,
      incomplete: false, pushes: 0, versions: { main: '1.5.283', mission: '1.5.282' }, resolvedVersions: {} as Record<string, string> };
    const port: RebaseWorkflowPort = rebaseWorkflowFixture({
      git: (args: string[]) => {
        const tail = subcommand(args);
        if (tail[0] === 'rebase' && tail[1] === 'main') {
          state.rebaseCall += 1;
          assert.equal(state.rebaseCall, 1, 'never restart a paused rebase');
          state.inProgress = true;
          state.unmerged = [HANDOFF];
          return { signal: null,  status: 1, stdout: '', stderr: `CONFLICT (content): Merge conflict in ${HANDOFF}\n` };
        }
        if (tail[0] === 'rebase' && tail[1] === '--continue') {
          state.continueSets.push([...state.staged]);
          assert.equal(state.unmerged.length, 0, 'all current conflicts must be staged before continue');
          state.continueCall += 1;
          state.staged = [];
          if (state.continueCall === 1) {
            state.unmerged = [PKG, PKGLCK];
            return { signal: null,  status: 1, stdout: '', stderr: `CONFLICT (content): Merge conflict in ${PKG}\nCONFLICT (content): Merge conflict in ${PKGLCK}\n` };
          }
          state.inProgress = false;
          return OK;
        }
        if (tail[0] === 'rebase' && tail[1] === '--show-current') { return { signal: null, ...OK, stdout: state.inProgress ? 'mission/task-2672' : '' }; }
        if (tail[0] === 'status' && tail[1] === '--porcelain') { return { signal: null, ...OK, stdout: state.unmerged.map(file => `UU ${file}`).join('\n') }; }
        if (tail[0] === 'add') { state.staged.push(...tail.slice(1)); state.unmerged = state.unmerged.filter(file => !state.staged.includes(file)); }
        if (tail[0] === 'push') { state.pushes += 1; }
        return OK;
      },
      detectRebaseState: () => ({ inProgress: state.inProgress, unmergedFiles: [...state.unmerged] }),
      getCurrentBranch: () => 'mission/task-2672',
      cwd: () => '/repo', inferSlug: (explicitSlug?: string) => explicitSlug ?? 'task-2672',
      findMissionDir: () => '/worktree/missions/task-2672', findMissionArea: () => 'docs',
      resolveWorktree: () => '/worktree', conventionalWorktreePath: () => '/worktrees/task-2672',
      missionBranchName: () => 'mission/task-2672', resolveMissionBaseBranch: () => 'main',
      missionConflictPathPrefix: () => 'missions/task-2672/', resolvePromptBaseBranch: () => 'main',
      startAgent: async (step: string, options: Record<string, unknown>) => {
        agentLaunches.push({ step, options });
        const prompt = String(options.prompt);
        assert.match(prompt, /stage every resolved file before each git rebase --continue/);
        assert.match(prompt, /Repeat through successive conflict pauses/);
        if (!state.incomplete) {
          for (const file of state.unmerged) { state.resolvedVersions[file] = state.versions.main; } port.git(['add', ...state.unmerged]);
          port.git(['rebase', '--continue']);
        }
        return { agent: String(options.agent ?? 'pool-selected'), result: { status: 0 } };
      },
      selectAgent: () => 'pool-selected', workflowLauncherStatus: (_agent: string) => ({ supported: true, agent: _agent }),
      applyAgentFallback: async () => 'codex', createPr: () => { state.pushes += 1; return { ok: true as const }; }, readToken: () => 'token',
      resolveForgejoUser: (user: string | null) => user ?? 'tester', fetchReviewBranch: () => OK,
      resolveTaskFile: () => ({ ok: true as const, taskFile: '/worktree/backlog/tasks/task-2672.md', task: {} }),
      getTaskImplementer: () => 'codex', transitionTask: async () => undefined,
      resolveReviewIdentity: () => ({ forgejoUser: 'tester' }),
      readReviewState: async () => ({ implementer: 'codex', status: 'active', metadata: {} }),
      writeReviewState: async () => ({ outcome: 'committed' as const }), persistReviewState: async () => ({ outcome: 'committed' as const }),
      isForgejoReviewEnabled: () => true, formatVerificationCommand: () => 'npm test',
      resolveConflictsForMission: () => assert.fail('paused recovery must not dry merge an unmerged index (TASK-2778)'),
      missionServices: null,
      exit: (code: number) => { exitCodes.push(code); },
    });
    return { port, lines, exitCodes, agentLaunches, state };
  }
  async function runSuccessive(h: ReturnType<typeof successiveConflictHarness>): Promise<void> {
    const previous = setLogger({ log: (...parts: unknown[]) => h.lines.push(parts.join(' ')) });
    try { await new RebaseCommandUseCase(h.port).execute(['task-2672', '--push']); } finally { setLogger(previous); }
  }
  test('TASK-2672: a second conflict after a mission conflict is rediscovered and resolved, not stopped (TASK-2668.02)', async () => {
    const h = successiveConflictHarness();
    await runSuccessive(h);
    assert.deepEqual(h.exitCodes, [0], 'rebase completes after resolving every successive conflict');
    const resolutionLaunches = h.agentLaunches.filter((l) => l.step === 'conflict-resolution');
    assert.ok(resolutionLaunches.length >= 1,
      'the resolver must launch for the rediscovered package.json/package-lock.json conflicts');
    assert.deepEqual(h.state.continueSets, [[HANDOFF], [PKG, PKGLCK]], 'each full conflict set staged before continue');
    assert.deepEqual(h.port.detectRebaseState('/worktree'), { inProgress: false, unmergedFiles: [] });
    assert.deepEqual(h.state.versions, { main: '1.5.283', mission: '1.5.282' }); assert.deepEqual(h.state.resolvedVersions, { [PKG]: '1.5.283', [PKGLCK]: '1.5.283' }); assert.equal(h.state.pushes, 1);
  });
  test('TASK-2672: successive-conflict recovery still fails closed when the continue budget is exhausted (TASK-2668.02)', async () => {
    const h = successiveConflictHarness();
    let continueCalls = 0;
    let staged = false;
    h.port.git = (args: string[]) => {
      const tail = subcommand(args);
      if (tail[0] === 'rebase' && tail[1] === 'main') { h.state.inProgress = true; return { status: 1, stdout: '', stderr: `CONFLICT (content): Merge conflict in ${HANDOFF}\n` }; }
      if (tail[0] === 'rebase' && tail[1] === '--continue') { continueCalls += 1; return { status: 1, stdout: '', stderr: 'pre-commit hook failed' }; }
      if (tail[0] === 'rebase' && tail[1] === '--show-current') { return { status: 0, stdout: 'mission/task-2672', stderr: '' }; }
      if (tail[0] === 'checkout' || tail[0] === 'add') { staged = true; return OK; }
      if (tail[0] === 'status' && tail[1] === '--porcelain') { return { status: 0, stdout: '', stderr: '' }; }
      return OK;
    };
    h.port.missionServices = null;
    h.port.detectRebaseState = () => ({ inProgress: h.state.inProgress, unmergedFiles: h.state.inProgress && !staged ? [HANDOFF] : [] });
    h.port.resolveConflictsForMission = () => ({ ok: true as const, conflictFiles: [HANDOFF], missionSpecificFiles: [HANDOFF], sharedFiles: [] });
    await runSuccessive(h);
    assert.equal(continueCalls, 3, 'the finite continue budget is preserved across successive conflicts');
    assert.ok(h.exitCodes.some((c) => c !== 0), 'budget exhaustion fails closed');
    assert.match(h.lines.join('\n'), /after 3 failed --continue attempt/, 'reports the exhausted continue budget');
  });
  for (const filesRemain of [true, false]) { test(`TASK-2672: zero resolver exit with unfinished re-entry cannot publish (unmerged=${filesRemain})`, async () => {
    const h = successiveConflictHarness();
    h.state.incomplete = true;
    if (!filesRemain) { const launch = h.port.startAgent; h.port.startAgent = async (step, options) => { const result = await launch(step, options); h.state.unmerged = []; return result; }; }
    await runSuccessive(h);
    assert.deepEqual(h.exitCodes, [1]);
    assert.deepEqual(h.state.unmerged, filesRemain ? [PKG, PKGLCK] : []);
    assert.equal(h.state.inProgress, true);
    assert.equal(h.state.pushes, 0);
    if (filesRemain) { assert.match(h.lines.join('\n'), /Unmerged: package-lock.json/); }
    assert.match(h.lines.join('\n'), /git rebase --continue/);
    assert.doesNotMatch(h.lines.join('\n'), /completed conflict resolution/);
  }); }
});
test('rebase continuation and recovery policy need only observed facts (TASK-2668.07)', () => {
  assert.equal(rebaseHookRecoveryEligible(1, true, true), true);
  for (const facts of [[0, true, true], [1, false, true], [1, true, false]] as const) { assert.equal(rebaseHookRecoveryEligible(facts[0], facts[1], facts[2]), false); }
  assert.equal(replacementImplementer('codex', 'claude', true), 'codex');
  assert.equal(replacementImplementer('codex', 'claude', true, 'custom'), 'custom');
  assert.equal(replacementImplementer('codex', 'codex', true), null);
  assert.equal(replacementImplementer(null, 'claude', true), null);
  assert.equal(replacementImplementer('codex', 'claude', false), null);
  assert.equal(continueBudgetExceeded(2, 2), true);
  assert.equal(preContinueAction(0, true, true, true), 'completed');
  assert.equal(preContinueAction(1, true, true, true), 'recursed');
  assert.equal(preContinueAction(1, false, false, false), 'completed');
  assert.equal(preContinueAction(1, false, true, false), 'retry');
  assert.equal(postContinueAction(0, true, true, 2, 2, true), 'completed');
  assert.equal(postContinueAction(1, true, true, 2, 2, true), 'retry');
  assert.equal(postContinueAction(1, false, false, 2, 2, true), 'completed');
  assert.equal(postContinueAction(1, false, true, 2, 2, true), 'budget-exhausted');
  assert.equal(postContinueAction(1, false, true, 1, 2, true), 'staged-failure');
  assert.equal(postContinueAction(1, false, true, 1, 2, false), 'retry');
});

test('integration rebase repair returns to ready-for-integration (TASK-2746)', async () => {
  const calls: string[] = [];
  const store = inMemoryTransitionStore(fixtureMission('task-2746', { status: 'integration' }));
  await transitionRebaseRepair('task-2746', 'active', { rootDir: '/mission' }, {
    missionServices: async root => {
      assert.equal(root, '/mission');
      return { store };
    },
    cwd: () => assert.fail('must use the explicit mission root'),
    transitionTask: (slug, status, options) => {
      assert.equal(slug, 'task-2746');
      assert.equal(options.rootDir, '/mission');
      calls.push(status);
    },
    reviewerEligibility: () => assert.fail('integration repair does not resume review'),
  });
  assert.deepEqual(calls, ['ready-for-integration']);
});
