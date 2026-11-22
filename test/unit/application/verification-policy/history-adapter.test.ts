import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveBelief } from '../../../../src/application/verification-policy/belief.js';
import { parsePolicyArtifact } from '../../../../src/application/verification-policy/policy-artifact.js';
import { syntheticPolicyArtifactV2 } from './policy-artifact.fixture.js';
import { adaptVerificationHistory, readVerificationHistory,
  type VerificationHistoryFacts } from '../../../../src/application/verification-policy/history-adapter.js';
import { applyImplementerCommand, applyReviewerCommand, changeRevision, recordReviewerResult,
  reviewFindingId, invalidateBlocker, revokeApprovedDecision, type Review,
  type ReviewRound } from '../../../../src/domain/review.js';
import { agentFamily } from '../../../../src/domain/agents.js';
import { missionId } from '../../../../src/domain/mission.js';
import { repositoryId } from '../../../../src/domain/repository.js';
import { fixtureMission, pendingReview } from '../../../fixtures/mission-builders.js';
import type { IntegrationGateEvidence } from '../../../../src/application/ports/gate-evidence.js';
import type { CheckpointData } from '../../../../src/domain/checkpoint.js';
import type { RebaseMeasurement } from '../../../../src/application/projections/verification-observation-reader.js';
import type { ApprovalCoverage } from '../../../../src/domain/approval-coverage.js';

const at = (hour: number) => `2026-08-04T${String(hour).padStart(2, '0')}:00:00Z`;
const rev = (value: string) => changeRevision(value.padEnd(40, '0'));
const entries = (value: ReturnType<typeof adaptVerificationHistory>) => {
  assert.equal(value.ok, true, JSON.stringify(value));
  return value.ok ? value.entries : [];
};
const failure = (value: ReturnType<typeof adaptVerificationHistory>) => {
  assert.equal(value.ok, false, JSON.stringify(value));
  return value.ok ? null : value.failure.kind;
};

function start(): Review {
  const review = pendingReview('task-x', at(9));
  return { ...review, rounds: [{ ...review.rounds[0], subject: {
    ...review.rounds[0].subject, revision: rev('a'), baseline: rev('0'),
  } }] } as Review;
}

function decide(review: Review, kind: 'approve' | 'request-changes',
  source?: { kind: 'operator'; author: string }, revision = rev('a')): Review {
  return applyReviewerCommand(review, kind === 'approve'
    ? { type: kind, decidedAt: at(10), revision, comment: null, source: { kind: 'local' } }
    : { type: kind, decidedAt: at(10), revision, comment: null,
      findings: [{ id: reviewFindingId('f'), summary: 'fix', location: null }], ...source && { source } });
}

function repair(review: Review): Review {
  return applyImplementerCommand(review, { type: 'submit-resolution', respondedAt: at(11), resultingRevision: rev('b'),
    resolutions: [{ findingId: reviewFindingId('f'), kind: 'fixed', evidence: 'done' }] });
}

const row = (id: string, outcome: string, hour = 12) => ({ eventType: 'rebound.repair', createdAt: at(hour),
  eventData: JSON.stringify({ occurrenceId: id, reasonKind: 'gate-failure', area: 'integration gates', outcome }) });
const cp = (id: string, gateKey: string): CheckpointData => ({ missionId: missionId('task-x'), name: 'CP-9', goalCheck: [],
  nextActionText: 'repair', repair: { incidentId: id, gateKey, command: 'npm test', authorizedGates: [],
    authorizedCriteria: [], attempt: 1, evidenceRecorded: true, verified: true } });

function failedReview(failedGate = 'e2e'): Review {
  const approved = decide(start(), 'approve');
  const round = approved.rounds[0];
  const cause = { kind: 'integration-gate-failure' as const, gate: 'e2e' };
  return revokeApprovedDecision({ ...approved, rounds: [{ ...round, integrationRepairAssessment: {
    assessedAt: at(14), approvedRevision: rev('a'), candidateRevision: rev('c'), failedGate,
    outcome: 'mission-change-differs', repair: { startedAt: at(11), cause },
  } }] }, 1, { revokedAt: at(14), revokedBy: 'workflow', reason: 'gate', cause });
}

