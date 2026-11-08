import test from 'node:test';
import assert from 'node:assert/strict';
import { missionVersion, type MissionStore } from '../../../src/application/domain-ports.js';
import { MissionWaveService } from '../../../src/application/mission-wave-service.js';
import { decideMission, type MissionCommand } from '../../../src/domain/mission-workflow.js';
import { agentFamily } from '../../../src/domain/agents.js';
import { approveLargeMissionRiskException, convertMissionToWave, type MissionWaveChildContract } from '../../../src/domain/mission-wave.js';
import { missionLabels, missionId, type Mission } from '../../../src/domain/mission.js';
import { fixtureMission } from '../../fixtures/mission-builders.js';

const child = (title: string, dependsOn: readonly number[] = []): MissionWaveChildContract => ({
  title, dependsOn,
  brief: { goal: `Deliver ${title}`, why: 'Keep the wave independently useful', scope: `${title}.ts`, outOfScope: ['Other children'] },
  criteria: [`${title} is delivered`],
  checkpoints: [{ name: 'CP-1', description: `Implement ${title}` }],
  gates: ['npm test'], predictedNelBucket: 'Medium', classification: 'ai_sdlc',
});

function parent(overrides: Partial<Mission> = {}): Mission {
  return fixtureMission('task-3000', {
    status: 'backlog', checkpoints: [], labels: missionLabels(['ai_sdlc']), predictedNelBucket: 'Large',
    ...overrides,
  });
}

test('conversion creates deterministic complete children and preserves dependency-free roots (PX-0030)', () => {
  const wave = convertMissionToWave(parent(), [child('foundation'), child('consumer', [1])]);
  assert.deepEqual(wave.parent.wave?.children, ['task-3000.01', 'task-3000.02']);
  assert.deepEqual(wave.children.map(mission => mission.id), ['task-3000.01', 'task-3000.02']);
  assert.deepEqual(wave.children.map(mission => mission.dependencies), [[], ['task-3000.01']]);
  for (const mission of wave.children) {
    assert.equal(mission.waveParentId, 'task-3000');
    assert.ok(mission.brief?.scope); assert.ok(mission.successCriteria?.length);
    assert.ok(mission.checkpoints.length); assert.ok(mission.declaredGates?.length);
    assert.equal(mission.predictedNelBucket, 'Medium'); assert.deepEqual(mission.labels, ['ai_sdlc']);
  }
});

test('conversion rejects invalid child contracts, cycles, unsupported parents, and existing exceptions (PX-0030)', () => {
  assert.throws(() => convertMissionToWave(parent(), [child('only')]), /between 2 and 99/);
  assert.throws(() => convertMissionToWave(parent(), [child('a', [2]), child('b', [1])]), /acyclic/);
  assert.throws(() => convertMissionToWave(parent(), [child('a'), { ...child('b'), predictedNelBucket: 'Large' }]), /child 2.*Small or Medium.*split it again/i);
  assert.throws(() => convertMissionToWave(parent(), [child('a'), { ...child('b'), gates: [] }]), /requires scope, criteria/);
  assert.throws(() => convertMissionToWave(parent({ status: 'refined' }), [child('a'), child('b')]), /while it is refined/);
  assert.throws(() => convertMissionToWave(parent({ id: 'adhoc-wave' as Mission['id'] }), [child('a'), child('b')]), /task-NNNN or px-NNNN/);
  assert.throws(() => convertMissionToWave(parent({ largeMissionRiskException: {
    rationale: 'safer together', approvedBy: 'operator', approvedAt: '2026-11-04T10:00:00.000Z',
  } }), [child('a'), child('b')]), /already has an approved/);
});

