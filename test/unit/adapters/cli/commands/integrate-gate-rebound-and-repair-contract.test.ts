// Historical regression provenance: TASK-2565, TASK-2603, TASK-2369.05, TASK-1124, TASK-2561, TASK-2543, TASK-1268.
// Behavior-owned suite (TASK-2622.09): integration-gate failure rebound and repair — lifecycle
// reactivation (task-2565), active mission context binding (task-2603), gate helper ownership
// (task-2369.05), relaunchable repair (task-1124), push-gate/handoff regressions (task-2561), integration
// repair approval invalidation (task-2543), and diff-scoped gate areas (task-1268). Legacy case names unchanged.
import test, { mock, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { mockModule, installModuleMocks } from '../../../../lib/module-mock.js';
import type { DraftWorkflowContext } from '../../../../../src/application/ports/cli-workflows.js';
import type { RebaseWorkflowPort } from '../../../../../src/application/ports/rebase-workflow.js';
import type { IntegrateWorkflowPorts } from '../../../../../src/application/ports/integrate-workflow.js';
import { SLUG, makePorts, makeRecorder, runOptions } from '../../../../helpers/handoff-ports.js';
import type { Mission } from '../../../../../src/domain/mission.js';
import { MissionLifecycleService } from '../../../../../src/application/mission-lifecycle-service.js';
import type { MissionVersion } from '../../../../../src/application/domain-ports.js';
import { mkdtemp as registeredMkdtemp } from '../../../../helpers/temp-dir.js';
import { fakeReviewLoopPorts } from '../../../../helpers/review-loop-ports.js';

// Declaration order is load-bearing: installModuleMocks relinks modules in this order, so a
// module must be declared after the modules it depends on (merged from every section below).
mockModule('../../../../../src/adapters/cli/commands/repair-handoff.js', import.meta.url);
mockModule('../../../../../src/adapters/agents/runtime-matrix.js', import.meta.url);
mockModule('../../../../../src/adapters/verification/verification.js', import.meta.url);
mockModule('../../../../../src/adapters/review/review-gate-handling.js', import.meta.url);
await installModuleMocks();
const { routeIntegrationGateFailure } = await import('../../../../../src/adapters/cli/commands/integrate-gate-rebound.js');
const { createIntegrationGateStep } = await import('../../../../../src/application/integrate/gates.js');
const { createSquashLanding } = await import('../../../../../src/application/integrate/squash.js');
const gates = await import('../../../../../src/adapters/cli/commands/integrate-gates.js');
const integrate = await import('../../../../../src/adapters/cli/commands/integrate.js');
const { createDraftWorkflowAdapter } = await import('../../../../../src/adapters/cli/commands/draft-stats.js');
const { runRebaseWorkflow } = await import('../../../../../src/application/rebase-workflow.js');
const { HandoffCommandUseCase } = await import('../../../../../src/application/handoff-command-use-case.js');
const { setLogger } = await import('../../../../../src/application/presentation/cli-format.js');
const { agentFamily } = await import('../../../../../src/domain/agents.js');
const { missionId, missionLabels } = await import('../../../../../src/domain/mission.js');
const { repositoryId } = await import('../../../../../src/domain/repository.js');
const { applyReviewerCommand, applyImplementerCommand, beginNextReviewRound, changeRevision, ConfiguredReviewerEligibility, currentReviewRound, requestReviewIntervention, reviewFindingId, reviewStatus, startReview } = await import('../../../../../src/domain/review.js');
const { integrationRepairNeedsReview } = await import('../../../../../src/application/integration-repair-review.js');
const { createReviewWorkflowAdapter } = await import('../../../../../src/adapters/review/review-workflow-adapter.js');
const { reviewStateDataFrom } = await import('../../../../../src/adapters/review/review-state-mapping.js');
const { ReviewState } = await import('../../../../../src/adapters/review/review-state.js');
const { getLatestReviewForPr, getLatestReviewDecision } = await import('../../../../../src/adapters/forgejo/forgejo.js');

// ---- task-2565 gate rebound lifecycle (consolidated from test/task-2565-lifecycle-repro.test.ts, TASK-2622.09) ----
describe("gate rebound lifecycle", () => {
  test('TASK-2565: integration-gate rebound reactivates through the lifecycle path', async () => {
    let lifecycleTransitions = 0;
    let backlogTransitions = 0;

    await routeIntegrationGateFailure({
      slug: 'task-2565-fixture',
      missionWorktree: '/tmp/mission',
      baseWorktree: '/tmp/base',
      baseBranch: 'main',
      verificationCommand: 'npm test',
      failedGate: { key: 'unit', command: 'npm test', exitCode: 1, stdout: '', stderr: '' },
      gateError: 'unit failed',
      gates: [],
      implementer: 'codex',
      repositoryId: 'fixture',
      startAgentFn: async () => ({ result: { status: 0 } }),
      transitionTaskFn: async () => { backlogTransitions += 1; },
      reactivateMissionFn: async () => { lifecycleTransitions += 1; },
      captureFinalTreeFn: () => ({ ok: true, rootDir: '/tmp/mission', tree: 'tree' }),
      runPhaseGatesFn: async () => ({ ok: true, phase: 'integration', gates: [], executed: 0, skipped: false, dryRun: false, failedGate: null, error: null }),
      reboundFn: async (_reason, context) => {
        await context.transitionToImplementer?.('task-2565-fixture');
        return { outcome: 'fixed', attempts: 1, diagnostic: '', classification: { failureClass: 'GateFailure', dispatchAction: 'AutoRepair', isRelaunchable: true, label: 'gate' }, implementer: 'codex' };
      },
    } as any);

    assert.equal(lifecycleTransitions, 1);
    assert.equal(backlogTransitions, 0, 'the Backlog mirror must not choose the Mission lifecycle');
  });
});

// ---- task-2603 rebound active mission context (consolidated from test/task-2603-repro.test.ts, TASK-2622.09) ----
describe("rebound active mission context", () => {
  // TASK-2603 — integration rebounds must retain the identity persistence context
  // that ordinary review-loop fallbacks receive.

  const slug = 'task-2603-fixture';
  const missionStore = { load: async () => ({ kind: 'found', mission: { status: 'integration' }, version: 1 }) };
  const reviewState = { implementer: 'claude', reviewer: 'codex', phase: 'approved', round: 2 };
  const taskResolution = { ok: true, taskFile: '/worktree/backlog/tasks/task-2603.md' };

  function assertFallbackContext(options: Record<string, unknown>, worktree: string) {
    assert.equal(options.role, 'implementer');
    assert.equal(options.slug, slug);
    assert.equal(options.worktree, worktree);
    assert.strictEqual(options.state, reviewState, 'without a live review aggregate, fallback receives the original snapshot unchanged');
    assert.equal(options.missionStore, missionStore);
    assert.equal(options.taskResolution, taskResolution);
    assert.equal(options.original, 'claude');
    assert.equal((options.launchResult as { agent: string }).agent, 'codex');
    return 'codex';
  }

  test('TASK-2603/TASK-2651: integration-gate rebound binds active mission context and preserves its snapshot when no live review aggregate exists', async () => {
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

  test('TASK-2651: rebound fallback persists the live current round, not a stale snapshot round', async () => {
    // The integration context was built from round 7. The rebound advances the
    // live aggregate to round 8 before the custom-to-claude fallback persists.
    // Persisting the stale round below
    // the current round trips the TASK-2385 stale-flattened-write guard and
    // drops the fallback identity write. The snapshot must be aligned to the
    // live current round before it is handed to the fallback.
    const contextReview = { kind: 'found', status: 'integration', repositoryId: 'repo', mission: { status: 'integration', repositoryId: 'repo', review: { rounds: [{ number: 7, phase: 'approved', disposition: null, implementer: 'custom', reviewer: 'codex' }] } } };
    const liveReview = { kind: 'found', status: 'integration', repositoryId: 'repo', mission: { status: 'integration', repositoryId: 'repo', review: { rounds: [{ number: 7, phase: 'approved', disposition: null, implementer: 'custom', reviewer: 'codex' }, { number: 8, phase: 'fixing', disposition: null, implementer: 'custom', reviewer: 'codex' }] } } };
    const staleSnapshot = { implementer: 'custom', reviewer: 'codex', phase: 'approved', round: 7 };
    let persistedImplementer = '';

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
      slug, context: { baseWorktree: '/base', taskAssignee: 'claude', branch: `mission/${slug}`, approval: {}, configuredReviewer: null, task: taskResolution, reviewState: staleSnapshot },
      missionLoad: contextReview, missionServices: { store: { load: async () => liveReview }, lifecycle: { transition: async () => ({ status: 'completed' }) } },
      dryRun: false, noIntegrationGates: false, realAgent: null, realAgentModel: null,
      seams: {
        startAgentFn: async () => ({ agent: 'claude', result: { status: 0 } }), transitionTaskFn: () => true,
        applyAgentFallbackFn: (options: Record<string, unknown>) => {
          const state = options.state as { round: number; implementer: string };
          assert.notEqual(state, staleSnapshot, 'a aligned copy is passed, not the stale snapshot');
          assert.equal(state.round, 8, 'the fallback persists the live current round');
          assert.equal(state.implementer, 'custom', 'the snapshot identity is preserved for the fallback to override');
          persistedImplementer = 'claude';
          return 'claude';
        },
        routeIntegrationGateFailureFn: async (options: Record<string, any>) => {
          await options.applyAgentFallbackFn({ original: 'custom', launchResult: { agent: 'claude' } });
          return { route: 'fixed', rebounds: 1 };
        },
      },
    } as never);
    assert.equal(persistedImplementer, 'claude', 'the fallback identity is persisted against live round 8');
  });

  test('TASK-2651: unavailable live aggregate keeps the fallback snapshot', async () => {
    let reads = 0;
    const snapshot = { implementer: 'claude', reviewer: 'codex', phase: 'approved', round: 7 };
    const store = { load: async () => {
      reads += 1;
      if (reads === 1) throw new Error('temporary review aggregate read failure');
      return { kind: 'found', mission: { status: 'integration' }, version: 1 };
    } };
    const { runRequiredLocalGates } = createIntegrationGateStep({
      gates: { resolveIntegrationVerificationWorktree: () => '/mission-worktree', captureFinalIntegrationTree: () => ({ ok: true, rootDir: '/mission-worktree', commit: 'c', tree: 't' }), loadPhaseGates: () => [{ key: 'required', command: 'false', order: 1 }], loadRequirePreIntegration: () => false, runPhaseGates: async () => ({ ok: false, skipped: false, cancelled: false, failedGate: { key: 'required' }, error: 'red' }) },
      landing: { createAbort: () => new Error('abort') }, verification: { formatVerificationCommand: () => 'npm test' },
    } as never);
    await runRequiredLocalGates({
      slug, context: { baseWorktree: '/base', taskAssignee: 'claude', branch: `mission/${slug}`, approval: {}, configuredReviewer: null, task: taskResolution, reviewState: snapshot },
      missionLoad: { kind: 'found', mission: { repositoryId: 'repo' } }, missionServices: { store, lifecycle: { transition: async () => ({ status: 'completed' }) } },
      dryRun: false, noIntegrationGates: false, realAgent: null, realAgentModel: null,
      seams: { startAgentFn: async () => ({ agent: 'codex', result: { status: 0 } }), transitionTaskFn: () => true,
        applyAgentFallbackFn: (options: Record<string, unknown>) => { assert.strictEqual(options.state, snapshot); return 'codex'; },
        routeIntegrationGateFailureFn: async (options: Record<string, any>) => { await options.applyAgentFallbackFn({ original: 'claude', launchResult: { agent: 'codex' } }); return { route: 'fixed', rebounds: 1 }; } },
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
});

// ---- task-2369.05 integrate gate helpers (consolidated from test/task-2369.05-integrate-gates.test.ts, TASK-2622.09) ----
describe("integrate gate helpers", () => {
  // TASK-2369.05 — integration gate helpers now live in `integrate-gates.ts`.
  //
  // The extraction risk is the boundary, not the gate logic (that stays covered
  // by test/integration-pipelines.test.ts): `integrate.ts` must re-export the
  // exact function objects the new module owns rather than keeping a second
  // implementation, and the gate-plan helpers must behave identically when
  // called directly on the new module. Hermetic: the git runner is injected and
  // the config is a fixture, so no worktree, Forgejo, or agent is touched.

  const OWNED = [
    'getIntegrationConfigPath',
    'detectChangedAreas',
    'isIntendedPayloadAtHead',
    'parseFilesToAreas',
    'orderIntegrationGates',
    'gateMatchesChangedAreas',
    'loadIntegrationConfig',
    'getIntegrationGatePlan',
    'printIntegrationGatePlan',
    'buildIntegrationGateEnv',
    'captureFinalIntegrationTree',
    'resolveIntegrationVerificationWorktree',
    'buildIntegrationVerificationInvocation',
    'executeIntegrationGates'
  ] as const;

  const REEXPORTED = OWNED.filter(name => name !== 'getIntegrationConfigPath');

  const INTEGRATE_SOURCE = path.resolve(import.meta.dirname, '../../../../../src/adapters/cli/commands/integrate.ts');

  test('integrate re-exports the extracted gate helpers as the same functions integrate-gates owns', () => {
    for (const name of REEXPORTED) {
      assert.equal(typeof (gates as any)[name], 'function', `${name} missing from integrate-gates.js`);
      assert.equal((integrate as any)[name], (gates as any)[name], `${name} is duplicated instead of re-exported`);
    }
  });

  test('integrate.ts keeps no second implementation of the extracted gate helpers', () => {
    const source = fs.readFileSync(INTEGRATE_SOURCE, 'utf8');
    for (const name of OWNED) {
      assert.equal(source.includes(`function ${name}(`), false, `integrate.ts still defines ${name}`);
    }
  });

  test('integrate-gates owns gate ordering with run_last gates sorted after the rest', () => {
    const ordered = gates.orderIntegrationGates({
      gates: {
        'web-e2e': { command: 'e2e', order: 1, run_last: true },
        workflow: { command: 'wf', order: 5 },
        server: { command: 'srv', order: 2 },
        disabled: { command: 'nope', order: 0, enabled: false }
      }
    });
    assert.deepEqual(ordered.map(gate => gate.key), ['server', 'workflow', 'web-e2e']);
  });

  test('integrate-gates plans only the gates matching the mission changed areas', () => {
    const configPath = path.resolve(import.meta.dirname, '../../../../fixtures/integration-pipelines.json');
    const plan = gates.getIntegrationGatePlan('task-2369.05', {
      dryRun: true,
      configPath,
      rootDir: import.meta.dirname,
      baseBranch: 'main',
      gitRunner: () => ({ status: 0, stdout: 'server/app.ts\n', stderr: '' })
    });
    assert.deepEqual(plan.changedAreas, ['server']);
    assert.deepEqual(plan.gates.map((gate: any) => gate.key), ['server']);
  });

  test('integrate-gates resolves the verification worktree from the mission worktree before the conventional path', () => {
    const resolved = gates.resolveIntegrationVerificationWorktree('task-2369.05', {
      baseWorktree: '/tmp/base',
      resolveWorktreeFn: (slug: string, opts: any) => `${opts.cwd}/wt-${slug}`,
      conventionalWorktreePathFn: () => '/tmp/should-not-be-used'
    });
    assert.equal(resolved, '/tmp/base/wt-task-2369.05');
  });

  test('integrate-gates falls back to the conventional worktree path when the mission worktree is unresolved', () => {
    const invocation = gates.buildIntegrationVerificationInvocation('task-2369.05', {
      baseWorktree: '/tmp/base',
      resolveWorktreeFn: () => null,
      conventionalWorktreePathFn: (slug: string, base: string) => `${base}/conventional-${slug}`,
      formatVerificationCommandFn: (phase: string, cwd: string) => `verify ${phase} in ${cwd}`
    });
    assert.deepEqual(invocation, {
      command: 'verify integrate in /tmp/base/conventional-task-2369.05',
      cwd: '/tmp/base/conventional-task-2369.05'
    });
  });
});

// ---- task-1124 relaunchable repair (consolidated from test/task-1124-integrate.test.ts, TASK-2622.09) ----
describe("relaunchable repair", () => {
  // CP-4 integration tests for task-1124

  const isRelaunchableErrorModule = mockModule<typeof import('../../../../../src/adapters/cli/commands/repair-handoff.js')>('../../../../../src/adapters/cli/commands/repair-handoff.js', import.meta.url);
  const runtimeMatrix = mockModule<typeof import('../../../../../src/adapters/agents/runtime-matrix.js')>('../../../../../src/adapters/agents/runtime-matrix.js', import.meta.url);

  test.afterEach(() => mock.restoreAll());
  const { isRelaunchableError } = isRelaunchableErrorModule;

  test('SC 1: isRelaunchableError returns true for goal-check missing evidence rows', () => {
    const errorMsg = 'The final checkpoint at docs/missions/2026/task-1121/CP-3.md has a "## Goal Check" section but no evidence rows. A goal-check table with real evidence is required before handoff.';
    assert.equal(isRelaunchableError(errorMsg), true);
  });

  test('SC 3: ExecuteHandoffService bounces through the kernel when repair fails and error is relaunchable', () => {
    // TASK-2377.05: `attemptAgentRelaunch` was deleted; the relaunch is a
    // `rebound()` call whose launch port is the injected `startAgentFn`.
    const serviceSource = fs.readFileSync(path.join(import.meta.dirname, '../../../../../src/application/execute-handoff-service.ts'), 'utf8');
    assert.ok(serviceSource.includes('repairLaunch.launch'), 'handoff service should have a typed repair-launch seam');
    assert.ok(serviceSource.includes('rebound('), 'Should bounce through the rebound kernel');
    // Matched on the classifier call rather than one spelling of its argument, so
    // extracting the repair helpers does not silently drop the guard.
    assert.match(serviceSource, /isRelaunchableFailure\(error\)/, 'Should check relaunchability before bouncing');
  });

  test('SC 4: reviewer fallback uses the review eligibility selector', () => {
    const fallbackSource = fs.readFileSync(path.join(import.meta.dirname, '../../../../../src/application/review-loop/reviewer-selection.ts'), 'utf8');
    assert.ok(fallbackSource.includes('const fallback = context.routing.nominate(excluded);'), 'Should select reviewer fallback from the review eligibility pool');
    assert.ok(!fallbackSource.includes('fallbackForFn(reviewer, implementer)'), 'Should not call fallbackFor for reviewer fallback');
    // Verify the implementer check was removed
    assert.ok(!fallbackSource.includes('if (!agents.includes(implementer))') || fallbackSource.includes('// The strict implementer eligibility check was removed'), 'Implementer eligibility check should be removed or commented');
  });

  test('SC 5: reviewer fallback does not update the Backlog task', () => {
    const fallbackSource = fs.readFileSync(path.join(import.meta.dirname, '../../../../../src/adapters/review/review-agent-fallback.ts'), 'utf8');
    assert.ok(!fallbackSource.includes('workflow(${slug}): fallback reviewer from'), 'Should not contain reviewer fallback commit message pattern');
    assert.ok(fallbackSource.includes("if (role === 'implementer' && taskResolution && taskResolution.ok)"), 'Backlog assignee enforcement should be guarded to implementer fallback');
    assert.ok(fallbackSource.includes('enforceTaskAssigneeFn(taskResolution.taskFile, fallback)'), 'Implementer fallback should still enforce Backlog assignee');
  });

  test('SC 6: resume-capable agents use session persistence via startAgent', () => {
    const agentsSource = fs.readFileSync(path.join(import.meta.dirname, '../../../../../src/adapters/agents/agents.ts'), 'utf8');
    const launcherSelectionSource = fs.readFileSync(path.join(import.meta.dirname, '../../../../../src/adapters/agents/launcher-selection.ts'), 'utf8');
    const activeSource = fs.readFileSync(path.join(import.meta.dirname, '../../../../../src/adapters/cli/commands/active.ts'), 'utf8');

    // Verify RESUME_CAPABLE matches the current resume-capable families
    assert.ok(launcherSelectionSource.includes("RESUME_CAPABLE = new Set(['claude', 'codex', 'custom', 'qwen'])"), 'RESUME_CAPABLE should include the current resume-capable agents');
    assert.ok(agentsSource.includes('await launchSessionMarkerPort.shouldResume('), 'startAgent should query the checked session-marker port');

    // Verify the kernel's launch port calls startAgent, which handles resume
    assert.ok(activeSource.includes("startAgentFn('active'"), 'Should call startAgent');
    assert.ok(activeSource.includes("role: 'implementer'"), 'Should pass role as implementer');
  });

  test('SC 8: manual handoff path preserved - outputs manual handoff message when relaunch fails', () => {
    const serviceSource = fs.readFileSync(path.join(import.meta.dirname, '../../../../../src/application/execute-handoff-service.ts'), 'utf8');
    assert.ok(serviceSource.includes('You may need to complete the handoff manually:'), 'Manual handoff message should be preserved');
    assert.ok(serviceSource.includes('px review ${request.slug} --submit'), 'Manual handoff command should be preserved');
  });

  test('runtime-matrix no longer exports hardcoded reviewer routing (reviewerFor/fallbackFor removed)', () => {

    // The biased, hardcoded implementer→reviewer routing has been removed in
    // favor of config-driven, unbiased selectAgent('review', { exclude: [implementer] }).
  // @ts-expect-error -- TASK-2328: partial test double after ESM seam migration
    assert.equal(runtimeMatrix.reviewerFor, undefined, 'reviewerFor must no longer be exported');
  // @ts-expect-error -- TASK-2328: partial test double after ESM seam migration
    assert.equal(runtimeMatrix.fallbackFor, undefined, 'fallbackFor must no longer be exported');
  });
});

// ---- task-2561 handoff and push-gate regressions (consolidated from test/task-2561-repro.test.ts, TASK-2622.09) ----
describe("handoff and push-gate regressions", () => {
  // ---------------------------------------------------------------------------
  // TASK-2561 — no mission could get from the backlog to integration without a
  // human workaround after TASK-2521.03. Each scenario is one stage where a real
  // mission stalled; each fails at the mission's parent commit.
  //
  //  (a) task-2561's own draft: the agent left the contract incomplete, and
  //      `px draft` hard-failed telling the operator to check the database
  //      instead of sending the missing parts back to the agent.
  //  (b) task-2553's push: the push-time gate ran the configured defaultArea
  //      (`all`) while handoff verified, and the evidence reported, the mission
  //      area (`docs`).
  //  (c) task-2553's handoff: the push-gate failure was reduced to "Rebase
  //      failed before handoff", so both repairs re-ran a rebase that worked.
  //  (d) task-2547's integration: a gate repair changed the approved revision
  //      and integration stopped for a manual re-review.
  //  (e) task-2561's own handoff: its checkpoint evidence was recorded and
  //      verified in Mission state, and the gatekeeper still blocked it for
  //      having no CP-*.md file on disk.
  //
  // Nothing here opens a database, launches an agent, runs a gate, or talks to
  // Forgejo: every boundary is a stub.
  // ---------------------------------------------------------------------------

  const INCOMPLETE = 'Cannot refine task-2561: its mission contract is incomplete. Missing a predicted NEL bucket (`px nel set`). Record what is missing, then read it back with `px status task-2561`.';

  function quietly<T>(run: () => Promise<T>): Promise<T> {
    const previous = setLogger({ log: () => {} });
    return run().finally(() => setLogger(previous));
  }

  // --- (a) draft ---------------------------------------------------------------

  test('(a) an incomplete draft contract is sent back to the drafting agent, not reported as a database fault', async () => {
    const logs: string[] = [];
    const errors: string[] = [];
    const exits: number[] = [];
    const repairs: string[] = [];
    let refineCalls = 0;
    const adapter = createDraftWorkflowAdapter({
      exitFn: ((code?: number) => { exits.push(code ?? 0); }) as never,
      logFn: (line: string) => logs.push(line),
      errorFn: (line: string) => errors.push(line),
    } as never);
    const ctx = {
      exited: false, slug: 'task-2561', mainRepo: '/repo', targetWorktree: '/repo-task-2561',
      missionFile: '/repo-task-2561/missions/task-2561/MISSION.md', recordedBase: null, syntheticTask: null,
      agent: 'claude', actualAgent: 'claude', agentResult: null,
      exitFn: () => { throw new Error('unused'); }, logFn: () => {}, errorFn: () => {},
      missionServicesFn: async () => ({
        lifecycle: {
          async transition() {
            refineCalls += 1;
            return refineCalls === 1
              ? { status: 'failed', error: { kind: 'validation', message: INCOMPLETE } }
              : { status: 'completed' };
          },
        },
        store: { async load() { return { kind: 'missing' }; } },
      }),
      options: {
        repairDraftContractFn: async (_slug: string, _worktree: string, agent: string, refusal: string) => {
          repairs.push(`${agent}: ${refusal}`);
          return true;
        },
        enforceDraftCommitSafetyFn: () => true,
        transitionTaskFn: async () => true,
        transitionVirtualFn: async () => true,
      },
    } as unknown as DraftWorkflowContext;

    await quietly(async () => { await adapter.finalTransition(ctx); });

    assert.deepEqual(repairs, [`claude: ${INCOMPLETE}`], 'the refusal goes back to the agent that drafted');
    assert.equal(refineCalls, 2, 'refine is retried after the repair');
    assert.deepEqual(exits, [], `the draft completes: ${errors.join(' | ')}`);
    assert.ok(!logs.concat(errors).some((line) => /operator-local database is reachable/.test(line)));
  });

  // --- (b) push-time gate area ----------------------------------------------------

  test('(b) the push-time gate verifies the mission area, not the configured defaultArea', async () => {
    const createPrOptions: Record<string, unknown>[] = [];
    const ok = { status: 0, stdout: '', stderr: '', signal: null };
    const port = {
      git: (args: string[]) => args.includes('rev-parse') ? { ...ok, stdout: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' } : ok,
      detectRebaseState: () => ({ inProgress: false, unmergedFiles: [] }),
      getCurrentBranch: () => `mission/${SLUG}`,
      cwd: () => '/wt',
      inferSlug: (explicit?: string) => explicit ?? SLUG,
      findMissionDir: () => `/wt/missions/${SLUG}`,
      findMissionArea: () => 'docs',
      resolveWorktree: () => '/wt',
      conventionalWorktreePath: () => '/wt',
      missionBranchName: () => `mission/${SLUG}`,
      resolveMissionBaseBranch: () => 'main',
      missionConflictPathPrefix: () => `missions/${SLUG}/`,
      resolvePromptBaseBranch: () => 'main',
      startAgent: async () => ({ agent: 'claude', result: { status: 0 } }),
      selectAgent: () => 'claude',
      workflowLauncherStatus: () => ({ supported: true, agent: 'claude' }),
      applyAgentFallback: async () => 'claude',
      createPr: (_branch: string, _user: string, _token: string, options: Record<string, unknown>) => {
        createPrOptions.push(options);
        return { ok: true };
      },
      readToken: () => 'token',
      resolveForgejoUser: (user: string | null) => user ?? 'claude',
      fetchReviewBranch: () => ok,
      resolveTaskFile: () => ({ ok: true, taskFile: '/wt/backlog/tasks/task.md', task: {} }),
      getTaskImplementer: () => 'claude',
      transitionTask: async () => undefined,
      resolveReviewIdentity: () => ({ forgejoUser: 'claude' }),
      readReviewState: () => ({ metadata: {} }),
      writeReviewState: () => undefined,
      persistReviewState: async () => undefined,
      isForgejoReviewEnabled: () => true,
      formatVerificationCommand: (area: string) => `./scripts/verify-local.sh ${area}`,
      resolveConflictsForMission: () => ({ ok: true, conflictFiles: [], missionSpecificFiles: [], sharedFiles: [] }),
      missionServices: null,
      exit: () => {},
    } as unknown as RebaseWorkflowPort;

    await quietly(() => runRebaseWorkflow([SLUG, '--push'], port));

    assert.equal(createPrOptions.length, 1, 'the push ran');
    assert.equal(createPrOptions[0].verificationArea, 'docs');
  });

  // --- (c) handoff push-gate evidence ---------------------------------------------

  test('(c) a handoff push-gate failure carries its gate evidence instead of a generic rebase message', async () => {
    const recorder = makeRecorder();
    const gate = {
      area: 'docs', command: './scripts/verify-local.sh docs', exitCode: 1,
      stdout: 'sh: 1: tsx: not found', stderr: 'sh: 1: tsx: not found',
    };
    const ports = makePorts(recorder, {
      rebase: { rebaseBeforeReviewRound: async () => ({ ok: false, sharedFileConflicts: false, hookFailure: false, failure: { kind: 'gate', operation: 'push', gate } }) },
    });

    const result = await new HandoffCommandUseCase(ports).performHandoff(SLUG, runOptions(recorder, { recoverGateFailure: false }));

    assert.equal(result.ok, false);
    assert.doesNotMatch(result.error ?? '', /Rebase failed before handoff/);
    assert.match(result.error ?? '', /verify-local\.sh docs.*exited with code 1/);
    assert.equal(result.gateFailure?.command, gate.command);
    assert.equal(result.gateFailure?.exitCode, 1);
    assert.match(result.gateFailure?.stderr ?? '', /tsx: not found/);
  });

  // --- (d) integration-gate repair re-review ----------------------------------------

  function gateStepPorts(route: Record<string, unknown>): IntegrateWorkflowPorts {
    return {
      gates: {
        resolveIntegrationVerificationWorktree: () => '/wt',
        captureFinalIntegrationTree: () => ({ ok: true, rootDir: '/wt', commit: 'c1', tree: 't1' }),
        loadPhaseGates: () => [{ key: 'quality-gate', command: 'npm run quality', order: 1 }],
        loadRequirePreIntegration: () => true,
        runPhaseGates: async () => ({ ok: false, error: 'quality-gate failed', failedGate: { key: 'quality-gate' } }),
        routeIntegrationGateFailure: async () => route,
      },
      landing: { createAbort: () => new Error('integration aborted'), isAbort: () => true },
      verification: { formatVerificationCommand: () => './scripts/verify-local.sh all' },
    } as unknown as IntegrateWorkflowPorts;
  }

  const REVISION_CHANGED = { route: 'revision-changed', rebounds: 2, repairedRevision: 't2', invalidation: { ok: true } };

  function gateRequest(reReviewFn?: () => Promise<boolean>) {
    return {
      slug: 'task-2547', context: { baseWorktree: '/repo', area: 'all', branch: 'mission/task-2547' },
      missionLoad: { kind: 'found', mission: { repositoryId: 'parallix' } },
      dryRun: false, noIntegrationGates: false, realAgent: null, realAgentModel: null,
      seams: {
        startAgentFn: async () => ({}), transitionTaskFn: () => true, applyAgentFallbackFn: async () => 'claude',
        routeIntegrationGateFailureFn: async () => REVISION_CHANGED,
        ...(reReviewFn ? { reReviewFn } : {}),
      },
    } as never;
  }

  test('(d) a gate repair that changed the approved revision is re-reviewed, then integration stops in the integration lane for the human', async () => {
    const reviewed: string[] = [];
    const { runRequiredLocalGates } = createIntegrationGateStep(gateStepPorts(REVISION_CHANGED));
    await assert.rejects(
      quietly(() => runRequiredLocalGates(gateRequest(async () => { reviewed.push('task-2547'); return true; }))),
      (error: unknown) => (error as Error).name === 'IntegrationStopsForHuman',
    );
    assert.deepEqual(reviewed, ['task-2547'], 'the repaired revision was re-reviewed through the single live route');
  });

  // --- (e) gatekeeper on a typed-verb mission ----------------------------------------

  test('(e) the gatekeeper does not demand CP-*.md from a mission whose checkpoints are recorded in Mission state', async () => {
    const recorder = makeRecorder();
    const gatekeeperOptions: Record<string, unknown>[] = [];
    const ports = makePorts(recorder, {
      missionServices: async () => ({
        checkpoints: { record: async () => ({ status: 'completed' }) },
        lifecycle: { transition: async () => ({ status: 'completed', value: { version: 3 } }) },
        store: {
          load: async () => ({
            kind: 'found',
            mission: {
              checkpoints: [{ name: 'CP-1', goalCheck: [{ criterion: 'works', evidence: 'src/application/handoff-command-use-case.ts:1' }], nextActionText: 'review' }],
              brief: { goal: 'g', why: 'w', scope: 's', outOfScope: [] },
              successCriteria: ['works'],
              completedSuccessCriteria: [0],
              declaredGates: ['npm test'],
            },
            version: 4,
          }),
        },
        handoff: { recordNel: async () => ({ status: 'completed' }) },
      }),
      gatekeeper: {
        runGatekeeper: (_slug: string, options: Record<string, unknown>) => {
          gatekeeperOptions.push(options);
          return options.checkpointsRecorded
            ? { ok: true, missing: [], skipped: false, posted: false }
            : { ok: false, missing: ['missions/task-2332.09/CP-*.md (at least one checkpoint document)'], skipped: true, posted: false };
        },
      },
    });

    const result = await new HandoffCommandUseCase(ports).performHandoff(SLUG, runOptions(recorder));

    assert.equal(gatekeeperOptions.length, 1);
    assert.equal(gatekeeperOptions[0].checkpointsRecorded, true);
    assert.equal(result.ok, true, recorder.errors.join('\n'));
  });
});

// ---- task-2543 integration repair (consolidated from test/task-2543-integration-repair.test.ts, TASK-2622.09) ----
describe("integration repair", () => {
  const slug = 'task-2543';
  const reviewer = agentFamily('claude');
  const implementer = agentFamily('codex');
  const eligibility = ConfiguredReviewerEligibility.fromReviewStep({ eligible: [reviewer], strategy: 'random' });
  const startedAt = '2026-01-01T00:00:00Z';

  function memoryMission(status: Mission['status'] = 'integration') {
    const review = applyReviewerCommand(startReview({
      change: { kind: 'local-branch', sourceBranch: `mission/${slug}`, targetBranch: 'main' },
      revision: changeRevision('approved-commit'),
    }, reviewer, implementer, startedAt, eligibility), {
      type: 'approve', decidedAt: '2026-01-01T00:01:00Z', comment: null, source: { kind: 'local' },
    });
    let mission: Mission = {
      id: missionId(slug), repositoryId: repositoryId('parallix'), title: 'repair',
      labels: missionLabels([]), status, assignee: implementer, review,
      checkpoints: [{ missionId: missionId(slug), name: 'CP-1', rawFilename: null, firstLine: '',
        goalCheck: [{ criterion: 'repair', evidence: 'src/application/handoff-command-use-case.ts', recordedRound: 2 }], nextActionText: 'review' }],
      closedAt: null, netEngineeringLines: null,
    };
    let version = 1;
    const history: Array<{ trigger: string; idempotencyKey: string }> = [];
    const store = {
      async load() { return { kind: 'found' as const, mission, version: version as MissionVersion }; },
      async save(next: Mission, expected: MissionVersion | null) {
        assert.equal(expected, version);
        mission = next;
        return ++version as MissionVersion;
      },
      async saveWithTransition(next: Mission, expected: MissionVersion | null, event: { trigger: string; idempotencyKey: string }) {
        const result = await this.save(next, expected);
        history.push(event);
        return result;
      },
      async findTransitions() { return history; },
    };
    const lifecycle = new MissionLifecycleService(store);
    return { store, lifecycle, history, mission: () => mission };
  }

  async function transition(fixture: ReturnType<typeof memoryMission>, command: Parameters<MissionLifecycleService['transition']>[0]['command']) {
    const loaded = await fixture.store.load();
    const result = await fixture.lifecycle.transition({
      operationId: 'test', missionId: missionId(slug), expectedVersion: loaded.version,
      capabilities: new Set(['mission:transition']), command, actor: implementer,
      occurredAt: new Date().toISOString(), idempotencyKey: `test:${loaded.version}`,
    });
    assert.equal(result.status, 'completed', result.error?.message);
  }

  test('an unchanged transient integration-gate retry stays approved and continues landing (TASK-2644)', async () => {
    const fixture = memoryMission();
    let gateRuns = 0;
    let launches = 0;
    const taskTransitions: string[] = [];
    const failedGate = { key: 'agent-smoke', command: 'agent-smoke', exitCode: 1, stdout: '', stderr: 'temporary model capacity' };
    const ports = {
      gates: {
        resolveIntegrationVerificationWorktree: () => '/fixture',
        captureFinalIntegrationTree: () => ({ ok: true, rootDir: '/fixture', commit: 'approved', tree: 'approved' }),
        loadPhaseGates: () => [{ key: 'agent-smoke', command: 'agent-smoke', order: 1 }],
        loadRequirePreIntegration: () => true,
        runPhaseGates: async () => ++gateRuns === 1 ? { ok: false, failedGate, error: 'temporary model capacity' } : { ok: true },
      },
      landing: { createAbort: () => Object.assign(new Error('aborted'), { name: 'IntegrationAbort' }) },
      verification: { formatVerificationCommand: () => 'agent-smoke' },
    };
    const step = createIntegrationGateStep(ports as never);
    const previous = setLogger({ log: () => {} });
    try {
      const result = await step.runRequiredLocalGates({
        slug, context: { taskAssignee: implementer, baseWorktree: '/fixture', area: 'all', branch: `mission/${slug}`, approval: { ok: true } },
        missionLoad: await fixture.store.load(), missionServices: fixture,
        dryRun: false, noIntegrationGates: false, realAgent: null, realAgentModel: null,
        seams: {
          applyAgentFallbackFn: async () => implementer,
          transitionTaskFn: async (_slug: string, status: string) => { taskTransitions.push(status); return true; },
          startAgentFn: async () => { launches += 1; return { agent: implementer, result: { status: 0 } } as never; },
          routeIntegrationGateFailureFn: async options => routeIntegrationGateFailure({
            ...options,
            captureFinalTreeFn: ports.gates.captureFinalIntegrationTree as never,
            runPhaseGatesFn: ports.gates.runPhaseGates as never,
            invalidateApprovalFn: async () => { throw new Error('unchanged transient retry must not retract approval'); },
          }),
        },
      } as never);

      assert.equal(result, '1 integration gate(s) passed after 0 integration-gate rebound(s)');
      assert.equal(gateRuns, 2, 'the outer failure and unchanged retry both ran');
      assert.equal(launches, 0, 'a green transient retry does not launch an implementer');
      assert.equal(fixture.mission().status, 'integration');
      assert.equal(reviewStatus(fixture.mission().review!), 'approved');
      assert.deepEqual(fixture.history, []);
      assert.deepEqual(taskTransitions, ['ready-for-integration']);
    } finally { setLogger(previous); }
  });

  test('integration repair withdraws approval before launch, survives review pingpong, and requests integration restart', async () => {
    const fixture = memoryMission();
    let providerRetracted = false;
    let repaired = false;
    const failedGate = { key: 'integration', command: 'gate', exitCode: 1, stdout: '', stderr: 'regression' };
    const ports = {
      gates: {
        resolveIntegrationVerificationWorktree: () => '/fixture',
        captureFinalIntegrationTree: () => ({ ok: true, rootDir: '/fixture', commit: repaired ? 'repair' : 'approved', tree: repaired ? 'repair' : 'approved' }),
        loadPhaseGates: () => [{ key: 'integration', command: 'gate', order: 1 }],
        loadRequirePreIntegration: () => true,
        runPhaseGates: async () => repaired ? { ok: true } : { ok: false, failedGate, error: 'red' },
      },
      landing: { createAbort: () => Object.assign(new Error('aborted'), { name: 'IntegrationAbort' }) },
      verification: { formatVerificationCommand: () => 'gate' },
    };
    const step = createIntegrationGateStep(ports as never);
    const previous = setLogger({ log: () => {} });
    try {
      await assert.rejects(step.runRequiredLocalGates({
        slug, context: { taskAssignee: implementer, baseWorktree: '/fixture', area: 'all', branch: `mission/${slug}` },
        missionLoad: await fixture.store.load(), missionServices: fixture,
        dryRun: false, noIntegrationGates: false, realAgent: null, realAgentModel: null,
        seams: {
          applyAgentFallbackFn: async () => implementer,
          transitionTaskFn: async () => true,
          startAgentFn: async () => {
            const review = fixture.mission().review!;
            assert.equal(fixture.mission().status, 'active');
            assert.equal(reviewStatus(review), 'awaiting-review');
            assert.ok(review.rounds[0].decision?.kind === 'approved' && review.rounds[0].decision.revocation);
            assert.equal(providerRetracted, true, 'provider approval is retracted before repair launches');
            repaired = true;
            return { agent: implementer, result: { status: 0 } } as never;
          },
          routeIntegrationGateFailureFn: async options => routeIntegrationGateFailure({
            ...options,
            captureFinalTreeFn: ports.gates.captureFinalIntegrationTree as never,
            runPhaseGatesFn: ports.gates.runPhaseGates as never,
            invalidateApprovalFn: async () => { providerRetracted = true; return { ok: true, dismissed: ['custom'], errors: [] }; },
            reboundFn: (async (_reason: unknown, context: any) => {
              await context.transitionToImplementer(slug);
              await context.startAgent();
              assert.equal((await context.verify()).ok, true);
              return { outcome: 'fixed', implementer, attempts: 1 };
            }) as never,
          }),
          reReviewFn: async () => {
            let review = fixture.mission().review!;
            const round = currentReviewRound(review);
            review = { ...review, rounds: [...review.rounds.slice(0, -1), {
              ...round, subject: { ...round.subject, revision: changeRevision('repair') },
            }] as unknown as typeof review.rounds };
            await transition(fixture, { type: 'submit-for-review', gatesPassed: true, review, reviewerEligibility: eligibility });
            review = applyReviewerCommand(review, { type: 'request-changes', decidedAt: new Date().toISOString(), comment: null,
              findings: [{ id: reviewFindingId('F1'), summary: 'one more repair', location: null }] });
            await transition(fixture, { type: 'request-changes', review });
            review = applyImplementerCommand(review, { type: 'submit-resolution', respondedAt: new Date().toISOString(),
              resultingRevision: changeRevision('repair-2'), resolutions: [{ findingId: reviewFindingId('F1'), kind: 'fixed', evidence: 'fixed' }] });
            review = beginNextReviewRound(review, reviewer, implementer, new Date().toISOString(), eligibility);
            await transition(fixture, { type: 'submit-for-review', gatesPassed: true, review, reviewerEligibility: eligibility });
            review = applyReviewerCommand(review, { type: 'approve', decidedAt: new Date().toISOString(), comment: null, source: { kind: 'local' } });
            await transition(fixture, { type: 'approve', review });
            return true;
          },
        },
      }), error => (error as Error).name === 'IntegrationStopsForHuman');
      assert.equal(fixture.mission().status, 'integration');
      assert.equal(fixture.mission().review!.rounds.length, 3);
      assert.equal(currentReviewRound(fixture.mission().review!).subject.revision, 'repair-2');
      assert.deepEqual(fixture.history.map(event => event.trigger), ['rebound-to-active', 'submit-for-review', 'request-changes', 'submit-for-review', 'approve']);
    } finally { setLogger(previous); }
  });

  test('operator continue clears escalation and permits an attempt even when its old round limit was exhausted', async () => {
    const fixture = memoryMission('review');
    const approved = fixture.mission().review!;
    const pending = startReview(approved.rounds[0].subject, reviewer, implementer, startedAt, eligibility);
    const rounds = Array.from({ length: 9 }, (_, index) => ({ ...pending.rounds[0], number: index + 1 }));
    const review = requestReviewIntervention({ ...pending, rounds: rounds as unknown as typeof pending.rounds,
      stageLaunches: [{ stageKey: 'review', fingerprints: ['prior-launch'] }] }, {
      requestedAt: startedAt, requestedBy: 'workflow', reason: 'MAX_ATTEMPTS',
    });
    await fixture.store.save({ ...fixture.mission(), review }, (await fixture.store.load()).version);
    let continued = false;
    const adapter = createReviewWorkflowAdapter({
      missionStore: fixture.store, inferSlugFn: () => slug, resolveWorktreeFn: () => '/fixture',
      readReviewStateFn: async () => ReviewState.from(slug, reviewStateDataFrom(fixture.mission().review!)),
      createEventFn: async () => undefined as never, run: (() => ({ stdout: 'operator' })) as never,
      log: () => {}, error: () => {}, exit: (() => { throw new Error('must resume'); }) as never,
      reviewLoopMechanisms: request => {
        continued = true;
        assert.equal(fixture.mission().review!.intervention, null);
        assert.deepEqual(fixture.mission().review!.stageLaunches, []);
        assert.equal(request.isContinue, true);
        assert.ok(request.maxAttempts >= 9);
        // The loop itself is not exercised: a held controller fence declines it.
        return fakeReviewLoopPorts({ lock: { tryAcquire: () => false, release: () => {} } }).ports;
      },
    });
    const context = await adapter.preflight([slug, '--continue', '--max-attempts', '1']);
    await adapter.continue(context!);
    assert.equal(continued, true);
  });

  test('a repair review cannot consume an old or unassigned provider approval', async () => {
    const result = await getLatestReviewForPr(1, 'claude', '2026-01-01T00:03:00Z', 'fake', {
      apiCall: async () => ({ ok: true, data: [
        { user: { login: 'claude' }, state: 'APPROVED', submitted_at: '2026-01-01T00:01:00Z' },
        { user: { login: 'custom' }, state: 'APPROVED', submitted_at: '2026-01-01T00:04:00Z' },
      ] }),
    });
    assert.equal(result, null);
  });

  test('the real handoff binds an invalidated round to the committed repair and mirrors the review lane', async () => {
    const fixture = memoryMission();
    await transition(fixture, { type: 'rebound-to-active', agent: implementer, cause: { kind: 'integration-gate-failure', gate: 'unit' }, occurredAt: new Date().toISOString() });
    const recorder = makeRecorder();
    const base = makePorts(recorder);
    const ports = makePorts(recorder, {
      missionServices: async () => ({ ...fixture,
        handoff: { recordNel: async () => ({ status: 'completed' }) },
        checkpoints: { record: async () => ({ status: 'completed' }) },
      }),
      git: { ...base.git, git: args => args.includes('rev-parse') && args.includes('HEAD')
        ? { status: 0, stdout: 'committed-repair\n', stderr: '' } : base.git.git(args) },
      reviewIdentity: { resolveReviewIdentity: async () => ({ forgejoUser: 'codex' }) },
      agentSelection: { eligibleAgentsForStep: () => ['claude', 'codex'], selectAgent: () => 'claude' },
    });
    const result = await new HandoffCommandUseCase(ports).performHandoff(slug, runOptions(recorder));
    assert.equal(result.ok, true, result.error);
    assert.equal(fixture.mission().status, 'review');
    assert.equal(currentReviewRound(fixture.mission().review!).subject.revision, 'committed-repair');
    assert.equal(fixture.mission().review!.rounds[0].subject.revision, 'approved-commit');
    assert.ok(recorder.transitions.includes('review'));
  });

  test('integration excludes a legacy approval from an earlier round but retains its holder for retraction', () => {
    const decision = getLatestReviewDecision(`mission/${slug}`, {
      token: 'fake', reviewerUser: 'claude', sinceIso: '2026-01-01T00:03:00Z',
      apiCall: (_method: string, url: string) => ({ ok: true, data: url.includes('/reviews')
        ? [{ user: { login: 'claude' }, state: 'APPROVED', submitted_at: '2026-01-01T00:01:00Z' }]
        : [{ number: 1, head: { ref: `mission/${slug}` } }] }),
    });
    assert.equal(decision.reviewerApproved, false);
    assert.equal(decision.reviewState, null);
  });

  for (const route of ['limit-reached', 'revision-changed'] as const) {
    test(`a ${route} repair route leaves the old approval invalid and continuation available`, async () => {
      const fixture = memoryMission();
      let reviewed = false;
      const step = createIntegrationGateStep({
        gates: {
          resolveIntegrationVerificationWorktree: () => '/fixture',
          captureFinalIntegrationTree: () => ({ ok: true, rootDir: '/fixture', commit: 'old', tree: 'old' }),
          loadPhaseGates: () => [{ key: 'gate', command: 'gate', order: 1 }],
          loadRequirePreIntegration: () => true,
          runPhaseGates: async () => ({ ok: false, failedGate: { key: 'gate' }, error: 'red' }),
        },
        landing: { createAbort: () => Object.assign(new Error('aborted'), { name: 'IntegrationAbort' }) },
        verification: { formatVerificationCommand: () => 'gate' },
      } as never);
      const previous = setLogger({ log: () => {} });
      try {
        await assert.rejects(step.runRequiredLocalGates({
          slug, context: { taskAssignee: implementer, area: 'all', baseWorktree: '/fixture' },
          missionLoad: await fixture.store.load(), missionServices: fixture,
          dryRun: false, noIntegrationGates: false, realAgent: null, realAgentModel: null,
          seams: {
            transitionTaskFn: async () => true, startAgentFn: async () => { throw new Error('no launch'); },
            applyAgentFallbackFn: async () => implementer,
            routeIntegrationGateFailureFn: async () => ({ route, rebounds: 2, repairedRevision: 'new', invalidation: { ok: false } } as never),
            reReviewFn: async () => { reviewed = true; return false; },
          },
        }), { name: 'IntegrationAbort' });
        assert.equal(integrationRepairNeedsReview(fixture.mission()), true);
        assert.equal(reviewed, route === 'revision-changed', 'failed provider retraction does not prevent the fresh review');
      } finally { setLogger(previous); }
    });
  }
});

// ---- task-1268 diff-scoped gate area (consolidated from test/task-1268-diff-scoped-area.test.ts, TASK-2622.09) ----
describe("diff-scoped gate area", () => {
  const detectAreasFromChangedFilesModule = mockModule<typeof import('../../../../../src/adapters/verification/verification.js')>('../../../../../src/adapters/verification/verification.js', import.meta.url);
  const runPreReviewGateModule = mockModule<typeof import('../../../../../src/adapters/review/review-gate-handling.js')>('../../../../../src/adapters/review/review-gate-handling.js', import.meta.url);

  test.afterEach(() => mock.restoreAll());
  const { detectAreasFromChangedFiles, detectMissionChangedArea } = detectAreasFromChangedFilesModule;
  const { runPreReviewGate } = runPreReviewGateModule;
  test('detectAreasFromChangedFiles maps changed lib files to the lib verification area', () => {
    assert.deepEqual(detectAreasFromChangedFiles('lib/review/review-loop.ts\ntest/review.test.js\n'), ['lib', 'workflow']);
  });

  test('detectMissionChangedArea selects an area from the mission worktree diff', () => {
    const result = detectMissionChangedArea('/tmp/mission', '/tmp/worktree', {
      baseBranch: 'main',
      gitRunner: () => ({ status: 0, stdout: 'lib/core/verification.ts\n', stderr: '', signal: null }),
    });
    assert.equal(result, 'lib');
  });

  test('detectMissionChangedArea selects the strict all area for mixed-area diffs', () => {
    const result = detectMissionChangedArea('/tmp/mission', '/tmp/worktree', {
      baseBranch: 'main',
      gitRunner: () => ({ status: 0, stdout: 'docs/adr/decision.md\nlib/core/verification.ts\n', stderr: '', signal: null }),
    });
    assert.equal(result, 'all');
  });

  test('runPreReviewGate runs the diff-scoped resolver and executes its selected area', async () => {
    const root = registeredMkdtemp('task-1268-area-');
    try {
      const missionDir = path.join(root, 'missions', 'task-1268');
      fs.mkdirSync(missionDir, { recursive: true });
      fs.writeFileSync(path.join(missionDir, 'MISSION.md'), '# Mission');
      fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({
        product: { name: 'Test' },
        adapters: {
          missions: { baseDir: 'missions' },
          verification: { command: 'echo area={{area}}', defaultArea: 'docs' },
        },
      }));

      const resolverCalls = [];
      const commands = [];
      const result = await runPreReviewGate('task-1268', root, {
        resolveEffectiveAreaFn: (area, worktree, resolvedMissionDir) => {
          resolverCalls.push({ area, worktree, resolvedMissionDir });
          return 'all';
        },
  // @ts-expect-error -- TASK-2328: partial test double after ESM seam migration
        runFn: (_command, args) => {
          commands.push(args[1]);
          return { status: 0, stdout: 'area=all\n', stderr: '' };
        },
        log: () => {},
        error: () => {},
      });

      assert.equal(result.ok, true);
      assert.equal(result.area, 'all');
      assert.deepEqual(resolverCalls, [{ area: undefined, worktree: root, resolvedMissionDir: missionDir }]);
      assert.deepEqual(commands, ['echo area=all']);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
