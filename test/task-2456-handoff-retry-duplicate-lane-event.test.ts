// TASK-2456 CP-1 — red reproduction of the handoff retry that a duplicate lane
// event turns into a failure.
//
// `performHandoff` deliberately passes the stable idempotency key
// `handoff-${slug}` to the review transition so the lane-event UNIQUE
// constraint deduplicates a retried handoff
// (`src/application/handoff-command-use-case.ts`). Once a handoff has committed
// its `active -> review` lane event under that key, any later handoff of the
// same mission collides with it. `MissionLifecycleService.transition` maps that
// refusal to `failure('conflict', …)`, so the retried handoff bombs before the
// Backlog task is synchronised to `review`.
//
// Fixture (mission task-2456-repro):
//   10:00  handoff 1: active -> review, lane event key `handoff-<slug>`
//   11:00  reviewer requests changes: review -> active
//   12:00  implementer resolves the finding and opens round 2
//   13:00  handoff 2: active -> review with the SAME `handoff-<slug>` key
//
// R1 (SC1): the 13:00 transition is a replay of the `active -> review`
// transition already recorded under that key, so it must return `completed`
// with `to === 'review'`. RED on the parent commit: it returns
// `failure('conflict', 'Duplicate idempotency key: handoff-…')`.
//
// R2 (SC2): reusing the same key for a genuinely distinct transition
// (`review -> integration` via `approve`) is not a replay of anything recorded
// under that key, so it must remain a `conflict`.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { agentFamily } from '../src/domain/agents.js';
import { missionId, type Mission } from '../src/domain/mission.js';
import { repositoryId } from '../src/domain/repository.js';
import {
  ConfiguredReviewerEligibility,
  applyImplementerCommand,
  applyReviewerCommand,
  beginNextReviewRound,
  changeRevision,
  reviewFindingId,
  startReview,
  type Review,
  type ReviewedChange,
} from '../src/domain/review.js';
import type { MissionVersion } from '../src/application/domain-ports.js';
import { MissionLifecycleService } from '../src/application/mission-lifecycle-service.js';
import { SqliteDatabaseAdapter } from '../src/adapters/sqlite/database-adapter.js';
import { SqliteMigrationRunner, loadDefaultMigrations } from '../src/adapters/sqlite/migration-runner.js';
import { SqliteMissionStore } from '../src/adapters/sqlite/mission-store.js';

const HANDOFF_1_AT = '2026-02-01T10:00:00Z';
const CHANGES_REQUESTED_AT = '2026-02-01T11:00:00Z';
const RESOLVED_AT = '2026-02-01T12:00:00Z';
const HANDOFF_2_AT = '2026-02-01T13:00:00Z';
const APPROVED_AT = '2026-02-01T14:00:00Z';

const implementer = agentFamily('configured-implementer');
const reviewer = agentFamily('configured-reviewer');
const reviewerEligibility = ConfiguredReviewerEligibility.fromReviewStep({
  eligible: [reviewer],
  strategy: 'random',
});
const pullRequest: ReviewedChange = {
  kind: 'pull-request',
  provider: 'forgejo',
  id: '2456',
  url: null,
  sourceBranch: 'mission/task-2456',
  targetBranch: 'main',
};

interface Fixture {
  readonly database: SqliteDatabaseAdapter;
  readonly store: SqliteMissionStore;
  readonly lifecycle: MissionLifecycleService;
  readonly slug: string;
  readonly root: string;
}

function seedMission(slug: string): Mission {
  return {
    id: missionId(slug),
    repositoryId: repositoryId('parallix'),
    title: 'Task 2456 repro',
    labels: [],
    assignee: implementer,
    status: 'active' as const,
    rawStatus: 'active',
    checkpoints: [{
      missionId: missionId(slug),
      name: 'CP-1',
      rawFilename: 'CP-1.md',
      firstLine: 'CP-1',
      goalCheck: [{ criterion: 'c', evidence: 'e' }],
      nextActionText: 'hand off',
    }],
    netEngineeringLines: null,
    closedAt: null,
    externalTaskRef: null,
    review: null,
  };
}

async function openFixture(slug: string): Promise<Fixture> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2456-repro-'));
  const database = new SqliteDatabaseAdapter();
  await database.open({ path: path.join(root, 'parallix.db') });
  await new SqliteMigrationRunner(database).applyPending(loadDefaultMigrations());
  const store = new SqliteMissionStore(database);
  await store.save(seedMission(slug), null);
  return { database, store, lifecycle: new MissionLifecycleService(store), slug, root };
}

async function closeFixture(fixture: Fixture): Promise<void> {
  await fixture.database.close();
  fs.rmSync(fixture.root, { recursive: true, force: true });
}

async function currentVersion(fixture: Fixture): Promise<MissionVersion> {
  const loaded = await fixture.store.load(missionId(fixture.slug));
  assert.equal(loaded.kind, 'found');
  if (loaded.kind !== 'found') { throw new Error(`mission ${fixture.slug} is not recorded`); }
  return loaded.version;
}

async function currentReview(fixture: Fixture): Promise<Review> {
  const loaded = await fixture.store.load(missionId(fixture.slug));
  assert.equal(loaded.kind, 'found');
  const review = loaded.kind === 'found' ? loaded.mission.review : null;
  assert.ok(review, 'the persisted mission carries a review');
  return review;
}