function gate(state: 'pass' | 'fail' | 'stale', revision = 'r', checkoutRevision = 'r'): IntegrationGateEvidence {
  return { checkout: { kind: 'present', revision: checkoutRevision, clean: true }, configured: ['e2e'], running: null,
    gates: [{ key: 'e2e', proof: state === 'pass' ? { state: 'current', revision, observedAt: at(13) }
      : { state: state === 'stale' ? 'stale' : 'absent', ...(state === 'stale' ? { revision: 'old', observedAt: at(8) } : {}) } as never,
    failure: state === 'fail' ? { state: 'current', revision, observedAt: at(13), exitCode: 1 } : null }] };
}

const mapped = (review: Review | null, gates: IntegrationGateEvidence | null = null,
  rows = [] as ReturnType<typeof row>[], checkpoints = [] as CheckpointData[], facts: VerificationHistoryFacts = {}) =>
  adaptVerificationHistory(review, gates, rows, checkpoints, facts);

test('maps authoritative verdicts and exact repairs while wrong-revision checks reset history (TASK-2859.07, TASK-2859.08)', () => {
  let multi = start();
  multi = recordReviewerResult(multi, { publicationId: 'p1', reviewerId: 'claude', agentFamily: agentFamily('claude'),
    revision: rev('a'), decision: 'changes-requested', findings: [], outcome: 'completed', status: 0, publishedAt: at(9) });
  assert.deepEqual(entries(mapped(decide(multi, 'approve'))), [{ kind: 'verdict', check: 'agent', passed: true }]);

  const human = decide(start(), 'request-changes', { kind: 'operator', author: 'magnus' });
  assert.deepEqual(entries(mapped(repair(human))), [
    { kind: 'verdict', check: 'human', passed: false }, { kind: 'repair', check: 'human' },
  ]);
  assert.deepEqual(entries(mapped(human)), [{ kind: 'verdict', check: 'human', passed: false }]);

  const blocked = decide(start(), 'request-changes');
  const continued = invalidateBlocker({ ...blocked, rounds: [{ ...blocked.rounds[0], disposition: 'BLOCKED' }] }, at(12));
  assert.deepEqual(entries(mapped(continued)), [{ kind: 'verdict', check: 'agent', passed: false }]);
  assert.deepEqual(entries(mapped(decide(start(), 'approve', undefined, rev('b')))), [{ kind: 'unmodelled-change' }]);

  const withdrawn = revokeApprovedDecision(decide(start(), 'approve'), 1,
    { revokedAt: at(14), revokedBy: 'magnus', reason: 'correction', cause: { kind: 'operator' } });
  assert.deepEqual(entries(mapped(withdrawn)), [
    { kind: 'verdict', check: 'agent', passed: true }, { kind: 'unmodelled-change' },
  ]);
});

