import { parseReviewPhase, parseReviewDisposition } from '../../../src/domain/review.js';
import { missionId } from '../../../src/domain/mission.js';
import type { MissionStore } from '../../../src/application/domain-ports.js';
import { fixtureMission } from '../../fixtures/mission-builders.js';
import { makeCard, makeProjection } from '../../fixtures/board-projection.js';
import { missionVersion as fixtureVersion } from '../../../src/application/domain-ports.js';
// Mission handoff reconcile contract: reconciling an interrupted handoff against the recorded Mission
// review state.
//
// Behavior-owned suite (TASK-2622.07). Legacy case names are unchanged; regression provenance
// TASK-2350 (was test/task-2350-reconcile-interrupted-handoff.test.ts).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { withMissionDatabase } from '../../fixtures/review-state-db.js';
import { readReviewState, writeReviewState } from '../../../src/adapters/review/review-state.js';
import { ReviewCommandUseCase } from '../../../src/application/review-command-use-case.js';
import { createReviewCommand } from '../../../src/interfaces/cli/review.js';
import { createReviewWorkflowAdapter } from '../../../src/adapters/review/review-commands.js';
const review = (args: string[], options: NonNullable<Parameters<typeof createReviewWorkflowAdapter>[0]> = {}) => createReviewCommand(new ReviewCommandUseCase(createReviewWorkflowAdapter(options)))(args, options);
import { status } from '../../../src/adapters/cli/commands/status.js';
import { fakeReviewLoopPorts } from '../../helpers/review-loop-ports.js';

/** Bound loop mechanisms whose held controller fence declines the run at the reviewer-launch boundary. */
const declinedLoop = () => fakeReviewLoopPorts({ lock: { tryAcquire: () => false, release: () => {} } }).ports;

const canonicalHandoff = {
  sourceBranch: 'mission/task-2350-reconcile',
  targetBranch: 'main',
  reviewer: 'codex',
  implementer: 'claude',
  revision: 'abc123',
  eligibleReviewers: ['codex'],
  startedAt: '2026-08-10T09:00:00.000Z',
};

function seedReviewBacklogTask(root: string, slug = 'task-2350-reconcile'): void {
  const tasksDir = path.join(root, 'backlog', 'tasks');
  fs.mkdirSync(tasksDir, { recursive: true });
  fs.writeFileSync(path.join(tasksDir, `${slug}.md`), `---\nid: ${slug.toUpperCase()}\nstatus: review\n---\n`);
}

test('reconciles an interrupted handoff before review-loop state is saved', async () => {
  await withMissionDatabase('task-2350-reconcile', async ({ root, slug, store }) => {
    seedReviewBacklogTask(root, slug);
    const beforeMission = await store.load(missionId(slug));
    assert.equal(beforeMission.kind, 'found');
    assert.equal(beforeMission.mission.review, null, 'precondition: interrupted handoff has no Review aggregate');

    const blocked = await writeReviewState(slug, {
      reviewer: canonicalHandoff.reviewer,
      implementer: canonicalHandoff.implementer,
      round: 1,
      phase: 'reviewing',
    }, root, store);
    assert.equal(blocked.outcome, 'write-failed');
    assert.match(blocked.diagnostic, /has no review to update/);

    const module = await import('../../../src/adapters/review/review-state.js');
    const reconciled = await module.reconcileInterruptedHandoff!(slug, canonicalHandoff, root, { missionStore: store });
    assert.equal(reconciled.outcome, 'reconciled');

    const afterMission = await store.load(missionId(slug));
    assert.equal(afterMission.kind, 'found');
    assert.equal(afterMission.mission.status, 'review', 'reconciliation does not move the Mission');
    assert.deepEqual(afterMission.mission.review?.rounds[0].subject, {
      change: { kind: 'local-branch', sourceBranch: canonicalHandoff.sourceBranch, targetBranch: canonicalHandoff.targetBranch },
      revision: canonicalHandoff.revision,
    });
    assert.equal(afterMission.mission.review?.rounds[0].reviewer, canonicalHandoff.reviewer);
    assert.equal(afterMission.mission.review?.rounds[0].implementer, canonicalHandoff.implementer);
    assert.deepEqual(reconciled.eligibleReviewers, canonicalHandoff.eligibleReviewers);
    assert.equal((await readReviewState(slug, root, store))?.round, 1);

    const beforeRetry = afterMission.mission.review;
    const retried = await module.reconcileInterruptedHandoff!(slug, canonicalHandoff, root, { missionStore: store });
    assert.equal(retried.outcome, 'already-present');
    const afterRetry = await store.load(missionId(slug));
    assert.equal(afterRetry.kind, 'found');
    assert.deepEqual(afterRetry.mission.review, beforeRetry, 'a retry does not change the existing aggregate');
  }, { seedReview: false });
});

