import { ExecutionActivityRecorder } from '../../../src/application/recording/execution-activity-recorder.js';
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
import { WorkflowOperationService } from '../../../src/application/workflow-operation-service.js';
import { completed } from '../../../src/application/contracts.js';
import { repositoryId } from '../../../src/domain/repository.js';

function bind(database: SqliteDatabaseAdapter) {
  const operations = new SqliteWorkflowOperationStore(database, repositoryId('parallix'));
  const service = new WorkflowOperationService(operations, new SqliteMissionStore(database),
    { canExecute: () => true, async dispatch<T>() { return completed({} as T); } },
    { identity: () => ({ pid: 123, identity: 'fixture-start' }), async launch() {}, async alive() { return true; }, async stop() { return true; } },
    repositoryId('parallix'), async () => 'codex', async () => {}, undefined, undefined, undefined, undefined,
    () => 'revision-fixture');
  return { service, operations };
}
const request = (id: string) => ({ operationId: id, requestKey: id, missionId: 'task-atomic-owner', kind: 'active:execute' as const, capabilities: new Set(['active:execute'] as const) });

export function workflowAdmissionPersistenceCases(): void {
  test('workflow admission rolls activation, lane and initial activity back together on authoritative insert failure (TASK-2750)', async () => {
    const fixture = await openMigratedMissionStore([fixtureMission('task-atomic-owner', { status: 'refined' })]);
    try {
      const { service, operations } = bind(fixture.database);
      operations.insert = async () => { throw new Error('injected authoritative insert failure'); };
      assert.equal((await service.admit(request('failed-admission'))).status, 'failed');
      const loaded = await fixture.store.load('task-atomic-owner' as never);
      assert.equal(loaded.kind === 'found' && loaded.mission.status, 'refined');
      assert.equal((await fixture.laneEvents('task-atomic-owner')).length, 0);
      assert.equal(await operations.get('failed-admission'), null);
    } finally { await fixture.close(); }
  });

  test('independent observation cannot supersede admitted worker activity (TASK-2822)', async () => {
    const fixture = await openMigratedMissionStore([fixtureMission('task-atomic-owner', { status: 'refined' })]);
    try {
      const { service, operations } = bind(fixture.database);
      assert.equal((await service.admit(request('admitted-worker'))).status, 'accepted');
      const publisher = new ExecutionActivityRecorder(operations.activity, { processId: process.pid });
      const intent = { missionId: 'task-atomic-owner' as never, operationId: 'independent-lead', phase: 'recovery' as const, summary: 'investigating' };
      await publisher.running(intent);
      await publisher.blocked(intent, 'independent observation');
      await publisher.ended(intent);
      const snapshots = await operations.activity.loadCurrentWork();
      assert.equal(snapshots.length, 1);
      assert.equal(snapshots[0].operationId, 'admitted-worker');
      assert.equal(snapshots[0].frames.at(-1)?.event.summary, 'preparing workflow');
      assert.equal(snapshots[0].frames.at(-1)?.event.revision, 'revision-fixture');
      assert.equal(snapshots[0].frames.at(-1)?.event.actor, 'parallix');
      assert.equal(snapshots[0].frames.at(-1)?.event.timeState, 'waiting');
      const audit = await fixture.database.query<{ event_data: string }>(
        "SELECT event_data FROM operational_history WHERE event_type = 'mission.current-work' ORDER BY id");
      assert.deepEqual(audit.map(row => (JSON.parse(row.event_data) as { ownerAccepted?: boolean }).ownerAccepted),
        [true, false, false, false], 'audit retains which publications the authoritative activity owner rejected');
    } finally { await fixture.close(); }
  });

  test('activity persistence failure rolls admission and its audit back together (TASK-2822)', async () => {
    const fixture = await openMigratedMissionStore([fixtureMission('task-atomic-owner', { status: 'refined' })]);
    try {
      const { service, operations } = bind(fixture.database);
      operations.activity.publish = async () => { throw new Error('injected activity failure'); };
      assert.equal((await service.admit(request('failed-activity'))).status, 'failed');
      const loaded = await fixture.store.load('task-atomic-owner' as never);
      assert.equal(loaded.kind === 'found' && loaded.mission.status, 'refined');
      assert.equal((await fixture.laneEvents('task-atomic-owner')).length, 0);
      assert.equal(await operations.get('failed-activity'), null);
      assert.equal((await operations.activity.loadCurrentWork()).length, 0);
      assert.equal((await fixture.database.query('SELECT * FROM operational_history')).length, 0);
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
      await bound.operations.replace({ ...operation, phase: 'executing', owner: { pid: 123, identity: 'fixture-start' }, generation: 1 }, 0);
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
