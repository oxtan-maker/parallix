import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWeakeningPacket, failureLines } from '../../../../src/application/review-classification/weakening-packet.js';
import { WEAKENING_LABELS, WEAKENING_POLICY_VERSION, WEAKENING_QUESTION, WEAKENING_THRESHOLD } from '../../../../src/application/review-classification/weakening-policy.js';
import type { MeasureBudget } from '../../../../src/application/review-classification/repair-evidence-packet.js';
import { EvidenceOverBudgetError, EvidencePreparationError, EvidenceReadError, type ReviewEvidencePort } from '../../../../src/application/ports/review-evidence.js';
import type { GateFact } from '../../../../src/application/review-classification/gate-fact.js';

// Boundary: the repair packet for the single weakening question; routing lives in the review-loop suites.
const fact: GateFact = { gate: 'integration', validationSha: 'v'.repeat(40), recordedAt: '2026-10-12T12:00:00Z', candidate: 'c'.repeat(40), relation: 'rebase-only' };
const approved = { baseline: 'base-a', revision: 'a'.repeat(40) };
const candidate = { baseline: 'base-b', revision: 'c'.repeat(40) };
const evidence = { gate: 'integration', log: 'noise\nnot ok 3 - exceeds CPU budget\nmore noise', approved, candidate, fact };
const generous: MeasureBudget = request => {
  const bytes = JSON.stringify(request).length;
  return { requestBytes: bytes, inputTokens: bytes, contextTokens: bytes, maxRequestBytes: 10_000_000, maxInputTokens: 10_000_000, maxContextTokens: 10_000_000, tokenizerModel: 'stub' };
};
const port = (over: Partial<ReviewEvidencePort> = {}): ReviewEvidencePort => ({
  tree: async () => [], source: async () => '', mainCommits: async () => [], changedPaths: async () => [], mergeBase: async () => 'x',
  missionInterdiff: async () => ({ diff: 'ignored', paths: ['src/a.ts', 'backlog/tasks/task-1 - x.md'] }),
  diff: async (_from, _to, paths) => `diff of ${paths.join(',')}`,
  subjects: async (from, to) => [`${from}..${to} subject`],
  ...over,
});
const stateOf = async (over?: Partial<ReviewEvidencePort>, input = evidence, measure = generous) =>
  (await buildWeakeningPacket(input, port(over), measure)).state as Record<string, unknown>;

test('packet carries gate, failure lines, restricted diff, subjects, rebase fact and gate fact (TASK-2736.3)', async () => {
  const state = await stateOf();
  assert.equal(state.failedGate, 'integration');
  assert.deepEqual(state.failureLines, ['not ok 3 - exceeds CPU budget']);
  assert.equal(state.repairDiff, 'diff of src/a.ts');
  assert.deepEqual(state.changedPaths, ['src/a.ts']);
  assert.deepEqual(state.repairCommitSubjects, [`${approved.revision}..${candidate.revision} subject`]);
  assert.deepEqual(state.rebase, { approvedBaseline: 'base-a', candidateBaseline: 'base-b', rebased: true, incorporatedMainCommits: ['base-a..base-b subject'] });
  assert.deepEqual(state.validation, { status: 'passed', failedIntegrationGateRerun: 'passed', gate: 'integration', validationRevision: fact.validationSha,
    candidateRevision: fact.candidate, relationToCandidate: 'rebase-only', recordedAt: fact.recordedAt, provenance: (state.validation as { provenance: string }).provenance });
});

test('an unrebased repair lists no incorporated main commits (TASK-2736.3)', async () => {
  const state = await stateOf(undefined, { ...evidence, candidate: { ...candidate, baseline: approved.baseline } });
  assert.deepEqual((state.rebase as { incorporatedMainCommits: string[] }).incorporatedMainCommits, []);
});

test('a large diff is sent whole while the token budget admits it (TASK-2736.3)', async () => {
  const big = 'x'.repeat(5_000_000);
  const state = await stateOf({ diff: async () => big });
  assert.equal(state.repairDiff, big);
});

test('the byte ceiling never refuses a packet which fits the token budget and reads carry no byte ceiling (TASK-2736.3)', async () => {
  const bytesOver: MeasureBudget = request => ({ ...generous(request), requestBytes: 5_000_000, maxRequestBytes: 1_000_000 });
  const options: unknown[] = [];
  const seen = port({ diff: async (_a, _b, _p, o) => { options.push(o); return 'diff'; }, subjects: async (_a, _b, o) => { options.push(o); return []; },
    missionInterdiff: async (_a, _b, o) => { options.push(o); return { diff: '', paths: ['src/a.ts'] }; } });
  await buildWeakeningPacket(evidence, seen, bytesOver);
  assert.ok(options.length >= 3 && options.every(o => (o as { unbounded?: boolean })?.unbounded === true));
});

test('only the token budget refuses an oversized packet (TASK-2736.3)', async () => {
  const tight: MeasureBudget = request => ({ ...generous(request), maxInputTokens: 10 });
  await assert.rejects(buildWeakeningPacket(evidence, port(), tight), EvidenceOverBudgetError);
});

test('a repair with no non-Backlog change or an unreadable range cannot be judged (TASK-2736.3)', async () => {
  await assert.rejects(buildWeakeningPacket(evidence, port({ missionInterdiff: async () => ({ diff: '', paths: ['backlog/tasks/task-1 - x.md'] }) }), generous), EvidencePreparationError);
  await assert.rejects(buildWeakeningPacket(evidence, port({ diff: async () => { throw new Error('boom'); } }), generous), EvidenceReadError);
});

test('failure lines fall back to the whole retained log when no line names a failure (TASK-2736.3)', () => {
  assert.deepEqual(failureLines('one\ntwo'), ['one', 'two']);
  assert.deepEqual(failureLines(null), []);
});

test('the policy carries the frozen question, labels, threshold and version (TASK-2736.3)', () => {
  assert.equal(WEAKENING_THRESHOLD, 0.6);
  assert.match(WEAKENING_POLICY_VERSION, /v4/);
  assert.deepEqual(Object.keys(WEAKENING_QUESTION.criteria), [...WEAKENING_LABELS]);
  assert.match(WEAKENING_QUESTION.instructions, /validation\.failedIntegrationGateRerun/);
  assert.match(WEAKENING_QUESTION.instructions, /removed assert, expect or check counts as weakening/);
});