/** Hand off the mission for review under the stable `handoff-<slug>` key. */
async function handOff(fixture: Fixture, review: Review, occurredAt: string) {
  return fixture.lifecycle.transition({
    operationId: `handoff-transition-${fixture.slug}`,
    missionId: missionId(fixture.slug),
    expectedVersion: await currentVersion(fixture),
    capabilities: new Set(['mission:transition' as const]),
    command: { type: 'submit-for-review', gatesPassed: true, review, reviewerEligibility },
    actor: reviewer,
    occurredAt,
    idempotencyKey: `handoff-${fixture.slug}`,
  });
}

test('a retried handoff replays its already recorded active -> review lane event instead of conflicting', async () => {
  const fixture = await openFixture('task-2456-retry');
  try {
    // 10:00 — the first handoff commits `active -> review` together with the
    // lane event keyed `handoff-<slug>`.
    const firstHandoff = await handOff(
      fixture,
      startReview(
        { change: pullRequest, revision: changeRevision('rev-round-1') },
        reviewer,
        implementer,
        HANDOFF_1_AT,
        reviewerEligibility,
      ),
      HANDOFF_1_AT,
    );
    assert.equal(firstHandoff.status, 'completed', 'the first handoff enters review');

    // 11:00 — the reviewer requests changes, so the mission returns to active.
    const finding = {
      id: reviewFindingId('F1'),
      summary: 'Fix the duplicate lane-event handling',
      location: null,
    };
    const changesRequested = await fixture.lifecycle.transition({
      operationId: `request-changes-${fixture.slug}`,
      missionId: missionId(fixture.slug),
      expectedVersion: await currentVersion(fixture),
      capabilities: new Set(['mission:transition' as const]),
      command: {
        type: 'request-changes',
        review: applyReviewerCommand(await currentReview(fixture), {
          type: 'request-changes',
          decidedAt: CHANGES_REQUESTED_AT,
          comment: null,
          findings: [finding],
        }),
      },
      actor: reviewer,
      occurredAt: CHANGES_REQUESTED_AT,
    });
    assert.equal(changesRequested.status, 'completed', 'the mission returns to active');

    // 12:00 — the implementer resolves the finding and opens round 2.
    const resolved = applyImplementerCommand(await currentReview(fixture), {
      type: 'submit-resolution',
      respondedAt: RESOLVED_AT,
      resultingRevision: changeRevision('rev-round-2'),
      resolutions: [{ findingId: finding.id, kind: 'fixed', evidence: 'Fixed in round 2.' }],
    });
    const roundTwo = beginNextReviewRound(
      resolved,
      reviewer,
      implementer,
      HANDOFF_2_AT,
      reviewerEligibility,
    );

    // 13:00 — the retried handoff reuses the stable key. Its `active -> review`
    // transition is already recorded under that key, so this is a replay.
    const retriedHandoff = await handOff(fixture, roundTwo, HANDOFF_2_AT);
    assert.equal(
      retriedHandoff.status,
      'completed',
      `retried handoff must complete, got ${retriedHandoff.status}: ${retriedHandoff.error?.message ?? ''}`,
    );
    assert.equal(retriedHandoff.value?.to, 'review', 'the replay lands the mission in review');
    assert.equal(
      retriedHandoff.value?.version,
      await currentVersion(fixture),
      'the returned version is the persisted one',
    );

    const loaded = await fixture.store.load(missionId(fixture.slug));
    assert.equal(
      loaded.kind === 'found' ? loaded.mission.status : null,
      'review',
      'the persisted mission reached review so the Backlog sync can run',
    );

    const events = await fixture.database.query<{ from_status: string | null; to_status: string }>(
      'SELECT from_status, to_status FROM board_lane_events WHERE idempotency_key = ?',
      [`handoff-${fixture.slug}`],
    );
    assert.equal(events.length, 1, 'the stable key still records exactly one lane event');
  } finally {
    await closeFixture(fixture);
  }
});

test('a duplicate handoff key on a distinct approve transition stays a conflict', async () => {
  const fixture = await openFixture('task-2456-distinct');
  try {
    const firstHandoff = await handOff(
      fixture,
      startReview(
        { change: pullRequest, revision: changeRevision('rev-round-1') },
        reviewer,
        implementer,
        HANDOFF_1_AT,
        reviewerEligibility,
      ),
      HANDOFF_1_AT,
    );
    assert.equal(firstHandoff.status, 'completed', 'the first handoff enters review');

    // `review -> integration` is a different transition from the one recorded
    // under `handoff-<slug>`, so reusing that key is a genuine collision.
    const approved = await fixture.lifecycle.transition({
      operationId: `approve-${fixture.slug}`,
      missionId: missionId(fixture.slug),
      expectedVersion: await currentVersion(fixture),
      capabilities: new Set(['mission:transition' as const]),
      command: {
        type: 'approve',
        review: applyReviewerCommand(await currentReview(fixture), {
          type: 'approve',
          decidedAt: APPROVED_AT,
          comment: null,
          source: { kind: 'local' },
        }),
      },
      actor: reviewer,
      occurredAt: APPROVED_AT,
      idempotencyKey: `handoff-${fixture.slug}`,
    });
    assert.equal(approved.status, 'failed', 'a non-replay duplicate key is refused');
    assert.equal(approved.error?.kind, 'conflict', 'the refusal is reported as a conflict');

    const loaded = await fixture.store.load(missionId(fixture.slug));
    assert.equal(
      loaded.kind === 'found' ? loaded.mission.status : null,
      'review',
      'the refused transition left the mission untouched',
    );
  } finally {
    await closeFixture(fixture);
  }
});
