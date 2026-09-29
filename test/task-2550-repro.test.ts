// ---------------------------------------------------------------------------
// TASK-2550 — red-to-green reproduction for the automatic revbounce.
//
// The reported scenario: `px integrate` runs, an integration gate goes red,
// the implementer repair is committed, the identical gate set re-runs green,
// but the repair changed the approved revision. Before the fix the
// revision-changed route dead-ended with the human-facing abort
// "must go back through review: run px review <slug> --start ...", and the
// follow-up `px integrate` additionally hit the stale-state error
// "stored approval without the required provider approval" because the
// retracted approval left a stored approval the provider no longer
// corroborated.
//
// After the fix the workflow automatically starts a new review round for the
// repaired revision (the review-resume seam) and re-reads the approval for
// that revision: an approval continues the integration through the merge in
// the same invocation, and anything else aborts before any merge with a
// precise operator message. The TASK-2528 invariant is unchanged: a mission
// never merges under an approval recorded against a different revision.
//
// Red at the mission parent commit: the integration gate step has no
// revision-changed resume, so it aborts instead of resuming the review and
// the seam is never invoked. Green after the fix.
//
// Nothing here opens a database, launches an agent, executes a gate, or talks
// to Forgejo: every boundary is injected.
// ---------------------------------------------------------------------------
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { mockModule, installModuleMocks } from './lib/module-mock.js';
import { createIntegrationGateStep } from '../src/application/integrate/gates.js';
import { createMissionRecovery } from '../src/application/integrate/recovery.js';
import { IntegrationAbort } from '../src/adapters/cli/commands/integrate-post.js';
import { setLogger } from '../src/application/presentation/cli-format.js';
import type { IntegrateWorkflowPorts } from '../src/application/ports/integrate-workflow.js';
import { IntegrationRestartRequired, type IntegrateSeams, type ReviewResumeOptions } from '../src/application/integrate/gates.js';
import { decideMission } from '../src/domain/mission-workflow.js';
import { agentFamily } from '../src/domain/agents.js';

const reviewLoop = mockModule<typeof import('../src/adapters/review/review-loop.js')>('../src/adapters/review/review-loop.js', import.meta.url);
await installModuleMocks();
const { createIntegratePorts } = await import('../src/adapters/cli/commands/integrate.js');
// No `mock.restoreAll()` afterEach here: restoreAll also unregisters the
// module mock, and the concrete-seam tests below run after the injected-seam
// tests in this file.

const SLUG = 'task-2550-fixture';
const BRANCH = `mission/${SLUG}`;
const REVIEWER = 'qwen';
const APPROVED = 'approved-tree';
const REPAIRED = 'repaired-tree';

const FAILED_GATE = {
  key: 'integration-suite',
  command: 'npm run test:integration',
  exitCode: 1,
  stdout: '',
  stderr: 'test/integration/landing.test.ts:42 failed',
};

/** Mutable harness state shared by the injected boundaries. */
interface Harness {
  /** The mission worktree HEAD, as the gate runner and the recovery observe it. */
  head: { commit: string; tree: string };
  /** The provider approval a re-read sees. */
  freshApproval: any;
  routeCalls: Array<Record<string, unknown>>;
  resumeCalls: ReviewResumeOptions[];
  approvalReads: Array<{ branch: string; options: Record<string, unknown> }>;
}

function harness(freshApproval: any): Harness {
  return {
    head: { commit: 'approved-commit', tree: APPROVED },
    freshApproval,
    routeCalls: [],
    resumeCalls: [],
    approvalReads: [],
  };
}

/**
 * Capture the workflow's operator log without touching the process streams
 * (mocking `process.stdout.write` in this runner swallows the test
 * reporter's own output). `setLogger` swaps the fmt sink the whole workflow
 * logs through.
 */
