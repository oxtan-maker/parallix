import { pendingReview } from '../../fixtures/mission-builders.js';
import { agentFamily } from '../../../src/domain/agents.js';
import type { Review } from '../../../src/domain/review.js';
import { fixtureMission as typedMissionFixture } from '../../fixtures/mission-builders.js';
// Fresh repair proof (TASK-2665): Goal Check rows remember the review round they were recorded in, and
// an open repair (reviewer-requested changes or an integration bounceback) owes fresh rows for the
// criteria its findings or failed gate name. Owns the record-time half of that contract; handoff's half
// lives in the handoff use-case suite.

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { MissionCheckpointService } from '../../../src/application/mission-checkpoint-service.js';
import { missionVersion, type MissionStore } from '../../../src/application/domain-ports.js';
import { missionId, type Mission } from '../../../src/domain/mission.js';
import { repositoryId } from '../../../src/domain/repository.js';
import { reviewFindingId } from '../../../src/domain/review.js';

describe('Checkpoint repair freshness', () => {
  // Rows remember the review round they were recorded in; repair rounds owe fresh rows.
  function repairFixture(kind: 'finding-F4' | 'finding-F4-criterion-1' | 'classifier-criterion-1' | 'bounceback' | 'bounceback-gate', priorRound?: number) {
    const successCriteria = ['first', 'second'];
    const base = { ...pendingReview('task-2662').rounds[0], implementer: agentFamily('custom'), startedAt: '2026-01-01T00:00:00Z' };
    const requested = (id: string, summary = 'repair'): Review['rounds'][number] => ({
      ...base, number: 1, phase: 'fixing', response: null,
      decision: { kind: 'changes-requested', decidedAt: '2026-01-01T01:00:00Z', comment: null, findings: [
        { id: reviewFindingId(id), summary, location: null },
      ] },
    });
    const rounds: Review['rounds'] = kind.startsWith('bounceback')
      ? [
        { ...base, number: 1, phase: 'approved', response: null, decision: {
          kind: 'approved', decidedAt: '2026-01-01T01:00:00Z', comment: null, source: { kind: 'local' },
          revocation: { revokedAt: '2026-01-01T02:00:00Z', revokedBy: 'px', reason: 'gate', cause: { kind: 'integration-gate-failure', gate: kind === 'bounceback-gate' ? 'unit-first' : 'g' } },
        } },
        { ...base, number: 2, phase: 'reviewing', response: null, decision: null },
      ]
      : [kind === 'finding-F4-criterion-1' ? requested('F4', 'Success criterion 1 has no fix evidence') : requested(kind === 'finding-F4' ? 'F4' : 'success-criterion-1')];
    const rowOf = (criterion: string, evidence: string) => ({ criterion, evidence, recordedRound: priorRound });
    let mission = typedMissionFixture(String(missionId('task-2662')), { repositoryId: repositoryId('repo'), status: 'active',
      successCriteria, completedSuccessCriteria: [0, 1],
      checkpoints: [{ missionId: missionId('task-2662'), name: 'CP-1', firstLine: 'cp', nextActionText: 'review', goalCheck: [
        rowOf('first', '`test/unit/example.test.ts` via unit-first'), rowOf('second', 'test/unit/example.test.ts'),
      ] }],
      review: { rounds, intervention: null, stageLaunches: [], reviewEvents: [] }});
    let saves = 0;
    const store: MissionStore = {
      load: async () => ({ kind: 'found', mission, version: missionVersion(1) }),
      save: async (next) => { mission = next; saves += 1; return missionVersion(2); },
    };
    const existing = new Set(['/repo/test/unit/example.test.ts']);
    const service = new MissionCheckpointService(store, {
      fileSystem: { existsSync: (target) => existing.has(target), readText: () => '', listEntries: () => [], listNames: () => [] },
      rootFor: () => '/repo',
    });
    const record = (name: string, rows: readonly { readonly criterion: string; readonly evidence: string }[]) => service.record({
      operationId: 'op', missionId: missionId('task-2662'), capabilities: new Set(['checkpoint:record']), expectedVersion: missionVersion(1),
      checkpoint: { missionId: missionId('task-2662'), name, nextActionText: 'continue', goalCheck: rows },
    });
    return { record, saves: () => saves, current: () => mission };
  }
  const ref = '`test/unit/example.test.ts`';

  test('record refuses a repair that omits fresh evidence for a criterion a finding names (TASK-2665)', async () => {
    const { record, saves, current } = repairFixture('classifier-criterion-1', 0);
    const stale = await record('CP-2', [{ criterion: 'second', evidence: ref }]);
    assert.equal(stale.status, 'failed');
    assert.match(stale.error?.message ?? '', /needs fresh fix evidence recorded in this review round for first/);
    assert.match(stale.error?.message ?? '', /px checkpoint record --name CP-2/);
    assert.equal(saves(), 0, 'a refused repair writes nothing');
    assert.equal((await record('CP-2', [{ criterion: 'first', evidence: ref }])).status, 'completed');
    assert.deepEqual(current().checkpoints.find((cp) => cp.name === 'CP-2')!.goalCheck.map((row) => row.recordedRound), [1]);
  });

  test('record refuses a fresh row for the wrong criterion when an F-id finding names another (TASK-2665)', async () => {
    const { record, saves } = repairFixture('finding-F4-criterion-1', 0);
    const wrong = await record('CP-2', [{ criterion: 'second', evidence: ref }]);
    assert.equal(wrong.status, 'failed');
    assert.match(wrong.error?.message ?? '', /fresh fix evidence recorded in this review round for first/);
    assert.equal(saves(), 0);
    assert.equal((await record('CP-2', [{ criterion: 'first', evidence: ref }])).status, 'completed');
  });

  test('record accepts a partial repair on ordinary F-id findings and keeps unrelated proof (TASK-2665)', async () => {
    const { record, current } = repairFixture('finding-F4', 0);
    assert.equal((await record('CP-1', [{ criterion: 'first', evidence: ref }])).status, 'completed');
    const rows = current().checkpoints.find((cp) => cp.name === 'CP-1')!.goalCheck;
    assert.deepEqual(rows.map((row) => [row.criterion, row.recordedRound]), [['first', 1], ['second', 0]]);
  });

  test('record refuses a bounceback repair that is fresh only for a criterion the failed gate does not touch (TASK-2665)', async () => {
    // The failed gate unit-first is cited by criterion first's proof, so that
    // criterion is affected; fresh proof for second alone does not repair it.
    const { record, saves } = repairFixture('bounceback-gate');
    const wrong = await record('CP-2', [{ criterion: 'second', evidence: ref }]);
    assert.equal(wrong.status, 'failed');
    assert.match(wrong.error?.message ?? '', /fresh fix evidence recorded in this review round for first/);
    assert.equal(saves(), 0);
    assert.equal((await record('CP-2', [{ criterion: 'first', evidence: ref }])).status, 'completed');
  });

  test('record accepts a bounceback repair and stamps it with the pending round (TASK-2665)', async () => {
    const { record, current } = repairFixture('bounceback');
    assert.equal((await record('CP-1', [{ criterion: 'second', evidence: ref }])).status, 'completed');
    const rows = current().checkpoints.find((cp) => cp.name === 'CP-1')!.goalCheck;
    assert.deepEqual(rows.map((row) => [row.criterion, row.recordedRound]), [['first', undefined], ['second', 2]]);
  });
});

