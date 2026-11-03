import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { GitReviewEvidence } from '../../../../src/adapters/review/review-evidence.js';
import { EvidenceReadError } from '../../../../src/application/ports/review-evidence.js';
import { mkdtemp } from '../../../helpers/temp-dir.js';

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
