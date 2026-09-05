// TASK-2398 — approve on a fixing round.
//
// Regression: an `approve` verdict reported `[PASS]` while writing no
// authoritative `ReviewerDecision` whenever the current round was not
// `reviewing`. From `fixing` the phase transition throws inside a swallowed
// `catch`, so the aggregate kept `decision.kind === 'changes-requested'` even
// though `disposition === 'APPROVED'`. `recoveryEstablishesApproval`
// (`integrate.ts`) requires `lastRound.decision.kind === 'approved'`, so the
// mission stays permanently unintegratable.
//
// This test locks both halves of the invariant:
//   * SC1 — approve on a legitimately `awaiting-review` round records an
//     authoritative `approved` decision and moves the mission to integration.
//   * SC2 — approve on a `fixing` round (request-changes then approve) fails
//     loudly and leaves the `changes-requested` decision untouched, so the
//     integration gate still refuses.
//
// It fails red at the mission's parent commit: `recordApproval` does not exist
// yet, so the import fails and the whole file errors.

import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { MissionLifecycleService } from '../src/application/mission-lifecycle-service.js';
import { MissionIntakeService } from '../src/application/mission-intake-service.js';
import { MissionCheckpointService } from '../src/application/mission-checkpoint-service.js';
import { SqliteDatabaseAdapter } from '../src/adapters/sqlite/database-adapter.js';
import { loadDefaultMigrations, SqliteMigrationRunner } from '../src/adapters/sqlite/migration-runner.js';
import { SqliteMissionStore } from '../src/adapters/sqlite/mission-store.js';
import {
  recordApproval,
  parseReviewFindings,
  recordRequestedChanges,
} from '../src/adapters/review/review-round.js';
import { postWorkflowReview } from '../src/adapters/review/review-artifacts.js';
import { submitReviewRound } from '../src/adapters/review/review-commands.js';
import { agentFamily } from '../src/domain/agents.js';
import { missionId, missionLabels } from '../src/domain/mission.js';
import { repositoryId } from '../src/domain/repository.js';
import {
  ConfiguredReviewerEligibility,
  currentReviewRound,
  changeRevision,
  reviewStatus,
  startReview,
} from '../src/domain/review.js';

const MISSION = missionId('task-2398');
const REPOSITORY = repositoryId('parallix');
const CAPABILITIES = new Set(['mission:intake', 'mission:transition', 'checkpoint:record'] as const);
const reviewer = agentFamily('codex');
const implementer = agentFamily('custom');
const eligibility = ConfiguredReviewerEligibility.fromReviewStep({ eligible: [reviewer] } as never);

const change = {
  kind: 'pull-request' as const,
  provider: 'forgejo',
  id: '2398',
  url: 'http://localhost:3300/example/parallix/pulls/2398',
  sourceBranch: 'mission/task-2398',
  targetBranch: 'main',
};

const temporaryDirectories: string[] = [];

/**
 * A mission submitted for review: round 1 in `reviewing`, `awaiting-review`,
 * mission status `review`. Mirrors what `px handoff` + `submit-for-review`
 * leave behind before the reviewer acts.
 */
