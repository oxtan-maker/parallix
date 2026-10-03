// TASK-2343: regression assertions routed to their owning write/read contract.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ConcreteOperationLogReadAdapter } from '../src/adapters/backlog/concrete-operation-log-read-adapter.js';
import { OperationEventRecorder, operationEventToEntry, operationEventType } from '../src/application/recording/operation-event-recorder.js';
import { missionId } from '../src/domain/mission.js';
import { repositoryId } from '../src/domain/repository.js';
import { type OperationalHistoryEntry, type OperationalHistoryRepository } from '../src/application/ports/operation-history.js';

const MISSION = missionId('task-2343');

class MemoryHistoryRepo implements OperationalHistoryRepository {
  readonly entries: OperationalHistoryEntry[] = [];
  async findAll() { return this.entries as readonly OperationalHistoryEntry[]; }
  async findByType(type: string) { return this.entries.filter(e => e.eventType === type); }
  async append(entry: OperationalHistoryEntry) { this.entries.push({ id: this.entries.length + 1, ...entry }); }
  async clear() { this.entries.length = 0; }
}

// ---------------------------------------------------------------------------
// SC6 — lifecycle operations reach operational_history and come back out
// ---------------------------------------------------------------------------

test('operationEventToEntry maps a lifecycle operation onto the operational_history shape', () => {
  const entry = operationEventToEntry({
    missionId: MISSION,
    repositoryId: repositoryId('parallix'),
    trigger: 'submit-for-review',
    toStatus: 'review',
    agent: 'codex',
    occurredAt: '2026-08-01T09:00:00.000Z',
  });

  assert.equal(entry.eventType, 'mission.submit-for-review');
  assert.equal(entry.createdAt, '2026-08-01T09:00:00.000Z');
  const data = JSON.parse(entry.eventData);
  assert.equal(data.missionId, 'task-2343');
  assert.equal(data.agent, 'codex');
  assert.match(data.message, /review/);
});

test('operationEventType namespaces every lifecycle trigger under mission.', () => {
  assert.equal(operationEventType('activate'), 'mission.activate');
  assert.equal(operationEventType('integrate'), 'mission.integrate');
});

test('recorded lifecycle events reach operational_history and the operation-log adapter', async () => {
  const history = new MemoryHistoryRepo();
  const recorder = new OperationEventRecorder(history);

  await recorder.append({
    missionId: MISSION, repositoryId: repositoryId('parallix'), trigger: 'activate', toStatus: 'active',
    agent: 'codex', occurredAt: '2026-07-31T09:00:00.000Z',
  });
  await recorder.append({
    missionId: MISSION, repositoryId: repositoryId('parallix'), trigger: 'submit-for-review', toStatus: 'review',
    agent: 'codex', occurredAt: '2026-08-01T09:00:00.000Z',
  });

  const adapter = new ConcreteOperationLogReadAdapter({ historyRepo: history });
  const log = await adapter.loadOperationLog();

  assert.equal(log.length, 2);
  assert.deepEqual(log.map(e => e.phase), ['mission.activate', 'mission.submit-for-review']);
  assert.equal(log[0].agent, 'codex');
  assert.equal(log[1].timestamp, '2026-08-01T09:00:00.000Z');
});

test('a lifecycle operation that changes no lane still records its own entry', async () => {
  const history = new MemoryHistoryRepo();
  await new OperationEventRecorder(history).append({
    missionId: MISSION, repositoryId: repositoryId('parallix'), trigger: 'checkpoint' as never, toStatus: 'CP-3',
    agent: 'codex', occurredAt: '2026-08-02T09:00:00.000Z',
  });

  const recorded = await history.findByType('mission.checkpoint');
  assert.equal(recorded.length, 1);
  assert.match(JSON.parse(recorded[0].eventData).message, /CP-3/);
});
