import { ReviewState } from '../../../src/adapters/review/review-state.js';
import { reviewStateWriterFixture } from '../../helpers/review-state-writer.js';

// review decision authority contract.
// Related scenarios share imports; each contract keeps its own hooks and mutable fixtures.
import { fixtureMission, inMemoryTransitionStore } from '../../fixtures/mission-builders.js';
import { describe, afterEach, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { MissionLifecycleService } from '../../../src/application/mission-lifecycle-service.js';
import { recordApproval, parseReviewFindings, recordRequestedChanges } from '../../../src/adapters/review/review-round.js';
import { postWorkflowReview } from '../../../src/adapters/review/review-artifacts.js';
import { submitReviewRound } from '../../../src/adapters/review/review-commands.js';
import { agentFamily } from '../../../src/domain/agents.js';
import { missionId } from '../../../src/domain/mission.js';
import {
  ConfiguredReviewerEligibility,
  currentReviewRound,
  changeRevision,
  reviewStatus,
  startReview,
} from '../../../src/domain/review.js';
import { mkdtemp as registeredMkdtemp } from '../../helpers/temp-dir.js';

// Regression provenance: TASK-2398.
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

const MISSION = missionId('task-2398');
const CAPABILITIES = new Set(['mission:intake', 'mission:transition', 'checkpoint:record'] as const);
const reviewer = agentFamily('codex');
const implementer = agentFamily('custom');
const eligibility = ConfiguredReviewerEligibility.fromReviewStep({ eligible: [reviewer], strategy: 'random' });

const change = {
  kind: 'pull-request' as const,
  provider: 'forgejo',
  id: '2398',
  url: 'http://localhost:3300/example/parallix/pulls/2398',
  sourceBranch: 'mission/task-2398',
  targetBranch: 'main',
} satisfies import("../../../src/domain/review.js").ReviewedChange;

const temporaryDirectories: string[] = [];

/**
 * A mission submitted for review: round 1 in `reviewing`, `awaiting-review`,
 * mission status `review`. Mirrors what `px handoff` + `submit-for-review`
 * leave behind before the reviewer acts.
 */
async function awaitingReview() {
  const store = inMemoryTransitionStore(fixtureMission('task-2398', {
    status: 'review', assignee: implementer,
    review: startReview(
      { change, revision: changeRevision('rev-1') }, reviewer, implementer,
      '2026-08-21T07:00:00.000Z', eligibility,
    ),
  }));
  return { store, lifecycle: new MissionLifecycleService(store) };
}

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("SC1: approve on an awaiting-review round is authoritative", () => {
  it('records decision.kind === approved and moves the mission to integration', async () => {
    const { store, lifecycle } = await awaitingReview();
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
    const events = store.events;
    assert.ok(
      events.some((event) => event.idempotencyKey === 'approve:task-2398:round-1'),
      'approval idempotency is stable for its review round',
    );
  });

  it('reports unchanged when an approve is replayed on an already-approved round', async () => {
    const { store, lifecycle } = await awaitingReview();
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
  });
});

describe("an approved round stranded in review finishes its transition", () => {
  it('moves the mission to integration when the approve is replayed', async () => {
    const { store, lifecycle } = await awaitingReview();
    // The decision was saved but the review → integration boundary never ran.
    await recordApproval(
      'task-2398',
      { comment: 'LGTM', decidedAt: '2026-08-21T08:00:00.000Z', source: { kind: 'local' } },
      { missionStore: store },
    );
    const stranded = await store.load(MISSION);
    assert.equal(stranded.kind, 'found');
    assert.equal(stranded.mission.status, 'review');

    const replay = await recordApproval(
      'task-2398',
      { comment: null, decidedAt: '2026-08-21T09:00:00.000Z' },
      { missionStore: store, lifecycleService: lifecycle },
    );
    assert.deepEqual(replay, { outcome: 'recorded' });

    const loaded = await store.load(MISSION);
    assert.equal(loaded.kind, 'found');
    assert.equal(loaded.mission.status, 'integration');
    assert.equal(currentReviewRound(loaded.mission.review!).decision?.decidedAt, '2026-08-21T08:00:00.000Z');
  });
});

describe("SC2: approve on a fixing round fails loudly", () => {
  it('rejects approve after request-changes and leaves the changes-requested decision', async () => {
    const { store } = await awaitingReview();
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
  });

  it('locks the task-2380 stuck state: an approving fixing round never satisfies the integration gate', async () => {
    // Reproduces the exact stuck aggregate from the task: decision_kind
    // changes-requested, disposition APPROVED, phase fixing. The gate reads
    // `lastRound.decision.kind`, so it must still report no authoritative
    // approval.
    const { store } = await awaitingReview();
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
  });
});

describe("SC3: review-artifacts.ts approve path (recordLocalReviewVerdict)", () => {
  // Drives the exported postWorkflowReview self-author path, which records the
  // verdict through recordLocalReviewVerdict — the second approve path the task
  // names. reviewer === PR author selects the local-record branch.
  function selfAuthorOpts(store: Awaited<ReturnType<typeof awaitingReview>>['store']) {
    // F4: hermetic — run in a temp worktree with a stubbed event writer so the
    // self-author verdict path never drops a real markdown file into a live
    // mission's review-events directory (which fails EROFS on a read-only CI
    // checkout). The Mission store is an isolated in-memory port double.
    const worktree = registeredMkdtemp('parallix-selfauthor-');
    temporaryDirectories.push(worktree);
    return {
      reviewIdentity: 'codex',
      readTokenFn: () => 'mock-token',
      getPrAuthorFn: () => 'codex',
      buildMetadataFooterFn: () => '',
      missionStore: store,
      worktree, revision: 'reviewed-head',
      createEventFn: (() => ({ ok: true as const, path: null })),
      log: () => {},
      error: () => {},
    } as Parameters<typeof postWorkflowReview>[3];
  }

  it('records an authoritative approval on an awaiting-review round', async () => {
    const { store } = await awaitingReview();
    const result = await postWorkflowReview('task-2398', 'approve', 'LGTM', selfAuthorOpts(store));
    assert.equal(result.ok, true);
    assert.equal(result.skipped, true);
    const loaded = await store.load(MISSION);
    assert.equal(loaded.kind, 'found');
    assert.equal(currentReviewRound(loaded.mission.review!).decision?.kind, 'approved');
  });

  it('fails loudly on a fixing round and leaves the changes-requested decision', async () => {
    const { store } = await awaitingReview();
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
  });
});

describe("SC3: review-commands.ts submitReviewRound approve path", () => {
  // Exercises the primary CLI approve path in `submitReviewRound` — the block
  // the task names as SC3's second site. Ports are stubbed so nothing touches a
  // live worktree (F4): the store-side decision is faked via `recordApprovalFn`,
  // the provider POST via `postReviewFn`, and the operator DB is a throwaway
  // in-memory store. `resolveReviewIdentity` reads the faked review state, so no
  // real mission dir is required.
  function tempWorktree(): string {
    const dir = registeredMkdtemp('parallix-review-cmds-');
    temporaryDirectories.push(dir);
    return dir;
  }

  const reviewingState: NonNullable<NonNullable<Parameters<typeof submitReviewRound>[3]>["readReviewStateFn"]> = () =>
    new ReviewState('task-2398', { round: 1, phase: 'reviewing', reviewer: 'rev', implementer: 'impl' });

  it('provider=none: an illegal approve fails loudly with exit(1) and "could not be recorded"', async () => {
    let exited: { value: number | null } = { value: null };
    let recordCalled = false;
    await submitReviewRound('task-2398', 'approve', 'LGTM', {
      worktree: tempWorktree(), revision: 'reviewed-head',
      isForgejoReviewEnabledFn: () => false,
      missionStore: inMemoryTransitionStore(fixtureMission('task-2398')),
      recordApprovalFn: (async () => {
        recordCalled = true;
        return { outcome: 'failed', diagnostic: 'Approve cannot move the round to approved while review is fixing' };
      }),
      readReviewStateFn: () => null,
      writeReviewStateFn: reviewStateWriterFixture(() => {}),
      exit: ((code: number) => { exited.value = code; }),
      log: () => {},
      error: () => {},
    });
    assert.equal(recordCalled, true, 'the review-commands.ts approve block ran recordApproval');
    assert.equal(exited.value, 1, 'an illegal approve exits non-zero');
  });

  it('provider=none: no Mission authority bound logs the WARN and does not exit', async () => {
    const logs: string[] = [];
    let exited: { value: number | null } = { value: null };
    await submitReviewRound('task-2398', 'approve', 'LGTM', {
      worktree: tempWorktree(), revision: 'reviewed-head',
      isForgejoReviewEnabledFn: () => false,
      // deliberately no missionStore
      readReviewStateFn: () => null,
      writeReviewStateFn: reviewStateWriterFixture(() => {}),
      log: (m) => logs.push(m),
      exit: ((code: number) => { exited.value = code; }),
      error: () => {},
    });
    assert.ok(logs.some((l) => /No Mission authority bound/.test(l)), 'warns when no authority is bound');
    assert.equal(exited.value, null, 'the WARN path does not exit');
  });

  it('provider-backed: a failed POST leaves NO approve recorded on the aggregate (F1)', async () => {
    let postCalled = false;
    let recordCalled = false;
    let exited: { value: number | null } = { value: null };
    await submitReviewRound('task-2398', 'approve', 'LGTM', {
      worktree: tempWorktree(), revision: 'reviewed-head',
      isForgejoReviewEnabledFn: () => true,
      // bound like the three sibling tests so the recording blocks below are
      // reachable — without it recordCalled === false would be true by
      // construction (F7) and the regression it closes would be invisible.
      missionStore: inMemoryTransitionStore(fixtureMission('task-2398')),
      readReviewStateFn: reviewingState,
      writeReviewStateFn: reviewStateWriterFixture(() => {}),
      readTokenFn: () => 'token',
      getPrAuthorFn: () => 'someone-else',
      postReviewFn: () => {
        postCalled = true;
        return { statusCode: null, stderr: null, error: null,  ok: false, status: 500, data: { message: 'boom' } };
      },
      recordApprovalFn: (async () => {
        recordCalled = true;
        return { outcome: 'recorded' };
      }),
      transitionTaskFn: (async () => true),
      resolveTaskFileFn: () => ({ matches: [], reason: 'missing',  ok: false }),
      log: () => {},
      error: () => {},
      exit: ((code: number) => { exited.value = code; }),
    });
    assert.equal(postCalled, true, 'the provider POST was attempted');
    assert.equal(exited.value, 1, 'a failed POST exits 1');
    assert.equal(recordCalled, false, 'the approve was NOT recorded after a failed POST — the mission stays in review');
  });

  it('provider-backed: a successful POST records the authoritative approve', async () => {
    let postCalled = false;
    let recordCalled = false;
    let order: string[] = [];
    await submitReviewRound('task-2398', 'approve', 'LGTM', {
      worktree: tempWorktree(), revision: 'reviewed-head',
      isForgejoReviewEnabledFn: () => true,
      readReviewStateFn: reviewingState,
      writeReviewStateFn: reviewStateWriterFixture(() => {}),
      readTokenFn: () => 'token',
      getPrAuthorFn: () => 'someone-else',
      postReviewFn: () => {
        postCalled = true;
        order.push('post');
        return { data: null, status: null, statusCode: null, stderr: null, error: null,  ok: true };
      },
      missionStore: inMemoryTransitionStore(fixtureMission('task-2398')),
      recordApprovalFn: (async () => {
        recordCalled = true;
        order.push('record');
        return { outcome: 'recorded' };
      }),
      transitionTaskFn: (async () => true),
      resolveTaskFileFn: () => ({ matches: [], reason: 'missing',  ok: false }),
      getTaskStatusFn: () => null,
      log: () => {},
      error: () => {},
    });
    assert.equal(postCalled, true, 'the provider POST was attempted');
    assert.equal(recordCalled, true, 'the approve is recorded after a successful POST');
    assert.deepEqual(order, ['post', 'record'], 'recordApproval runs only after the POST succeeded');
  });
});

it('classifier decision preserves review authority and rejects stale/partial scope (TASK-2658)', async () => {
  const { applyClassifierReview, assertClassifierReviewSource, LEGACY_CLASSIFIER_POLICY_VERSION } = await import('../../../src/domain/classifier-review.js');
  const { repeatReview } = await import('../../fixtures/repeat-review.js');
  const source = { kind: 'classifier' as const, identity: 'jev' as const, decisionId: 'd', provider: 'typesafe', model: 'jev',
    packetHash: 'c'.repeat(64), priorRevision: 'a'.repeat(40), candidateRevision: 'b'.repeat(40), findingIds: ['F1'], policyVersion: 'jev-three-question-51-80-89-omissions-v2', label: 'addresses', score: 0.52 } satisfies NonNullable<Parameters<typeof applyClassifierReview>[1]>;
  const review = repeatReview();
  const legacy = { ...source, policyVersion: LEGACY_CLASSIFIER_POLICY_VERSION, score: 0.51 };
  assert.doesNotThrow(() => assertClassifierReviewSource(legacy), 'historical decisions retain their original threshold');
  assert.throws(() => applyClassifierReview(review, legacy, 'clear', '2026-10-06T00:00:00Z'), /current policy/);
  assert.throws(() => applyClassifierReview(review, { ...source, score: 0.509 }, 'clear', '2026-10-06T00:00:00Z'), /provenance/);
  const approved = applyClassifierReview(review, source, 'clear', '2026-10-06T00:00:00Z');
  assert.equal(currentReviewRound(approved).decision?.classifier?.identity, 'jev');
  assert.equal(currentReviewRound(approved).reviewer, 'claude', 'classifier never impersonates or replaces the general reviewer');
  assert.equal(currentReviewRound(approved).phase, 'approved');
  assert.throws(() => applyClassifierReview(review, { ...source, findingIds: [] }, 'clear', '2026-10-06T00:00:00Z'), /provenance/);
  assert.throws(() => applyClassifierReview(review, { ...source, priorRevision: 'c'.repeat(40) }, 'clear', '2026-10-06T00:00:00Z'), /stale/);
  assert.throws(() => applyClassifierReview(review, { ...source, score: 0.50 }, 'clear', '2026-10-06T00:00:00Z'), /provenance/);
});

it('classifier provenance binds a decided head without rewriting the start (TASK-2675, TASK-2752)', async () => {
  const { applyClassifierReview } = await import('../../../src/domain/classifier-review.js');
  const { repeatReview } = await import('../../fixtures/repeat-review.js');
  const review = repeatReview();
  const source = { kind: 'classifier' as const, identity: 'jev' as const, decisionId: 'd', provider: 'typesafe', model: 'jev',
    packetHash: 'c'.repeat(64), priorRevision: 'a'.repeat(40), candidateRevision: 'b'.repeat(40), findingIds: ['F1'],
    policyVersion: 'jev-three-question-51-80-89-omissions-v2', label: 'addresses', score: 0.52 };
  // Malformed provenance is rejected by the single assertion before any scope check.
  for (const broken of [{ ...source, identity: 'other' }, { ...source, packetHash: 'short' }, { ...source, score: 1.2 }, { ...source, label: 'insufficient_evidence' }]) {
    // @ts-expect-error Deliberately invalid classifier identity must fail provenance validation.
    assert.throws(() => applyClassifierReview(review, broken, 'clear', '2026-10-06T00:00:00Z'), /provenance/);
  }
  assert.throws(() => applyClassifierReview(review, source, 'clear', 'not a date'), /provenance/);
  const advanced = applyClassifierReview(review, { ...source, candidateRevision: 'c'.repeat(40), responseRevision: 'b'.repeat(40) }, 'clear', '2026-10-06T00:00:00Z', [], 'c'.repeat(40));
  assert.equal(currentReviewRound(advanced).decision?.revision, 'c'.repeat(40));
  assert.equal(advanced.rounds.length, review.rounds.length);
  assert.equal(currentReviewRound(advanced).subject.revision, 'b'.repeat(40));
  assert.equal(currentReviewRound(review).decision, null, 'the stored review is not mutated');
});

it('classifier integration repairs bind the withdrawn gate and retain its complete obligation', async () => {
  const { applyClassifierReview } = await import('../../../src/domain/classifier-review.js');
  const { repeatReview } = await import('../../fixtures/repeat-review.js');
  const initial = repeatReview();
  const revokedAt = '2026-10-01T00:02:00Z';
  const revocation = { revokedAt, revokedBy: 'workflow', reason: 'Gate failed',
    cause: { kind: 'integration-gate-failure' as const, gate: 'output', command: 'node answer.mjs',
      log: 'at file:///repo/answer.mjs:25:14 required output missing' } };
  const review = { ...initial, rounds: [{ ...initial.rounds[0], response: null,
    decision: { kind: 'approved' as const, revision: changeRevision('a'.repeat(40)), decidedAt: '2026-10-01T00:01:00Z', comment: 'Prior approval', source: { kind: 'local' as const }, revocation } }, initial.rounds[1]] } as typeof initial;
  const source = { kind: 'classifier' as const, identity: 'jev' as const, decisionId: 'd', provider: 'typesafe', model: 'jev',
    packetHash: 'c'.repeat(64), priorRevision: 'a'.repeat(40), candidateRevision: 'b'.repeat(40), responseRevision: 'b'.repeat(40),
    findingIds: ['integration-gate-repair'], integrationRepair: { revokedAt, gate: 'output' },
    policyVersion: 'jev-three-question-51-80-89-omissions-v2', label: 'addresses', score: 0.52 } satisfies NonNullable<Parameters<typeof applyClassifierReview>[1]>;
  const at = '2026-10-06T00:00:00Z';
  const approved = applyClassifierReview(review, source, 'clear', at);
  assert.equal(currentReviewRound(approved).phase, 'approved');
  assert.deepEqual(approved.rounds[0], review.rounds[0], 'withdrawn approval stays auditable');
  for (const integrationRepair of [{ revokedAt: at, gate: 'output' }, { revokedAt, gate: 'other' }]) {
    assert.throws(() => applyClassifierReview(review, { ...source, integrationRepair }, 'clear', at), /scope is stale/);
  }
  assert.throws(() => applyClassifierReview(review, { ...source, integrationRepair: undefined }, 'clear', at), /stale/);
  assert.throws(() => applyClassifierReview(review, { ...source, responseRevision: undefined }, 'clear', at), /stale/);
  assert.throws(() => applyClassifierReview(review, { ...source, candidateRevision: 'd'.repeat(40) }, 'clear', at), /stale/);
  assert.throws(() => applyClassifierReview(review, { ...source, findingIds: ['F1'] }, 'clear', at), /complete original/);
  const operatorRevoked = { ...review, rounds: [{ ...review.rounds[0], decision: {
    ...review.rounds[0].decision!, revocation: { ...revocation, cause: { kind: 'operator' as const } },
  } }, review.rounds[1]] } as typeof review;
  assert.throws(() => applyClassifierReview(operatorRevoked, source, 'clear', at), /scope is stale/);
  assert.throws(() => applyClassifierReview(review, { ...source, policyVersion: 'integration-repair-52-81-v1' }, 'clear', at), /current policy/);
  assert.throws(() => applyClassifierReview(review, { ...source, label: 'does_not_address', score: 0.889 }, 'implementer', at), /provenance/);
  const unresolved = applyClassifierReview(review, { ...source, label: 'does_not_address', score: 0.89 }, 'implementer', at);
  const decision = currentReviewRound(unresolved).decision;
  assert.equal(decision?.kind, 'changes-requested');
  if (decision?.kind === 'changes-requested') {
    assert.equal(decision.findings[0].id, 'integration-gate-repair');
    assert.equal(decision.findings[0].location, '/repo/answer.mjs:25');
    assert.match(decision.findings[0].summary, /required output missing/);
  }
});

it('a weakening decision restores the withdrawn approval only with its own provenance and threshold (TASK-2736)', async () => {
  const { applyClassifierReview, assertClassifierReviewSource, classifierPolicyThresholds, WEAKENING_POLICY_VERSION } = await import('../../../src/domain/classifier-review.js');
  const { repeatReview } = await import('../../fixtures/repeat-review.js');
  const initial = repeatReview();
  const revokedAt = '2026-10-01T00:02:00Z';
  const revocation = { revokedAt, revokedBy: 'workflow', reason: 'Gate failed',
    cause: { kind: 'integration-gate-failure' as const, gate: 'unit', command: 'npm test', log: 'x.java:1 failed' } };
  const review = { ...initial, rounds: [{ ...initial.rounds[0], response: null,
    decision: { kind: 'approved' as const, revision: changeRevision('a'.repeat(40)), decidedAt: '2026-10-01T00:01:00Z', comment: 'Prior approval', source: { kind: 'local' as const }, revocation } }, initial.rounds[1]] } as typeof initial;
  const source = { kind: 'classifier' as const, identity: 'jev' as const, decisionId: 'd', provider: 'typesafe', model: 'jev',
    packetHash: 'c'.repeat(64), priorRevision: 'a'.repeat(40), candidateRevision: 'b'.repeat(40), responseRevision: 'b'.repeat(40),
    findingIds: ['integration-gate-repair'], integrationRepair: { revokedAt, gate: 'unit' }, policyVersion: WEAKENING_POLICY_VERSION, label: 'preserves', score: 0.6,
    weakening: { decisionSource: 'integration-repair-weakening' as const, approvedRevision: 'a'.repeat(40), gate: 'unit', validationSha: 'b'.repeat(40),
      validationRecordedAt: '2026-10-01T00:02:30Z', relation: 'same' as const } } satisfies NonNullable<Parameters<typeof applyClassifierReview>[1]>;
  const at = '2026-10-06T00:00:00Z';
  const approved = applyClassifierReview(review, source, 'clear', at);
  assert.equal(currentReviewRound(approved).decision?.kind, 'approved');
  assert.doesNotThrow(() => assertClassifierReviewSource({ ...source, policyVersion: 'integration-repair-weakening-v4-preserves-0.60' }));
  assert.deepEqual(classifierPolicyThresholds('jev-three-question-51-80-89-v1'), { clear: 0.51, unresolved: 0.89 });
  assert.deepEqual(currentReviewRound(approved).decision?.classifier?.weakening, source.weakening);
  for (const clearedBy of ['weakening-v4', 'weakening-v5'] as const) {
    const question = { clearedBy, preserves: 0.6, versions: ['weakening-v4', 'weakening-v5'] as const } satisfies { readonly clearedBy: "weakening-v4" | "weakening-v5"; readonly preserves: number; readonly versions: readonly ["weakening-v4", "weakening-v5"]; };
    const updated = applyClassifierReview(review, { ...source, weakening: { ...source.weakening, question } }, 'clear', at);
    assert.deepEqual(currentReviewRound(updated).decision?.classifier?.weakening?.question, question);
    assert.match(currentReviewRound(updated).decision!.comment!, new RegExp(`cleared by ${clearedBy}, preserves 0.6, questions weakening-v4, weakening-v5`));
    assert.throws(() => applyClassifierReview(review, { ...source, weakening: { ...source.weakening, question: { ...question, preserves: 0.9 } } }, 'clear', at), /provenance/);
  }
  const noFact = { ...source, weakening: { decisionSource: source.weakening.decisionSource,
    approvedRevision: source.priorRevision, gate: 'unit', factAdmitted: false,
    question: { clearedBy: 'weakening-v4-optional-fact-v1' as const, preserves: 0.6,
      versions: ['weakening-v4-optional-fact-v1', 'weakening-v5-optional-fact-v1'] as const } } };
  const noFactApproval = currentReviewRound(applyClassifierReview(review, noFact, 'clear', at)).decision!;
  assert.match(noFactApproval.comment!, /no admitted re-run fact; mandatory integration gates still apply/);
  assert.doesNotMatch(noFactApproval.comment!, /green/);
  for (const fabricated of [{ validationSha: source.weakening.validationSha }, { validationRecordedAt: at }, { relation: 'same' as const }]) {
    assert.throws(() => assertClassifierReviewSource({ ...noFact, weakening: { ...noFact.weakening, ...fabricated } }), /provenance/);
  }
  assert.throws(() => applyClassifierReview(review, { ...source, score: 0.599 }, 'clear', at), /provenance/);
  assert.throws(() => applyClassifierReview(review, { ...source, weakening: undefined }, 'clear', at), /provenance/);
  assert.throws(() => applyClassifierReview(review, { ...source, label: 'addresses' }, 'clear', at), /provenance/);
  assert.throws(() => applyClassifierReview(review, { ...source, weakening: { ...source.weakening, gate: 'other' } }, 'clear', at), /provenance/);
  assert.throws(() => applyClassifierReview(review, { ...source, weakening: { ...source.weakening, approvedRevision: 'd'.repeat(40) } }, 'clear', at), /provenance/);
  assert.throws(() => applyClassifierReview(review, { ...source, label: 'does_not_address', score: 1 }, 'implementer', at), /provenance/);
  assert.throws(() => applyClassifierReview(review, source, 'implementer', at), /provenance/);
});

it('first-review classifier decisions are rejected while historical provenance remains readable (TASK-2703)', async () => {
  const { applyClassifierReview, assertClassifierReviewSource, successCriteriaFindings } = await import('../../../src/domain/classifier-review.js');
  const { repeatReview } = await import('../../fixtures/repeat-review.js');
  const review = repeatReview();
  const first = { ...review, rounds: [{ ...review.rounds[1], number: 1 }] as const };
  const source = { kind: 'classifier' as const, identity: 'jev' as const, decisionId: 'd', provider: 'typesafe', model: 'jev',
    packetHash: 'c'.repeat(64), priorRevision: 'b'.repeat(40), candidateRevision: 'b'.repeat(40),
    successCriteria: { baseRef: 'main' }, findingIds: ['success-criterion-1'],
    policyVersion: 'jev-three-question-51-80-89-omissions-v2', label: 'addresses', score: 0.99 };
  assert.doesNotThrow(() => assertClassifierReviewSource(source));
  assert.throws(() => applyClassifierReview(first, source, 'clear', '2026-10-06T00:00:00Z', successCriteriaFindings(['Output preserved'])), /First review requires/);
  assert.equal(currentReviewRound(first).decision, null);
});

it('obligation authority checks the general ancestor and complete obligation set (TASK-2753)', async () => {
  const { applyClassifierReview, OBLIGATION_POLICY_VERSION } = await import('../../../src/domain/classifier-review.js');
  const { repeatReview } = await import('../../fixtures/repeat-review.js');
  const review = repeatReview();
  const source = { kind: 'classifier' as const, identity: 'jev' as const, decisionId: 'd', provider: 'stub', model: 'jev',
    packetHash: 'c'.repeat(64), priorRevision: 'a'.repeat(40), candidateRevision: 'b'.repeat(40), findingIds: ['F1'],
    policyVersion: OBLIGATION_POLICY_VERSION, label: 'addresses', score: 0.97, obligations: { generalRound: 1, failingIds: [] as string[] } };
  assert.equal(applyClassifierReview(review, source, 'clear', '2026-10-06T00:00:00Z').rounds.at(-1)!.decision?.kind, 'approved');
  for (const patch of [{ score: 0.969999 }, { obligations: undefined }, { obligations: { generalRound: 2, failingIds: [] } },
    { findingIds: ['H1'] }, { priorRevision: 'd'.repeat(40) }]) {
    assert.throws(() => applyClassifierReview(review, { ...source, ...patch }, 'clear', '2026-10-06T00:00:00Z'));
  }
  assert.throws(() => applyClassifierReview(review, { ...source, label: 'does_not_address' }, 'implementer', '2026-10-06T00:00:00Z'));
});
