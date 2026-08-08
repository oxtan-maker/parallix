/**
 * task-2343 reproduction: board projections report `unavailable` for facts the
 * mission lifecycle has already produced.
 *
 * The test composes the production `BoardProjectionBuilder` from the real
 * concrete read adapters over deterministic fixtures. No Forgejo access, no
 * agent launch, no `git` invocation, no new port and no new table.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ConcreteAgentReadAdapter } from '../src/adapters/backlog/concrete-agent-read-adapter.js';
import { ConcreteGateReadAdapter } from '../src/adapters/backlog/concrete-gate-read-adapter.js';
import { ConcreteGitReadAdapter } from '../src/adapters/backlog/concrete-git-read-adapter.js';
import { ConcreteMissionReadAdapter } from '../src/adapters/backlog/concrete-mission-read-adapter.js';
import { ConcreteOperationLogReadAdapter } from '../src/adapters/backlog/concrete-operation-log-read-adapter.js';
import { ConcreteReviewReadAdapter } from '../src/adapters/backlog/concrete-review-read-adapter.js';
import { BoardProjectionBuilder } from '../src/application/projections/board-readers.js';
import { ConcreteMetricsReadAdapter } from '../src/application/projections/metrics-read-adapter.js';
import { recordGateResult } from '../src/adapters/verification/verification.js';
import { agentFamily } from '../src/domain/agents.js';
import { missionId } from '../src/domain/mission.js';
import { repositoryId } from '../src/domain/repository.js';
import type { AgentBlocklistRepository } from '../src/application/ports/agent-blocklist.js';
import type {
  BoardLaneEventEntry,
  BoardLaneEventRepository,
  OperationalHistoryEntry,
  OperationalHistoryRepository,
} from '../src/application/ports/operation-history.js';
import type { UsageRecord, UsageRepository } from '../src/application/ports/mission-measurements.js';

const SLUG = 'task-2343';
const MISSION = missionId(SLUG);

// ---------------------------------------------------------------------------
// In-memory doubles for the existing ports
// ---------------------------------------------------------------------------

class MemoryBlocklistRepo implements AgentBlocklistRepository {
  private entries: Array<{ agent: string; blocked: boolean; until?: string; reason?: string }> = [];
  async findAll() { return this.entries as readonly { agent: string; blocked: boolean; until?: string; reason?: string }[]; }
  async findByAgent(agent: string) { return this.entries.find(e => e.agent === agent); }
  async save(entry: { agent: string; blocked: boolean; until?: string; reason?: string }) {
    const index = this.entries.findIndex(e => e.agent === entry.agent);
    if (index >= 0) { this.entries[index] = entry; } else { this.entries.push(entry); }
  }
  async deleteByAgent(agent: string) { this.entries = this.entries.filter(e => e.agent !== agent); }
  async clear() { this.entries = []; }
}

class MemoryLaneEventRepo implements BoardLaneEventRepository {
  readonly entries: BoardLaneEventEntry[] = [];
  async append(entry: BoardLaneEventEntry) {
    if (this.entries.some(e => e.idempotencyKey === entry.idempotencyKey && e.repositoryId === entry.repositoryId)) { return false; }
    this.entries.push(entry);
    return true;
  }
  async findByMissionId(id: string) { return this.entries.filter(e => e.missionId === id); }
  async findAll() { return this.entries as readonly BoardLaneEventEntry[]; }
  async findByRepositoryId(repoId: string) { return this.entries.filter(e => e.repositoryId === repoId); }
  async clear() { this.entries.length = 0; }
}

class MemoryHistoryRepo implements OperationalHistoryRepository {
  readonly entries: OperationalHistoryEntry[] = [];
  async findAll() { return this.entries as readonly OperationalHistoryEntry[]; }
  async findByType(type: string) { return this.entries.filter(e => e.eventType === type); }
  async append(entry: OperationalHistoryEntry) { this.entries.push({ id: this.entries.length + 1, ...entry }); }
  async clear() { this.entries.length = 0; }
}

class MemoryUsageRepo implements UsageRepository {
  async findAll() { return [] as readonly UsageRecord[]; }
  async findWhere() { return [] as readonly UsageRecord[]; }
  async save() { /* not used by these fixtures */ }
  async saveAll() { /* not used by these fixtures */ }
  async clear() { /* not used by these fixtures */ }
}

// ---------------------------------------------------------------------------
// Deterministic filesystem fixture: one task file plus two checkpoints
// ---------------------------------------------------------------------------

const CP_2 = `# CP-2: Adapters repaired

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Checkpoint parser reads Goal Check rows | \`src/adapters/backlog/checkpoint-document.ts:36\` | PASS |
| Gate evidence recorded from the verifier exit code | \`./scripts/verify-local.sh all\` | PASS |

Next action: Wire the lifecycle commands through the operation-event recorder.
`;