test('px review reconciles canonical inputs then reaches the reviewer-launch boundary', async () => {
  await withMissionDatabase('task-2350-command', async ({ root, slug, store }) => {
    seedReviewBacklogTask(root, slug);
    const logs: string[] = [];
    let launched = false;
    const options: NonNullable<Parameters<typeof createReviewWorkflowAdapter>[0]> = {
      log: (line: string) => logs.push(line), error: (line: string) => logs.push(line), exit: (() => undefined),
      resolveWorktreeFn: () => root, missionStore: store, requireReviewAggregate: true,
      readReviewStateFn: readReviewState,
      reviewLoopMechanisms: () => { launched = true; return declinedLoop(); },
    };
    await review([slug, '--start'], options);
    assert.equal(launched, true, 'a fresh start may rerun handoff to complete the Review');

    launched = false;
    logs.length = 0;
    await review([slug, '--reconcile-review', '--branch', 'mission/task-2350-command', '--target', 'main', '--reviewer', 'codex', '--implementer', 'claude', '--revision', 'def456', '--eligible-reviewer', 'codex'], options);
    assert.match(logs.join('\n'), /Reconciled round-one review/);
    assert.equal((await readReviewState(slug, root, store))?.phase, 'reviewing');

    await review([slug, '--start'], options);
    assert.equal(launched, true, 'the command reaches the injected reviewer-launch boundary');
  }, { seedReview: false });
});

test('px review production start guard gives reconciliation guidance before reviewer launch', async () => {
  const logs: string[] = [];
  let launched = false;
  await review(['task-2350-default-guard', '--start'], {
    log: (line: string) => logs.push(line), error: (line: string) => logs.push(line), exit: (() => undefined),
    inferSlugFn: slug => slug ?? null,
    resolveWorktreeFn: () => process.cwd(),
    requireReviewAggregate: true,
    reviewLoopMechanisms: () => { launched = true; return declinedLoop(); },
  });
  assert.equal(launched, false, 'the default path stops before the reviewer-launch seam');
  assert.match(logs.join('\n'), /--reconcile-review/);
});

test('reconciliation fails closed for ambiguous identity, missing Mission, and malformed legacy Review data', async () => {
  const module = await import('../../../src/adapters/review/review-state.js') as typeof import('../../../src/adapters/review/review-state.js');
  const mission = fixtureMission('task-2350-ambiguous', { status: 'review', review: null });
  let saves = 0;
  const store: MissionStore = { load: async () => ({ kind: 'found', mission, version: fixtureVersion(1) }), save: async () => { saves += 1; return fixtureVersion(2); } };
  const ambiguous = await module.reconcileInterruptedHandoff('task-2350-ambiguous', { ...canonicalHandoff, eligibleReviewers: ['codex', 'codex'] }, process.cwd(), { missionStore: store });
  assert.equal(ambiguous.outcome, 'failed');
  assert.match(ambiguous.diagnostic, /duplicate/);

  const missing = await module.reconcileInterruptedHandoff('task-2350-missing', canonicalHandoff, process.cwd(), { missionStore: { ...store, load: async () => ({ kind: 'missing' as const }) } });
  assert.equal(missing.outcome, 'failed');
  assert.match(missing.diagnostic, /restore it before reconciliation/);

  // @ts-expect-error Empty review rounds intentionally exercise malformed legacy aggregate recovery.
  const malformed = await module.reconcileInterruptedHandoff('task-2350-malformed', canonicalHandoff, process.cwd(), { missionStore: { ...store, load: async () => ({ kind: 'found' as const, mission: { ...mission, review: { rounds: [] } }, version: fixtureVersion(1) }) } });
  assert.equal(malformed.outcome, 'failed');
  assert.match(malformed.diagnostic, /malformed legacy Review data/);
  assert.equal(saves, 0, 'failed recovery never persists a Review');
});

test('px status reports a started review after reconciliation', async () => {
  await withMissionDatabase('task-2350-status', async ({ root, slug, store }) => {
    const module = await import('../../../src/adapters/review/review-state.js') as typeof import('../../../src/adapters/review/review-state.js');
    assert.equal((await module.reconcileInterruptedHandoff(slug, { ...canonicalHandoff, sourceBranch: `mission/${slug}` }, root, { missionStore: store })).outcome, 'reconciled');
    const state = await readReviewState(slug, root, store);
    const logs: string[] = [];
    await status([slug], {
      log: (line: string) => logs.push(line), exit: (() => undefined),
      inferSlugFn: value => value ?? null,
      getCurrentBranchFn: () => `mission/${slug}`,
      getPrStatusFn: () => ({ raw: '',  exists: false as const }),
      findStaleMissionWorktreesFn: () => [], readAgentConfigOrExitFn: () => ({}),
      eligibleAgentsForStepFn: () => [], allWorkflowAgentNamesFn: () => [],
      workflowLauncherStatusFn: () => ({ supported: true }), getLastThreeCommitsFn: () => [], getUncommittedCountFn: () => 0,
      detectRebaseStateFn: () => ({ inProgress: false, detached: false, unmergedFiles: [] }),
      buildProjectionFn: async () => ({ build: async () => makeProjection({ review: [makeCard({ id: missionId(slug), rawStatus: 'review', reviewPhase: parseReviewPhase(state?.phase), reviewRound: state?.round ?? null, reviewDisposition: parseReviewDisposition(state?.disposition) })] }) }),
    });
    assert.match(logs.join('\n'), /Review: round 1, phase reviewing/);
  }, { seedReview: false });
});
