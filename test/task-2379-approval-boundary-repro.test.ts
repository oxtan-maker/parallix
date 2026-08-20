// TASK-2379 CP-1 — red reproduction of the approval-boundary divergence.
//
// Deterministic fixture (mission Part M):
//   10:00  mission enters review (round 1, awaiting a reviewer decision)
//   10:30  human (repo default user) approves on the provider
//   14:00  px integrate is invoked (its recovery/reconcile step)
//   14:15  integration lands
//
// The 10:30 approval is the human-override producer. In the baseline it only
// exists as the `defaultUserApproved` integrate-preflight boolean: it never
// persists a ReviewerDecision and never fires the review → integration
// boundary, so the Mission sits in `review` and the 14:00 recovery aborts
// before integration can run — every mission integrated hours after a
// human approval reports a wrong review dwell and a wrong integration dwell.
//
// Expected after the fix: recovery records the override as a real
// ReviewerDecision(kind=approved, decidedAt=10:30) through the Review
// domain, invokes the existing approve transition with occurredAt=10:30
// (never the 14:00 integration start), the 14:15 landing persists exactly
// one integration → done event, and the Board/FLOW projection reports
// review dwell = 30m and integration dwell = 225m.
//
// RED on the parent commit: recoverMissionForIntegration rejects with
// IntegrationAbort ("in review without an authoritative approval").

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { agentFamily } from '../src/domain/agents.js';
import { missionId } from '../src/domain/mission.js';
import { repositoryId } from '../src/domain/repository.js';
import {
  ConfiguredReviewerEligibility,
  changeRevision,
  startReview,
  type ReviewedChange,
} from '../src/domain/review.js';
import { medianCycleTimeByStateSeries } from '../src/application/projections/metrics.js';
import { MissionLifecycleService } from '../src/application/mission-lifecycle-service.js';
import { MissionIntegrationService } from '../src/application/mission-integration-service.js';
import { recoverMissionForIntegration } from '../src/adapters/cli/commands/integrate.js';
import { SqliteDatabaseAdapter } from '../src/adapters/sqlite/database-adapter.js';
import { SqliteMigrationRunner, loadDefaultMigrations } from '../src/adapters/sqlite/migration-runner.js';
import { SqliteMissionStore } from '../src/adapters/sqlite/mission-store.js';
import { clearOperatorStateCache } from '../src/adapters/sqlite/adapter-factory.js';

const REVIEW_ENTERED_AT = '2026-01-01T10:00:00Z';
const APPROVED_AT = '2026-01-01T10:30:00Z';
const LANDED_AT = '2026-01-01T14:15:00Z';

const implementer = agentFamily('configured-implementer');
const reviewer = agentFamily('configured-reviewer');
const reviewerEligibility = ConfiguredReviewerEligibility.fromReviewStep({
  eligible: [reviewer],
  strategy: 'random',
});
const pullRequest: ReviewedChange = {
  kind: 'pull-request',
  provider: 'forgejo',
  id: '2379',
  url: null,
  sourceBranch: 'mission/task-2379',
  targetBranch: 'main',
};