interface Fixture {
  readonly rootDir: string;
  readonly missionDir: string;
  readonly taskFile: string;
}

function makeFixture(): Fixture {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'px-2343-'));
  const tasksDir = path.join(rootDir, 'backlog', 'tasks');
  const missionDir = path.join(rootDir, 'missions', SLUG);
  fs.mkdirSync(tasksDir, { recursive: true });
  fs.mkdirSync(missionDir, { recursive: true });

  const taskFile = path.join(tasksDir, `${SLUG} - Populate-board-projection-data.md`);
  fs.writeFileSync(
    taskFile,
    `---\nid: TASK-2343\ntitle: Populate board projection data\nstatus: review\nassignee: [codex]\nlabels: [bug]\n---\n\n## Description\n\nBoard cards report unavailable.\n`,
    'utf8',
  );
  fs.writeFileSync(path.join(missionDir, 'CP-1.md'), '# CP-1: Reproduction\n\nNext action: Repair the adapters.\n', 'utf8');
  fs.writeFileSync(path.join(missionDir, 'CP-2.md'), CP_2, 'utf8');

  return { rootDir, missionDir, taskFile };
}

function cleanup(fixture: Fixture): void {
  fs.rmSync(fixture.rootDir, { recursive: true, force: true });
}

/** The review state a completed review round leaves behind for a Forgejo PR. */
function reviewStateWithPullRequest() {
  return {
    slug: SLUG,
    reviewer: 'claude',
    implementer: 'codex',
    round: 2,
    startedAt: '2026-08-01T10:00:00.000Z',
    phase: 'approved',
    disposition: 'approved',
    reviewerRetryCount: 0,
    implementerRetryCount: 0,
    metadata: {},
    pullRequest: {
      kind: 'pull-request' as const,
      provider: 'forgejo',
      id: '4242',
      url: 'http://localhost:3000/parallix/parallix/pulls/4242',
      sourceBranch: `mission/${SLUG}`,
      targetBranch: 'main',
    },
  };
}

interface BuiltBoard {
  readonly laneEvents: MemoryLaneEventRepo;
  readonly history: MemoryHistoryRepo;
  readonly build: () => ReturnType<BoardProjectionBuilder['build']>;
}

function composeBoard(fixture: Fixture): BuiltBoard {
  const repoId = repositoryId(fixture.rootDir);
  const blocklist = new MemoryBlocklistRepo();
  const laneEvents = new MemoryLaneEventRepo();
  const history = new MemoryHistoryRepo();

  void blocklist.save({ agent: 'claude', blocked: true, until: new Date(Date.now() + 3_600_000).toISOString(), reason: 'usage limit' });
  void laneEvents.append({
    repositoryId: repoId, missionId: SLUG, fromStatus: 'active', toStatus: 'review', trigger: 'submit-for-review',
    agent: 'codex', occurredAt: '2026-08-01T09:00:00.000Z', idempotencyKey: `${SLUG}-active-review`,
  });
  void laneEvents.append({
    repositoryId: repoId, missionId: SLUG, fromStatus: 'backlog', toStatus: 'active', trigger: 'activate',
    agent: 'codex', occurredAt: '2026-07-31T09:00:00.000Z', idempotencyKey: `${SLUG}-backlog-active`,
  });
  void history.append({ eventType: 'mission.active', eventData: JSON.stringify({ missionId: SLUG }), createdAt: '2026-07-31T09:00:00.000Z' });

  const missions = new ConcreteMissionReadAdapter({
    rootDir: fixture.rootDir,
    repositoryId: repoId,
    findMissionDir: () => fixture.missionDir,
    resolveWorktree: () => null,
  });

  const builder = new BoardProjectionBuilder(
    missions,
    new ConcreteReviewReadAdapter({
      rootDir: fixture.rootDir,
      missionStore: null,
      readReviewState: () => reviewStateWithPullRequest() as never,
      findMissionDir: () => fixture.missionDir,
    }),
    new ConcreteGateReadAdapter({ rootDir: fixture.rootDir, findMissionDir: () => fixture.missionDir }),
    new ConcreteAgentReadAdapter({
      rootDir: fixture.rootDir,
      blocklistRepo: blocklist,
      knownAgentFamilies: [agentFamily('codex'), agentFamily('claude')],
      resolveTaskFile: () => ({ ok: true, taskFile: fixture.taskFile, matches: [fixture.taskFile] }),
    }),
    new ConcreteGitReadAdapter({ rootDir: fixture.rootDir, repositoryId: repoId }),
    new ConcreteOperationLogReadAdapter({ historyRepo: history }),
    { metricsAdapter: new ConcreteMetricsReadAdapter({ laneEventRepo: laneEvents, usageRepo: new MemoryUsageRepo(), repositoryId: repoId }) },
  );

  return { laneEvents, history, build: () => builder.build() };
}

