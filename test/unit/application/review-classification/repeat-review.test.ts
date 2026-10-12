import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { tryClassifyReview } from '../../../../src/application/review-classification/classify-review.js';
import { observeGeneralReview } from '../../../../src/application/review-classification/observe-review.js';
import { fakeLoopContext, fakeReviewLoopPorts } from '../../../helpers/review-loop-ports.js';
import { ReviewRound } from '../../../../src/application/review-loop/round.js';
import { pinReviewBaseline } from '../../../../src/application/review-loop/pin-baseline.js';
import { fixtureMission, inMemoryTransitionStore } from '../../../fixtures/mission-builders.js';
import { repeatReview } from '../../../fixtures/repeat-review.js';
import { MissionLifecycleService } from '../../../../src/application/mission-lifecycle-service.js';
import { EvidenceReadError } from '../../../../src/application/ports/review-evidence.js';
import { PANEL_QUESTIONS } from '../../../../src/application/review-classification/panel-questions.js';
import type { DecisionResult } from '../../../../src/application/ports/decision.js';
import type { ReviewClassificationPorts } from '../../../../src/application/ports/review-classification.js';
import type { ClassifierCallMeasurement, ClassifierObservation } from '../../../../src/application/ports/review-classification-telemetry.js';

function distribution(selected: string, score: number) {
  return Object.fromEntries(['addresses', 'does_not_address', 'insufficient_evidence'].map(label => [label, label === selected ? score : (1 - score) / 2]));
}

// New contract: classifier orchestration at the verified repeat-review boundary.
function scenario(mode: ReviewClassificationPorts['mode'] = 'enabled') {
  const review = repeatReview();
  const store = inMemoryTransitionStore(fixtureMission('task-2658', { status: 'review', review }));
  const attempts: ClassifierCallMeasurement[] = [];
  const observations: ClassifierObservation[] = [];
  const published: string[] = [];
  const classifier: ReviewClassificationPorts = {
    mode, hash: text => createHash('sha256').update(text).digest('hex'), fingerprint: () => 'attempt',
    now: () => '2026-10-06T00:00:00Z', clock: () => 1,
    decision: { requestBudget: request => ({ requestBytes: JSON.stringify(request).length, inputTokens: 1, contextTokens: 1, maxRequestBytes: 1_000_000, maxInputTokens: 64000, maxContextTokens: 30000, tokenizerModel: 'stub' }), available: () => ({ status: 'available', provider: 'typesafe', model: 'jev' }), requestBytes: request => JSON.stringify(request).length,
      decide: async () => ({ provider: 'typesafe', model: 'jev', answers: { resolution: {
        type: 'choice', selected: 'addresses', probabilities: distribution('addresses', 0.52), confidence: 0.1,
      } } }) },
    evidence: { tree: async () => ['x.java'], source: async () => 'return output;\n',
      diff: async () => '+++ b/x.java\n@@ -1 +1 @@\n-return null;\n+return output;\n',
      mainCommits: async () => [],
      missionInterdiff: async () => ({ diff: '-return null;\n+return output;\n', paths: ['x.java'] }) },
    telemetry: async () => ({ recordCall: async a => { attempts.push(a); }, 
      recordObservation: async o => { observations.push(o); }, calls: async () => attempts, observations: async () => observations }),
    publish: async (_source, route) => { published.push(route); return true; },
  };
  const fake = fakeReviewLoopPorts({ slug: 'task-2658', provider: {}, missionStore: store, lifecycle: new MissionLifecycleService(store),
    preReview: { head: () => 'b'.repeat(40) } });
  const context = fakeLoopContext(fake, { slug: 'task-2658' });
  context.state.round = 2;
  const ports = { ...context.ports, classification: classifier };
  const classified = { ...context, ports };
  return { context: classified, classifier, store, attempts, observations, published, logs: fake.logs, round: new ReviewRound(2, classified) };
}

test('available default records a real classifier clear and moves through existing approval authority', async () => {
  const s = scenario();
  s.context.state.metadata.humanFeedbackSources = [];
  assert.equal(await tryClassifyReview(s.context, s.round), 'APPROVED');
  assert.deepEqual(s.published, ['clear']);
  const loaded = await s.store.load(s.context.slug as never);
  assert.equal(loaded.kind, 'found');
  if (loaded.kind !== 'found') { return; }
  assert.equal(loaded.mission.status, 'integration');
  assert.equal(loaded.mission.review!.rounds.at(-1)!.decision!.classifier!.identity, 'jev');
  assert.equal(s.attempts.length, 1);
  assert.equal(s.observations[0].originalFindings, 'unobserved');
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
  const loaded = await s.store.load(s.context.slug as never);
  assert.equal(loaded.kind, 'found');
  if (loaded.kind === 'found') {
    assert.equal(loaded.mission.review!.rounds.at(-1)!.subject.revision, finalVerifiedRevision);
  }
});

