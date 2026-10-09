import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { tryClassifyReview } from '../../../../src/application/review-classification/classify-review.js';
import { observeGeneralReview } from '../../../../src/application/review-classification/observe-review.js';
import { fakeLoopContext, fakeReviewLoopPorts } from '../../../helpers/review-loop-ports.js';
import { ReviewRound } from '../../../../src/application/review-loop/round.js';
import { fixtureMission, inMemoryTransitionStore } from '../../../fixtures/mission-builders.js';
import { repeatReview } from '../../../fixtures/repeat-review.js';
import { MissionLifecycleService } from '../../../../src/application/mission-lifecycle-service.js';
import type { ReviewClassificationPorts } from '../../../../src/application/ports/review-classification.js';
import type { ClassifierCallMeasurement, ClassifierObservation } from '../../../../src/application/ports/review-classification-telemetry.js';

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
        type: 'choice', selected: 'addresses', probabilities: { addresses: 0.52 }, confidence: 0.1,
      } } }) },
    evidence: { tree: async () => ['x.java'], source: async () => 'return output;\n',
      diff: async () => '+++ b/x.java\n@@ -1 +1 @@\n-return null;\n+return output;\n' },
    telemetry: async () => ({ recordCall: async a => { attempts.push(a); }, 
      recordObservation: async o => { observations.push(o); }, calls: async () => attempts, observations: async () => observations }),
    publish: async (_source, route) => { published.push(route); return true; },
  };
  const context = fakeLoopContext(fakeReviewLoopPorts({ slug: 'task-2658', provider: {}, missionStore: store, lifecycle: new MissionLifecycleService(store),
    preReview: { head: () => 'b'.repeat(40) } }), { slug: 'task-2658' });
  context.state.round = 2;
  const ports = { ...context.ports, classification: classifier };
  const classified = { ...context, ports };
  return { context: classified, classifier, store, attempts, observations, published, round: new ReviewRound(2, classified) };
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
    type: 'choice', selected: 'does_not_address', probabilities: { does_not_address: 0.89 }, confidence: 0.1 } } });
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

test('borderline 51% clear is retained as abstention without publishing a verdict (TASK-2658)', async () => {
  const s = scenario();
  s.classifier.decision.decide = async () => ({ provider: 'typesafe', model: 'jev', answers: {
    resolution: { type: 'choice', selected: 'addresses', probabilities: { addresses: 0.51 }, confidence: 0.26 },
  } });
  assert.equal(await tryClassifyReview(s.context, s.round), null);
  assert.equal(s.published.length, 0);
  assert.equal(s.attempts[0].reason, 'abstention');
  const loaded = await s.store.load(s.context.slug as never);
  assert.equal(loaded.kind === 'found' ? loaded.mission.review?.rounds.at(-1)?.decision : undefined, null);
});

