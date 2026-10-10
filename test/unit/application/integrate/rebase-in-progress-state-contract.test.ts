// Historical regression provenance: TASK-2520.
// Behavior-owned suite (TASK-2622.09): a paused rebase is never reported as a clean completion — the
// integration-time rebase inspects the mission worktree (task-2520 SC4/SC7) and `px rebase` reports
// clean completion only when no rebase is active (task-2520 SC6). The rebase-workflow module is mocked
// here only. Legacy case names unchanged.
import test, { mock, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mockModule, installModuleMocks, importFresh } from '../../../lib/module-mock.js';

// Declaration order is load-bearing: installModuleMocks relinks modules in this order, so a
// module must be declared after the modules it depends on (merged from every section below).
mockModule('../../../../src/application/rebase-workflow.js', import.meta.url);
await installModuleMocks();

// ---- task-2520 integration rebase state (consolidated from test/task-2520-integrate-rebase-state.test.ts, TASK-2622.09) ----
describe("integration rebase state", async () => {
  // TASK-2520 SC7 / AC8: the integration-time rebase must inspect the mission
  // worktree for an active rebase, not the base worktree. The rebase runs in the
  // mission worktree, so a mid-rebase state there is the only one that matters;
  // checking the base worktree always reports clean and a paused mission rebase
  // is falsely reported as complete. Hermetic: the shared rebase workflow and git
  // are injected doubles, so no worktree, real Forgejo, or agent is touched.

  const rebaseWorkflow = mockModule<typeof import('../../../../src/application/rebase-workflow.js')>('../../../../src/application/rebase-workflow.js', import.meta.url);

  // The shared workflow is driven to a clean completion by the rebase port double;
  // stub it so the only behaviour under test is the post-rebase in-progress check.
  // Re-establish it per test: afterEach's mock.restoreAll() removes the stub.
  test.beforeEach(() => { mock.method(rebaseWorkflow, 'runRebaseWorkflow', async () => {}); });
  test.afterEach(() => mock.restoreAll());

  const { createIntegrationRebase } = await importFresh<typeof import('../../../../src/application/integrate/rebase.js')>('../../../../src/application/integrate/rebase.js', import.meta.url);

  const SLUG = 'task-2520-rebase';
  const MISSION_WORKTREE = `/tmp/mission-${SLUG}`;
  const BASE_WORKTREE = '/tmp/base-worktree';

  /**
   * Build minimal ports for `createIntegrationRebase`. The rebase workflow port is
   * driven to a clean completion (exit 0) so the only thing under test is the
   * post-rebase in-progress check, which must read the mission worktree.
   */
  function buildPorts({ missionRebaseInProgress }: { missionRebaseInProgress: boolean }) {
    const rebase = {
      createRebaseWorkflowPort: (opts: { exitFn: (code: number) => void }) => {
        opts.exitFn(0);
        return { cwd() {}, getCurrentBranch() {}, resolveMissionBaseBranch() {} };
      },
    };
    const landing = { createAbort: () => ({ isAbort: true }) };
    const missionPaths = {
      missionBranchName: (_slug: string) => `mission/${SLUG}`,
      conventionalWorktreePath: (_slug: string) => MISSION_WORKTREE,
      parseConflictFilesFromMergeOutput: () => [],
    };
    const git = mock.fn((args: string[]) => {
      const joined = args.join(' ');
      if (joined.includes('rebase') && args.includes('--show-current')) {
        // The rebase lives in the mission worktree; the base worktree is clean.
        if (args.includes(MISSION_WORKTREE)) {
          return { status: 0, stdout: missionRebaseInProgress ? SLUG : '', stderr: '' };
        }
        return { status: 0, stdout: '', stderr: '' };
      }
      if (joined.includes('rev-parse')) { return { status: 0, stdout: 'missionsha', stderr: '' }; }
      if (joined.includes('merge-base') && joined.includes('--is-ancestor')) { return { status: 0, stdout: '', stderr: '' }; }
      return { status: 0, stdout: '', stderr: '' };
    });
    const ports = {
      missionPaths: missionPaths as any,
      rebase: rebase as any,
      landing: landing as any,
      git: { git },
    };
    return ports as any;
  }

  test('integration rebase reports a paused rebase in the mission worktree (SC7)', async () => {
    const logs: string[] = [];
    mock.method(console, 'log', (chunk: unknown) => { logs.push(String(chunk)); return true; });
    mock.method(console, 'error', (chunk: unknown) => { logs.push(String(chunk)); return true; });
    const ports = buildPorts({ missionRebaseInProgress: true });
    let aborted = false;
    try {
      await createIntegrationRebase(ports).runIntegrationRebase(SLUG, { baseWorktree: BASE_WORKTREE, baseBranch: 'main', git: ports.git.git });
    } catch (error) {
      aborted = (error as { isAbort?: boolean })?.isAbort === true;
    }
    assert.ok(aborted, 'a paused mission rebase aborts the integration rebase');
    assert.match(logs.join('\n'), /Integration-time rebase did not complete cleanly \(inProgress=true/,
      'a paused rebase in the mission worktree must be reported, not reported clean');
  });

  /**
   * Base not an ancestor of the mission HEAD: the resolved local base has not been
   * folded into the mission branch, so landing would squash onto a stale base.
   * This is the SC4 ancestry guard — the integration rebase must abort rather than
   * proceed to squash/merge against a base the mission does not build on.
   */
  test('integration rebase aborts when the local base is not an ancestor of the mission (SC4)', async () => {
    const logs: string[] = [];
    mock.method(console, 'log', (chunk: unknown) => { logs.push(String(chunk)); return true; });
    mock.method(console, 'error', (chunk: unknown) => { logs.push(String(chunk)); return true; });
    const ports = buildPorts({ missionRebaseInProgress: false });
    // Make the ancestry probe report the base is NOT an ancestor of the mission.
    const git = (args: string[]) => {
      const joined = args.join(' ');
      if (joined.includes('merge-base') && joined.includes('--is-ancestor')) { return { status: 1, stdout: '', stderr: '' }; }
      if (joined.includes('rebase') && args.includes('--show-current')) { return { status: 0, stdout: '', stderr: '' }; }
      if (joined.includes('rev-parse')) { return { status: 0, stdout: 'missionsha', stderr: '' }; }
      return { status: 0, stdout: '', stderr: '' };
    };
    let aborted = false;
    try {
      await createIntegrationRebase({ ...ports, git }).runIntegrationRebase(SLUG, { baseWorktree: BASE_WORKTREE, baseBranch: 'main', git });
    } catch (error) {
      aborted = (error as { isAbort?: boolean })?.isAbort === true;
    }
    assert.ok(aborted, 'a base that is not an ancestor of the mission aborts the integration rebase');
    assert.match(logs.join('\n'), /did not complete cleanly/,
      'the ancestry failure must surface as an incomplete rebase, not a clean completion');
  });

  test('integration rebase completes cleanly when no rebase is active in the mission worktree (SC7)', async () => {
    const ports = buildPorts({ missionRebaseInProgress: false });
    // A clean-start round exits 0 with no active rebase and an ancestor base, so
    // the integration rebase resolves without throwing.
    await createIntegrationRebase(ports).runIntegrationRebase(SLUG, { baseWorktree: BASE_WORKTREE, baseBranch: 'main', git: ports.git.git });
    assert.ok(ports.git.git.mock.callCount() > 0, 'the clean rebase still probes the mission worktree state');
  });
});

// ---- task-2520 px rebase in-progress (consolidated from test/task-2520-rebase-inprogress.test.ts, TASK-2622.09) ----
describe("px rebase in-progress", async () => {
  // TASK-2520 SC6 / AC7: `px rebase` must never report "Rebase completed cleanly"
  // while the mission worktree still has a rebase in progress. The shared rebase
  // workflow treats a non-empty `rebase --show-current` after a status-0
  // rebase as incomplete and must skip the clean-completion result. Hermetic: the
  // rebase-workflow port is an injected double, so no worktree, real Forgejo, or
  // agent is touched.

  const rebaseWorkflow = mockModule<typeof import('../../../../src/application/rebase-workflow.js')>('../../../../src/application/rebase-workflow.js', import.meta.url);

  test.afterEach(() => mock.restoreAll());

  const { runRebaseWorkflow } = await import('../../../../src/application/rebase-workflow.js');

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
      formatVerificationCommand: () => ': # no verification gate configured (set adapters.verification.command)',
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
    assert.match(joined, /Verification: the workflow handles integration checks\./);
    assert.match(joined, /Next: git rebase --continue/);
    assert.doesNotMatch(joined, /Next: :|Next: \s*$/m);
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
    assert.match(joined, /Verification: the workflow handles integration checks\./);
    assert.doesNotMatch(joined, /Next:/);
    assert.match(joined, /Rebase completed cleanly/, 'a finished rebase reports clean completion');
  });
});