test('maps landing failure and its verdict record, while exact and multi-gate repairs clear that record (TASK-2859.08, TASK-2867.02, TASK-2867.04)', () => {
  assert.deepEqual(entries(mapped(null, gate('pass'))), [{ kind: 'verdict', check: 'tests', passed: true }]);
  assert.deepEqual(mapped(null, gate('stale')), { ok: true, entries: [], record: { passed: [], failed: [] }, tests: 'not-current' });
  assert.deepEqual(entries(mapped(null, gate('pass', 'other'))), [{ kind: 'unmodelled-change' }]);
  const testsState = (gates: IntegrationGateEvidence | null) => { const value = mapped(null, gates); return value.ok ? value.tests : value.failure.kind; };
  assert.equal(testsState(gate('pass')), 'passed');
  assert.equal(testsState(gate('fail')), 'failed');
  assert.equal(testsState(gate('pass', 'other')), 'not-current', 'a changed-identity pass is not current');
  assert.equal(testsState({ ...gate('pass'), checkout: { kind: 'present', revision: 'r', clean: false },
    gates: [{ ...gate('stale').gates[0], proof: { state: 'stale', revision: 'r', observedAt: at(8) } }] }), 'not-current', 'same-revision stale inputs are not current');
  assert.equal(testsState(gate('none' as never)), 'unobserved', 'a configured gate with no run or receipt is no pass (PX-0072)');
  assert.equal(testsState({ ...gate('pass'), gates: [] }), 'unobserved', 'a configured gate with no recorded outcome is no pass');
  const gateRow = (key: string, proof: IntegrationGateEvidence['gates'][number]['proof'], failed?: { revision: string; observedAt: string }) =>
    ({ key, proof, failure: failed ? { state: 'current' as const, exitCode: 1, ...failed } : null });
  const two = (...gates: IntegrationGateEvidence['gates'][number][]): IntegrationGateEvidence => ({ ...gate('pass'), configured: ['e2e', 'docs'], gates });
  const current = (revision: string, observedAt = at(10)) => ({ state: 'current' as const, revision, observedAt });
  assert.equal(testsState(two(gateRow('e2e', { state: 'absent' }, { revision: 'r', observedAt: at(10) }), gateRow('docs', current('other')))), 'failed',
    'a matching durable failure outranks another gate whose evidence covers a different identity');
  assert.equal(testsState({ ...gate('pass'), gates: [gateRow('e2e', current('r', at(10)), { revision: 'other', observedAt: at(11) })] }), 'passed',
    'a newer failure from another identity cannot discard a current pass');
  assert.equal(testsState({ ...gate('pass'), gates: [gateRow('e2e', current('other', at(10)), { revision: 'r', observedAt: at(11) })] }), 'failed',
    'a matching failure still reports when the pass belongs to another identity');
  const partial = (state: 'pass' | 'fail' | 'stale') => ({ ...gate(state), configured: ['e2e', 'docs'] });
  assert.equal(testsState(partial('fail')), 'failed', 'a durable failure still counts when another configured gate has no row');
  assert.equal(testsState(partial('stale')), 'not-current', 'stale evidence still counts when another configured gate has no row');
  assert.equal(testsState(partial('pass')), 'unobserved', 'a pass for one of two configured gates is no pass');
  assert.equal(testsState({ ...gate('pass'), configured: [] }), 'unobserved');
  assert.equal(testsState({ ...gate('pass'), checkout: { kind: 'absent' } }), 'unobserved');

  const pending = mapped(null, gate('fail'));
  assert.deepEqual(pending.ok && pending.record, { passed: [], failed: ['tests'] });

  const failed = failedReview();
  const exact = mapped(failed, null, [row('same', 'advance'), row('same', 'pass', 13)], [cp('same', 'e2e')]);
  assert.deepEqual(entries(exact), [
    { kind: 'verdict', check: 'agent', passed: true },
    { kind: 'verdict', check: 'tests', passed: false },
    { kind: 'repair', check: 'tests' },
  ]);
  assert.deepEqual(exact.ok && exact.record, { passed: [], failed: [] });
  assert.equal(JSON.stringify(exact), JSON.stringify(mapped(JSON.parse(JSON.stringify(failed)), null,
    [row('same', 'advance'), row('same', 'pass', 13)], [cp('same', 'e2e')])));

  const multi = [cp('wide', 'e2e'), { ...cp('wide', 'unit'), name: 'CP-10' }];
  assert.deepEqual(entries(mapped(failed, null, [row('wide', 'pass')], multi)), [
    { kind: 'verdict', check: 'agent', passed: true },
    { kind: 'verdict', check: 'tests', passed: false },
    { kind: 'repair', check: 'tests' },
  ]);
  assert.deepEqual(entries(mapped(failed, gate('pass', 'other'), [], [],
    { identity: { branchHead: () => null, changeIdentity: revision => revision } })), [
    { kind: 'verdict', check: 'agent', passed: true },
    { kind: 'verdict', check: 'tests', passed: false },
    { kind: 'unmodelled-change' },
  ]);
});