async function withCapturedOutput<T>(fn: () => Promise<T>): Promise<{ result: T; said: string }> {
  const chunks: string[] = [];
  const restore = setLogger({ log: text => chunks.push(String(text)), error: text => chunks.push(String(text)) });
  try {
    const result = await fn();
    return { result, said: chunks.join('\n') };
  } finally {
    setLogger(restore);
  }
}

function gateStepPorts(h: Harness): IntegrateWorkflowPorts {
  return {
    gates: {
      resolveIntegrationVerificationWorktree: () => '/tmp/mission',
      captureFinalIntegrationTree: () => ({ ok: true, rootDir: '/tmp/mission', commit: h.head.commit, tree: h.head.tree }),
      loadPhaseGates: () => [{ key: FAILED_GATE.key, command: FAILED_GATE.command, order: 3 }],
      loadRequirePreIntegration: () => false,
      // The first integration run is red; the rebound kernel's re-run of the
      // identical gate set (inside the route) is green after the repair.
      runPhaseGates: async () => ({
        ok: false,
        phase: 'integration',
        skipped: false,
        dryRun: false,
        executed: 1,
        failedGate: FAILED_GATE,
        error: `Repository gate "${FAILED_GATE.key}" exited with code 1 for integration.`,
      }),
    },
    landing: { createAbort: () => new IntegrationAbort() },
    verification: { formatVerificationCommand: () => './scripts/verify-local.sh all' },
    forgejo: {
      getLatestReviewDecision: () => {
        throw new Error('the production approval reader must not run in this test; inject readApprovalFn');
      },
    },
  } as unknown as IntegrateWorkflowPorts;
}

/**
 * The integration-gate rebound as the gate step sees it: the gate failed, the
 * implementer repair committed a new tree, the identical gate set re-ran
 * green, and the repair changed the approved revision.
 */
function revisionChangedRouteSeam(h: Harness, changeRevision: boolean) {
  return async (opts: Record<string, unknown>) => {
    h.routeCalls.push(opts);
    if (changeRevision) { h.head = { commit: 'repaired-commit', tree: REPAIRED }; }
    return changeRevision
      ? { route: 'revision-changed', rebounds: 1, approvedRevision: APPROVED, repairedRevision: REPAIRED, invalidation: { ok: true, retracted: [REVIEWER], errors: [] } }
      : { route: 'fixed', rebounds: 1 };
  };
}

function baseContext(configuredReviewer: string | null): any {
  return {
    slug: SLUG,
    branch: BRANCH,
    baseWorktree: '/tmp/base',
    baseBranch: 'main',
    taskAssignee: 'codex',
    configuredReviewer,
    forgejoUser: 'default',
    forgejoToken: 'token-for-default',
    // The standing approval the reviewer gave to the pre-repair revision.
    approval: { ok: true, reviewState: 'APPROVED', reviewerApproved: true, reviewerApprovedAt: '2026-09-16T10:00:00Z' },
  };
}

function gateSeams(h: Harness, overrides: Partial<IntegrateSeams> = {}): IntegrateSeams {
  return {
    startAgentFn: (async () => { throw new Error('no agent launch on the automatic path'); }) as never,
    transitionTaskFn: (async () => true) as never,
    applyAgentFallbackFn: (async () => 'codex') as never,
    routeIntegrationGateFailureFn: revisionChangedRouteSeam(h, true),
    resumeReviewFn: async (options: ReviewResumeOptions) => { h.resumeCalls.push(options); return REVIEWER; },
    readApprovalFn: (branch: string, options: Record<string, unknown>) => {
      h.approvalReads.push({ branch, options });
      return h.freshApproval;
    },
    ...overrides,
  };
}

async function runGates(context: any, seams: IntegrateSeams, h: Harness) {
  const { runRequiredLocalGates } = createIntegrationGateStep(gateStepPorts(h));
  return await runRequiredLocalGates({
    slug: SLUG,
    context,
    missionLoad: { kind: 'found', mission: { repositoryId: 'parallix' } },
    // The repro does not exercise the reactivation path (mission stays out of
    // the integration lane in these fixtures), so no mission services are bound.
    missionServices: null,
    dryRun: false,
    noIntegrationGates: false,
    realAgent: null,
    realAgentModel: null,
    seams,
  });
}

