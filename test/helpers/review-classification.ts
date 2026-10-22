import { createHash } from 'node:crypto';
import { fakeLoopContext, fakeReviewLoopPorts } from './review-loop-ports.js';
import { ReviewRound } from '../../src/application/review-loop/round.js';
import { fixtureMission, inMemoryTransitionStore } from '../fixtures/mission-builders.js';
import { repeatReview } from '../fixtures/repeat-review.js';
import { MissionLifecycleService } from '../../src/application/mission-lifecycle-service.js';
import type { ReviewClassificationPorts } from '../../src/application/ports/review-classification.js';
import type { ClassifierCallMeasurement } from '../../src/application/ports/review-classification-telemetry.js';

export function distribution(selected: string, score: number) {
  return Object.fromEntries(['addresses', 'does_not_address', 'insufficient_evidence'].map(label => [label, label === selected ? score : (1 - score) / 2]));
}

// New contract: classifier orchestration at the verified repeat-review boundary.
export function scenario(mode: ReviewClassificationPorts['mode'] = 'enabled') {
  const review = repeatReview();
  const store = inMemoryTransitionStore(fixtureMission('task-2658', { status: 'review', review }));
  const attempts: ClassifierCallMeasurement[] = [];
  const published: string[] = [];
  const summaries: string[] = [];
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
      missionInterdiff: async () => ({ diff: '-return null;\n+return output;\n', paths: ['x.java'] }),
      changedPaths: async () => [], mergeBase: async () => 'e'.repeat(40), subjects: async () => ['abc1234 Repair x.java'] },
    validations: async () => [],
    telemetry: async () => ({ recordCall: async a => { attempts.push(a); }, 
      calls: async () => attempts }),
    publish: async (_source, route, summary) => { published.push(route); summaries.push(summary); return true; },
  };
  const fake = fakeReviewLoopPorts({ slug: 'task-2658', provider: {}, missionStore: store, lifecycle: new MissionLifecycleService(store),
    preReview: { head: () => 'b'.repeat(40) } });
  const context = fakeLoopContext(fake, { slug: 'task-2658' });
  context.state.round = 2;
  const ports = { ...context.ports, classification: classifier };
  const classified = { ...context, ports };
  return { context: classified, classifier, store, attempts, published, summaries, logs: fake.logs, round: new ReviewRound(2, classified) };
}