test('delayed integration: review dwell is 30m and integration dwell is 225m (R2)', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2379-repro-'));
  fs.mkdirSync(path.join(root, 'missions'), { recursive: true });
  spawnSync('git', ['init'], { cwd: root });
  spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: root });
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  spawnSync('git', ['checkout', '-b', 'main'], { cwd: root });
  spawnSync('git', ['commit', '-m', 'init', '--allow-empty'], { cwd: root });

  const home = path.join(root, 'parallix-home');
  fs.mkdirSync(home, { recursive: true });
  const previousHome = process.env.PARALLIX_HOME;
  process.env.PARALLIX_HOME = home;
  await clearOperatorStateCache();

  const database = new SqliteDatabaseAdapter();
  await database.open({ path: path.join(home, 'parallix.db') });
  await new SqliteMigrationRunner(database).applyPending(loadDefaultMigrations());
  const store = new SqliteMissionStore(database);
  const lifecycle = new MissionLifecycleService(store);
  const integration = new MissionIntegrationService(store);

  const slug = 'task-2379-repro';
  const review = startReview(
    { change: pullRequest, revision: changeRevision('abc123') },
    reviewer,
    implementer,
    REVIEW_ENTERED_AT,
    reviewerEligibility,
  );
  const mission = {
    id: missionId(slug),
    repositoryId: repositoryId('parallix'),
    title: 'Task 2379 repro',
    labels: [],
    assignee: implementer,
    status: 'active' as const,
    rawStatus: 'active',
    checkpoints: [{
      missionId: missionId(slug),
      name: 'CP-0',
      rawFilename: 'CP-0.md',
      firstLine: 'CP-0',
      goalCheck: [{ criterion: 'c', evidence: 'e' }],
      nextActionText: 'review',
    }],
    netEngineeringLines: null,
    closedAt: null,
    externalTaskRef: null,
    intakeTrace: null,
    review: null,
  };
  await store.save(mission, null);

  try {
    // 10:00 — the mission enters review through the existing workflow
    // operation (active → review).
    const seedLoad = await store.load(missionId(slug));
    const submitted = await lifecycle.transition({
      operationId: `repro-submit:${slug}`,
      missionId: missionId(slug),
      expectedVersion: seedLoad.kind === 'found' ? seedLoad.version : null,
      capabilities: new Set(['mission:transition']),
      command: { type: 'submit-for-review', gatesPassed: true, review, reviewerEligibility },
      actor: implementer,
      occurredAt: REVIEW_ENTERED_AT,
    });
    assert.equal(submitted.status, 'completed', 'mission enters review at 10:00');

    // 10:30 — the human (repo default user) approved on the provider. The
    // integrate context carries that override fact, including the
    // authoritative approval time.
    const context = {
      slug,
      approval: {
        ok: true,
        reviewState: 'REQUEST_CHANGES',
        defaultUserApproved: true,
        defaultUserApprovedAt: APPROVED_AT,
      },
    };

    // 14:00 — px integrate runs. Its recovery step must observe the
    // previously happened approval, persist it as a real ReviewerDecision,
    // and invoke the existing approve transition at decidedAt (10:30) —
    // never at the 14:00 integration start.
    await recoverMissionForIntegration(context, { missionServices: { store, lifecycle } });

    const loaded = await store.load(missionId(slug));
    assert.equal(loaded.kind, 'found');
    assert.equal(
      loaded.kind === 'found' ? loaded.mission.status : null,
      'integration',
      'recovery leaves the Mission in integration, not review',
    );
    const round = loaded.kind === 'found'
      ? loaded.mission.review?.rounds[loaded.mission.review.rounds.length - 1]
      : null;
    assert.equal(round?.decision?.kind, 'approved', 'a real ReviewerDecision is persisted');
    assert.equal(round?.decision?.decidedAt, APPROVED_AT, 'decidedAt is the human approval time');

    // 14:15 — the integration lands: exactly one integration → done event.
    const preLandLoad = await store.load(missionId(slug));
    const landed = await integration.decideIntegration({
      operationId: `repro-land:${slug}`,
      missionId: missionId(slug),
      expectedVersion: preLandLoad.kind === 'found' ? preLandLoad.version : null,
      capabilities: new Set(['integration:decide']),
      idempotencyKey: `integrate:${slug}:land`,
      actor: implementer,
      occurredAt: LANDED_AT,
      facts: {
        git: { source: 'git', status: 'fresh', value: { merged: true } },
        verification: { source: 'integration-gates', status: 'fresh', value: { passed: true } },
      },
    });
    assert.equal(landed.status, 'completed', 'landing closes the integration lane');

    const events = await database.query<{
      mission_id: string; from_status: string | null; to_status: string; trigger: string; occurred_at: string; agent: string;
    }>(
      'SELECT mission_id, from_status, to_status, trigger, occurred_at, agent FROM board_lane_events WHERE mission_id = ? ORDER BY occurred_at',
      [missionId(slug)],
    );

    const approveEvents = events.filter((e) => e.from_status === 'review' && e.to_status === 'integration');
    assert.equal(approveEvents.length, 1, 'exactly one review → integration event');
    assert.equal(
      approveEvents[0].occurred_at,
      APPROVED_AT,
      `review → integration occurredAt is decidedAt (10:30), not the 14:00 integration start (got ${approveEvents[0]?.occurred_at})`,
    );
    const doneEvents = events.filter((e) => e.to_status === 'done' && e.trigger === 'integrate');
    assert.equal(doneEvents.length, 1, 'exactly one integration → done event');
    assert.equal(doneEvents[0].occurred_at, LANDED_AT, 'integration → done is the landed commit time');

    // The same projection Board/FLOW consumes: review dwell = 30m,
    // integration dwell = 225m.
    const transitions = events.map((e) => ({
      missionId: e.mission_id,
      from: e.from_status,
      to: e.to_status,
      trigger: e.trigger,
      actor: e.agent,
      occurredAt: e.occurred_at,
    }));
    const dwell = medianCycleTimeByStateSeries(transitions as never);
    const reviewDwell = dwell.series.find((s) => s.lane === 'review');
    const integrationDwell = dwell.series.find((s) => s.lane === 'integration');
    assert.equal(reviewDwell?.value, 30, `review dwell must be 30m (got ${reviewDwell?.value}m)`);
    assert.equal(integrationDwell?.value, 225, `integration dwell must be 225m (got ${integrationDwell?.value}m)`);
  } finally {
    await database.close();
    if (previousHome === undefined) { delete process.env.PARALLIX_HOME; }
    else { process.env.PARALLIX_HOME = previousHome; }
    clearOperatorStateCache();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
