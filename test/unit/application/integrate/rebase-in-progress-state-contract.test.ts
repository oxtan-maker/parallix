import { fixtureMission, inMemoryTransitionStore, pendingReview } from '../../../fixtures/mission-builders.js';
import { missionExecutionContext } from '../../../fixtures/mission-execution-context.js';
import { applyReviewerCommand, changeRevision } from '../../../../src/domain/review.js';
import { decideMission } from '../../../../src/domain/mission-workflow.js';
import { MissionLifecycleService } from '../../../../src/application/mission-lifecycle-service.js';
import { integrationServices } from '../../../helpers/stub-integration-services.js';
import { integrationBounceSeams } from '../../../helpers/integration-bounce-seams.js';
import { rebaseWorkflowFixture } from '../../../helpers/rebase-workflow-fixture.js';
import type { IntegrateWorkflowPorts } from '../../../../src/application/ports/integrate-workflow.js';
import { stubIntegrateWorkflowPorts } from '../../../helpers/stub-integrate-workflow-ports.js';
import { sharedConflictHarness } from '../../../helpers/rebase-conflict-fixture.js';
import { agentFamily } from '../../../../src/domain/agents.js';
import { setLogger } from '../../../../src/application/presentation/cli-format.js';
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
mockModule('../../../../src/application/integrate/rebase.js', import.meta.url);
await installModuleMocks();

test('integration shared conflicts use the fresh shared resolver and resolved base (px-0021)', async () => {
  const { createIntegrationRebase } = await importFresh<typeof import('../../../../src/application/integrate/rebase.js')>('../../../../src/application/integrate/rebase.js', import.meta.url);
  const store = inMemoryTransitionStore(fixtureMission('task-2503', { assignee: agentFamily('codex'),
    brief: { goal: 'Integration intent', why: 'Keep current base behavior', scope: 'shared source', outOfScope: [] },
    successCriteria: ['Preserve the feature'] }));
  const h = sharedConflictHarness({ missionServices: async () => ({ store }), findMissionDir: () => null,
    git: args => ({ failureReason: args.at(-1) === 'local-base' && args.includes('rebase') ? { version: 1, code: 'git-conflict' } : undefined, status: args.at(-1) === 'local-base' && args.includes('rebase') ? 1 : 0,
      stdout: '', stderr: args.at(-1) === 'local-base' && args.includes('rebase') ? 'CONFLICT (content): Merge conflict in shared.ts' : '' }) });
  const defaults = stubIntegrateWorkflowPorts();
  const observedRoots: Array<string | undefined> = [];
  const completionRoots: string[] = [];
  const executionContext = missionExecutionContext({ missionId: 'task-2503', missionWorktree: '/worktree', baseWorktree: '/base', baseBranch: 'local-base' });
  const ports = stubIntegrateWorkflowPorts({
    missionPaths: { ...defaults.missionPaths, missionBranchName: () => 'mission/task-2503', conventionalWorktreePath: () => '/configured/default' },
    rebase: { createRebaseWorkflowPort: options => {
      assert.equal(options.rebaseObservationStage, 'integration-rebase');
      assert.deepEqual(options.executionContext, executionContext);
      h.port.resolveExecutionContext = () => ({ ok: true, context: options.executionContext });
      h.port.exit = options.exitFn!; return h.port;
    } },
    git: { ...defaults.git, getCurrentBranch: root => { observedRoots.push(root); return 'mission/task-2503'; }, detectRebaseState: root => { completionRoots.push(root); return { inProgress: false, unmergedFiles: [] }; } },
  });
  const previous = setLogger({ log: (...parts: unknown[]) => h.lines.push(parts.join(' ')) });
  try {
    await createIntegrationRebase(ports).runIntegrationRebase('task-2503', { baseWorktree: '/base', baseBranch: 'local-base',
      executionContext,
      git: args => ({ status: 0, stdout: args.includes('rev-parse') ? 'sha' : '', stderr: '', signal: null }) });
    assert.deepEqual(completionRoots, ['/worktree'], 'completion observes the resolved mission checkout, not a reconstructed conventional path (px-0042.02 F6)');
    assert.ok(observedRoots.length >= 2, 'entry and completion both observe the checkout (TASK-2830)');
    assert.deepEqual([...new Set(observedRoots)], ['/worktree'], 'every branch check observes the mission worktree');
    assert.equal(h.agentLaunches.length, 1, h.lines.join('\n'));
    assert.equal(h.agentLaunches[0].options.sessionPolicy, 'fresh-ephemeral');
    assert.match(String(h.agentLaunches[0].options.prompt), /Integration intent/);
    assert.match(String(h.agentLaunches[0].options.prompt), /Resolved local rebase base: local-base/);
  } finally { setLogger(previous); }
});

