import { fixtureMission, inMemoryTransitionStore } from '../../../fixtures/mission-builders.js';
import { missionId } from '../../../../src/domain/mission.js';
import { changeRevision, reviewFindingId, type ReviewRound as DomainReviewRound, type ReviewFinding } from '../../../../src/domain/review.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { tryClassifyReview } from '../../../../src/application/review-classification/classify-review.js';
import { tryRestoreIntegrationApproval } from '../../../../src/application/review-loop/restore-integration-approval.js';
import { ReviewRound } from '../../../../src/application/review-loop/round.js';
import { pinReviewBaseline } from '../../../../src/application/review-loop/pin-baseline.js';
import { repeatReview } from '../../../fixtures/repeat-review.js';
import { EvidenceReadError } from '../../../../src/application/ports/review-evidence.js';
import { WEAKENING_POLICY_VERSION } from '../../../../src/application/review-classification/weakening-policy.js';
import { PANEL_QUESTIONS } from '../../../../src/application/review-classification/panel-questions.js';
import type { ReviewClassificationPorts } from '../../../../src/application/ports/review-classification.js';
import type { DecisionData, DecisionResult } from '../../../../src/application/ports/decision.js';

import { scenario, distribution } from '../../../helpers/review-classification.js';

test('available default records a real classifier clear and moves through existing approval authority', async () => {
  const s = scenario();
  s.context.state.metadata.humanFeedbackSources = [];
  assert.equal(await tryClassifyReview(s.context, s.round), 'APPROVED');
  assert.deepEqual(s.published, ['clear']);
  const loaded = await s.store.load(missionId(s.context.slug));
  assert.equal(loaded.kind, 'found');
  if (loaded.kind !== 'found') { return; }
  assert.equal(loaded.mission.status, 'integration');
  assert.equal(loaded.mission.review!.rounds.at(-1)!.decision!.classifier!.identity, 'jev');
  assert.equal(s.attempts.length, 1);
});

test('pins an eligible repeat review to the final revision verified after round opening (TASK-2671)', async () => {
  const s = scenario();
  const finalVerifiedRevision = 'c'.repeat(40);
  // Round opening records the implementer's submitted revision. The rebase,
  // declared verification, and Backlog mirror then complete before routing.
  // Their final verified revision is the only candidate Jev may assess.
  s.round.verifiedRevision = finalVerifiedRevision;
  s.context.ports.preReview.head = () => finalVerifiedRevision;

  assert.equal(await tryClassifyReview(s.context, s.round), 'APPROVED');
  assert.equal(s.attempts[0]?.candidateRevision, finalVerifiedRevision);
  const loaded = await s.store.load(missionId(s.context.slug));
  assert.equal(loaded.kind, 'found');
  if (loaded.kind === 'found') {
    assert.equal(loaded.mission.review!.rounds.at(-1)!.subject.revision, 'b'.repeat(40));
    assert.equal(loaded.mission.review!.rounds.at(-1)!.decision!.revision, finalVerifiedRevision);
  }
});

test('a verified repair with a recorded green gate and a non-weakening answer restores the prior approval (TASK-2736)', async () => {
  const s = gateRepairScenario();
  assert.equal(await tryClassifyReview(s.context, s.round), 'APPROVED');
  assert.deepEqual(s.published, ['clear']);
  assert.equal(s.attempts.length, 1);
  assert.equal(s.attempts[0].reason, 'weakening-preserves');
  assert.equal(s.attempts[0].policyVersion, WEAKENING_POLICY_VERSION);
  assert.equal(s.attempts[0].admissibleFact, true);
  assert.equal(s.attempts[0].score, 0.6);
});

test('the restored approval cites its decision source, gate, validation and probability (TASK-2736)', async () => {
  const s = gateRepairScenario();
  assert.equal(await tryClassifyReview(s.context, s.round), 'APPROVED');
  const decision = s.store.mission().review!.rounds.at(-1)!.decision!;
  assert.equal(decision.kind, 'approved');
  assert.deepEqual(decision.classifier!.weakening, { decisionSource: 'integration-repair-weakening', approvedRevision: 'a'.repeat(40), gate: 'unit',
    factAdmitted: true, validationSha: 'b'.repeat(40), validationRecordedAt: '2026-10-01T00:02:30Z', relation: 'same',
    question: { clearedBy: 'weakening-v4-optional-fact-v1', preserves: 0.6, versions: ['weakening-v4-optional-fact-v1', 'weakening-v5-optional-fact-v1'] } });
  assert.equal(decision.classifier!.policyVersion, WEAKENING_POLICY_VERSION);
  assert.equal(decision.classifier!.label, 'preserves');
  assert.equal(decision.classifier!.score, 0.6);
  assert.match(decision.comment ?? '', /restored.*unit.*preserves/);
});

test('verified integration repair supplies the failure lines of its absolute stack path (TASK-2667 regression)', async () => {
  const s = gateRepairScenario();
  const prior = s.store.mission().review!.rounds[0]!;
  const log = `at runSmoke (${s.context.ports.worktree}/x.java:865:14)\n    at Test.run (node:internal/test_runner/test:1402:25)`;
  (prior.decision as { revocation: { cause: { log: string } } }).revocation.cause.log = `AssertionError: ${log}`;
  let called = false;
  const decide = s.classifier.decision.decide;
  s.classifier.decision.decide = async request => {
    called = true;
    assert.match(JSON.stringify(request.state), /runSmoke/);
    assert.match(JSON.stringify(request.state), /return output/);
    return decide(request);
  };
  assert.equal(await tryClassifyReview(s.context, s.round), 'APPROVED');
  assert.equal(called, true);
});

test('opt-out, unavailable provider, API failure and shadow retain the reviewer', async () => {
  for (const mode of ['disabled', 'shadow'] as const) {
    const s = scenario(mode);
    assert.equal(await tryClassifyReview(s.context, s.round), null);
    assert.equal(s.published.length, 0);
  }
  const unavailable = scenario();
  unavailable.classifier.decision.available = () => ({ status: 'setup-required', reason: 'missing key' as const });
  assert.equal(await tryClassifyReview(unavailable.context, unavailable.round), null);
  assert.equal(unavailable.attempts[0].reason, 'provider-unavailable');
  const failed = scenario();
  failed.classifier.decision.decide = async () => { throw new Error('timeout'); };
  assert.equal(await tryClassifyReview(failed.context, failed.round), null);
  assert.equal(failed.attempts[0].reason, 'classifier-failure');
});

test('a rebased branch whose prior revision is not an ancestor still reaches Jev (TASK-2675)', async () => {
  const s = scenario();
  // Prior..candidate on a rebased branch lists files the implementer never touched.
  s.classifier.evidence.diff = async () => '+++ b/x.java\n@@ -1 +1 @@\n-return null;\n+return output;\n'
    + '+++ b/unrelated-upstream.java\nnew file mode 100644\n';
  assert.equal(await tryClassifyReview(s.context, s.round), 'APPROVED');
  assert.equal(s.attempts.length, 1);
  assert.equal(s.attempts[0].reason, 'resolved-threshold');
});

test('human feedback is evidence for Jev rather than a reason to skip it (TASK-2675, TASK-2805)', async () => {
  const s = scenario();
  s.round.humanFeedback = 'New obligation: also keep logging.';
  s.context.state.metadata.humanFeedbackSources = ['comment-7'];
  let state = '';
  const decide = s.classifier.decision.decide;
  s.classifier.decision.decide = async request => { state = JSON.stringify(request.state); return decide(request); };
  assert.equal(await tryClassifyReview(s.context, s.round), 'APPROVED');
  assert.match(state, /New obligation: also keep logging\./);
  assert.match(state, /comment-7/);
});

test('failed publication cannot clear', async () => {
  const post = scenario();
  post.classifier.publish = async () => false;
  assert.equal(await tryClassifyReview(post.context, post.round), null);
  assert.equal((await post.store.load(missionId(post.context.slug))).kind, 'found');
});