test('attempts Jev for a verified repair after an integration gate revoked approval (TASK-2674)', async () => {
  const s = scenario();
  const review = s.store.mission().review!;
  const prior = review.rounds[0]!;
  (prior as { decision: typeof prior.decision; response: typeof prior.response }).decision = {
    kind: 'approved', decidedAt: '2026-10-01T00:01:00Z', comment: 'Approved before integration.', source: { kind: 'local' },
    revocation: { revokedAt: '2026-10-01T00:02:00Z', revokedBy: 'operator', reason: 'integration gate failed', cause: { kind: 'integration-gate-failure', gate: 'unit', command: 'npm test', log: 'x.java:1 failed' } },
  };
  (prior as { response: typeof prior.response }).response = null;
  s.round.integrationRepair = 'verified integration repair';
  s.round.verifiedRevision = 'b'.repeat(40);
  assert.equal(await tryClassifyReview(s.context, s.round), 'APPROVED');
  assert.equal(s.attempts.length, 1);
  assert.equal(s.attempts[0]?.reason, 'resolved-threshold');
});

test('verified integration repair supplies source for its absolute stack path (TASK-2667 regression)', async () => {
  const s = scenario();
  const prior = s.store.mission().review!.rounds[0]!;
  const log = `at runSmoke (${s.context.ports.worktree}/x.java:865:14)\n    at Test.run (node:internal/test_runner/test:1402:25)`;
  (prior as { decision: typeof prior.decision }).decision = {
    kind: 'approved', decidedAt: '2026-10-01T00:01:00Z', comment: 'Approved before integration.', source: { kind: 'local' },
    revocation: { revokedAt: '2026-10-01T00:02:00Z', revokedBy: 'operator', reason: 'Integration failed',
      cause: { kind: 'integration-gate-failure', gate: 'unit', command: 'npm test', log } },
  };
  (prior as { response: typeof prior.response }).response = null;
  s.round.integrationRepair = 'verified integration repair';
  s.round.verifiedRevision = 'b'.repeat(40);
  let called = false;
  const decide = s.classifier.decision.decide;
  s.classifier.decision.decide = async request => {
    called = true;
    assert.match(JSON.stringify(request.state), /runSmoke/);
    assert.match(JSON.stringify(request.state), /return output/);
    return decide(request);
  };
  assert.equal(await tryClassifyReview(s.context, s.round), 'APPROVED');
  assert.equal(s.attempts[0]?.reason, 'resolved-threshold');
  assert.equal(called, true);
});

