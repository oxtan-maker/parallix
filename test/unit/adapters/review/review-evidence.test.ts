import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { GitReviewEvidence } from '../../../../src/adapters/review/review-evidence.js';
import { EvidenceReadError } from '../../../../src/application/ports/review-evidence.js';
import { mkdtemp } from '../../../helpers/temp-dir.js';
import type { Review } from '../../../../src/domain/review.js';

// Contract of the Git evidence adapter: bounded reads report typed errors.
test('an oversized or failed git read is a typed evidence error rather than a raw child-process error (TASK-2704)', async () => {
  const oversize = Object.assign(new Error('stdout maxBuffer length exceeded'), { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' });
  const big = new GitReviewEvidence('/repo', async () => { throw oversize; });
  await assert.rejects(big.diff('a', 'b', []), (error: unknown) => error instanceof EvidenceReadError && error.oversize);
  const broken = new GitReviewEvidence('/repo', async () => { throw new Error('fatal: bad object'); });
  await assert.rejects(broken.source('a', 'x.ts'), (error: unknown) => error instanceof EvidenceReadError && !error.oversize);
  await assert.rejects(broken.tree('a'), EvidenceReadError);
});

test('an unbounded read lifts the byte ceiling while default reads stay bounded (TASK-2736)', async () => {
  const ceilings: number[] = [];
  const evidence = new GitReviewEvidence('/repo', async (_file, _args, options) => { ceilings.push(options.maxBuffer); return { stdout: '' }; });
  await evidence.diff('a', 'b', []);
  await evidence.diff('a', 'b', [], { unbounded: true });
  await evidence.subjects('a', 'b', { unbounded: true });
  assert.deepEqual(ceilings, [2_000_000, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY]);
});


test('statistics authorship accepts only explicit Git patch proofs (TASK-2818)', async t => {
  const { GitMissionPatchComparison } = await import('../../../../src/adapters/review/mission-patch-comparison.js');
  const { createReviewStatisticsEvidenceReader } = await import('../../../../src/adapters/review/review-statistics-evidence.js');
  const { repeatReview } = await import('../../../fixtures/repeat-review.js');
  const { changeRevision } = await import('../../../../src/domain/review.js');
  const aggregate = repeatReview();
  const first = aggregate.rounds[0];
  const judged = changeRevision('f'.repeat(40));
  const review = { ...aggregate, rounds: [{ ...first, decision: { ...first.decision!, revision: judged } }] as typeof aggregate.rounds };
  const comparison = mock.method(GitMissionPatchComparison.prototype, 'samePatch', async () => true);
  t.after(() => comparison.mock.restore());
  const reader = createReviewStatisticsEvidenceReader('/unreachable-repository');
  assert.deepEqual((await reader(review)).equivalentSubmissions[judged], [first.subject.revision]);
  comparison.mock.mockImplementation(async () => { throw new Error('missing Git object'); });
  assert.deepEqual((await createReviewStatisticsEvidenceReader('/missing-repository')(review)).equivalentSubmissions[judged], []);
  assert.deepEqual(await reader(null), { equivalentSubmissions: {} });
  comparison.mock.resetCalls();
  const approved = { ...review, rounds: [{ ...review.rounds[0], decision: {
    kind: 'approved' as const, revision: judged, decidedAt: '2026-10-01T00:00:00Z', comment: '',
    source: { kind: 'provider' as const, provider: 'forgejo' } } }] as typeof aggregate.rounds };
  assert.deepEqual(await reader(approved), { equivalentSubmissions: {} });
  assert.equal(comparison.mock.callCount(), 0, 'a plain approval needs no authorship Git read');
});


test('statistics Git proofs survive reader restarts while misses and mutable refs remain uncached (TASK-2818)', async t => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { GitMissionPatchComparison } = await import('../../../../src/adapters/review/mission-patch-comparison.js');
  const { createReviewStatisticsEvidenceReader } = await import('../../../../src/adapters/review/review-statistics-evidence.js');
  const { repeatReview } = await import('../../../fixtures/repeat-review.js');
  const { changeRevision } = await import('../../../../src/domain/review.js');
  const root = mkdtemp('review-proof-cache-');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const comparison = mock.method(GitMissionPatchComparison.prototype, 'samePatch', async () => true);
  t.after(() => comparison.mock.restore());
  const aggregate = repeatReview();
  const first = aggregate.rounds[0];
  const observed = (revision: string) => ({ ...aggregate, rounds: [{ ...first,
    decision: { ...first.decision!, revision: changeRevision(revision) } }] as typeof aggregate.rounds });
  const judged = 'f'.repeat(40);
  const read = () => createReviewStatisticsEvidenceReader(root);
  assert.deepEqual((await read()(observed(judged))).equivalentSubmissions[judged], [first.subject.revision]);
  assert.deepEqual((await read()(observed(judged))).equivalentSubmissions[judged], [first.subject.revision]);
  assert.equal(comparison.mock.callCount(), 1, 'a new reader reuses an immutable Git proof from disk');
  await read()(observed('HEAD'));
  await read()(observed('HEAD'));
  assert.equal(comparison.mock.callCount(), 3, 'mutable refs are never reused');
  comparison.mock.mockImplementation(async () => false);
  const denied = 'd'.repeat(40);
  const beforeDenial = comparison.mock.callCount();
  assert.deepEqual((await read()(observed(denied))).equivalentSubmissions[denied], []);
  assert.deepEqual((await read()(observed(denied))).equivalentSubmissions[denied], []);
  assert.equal(comparison.mock.callCount(), beforeDenial + 1, 'a proven different patch stays different after restart');
  comparison.mock.mockImplementation(async () => { throw new Error('missing Git object'); });
  const missing = 'e'.repeat(40);
  assert.deepEqual((await read()(observed(missing))).equivalentSubmissions[missing], []);
  comparison.mock.mockImplementation(async () => true);
  assert.deepEqual((await read()(observed(missing))).equivalentSubmissions[missing], [first.subject.revision], 'missing evidence is retried after objects become available');
  fs.writeFileSync(path.join(root, '.workflow/cache/review-patch-proofs-v1.json'), 'broken');
  const calls = comparison.mock.callCount();
  await read()(observed(judged));
  assert.equal(comparison.mock.callCount(), calls + 1, 'a corrupt cache is a miss');
});

// TASK-2832: workflow history is the evidence for returns the Review never saw.
test('gate repairs that moved no lane are returns; a repair answering a lane return is that return (TASK-2832)', async () => {
  const { workflowReturnsFromHistory, createWorkflowReturnReader } = await import('../../../../src/adapters/review/review-statistics-evidence.js');
  const move = (fromStatus: string | null, toStatus: string, trigger: string, agent: string, occurredAt: string) =>
    ({ fromStatus, toStatus, trigger, agent, occurredAt, idempotencyKey: `${trigger}@${occurredAt}` });
  const lane = [move('refined', 'active', 'activate', 'codex', '2026-10-01T10:00:00Z'),
    move('active', 'review', 'submit-for-review', 'claude', '2026-10-01T11:00:00Z'),
    move('review', 'integration', 'approve', 'claude', '2026-10-01T11:05:00Z'),
    move('integration', 'active', 'rebound-to-active', 'claude', '2026-10-01T12:00:00Z')];
  const repair = (occurrenceId: string, reasonKind: string, area: string | null, occurredAt: string) => ({ occurrenceId, reasonKind, area, agent: 'codex', headBefore: null, occurredAt });
  const returns = workflowReturnsFromHistory(lane, [
    repair('pre', 'gate-failure', 'declared gate', '2026-10-01T10:30:00Z'),
    repair('answer', 'gate-failure', 'integration gate unit', '2026-10-01T12:20:00Z'),
    repair('retry', 'artifact-incomplete', 'implementer', '2026-10-01T10:40:00Z'),
    repair('timeout', 'agent-timeout', 'reviewer', '2026-10-01T10:50:00Z'),
  ]);
  assert.deepEqual(returns.map(item => item.identity).sort(), ['lane:rebound-to-active@2026-10-01T12:00:00Z', 'repair:pre']);
  assert.equal(returns.find(item => item.identity === 'repair:pre')!.author, 'codex', 'the launcher before the return, not the sender');
  const read = createWorkflowReturnReader({ findByMissionId: async () => lane }, { findByTypeForMission: async () => [
    { eventData: JSON.stringify({ occurrenceId: 'pre', reasonKind: 'gate-failure', area: 'declared gate', agent: 'codex' }), createdAt: '2026-10-01T10:30:00Z' },
    { eventData: JSON.stringify({ occurrenceId: 'pre', reasonKind: 'gate-failure', area: 'declared gate', agent: 'codex' }), createdAt: '2026-10-01T10:35:00Z' },
    { eventData: 'not json', createdAt: '2026-10-01T10:36:00Z' },
  ] });
  assert.equal((await read('m'))?.length, 2, 'attempts of one occurrence and unreadable rows never add returns');
});

test('an independent gate failure shortly after a reviewer return is its own return (TASK-2832)', async () => {
  const { workflowReturnsFromHistory } = await import('../../../../src/adapters/review/review-statistics-evidence.js');
  const lane = [{ fromStatus: 'refined', toStatus: 'active', trigger: 'activate', agent: 'codex', occurredAt: '2026-10-01T10:00:00Z', idempotencyKey: 'a' },
    { fromStatus: 'review', toStatus: 'active', trigger: 'request-changes', agent: 'claude', occurredAt: '2026-10-01T11:00:00Z', idempotencyKey: 'pr' }];
  const returns = workflowReturnsFromHistory(lane, [{ occurrenceId: 'gate', reasonKind: 'gate-failure', area: 'declared gate', agent: 'codex', headBefore: null, occurredAt: '2026-10-01T11:05:00Z' }]);
  assert.deepEqual(returns.map(item => item.source).sort(), ['judgment', 'repair']);
});

test('rebound repair reader indexes minimal history once and deduplicates retry attempts (TASK-2836)', async () => {
  const { createReboundRepairReader } = await import('../../../../src/adapters/review/review-statistics-evidence.js');
  let reads = 0;
  const reader = createReboundRepairReader({ findReboundRepairs: async () => {
    reads += 1;
    return [
      { missionId: 'task-a', occurrenceId: 'same', reasonKind: 'gate-failure', area: 'unit', agent: 'codex', headBefore: 'rev-a1', occurredAt: '2026-10-01T10:00:00Z' },
      { missionId: 'task-a', occurrenceId: 'same', reasonKind: 'gate-failure', area: 'unit', agent: 'codex', headBefore: 'rev-a1', occurredAt: '2026-10-01T10:01:00Z' },
      { missionId: 'task-b', occurrenceId: 'other', reasonKind: 'gate-failure', area: null, agent: 'claude', headBefore: null, occurredAt: '2026-10-01T11:00:00Z' },
    ];
  } });
  assert.deepEqual(await reader('task-a'), [
    { occurrenceId: 'same', reasonKind: 'gate-failure', area: 'unit', agent: 'codex', headBefore: 'rev-a1', occurredAt: '2026-10-01T10:00:00Z' },
  ]);
  assert.equal((await reader('task-b')).length, 1);
  assert.equal(reads, 1);
});

test('a repair is claimed by the rebound active when its attempt started, not when it completed (TASK-2836)', async () => {
  const { createReboundRepairReader, workflowReturnsFromHistory } = await import('../../../../src/adapters/review/review-statistics-evidence.js');
  const reader = createReboundRepairReader({ findReboundRepairs: async () => [{ missionId: 'task-a', occurrenceId: 'repair',
    reasonKind: 'gate-failure', area: 'unit', agent: 'codex', headBefore: 'rev-a1', durationMs: 120_000, occurredAt: '2026-10-01T10:11:00Z' }] });
  const repairs = await reader('task-a');
  assert.equal(repairs[0]?.occurredAt, '2026-10-01T10:09:00.000Z');
  const returns = workflowReturnsFromHistory([
    { fromStatus: 'review', toStatus: 'active', trigger: 'rebound-to-active', agent: 'codex', occurredAt: '2026-10-01T10:00:00Z', idempotencyKey: 'rebound' },
    { fromStatus: 'active', toStatus: 'review', trigger: 'submit', agent: 'codex', occurredAt: '2026-10-01T10:10:00Z', idempotencyKey: 'submit' },
  ], repairs);
  assert.deepEqual(returns.map(item => item.identity), ['lane:rebound']);
});

test('durable integration handoffs expose clean and returned human review episodes (TASK-2835 review F5)', async () => {
  const { createHumanReviewEpisodeReader } = await import('../../../../src/adapters/review/review-statistics-evidence.js');
  const lane = [
    { fromStatus: 'review', toStatus: 'integration', trigger: 'approve', agent: 'claude', occurredAt: '2026-10-01T10:00:00Z', idempotencyKey: 'handoff-1' },
    { fromStatus: 'integration', toStatus: 'active', trigger: 'request-changes', agent: 'magnus', occurredAt: '2026-10-01T10:05:00Z', idempotencyKey: 'return-1' },
    { fromStatus: 'review', toStatus: 'integration', trigger: 'approve', agent: 'claude', occurredAt: '2026-10-01T11:00:00Z', idempotencyKey: 'handoff-2' },
    { fromStatus: 'integration', toStatus: 'done', trigger: 'land', agent: 'magnus', occurredAt: '2026-10-01T11:05:00Z', idempotencyKey: 'done' },
  ];
  const episodes = await createHumanReviewEpisodeReader({ findByMissionId: async () => lane })('task-1');
  assert.deepEqual(episodes?.map(episode => [episode.identity, episode.startedAt, episode.endedAt]), [
    ['human-handoff:handoff-1', '2026-10-01T10:00:00Z', '2026-10-01T10:05:00Z'],
    ['human-handoff:handoff-2', '2026-10-01T11:00:00Z', '2026-10-01T11:05:00Z'],
  ]);
});

test('a revocation decision inside its durable handoff is one human episode (TASK-2835 review F10)', async () => {
  const { createHumanReviewEpisodeReader } = await import('../../../../src/adapters/review/review-statistics-evidence.js');
  const { reviewStatistics } = await import('../../../../src/application/services/review-statistics.js');
  const { repeatReview } = await import('../../../fixtures/repeat-review.js');
  const lane = [
    { fromStatus: 'review', toStatus: 'integration', trigger: 'approve', agent: 'claude', occurredAt: '2026-10-01T01:00:00Z', idempotencyKey: 'handoff-return' },
    { fromStatus: 'integration', toStatus: 'active', trigger: 'revoke-review', agent: 'magnus', occurredAt: '2026-10-01T01:30:00Z', idempotencyKey: 'return' },
    { fromStatus: 'review', toStatus: 'integration', trigger: 'approve', agent: 'claude', occurredAt: '2026-10-01T02:00:00Z', idempotencyKey: 'handoff-clean' },
    { fromStatus: 'integration', toStatus: 'done', trigger: 'land', agent: 'magnus', occurredAt: '2026-10-01T02:30:00Z', idempotencyKey: 'done' },
  ];
  const episodes = await createHumanReviewEpisodeReader({ findByMissionId: async () => lane })('task-1');
  const aggregate = repeatReview();
  const submitted = aggregate.rounds[0];
  const review: Review = { ...aggregate, rounds: [{ ...submitted, decision: {
    kind: 'approved' as const, revision: submitted.subject.revision, decidedAt: '2026-10-01T00:30:00Z', comment: null,
    source: { kind: 'local' as const }, revocation: { revokedAt: '2026-10-01T01:30:00Z', revokedBy: 'magnus',
      reason: 'Supported human send-back', cause: { kind: 'operator' as const } },
  } }] as Review['rounds'] };

  const result = reviewStatistics(review, { equivalentSubmissions: {}, reviewEpisodes: episodes });

  assert.deepEqual(result.episodes.filter(episode => episode.actor === 'human').map(episode => episode.identity),
    ['human-handoff:handoff-return', 'human-handoff:handoff-clean']);
  assert.deepEqual(result.sendBacks.human, { numerator: 1, eligibleEpisodes: 2, coverage: 1,
    rate: { state: 'measured', value: 0.5 } });
});

test('an integration repair belongs to the rebound that opened it however long it runs (TASK-2832)', async () => {
  const { workflowReturnsFromHistory } = await import('../../../../src/adapters/review/review-statistics-evidence.js');
  const lane = [{ fromStatus: 'refined', toStatus: 'active', trigger: 'activate', agent: 'codex', occurredAt: '2026-10-01T10:00:00Z', idempotencyKey: 'a' },
    { fromStatus: 'integration', toStatus: 'active', trigger: 'rebound-to-active', agent: 'codex', occurredAt: '2026-10-01T11:00:00Z', idempotencyKey: 'rb' },
    { fromStatus: 'active', toStatus: 'review', trigger: 'begin-review-preparation', agent: 'codex', occurredAt: '2026-10-01T15:00:00Z', idempotencyKey: 'next' }];
  const repair = (occurredAt: string, area: string) => ({ occurrenceId: occurredAt, reasonKind: 'gate-failure', area, agent: 'codex', headBefore: null, occurredAt });
  const returns = workflowReturnsFromHistory(lane, [repair('2026-10-01T13:30:00Z', 'integration gate unit'), repair('2026-10-01T16:00:00Z', 'integration gate unit')]);
  assert.deepEqual(returns.map(item => item.source).sort(), ['rebound', 'repair'], 'only the repair after the next lane move is a new incident');
  const review = workflowReturnsFromHistory([lane[0], { ...lane[1], fromStatus: 'review' }, lane[2]], [repair('2026-10-01T13:30:00Z', 'declared gate')]);
  assert.deepEqual(review.map(item => item.source), ['rebound'], 'a review-state rebound owns the repair it launched too');
});

test('a second independent repair in a rebound interval is its own return (TASK-2832)', async () => {
  const { workflowReturnsFromHistory } = await import('../../../../src/adapters/review/review-statistics-evidence.js');
  const lane = [{ fromStatus: 'refined', toStatus: 'active', trigger: 'activate', agent: 'codex', occurredAt: '2026-10-01T09:00:00Z', idempotencyKey: 'a' },
    { fromStatus: 'integration', toStatus: 'active', trigger: 'rebound-to-active', agent: 'codex', occurredAt: '2026-10-01T10:00:00Z', idempotencyKey: 'rb' }];
  const repair = (occurrenceId: string, occurredAt: string) => ({ occurrenceId, reasonKind: 'gate-failure', area: 'declared gate', agent: 'codex', headBefore: null, occurredAt });
  const returns = workflowReturnsFromHistory(lane, [repair('own', '2026-10-01T11:00:00Z'), repair('other', '2026-10-01T12:00:00Z')]);
  assert.deepEqual(returns.map(item => item.source).sort(), ['rebound', 'repair']);
});

test('a repair row without stored return provenance keeps its coarse origin (PX-0055.01)', async () => {
  const { workflowReturnsFromHistory } = await import('../../../../src/adapters/review/review-statistics-evidence.js');
  const legacy = { occurrenceId: 'legacy', reasonKind: 'gate-failure', area: 'declared gate', agent: 'codex', headBefore: null, occurredAt: '2026-10-01T10:30:00Z' };
  const typed = { ...legacy, occurrenceId: 'typed', occurredAt: '2026-10-01T11:30:00Z', headBefore: 'rev-2',
    returnIdentity: { stage: 'declared-gates' as const, operationId: 'op-2', operationGeneration: 3 } };
  const returns = workflowReturnsFromHistory([], [legacy, typed]);
  assert.deepEqual(returns.map(item => [item.identity, item.origin]), [
    ['repair:legacy', undefined],
    ['repair:typed', { actor: 'workflow', stage: 'declared-gates', decisionIdentity: 'repair:typed',
      revision: 'rev-2', sender: 'codex', cause: 'gate-failure', operationId: 'op-2', operationGeneration: 3 }],
  ], 'only a producer-typed row names its lane; a legacy row keeps the coarse repair cause for placement');
});
