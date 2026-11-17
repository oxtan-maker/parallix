import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptVerificationHistory, readVerificationHistory } from '../../../../src/application/verification-policy/history-adapter.js';
import { applyImplementerCommand, applyReviewerCommand, changeRevision, recordReviewerResult, reviewFindingId,
  invalidateBlocker, revokeApprovedDecision, type Review } from '../../../../src/domain/review.js';
import { agentFamily } from '../../../../src/domain/agents.js';
import { missionId } from '../../../../src/domain/mission.js';
import { repositoryId } from '../../../../src/domain/repository.js';
import { fixtureMission, pendingReview } from '../../../fixtures/mission-builders.js';
import type { IntegrationGateEvidence } from '../../../../src/application/ports/gate-evidence.js'; import type { CheckpointData } from '../../../../src/domain/checkpoint.js';
const at = (hour: number) => `2026-08-04T${String(hour).padStart(2, '0')}:00:00Z`, rev = (v: string) => changeRevision(v.padEnd(40, '0'));
const start = () => { const r = pendingReview('task-x', at(9)); return { ...r, rounds: [{ ...r.rounds[0], subject: { ...r.rounds[0].subject, revision: rev('a') } }] } as Review; };
const decide = (r: Review, kind: 'approve' | 'request-changes', source?: { kind: 'operator'; author: string }, revision = rev('a')) => applyReviewerCommand(r, kind === 'approve'
  ? { type: kind, decidedAt: at(10), revision, comment: null, source: { kind: 'local' } }
  : { type: kind, decidedAt: at(10), revision, comment: null, findings: [{ id: reviewFindingId('f'), summary: 'fix', location: null }], ...source && { source } });
const repair = (r: Review) => applyImplementerCommand(r, { type: 'submit-resolution', respondedAt: at(11), resultingRevision: rev('b'),
  resolutions: [{ findingId: reviewFindingId('f'), kind: 'fixed', evidence: 'done' }] });
const row = (id: string, outcome: string, area = 'retained verification', hour = 12) => ({ eventType: 'rebound.repair', createdAt: at(hour),
  eventData: JSON.stringify({ occurrenceId: id, reasonKind: 'gate-failure', area, outcome }) }); const cp = (id: string, gateKey: string): CheckpointData => ({ missionId: missionId('task-x'), name: 'CP-9', goalCheck: [], nextActionText: 'repair', repair: { incidentId: id, gateKey, command: 'npm test', authorizedGates: [], authorizedCriteria: [], attempt: 1, evidenceRecorded: true, verified: true } });
const failedReview = (failedGate = 'e2e') => { const approved = decide(start(), 'approve'), round = approved.rounds[0], cause = { kind: 'integration-gate-failure' as const, gate: 'e2e' }; return revokeApprovedDecision({ ...approved, rounds: [{ ...round, integrationRepairAssessment: { assessedAt: at(14), approvedRevision: rev('a'), candidateRevision: rev('c'), failedGate, outcome: 'mission-change-differs', repair: { startedAt: at(11), cause } } }] }, 1,
  { revokedAt: at(14), revokedBy: 'workflow', reason: 'gate', cause }); };
const gates = (state: 'pass' | 'fail' | 'stale'): IntegrationGateEvidence => ({ checkout: { kind: 'present', revision: 'r', clean: true }, configured: ['e2e'], running: null,
  gates: [{ key: 'e2e', proof: state === 'pass' ? { state: 'current', revision: 'r', observedAt: at(13) } : { state: state === 'stale' ? 'stale' : 'absent', ...(state === 'stale' ? { revision: 'old', observedAt: at(8) } : {}) } as never,
    failure: state === 'fail' ? { state: 'current', revision: 'r', observedAt: at(13), exitCode: 1 } : null }] }); const mapped = (r: Review | null, g: IntegrationGateEvidence | null = null, rows = [] as ReturnType<typeof row>[], checkpoints = [] as ReturnType<typeof cp>[]) => adaptVerificationHistory(r, g, rows, checkpoints);