// Harness-created incident checkpoints share the existing record-time evidence authority.
import { RepairCheckpointService, repairCheckpointFailure } from '../../../src/application/repair-checkpoint-service.js';
import { fixtureMission, inMemoryTransitionStore } from '../../fixtures/mission-builders.js';

function incidentFixture() {
  const mission = fixtureMission('repair-checkpoint', {
    brief: { goal: 'g', why: 'w', scope: 's', outOfScope: [] }, successCriteria: ['first', 'second'], completedSuccessCriteria: [0, 1],
    checkpoints: [{ missionId: missionId('repair-checkpoint'), name: 'CP-1', nextActionText: 'continue', goalCheck: [
      { criterion: 'first', evidence: 'npm test', recordedRound: 1 },
      { criterion: 'second', evidence: 'npm test', recordedRound: 1 },
    ] }],
  });
  const store = inMemoryTransitionStore(mission);
  const repair = new RepairCheckpointService(store);
  const checkpoints = new MissionCheckpointService(store);
  const record = async (name: string, force = false) => checkpoints.record({
    force,
    operationId: 'record', missionId: mission.id, expectedVersion: (await store.load()).version,
    capabilities: new Set(force ? ['checkpoint:record', 'checkpoint:correct'] : ['checkpoint:record']), checkpoint: { missionId: mission.id, name,
      goalCheck: [{ criterion: 'first', evidence: 'npm test' }], nextActionText: 'handoff' },
  });
  return { mission, store, repair, record };
}

test('incident repair records only its affected criterion and preserves original proof through relaunch (TASK-2695)', async () => {
  const { mission, store, repair, record } = incidentFixture();
  const original = structuredClone(mission.checkpoints);
  const request = { slug: mission.id, incidentId: 'incident-1', command: 'npm test', attempt: 1 } satisfies Partial<NonNullable<Parameters<typeof repair.open>[0]>>;
  const opened = await repair.open(request);
  assert.equal(opened?.name, 'CP-2');
  assert.match(repairCheckpointFailure(store.mission().checkpoints) ?? '', /CP-2/);
  await assert.rejects(repair.verify(mission.id, 'CP-2'), /fresh authorized evidence/);
  assert.equal((await record('CP-2')).status, 'completed');
  assert.equal(repairCheckpointFailure(store.mission().checkpoints), null);
  await repair.verify(mission.id, 'CP-2');
  assert.equal(store.mission().checkpoints[1].repair?.verified, true);
  await repair.open({ ...request, attempt: 2 });
  assert.match(repairCheckpointFailure(store.mission().checkpoints) ?? '', /CP-2/);
  await assert.rejects(repair.verify(mission.id, 'CP-2'), /fresh authorized evidence/);
  assert.equal((await record('CP-2')).status, 'completed');
  await repair.verify(mission.id, 'CP-2');
  assert.deepEqual(store.mission().checkpoints[0], original[0]);
  assert.deepEqual(store.mission().checkpoints[1].goalCheck.map(row => [row.criterion, row.carriedFrom]), [['first', undefined], ['second', 'CP-1']]);
  const nextRound = await repair.open({ ...request, incidentId: 'incident-2' });
  assert.equal(nextRound?.name, 'CP-3');
  assert.equal(store.mission().checkpoints[1].repair?.verified, true);
});

test('structured blocker validates exact command, survives evidence writes and blocks handoff (TASK-2695)', async () => {
  const { mission, store, repair, record } = incidentFixture();
  await repair.open({ slug: mission.id, incidentId: 'incident', command: 'npm test', attempt: 1 });
  const blocker = { command: 'npm test', diagnostic: 'support module rejected', authorityReason: 'locked check', proposedCorrection: 'operator selects owner' } satisfies import("../../../src/domain/rebound-policy.js").InvalidContractBlocker;
  const request = { operationId: 'blocker', missionId: mission.id, capabilities: new Set(['checkpoint:record'] as const), name: 'CP-2', blocker } satisfies Partial<NonNullable<Parameters<typeof repair.report>[0]>>;
  assert.equal((await repair.report({ ...request, expectedVersion: (await store.load()).version, blocker: { ...blocker, command: 'unrelated' } })).status, 'failed');
  assert.equal((await repair.report({ ...request, expectedVersion: (await store.load()).version, blocker: { ...blocker, authorityReason: '' } })).status, 'failed');
  assert.equal((await repair.report({ ...request, expectedVersion: (await store.load()).version })).status, 'completed');
  assert.deepEqual(await repair.readBlocker(mission.id, 'CP-2'), blocker);
  const checkpoints = new MissionCheckpointService(store);
  assert.equal((await checkpoints.unplan({ ...request, expectedVersion: (await store.load()).version, capabilities: new Set(['mission:context']) })).status, 'failed');
  assert.match(repairCheckpointFailure(store.mission().checkpoints) ?? '', /human review/);
  assert.equal((await record('CP-2')).status, 'failed');
  await assert.rejects(repair.open({ slug: mission.id, incidentId: 'new-incident', command: 'npm test', attempt: 1 }), /operator decision/);
});

test('repair checkpoint planning leaves earlier missing checkpoints missing (TASK-2695)', async () => {
  const { mission, store, repair, record } = incidentFixture();
  await store.save({ ...store.mission(), checkpoints: [...store.mission().checkpoints,
    { missionId: mission.id, name: 'CP-2', firstLine: 'remaining implementation', goalCheck: [], nextActionText: '' }] } as Mission);
  const opened = await repair.open({ slug: mission.id, incidentId: 'incident', command: 'npm test', attempt: 1 });
  assert.equal(opened?.name, 'CP-3');
  assert.equal((await record('CP-3')).status, 'completed');
  assert.match(repairCheckpointFailure(store.mission().checkpoints) ?? '', /CP-2/);
  assert.equal((await record('CP-2')).status, 'completed');
  assert.equal(repairCheckpointFailure(store.mission().checkpoints), null);
});

test('changed locked gates cannot be certified by an unrelated green rerun (TASK-2695)', async () => {
  const { mission, store, repair, record } = incidentFixture();
  await store.save({ ...store.mission(), declaredGates: ['npm test'] } as Mission);
  await repair.open({ slug: mission.id, incidentId: 'incident', command: 'npm test', attempt: 1 });
  assert.equal((await record('CP-2')).status, 'completed');
  await store.save({ ...store.mission(), declaredGates: ['npm run typecheck'] } as Mission);
  assert.match(repairCheckpointFailure(store.mission().checkpoints, ['npm run typecheck']) ?? '', /required checks changed/);
  await assert.rejects(repair.verify(mission.id, 'CP-2'), /unrelated success/);
  await assert.rejects(repair.open({ slug: mission.id, incidentId: 'incident', command: 'npm test', attempt: 2 }), /operator decision/);
  assert.equal(store.mission().checkpoints[1].repair?.verified, false);
});


