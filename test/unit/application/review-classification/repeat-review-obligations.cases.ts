import test from 'node:test';
import assert from 'node:assert/strict';
import { scenario, distribution } from '../../../helpers/review-classification.js';
import { tryClassifyReview } from '../../../../src/application/review-classification/classify-review.js';
import { ReviewRound } from '../../../../src/application/review-loop/round.js';
import { changeRevision } from '../../../../src/domain/review.js';
import { obligationQuestion } from '../../../../src/application/review-classification/obligation-review.js';

function qualifying() {
  const s = scenario('enabled', true);
  s.round.verifiedRevision = 'b'.repeat(40);
  return s;
}
function answer(s: ReturnType<typeof qualifying>, selected = 'addresses', score = 0.97) {
  s.classifier.decision.decide = async () => ({ provider: 'stub', model: 'jev', answers: {
    resolution: { type: 'choice', selected, confidence: 1, probabilities: distribution(selected, score) } } });
}
function note(s: ReturnType<typeof qualifying>, text: string) {
  (s.store.mission().review!.reviewEvents as unknown[]).push({ position: 1, eventType: 'human_note', roundNumber: 1,
    actor: 'operator', content: text, createdAt: '2026-10-01T00:02:30Z' });
}

test('qualifying obligations replace the panel in default shadow with no approval authority (TASK-2753)', async () => {
  const s = qualifying();
  note(s, 'Keep errors visible');
  let calls = 0;
  s.classifier.decision.decide = async request => {
    calls++;
    const state = request.state as { finding: string; priorReviewComment: string; implementerResponse: string; repairDiff: string };
    assert.deepEqual(request.questions, { resolution: obligationQuestion(state.finding) });
    assert.match(state.priorReviewComment, /Fix output/);
    assert.match(state.implementerResponse, /Fixed F1/);
    assert.match(state.repairDiff, /return output/);
    return { provider: 'stub', model: 'jev', answers: { resolution: { type: 'choice', selected: 'addresses', confidence: 1, probabilities: distribution('addresses', 0.97) } } };
  };
  assert.equal(await tryClassifyReview(s.context, s.round), null);
  assert.equal(calls, 2);
  assert.deepEqual(s.published, []);
  assert.equal(s.store.mission().status, 'review');
  assert.equal(s.store.mission().review!.rounds.at(-1)!.decision, null);
  assert.equal(s.attempts[0].panel, undefined);
  assert.equal(s.attempts[0].shadow, true);
  assert.equal(s.attempts[0].route, 'clear');
  assert.deepEqual(s.attempts[0].obligations?.map(a => a.probabilities?.addresses), [0.97, 0.97]);
});

test('explicit activation clears or names failing obligations through existing authority (TASK-2753)', async () => {
  for (const selected of ['addresses', 'does_not_address']) {
    const s = qualifying();
    Object.assign(s.classifier, { obligationMode: 'enabled' });
    answer(s, selected);
    assert.equal(await tryClassifyReview(s.context, s.round), selected === 'addresses' ? 'APPROVED' : 'REQUEST_CHANGES');
    assert.deepEqual(s.published, [selected === 'addresses' ? 'clear' : 'implementer']);
    assert.equal(s.attempts[0].shadow, false);
    const decision = s.store.mission().review!.rounds.at(-1)!.decision!;
    assert.equal(decision.classifier!.obligations!.generalRound, 1);
    if (selected === 'does_not_address') { assert.match(decision.comment!, /Unresolved prior obligations: F1/); }
  }
});

test('obligation diff retains general decided head across classifier return and verified head drift (TASK-2753)', async () => {
  const s = qualifying();
  const first = s.store.mission().review!.rounds[0];
  const current = s.store.mission().review!.rounds[1];
  const returned = { ...current, decision: { ...first.decision!, revision: changeRevision('d'.repeat(40)), classifier: { kind: 'classifier' } as never } };
  Object.assign(s.store.mission().review!, { rounds: [first, returned, { ...current, number: 3 }] });
  s.context.state.round = 3;
  const round = new ReviewRound(3, s.context);
  round.verifiedRevision = 'c'.repeat(40);
  const ranges: string[] = [];
  s.classifier.evidence.diff = async (base, candidate) => { ranges.push(`${base}..${candidate}`); return '+repair'; };
  answer(s);
  assert.equal(await tryClassifyReview(s.context, round), null);
  assert.deepEqual(ranges, [`${'a'.repeat(40)}..${'c'.repeat(40)}`]);
  assert.equal(s.attempts[0].priorRevision, 'a'.repeat(40));
  assert.equal(s.attempts[0].candidateRevision, 'c'.repeat(40));
});

