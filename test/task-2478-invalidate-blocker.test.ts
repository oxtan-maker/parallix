// TASK-2478 — `px review --continue` invalidates a BLOCKED/PARKED implementer
// stop so the review loop re-polls the reviewer on the current tree instead of
// relaunching the stuck implementer on every invocation.
//
// Red at the mission parent commit: `continueReviewInvalidatesBlocker` does not
// exist, so `--continue` relaunches the implementer against any persisted
// BLOCKED disposition and spins forever (the loop treats an existing disposition
// as "resolve the blocker"). Green after the fix: a `--continue` on a BLOCKED
// review clears the disposition, resets the round to `reviewing`, and records
// the operator attribution.

import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { SqliteDatabaseAdapter } from '../src/adapters/sqlite/database-adapter.js';
import { SqliteMigrationRunner, loadDefaultMigrations } from '../src/adapters/sqlite/migration-runner.js';
import { SqliteMissionStore } from '../src/adapters/sqlite/mission-store.js';
import { clearOperatorStateCache } from '../src/adapters/sqlite/adapter-factory.js';
import { missionId, missionLabels, type Mission } from '../src/domain/mission.js';
import { repositoryId } from '../src/domain/repository.js';
import { agentFamily } from '../src/domain/agents.js';
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
import { continueReviewInvalidatesBlocker } from '../src/adapters/review/review-commands.js';
import { applyReviewStateToReview, reviewStateDataFrom } from '../src/adapters/review/review-state-mapping.js';
import { readAllEvents } from '../src/adapters/review/review-events.js';

const SLUG = 'task-2478-invalidate-blocker';
const REVIEWER = agentFamily('configured-reviewer');
const IMPLEMENTER = agentFamily('configured-implementer');

const tempDirs: string[] = [];

after(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function createTempRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `parallix-task-2478-blocker-`));
  tempDirs.push(dir);
  fs.mkdirSync(path.join(dir, 'missions', SLUG), { recursive: true });
  fs.writeFileSync(path.join(dir, 'missions', SLUG, 'MISSION.md'), `# Mission: ${SLUG}\n`);
  fs.mkdirSync(path.join(dir, 'parallix-home'), { recursive: true });
  return dir;
}

function databasePathOf(root: string): string {
  return path.join(root, 'parallix-home', 'parallix.db');
}

async function withHome<T>(root: string, fn: () => Promise<T>): Promise<T> {
  const previous = process.env.PARALLIX_HOME;
  process.env.PARALLIX_HOME = path.join(root, 'parallix-home');
  await clearOperatorStateCache();
  try {
    return await fn();
  } finally {
    if (previous === undefined) { delete process.env.PARALLIX_HOME; }
    else { process.env.PARALLIX_HOME = previous; }
    await clearOperatorStateCache();
  }
}

const reviewerEligibility = ConfiguredReviewerEligibility.fromReviewStep({
  eligible: [REVIEWER],
  strategy: 'random',
});

/**
 * A single round that decided `changes-requested` and whose implementer then
 * stopped on a BLOCKED disposition — the exact shape that pins the loop in the
 * fixing phase and relaunches on every `--continue`.
 */
function blockedRound(): Review {
  const review = startReview(
    { change: { kind: 'local-branch', sourceBranch: `mission/${SLUG}`, targetBranch: 'main' }, revision: changeRevision('rev-1') },
    REVIEWER, IMPLEMENTER, '2026-09-01T09:00:00.000Z', reviewerEligibility,
  );
  const withChanges = applyReviewerCommand(review, {
    type: 'request-changes', decidedAt: '2026-09-01T10:00:00.000Z', comment: 'Fix findings', findings: [{ id: reviewFindingId('F1'), summary: 'Security', location: null }],
  });
  const state = reviewStateDataFrom(withChanges);
  return applyReviewStateToReview(withChanges, { ...state, phase: 'fixing', disposition: 'BLOCKED' });
}

/** Same as blockedRound but parked (a follow-up is owed instead of a fix). */
function parkedRound(): Review {
  const review = startReview(
    { change: { kind: 'local-branch', sourceBranch: `mission/${SLUG}`, targetBranch: 'main' }, revision: changeRevision('rev-1') },
    REVIEWER, IMPLEMENTER, '2026-09-01T09:00:00.000Z', reviewerEligibility,
  );
  const withChanges = applyReviewerCommand(review, {
    type: 'request-changes', decidedAt: '2026-09-01T10:00:00.000Z', comment: 'Fix findings', findings: [{ id: reviewFindingId('F1'), summary: 'Security', location: null }],
  });
  const state = reviewStateDataFrom(withChanges);
  return applyReviewStateToReview(withChanges, { ...state, phase: 'fixing', disposition: 'PARKED' });
}

function missionWith(review: Review): Mission {
  return {
    id: missionId(SLUG),
    repositoryId: repositoryId('parallix'),
    title: `Mission ${SLUG}`,
    labels: missionLabels([]),
    status: 'review',
    rawStatus: 'review',
    checkpoints: [],
    netEngineeringLines: null,
    closedAt: null,
    assignee: null,
    externalTaskRef: null,
    intakeTrace: null,
    review,
  } as Mission;
}

async function openMigrated(root: string): Promise<SqliteDatabaseAdapter> {
  const db = new SqliteDatabaseAdapter();
  await db.open({ path: databasePathOf(root) });
  await new SqliteMigrationRunner(db).applyPending(loadDefaultMigrations());
  return db;
}