test('forced evidence record clears reported blocker but still requires exact gate verification', async () => {
  const { mission, store, repair, record } = incidentFixture();
  await repair.open({ slug: mission.id, incidentId: 'incident', command: 'npm test', attempt: 1 });
  const prior = structuredClone(store.mission().checkpoints[0]);
  const blocker = { command: 'npm test', diagnostic: 'renamed reference', authorityReason: 'operator decision', proposedCorrection: 'correct reference' } satisfies import("../../../src/domain/rebound-policy.js").InvalidContractBlocker;
  await repair.report({ operationId: 'report', missionId: mission.id, expectedVersion: (await store.load()).version,
    capabilities: new Set(['checkpoint:record']), name: 'CP-2', blocker });
  assert.equal((await record('CP-2')).status, 'failed');
  const checkpoints = new MissionCheckpointService(store);
  const forced = { operationId: 'force', missionId: mission.id, expectedVersion: (await store.load()).version,
    capabilities: new Set(['checkpoint:record', 'checkpoint:correct'] as const), force: true,
    checkpoint: { missionId: mission.id, name: 'CP-2', nextActionText: 'handoff',
      goalCheck: [{ criterion: 'first', evidence: '' }] } } satisfies Partial<NonNullable<Parameters<typeof checkpoints.record>[0]>>;
  assert.equal((await checkpoints.record(forced)).status, 'failed', 'force cannot accept blank evidence');
  assert.equal((await checkpoints.record({ ...forced, expectedVersion: missionVersion(forced.expectedVersion - 1),
    checkpoint: { ...forced.checkpoint, goalCheck: [{ criterion: 'first', evidence: 'npm test' }] } })).status,
    'failed', 'force cannot overwrite a stale version');
  assert.deepEqual(await repair.readBlocker(mission.id, 'CP-2'), blocker);
  assert.notEqual((await checkpoints.record({ ...forced, capabilities: new Set(['checkpoint:record']),
    checkpoint: { ...forced.checkpoint, goalCheck: [{ criterion: 'first', evidence: 'npm test' }] } })).status, 'completed');
  assert.equal((await record('CP-2', true)).status, 'completed');
  assert.equal(await repair.readBlocker(mission.id, 'CP-2'), undefined);
  assert.deepEqual(store.mission().checkpoints[0], prior);
  const repaired = store.mission().checkpoints[1];
  assert.equal(repaired.repair?.evidenceRecorded, true);
  assert.equal(repaired.repair?.verified, false);
  assert.equal(repaired.repair?.command, 'npm test');
  assert.deepEqual(repaired.repair?.corrections?.[0].blocker, blocker);
  assert.deepEqual(repaired.repair?.acknowledgedBlocker, blocker);
  await repair.verify(mission.id, 'CP-2');
  assert.equal(store.mission().checkpoints[1].repair?.verified, true);
});


test('operator resume refreshes authorization and retains acknowledgment through another repair attempt (TASK-2756)', async () => {
  const { mission, store, repair, record } = incidentFixture();
  const open = { slug: mission.id, incidentId: 'resume-incident', command: 'npm test', attempt: 1 };
  await repair.open(open);
  const blocker = { command: 'npm test', diagnostic: 'contradictory criterion', authorityReason: 'operator owns criteria', proposedCorrection: 'amend criterion' };
  await repair.open({ slug: mission.id, incidentId: 'other-open', command: 'npm test', attempt: 1 });
  await repair.open({ slug: mission.id, incidentId: 'settled', command: 'npm test', attempt: 1 });
  await record('CP-4');
  await repair.verify(mission.id, 'CP-4');
  await repair.report({ operationId: 'report', missionId: mission.id, capabilities: new Set(['checkpoint:record']), name: 'CP-2', blocker });
  await store.save({ ...store.mission(), successCriteria: ['amended criterion'], declaredGates: ['npm test', 'npm run typecheck'] } as Mission);
  const before = structuredClone(store.mission().checkpoints);
  const request = { operationId: 'resume', missionId: mission.id, capabilities: new Set(['checkpoint:record'] as const), actor: 'px active operator', occurredAt: '2026-10-15T08:00:00.000Z' };
  await assert.rejects(repair.acknowledgeOperatorResume({ ...request, capabilities: new Set() }), /capability is required/);
  await new MissionCheckpointService(store).acknowledgeOperatorResume(request);
  const acknowledged = store.mission().checkpoints[1].repair!;
  assert.equal(acknowledged.blocker, undefined);
  assert.deepEqual(acknowledged.acknowledgedBlocker, blocker);
  assert.equal(acknowledged.acknowledgedBy, request.actor);
  assert.equal(acknowledged.acknowledgedAt, request.occurredAt);
  assert.deepEqual(acknowledged.authorizedCriteria, ['amended criterion']);
  assert.deepEqual(acknowledged.authorizedGates, ['npm test', 'npm run typecheck']);
  assert.deepEqual(store.mission().checkpoints.map(cp => cp.goalCheck), before.map(cp => cp.goalCheck));
  assert.deepEqual(store.mission().checkpoints[2].repair?.authorizedCriteria, ['amended criterion']);
  assert.deepEqual(store.mission().checkpoints[2].repair?.authorizedGates, ['npm test', 'npm run typecheck']);
  assert.deepEqual(store.mission().checkpoints[3], before[3], 'settled history is unchanged');
  assert.deepEqual(store.mission().completedSuccessCriteria, mission.completedSuccessCriteria);
  await repair.open({ ...open, attempt: 2 });
  const retried = store.mission().checkpoints.find(cp => cp.name === 'CP-2')!.repair!;
  assert.deepEqual(retried.acknowledgedBlocker, blocker);
  assert.equal(retried.acknowledgedBy, request.actor);
  assert.equal(retried.acknowledgedAt, request.occurredAt);
  assert.equal(retried.evidenceRecorded, false);
  assert.equal(retried.verified, false);
  await assert.rejects(repair.verify(mission.id, 'CP-2'), /fresh authorized evidence/);
});