test('TASK-2550: a revision-changing gate repair auto-resumes review and restarts integration on approval', async () => {
  const freshApproval = { ok: true, reviewState: 'APPROVED', reviewerApproved: true, reviewerApprovedAt: '2026-09-22T12:00:00Z' };
  const h = harness(freshApproval);
  const context = baseContext(REVIEWER);

  const { said } = await withCapturedOutput(() =>
    assert.rejects(runGates(context, gateSeams(h), h), (error: unknown) => error instanceof IntegrationRestartRequired));

  // SC1: the workflow started a review round for the repaired revision with
  // no human `px review --start` invocation.
  assert.equal(h.resumeCalls.length, 1, 'the review-resume seam is invoked exactly once');
  assert.equal(h.resumeCalls[0]!.revision, REPAIRED, 'the resumed round targets the post-repair revision, not the pre-repair one');
  assert.notEqual(h.resumeCalls[0]!.revision, APPROVED);
  assert.equal(h.resumeCalls[0]!.slug, SLUG);
  assert.equal(h.resumeCalls[0]!.branch, BRANCH);
  // SC2: the same invocation restarts with fresh approval and gate state.
  // The fresh approval replaces the retracted one for the downstream recovery.
  assert.equal(context.approval, freshApproval, 'the re-read approval for the repaired revision becomes the integration approval');
  assert.equal(h.approvalReads.length, 1, 'the approval is re-read once, for the mission branch');
  assert.equal(h.approvalReads[0]!.branch, BRANCH);
  assert.equal(h.approvalReads[0]!.options.reviewerUser, REVIEWER);
  assert.ok(h.approvalReads[0]!.options.sinceIso, 'the approval must come from the new review window');
  // SC2: the human-facing abort is no longer emitted on the recoverable path.
  assert.doesNotMatch(said, /must go back through review/);
});

test('TASK-2550: the merge continues only when the repaired revision is approved (request-changes refuses the merge)', async () => {
  const h = harness({ ok: true, reviewState: 'REQUEST_CHANGES', reviewerApproved: false, defaultUserApproved: false });
  const context = baseContext(REVIEWER);

  await assert.rejects(
    runGates(context, gateSeams(h), h),
    (error: unknown) => error instanceof IntegrationAbort,
    'a non-approved re-review must abort before the merge',
  );
  assert.equal(h.resumeCalls.length, 1, 'the re-review still started; the refusal is the approval re-read, not the resume');
  assert.notEqual(context.approval?.reviewState, 'APPROVED', 'the retracted approval is never restored');
});

test('TASK-2550: an approval from another reviewer cannot authorize the repaired revision', async () => {
  const h = harness({ ok: true, reviewState: 'APPROVED', reviewerApproved: false, defaultUserApproved: true });
  const context = baseContext(REVIEWER);

  await assert.rejects(runGates(context, gateSeams(h), h), (error: unknown) => error instanceof IntegrationAbort);
  assert.equal(h.resumeCalls.length, 1);
});

test('TASK-2550: approval is checked against the reviewer selected by handoff', async () => {
  const h = harness({ ok: true, reviewState: 'APPROVED', reviewerApproved: true, reviewerApprovedAt: '2026-09-22T12:00:00Z' });
  const context = baseContext(REVIEWER);
  const seams = gateSeams(h, { resumeReviewFn: async options => { h.resumeCalls.push(options); return 'claude'; } });
  await assert.rejects(runGates(context, seams, h), (error: unknown) => error instanceof IntegrationRestartRequired);
  assert.equal(h.approvalReads[0]?.options.reviewerUser, 'claude');
});

