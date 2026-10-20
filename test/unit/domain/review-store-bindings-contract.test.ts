import { fixtureMission as completeMissionFixture } from '../../fixtures/mission-builders.js';
import { fixtureMission, pendingReview, inMemoryTransitionStore } from '../../fixtures/mission-builders.js';
import type { ReviewRound, ReviewEventRecord } from '../../../src/domain/review.js';
// review store bindings contract.
// Related scenarios share imports; each contract keeps its own hooks and mutable fixtures.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { bindReviewPersistence, reviewLoopBindings } from '../../../src/composition/review-persistence.js';
import { createEvent } from '../../../src/adapters/review/review-events.js';
import { ConcreteReviewReadAdapter } from '../../../src/adapters/backlog/concrete-review-read-adapter.js';
import { type MissionStore, missionVersion } from '../../../src/application/domain-ports.js';
import { agentFamily } from '../../../src/domain/agents.js';
import { missionId, missionLabels, type Mission } from '../../../src/domain/mission.js';
import { repositoryId } from '../../../src/domain/repository.js';
import { changeRevision } from '../../../src/domain/review.js';
import { persistReviewStateOrThrow, ReviewState } from '../../../src/adapters/review/review-state.js';

// Regression provenance: TASK-2339.
describe("review store bindings", { concurrency: false }, () => {
  /**
   * A Mission with a Review on round 3, so a bound consumer is distinguishable
   * from the unbound default (which reads no state and falls back to round 1).
   */
  function missionWithReview() {
    const base = pendingReview('task-9001', '2026-08-04T09:00:00.000Z');
    const currentRound = { ...base.rounds[0], number: 3 };
    const review = { ...base, rounds: [{ ...currentRound, number: 1 }, { ...currentRound, number: 2 }, currentRound] as const };
    return { ...fixtureMission('task-9001', { repositoryId: repositoryId('repo'), title: 'bound review persistence', status: 'review', rawStatus: 'review', assignee: agentFamily('claude'), checkpoints: [], netEngineeringLines: 0 }), review };
  }

  function fakeStore() {
    const state: { mission: Mission & { review: NonNullable<Mission['review']> }; version: ReturnType<typeof missionVersion>; saves: Mission[] } = { mission: missionWithReview(), version: missionVersion(1), saves: [] };
    return {
      state,
      async load() { return { kind: 'found' as const, mission: state.mission, version: state.version }; },
      async save(mission: Mission) {
        assert.ok(mission.review);
        state.mission = { ...mission, review: mission.review };
        state.version = missionVersion(state.version + 1);
        state.saves.push(mission);
        return state.version;
      },
      async saveWithTransition(mission: Mission) { return this.save(mission); },
      setReviewEvents(events: readonly (Pick<ReviewEventRecord, 'eventType' | 'roundNumber' | 'actor' | 'content' | 'createdAt'> & Partial<ReviewEventRecord>)[]) {
        state.mission = { ...state.mission, review: { ...state.mission.review, reviewEvents: events.map((event, index) => ({ position: index + 1, phase: null, disposition: null, verdict: null, itemDispositions: null, blockedReason: null, followUpReference: null, ...event })) } };
      },
      setCurrentRound(overrides: Partial<ReviewRound>) {
        const rounds: [ReviewRound, ...ReviewRound[]] = [...state.mission.review.rounds];
        const index = rounds.length - 1;
        rounds[index] = { ...rounds[index], ...overrides };
        state.mission = { ...state.mission, review: { ...state.mission.review, rounds } };
      },
    };
  }

  test('reviewLoopBindings supplies persisted-output readers, not only review-state projections', () => {
    const bindings = reviewLoopBindings(fakeStore());
    assert.deepEqual(Object.keys(bindings).sort(), [
      'consumeImplementerArtifacts',
      'consumeReviewerArtifacts',
      // TASK-2582: the round-open boundary moves an active Mission back to
      // review at the boundary, so the loop needs the lifecycle service.
      'lifecycleService',
      'missionStore',
      'readReviewState',
      'resetReviewState',
      'writeReviewState',
    ]);
  });

  test('loop reviewer reader uses persisted SQLite events rather than artifacts', async () => {
    const store = fakeStore();
    store.setReviewEvents([
      { eventType: 'reviewer_findings', roundNumber: 3, actor: 'claude', content: '## F1: persisted finding', createdAt: '2026-08-04T10:00:00.000Z' },
      { eventType: 'reviewer_outcome', roundNumber: 3, actor: 'claude', verdict: 'request-changes', content: 'Outcome: request-changes', createdAt: '2026-08-04T10:00:01.000Z' },
    ]);

    const result = await reviewLoopBindings(store).consumeReviewerArtifacts('task-9001', 'claude', {
      worktree: '/tmp/worktree',
    });

    assert.equal(result.consumed, true);
    assert.ok('reviewFindings' in result, 'consumed reviewer output includes finding facts');
    assert.equal(result.ok, true);
    assert.equal(result.reviewState, 'REQUEST_CHANGES');
    assert.deepEqual(result.reviewFindings, [{ id: 'F1', summary: 'persisted finding' }]);
  });

  test('loop reviewer reader ignores events from another round or reviewer', async () => {
    const store = fakeStore();
    store.setReviewEvents([
      { eventType: 'reviewer_outcome', roundNumber: 2, actor: 'claude', verdict: 'approve', content: 'old', createdAt: '2026-08-04T10:00:00.000Z' },
      { eventType: 'reviewer_outcome', roundNumber: 3, actor: 'codex', verdict: 'approve', content: 'other', createdAt: '2026-08-04T10:00:01.000Z' },
    ]);

    const result = await reviewLoopBindings(store).consumeReviewerArtifacts('task-9001', 'claude', {
      worktree: '/tmp/worktree',
    });

    assert.equal(result.consumed, false);
  });

  test('loop reviewer reader ignores an outcome from before a reset', async () => {
    const store = fakeStore();
    store.setCurrentRound({ startedAt: '2026-08-04T11:00:00.000Z' });
    store.setReviewEvents([
      { eventType: 'reviewer_outcome', roundNumber: 3, actor: 'claude', verdict: 'approve', content: 'old approval', createdAt: '2026-08-04T10:00:00.000Z' },
    ]);

    const result = await reviewLoopBindings(store).consumeReviewerArtifacts('task-9001', 'claude', { worktree: '/tmp/worktree' });
    assert.equal(result.consumed, false);
  });

  test('loop implementer reader uses the persisted disposition event', async () => {
    const store = fakeStore();
    store.setReviewEvents([
      { eventType: 'implementer_disposition', roundNumber: 3, actor: 'codex', disposition: 'PUSHBACK_ALL', content: 'Autonomous review disposition: PUSHBACK_ALL', createdAt: '2026-08-04T10:00:00.000Z' },
    ]);

    const result = await reviewLoopBindings(store).consumeImplementerArtifacts('task-9001', 'codex', {
      worktree: '/tmp/worktree',
    });

    assert.equal(result.consumed, true);
    assert.equal(result.ok, true);
    assert.equal(result.disposition, 'PUSHBACK_ALL');
  });

  test('loop implementer reader ignores a disposition from before a reset', async () => {
    const store = fakeStore();
    store.setCurrentRound({ startedAt: '2026-08-04T11:00:00.000Z' });
    store.setReviewEvents([
      { eventType: 'implementer_disposition', roundNumber: 3, actor: 'codex', disposition: 'CHANGES_MADE', content: 'old', createdAt: '2026-08-04T10:00:00.000Z' },
    ]);

    const result = await reviewLoopBindings(store).consumeImplementerArtifacts('task-9001', 'codex', { worktree: '/tmp/worktree' });
    assert.equal(result.consumed, false);
  });

  test('bindReviewPersistence exposes the same bound consumers', async () => {
    const persistence = bindReviewPersistence(fakeStore());
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
    assert.ok(result.error);
    assert.match(result.error, /No Mission store supplied/);
    assert.match(messages.join('\n'), /no Mission store was supplied/i);
    assert.doesNotMatch(messages.join('\n'), /backfill-review/);
  });
});

