/**
 * TASK-2436 round-8 F1 — the board's handoff *resume* branch.
 *
 * A repeated board handoff on a mission that is already under review is a
 * resume signal, not a second submission. This is the highest-risk glue in the
 * mission: the browser supplies mission identity only, and the composition root
 * has to turn that into a real review round on its own. It broke once already
 * (round 6 shipped a transition that threw on every reachable resume state and
 * discarded the failure), so it is pinned here against fake ports only — no
 * SQL, no git, and no agent launch.
 *
 * The review loop reaches this test through the `handoffReviewLoop` override on
 * `ProductionCompositionOverrides`, the same test-only seam shape the draft
 * path already uses.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { missionVersion, MissionStaleVersion } from '../src/application/domain-ports.js';
import type {
  MissionLoadResult,
  MissionNelRecordReceipt,
  MissionTransitionStore,
  MissionVersion,
} from '../src/application/domain-ports.js';
import { composeProductionCapabilities } from '../src/composition/production-capabilities.js';
import { agentFamily } from '../src/domain/agents.js';
import type { LaneTransitionEvent } from '../src/domain/board-event.js';
import { intakeMission, missionId, missionLabels, type Mission } from '../src/domain/mission.js';
import { repositoryId } from '../src/domain/repository.js';
import {
  applyReviewerCommand,
  changeRevision,
  ConfiguredReviewerEligibility,
  currentReviewRound,
  reviewFindingId,
  reviewStatus,
  startReview,
  type Review,
} from '../src/domain/review.js';

const SLUG = 'task-2436-resume';
const MISSION = missionId(SLUG);
const REPOSITORY = repositoryId('parallix');
const REVIEWER = agentFamily('claude');
const IMPLEMENTER = agentFamily('codex');

/**
 * In-memory Mission authority that also models the durable lane-event
 * uniqueness the resume branch depends on. `saveAggregateWithTransition`
 * surfaces a UNIQUE violation as `Duplicate idempotency key`, which
 * `MissionLifecycleService` maps to a `conflict`, so a fake that ignores the
 * key would let a replayed transition pass unnoticed.
 */
class FakeMissionStore implements MissionTransitionStore {
  readonly events: LaneTransitionEvent[] = [];
  readonly idempotencyKeys: string[] = [];
  mission: Mission | null;
  version: MissionVersion = missionVersion(1);

  constructor(mission: Mission | null, version = 1) {
    this.mission = mission;
    this.version = missionVersion(version);
  }

  async load(): Promise<MissionLoadResult> {
    if (this.mission === null) { return { kind: 'missing' }; }
    return { kind: 'found', mission: this.mission, version: this.version };
  }

  async save(mission: Mission, expectedVersion: MissionVersion | null): Promise<MissionVersion> {
    if (expectedVersion !== null && expectedVersion !== this.version) {
      throw new MissionStaleVersion(mission.id, expectedVersion, this.version);
    }
    this.mission = mission;
    this.version = missionVersion(expectedVersion === null ? 1 : expectedVersion + 1);
    return this.version;
  }

  async saveWithTransition(
    mission: Mission,
    expectedVersion: MissionVersion | null,
    event: LaneTransitionEvent,
  ): Promise<MissionVersion> {
    const key = (event as { idempotencyKey?: string }).idempotencyKey;
    if (key !== undefined) {
      if (this.idempotencyKeys.includes(key)) {
        throw new Error(`Duplicate idempotency key: ${key}`);
      }
      this.idempotencyKeys.push(key);
    }
    const version = await this.save(mission, expectedVersion);
    this.events.push(event);
    return version;
  }

  async recordNel(): Promise<MissionNelRecordReceipt> {
    return { reference: `nel://${SLUG}` };
  }
}

/** A review that `request-changes` left awaiting the implementer — the state a repeated board handoff actually arrives in. */
function reviewAwaitingImplementation(): Review {
  const eligibility = ConfiguredReviewerEligibility.fromReviewStep({
    eligible: [REVIEWER],
    strategy: 'random',
  });
  const review = startReview(
    { change: { kind: 'local-branch', sourceBranch: `mission/${SLUG}`, targetBranch: 'main' }, revision: changeRevision('abc1234') },
    REVIEWER,
    IMPLEMENTER,
    '2026-08-31T10:00:00.000Z',
    eligibility,
  );
  return applyReviewerCommand(review, {
    type: 'request-changes',
    decidedAt: '2026-08-31T11:00:00.000Z',
    comment: 'The resume branch needs a dedicated test.',
    findings: [{ id: reviewFindingId('F1'), summary: 'The resume branch is untested.', location: 'src/composition/production-capabilities.ts' }],
  });
}

function activeMissionUnderReview(): Mission {
  return {
    ...intakeMission({
      id: MISSION,
      repositoryId: REPOSITORY,
      title: 'Add guarded browser actions',
      labels: missionLabels(['web']),
      assignee: IMPLEMENTER,
    }),
    status: 'active',
    // `submit-for-review` refuses a mission with no goal-check evidence, so the
    // fixture carries the checkpoint a real mission reaches review with.
    checkpoints: [{
      name: 'CP-4',
      rawFilename: 'CP-4.md',
      firstLine: 'CP-4: browser controller authority audit',
      goalCheck: [{ criterion: 'SC9 interaction coverage', evidence: 'test/web-board-interaction.test.ts' }],
      nextActionText: null,
    }],
    review: reviewAwaitingImplementation(),
  } as unknown as Mission;
}