test('integration rebase uses the shared exact-tree suffix boundary (TASK-2849)', async () => {
  const { createIntegrationRebase } = await importFresh<typeof import('../../../../src/application/integrate/rebase.js')>('../../../../src/application/integrate/rebase.js', import.meta.url);
  const hash = (digit: string) => digit.repeat(40);
  const [target, tip, boundary, root, targetTree, tipTree, rebasedTip] =
    ['1', '2', '3', '4', '5', '6', '8'].map(hash);
  const slug = 'task-2849'; const branch = `mission/${slug}`;
  const executionContext = missionExecutionContext({ missionId: slug, missionWorktree: '/mission', baseWorktree: '/base', baseBranch: 'main' });
  const ontoCalls: string[][] = [];
  const subcommand = (args: string[]) => {
    let index = 0;
    while (index + 1 < args.length && (args[index] === '-C' || args[index] === '-c')) { index += 2; }
    return args.slice(index);
  };
  const git = (args: string[]) => {
    const tail = subcommand(args); const joined = tail.join(' ');
    if (joined === 'rev-parse --verify main') return { status: 0, stdout: `${target}\n`, stderr: '' };
    if (joined === 'rev-parse --is-shallow-repository') return { status: 0, stdout: 'false\n', stderr: '' };
    if (joined === `rev-parse --verify ${target}^{tree}`) return { status: 0, stdout: `${targetTree}\n`, stderr: '' };
    if (joined === 'rev-parse --verify HEAD^{commit}') return { status: 0, stdout: `${tip}\n`, stderr: '' };
    if (tail[0] === 'log') return { status: 0, stdout: `${tip}\t${boundary}\t${tipTree}\n${boundary}\t${root}\t${targetTree}\n`, stderr: '' };
    if (joined === `rev-list --parents --max-count=1 ${target}`) return { status: 0, stdout: `${target} ${root}\n`, stderr: '' };
    if (joined === `merge-base --is-ancestor ${root} ${tip}`) return { status: 0, stdout: '', stderr: '' };
    if (joined === `merge-base ${target} ${boundary}`) return { status: 0, stdout: `${root}\n`, stderr: '' };
    if (joined === `merge-base --is-ancestor ${target} ${tip}`) return { status: 1, stdout: '', stderr: '' };
    if (joined === `merge-base --is-ancestor ${boundary} ${tip}` || joined === 'merge-base --is-ancestor main HEAD') return { status: 0, stdout: '', stderr: '' };
    if (tail[0] === 'rebase' && tail[1] === '--onto') { ontoCalls.push(tail); return { status: 0, stdout: '', stderr: '' }; }
    if (joined === `rev-parse ${branch}` || joined === 'rev-parse HEAD') return { status: 0, stdout: `${rebasedTip}\n`, stderr: '' };
    if (joined === 'rev-parse main') return { status: 0, stdout: `${target}\n`, stderr: '' };
    if (joined === `merge-base --is-ancestor ${target} ${rebasedTip}`) return { status: 0, stdout: '', stderr: '' };
    return { status: 0, stdout: '', stderr: '' };
  };
  const h = sharedConflictHarness({ git, detectRebaseState: () => ({ inProgress: false, unmergedFiles: [] }),
    getCurrentBranch: () => branch, findMissionDir: () => null, findMissionArea: () => 'workflow',
    missionBranchName: () => branch, resolveMissionBaseBranch: () => 'main' });
  const defaults = stubIntegrateWorkflowPorts();
  const ports = stubIntegrateWorkflowPorts({
    missionPaths: { ...defaults.missionPaths, missionBranchName: () => branch },
    rebase: { createRebaseWorkflowPort: options => {
      h.port.resolveExecutionContext = () => ({ ok: true, context: options.executionContext });
      h.port.exit = options.exitFn; return h.port;
    } },
    git: { git, getCurrentBranch: () => branch, detectRebaseState: () => ({ inProgress: false, unmergedFiles: [] }) },
  });
  await createIntegrationRebase(ports).runIntegrationRebase(slug, { baseWorktree: '/base', baseBranch: 'main', git, executionContext });
  assert.deepEqual(ontoCalls, [['rebase', '--onto', target, boundary]]);
  assert.equal(h.agentLaunches.length, 0);
});

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
  let onRebase = () => {};
  test.beforeEach(() => { mock.method(rebaseWorkflow, 'runRebaseWorkflow', async () => { onRebase(); }); });
  test.afterEach(() => { onRebase = () => {}; mock.restoreAll(); });

  const { createIntegrationRebase } = await importFresh<typeof import('../../../../src/application/integrate/rebase.js')>('../../../../src/application/integrate/rebase.js', import.meta.url);
  const { resumePendingIntegrationRepair } = await importFresh<typeof import('../../../../src/application/integrate/repair-resumption.js')>('../../../../src/application/integrate/repair-resumption.js', import.meta.url);

  const SLUG = 'task-2520-rebase';
  const MISSION_WORKTREE = `/tmp/mission-${SLUG}`;
  const BASE_WORKTREE = '/tmp/base-worktree';

  /**
   * Build minimal ports for `createIntegrationRebase`. The rebase workflow port is
   * driven to a clean completion (exit 0) so the only thing under test is the
   * post-rebase in-progress check, which must read the mission worktree.
   */
  function buildPorts({ missionRebaseInProgress }: { missionRebaseInProgress: boolean }) {
    const rebase: IntegrateWorkflowPorts['rebase'] = {
      createRebaseWorkflowPort: (opts: { exitFn: (code: number) => void }) => {
        opts.exitFn(0);
        return rebaseWorkflowFixture();
      },
    };
    const landing = { createAbort: () => Object.assign(new Error('Integration aborted'), { isAbort: true }) };
    const missionPaths = {
      missionBranchName: (_slug: string) => `mission/${SLUG}`,
      conventionalWorktreePath: (_slug: string) => MISSION_WORKTREE,
    };
    const git = mock.fn((args: string[]) => {
      const joined = args.join(' ');
      if (joined.includes('rebase') && args.includes('--show-current')) {
        // The rebase lives in the mission worktree; the base worktree is clean.
        if (args.includes(MISSION_WORKTREE)) {
          return { signal: null, status: 0, stdout: missionRebaseInProgress ? SLUG : '', stderr: '' };
        }
        return { signal: null, status: 0, stdout: '', stderr: '' };
      }
      if (joined.includes('rev-parse')) { return { signal: null, status: 0, stdout: 'missionsha', stderr: '' }; }
      if (joined.includes('merge-base') && joined.includes('--is-ancestor')) { return { signal: null, status: 0, stdout: '', stderr: '' }; }
      return { signal: null, status: 0, stdout: '', stderr: '' };
    });
    const defaults = stubIntegrateWorkflowPorts();
    const ports = {
      ...stubIntegrateWorkflowPorts({
      missionPaths: missionPaths,
      rebase: rebase,
      landing: landing,
      git: { git },
      }),
      git: { ...defaults.git, git, detectRebaseState: (rootDir: string) => ({ inProgress: missionRebaseInProgress && rootDir === MISSION_WORKTREE, unmergedFiles: [] }) },
    };
    return ports;
  }

  test('integration rebase reports a paused rebase in the mission worktree (SC7)', async () => {
    const logs: string[] = [];
    mock.method(console, 'log', (chunk: unknown) => { logs.push(String(chunk)); return true; });
    mock.method(console, 'error', (chunk: unknown) => { logs.push(String(chunk)); return true; });
    const ports = buildPorts({ missionRebaseInProgress: true });
    let aborted = false;
    try {
      await createIntegrationRebase(ports).runIntegrationRebase(SLUG, { baseWorktree: BASE_WORKTREE, baseBranch: 'main', git: ports.git.git,
        executionContext: missionExecutionContext({ missionId: SLUG, missionWorktree: MISSION_WORKTREE, baseWorktree: BASE_WORKTREE }) });
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
    const git: import("../../../../src/application/ports/integrate-workflow.js").IntegrateGitRunner = (args) => {
      const joined = args.join(' ');
      if (joined.includes('merge-base') && joined.includes('--is-ancestor')) { return { signal: null,  status: 1, stdout: '', stderr: '' }; }
      if (joined.includes('rebase') && args.includes('--show-current')) { return { signal: null,  status: 0, stdout: '', stderr: '' }; }
      if (joined.includes('rev-parse')) { return { signal: null,  status: 0, stdout: 'missionsha', stderr: '' }; }
      return { signal: null,  status: 0, stdout: '', stderr: '' };
    };
    let aborted = false;
    try {
      await createIntegrationRebase(stubIntegrateWorkflowPorts({ ...ports, git: { ...ports.git, git } })).runIntegrationRebase(SLUG, { baseWorktree: BASE_WORKTREE, baseBranch: 'main', git,
        executionContext: missionExecutionContext({ missionId: SLUG, missionWorktree: MISSION_WORKTREE, baseWorktree: BASE_WORKTREE }) });
    } catch (error) {
      aborted = (error as { isAbort?: boolean })?.isAbort === true;
    }
    assert.ok(aborted, 'a base that is not an ancestor of the mission aborts the integration rebase');
    assert.match(logs.join('\n'), /did not complete cleanly/,
      'the ancestry failure must surface as an incomplete rebase, not a clean completion');
  });

  test('interrupted repair rebases through the shared owner before equivalent-patch comparison (TASK-2820)', async () => {
    let rebased = false, validatedSha = 'before-rebase', comparisons = 0;
    const open = pendingReview(SLUG, '2026-10-25T08:00:00Z');
    const round = open.rounds[0];
    const review = applyReviewerCommand({ ...open, rounds: [{ ...round, subject: { ...round.subject, baseline: changeRevision('old-base') } }] },
      { type: 'approve', revision: changeRevision('approved-A'), decidedAt: '2026-10-25T09:00:00Z', comment: null, source: { kind: 'local' } });
    const active = decideMission(fixtureMission(SLUG, { status: 'integration', review, assignee: round.implementer }), {
      type: 'rebound-to-active', agent: round.implementer, occurredAt: '2026-10-25T10:00:00Z', cause: { kind: 'integration-gate-failure', gate: 'unit' },
    });
    const store = inMemoryTransitionStore(active);
    const services = integrationServices({ store, lifecycle: new MissionLifecycleService(store), operationalHistory: {
      loadLatestByTypeForMission: async () => null, recordIntegrationValidation: async input => { validatedSha = input.sha; },
    } });
    onRebase = () => { rebased = true; };
    const evidence = { now: () => '2026-10-25T12:00:00Z', reconcileHumanFeedback: async () => true,
      samePatch: async (_approved: unknown, candidate: { baseline: string; revision: string }) => {
        comparisons++; assert.equal(rebased, true); assert.deepEqual(candidate, { revision: 'rebased-B', baseline: 'new-base' }); return true;
      }, validation: async () => ({ missionId: SLUG, sha: validatedSha, baseline: 'new-base', hooks: ['unit'],
        createdAt: '2026-10-25T11:00:00Z', reference: 'history:1' }) };
    const ports = stubIntegrateWorkflowPorts({ process: { cwd: () => MISSION_WORKTREE },
      landing: { createAbort: () => Object.assign(new Error('Integration aborted'), { name: 'IntegrationAbort' }) },
      missionPaths: { resolveWorktree: () => MISSION_WORKTREE, resolveMissionBaseBranch: () => 'main',
        resolveBaseWorktree: () => BASE_WORKTREE, missionBranchName: () => `mission/${SLUG}`, conventionalWorktreePath: () => MISSION_WORKTREE },
      rebase: { createRebaseWorkflowPort: options => { options.exitFn(0); return rebaseWorkflowFixture(); } },
      git: { git: args => {
        let stdout = '';
        if (args.includes('rev-parse')) { stdout = args.at(-1) === 'main' ? 'new-base' : rebased ? 'rebased-B' : 'before-rebase'; }
        if (args.includes('merge-base') && !args.includes('--is-ancestor')) { stdout = rebased ? 'new-base' : 'old-base'; }
        return { status: 0, stdout, stderr: '' };
      }, detectRebaseState: () => ({ inProgress: false, unmergedFiles: [] }) },
      gates: { approvalEvidence: () => evidence, captureFinalIntegrationTree: () => ({ ok: true, commit: rebased ? 'rebased-B' : 'before-rebase' }),
        loadPhaseGates: () => [{ key: 'unit', command: 'verify', order: 1 }], runPhaseGates: async () => { assert.equal(rebased, true); return { ok: true }; } },
    });
    const seams = { ...integrationBounceSeams({ transitionTaskFn: () => true }), routeIntegrationGateFailureFn: async () => { throw new Error('unexpected repair'); } };
    await assert.rejects(resumePendingIntegrationRepair(SLUG, services, ports, missionExecutionContext({ missionId: SLUG }), seams, { realAgent: null, realAgentModel: null }), { name: 'IntegrationStopsForHuman' });
    assert.equal(comparisons, 1); assert.equal(store.mission().status, 'integration');
    assert.equal(store.mission().review!.rounds.length, 1);
    assert.equal(store.mission().review!.rounds[0].decision?.revision, 'approved-A');
  });

  test('dry-run predicts a pending repair rebase without mutating the mission branch (PX-0031)', async () => {
    let rebased = false, gateRuns = 0;
    const output: string[] = [];
    const previousLogger = setLogger({ log: line => { output.push(String(line)); }, error: line => { output.push(String(line)); } });
    const open = pendingReview(SLUG, '2026-10-25T08:00:00Z');
    const round = open.rounds[0];
    const review = applyReviewerCommand(open,
      { type: 'approve', revision: changeRevision('approved-A'), decidedAt: '2026-10-25T09:00:00Z', comment: null, source: { kind: 'local' } });
    const active = decideMission(fixtureMission(SLUG, { status: 'integration', review, assignee: round.implementer }), {
      type: 'rebound-to-active', agent: round.implementer, occurredAt: '2026-10-25T10:00:00Z', cause: { kind: 'integration-gate-failure', gate: 'unit' },
    });
    const store = inMemoryTransitionStore(active);
    const services = integrationServices({ store, lifecycle: new MissionLifecycleService(store) });
    onRebase = () => { rebased = true; };
    const defaults = stubIntegrateWorkflowPorts();
    const ports = stubIntegrateWorkflowPorts({
      process: { cwd: () => MISSION_WORKTREE },
      landing: { createAbort: () => Object.assign(new Error('Integration aborted'), { name: 'IntegrationAbort' }) },
      missionPaths: { ...defaults.missionPaths, resolveWorktree: () => MISSION_WORKTREE, resolveMissionBaseBranch: () => 'main',
        resolveBaseWorktree: () => BASE_WORKTREE, missionBranchName: () => `mission/${SLUG}`, conventionalWorktreePath: () => MISSION_WORKTREE },
      rebase: { createRebaseWorkflowPort: options => { options.exitFn(0); return rebaseWorkflowFixture(); } },
      git: { ...defaults.git, git: args => {
        if (args.includes('rev-parse')) { return { status: 0, stdout: args.at(-1) === 'main' ? 'new-base' : 'repair-head', stderr: '' }; }
        if (args.includes('merge-base')) { return { status: 0, stdout: 'old-base', stderr: '' }; }
        return { status: 0, stdout: '', stderr: '' };
      } },
      gates: { ...defaults.gates, approvalEvidence: () => ({ now: () => '2026-10-25T12:00:00Z',
        samePatch: async () => false, validation: async () => null, reconcileHumanFeedback: async () => true }),
        captureFinalIntegrationTree: () => ({ ok: true, commit: 'repair-head' }),
        loadPhaseGates: () => [{ key: 'unit', command: 'verify', order: 1 }], runPhaseGates: async () => { gateRuns++; return { ok: true }; } },
    });
    const seams = { ...integrationBounceSeams(), routeIntegrationGateFailureFn: async () => { throw new Error('unexpected repair'); } };

    try {
      await assert.rejects(resumePendingIntegrationRepair(SLUG, services, ports, missionExecutionContext({ missionId: SLUG }), seams,
        { realAgent: null, realAgentModel: null, dryRun: true }), { name: 'IntegrationAbort' });
      assert.match(output.join('\n'), /requires a rebase onto main.*dry-run did not mutate/);
      assert.equal(rebased, false, 'dry-run never invokes the mutating shared rebase owner');
      assert.equal(gateRuns, 0, 'stale-base repair evidence is not verified before the required rebase');
      assert.equal(store.mission().status, 'active', 'the pending repair remains available to a later landing integration');
    } finally { setLogger(previousLogger); }
  });

  test('integration rebase checks completion from rebase metadata, never a patch dump (TASK-2828.2)', async () => {
    mock.method(console, 'log', () => true);
    mock.method(console, 'error', () => true);
    const ports = buildPorts({ missionRebaseInProgress: false });

    await createIntegrationRebase(ports).runIntegrationRebase(SLUG, { baseWorktree: BASE_WORKTREE, baseBranch: 'main', git: ports.git.git,
      executionContext: missionExecutionContext({ missionId: SLUG, missionWorktree: MISSION_WORKTREE, baseWorktree: BASE_WORKTREE }) });

    const probes = ports.git.git.mock.calls.map((call: { arguments: [string[]] }) => call.arguments[0].join(' '));
    assert.ok(probes.length > 0, 'the integration rebase still probes git state');
    assert.deepEqual(probes.filter((p) => p.includes('--show-current')), [],
      'the completion check must not ask git for the current patch');
  });

  test('integration rebase completes cleanly when no rebase is active in the mission worktree (SC7)', async () => {
    const ports = buildPorts({ missionRebaseInProgress: false });
    // A clean-start round exits 0 with no active rebase and an ancestor base, so
    // the integration rebase resolves without throwing.
    await createIntegrationRebase(ports).runIntegrationRebase(SLUG, { baseWorktree: BASE_WORKTREE, baseBranch: 'main', git: ports.git.git,
      executionContext: missionExecutionContext({ missionId: SLUG, missionWorktree: MISSION_WORKTREE, baseWorktree: BASE_WORKTREE }) });
    assert.ok(ports.git.git.mock.callCount() > 0, 'the clean rebase still probes the mission worktree state');
  });
});