// Regression provenance: TASK-2341.
describe("review store wiring", { concurrency: false }, () => {
  const reviewMission: Mission = completeMissionFixture(String(missionId('task-2341')), {
    id: missionId('task-2341'),
    repositoryId: repositoryId('parallix'),
    title: 'Review state is stored in the operator database',
    labels: missionLabels(['bug']),
    status: 'review',
    closedAt: null,
    assignee: agentFamily('codex'),
    checkpoints: [],
    netEngineeringLines: null,
    review: {
      rounds: [{
        number: 1,
        subject: {
          change: { kind: 'local-branch', sourceBranch: 'mission/task-2341', targetBranch: 'main' },
          revision: changeRevision('reviewed-revision'),
        },
        reviewer: agentFamily('codex'),
        implementer: agentFamily('custom'),
        startedAt: '2026-08-04T12:00:00.000Z',
        decision: null,
        response: null,
        phase: 'reviewing',
        disposition: null,
        reviewerRetryCount: 0,
        implementerRetryCount: 0,
      }],
      intervention: null,
      stageLaunches: [],
      reviewEvents: [],
    },
  });

  const missionStore: MissionStore = {
    async load() {
      return { kind: 'found' as const, mission: reviewMission, version: missionVersion(1) };
    },
    async save() {
      return missionVersion(1);
    },
  };

  test('ConcreteReviewReadAdapter returns a Review when its MissionStore has persisted review data', async () => {
    const adapter = new ConcreteReviewReadAdapter({
      rootDir: process.cwd(),
      missionStore,
    });

    const review = await adapter.loadReview(missionId('task-2341'));

    assert.notEqual(review, null);
    assert.equal(review?.rounds[0].phase, 'reviewing');
  });
});