async function awaitingReview() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-task-2398-'));
  temporaryDirectories.push(directory);
  const db = new SqliteDatabaseAdapter();
  await db.open({ path: path.join(directory, 'fixture.db') });
  await new SqliteMigrationRunner(db).applyPending(loadDefaultMigrations());
  const store = new SqliteMissionStore(db);
  const lifecycle = new MissionLifecycleService(store);

  await new MissionIntakeService(store).execute({
    operationId: 'op-intake',
    missionId: MISSION,
    repositoryId: REPOSITORY,
    title: 'approve on a fixing round',
    labels: missionLabels(['ai_sdlc']),
    assignee: implementer,
    rawStatus: 'refined',
    capabilities: CAPABILITIES,
  } as never);
  // Intake materializes every mission as `backlog`; refinement is what
  // `px draft` records before a launch, and activation demands it.
  await lifecycle.transition({
    operationId: 'op-refine',
    missionId: MISSION,
    capabilities: CAPABILITIES,
    command: { type: 'refine' },
    actor: implementer,
    occurredAt: '2026-08-21T06:00:00.000Z',
  } as never);
  await lifecycle.activate({
    operationId: 'op-activate',
    missionId: MISSION,
    capabilities: CAPABILITIES,
    agent: implementer,
    occurredAt: '2026-08-21T06:00:00.000Z',
  } as never);
  await new MissionCheckpointService(store).record({
    operationId: 'op-checkpoint',
    missionId: MISSION,
    capabilities: CAPABILITIES,
    checkpoint: {
      missionId: MISSION,
      name: 'CP-1',
      rawFilename: 'CP-1.md',
      firstLine: 'Checkpoint 1',
      goalCheck: [{ criterion: 'SC1', evidence: 'test/task-2398-approve-fixing-round.test.ts' }],
      nextActionText: 'Review the handed-off change.',
    },
  } as never);
  const submitted = await lifecycle.transition({
    operationId: 'op-submit-1',
    missionId: MISSION,
    capabilities: CAPABILITIES,
    command: {
      type: 'submit-for-review',
      gatesPassed: true,
      review: startReview(
        { change, revision: changeRevision('rev-1') },
        reviewer,
        implementer,
        '2026-08-21T07:00:00.000Z',
        eligibility,
      ),
      reviewerEligibility: eligibility,
    },
    actor: reviewer,
    occurredAt: '2026-08-21T07:00:00.000Z',
    idempotencyKey: 'submit-1',
  } as never);
  assert.equal(submitted.status, 'completed');
  return { store, db, lifecycle };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('TASK-2398 SC1: approve on an awaiting-review round is authoritative', () => {
  it('records decision.kind === approved and moves the mission to integration', async () => {
    const { store, db, lifecycle } = await awaitingReview();
    try {
      const result = await recordApproval(
        'task-2398',
        { comment: 'Looks good to me', decidedAt: '2026-08-21T08:00:00.000Z', source: { kind: 'local' } },
        { missionStore: store, lifecycleService: lifecycle },
      );
      assert.deepEqual(result, { outcome: 'recorded' });

      const loaded = await store.load(MISSION);
      assert.equal(loaded.kind, 'found');
      const round = currentReviewRound(loaded.mission.review!);
      // This is exactly what `recoveryEstablishesApproval` (integrate.ts) reads:
      // the round must carry an authoritative approved decision to integrate.
      assert.equal(round.decision?.kind, 'approved', 'the approve verdict writes an authoritative decision');
      assert.equal(round.disposition, 'APPROVED');
      // The approval boundary returns the mission to integration at the
      // reviewer's decision time, mirroring how request-changes returns it to
      // active.
      assert.equal(loaded.mission.status, 'integration');
      assert.equal(reviewStatus(loaded.mission.review!), 'approved');
      const events = await db.query<{ idempotency_key: string }>(
        'SELECT idempotency_key FROM board_lane_events WHERE mission_id = ?',
        [MISSION],
      );
      assert.ok(
        events.some((event) => event.idempotency_key === 'approve:task-2398:round-1'),
        'approval idempotency is stable for its review round',
      );
    } finally {
      await db.close();
    }
  });

  it('reports unchanged when an approve is replayed on an already-approved round', async () => {
    const { store, db, lifecycle } = await awaitingReview();
    try {
      await recordApproval(
        'task-2398',
        { comment: 'LGTM', decidedAt: '2026-08-21T08:00:00.000Z', source: { kind: 'local' } },
        { missionStore: store, lifecycleService: lifecycle },
      );
      const replay = await recordApproval(
        'task-2398',
        { comment: 'LGTM again', decidedAt: '2026-08-21T09:00:00.000Z', source: { kind: 'local' } },
        { missionStore: store, lifecycleService: lifecycle },
      );
      assert.equal(replay.outcome, 'unchanged');

      const loaded = await store.load(MISSION);
      assert.equal(loaded.kind, 'found');
      const round = currentReviewRound(loaded.mission.review!);
      // A replay must not rewrite the authoritative decision time.
      assert.equal(round.decision?.kind, 'approved');
      assert.equal(round.decision?.decidedAt, '2026-08-21T08:00:00.000Z');
    } finally {
      await db.close();
    }
  });
});

