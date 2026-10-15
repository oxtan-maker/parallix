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
const evidence = { gate: 'integration', log: 'noise\nnot ok 3 - exceeds CPU budget\nmore noise', approved, candidate, fact } satisfies Partial<NonNullable<Parameters<typeof buildWeakeningPacket>[0]>>;
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

import { fitPacket } from '../../../../src/application/review-classification/fit-packet.js';
import type { DecisionRequest } from '../../../../src/application/ports/decision.js';
const fileDiff = (path: string, size: number) => `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-old\n+${'x'.repeat(size)}\n`;
test('shared fitter keeps admitted evidence unchanged and drops largest diffs first (TASK-2751)', () => {
  const request: DecisionRequest = { state: { finding: 'obligation', diff: fileDiff('small', 50) + fileDiff('generated', 5000) + fileDiff('medium', 2000) }, questions: {} };
  assert.equal(fitPacket(request, generous, { diffKey: 'diff' }), request);
  const tight: MeasureBudget = r => ({ ...generous(r), maxInputTokens: 1000 });
  fitPacket(request, tight, { diffKey: 'diff' });
  const state = request.state as Record<string, unknown>;
  assert.deepEqual(state.omittedDiffs, [{ path: 'generated', added: 1, removed: 1 }, { path: 'medium', added: 1, removed: 1 }]);
  assert.match(String(state.omissionNotice), /not shown/);
  assert.ok(tight(request).inputTokens <= 1000);
});
test('shared fitter omits context before diffs and shortens commit lists with counts (TASK-2751)', () => {
  const state = { finding: 'obligation', diff: fileDiff('small', 50), context: 'x'.repeat(3000), commits: Array.from({ length: 20 }, () => 'subject'.repeat(30)), counts: { kept: 20, dropped: 0 } };
  const request: DecisionRequest = { state, questions: {} };
  const tight: MeasureBudget = r => ({ ...generous(r), maxInputTokens: 1000 });
  fitPacket(request, tight, { diffKey: 'diff', context: [{ text: state.context, omit: () => { state.context = ''; } }],
    commits: [{ values: state.commits, set: (v, counts) => { state.commits = v as string[]; state.counts = counts; } }] });
  assert.equal(state.context, '');
  assert.ok(state.counts.dropped > 0);
  assert.equal(state.counts.kept + state.counts.dropped, 20);
  assert.throws(() => fitPacket({ state: { finding: 'x'.repeat(2000), diff: '' }, questions: {} }, tight, { diffKey: 'diff' }), EvidenceOverBudgetError);
});

test('required omission manifest can exceed budget despite admitted obligations (TASK-2751 contract blocker)', () => {
  const tight: MeasureBudget = r => ({ ...generous(r), maxInputTokens: 4096 });
  const mandatory = { finding: 'Resolve the reported failure', failureLines: ['failed check'], validation: { status: 'passed' } };
  assert.ok(tight({ state: mandatory, questions: {} }).inputTokens < 4096);
  const diff = Array.from({ length: 100 }, (_, i) => fileDiff(`changes/${i}/component`, 100)).join('');
  const request: DecisionRequest = { state: { ...mandatory, diff }, questions: {} };
  assert.throws(() => fitPacket(request, tight, { diffKey: 'diff' }), EvidenceOverBudgetError);
  const fitted = request.state as Record<string, unknown>;
  assert.equal((fitted.omittedDiffs as unknown[]).length, 100);
  assert.equal(fitted.diff, '');
  assert.ok(tight(request).inputTokens > 4096);
});

test('production weakening fits diffs and commit lists with named omissions (TASK-2751)', async () => {
  const measure: MeasureBudget = r => ({ ...generous(r), maxInputTokens: 5000 });
  const request = await buildWeakeningPacket(evidence, port({
    diff: async () => fileDiff('large', 20000) + fileDiff('small', 5),
    subjects: async () => Array.from({ length: 100 }, () => 'commit subject '.repeat(20)),
  }), measure);
  const state = request.state as Record<string, unknown>;
  assert.deepEqual(state.omittedDiffs, [{ path: 'large', added: 1, removed: 1 }, { path: 'small', added: 1, removed: 1 }]);
  assert.ok((state.repairCommitCounts as { dropped: number }).dropped > 0);
  assert.ok(measure(request).inputTokens <= 5000);
  assert.match(String(request.questions.resolution.instructions), /Do not select preserves when an omitted change could decide/);
});