test('unresolved classifier returns preserve original findings without invented repairs (TASK-2658)', async () => {
  const s = scenario();
  s.classifier.decision.decide = async () => ({ provider: 'typesafe', model: 'jev', answers: { resolution: {
    type: 'choice', selected: 'does_not_address', probabilities: distribution('does_not_address', 0.89), confidence: 0.1 } } });
  assert.equal(await tryClassifyReview(s.context, s.round), 'REQUEST_CHANGES');
  assert.deepEqual(s.published, ['implementer']);
  assert.deepEqual(s.round.blockingFindings, [{ id: 'F1', summary: 'x.java:1 drops output' }]);
  const loaded = await s.store.load(missionId(s.context.slug));
  assert.equal(loaded.kind, 'found');
  if (loaded.kind !== 'found') { return; }
  const decision = loaded.mission.review!.rounds.at(-1)!.decision!;
  assert.equal(decision.kind, 'changes-requested');
  assert.match(decision.comment!, /Make changes or request general review/);
});

test('one classifier return permits another return using retained findings and comment (TASK-2741)', async () => {
  const s = scenario();
  const prior = s.store.mission().review!.rounds[0]!;
  (prior as { decision: typeof prior.decision }).decision = {
    ...prior.decision!,
    classifier: {
      kind: 'classifier', identity: 'jev', decisionId: 'prior-decision', provider: 'typesafe', model: 'jev',
      packetHash: 'c'.repeat(64), priorRevision: 'd'.repeat(40), candidateRevision: 'a'.repeat(40),
      findingIds: ['F1'], policyVersion: 'repeat-findings-52-89-v2', label: 'does_not_address', score: 0.89,
    },
  };
  s.classifier.decision.decide = async request => {
    assert.match(JSON.stringify(request.state), /Fix output/);
    return result('does_not_address', 0.89);
  };
  assert.equal(await tryClassifyReview(s.context, s.round), 'REQUEST_CHANGES');
  assert.deepEqual(s.published, ['implementer']);
  assert.deepEqual(s.round.blockingFindings, [{ id: 'F1', summary: 'x.java:1 drops output' }]);
});

test('frozen V3 includes 51% approval boundary (TASK-2716)', async () => {
  const s = scenario();
  s.classifier.decision.decide = async () => ({ provider: 'typesafe', model: 'jev', answers: {
    resolution: { type: 'choice', selected: 'addresses', probabilities: distribution('addresses', 0.51), confidence: 0.26 },
  } });
  assert.equal(await tryClassifyReview(s.context, s.round), 'APPROVED');
  assert.equal(s.published.length, 1);
  assert.equal(s.attempts[0].reason, 'resolved-threshold');
  const loaded = await s.store.load(missionId(s.context.slug));
  assert.equal(loaded.kind === 'found' ? loaded.mission.review?.rounds.at(-1)?.decision?.kind : undefined, 'approved');
});

test('mandatory evidence failures defer while human context remains eligible (TASK-2716)', async () => {
  const exits: Record<string, (s: ReturnType<typeof scenario>) => void> = {
    'uncited path': s => { s.classifier.evidence.tree = async () => ['other/y.java']; },
    'no source excerpts': s => { s.classifier.evidence.source = async () => { throw new Error('gone'); }; },
    'oversized evidence': s => { const budget = s.classifier.decision.requestBudget; s.classifier.decision.requestBudget = request => ({ ...budget(request), requestBytes: 10_000_000 }); },
    'human feedback': s => { s.round.humanFeedback = 'Please also fix Y.'; },
    'human feedback sources': s => { s.context.state.metadata.humanFeedbackSources = ['c1']; },
    'rebased unrelated diff': s => { s.classifier.evidence.diff = async () => '+++ b/other.java\nnew file mode 100644\n'; },
  };
  for (const [name, arrange] of Object.entries(exits)) {
    const s = scenario();
    let calls = 0;
    const decide = s.classifier.decision.decide;
    s.classifier.decision.decide = async request => { calls++; return decide(request); };
    arrange(s);
    const missing = ['uncited path', 'no source excerpts', 'oversized evidence'].includes(name);
    assert.equal(await tryClassifyReview(s.context, s.round), missing ? null : 'APPROVED', name);
    assert.equal(calls, missing ? 0 : 3, name);
    assert.equal(s.attempts.length, 1, name);
  }
});

test('every re-review round records exactly one row with a reason, including early exits (TASK-2675)', async () => {
  const reasonOf = async (arrange: (s: ReturnType<typeof scenario>) => void, expected: string, mode?: ReviewClassificationPorts['mode']) => {
    const s = scenario(mode);
    arrange(s);
    await tryClassifyReview(s.context, s.round);
    assert.deepEqual(s.attempts.map(a => a.reason), [expected]);
    assert.equal(s.attempts[0].route, 'reviewer');
    assert.ok(s.attempts[0].decisionId);
  };
  await reasonOf(() => {}, 'opted-out', 'disabled');
  await reasonOf(s => { s.context.state.round = 5; }, 'review-evidence-unavailable');
  await reasonOf(s => { (s.context.ports as { lifecycle: unknown }).lifecycle = undefined; }, 'ports-unavailable');
  await reasonOf(s => { (s.store.mission() as { review: unknown }).review = null; }, 'review-evidence-unavailable');
  await reasonOf(s => { s.classifier.decision.available = () => ({ status: 'setup-required', reason: 'x' as const }); }, 'provider-unavailable');
  await reasonOf(s => { s.classifier.decision.decide = async () => { throw new Error('x'); }; }, 'classifier-failure');
  await reasonOf(s => { s.classifier.publish = async () => false; }, 'classifier-publication-failed');
});

test('a mission version that moves while the panel runs refuses stale publication (TASK-2716)', async () => {
  const s = scenario();
  const decide = s.classifier.decision.decide;
  s.classifier.decision.decide = async request => { const result = await decide(request); await s.store.save(s.store.mission()); return result; };
  assert.equal(await tryClassifyReview(s.context, s.round), null);
  assert.deepEqual(s.published, []);
});

test('a pending human intervention does not stop the classifier from being called (TASK-2675)', async () => {
  const s = scenario();
  (s.store.mission().review as { intervention: unknown }).intervention = { requestedAt: '2026-10-01T00:04:00Z', requestedBy: 'implementer', reason: 'needs a human' };
  assert.equal(await tryClassifyReview(s.context, s.round), 'APPROVED');
  assert.deepEqual(s.published, ['clear']);
});

test('a retried round keeps one decision identity so statistics count it once (TASK-2675)', async () => {
  const s = scenario();
  s.classifier.publish = async () => false;
  await tryClassifyReview(s.context, s.round);
  await tryClassifyReview(s.context, s.round);
  assert.equal(s.attempts.length, 2);
  assert.equal(s.attempts[0].decisionId, s.attempts[1].decisionId);
});

/** Only readonly modifiers are removed from case-owned round data. */
type MutableRound = { -readonly [K in keyof DomainReviewRound]: DomainReviewRound[K] };
function reshape(s: ReturnType<typeof scenario>) {
  const stored = s.store.mission();
  assert.ok(stored.review);
  assert.ok(stored.review.rounds[1], 'the repeat-review fixture has two rounds');
  const mission = stored as { review: ReturnType<typeof repeatReview>; successCriteria?: readonly string[] };
  const rounds = mission.review.rounds as [MutableRound, ...MutableRound[]];
  return { mission, rounds: rounds as [MutableRound, MutableRound, ...MutableRound[]] };
}