describe('TASK-2398 SC2: approve on a fixing round fails loudly', () => {
  it('rejects approve after request-changes and leaves the changes-requested decision', async () => {
    const { store, db } = await awaitingReview();
    try {
      // The reviewer requested changes: round -> fixing, awaiting-implementation.
      const requested = await recordRequestedChanges(
        'task-2398',
        { findings: parseReviewFindings('## F1 (blocking): the import gate mutates the operator db'), comment: 'Changes', decidedAt: '2026-08-21T07:02:51.021Z' },
        { missionStore: store, lifecycleService: new MissionLifecycleService(store) },
      );
      assert.deepEqual(requested, { outcome: 'recorded' });
      const afterChanges = await store.load(MISSION);
      assert.equal(afterChanges.kind, 'found');
      assert.equal(reviewStatus(afterChanges.mission.review!), 'awaiting-implementation');

      // The regression: a later approve recorded against the still-fixing round.
      const approve = await recordApproval(
        'task-2398',
        { comment: 'APPROVED', decidedAt: '2026-08-21T09:00:00.000Z', source: { kind: 'local' } },
        { missionStore: store, lifecycleService: new MissionLifecycleService(store) },
      );

      // Loud failure, not a swallowed `[PASS]`. The diagnostic names the round's
      // status so the operator sees why approve cannot move it to `approved`.
      assert.equal(approve.outcome, 'failed');
      assert.match(approve.diagnostic, /awaiting-implementation/i, 'the diagnostic names the illegal transition away from fixing');

      // No path may leave the round with disposition APPROVED and a
      // changes-requested decision. The aggregate is untouched.
      const loaded = await store.load(MISSION);
      assert.equal(loaded.kind, 'found');
      const round = currentReviewRound(loaded.mission.review!);
      assert.equal(round.decision?.kind, 'changes-requested', 'the authoritative decision stays changes-requested');
      assert.equal(round.disposition, 'REQUEST_CHANGES', 'the round is not promoted to APPROVED');
      assert.notEqual(round.phase, 'approved');
      // The mission must still be integrable-refusing: it never left review
      // through an authoritative approval.
      assert.notEqual(loaded.mission.status, 'integration');
      assert.equal(reviewStatus(loaded.mission.review!), 'awaiting-implementation');
    } finally {
      await db.close();
    }
  });

  it('locks the task-2380 stuck state: an approving fixing round never satisfies the integration gate', async () => {
    // Reproduces the exact stuck aggregate from the task: decision_kind
    // changes-requested, disposition APPROVED, phase fixing. The gate reads
    // `lastRound.decision.kind`, so it must still report no authoritative
    // approval.
    const { store, db } = await awaitingReview();
    try {
      await recordRequestedChanges(
        'task-2398',
        { findings: parseReviewFindings('## F1 (blocking): the import gate mutates the operator db'), comment: 'Changes', decidedAt: '2026-08-21T07:02:51.021Z' },
        { missionStore: store, lifecycleService: new MissionLifecycleService(store) },
      );
      // The buggy approve path would have written disposition APPROVED here;
      // the fix refuses it, so the decision kind stays changes-requested.
      const loaded = await store.load(MISSION);
      assert.equal(loaded.kind, 'found');
      const round = currentReviewRound(loaded.mission.review!);
      assert.notEqual(round.decision?.kind, 'approved', 'the integration gate (lastRound.decision.kind === approved) still refuses');
    } finally {
      await db.close();
    }
  });
});