test('TASK-2550: failed approval retraction prevents automatic review and merge', async () => {
  const h = harness({ ok: true, reviewState: 'APPROVED', reviewerApproved: true });
  const context = baseContext(REVIEWER);
  const seams = gateSeams(h, { routeIntegrationGateFailureFn: async () => ({
    route: 'revision-changed',
    rebounds: 1,
    approvedRevision: APPROVED,
    repairedRevision: REPAIRED,
    invalidation: { ok: false, retracted: [], errors: ['token unavailable'] },
  }) });

  await assert.rejects(runGates(context, seams, h), (error: unknown) => error instanceof IntegrationAbort);
  assert.equal(h.resumeCalls.length, 0);
  assert.equal(h.approvalReads.length, 0);
});

test('TASK-2550: a non-approved re-review ends in a precise operator message naming the blocking condition', async () => {
  const h = harness({ ok: true, reviewState: 'REQUEST_CHANGES', reviewerApproved: false, defaultUserApproved: false });
  const context = baseContext(REVIEWER);

  const { said } = await withCapturedOutput(() =>
    assert.rejects(runGates(context, gateSeams(h), h), (error: unknown) => error instanceof IntegrationAbort));

  assert.match(said, new RegExp(REPAIRED), 'the blocking condition names the repaired revision');
  assert.match(said, /REQUEST_CHANGES/, 'the blocking condition names the review state that blocks the merge');
  assert.match(said, /does not merge/i, 'the operator is told the integration does not merge');
});

test('TASK-2550: an unreadable approval re-read refuses the merge', async () => {
  const h = harness({ ok: false, error: 'api-failed', reviewState: null });
  const context = baseContext(REVIEWER);

  const { said } = await withCapturedOutput(() =>
    assert.rejects(runGates(context, gateSeams(h), h), (error: unknown) => error instanceof IntegrationAbort));

  assert.match(said, new RegExp(REPAIRED), 'the operator is told which revision is blocked');
  assert.match(said, /api-failed/, 'the unreadable re-read is named');
});

test('TASK-2550: when no automatic review seam is wired the human route stands unchanged', async () => {
  const h = harness({ ok: true, reviewState: 'APPROVED', reviewerApproved: true, reviewerApprovedAt: '2026-09-22T12:00:00Z' });
  const context = baseContext(REVIEWER);
  const seams = gateSeams(h);
  delete seams.resumeReviewFn;

  const { said } = await withCapturedOutput(() =>
    assert.rejects(runGates(context, seams, h), (error: unknown) => error instanceof IntegrationAbort));

  assert.equal(h.resumeCalls.length, 0, 'no review round starts without the seam');
  assert.match(said, /must go back through review/, 'the fallback keeps the human re-review instruction');
  assert.match(said, new RegExp(REPAIRED), 'the fallback names the repaired revision');
});

// ── The post-retraction approval state and the automatic path ──────────────

function retractedStateMission(status: 'active' | 'review') {
  // The mission after the rebound: the lane is back to `active` (or already
  // `review` after the auto re-review handoff), and the Review aggregate still
  // records the pre-repair round the retraction invalidated on the provider.
  return {
    id: `task-2550-fixture`,
    repositoryId: 'parallix',
    title: 'fixture',
    labels: [],
    assignee: 'codex',
    checkpoints: [],
    review: {
      rounds: [{
        number: 1,
        subject: { change: { kind: 'local-branch', sourceBranch: BRANCH, targetBranch: 'main' }, revision: APPROVED },
        reviewer: REVIEWER,
        implementer: 'codex',
        startedAt: '2026-09-16T10:00:00Z',
        decision: { kind: 'approved', decidedAt: '2026-09-16T10:30:00Z', comment: null, source: { kind: 'provider', provider: 'forgejo' } },
        response: null,
        phase: 'approved',
        disposition: 'APPROVED',
        reviewerRetryCount: 0,
        implementerRetryCount: 0,
      }],
      intervention: null,
      stageLaunches: [],
      reviewEvents: [],
    },
    netEngineeringLines: null,
    status,
    closedAt: null,
  } as any;
}

