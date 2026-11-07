import { seedDraftedContract } from '../../helpers/seed-drafted-contract.js';
// Historical regression provenance: TASK-2347.02, TASK-2357.
/**
 * Lifecycle history for the metrics slice (TASK-2622.13 consolidation).
 *
 * integration-ci tier provenance tests migrated from
 * `test/task-2347.02-lifecycle-history.test.ts` (TASK-2347.02 SC4: one mission,
 * one gap-free ordered lane history), `test/task-2357.a-historical-intake.test.ts`
 * (TASK-2357 defect A: historical flow excludes missions before intake), and
 * `test/task-2357.e-legacy-history-scope.test.ts` (TASK-2357 defect E: the legacy
 * lifecycle-entry fallback stays inside its repository). These exercise the real
 * SQLite operator database and the production lifecycle use cases, so they stay
 * in the integration-ci lane. Historical task IDs are kept in case names as
 * regression provenance (AC#7).
 */
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { MissionVersion } from '../../../src/application/domain-ports.js';
import { MissionCheckpointService } from '../../../src/application/mission-checkpoint-service.js';
import { MissionIntakeService } from '../../../src/application/mission-intake-service.js';
import { MissionIntegrationService } from '../../../src/application/mission-integration-service.js';
import { MissionLifecycleService } from '../../../src/application/mission-lifecycle-service.js';
import { SqliteBoardLaneEventRepository } from '../../../src/adapters/sqlite/board-lane-event-repository.js';
import { SqliteDatabaseAdapter } from '../../../src/adapters/sqlite/database-adapter.js';
import { loadDefaultMigrations, SqliteMigrationRunner } from '../../../src/adapters/sqlite/migration-runner.js';
import { SqliteMissionStore } from '../../../src/adapters/sqlite/mission-store.js';
import { agentFamily } from '../../../src/domain/agents.js';
import { missionId, missionLabels } from '../../../src/domain/mission.js';
import type { MissionTransition } from '../../../src/domain/mission-workflow.js';
import { repositoryId } from '../../../src/domain/repository.js';
import {
  applyReviewerCommand,
  changeRevision,
  ConfiguredReviewerEligibility,
  startReview,
} from '../../../src/domain/review.js';
import { ConcreteMetricsReadAdapter } from '../../../src/application/projections/metrics-read-adapter.js';
import {
  deriveLaneIntervals,
  medianCycleTimeByStateSeries,
} from '../../../src/application/projections/metrics.js';
import {
  createHumanReviewEpisodeReader,
  workflowReturnsFromHistory,
} from '../../../src/adapters/review/review-statistics-evidence.js';
import type { MissionId, MissionStatus } from '../../../src/domain/mission.js';
import {
  fixedClock,
  laneEvent,
  withStatisticsDatabase,
} from '../../fixtures/statistics-database.js';

/**
 * TASK-2347.02 SC4 — one mission, one gap-free lane history.
 *
 * Drives a single mission from intake to closure through the application use
 * cases against a real SQLite fixture, then replays `board_lane_events` and
 * asserts the recorded history is ordered and continuous: the first row starts
 * from no lane, and every later row leaves the lane the previous row entered.
 * A missing lifecycle step shows up here as a break in that chain.
 */



/**
 * Draft settles the contract activation demands: a goal, a why, a scope and at
 * least one verification gate (`requireDraftedContract` in mission-workflow.ts).
 * A fixture that activates without it is not a mission the workflow can produce.
 */


const MISSION = missionId('task-2347.02-lifecycle');
const REPOSITORY = repositoryId('parallix');
const IMPLEMENTER = agentFamily('custom');
const REVIEWER = agentFamily('codex');
const CAPABILITIES = new Set([
  'mission:intake',
  'mission:transition',
  'checkpoint:record',
  'integration:decide',
  'closure:record',
] as const);

const temporaryDirectories: string[] = [];

const reviewerEligibility = ConfiguredReviewerEligibility.fromReviewStep({
  eligible: [REVIEWER],
  strategy: 'random',
});

const pullRequest = {
  kind: 'pull-request' as const,
  provider: 'forgejo',
  id: '2347',
  url: '/pull/2347',
  sourceBranch: 'mission/task-2347.02',
  targetBranch: 'main',
} satisfies import("../../../src/domain/review.js").ReviewedChange;