test('every former pre-call exit now reaches the classifier (TASK-2675)', async () => {
  const exits: Record<string, (s: ReturnType<typeof scenario>) => void> = {
    'uncited path': s => { s.classifier.evidence.tree = async () => ['other/y.java']; },
    'no source excerpts': s => { s.classifier.evidence.source = async () => { throw new Error('gone'); }; },
    'oversized evidence': s => { s.classifier.decision.requestBytes = () => 10_000_000; },
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
    assert.equal(await tryClassifyReview(s.context, s.round), 'APPROVED', name);
    assert.equal(calls, 1, name);
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

test('a mission version that moves while the classifier runs does not discard its decision (TASK-2675)', async () => {
  const s = scenario();
  const decide = s.classifier.decision.decide;
  s.classifier.decision.decide = async request => { const result = await decide(request); await s.store.save(s.store.mission()); return result; };
  assert.equal(await tryClassifyReview(s.context, s.round), 'APPROVED');
  assert.deepEqual(s.published, ['clear']);
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

test('a first review round reaches the classifier on its candidate revision against the success criteria (TASK-2680)', async () => {
  const s = scenario();
  const { mission, rounds } = reshape(s);
  mission.review = { ...mission.review, rounds: [{ ...mission.review.rounds[1], number: 1, subject: { ...rounds[1].subject } }] } as never;
  mission.successCriteria = ['Output is preserved in x.java'];
  s.context.state.round = 1;
  const round = new ReviewRound(1, s.context);
  const requests: unknown[] = [];
  const decide = s.classifier.decision.decide;
  s.classifier.decision.decide = async request => { requests.push(request); return decide(request); };
  assert.equal(await tryClassifyReview(s.context, round), 'APPROVED');
  assert.deepEqual(s.published, ['clear']);
  assert.deepEqual(s.attempts[0].findingIds, ['success-criterion-1']);
  assert.equal(s.attempts[0].priorRevision, 'main');
  assert.match(JSON.stringify(requests[0]), /Success criterion 1: Output is preserved/);
  const loaded = await s.store.load(s.context.slug as never);
  if (loaded.kind !== 'found') { throw new Error('mission missing'); }
  assert.equal(loaded.mission.review!.rounds.at(-1)!.decision!.classifier!.successCriteria?.baseRef, 'main');
});

test('a first review of a mission without success criteria names the missing data (TASK-2680)', async () => {
  const s = scenario();
  const { mission } = reshape(s);
  mission.review = { ...mission.review, rounds: [mission.review.rounds[1]] } as never;
  s.context.state.round = 2;
  assert.equal(await tryClassifyReview(s.context, s.round), null);
  assert.deepEqual(s.attempts.map(a => a.reason), ['no-success-criteria']);
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

test('tuned gate repairs return at 67%, preserve 52% clear, and retain fallback below the boundary (TASK-2692)', async () => {
  for (const [label, score, expected] of [
    ['does_not_address', 0.67, 'REQUEST_CHANGES'], ['does_not_address', 0.669, null],
    ['addresses', 0.52, 'APPROVED'], ['addresses', 0.519, null], ['insufficient_evidence', 1, null],
  ] as const) {
    const s = gateRepairScenario();
    s.classifier.decision.decide = async request => {
      assert.match(String(request.questions.resolution.instructions), /preserving the checked obligation/);
      assert.match(JSON.stringify(request.state), /Configured pre-review verification/);
      assert.match(JSON.stringify(request.state), /failedIntegrationGateRerun.*unknown/);
      return { provider: 'typesafe', model: 'jev', answers: { resolution: {
        type: 'choice', selected: label, probabilities: { [label]: score }, confidence: 0.1 } } };
    };
    assert.equal(await tryClassifyReview(s.context, s.round), expected);
    assert.equal(s.attempts[0].policyVersion, 'integration-repair-52-67-v1');
    if (expected) {
      const source = s.store.mission().review!.rounds.at(-1)!.decision!.classifier!;
      assert.equal(source.policyVersion, s.attempts[0].policyVersion);
      assert.deepEqual(source.findingIds, ['integration-gate-repair']);
    }
  }
});

test('a consecutive Jev gate-repair decision needs 81% to return while clear remains 52% (TASK-2692)', async () => {
  for (const [label, score, expected] of [
    ['does_not_address', 0.67, null], ['does_not_address', 0.809, null],
    ['does_not_address', 0.81, 'REQUEST_CHANGES'], ['addresses', 0.52, 'APPROVED'],
  ] as const) {
    const s = gateRepairScenario(true);
    s.classifier.decision.decide = async () => ({ provider: 'typesafe', model: 'jev', answers: { resolution: {
      type: 'choice', selected: label, probabilities: { [label]: score }, confidence: 0.1 } } });
    assert.equal(await tryClassifyReview(s.context, s.round), expected);
    assert.equal(s.attempts[0].policyVersion, 'integration-repair-52-81-v1');
    assert.equal(s.published.length, expected ? 1 : 0);
  }
});

test('ordinary finding re-reviews retain the 89% return threshold (TASK-2692)', async () => {
  const s = scenario();
  s.classifier.decision.decide = async () => ({ provider: 'typesafe', model: 'jev', answers: { resolution: {
    type: 'choice', selected: 'does_not_address', probabilities: { does_not_address: 0.67 }, confidence: 0.1 } } });
  assert.equal(await tryClassifyReview(s.context, s.round), null);
  assert.equal(s.attempts[0].policyVersion, 'repeat-findings-52-89-v2');
  assert.deepEqual(s.published, []);
});

test('a revoked Jev approval uses 81%, and further Jev repair rounds keep that threshold (TASK-2692)', async () => {
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
    assert.equal(await tryClassifyReview(s.context, s.round), 'REQUEST_CHANGES');
    assert.equal(s.attempts[0].policyVersion, 'integration-repair-52-81-v1');
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
  assert.equal(s.attempts[0].reason, 'classifier-exception');
});
