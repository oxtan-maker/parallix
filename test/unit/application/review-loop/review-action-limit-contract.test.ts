import assert from 'node:assert/strict';
import test from 'node:test';
import { runReviewLoop } from '../../../../src/application/review-loop/review-loop.js';
import { effectiveReviewActionLimit, loadReviewActionCount, startReviewAction } from '../../../../src/application/review-loop/action-limit.js';
import { reviewActionStarted } from '../../../../src/application/review-action-history.js';
import { OperationalHistoryService } from '../../../../src/application/services/operational-history-service.js';
import type { IdempotentOperationalHistoryRepository, OperationalHistoryEntry } from '../../../../src/application/ports/operation-history.js';
import type { ReviewActionHistoryPort, ReviewActionStarted } from '../../../../src/application/ports/review-action-history.js';
import { missionId } from '../../../../src/domain/mission.js';
import { agentFamily } from '../../../../src/domain/agents.js';
import { fakeLoopContext, fakeReviewLoopPorts } from '../../../helpers/review-loop-ports.js';
import { fixtureMission } from '../../../fixtures/mission-builders.js';
import { repeatReview } from '../../../fixtures/repeat-review.js';
import { ReviewState } from '../../../../src/adapters/review/review-state.js';
import { missionVersion } from '../../../../src/application/domain-ports.js';

function actionHistory(slug: string, initial: number) {
  let count = initial;
  const records: ReviewActionStarted[] = [];
  const history: ReviewActionHistoryPort = {
    count: async () => count,
    record: async input => {
      const replay = records.find(record => record.action === input.action && record.correlation === input.correlation
        && record.changeIdentity === input.changeIdentity);
      if (replay) { return replay; }
      const record = reviewActionStarted({ repositoryId: 'repo-a', missionId: missionId(slug), ...input },
        ++count, `2026-11-23T10:00:${String(count).padStart(2, '0')}Z`);
      records.push(record);
      return record;
    },
  };
  return { history, records, count: () => count };
}

function inMemoryHistoryRepository(): IdempotentOperationalHistoryRepository {
  const entries: OperationalHistoryEntry[] = [];
  const keys = new Set<string>();
  return {
    findAll: async () => entries,
    findByType: async type => entries.filter(entry => entry.eventType === type),
    findByTypeForMission: async (type, id) => entries.filter(entry => entry.eventType === type
      && (JSON.parse(entry.eventData) as { missionId?: string }).missionId === id),
    append: async entry => { entries.push(entry); },
    appendIdempotent: async (entry, key) => {
      if (keys.has(key)) { return false; }
      keys.add(key);
      entries.push(entry);
      return true;
    },
    clear: async () => { entries.length = 0; keys.clear(); },
  };
}

test('action 40 carries a typed lifetime-limit failure reason (TASK-2859.20)', () => {
  const input = { repositoryId: 'repo-a', missionId: missionId('task-action-limit'),
    changeIdentity: 'sha-40', action: 'agent' as const,
    correlation: 'agent-40', configuredLimit: 40 };
  assert.equal(reviewActionStarted(input, 39).failureReason, null);
  assert.deepEqual(reviewActionStarted(input, 40).failureReason, {
    version: 1, code: 'review-action-limit', source: 'lifecycle', context: { count: 40, limit: 40 },
  });
});

test('durable history sequences all review-step action kinds across service restarts (TASK-2859.20)', async () => {
  const repository = inMemoryHistoryRepository();
  const inputs = (['agent', 'tests', 'human', 'repair'] as const).map((action, index) => ({
    repositoryId: 'repo-a', missionId: missionId('task-action-types'), changeIdentity: `sha-${index % 2}`, action,
    correlation: `${action}-${index}`, configuredLimit: 40,
  }));
  const records = await Promise.all(inputs.map(input => new OperationalHistoryService(repository).recordReviewAction(input)));
  assert.deepEqual(records.map(record => record.actionSequence).sort((a, b) => a - b), [1, 2, 3, 4]);
  assert.equal(await new OperationalHistoryService(repository).countReviewActions('task-action-types', 'repo-a'), 4);
  const replay = await new OperationalHistoryService(repository).recordReviewAction(inputs[0]);
  assert.equal(replay.actionSequence, records[0].actionSequence, 'restart replay must not allocate another action');
  assert.equal(await new OperationalHistoryService(repository).countReviewActions('task-action-types', 'repo-a'), 4);
});