function version(outcome: { value?: { version: MissionVersion } }): MissionVersion {
  return outcome.value!.version;
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    fs.rmSync(temporaryDirectories.pop()!, { recursive: true, force: true });
  }
});

describe("full lifecycle lane history", () => {
  it('records a gap-free ordered lane history from backlog entry to closure', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-task-2347-02-history-'));
    temporaryDirectories.push(directory);
    const db = new SqliteDatabaseAdapter();
    await db.open({ path: path.join(directory, 'fixture.db') });
    await new SqliteMigrationRunner(db).applyPending(loadDefaultMigrations());
    const store = new SqliteMissionStore(db);
    const events = new SqliteBoardLaneEventRepository(db);

    try {
      // backlog
      const intake = await new MissionIntakeService(store).execute({
        operationId: 'op-intake',
        missionId: MISSION,
        repositoryId: REPOSITORY,
        title: 'Close the gaps in the lifecycle event stream',
        labels: missionLabels(['ai_sdlc']),
        assignee: IMPLEMENTER,
        occurredAt: '2026-08-08T00:00:00.000Z',
        capabilities: CAPABILITIES,
      });
      assert.equal(intake.status, 'completed', JSON.stringify(intake));

      // backlog -> refined: what `px draft` records once the contract is recorded.
      const lifecycle = new MissionLifecycleService(store);
      const contractVersion = await seedDraftedContract(store, MISSION);
      const refined = await lifecycle.transition({
        operationId: 'op-refine',
        missionId: MISSION,
        expectedVersion: contractVersion,
        capabilities: CAPABILITIES,
        command: { type: 'refine' },
        actor: IMPLEMENTER,
        occurredAt: '2026-08-08T00:30:00.000Z',
      });
      assert.equal(refined.status, 'completed', JSON.stringify(refined));

      // refined -> active
      const activated = await lifecycle.activate({
        operationId: 'op-activate',
        missionId: MISSION,
        expectedVersion: version(refined),
        capabilities: CAPABILITIES,
        agent: IMPLEMENTER,
        occurredAt: '2026-08-08T01:00:00.000Z',
      });
      assert.equal(activated.status, 'completed', JSON.stringify(activated));

      // Handoff evidence: submission is refused without a recorded checkpoint.
      const checkpoint = await new MissionCheckpointService(store).record({
        operationId: 'op-cp',
        missionId: MISSION,
        expectedVersion: version(activated),
        capabilities: CAPABILITIES,
        checkpoint: {
          missionId: MISSION,
          name: 'CP-4',
          rawFilename: 'CP-4.md',
          firstLine: 'CP-4: Full lifecycle lane history',
          goalCheck: [{ criterion: 'The fixture mission is done', evidence: 'test/integration/lifecycle/lifecycle-history.test.ts' }],
          nextActionText: 'Run the mission gate.',
        },
      });
      assert.equal(checkpoint.status, 'completed', JSON.stringify(checkpoint));

      // active -> review
      const review = startReview(
        { change: pullRequest, revision: changeRevision('abc123') },
        REVIEWER,
        IMPLEMENTER,
        '2026-08-08T02:00:00.000Z',
        reviewerEligibility,
      );
      const submitted = await lifecycle.transition({
        operationId: 'op-submit',
        missionId: MISSION,
        expectedVersion: version(checkpoint),
        capabilities: CAPABILITIES,
        command: { type: 'submit-for-review', gatesPassed: true, review, reviewerEligibility },
        actor: IMPLEMENTER,
        occurredAt: '2026-08-08T02:00:00.000Z',
      });
      assert.equal(submitted.status, 'completed', JSON.stringify(submitted));

      // review -> integration
      const approved = await lifecycle.transition({
        operationId: 'op-approve',
        missionId: MISSION,
        expectedVersion: version(submitted),
        capabilities: CAPABILITIES,
        command: {
          type: 'approve',
          review: applyReviewerCommand(review, {
            type: 'approve',
            decidedAt: '2026-08-08T03:00:00.000Z',
            comment: 'Ready to integrate',
            source: { kind: 'provider', provider: 'forgejo' },
          }),
        },
        actor: REVIEWER,
        occurredAt: '2026-08-08T03:00:00.000Z',
      });
      assert.equal(approved.status, 'completed', JSON.stringify(approved));

      // integration -> done
      const integration = new MissionIntegrationService(store);
      const integrated = await integration.decideIntegration({
        operationId: 'op-integrate',
        missionId: MISSION,
        expectedVersion: version(approved),
        capabilities: CAPABILITIES,
        occurredAt: '2026-08-08T04:00:00.000Z',
        facts: {
          git: { source: 'git', status: 'fresh', value: { merged: true } },
          verification: { source: 'stats', status: 'fresh', value: { passed: true } },
        },
      });
      assert.equal(integrated.status, 'completed', JSON.stringify(integrated));

      // closure
      const closed = await integration.close({
        operationId: 'op-close',
        missionId: MISSION,
        expectedVersion: version(integrated),
        capabilities: CAPABILITIES,
        integration: { source: 'git', status: 'fresh', value: { completed: true } },
        closedAt: '2026-08-08T05:00:00.000Z',
      });
      assert.equal(closed.status, 'completed', JSON.stringify(closed));

      const history = await events.findByMissionId(MISSION);
      assert.deepEqual(
        history.map((row) => ({ from: row.fromStatus, to: row.toStatus, trigger: row.trigger, at: row.occurredAt })),
        [
          { from: null, to: 'backlog', trigger: 'intake', at: '2026-08-08T00:00:00.000Z' },
          { from: 'backlog', to: 'refined', trigger: 'refine', at: '2026-08-08T00:30:00.000Z' },
          { from: 'refined', to: 'active', trigger: 'activate', at: '2026-08-08T01:00:00.000Z' },
          { from: 'active', to: 'review', trigger: 'submit-for-review', at: '2026-08-08T02:00:00.000Z' },
          { from: 'review', to: 'integration', trigger: 'approve', at: '2026-08-08T03:00:00.000Z' },
          { from: 'integration', to: 'done', trigger: 'integrate', at: '2026-08-08T04:00:00.000Z' },
        ],
      );

      // The history is continuous and ordered on its own terms: no row starts
      // from a lane the mission was not left in, and time never moves backwards.
      let lane: string | null = null;
      let previousAt = '';
      for (const row of history) {
        assert.equal(row.fromStatus, lane, `lane history breaks at ${row.trigger}`);
        assert.ok(row.occurredAt > previousAt, `lane history is out of order at ${row.trigger}`);
        lane = row.toStatus;
        previousAt = row.occurredAt;
      }
      assert.equal(lane, 'done');

      // Closure records the completion time on the aggregate without inventing
      // a done -> done lane move.
      const reloaded = await store.load(MISSION);
      assert.equal(reloaded.kind, 'found');
      assert.equal((reloaded as { mission: { closedAt: string | null } }).mission.closedAt, '2026-08-08T05:00:00.000Z');
    } finally {
      await db.close();
    }
  });
});