test('deleted diff manifests retain repository-relative paths (TASK-2751 F2)', () => {
  const request: DecisionRequest = { state: { diff: 'diff --git a/lib/x.java b/lib/x.java\n--- a/lib/x.java\n+++ /dev/null\n@@ -1 +0,0 @@\n-' + 'x'.repeat(5000) + '\n' }, questions: {} };
  fitPacket(request, r => ({ ...generous(r), maxInputTokens: 1000 }), { diffKey: 'diff' });
  assert.deepEqual((request.state as Record<string, unknown>).omittedDiffs, [{ path: 'lib/x.java', added: 0, removed: 1 }]);
});

test('no-fact packet uses the integration guarantee and exact question substitutions (TASK-2754)', async () => {
  const { WEAKENING_V5, weakeningQuestion, INTEGRATION_RERUN_GUARANTEE } = await import('../../../../src/application/review-classification/weakening-policy.js');
  const factSentence = 'Parallix mechanically re-ran the failed gate (validation.failedIntegrationGateRerun); treat its status as an authoritative execution fact at the stated revision and do not re-judge whether the failure is fixed.';
  const guarantee = 'The failed gate has not been re-run at this revision yet; Parallix re-runs it and every other integration gate before the mission can integrate and refuses integration if any fails (validation.failedIntegrationGateRerun). Do not judge whether the failure is fixed.';
  for (const [v5, admitted] of [[false, WEAKENING_QUESTION], [true, WEAKENING_V5]] as const) {
    const instructions = String(weakeningQuestion(false, v5).instructions);
    assert.ok(instructions.includes(INTEGRATION_RERUN_GUARANTEE));
    assert.ok(instructions.includes(guarantee));
    assert.ok(instructions.includes('Decide whether the repair preserves'));
    assert.doesNotMatch(instructions, /authoritative execution fact|made the gate pass while|Parallix mechanically re-ran/);
    assert.deepEqual(weakeningQuestion(true, v5), admitted);
    assert.deepEqual(weakeningQuestion(false, v5), { ...admitted, instructions: admitted.instructions
      .replace(factSentence, guarantee).replace('Decide whether the repair made the gate pass while preserving', 'Decide whether the repair preserves') });
  }
  const request = await buildWeakeningPacket({ ...evidence, fact: undefined }, port(), generous);
  assert.deepEqual(request.questions.resolution, weakeningQuestion(false));
  assert.doesNotMatch(JSON.stringify(request.state), /"passed"|validationRevision|recordedAt/);
  assert.match(JSON.stringify(request.state), /re-runs.*every.*integration gate.*refuses integration/);
  await assert.rejects(buildWeakeningPacket({ ...evidence, fact: undefined }, port({ diff: async () => '' }), generous), EvidencePreparationError);
});


test('no-fact question refuses either missing substitution (TASK-2754 F1)', async () => {
  const { WEAKENING_V5, weakeningQuestion } = await import('../../../../src/application/review-classification/weakening-policy.js');
  for (const [v5, question] of [[false, WEAKENING_QUESTION], [true, WEAKENING_V5]] as const) {
    const mutable = question as { instructions: string };
    const original = mutable.instructions;
    try {
      for (const phrase of ['Parallix mechanically re-ran', 'Decide whether the repair made the gate pass while preserving']) {
        mutable.instructions = original.replace(phrase, 'changed prompt');
        assert.throws(() => weakeningQuestion(false, v5), /No-fact replacement did not apply/);
        assert.equal(weakeningQuestion(true, v5), question);
      }
    } finally { mutable.instructions = original; }
  }
});