test('a joint agent and human repair records both repaired checks but applies the last verdict transition once (TASK-2867.04)', async () => {
  const agentFailed = recordReviewerResult(start(), { publicationId: 'agent-failure', reviewerId: 'claude',
    agentFamily: agentFamily('claude'), revision: rev('a'), decision: 'changes-requested',
    findings: [{ id: reviewFindingId('agent-finding'), summary: 'agent finding', location: null }],
    outcome: 'completed', status: 0, publishedAt: at(9) });
  const jointlyFailed = decide(agentFailed, 'request-changes', { kind: 'operator', author: 'magnus' });
  const jointlyRepaired = repair(jointlyFailed);
  const mission = fixtureMission('task-x', { review: jointlyRepaired });
  const history = await readVerificationHistory({
    store: { load: async () => ({ kind: 'found' as const, mission, version: 1 as never }) },
    gates: { readIntegrationGates: async () => gate('stale') },
    history: { loadAllByTypeForMission: async () => [] }, lifecycle: { findByMissionId: async () => [] },
    operations: { all: async () => [] },
    identity: { branchHead: () => null, changeIdentity: (revision: string) => revision },
  }, { repositoryId: repositoryId('repo'), missionId: missionId('task-x') });
  assert.deepEqual(entries(history), [
    { kind: 'verdict', check: 'agent', passed: false },
    { kind: 'verdict', check: 'human', passed: false },
    { kind: 'repair', check: 'agent' },
    { kind: 'repair', check: 'human' },
  ]);
  assert.deepEqual(history.ok && history.record, { passed: [], failed: [] });

  const parsed = parsePolicyArtifact(syntheticPolicyArtifactV2());
  assert.equal(parsed.ok, true);
  if (!parsed.ok) { return; }
  const repairTransitions: string[] = [];
  const transition = new Proxy(parsed.artifact.transition, { get(target, key: string) {
    if (key.startsWith('repair-')) { repairTransitions.push(key); }
    return target[key];
  } });
  const belief = deriveBelief({ ...parsed.artifact, transition }, history.ok ? history.entries : []);
  assert.equal(belief.ok, true, JSON.stringify(belief));
  assert.deepEqual(repairTransitions, ['repair-human']);
});

test('preserves only coverage-backed approval after a completed landing repair (TASK-2859.08)', () => {
  const approved = decide(start(), 'approve');
  const cause = { kind: 'integration-gate-failure' as const, gate: 'e2e' };
  const retained = { ...approved, rounds: [{ ...approved.rounds[0], integrationRepairAssessment: {
    assessedAt: at(15), approvedRevision: rev('a'), candidateRevision: rev('c'), failedGate: 'e2e', outcome: 'retained' as const,
    repair: { startedAt: at(11), cause }, validation: { missionId: 'task-x', sha: rev('c'), baseline: rev('0'),
      hooks: ['e2e'], createdAt: at(14), reference: 'history:1' },
  } }] } as Review;
  const covers: ApprovalCoverage = { kind: 'covers', round: 1, approvedRevision: rev('a') };
  const facts = { approvalCoverage: new Map([[1, covers]]) };
  assert.deepEqual(entries(mapped(retained, null, [row('landing', 'pass')], [cp('landing', 'e2e')], facts)), [
    { kind: 'verdict', check: 'agent', passed: true },
    { kind: 'verdict', check: 'tests', passed: false },
    { kind: 'repair', check: 'tests' },
    { kind: 'retained-pass', check: 'agent' },
  ]);
  assert.equal(failure(mapped(retained, null, [row('landing', 'pass')], [cp('landing', 'e2e')])), 'unmodelled-history');
  const stale: ApprovalCoverage = { kind: 'stale', round: 1, approvedRevision: rev('a'),
    landedRevision: rev('c'), recorded: null };
  assert.equal(failure(mapped(retained, null, [row('landing', 'pass')], [cp('landing', 'e2e')],
    { approvalCoverage: new Map([[1, stale]]) })), 'contradiction');
  const unverifiable: ApprovalCoverage = { kind: 'unverifiable', round: 1,
    approvedRevision: null, reason: 'approved revision is unavailable' };
  assert.equal(failure(mapped(retained, null, [row('landing', 'pass')], [cp('landing', 'e2e')],
    { approvalCoverage: new Map([[1, unverifiable]]) })), 'unavailable');
});

function rebase(outcome: RebaseMeasurement['outcome'], before: string | null, after: string | null, id = 'rb'): RebaseMeasurement {
  return { id, repositoryId: 'repo', missionId: 'task-x', operationId: 'op', generation: 1, sourceId: id,
    stage: 'direct-rebase', attempt: 1, outcome, baseBranch: 'main', revisionBefore: before, revisionAfter: after,
    conflicts: [], occurredAt: at(12) };
}