// ---------------------------------------------------------------------------
// TASK-2357 defect A — historical cumulative flow must not contain a mission
// before its authoritative intake.
//
// The fixture persists real lane events and reads them back through
// `ConcreteMetricsReadAdapter`, so the assertion covers the production
// conversion in `entryToMissionTransition` as well as the historical-seeding
// filter in `buildMetrics`. Constructing a transition with `from: null` by hand
// would skip exactly the conversion that loses the intake marker.
// ---------------------------------------------------------------------------

const REPO = repositoryId('fixture-repo');
const TASK_A = missionId('task-a');
const TASK_B = missionId('task-b');

/** Hand-computed instants: one per persisted lane event. */
const MONDAY = '2026-06-01T09:00:00.000Z';
const TUESDAY = '2026-06-02T09:00:00.000Z';
const WEDNESDAY = '2026-06-03T09:00:00.000Z';
const THURSDAY = '2026-06-04T09:00:00.000Z';
const FRIDAY = '2026-06-05T09:00:00.000Z';

describe("defect A: historical flow excludes missions before intake", () => {
  it('leaves a Thursday-intaked mission absent from Monday, Tuesday and Wednesday', async () => {
    await withStatisticsDatabase(async ({ laneEventRepo, usageRepo }) => {
      // Task A is intaked Monday and walks the board.
      await laneEventRepo.append(laneEvent({ repositoryId: REPO, missionId: TASK_A, from: null, to: 'backlog', at: MONDAY }));
      await laneEventRepo.append(laneEvent({ repositoryId: REPO, missionId: TASK_A, from: 'backlog', to: 'refined', at: TUESDAY }));
      await laneEventRepo.append(laneEvent({ repositoryId: REPO, missionId: TASK_A, from: 'refined', to: 'active', at: WEDNESDAY }));
      // Task B does not exist until Thursday, and reaches done on Friday.
      await laneEventRepo.append(laneEvent({ repositoryId: REPO, missionId: TASK_B, from: null, to: 'backlog', at: THURSDAY }));
      await laneEventRepo.append(laneEvent({ repositoryId: REPO, missionId: TASK_B, from: 'backlog', to: 'done', at: FRIDAY }));

      const adapter = new ConcreteMetricsReadAdapter({
        laneEventRepo,
        usageRepo,
        repositoryId: REPO,
        clock: fixedClock(FRIDAY),
      });

      // Current board state, exactly as `BoardProjectionBuilder` supplies it.
      const initialStates = new Map<MissionId, MissionStatus>([
        [TASK_A, 'active'],
        [TASK_B, 'done'],
      ]);
      const metrics = await adapter.buildMetrics(initialStates);

      const at = (instant: string) => {
        const point = metrics.cumulativeFlowByState.series.find((entry) => entry.at === instant);
        assert.ok(point, `no cumulative-flow point at ${instant}; series had ${
          metrics.cumulativeFlowByState.series.map((entry) => entry.at).join(', ')}`);
        return point;
      };
      const total = (instant: string) =>
        Object.values(at(instant).counts).reduce((sum, count) => sum + count, 0);

      // Monday–Wednesday: task-a only. Hand-computed: one mission exists.
      assert.equal(total(MONDAY), 1, 'Monday must contain only task-a');
      assert.deepEqual(at(MONDAY).counts, { backlog: 1, refined: 0, active: 0, review: 0, integration: 0, done: 0 });
      assert.equal(total(TUESDAY), 1, 'Tuesday must contain only task-a');
      assert.deepEqual(at(TUESDAY).counts, { backlog: 0, refined: 1, active: 0, review: 0, integration: 0, done: 0 });
      assert.equal(total(WEDNESDAY), 1, 'Wednesday must contain only task-a');
      assert.deepEqual(at(WEDNESDAY).counts, { backlog: 0, refined: 0, active: 1, review: 0, integration: 0, done: 0 });

      // Thursday: task-b appears in backlog, the lane its intake event names.
      assert.equal(total(THURSDAY), 2, 'Thursday must contain task-a and task-b');
      assert.deepEqual(at(THURSDAY).counts, { backlog: 1, refined: 0, active: 1, review: 0, integration: 0, done: 0 });

      // Friday: task-b is done.
      assert.deepEqual(at(FRIDAY).counts, { backlog: 0, refined: 0, active: 1, review: 0, integration: 0, done: 1 });
    });
  });

  it('never reports a completed mission before the week it was intaked', async () => {
    await withStatisticsDatabase(async ({ laneEventRepo, usageRepo }) => {
      await laneEventRepo.append(laneEvent({ repositoryId: REPO, missionId: TASK_A, from: null, to: 'backlog', at: MONDAY }));
      await laneEventRepo.append(laneEvent({ repositoryId: REPO, missionId: TASK_B, from: null, to: 'backlog', at: THURSDAY }));
      await laneEventRepo.append(laneEvent({ repositoryId: REPO, missionId: TASK_B, from: 'backlog', to: 'done', at: FRIDAY }));

      const adapter = new ConcreteMetricsReadAdapter({
        laneEventRepo,
        usageRepo,
        repositoryId: REPO,
        clock: fixedClock(FRIDAY),
      });
      const metrics = await adapter.buildMetrics(new Map<MissionId, MissionStatus>([
        [TASK_A, 'backlog'],
        [TASK_B, 'done'],
      ]));

      const monday = metrics.cumulativeFlow.series.find((entry) => entry.at === MONDAY);
      assert.ok(monday, 'expected a cumulative-flow point on Monday');
      // Hand-computed: nothing had completed on Monday.
      assert.equal(monday.value, 0);
      const friday = metrics.cumulativeFlow.series.find((entry) => entry.at === FRIDAY);
      assert.equal(friday?.value, 1);
    });
  });
});