interface Harness { root: string; store: SqliteMissionStore; }

async function seedRoot(review: Review): Promise<Harness> {
  const root = createTempRoot();
  const db = await openMigrated(root);
  const store = new SqliteMissionStore(db);
  await store.save(missionWith(review), null);
  return { root, store };
}

describe('TASK-2478: px review --continue invalidates a BLOCKED/PARKED stop', () => {
  it('clears a BLOCKED disposition and resets the round to reviewing', async () => {
    await withHome(createTempRoot(), async () => {
      const { root, store } = await seedRoot(blockedRound());
      const gitUser = { status: 0, stdout: 'alice-dev\n', stderr: '', error: null };
      const result = await continueReviewInvalidatesBlocker(SLUG, [], {
        resolveWorktreeFn: () => root,
        missionStore: store,
        log: () => undefined,
        error: () => undefined,
        runFn: (() => gitUser) as any,
      });
      assert.equal(result.invalidated, true, 'the BLOCKED stop is invalidated');
      const loaded = await store.load(missionId(SLUG));
      const review = loaded.kind === 'found' ? loaded.mission.review! : null;
      const round = currentReviewRound(review!);
      assert.equal(round.disposition, null, 'the round disposition is cleared');
      assert.equal(round.phase, 'reviewing', 'the round resets to reviewing so the loop re-polls the reviewer');
      assert.equal(round.blockedReason, undefined, 'the blocked reason is dropped');
    });
  });

  it('clears a PARKED disposition too', async () => {
    await withHome(createTempRoot(), async () => {
      const { root, store } = await seedRoot(parkedRound());
      const gitUser = { status: 0, stdout: 'alice-dev\n', stderr: '', error: null };
      const result = await continueReviewInvalidatesBlocker(SLUG, [], {
        resolveWorktreeFn: () => root,
        missionStore: store,
        log: () => undefined,
        error: () => undefined,
        runFn: (() => gitUser) as any,
      });
      assert.equal(result.invalidated, true, 'the PARKED stop is invalidated');
      const loaded = await store.load(missionId(SLUG));
      const review = loaded.kind === 'found' ? loaded.mission.review! : null;
      assert.equal(currentReviewRound(review!).disposition, null, 'the round disposition is cleared');
    });
  });

  it('leaves a non-blocked review untouched', async () => {
    await withHome(createTempRoot(), async () => {
      // A review that is already resolved (not blocked) is a no-op.
      const resolved = applyReviewerCommand(
        startReview({ change: { kind: 'local-branch', sourceBranch: `mission/${SLUG}`, targetBranch: 'main' }, revision: changeRevision('rev-1') }, REVIEWER, IMPLEMENTER, '2026-09-01T09:00:00.000Z', reviewerEligibility),
        { type: 'approve', decidedAt: '2026-09-01T10:00:00.000Z', comment: null, source: { kind: 'local' } },
      );
      const { root, store } = await seedRoot(resolved);
      const gitUser = { status: 0, stdout: 'alice-dev\n', stderr: '', error: null };
      const result = await continueReviewInvalidatesBlocker(SLUG, [], {
        resolveWorktreeFn: () => root,
        missionStore: store,
        log: () => undefined,
        error: () => undefined,
        runFn: (() => gitUser) as any,
      });
      assert.equal(result.invalidated, false, 'a non-blocked review is not invalidated');
      const loaded = await store.load(missionId(SLUG));
      const review = loaded.kind === 'found' ? loaded.mission.review! : null;
      assert.equal(reviewStatus(review), 'approved', 'the aggregate is unchanged');
    });
  });

  it('attributes the invalidation to the current git user on a review event', async () => {
    await withHome(createTempRoot(), async () => {
      const { root, store } = await seedRoot(blockedRound());
      const gitUser = { status: 0, stdout: 'alice-dev\n', stderr: '', error: null };
      await continueReviewInvalidatesBlocker(SLUG, [], {
        resolveWorktreeFn: () => root,
        missionStore: store,
        log: () => undefined,
        error: () => undefined,
        runFn: (() => gitUser) as any,
      });
      const events = await readAllEvents(SLUG, { rootDir: root, missionStore: store });
      const note = (events as Array<Record<string, unknown>>).find(
        (e) => e.event_type === 'human_note' && String(e.actor) === 'alice-dev',
      );
      assert.ok(note, 'the invalidation is attributed to the current git user');
      assert.match(String(note!.content), /BLOCKED/, 'the event names the invalidated stop');
    });
  });

  it('forwards a named --actor over the git user', async () => {
    await withHome(createTempRoot(), async () => {
      const { root, store } = await seedRoot(blockedRound());
      const gitUser = { status: 0, stdout: 'alice-dev\n', stderr: '', error: null };
      await continueReviewInvalidatesBlocker(SLUG, ['--actor=operator-carol'], {
        resolveWorktreeFn: () => root,
        missionStore: store,
        log: () => undefined,
        error: () => undefined,
        runFn: (() => gitUser) as any,
      });
      const events = await readAllEvents(SLUG, { rootDir: root, missionStore: store });
      const note = (events as Array<Record<string, unknown>>).find(
        (e) => e.event_type === 'human_note' && String(e.actor) === 'operator-carol',
      );
      assert.ok(note, 'the named operator overrides the git user');
    });
  });
});