function recoveryServices(afterTransitionStatus: 'active' | 'review') {
  const transitions: Array<{ operationId: string; command: { type: string } }> = [];
  return {
    transitions,
    // The recovery module destructures `backlog`/`landing` and defaults its
    // submit-for-review seam off `ports.review`.
    ports: { landing: { createAbort: () => new IntegrationAbort() }, backlog: {}, review: { submitForReview: async () => { throw new Error('submit-for-review is not reached in these scenarios'); } } } as unknown as IntegrateWorkflowPorts,
    missionServices: {
      store: { load: async () => ({ kind: 'found', mission: retractedStateMission(afterTransitionStatus), version: 2 }) },
      lifecycle: { transition: async (request: { operationId: string; command: { type: string } }) => { transitions.push(request); return { status: 'completed' }; } },
    },
  };
}

/**
 * CP-3: the post-retraction approval state must not block the automatic
 * path. The gate step replaces the retracted approval with the fresh provider
 * approval for the repaired revision, and recovery reaches the integration
 * lane instead of the stale-state abort.
 */
test('TASK-2550: the post-retraction approval state does not block the automatic path after the re-review approves', async () => {
  const freshApproval = { ok: true, reviewState: 'APPROVED', reviewerApproved: true, reviewerApprovedAt: '2026-09-22T12:00:00Z' };
  const recovery = recoveryServices('review');
  const context: any = {
    slug: SLUG,
    branch: BRANCH,
    // The gate step wrote the re-read approval for the repaired revision.
    approval: freshApproval,
  };

  const { result, said } = await withCapturedOutput(async () => {
    const { recoverMissionForIntegration } = createMissionRecovery(recovery.ports);
    return await recoverMissionForIntegration(context, {
      missionServices: recovery.missionServices,
      missionLoad: { kind: 'found', mission: retractedStateMission('active'), version: 1 },
    } as never);
  });

  assert.equal(result.status, 'integration', 'recovery reaches the integration lane');
  assert.equal(context.missionStatus, 'integration');
  assert.ok(recovery.transitions.some(t => t.command.type === 'approve'), 'the approval transition runs for the re-approved revision');
  assert.doesNotMatch(said, /stored approval without the required provider approval/, 'the stale-state error is not emitted on the automatic path');
});

/**
 * CP-3 control: the same post-retraction state as the human's second
 * `px integrate` sees it (provider approval retracted, no per-login
 * corroboration) still fails closed with the stale-state error. The
 * automatic path is exempt only because it re-reads the fresh approval.
 */
test('TASK-2550: the post-retraction approval state still blocks a manual re-integrate', async () => {
  const recovery = recoveryServices('review');
  const context: any = {
    slug: SLUG,
    branch: BRANCH,
    // What the provider read returns after the retraction, before any
    // re-review: REQUEST_CHANGES is the latest formal decision.
    approval: { ok: true, reviewState: 'REQUEST_CHANGES', reviewerApproved: false, defaultUserApproved: false },
  };

  const { said } = await withCapturedOutput(async () => {
    const { recoverMissionForIntegration } = createMissionRecovery(recovery.ports);
    await assert.rejects(
      recoverMissionForIntegration(context, {
        missionServices: recovery.missionServices,
        missionLoad: { kind: 'found', mission: retractedStateMission('active'), version: 1 },
      } as never),
      (error: unknown) => error instanceof IntegrationAbort,
    );
  });

  assert.match(said, /stored approval without the required provider approval/, 'the stale-state refusal stands for the manual path');
});