test('a re-review whose candidate differs from the recorded response revision reaches the classifier (TASK-2680)', async () => {
  const s = scenario();
  const response = s.store.mission().review!.rounds[0].response;
  assert.ok(response);
  reshape(s).rounds[0].response = { ...response, resultingRevision: changeRevision('d'.repeat(40)) };
  s.round.verifiedRevision = 'c'.repeat(40);
  s.context.ports.preReview.head = () => 'c'.repeat(40);
  assert.equal(await tryClassifyReview(s.context, s.round), 'APPROVED');
  assert.deepEqual(s.attempts.map(a => a.reason), ['resolved-threshold']);
  assert.equal(s.attempts[0].candidateRevision, 'c'.repeat(40));
});

test('a re-review whose prior findings were never answered falls back with a specific reason (TASK-2680)', async () => {
  const s = scenario();
  reshape(s).rounds[0].response = null;
  assert.equal(await tryClassifyReview(s.context, s.round), null);
  assert.deepEqual(s.attempts.map(a => a.reason), ['implementer-response-missing']);
});

test('first reviews stay with the general reviewer without collecting evidence or calling Jev (TASK-2703)', async () => {
  for (const [number, mode] of [[1, 'enabled'], [1, 'shadow'], [2, 'enabled']] as const) {
    const s = scenario(mode);
    const { mission, rounds } = reshape(s);
    mission.review = { ...mission.review, rounds: [{ ...mission.review.rounds[1], number, subject: { ...rounds[1].subject } }] };
    mission.successCriteria = ['Output is preserved in x.java'];
    s.context.state.round = number;
    const round = new ReviewRound(number, s.context);
    s.classifier.evidence.diff = async () => { return assert.fail('first review must not collect evidence'); };
    s.classifier.decision.available = async () => { return assert.fail('first review must not reach the decision provider'); };
    s.classifier.decision.decide = async () => { return assert.fail('first review must not call Jev'); };
    assert.equal(await tryClassifyReview(s.context, round), null);
    assert.deepEqual(s.published, []);
    assert.deepEqual(s.attempts.map(a => a.reason), ['first-review']);
    assert.equal(s.store.mission().review!.rounds.at(-1)!.decision, null);
  }
});

test('an unverified integration repair keeps its specific reason (TASK-2680)', async () => {
  const s = scenario();
  const prior = reshape(s).rounds[0];
  prior.decision = { kind: 'approved', revision: changeRevision('a'.repeat(40)), decidedAt: '2026-10-01T00:01:00Z', comment: 'ok', source: { kind: 'local' },
    revocation: { revokedAt: '2026-10-01T00:02:00Z', revokedBy: 'operator', reason: 'x', cause: { kind: 'integration-gate-failure', gate: 'unit', command: 'npm test', log: null } } };
  assert.equal(await tryClassifyReview(s.context, s.round), null);
  assert.deepEqual(s.attempts.map(a => a.reason), ['integration-repair-unverified']);
});

/** Gate repair rounds retain the original obligation even after Jev requested changes. */
function gateRepairScenario(consecutive = false) {
  const s = scenario();
  const prior = s.store.mission().review!.rounds[0]!;
  const classifier = {
    kind: 'classifier' as const, identity: 'jev' as const, decisionId: 'prior-decision', provider: 'typesafe', model: 'jev',
    packetHash: 'c'.repeat(64), priorRevision: 'd'.repeat(40), candidateRevision: 'a'.repeat(40),
    findingIds: ['integration-gate-repair'], policyVersion: 'integration-repair-52-67-v1', label: 'does_not_address', score: 0.67,
    integrationRepair: { revokedAt: '2026-10-01T00:02:00Z', gate: 'unit' },
  } satisfies import("../../../../src/domain/classifier-review.js").ClassifierReviewSource;
  if (consecutive) {
    const finding = { id: reviewFindingId('integration-gate-repair'), summary: 'x.java:1 drops output', location: 'x.java:1' };
    (prior as { decision: typeof prior.decision }).decision = {
      kind: 'changes-requested', revision: changeRevision('a'.repeat(40)), decidedAt: '2026-10-01T00:01:00Z', comment: 'Gate repair remains unresolved.', findings: [finding], classifier,
    };
    (prior as { response: typeof prior.response }).response = { ...prior.response!,
      resolutions: [{ findingId: finding.id, kind: 'fixed', evidence: 'Preserve output' }] };
  } else {
    (prior as { decision: typeof prior.decision }).decision = {
      kind: 'approved', revision: changeRevision('a'.repeat(40)), decidedAt: '2026-10-01T00:01:00Z', comment: 'Approved before integration.', source: { kind: 'local' },
      revocation: { revokedAt: '2026-10-01T00:02:00Z', revokedBy: 'operator', reason: 'integration gate failed',
        cause: { kind: 'integration-gate-failure', gate: 'unit', command: 'npm test', log: 'x.java:1 drops output' } },
    };
    (prior as { response: typeof prior.response }).response = null;
    s.round.integrationRepair = 'verified repair';
    s.round.verifiedRevision = 'b'.repeat(40);
    (prior.subject as { baseline?: string }).baseline = 'e'.repeat(40);
    s.round.reviewBaseline = 'e'.repeat(40);
    s.classifier.validations = async () => [{ sha: 'b'.repeat(40), hooks: ['unit'], recordedAt: '2026-10-01T00:02:30Z' }];
    s.classifier.decision.decide = weakeningAnswer('preserves', 0.6);
  }
  return s;
}

const weakeningAnswer = (selected: string, preserves: number) => async () => ({ provider: 'typesafe', model: 'jev', answers: { resolution: {
  type: 'choice' as const, selected, confidence: 0.1,
  probabilities: { preserves, weakens: selected === 'weakens' ? 1 - preserves : 0, insufficient_evidence: selected === 'insufficient_evidence' ? 1 - preserves : 0, ...(selected === 'preserves' ? { weakens: 1 - preserves } : {}) } } } });

test('every weakening outcome other than preserves at the threshold goes to normal review and never returns the mission (TASK-2736)', async () => {
  for (const [selected, preserves, reason] of [
    ['preserves', 0.6, 'weakening-preserves'], ['preserves', 0.599, 'weakening-below-threshold'], ['weakens', 0.4, 'weakening-weakens'],
    ['insufficient_evidence', 0.3, 'weakening-insufficient-evidence'],
    // A contradictory answer which selects another label never clears, whatever its preserves probability.
    ['weakens', 0.6, 'weakening-weakens'], ['insufficient_evidence', 0.6, 'weakening-insufficient-evidence'],
  ] as const) {
    const s = gateRepairScenario();
    s.classifier.decision.decide = weakeningAnswer(selected, preserves);
    const expected = reason === 'weakening-preserves' ? 'APPROVED' : null;
    assert.equal(await tryClassifyReview(s.context, s.round), expected, reason);
    assert.equal(s.attempts[0].reason, reason);
    assert.equal(s.attempts[0].score, preserves);
    assert.deepEqual(s.published, expected ? ['clear'] : []);
    assert.equal(s.store.mission().review!.rounds.at(-1)!.decision?.kind, expected ? 'approved' : undefined);
  }
});

test('a failed or malformed weakening call goes to normal review (TASK-2736)', async () => {
  const failing = gateRepairScenario();
  failing.classifier.decision.decide = async () => { throw new Error('provider down'); };
  const malformed = gateRepairScenario();
  malformed.classifier.decision.decide = async () => ({ provider: 'typesafe', model: 'jev', answers: { resolution: {
    type: 'choice', selected: 'preserves', probabilities: { preserves: 0.9, weakens: 0.9, insufficient_evidence: 0 }, confidence: 0.1 } } });
  for (const run of [failing, malformed]) {
    assert.equal(await tryClassifyReview(run.context, run.round), null);
    assert.equal(run.attempts[0].reason, 'weakening-failure');
    assert.notEqual(run.attempts[0].classificationMs, null, 'the invocation is recorded even when the answer is unusable');
    assert.deepEqual(run.published, []);
  }
});

