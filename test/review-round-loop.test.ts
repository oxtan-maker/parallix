/**
 * The request-changes half of the review loop, end to end over a real store.
 *
 * Before this wiring the reviewer's verdict reached the review-event trail
 * only: the round kept `decision: null`, the Mission never left `review`
 * through `request-changes`, no implementer resolution was recorded, and the
 * next handoff resubmitted round 1 — which the workflow rejects with "A new
 * review round must advance the same pull request or local branch".
 */

import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { MissionCheckpointService } from '../src/application/mission-checkpoint-service.js';
import { MissionIntakeService } from '../src/application/mission-intake-service.js';
import { MissionLifecycleService } from '../src/application/mission-lifecycle-service.js';
import { SqliteDatabaseAdapter } from '../src/adapters/sqlite/database-adapter.js';
import { loadDefaultMigrations, SqliteMigrationRunner } from '../src/adapters/sqlite/migration-runner.js';
import { SqliteMissionStore } from '../src/adapters/sqlite/mission-store.js';
import {
  parseReviewFindings,
  recordImplementerResolution,
  recordRequestedChanges,
} from '../src/adapters/review/review-round.js';
import { applyReviewStateToReview, reviewStateDataFrom } from '../src/adapters/review/review-state-mapping.js';
import { agentFamily } from '../src/domain/agents.js';
import { missionId, missionLabels } from '../src/domain/mission.js';
import { repositoryId } from '../src/domain/repository.js';
import {
  beginNextReviewRound,
  changeRevision,
  ConfiguredReviewerEligibility,
  currentReviewRound,
  reviewStatus,
  startReview,
} from '../src/domain/review.js';

const MISSION = missionId('task-round-loop');
const REPOSITORY = repositoryId('parallix');
const CAPABILITIES = new Set(['mission:intake', 'mission:transition', 'checkpoint:record'] as const);
const reviewer = agentFamily('codex');
const implementer = agentFamily('custom');
const eligibility = ConfiguredReviewerEligibility.fromReviewStep({ eligible: [reviewer] } as never);

const change = {
  kind: 'pull-request' as const,
  provider: 'forgejo',
  id: '305',
  url: 'http://localhost:3300/magnus/parallix/pulls/305',
  sourceBranch: 'mission/task-round-loop',
  targetBranch: 'main',
};

const temporaryDirectories: string[] = [];

async function reviewInProgress() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-round-loop-'));
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
    title: 'Advance a review round',
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
    occurredAt: '2026-08-16T11:04:54.374Z',
  } as never);
  await lifecycle.activate({
    operationId: 'op-activate',
    missionId: MISSION,
    capabilities: CAPABILITIES,
    agent: implementer,
    occurredAt: '2026-08-16T11:04:54.374Z',
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
      goalCheck: [{ criterion: 'SC01', evidence: 'test/review-round-loop.test.ts' }],
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
        '2026-08-16T13:20:32.869Z',
        eligibility,
      ),
      reviewerEligibility: eligibility,
    },
    actor: reviewer,
    occurredAt: '2026-08-16T13:20:32.869Z',
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