// TASK-2755: Goal Check row carry-forward into repair incidents.
describe('Repair incidents carry accepted Goal Check rows', () => {
  const row = (criterion: string, evidence: string, recordedRound?: number) => ({ criterion, evidence, ...(recordedRound ? { recordedRound } : {}) });
  const open = (repair: RepairCheckpointService, slug: string, incidentId = 'incident', attempt = 1) =>
    repair.open({ slug, incidentId, command: 'npm test', attempt });

  test('a new incident copies every row of the latest eligible source and leaves the source unchanged (TASK-2755)', async () => {
    const { mission, store, repair } = incidentFixture();
    const source = structuredClone(store.mission().checkpoints[0]);
    assert.equal((await open(repair, mission.id))?.name, 'CP-2');
    const [cp1, cp2] = store.mission().checkpoints;
    assert.deepEqual(cp1, source);
    assert.deepEqual(cp2.goalCheck, source.goalCheck.map(item => ({ ...item, carriedFrom: 'CP-1' })));
    assert.equal(cp2.repair?.evidenceRecorded, false);
  });

  test('source selection skips empty plans and unverified repairs and starts empty without an eligible source (TASK-2755)', async () => {
    const { mission, store, repair } = incidentFixture();
    const at = (name: string, goalCheck: ReturnType<typeof row>[], verified?: boolean) => ({ missionId: mission.id, name, nextActionText: 'next', goalCheck,
      ...(verified === undefined ? {} : { repair: { incidentId: name, command: 'npm test', authorizedGates: [], authorizedCriteria: ['first', 'second'], attempt: 1, evidenceRecorded: true, verified } }) });
    await store.save({ ...store.mission(), checkpoints: [
      at('CP-1', [row('first', 'cp1')]), at('CP-2', [row('first', 'verified', 2), row('second', 'verified')], true),
      at('CP-3', [row('second', 'unverified')], false), at('CP-4', []),
    ] } as Mission);
    assert.equal((await open(repair, mission.id, 'later'))?.name, 'CP-5');
    assert.deepEqual(store.mission().checkpoints.at(-1)!.goalCheck,
      [{ ...row('first', 'verified', 2), carriedFrom: 'CP-2' }, { ...row('second', 'verified'), carriedFrom: 'CP-2' }]);
    const unverified = incidentFixture();
    await unverified.store.save({ ...unverified.store.mission(), checkpoints: [at('CP-1', [row('first', 'cp1')]), at('CP-2', [row('second', 'unverified')], false), at('CP-3', [])] } as Mission);
    await open(unverified.repair, unverified.mission.id, 'later');
    assert.deepEqual(unverified.store.mission().checkpoints.at(-1)!.goalCheck, [{ ...row('first', 'cp1'), carriedFrom: 'CP-1' }]);
    const none = incidentFixture();
    await none.store.save({ ...none.store.mission(), checkpoints: [at('CP-1', [])] } as Mission);
    await open(none.repair, none.mission.id);
    assert.deepEqual(none.store.mission().checkpoints.at(-1)!.goalCheck, []);
  });

  test('fresh evidence replaces the matching carried row and preserves unrelated carried rows (TASK-2755)', async () => {
    const { mission, store, repair, record } = incidentFixture();
    await store.save({ ...store.mission(), checkpoints: [{ ...store.mission().checkpoints[0],
      goalCheck: store.mission().checkpoints[0].goalCheck.map(item => ({ ...item, criterionId: null })) }] } as Mission);
    await open(repair, mission.id);
    assert.equal((await record('CP-2')).status, 'completed');
    const rows = store.mission().checkpoints[1].goalCheck;
    assert.deepEqual(rows.map(item => [item.criterion, item.evidence, item.carriedFrom]), [['first', 'npm test', undefined], ['second', 'npm test', 'CP-1']]);
    assert.equal(rows[1].recordedRound, 1, 'carried freshness metadata is unchanged');
  });

  test('verify refuses carried-only rows and succeeds after fresh authorized evidence (TASK-2755)', async () => {
    const { mission, store, repair, record } = incidentFixture();
    await open(repair, mission.id);
    await assert.rejects(repair.verify(mission.id, 'CP-2'), /fresh authorized evidence/);
    // Even an evidence flag cannot turn carried rows into repair proof.
    await store.save({ ...store.mission(), checkpoints: store.mission().checkpoints.map(cp => cp.repair
      ? { ...cp, repair: { ...cp.repair, evidenceRecorded: true } } : cp) } as Mission);
    await assert.rejects(repair.verify(mission.id, 'CP-2'), /fresh authorized evidence/);
    assert.equal((await record('CP-2')).status, 'completed');
    await repair.verify(mission.id, 'CP-2');
    assert.equal(store.mission().checkpoints[1].repair?.verified, true);
  });

  test('reopening the same incident keeps its rows and provenance and still owes fresh evidence (TASK-2755)', async () => {
    const { mission, store, repair, record } = incidentFixture();
    await open(repair, mission.id);
    assert.equal((await record('CP-2')).status, 'completed');
    await repair.verify(mission.id, 'CP-2');
    await store.save({ ...store.mission(), checkpoints: [{ ...store.mission().checkpoints[0], goalCheck: [row('first', 'rewritten'), row('second', 'rewritten')] }, store.mission().checkpoints[1]] } as Mission);
    const before = structuredClone(store.mission().checkpoints[1].goalCheck);
    await open(repair, mission.id, 'incident', 2);
    assert.deepEqual(store.mission().checkpoints[1].goalCheck, before);
    await assert.rejects(repair.verify(mission.id, 'CP-2'), /fresh authorized evidence/);
  });
});

async function falseBlockerFixture() {
  const { mission, store, repair } = incidentFixture();
  await store.save({ ...store.mission(), successCriteria: ['first', 'second', 'implementation'], completedSuccessCriteria: [0],
    checkpoints: [store.mission().checkpoints[0],
      { missionId: mission.id, name: 'CP-2', firstLine: 'Operator decision', goalCheck: [{ criterion: 'first', evidence: 'npm test' }], nextActionText: 'Implement CP-3' },
      ...['CP-3', 'CP-4'].map(name => ({ missionId: mission.id, name, goalCheck: [], nextActionText: 'Implement' }))] } as Mission);
  await repair.open({ slug: mission.id, incidentId: 'stale-report', command: 'npm test', attempt: 1 });
  const blocker = { command: 'npm test', diagnostic: 'CP-2 decision absent', authorityReason: 'operator decision required', proposedCorrection: 'record CP-2 decision' };
  await repair.report({ operationId: 'report', missionId: mission.id, capabilities: new Set(['checkpoint:record']), name: 'CP-5', blocker });
  const references = { rootFor: () => '/repo', fileSystem: {
    existsSync: (target: string) => target === '/repo/decision.txt', readText: () => '', listEntries: () => [], listNames: () => [],
  } };
  const checkpoints = new MissionCheckpointService(store, references);
  const correct = async (patch: Partial<Parameters<typeof checkpoints.correctInvalidContract>[0]> = {}) => checkpoints.correctInvalidContract({
    operationId: 'correct', missionId: mission.id, expectedVersion: (await store.load()).version,
    capabilities: new Set(['checkpoint:correct']), name: 'CP-5', operator: 'operator', decision: 'CP-2 already records the decision', evidence: 'decision.txt', ...patch,
  });
  return { mission, store, repair, checkpoints, blocker, correct, references };
}