test('every rejected gate fact still reaches weakening without claiming validation (TASK-2754)', async () => {
  const cases: [string, (_s: ReturnType<typeof gateRepairScenario>) => void, string][] = [
    ['no validation', s => { s.classifier.validations = async () => []; }, 'weakening-no-fact'],
    ['recorded after the round started', s => { s.classifier.validations = async () => [{ sha: 'b'.repeat(40), hooks: ['unit'], recordedAt: '2026-10-01T00:03:01Z' }]; }, 'weakening-fact-after-round-start'],
    ['another gate', s => { s.classifier.validations = async () => [{ sha: 'b'.repeat(40), hooks: ['lint'], recordedAt: '2026-10-01T00:02:30Z' }]; }, 'weakening-gate-not-validated'],
    ['code after the validated sha', s => {
      s.classifier.validations = async () => [{ sha: 'f'.repeat(40), baseline: 'e'.repeat(40), hooks: ['unit'], recordedAt: '2026-10-01T00:02:30Z' }];
      s.classifier.evidence.changedPaths = async () => ['x.java'];
    }, 'weakening-code-after-validated-sha'],
  ];
  cases.push(['relation unavailable', s => {
    s.classifier.validations = async () => [{ sha: 'f'.repeat(40), baseline: 'e'.repeat(40), hooks: ['unit'], recordedAt: '2026-10-01T00:02:30Z' }];
    s.classifier.evidence.changedPaths = async () => { throw new Error('unavailable'); };
  }, 'relation-unavailable']);
  for (const [name, arrange] of cases) {
    const s = gateRepairScenario();
    arrange(s);
    assert.equal(await tryClassifyReview(s.context, s.round), 'APPROVED', name);
    assert.equal(s.attempts[0].admissibleFact, false, name);
    assert.deepEqual(s.published, ['clear'], name);
    const source = s.store.mission().review!.rounds.at(-1)!.decision!.classifier!;
    assert.equal(source.weakening!.validationSha, undefined);
    assert.doesNotMatch(s.store.mission().review!.rounds.at(-1)!.decision!.comment!, /re-ran green/);
  }
});

test('a validation at a backlog-only or rebased-only predecessor of the candidate is admissible (TASK-2736)', async () => {
  const backlog = gateRepairScenario();
  backlog.classifier.validations = async () => [{ sha: 'f'.repeat(40), baseline: 'e'.repeat(40), hooks: ['unit'], recordedAt: '2026-10-01T00:02:30Z' }];
  backlog.classifier.evidence.changedPaths = async () => ['backlog/tasks/task-2658 - x.md'];
  assert.equal(await tryClassifyReview(backlog.context, backlog.round), 'APPROVED');
  assert.equal(backlog.store.mission().review!.rounds.at(-1)!.decision!.classifier!.weakening!.relation, 'backlog-only');
  const rebased = gateRepairScenario();
  rebased.classifier.validations = async () => [{ sha: 'f'.repeat(40), baseline: 'e'.repeat(40), hooks: ['unit'], recordedAt: '2026-10-01T00:02:30Z' }];
  rebased.classifier.evidence.changedPaths = async () => ['x.java'];
  for (const round of rebased.store.mission().review!.rounds) { (round.subject as { baseline?: string }).baseline = 'e'.repeat(40); }
  rebased.round.reviewBaseline = 'd'.repeat(40);
  rebased.classifier.evidence.missionInterdiff = async before => before.revision === 'f'.repeat(40) ? { diff: '', paths: [] } : { diff: '+repair', paths: ['x.java'] };
  assert.equal(await tryClassifyReview(rebased.context, rebased.round), 'APPROVED');
  assert.equal(rebased.store.mission().review!.rounds.at(-1)!.decision!.classifier!.weakening!.relation, 'rebase-only');
});

test('a classifier return about a gate repair can reach the normal findings panel (TASK-2741)', async () => {
  const s = gateRepairScenario(true);
  assert.equal(await tryClassifyReview(s.context, s.round), 'APPROVED');
  assert.equal(s.attempts[0].reason, 'resolved-threshold');
});


test('ordinary finding re-reviews retain the 89% return threshold (TASK-2692)', async () => {
  const s = scenario();
  s.classifier.decision.decide = async () => ({ provider: 'typesafe', model: 'jev', answers: { resolution: {
    type: 'choice', selected: 'does_not_address', probabilities: distribution('does_not_address', 0.67), confidence: 0.1 } } });
  assert.equal(await tryClassifyReview(s.context, s.round), null);
  assert.equal(s.attempts[0].policyVersion, 'jev-three-question-51-80-89-omissions-v2');
  assert.deepEqual(s.published, []);
});

test('a revoked classifier clear reaches weakening and unchanged-patch restore (TASK-2741)', async () => {
  for (const unchanged of [false, true]) {
    const s = gateRepairScenario();
    const prior = s.store.mission().review!.rounds[0]!;
    (prior as { decision: typeof prior.decision }).decision = { ...prior.decision!,
      classifier: { ...gateRepairScenario(true).store.mission().review!.rounds[0].decision!.classifier!,
        label: 'addresses', score: 0.52 } };
    if (unchanged) {
      (s.store.mission().review!.rounds[1].subject as { baseline?: string }).baseline = 'e'.repeat(40);
      s.context.ports.restoration = {
        samePatch: async () => true,
        validation: async () => ({ sha: 'b'.repeat(40), baseline: 'e'.repeat(40), hooks: ['unit'],
          createdAt: '2026-10-01T00:02:30Z', missionId: s.context.slug, reference: 'isolated-green' }),
        now: () => '2026-10-06T00:00:00Z',
      };
      (s.store.mission().review!.rounds[1].subject as { revision: string }).revision = 'start-before-verified';
      assert.equal(await tryRestoreIntegrationApproval(s.context, s.round), 'APPROVED');
      assert.equal(s.store.mission().review!.rounds[1].subject.revision, 'start-before-verified');
      assert.equal(s.store.mission().review!.rounds[1].decision?.revision, 'b'.repeat(40));
      assert.equal(s.attempts.length, 0);
    } else {
      assert.equal(await tryClassifyReview(s.context, s.round), 'APPROVED');
      assert.equal(s.attempts[0].reason, 'weakening-preserves');
    }
  }
});

test('two mission-local classifier returns hand off and recorded reviewer or clear decisions reset the sequence (TASK-2741)', async () => {
  for (const reset of [null, 'reviewer', 'clear'] as const) {
    const s = gateRepairScenario(true);
    const { rounds } = reshape(s);
    const returned = structuredClone(rounds[0]);
    const history = [returned, structuredClone(returned)];
    if (reset) {
      const breaker = structuredClone(returned);
      if (reset === 'reviewer') { breaker.decision = { ...breaker.decision!, classifier: undefined }; }
      else { breaker.decision = { kind: 'approved', revision: changeRevision('a'.repeat(40)), comment: 'Classifier clear', decidedAt: returned.decision!.decidedAt,
        source: { kind: 'local' }, classifier: { ...returned.decision!.classifier!, label: 'addresses', score: 0.52 } }; }
      history.push(breaker, structuredClone(returned));
    }
    rounds.splice(0, 1, ...history);
    rounds.forEach((round, index) => { round.number = index + 1; });
    s.context.state.round = rounds.length;
    const round = new ReviewRound(rounds.length, s.context);
    if (!reset) {
      s.classifier.decision.available = () => { return assert.fail('bound must precede provider access'); };
      s.classifier.evidence.diff = async () => { return assert.fail('bound must precede evidence collection'); };
    }
    assert.equal(await tryClassifyReview(s.context, round), reset ? 'APPROVED' : null);
    assert.equal(s.attempts[0].reason, reset ? 'resolved-threshold' : 'consecutive-classifier-returns');
    assert.deepEqual(s.published, reset ? ['clear'] : []);
  }
});

