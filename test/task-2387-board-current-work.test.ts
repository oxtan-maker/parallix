import test from 'node:test';
import assert from 'node:assert/strict';

import { BoardCommandController } from '../src/application/controller/board-controller.js';
import type { BoardCommandRequest } from '../src/application/controller/board-command.js';
import type { CurrentWorkPort } from '../src/application/recording/current-work-recorder.js';
import { CurrentWorkRecorder } from '../src/application/recording/current-work-recorder.js';
import type { OperationalHistoryEntry, OperationalHistoryRepository } from '../src/application/ports/operation-history.js';
import { makeExecutePorts } from './fixtures/execute-mission-ports.js';
import { composeProductionCapabilities } from '../src/composition/production-capabilities.js';
import { repositoryId } from '../src/domain/repository.js';
import { missionId } from '../src/domain/mission.js';
import { agentFamily } from '../src/domain/agents.js';
import { ConcreteCurrentWorkReadAdapter } from '../src/adapters/backlog/concrete-current-work-read-adapter.js';
import { reconcileCurrentWork, isWorkInProgress } from '../src/application/projections/current-work.js';

const CURRENT_WORK_TTL_MS = 5 * 60 * 1000;
const noopProgress = (() => {}) as never;

function boardRequest(overrides: Record<string, unknown> = {}): BoardCommandRequest {
  return {
    operationId: 'active:task-2387',
    kind: 'active:execute',
    missionId: 'task-2387',
    missionStatusAtRequest: 'refined',
    agent: 'codex',
    capabilities: new Set(['active:execute']),
    cancellation: { requested: false },
    ...overrides,
  } as BoardCommandRequest;
}

/** A CurrentWorkPort that records every call for assertions. */
function spyCurrentWork(): CurrentWorkPort & { calls: Array<{ phase: string; state: string }> } {
  const calls: Array<{ phase: string; state: string }> = [];
  return {
    calls,
    async running(publication) { calls.push({ phase: publication.phase, state: 'running' }); },
    async blocked(publication) { calls.push({ phase: publication.phase, state: 'blocked' }); },
    async ended(publication) { calls.push({ phase: publication.phase, state: 'ended' }); },
  };
}

function makeHistoryRepo() {
  const appended: OperationalHistoryEntry[] = [];
  const repo: OperationalHistoryRepository = {
    async findAll() { return appended; },
    async findByType(type: string) { return appended.filter((entry) => entry.eventType === type); },
    async append(entry: OperationalHistoryEntry) { appended.push(entry); },
    async clear() { appended.length = 0; },
  };
  return { repo, appended };
}

// ---------------------------------------------------------------------------
// SC1 + SC2(completion): running then ended through the real controller
// ---------------------------------------------------------------------------

test('board active:execute publishes running and ended current work', async () => {
  const { ports } = makeExecutePorts();
  const spy = spyCurrentWork();
  const controller = new BoardCommandController(ports, undefined, undefined, spy);

  const result = await controller.dispatch(boardRequest());

  assert.equal(result.status, 'completed');
  assert.ok(spy.calls.some((call) => call.phase === 'execute' && call.state === 'running'), 'launch publishes running');
  assert.ok(spy.calls.some((call) => call.phase === 'execute' && call.state === 'ended'), 'completion publishes ended');
});

// ---------------------------------------------------------------------------
// SC2(failure): a launch that cannot finish publishes blocked with its reason
// ---------------------------------------------------------------------------

test('a board execute that cannot finish publishes blocked carrying the reason', async () => {
  const { ports } = makeExecutePorts({
    agentExecution: {
      async prepare() { return { prompt: 'p', agentConfig: {} }; },
      async launch() {
        return { agent: 'codex', rebaseDeferred: false, errored: true, errorMessage: 'all eligible agents are exhausted', exitStatus: null, detail: null };
      },
    },
  });
  const spy = spyCurrentWork();
  const controller = new BoardCommandController(ports, undefined, undefined, spy);

  const result = await controller.dispatch(boardRequest());

  assert.equal(result.status, 'failed');
  const blocked = spy.calls.find((call) => call.state === 'blocked');
  assert.ok(blocked, 'a blocked fact is published');
  assert.equal(blocked?.phase, 'execute');
});

// ---------------------------------------------------------------------------
// SC2(cancellation): a cancellation observed after the durable launch records ended
// ---------------------------------------------------------------------------

test('a board cancellation observed after the durable launch publishes ended', async () => {
  const cancellation = { requested: false };
  const { ports } = makeExecutePorts({
    agentExecution: {
      async prepare() { return { prompt: 'p', agentConfig: {} }; },
      async launch() {
        // Flip the cancellation after the durable launch so execute() reaches
        // the post-record cancellation boundary and publishes `ended`.
        cancellation.requested = true;
        return { agent: 'codex', rebaseDeferred: false, errored: false, errorMessage: null, exitStatus: 0, detail: null };
      },
    },
  });
  const spy = spyCurrentWork();
  const controller = new BoardCommandController(ports, undefined, undefined, spy);

  const result = await controller.dispatch(boardRequest({ cancellation }));

  assert.equal(result.status, 'cancelled');
  assert.ok(spy.calls.some((call) => call.phase === 'execute' && call.state === 'ended'), 'cancellation after launch publishes ended');
});

// ---------------------------------------------------------------------------
// SC3: production composition wires the real recorder, never the no-op default
// ---------------------------------------------------------------------------