// Serialized Mission snapshots model the pre-reconciliation persisted legacy payload.
async function legacyCorrectedFixture() {
  const f = await falseBlockerFixture();
  assert.equal((await f.correct()).status, 'completed');
  assert.equal((await f.repair.report({ operationId: 'second-report', missionId: f.mission.id,
    capabilities: new Set(['checkpoint:record']), name: 'CP-5', blocker: { ...f.blocker, diagnostic: 'second retained diagnostic' } })).status, 'completed');
  assert.equal((await f.correct({ decision: 'second retained decision' })).status, 'completed');
  const persisted = JSON.stringify({ ...f.store.mission(), successCriteria: ['first', 'second', 'amended implementation'],
    checkpoints: f.store.mission().checkpoints.map(cp => cp.name === 'CP-5' ? { ...cp, repair: { ...cp.repair!,
      occurrence: { worktree: '/repo', failureRevision: 'old-head', failureEvidenceId: 'retained-failure', openedMissionRevision: 4 },
    } } : cp),
  });
  const store = inMemoryTransitionStore(JSON.parse(persisted) as Mission, { version: 10 });
  const checkpoints = new MissionCheckpointService(store, f.references);
  const correct = async (patch: Partial<Parameters<typeof checkpoints.correctInvalidContract>[0]> = {}) => checkpoints.correctInvalidContract({
    operationId: 'reconcile', missionId: f.mission.id, expectedVersion: (await store.load()).version,
    capabilities: new Set(['checkpoint:correct']), name: 'CP-5', operator: 'reconciling operator',
    decision: 'authorize amended criteria after retained correction', evidence: 'decision.txt', ...patch,
  });
  return { ...f, store, checkpoints, correct };
}

test('persisted legacy corrected repair reconciles stale criteria without a new blocker (TASK-2809)', async () => {
  const { evaluateMissionEvidence } = await import('../../../src/application/mission-evidence-readiness.js');
  const f = await legacyCorrectedFixture();
  const before = structuredClone(f.store.mission());
  const readiness = evaluateMissionEvidence({ draftedInDb: true, checkpoints: before.checkpoints,
    successCriteria: before.successCriteria!, completedSuccessCriteria: before.completedSuccessCriteria!,
    gates: before.declaredGates ?? [], review: before.review }, f.references.fileSystem, '/repo');
  assert.ok(readiness.findings.some(row => row.code === 'repair-contract-changed'));
  assert.equal(before.checkpoints[4].repair!.blocker, undefined);
  assert.equal(before.checkpoints[4].repair!.corrections!.length, 2);
  const result = await f.correct();
  assert.equal(result.status, 'completed', result.error?.message ?? 'reconciliation failed');
  const after = f.store.mission();
  const priorRepair = before.checkpoints[4].repair!;
  const nextRepair = after.checkpoints[4].repair!;
  assert.deepEqual(nextRepair.authorizedCriteria, before.successCriteria);
  assert.deepEqual(nextRepair.corrections!.slice(0, -1), priorRepair.corrections);
  assert.deepEqual({ ...nextRepair, authorizedCriteria: priorRepair.authorizedCriteria, corrections: priorRepair.corrections }, priorRepair);
  assert.deepEqual({ ...after, checkpoints: before.checkpoints }, before);
  assert.deepEqual(after.checkpoints.slice(0, 4), before.checkpoints.slice(0, 4));
  assert.deepEqual({ ...after.checkpoints[4], repair: priorRepair }, before.checkpoints[4]);
  const reloaded = inMemoryTransitionStore(JSON.parse(JSON.stringify(after)) as Mission);
  assert.deepEqual(reloaded.mission(), after);
  const audit = nextRepair.corrections!.at(-1)!;
  assert.equal(audit.operator, 'reconciling operator');
  assert.equal(audit.decision, 'authorize amended criteria after retained correction');
  assert.equal(audit.evidence, 'decision.txt');
  assert.deepEqual(audit.authorizedCriteria, priorRepair.authorizedCriteria);
  assert.deepEqual(audit.authorizedGates, priorRepair.authorizedGates);
  assert.ok(audit.occurredAt);
  assert.equal(audit.missionRevision, (await f.store.load()).version);
  assert.deepEqual(audit.blocker, priorRepair.corrections!.at(-1)!.blocker);
});

test('legacy criteria reconciliation rejects missing authority, gate drift and replay atomically (TASK-2809)', async () => {
  const f = await legacyCorrectedFixture();
  const before = structuredClone(await f.store.load());
  for (const patch of [
    { capabilities: new Set(['checkpoint:record'] as const) },
    { expectedVersion: missionVersion(before.version - 1) }, { operator: '' }, { decision: ' ' },
    { evidence: '' }, { evidence: 'operator assertion only' }, { evidence: 'missing.txt' }, { name: 'CP-3' },
  ]) {
    assert.notEqual((await f.correct(patch)).status, 'completed');
    assert.deepEqual(await f.store.load(), before);
  }
  for (const repairPatch of [
    { corrections: undefined }, { corrections: [] },
    { corrections: [{ ...before.mission.checkpoints[4].repair!.corrections![0], operator: '' }] },
    { authorizedGates: ['other required gate'] },
  ]) {
    const mission = { ...before.mission, checkpoints: before.mission.checkpoints.map(cp => cp.name === 'CP-5'
      ? { ...cp, repair: { ...cp.repair!, ...repairPatch } } : cp) } as Mission;
    const store = inMemoryTransitionStore(mission);
    const checkpoints = new MissionCheckpointService(store, f.references);
    const request = { operationId: 'invalid', missionId: mission.id, capabilities: new Set(['checkpoint:correct'] as const),
      name: 'CP-5', operator: 'operator', decision: 'reconcile', evidence: 'decision.txt' };
    assert.equal((await checkpoints.correctInvalidContract(request)).status, 'failed');
    assert.deepEqual(store.mission(), mission);
  }
  for (const references of [undefined, { ...f.references, rootFor: () => null }]) {
    const service = new MissionCheckpointService(f.store, references);
    const result = await service.correctInvalidContract({ operationId: 'no-checkout', missionId: f.mission.id,
      capabilities: new Set(['checkpoint:correct']), name: 'CP-5', operator: 'operator', decision: 'reconcile', evidence: 'decision.txt' });
    assert.equal(result.error?.kind, 'unavailable');
    assert.deepEqual(await f.store.load(), before);
  }
  assert.equal((await f.correct()).status, 'completed');
  const current = structuredClone(await f.store.load());
  assert.match((await f.correct()).error?.message ?? '', /already current/);
  assert.deepEqual(await f.store.load(), current);
});

test('legacy reconciliation CAS conflict retains the entire stale snapshot (TASK-2809)', async () => {
  const { MissionStaleVersion } = await import('../../../src/application/domain-ports.js');
  const f = await legacyCorrectedFixture();
  const before = structuredClone(await f.store.load());
  const service = new MissionCheckpointService({ load: () => f.store.load(), save: async (_next, version) => {
    assert.equal(version, before.version);
    throw new MissionStaleVersion(f.mission.id, version, missionVersion(before.version + 1));
  } }, f.references);
  const result = await service.correctInvalidContract({ operationId: 'race', missionId: f.mission.id,
    expectedVersion: before.version, capabilities: new Set(['checkpoint:correct']), name: 'CP-5',
    operator: 'operator', decision: 'reconcile', evidence: 'decision.txt' });
  assert.equal(result.error?.kind, 'conflict');
  assert.deepEqual(await f.store.load(), before);
});