test('another mission classifier-return history cannot affect this mission (TASK-2741)', async () => {
  const returned = gateRepairScenario(true).store.mission().review!.rounds[0];
  const other = inMemoryTransitionStore(fixtureMission('task-other', { status: 'review',
    review: { ...repeatReview(), rounds: [returned, { ...returned, number: 2 }] } }));
  const own = scenario();
  const load = own.context.ports.missionStore!.load;
  own.context.ports.missionStore!.load = async id => id === own.context.slug ? load(id) : other.load(id);
  assert.equal(other.mission().review!.rounds.filter(r => r.decision?.classifier).length, 2);
  assert.equal(await tryClassifyReview(own.context, own.round), 'APPROVED');
  assert.equal(own.attempts[0].reason, 'resolved-threshold');
});

test('a prior classifier clear reaches the success-criteria findings panel (TASK-2741)', async () => {
  const s = scenario();
  const { mission, rounds } = reshape(s);
  rounds[0].decision = { kind: 'approved', revision: changeRevision('a'.repeat(40)), comment: 'Classifier clear', decidedAt: '2026-10-01T00:01:00Z', source: { kind: 'local' },
    classifier: { ...gateRepairScenario(true).store.mission().review!.rounds[0].decision!.classifier!,
      label: 'addresses', score: 0.52 } };
  mission.successCriteria = ['Output is preserved in x.java'];
  assert.equal(await tryClassifyReview(s.context, s.round), 'APPROVED');
  assert.equal(s.attempts[0].reason, 'resolved-threshold');
});


test('an added finding still requires a complete recorded response after a classifier return (TASK-2741)', async () => {
  const s = gateRepairScenario(true);
  const prior = s.store.mission().review!.rounds[0]!;
  if (prior.decision?.kind !== 'changes-requested') { throw new Error('missing prior return'); }
  (prior.decision as { findings: readonly ReviewFinding[] }).findings = [...prior.decision.findings,
    { id: reviewFindingId('F2'), summary: 'New obligation: preserve logging', location: null }];
  assert.equal(await tryClassifyReview(s.context, s.round), null);
  assert.equal(s.attempts[0].reason, 'classifier-exception');
  assert.deepEqual(s.published, []);
});

test('oversized mandatory repair evidence retains general review without calling Jev (TASK-2692)', async () => {
  const s = gateRepairScenario();
  const budget = s.classifier.decision.requestBudget;
  s.classifier.decision.requestBudget = request => ({ ...budget(request), contextTokens: 30001 });
  let calls = 0;
  s.classifier.decision.decide = async () => { calls++; throw new Error('must not send an incomplete packet'); };
  assert.equal(await tryClassifyReview(s.context, s.round), null);
  assert.equal(calls, 0);
  assert.deepEqual(s.published, []);
  assert.equal(s.store.mission().review!.rounds.at(-1)!.decision, null);
  assert.equal(s.attempts[0].reason, 'weakening-over-budget');
});

test('first review retains its immutable baseline without classifying while main advances (TASK-2704)', async () => {
  const s = scenario();
  const { mission, rounds } = reshape(s);
  mission.review = { ...mission.review, rounds: [{ ...mission.review.rounds[1], number: 1, subject: { ...rounds[1].subject } }] };
  mission.successCriteria = ['Output is preserved in x.java'];
  s.context.state.round = 1;
  const pinned = 'e'.repeat(40);
  s.context.ports.preReview.reviewBaseline = () => pinned;
  const round = new ReviewRound(1, s.context);
  // Main moves after the pre-review rebase; the round must not follow it.
  s.context.ports.preReview.reviewBaseline = () => 'f'.repeat(40);
  const ranges: string[] = [];
  const diff = s.classifier.evidence.diff;
  s.classifier.evidence.diff = async (prior, candidate, paths) => { ranges.push(`${prior}..${candidate}`); return diff(prior, candidate, paths); };
  assert.equal(await tryClassifyReview(s.context, round), null);
  assert.equal(round.reviewBaseline, pinned);
  assert.deepEqual(ranges, []);
  assert.equal(s.attempts[0].reason, 'first-review');
});

test('a rebased gate repair sends the restricted diff of the mission interdiff files (TASK-2716, TASK-2732, TASK-2736)', async () => {
  const s = gateRepairScenario();
  for (const round of s.store.mission().review!.rounds) {
    (round.subject as { baseline?: string }).baseline = 'e'.repeat(40);
  }
  let calls = 0;
  const seen: (readonly string[])[] = [];
  s.classifier.evidence.diff = async (_from, _to, paths) => { seen.push(paths); return `+repair in ${paths.join()}`; };
  s.classifier.evidence.missionInterdiff = async () => {
    calls++; return { diff: '+repair', paths: ['x.java', 'backlog/tasks/task-2658 - x.md'] };
  };
  assert.equal(await tryClassifyReview(s.context, s.round), 'APPROVED');
  assert.equal(calls, 1);
  assert.deepEqual(seen, [['x.java']]);
});

test('classifier failures persist a distinguishable cause (TASK-2704)', async () => {
  const over = gateRepairScenario();
  const budget = over.classifier.decision.requestBudget;
  over.classifier.decision.requestBudget = request => ({ ...budget(request), contextTokens: 30001 });
  const read = gateRepairScenario();
  read.classifier.evidence.diff = async () => { throw new EvidenceReadError('git diff output exceeds the read limit', true); };
  const other = gateRepairScenario();
  other.classifier.decision.requestBudget = () => { throw new Error('tokenizer unavailable'); };
  for (const run of [over, read, other]) { assert.equal(await tryClassifyReview(run.context, run.round), null); }
  assert.deepEqual([over, read, other].map(run => run.attempts[0].reason), ['weakening-over-budget', 'weakening-failure', 'weakening-failure']);
  assert.match(over.logs.join('\n'), /Reviewer classifier not used \(weakening-over-budget\)/);
});

test('a missing provider key is its own cause and is announced to the operator once without credentials (TASK-2704)', async () => {
  const s = scenario();
  s.classifier.decision.available = () => ({ status: 'setup-required', reason: 'Export TYPESAFE_API_KEY to enable decisions.' as const, cause: 'credentials-missing' });
  assert.equal(await tryClassifyReview(s.context, s.round), null);
  assert.equal(await tryClassifyReview(s.context, new ReviewRound(2, s.context)), null);
  assert.deepEqual(s.attempts.map(a => a.reason), ['provider-key-missing', 'provider-key-missing']);
  const notices = s.logs.filter(line => /no decision provider key/.test(line));
  assert.equal(notices.length, 1);
  assert.match(notices[0], /TYPESAFE_API_KEY, OPENROUTER_API_KEY or AI_GATEWAY_API_KEY/);
  assert.match(notices[0], /launched agents never receive these keys/);
  const misconfigured = scenario();
  misconfigured.classifier.decision.available = () => ({ status: 'setup-required', reason: 'JEV_CODE_PROVIDER conflicts with TYPESAFE_BASE_URL.' as const });
  await tryClassifyReview(misconfigured.context, misconfigured.round);
  assert.equal(misconfigured.attempts[0].reason, 'provider-unavailable');
  assert.equal(misconfigured.logs.filter(line => /no decision provider key/.test(line)).length, 0);
});

test('a round keeps its review baseline with its reviewed subject across reload (TASK-2704)', async () => {
  const s = scenario();
  s.round.reviewBaseline = 'e'.repeat(40);
  await pinReviewBaseline(s.context, s.round);
  const loaded = await s.store.load(missionId(s.context.slug));
  if (loaded.kind !== 'found') { throw new Error('mission missing'); }
  const rounds = loaded.mission.review!.rounds;
  assert.equal(rounds.at(-1)!.subject.baseline, 'e'.repeat(40));
  assert.equal(rounds[0].subject.baseline, undefined, 'a decided round is never rewritten');
  s.round.reviewBaseline = 'f'.repeat(40);
  assert.equal(await tryClassifyReview(s.context, s.round), 'APPROVED');
  const decided = await s.store.load(missionId(s.context.slug));
  if (decided.kind !== 'found') { throw new Error('mission missing'); }
  assert.equal(decided.mission.review!.rounds.at(-1)!.subject.baseline, 'e'.repeat(40), 'the baseline recorded for the round survives its decision');
});

