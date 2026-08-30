import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { recoverMissionLifecycle } from '../src/application/mission-lifecycle-recovery.js';
import { missionId } from '../src/domain/mission.js';
import { SqliteDatabaseAdapter } from '../src/adapters/sqlite/database-adapter.js';
import { SqliteMigrationRunner, loadDefaultMigrations } from '../src/adapters/sqlite/migration-runner.js';
import { SqliteMissionStore } from '../src/adapters/sqlite/mission-store.js';

test('TASK-2438-shaped active task and closed aggregate reports supported recovery and resumes active', async () => {
  const events: Array<{ from: string | null; to: string; trigger: string }> = [];
  let mission = {
    id: missionId('task-2438'), repositoryId: 'repo' as never, title: 'Fixture', labels: [], assignee: null,
    checkpoints: [], review: null, netEngineeringLines: null, status: 'done' as const, closedAt: '2026-08-30T12:00:00.000Z',
  };
  const result = await recoverMissionLifecycle({
    missionId: mission.id,
    taskStatus: 'active',
    actor: 'codex',
    occurredAt: '2026-08-30T12:01:00.000Z',
    store: {
      async load() { return { kind: 'found' as const, mission, version: 18 as never }; },
      async save() { throw new Error('recovery must keep a lane event'); },
      async saveWithTransition(next: typeof mission, _version: never, event: typeof events[number]) {
        mission = next;
        events.push(event);
        return 19 as never;
      },
      async findTransitions() { return []; },
    },
  });

  assert.equal(result.value?.taskStatus, 'active');
  assert.equal(result.value?.aggregateStatus, 'done');
  assert.equal(result.value?.action, 'recover-to-active');
  assert.equal(result.value?.recovered?.status, 'active');
  assert.deepEqual(events.map(({ from, to, trigger }) => ({ from, to, trigger })), [{ from: 'done', to: 'active', trigger: 'recover-active' }]);
});

test('integrated mission recovery is refused without changing its aggregate or history', async () => {
  const mission = {
    id: missionId('task-integrated'), repositoryId: 'repo' as never, title: 'Fixture', labels: [], assignee: null,
    checkpoints: [], review: null, netEngineeringLines: null, status: 'done' as const, closedAt: '2026-08-30T12:00:00.000Z',
  };
  const result = await recoverMissionLifecycle({
    missionId: mission.id, taskStatus: 'active', actor: 'codex', occurredAt: '2026-08-30T12:01:00.000Z',
    store: {
      async load() { return { kind: 'found' as const, mission, version: 18 as never }; },
      async save() { throw new Error('must not save'); },
      async saveWithTransition() { throw new Error('must not save'); },
      async findTransitions() { return [{ trigger: 'integrate' } as never]; },
    },
  });
  assert.equal(result.value?.action, 'refused-integrated');
  assert.equal(result.value?.recovered, null);
});

test('recovery reports a stale lifecycle write as a conflict', async () => {
  const mission = {
    id: missionId('task-stale'), repositoryId: 'repo' as never, title: 'Fixture', labels: [], assignee: null,
    checkpoints: [], review: null, netEngineeringLines: null, status: 'done' as const, closedAt: '2026-08-30T12:00:00.000Z',
  };
  const result = await recoverMissionLifecycle({
    missionId: mission.id, taskStatus: 'active', actor: 'codex', occurredAt: '2026-08-30T12:01:00.000Z',
    store: {
      async load() { return { kind: 'found' as const, mission, version: 18 as never }; },
      async save() { throw new Error('must not save'); },
      async saveWithTransition() { throw Object.assign(new Error('concurrent lifecycle write; re-run px recover task-stale'), { disposition: 'stale-write' }); },
      async findTransitions() { return []; },
    },
  });
  assert.equal(result.status, 'failed');
  assert.equal(result.error?.kind, 'conflict');
});

test('TASK-2438 durable fixture persists recovery and its lane-history record', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2446-'));
  const database = new SqliteDatabaseAdapter();
  try {
    await database.open({ path: path.join(dir, 'operator.db') });
    await new SqliteMigrationRunner(database).applyPending(loadDefaultMigrations());
    const store = new SqliteMissionStore(database);
    const id = missionId('task-2438');
    await store.save({
      id, repositoryId: 'repo' as never, title: 'TASK-2438 fixture', labels: [], assignee: null,
      checkpoints: [], review: null, netEngineeringLines: null, status: 'done', closedAt: '2026-08-30T12:00:00.000Z',
    }, null);
    const result = await recoverMissionLifecycle({
      missionId: id, taskStatus: 'active', actor: 'operator', occurredAt: '2026-08-30T12:01:00.000Z', store,
    });
    assert.equal(result.value?.action, 'recover-to-active');
    const recovered = await store.load(id);
    assert.equal(recovered.kind, 'found');
    if (recovered.kind === 'found') { assert.equal(recovered.mission.status, 'active'); }
    assert.deepEqual((await store.findTransitions(id)).map(({ fromStatus, toStatus, trigger }) => ({ fromStatus, toStatus, trigger })), [
      { fromStatus: 'done', toStatus: 'active', trigger: 'recover-active' },
    ]);
  } finally {
    await database.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