describe('TASK-2398 SC3: review-artifacts.ts approve path (recordLocalReviewVerdict)', () => {
  // Drives the exported postWorkflowReview self-author path, which records the
  // verdict through recordLocalReviewVerdict — the second approve path the task
  // names. reviewer === PR author selects the local-record branch.
  function selfAuthorOpts(store: Awaited<ReturnType<typeof awaitingReview>>['store']) {
    // F4: hermetic — run in a temp worktree with a stubbed event writer so the
    // self-author verdict path never drops a real markdown file into a live
    // mission's review-events directory (which fails EROFS on a read-only CI
    // checkout). The operator DB is already a throwaway temp SQLite.
    const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-selfauthor-'));
    temporaryDirectories.push(worktree);
    return {
      reviewIdentity: 'codex',
      readTokenFn: () => 'mock-token',
      getPrAuthorFn: () => 'codex',
      buildMetadataFooterFn: () => '',
      missionStore: store,
      worktree,
      createEventFn: (() => ({ ok: true, path: null })) as any,
      log: () => {},
      error: () => {},
    } as Parameters<typeof postWorkflowReview>[3];
  }

  it('records an authoritative approval on an awaiting-review round', async () => {
    const { store, db } = await awaitingReview();
    try {
      const result = await postWorkflowReview('task-2398', 'approve', 'LGTM', selfAuthorOpts(store));
      assert.equal(result.ok, true);
      assert.equal(result.skipped, true);
      const loaded = await store.load(MISSION);
      assert.equal(loaded.kind, 'found');
      assert.equal(currentReviewRound(loaded.mission.review!).decision?.kind, 'approved');
    } finally {
      await db.close();
    }
  });

  it('fails loudly on a fixing round and leaves the changes-requested decision', async () => {
    const { store, db } = await awaitingReview();
    try {
      await recordRequestedChanges(
        'task-2398',
        { findings: parseReviewFindings('## F1 (blocking): the import gate mutates the operator db'), comment: 'Changes', decidedAt: '2026-08-21T07:02:51.021Z' },
        { missionStore: store },
      );
      const result = await postWorkflowReview('task-2398', 'approve', 'APPROVED', selfAuthorOpts(store));
      assert.equal(result.ok, false, 'a fixing round cannot legally approve; the path fails loudly');
      assert.match(result.error ?? '', /could not record the approve decision/i);
      const loaded = await store.load(MISSION);
      assert.equal(loaded.kind, 'found');
      assert.equal(currentReviewRound(loaded.mission.review!).decision?.kind, 'changes-requested');
    } finally {
      await db.close();
    }
  });
});