test('maps one authoritative round verdict and exact agent or human repair, leaving incomplete repair pending (TASK-2859.07)', () => {
  let multi = start();
  multi = recordReviewerResult(multi, { publicationId: 'p1', reviewerId: 'claude', agentFamily: agentFamily('claude'), revision: rev('a'), decision: 'changes-requested', findings: [], outcome: 'completed', status: 0, publishedAt: at(9) });
  assert.deepEqual(mapped(decide(multi, 'approve')), { ok: true, entries: [{ kind: 'verdict', check: 'agent', passed: true }], tests: 'unobserved' });
  const human = decide(start(), 'request-changes', { kind: 'operator', author: 'magnus' });
  assert.deepEqual((mapped(repair(human)) as unknown as { entries: unknown[] }).entries, [{ kind: 'verdict', check: 'human', passed: false }, { kind: 'repair', check: 'human' }]);
  assert.deepEqual((mapped(human) as unknown as { entries: unknown[] }).entries, [{ kind: 'verdict', check: 'human', passed: false }]);
  const blocked = decide(start(), 'request-changes'), continued = invalidateBlocker({ ...blocked, rounds: [{ ...blocked.rounds[0], disposition: 'BLOCKED' }] }, at(12)); assert.deepEqual((mapped(continued) as unknown as { entries: unknown[] }).entries, [{ kind: 'verdict', check: 'agent', passed: false }]); assert.deepEqual((mapped(decide(start(), 'approve', undefined, rev('b'))) as unknown as { entries: unknown[] }).entries, [{ kind: 'verdict', check: 'agent', passed: true }]); const withdrawn = revokeApprovedDecision(decide(start(), 'approve'), 1, { revokedAt: at(14), revokedBy: 'magnus', reason: 'correction', cause: { kind: 'operator' } }); assert.deepEqual((mapped(withdrawn) as unknown as { entries: unknown[] }).entries, [{ kind: 'verdict', check: 'agent', passed: true }, { kind: 'unmodelled-change' }]);
});
test('maps integration pass, failure and one completed exact-gate repair in stable order without duplicates (TASK-2859.07)', () => {
  assert.deepEqual((mapped(null, gates('pass')) as unknown as { entries: unknown[] }).entries, [{ kind: 'verdict', check: 'tests', passed: true }]);
  assert.deepEqual(mapped(null, gates('stale')), { ok: true, entries: [], tests: 'observed' });
  const failed = failedReview(), current = failed.rounds[1], reReviewed = applyReviewerCommand({ ...failed, rounds: [failed.rounds[0], { ...current, subject: { ...current.subject, revision: rev('c') } }] } as Review, { type: 'approve', decidedAt: at(16), revision: rev('c'), comment: null, source: { kind: 'local' } });
  const rows = [row('same', 'advance', 'integration gate e2e', 12), row('same', 'pass', 'integration gate unit', 13)], result = mapped(failed, null, rows, [cp('same', 'e2e')]);
  assert.equal(JSON.stringify(result), JSON.stringify(mapped(JSON.parse(JSON.stringify(failed)), null, rows, [cp('same', 'e2e')])));
  assert.deepEqual((result as unknown as { entries: unknown[] }).entries, [{ kind: 'verdict', check: 'agent', passed: true }, { kind: 'verdict', check: 'tests', passed: false }, { kind: 'repair', check: 'tests' }]); assert.deepEqual((mapped(reReviewed, null, [row('retained', 'pass', 'retained verification', 15)], [cp('retained', 'e2e')]) as unknown as { entries: unknown[] }).entries.at(-1), { kind: 'verdict', check: 'agent', passed: true }); assert.doesNotMatch(JSON.stringify(mapped(failed, null, [row('wrong', 'pass', 'integration gate unit', 12)], [cp('wrong', 'unit')])), /"kind":"repair"/);
  const multiGateCheckpoints = [cp('multi', 'e2e'), { ...cp('multi', 'unit'), name: 'CP-10' }];
  assert.deepEqual((mapped(reReviewed, null, [row('multi', 'pass', 'integration gates', 15)], multiGateCheckpoints) as unknown as { entries: unknown[] }).entries,
    [{ kind: 'verdict', check: 'agent', passed: true }, { kind: 'verdict', check: 'tests', passed: false }, { kind: 'repair', check: 'tests' }, { kind: 'verdict', check: 'agent', passed: true }]);
  assert.deepEqual((mapped(reReviewed) as unknown as { entries: unknown[] }).entries.at(-1), { kind: 'verdict', check: 'tests', passed: false });
});
test('unknown and malformed facts never infer success and reads use each existing typed owner once (TASK-2859.07)', async () => {
  assert.deepEqual(mapped(null), { ok: true, entries: [], tests: 'unobserved' });
  assert.deepEqual((mapped(null, gates('fail')) as unknown as { entries: unknown[] }).entries, [{ kind: 'verdict', check: 'tests', passed: false }]);
  assert.equal((mapped(null, null, [{ ...row('x', 'pass'), eventData: '{' }]) as unknown as { failure: { kind: string } }).failure.kind, 'invalid'); assert.equal((mapped(failedReview(), null, [row('a', 'pass'), row('b', 'pass')], [cp('a', 'e2e'), cp('b', 'e2e')]) as unknown as { entries: Array<{ kind: string }> }).entries.filter(item => item.kind === 'repair').length, 1);
  const both = gates('pass'); assert.equal((mapped(null, { ...both, gates: [{ ...both.gates[0], failure: { state: 'current', revision: 'r', observedAt: at(13), exitCode: 1 } }] }) as unknown as { failure: { kind: string } }).failure.kind, 'contradiction'); assert.equal((mapped(failedReview('other'), null, [row('wrong', 'pass')]) as unknown as { failure: { kind: string } }).failure.kind, 'unmodelled-history');
  const mission = fixtureMission('task-x', { review: failedReview(), checkpoints: [cp('read', 'e2e')] }), calls: string[] = [], statistics = { rounds: 7, sendBacks: 2 };
  const ports = { store: { load: async () => { calls.push('review'); return { kind: 'found' as const, mission, version: 1 as never }; } },
    gates: { readIntegrationGates: async () => { calls.push('gates'); return gates('stale'); } },
    history: { loadAllByTypeForMission: async () => { calls.push('repairs'); return [row('read', 'pass')]; } } };
  const before = JSON.stringify(statistics), first = JSON.stringify(await readVerificationHistory(ports, { repositoryId: repositoryId('repo'), missionId: missionId('task-x') }));
  assert.equal(JSON.stringify(await readVerificationHistory(ports, { repositoryId: repositoryId('repo'), missionId: missionId('task-x') })), first);
  assert.deepEqual(calls, ['review', 'gates', 'repairs', 'review', 'gates', 'repairs']); assert.equal(JSON.stringify(statistics), before); assert.equal((await readVerificationHistory({ ...ports, store: { load: async () => ({ kind: 'missing' as const }) } }, { repositoryId: repositoryId('repo'), missionId: missionId('task-x') }) as unknown as { failure: { kind: string } }).failure.kind, 'unavailable');
});