test('uses stable change identity for rebases and marks re-scope or unmodelled revision movement (TASK-2859.08)', () => {
  const ids: Record<string, string> = { before: 'same', clean: 'same', changed: 'different',
    [rev('b')]: 'round-change', [rev('c')]: 'round-change' };
  const identity = { branchHead: () => null, changeIdentity: (revision: string) => ids[revision] ?? null };
  assert.deepEqual(entries(mapped(null, null, [], [],
    { identity, rebases: [rebase('clean', 'before', 'clean')] })), []);
  // Rebases are outside the model (PX-0074.01): even one that changed the patch leaves the judged state as it was.
  assert.deepEqual(entries(mapped(null, null, [], [],
    { identity, rebases: [rebase('resolved', 'before', 'changed')] })), []);
  assert.deepEqual(entries(mapped(null, null, [], [],
    { identity, rebases: [rebase('clean', 'missing', 'clean')] })), []);
  const approved = decide(start(), 'approve');
  const currentGateHistory = entries(mapped(approved, gate('pass', rev('c'), rev('c')), [], [], { identity }));
  assert.deepEqual(currentGateHistory, [
    { kind: 'verdict', check: 'agent', passed: true },
    { kind: 'verdict', check: 'tests', passed: true },
  ]);
  assert.deepEqual(entries(mapped(approved, gate('pass', rev('b'), rev('c')), [], [],
    { identity, rebases: [rebase('clean', rev('b'), rev('c'))] })), currentGateHistory);

  const first = repair(decide(start(), 'request-changes')).rounds[0];
  const stableRound = (subjectRevision: ReturnType<typeof rev>): ReviewRound => ({ ...first,
    number: 2, startedAt: at(12), subject: { ...first.subject, revision: subjectRevision }, decision: {
      kind: 'approved', revision: rev('c'), decidedAt: at(13), comment: null, source: { kind: 'local' },
    }, response: null, phase: 'approved', disposition: 'APPROVED' });
  const stableEntries = [
    { kind: 'verdict', check: 'agent', passed: false }, { kind: 'repair', check: 'agent' },
    { kind: 'verdict', check: 'agent', passed: true },
  ];
  assert.deepEqual(entries(mapped({ ...start(), rounds: [first, stableRound(rev('c'))] }, null, [], [],
    { identity })), stableEntries);
  assert.deepEqual(entries(mapped({ ...start(), rounds: [first, stableRound(rev('b'))] }, null, [], [],
    { identity })), stableEntries);

  const second: ReviewRound = { ...first, number: 2, startedAt: at(12), subject: { ...first.subject, revision: rev('b'),
    change: { ...first.subject.change, targetBranch: 'release' } }, decision: {
    kind: 'approved', revision: rev('b'), decidedAt: at(13), comment: null, source: { kind: 'local' },
  }, response: null, phase: 'approved', disposition: 'APPROVED' };
  assert.deepEqual(entries(mapped({ ...start(), rounds: [first, second] })), [
    { kind: 'verdict', check: 'agent', passed: false }, { kind: 'repair', check: 'agent' },
    { kind: 'unmodelled-change' }, { kind: 'verdict', check: 'agent', passed: true },
  ]);
});

test('retained approval survives a clean rebase and drops on an identity-changing rebase (TASK-2867.04)', () => {
  const ids: Record<string, string> = { [rev('b')]: 'same-change', [rev('c')]: 'same-change', [rev('d')]: 'changed' };
  const identity = { branchHead: () => null, changeIdentity: (revision: string) => ids[revision] ?? null };
  const approved = decide(start(), 'approve');
  const standing = [{ kind: 'verdict', check: 'agent', passed: true }, { kind: 'verdict', check: 'tests', passed: true }];
  assert.deepEqual(entries(mapped(approved, gate('pass', rev('b'), rev('c')), [], [],
    { identity, rebases: [rebase('clean', rev('b'), rev('c'))] })), standing, 'the clean rebase carried the judged revision');
  const changed = mapped(approved, gate('pass', rev('b'), rev('d')), [], [],
    { identity, rebases: [rebase('resolved', rev('b'), rev('d'))] });
  assert.deepEqual(entries(changed),
    [{ kind: 'verdict', check: 'agent', passed: true }, { kind: 'unmodelled-change' }],
    'an identity-changing rebase invalidates the approval and gate result');
  assert.deepEqual(changed.ok && changed.record, { passed: [], failed: [] });
  // An agent that left the rebase unfinished and completed it by hand: the next rebase observation starts from the head it left.
  const unfinished = [{ ...rebase('failed', rev('b'), rev('b'), 'run-1'), occurredAt: at(11) },
    { ...rebase('no-op', rev('c'), rev('c'), 'run-2'), occurredAt: at(12) }];
  assert.deepEqual(entries(mapped(approved, gate('pass', rev('b'), rev('c')), [], [], { identity, rebases: unfinished })), standing,
    'a failed rebase that was later completed restores the judged state');
  assert.deepEqual(entries(mapped(approved, gate('pass', rev('b'), rev('d')), [], [], { identity, rebases: unfinished.slice(0, 1) })),
    [{ kind: 'verdict', check: 'agent', passed: true }, { kind: 'unmodelled-change' }], 'an unfinished rebase explains no movement by itself');
  const [round] = approved.rounds;
  const switched: typeof approved = { ...approved, rounds: [{ ...round, implementer: agentFamily('codex'), reviewer: agentFamily('custom') }] };
  assert.deepEqual(entries(mapped(switched, null, [], [], { identity })), entries(mapped(approved, null, [], [], { identity })));
});