describe('TASK-2398 SC3: review-commands.ts submitReviewRound approve path', () => {
  // Exercises the primary CLI approve path in `submitReviewRound` — the block
  // the task names as SC3's second site. Ports are stubbed so nothing touches a
  // live worktree (F4): the store-side decision is faked via `recordApprovalFn`,
  // the provider POST via `postReviewFn`, and the operator DB is a throwaway
  // temp SQLite. `resolveReviewIdentity` reads the faked review state, so no
  // real mission dir is required.
  function tempWorktree(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-review-cmds-'));
    temporaryDirectories.push(dir);
    return dir;
  }

  const reviewingState = () =>
    ({ round: 1, phase: 'reviewing', reviewer: 'rev', implementer: 'impl', transitionTo: () => {} }) as never;

  it('provider=none: an illegal approve fails loudly with exit(1) and "could not be recorded"', async () => {
    let exited: number | null = null;
    let recordCalled = false;
    await submitReviewRound('task-2398', 'approve', 'LGTM', {
      worktree: tempWorktree(),
      isForgejoReviewEnabledFn: () => false,
      missionStore: {} as any,
      recordApprovalFn: (async () => {
        recordCalled = true;
        return { outcome: 'failed', diagnostic: 'Approve cannot move the round to approved while review is fixing' } as never;
      }) as any,
      readReviewStateFn: () => null,
      writeReviewStateFn: (() => {}) as any,
      exit: ((code: number) => { exited = code; }) as any,
      log: () => {},
      error: () => {},
    });
    assert.equal(recordCalled, true, 'the review-commands.ts approve block ran recordApproval');
    assert.equal(exited, 1, 'an illegal approve exits non-zero');
  });

  it('provider=none: no Mission authority bound logs the WARN and does not exit', async () => {
    const logs: string[] = [];
    let exited: number | null = null;
    await submitReviewRound('task-2398', 'approve', 'LGTM', {
      worktree: tempWorktree(),
      isForgejoReviewEnabledFn: () => false,
      // deliberately no missionStore
      readReviewStateFn: () => null,
      writeReviewStateFn: (() => {}) as any,
      log: (m) => logs.push(m),
      exit: ((code: number) => { exited = code; }) as any,
      error: () => {},
    });
    assert.ok(logs.some((l) => /No Mission authority bound/.test(l)), 'warns when no authority is bound');
    assert.equal(exited, null, 'the WARN path does not exit');
  });

  it('provider-backed: a failed POST leaves NO approve recorded on the aggregate (F1)', async () => {
    let postCalled = false;
    let recordCalled = false;
    let exited: number | null = null;
    await submitReviewRound('task-2398', 'approve', 'LGTM', {
      worktree: tempWorktree(),
      isForgejoReviewEnabledFn: () => true,
      // bound like the three sibling tests so the recording blocks below are
      // reachable — without it recordCalled === false would be true by
      // construction (F7) and the regression it closes would be invisible.
      missionStore: {} as any,
      readReviewStateFn: reviewingState,
      writeReviewStateFn: (() => {}) as any,
      readTokenFn: () => 'token',
      getPrAuthorFn: () => 'someone-else',
      postReviewFn: () => {
        postCalled = true;
        return { ok: false, status: 500, data: { message: 'boom' } } as never;
      },
      recordApprovalFn: (async () => {
        recordCalled = true;
        return { outcome: 'recorded' } as never;
      }) as any,
      transitionTaskFn: (() => {}) as any,
      resolveTaskFileFn: () => ({ ok: false }) as any,
      log: () => {},
      error: () => {},
      exit: ((code: number) => { exited = code; }) as any,
    });
    assert.equal(postCalled, true, 'the provider POST was attempted');
    assert.equal(exited, 1, 'a failed POST exits 1');
    assert.equal(recordCalled, false, 'the approve was NOT recorded after a failed POST — the mission stays in review');
  });

  it('provider-backed: a successful POST records the authoritative approve', async () => {
    let postCalled = false;
    let recordCalled = false;
    let order: string[] = [];
    await submitReviewRound('task-2398', 'approve', 'LGTM', {
      worktree: tempWorktree(),
      isForgejoReviewEnabledFn: () => true,
      readReviewStateFn: reviewingState,
      writeReviewStateFn: (() => {}) as any,
      readTokenFn: () => 'token',
      getPrAuthorFn: () => 'someone-else',
      postReviewFn: () => {
        postCalled = true;
        order.push('post');
        return { ok: true } as never;
      },
      missionStore: {} as any,
      recordApprovalFn: (async () => {
        recordCalled = true;
        order.push('record');
        return { outcome: 'recorded' } as never;
      }) as any,
      transitionTaskFn: (() => {}) as any,
      resolveTaskFileFn: () => ({ ok: false }) as any,
      getTaskStatusFn: () => null,
      log: () => {},
      error: () => {},
    });
    assert.equal(postCalled, true, 'the provider POST was attempted');
    assert.equal(recordCalled, true, 'the approve is recorded after a successful POST');
    assert.deepEqual(order, ['post', 'record'], 'recordApproval runs only after the POST succeeded');
  });
});
