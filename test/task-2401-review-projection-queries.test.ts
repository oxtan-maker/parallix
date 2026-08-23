import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { SqliteReviewProjectionReader } from '../src/adapters/sqlite/review-projection-reader.js';
import { ConcreteReviewReadAdapter } from '../src/adapters/backlog/concrete-review-read-adapter.js';
import { BoardProjectionBuilder } from '../src/application/projections/board-readers.js';
import { agentFamily } from '../src/domain/agents.js';
import { missionLabels } from '../src/domain/mission.js';
import { repositoryId } from '../src/domain/repository.js';
import { SqliteDatabaseAdapter } from '../src/adapters/sqlite/database-adapter.js';
import { SqliteMigrationRunner, loadDefaultMigrations } from '../src/adapters/sqlite/migration-runner.js';
import { missionId, type MissionId } from '../src/domain/mission.js';

function countingDatabase() {
  const calls: string[] = [];
  return {
    calls,
    async query<T>(sql: string, ids: readonly MissionId[]): Promise<T[]> {
      calls.push(sql);
      if (!sql.includes('mission_review_rounds')) { return []; }
      return ids.map((id, position) => ({
        mission_id: id,
        position,
        round_number: 1,
        change_kind: 'local-branch',
        provider: null,
        provider_change_id: null,
        provider_url: null,
        source_branch: `mission/${id}`,
        target_branch: 'main',
        revision: `revision-${id}`,
        reviewer: 'codex',
        implementer: 'custom',
        started_at: '2026-08-23T08:00:00.000Z',
        decision_kind: 'approved',
        decided_at: '2026-08-23T08:10:00.000Z',
        decision_comment: null,
        approval_source_kind: 'local',
        approval_source_provider: null,
        responded_at: null,
        resulting_revision: null,
        phase: 'approved',
        disposition: 'APPROVED',
        reviewer_retry_count: 0,
        implementer_retry_count: 0,
        implementer_response_content: null,
        item_dispositions: null,
        blocked_reason: null,
      })) as T[];
    },
  };
}

test('SQLite review projection uses four queries for one or many missions', async () => {
  for (const ids of [
    [missionId('task-2401-one')],
    [missionId('task-2401-a'), missionId('task-2401-b'), missionId('task-2401-c')],
  ]) {
    const database = countingDatabase();
    const facts = await new SqliteReviewProjectionReader(database).loadReviews(ids);
    assert.equal(database.calls.length, 4);
    assert.equal(facts.size, ids.length);
    assert.ok([...facts.values()].every(({ review, approval }) => review?.rounds.length === 1 && approval !== null));
  }
});

test('SQLite review projection SQL executes against the migrated schema', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2401-review-projection-'));
  try {
    const database = new SqliteDatabaseAdapter();
    await database.open({ path: path.join(dir, 'operator.db') });
    await new SqliteMigrationRunner(database).applyPending(loadDefaultMigrations());
    const facts = await new SqliteReviewProjectionReader(database).loadReviews([missionId('task-2401-schema')]);
    assert.equal(facts.size, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('SQLite review projection chunks mission sets beyond the bind-safe batch', async () => {
  const ids = Array.from({ length: 1000 }, (_, index) => missionId(`task-2401-${index}`));
  const database = countingDatabase();
  const facts = await new SqliteReviewProjectionReader(database).loadReviews(ids);
  assert.equal(facts.size, ids.length);
  assert.equal(database.calls.length, 8);
});

test('SQLite-backed board review projection never loads Mission aggregates', async () => {
  const database = countingDatabase();
  let aggregateLoads = 0;
  const adapter = new ConcreteReviewReadAdapter({
    rootDir: process.cwd(),
    missionStore: {
      async load() { aggregateLoads += 1; throw new Error('aggregate load is forbidden'); },
      async save() { throw new Error('not used'); },
    },
    projectionReader: new SqliteReviewProjectionReader(database),
  });

  const id = missionId('task-2401-board');
  const builder = new BoardProjectionBuilder(
    { async loadAllMissions() { return [{ id, repositoryId: repositoryId('repo'), title: 'board', labels: missionLabels([]), status: 'review' as const, closedAt: null, assignee: agentFamily('codex'), checkpoints: [], review: null, netEngineeringLines: null }]; }, async loadMission() { return null; }, getSourceFacts() { return []; } },
    adapter,
    { async loadGateStatus() { return 'passed' as const; } },
    { async loadAgentAvailability() { return []; }, async loadAssignedAgent() { return null; } },
    { async loadRepositoryId() { return repositoryId('repo'); }, async loadHeadCommit() { return 'head'; } },
    { async loadOperationLog() { return []; } },
  );
  const projection = await builder.build();
  assert.equal(aggregateLoads, 0);
  assert.equal(database.calls.length, 4);
  assert.equal(projection.stages.flatMap((stage) => stage.cards).find((card) => card.id === id)?.reviewRound, 1);
});
