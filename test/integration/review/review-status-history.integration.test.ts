import { statusResult } from '../../fixtures/status-result.js';
import { fixtureMission as completeMissionFixture } from '../../fixtures/mission-builders.js';
// review status backfill.integration.
// Related scenarios share imports; each contract keeps its own hooks and mutable fixtures.
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { SqliteDatabaseAdapter } from '../../../src/adapters/sqlite/database-adapter.js';
import { SqliteMigrationRunner, loadDefaultMigrations } from '../../../src/adapters/sqlite/migration-runner.js';
import { SqliteMissionStore } from '../../../src/adapters/sqlite/mission-store.js';
import { ConcreteReviewReadAdapter } from '../../../src/adapters/backlog/concrete-review-read-adapter.js';
import { projectReviewHistory } from '../../../src/application/projections/mission-board.js';
import { renderStatus } from '../../../src/interfaces/cli/status.js';
import { missionId, missionLabels, type Mission } from '../../../src/domain/mission.js';
import { repositoryId } from '../../../src/domain/repository.js';
import { agentFamily } from '../../../src/domain/agents.js';
import { changeRevision, type Review, type ReviewRound } from '../../../src/domain/review.js';
import { type StatusResult } from '../../../src/application/ports/cli-workflows.js';
import { mkdtemp as registeredMkdtemp } from '../../helpers/temp-dir.js';

// Regression provenance: TASK-2332.
// TASK-2332 round 5 — `px status <slug>` must report each review round's
// conversation, not just its verdict.
//
const SLUG = 'task-2332-status';
const tempDirs: string[] = [];

const FINDINGS_EVENT = `src/adapters/sqlite/mission-store.ts:L220: 🔴 bug: the fallback reintroduces a file-backed authority.

px status ${SLUG}: 🟡 risk: rounds report a verdict with no conversation under it.
`;

const OUTCOME_EVENT = `Outcome: request-changes
`;

const SUMMARY_EVENT = `# Round 1 Resolution — ${SLUG}

## fixed_items
1. **Filesystem fallback removed:** SQLite is the sole authority.

## pushed_back_items
1. **Rebase artifact:** Not a mission change - will be resolved by parallix rebase.

## parked_items
(none)
`;

function createRoot(): string {
  const root = registeredMkdtemp('parallix-2332-status-');
  tempDirs.push(root);
  return root;
}

/** A mission in review whose round predates event persistence. */
function missionWithEventlessRound(root: string): Mission {
  const round: ReviewRound = {
    number: 1,
    subject: {
      change: { kind: 'local-branch', sourceBranch: `mission/${SLUG}`, targetBranch: 'main' },
      revision: changeRevision('rev-1'),
    },
    reviewer: agentFamily('codex'),
    implementer: agentFamily('claude'),
    startedAt: '2026-08-12T13:00:00.000Z',
    decision: null,
    response: null,
    phase: 'fixing',
    disposition: 'REQUEST_CHANGES',
    reviewerRetryCount: 0,
    implementerRetryCount: 0,
  };
  return completeMissionFixture(String(missionId(SLUG)), {
    id: missionId(SLUG),
    repositoryId: repositoryId(root),
    title: `Mission ${SLUG}`,
    labels: missionLabels([]),
    assignee: agentFamily('claude'),
    status: 'review',
    rawStatus: 'review',
    checkpoints: [],
    netEngineeringLines: null,
    closedAt: null,
    externalTaskRef: null,

    review: {
      rounds: [round],
      intervention: null,
      stageLaunches: [],
      gateFailureRetryCount: 0,
      hookFailureRetryCount: 0,
      reviewEvents: [],
    } as Review,
  }) as Mission;
}

async function openMigrated(root: string): Promise<SqliteDatabaseAdapter> {
  const db = new SqliteDatabaseAdapter();
  await db.open({ path: path.join(root, 'parallix.db') });
  await new SqliteMigrationRunner(db).applyPending(loadDefaultMigrations());
  return db;
}

/** Render `px status <slug>`'s mission block from the projected review history. */
function renderedStatusLines(history: ReturnType<typeof projectReviewHistory>): string[] {
  const lines: string[] = [];
  const result = statusResult({
    branch: `mission/${SLUG}`,
    worktree: '/tmp/worktree',
    rebaseInfo: null,
    slug: SLUG,
    missionData: {
      backlogStatus: 'review',
      reviewPhase: 'fixing',
      reviewRound: 1,
      reviewDisposition: 'REQUEST_CHANGES',
      // Status carries the board projection's rounds unchanged; the mirror map
      // it used to widen them through is gone (TASK-2846).
      reviewHistory: history,
    },
    prInfo: null,
    staleWorktrees: [],
    agents: [],
    lastThreeCommits: [],
  });
  renderStatus(result, (message) => lines.push(message));
  return lines;
}

describe('px status reports the review conversation from persisted events', () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it('renders stored conversation without historical files (TASK-2821)', async () => {
    const root = createRoot();
    const db = await openMigrated(root);
    try {
      const store = new SqliteMissionStore(db);
      const mission = missionWithEventlessRound(root);
      const events = [
        { position: 0, eventType: 'reviewer_findings', actor: 'codex', content: FINDINGS_EVENT },
        { position: 1, eventType: 'reviewer_outcome', actor: 'codex', content: OUTCOME_EVENT, verdict: 'request-changes' },
        { position: 2, eventType: 'implementer_round_summary', actor: 'claude', content: SUMMARY_EVENT },
      ] as const;
      const storedEvents: Review['reviewEvents'] = events.map(event => ({ roundNumber: 1, phase: 'fixing', createdAt: '2026-08-12T13:27:34.746Z', disposition: null,
        verdict: null, itemDispositions: null, blockedReason: null, followUpReference: null, ...event }));
      await store.save({ ...mission, review: { ...mission.review!, reviewEvents: storedEvents } }, null);
      const review = await new ConcreteReviewReadAdapter({ missionStore: store }).loadReview(missionId(SLUG));
      assert.equal(review?.reviewEvents.length, 3);
      const lines = renderedStatusLines(projectReviewHistory(review)).join('\n');
      assert.match(lines, /Round 1 \[codex -> claude\]: REQUEST_CHANGES/);
      assert.match(lines, /comment: request-changes/);
      assert.match(lines, /finding: .*the fallback reintroduces a file-backed authority\./);
      assert.match(lines, /finding: .*rounds report a verdict with no conversation under it\./);
      assert.match(lines, /fixed: Filesystem fallback removed/);
      assert.match(lines, /pushback: Rebase artifact/);
    } finally { await db.close(); }
  });
});
