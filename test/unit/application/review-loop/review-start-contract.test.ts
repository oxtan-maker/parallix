// Review start owns the handoff prerequisite, its failure boundaries, and dry-run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runReviewLoop } from '../../../../src/application/review-loop/review-loop.js';
import { ReviewState } from '../../../../src/adapters/review/review-state.js';
import { fakeReviewLoopPorts } from '../../../helpers/review-loop-ports.js';

const slug = 'review-start-contract';

test('start resumes the handoff-assigned reviewer instead of reselecting (TASK-2490, TASK-2647)', async () => {
  const fake = fakeReviewLoopPorts({
    slug,
    routing: {
      eligibleFamilies: () => ['claude', 'codex', 'custom'],
      nominate: () => { assert.fail('handoff assignment must take precedence over selection'); },
    },
    handoff: { handoff: async () => {
      await fake.ports.state.persist(new ReviewState(slug, { implementer: 'claude', reviewer: 'custom', round: 3 }));
      return { ok: true };
    } },
    artifacts: { consumeReviewer: async () => ({ consumed: true, ok: true, reviewState: 'APPROVED' }) },
  });
  await runReviewLoop({ slug, implementer: 'claude', maxAttempts: 3 }, fake.ports);
  assert.deepEqual(fake.launches.map(launch => [launch.role, launch.agent, launch.prompt?.attempt]), [['reviewer', 'custom', 3]]);
  assert.equal(fake.current()?.reviewer, 'custom');
  assert.deepEqual(fake.exits, []);
});

test('gatekeeper pushback stops before reviewer, gate, or rebase work (TASK-1303, TASK-2647)', async () => {
  const fake = fakeReviewLoopPorts({
    slug,
    provider: { openPullRequest: () => null },
    handoff: { handoff: async () => ({ ok: true, gatekeeperPushedBack: true }) },
    preReview: {
      rebase: async () => { assert.fail('pushback must stop before rebase'); },
      runGate: async () => { assert.fail('pushback must stop before gate'); },
    },
  });
  await runReviewLoop({ slug, implementer: 'claude', reviewer: 'codex' }, fake.ports);
  assert.deepEqual(fake.launches, []);
  assert.deepEqual(fake.writes, []);
  assert.deepEqual(fake.mirrors, []);
  assert.deepEqual(fake.exits, [1]);
  assert.match(fake.errors.join('\n'), /mandatory mission artifacts are missing/);
});

test('dry-run never self-heals or launches destination work (TASK-1303, TASK-2647)', async () => {
  const fake = fakeReviewLoopPorts({
    slug,
    provider: {
      ensureReachable: async () => { assert.fail('dry-run must not bootstrap the provider'); },
      openPullRequest: () => { assert.fail('dry-run must not inspect the provider'); },
    },
    handoff: { handoff: async () => { assert.fail('dry-run must not hand off'); } },
    preReview: {
      refreshKnowledgeGraph: async () => { assert.fail('dry-run must not refresh the graph'); },
      rebase: async () => { assert.fail('dry-run must not rebase'); },
      runGate: async () => { assert.fail('dry-run must not run gates'); },
    },
  });
  await runReviewLoop({ slug, implementer: 'claude', reviewer: 'codex', dryRun: true }, fake.ports);
  assert.deepEqual(fake.launches, []);
  assert.deepEqual(fake.writes, []);
  assert.deepEqual(fake.mirrors, []);
  assert.deepEqual(fake.exits, []);
  assert.match(fake.logs.join('\n'), /DRY-RUN/);
});

test('refreshes Graphify once after final review preparation and immediately before reviewer launch (TASK-2654)', async () => {
  const calls: string[] = [];
  const fake = fakeReviewLoopPorts({
    slug,
    handoff: { handoff: async () => ({ ok: true }) },
    preReview: {
      rebase: async () => { calls.push('rebase'); return { ok: true }; },
      runGate: async () => { calls.push('gate'); return { ok: true }; },
      refreshKnowledgeGraph: async () => { calls.push('refresh'); },
    },
    agents: { launch: async launch => { calls.push(`launch:${launch.role}`); return { agent: launch.agent }; } },
    artifacts: { consumeReviewer: async () => ({ consumed: true, ok: true, reviewState: 'APPROVED' }) },
  });

  await runReviewLoop({ slug, implementer: 'claude', reviewer: 'codex' }, fake.ports);

  assert.deepEqual(calls, ['rebase', 'gate', 'refresh', 'launch:reviewer']);
  assert.equal(calls.filter(call => call === 'refresh').length, 1);
});


test('continuation preparation stops after an unreachable provider even when exit returns (TASK-2696)', async () => {
  const fake = fakeReviewLoopPorts({
    slug,
    state: new ReviewState(slug, { implementer: 'claude', reviewer: 'codex', round: 2 }),
    provider: { ensureReachable: async () => false },
    routing: { nominate: () => { assert.fail('failed preparation must not select a reviewer'); } },
  });
  await runReviewLoop({ slug, isContinue: true }, fake.ports);
  assert.deepEqual(fake.exits, [1]);
  assert.deepEqual(fake.launches, []);
  assert.deepEqual(fake.writes, []);
});
