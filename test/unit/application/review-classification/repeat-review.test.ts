import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { tryRepeatReview } from '../../../../src/application/review-classification/repeat-review.js';
import { observeGeneralReview } from '../../../../src/application/review-classification/observe-review.js';
import { fakeLoopContext, fakeReviewLoopPorts } from '../../../helpers/review-loop-ports.js';
import { ReviewRound } from '../../../../src/application/review-loop/round.js';
import { fixtureMission, inMemoryTransitionStore } from '../../../fixtures/mission-builders.js';
import { repeatReview } from '../../../fixtures/repeat-review.js';
import { MissionLifecycleService } from '../../../../src/application/mission-lifecycle-service.js';
import type { RepeatReviewClassificationPorts } from '../../../../src/application/ports/review-classification.js';
import type { ClassifierCallMeasurement, ClassifierObservation } from '../../../../src/application/ports/review-classification-telemetry.js';

// New contract: classifier orchestration at the verified repeat-review boundary.
function scenario(mode: RepeatReviewClassificationPorts['mode'] = 'enabled') {
  const review = repeatReview();
  const store = inMemoryTransitionStore(fixtureMission('task-2658', { status: 'review', review }));
  const attempts: ClassifierCallMeasurement[] = [];
  const observations: ClassifierObservation[] = [];
  const published: string[] = [];
  const classifier: RepeatReviewClassificationPorts = {
    mode, hash: text => createHash('sha256').update(text).digest('hex'), fingerprint: () => 'attempt',
    now: () => '2026-10-06T00:00:00Z', clock: () => 1,
    decision: { available: () => ({ status: 'available', provider: 'typesafe', model: 'jev' }),
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
  assert.equal(await tryRepeatReview(s.context, s.round), 'APPROVED');
  assert.deepEqual(s.published, ['clear']);
  const loaded = await s.store.load(s.context.slug as never);
  assert.equal(loaded.kind, 'found');
  if (loaded.kind !== 'found') { return; }
  assert.equal(loaded.mission.status, 'integration');
  assert.equal(loaded.mission.review!.rounds.at(-1)!.decision!.classifier!.identity, 'jev');
  assert.equal(s.attempts.length, 1);
  assert.equal(s.observations[0].originalFindings, 'unobserved');
});

test('opt-out, unavailable provider, API failure and shadow retain the reviewer', async () => {
  for (const mode of ['disabled', 'shadow'] as const) {
    const s = scenario(mode);
    assert.equal(await tryRepeatReview(s.context, s.round), null);
    assert.equal(s.published.length, 0);
  }
  const unavailable = scenario();
  unavailable.classifier.decision.available = () => ({ status: 'setup-required', reason: 'missing key' });
  assert.equal(await tryRepeatReview(unavailable.context, unavailable.round), null);
  assert.equal(unavailable.attempts[0].reason, 'unavailable');
  const failed = scenario();
  failed.classifier.decision.decide = async () => { throw new Error('timeout'); };
  assert.equal(await tryRepeatReview(failed.context, failed.round), null);
  assert.equal(failed.attempts[0].reason, 'classifier-failure');
});

test('revision drift, broader files, human corrections and failed publication cannot clear', async () => {
  const drift = scenario();
  drift.context.ports.preReview.head = () => 'c'.repeat(40);
  assert.equal(await tryRepeatReview(drift.context, drift.round), null);
  const broad = scenario();
  broad.classifier.evidence.diff = async () => '+++ b/new.java\nnew file mode 100644\n';
  assert.equal(await tryRepeatReview(broad.context, broad.round), null);
  assert.equal(broad.attempts[0].reason, 'broader-review-obligations');
  const human = scenario();
  human.round.humanFeedback = 'New obligation';
  assert.equal(await tryRepeatReview(human.context, human.round), null);
  const post = scenario();
  post.classifier.publish = async () => false;
  assert.equal(await tryRepeatReview(post.context, post.round), null);
  assert.equal((await post.store.load(post.context.slug as never)).kind, 'found');
  assert.equal(post.observations.length, 0);
});

test('shadow observations join the same revision and never mutate review authority (TASK-2658)', async () => {
  const s = scenario('shadow');
  assert.equal(await tryRepeatReview(s.context, s.round), null);
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
  await tryRepeatReview(unavailable.context, unavailable.round);
  await observeGeneralReview(unavailable.context, 0, 'APPROVED');
  assert.equal(unavailable.observations[0].cycleMs, null, 'missing preparation time cannot silently become zero');
  assert.equal(unavailable.observations[0].ordinaryReviewMs, 1);
});

test('unresolved classifier returns preserve original findings without invented repairs (TASK-2658)', async () => {
  const s = scenario();
  s.classifier.decision.decide = async () => ({ provider: 'typesafe', model: 'jev', answers: { resolution: {
    type: 'choice', selected: 'does_not_address', probabilities: { does_not_address: 0.89 }, confidence: 0.1 } } });
  assert.equal(await tryRepeatReview(s.context, s.round), 'REQUEST_CHANGES');
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
  assert.equal(await tryRepeatReview(s.context, s.round), null);
  assert.deepEqual(s.published, []);
  assert.equal(s.attempts[0]?.reason, 'prior-classifier-review');
});

test('published classifier review with revision drift stops rather than launching a conflicting reviewer (TASK-2658)', async () => {
  const s = scenario();
  let published = false;
  s.classifier.publish = async () => { published = true; return true; };
  s.context.ports.preReview.head = () => (published ? 'c' : 'b').repeat(40);
  assert.equal(await tryRepeatReview(s.context, s.round), 'stop');
  assert.equal(s.observations.length, 0);
});

test('borderline 51% clear is retained as abstention without publishing a verdict (TASK-2658)', async () => {
  const s = scenario();
  s.classifier.decision.decide = async () => ({ provider: 'typesafe', model: 'jev', answers: {
    resolution: { type: 'choice', selected: 'addresses', probabilities: { addresses: 0.51 }, confidence: 0.26 },
  } });
  assert.equal(await tryRepeatReview(s.context, s.round), null);
  assert.equal(s.published.length, 0);
  assert.equal(s.attempts[0].reason, 'abstention');
  const loaded = await s.store.load(s.context.slug as never);
  assert.equal(loaded.kind === 'found' ? loaded.mission.review?.rounds.at(-1)?.decision : undefined, null);
});