/** Compose only what the handoff workflow needs; every other port stays unused. */
function composeWithRecordedLoop(store: FakeMissionStore) {
  const launches: { slug: string; options: Record<string, unknown> }[] = [];
  const capabilities = composeProductionCapabilities(
    process.cwd(),
    REPOSITORY,
    {} as never,
    {} as never,
    store,
    { read: async () => null } as never,
    undefined,
    null,
    {
      handoffReviewLoop: (async (slug: string, options: Record<string, unknown>) => {
        launches.push({ slug, options });
      }) as never,
    },
  );
  return { capabilities, launches };
}

/**
 * The board reaches the workflow the only way the browser can: a typed
 * `handoff:record` dispatch carrying mission identity and nothing else.
 */
function resumeVia(capabilities: ReturnType<typeof composeWithRecordedLoop>['capabilities'], status: string) {
  return capabilities.commandController.dispatch({
    operationId: `op-${status}`,
    kind: 'handoff:record',
    missionId: SLUG,
    missionStatusAtRequest: status,
    agent: IMPLEMENTER,
    capabilities: new Set(['handoff:record']),
    cancellation: { requested: false },
  } as never);
}

test('board handoff resume advances the review round and records one lane transition', async () => {
  const store = new FakeMissionStore(activeMissionUnderReview(), 3);
  const { capabilities, launches } = composeWithRecordedLoop(store);

  const result = await resumeVia(capabilities, 'active');
  assert.equal(result.status, 'completed', 'the typed handoff dispatch succeeds');

  const review = store.mission!.review!;
  assert.equal(review.rounds.length, 2, 'the resume starts the next review round');
  assert.equal(reviewStatus(review), 'awaiting-review');
  assert.equal(currentReviewRound(review).reviewer, REVIEWER, 'the resumed round keeps the persisted reviewer');
  assert.equal(store.mission!.status, 'review', 'the mission moves to its authoritative review lane');

  assert.equal(store.events.length, 1, 'exactly one lane event is recorded');
  assert.equal(store.events[0].from, 'active');
  assert.equal(store.events[0].to, 'review');
  assert.deepEqual(store.idempotencyKeys, [`handoff-resume-${SLUG}-2`], 'the key is scoped to the resumed round');

  assert.equal(launches.length, 1, 'the review loop is launched exactly once');
  assert.equal(launches[0].slug, SLUG);
  assert.equal(launches[0].options.isContinue, true);
  // SC9: a human-initiated continuation of persisted round N runs with a limit
  // of N+1. The automatic five-round cap is the CLI's own default and is pinned
  // by `review automation retains its five-round limit` in review-commands.test.ts.
  assert.equal(launches[0].options.maxAttempts, 2, 'a resume at round 2 grants exactly one further round');
});

test('board handoff resume launches the loop again without inventing a second lane event', async () => {
  const store = new FakeMissionStore(activeMissionUnderReview(), 3);
  const { capabilities, launches } = composeWithRecordedLoop(store);

  await resumeVia(capabilities, 'active');
  await resumeVia(capabilities, 'review');

  assert.equal(store.events.length, 1, 'the already-reviewing mission records no second transition');
  assert.deepEqual(store.idempotencyKeys, [`handoff-resume-${SLUG}-2`]);
  assert.equal(store.mission!.review!.rounds.length, 2, 'a repeated resume does not open a third round');
  assert.equal(launches.length, 2, 'each resume still hands the loop the mission');
  // SC9 again: the ceiling is always one beyond the persisted round count, so
  // every human restart permits exactly one further round — including this one,
  // which opens no new round because the mission is already reviewing.
  assert.deepEqual(
    launches.map((launch) => launch.options.maxAttempts),
    [2, 3],
    'each restart raises the limit to one beyond the rounds already persisted',
  );
});

test('board handoff resume refuses a review that is not waiting on the implementer', async () => {
  const store = new FakeMissionStore({
    ...activeMissionUnderReview(),
    review: startReview(
      { change: { kind: 'local-branch', sourceBranch: `mission/${SLUG}`, targetBranch: 'main' }, revision: changeRevision('abc1234') },
      REVIEWER,
      IMPLEMENTER,
      '2026-08-31T10:00:00.000Z',
      ConfiguredReviewerEligibility.fromReviewStep({ eligible: [REVIEWER], strategy: 'random' }),
    ),
  } as Mission, 3);
  const { capabilities, launches } = composeWithRecordedLoop(store);

  const result = await resumeVia(capabilities, 'active');
  assert.notEqual(result.status, 'completed', 'a review that is not awaiting the implementer cannot resume');
  assert.equal(store.events.length, 0, 'a refused resume records no lane event');
  assert.equal(launches.length, 0, 'a refused resume never reaches the review loop');
});
