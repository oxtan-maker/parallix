import { configureMissionWriteAuthorization } from '../../../src/application/ports/mission-write-authorization.js';
import { requireWorkflowOwner } from '../../../src/domain/workflow-operation.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { openMigratedMissionStore } from '../../fixtures/mission-sqlite-store.js';
import { fixtureMission } from '../../fixtures/mission-builders.js';
import { SqliteWorkflowOperationStore } from '../../../src/adapters/sqlite/workflow-operation-store.js';
import { SqliteDatabaseAdapter } from '../../../src/adapters/sqlite/database-adapter.js';
import { SqliteMissionStore } from '../../../src/adapters/sqlite/mission-store.js';
import { SqliteOperationalHistoryRepository } from '../../../src/adapters/sqlite/operational-history-repository.js';
import { CurrentWorkRecorder, type CurrentWorkPort } from '../../../src/application/recording/current-work-recorder.js';
import { WorkflowOperationService } from '../../../src/application/workflow-operation-service.js';
import { completed } from '../../../src/application/contracts.js';
import { repositoryId } from '../../../src/domain/repository.js';

function bind(database: SqliteDatabaseAdapter, work?: CurrentWorkPort) {
  const operations = new SqliteWorkflowOperationStore(database, repositoryId('parallix'));
  const service = new WorkflowOperationService(operations, new SqliteMissionStore(database),
    { canExecute: () => true, async dispatch<T>() { return completed({} as T); } },
    { identity: () => ({ pid: 123, identity: 'fixture-start' }), async launch() {}, async alive() { return true; }, async stop() { return true; } },
    work ?? new CurrentWorkRecorder(new SqliteOperationalHistoryRepository(database), { processId: 123 }),
    repositoryId('parallix'), async () => 'codex', async () => {});
  return { service, operations };
}
const request = (id: string) => ({ operationId: id, requestKey: id, missionId: 'task-atomic-owner', kind: 'active:execute' as const, capabilities: new Set(['active:execute'] as const) });

export function workflowAdmissionPersistenceCases(): void {
  test('workflow admission rolls activation, lane and preparing back together on publication failure (TASK-2750)', async () => {
    const fixture = await openMigratedMissionStore([fixtureMission('task-atomic-owner', { status: 'refined' })]);
    try {
      const { service, operations } = bind(fixture.database, {
        async running() { throw new Error('injected durable publication failure'); }, async ended() {}, async blocked() {},
      });
      assert.equal((await service.admit(request('failed-admission'))).status, 'failed');
      const loaded = await fixture.store.load('task-atomic-owner' as never);
      assert.equal(loaded.kind === 'found' && loaded.mission.status, 'refined');
      assert.equal((await fixture.laneEvents('task-atomic-owner')).length, 0);
      assert.equal(await operations.get('failed-admission'), null);
    } finally { await fixture.close(); }
  });

  test('separate SQLite connections share deduplication and exclusion, then rediscover committed intent (TASK-2750)', async () => {
    const fixture = await openMigratedMissionStore([fixtureMission('task-atomic-owner', { status: 'refined' })]);
    const other = new SqliteDatabaseAdapter();
    try {
      await other.open({ path: path.join(fixture.root, 'parallix.db'), busyTimeoutMs: 0 });
      const a = bind(fixture.database); const b = bind(other);
      const outcomes = await Promise.all([a.service.admit(request('first')), b.service.admit(request('second'))]);
      assert.deepEqual(outcomes.map(value => value.status).sort(), ['accepted', 'failed']);
      const winner = outcomes.find(outcome => outcome.status === 'accepted')!;
      assert.equal(winner.status, 'accepted');
      if (winner.status !== 'accepted') { throw new Error('No admission winner'); }
      const duplicate = await b.service.admit(request(winner.operation.id));
      assert.equal(duplicate.status, 'accepted');
      assert.equal((await fixture.laneEvents('task-atomic-owner')).length, 1);
      const rehydrated = await b.service.operation(winner.operation.id);
      assert.equal(rehydrated?.phase, 'accepted'); assert.equal(rehydrated?.owner, null);
      await Promise.all([a.service.run(winner.operation.id), b.service.run(winner.operation.id)]);
      assert.equal((await b.service.operation(winner.operation.id))?.generation, 1);
      assert.equal((await b.service.operation(winner.operation.id))?.phase, 'completed');
      assert.equal((await fixture.laneEvents('task-atomic-owner')).length, 1);
    } finally { await other.close(); await fixture.close(); }
  });

  test('operation reads stay available while a separate connection owns a writer (TASK-2750 F5)', async () => {
    const fixture = await openMigratedMissionStore([fixtureMission('task-atomic-owner', { status: 'refined' })]);
    const writer = new SqliteDatabaseAdapter();
    try {
      const bound = bind(fixture.database);
      await bound.service.admit(request('read-during-write'));
      await writer.open({ path: path.join(fixture.root, 'parallix.db'), busyTimeoutMs: 0 });
      await writer.beginImmediateTransaction();
      try {
        assert.equal((await bound.service.operation('read-during-write'))?.phase, 'accepted');
        assert.equal((await bound.service.current('task-atomic-owner'))?.id, 'read-during-write');
      } finally { await writer.rollbackTransaction(); }
    } finally { await writer.close(); await fixture.close(); }
  });


  test('guarded Mission persistence excludes concurrent stop then rejects the stopped owner (TASK-2750 F10)', async () => {
    const fixture = await openMigratedMissionStore([fixtureMission('task-atomic-owner', { status: 'refined' })]);
    const other = new SqliteDatabaseAdapter();
    try {
      const bound = bind(fixture.database);
      await bound.service.admit(request('write-fence'));
      const operation = (await bound.service.operation('write-fence'))!;
      await bound.operations.replace({ ...operation, phase: 'running', generation: 1 }, 0);
      const loaded = await fixture.store.load(operation.missionId);
      assert.equal(loaded.kind, 'found'); if (loaded.kind !== 'found') { throw new Error('fixture missing'); }
      await other.open({ path: path.join(fixture.root, 'parallix.db'), busyTimeoutMs: 0 });
      configureMissionWriteAuthorization({ operationId: operation.id, assert: async (_mission, read) => {
        assert.ok(read, 'the write must supply its own transaction reader');
        const owner = await read(operation.id);
        assert.ok(owner);
        await assert.rejects(() => other.beginImmediateTransaction(), /BUSY|locked/i);
        requireWorkflowOwner(owner, 1);
      } });
      const version = await fixture.store.save({ ...loaded.mission, title: 'guarded mutation' }, loaded.version);
      const stopped = { ...operation, phase: 'stopped', generation: 2 };
      await other.execute('UPDATE workflow_operations SET generation = 2, phase = ?, record_json = ? WHERE id = ?', ['stopped', JSON.stringify(stopped), operation.id]);
      configureMissionWriteAuthorization({ operationId: operation.id, assert: async (_mission, read) => {
        assert.ok(read); const owner = await read(operation.id); assert.ok(owner); requireWorkflowOwner(owner, 1);
      } });
      await assert.rejects(() => fixture.store.save({ ...loaded.mission, title: 'stale mutation' }, version), /fenced|stopped/i);
      const after = await fixture.store.load(operation.missionId);
      assert.equal(after.kind === 'found' && after.mission.title, 'guarded mutation');
    } finally { configureMissionWriteAuthorization(null); await other.close(); await fixture.close(); }
  });

}