test('durable action sequences are independent for colliding Mission ids in different repositories (TASK-2859.21 F1)', async () => {
  const repository = inMemoryHistoryRepository();
  const service = new OperationalHistoryService(repository);
  const common = { missionId: missionId('px-0042'), changeIdentity: 'sha', action: 'agent' as const,
    configuredLimit: 40 };
  const first = await service.recordReviewAction({ ...common, repositoryId: 'repo-a', correlation: 'repo-a-action' });
  const foreign = await service.recordReviewAction({ ...common, repositoryId: 'repo-b', correlation: 'repo-b-action' });
  assert.deepEqual([first.actionSequence, foreign.actionSequence], [1, 1]);
  assert.notEqual(first.idempotencyKey, foreign.idempotencyKey);
  assert.deepEqual(await Promise.all([
    service.countReviewActions('px-0042', 'repo-a'), service.countReviewActions('px-0042', 'repo-b'),
  ]), [1, 1]);
});

test('a stored action from before repository identity retains its lifetime sequence (TASK-2859.21 F3)', async () => {
  const repository = inMemoryHistoryRepository();
  await repository.append({ eventType: 'review.action-started', createdAt: '2026-11-23T10:00:00.000Z',
    eventData: JSON.stringify({ schemaVersion: 1, missionId: 'px-0042', changeIdentity: 'sha', action: 'agent',
      correlation: 'legacy', actionSequence: 1, configuredLimit: 40, failureReason: null,
      idempotencyKey: 'legacy', recordedAt: '2026-11-23T10:00:00.000Z' }) });
  const service = new OperationalHistoryService(repository);
  assert.equal(await service.countReviewActions('px-0042', 'repo-a'), 1);
  const next = await service.recordReviewAction({ repositoryId: 'repo-a', missionId: missionId('px-0042'),
    changeIdentity: 'sha', action: 'agent', correlation: 'current', configuredLimit: 40 });
  assert.deepEqual([next.repositoryId, next.actionSequence], ['repo-a', 2]);
});

test('an operator continuation at an exhausted limit runs five mechanisms before the boundary handoff (TASK-2873)', async () => {
  const slug = 'task-operator-action-limit';
  const ledger = actionHistory(slug, 40);
  const approved = new ReviewState(slug, { reviewer: 'claude', implementer: 'codex', phase: 'approved',
    disposition: 'APPROVED' });
  const fake = fakeReviewLoopPorts({ slug, state: approved, actionHistory: ledger.history });
  const context = fakeLoopContext(fake, { slug, state: approved, operatorInvocation: true, actionLimit: 40 });
  const mechanisms: number[] = [];

  assert.equal(await loadReviewActionCount(context), true, 'the direct operator invocation reaches its approved continuation');
  for (let attempt = 1; attempt <= 6; attempt++) {
    if (await startReviewAction(context, 'human', `integration-continuation:${attempt}`, 'approved-sha')) {
      mechanisms.push(attempt);
    }
  }

  assert.deepEqual(mechanisms, [1, 2, 3, 4, 5]);
  assert.deepEqual(ledger.records.map(record => record.actionSequence), [41, 42, 43, 44, 45, 46]);
  assert.deepEqual(fake.stops, ['action limit 46 reached']);
  assert.equal(ledger.records.at(-1)?.failureReason?.code, 'review-action-limit');
});

test('operator headroom tops up zero through four runnable actions and preserves larger allowances (TASK-2873)', async () => {
  for (const [initial, expectedLimit] of [[39, 45], [38, 44], [37, 43], [36, 42], [35, 41], [34, 40], [33, 40]]) {
    const slug = `task-operator-headroom-${initial}`;
    const ledger = actionHistory(slug, initial);
    const fake = fakeReviewLoopPorts({ slug, actionHistory: ledger.history });
    const context = fakeLoopContext(fake, { slug, operatorInvocation: true, actionLimit: 40 });

    assert.equal(await loadReviewActionCount(context), true);
    assert.equal(effectiveReviewActionLimit(context), expectedLimit,
      `durable count ${initial} must retain at least five runnable actions without shrinking the configured ceiling`);
  }
});