test('declared-gates returns reset history and malformed facts fall back with typed reasons (TASK-2859.08)', () => {
  const lane = { repositoryId: 'repo', missionId: 'task-x', fromStatus: 'review', toStatus: 'active',
    trigger: 'request-changes', agent: 'codex', occurredAt: at(12), idempotencyKey: 'return',
    returnIdentity: { stage: 'declared-gates' as const, operationId: 'op', operationGeneration: 1 } };
  assert.deepEqual(entries(mapped(null, null, [], [], { lifecycle: [lane] })), [{ kind: 'unmodelled-change' }]);
  assert.equal(failure(mapped(null, null, [{ ...row('x', 'pass'), eventData: '{' }])), 'invalid');
  const both = gate('pass');
  const withFailure = (observedAt: string) => mapped(null, { ...both, gates: [{ ...both.gates[0],
    failure: { state: 'current', revision: 'r', observedAt, exitCode: 1 } }] });
  const outcome = (value: ReturnType<typeof withFailure>) => ({ tests: value.ok ? value.tests : value.failure.kind, entries: entries(value) });
  assert.deepEqual(outcome(withFailure(at(12))), { tests: 'passed', entries: [{ kind: 'verdict', check: 'tests', passed: true }] }, 'a rerun pass after a failure is the newest result');
  assert.deepEqual(outcome(withFailure(at(14))), { tests: 'failed', entries: [{ kind: 'verdict', check: 'tests', passed: false }] }, 'a failure after the pass is the newest result');
  assert.equal(outcome(withFailure(at(13))).tests, 'passed', 'a tie keeps the pass, as the board gate does');
  assert.equal(failure(mapped(failedReview('other'), null, [row('wrong', 'pass')])), 'unmodelled-history');
});

test('typed read uses every existing owner once and does not mutate existing statistics (TASK-2859.08)', async () => {
  const mission = fixtureMission('task-x', { review: failedReview(), checkpoints: [cp('read', 'e2e')] });
  const calls: string[] = [];
  const statistics = { rounds: 7, sendBacks: 2 };
  const ports = {
    store: { load: async () => { calls.push('review'); return { kind: 'found' as const, mission, version: 1 as never }; } },
    gates: { readIntegrationGates: async () => { calls.push('gates'); return gate('stale'); } },
    history: { loadAllByTypeForMission: async (type: string) => { calls.push(type); return type === 'rebound.repair' ? [row('read', 'pass')] : []; } },
    lifecycle: { findByMissionId: async () => { calls.push('lifecycle'); return []; } },
    operations: { all: async () => { calls.push('operations'); return []; } },
    identity: { beginRead: () => calls.push('identity'), branchHead: () => null, changeIdentity: () => null },
  };
  const scope = { repositoryId: repositoryId('repo'), missionId: missionId('task-x') };
  const before = JSON.stringify(statistics);
  const first = JSON.stringify(await readVerificationHistory(ports, scope));
  assert.equal(JSON.stringify(await readVerificationHistory(ports, scope)), first);
  assert.deepEqual(calls, [
    'review', 'identity', 'gates', 'rebound.repair', 'flow.rebase', 'lifecycle', 'operations',
    'review', 'identity', 'gates', 'rebound.repair', 'flow.rebase', 'lifecycle', 'operations',
  ]);
  assert.equal(JSON.stringify(statistics), before);
  const missing = await readVerificationHistory({ ...ports, store: { load: async () => ({ kind: 'missing' as const }) } }, scope);
  assert.equal(missing.ok ? null : missing.failure.kind, 'unavailable');
});

