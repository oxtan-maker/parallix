import test from 'node:test';
import assert from 'node:assert/strict';
import { MissionEditService } from '../../../src/application/mission-edit-service.js';
import { missionVersion, type MissionStore } from '../../../src/application/domain-ports.js';
import { missionId, missionLabels, intakeMission, type Mission } from '../../../src/domain/mission.js';
import { repositoryId } from '../../../src/domain/repository.js';
import { missionBrief } from '../../../src/domain/mission-brief.js';

function fixture(id = 'supplied-mission-1') {
  let mission: Mission = { ...intakeMission({ id: missionId(id), repositoryId: repositoryId('repo'), title: 'Before', labels: missionLabels(['bug']), assignee: null }),
    brief: missionBrief({ goal: 'Description', why: 'Context', scope: 'Scope', outOfScope: ['Excluded'] }),
    successCriteria: ['keep', 'remove'], completedSuccessCriteria: [0], dependencies: [missionId('dependency-1')] };
  let version = 1;
  let writes = 0;
  const store: MissionStore = { load: async id => id === mission.id ? { kind: 'found', mission, version: missionVersion(version) }
    : id === 'dependency-1' ? { kind: 'found', mission: { ...mission, id: missionId('dependency-1') }, version: missionVersion(1) } : { kind: 'missing' },
    save: async (next, expected) => { assert.equal(expected, version); mission = next; writes++; return missionVersion(++version); } };
  const service = new MissionEditService(store);
  const request = { operationId: 'edit', missionId: mission.id, capabilities: new Set(['mission:context'] as const), expectedVersion: missionVersion(1),
    title: 'After', description: 'New description', context: 'New context', labels: ['user_value'], successCriteria: ['keep'], dependencies: [] };
  return { service, request, current: () => mission, writes: () => writes, set: (m: Mission) => { mission = m; } };
}

test('mission editing replaces every planning field atomically and preserves identity and lifecycle (TASK-2702)', async () => {
  for (const id of ['supplied-mission-1', 'px-0001', 'parallix-adhoc-0001']) {
    const f = fixture(id); const before = f.current();
    const read = await f.service.read(f.request);
    assert.equal(read.value?.description, 'Description'); assert.equal(read.value?.context, 'Context');
    assert.equal((await f.service.save(f.request)).status, 'completed');
    const next = f.current();
    assert.equal(next.title, 'After'); assert.equal(next.brief?.goal, 'New description'); assert.equal(next.brief?.why, 'New context');
    assert.equal(next.brief?.scope, 'Scope'); assert.deepEqual(next.brief?.outOfScope, ['Excluded']);
    assert.deepEqual(next.labels, ['user_value']); assert.deepEqual(next.successCriteria, ['keep']); assert.deepEqual(next.completedSuccessCriteria, [0]); assert.deepEqual(next.dependencies, []);
    for (const key of ['id', 'repositoryId', 'assignee', 'status', 'checkpoints', 'review', 'netEngineeringLines'] as const) { assert.deepEqual(next[key], before[key]); }
    assert.equal((await f.service.save({ ...f.request, expectedVersion: missionVersion(2), description: '', context: '', labels: [], successCriteria: [] })).status, 'completed');
    assert.equal(f.current().brief, null); assert.equal(f.current().description, null);
    assert.deepEqual(f.current().labels, []); assert.deepEqual(f.current().successCriteria, []);
    const reopened = await f.service.read(f.request);
    assert.equal(reopened.status, 'failed', 'old version cannot read as current');
    assert.equal((await f.service.read({ ...f.request, expectedVersion: undefined })).value?.description, '');
  }
});

test('mission editing refuses invalid fields, dependency and stale or finished saves without writes (TASK-2702)', async () => {
  for (const patch of [{ title: '' }, { dependencies: ['missing'] }, { dependencies: ['supplied-mission-1'] }, { dependencies: ['dependency-1', 'dependency-1'] }, { description: '', context: 'why' }, { expectedVersion: missionVersion(2) }]) {
    const f = fixture(); const before = f.current();
    assert.notEqual((await f.service.save({ ...f.request, ...patch })).status, 'completed');
    assert.equal(f.writes(), 0); assert.deepEqual(f.current(), before);
  }
  const f = fixture(); f.set({ ...f.current(), status: 'done', closedAt: null });
  assert.notEqual((await f.service.save(f.request)).status, 'completed'); assert.equal(f.writes(), 0);
});
