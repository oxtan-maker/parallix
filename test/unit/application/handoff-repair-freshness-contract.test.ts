import { fixtureMission } from '../../fixtures/mission-builders.js';
import type { MissionLoadResult } from '../../../src/application/domain-ports.js';
/**
 * Handoff half of fresh repair proof (TASK-2665): after reviewer-requested changes
 * or an integration bounceback, handoff requires rows recorded in the repair round
 * for the criteria the findings or failed gate name. The record-time half lives in
 * the checkpoint repair freshness suite.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { HandoffCommandUseCase } from '../../../src/application/handoff-command-use-case.js';
import { SLUG, ROOT, makeRecorder, makePorts, runOptions, handoffTransitionValue } from '../../helpers/handoff-ports.js';
import { MissionCheckpointService } from '../../../src/application/mission-checkpoint-service.js';
import { missionVersion, type MissionStore } from '../../../src/application/domain-ports.js';
import { missionId, type Mission } from '../../../src/domain/mission.js';
import { classifyError } from '../../../src/application/failure-classification.js';
import { reviewFindingId, applyImplementerCommand, applyReviewerCommand, changeRevision, ConfiguredReviewerEligibility, revokeApprovedDecision, startReview, type Review } from '../../../src/domain/review.js';
import { agentFamily } from '../../../src/domain/agents.js';

function contractServices(load: () => Promise<MissionLoadResult>) {
  return {
    missionServices: async () => ({
      checkpoints: { record: async () => ({ durableEvidence: [],  status: 'completed' as const }) },
      lifecycle: { transition: async () => ({ durableEvidence: [],  status: 'completed' as const, value: handoffTransitionValue() }) },
      store: { load },
      handoff: { recordNel: async () => ({ durableEvidence: [],  status: 'completed' as const }) },
    }),
  };
}

const DRAFTED_BRIEF = { goal: 'g', why: 'w', scope: 's', outOfScope: [] };

// Real repair facts drive freshness: reviewer-requested changes (ordinary F-ids
// or classifier `success-criterion-N` ids) and an integration bounceback (a
// revoked approval followed by a pending round). A row remembers the review round
// it was recorded in; proof from an earlier round is valid for coverage but stale
// as repair evidence, so a repair that wrote nothing fresh is refused.
const REPAIR_REF = 'test/unit/application/handoff-repair-freshness-contract.test.ts';

async function handOffRepair(
  kind: 'finding-F4' | 'finding-F4-criterion-1' | 'classifier-criterion-1' | 'bounceback' | 'bounceback-gate',
  freshCriteria: readonly string[],
) {
  const targetRef = path.join(ROOT, REPAIR_REF);
  const base = {
    subject: { change: { kind: 'local-branch' as const, sourceBranch: `mission/${SLUG}`, targetBranch: 'main' }, revision: changeRevision('rev') }, reviewer: agentFamily('codex'),
    implementer: agentFamily('custom'), startedAt: '2026-01-01T00:00:00Z',
    disposition: null, reviewerRetryCount: 0, implementerRetryCount: 0,
  };
  const findingId = kind.startsWith('finding-F4') ? 'F4' : 'success-criterion-1';
  const rounds: Review['rounds'] = kind.startsWith('bounceback')
    ? [
      { ...base, number: 1, phase: 'approved', response: null, decision: {
        kind: 'approved', decidedAt: '2026-01-01T01:00:00Z', comment: null, source: { kind: 'local' },
        revocation: { revokedAt: '2026-01-01T02:00:00Z', revokedBy: 'px', reason: 'gate', cause: { kind: 'integration-gate-failure', gate: kind === 'bounceback-gate' ? 'unit-first' : 'g' } },
      } },
      { ...base, number: 2, phase: 'reviewing', response: null, decision: null },
    ]
    : [{
      ...base, number: 1, phase: 'fixing',
      decision: { kind: 'changes-requested', decidedAt: '2026-01-01T01:00:00Z', comment: null, findings: [
        { id: reviewFindingId(findingId), summary: kind === 'finding-F4-criterion-1' ? 'Success criterion 1 has no fix evidence' : 'repair', location: null },
      ] },
      // The implementer's resolution precedes the repair handoff, which then
      // begins the next round.
      response: { kind: 'resolved', respondedAt: '2026-01-01T02:00:00Z', resolutions: [
        { findingId: reviewFindingId(findingId), kind: 'fixed', evidence: REPAIR_REF },
      ], resultingRevision: changeRevision('rev') },
    }];
  const freshRound = rounds.length;
  const review: Review = { rounds, intervention: null, stageLaunches: [], reviewEvents: [] };
  const row = (criterion: string) => ({
    criterion, evidence: criterion === 'first' ? `${REPAIR_REF} via unit-first` : REPAIR_REF, recordedRound: freshCriteria.includes(criterion) ? freshRound : 0,
  });
  const recorder = makeRecorder();
  const ports = makePorts(recorder, {
    ...contractServices(async () => ({
      kind: 'found' as const,
      mission: fixtureMission(SLUG, { assignee: agentFamily('custom'),
        // Valid prior A/B proof in CP-1; CP-2 is the repair checkpoint.
        checkpoints: [
          { missionId: missionId(SLUG), name: 'CP-1', goalCheck: [row('first'), row('second')], nextActionText: 'review' },
          { missionId: missionId(SLUG), name: 'CP-2', goalCheck: [row('second')], nextActionText: 'review' },
        ],
        brief: DRAFTED_BRIEF,
        successCriteria: ['first', 'second'],
        completedSuccessCriteria: [0, 1],
        declaredGates: ['npm test'],
        review,
      }),
      version: missionVersion(4),
    })),
    fileSystem: { existsSync: (target: string) => target === targetRef, readText: () => '', writeText: () => {}, listNames: () => [], listEntries: () => [] },
  });
  const loaded = await ports.missionServices!(ROOT, { missionDir: ROOT });
  const state = await loaded.store.load(missionId(SLUG));
  assert.equal(state.kind, 'found');
  if (state.kind !== 'found') { throw new Error('fixture missing'); }
  const readiness = evaluateMissionEvidence({ draftedInDb: true, checkpoints: state.mission.checkpoints,
    successCriteria: state.mission.successCriteria ?? [], completedSuccessCriteria: state.mission.completedSuccessCriteria ?? [],
    gates: state.mission.declaredGates ?? [], review: state.mission.review }, ports.fileSystem, ROOT);
  const result = await new HandoffCommandUseCase(ports).performHandoff(SLUG, runOptions(recorder));
  assert.equal(readiness.ready, result.ok, 'shared readiness and handoff agree');
  if (!result.ok) { assert.equal(readiness.findings[0].message, result.error); }
  return { result, recorder };
}

test('handoff rejects unchanged proof when ordinary F-id findings request a repair (TASK-2665)', async () => {
  const { result, recorder } = await handOffRepair('finding-F4', []);
  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /no fresh fix evidence recorded in this review round for \(any\)/);
  assert.match(result.error ?? '', /px checkpoint record --name CP-2/);
  assert.equal(classifyError(result.error ?? '').dispatchAction, 'AutoSendBack');
  assert.deepEqual(recorder.transitions, []);
});

test('handoff rejects a bounceback repair that wrote no fresh proof (TASK-2665)', async () => {
  const { result, recorder } = await handOffRepair('bounceback', []);
  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /no fresh fix evidence recorded in this review round for \(any\)/);
  assert.deepEqual(recorder.transitions, []);
});

test('handoff rejects a bounceback repair fresh only for a criterion the failed gate does not touch (TASK-2665)', async () => {
  const { result, recorder } = await handOffRepair('bounceback-gate', ['second']);
  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /no fresh fix evidence recorded in this review round for first/);
  assert.deepEqual(recorder.transitions, []);
});

test('handoff rejects a repair that leaves a criterion a finding names on stale proof (TASK-2665)', async () => {
  const { result, recorder } = await handOffRepair('classifier-criterion-1', ['second']);
  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /no fresh fix evidence recorded in this review round for first/);
  assert.deepEqual(recorder.transitions, []);
});

test('handoff rejects a fresh row for the wrong criterion when an F-id finding names another (TASK-2665)', async () => {
  const { result, recorder } = await handOffRepair('finding-F4-criterion-1', ['second']);
  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /no fresh fix evidence recorded in this review round for first/);
  assert.deepEqual(recorder.transitions, []);
  assert.equal((await handOffRepair('finding-F4-criterion-1', ['first'])).result.ok, true);
});

// Repair lifecycle over recorded state, using the real review transitions: a
// bounceback on a gate, a repair that replaces the gate-citing reference in the
// same checkpoint, an independent re-review approval, then the same gate failing
// again. Record writes through the real checkpoint service and handoff reads the
// very mission record saved. The repaired criterion stays owed for that gate;
// an unrelated criterion stays retained.
test('a repeated bounceback on the same gate keeps only the repaired criterion owed from record through handoff (TASK-2665)', async () => {
  const targetRef = path.join(ROOT, REPAIR_REF);
  const fileSystem = { existsSync: (target: string) => target === targetRef, readText: () => '', writeText: () => {}, listNames: () => [], listEntries: () => [] };
  const reviewer = agentFamily('claude');
  const implementer = agentFamily('codex');
  const eligibility = ConfiguredReviewerEligibility.fromReviewStep({ eligible: [reviewer], strategy: 'random' });
  const approve = (review: Review) => applyReviewerCommand(review, { type: 'approve', decidedAt: '2026-01-01T03:00:00Z', comment: null, source: { kind: 'local' } });
  const bounce = (review: Review, gate: string) => revokeApprovedDecision(review, review.rounds.length, {
    revokedAt: '2026-01-01T04:00:00Z', revokedBy: 'px', reason: 'gate', cause: { kind: 'integration-gate-failure', gate },
  });
  let review = bounce(approve(startReview({
    change: { kind: 'local-branch', sourceBranch: 'mission/task-2665', targetBranch: 'main' }, revision: changeRevision('approved-commit'),
  }, reviewer, implementer, '2026-01-01T00:00:00Z', eligibility)), 'unit-first');
  const id = missionId('task-2665');
  let mission = fixtureMission(id, { assignee: implementer,
    id, successCriteria: ['first', 'second'], completedSuccessCriteria: [0, 1], brief: DRAFTED_BRIEF, declaredGates: ['npm test'],
    checkpoints: [{ missionId: id, name: 'CP-1', nextActionText: 'review', goalCheck: [
      { criterion: 'first', evidence: `${REPAIR_REF} via unit-first` }, { criterion: 'second', evidence: `${REPAIR_REF} via unit-second`, recordedRound: 1 },
    ] }],
    review,
  });
  const store: MissionStore = {
    load: async () => ({ kind: 'found', mission, version: missionVersion(1) }),
    save: async (next) => { mission = next; return missionVersion(2); },
  };
  const service = new MissionCheckpointService(store, { fileSystem: fileSystem, rootFor: () => ROOT });
  const record = (criterion: string, evidence = REPAIR_REF) => service.record({
    operationId: 'op', missionId: id, capabilities: new Set(['checkpoint:record']), expectedVersion: missionVersion(1),
    checkpoint: { missionId: id, name: 'CP-1', nextActionText: 'continue', goalCheck: [{ criterion, evidence }] },
  });
  const handoff = async () => {
    const recorder = makeRecorder();
    const ports = makePorts(recorder, {
      fileSystem,
      reviewIdentity: { resolveReviewIdentity: async () => ({ forgejoUser: 'codex' }) },
      agentSelection: { eligibleAgentsForStep: () => ['claude', 'codex'], selectAgent: () => 'claude' },
      missionServices: async () => ({
        checkpoints: service,
        store,
        handoff: { recordNel: async () => ({ durableEvidence: [],  status: 'completed' as const }) },
        lifecycle: { transition: async request => {
          assert.ok('review' in request.command);
          if (!('review' in request.command)) { throw new Error('Expected review transition'); }
          mission = fixtureMission(id, { ...mission, status: 'review', review: request.command.review });
          return { durableEvidence: [],  status: 'completed' as const, value: handoffTransitionValue() };
        } },
      }),
    });
    return new HandoffCommandUseCase(ports).performHandoff(SLUG, runOptions(recorder));
  };
  // First bounceback on unit-first: the unrelated criterion cannot stand in for the affected one.
  assert.equal((await record('second')).status, 'failed');
  assert.equal((await record('first')).status, 'completed');
  // Complete the first repair handoff before the independent reviewer approves.
  assert.equal((await handoff()).ok, true);
  assert.equal(mission.review!.rounds.at(-1)!.reviewer, reviewer);
  assert.equal(mission.review!.rounds.at(-1)!.implementer, implementer);
  mission = { ...mission, review: approve(mission.review!) } as Mission;

  // A reviewer-requested repair replaces A without a failed gate. Its historical
  // unit-first obligation must survive, while stamped B remains unrelated.
  review = bounce(mission.review!, 'unit-first');
  review = applyReviewerCommand(review, { type: 'request-changes', decidedAt: '2026-01-01T05:00:00Z',
    comment: null, findings: [{ id: reviewFindingId('F4'), summary: 'Success criterion 1 needs a repair', location: null }] });
  mission = { ...mission, status: 'active', review } as Mission;
  assert.equal((await record('first', `${REPAIR_REF} via unit-other`)).status, 'completed');
  mission = { ...mission, review: applyImplementerCommand(mission.review!, {
    type: 'submit-resolution', respondedAt: '2026-01-01T06:00:00Z',
    resolutions: [{ findingId: reviewFindingId('F4'), kind: 'fixed', evidence: REPAIR_REF }],
    resultingRevision: changeRevision('reviewer-repair'),
  }) } as Mission;
  assert.equal((await handoff()).ok, true);
  mission = { ...mission, review: approve(mission.review!) } as Mission;

  // A different gate repair must accumulate, rather than replace, gate history.
  mission = { ...mission, status: 'active', review: bounce(mission.review!, 'unit-second') } as Mission;
  assert.equal((await record('second')).status, 'completed');
  assert.equal((await handoff()).ok, true);
  mission = { ...mission, review: approve(mission.review!) } as Mission;
  mission = { ...mission, status: 'active', review: bounce(mission.review!, 'unit-other') } as Mission;
  assert.equal((await record('first')).status, 'completed');
  assert.equal((await handoff()).ok, true);
  mission = { ...mission, review: approve(mission.review!) } as Mission;

  mission = { ...mission, status: 'active', review: bounce(mission.review!, 'unit-first') } as Mission;
  assert.equal((await record('second')).status, 'failed', 'repaired first is still owed for unit-first');
  const refused = await handoff();
  assert.equal(refused.ok, false);
  assert.match(refused.error ?? '', /no fresh fix evidence recorded in this review round for first/);
  assert.equal((await record('first')).status, 'completed');
  const rows = mission.checkpoints[0].goalCheck;
  assert.deepEqual(rows[0].repairedGates, ['unit-first', 'unit-other']);
  assert.deepEqual(rows[1].repairedGates, ['unit-second']);
  assert.equal((await handoff()).ok, true);
  assert.equal(mission.review!.rounds.at(-1)!.reviewer, reviewer);
  assert.equal(mission.review!.rounds.at(-1)!.implementer, implementer);
  mission = { ...mission, review: approve(mission.review!) } as Mission;
  assert.equal(mission.review!.rounds.at(-1)!.decision!.kind, 'approved');
});

test('handoff accepts a partial fresh repair that keeps unrelated retained proof (TASK-2665)', async () => {
  const { result, recorder } = await handOffRepair('finding-F4', ['first']);
  assert.equal(result.ok, true);
  assert.deepEqual(recorder.transitions, ['review']);
});

test('handoff accepts a repair that re-evidences the criterion a finding names (TASK-2665)', async () => {
  const { result } = await handOffRepair('classifier-criterion-1', ['first']);
  assert.equal(result.ok, true);
});

// Readiness and both handoff paths share recorded policies (TASK-2713).
import { evaluateMissionEvidence, type EvidenceContract } from '../../../src/application/mission-evidence-readiness.js';
import { HandoffContractVerifier } from '../../../src/application/handoff-contract.js';

test('readiness reports CP-5 and CP-6 together with coverage and every bad reference (TASK-2713)', () => {
  const recorder = makeRecorder();
  const ports = makePorts(recorder);
  const contract: EvidenceContract = {
    draftedInDb: true, gates: [], review: null, successCriteria: ['first', 'second'], completedSuccessCriteria: [0, 1],
    checkpoints: [1, 2, 3, 4, 5, 6].map(number => ({ missionId: missionId(SLUG), name: `CP-${number}`, nextActionText: 'continue',
      goalCheck: number < 5 ? [{ criterion: 'first', evidence: 'unresolvable proof' }] : [] })),
  };
  const result = evaluateMissionEvidence(contract, ports.fileSystem, ROOT);
  assert.equal(result.ready, false);
  assert.deepEqual(result.findings.filter(item => item.code === 'missing-checkpoint').map(item => item.checkpoint), ['CP-5', 'CP-6']);
  assert.equal(result.findings.filter(item => item.code === 'unverifiable-reference').length, 4);
  assert.deepEqual(result.findings.filter(item => item.code === 'uncovered-criterion').map(item => item.criterion), ['second']);
  const handoff = new HandoffContractVerifier(ports).verifyCheckpointEvidence(SLUG, { ...contract, ok: true }, {
    rootDir: ROOT, missionDirPath: ROOT, log: recorder.log.push.bind(recorder.log), error: recorder.errors.push.bind(recorder.errors),
  });
  assert.equal('error' in handoff && handoff.error, result.findings[0].message);
});

test('readiness prioritizes a typed human-only blocker over incomplete evidence and prose (TASK-2713)', () => {
  const ports = makePorts(makeRecorder());
  const contract: EvidenceContract = { draftedInDb: true, gates: ['npm test'], review: null,
    successCriteria: ['first'], completedSuccessCriteria: [], checkpoints: [{ missionId: missionId(SLUG), name: 'CP-5', goalCheck: [],
      nextActionText: 'Blocker resolved; all done', repair: { incidentId: 'incident', command: 'npm test', authorizedGates: ['npm test'],
        authorizedCriteria: ['first'], attempt: 1, evidenceRecorded: false, verified: false,
        blocker: { command: 'npm test', diagnostic: 'contradictory requirement', authorityReason: 'locked contract', proposedCorrection: 'operator decision' } } }] };
  const result = evaluateMissionEvidence(contract, ports.fileSystem, ROOT);
  assert.equal(result.primaryStopReason, 'human-only-contract-blocker');
  assert.ok(result.findings.some(item => item.code === 'missing-checkpoint'));
  assert.ok(result.findings.some(item => item.code === 'incomplete-criterion'));
  assert.deepEqual(contract.checkpoints[0].goalCheck, []);
});

test('checkpoint readiness service preserves state for ready and incomplete evidence (TASK-2713)', async () => {
  const id = missionId(SLUG);
  const recorder = makeRecorder();
  const fileSystem = makePorts(recorder).fileSystem;
  let mission = { id, brief: DRAFTED_BRIEF, successCriteria: ['first'], completedSuccessCriteria: [0],
    declaredGates: ['npm test'], checkpoints: [{ missionId: id, name: 'CP-1', goalCheck: [], nextActionText: 'record' }],
    review: null } as unknown as Mission;
  let writes = 0;
  const store: MissionStore = {
    load: async () => ({ kind: 'found', mission, version: missionVersion(7) }),
    save: async () => { writes += 1; throw new Error('readiness must not save'); },
  };
  const service = new MissionCheckpointService(store, { fileSystem, rootFor: () => ROOT });
  const request = { operationId: 'read', missionId: id, capabilities: new Set(), expectedVersion: missionVersion(7) } as never;
  const before = structuredClone(mission);
  const incomplete = await service.check(request);
  assert.equal(incomplete.status, 'completed');
  if (incomplete.status !== 'completed') throw new Error('missing diagnostic');
  const diagnostic = incomplete.value as ReturnType<typeof evaluateMissionEvidence> & { version: number; slug: string };
  assert.equal(diagnostic.version, 7);
  assert.equal(diagnostic.slug, id);
  assert.equal(diagnostic.ready, false);
  assert.equal(diagnostic.primaryStopReason, 'missing-checkpoint');
  assert.ok(diagnostic.findings.some(finding => finding.code === 'uncovered-criterion'));
  assert.deepEqual(mission, before);
  mission = { ...mission, checkpoints: [{ ...mission.checkpoints[0], goalCheck: [{ criterion: 'first', evidence: REPAIR_REF }] }] };
  const readyBefore = structuredClone(mission);
  const ready = await service.check(request);
  assert.equal(ready.status, 'completed');
  if (ready.status !== 'completed') throw new Error('missing diagnostic');
  const readyDiagnostic = ready.value as ReturnType<typeof evaluateMissionEvidence>;
  assert.equal(readyDiagnostic.ready, true);
  assert.deepEqual(readyDiagnostic.findings, []);
  assert.deepEqual(mission, readyBefore);
  assert.equal(writes, 0);
});

test('operator correction resumes CP-3 while readiness and handoff retain missing evidence obligations (TASK-2803)', async () => {
  const { inMemoryTransitionStore } = await import('../../fixtures/mission-builders.js');
  const { RepairCheckpointService } = await import('../../../src/application/repair-checkpoint-service.js');
  const { renderLaunchContext } = await import('../../../src/application/mission-brief-service.js');
  const id = missionId(SLUG);
  const store = inMemoryTransitionStore(fixtureMission(SLUG, { assignee: agentFamily('custom'), brief: DRAFTED_BRIEF,
    successCriteria: ['first', 'unfinished'], completedSuccessCriteria: [0], declaredGates: ['npm test'],
    checkpoints: [
      ...['CP-1', 'CP-2'].map(name => ({ missionId: id, name, goalCheck: [{ criterion: 'first', evidence: REPAIR_REF }], nextActionText: 'CP-3' })),
      ...['CP-3', 'CP-4'].map(name => ({ missionId: id, name, goalCheck: [], nextActionText: 'implement' })),
    ] }));
  const recorder = makeRecorder();
  const ports = makePorts(recorder, { ...contractServices(() => store.load()) });
  const service = new MissionCheckpointService(store, { fileSystem: ports.fileSystem, rootFor: () => ROOT });
  const repair = new RepairCheckpointService(store);
  await repair.open({ slug: SLUG, incidentId: 'stale', command: 'npm test', attempt: 1 });
  await repair.report({ operationId: 'report', missionId: id, capabilities: new Set(['checkpoint:record']), name: 'CP-5',
    blocker: { command: 'npm test', diagnostic: 'decision missing', authorityReason: 'human decision', proposedCorrection: 'record decision' } });
  const req = { operationId: 'check', missionId: id, capabilities: new Set(['checkpoint:record'] as const) };
  assert.equal((await service.check(req)).value?.primaryStopReason, 'human-only-contract-blocker');
  const handoff = () => new HandoffCommandUseCase(ports).performHandoff(SLUG, runOptions(recorder));
  assert.match((await handoff()).error ?? '', /human review/);
  assert.equal((await service.correctInvalidContract({ ...req, capabilities: new Set(['checkpoint:correct']), name: 'CP-5',
    operator: 'operator', decision: 'CP-2 decision already recorded', evidence: REPAIR_REF })).status, 'completed');
  const readiness = (await service.check(req)).value!;
  assert.equal(readiness.ready, false);
  assert.equal(readiness.primaryStopReason, 'missing-checkpoint');
  assert.deepEqual(readiness.findings.filter(item => item.code === 'missing-checkpoint').map(item => item.checkpoint), ['CP-3', 'CP-4', 'CP-5']);
  assert.ok(readiness.findings.some(item => item.code === 'incomplete-criterion' && item.criterion === 'unfinished'));
  const current = store.mission();
  assert.match(renderLaunchContext({ brief: current.brief!, checkpoints: current.checkpoints, declaredGates: current.declaredGates!, latestCheckpoint: current.checkpoints[1] }), /Next checkpoint: CP-3/);
  assert.match((await handoff()).error ?? '', /missing.*CP-3, CP-4, CP-5/i);
  assert.deepEqual(recorder.transitions, []);
  assert.deepEqual(recorder.spawned, []);
  assert.deepEqual(recorder.gatekeeperCalls, []);
  // Normal final recording still cannot invent coverage for unfinished work.
  const rejected = await service.record({ ...req, checkpoint: { missionId: id, name: 'CP-5',
    goalCheck: [{ criterion: 'first', evidence: REPAIR_REF }], nextActionText: 'handoff' } });
  assert.equal(rejected.status, 'failed');
  assert.match(rejected.error?.message ?? '', /Uncovered criteria: unfinished/);
  await assert.rejects(repair.verify(SLUG, 'CP-5'), /fresh authorized evidence/);
});

test('operator correction clears obsolete impossible repair criteria without bypassing readiness (TASK-2808)', async () => {
  const { inMemoryTransitionStore } = await import('../../fixtures/mission-builders.js');
  const { RepairCheckpointService } = await import('../../../src/application/repair-checkpoint-service.js');
  const id = missionId(SLUG);
  const impossible = 'GitHub-hosted acceptance before pre-handoff publication';
  const store = inMemoryTransitionStore(fixtureMission(SLUG, { assignee: agentFamily('custom'), brief: DRAFTED_BRIEF,
    successCriteria: ['first', impossible], completedSuccessCriteria: [0], declaredGates: ['npm test'],
    checkpoints: [{ missionId: id, name: 'CP-1', goalCheck: [{ criterion: 'first', evidence: REPAIR_REF }], nextActionText: 'repair' }] }));
  const recorder = makeRecorder();
  const ports = makePorts(recorder, { ...contractServices(() => store.load()),
    fileSystem: { existsSync: target => target === path.join(ROOT, REPAIR_REF), readText: () => '', listNames: () => [], listEntries: () => [] } });
  const service = new MissionCheckpointService(store, { fileSystem: ports.fileSystem, rootFor: () => ROOT });
  const repair = new RepairCheckpointService(store);
  await repair.open({ slug: SLUG, incidentId: 'impossible-criterion', command: 'npm test', attempt: 1 });
  await store.save({ ...store.mission(), successCriteria: ['first'] } as Mission);
  const req = { operationId: 'criteria-correction', missionId: id, capabilities: new Set(['checkpoint:record'] as const) };
  const check = async () => (await service.check(req)).value!;
  assert.ok((await check()).findings.some(item => item.code === 'repair-contract-changed'));
  const handoff = () => new HandoffCommandUseCase(ports).performHandoff(SLUG, runOptions(recorder));
  assert.match((await handoff()).error ?? '', /success criteria changed/);
  await repair.report({ ...req, name: 'CP-2', blocker: { command: 'npm test', diagnostic: impossible,
    authorityReason: 'operator owns locked criteria', proposedCorrection: 'remove impossible criterion' } });
  assert.equal((await service.correctInvalidContract({ ...req, capabilities: new Set(['checkpoint:correct']), name: 'CP-2',
    operator: 'operator', decision: 'Accept removal of impossible criterion', evidence: REPAIR_REF })).status, 'completed');
  assert.equal((await check()).findings.some(item => item.code === 'repair-contract-changed'), false);
  assert.deepEqual(store.mission().checkpoints[1].repair!.authorizedCriteria, ['first']);
  assert.equal((await check()).ready, false, 'carried evidence is not fresh repair proof');
  assert.match((await handoff()).error ?? '', /missing.*CP-2/i);
  await store.save({ ...store.mission(), completedSuccessCriteria: [] } as Mission);
  assert.ok((await check()).findings.some(item => item.code === 'incomplete-criterion'));
  assert.equal((await service.record({ ...req, checkpoint: { missionId: id, name: 'CP-2', nextActionText: 'handoff',
    goalCheck: [{ criterion: 'first', evidence: 'nonexistent-proof.txt' }] } })).status, 'failed');
  assert.equal((await service.record({ ...req, checkpoint: { missionId: id, name: 'CP-2', nextActionText: 'handoff',
    goalCheck: [{ criterion: 'first', evidence: REPAIR_REF }] } })).status, 'completed');
  assert.ok((await check()).findings.some(item => item.code === 'incomplete-criterion'));
  await store.save({ ...store.mission(), completedSuccessCriteria: [0] } as Mission);
  assert.equal((await check()).ready, true);
  assert.equal((await handoff()).ok, true);
  assert.ok(recorder.transitions.length > 0, 'normal handoff transition is reached');
  await store.save({ ...store.mission(), successCriteria: ['first', 'later change'] } as Mission);
  assert.ok((await check()).findings.some(item => item.code === 'repair-contract-changed'));
});


test('legacy corrected criteria require explicit reconciliation, current proof and original handoff gates (TASK-2809)', async () => {
  const { inMemoryTransitionStore } = await import('../../fixtures/mission-builders.js');
  const { RepairCheckpointService } = await import('../../../src/application/repair-checkpoint-service.js');
  const id = missionId(SLUG);
  const blocker = { command: 'npm test', diagnostic: 'old contradictory criterion', authorityReason: 'operator owns criteria', proposedCorrection: 'amend criteria' };
  const store = inMemoryTransitionStore(JSON.parse(JSON.stringify(fixtureMission(SLUG, {
    assignee: agentFamily('custom'), brief: DRAFTED_BRIEF, successCriteria: ['first', 'amended'], completedSuccessCriteria: [0],
    declaredGates: ['npm test'], checkpoints: [
      { missionId: id, name: 'CP-1', goalCheck: [{ criterion: 'first', evidence: REPAIR_REF }], nextActionText: 'CP-2' },
      { missionId: id, name: 'CP-2', goalCheck: [], nextActionText: 'record current proof', repair: {
        incidentId: 'legacy-task-2807', command: 'npm test', authorizedGates: ['npm test'], authorizedCriteria: ['first', 'old'],
        attempt: 2, evidenceRecorded: false, verified: false, acknowledgedBlocker: blocker,
        acknowledgedBy: 'original operator', acknowledgedAt: '2026-10-20T12:00:00Z',
        corrections: [{ blocker, operator: 'original operator', decision: 'criteria amended', evidence: REPAIR_REF,
          occurredAt: '2026-10-20T12:00:00Z', missionRevision: 2 }],
      } },
    ],
  }))) as Mission, { version: 3 });
  const recorder = makeRecorder();
  const commands: string[] = [];
  let gateExit = 1;
  const ports = makePorts(recorder, { ...contractServices(() => store.load()), process: {
    spawnSync: (_cmd, args) => { commands.push(args.join(' ')); return { status: gateExit, stdout: '', stderr: 'original gate diagnostic' }; },
  } });
  const service = new MissionCheckpointService(store, { fileSystem: ports.fileSystem, rootFor: () => ROOT });
  const repair = new RepairCheckpointService(store);
  const req = { operationId: 'read', missionId: id, capabilities: new Set(['checkpoint:record'] as const) };
  const handoff = () => new HandoffCommandUseCase(ports).performHandoff(SLUG, runOptions(recorder));
  const before = structuredClone(await store.load());
  assert.equal((await service.check(req)).value?.primaryStopReason, 'repair-contract-changed');
  await service.read(req);
  assert.match((await handoff()).error ?? '', /success criteria changed/);
  await assert.rejects(repair.open({ slug: SLUG, incidentId: 'legacy-task-2807', command: 'npm test', attempt: 3 }), /operator decision/);
  assert.deepEqual(await store.load(), before, 'reads and automatic reopening never refresh authority');
  assert.equal((await service.correctInvalidContract({ ...req, capabilities: new Set(['checkpoint:correct']), name: 'CP-2',
    operator: 'operator', decision: 'authorize amended criteria', evidence: REPAIR_REF })).status, 'completed');
  assert.equal((await service.check(req)).value?.primaryStopReason, 'missing-checkpoint');
  assert.equal((await handoff()).ok, false);
  await assert.rejects(repair.verify(SLUG, 'CP-2'), /fresh authorized evidence/);
  assert.equal(commands.length, 0);
  assert.deepEqual(recorder.transitions, []);
  assert.equal((await service.record({ ...req, checkpoint: { missionId: id, name: 'CP-2',
    goalCheck: ['first', 'amended'].map(criterion => ({ criterion, evidence: REPAIR_REF })), nextActionText: 'handoff' } })).status, 'completed');
  assert.equal((await handoff()).ok, false, 'completion remains independently required');
  await store.save({ ...store.mission(), completedSuccessCriteria: [0, 1] });
  assert.equal((await service.check(req)).value?.ready, true);
  assert.equal((await handoff()).ok, false, 'failed original gate still stops handoff');
  assert.ok(commands.some(command => command.includes('npm test')));
  assert.deepEqual(recorder.transitions, []);
  gateExit = 0;
  const success = await handoff();
  assert.equal(success.ok, true, success.error ?? 'handoff failed');
  assert.deepEqual(recorder.transitions, ['review']);
  assert.equal(store.mission().checkpoints[1].repair!.verified, false, 'handoff is not fabricated repair certification');
});
