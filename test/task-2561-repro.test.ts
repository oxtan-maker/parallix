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
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDraftWorkflowAdapter } from '../src/adapters/cli/commands/draft-stats.js';
import { runRebaseWorkflow } from '../src/application/rebase-workflow.js';
import { HandoffCommandUseCase } from '../src/application/handoff-command-use-case.js';
import { createIntegrationGateStep } from '../src/application/integrate/gates.js';
import { setLogger } from '../src/application/presentation/cli-format.js';
import type { DraftWorkflowContext } from '../src/application/ports/cli-workflows.js';
import type { RebaseWorkflowPort } from '../src/application/ports/rebase-workflow.js';
import type { IntegrateWorkflowPorts } from '../src/application/ports/integrate-workflow.js';
import { SLUG, makePorts, makeRecorder, runOptions } from './helpers/handoff-ports.js';

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
    git: () => ok,
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

test('(d) a gate repair that changed the approved revision is re-reviewed and integration restarts on the approval', async () => {
  const reviewed: string[] = [];
  const { runRequiredLocalGates } = createIntegrationGateStep(gateStepPorts(REVISION_CHANGED));
  await assert.rejects(
    quietly(() => runRequiredLocalGates(gateRequest(async () => { reviewed.push('task-2547'); return true; }))),
    (error: unknown) => (error as Error).name === 'IntegrationRestartRequired',
  );
  assert.deepEqual(reviewed, ['task-2547']);
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