test('operator corrects false CP-5 blocker after CP-2 before unfinished CP-3 and CP-4 (TASK-2803)', async () => {
  const { mission, store, repair, checkpoints, blocker, correct } = await falseBlockerFixture();
  const before = structuredClone(store.mission());
  const coupled = await checkpoints.record({ operationId: 'coupled-force', missionId: mission.id,
    capabilities: new Set(['checkpoint:record', 'checkpoint:correct']), force: true,
    checkpoint: { missionId: mission.id, name: 'CP-5', goalCheck: [{ criterion: 'first', evidence: 'decision.txt' }], nextActionText: 'CP-3' } });
  assert.match(coupled.error?.message ?? '', /Uncovered criteria: implementation/);
  assert.deepEqual(store.mission(), before, 'the original coupled evidence path still refuses missing coverage');
  const result = await correct();
  assert.equal(result.status, 'completed', result.error?.message ?? 'correction failed');
  assert.equal(await repair.readBlocker(mission.id, 'CP-5'), undefined);
  assert.deepEqual(store.mission().checkpoints.slice(0, 4), before.checkpoints.slice(0, 4));
  assert.deepEqual(store.mission().completedSuccessCriteria, before.completedSuccessCriteria);
  assert.deepEqual(store.mission().checkpoints[4].repair?.acknowledgedBlocker, blocker);
  assert.equal(store.mission().checkpoints[4].repair?.verified, false);
  assert.equal(store.mission().checkpoints[4].repair?.evidenceRecorded, false);
  assert.deepEqual(store.mission().checkpoints[4].goalCheck, before.checkpoints[4].goalCheck);
  await assert.rejects(repair.verify(mission.id, 'CP-5'), /fresh authorized evidence/);
});


test('operator correction rejects unauthorized, stale and invalid evidence writes atomically (TASK-2803)', async () => {
  const { store, correct } = await falseBlockerFixture();
  await store.save({ ...store.mission(), successCriteria: ['first'] } as Mission);
  const before = structuredClone(await store.load());
  for (const patch of [
    { capabilities: new Set(['checkpoint:record'] as const) }, { capabilities: new Set<import('../../../src/application/contracts.js').Capability>() },
    { expectedVersion: missionVersion(before.version - 1) }, { operator: '' }, { decision: ' ' },
    { evidence: '' }, { evidence: 'the operator said so' }, { evidence: 'missing.txt' }, { name: 'CP-3' },
  ]) {
    assert.notEqual((await correct(patch)).status, 'completed');
    assert.deepEqual(await store.load(), before);
  }
  assert.equal((await correct()).status, 'completed');
  const corrected = structuredClone(await store.load());
  assert.notEqual((await correct()).status, 'completed', 'cannot correct an already resolved blocker');
  assert.deepEqual(await store.load(), corrected);
});

test('public checkpoint reads retain original diagnostics and every operator correction after reload (TASK-2803)', async () => {
  const { mission, store, repair, checkpoints, blocker, correct, references } = await falseBlockerFixture();
  assert.equal((await correct()).status, 'completed');
  const second = { ...blocker, diagnostic: 'another false report' };
  await repair.report({ operationId: 'report-again', missionId: mission.id, capabilities: new Set(['checkpoint:record']), name: 'CP-5', blocker: second });
  assert.equal((await correct({ decision: 'second report is also incorrect' })).status, 'completed');
  const reloaded = new MissionCheckpointService(inMemoryTransitionStore(structuredClone(store.mission())), references);
  const read = await reloaded.read({ operationId: 'read', missionId: mission.id, capabilities: new Set(['checkpoint:record']), name: 'CP-5' });
  assert.equal(read.status, 'completed');
  const retained = read.value!.checkpoints[0].repair!;
  assert.equal(retained.blocker, undefined);
  assert.deepEqual(retained.corrections?.map(item => item.blocker), [blocker, second]);
  assert.deepEqual(retained.corrections?.map(item => item.decision), ['CP-2 already records the decision', 'second report is also incorrect']);
  assert.equal(retained.corrections?.[0].evidence, 'decision.txt');
  assert.equal(retained.corrections?.[0].operator, 'operator');
  assert.equal(retained.corrections?.[0].missionRevision, 5);
  assert.ok(retained.corrections?.[0].occurredAt);
  assert.equal(retained.verified, false);
  assert.equal((await checkpoints.read({ operationId: 'read', missionId: mission.id, capabilities: new Set(['checkpoint:record']) })).status, 'completed');
});


test('concurrent correction refuses CAS conflict without losing the blocker (TASK-2803)', async () => {
  const { MissionStaleVersion } = await import('../../../src/application/domain-ports.js');
  const { mission, store, references } = await falseBlockerFixture();
  await store.save({ ...store.mission(), successCriteria: ['first'] } as Mission);
  const before = structuredClone(await store.load());
  const checkpoints = new MissionCheckpointService({ load: () => store.load(), save: async (_next, version) => {
    assert.equal(version, before.version);
    throw new MissionStaleVersion(mission.id, version, missionVersion(before.version + 1));
  } }, references);
  const result = await checkpoints.correctInvalidContract({ operationId: 'race', missionId: mission.id,
    capabilities: new Set(['checkpoint:correct']), operator: 'operator', decision: 'CP-2 recorded', evidence: 'decision.txt', name: 'CP-5' });
  assert.equal(result.error?.kind, 'conflict');
  assert.deepEqual(await store.load(), before);
});

import { effectiveRepairObligations, isExplicitlyCovered } from '../../../src/domain/repair-coverage.js';
import { pendingRetainedRepair } from '../../../src/application/review-loop/retained-repair.js';
import { runCheckpointVerification } from '../../../src/application/rebound-checkpoints.js';
import { rebound } from '../../../src/application/rebound-kernel.js';
import type { RepairVerificationProof } from '../../../src/application/ports/repair-checkpoint.js';

