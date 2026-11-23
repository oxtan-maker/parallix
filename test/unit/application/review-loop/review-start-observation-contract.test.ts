// Policy observation is a post-commit side effect of the existing review-start owner.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runReviewLoop } from '../../../../src/application/review-loop/review-loop.js';
import type { ReviewStartFacts } from '../../../../src/application/ports/review-round.js';
import { fakeReviewLoopPorts } from '../../../helpers/review-loop-ports.js';
import { reviewActionStarted } from '../../../../src/application/review-action-history.js';
import { missionId } from '../../../../src/domain/mission.js';

async function approvedRun(mode: 'off' | 'shadow' | 'pilot') {
  const slug = `task-2859-${mode}`;
  const observations: ReviewStartFacts[] = [];
  const committed: string[] = [];
  const actions: ReturnType<typeof reviewActionStarted>[] = [];
  const fake = fakeReviewLoopPorts({
    slug,
    actionHistory: {
      count: async () => actions.length,
      record: async input => {
        const replay = actions.find(action => action.action === input.action && action.correlation === input.correlation
          && action.changeIdentity === input.changeIdentity);
        if (replay) { return replay; }
        const record = reviewActionStarted({ repositoryId: 'repo-a', missionId: missionId(slug), ...input }, actions.length + 1);
        actions.push(record);
        return record;
      },
    },
    stateport: {
      openRound: async next => {
        next.phase = 'reviewing';
        committed.push('agent');
        await fake.ports.state.persist(next);
        return true;
      },
      recordApproval: async next => {
        await fake.ports.state.persist(next);
        committed.push('human');
        return 'recorded';
      },
    },
    ...(mode === 'off' ? {} : { reviewStarts: { observe: async facts => {
      assert.ok(committed.includes(facts.actualAction), 'the start boundary must commit before observation');
      observations.push(facts);
    } } }),
    agents: { launch: async launch => {
      await launch.onStarted?.({ agent: launch.agent, runId: `run-${mode}` });
      return { agent: launch.agent, result: { status: 0 } };
    } },
    artifacts: { consumeReviewer: async () => ({ consumed: true, ok: true as const, reviewState: 'APPROVED' }) },
  });
  await runReviewLoop({ slug, implementer: 'codex', reviewer: 'claude', actionLimit: 40,
    skipReviewPreparation: true, operatorInvocation: true }, fake.ports);
  return { fake, observations, actions };
}

test('off, shadow and pilot retain identical review actions and state after post-commit observation (TASK-2859.09)', async () => {
  const off = await approvedRun('off');
  const shadow = await approvedRun('shadow');
  const pilot = await approvedRun('pilot');
  const trace = (run: typeof off) => ({
    launches: run.fake.launches.map(item => [item.role, item.agent]),
    state: { phase: run.fake.current()?.phase, disposition: run.fake.current()?.disposition,
      round: run.fake.current()?.round, implementer: run.fake.current()?.implementer, reviewer: run.fake.current()?.reviewer },
    mirrors: run.fake.mirrors,
  });
  assert.deepEqual(trace(shadow), trace(off));
  assert.deepEqual(trace(pilot), trace(off));
  assert.deepEqual(off.observations, []);
  for (const run of [off, shadow, pilot]) {
    assert.deepEqual(run.actions.map(action => [action.actionSequence, action.action]), [[1, 'agent'], [2, 'human']],
      'policy mode does not change the history-derived lifetime count');
  }
  for (const run of [shadow, pilot]) {
    assert.deepEqual(run.observations.map(item => item.actualAction), ['agent', 'human']);
    assert.deepEqual(run.observations.map(item => item.verdictCorrelation),
      ['review:1:agent:claude-verdict', 'review:1:human-verdict']);
    assert.equal(run.observations[0]?.agentRunId, `run-${run === shadow ? 'shadow' : 'pilot'}`);
    assert.equal(run.observations[1]?.agentRunId, null);
    assert.ok(run.observations.every(item => item.operatorInvocation));
  }
});

test('restart replays only the durable human review-start key (TASK-2859.09)', async () => {
  const approved = await approvedRun('shadow');
  const replayed: ReviewStartFacts[] = [];
  Object.assign(approved.fake.ports, { reviewStarts: { observe: async (facts: ReviewStartFacts) => { replayed.push(facts); } } });
  await runReviewLoop({ slug: 'task-2859-shadow', isContinue: true, actionLimit: 40, skipReviewPreparation: true }, approved.fake.ports);
  assert.deepEqual(replayed.map(item => [item.actualAction, item.verdictCorrelation]),
    [['human', 'review:1:human-verdict']]);
  assert.equal(approved.fake.launches.length, 1);
  assert.equal(approved.fake.current()?.phase, 'approved');
});

test('persisted approval dry-run performs no observation or metadata read (TASK-2859.09 F1)', async () => {
  const approved = await approvedRun('shadow');
  const observations: ReviewStartFacts[] = [];
  let heads = 0;
  Object.assign(approved.fake.ports, {
    reviewStarts: { observe: async (facts: ReviewStartFacts) => { observations.push(facts); } },
    preReview: { ...approved.fake.ports.preReview, head: () => { heads += 1; return 'head-1'; } },
  });
  await runReviewLoop({ slug: 'task-2859-shadow', isContinue: true, dryRun: true, actionLimit: 40,
    skipReviewPreparation: true }, approved.fake.ports);
  assert.deepEqual(observations, []);
  assert.equal(heads, 0);
  assert.equal(approved.fake.launches.length, 1);
});

test('reviewer recovery and escalation launch no additional observed starts (TASK-2859.09 F2)', async () => {
  const observations: ReviewStartFacts[] = [];
  const fake = fakeReviewLoopPorts({
    slug: 'task-2859-recovery',
    reviewStarts: { observe: async facts => { observations.push(facts); } },
    agents: { launch: async launch => {
      await launch.onStarted?.({ agent: launch.agent, runId: `run-${fake.launches.length}` });
      return { agent: launch.agent, result: { status: 0 } };
    } },
    artifacts: { consumeReviewer: async () => ({ consumed: false }) },
  });
  await runReviewLoop({ slug: 'task-2859-recovery', implementer: 'codex', reviewer: 'claude', actionLimit: 40,
    skipReviewPreparation: true }, fake.ports);
  assert.equal(fake.launches.filter(launch => launch.role === 'reviewer').length, 3);
  assert.deepEqual(observations.map(item => item.actualAction), ['agent']);
  assert.ok(fake.stops.includes('REVIEWER_ARTIFACT_RETRY_EXHAUSTED'));
});

test('dry-run and pre-review rebase conflict emit no review-start observation (TASK-2859.09)', async () => {
  for (const scenario of ['dry-run', 'rebase-conflict'] as const) {
    const observations: ReviewStartFacts[] = [];
    const fake = fakeReviewLoopPorts({
      slug: `task-2859-${scenario}`,
      reviewStarts: { observe: async facts => { observations.push(facts); } },
      ...(scenario === 'rebase-conflict' ? { preReview: { rebase: async () => ({ ok: false as const,
        diagnostic: 'Unresolved shared-file rebase conflicts: src/example.ts' }) } } : {}),
    });
    await runReviewLoop({ slug: `task-2859-${scenario}`, implementer: 'codex', reviewer: 'claude', actionLimit: 40,
      skipReviewPreparation: true, dryRun: scenario === 'dry-run' }, fake.ports);
    assert.deepEqual(observations, []);
    assert.deepEqual(fake.launches, []);
  }
});