// Regression provenance: TASK-2342.
describe("missionstore repro", { concurrency: false }, () => {
  test('persistReviewStateOrThrow passes missionStore to writeFn', async () => {
    let receivedArgs: unknown[] = [];
    const mockWriteFn = async (...args: unknown[]) => {
      receivedArgs = args;
      return { outcome: 'committed' as const };
    };

    const mockStore = Object.assign(inMemoryTransitionStore(fixtureMission('test-store')), { id: 'test-store' });
    const slug = 'task-2342';
    const state = new ReviewState(slug, { reviewer: 'codex', implementer: 'claude' });
    const worktree = '/tmp/worktree';
    await persistReviewStateOrThrow(mockWriteFn, slug, state, worktree, mockStore);

    // writeFn must be called with 4 args: (slug, state, worktree, { missionStore, lifecycleService })
    assert.equal(receivedArgs.length, 4, 'writeFn should receive 4 arguments');
    assert.equal(receivedArgs[0], slug, 'first arg should be slug');
    assert.ok(receivedArgs[1] instanceof ReviewState, 'second arg should be ReviewState');
    assert.equal(receivedArgs[2], worktree, 'third arg should be worktree');
    assert.deepEqual(
      receivedArgs[3],
      { missionStore: mockStore, lifecycleService: undefined },
      'fourth arg should be the options object carrying missionStore'
    );
  });

  test('persistReviewStateOrThrow calls writeFn with 4 args even when missionStore omitted', async () => {
    let receivedArgs: unknown[] = [];
    const mockWriteFn = async (...args: unknown[]) => {
      receivedArgs = args;
      return { outcome: 'committed' as const };
    };

    const slug = 'task-2342';
    const state = new ReviewState(slug, { reviewer: 'codex', implementer: 'claude' });
    const worktree = '/tmp/worktree';

    // Call with only 4 args (no missionStore) — missionStore param omitted by caller
    await persistReviewStateOrThrow(mockWriteFn, slug, state, worktree);

    // After fix: always 4 args (options.missionStore = undefined when omitted)
    // Before fix: 3 args (missionStore not forwarded to writeFn)
    // RED (before fix): receivedArgs.length === 3
    // GREEN (after fix): receivedArgs.length === 4 and the options object carries undefined missionStore
    assert.equal(
      receivedArgs.length,
      4,
      'writeFn should receive exactly 4 arguments (slug, state, worktree, options)'
    );
    assert.deepEqual(
      receivedArgs[3],
      { missionStore: undefined, lifecycleService: undefined },
      'fourth arg options should carry undefined missionStore when omitted'
    );
  });
});