function result(selected: string, score: number): DecisionResult {
  return { provider: 'typesafe', model: 'actual-jev', answers: { resolution: {
    type: 'choice', selected, probabilities: distribution(selected, score), confidence: 0.01 } },
    usage: { inputTokens: 100, outputTokens: 5, cost: 0.001 } };
}

function panelScenario(answers: readonly (DecisionResult | Error)[]) {
  const s = scenario();
  let calls = 0;
  const states: unknown[] = [];
  s.classifier.decision.decide = async request => {
    const index = calls++;
    states.push(request.state);
    assert.deepEqual(request.questions, { resolution: Object.values(PANEL_QUESTIONS)[index] });
    assert.ok(Object.isFrozen(request.state));
    const answer = answers[index];
    if (answer instanceof Error) { throw answer; }
    return answer;
  };
  return { ...s, states, calls: () => calls };
}

const abstain = () => result('insufficient_evidence', 1);
for (const [id, index, label, threshold, route] of [
  ['v3 approval', 0, 'addresses', 0.51, 'APPROVED'],
  ['v1 approval', 1, 'addresses', 0.80, 'APPROVED'],
  ['v1 rejection', 1, 'does_not_address', 0.89, 'REQUEST_CHANGES'],
  ['original rejection', 2, 'does_not_address', 0.89, 'REQUEST_CHANGES'],
] as const) {
  test(`panel ${id} includes exact threshold and excludes immediately below (TASK-2716)`, async () => {
    for (const score of [threshold, threshold - 0.000001]) {
      const answers = [abstain(), abstain(), abstain()];
      answers[index] = result(label, score);
      const s = panelScenario(answers);
      assert.equal(await tryClassifyReview(s.context, s.round), score === threshold ? route : null);
      assert.equal(s.calls(), 3);
      assert.ok(s.states.every(state => state === s.states[0]));
      assert.equal(s.published.length, score === threshold ? 1 : 0);
      assert.equal(s.attempts.length, 1);
      assert.equal(s.attempts[0].panel?.calls, 3);
      assert.equal(s.attempts[0].panel?.members[index].model, 'actual-jev');
    }
  });
}

test('disabled channels, no votes and conflicting directions retain general review (TASK-2716)', async () => {
  for (const answers of [
    [result('does_not_address', 1), abstain(), abstain()],
    [abstain(), abstain(), result('addresses', 1)],
    [abstain(), abstain(), abstain()],
    [result('addresses', 0.51), abstain(), result('does_not_address', 0.89)],
  ]) {
    const s = panelScenario(answers);
    assert.equal(await tryClassifyReview(s.context, s.round), null);
    assert.equal(s.calls(), 3);
    assert.equal(s.published.length, 0);
  }
});

test('every failed or invalid panel member vetoes partial approval (TASK-2716)', async () => {
  const malformed = { ...result('addresses', 1), answers: {} };
  for (const index of [0, 1, 2]) {
    for (const failure of [new Error('timeout'), malformed]) {
      const answers: (DecisionResult | Error)[] = [result('addresses', 1), result('addresses', 1), abstain()];
      answers[index] = failure;
      const s = panelScenario(answers);
      assert.equal(await tryClassifyReview(s.context, s.round), null);
      assert.equal(s.calls(), 3);
      assert.deepEqual(s.published, []);
      assert.equal(s.attempts[0].reason, 'classifier-failure');
    }
  }
});

test('later panel member budgets are checked before any provider call (TASK-2716)', async () => {
  for (const patch of [{ inputTokens: 32001 }, { contextTokens: 30001 }, { requestBytes: 1000001 }, { inputTokens: NaN }]) {
    const s = scenario();
    const budget = s.classifier.decision.requestBudget;
    s.classifier.decision.requestBudget = request => ({ ...budget(request),
      ...(request.questions.resolution.instructions === PANEL_QUESTIONS.v1.instructions ? patch : {}) });
    s.classifier.decision.decide = async () => { return assert.fail('budget failure must prevent all calls'); };
    assert.equal(await tryClassifyReview(s.context, s.round), null);
    assert.deepEqual(s.published, []);
    assert.equal(s.attempts[0].reason, 'evidence-over-budget');
  }
});

test('HEAD drift and duplicate panel execution cannot publish a stale or second decision (TASK-2716)', async () => {
  const drift = scenario();
  const decide = drift.classifier.decision.decide;
  drift.classifier.decision.decide = async request => { drift.context.ports.preReview.head = () => 'f'.repeat(40); return decide(request); };
  assert.equal(await tryClassifyReview(drift.context, drift.round), null);
  assert.equal(drift.attempts[0].reason, 'classifier-stale-result');
  assert.deepEqual(drift.published, []);
  const duplicate = scenario();
  assert.equal(await tryClassifyReview(duplicate.context, duplicate.round), 'APPROVED');
  assert.equal(await tryClassifyReview(duplicate.context, duplicate.round), null);
  assert.deepEqual(duplicate.published, ['clear']);
});

test('preparation failures retain a zero-call whole-panel fallback record (TASK-2716)', async () => {
  const s = scenario();
  s.classifier.evidence.source = async () => { throw new EvidenceReadError('missing pinned source'); };
  assert.equal(await tryClassifyReview(s.context, s.round), null);
  assert.equal(s.attempts[0].panel!.calls, 0);
  assert.equal(s.attempts[0].panel!.outcome, 'reviewer');
  assert.equal(s.attempts[0].panel!.reason, s.attempts[0].reason);
  assert.deepEqual(s.attempts[0].panel!.members, []);
});

test('saved scoped safety and complementary outcomes replay without policy or context tuning (TASK-2716)', async () => {
  const { default: retained } = await import('../../../fixtures/review-classification/frozen-panel-regressions.json', { with: { type: 'json' } });
  const { panelVote, aggregatePanel } = await import('../../../../src/application/review-classification/panel.js');
  const originalBodies = Object.fromEntries(Object.entries(PANEL_QUESTIONS).map(([id, question]) => [id, { ...question, instructions: question.instructions.replace('When the state lists omissions, that evidence was not shown. Select insufficient_evidence when an omitted change could decide the answer. ', '') }]));
  assert.deepEqual(retained.questions, originalBodies, 'research question bodies remain exact apart from authorized omission instruction');
  assert.equal(retained.cases.length, 9);
  for (const sample of retained.cases) {
    assert.equal(new Set(sample.members.map(m => m.stateSha256)).size, 1, sample.id);
    const members = sample.members.map(member => {
      assert.match(member.requestSha256, /^[a-f0-9]{64}$/);
      const question = member.question as keyof typeof PANEL_QUESTIONS;
      return { question, questionHash: createHash('sha256').update(JSON.stringify(PANEL_QUESTIONS[question])).digest('hex'),
        provider: member.response.provider, configuredModel: 'jev-latest', model: member.response.model,
        usage: member.response.usage, ...panelVote(question, member.response as DecisionResult) };
    });
    const outcome = aggregatePanel(members);
    assert.equal(outcome.route, sample.expected, sample.id);
    assert.ok(members.every(m => m.failure === null), sample.id);
    if (/2586|2640/.test(sample.id)) { assert.notEqual(outcome.route, 'clear', sample.id); }
    if (/2500\.05/.test(sample.id)) {
      assert.equal(members[0].selected, 'does_not_address');
      assert.equal(members[0].vote, null, 'V3-only reject channel stays disabled');
      assert.notEqual(outcome.route, 'implementer');
    }
  }
});

