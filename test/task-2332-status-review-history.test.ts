// TASK-2332 round 5 — `px status <slug>` must report each review round's
// conversation, not just its verdict.
//
// The chain under test is the production one: exported review-event Markdown is
// restored into the operator database by the `--backfill-review` one-shot, read
// back out through `ConcreteReviewReadAdapter`, projected by
// `projectReviewHistory`, and rendered by `renderStatus`. Every step runs
// against a migrated SQLite database and a real mission directory, because the
// defect this covers was invisible to unit tests over hand-built aggregates:
// the data never reached the projection.

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { SqliteDatabaseAdapter } from '../src/adapters/sqlite/database-adapter.js';
import { SqliteMigrationRunner, loadDefaultMigrations } from '../src/adapters/sqlite/migration-runner.js';
import { SqliteMissionStore } from '../src/adapters/sqlite/mission-store.js';
import { ConcreteReviewReadAdapter } from '../src/adapters/backlog/concrete-review-read-adapter.js';
import {
  backfillReviewFromLegacyState,
  readExportedReviewEvents,
} from '../src/adapters/review/review-state.js';
import { projectReviewHistory } from '../src/application/projections/mission-board.js';
import { renderStatus } from '../src/interfaces/cli/status.js';
import { missionId, missionLabels, type Mission } from '../src/domain/mission.js';
import { repositoryId } from '../src/domain/repository.js';
import { agentFamily } from '../src/domain/agents.js';
import { changeRevision, type Review, type ReviewRound } from '../src/domain/review.js';
import type { StatusResult } from '../src/application/ports/cli-workflows.js';

const SLUG = 'task-2332-status';
const tempDirs: string[] = [];

const FINDINGS_EVENT = `---
event_type: reviewer_findings
timestamp: 2026-08-12T13:27:34.746Z
round: 1
phase: reviewing
actor: codex
slug: ${SLUG}
---

src/adapters/sqlite/mission-store.ts:L220: 🔴 bug: the fallback reintroduces a file-backed authority.

px status ${SLUG}: 🟡 risk: rounds report a verdict with no conversation under it.
`;

const OUTCOME_EVENT = `---
event_type: reviewer_outcome
timestamp: 2026-08-12T13:27:34.753Z
round: 1
phase: reviewing
actor: codex
slug: ${SLUG}
verdict: request-changes
---

Outcome: request-changes
`;

const SUMMARY_EVENT = `---
event_type: implementer_round_summary
timestamp: 2026-08-12T13:49:42.351Z
round: 1
phase: fixing
actor: claude
slug: ${SLUG}
---

# Round 1 Resolution — ${SLUG}

## fixed_items
1. **Filesystem fallback removed:** SQLite is the sole authority.

## pushed_back_items
1. **Rebase artifact:** Not a mission change - will be resolved by parallix rebase.

## parked_items
(none)
`;

function createRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-2332-status-'));
  tempDirs.push(root);
  const eventsDir = path.join(root, 'missions', SLUG, 'review-events');
  fs.mkdirSync(eventsDir, { recursive: true });
  fs.writeFileSync(path.join(root, 'missions', SLUG, 'MISSION.md'), `# Mission: ${SLUG}\n`);
  fs.writeFileSync(
    path.join(root, 'missions', SLUG, 'review-state.json'),
    JSON.stringify({
      slug: SLUG, reviewer: 'codex', implementer: 'claude', round: 1,
      phase: 'fixing', disposition: 'REQUEST_CHANGES', startedAt: '2026-08-12T13:00:00.000Z',
    }),
  );
  // Filenames carry the timestamp, so lexical order is chronological order.
  fs.writeFileSync(path.join(eventsDir, '2026-08-12T132734-reviewer_findings-1-codex.md'), FINDINGS_EVENT);
  fs.writeFileSync(path.join(eventsDir, '2026-08-12T132735-reviewer_outcome-1-codex.md'), OUTCOME_EVENT);
  fs.writeFileSync(path.join(eventsDir, '2026-08-12T134942-implementer_round_summary-1-claude.md'), SUMMARY_EVENT);
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
  return {
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
    intakeTrace: null,
    review: {
      rounds: [round],
      intervention: null,
      stageLaunches: [],
      gateFailureRetryCount: 0,
      hookFailureRetryCount: 0,
      reviewEvents: [],
    } as Review,
  } as Mission;
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
  const result: StatusResult = {
    branch: `mission/${SLUG}`,
    worktree: '/tmp/worktree',
    rebaseInfo: null,
    slug: SLUG,
    missionData: {
      backlogStatus: 'review',
      reviewPhase: 'fixing',
      reviewRound: 1,
      reviewDisposition: 'REQUEST_CHANGES',
      reviewHistory: history.map((round) => ({
        number: round.number,
        reviewer: round.reviewer,
        implementer: round.implementer,
        disposition: round.disposition ?? 'pending',
        comment: round.comment,
        findingSummaries: round.findingSummaries,
        fixes: round.fixes,
        pushbacks: round.pushbacks,
      })),
    },
    prInfo: null,
    staleWorktrees: [],
    agentMatrix: [],
    lastThreeCommits: [],
  } as unknown as StatusResult;
  renderStatus(result, (message) => lines.push(message));
  return lines;
}