// ---------------------------------------------------------------------------
// TASK-2357 defect E — the legacy lifecycle-entry fallback is repository-scoped.
//
// Repository A and repository B both contain TASK-123. Only A's own history row
// may answer "when did TASK-123 enter its lane here"; B's row is a different
// mission that happens to share an id.
// ---------------------------------------------------------------------------

const e_REPO_A = repositoryId('repo-a');
const e_REPO_B = repositoryId('repo-b');
const e_COLLIDING = missionId('task-123');
const e_ANCHOR = missionId('task-900');

const e_NOW = '2026-06-05T12:00:00.000Z';
const e_A_ENTERED = '2026-06-05T11:00:00.000Z'; // 60 minutes before e_NOW
const e_B_ENTERED = '2026-06-05T02:00:00.000Z'; // 600 minutes before e_NOW
const e_ANCHOR_EVENT = '2026-06-05T11:30:00.000Z';

/** Hand-computed: A's own row is 60 minutes old; B's is 600 and must not win. */
const e_EXPECTED_REVIEW_AGE_MINUTES = 60;

describe("defect E: legacy lifecycle-entry fallback stays inside its repository", () => {
  it('reads only its own repository history for a colliding mission id', async () => {
    await withStatisticsDatabase(async ({ laneEventRepo, usageRepo, historyRepo }) => {
      // An anchor mission with real lane events in repository A.
      await laneEventRepo.append(laneEvent({ repositoryId: e_REPO_A, missionId: e_ANCHOR, from: null, to: 'backlog', at: e_ANCHOR_EVENT }));

      // TASK-123 has no lane events in either repository, only history rows.
      await historyRepo.append({
        eventType: 'mission.review',
        eventData: JSON.stringify({ missionId: e_COLLIDING, repositoryId: e_REPO_B, message: `${e_COLLIDING} → review`, agent: 'codex' }),
        createdAt: e_B_ENTERED,
      });
      await historyRepo.append({
        eventType: 'mission.review',
        eventData: JSON.stringify({ missionId: e_COLLIDING, repositoryId: e_REPO_A, message: `${e_COLLIDING} → review`, agent: 'claude' }),
        createdAt: e_A_ENTERED,
      });

      const metrics = await new ConcreteMetricsReadAdapter({
        laneEventRepo, usageRepo, historyRepo, repositoryId: e_REPO_A, clock: fixedClock(e_NOW),
      }).buildMetrics(new Map<MissionId, MissionStatus>([
        [e_ANCHOR, 'backlog'],
        [e_COLLIDING, 'review'],
      ]));

      const review = metrics.medianAgeByLane.series.find((entry) => entry.lane === 'review');
      assert.ok(review, 'expected a review lane entry');
      assert.equal(
        review.value,
        e_EXPECTED_REVIEW_AGE_MINUTES,
        'the other repository\'s older row must not become this mission\'s lane entry',
      );
      assert.equal(review.observationCount, 1);
    });
  });

  it('reports the lane age as unavailable when no row can be attributed to this repository', async () => {
    await withStatisticsDatabase(async ({ laneEventRepo, usageRepo, historyRepo }) => {
      await laneEventRepo.append(laneEvent({ repositoryId: e_REPO_A, missionId: e_ANCHOR, from: null, to: 'backlog', at: e_ANCHOR_EVENT }));
      // Only the other repository's row exists.
      await historyRepo.append({
        eventType: 'mission.review',
        eventData: JSON.stringify({ missionId: e_COLLIDING, repositoryId: e_REPO_B, message: `${e_COLLIDING} → review`, agent: 'codex' }),
        createdAt: e_B_ENTERED,
      });

      const metrics = await new ConcreteMetricsReadAdapter({
        laneEventRepo, usageRepo, historyRepo, repositoryId: e_REPO_A, clock: fixedClock(e_NOW),
      }).buildMetrics(new Map<MissionId, MissionStatus>([
        [e_ANCHOR, 'backlog'],
        [e_COLLIDING, 'review'],
      ]));

      const review = metrics.medianAgeByLane.series.find((entry) => entry.lane === 'review');
      assert.equal(review?.value, null, 'an unattributable legacy row is unavailable, not a guess');
      assert.equal(review?.observationCount, 0);
    });
  });
});