test('invalid oversized returned model retains bounded whole-panel fallback telemetry (TASK-2716)', async () => {
  const s = panelScenario([result('addresses', 1), { ...result('addresses', 1), model: 'x'.repeat(17000) }, abstain()]);
  assert.equal(await tryClassifyReview(s.context, s.round), null);
  assert.equal(s.attempts[0].panel!.members[1].model, null);
  assert.equal(s.attempts[0].panel!.members[1].failure, 'invalid-answer');
  assert.ok(Buffer.byteLength(JSON.stringify(s.attempts[0])) < 16384);
  assert.deepEqual(s.published, []);
});

test('no selectable excerpt has distinct zero-call preparation fallback (TASK-2732)', async () => {
  const s = scenario();
  s.classifier.evidence.tree = async () => [];
  s.classifier.evidence.diff = async () => '';
  assert.equal(await tryClassifyReview(s.context, s.round), null);
  assert.equal(s.attempts[0].reason, 'evidence-preparation-fallback');
  assert.equal(s.attempts[0].panel!.calls, 0);
});

test('panel question token pressure omits whole context before refusing re-review (TASK-2732)', async () => {
  const s = scenario();
  const measure = s.classifier.decision.requestBudget;
  s.classifier.decision.requestBudget = request => ({
    ...measure(request),
    contextTokens: Object.keys((request.state as { candidateSourceExcerpts?: object }).candidateSourceExcerpts ?? {}).length > 0
      && request.questions.resolution.instructions === PANEL_QUESTIONS.v3.instructions ? 30001 : 1,
  });
  const decide = s.classifier.decision.decide;
  s.classifier.decision.decide = async request => {
    assert.deepEqual((request.state as { candidateSourceExcerpts: object }).candidateSourceExcerpts, {});
    assert.match(JSON.stringify(request.state), /complete candidate file omitted by token budget/);
    return decide(request);
  };
  assert.equal(await tryClassifyReview(s.context, s.round), 'APPROVED');
  assert.equal(s.attempts[0].panel!.calls, 3);
});


test('V4 clear uses one call; V5 fallback reuses subject-only state and never returns a mission (TASK-2743)', async () => {
  const { WEAKENING_QUESTION, WEAKENING_V5, weakeningQuestion } = await import('../../../../src/application/review-classification/weakening-policy.js');
  for (const noFact of [false, true]) for (const outcome of ['v4-clear', 'v5-clear', 'both-fallback', 'v5-failure', 'v5-weakens', 'v5-insufficient', 'v5-malformed', 'v4-failure', 'v4-malformed'] as const) {
    const s = gateRepairScenario();
    if (noFact) { s.classifier.validations = async () => []; }
    const requests: import('../../../../src/application/ports/decision.js').DecisionRequest[] = [];
    s.classifier.decision.decide = async (request): Promise<DecisionResult> => {
      requests.push(request);
      if (requests.length === 1) {
        if (outcome === 'v4-failure') { throw new Error('provider down'); }
        if (outcome === 'v4-malformed') {
          // @ts-expect-error Intentional malformed provider distribution tests the V5 fallback.
          return { provider: 'typesafe', model: 'jev', answers: { resolution: { type: 'choice', selected: 'preserves', probabilities: null } } };
        }
        return await weakeningAnswer('preserves', outcome === 'v4-clear' ? 0.6 : 0.59)();
      }
      if (outcome === 'v5-failure') { throw new Error('provider down'); }
      if (outcome === 'v5-malformed') { return { provider: 'typesafe', model: 'jev', answers: {} }; }
      return await weakeningAnswer(outcome === 'v5-weakens' ? 'weakens' : outcome === 'v5-insufficient' ? 'insufficient_evidence' : 'preserves', outcome === 'both-fallback' ? 0.59 : 0.6)();
    };
    const clears = ['v4-clear', 'v5-clear', 'v4-failure', 'v4-malformed'].includes(outcome);
    assert.equal(await tryClassifyReview(s.context, s.round), clears ? 'APPROVED' : null, outcome);
    assert.equal(requests.length, outcome === 'v4-clear' ? 1 : 2, outcome);
    assert.equal(s.attempts[0].weakening?.v5 !== undefined, requests.length === 2);
    if (requests.length === 2) {
      assert.equal(s.attempts[0].weakening!.v5!.cleared, clears);
      assert.equal(s.attempts[0].weakening!.v5!.preserves, ['v5-failure', 'v5-malformed'].includes(outcome) ? null : outcome === 'both-fallback' ? 0.59 : 0.6);
    }
    assert.deepEqual(requests[0].questions.resolution, noFact ? weakeningQuestion(false) : WEAKENING_QUESTION);
    if (requests.length === 2) {
      assert.deepEqual(requests[1].questions.resolution, noFact ? weakeningQuestion(false, true) : WEAKENING_V5);
      assert.equal(requests[1].state, requests[0].state, 'identical state object');
    }
    const state = requests[0].state as { repairCommitSubjects: readonly string[] };
    assert.deepEqual(state.repairCommitSubjects, ['abc1234 Repair x.java']);
    assert.equal(JSON.stringify(state).includes('repairCommitBodies'), false);
    assert.deepEqual(s.published, clears ? ['clear'] : [], outcome);
    const decision = s.store.mission().review!.rounds.at(-1)!.decision;
    assert.equal(decision?.kind, clears ? 'approved' : undefined);
    if (clears) {
      assert.equal(decision!.classifier!.weakening!.question!.clearedBy, outcome === 'v4-clear' ? 'weakening-v4-optional-fact-v1' : 'weakening-v5-optional-fact-v1');
      assert.match(decision!.comment!, /questions weakening-v4-optional-fact-v1, weakening-v5-optional-fact-v1/);
      assert.match(s.summaries[0], new RegExp(`cleared by ${outcome === 'v4-clear' ? 'weakening-v4-optional-fact-v1' : 'weakening-v5-optional-fact-v1'}, preserves 0.6, questions weakening-v4-optional-fact-v1, weakening-v5-optional-fact-v1`));
    } else {
      assert.equal(s.store.mission().status, 'review');
    }
  }
});


test('V5 budget refusal keeps the same evidence and does not count an unmade call (TASK-2743)', async () => {
  const s = gateRepairScenario();
  const { WEAKENING_V5 } = await import('../../../../src/application/review-classification/weakening-policy.js');
  const measure = s.classifier.decision.requestBudget;
  s.classifier.decision.requestBudget = request => ({ ...measure(request), inputTokens: request.questions.resolution === WEAKENING_V5 ? 64001 : 1 });
  let calls = 0;
  s.classifier.decision.decide = async () => { calls++; return await weakeningAnswer('preserves', 0.59)(); };
  assert.equal(await tryClassifyReview(s.context, s.round), null);
  assert.equal(calls, 1);
  assert.equal(s.attempts[0].reason, 'weakening-over-budget');
  assert.equal(s.attempts[0].weakening!.v5, undefined);
  assert.deepEqual(s.published, []);
});

test('classifier verdicts bind the verified head and prior decided code, with legacy null fallback (TASK-2752)', async () => {
  for (const unresolved of [false, true]) {
    const s = scenario();
    const prior = s.store.mission().review!.rounds[0];
    (prior.subject as { revision: string }).revision = 'round-start-before-prior-decision';
    s.round.verifiedRevision = 'c'.repeat(40);
    s.context.ports.preReview.head = () => 'c'.repeat(40);
    if (unresolved) { s.classifier.decision.decide = async () => result('does_not_address', 0.89); }
    assert.equal(await tryClassifyReview(s.context, s.round), unresolved ? 'REQUEST_CHANGES' : 'APPROVED');
    assert.equal(s.attempts[0].priorRevision, 'a'.repeat(40));
    const round = s.store.mission().review!.rounds.at(-1)!;
    assert.equal(round.subject.revision, 'b'.repeat(40));
    assert.equal(round.decision?.revision, 'c'.repeat(40));
  }
  const legacy = scenario();
  (legacy.store.mission().review!.rounds[0].decision as { revision: null }).revision = null;
  assert.equal(await tryClassifyReview(legacy.context, legacy.round), null);
  assert.equal(legacy.attempts[0].reason, 'review-evidence-unavailable');
  assert.deepEqual(legacy.published, []);
});