describe('TASK-2332: px status reports the review conversation from persisted events', () => {
  after(() => {
    for (const dir of tempDirs) {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
    }
  });

  it('reads the exported events in chronological order with their frontmatter', () => {
    const root = createRoot();
    const events = readExportedReviewEvents(SLUG, root);

    assert.deepEqual(
      events.map((event) => [event.position, event.eventType, event.roundNumber, event.actor]),
      [
        [0, 'reviewer_findings', 1, 'codex'],
        [1, 'reviewer_outcome', 1, 'codex'],
        [2, 'implementer_round_summary', 1, 'claude'],
      ],
    );
    assert.equal(events[1].verdict, 'request-changes');
    assert.match(events[0].content, /reintroduces a file-backed authority/);
  });

  it('backfills the events into SQLite and renders them under the round in px status', async () => {
    const root = createRoot();
    const db = await openMigrated(root);
    try {
      const store = new SqliteMissionStore(db);
      await store.save(missionWithEventlessRound(root), null);

      // Before the one-shot: the round exists, its conversation does not.
      const before = await new ConcreteReviewReadAdapter({ rootDir: root, missionStore: store })
        .loadReview(missionId(SLUG));
      assert.equal(before?.reviewEvents.length, 0);
      assert.deepEqual(projectReviewHistory(before)[0].findingSummaries, []);

      assert.deepEqual(
        await backfillReviewFromLegacyState(SLUG, root, { missionStore: store }),
        { outcome: 'events-backfilled', events: 3 },
      );

      // The events must come back out of the database, not off disk: the read
      // adapter has no filesystem path to review events.
      const after = await new ConcreteReviewReadAdapter({ rootDir: root, missionStore: store })
        .loadReview(missionId(SLUG));
      assert.equal(after?.reviewEvents.length, 3);

      const lines = renderedStatusLines(projectReviewHistory(after)).join('\n');
      assert.match(lines, /Round 1 \[codex -> claude\]: REQUEST_CHANGES/);
      assert.match(lines, /comment: request-changes/);
      assert.match(lines, /finding: .*the fallback reintroduces a file-backed authority\./);
      // A finding scoped to a command rather than a file:line must survive too.
      assert.match(lines, /finding: .*rounds report a verdict with no conversation under it\./);
      assert.match(lines, /fixed: Filesystem fallback removed/);
      assert.match(lines, /pushback: Rebase artifact/);

      // Re-running the one-shot must not duplicate the conversation.
      assert.deepEqual(
        await backfillReviewFromLegacyState(SLUG, root, { missionStore: store }),
        { outcome: 'already-present' },
      );
    } finally {
      await db.close();
    }
  });

  it('restores the conversation for a post-cutover mission that has no review-state.json', async () => {
    const root = createRoot();
    // The cutover removed the file; the mission still has rounds and exported
    // events, which is the state every live mission is in.
    fs.rmSync(path.join(root, 'missions', SLUG, 'review-state.json'));

    const db = await openMigrated(root);
    try {
      const store = new SqliteMissionStore(db);
      await store.save(missionWithEventlessRound(root), null);

      assert.deepEqual(
        await backfillReviewFromLegacyState(SLUG, root, { missionStore: store }),
        { outcome: 'events-backfilled', events: 3 },
      );

      const result = await store.load(missionId(SLUG));
      assert.equal(result.kind === 'found' && result.mission.review?.reviewEvents.length, 3);
    } finally {
      await db.close();
    }
  });

  it('reports the pending write under --dry-run without touching the database', async () => {
    const root = createRoot();
    const db = await openMigrated(root);
    try {
      const store = new SqliteMissionStore(db);
      await store.save(missionWithEventlessRound(root), null);

      assert.deepEqual(
        await backfillReviewFromLegacyState(SLUG, root, { missionStore: store, apply: false }),
        { outcome: 'would-backfill-events', events: 3 },
      );

      const result = await store.load(missionId(SLUG));
      assert.equal(result.kind === 'found' && result.mission.review?.reviewEvents.length, 0);
    } finally {
      await db.close();
    }
  });
});