describe('Exact repair success coverage', () => {
  async function coverageFixture() {
    const f = incidentFixture();
    await f.store.save({ ...f.store.mission(), declaredGates: ['npm test'] } as Mission);
    const open = { slug: f.mission.id, command: 'npm test', attempt: 1, worktree: '/isolated/worktree',
      failureRevision: 'failed-head', failureEvidenceId: 'retained-failure-1' };
    await f.repair.open({ ...open, incidentId: 'older' });
    await f.record('CP-2');
    await f.repair.open({ ...open, incidentId: 'newer', failureEvidenceId: 'retained-failure-2' });
    await f.record('CP-3');
    const snapshot = await f.repair.prepareVerification(f.mission.id, 'CP-3', { worktree: open.worktree, executionRevision: 'fixed-head' });
    assert.ok(snapshot);
    const proof: RepairVerificationProof = { snapshot, command: open.command, revisionAfter: 'fixed-head', execution: {
      id: 'exact-run', producer: 'rebound-exact-verifier', exitCode: 0,
      startedAt: '2026-10-21T10:00:00Z', completedAt: '2026-10-21T10:01:00Z',
    } };
    return { ...f, open, proof, obligations: () => {
      const m = f.store.mission();
      return effectiveRepairObligations(m.checkpoints, m.declaredGates, m.successCriteria);
    } };
  }

  test('only an exact-success receipt discharges its explicit older occurrence without changing history (TASK-2802)', async () => {
    const f = await coverageFixture();
    const before = structuredClone(f.store.mission().checkpoints[1]);
    assert.deepEqual(f.obligations().map(cp => cp.name), ['CP-2', 'CP-3']);
    await f.repair.verify(f.mission.id, 'CP-3', f.proof);
    assert.deepEqual(f.obligations(), []);
    assert.deepEqual(f.store.mission().checkpoints[1], before);
    assert.equal(before.repair?.verified, false);
    assert.equal(pendingRetainedRepair(f.store.mission(), f.open.worktree), undefined);
    assert.equal(repairCheckpointFailure(f.store.mission().checkpoints, ['npm test'], ['first', 'second']), null);
    assert.equal(pendingRetainedRepair(f.store.mission(), '/other/worktree')?.name, 'CP-2');
  });

  test('the running rebound harness alone certifies exact execution and occurrence coverage (TASK-2802)', async () => {
    const f = await coverageFixture();
    const outcome = await rebound({ kind: 'gate-failure', area: 'coverage', command: f.open.command, exitCode: 1, stdout: '', stderr: 'failed' }, {
      slug: f.mission.id, worktree: f.open.worktree, implementer: 'codex', maxAttempts: 1,
      repairCheckpoints: f.repair, repairIncidentId: 'newer', readHead: () => 'fixed-head',
      retainedFailure: { version: 1, incidentId: 'failure-store', attempt: 2,
        command: f.open.command, cwd: f.open.worktree, capturedRevision: 'failed-head', exitCode: 1, signal: null,
        stdoutPath: '/retained/stdout', stderrPath: '/retained/stderr', stdoutBytes: 0, stderrBytes: 6,
        captureComplete: true, truncatedFrom: null, redacted: false, capturedAt: '2026-10-21T10:00:00Z' },
      startAgent: async () => { await f.record('CP-3'); return { result: { status: 0 } }; },
      verify: () => ({ ok: true, command: f.open.command,
        exactExecution: { command: f.open.command, worktree: f.open.worktree, exitCode: 0 } }), log() {}, error() {},
    });
    assert.equal(outcome.outcome, 'fixed', outcome.diagnostic);
    assert.deepEqual(f.obligations(), []);
    const source = f.store.mission().checkpoints.find(cp => cp.name === 'CP-3')!;
    assert.equal(source.repair!.exactSuccessCoverage!.execution.producer, 'rebound-exact-verifier');
    assert.equal(source.repair!.occurrence!.failureEvidenceId, 'failure-store:2');
  });

  test('reused success or an unrelated execution receipt cannot create occurrence coverage (TASK-2802)', async () => {
    for (const exactExecution of [undefined,
      { command: 'unrelated', worktree: '/isolated/worktree', exitCode: 0 as const },
      { command: 'npm test', worktree: '/other/worktree', exitCode: 0 as const }]) {
      const f = await coverageFixture();
      const verification = await runCheckpointVerification({ slug: f.mission.id, worktree: f.open.worktree,
        implementer: 'codex', readHead: () => 'fixed-head', repairCheckpoints: f.repair,
        startAgent: async () => ({ result: { status: 0 } }), verify: () => ({ ok: true, command: f.open.command, exactExecution }),
      }, { fixPrompt: '', repairPort: f.repair, repairCheckpoint: { name: 'CP-3', version: 1 } }, 1);
      await verification.certify();
      assert.equal(f.store.mission().checkpoints[2].repair!.exactSuccessCoverage, undefined);
      assert.deepEqual(f.obligations().map(cp => cp.name), ['CP-2']);
    }
  });

  test('legacy verified flags and equal commands cannot reconcile distinct incidents (TASK-2802)', async () => {
    const f = await coverageFixture();
    await f.repair.verify(f.mission.id, 'CP-3');
    assert.deepEqual(f.obligations().map(cp => cp.name), ['CP-2']);
    assert.equal(pendingRetainedRepair(f.store.mission())?.name, 'CP-2');
  });

  test('incomplete provenance, incompatible scope and changed authority preserve obligations (TASK-2802)', async () => {
    const f = await coverageFixture();
    await f.repair.verify(f.mission.id, 'CP-3', f.proof);
    const mission = structuredClone(f.store.mission());
    const source = mission.checkpoints[2];
    const target = mission.checkpoints[1];
    const coverage = source.repair!.exactSuccessCoverage!;
    const mutations = [
      { ...coverage, producer: 'agent' }, { ...coverage, missionId: 'other' }, { ...coverage, worktree: '/other' },
      { ...coverage, command: 'unrelated' }, { ...coverage, executionRevision: '' },
      { ...coverage, checkpointEvidenceRevision: 0 }, { ...coverage, verifiedMissionRevision: 0 },
      { ...coverage, executionMissionRevision: 0 },
      { ...coverage, execution: { ...coverage.execution, id: '' } },
      { ...coverage, execution: { ...coverage.execution, exitCode: 1 } },
      { ...coverage, execution: { ...coverage.execution, producer: 'agent' } },
      { ...coverage, execution: { ...coverage.execution, startedAt: '' } },
      { ...coverage, coveredOccurrences: [] }, { ...coverage, verifiedOccurrence: { ...coverage.verifiedOccurrence, attempt: 99 } },
      { ...coverage, coveredOccurrences: [{ ...coverage.coveredOccurrences[0], failureEvidenceId: 'unrelated-failure' }] },
      { ...coverage, authorizedGates: ['other'] }, { ...coverage, authorizedCriteria: ['other'] },
    ];
    for (const mutation of mutations) {
      const changed = { ...source, repair: { ...source.repair!, exactSuccessCoverage: mutation } } as typeof source;
      assert.equal(isExplicitlyCovered(target, [target, changed], mission.declaredGates, mission.successCriteria), false, JSON.stringify(mutation));
    }
    assert.equal(isExplicitlyCovered(target, mission.checkpoints, ['changed'], mission.successCriteria), false);
    assert.equal(isExplicitlyCovered(target, mission.checkpoints, mission.declaredGates, ['changed']), false);
    const blocked = { ...target, repair: { ...target.repair!, blocker: {
      command: 'npm test', diagnostic: 'invalid', authorityReason: 'operator owns it', proposedCorrection: 'operator corrects it',
    } } };
    assert.equal(isExplicitlyCovered(blocked, [blocked, source]), false);
    assert.match(repairCheckpointFailure([blocked, source]) ?? '', /human review/);
  });

  test('reopening either occurrence invalidates prior coverage and preserves the failure rows (TASK-2802)', async () => {
    for (const incidentId of ['older', 'newer']) {
      const f = await coverageFixture();
      await f.repair.verify(f.mission.id, 'CP-3', f.proof);
      const rows = structuredClone(f.store.mission().checkpoints[1].goalCheck);
      await f.repair.open({ ...f.open, incidentId, attempt: 2 });
      assert.ok(f.obligations().some(cp => cp.name === 'CP-2'));
      const older = f.store.mission().checkpoints.find(cp => cp.name === 'CP-2')!;
      assert.deepEqual(older.goalCheck, rows);
      assert.equal(older.repair!.incidentId, 'older');
    }
  });

  test('unrelated success, revision drift, rerecorded evidence and reopened failures persist no partial coverage (TASK-2802)', async () => {
    for (const change of ['command', 'revision', 'evidence', 'occurrence', 'gates', 'criteria']) {
      const f = await coverageFixture();
      let proof = f.proof;
      if (change === 'command') { proof = { ...proof, command: 'unrelated' }; }
      if (change === 'revision') { proof = { ...proof, revisionAfter: 'changed-head' }; }
      if (change === 'evidence') { await f.record('CP-3'); }
      if (change === 'occurrence') { await f.repair.open({ ...f.open, incidentId: 'older', attempt: 2 }); }
      if (change === 'gates') { await f.store.save({ ...f.store.mission(), declaredGates: ['changed'] } as Mission); }
      if (change === 'criteria') { await f.store.save({ ...f.store.mission(), successCriteria: ['changed'] } as Mission); }
      const before = structuredClone(f.store.mission());
      await assert.rejects(f.repair.verify(f.mission.id, 'CP-3', proof), /authority|unrelated success/);
      assert.deepEqual(f.store.mission(), before);
      assert.equal(f.store.mission().checkpoints[2].repair!.exactSuccessCoverage, undefined);
      assert.equal(f.store.mission().checkpoints[2].repair!.verified, false);
    }
  });

  test('distinct commands, scopes and failures first seen after execution stay unresolved (TASK-2802)', async () => {
    const f = await coverageFixture();
    await f.repair.open({ ...f.open, incidentId: 'unrelated-command', command: 'npm run other' });
    await f.repair.open({ ...f.open, incidentId: 'unrelated-scope', worktree: '/other/worktree' });
    await f.repair.open({ ...f.open, incidentId: 'new-occurrence-after-snapshot' });
    await f.repair.verify(f.mission.id, 'CP-3', f.proof);
    assert.deepEqual(f.obligations().map(cp => cp.repair!.incidentId),
      ['unrelated-command', 'unrelated-scope', 'new-occurrence-after-snapshot']);
    assert.equal(pendingRetainedRepair(f.store.mission(), f.open.worktree)?.repair!.incidentId, 'new-occurrence-after-snapshot');
  });

  test('Mission CAS conflict persists neither coverage nor verified success (TASK-2802)', async () => {
    const f = await coverageFixture();
    const before = structuredClone(f.store.mission());
    const repair = new RepairCheckpointService({ ...f.store, save: async (_mission, expectedVersion) => {
      assert.equal(expectedVersion, (await f.store.load()).version);
      throw new Error('Stale write: concurrent Mission update');
    } });
    await assert.rejects(repair.verify(f.mission.id, 'CP-3', f.proof), /Stale write/);
    assert.deepEqual(f.store.mission(), before);
  });
});