// ---- task-2520 px rebase in-progress (consolidated from test/task-2520-rebase-inprogress.test.ts, TASK-2622.09) ----
describe("px rebase in-progress", async () => {
  // TASK-2520 SC6 / AC7: `px rebase` must never report "Rebase completed cleanly"
  // while the mission worktree still has a rebase in progress. The shared rebase
  // workflow treats a rebase-state snapshot still reporting inProgress after a status-0
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
   * Build a minimal RebaseWorkflowPort. The rebase command succeeds (status 0) but the
   * rebase-state owner reports the worktree is still mid-rebase, which is the
   * exact SC6 trap: a status-0 rebase that has not actually finished.
   */
  function buildPort({ inProgress }: { inProgress: boolean }, exitCodes: { value: number[] }, gitCalls: string[][] = []) {
    // The worktree is clean on entry — otherwise the workflow reports an existing rebase and
    // bails before starting a round. It is still mid-rebase after a status-0 round when
    // inProgress is set, which is the SC6 trap.
    let rebaseRoundRan = false;
    const port = rebaseWorkflowFixture({
      git: (args: string[]) => {
        gitCalls.push([...args]);
        if (args.includes('rebase')) { rebaseRoundRan = true; }
        return { signal: null,  status: 0, stdout: '', stderr: '' };
      },
      detectRebaseState: () => ({
        inProgress: rebaseRoundRan && inProgress,
        // A paused round replays a commit, so REBASE_HEAD resolves; that is the metadata the
        // removed `rebase --show-current` probe was reading the patch to identify.
        rebaseHead: rebaseRoundRan && inProgress ? 'a'.repeat(40) : '',
        unmergedFiles: [],
      }),
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
      startAgent: async () => ({ agent: 'test-agent', result: { status: 0 } }),
      selectAgent: () => 'test-agent',
      workflowLauncherStatus: () => ({ supported: true, agent: 'test-agent' }),
      applyAgentFallback: async () => 'test-agent',
      createPr: () => ({ ok: true as const }),
      readToken: () => 'token',
      resolveForgejoUser: (user: string | null) => user ?? 'tester',
      fetchReviewBranch: () => ({ status: 0, stdout: '', stderr: '' }),
      resolveTaskFile: () => ({ ok: true as const, taskFile: `${WORKTREE}/backlog/tasks/${SLUG}.md`, task: {} }),
      getTaskImplementer: () => 'tester',
      transitionTask: async () => undefined,
      resolveReviewIdentity: () => ({ forgejoUser: 'tester' }),
      readReviewState: async () => ({ metadata: {} }),
      writeReviewState: async () => ({ outcome: 'committed' as const }),
      persistReviewState: async () => ({ outcome: 'committed' as const }),
      isForgejoReviewEnabled: () => true,
      formatVerificationCommand: () => ': # no verification gate configured (set adapters.verification.command)',
      resolveConflictsForMission: () => ({ ok: true as const, conflictFiles: [], missionSpecificFiles: [], sharedFiles: [] }),
      missionServices: null,
      exit: (code: number) => { exitCodes.value.push(code); },
    });
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

  test('px rebase resolves the completion check from rebase metadata, never a patch dump (TASK-2828.2)', async () => {
    mock.method(console, 'log', () => true);
    mock.method(console, 'error', () => true);
    const gitCalls: string[][] = [];
    const exitCodes: number[] = [];
    const port = buildPort({ inProgress: false }, { value: exitCodes }, gitCalls);

    await runRebaseWorkflow([SLUG], port);

    assert.deepEqual(exitCodes, [0], 'the clean-completion path still runs');
    assert.ok(gitCalls.length > 0, 'the workflow still talks to git');
    assert.deepEqual(
      gitCalls.filter((args) => args.includes('--show-current')).map((args) => args.join(' ')),
      [],
      'the completion check must not ask git for the current patch; `rebase --show-current` is git\'s prefix match for --show-current-patch',
    );
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