describe('review round advancement', () => {
  it('parses reviewer finding headings into domain findings', () => {
    const findings = parseReviewFindings([
      '# Review findings — task-2378, round 1',
      '',
      'Verdict: request-changes (2 findings).',
      '',
      '## F1 (blocking): `px stats` runs the import gate',
      'body text',
      '## F2: second problem',
      '## F1 (duplicate heading is ignored)',
    ].join('\n'));
    assert.deepEqual(findings.map((finding) => finding.id), ['F1', 'F2']);
    assert.equal(findings[0].summary, 'px stats runs the import gate');
  });

  it('records the reviewer decision and returns the mission to the implementer', async () => {
    const { store, db } = await reviewInProgress();
    try {
      const result = await recordRequestedChanges(MISSION, {
        findings: parseReviewFindings('## F1 (blocking): the import gate mutates the operator db'),
        comment: 'Outcome: request-changes',
        decidedAt: '2026-08-16T13:51:30.650Z',
      }, { missionStore: store, lifecycleService: new MissionLifecycleService(store) });
      assert.deepEqual(result, { outcome: 'recorded' });

      const loaded = await store.load(MISSION);
      assert.equal(loaded.kind, 'found');
      const round = currentReviewRound(loaded.mission.review!);
      assert.equal(round.decision?.kind, 'changes-requested');
      assert.equal(round.disposition, 'REQUEST_CHANGES');
      assert.equal(loaded.mission.status, 'active');
      assert.equal(reviewStatus(loaded.mission.review!), 'awaiting-implementation');

      // Replaying the same consumption is not a second decision.
      const replay = await recordRequestedChanges(MISSION, {
        findings: parseReviewFindings('## F1 (blocking): the import gate mutates the operator db'),
        comment: null,
        decidedAt: '2026-08-16T14:00:00.000Z',
      }, { missionStore: store, lifecycleService: new MissionLifecycleService(store) });
      assert.equal(replay.outcome, 'unchanged');
    } finally {
      await db.close();
    }
  });

  it('keeps the request-changes decidedAt when a flat writer re-persists the round', async () => {
    const { store, db } = await reviewInProgress();
    try {
      const decidedAt = '2026-08-16T13:51:30.650Z';
      await recordRequestedChanges(MISSION, {
        findings: parseReviewFindings('## F1 (blocking): the import gate mutates the operator db'),
        comment: 'Outcome: request-changes',
        decidedAt,
      }, { missionStore: store, lifecycleService: new MissionLifecycleService(store) });

      const loaded = await store.load(MISSION);
      assert.equal(loaded.kind, 'found');
      const review = loaded.mission.review!;
      const decidedRound = currentReviewRound(review);
      // The decision time is the reviewer's, not the round's start — otherwise
      // the aggregate skews away from the lane event that fired review -> active.
      assert.notEqual(decidedRound.startedAt, decidedAt);

      // A flat writer (legacy loop-state view) re-persisting the same round
      // must not rewrite the retained decision's time to the round start.
      const rePersisted = applyReviewStateToReview(review, reviewStateDataFrom(review));
      const round = currentReviewRound(rePersisted);
      assert.equal(round.decision?.kind, 'changes-requested');
      assert.equal(round.decision?.decidedAt, decidedAt);
    } finally {
      await db.close();
    }
  });

  it('resolves the round so the next handoff can submit round 2 on the same pull request', async () => {
    const { store, db, lifecycle } = await reviewInProgress();
    try {
      await recordRequestedChanges(MISSION, {
        findings: parseReviewFindings('## F1 (blocking): first\n## F2: second'),
        comment: null,
        decidedAt: '2026-08-16T13:51:30.650Z',
      }, { missionStore: store, lifecycleService: lifecycle });

      const resolved = await recordImplementerResolution(MISSION, {
        itemDispositions: [{ kind: 'pushed_back', findingId: 'F2' as never }],
        evidence: 'CHANGES_MADE — round summary',
        resultingRevision: 'rev-2',
        respondedAt: '2026-08-16T16:00:00.000Z',
      }, { missionStore: store });
      assert.deepEqual(resolved, { outcome: 'recorded' });

      const afterResolution = await store.load(MISSION);
      assert.equal(afterResolution.kind, 'found');
      assert.equal(reviewStatus(afterResolution.mission.review!), 'ready-for-next-round');
      assert.deepEqual(
        currentReviewRound(afterResolution.mission.review!).response?.resolutions.map((r) => r.kind),
        ['fixed', 'disputed'],
      );

      // This is what the handoff does on the next round.
      const nextRound = beginNextReviewRound(
        afterResolution.mission.review!,
        reviewer,
        implementer,
        '2026-08-16T16:05:00.000Z',
        eligibility,
      );
      const submitted = await lifecycle.transition({
        operationId: 'op-submit-2',
        missionId: MISSION,
        capabilities: CAPABILITIES,
        command: {
          type: 'submit-for-review',
          gatesPassed: true,
          review: nextRound,
          reviewerEligibility: eligibility,
        },
        actor: reviewer,
        occurredAt: '2026-08-16T16:05:00.000Z',
        idempotencyKey: 'submit-2',
      } as never);
      assert.equal(submitted.status, 'completed', submitted.error?.message);

      const afterSubmit = await store.load(MISSION);
      assert.equal(afterSubmit.kind, 'found');
      assert.equal(afterSubmit.mission.status, 'review');
      assert.equal(currentReviewRound(afterSubmit.mission.review!).number, 2);
      assert.deepEqual(currentReviewRound(afterSubmit.mission.review!).subject.change, change);
    } finally {
      await db.close();
    }
  });

  it('accepts a resubmission of the round the reviewer has not decided yet', async () => {
    const { store, db, lifecycle } = await reviewInProgress();
    try {
      // A relaunched handoff replays the transition against a mission that was
      // bounced back to active with its undecided round still recorded.
      const loaded = await store.load(MISSION);
      assert.equal(loaded.kind, 'found');
      await store.save({ ...loaded.mission, status: 'active' } as never, loaded.version);

      const resubmitted = await lifecycle.transition({
        operationId: 'op-resubmit',
        missionId: MISSION,
        capabilities: CAPABILITIES,
        command: {
          type: 'submit-for-review',
          gatesPassed: true,
          review: loaded.mission.review!,
          reviewerEligibility: eligibility,
        },
        actor: reviewer,
        occurredAt: '2026-08-16T15:00:00.000Z',
        idempotencyKey: 'resubmit',
      } as never);
      assert.equal(resubmitted.status, 'completed', resubmitted.error?.message);
    } finally {
      await db.close();
    }
  });
});
