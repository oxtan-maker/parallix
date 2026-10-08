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
import { SLUG, ROOT, makeRecorder, makePorts, runOptions } from '../../helpers/handoff-ports.js';
import { MissionCheckpointService } from '../../../src/application/mission-checkpoint-service.js';
import { missionVersion, type MissionStore } from '../../../src/application/domain-ports.js';
import { missionId, type Mission } from '../../../src/domain/mission.js';
import { classifyError } from '../../../src/application/failure-classification.js';
import { reviewFindingId, applyImplementerCommand, applyReviewerCommand, changeRevision, ConfiguredReviewerEligibility, revokeApprovedDecision, startReview, type Review } from '../../../src/domain/review.js';
import { agentFamily } from '../../../src/domain/agents.js';

function contractServices(load: () => Promise<unknown>) {
  return {
    missionServices: async () => ({
      checkpoints: { record: async () => ({ status: 'completed' }) },
      lifecycle: { transition: async () => ({ status: 'completed', value: { version: 3 } }) },
      store: { load },
      handoff: { recordNel: async () => ({ status: 'completed' }) },
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
    subject: { change: {} as never, revision: 'rev' as never }, reviewer: 'codex' as never,
    implementer: 'custom' as never, startedAt: '2026-01-01T00:00:00Z',
    disposition: null, reviewerRetryCount: 0, implementerRetryCount: 0,
  };
  const findingId = kind.startsWith('finding-F4') ? 'F4' : 'success-criterion-1';
  const rounds = kind.startsWith('bounceback')
    ? [
      { ...base, number: 1, phase: 'approved' as never, response: null, decision: {
        kind: 'approved', decidedAt: '2026-01-01T01:00:00Z', comment: null, source: { kind: 'local' },
        revocation: { revokedAt: '2026-01-01T02:00:00Z', revokedBy: 'px', reason: 'gate', cause: { kind: 'integration-gate-failure', gate: kind === 'bounceback-gate' ? 'unit-first' : 'g' } },
      } },
      { ...base, number: 2, phase: 'reviewing' as never, response: null, decision: null },
    ]
    : [{
      ...base, number: 1, phase: 'fixing' as never,
      decision: { kind: 'changes-requested', decidedAt: '2026-01-01T01:00:00Z', comment: null, findings: [
        { id: reviewFindingId(findingId), summary: kind === 'finding-F4-criterion-1' ? 'Success criterion 1 has no fix evidence' : 'repair', location: null },
      ] },
      // The implementer's resolution precedes the repair handoff, which then
      // begins the next round.
      response: { kind: 'resolved', respondedAt: '2026-01-01T02:00:00Z', resolutions: [
        { findingId: reviewFindingId(findingId), kind: 'fixed', evidence: REPAIR_REF },
      ], resultingRevision: 'rev' as never },
    }];
  const freshRound = rounds.length;
  const review = { rounds, intervention: null, stageLaunches: [], reviewEvents: [] } as unknown as Review;
  const row = (criterion: string) => ({
    criterion, evidence: criterion === 'first' ? `${REPAIR_REF} via unit-first` : REPAIR_REF, recordedRound: freshCriteria.includes(criterion) ? freshRound : 0,
  });
  const recorder = makeRecorder();
  const ports = makePorts(recorder, {
    ...contractServices(async () => ({
      kind: 'found',
      mission: {
        // Valid prior A/B proof in CP-1; CP-2 is the repair checkpoint.
        checkpoints: [
          { name: 'CP-1', goalCheck: [row('first'), row('second')], nextAction: 'review' },
          { name: 'CP-2', goalCheck: [row('second')] },
        ],
        brief: DRAFTED_BRIEF,
        successCriteria: ['first', 'second'],
        completedSuccessCriteria: [0, 1],
        declaredGates: ['npm test'],
        review,
      },
      version: 4,
    })),
    fileSystem: { existsSync: (target: string) => target === targetRef, readText: () => '', writeText: () => {}, listNames: () => [], listEntries: () => [] },
  });
  const result = await new HandoffCommandUseCase(ports).performHandoff(SLUG, runOptions(recorder));
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
  let mission = {
    id, successCriteria: ['first', 'second'], completedSuccessCriteria: [0, 1], brief: DRAFTED_BRIEF, declaredGates: ['npm test'],
    checkpoints: [{ missionId: id, name: 'CP-1', nextActionText: 'review', goalCheck: [
      { criterion: 'first', evidence: `${REPAIR_REF} via unit-first` }, { criterion: 'second', evidence: `${REPAIR_REF} via unit-second`, recordedRound: 1 },
    ] }],
    review,
  } as unknown as Mission;
  const store: MissionStore = {
    load: async () => ({ kind: 'found', mission, version: missionVersion(1) }) as never,
    save: async (next) => { mission = next; return missionVersion(2); },
  };
  const service = new MissionCheckpointService(store, { fileSystem: fileSystem as never, rootFor: () => ROOT });
  const record = (criterion: string, evidence = REPAIR_REF) => service.record({
    operationId: 'op', missionId: id, capabilities: new Set(['checkpoint:record']), expectedVersion: missionVersion(1),
    checkpoint: { missionId: id, name: 'CP-1', nextActionText: 'continue', goalCheck: [{ criterion, evidence }] },
  } as never);
  const handoff = async () => {
    const recorder = makeRecorder();
    const ports = makePorts(recorder, {
      fileSystem,
      reviewIdentity: { resolveReviewIdentity: async () => ({ forgejoUser: 'codex' }) },
      agentSelection: { eligibleAgentsForStep: () => ['claude', 'codex'], selectAgent: () => 'claude' },
      missionServices: async () => ({
        checkpoints: service,
        store,
        handoff: { recordNel: async () => ({ status: 'completed' }) },
        lifecycle: { transition: async (request: { command: { review: Review } }) => {
          mission = { ...mission, status: 'review', review: request.command.review } as Mission;
          return { status: 'completed', value: { version: 3 } };
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