test('an internal restart carries one fixed allowance without renewing it or the durable ledger (TASK-2873)', async () => {
  const slug = 'task-fixed-operator-allowance';
  const ledger = actionHistory(slug, 40);
  const firstFake = fakeReviewLoopPorts({ slug, actionHistory: ledger.history });
  const first = fakeLoopContext(firstFake, { slug, operatorInvocation: true, actionLimit: 40 });
  assert.equal(await loadReviewActionCount(first), true);
  assert.equal(effectiveReviewActionLimit(first), 46);
  assert.equal(await startReviewAction(first, 'agent', 'same-action', 'sha'), true);
  assert.equal(await startReviewAction(first, 'agent', 'same-action', 'sha'), true);
  assert.equal(ledger.count(), 41, 'an idempotent replay does not allocate another durable action');

  const restartedFake = fakeReviewLoopPorts({ slug, actionHistory: ledger.history });
  const restarted = fakeLoopContext(restartedFake, { slug, operatorInvocation: true, actionLimit: 40,
    effectiveActionLimit: effectiveReviewActionLimit(first) });
  assert.equal(await loadReviewActionCount(restarted), true);
  const mechanisms: number[] = [];
  for (let attempt = 42; attempt <= 46; attempt++) {
    if (await startReviewAction(restarted, 'repair', `restart:${attempt}`, 'sha')) { mechanisms.push(attempt); }
  }

  assert.deepEqual(mechanisms, [42, 43, 44, 45]);
  assert.equal(effectiveReviewActionLimit(restarted), 46, 'restart must not derive a fresh ceiling from count 41');
  assert.equal(ledger.count(), 46);
  assert.deepEqual(restartedFake.stops, ['action limit 46 reached']);
});

test('the review-loop request restores the fixed ceiling instead of granting a restart allowance (TASK-2873)', async () => {
  const slug = 'task-propagated-operator-allowance';
  const ledger = actionHistory(slug, 46);
  const approved = new ReviewState(slug, { reviewer: 'claude', implementer: 'codex', phase: 'approved',
    disposition: 'APPROVED' });
  const fake = fakeReviewLoopPorts({ slug, state: approved, actionHistory: ledger.history });

  await runReviewLoop({ slug, implementer: 'codex', reviewer: 'claude', operatorInvocation: true,
    actionLimit: 40, effectiveActionLimit: 46, skipReviewPreparation: true }, fake.ports);

  assert.equal(ledger.count(), 46);
  assert.deepEqual(ledger.records, []);
  assert.deepEqual(fake.stops, ['action limit 46 reached']);
});

test('autonomous entry receives no operator allowance at an exhausted durable count (TASK-2873)', async () => {
  const slug = 'task-autonomous-exhausted';
  const ledger = actionHistory(slug, 40);
  const fake = fakeReviewLoopPorts({ slug, actionHistory: ledger.history });
  const context = fakeLoopContext(fake, { slug, operatorInvocation: false, actionLimit: 40 });

  assert.equal(await loadReviewActionCount(context), false);
  assert.equal(effectiveReviewActionLimit(context), 40);
  assert.equal(ledger.count(), 40);
  assert.deepEqual(fake.stops, ['action limit 40 reached']);
});

test('restart at action 38 resumes at 38 and action 40 enters human attention without another launch (TASK-2859.20)', async () => {
  const slug = 'task-action-38';
  const ledger = actionHistory(slug, 38);
  const fake = fakeReviewLoopPorts({
    slug, actionHistory: ledger.history,
    agents: { launch: async launch => ({ agent: launch.agent, result: { status: 0 } }) },
    artifacts: { consumeReviewer: async () => ({ consumed: true, ok: true as const, reviewState: 'APPROVED' }) },
  });
  await runReviewLoop({ slug, implementer: 'codex', reviewer: 'claude', actionLimit: 40, skipReviewPreparation: true }, fake.ports);
  assert.deepEqual(ledger.records.map(record => [record.actionSequence, record.action]), [[39, 'agent'], [40, 'human']]);
  assert.equal(fake.launches.length, 1, 'action 39 may launch; action 40 itself hands off');
  assert.deepEqual(fake.stops, ['action limit 40 reached']);
  assert.ok(!fake.mirrors.includes('approved'), 'the limit handoff must not advertise autonomous completion');
  assert.equal(ledger.records[1]?.failureReason?.code, 'review-action-limit');

  await runReviewLoop({ slug, implementer: 'codex', reviewer: 'claude', isContinue: true,
    actionLimit: 40, skipReviewPreparation: true }, fake.ports);
  assert.equal(ledger.count(), 40);
  assert.equal(fake.launches.length, 1, 'restart at the limit cannot launch another reviewer');
});

