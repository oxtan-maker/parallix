const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  bindReviewPersistence,
  reviewLoopBindings,
} = require('../.test-runtime/composition/review-persistence.js');
const { createEvent } = require('../.test-runtime/adapters/review/review-events.js');

/**
 * A Mission with a Review on round 3, so a bound consumer is distinguishable
 * from the unbound default (which reads no state and falls back to round 1).
 */
function missionWithReview() {
  return {
    id: 'task-9001',
    repositoryId: 'repo',
    title: 'bound review persistence',
    status: 'review',
    rawStatus: 'review',
    assignee: 'claude',
    labels: [],
    checkpoints: [],
    netEngineeringLines: 0,
    closedAt: null,
    review: {
      rounds: [{
        number: 3,
        subject: {
          change: { kind: 'local-branch', sourceBranch: 'mission/task-9001', targetBranch: 'main' },
          revision: 'rev-3',
        },
        reviewer: 'claude',
        implementer: 'codex',
        startedAt: '2026-08-04T09:00:00.000Z',
        decision: null,
        response: null,
        phase: 'reviewing',
        disposition: null,
        reviewerRetryCount: 0,
        implementerRetryCount: 0,
      }],
      intervention: null,
      stageLaunches: [],
      gateFailureRetryCount: 0,
      reviewEvents: [],
    },
  };
}

function fakeStore() {
  const state = { mission: missionWithReview(), version: 1, saves: [] as unknown[] };
  return {
    state,
    async load() { return { kind: 'found', mission: state.mission, version: state.version }; },
    async save(mission: any) {
      state.mission = mission;
      state.version += 1;
      state.saves.push(mission);
      return state.version;
    },
    async saveWithTransition(mission: any) { return this.save(mission); },
  };
}

function artifactDir(files: Record<string, string>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2339-'));
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content, 'utf8');
  }
  return dir;
}

const silent = { log: () => {}, error: () => {} };

test('reviewLoopBindings supplies the artifact consumers, not only the review-state projections', () => {
  const bindings = reviewLoopBindings(fakeStore() as never);
  assert.deepEqual(Object.keys(bindings).sort(), [
    'consumeImplementerArtifactsFn',
    'consumeReviewerArtifactsFn',
    'readReviewStateFn',
    'resetReviewStateFn',
    'writeReviewStateFn',
  ]);
});

test('bound reviewer-artifact consumer persists its events to the operator database', async () => {
  const store = fakeStore();
  const tmpDir = artifactDir({
    'task-9001-review-findings.md': 'No blocking findings.',
    'task-9001-review-outcome.md': 'Verdict: approve',
    'task-9001-review-verdict.txt': 'approve',
  });

  const result = await reviewLoopBindings(store as never).consumeReviewerArtifactsFn('task-9001', 'claude', {
    worktree: tmpDir,
    tmpDir,
    providerEnabled: false,
    ...silent,
  });

  assert.equal(result.consumed, true);
  assert.equal(result.ok, true);
  const events = store.state.mission.review.reviewEvents;
  assert.deepEqual(events.map((event: any) => event.eventType), ['reviewer_findings', 'reviewer_outcome']);
  // The round comes from the stored Review, so an unbound state reader (which
  // resolves no store and defaults to round 1) fails this assertion.
  assert.deepEqual(events.map((event: any) => event.roundNumber), [3, 3]);
});

test('bound implementer-artifact consumer persists its events to the operator database', async () => {
  const store = fakeStore();
  const tmpDir = artifactDir({
    'task-9001-round-resolution.md': 'fixed_items: ["F1"]',
    'task-9001-review-disposition.txt': 'CHANGES_MADE',
  });

  const result = await reviewLoopBindings(store as never).consumeImplementerArtifactsFn('task-9001', 'codex', {
    worktree: tmpDir,
    tmpDir,
    providerEnabled: false,
    ...silent,
  });

  assert.equal(result.consumed, true);
  assert.equal(result.ok, true);
  assert.deepEqual(
    store.state.mission.review.reviewEvents.map((event: any) => event.eventType),
    ['implementer_round_summary', 'implementer_disposition'],
  );
});

test('bindReviewPersistence exposes the same bound consumers', async () => {
  const persistence = bindReviewPersistence(fakeStore() as never);
  assert.equal(typeof persistence.consumeReviewerArtifacts, 'function');
  assert.equal(typeof persistence.consumeImplementerArtifacts, 'function');
});

test('an unbound event writer reports the missing store, not a missing Review', async () => {
  const messages: string[] = [];
  const result = await createEvent(
    'task-9001',
    'human_note',
    { content: 'note' },
    { worktree: os.tmpdir(), skipGit: true, log: () => {}, error: (msg: string) => messages.push(msg) },
  );

  assert.equal(result.ok, false);
  assert.match(result.error, /No Mission store supplied/);
  assert.match(messages.join('\n'), /no Mission store was supplied/i);
  assert.doesNotMatch(messages.join('\n'), /backfill-review/);
});
