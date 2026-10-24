import { NO_CURRENT_WORK_PORT } from '../../../../src/application/recording/current-work-recorder.js';
import { makeExecutePorts } from '../../../fixtures/execute-mission-ports.js';
import { emptyBoardRepositories } from '../../../helpers/empty-board-repositories.js';
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

import { missionVersion, MissionStaleVersion } from '../../../../src/application/domain-ports.js';
import type {
  MissionLoadResult,
  MissionNelRecordReceipt,
  MissionTransitionStore,
  MissionVersion,
} from '../../../../src/application/domain-ports.js';
import { composeProductionCapabilities } from '../../../../src/composition/production-capabilities.js';
import { agentFamily } from '../../../../src/domain/agents.js';
import { DuplicateLaneEventError, type LaneTransitionEvent } from '../../../../src/domain/board-event.js';
import { intakeMission, missionId, missionLabels, type Mission } from '../../../../src/domain/mission.js';
import { repositoryId } from '../../../../src/domain/repository.js';
import {
  applyReviewerCommand,
  changeRevision,
  ConfiguredReviewerEligibility,
  currentReviewRound,
  reviewFindingId,
  reviewStatus,
  startReview,
  type Review,
} from '../../../../src/domain/review.js';
import { resolveConfiguration } from '../../../../src/composition/config.js';

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
    if (this.mission === null) { return { kind: 'missing' as const }; }
    return { kind: 'found' as const, mission: this.mission, version: this.version };
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
        throw new DuplicateLaneEventError(key);
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
      missionId: MISSION, name: 'CP-4',
      rawFilename: 'CP-4.md',
      firstLine: 'CP-4: browser controller authority audit',
      goalCheck: [{ criterion: 'SC9 interaction coverage', evidence: 'test/web-board-interaction.test.ts' }],
      nextActionText: '',
    }],
    review: reviewAwaitingImplementation(),
  };
}

/** Compose only what the handoff workflow needs; every other port stays unused. */
function composeWithRecordedLoop(store: FakeMissionStore) {
  const launches: { slug: string; options: Record<string, unknown> }[] = [];
  const repos = emptyBoardRepositories();
  const capabilities = composeProductionCapabilities(
    process.cwd(),
    REPOSITORY,
    { agentBlocklist: repos.blocklistRepo, operationalHistory: repos.historyRepo, boardLaneEvents: repos.laneEventRepo, usage: repos.usageRepo },
    makeExecutePorts().ports,
    store,
    NO_CURRENT_WORK_PORT,
    undefined,
    null,
    {
      configuration: resolveConfiguration({}),
      handoffReviewLoop: (async (request: { slug: string }) => {
        launches.push({ slug: request.slug, options: request as Record<string, unknown> });
      }),
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
  });
}

test('board handoff resume enters the shared review round owner without composition writes', async () => {
  const store = new FakeMissionStore(activeMissionUnderReview(), 3);
  const { capabilities, launches } = composeWithRecordedLoop(store);

  const result = await resumeVia(capabilities, 'active');
  assert.equal(result.status, 'completed', 'the typed handoff dispatch succeeds');

  assert.equal(store.mission!.review!.rounds.length, 1, 'composition opens no round; the loop owns progression');
  assert.equal(store.events.length, 0, 'composition records no lane event');
  assert.equal(launches.length, 1, 'the review loop is launched exactly once');
  assert.equal(launches[0].slug, SLUG);
  assert.equal(launches[0].options.isContinue, true);
  // Same limit `px review` grants a continuation of persisted round N.
  assert.equal(launches[0].options.maxAttempts, 5, 'the continuation limit is the shared owner contract');
});

test('board handoff resume launches the loop again without inventing a second lane event', async () => {
  const store = new FakeMissionStore(activeMissionUnderReview(), 3);
  const { capabilities, launches } = composeWithRecordedLoop(store);

  await resumeVia(capabilities, 'active');
  await resumeVia(capabilities, 'active');

  assert.equal(store.events.length, 0, 'composition records no transition');
  assert.equal(store.mission!.review!.rounds.length, 1, 'a repeated resume does not open a round');
  assert.equal(launches.length, 2, 'each resume hands the loop the mission');
});

test('board handoff resume hands an active mission with a round awaiting review to the review loop (TASK-2817)', async () => {
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
  assert.equal(result.status, 'completed', 'an interrupted pending review resumes instead of failing');
  assert.equal(store.mission!.review!.rounds.length, 1, 'no duplicate round is opened');
  assert.equal(store.events.length, 0, 'composition records no lane event; the review loop owns progression');
  assert.equal(launches.length, 1, 'the review loop receives the mission once');
  assert.equal(launches[0].options.isContinue, true);
});
