// TASK-2514 — human approve after an active-state repair.
//
// After an interrupted request-changes review is repaired by hand, the
// Mission lane is `active` while the valid next round is `awaiting-review`.
// A named human must be able to record the approval with the existing
// `px review --submit-review approve` path and have the Mission leave for
// integration in the same command.
//
// Red at the parent: `recordApproval` refuses any lane other than review or
// integration, so an approve over the repaired active lane fails and the
// Mission stays `active`. The awaiting-implementation guard cases pin the
// behaviour the fix must not regress: an approve can never overwrite the
// unresolved findings of a changes-requested round.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { agentFamily } from '../src/domain/agents.js';
import { missionId, type Mission } from '../src/domain/mission.js';
import {
  applyImplementerCommand,
  applyReviewerCommand,
  beginNextReviewRound,
  changeRevision,
  ConfiguredReviewerEligibility,
  currentReviewRound,
  reviewFindingId,
  reviewStatus,
  startReview,
  type Review,
  type ReviewedChange,
} from '../src/domain/review.js';
import { MissionLifecycleService } from '../src/application/mission-lifecycle-service.js';
import { recordApproval } from '../src/adapters/review/review-round.js';
import { submitReviewRound } from '../src/adapters/review/review-commands.js';
import { fixtureMission } from './fixtures/mission-builders.js';
import { openMigratedMissionStore, type MigratedMissionStore } from './fixtures/mission-sqlite-store.js';

const SLUG = 'task-2514-repro';
const HUMAN = agentFamily('magnus');
const IMPLEMENTER = agentFamily('claude');
const ELIGIBILITY = ConfiguredReviewerEligibility.fromReviewStep({ eligible: [HUMAN], strategy: 'random' });
const PULL_REQUEST: ReviewedChange = {
  kind: 'pull-request',
  provider: 'forgejo',
  id: '2514',
  url: null,
  sourceBranch: `mission/${SLUG}`,
  targetBranch: 'main',
};

const HANDOFF_AT = '2026-09-20T10:00:00.000Z';
const CHANGES_REQUESTED_AT = '2026-09-20T11:00:00.000Z';
const RESOLVED_AT = '2026-09-20T12:00:00.000Z';
const ROUND_2_AT = '2026-09-20T13:00:00.000Z';
const APPROVED_AT = '2026-09-20T14:00:00.000Z';

const tempDirs: string[] = [];

test.after(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-task-2514-'));
  tempDirs.push(dir);
  return dir;
}

interface Fixture extends MigratedMissionStore {
  readonly lifecycle: MissionLifecycleService;
}

async function openFixture(review: Review, status: 'active' | 'integration' = 'active'): Promise<Fixture> {
  const migrated = await openMigratedMissionStore([fixtureMission(SLUG, { status, review, assignee: IMPLEMENTER })]);
  return { ...migrated, lifecycle: new MissionLifecycleService(migrated.store) };
}

async function loadMission(fixture: Fixture): Promise<Mission> {
  const loaded = await fixture.store.load(missionId(SLUG));
  assert.equal(loaded.kind, 'found', 'the mission is recorded');
  return (loaded as { mission: Mission }).mission;
}

async function laneEvents(fixture: Fixture): Promise<Array<[string | null, string, string]>> {
  return (await fixture.laneEvents(SLUG)).map((row) => [row.from_status, row.to_status, row.trigger]);
}

function roundOneAwaitingReview(): Review {
  return startReview({ change: PULL_REQUEST, revision: changeRevision('rev-1') }, HUMAN, IMPLEMENTER, HANDOFF_AT, ELIGIBILITY);
}

function roundOneChangesRequested(): Review {
  return applyReviewerCommand(roundOneAwaitingReview(), {
    type: 'request-changes',
    decidedAt: CHANGES_REQUESTED_AT,
    comment: 'Changes requested',
    findings: [{ id: reviewFindingId('F1'), summary: 'Unresolved finding', location: null }],
  });
}

/** The manually repaired shape: round 1 resolved, round 2 opened, lane left active. */
function repairedRoundTwoAwaitingReview(): Review {
  const resolved = applyImplementerCommand(roundOneChangesRequested(), {
    type: 'submit-resolution',
    respondedAt: RESOLVED_AT,
    resolutions: [{ findingId: reviewFindingId('F1'), kind: 'fixed', evidence: 'fixed by hand' }],
    resultingRevision: changeRevision('rev-2'),
  });
  return beginNextReviewRound(resolved, HUMAN, IMPLEMENTER, ROUND_2_AT, ELIGIBILITY);
}

async function approve(fixture: Fixture) {
  return recordApproval(SLUG, { comment: 'Approved by a human', decidedAt: APPROVED_AT, source: { kind: 'local' } }, {
    missionStore: fixture.store,
    lifecycleService: fixture.lifecycle,
  });
}

async function assertChangesRequestedIntact(fixture: Fixture): Promise<void> {
  const mission = await loadMission(fixture);
  assert.equal(mission.status, 'active', 'the rejected approve leaves the lane active');
  assert.equal(reviewStatus(mission.review!), 'awaiting-implementation');
  const round = currentReviewRound(mission.review!);
  assert.equal(round.decision?.kind, 'changes-requested', 'the changes-requested decision is preserved');
  assert.deepEqual(
    round.decision?.kind === 'changes-requested' ? round.decision.findings.map((finding) => String(finding.id)) : [],
    ['F1'],
    'the unresolved findings are preserved',
  );
  assert.notEqual(round.disposition, 'APPROVED', 'no approval is written over unresolved findings');
  assert.deepEqual(await laneEvents(fixture), [], 'no lane event is recorded for the rejected approve');
}