test('fitted weakening decisions record omission measurements (TASK-2751)', async () => {
  const s = gateRepairScenario();
  s.classifier.evidence.diff = async () => 'diff --git a/x.java b/x.java\n--- a/x.java\n+++ b/x.java\n@@ -1 +1 @@\n-old\n+' + 'generated '.repeat(2000) + '\n';
  s.classifier.decision.requestBudget = request => {
    const tokens = JSON.stringify(request).length;
    return { requestBytes: tokens, maxRequestBytes: 1000000, inputTokens: tokens, contextTokens: tokens,
      maxInputTokens: 6000, maxContextTokens: 6000, tokenizerModel: 'stub' };
  };
  assert.equal(await tryClassifyReview(s.context, s.round), 'APPROVED');
  assert.equal(s.attempts[0].omittedDiffCount, 1);
  assert.ok(s.attempts[0].omittedTokens! > 10000);
});


test('general obligation ancestry retains findings, human corrections and decided revision (TASK-2753)', async () => {
  const { reviewObligations } = await import('../../../../src/domain/review-obligations.js');
  const review = repeatReview();
  const first = review.rounds[0];
  const note = (position: number, content: string, actor = 'operator') => ({ position, content, actor,
    eventType: 'human_note' as const, roundNumber: 1, phase: null, disposition: null, verdict: null,
    itemDispositions: null, blockedReason: null, followUpReference: null, createdAt: '2026-10-01T00:02:00Z' });
  const annotated = { ...review, reviewEvents: [note(1, 'Preserve errors\n---\n`[workflow-round:1]`'),
    note(2, 'cleared a human-intervention stop'), note(3, 'invalidated a BLOCKED stop'), note(4, 'system text', 'system')] };
  const scope = reviewObligations(annotated)!;
  assert.equal(scope.general.decision?.revision, 'a'.repeat(40));
  assert.deepEqual(scope.findings.map(f => f.summary), ['x.java:1 drops output', 'Preserve errors']);
  const returned = { ...review.rounds[1], decision: { ...first.decision!, classifier: { kind: 'classifier' } as never } };
  const current = { ...review.rounds[1], number: 3 };
  const ancestry = { ...annotated, rounds: [first, returned, current] as typeof review.rounds };
  assert.equal(reviewObligations(ancestry)!.general.number, 1);
  const approved = { ...first, decision: { kind: 'approved' as const, revision: first.subject.revision,
    decidedAt: first.decision!.decidedAt, comment: null, source: { kind: 'provider' as const, provider: 'forgejo' },
    revocation: { revokedAt: '2026-10-01T00:02:00Z', revokedBy: 'operator', reason: 'Keep errors visible', cause: { kind: 'operator' as const } } } };
  assert.deepEqual(reviewObligations({ ...review, rounds: [approved, current] })!.findings.map(f => f.summary), ['Keep errors visible']);
  assert.equal(reviewObligations({ ...review, rounds: [{ ...approved, decision: { ...approved.decision, revocation: undefined } }, current] }), null);
});

test('no-fact repairs retain evidence, provider and empty repair fallback (TASK-2754)', async () => {
  for (const cause of ['baseline', 'read', 'empty', 'bookkeeping', 'budget', 'provider'] as const) {
    const s = gateRepairScenario();
    s.classifier.validations = async () => [];
    if (cause === 'baseline') { delete (s.store.mission().review!.rounds[0].subject as { baseline?: string }).baseline; }
    if (cause === 'read') { s.classifier.evidence.diff = async () => { throw new Error('unreadable'); }; }
    if (cause === 'empty') { s.classifier.evidence.diff = async () => ''; }
    if (cause === 'bookkeeping') { s.classifier.evidence.missionInterdiff = async () => ({ diff: '+task', paths: ['backlog/tasks/task-1.md'] }); }
    if (cause === 'budget') {
      const measure = s.classifier.decision.requestBudget;
      s.classifier.decision.requestBudget = request => ({ ...measure(request), inputTokens: 64001 });
    }
    if (cause === 'provider') { s.classifier.decision.available = () => ({ status: 'setup-required', cause: 'credentials-missing', reason: 'missing' }); }
    let calls = 0;
    s.classifier.decision.decide = async () => { calls++; return await weakeningAnswer('preserves', 0.99)(); };
    assert.equal(await tryClassifyReview(s.context, s.round), null, cause);
    assert.equal(calls, 0, cause);
    assert.deepEqual(s.published, []);
    assert.equal(s.attempts[0].admissibleFact, false);
  }
});


test('frozen V3 0.53 publishes and persists approval for qualifying prior findings (TASK-2805)', async () => {
  const { default: frozen } = await import('../../../fixtures/review-classification/frozen-panel-regressions.json', { with: { type: 'json' } });
  assert.deepEqual(frozen.restoredCases.map(c => [c.id, c.members[0].response.answers.resolution.probabilities.addresses]),
    [['px-0012-r2', 0.53], ['px-0014-r7', 0.71], ['task-2762-r8', 0.58], ['task-2762-r12', 0.53]]);
  for (const sample of frozen.restoredCases) {
    assert.equal(sample.expected, 'clear');
    for (const member of sample.members) {
      const raw = JSON.parse(member.rawResponse);
      assert.equal(raw.model, member.response.model);
      assert.equal(raw.answers.resolution.choice, member.response.answers.resolution.selected);
      assert.deepEqual(raw.answers.resolution.probabilities, member.response.answers.resolution.probabilities);
    }
    const s = scenario();
    s.round.verifiedRevision = sample.pinned.after;
    s.context.ports.preReview.head = () => sample.pinned.after;
    let calls = 0;
    s.classifier.decision.decide = async () => sample.members[calls++].response as DecisionResult;
    assert.equal(await tryClassifyReview(s.context, s.round), 'APPROVED');
    assert.equal(calls, 3);
    assert.deepEqual(s.published, ['clear']);
    const stored = await s.store.load(missionId(s.context.slug));
    assert.equal(stored.kind, 'found');
    if (stored.kind !== 'found') { throw new Error('mission missing'); }
    assert.equal(stored.mission.status, 'integration');
    const decision = stored.mission.review!.rounds.at(-1)!.decision!;
    assert.equal(decision.kind, 'approved');
    assert.equal(decision.revision, sample.pinned.after);
    assert.equal(decision.classifier!.score, sample.members[0].response.answers.resolution.probabilities.addresses);
    assert.equal(decision.classifier!.candidateRevision, sample.pinned.after);
  }
});


test('frozen production controls reproduce all four recorded packet hashes (TASK-2805)', async () => {
  const { default: frozen } = await import('../../../fixtures/review-classification/frozen-panel-regressions.json', { with: { type: 'json' } });
  const { runPanel } = await import('../../../../src/application/review-classification/panel.js');
  assert.equal(frozen.productionControls.length, 4);
  for (const control of frozen.productionControls) {
    const state = JSON.parse(JSON.stringify(control.state)) as DecisionData;
    const s = scenario();
    let calls = 0;
    s.classifier.decision.decide = async request => {
      assert.deepEqual(request.questions, { resolution: Object.values(PANEL_QUESTIONS)[calls++] });
      assert.equal(request.state, state);
      assert.equal(s.classifier.hash(JSON.stringify(request.state)), control.originalPacketHash, control.id);
      return abstain();
    };
    const outcome = await runPanel(state, s.classifier.decision,
      { provider: 'openrouter', model: 'typesafe/jev-1.13-20260917' }, s.classifier.hash);
    assert.equal(calls, 3);
    assert.equal(outcome.selected.route, 'reviewer');
    assert.equal(s.classifier.hash(JSON.stringify(control.state)), control.originalPacketHash, control.id);
  }
});
