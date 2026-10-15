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
    capabilities: new Set(['checkpoint:record']), checkpoint: { missionId: mission.id, name,
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
    capabilities: new Set(['checkpoint:record'] as const), force: true,
    checkpoint: { missionId: mission.id, name: 'CP-2', nextActionText: 'handoff',
      goalCheck: [{ criterion: 'first', evidence: '' }] } } satisfies Partial<NonNullable<Parameters<typeof checkpoints.record>[0]>>;
  assert.equal((await checkpoints.record(forced)).status, 'failed', 'force cannot accept blank evidence');
  assert.equal((await checkpoints.record({ ...forced, expectedVersion: missionVersion(forced.expectedVersion - 1),
    checkpoint: { ...forced.checkpoint, goalCheck: [{ criterion: 'first', evidence: 'npm test' }] } })).status,
    'failed', 'force cannot overwrite a stale version');
  assert.deepEqual(await repair.readBlocker(mission.id, 'CP-2'), blocker);
  assert.equal((await record('CP-2', true)).status, 'completed');
  assert.equal(await repair.readBlocker(mission.id, 'CP-2'), undefined);
  assert.deepEqual(store.mission().checkpoints[0], prior);
  const repaired = store.mission().checkpoints[1];
  assert.equal(repaired.repair?.evidenceRecorded, true);
  assert.equal(repaired.repair?.verified, false);
  assert.equal(repaired.repair?.command, 'npm test');
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