test('criterion corrections retain each authorization and leave other incidents and gates untouched (TASK-2808)', async () => {
  const { mission, store, repair, blocker, correct, references } = await falseBlockerFixture();
  const initial = structuredClone(store.mission().checkpoints[4].repair!);
  // Both an unrelated open incident and a settled one must remain byte-for-byte history.
  const others = ['unrelated', 'settled'].map((incidentId, index) => ({
    ...store.mission().checkpoints[4], name: `CP-${index + 6}`,
    repair: { ...initial, incidentId, blocker: undefined, verified: index === 1 },
  }));
  await store.save({ ...store.mission(), successCriteria: ['first', 'second'], declaredGates: ['changed gate'],
    checkpoints: [...store.mission().checkpoints, ...others] } as Mission);
  const before = structuredClone(store.mission());
  assert.equal((await correct()).status, 'completed');
  const firstDecision = structuredClone(store.mission().checkpoints[4].repair!.corrections![0]);
  assert.deepEqual(firstDecision.authorizedCriteria, initial.authorizedCriteria);
  assert.deepEqual(firstDecision.authorizedGates, initial.authorizedGates);
  assert.deepEqual(store.mission().checkpoints[4].repair!.authorizedCriteria, ['first', 'second']);
  assert.deepEqual(store.mission().checkpoints[4].repair!.authorizedGates, initial.authorizedGates);
  assert.match(repairCheckpointFailure([store.mission().checkpoints[4]], ['changed gate'], ['first', 'second']) ?? '', /required checks changed/);
  await assert.rejects(repair.verify(mission.id, 'CP-5'), /fresh authorized evidence/);
  const secondBlocker = { ...blocker, diagnostic: 'second criterion is impossible too' };
  await repair.report({ operationId: 'second-report', missionId: mission.id, capabilities: new Set(['checkpoint:record']), name: 'CP-5', blocker: secondBlocker });
  await store.save({ ...store.mission(), successCriteria: ['first'] } as Mission);
  assert.equal((await correct({ decision: 'Accept second criterion removal' })).status, 'completed');
  const reloaded = new MissionCheckpointService(inMemoryTransitionStore(JSON.parse(JSON.stringify(store.mission()))), references);
  const read = await reloaded.read({ operationId: 'read', missionId: mission.id, capabilities: new Set(['checkpoint:record']), name: 'CP-5' });
  assert.equal(read.status, 'completed');
  const retained = read.value!.checkpoints[0].repair!;
  assert.equal(retained.incidentId, initial.incidentId);
  assert.equal(retained.command, initial.command);
  assert.deepEqual(retained.authorizedCriteria, ['first']);
  assert.deepEqual(retained.authorizedGates, initial.authorizedGates);
  assert.deepEqual(retained.corrections![0], firstDecision);
  assert.deepEqual(retained.corrections!.map(item => item.authorizedCriteria), [initial.authorizedCriteria, ['first', 'second']]);
  assert.deepEqual(retained.corrections!.map(item => item.blocker), [blocker, secondBlocker]);
  assert.equal(retained.corrections![1].decision, 'Accept second criterion removal');
  assert.ok(retained.corrections![1].missionRevision > firstDecision.missionRevision);
  for (const correction of retained.corrections!) {
    assert.equal(correction.operator, 'operator');
    assert.equal(correction.evidence, 'decision.txt');
    assert.ok(correction.occurredAt);
  }
  assert.deepEqual(store.mission().checkpoints.slice(0, 4), before.checkpoints.slice(0, 4));
  assert.deepEqual(store.mission().checkpoints.slice(5), before.checkpoints.slice(5));
  assert.deepEqual(store.mission().checkpoints[4].goalCheck, before.checkpoints[4].goalCheck);
  assert.deepEqual(store.mission().completedSuccessCriteria, before.completedSuccessCriteria);
  assert.deepEqual(store.mission().review, before.review);
  assert.equal(retained.verified, false);
  assert.equal(retained.evidenceRecorded, false);
});