test('production composition delivers a board controller that publishes to the wired recorder', async () => {
  const { ports } = makeExecutePorts();
  const { repo } = makeHistoryRepo();
  const recorder = new CurrentWorkRecorder(repo, { processId: 2387 });

  // Built via a typed const so the repository fakes are structurally checked
  // against their interfaces rather than flagged for extra test-only methods.
  const repositories = {
    agentBlocklist: { async findAll() { return []; }, async findByAgent() { return undefined; }, async save() {}, async deleteByAgent() {}, async clear() {} },
    operationalHistory: { async findAll() { return []; }, async findByType() { return []; }, async append() {}, async clear() {} },
    boardLaneEvents: { async findAll() { return []; }, async findByMissionId() { return []; }, async findByRepositoryId() { return []; }, async append() { return true; }, async clear() {} },
    usage: { async findAll() { return []; }, async findWhere() { return []; }, async save() {}, async saveAll() {}, async clear() {} },
  };

  const capabilities = composeProductionCapabilities(
    '/fixture-repository',
    repositoryId('/fixture-repository'),
    repositories,
    ports,
    null,
    recorder,
  );

  // The factory delivered by the production composition forwards the same
  // recorder composition received: a completed board launch publishes through it.
  const result = await capabilities.tui.commandControllerFactory(noopProgress).dispatchWithStatus(boardRequest(), 'refined');
  assert.equal(result.status, 'completed');

  const events = await new ConcreteCurrentWorkReadAdapter(repo).loadCurrentWork();
  // loadCurrentWork already parses the events into CurrentWorkEvent facts.
  const states = events.map((event) => event.state);
  // The production recorder is the value composition received: a completed board
  // launch writes running/ended facts to the operational-history authority it owns.
  assert.ok(states.includes('running'), 'the production recorder received a running fact');
  assert.ok(states.includes('ended'), 'the production recorder received an ended fact');
  assert.equal(events.length, 3, 'a completed launch publishes running, running, ended');
});

// ---------------------------------------------------------------------------
// SC4: the WORKING projection sees a live board launch and clears on a terminal state
// ---------------------------------------------------------------------------

test('a board-launched agent surfaces in the WORKING projection and clears on completion', async () => {
  const { repo } = makeHistoryRepo();
  const recorder = new CurrentWorkRecorder(repo, { processId: 999 });
  const controller = new BoardCommandController(makeExecutePorts().ports, undefined, {}, recorder);

  // A live launch lands a running fact; the projection grades it WORKING.
  await recorder.running({
    missionId: missionId('task-2387'),
    operationId: 'active:task-2387',
    phase: 'execute',
    summary: 'running execute agent',
    agent: agentFamily('codex'),
  });
  const working = await reconcileCurrentWork(
    await new ConcreteCurrentWorkReadAdapter(repo).loadCurrentWork(),
    { nowMs: Date.now(), ttlMs: CURRENT_WORK_TTL_MS },
  );
  const workingFact = working.get(missionId('task-2387'));
  assert.ok(isWorkInProgress(workingFact?.currentWork), 'a live launch surfaces as WORKING');

  // A completed board launch through the real controller brackets itself with an
  // ended fact, clearing the standing WORKING fact.
  const result = await controller.dispatch(boardRequest());
  assert.equal(result.status, 'completed');

  const cleared = await reconcileCurrentWork(
    await new ConcreteCurrentWorkReadAdapter(repo).loadCurrentWork(),
    { nowMs: Date.now(), ttlMs: CURRENT_WORK_TTL_MS },
  );
  const clearedFact = cleared.get(missionId('task-2387'));
  assert.equal(clearedFact?.currentWork, null, 'an ended fact clears the WORKING projection');
  assert.equal(isWorkInProgress(clearedFact?.currentWork), false, 'a cleared fact is not in progress');
});

test('a blocked board launch records a blocking reason in the projection', async () => {
  const { repo } = makeHistoryRepo();
  const controller = new BoardCommandController(
    makeExecutePorts({
      agentExecution: {
        async prepare() { return { prompt: 'p', agentConfig: {} }; },
        async launch() {
          return { agent: 'codex', rebaseDeferred: false, errored: true, errorMessage: 'no eligible agent family', exitStatus: null, detail: null };
        },
      },
    }).ports,
    undefined,
    {},
    new CurrentWorkRecorder(repo, { processId: 1000 }),
  );

  const result = await controller.dispatch(boardRequest());
  assert.equal(result.status, 'failed');

  const facts = await reconcileCurrentWork(
    await new ConcreteCurrentWorkReadAdapter(repo).loadCurrentWork(),
    { nowMs: Date.now(), ttlMs: CURRENT_WORK_TTL_MS },
  );
  const fact = facts.get(missionId('task-2387'));
  assert.equal(fact?.currentWork, null, 'a blocked run is no longer WORKING');
  assert.match(fact?.blockingReason ?? '', /no eligible agent family/);
});

// ---------------------------------------------------------------------------
// Regression: the no-op default still records nothing (read-only shell)
// ---------------------------------------------------------------------------

test('the no-op default records no current work', async () => {
  const { ports } = makeExecutePorts();
  const { repo } = makeHistoryRepo();
  // No current-work argument supplied: the controller falls back to the
  // NO_CURRENT_WORK_PORT default for read-only shells and test fixtures.
  const controller = new BoardCommandController(ports);

  await controller.dispatch(boardRequest());

  const events = await new ConcreteCurrentWorkReadAdapter(repo).loadCurrentWork();
  assert.equal(events.length, 0, 'a launched agent publishes nothing when the recorder is the no-op default');
});