function serviceFixture(options: { collision?: boolean; fail?: boolean } = {}) {
  let current = parent();
  let writes = 0;
  const store: MissionStore = {
    async load(id) {
      if (id === current.id) { return { kind: 'found', mission: current, version: missionVersion(1) }; }
      if (options.collision && id === 'task-3000.02') {
        return { kind: 'found', mission: fixtureMission('task-3000.02'), version: missionVersion(1) };
      }
      return { kind: 'missing' };
    },
    async save() { throw new Error('unexpected save'); },
    async saveWave(next, _version, children) {
      if (options.fail) { throw new Error('simulated persistence failure'); }
      current = next; writes++; return { parentVersion: missionVersion(2), childVersions: children.map(() => missionVersion(1)) };
    },
  };
  return { service: new MissionWaveService(store), current: () => current, writes: () => writes };
}

test('application conversion is one atomic store call and collision or persistence failure changes nothing (PX-0030)', async () => {
  for (const mode of ['collision', 'fail'] as const) {
    const fixture = serviceFixture({ [mode]: true });
    const before = fixture.current();
    const result = await fixture.service.convert({
      operationId: 'wave', missionId: before.id, capabilities: new Set(['mission:context']),
      children: [child('a'), child('b', [1])],
    });
    assert.notEqual(result.status, 'completed');
    assert.equal(result.error?.kind, mode === 'collision' ? 'conflict' : 'execution');
    assert.deepEqual(fixture.current(), before); assert.equal(fixture.writes(), 0);
  }
  const fixture = serviceFixture();
  const result = await fixture.service.convert({ operationId: 'wave', missionId: fixture.current().id,
    capabilities: new Set(['mission:context']), children: [child('a'), child('b')] });
  assert.equal(result.status, 'completed'); assert.equal(fixture.writes(), 1);
});

test('Large draft readiness fails closed without a wave or operator exception and parents never execute (PX-0030)', () => {
  const complete = parent({
    checkpoints: fixtureMission('task-3000').checkpoints,
    brief: { goal: 'Large goal', why: 'Needed', scope: 'Repository', outOfScope: [] },
    successCriteria: ['Delivered'], declaredGates: ['npm test'],
  });
  assert.throws(() => decideMission(complete, { type: 'refine' }), /operator-approved Large-mission risk exception/);
  const approved = approveLargeMissionRiskException(complete, {
    rationale: 'Splitting would duplicate a single atomic schema transition', approvedBy: 'operator', approvedAt: '2026-11-04T10:00:00+01:00',
  });
  assert.equal(decideMission(approved, { type: 'refine' }).status, 'refined');
  const wave = convertMissionToWave(complete, [child('a'), child('b')]);
  assert.throws(() => decideMission(wave.parent, { type: 'refine' }), /non-executable/);
});

// PX-0045: the dotted identity a `px-NNNN` parent mints is a Mission identity
// in its own right, so it must pass the domain id validator unchanged. It never
// becomes a wave parent, which keeps the dotted grammar one level deep, and the
// parent wave stays non-executable.
test('a px wave parent mints dotted child identities one level deep with a non-executable parent (PX-0045)', () => {
  const pxParent = parent({ id: 'px-0041' as Mission['id'] });
  const wave = convertMissionToWave(pxParent, [child('a'), child('b', [1])]);

  assert.deepEqual(wave.parent.wave?.children, ['px-0041.01', 'px-0041.02']);
  assert.deepEqual(wave.children.map(mission => mission.id), ['px-0041.01', 'px-0041.02']);
  for (const mission of wave.children) {
    assert.equal(missionId(mission.id), mission.id, 'the dotted child id is a valid Mission identity');
    assert.equal(mission.waveParentId, 'px-0041');
  }
  const nonExecutableCommands: readonly MissionCommand[] = [
    { type: 'refine' },
    { type: 'activate', agent: agentFamily('claude') },
  ];
  for (const command of nonExecutableCommands) {
    assert.throws(() => decideMission(wave.parent, command), /non-executable/, command.type);
  }
  assert.throws(() => convertMissionToWave(wave.children[0], [child('x'), child('y')]), /task-NNNN or px-NNNN/,
    'a wave child is never a wave parent');
});
