import test from 'node:test';
import assert from 'node:assert/strict';
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

test('maps landing failure and exact repair, but multi-check repair becomes one unmodelled change (TASK-2859.08)', () => {
  assert.deepEqual(entries(mapped(null, gate('pass'))), [{ kind: 'verdict', check: 'tests', passed: true }]);
  assert.deepEqual(mapped(null, gate('stale')), { ok: true, entries: [], tests: 'observed' });
  assert.deepEqual(entries(mapped(null, gate('pass', 'other'))), [{ kind: 'unmodelled-change' }]);

  const failed = failedReview();
  const exact = mapped(failed, null, [row('same', 'advance'), row('same', 'pass', 13)], [cp('same', 'e2e')]);
  assert.deepEqual(entries(exact), [
    { kind: 'verdict', check: 'agent', passed: true },
    { kind: 'verdict', check: 'tests', passed: false },
    { kind: 'repair', check: 'tests' },
  ]);
  assert.equal(JSON.stringify(exact), JSON.stringify(mapped(JSON.parse(JSON.stringify(failed)), null,
    [row('same', 'advance'), row('same', 'pass', 13)], [cp('same', 'e2e')])));

  const multi = [cp('wide', 'e2e'), { ...cp('wide', 'unit'), name: 'CP-10' }];
  assert.deepEqual(entries(mapped(failed, null, [row('wide', 'pass')], multi)), [
    { kind: 'verdict', check: 'agent', passed: true },
    { kind: 'verdict', check: 'tests', passed: false },
    { kind: 'unmodelled-change' },
  ]);
  assert.deepEqual(entries(mapped(failed, gate('pass', 'other'), [], [],
    { identity: { branchHead: () => null, changeIdentity: revision => revision } })), [
    { kind: 'verdict', check: 'agent', passed: true },
    { kind: 'verdict', check: 'tests', passed: false },
    { kind: 'unmodelled-change' },
  ]);
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
});

function rebase(outcome: RebaseMeasurement['outcome'], before: string | null, after: string | null): RebaseMeasurement {
  return { id: 'rb', repositoryId: 'repo', missionId: 'task-x', operationId: 'op', generation: 1, sourceId: 'rb',
    stage: 'direct-rebase', attempt: 1, outcome, baseBranch: 'main', revisionBefore: before, revisionAfter: after,
    conflicts: [], occurredAt: at(12) };
}

test('uses stable change identity for rebases and marks re-scope or unmodelled revision movement (TASK-2859.08)', () => {
  const ids: Record<string, string> = { before: 'same', clean: 'same', changed: 'different',
    [rev('b')]: 'round-change', [rev('c')]: 'round-change' };
  const identity = { branchHead: () => null, changeIdentity: (revision: string) => ids[revision] ?? null };
  assert.deepEqual(entries(mapped(null, null, [], [],
    { identity, rebases: [rebase('clean', 'before', 'clean')] })), []);
  assert.deepEqual(entries(mapped(null, null, [], [],
    { identity, rebases: [rebase('resolved', 'before', 'changed')] })), [{ kind: 'unmodelled-change' }]);
  assert.equal(failure(mapped(null, null, [], [],
    { identity, rebases: [rebase('clean', 'missing', 'clean')] })), 'unavailable');
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

test('declared-gates returns reset history and malformed facts fall back with typed reasons (TASK-2859.08)', () => {
  const lane = { repositoryId: 'repo', missionId: 'task-x', fromStatus: 'review', toStatus: 'active',
    trigger: 'request-changes', agent: 'codex', occurredAt: at(12), idempotencyKey: 'return',
    returnIdentity: { stage: 'declared-gates' as const, operationId: 'op', operationGeneration: 1 } };
  assert.deepEqual(entries(mapped(null, null, [], [], { lifecycle: [lane] })), [{ kind: 'unmodelled-change' }]);
  assert.equal(failure(mapped(null, null, [{ ...row('x', 'pass'), eventData: '{' }])), 'invalid');
  const both = gate('pass');
  assert.equal(failure(mapped(null, { ...both, gates: [{ ...both.gates[0],
    failure: { state: 'current', revision: 'r', observedAt: at(13), exitCode: 1 } }] })), 'contradiction');
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