function rebuttal(review: Review, resultingRevision = rev('a')): Review {
  return applyImplementerCommand(review, { type: 'submit-resolution', respondedAt: at(11), resultingRevision,
    resolutions: [{ findingId: reviewFindingId('f'), kind: 'disputed', rationale: 'the code is correct' }] });
}

function renewed(review: Review, verdict: 'approved' | 'changes-requested' | null, revision = rev('a')): Review {
  const [first] = review.rounds;
  const decision = verdict === 'approved'
    ? { kind: 'approved' as const, revision, decidedAt: at(13), comment: null, source: { kind: 'local' as const } }
    : verdict === 'changes-requested'
      ? { kind: 'changes-requested' as const, revision, decidedAt: at(13), comment: null,
        findings: [{ id: reviewFindingId('g'), summary: 'still wrong', location: null }] }
      : null;
  return { ...review, rounds: [first, { ...first, number: 2, startedAt: at(12), subject: { ...first.subject, revision },
    decision, response: null, phase: decision ? 'pending-approval' : 'reviewing', disposition: null }] } as Review;
}

test('maps a rebuttal with no new commit and the renewed verdict on the same revision (TASK-2867.03)', () => {
  const rebutted = rebuttal(decide(start(), 'request-changes'));
  const sent = { kind: 'verdict', check: 'agent', passed: false }, repaired = { kind: 'repair', check: 'agent' };
  assert.deepEqual(entries(mapped(renewed(rebutted, 'approved'))), [sent, repaired, { kind: 'verdict', check: 'agent', passed: true }]);
  assert.deepEqual(entries(mapped(renewed(rebutted, 'changes-requested'))), [sent, repaired, sent]);
  assert.deepEqual(entries(mapped(renewed(rebutted, null))), [sent, repaired],
    'a renewed review that has no verdict yet is left unknown, not fabricated');
  assert.deepEqual(entries(mapped(rebutted)), [sent, repaired]);
});

test('a rebuttal followed by a review of another revision stays an unmodelled change (TASK-2867.03)', () => {
  const rebutted = rebuttal(decide(start(), 'request-changes'));
  assert.deepEqual(entries(mapped(renewed(rebutted, 'approved', rev('b')))), [
    { kind: 'verdict', check: 'agent', passed: false }, { kind: 'repair', check: 'agent' },
    { kind: 'unmodelled-change' }, { kind: 'verdict', check: 'agent', passed: true },
  ]);
});

test('a synthetic rebuttal sequence read through the typed history owner reaches the belief without fabricating a verdict (TASK-2867.03)', async () => {
  const rebutted = rebuttal(decide(start(), 'request-changes'));
  const readBelief = async (review: Review) => {
    const ports = {
      store: { load: async () => ({ kind: 'found' as const, mission: fixtureMission('task-x', { review }), version: 1 as never }) },
      gates: { readIntegrationGates: async () => gate('stale') }, history: { loadAllByTypeForMission: async () => [] },
      lifecycle: { findByMissionId: async () => [] }, operations: { all: async () => [] },
      identity: { branchHead: () => null, changeIdentity: (revision: string) => revision },
    };
    const history = await readVerificationHistory(ports, { repositoryId: repositoryId('repo'), missionId: missionId('task-x') });
    assert.equal(history.ok, true, JSON.stringify(history));
    const parsed = parsePolicyArtifact(syntheticPolicyArtifactV2());
    assert.equal(parsed.ok, true);
    const belief = history.ok && parsed.ok ? deriveBelief(parsed.artifact, history.entries) : null;
    assert.equal(belief?.ok, true, 'the rebuttal sequence replays into a belief');
    return history.ok ? history.record : null;
  };
  assert.deepEqual(await readBelief(renewed(rebutted, 'approved')), { passed: ['agent'], failed: [] });
  assert.deepEqual(await readBelief(renewed(rebutted, null)), { passed: [], failed: [] }, 'the unrenewed verdict stays unknown');
  assert.deepEqual(await readBelief(renewed(rebutted, 'changes-requested')), { passed: [], failed: ['agent'] });
});