async function cardFor(fixture: Fixture) {
  const board = composeBoard(fixture);
  const projection = await board.build();
  const card = projection.stages.flatMap(stage => stage.cards).find(c => c.id === MISSION);
  assert.ok(card, `no board card projected for ${SLUG}`);
  return { projection, card: card! };
}

// ---------------------------------------------------------------------------
// SC1 — a review carrying a Forgejo PR reference projects `PR #N`
// ---------------------------------------------------------------------------

test('task-2343 repro: card projects the Forgejo PR number from the review round', async () => {
  const fixture = makeFixture();
  try {
    const { card } = await cardFor(fixture);
    assert.notEqual(card.pullRequest, null, 'card.pullRequest is null despite a confirmed Forgejo PR');
    assert.equal(card.pullRequest!.kind, 'pull-request');
    assert.equal(card.pullRequest!.provider, 'forgejo');
    assert.equal(card.pullRequest!.id, '4242');
  } finally {
    cleanup(fixture);
  }
});

// ---------------------------------------------------------------------------
// SC2 — the latest checkpoint's Next action line and Goal Check rows
// ---------------------------------------------------------------------------

test('task-2343 repro: card projects the checkpoint Next action line', async () => {
  const fixture = makeFixture();
  try {
    const { card } = await cardFor(fixture);
    assert.equal(
      card.nextActionText,
      'Wire the lifecycle commands through the operation-event recorder.',
    );
  } finally {
    cleanup(fixture);
  }
});

test('task-2343 repro: mission adapter parses the checkpoint Goal Check table', async () => {
  const fixture = makeFixture();
  try {
    const missions = new ConcreteMissionReadAdapter({
      rootDir: fixture.rootDir,
      repositoryId: repositoryId(fixture.rootDir),
      findMissionDir: () => fixture.missionDir,
      resolveWorktree: () => null,
    });
    const mission = await missions.loadMission(MISSION);
    assert.ok(mission, 'mission did not materialize');
    const cp2 = mission!.checkpoints.find(cp => cp.name === 'CP-2');
    assert.ok(cp2, 'CP-2 missing from the materialized mission');
    assert.equal(cp2!.goalCheck.length, 2);
    assert.equal(cp2!.goalCheck[0].criterion, 'Checkpoint parser reads Goal Check rows');
    assert.equal(cp2!.goalCheck[0].evidence, '`src/adapters/backlog/checkpoint-document.ts:36`');
  } finally {
    cleanup(fixture);
  }
});

// ---------------------------------------------------------------------------
// SC3 — gate status derives from the recorded verifier exit code
// ---------------------------------------------------------------------------

test('task-2343 repro: gate status comes from the recorded verifier exit code', async () => {
  const fixture = makeFixture();
  try {
    recordGateResult(fixture.missionDir, { area: 'all', command: './scripts/verify-local.sh all', exitCode: 0 });
    const passed = await cardFor(fixture);
    assert.equal(passed.card.gate, 'passed');

    recordGateResult(fixture.missionDir, { area: 'all', command: './scripts/verify-local.sh all', exitCode: 1 });
    const failed = await cardFor(fixture);
    assert.equal(failed.card.gate, 'failed');
  } finally {
    cleanup(fixture);
  }
});

// ---------------------------------------------------------------------------
// SC4/SC5/SC6 read paths — already correct, pinned so the repairs cannot regress
// ---------------------------------------------------------------------------

test('task-2343 repro: agent availability reflects the recorded usage-limit block', async () => {
  const fixture = makeFixture();
  try {
    const { projection } = await cardFor(fixture);
    const claude = projection.metrics.agentAvailability.find(a => a.family === 'claude');
    assert.ok(claude, 'claude missing from the availability projection');
    assert.equal(claude!.available, false);
    assert.ok((claude!.blockedForMs ?? 0) > 0);
  } finally {
    cleanup(fixture);
  }
});

test('task-2343 repro: cycle-time series is populated from recorded lane events', async () => {
  const fixture = makeFixture();
  try {
    const { projection } = await cardFor(fixture);
    assert.ok(projection.metrics.medianCycleTimeByState.series.length > 0);
  } finally {
    cleanup(fixture);
  }
});

test('task-2343 repro: operation log returns the recorded lifecycle events', async () => {
  const fixture = makeFixture();
  try {
    const { projection } = await cardFor(fixture);
    assert.ok(projection.operationLog.some(entry => entry.phase === 'mission.active'));
  } finally {
    cleanup(fixture);
  }
});