describe('historical double-collected lane transitions', () => {
  it('collapses a handoff and round-open pair into one lifecycle move and human handoff (TASK-2842.1)', async () => {
    await withStatisticsDatabase(async ({ laneEventRepo }) => {
      const mission = missionId('task-2842-duplicate-approval');
      const approvedAt = '2026-08-08T03:00:00.000Z';
      const completedAt = '2026-08-08T04:00:00.000Z';
      const approval = laneEvent({
        repositoryId: REPO,
        missionId: mission,
        from: 'review',
        to: 'integration',
        trigger: 'approve',
        at: approvedAt,
      });

      await laneEventRepo.append({ ...approval, idempotencyKey: `handoff-${mission}` });
      await laneEventRepo.append({ ...approval, idempotencyKey: `round-open:${mission}:round-1` });
      await laneEventRepo.append({
        ...laneEvent({
          repositoryId: REPO,
          missionId: mission,
          from: 'integration',
          to: 'done',
          trigger: 'integrate',
          at: completedAt,
        }),
        idempotencyKey: `integrate-${mission}`,
      });

      const history = await laneEventRepo.findByMissionId(mission);
      const approvals = history.filter((entry) => entry.trigger === 'approve');
      assert.equal(approvals.length, 1, 'the historical pair is one lifecycle move');

      const episodes = await createHumanReviewEpisodeReader(laneEventRepo)(mission);
      assert.equal(episodes?.length, 1, 'the historical pair is one human handoff episode');
      assert.ok(episodes?.every((episode) => episode.startedAt !== episode.endedAt),
        'the duplicate must not create a zero-length human handoff interval');

      const intervals = deriveLaneIntervals(history.map((entry) => ({
        missionId: mission,
        from: entry.fromStatus as MissionStatus | null,
        to: entry.toStatus as MissionStatus,
        trigger: entry.trigger as MissionTransition['trigger'],
        actor: agentFamily(entry.agent),
        occurredAt: entry.occurredAt,
      })));
      assert.ok(intervals.every((interval) => interval.enteredAt !== interval.exitedAt),
        'the duplicate must not create a zero-length lane dwell interval');
    });
  });

  it('gives board FLOW and px stats the same collapsed transition return and dwell facts', async () => {
    await withStatisticsDatabase(async ({ laneEventRepo }) => {
      const mission = missionId('task-2842-shared-read');
      const moves = [
        laneEvent({ repositoryId: REPO, missionId: mission, from: null, to: 'active', trigger: 'activate', at: '2026-08-08T09:00:00.000Z' }),
        laneEvent({ repositoryId: REPO, missionId: mission, from: 'active', to: 'review', trigger: 'submit-for-review', at: '2026-08-08T10:00:00.000Z' }),
        { ...laneEvent({ repositoryId: REPO, missionId: mission, from: 'review', to: 'active', trigger: 'request-changes', at: '2026-08-08T11:00:00.000Z' }), idempotencyKey: `handoff-${mission}` },
        { ...laneEvent({ repositoryId: REPO, missionId: mission, from: 'review', to: 'active', trigger: 'request-changes', at: '2026-08-08T11:00:02.000Z' }), idempotencyKey: `active-review:${mission}:2026-08-08T11:00:02.000Z` },
        laneEvent({ repositoryId: REPO, missionId: mission, from: 'active', to: 'review', trigger: 'submit-for-review', at: '2026-08-08T12:00:00.000Z' }),
        laneEvent({ repositoryId: REPO, missionId: mission, from: 'review', to: 'integration', trigger: 'approve', at: '2026-08-08T13:00:00.000Z' }),
        laneEvent({ repositoryId: REPO, missionId: mission, from: 'integration', to: 'done', trigger: 'integrate', at: '2026-08-08T14:00:00.000Z' }),
      ];
      for (const move of moves) { await laneEventRepo.append(move); }

      const boardHistory = (await laneEventRepo.findByRepositoryId(REPO)).filter((entry) => entry.missionId === mission);
      const statsHistory = await laneEventRepo.findByMissionId(mission);
      assert.equal(boardHistory.length, 6);
      assert.equal(statsHistory.length, 6);
      assert.equal(workflowReturnsFromHistory(boardHistory).length, 1);
      assert.equal(workflowReturnsFromHistory(statsHistory).length, 1);

      const transitions = (history: readonly (typeof boardHistory)[number][]) => history.map((entry) => ({
        missionId: mission,
        from: entry.fromStatus as MissionStatus | null,
        to: entry.toStatus as MissionStatus,
        trigger: entry.trigger as MissionTransition['trigger'],
        actor: agentFamily(entry.agent),
        occurredAt: entry.occurredAt,
      }));
      assert.deepEqual(deriveLaneIntervals(transitions(boardHistory)), deriveLaneIntervals(transitions(statsHistory)));
      assert.deepEqual(
        medianCycleTimeByStateSeries(transitions(boardHistory)),
        medianCycleTimeByStateSeries(transitions(statsHistory)),
      );
    });
  });

  it('collapses every historical key shape while preserving distinct transitions and genuine re-entry', async () => {
    await withStatisticsDatabase(async ({ laneEventRepo }) => {
      const keyIndependent = missionId('task-2842-key-independent');
      await laneEventRepo.append({
        ...laneEvent({ repositoryId: REPO, missionId: keyIndependent, from: 'review', to: 'active', trigger: 'request-changes', at: '2026-08-08T10:00:00.000Z' }),
        idempotencyKey: `request-changes:${keyIndependent}:2026-08-08T10:00:00.000Z`,
      });
      await laneEventRepo.append({
        ...laneEvent({ repositoryId: REPO, missionId: keyIndependent, from: 'review', to: 'active', trigger: 'request-changes', at: '2026-08-08T10:00:02.000Z' }),
        idempotencyKey: `${keyIndependent}:request-changes:2026-08-08T10:00:02.000Z`,
      });
      assert.equal((await laneEventRepo.findByMissionId(keyIndependent)).length, 1,
        'matching lifecycle state collapses independently of key shape');

      const cases = [
        { mission: missionId('task-2842-different-trigger'), second: { trigger: 'rebound-to-active', at: '2026-08-08T11:00:01.000Z', from: 'review', to: 'active' } },
        { mission: missionId('task-2842-different-lanes'), second: { trigger: 'request-changes', at: '2026-08-08T11:00:01.000Z', from: 'integration', to: 'active' } },
        { mission: missionId('task-2842-outside-window'), second: { trigger: 'request-changes', at: '2026-08-08T11:00:05.001Z', from: 'review', to: 'active' } },
      ] as const;
      for (const { mission, second } of cases) {
        await laneEventRepo.append({
          ...laneEvent({ repositoryId: REPO, missionId: mission, from: 'review', to: 'active', trigger: 'request-changes', at: '2026-08-08T11:00:00.000Z' }),
          idempotencyKey: `handoff-${mission}`,
        });
        await laneEventRepo.append({
          ...laneEvent({ repositoryId: REPO, missionId: mission, ...second }),
          idempotencyKey: `round-open:${mission}:round-1`,
        });
        assert.equal((await laneEventRepo.findByMissionId(mission)).length, 2, `${mission} must stay distinct`);
      }

      const reentered = missionId('task-2842-genuine-reentry');
      const reentryMoves = [
        laneEvent({ repositoryId: REPO, missionId: reentered, from: 'active', to: 'review', trigger: 'submit-for-review', at: '2026-08-08T12:00:00.000Z' }),
        laneEvent({ repositoryId: REPO, missionId: reentered, from: 'review', to: 'active', trigger: 'request-changes', at: '2026-08-08T12:00:01.000Z' }),
        laneEvent({ repositoryId: REPO, missionId: reentered, from: 'active', to: 'review', trigger: 'submit-for-review', at: '2026-08-08T12:00:02.000Z' }),
      ];
      for (const [index, move] of reentryMoves.entries()) {
        await laneEventRepo.append({ ...move, idempotencyKey: `unrelated-historical-shape-${index}` });
      }
      assert.equal((await laneEventRepo.findByMissionId(reentered)).length, 3,
        'returning to the from lane proves the later matching move is distinct');
    });
  });
});
