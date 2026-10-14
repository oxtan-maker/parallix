import test from 'node:test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { MissionBriefService } from '../../../src/application/mission-brief-service.js';
import { missionVersion, MissionStaleVersion, type MissionStore } from '../../../src/application/domain-ports.js';
import type { MissionAuthoringFields } from '../../../src/domain/mission-authoring.js';
import { missionLabels } from '../../../src/domain/mission.js';
import { fixtureMission } from '../../fixtures/mission-builders.js';
import { createMissionCommand, createGoalCommand } from '../../../src/interfaces/cli/mission-writes.js';

const fields: MissionAuthoringFields = {
  brief: { goal: 'Goal', why: 'Why', scope: 'Scope', outOfScope: ['Excluded'] },
  criteria: ['first', 'second'], checkpoints: [{ name: 'CP-2', description: 'second slice' }, { name: 'CP-1', description: 'first slice' }],
  gates: ['npm test'], predictedNelBucket: 'Small', classification: 'ai_sdlc',
};
function fixture() {
  let mission = fixtureMission('task-author', { status: 'backlog', checkpoints: [], labels: missionLabels(['bug', 'user_value']), successCriteria: ['first'], completedSuccessCriteria: [0] });
  let version = 1;
  let writes = 0;
  let race = false;
  const store: MissionStore = {
    load: async () => ({ kind: 'found', mission, version: missionVersion(version) }),
    save: async (next, expected) => {
      if (race) { throw new MissionStaleVersion(mission.id, expected!, missionVersion(version + 1)); }
      assert.equal(expected, version); mission = next; writes++; return missionVersion(++version);
    },
  };
  const request = { operationId: 'author', missionId: mission.id, capabilities: new Set(['mission:context'] as const), ...fields };
  const brief = new MissionBriefService(store);
  return { brief, request, current: () => mission, writes: () => writes,
    lock: () => { mission = { ...mission, status: 'active', closedAt: null }; }, race: () => { race = true; } };
}

test('full authoring batch saves once, orders plans and preserves unrelated state (TASK-2731)', async () => {
  const f = fixture(); const before = f.current();
  const result = await f.brief.author(f.request);
  assert.equal(result.status, 'completed'); assert.equal(result.value?.version, 2); assert.equal(f.writes(), 1);
  const next = f.current();
  assert.deepEqual(next.brief, fields.brief); assert.deepEqual(next.successCriteria, fields.criteria);
  assert.deepEqual(next.declaredGates, fields.gates); assert.equal(next.predictedNelBucket, 'Small');
  assert.deepEqual(next.checkpoints.map(c => [c.name, c.firstLine]), [['CP-1', 'first slice'], ['CP-2', 'second slice']]);
  assert.deepEqual(next.labels, ['bug', 'ai_sdlc']); assert.deepEqual(next.completedSuccessCriteria, [0]);
  for (const key of ['id', 'repositoryId', 'title', 'status', 'assignee', 'dependencies', 'review', 'closedAt'] as const) { assert.deepEqual(next[key], before[key]); }
});

test('authoring rejects invalid, unauthorized, locked and stale batches without partial writes (TASK-2731)', async () => {
  const invalid = [
    { brief: { ...fields.brief, goal: '' } }, { brief: { ...fields.brief, scope: null } },
    { criteria: ['duplicate', 'duplicate'] }, { criteria: [] }, { gates: ['npm test', 'npm test'] },
    { checkpoints: [{ name: 'bad', description: 'bad' }] }, { checkpoints: [] },
    { checkpoints: [fields.checkpoints[0]!, fields.checkpoints[0]!] },
    { predictedNelBucket: 'bad' }, { classification: 'bad' },
    { capabilities: new Set() }, { expectedVersion: missionVersion(9) },
  ];
  for (const patch of invalid) {
    const f = fixture(); const before = f.current();
    assert.notEqual((await f.brief.author({ ...f.request, ...patch } as typeof f.request)).status, 'completed');
    assert.deepEqual(f.current(), before); assert.equal(f.writes(), 0);
  }
  for (const mode of ['lock', 'race'] as const) {
    const f = fixture(); f[mode](); const before = f.current();
    const outcome = await f.brief.author(f.request);
    assert.equal(outcome.error?.kind, mode === 'race' ? 'conflict' : 'validation');
    assert.deepEqual(f.current(), before); assert.equal(f.writes(), 0);
  }
});

test('public typed author command dispatches one batch and retains single goal behavior (TASK-2731)', async () => {
  const f = fixture(); const services = { brief: f.brief, resolveSlug: () => 'task-author' } as never;
  const command = createMissionCommand(services, gate => gate === 'bad gate' ? 'invalid gate' : null);
  const args = ['author', '--goal', 'Goal', '--why', 'Why', '--scope', 'Scope', '--out-of-scope', 'Excluded',
    '--criterion', 'first', '--criterion', 'second', '--checkpoint', 'CP-2', '--checkpoint-text', 'second slice',
    '--checkpoint', 'CP-1', '--checkpoint-text', 'first slice', '--gate', 'npm test', '--predicted', 'Small', '--classification', 'ai_sdlc'];
  await command([...args, '--expected-version', '1']); assert.equal(f.writes(), 1);
  await assert.rejects(command([...args, '--expected-version', '1']), /changed since/);
  for (const extra of [['--goal', 'other'], ['--alien', 'x'], ['--gate', 'bad gate'], ['--checkpoint', 'CP-3'], ['--scope']]) {
    await assert.rejects(command([...args, ...extra])); assert.equal(f.writes(), 1);
  }
  await createGoalCommand(services)(['set', '--goal', 'Adjusted', '--why', 'Why']);
  assert.equal(f.current().brief?.goal, 'Adjusted'); assert.equal(f.writes(), 2);
  assert.deepEqual(f.current().successCriteria, fields.criteria);
});


test('authoring and evidence guidance use plain values and keep reference validation (TASK-2731)', () => {
  const draft = fs.readFileSync('prompts/draft-core.md', 'utf8');
  const command = draft.split('\n').find(line => line.startsWith('px mission author --goal'))!;
  assert.ok(command); assert.doesNotMatch(command, /[`"]/);
  assert.match(command, /--criterion 'hello.sh prints Hello, World! and exits successfully'/);
  const execute = fs.readFileSync('prompts/execute-core.md', 'utf8');
  const example = execute.split('Example: px checkpoint record')[1]!.split('\n')[0]!;
  assert.doesNotMatch(example, /[`"]/);
  assert.match(example, /test\/unit\/example.test.ts/);
  assert.match(execute, /recording refuses a row that cites none/);
});