test('opt-out, unavailable provider, API failure and shadow retain the reviewer', async () => {
  for (const mode of ['disabled', 'shadow'] as const) {
    const s = scenario(mode);
    assert.equal(await tryClassifyReview(s.context, s.round), null);
    assert.equal(s.published.length, 0);
  }
  const unavailable = scenario();
  unavailable.classifier.decision.available = () => ({ status: 'setup-required', reason: 'missing key' });
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

test('human feedback is evidence for Jev rather than a reason to skip it (TASK-2675)', async () => {
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
  assert.equal((await post.store.load(post.context.slug as never)).kind, 'found');
  assert.equal(post.observations.length, 0);
});

test('shadow observations join the same revision and never mutate review authority (TASK-2658)', async () => {
  const s = scenario('shadow');
  assert.equal(await tryClassifyReview(s.context, s.round), null);
  await observeGeneralReview(s.context, 0, 'APPROVED');
  assert.equal(s.observations[0].originalFindings, 'resolved');
  assert.equal(s.observations[0].newFindings, 0);
  const loaded = await s.store.load(s.context.slug as never);
  assert.equal(loaded.kind, 'found');
  if (loaded.kind !== 'found') { return; }
  assert.equal(loaded.mission.status, 'review');
  assert.equal(loaded.mission.review!.rounds.at(-1)!.decision, null);
  s.context.ports.preReview.head = () => 'c'.repeat(40);
  await observeGeneralReview(s.context, 0, 'APPROVED');
  assert.equal(s.observations.length, 1, 'a different revision is not independent correctness evidence');
  const unavailable = scenario();
  unavailable.classifier.decision.available = () => ({ status: 'setup-required', reason: 'missing key' });
  await tryClassifyReview(unavailable.context, unavailable.round);
  await observeGeneralReview(unavailable.context, 0, 'APPROVED');
  assert.equal(unavailable.observations[0].cycleMs, null, 'missing preparation time cannot silently become zero');
  assert.equal(unavailable.observations[0].ordinaryReviewMs, 1);
});

test('unresolved classifier returns preserve original findings without invented repairs (TASK-2658)', async () => {
  const s = scenario();
  s.classifier.decision.decide = async () => ({ provider: 'typesafe', model: 'jev', answers: { resolution: {
    type: 'choice', selected: 'does_not_address', probabilities: distribution('does_not_address', 0.89), confidence: 0.1 } } });
  assert.equal(await tryClassifyReview(s.context, s.round), 'REQUEST_CHANGES');
  assert.deepEqual(s.published, ['implementer']);
  assert.deepEqual(s.round.blockingFindings, [{ id: 'F1', summary: 'x.java:1 drops output' }]);
  const loaded = await s.store.load(s.context.slug as never);
  assert.equal(loaded.kind, 'found');
  if (loaded.kind !== 'found') { return; }
  const decision = loaded.mission.review!.rounds.at(-1)!.decision!;
  assert.equal(decision.kind, 'changes-requested');
  assert.match(decision.comment!, /Make changes or request general review/);
});

test('a classifier return cannot become evidence for another classifier review (TASK-2658)', async () => {
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
  assert.equal(await tryClassifyReview(s.context, s.round), null);
  assert.deepEqual(s.published, []);
  assert.equal(s.attempts[0]?.reason, 'prior-classifier-review');
});

test('frozen V3 includes 51% approval boundary (TASK-2716)', async () => {
  const s = scenario();
  s.classifier.decision.decide = async () => ({ provider: 'typesafe', model: 'jev', answers: {
    resolution: { type: 'choice', selected: 'addresses', probabilities: distribution('addresses', 0.51), confidence: 0.26 },
  } });
  assert.equal(await tryClassifyReview(s.context, s.round), 'APPROVED');
  assert.equal(s.published.length, 1);
  assert.equal(s.attempts[0].reason, 'resolved-threshold');
  const loaded = await s.store.load(s.context.slug as never);
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
  await reasonOf(s => { s.classifier.decision.available = () => ({ status: 'setup-required', reason: 'x' }); }, 'provider-unavailable');
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

/** A mutable view of the stored review so a case can reshape the rounds it starts from. */
function reshape(s: ReturnType<typeof scenario>) {
  const mission = s.store.mission() as { review: ReturnType<typeof repeatReview>; successCriteria?: readonly string[] };
  return { mission, rounds: mission.review.rounds as unknown as { decision: unknown; response: unknown; subject: { revision: string } }[] };
}

test('a re-review whose candidate differs from the recorded response revision reaches the classifier (TASK-2680)', async () => {
  const s = scenario();
  reshape(s).rounds[0].response = { ...(s.store.mission().review!.rounds[0].response as object), resultingRevision: 'd'.repeat(40) };
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
    mission.review = { ...mission.review, rounds: [{ ...mission.review.rounds[1], number, subject: { ...rounds[1].subject } }] } as never;
    mission.successCriteria = ['Output is preserved in x.java'];
    s.context.state.round = number;
    const round = new ReviewRound(number, s.context);
    s.classifier.evidence.diff = async () => { assert.fail('first review must not collect evidence'); };
    s.classifier.decision.available = async () => { assert.fail('first review must not reach the decision provider'); };
    s.classifier.decision.decide = async () => { assert.fail('first review must not call Jev'); };
    assert.equal(await tryClassifyReview(s.context, round), null);
    assert.deepEqual(s.published, []);
    assert.deepEqual(s.attempts.map(a => a.reason), ['first-review']);
    assert.equal(s.store.mission().review!.rounds.at(-1)!.decision, null);
  }
});

test('an unverified integration repair keeps its specific reason (TASK-2680)', async () => {
  const s = scenario();
  const prior = reshape(s).rounds[0];
  prior.decision = { kind: 'approved', decidedAt: '2026-10-01T00:01:00Z', comment: 'ok', source: { kind: 'local' },
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
  };
  if (consecutive) {
    const finding = { id: 'integration-gate-repair' as never, summary: 'x.java:1 drops output', location: 'x.java:1' };
    (prior as { decision: typeof prior.decision }).decision = {
      kind: 'changes-requested', decidedAt: '2026-10-01T00:01:00Z', comment: 'Gate repair remains unresolved.', findings: [finding], classifier,
    };
    (prior as { response: typeof prior.response }).response = { ...prior.response!,
      resolutions: [{ findingId: finding.id, kind: 'fixed', evidence: 'Preserve output' }] };
  } else {
    (prior as { decision: typeof prior.decision }).decision = {
      kind: 'approved', decidedAt: '2026-10-01T00:01:00Z', comment: 'Approved before integration.', source: { kind: 'local' },
      revocation: { revokedAt: '2026-10-01T00:02:00Z', revokedBy: 'operator', reason: 'integration gate failed',
        cause: { kind: 'integration-gate-failure', gate: 'unit', command: 'npm test', log: 'x.java:1 drops output' } },
    };
    (prior as { response: typeof prior.response }).response = null;
    s.round.integrationRepair = 'verified repair';
    s.round.verifiedRevision = 'b'.repeat(40);
  }
  return s;
}

test('gate repairs use frozen panel thresholds and authoritative validation (TASK-2716)', async () => {
  for (const [label, score, expected] of [
    ['does_not_address', 0.89, 'REQUEST_CHANGES'], ['does_not_address', 0.889, null],
    ['addresses', 0.51, 'APPROVED'], ['addresses', 0.509, null], ['insufficient_evidence', 1, null],
  ] as const) {
    const s = gateRepairScenario();
    s.classifier.decision.decide = async request => {
      assert.match(JSON.stringify(request.state), /Configured pre-review verification/);
      assert.match(JSON.stringify(request.state), /failedIntegrationGateRerun.*unknown/);
      return { provider: 'typesafe', model: 'jev', answers: { resolution: {
        type: 'choice', selected: label, probabilities: distribution(label, score), confidence: 0.1 } } };
    };
    assert.equal(await tryClassifyReview(s.context, s.round), expected);
    assert.equal(s.attempts[0].policyVersion, 'jev-three-question-51-80-89-v1');
    if (expected) { assert.deepEqual(s.store.mission().review!.rounds.at(-1)!.decision!.classifier!.findingIds, ['integration-gate-repair']); }
  }
});

test('consecutive Jev gate-repair decisions always require general review (TASK-2716)', async () => {
  const s = gateRepairScenario(true);
  s.classifier.decision.decide = async () => { assert.fail('recursive classifier call'); };
  assert.equal(await tryClassifyReview(s.context, s.round), null);
  assert.equal(s.attempts[0].reason, 'prior-classifier-review');
  assert.deepEqual(s.published, []);
});

test('ordinary finding re-reviews retain the 89% return threshold (TASK-2692)', async () => {
  const s = scenario();
  s.classifier.decision.decide = async () => ({ provider: 'typesafe', model: 'jev', answers: { resolution: {
    type: 'choice', selected: 'does_not_address', probabilities: distribution('does_not_address', 0.67), confidence: 0.1 } } });
  assert.equal(await tryClassifyReview(s.context, s.round), null);
  assert.equal(s.attempts[0].policyVersion, 'jev-three-question-51-80-89-v1');
  assert.deepEqual(s.published, []);
});

test('revoked Jev approvals and further returns preserve classifier provenance fallback (TASK-2716)', async () => {
  for (const previous of ['approved', 'continued-return'] as const) {
    const s = gateRepairScenario(previous === 'continued-return');
    const prior = s.store.mission().review!.rounds[0]!;
    if (previous === 'approved') {
      (prior as { decision: typeof prior.decision }).decision = { ...prior.decision!, classifier: {
        kind: 'classifier', identity: 'jev', decisionId: 'prior-clear', provider: 'typesafe', model: 'jev',
        packetHash: 'c'.repeat(64), priorRevision: 'd'.repeat(40), candidateRevision: 'a'.repeat(40),
        findingIds: ['F1'], policyVersion: 'repeat-findings-52-89-v2', label: 'addresses', score: 0.52,
      } };
    } else {
      (prior.decision!.classifier as { policyVersion: string }).policyVersion = 'integration-repair-52-81-v1';
    }
    s.classifier.decision.decide = async () => ({ provider: 'typesafe', model: 'jev', answers: { resolution: {
      type: 'choice', selected: 'does_not_address', probabilities: { does_not_address: 0.81 }, confidence: 0.1 } } });
    assert.equal(await tryClassifyReview(s.context, s.round), null);
    assert.equal(s.attempts[0].reason, 'prior-classifier-review');
  }
});


test('an additional obligation prevents a consecutive gate-only Jev decision (TASK-2692)', async () => {
  const s = gateRepairScenario(true);
  const prior = s.store.mission().review!.rounds[0]!;
  if (prior.decision?.kind !== 'changes-requested') { throw new Error('missing prior return'); }
  (prior.decision as { findings: typeof prior.decision.findings }).findings = [...prior.decision.findings,
    { id: 'F2' as never, summary: 'New obligation: preserve logging', location: null }];
  assert.equal(await tryClassifyReview(s.context, s.round), null);
  assert.equal(s.attempts[0].reason, 'prior-classifier-review');
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
  assert.equal(s.attempts[0].reason, 'evidence-over-budget');
});

test('first review retains its immutable baseline without classifying while main advances (TASK-2704)', async () => {
  const s = scenario();
  const { mission, rounds } = reshape(s);
  mission.review = { ...mission.review, rounds: [{ ...mission.review.rounds[1], number: 1, subject: { ...rounds[1].subject } }] } as never;
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

test('a rebased gate repair uses production mission interdiff (TASK-2716, TASK-2732)', async () => {
  const s = gateRepairScenario();
  for (const round of s.store.mission().review!.rounds) {
    (round.subject as { baseline?: string }).baseline = 'e'.repeat(40);
  }
  let calls = 0;
  s.classifier.evidence.diff = async () => { assert.fail('plain range substitution'); };
  s.classifier.evidence.missionInterdiff = async () => {
    calls++; return { diff: '+repair', paths: ['x.java'] };
  };
  assert.equal(await tryClassifyReview(s.context, s.round), 'APPROVED');
  assert.equal(calls, 1);
});

test('classifier failures persist a distinguishable cause (TASK-2704)', async () => {
  const over = gateRepairScenario();
  const budget = over.classifier.decision.requestBudget;
  over.classifier.decision.requestBudget = request => ({ ...budget(request), contextTokens: 30001 });
  const read = gateRepairScenario();
  read.classifier.evidence.tree = async () => { throw new EvidenceReadError('git diff output exceeds the read limit', true); };
  const other = gateRepairScenario();
  other.classifier.decision.requestBudget = () => { throw new Error('tokenizer unavailable'); };
  for (const run of [over, read, other]) { assert.equal(await tryClassifyReview(run.context, run.round), null); }
  assert.deepEqual([over, read, other].map(run => run.attempts[0].reason), ['evidence-over-budget', 'evidence-read-failed', 'classifier-exception']);
  assert.match(over.logs.join('\n'), /Reviewer classifier failed \(evidence-over-budget\)/);
});

test('a missing provider key is its own cause and is announced to the operator once without credentials (TASK-2704)', async () => {
  const s = scenario();
  s.classifier.decision.available = () => ({ status: 'setup-required', reason: 'Export TYPESAFE_API_KEY to enable decisions.', cause: 'credentials-missing' });
  assert.equal(await tryClassifyReview(s.context, s.round), null);
  assert.equal(await tryClassifyReview(s.context, new ReviewRound(2, s.context)), null);
  assert.deepEqual(s.attempts.map(a => a.reason), ['provider-key-missing', 'provider-key-missing']);
  const notices = s.logs.filter(line => /no decision provider key/.test(line));
  assert.equal(notices.length, 1);
  assert.match(notices[0], /TYPESAFE_API_KEY, OPENROUTER_API_KEY or AI_GATEWAY_API_KEY/);
  assert.match(notices[0], /launched agents never receive these keys/);
  const misconfigured = scenario();
  misconfigured.classifier.decision.available = () => ({ status: 'setup-required', reason: 'JEV_CODE_PROVIDER conflicts with TYPESAFE_BASE_URL.' });
  await tryClassifyReview(misconfigured.context, misconfigured.round);
  assert.equal(misconfigured.attempts[0].reason, 'provider-unavailable');
  assert.equal(misconfigured.logs.filter(line => /no decision provider key/.test(line)).length, 0);
});

test('a round keeps its review baseline with its reviewed subject across reload (TASK-2704)', async () => {
  const s = scenario();
  s.round.reviewBaseline = 'e'.repeat(40);
  await pinReviewBaseline(s.context, s.round);
  const loaded = await s.store.load(s.context.slug as never);
  if (loaded.kind !== 'found') { throw new Error('mission missing'); }
  const rounds = loaded.mission.review!.rounds;
  assert.equal(rounds.at(-1)!.subject.baseline, 'e'.repeat(40));
  assert.equal(rounds[0].subject.baseline, undefined, 'a decided round is never rewritten');
  s.round.reviewBaseline = 'f'.repeat(40);
  assert.equal(await tryClassifyReview(s.context, s.round), 'APPROVED');
  const decided = await s.store.load(s.context.slug as never);
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
    s.classifier.decision.decide = async () => { assert.fail('budget failure must prevent all calls'); };
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
  assert.deepEqual(retained.questions, PANEL_QUESTIONS, 'independently saved research questions must remain exact');
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