test('the 40th agent or integration-test start is recorded but its mechanism does not launch (TASK-2859.20)', async () => {
  const agentSlug = 'task-agent-40';
  const agentLedger = actionHistory(agentSlug, 39);
  const agent = fakeReviewLoopPorts({ slug: agentSlug, actionHistory: agentLedger.history });
  await runReviewLoop({ slug: agentSlug, implementer: 'codex', reviewer: 'claude', actionLimit: 40,
    skipReviewPreparation: true }, agent.ports);
  assert.deepEqual(agentLedger.records.map(record => record.action), ['agent']);
  assert.deepEqual(agent.launches, []);
  assert.deepEqual(agent.stops, ['action limit 40 reached']);

  const testsSlug = 'task-tests-40';
  const testsLedger = actionHistory(testsSlug, 39);
  let testRuns = 0;
  const mission = fixtureMission(testsSlug, { status: 'review', assignee: agentFamily('codex'), review: repeatReview() });
  const tests = fakeReviewLoopPorts({ slug: testsSlug, actionHistory: testsLedger.history,
    state: new ReviewState(testsSlug, { reviewer: 'claude', implementer: 'codex' }),
    missionStore: { load: async () => ({ kind: 'found' as const, mission, version: missionVersion(1) }) } as never,
    policyActions: { select: async () => ({ action: 'tests', failure: null }), runTests: async () => {
      testRuns += 1; return { kind: 'completed', verdict: 'passed' };
    }, rebaseInProgress: () => false },
  });
  await runReviewLoop({ slug: testsSlug, implementer: 'codex', reviewer: 'claude', actionLimit: 40,
    skipReviewPreparation: true }, tests.ports);
  assert.deepEqual(testsLedger.records.map(record => record.action), ['tests']);
  assert.equal(testRuns, 0);
  assert.deepEqual(tests.launches, []);
  assert.deepEqual(tests.stops, ['action limit 40 reached']);
});

test('a recovery relaunch is a repair action and action 40 stops before that agent starts (TASK-2859.20)', async () => {
  const slug = 'task-repair-40';
  const ledger = actionHistory(slug, 38);
  const fake = fakeReviewLoopPorts({
    slug,
    actionHistory: ledger.history,
    routing: { eligibleFamilies: () => ['custom'], nominate: () => 'custom' },
    artifacts: { consumeReviewer: async () => ({ consumed: false }) },
  });

  await runReviewLoop({ slug, implementer: 'codex', reviewer: 'custom', actionLimit: 40,
    skipReviewPreparation: true }, fake.ports);

  assert.deepEqual(ledger.records.map(record => [record.actionSequence, record.action]), [[39, 'agent'], [40, 'repair']]);
  assert.equal(fake.launches.length, 1, 'the limit action is retained, but the recovery agent mechanism never starts');
  assert.deepEqual(fake.stops, ['action limit 40 reached']);
});

test('an unavailable action history fails closed before autonomous work (TASK-2859.20)', async () => {
  const fake = fakeReviewLoopPorts({ actionHistory: {
    count: async () => { throw new Error('history offline'); },
    record: async () => assert.fail('record must not run after a failed count'),
  } });
  await runReviewLoop({ slug: 'fake-mission', implementer: 'codex', reviewer: 'claude', actionLimit: 40,
    skipReviewPreparation: true }, fake.ports);
  assert.deepEqual(fake.launches, []);
  assert.deepEqual(fake.stops, ['ACTION_HISTORY_UNAVAILABLE: history offline']);
});

test('dry-run neither reads action history nor persists a limit handoff (TASK-2859.20 review)', async () => {
  for (const count of [async () => 40, async () => { throw new Error('history offline'); }]) {
    let reads = 0;
    const fake = fakeReviewLoopPorts({ actionHistory: {
      count: async () => { reads++; return await count(); },
      record: async () => assert.fail('dry-run must not record an action'),
    } });
    await runReviewLoop({ slug: 'fake-mission', implementer: 'codex', reviewer: 'claude', dryRun: true,
      actionLimit: 40, skipReviewPreparation: true }, fake.ports);
    assert.equal(reads, 0);
    assert.deepEqual(fake.stops, []);
    assert.deepEqual(fake.writes, []);
  }
});