// ---------------------------------------------------------------------------
// The concrete seam starts from the review round opened by the real mission
// rebound transition. Handoff later binds that round to the repaired commit
// and selects a reviewer.
// ---------------------------------------------------------------------------
/** A minimal in-memory MissionStore after the real rebound transition. */
function retractedReviewStore(priorRound = 1) {
  let mission: any = {
    id: 'task-2550',
    status: 'integration',
    review: {
      rounds: [{
        number: priorRound,
        subject: { change: { kind: 'local-branch', sourceBranch: 'mission/task-2550', targetBranch: 'main' }, revision: APPROVED },
        reviewer: REVIEWER,
        implementer: 'codex',
        startedAt: '2026-09-16T10:00:00Z',
        decision: { kind: 'approved', decidedAt: '2026-09-16T10:30:00Z', comment: null, source: { kind: 'provider', provider: 'forgejo' } },
        response: null,
        phase: 'approved',
        disposition: 'APPROVED',
        reviewerRetryCount: 0,
        implementerRetryCount: 0,
      }],
      intervention: null,
      stageLaunches: [],
      reviewEvents: [],
    },
  };
  mission = decideMission(mission, { type: 'rebound-to-active', agent: agentFamily('codex'), occurredAt: '2026-09-22T11:00:00Z' });
  let version = 2;
  return {
    store: {
      load: (async () => ({ kind: 'found', mission, version })) as never,
      save: (async (next: any) => { mission = next; return ++version; }) as never,
    },
    lifecycle: null,
    currentReview: () => mission.review,
    setReviewer: (reviewer: string) => {
      const rounds = mission.review.rounds;
      mission = { ...mission, review: { ...mission.review, rounds: [...rounds.slice(0, -1), { ...rounds.at(-1), reviewer }] } };
    },
  };
}

async function invokeConcreteStartReviewRound(priorRound = 1) {
  const calls: Array<Record<string, unknown>> = [];
  const seeded = retractedReviewStore(priorRound);
  mock.method(reviewLoop, 'startReviewLoop', (async (_slug: string, opts: Record<string, unknown> = {}) => {
    calls.push({ ...opts });
    seeded.setReviewer('claude');
  }) as typeof reviewLoop.startReviewLoop);
  const assignedReviewer = await createIntegratePorts().review.startReviewRound('task-2550', {
    worktree: '/tmp/revbounce-worktree',
    revision: REPAIRED,
    missionServicesFn: (async () => ({ store: seeded.store, lifecycle: seeded.lifecycle })) as never,
  });
  return { calls, currentReview: seeded.currentReview(), assignedReviewer };
}

test('TASK-2550: the concrete startReviewRound port uses the rebound round and persisted reviewer', async () => {
  const { calls, currentReview, assignedReviewer } = await invokeConcreteStartReviewRound();
  assert.equal(calls.length, 1, 'the loop runs exactly once');
  assert.notEqual(calls[0].reset, true, 'the loop must not merely reset the prior round');
  assert.equal(calls[0].isContinue, false);
  assert.equal(calls[0].worktree, '/tmp/revbounce-worktree');
  assert.equal(calls[0].reviewer, undefined, 'handoff chooses the reviewer');
  assert.equal(calls[0].maxAttempts, 6, 'the resumed invocation has five attempts starting at round two');
  assert.equal(assignedReviewer, 'claude', 'the adapter returns the reviewer persisted by handoff');
  const rounds = currentReview.rounds;
  assert.equal(rounds.length, 2, 'a second review round is opened for the repaired revision');
  assert.equal(rounds[0].decision.kind, 'approved', 'the original approval remains in review history');
  assert.equal(rounds[0].decision.revocation.revokedBy, 'workflow', 'the superseded approval is explicitly revoked');
  assert.equal(rounds[1].subject.revision, APPROVED, 'handoff binds the pending round to the repaired commit');
  assert.equal(rounds[1].number, 2);
  assert.equal(rounds[1].phase, 'reviewing');
});

test('TASK-2550: round numbers beyond the original review budget still launch the reviewer', async () => {
  const { calls, currentReview } = await invokeConcreteStartReviewRound(5);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].reviewer, undefined, 'no configured reviewer: the pipeline selects');
  const rounds = currentReview.rounds;
  assert.equal(rounds.length, 2, 'the repaired-revision round is opened regardless of reviewer pinning');
  assert.equal(rounds[1].number, 6);
  assert.equal(calls[0].maxAttempts, 10);
});