test('a human approve of an awaiting-review round moves an active Mission to integration', async () => {
  const fixture = await openFixture(roundOneAwaitingReview());
  try {
    assert.deepEqual(await approve(fixture), { outcome: 'recorded' });
    const mission = await loadMission(fixture);
    const round = currentReviewRound(mission.review!);
    assert.equal(round.decision?.kind, 'approved', 'the approved ReviewerDecision is recorded on the aggregate');
    assert.equal(round.number, 1);
    assert.equal(mission.status, 'integration', 'the repaired lane leaves for integration in one command');
    assert.deepEqual(await laneEvents(fixture), [['active', 'integration', 'approve']]);
  } finally {
    await fixture.close();
  }
});

test('a human approve of the repaired next round moves an active Mission to integration', async () => {
  const fixture = await openFixture(repairedRoundTwoAwaitingReview());
  try {
    assert.deepEqual(await approve(fixture), { outcome: 'recorded' });
    const mission = await loadMission(fixture);
    const round = currentReviewRound(mission.review!);
    assert.equal(round.number, 2);
    assert.equal(round.decision?.kind, 'approved');
    assert.equal(mission.status, 'integration');
    assert.deepEqual(await laneEvents(fixture), [['active', 'integration', 'approve']]);
    assert.deepEqual(await approve(fixture), { outcome: 'unchanged', reason: 'mission is already in integration' });
  } finally {
    await fixture.close();
  }
});

test('an approve of an awaiting-implementation round on an active Mission fails and keeps the findings', async () => {
  const fixture = await openFixture(roundOneChangesRequested());
  try {
    const result = await approve(fixture);
    assert.equal(result.outcome, 'failed');
    assert.match(result.outcome === 'failed' ? result.diagnostic : '', /awaiting-implementation/);
    await assertChangesRequestedIntact(fixture);
  } finally {
    await fixture.close();
  }
});

test('an active-lane approve without a lifecycle service writes no approval', async () => {
  const fixture = await openFixture(repairedRoundTwoAwaitingReview());
  try {
    const result = await recordApproval(SLUG, { comment: null, decidedAt: APPROVED_AT, source: { kind: 'local' } }, {
      missionStore: fixture.store,
    });
    assert.equal(result.outcome, 'failed');
    const mission = await loadMission(fixture);
    assert.equal(mission.status, 'active');
    assert.equal(reviewStatus(mission.review!), 'awaiting-review', 'no approval is left attached to an active Mission');
  } finally {
    await fixture.close();
  }
});

test('an integration-repair round reopened by a revoked approval is not approvable from active', async () => {
  const approved = applyReviewerCommand(repairedRoundTwoAwaitingReview(), {
    type: 'approve', decidedAt: APPROVED_AT, comment: null, source: { kind: 'local' },
  });
  const fixture = await openFixture(approved, 'integration');
  try {
    const rebound = await fixture.lifecycle.transition({
      operationId: 'integration-repair', missionId: missionId(SLUG), capabilities: new Set(['mission:transition']),
      command: { type: 'rebound-to-active', agent: IMPLEMENTER, cause: { kind: 'integration-gate-failure', gate: 'unit' }, occurredAt: APPROVED_AT }, actor: IMPLEMENTER, occurredAt: APPROVED_AT,
    });
    assert.equal(rebound.status, 'completed');
    const result = await approve(fixture);
    assert.equal(result.outcome, 'failed');
    assert.match(result.outcome === 'failed' ? result.diagnostic : '', /integration repair/);
    const mission = await loadMission(fixture);
    assert.equal(mission.status, 'active', 'the implementer still owns the integration repair');
    assert.equal(reviewStatus(mission.review!), 'awaiting-review');
  } finally {
    await fixture.close();
  }
});

function submitOptions(fixture: Fixture, exits: number[], errors: string[]) {
  return {
    worktree: tempDir(),
    isReviewProviderEnabledFn: () => false,
    missionStore: fixture.store,
    lifecycleService: fixture.lifecycle,
    readReviewStateFn: () => null,
    writeReviewStateFn: (async () => {}) as never,
    transitionTaskFn: (async () => ({ ok: true })) as never,
    exit: ((code: number) => { exits.push(code); }) as never,
    log: () => {},
    error: (message: string) => { errors.push(message); },
  };
}

test('px review --submit-review approve records a human approval over the repaired active lane', async () => {
  const fixture = await openFixture(repairedRoundTwoAwaitingReview());
  try {
    const exits: number[] = [];
    const errors: string[] = [];
    await submitReviewRound(SLUG, 'approve', 'Approved by a human', submitOptions(fixture, exits, errors));
    assert.deepEqual(exits, [], errors.join('\n'));
    const mission = await loadMission(fixture);
    assert.equal(currentReviewRound(mission.review!).decision?.kind, 'approved');
    assert.equal(mission.status, 'integration');
  } finally {
    await fixture.close();
  }
});

test('px review --submit-review approve over an awaiting-implementation round exits non-zero', async () => {
  const fixture = await openFixture(roundOneChangesRequested());
  try {
    const exits: number[] = [];
    const errors: string[] = [];
    await submitReviewRound(SLUG, 'approve', 'Approved by a human', submitOptions(fixture, exits, errors));
    assert.deepEqual(exits, [1]);
    assert.ok(errors.some((message) => /awaiting-implementation/.test(message)), errors.join('\n'));
    await assertChangesRequestedIntact(fixture);
  } finally {
    await fixture.close();
  }
});