test('revoked approval uses human requests and missing recorded heads abstain (TASK-2753)', async () => {
  for (const legacy of [false, true]) {
    const s = qualifying();
    const first = s.store.mission().review!.rounds[0];
    Object.assign(first, { decision: { kind: 'approved', revision: legacy ? null : 'a'.repeat(40), decidedAt: '2026-10-01T00:01:00Z',
      source: { kind: 'provider', provider: 'forgejo' }, comment: null,
      revocation: { revokedAt: '2026-10-01T00:02:00Z', revokedBy: 'operator', reason: 'Preserve errors', cause: { kind: 'operator' } } } });
    answer(s);
    assert.equal(await tryClassifyReview(s.context, s.round), null);
    assert.deepEqual(s.attempts[0].findingIds, legacy ? [] : ['H-revocation-1']);
    assert.equal(s.attempts[0].reason, legacy ? 'review-evidence-unavailable' : 'all-obligations-addressed');
  }
});

test('failed obligation calls veto a return while every obligation is attempted once (TASK-2753)', async () => {
  const s = qualifying();
  note(s, 'Preserve errors');
  let calls = 0;
  s.classifier.decision.decide = async () => {
    if (++calls === 2) { throw new Error('unavailable'); }
    return { provider: 'stub', model: 'jev', answers: { resolution: { type: 'choice', selected: 'does_not_address', confidence: 1, probabilities: distribution('does_not_address', 1) } } };
  };
  Object.assign(s.classifier, { obligationMode: 'enabled' });
  assert.equal(await tryClassifyReview(s.context, s.round), null);
  assert.equal(calls, 2);
  assert.equal(s.attempts[0].route, 'reviewer');
  assert.equal(s.attempts[0].reason, 'obligation-call-failure');
  assert.deepEqual(s.published, []);
});

test('obligation packets fit complete question budgets and disclose omitted hunks (TASK-2753)', async () => {
  const s = qualifying();
  s.classifier.evidence.diff = async () => 'diff --git a/x.java b/x.java\n--- a/x.java\n+++ b/x.java\n@@ -1 +1 @@\n-old\n+' + 'large '.repeat(5000);
  s.classifier.decision.requestBudget = request => {
    const n = JSON.stringify(request).length;
    return { inputTokens: n, contextTokens: n, requestBytes: n, maxInputTokens: 6000, maxContextTokens: 6000, maxRequestBytes: 6000, tokenizerModel: 'stub' };
  };
  s.classifier.decision.decide = async request => {
    assert.ok(JSON.stringify(request).length <= 6000);
    assert.match(JSON.stringify(request.state), /omittedDiffs.*x.java/);
    return { provider: 'stub', model: 'jev', answers: { resolution: { type: 'choice', selected: 'insufficient_evidence', confidence: 1, probabilities: distribution('insufficient_evidence', 1) } } };
  };
  assert.equal(await tryClassifyReview(s.context, s.round), null);
  assert.equal(s.attempts[0].reason, 'obligation-abstention');
});

test('activated obligations preserve the general baseline on a later classifier return (TASK-2753)', async () => {
  const s = qualifying();
  Object.assign(s.classifier, { obligationMode: 'enabled' });
  answer(s, 'does_not_address', 0.97);
  assert.equal(await tryClassifyReview(s.context, s.round), 'REQUEST_CHANGES');
  const review = s.store.mission().review!;
  const returned = review.rounds.at(-1)!;
  Object.assign(review, { rounds: [...review.rounds, { ...returned, number: 3, phase: 'reviewing', decision: null, response: null }] });
  s.context.state.round = 3;
  const round = new ReviewRound(3, s.context);
  round.verifiedRevision = 'b'.repeat(40);
  answer(s);
  assert.equal(await tryClassifyReview(s.context, round), 'APPROVED');
  assert.equal(s.store.mission().review!.rounds.at(-1)!.decision!.classifier!.priorRevision, 'a'.repeat(40));
});
