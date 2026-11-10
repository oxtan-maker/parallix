// review intervention resume.integration.
// Related scenarios share imports; each contract keeps its own hooks and mutable fixtures.
import { recordApproval } from '../../../src/adapters/review/review-round.js';
import { readReviewState } from '../../../src/adapters/review/review-state.js';
import { currentReviewRound } from '../../../src/domain/review.js';
import { MissionLifecycleService } from '../../../src/application/mission-lifecycle-service.js';
import { createReviewLoopPorts } from '../../../src/adapters/review/review-loop.js';
import { describe, afterEach, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { SqliteDatabaseAdapter } from '../../../src/adapters/sqlite/database-adapter.js';
import { SqliteMissionStore } from '../../../src/adapters/sqlite/mission-store.js';
import { clearOperatorStateCache } from '../../../src/adapters/sqlite/adapter-factory.js';
import { missionId, missionLabels, type Mission } from '../../../src/domain/mission.js';
import { repositoryId } from '../../../src/domain/repository.js';
import { agentFamily } from '../../../src/domain/agents.js';
import {
  applyImplementerCommand,
  applyReviewerCommand,
  beginNextReviewRound,
  changeRevision,
  ConfiguredReviewerEligibility,
  requestReviewIntervention,
  reviewFindingId,
  reviewStatus,
  resumeReview,
  startReview,
  type Review,
} from '../../../src/domain/review.js';
import { ReviewCommandUseCase } from '../../../src/application/review-command-use-case.js';
import {
  continueReviewClearsIntervention,
  createReviewWorkflowAdapter,
} from '../../../src/adapters/review/review-commands.js';
import { bindReviewOperatorResume } from '../../../src/composition/review-operator-resume.js';
import { fakeReviewLoopPorts } from '../../helpers/review-loop-ports.js';
import { unknownReviewFlags } from '../../../src/adapters/review/review-cli-flags.js';
import { applyReviewStateToReview, reviewStateDataFrom } from '../../../src/adapters/review/review-state-mapping.js';
import { readAllEvents } from '../../../src/adapters/review/review-events.js';
import { mkdtemp as registeredMkdtemp } from '../../helpers/temp-dir.js';

// Regression provenance: TASK-2473, TASK-2810. Direct entry clears the
// intervention without supplying a verdict; automatic entry retains it.
const SLUG = 'task-2473-resume';
const REVIEWER = agentFamily('configured-reviewer');
const IMPLEMENTER = agentFamily('configured-implementer');

const tempDirs: string[] = [];
const databases: SqliteDatabaseAdapter[] = [];

afterEach(async () => {
  for (const db of databases.splice(0)) { await db.close(); }
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function createTempRoot(): string {
  const dir = registeredMkdtemp(`parallix-task-2473-resume-`);
  tempDirs.push(dir);
  fs.mkdirSync(path.join(dir, 'missions', SLUG), { recursive: true });
  fs.writeFileSync(path.join(dir, 'missions', SLUG, 'MISSION.md'), `# Mission: ${SLUG}\n`);
  fs.mkdirSync(path.join(dir, 'parallix-home'), { recursive: true });
  return dir;
}

function databasePathOf(root: string): string {
  return path.join(root, 'parallix-home', 'parallix.db');
}

async function withHome<T>(root: string, fn: () => Promise<T>): Promise<T> {
  const previous = process.env.PARALLIX_HOME;
  process.env.PARALLIX_HOME = path.join(root, 'parallix-home');
  await clearOperatorStateCache();
  try {
    return await fn();
  } finally {
    if (previous === undefined) { delete process.env.PARALLIX_HOME; }
    else { process.env.PARALLIX_HOME = previous; }
    await clearOperatorStateCache();
  }
}

const reviewerEligibility = ConfiguredReviewerEligibility.fromReviewStep({
  eligible: [REVIEWER],
  strategy: 'random',
});

/**
 * Build the task-2465 round-4 shape: a `changes-requested` round whose
 * implementer stopped on budget exhaustion, escalating to `human-intervention`
 * with `workflow`-requested metadata exactly the way `escalateToHumanReview`
 * persists it.
 */
function stoppedReview(): Review {
  const review = startReview(
    {
      change: { kind: 'local-branch', sourceBranch: `mission/${SLUG}`, targetBranch: 'main' },
      revision: changeRevision('rev-1'),
    },
    REVIEWER,
    IMPLEMENTER,
    '2026-09-01T09:00:00.000Z',
    reviewerEligibility,
  );
  const withChanges = applyReviewerCommand(review, {
    type: 'request-changes',
    decidedAt: '2026-09-01T10:00:00.000Z',
    comment: 'Fix the security findings',
    findings: [{ id: reviewFindingId('F1'), summary: 'Security findings', location: null }],
  });
  return requestReviewIntervention(withChanges, {
    requestedAt: '2026-09-01T11:00:00.000Z',
    requestedBy: 'workflow',
    reason: 'IMPLEMENTER_ARTIFACT_RETRY_EXHAUSTED',
  });
}

/**
 * A stopped review in round 2: round 1 resolved, round 2 decided
 * `changes-requested`, then escalated. Exercises the audit-event round
 * derivation (task-2473 round 2 F1).
 */
function stoppedReviewRound2(): Review {
  const review = startReview(
    { change: { kind: 'local-branch', sourceBranch: `mission/${SLUG}`, targetBranch: 'main' }, revision: changeRevision('rev-1') },
    REVIEWER, IMPLEMENTER, '2026-09-01T09:00:00.000Z', reviewerEligibility,
  );
  const r1 = applyReviewerCommand(review, {
    type: 'request-changes', decidedAt: '2026-09-01T10:00:00.000Z', comment: 'Fix findings', findings: [{ id: reviewFindingId('F1'), summary: 'Security', location: null }],
  });
  const r1responded = applyImplementerCommand(r1, {
    type: 'submit-resolution', respondedAt: '2026-09-01T11:00:00.000Z', resolutions: [{ findingId: reviewFindingId('F1'), kind: 'fixed', evidence: 'patched' }], resultingRevision: changeRevision('rev-2'),
  });
  const r2 = beginNextReviewRound(r1responded, REVIEWER, IMPLEMENTER, '2026-09-02T09:00:00.000Z', reviewerEligibility);
  const r2decided = applyReviewerCommand(r2, {
    type: 'request-changes', decidedAt: '2026-09-02T10:00:00.000Z', comment: 'Fix the security findings', findings: [{ id: reviewFindingId('F2'), summary: 'Security findings', location: null }],
  });
  return requestReviewIntervention(r2decided, {
    requestedAt: '2026-09-02T11:00:00.000Z', requestedBy: 'workflow', reason: 'IMPLEMENTER_ARTIFACT_RETRY_EXHAUSTED',
  });
}

function plainReadyForNextRound(): Review {
  const review = startReview(
    { change: { kind: 'local-branch', sourceBranch: `mission/${SLUG}`, targetBranch: 'main' }, revision: changeRevision('rev-1') },
    REVIEWER, IMPLEMENTER, '2026-09-02T09:00:00.000Z', reviewerEligibility,
  );
  const withChanges = applyReviewerCommand(review, {
    type: 'request-changes', decidedAt: '2026-09-02T10:00:00.000Z', comment: null, findings: [{ id: reviewFindingId('F1'), summary: 'Security findings', location: null }],
  });
  return applyImplementerCommand(withChanges, {
    type: 'submit-resolution',
    respondedAt: '2026-09-02T11:00:00.000Z',
    resolutions: [{ findingId: reviewFindingId('F1'), kind: 'fixed', evidence: 'patched' }],
    resultingRevision: changeRevision('rev-3'),
  });
}

function missionWith(review: Review): Mission {
  return {
    id: missionId(SLUG),
    repositoryId: repositoryId('parallix'),
    title: `Mission ${SLUG}`,
    labels: missionLabels([]),
    status: 'review',
    rawStatus: 'review',
    checkpoints: [],
    netEngineeringLines: null,
    closedAt: null,
    assignee: null,
    externalTaskRef: null,
    intakeTrace: null,
    review,
  } as Mission;
}

async function openMigrated(root: string): Promise<SqliteDatabaseAdapter> {
  const db = new SqliteDatabaseAdapter();
  databases.push(db);
  copyRepairSchema(databasePathOf(root));
  await db.open({ path: databasePathOf(root) });
  return db;
}

interface Harness { root: string; store: SqliteMissionStore; }

async function seedRoot(review: Review): Promise<Harness> {
  const root = createTempRoot();
  const db = await openMigrated(root);
  const store = new SqliteMissionStore(db);
  await store.save(missionWith(review), null);
  return { root, store };
}

/** Invoke the inferred review entry with real SQLite and a held loop fence. */
async function invokeResume(store: SqliteMissionStore, root: string, actor: string | null, direct = true): Promise<{ cleared: boolean; outcome: string | null }> {
  const adapter = createReviewWorkflowAdapter({
    missionStore: store,
    operatorResume: bindReviewOperatorResume(store, direct, {}, async () => ({ workflow: null,
      liveness: { workflow: false, coordinator: false, execution: false, reviewer: false } })),
    readReviewStateFn: async () => {
      const loaded = await store.load(missionId(SLUG));
      if (loaded.kind !== 'found' || !loaded.mission.review) { return null; }
      const { ReviewState } = await import('../../../src/adapters/review/review-state.js');
      return new ReviewState(SLUG, reviewStateDataFrom(loaded.mission.review));
    },
    reviewLoopMechanisms: () => fakeReviewLoopPorts({ lock: { tryAcquire: () => false, release: () => {} } }).ports,
    run: () => ({ status: 1, signal: null, stdout: '', stderr: '' }),
    resolveWorktreeFn: () => root,
    log: () => undefined,
    error: () => undefined,
    exit: (code: number) => { throw new Error(`exit:${code}`); },
    inferSlugFn: () => SLUG,
  });
  const useCase = new ReviewCommandUseCase(adapter);
  const args = actor === null ? [SLUG] : [SLUG, `--actor=${actor}`];
  try {
    await useCase.execute(args, {});
  } catch {
    // Injected failure remains visible in persisted state below.
  }
  const loaded = await store.load(missionId(SLUG));
  const review = loaded.kind === 'found' && loaded.mission.review ? loaded.mission.review : null;
  return { cleared: review?.intervention === null, outcome: review ? reviewStatus(review) : null };
}

describe("stopped review recovery through inferred px review", () => {
  it('clears a human-intervention stop and derives the surviving-round status', async () => {
    await withHome(createTempRoot(), async () => {
      const { root, store } = await seedRoot(stoppedReview());
      const { cleared, outcome } = await invokeResume(store, root, 'human');
      assert.equal(cleared, true, 'review.intervention is null after recovery');
      assert.notEqual(outcome, 'human-intervention', 'recovery derives the surviving-round status');
    });
  });

  it('rejects a review that is not in human-intervention', async () => {
    await withHome(createTempRoot(), async () => {
      const { root, store } = await seedRoot(plainReadyForNextRound());
      const { outcome } = await invokeResume(store, root, 'human');
      assert.equal(outcome, 'ready-for-next-round', 'a non-intervened review is left untouched');
    });
  });

  it('automatic invocation cannot clear the intervention without operator authority', async () => {
    await withHome(createTempRoot(), async () => {
      const { root, store } = await seedRoot(stoppedReview());
      const { cleared } = await invokeResume(store, root, null, false);
      assert.equal(cleared, false, 'an operator identity is required to clear an intervention');
    });
  });

  it('does not resurrect the intervention on reload', async () => {
    await withHome(createTempRoot(), async () => {
      const { root, store } = await seedRoot(stoppedReview());
      await invokeResume(store, root, 'human');
      const reloaded = await store.load(missionId(SLUG));
      const review = reloaded.kind === 'found' ? reloaded.mission.review! : stoppedReview();
      assert.equal(review.intervention, null, 'persisted intervention is null');
      const metadata = reviewStateDataFrom(review).metadata || {};
      assert.equal(metadata.humanEscalationReason, undefined);
      assert.equal(metadata.humanEscalatedAt, undefined);
      const reapplied = applyReviewStateToReview(review, reviewStateDataFrom(review));
      assert.equal(reapplied.intervention, null, 'applyReviewStateToReview yields no intervention');
    });
  });

  it("lets the derived-status review preparation proceed without a MissionRuleViolation", async () => {
    await withHome(createTempRoot(), async () => {
      const { root, store } = await seedRoot(stoppedReview());
      await invokeResume(store, root, 'human');
      const reloaded = await store.load(missionId(SLUG));
      const review = reloaded.kind === 'found' ? reloaded.mission.review! : stoppedReview();
      // The task-2465 shape derives `awaiting-implementation`: the implementer
      // resolution is the handoff that status permits.
      const status = reviewStatus(review);
      assert.equal(status, 'awaiting-implementation', `expected awaiting-implementation, got ${status}`);
      assert.doesNotThrow(() =>
        applyImplementerCommand(review, {
          type: 'submit-resolution',
          respondedAt: '2026-09-03T09:00:00.000Z',
          resolutions: [{ findingId: reviewFindingId('F1'), kind: 'fixed', evidence: 'patched' }],
          resultingRevision: changeRevision('rev-2'),
        }),
      );
    });
  });

  it('leaves an approved review that carries a stale intervention untouched', async () => {
    await withHome(createTempRoot(), async () => {
      const review = applyReviewerCommand(
        startReview(
          { change: { kind: 'local-branch', sourceBranch: `mission/${SLUG}`, targetBranch: 'main' }, revision: changeRevision('rev-1') },
          REVIEWER, IMPLEMENTER, '2026-09-05T09:00:00.000Z', reviewerEligibility,
        ),
        { type: 'approve', decidedAt: '2026-09-05T10:00:00.000Z', comment: null, source: { kind: 'local' } },
      );
      // A stale intervention from a superseded round: reviewStatus reports
      // 'approved' ahead of it, so this review is never a recovery candidate.
      const stale = { ...review, intervention: { requestedAt: '2026-09-05T08:00:00.000Z', requestedBy: 'reviewer' as const, reason: 'stale' } };
      assert.equal(reviewStatus(stale), 'approved');
      const { root, store } = await seedRoot(stale);
      const { outcome } = await invokeResume(store, root, 'human');
      assert.equal(outcome, 'approved', 'an approved review is not a recovery candidate');
    });
  });

  it('attributes the clearing actor to a review event', async () => {
    // F1/F2: the --actor override must be attributable. Drive a real recovery
    // with a named operator and assert that identity lands on a review event,
    // so an operator inspecting review-events/ can see who cleared the stop.
    await withHome(createTempRoot(), async () => {
      const { root, store } = await seedRoot(stoppedReview());
      const { cleared } = await invokeResume(store, root, 'operator-alice');
      assert.equal(cleared, true, 'review.intervention is null after recovery');
      const events = await readAllEvents(SLUG, { rootDir: root, missionStore: store });
      const resumeNote = (events as Array<Record<string, unknown>>).find(
        (e) => e.event_type === 'human_note' && String(e.actor) === 'operator-alice',
      );
      assert.ok(resumeNote, 'the clearing operator is attributed to a review event');
      assert.match(String(resumeNote!.content), /operator-alice/, 'the event names who cleared the stop');
    });
  });

  it('records the audit event at the recovered round', async () => {
    // task-2473 round 2 F1: the audit event round must follow the recovered
    // review's current round, not be hard-coded to 1. A round-2 stop must
    // export a round-2 human_note.
    await withHome(createTempRoot(), async () => {
      const { root, store } = await seedRoot(stoppedReviewRound2());
      const { cleared } = await invokeResume(store, root, 'operator-alice');
      assert.equal(cleared, true, 'review.intervention is null after recovery');
      const events = await readAllEvents(SLUG, { rootDir: root, missionStore: store });
      const resumeNote = (events as Array<Record<string, unknown>>).find(
        (e) => e.event_type === 'human_note' && String(e.actor) === 'operator-alice',
      );
      assert.ok(resumeNote, 'the clearing operator is attributed to a review event');
      assert.equal((resumeNote as Record<string, unknown>).round, 2, 'the audit event records the recovered round 2');
    });
  });

  it('rejects removed modes while keeping operator attribution', () => {
    assert.deepEqual(unknownReviewFlags([SLUG, '--actor', 'human']), []);
    assert.deepEqual(unknownReviewFlags(['--start', '--continue', '--resume']), ['--start', '--continue', '--resume']);
  });

  it('continue clears a human-intervention stop attributed to the git user', async () => {
    // `px review` relaunches the loop after clearing the stop. It
    // takes no --actor: attribution is to the operator (the current git user),
    // with zero ceremony. A stubbed `run` stands in for `git config user.name`.
    await withHome(createTempRoot(), async () => {
      const { root, store } = await seedRoot(stoppedReview());
      const gitUser = { signal: null, status: 0, stdout: 'alice-dev\n', stderr: '', error: null };
      const cleared = await continueReviewClearsIntervention(SLUG, [], {
        resolveWorktreeFn: () => root,
        missionStore: store,
        log: () => undefined,
        error: () => undefined,
        runFn: (() => gitUser),
      });
      assert.equal(cleared, true, 'review entry clears the intervention');
      const loaded = await store.load(missionId(SLUG));
      const review = loaded.kind === 'found' ? loaded.mission.review! : null;
      assert.equal(review?.intervention, null, 'intervention cleared on the persisted aggregate');
      const events = await readAllEvents(SLUG, { rootDir: root, missionStore: store });
      const note = (events as Array<Record<string, unknown>>).find((e) => e.event_type === 'human_note' && String(e.actor) === 'alice-dev');
      assert.ok(note, 'the clearing is attributed to the current git user');
    });
  });

  it('continue falls back to a generic operator when no git user is set', async () => {
    await withHome(createTempRoot(), async () => {
      const { root, store } = await seedRoot(stoppedReview());
      const gitUser = { signal: null, status: 1, stdout: '', stderr: 'fatal: not a git repository', error: null };
      const cleared = await continueReviewClearsIntervention(SLUG, [], {
        resolveWorktreeFn: () => root,
        missionStore: store,
        log: () => undefined,
        error: () => undefined,
        runFn: (() => gitUser),
      });
      assert.equal(cleared, true, 'still clears without a git user');
      const events = await readAllEvents(SLUG, { rootDir: root, missionStore: store });
      const note = (events as Array<Record<string, unknown>>).find((e) => e.event_type === 'human_note' && String(e.actor) === 'operator');
      assert.ok(note, 'a generic operator attribution is recorded when no git user is resolvable');
    });
  });

  it('continue leaves a non-intervened review untouched', async () => {
    await withHome(createTempRoot(), async () => {
      const { root, store } = await seedRoot(plainReadyForNextRound());
      const gitUser = { signal: null, status: 0, stdout: 'alice-dev\n', stderr: '', error: null };
      const cleared = await continueReviewClearsIntervention(SLUG, [], {
        resolveWorktreeFn: () => root,
        missionStore: store,
        log: () => undefined,
        error: () => undefined,
        runFn: (() => gitUser),
      });
      assert.equal(cleared, false, 'no intervention to clear');
      const loaded = await store.load(missionId(SLUG));
      const review = loaded.kind === 'found' ? loaded.mission.review! : null;
      assert.equal(review?.intervention, null, 'aggregate unchanged');
      const events = await readAllEvents(SLUG, { rootDir: root, missionStore: store });
      assert.equal((events as Array<Record<string, unknown>>).filter((e) => e.event_type === 'human_note').length, 0, 'no audit event for a no-op');
    });
  });

  it('automatic invocation retains the persisted stop (TASK-2810)', async () => {
    await withHome(createTempRoot(), async () => {
      const { root, store } = await seedRoot(stoppedReview());
      const { cleared, outcome } = await invokeResume(store, root, null, false);
      assert.equal(cleared, false, 'no supported invocation clears the intervention without an actor');
      assert.equal(outcome, 'human-intervention');
    });
  });
});

import { copyRepairSchema } from '../../lib/integration-repair-fixture.js';
import { registerRetainedRepairCases, retainedRepairCase } from '../../fixtures/review-repair-recovery.js';
registerRetainedRepairCases(['acknowledgment']);


it('first review recovers acknowledged criteria correction without a persisted Review (TASK-2810)', { timeout: 10000 }, async t => {
  await retainedRepairCase('acknowledgment', true, t, true);
});


it('inferred recovery stops for a newly reported blocker (TASK-2810)', { timeout: 10000 }, async t => {
  await retainedRepairCase('new-blocker', false, t);
});

// Exercise the real state, revocation and observation adapters across closed
// database connections; provider evidence is persisted separately from Mission.

it('retries a persisted operator correction after failed revocation and a database restart (px-0001)', async () => {
  const review = applyReviewerCommand(startReview(
    { change: { kind: 'local-branch', sourceBranch: `mission/${SLUG}`, targetBranch: 'main' }, revision: changeRevision('approved-head') },
    REVIEWER, IMPLEMENTER, '2026-10-01T09:00:00Z', reviewerEligibility,
  ), { type: 'approve', decidedAt: '2026-10-01T10:00:00Z', comment: 'Approved', source: { kind: 'local' } });
  const { root, store: seedStore } = await seedRoot(review);
  const seeded = await seedStore.load(missionId(SLUG));
  assert.equal(seeded.kind, 'found');
  if (seeded.kind !== 'found') { throw new Error('Missing fixture'); }
  fs.writeFileSync(path.join(root, 'feature.txt'), 'approved feature\n');
  await seedStore.save({ ...seeded.mission, status: 'integration', closedAt: null, assignee: IMPLEMENTER,
    checkpoints: [{ missionId: missionId(SLUG), name: 'CP-1',
      goalCheck: [{ criterion: 'Retain the approved feature', evidence: 'feature.txt' }],
      nextActionText: 'Exercise correction retry and independent review' }],
  }, seeded.version);
  const providerFile = path.join(root, 'provider-review.json');
  fs.writeFileSync(providerFile, JSON.stringify([{
    kind: 'review', id: '7', user: 'operator', state: 'REQUEST_CHANGES',
    created: '2026-10-01T11:00:00Z', body: 'Preserve the requested retry correction.',
  }, {
    kind: 'inline-comment', id: '7', reviewId: '7', user: 'operator', state: 'REQUEST_CHANGES',
    created: '2026-10-01T11:00:01Z', body: 'Preserve its inline obligation too.',
  }]));
  const findingIds = ['human-review-7', 'human-inline-comment-7'];
  const summaries = ['Preserve the requested retry correction.', 'Preserve its inline obligation too.'];
  const applied: string[] = [];
  let launches = 0;
  let approvalRevoked = false;
  let expectedSource: string | undefined;

  async function restart(failRevocation: boolean, failDecision = false) {
    // No Mission, ReviewState, feedback object or connection survives a restart.
    for (const database of databases.splice(0)) { await database.close(); }
    const database = new SqliteDatabaseAdapter();
    databases.push(database);
    await database.open({ path: databasePathOf(root) });
    const store = new SqliteMissionStore(database);
    const lifecycle = new MissionLifecycleService(store);
    const errors: string[] = [], entryExits: number[] = [];
    let preparations = 0;
    const real = createReviewLoopPorts(SLUG, { worktree: root }, {
      missionStore: store, lifecycleService: lifecycle,
      isProviderEnabled: () => true, readToken: () => 'fixture-token',
      getComments: async () => JSON.parse(fs.readFileSync(providerFile, 'utf8')),
      log: () => {}, error: message => { errors.push(message); },
    });
    const fake: ReturnType<typeof fakeReviewLoopPorts> = fakeReviewLoopPorts({
      slug: SLUG, worktree: root, missionStore: store, lifecycle,
      stateport: { ...real.state,
        recordRequestedChanges: async (state, observation) => {
          if (failDecision) { throw new Error('injected decision write failure'); }
          await real.state.recordRequestedChanges(state, observation);
          applied.push(...observation.findings.map(finding => finding.id));
        },
      },
      routing: { eligibleFamilies: () => [REVIEWER, IMPLEMENTER] },
      reviewPreparation: { reviewPreparation: async () => {
        preparations++;
        const state = await real.state.read();
        assert.ok(state);
        assert.equal(state.phase, 'reviewing', 'operator continuation opened the next round');
        const gate = await fake.ports.preReview.runGate();
        assert.equal(gate.ok, true);
        assert.equal(await real.state.openRound(state), true, errors.join('\n'));
        return { ok: true };
      } },
      preReview: { head: () => 'approved-head' },
      agents: { launch: async launch => {
        const loaded = await store.load(missionId(SLUG));
        assert.equal(loaded.kind, 'found');
        if (loaded.kind !== 'found') { throw new Error('Missing mission'); }
        if (launch.role === 'reviewer') {
          assert.equal(launches, 1, 'review follows the single correction application');
          assert.equal(preparations, 1, 'review preparation must finish before the reviewer starts');
          assert.equal(loaded.mission.status, 'review');
          assert.equal(reviewStatus(loaded.mission.review!), 'awaiting-review');
          const result = await recordApproval(SLUG, {
            revision: 'approved-head', decidedAt: new Date().toISOString(),
            comment: 'Operator-resolved correction independently reviewed', source: { kind: 'local' },
          }, { missionStore: store, lifecycleService: lifecycle });
          assert.equal(result.outcome, 'recorded');
          return { agent: REVIEWER };
        }
        assert.equal(launch.role, 'implementer');
        assert.equal(approvalRevoked, true);
        assert.equal(loaded.mission.status, 'active');
        const decision = currentReviewRound(loaded.mission.review!).decision;
        assert.equal(decision?.kind, 'changes-requested', 'the correction must be durable before launching implementation');
        if (decision?.kind !== 'changes-requested') { throw new Error('Missing correction decision'); }
        assert.deepEqual(decision.findings.map(f => f.summary), summaries);
        assert.deepEqual(decision.findings.map(f => f.id), findingIds);
        assert.deepEqual(decision.source, { kind: 'operator', author: 'operator' });
        launches++;
        return { agent: IMPLEMENTER };
      } },
      artifacts: { consumeImplementer: async () => ({ consumed: true, ok: true, disposition: 'BLOCKED', changedRevision: true }) },
    });
    const reconcile = real.humanFeedback.reconcile;
    const humanFeedback = { ...real.humanFeedback, reconcile: async (state: Parameters<typeof reconcile>[0]) => {
      const feedback = await reconcile(state);
      if (feedback) {
        expectedSource ??= feedback.source;
        assert.equal(feedback.source, expectedSource, 'restart must recover the original provider identity');
        assert.equal(feedback.reason, summaries.join('\n'));
      }
      return feedback;
    } };
    const ports = {
      ...fake.ports, humanFeedback,
      approvalRevocation: { revoke: async (request: Parameters<NonNullable<typeof real.approvalRevocation>['revoke']>[0]) => {
        if (failRevocation) { return { ok: false, diagnostic: 'injected version conflict' }; }
        const result = await real.approvalRevocation!.revoke(request);
        approvalRevoked = result.ok;
        return result;
      } },
    };
    await new ReviewCommandUseCase(createReviewWorkflowAdapter({
      missionStore: store, operatorResume: bindReviewOperatorResume(store, true, {}, async () => ({ workflow: null,
        liveness: { workflow: false, coordinator: false, execution: false, reviewer: false } })),
      inferSlugFn: () => SLUG, resolveWorktreeFn: () => root,
      readReviewStateFn: async () => readReviewState(SLUG, root, store), reviewLoopMechanisms: () => ports,
      log: () => {}, error: message => { errors.push(message); }, exit: code => { entryExits.push(code); },
    })).execute([SLUG, '--actor', 'operator']);
    return { store, ports, preparations, roles: fake.launches.map(launch => launch.role),
      exits: [...entryExits, ...fake.exits], errors: [...errors, ...fake.errors], stops: fake.stops };
  }

  const first = await restart(true);
  const failed = await first.store.load(missionId(SLUG));
  assert.equal(failed.kind, 'found');
  if (failed.kind !== 'found') { throw new Error('Missing failed mission'); }
  assert.equal(reviewStatus(failed.mission.review!), 'approved');
  assert.equal(failed.mission.review!.rounds[0].decision?.kind === 'approved'
    && failed.mission.review!.rounds[0].decision.revocation, undefined);
  assert.equal(launches, 0);
  assert.deepEqual(applied, []);
  assert.equal(failed.mission.review!.reviewEvents.filter(e => e.followUpReference?.startsWith('forgejo:')).length, 0);
  assert.match(fs.readFileSync(providerFile, 'utf8'), /Preserve the requested retry correction/);

  const decisionFailure = await restart(false, true);
  assert.deepEqual(decisionFailure.exits, [1]);
  assert.match(decisionFailure.errors.join('\n'), /injected decision write failure.*px review/);
  assert.equal(launches, 0);
  const retried = await restart(false);
  assert.equal(launches, 1);
  assert.deepEqual(applied, findingIds);
  assert.deepEqual(retried.exits, []);
  assert.deepEqual(retried.errors, []);
  assert.deepEqual(retried.roles, ['implementer']);
  const recovered = await retried.store.load(missionId(SLUG));
  assert.equal(recovered.kind, 'found');
  if (recovered.kind !== 'found') { throw new Error('Missing recovered mission'); }
  assert.equal(recovered.mission.review!.rounds.length, 2);
  const correctionDecision = recovered.mission.review!.rounds[1].decision;
  assert.ok(correctionDecision?.kind === 'changes-requested');
  assert.deepEqual(correctionDecision.source, { kind: 'operator', author: 'operator' }, 'operator provenance survives reopening SQLite');
  assert.equal(recovered.mission.review!.rounds[0].decision?.kind === 'approved'
    && recovered.mission.review!.rounds[0].decision.revocation?.revokedBy, 'operator');
  assert.equal(recovered.mission.review!.reviewEvents.filter(e => e.followUpReference?.startsWith(expectedSource!)).length, 1);
  assert.equal(recovered.mission.review!.reviewEvents.filter(e => e.followUpReference?.startsWith('forgejo:')).length, 2);
  const state = await retried.ports.state.read();
  assert.ok(state);
  assert.equal(await retried.ports.humanFeedback.reconcile(state!), null);
  // A later process reads the consumed source from SQLite, not an old state object.
  const last = await restart(false);
  const lastState = await last.ports.state.read();
  assert.ok(lastState);
  assert.equal(await last.ports.humanFeedback.reconcile(lastState!), null);
  assert.equal(launches, 1, 'replaying the review command cannot launch the consumed correction twice');
  assert.deepEqual(applied, findingIds, 'continuation cannot apply the consumed correction again');
  assert.deepEqual(last.exits, [], 'the final command must complete without an unsuccessful loop exit');
  assert.deepEqual(last.errors, [], 'the final command must not hide a preparation failure');
  assert.deepEqual(last.stops, []);
  assert.equal(last.preparations, 1);
  assert.deepEqual(last.roles, ['reviewer']);
  const completed = await last.store.load(missionId(SLUG));
  assert.equal(completed.kind, 'found');
  if (completed.kind !== 'found') { throw new Error('Missing completed mission'); }
  assert.equal(completed.mission.status, 'integration');
  assert.equal(reviewStatus(completed.mission.review!), 'approved');
  assert.equal(completed.mission.review!.rounds.length, 3);
  assert.equal(completed.mission.review!.reviewEvents.filter(e => e.followUpReference?.startsWith('forgejo:')).length, 2);
});
