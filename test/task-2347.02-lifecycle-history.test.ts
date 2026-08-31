/**
 * TASK-2347.02 SC4 — one mission, one gap-free lane history.
 *
 * Drives a single mission from intake to closure through the application use
 * cases against a real SQLite fixture, then replays `board_lane_events` and
 * asserts the recorded history is ordered and continuous: the first row starts
 * from no lane, and every later row leaves the lane the previous row entered.
 * A missing lifecycle step shows up here as a break in that chain.
 */

import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { MissionVersion } from '../src/application/domain-ports.js';
import { MissionCheckpointService } from '../src/application/mission-checkpoint-service.js';
import { MissionIntakeService } from '../src/application/mission-intake-service.js';
import { MissionIntegrationService } from '../src/application/mission-integration-service.js';
import { MissionLifecycleService } from '../src/application/mission-lifecycle-service.js';
import { SqliteBoardLaneEventRepository } from '../src/adapters/sqlite/board-lane-event-repository.js';
import { SqliteDatabaseAdapter } from '../src/adapters/sqlite/database-adapter.js';
import { loadDefaultMigrations, SqliteMigrationRunner } from '../src/adapters/sqlite/migration-runner.js';
import { SqliteMissionStore } from '../src/adapters/sqlite/mission-store.js';
import { agentFamily } from '../src/domain/agents.js';
import { missionId, missionLabels } from '../src/domain/mission.js';
import { repositoryId } from '../src/domain/repository.js';
import {
  applyReviewerCommand,
  changeRevision,
  ConfiguredReviewerEligibility,
  startReview,
} from '../src/domain/review.js';

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
};

function version(outcome: { value?: { version: MissionVersion } }): MissionVersion {
  return outcome.value!.version;
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    fs.rmSync(temporaryDirectories.pop()!, { recursive: true, force: true });
  }
});

describe('TASK-2347.02 full lifecycle lane history', () => {
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

      // backlog -> refined: what `px draft` records before a launch.
      const lifecycle = new MissionLifecycleService(store);
      const refined = await lifecycle.transition({
        operationId: 'op-refine',
        missionId: MISSION,
        expectedVersion: version(intake),
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
          goalCheck: [{ criterion: 'History is gap-free', evidence: 'test/task-2347.02-lifecycle-history.test.ts' }],
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
          { from: 'done', to: 'done', trigger: 'close', at: '2026-08-08T05:00:00.000Z' },
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

      // Closure is durable on the aggregate too, so the truncated final dwell
      // the mission set out to fix is now bounded by a recorded event.
      const reloaded = await store.load(MISSION);
      assert.equal(reloaded.kind, 'found');
      assert.equal((reloaded as { mission: { closedAt: string | null } }).mission.closedAt, '2026-08-08T05:00:00.000Z');
    } finally {
      await db.close();
    }
  });
});
