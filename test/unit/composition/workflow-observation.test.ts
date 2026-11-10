import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { createReviewLivenessReader, reviewLivenessSystem } from '../../../src/composition/review-liveness.js';
import type { ProductionApplicationServices } from '../../../src/composition/application-services.js';
import type { MissionTerminalCapability } from '../../../src/application/ports/mission-terminal.js';
import { workflowOperation } from '../../../src/domain/workflow-operation.js';
import { missionId } from '../../../src/domain/mission.js';
import { repositoryId } from '../../../src/domain/repository.js';
import { requestReviewIntervention } from '../../../src/domain/review.js';
import { fixtureMission, pendingReview } from '../../fixtures/mission-builders.js';
import { assessReviewOperatorResume } from '../../../src/application/review-recovery.js';
import { missionVersion } from '../../../src/application/domain-ports.js';
import { SqliteDatabaseAdapter } from '../../../src/adapters/sqlite/database-adapter.js';
import type { RunSummary } from '../../../src/application/run-history.js';
import { WorkflowProcessAdapter } from '../../../src/adapters/process/workflow-process.js';

test('orphan observation excludes the querying CLI capture and preserves unknown execution (TASK-2826)', async t => {
  const runs = [{ record: { captureKind: 'coordinator', supervisorPid: process.pid }, state: 'running', execution: 'unknown', executionProbeUnavailable: false }];
  t.mock.method(reviewLivenessSystem, 'startProcessTableRead', async () => [
    { pid: process.pid, elapsedSeconds: 1, args: 'px review task-one' },
    { pid: 42, elapsedSeconds: 1, args: 'unrelated' },
  ]);
  t.mock.method(reviewLivenessSystem, 'detectRunningMissionSessions', (options: Parameters<typeof reviewLivenessSystem.detectRunningMissionSessions>[0]) => {
    assert.deepEqual(options.listProcesses?.()?.map(entry => entry.pid), [42], 'the admitting CLI must not report itself as pre-existing ownership');
    return [];
  });
  t.mock.method(reviewLivenessSystem, 'createMissionTerminalCapability', () => ({ history: () => ({ ok: true, runs, unattributed: [] }) }) as unknown as MissionTerminalCapability);
  const graph = { operatorState: { db: { query: async () => [] } }, mission: { repositoryId: 'repo' } } as unknown as ProductionApplicationServices;
  const read = createReviewLivenessReader(graph, '/unused', resolveConfiguration({}));
  assert.deepEqual(await read('task-one'), {
    workflow: null,
    liveness: { workflow: false, coordinator: false, execution: false, reviewer: false },
  });
  runs.push({ record: { captureKind: 'agent', supervisorPid: 10 }, state: 'interrupted', execution: 'unknown', executionProbeUnavailable: false });
  assert.deepEqual(await read('task-one'), {
    workflow: null,
    liveness: { workflow: false, coordinator: false, execution: null, reviewer: null },
  });
  runs[1]!.execution = 'stopped';
  runs[1]!.executionProbeUnavailable = true;
  assert.equal((await read('task-one')).liveness.execution, null, 'a retained inconclusive provider probe cannot prove termination');
});

test('review observation excludes its admitted legacy owner but retains other workflow ownership (PX-0041.03 F2)', async t => {
  const operation = { ...workflowOperation({
    id: 'legacy-review', repositoryId: repositoryId('repo'), missionId: missionId('task-one'), requestKey: 'legacy-review',
    command: 'review:submit', generation: 0, phase: 'accepted', providerStarted: false, agent: null, reviewer: null,
    originalStatus: 'review', previousAssignee: null, owner: null,
    createdAt: '2026-11-10T10:00:00.000Z', updatedAt: '2026-11-10T10:00:00.000Z', reason: null,
  }), phase: 'executing' as const, generation: 1, owner: { pid: process.pid, identity: 'legacy-owner' },
    launcher: { pid: 42, identity: 'legacy-supervisor' },
    operatorInvocation: true, invocation: { command: 'review' as const, args: ['task-one'], interactive: false } };
  t.mock.method(reviewLivenessSystem, 'startProcessTableRead', async () => []);
  t.mock.method(reviewLivenessSystem, 'detectRunningMissionSessions', () => []);
  const runs: RunSummary[] = [{ record: {
    version: 1, runId: 'legacy-supervisor', missionId: 'task-one', repositoryId: 'repo',
    captureKind: 'coordinator', supervisorPid: 42, operationId: operation.id, role: 'review',
    family: null, attempt: null, terminalHost: 'pipe', hostFallbackReason: null, tmux: null,
    state: 'running', startedAt: operation.createdAt, endedAt: null, exitCode: null, signal: null,
    providerSessionId: null, redacted: false, sources: [], omissions: [],
    streams: { stdout: { bytes: 0, retainedBytes: 0, omitted: [] }, stderr: { bytes: 0, retainedBytes: 0, omitted: [] } },
  }, state: 'running', execution: 'stopped', coverage: [] }];
  const terminal = reviewLivenessSystem.createMissionTerminalCapability('/unused', resolveConfiguration({}));
  t.mock.method(terminal, 'history', () => ({ ok: true, runs, unattributed: [] }));
  t.mock.method(reviewLivenessSystem, 'createMissionTerminalCapability', () => terminal);
  let storedOperation = operation;
  const db = new SqliteDatabaseAdapter();
  t.mock.method(db, 'query', async () => [{ record_json: JSON.stringify(storedOperation) }]);
  t.mock.method(WorkflowProcessAdapter.prototype, 'alive', async () => null);
  const graph = { operatorState: { db }, mission: { repositoryId: repositoryId('repo') } };

  const owned = createReviewLivenessReader(graph, '/unused', resolveConfiguration({
    PARALLIX_WORKFLOW_OPERATION: operation.id, PARALLIX_WORKFLOW_GENERATION: '1',
  }));
  assert.deepEqual(await owned('task-one'), {
    workflow: null,
    liveness: { workflow: false, coordinator: false, execution: false, reviewer: false },
  });
  const competing = createReviewLivenessReader(graph, '/unused', resolveConfiguration({
    PARALLIX_WORKFLOW_OPERATION: 'another-review', PARALLIX_WORKFLOW_GENERATION: '1',
  }));
  assert.deepEqual(await competing('task-one'), {
    workflow: { id: operation.id, phase: 'executing', reason: null },
    liveness: { workflow: null, coordinator: true, execution: false, reviewer: false },
  });
  const review = requestReviewIntervention(pendingReview('task-one'), {
    requestedAt: '2026-11-10T10:00:00.000Z', requestedBy: 'workflow', reason: 'MAX_ATTEMPTS',
  });
  const mission = fixtureMission('task-one', { status: 'review', review });
  const load = async () => ({ kind: 'found' as const, mission, version: missionVersion(7) });
  assert.equal((await assessReviewOperatorResume('task-one', load, owned)).outcome, 'permitted');
  assert.equal((await assessReviewOperatorResume('task-one', load, competing)).outcome, 'refused');
  for (const generation of [undefined, '2']) {
    const stale = createReviewLivenessReader(graph, '/unused', resolveConfiguration({
      PARALLIX_WORKFLOW_OPERATION: operation.id,
      ...(generation ? { PARALLIX_WORKFLOW_GENERATION: generation } : {}),
    }));
    assert.equal((await stale('task-one')).workflow?.id, operation.id, 'an unconfirmed or stale generation cannot hide ownership');
    assert.equal((await assessReviewOperatorResume('task-one', load, stale)).outcome, 'refused');
  }
  runs.push({ ...runs[0]!, record: { ...runs[0]!.record, supervisorPid: 43 } });
  assert.equal((await assessReviewOperatorResume('task-one', load, owned)).outcome, 'refused', 'a different supervisor is competing ownership');
  runs.pop();
  storedOperation = { ...operation, owner: { pid: process.pid + 1, identity: 'another-owner' } };
  assert.equal((await owned('task-one')).workflow?.id, operation.id, 'inherited environment cannot hide another process owner');
  assert.equal((await assessReviewOperatorResume('task-one', load, owned)).outcome, 'refused');
});
import { EventEmitter } from 'node:events';
import { workflowObservationCapabilities, workflowObservationSystem } from '../../../src/composition/workflow-observation.js';
import { resolveConfiguration } from '../../../src/composition/config.js';

test('finite slow cold projection retains its observer and subsequent warm reads succeed (TASK-2770)', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => mock.restoreAll());
  let starts = 0;
  let kills = 0;
  let warm = false;
  mock.method(workflowObservationSystem, 'spawn', () => {
    starts++;
    const child = Object.assign(new EventEmitter(), { connected: true,
      send(request: { id: number }) {
        setTimeout(() => {
          warm = true;
          child.emit('message', { id: request.id, value: 'snapshot' });
        }, warm ? 1 : 10_500);
      },
      kill() { kills++; queueMicrotask(() => child.emit('exit', 1)); return true; },
      disconnect() { queueMicrotask(() => child.emit('exit', 0)); },
    });
    return child;
  });
  const observe = workflowObservationCapabilities('/unused', resolveConfiguration({}), { command: 'unused', args: [] });
  t.after(() => observe.close());
  for (let attempt = 0; attempt < 3; attempt++) {
    const expired = assert.rejects(observe.board(), /timed out/);
    t.mock.timers.tick(10_000);
    await expired;
    assert.equal(kills, 0, 'a request deadline must preserve finite cold work');
    t.mock.timers.tick(500);
    const reading = observe.board();
    t.mock.timers.tick(1);
    assert.equal(await reading, 'snapshot');
    warm = false;
  }
  assert.equal(starts, 1, 'cold deadlines must not cause repeated observer startup');
});

test('observation shares persistent readers, routes responses and rejects reads on close (TASK-2750 F7)', async t => {
  t.after(() => mock.restoreAll());
  const children: EventEmitter[] = [];
  mock.method(workflowObservationSystem, 'spawn', () => {
    const child = Object.assign(new EventEmitter(), { connected: true,
      send: (request: { id: number; observation: { kind: string } }) => {
        queueMicrotask(() => child.emit('message', { id: request.id, value: request.observation.kind }));
      },
      disconnect: () => { child.connected = false; queueMicrotask(() => child.emit('exit', 0)); },
      kill: () => { queueMicrotask(() => child.emit('exit', 1)); },
    });
    children.push(child); return child;
  });
  const observe = workflowObservationCapabilities('/unused', resolveConfiguration({}), { command: 'unused', args: [] });
  try {
    assert.equal(await observe.board(), 'board');
    assert.equal(await observe.board(), 'board');
    assert.equal(await observe.terminal.overview('task-test'), 'overview');
    assert.equal(children.length, 2, 'board and terminal each reuse one isolated reader');
  } finally { await observe.close(); }
  await assert.rejects(() => observe.board(), /closed/);
});

for (const failure of ['response', 'send', 'exit', 'error', 'timeout', 'close'] as const) {
  test(`observation rejects pending reads on ${failure} and releases its child (TASK-2750)`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    t.after(() => mock.restoreAll());
    let requestId = 0;
    const signals: string[] = [];
    const child = Object.assign(new EventEmitter(), { connected: false,
      send(request: { id: number }, callback: (error?: Error) => void) {
        requestId = request.id;
        if (failure === 'send') { callback(new Error('send failed')); }
      },
      kill(signal: string) { signals.push(signal); queueMicrotask(() => child.emit('exit', 1)); return true; },
    });
    mock.method(workflowObservationSystem, 'spawn', () => child);
    const observe = workflowObservationCapabilities('/unused', resolveConfiguration({}), { command: 'unused', args: [] });
    t.after(() => observe.close());
    const reading = assert.rejects(observe.board(), /failed|exited|timed out|closed/);
    if (failure === 'response') { child.emit('message', { id: requestId, error: 'response failed' }); }
    if (failure === 'exit') { child.emit('exit', 7); }
    if (failure === 'error') { child.emit('error', new Error('child failed')); }
    if (failure === 'timeout') { t.mock.timers.tick(10000); }
    if (failure === 'close') { await observe.close(); }
    await reading;
    await observe.close();
    if (failure === 'close') { assert.ok(signals.includes('SIGTERM')); }
  });
}

test('request expiry leaves unrelated reads and the independent terminal observer alive (TASK-2770)', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => mock.restoreAll());
  const children: Array<EventEmitter & { requests: number[] }> = [];
  mock.method(workflowObservationSystem, 'spawn', () => {
    const child = Object.assign(new EventEmitter(), { connected: true, requests: [] as number[],
      send(request: { id: number }) { child.requests.push(request.id); },
      disconnect() { queueMicrotask(() => child.emit('exit', 0)); },
      kill() { assert.fail('request expiration must not kill the observer'); },
    });
    children.push(child); return child;
  });
  const observe = workflowObservationCapabilities('/unused', resolveConfiguration({}), { command: 'unused', args: [] });
  t.after(() => observe.close());
  const expired = assert.rejects(observe.board(), /timed out/);
  t.mock.timers.tick(5000);
  const pending = observe.board();
  const terminal = observe.terminal.overview('task-test');
  t.mock.timers.tick(5000);
  await expired;
  children[0]!.emit('message', { id: children[0]!.requests[1], value: 'fresh board' });
  children[1]!.emit('message', { id: children[1]!.requests[0], value: 'terminal' });
  assert.deepEqual(await Promise.all([pending, terminal]), ['fresh board', 'terminal']);
  const exitRead = assert.rejects(observe.board(), /exited/);
  children[0]!.emit('exit', 7);
  await exitRead;
  const replacement = observe.board();
  children[0]!.emit('exit', 7); // A late event from the old generation.
  children[2]!.emit('message', { id: children[2]!.requests[0], value: 'replacement' });
  assert.equal(await replacement, 'replacement');
});

test('observer close bounds an unresponsive child and forcefully releases ownership (TASK-2770)', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => mock.restoreAll());
  const signals: string[] = [];
  const child = Object.assign(new EventEmitter(), { connected: true,
    send() {}, disconnect() {}, kill(signal: string) { signals.push(signal); return true; },
  });
  mock.method(workflowObservationSystem, 'spawn', () => child);
  const observe = workflowObservationCapabilities('/unused', resolveConfiguration({}), { command: 'unused', args: [] });
  const reading = assert.rejects(observe.board(), /closed/);
  const closing = observe.close();
  await reading;
  t.mock.timers.tick(2000);
  await closing;
  assert.deepEqual(signals, ['SIGKILL']);
  await assert.rejects(observe.board(), /closed/);
  await observe.close();
});

test('terminal observation preserves page and search requests and correlates concurrent replies (TASK-2750)', async t => {
  t.after(() => mock.restoreAll());
  const requests: Array<{ id: number; observation: unknown }> = [];
  const child = Object.assign(new EventEmitter(), { connected: true,
    send: (request: { id: number; observation: unknown }) => { requests.push(request); },
    disconnect: () => { queueMicrotask(() => child.emit('exit', 0)); },
  });
  mock.method(workflowObservationSystem, 'spawn', () => child);
  const observe = workflowObservationCapabilities('/unused', resolveConfiguration({}), { command: 'unused', args: [] });
  t.after(() => observe.close());
  const pageRequest = { runId: 'run', stream: 'stdout' as const, limit: 10 };
  const searchRequest = { pattern: 'needle' };
  const page = observe.terminal.page('task-test', pageRequest);
  const search = observe.terminal.search('task-test', searchRequest);
  const live = observe.terminal.live('task-test');
  assert.deepEqual(requests.map(request => request.observation), [
    { kind: 'page', mission: 'task-test', request: pageRequest },
    { kind: 'search', mission: 'task-test', request: searchRequest },
    { kind: 'live', mission: 'task-test' },
  ]);
  for (const request of [...requests].reverse()) { child.emit('message', { id: request.id, value: request.id }); }
  assert.deepEqual(await Promise.all([page, search, live]), [1, 2, 3]);
});

test('observer child serializes board and terminal reads and closes its shared graph on disconnect (TASK-2750)', async t => {
  const { runWorkflowObservation } = await import('../../../src/composition/workflow-observation.js');
  t.after(() => mock.restoreAll());
  let receive: (input: unknown) => void = () => {};
  let disconnect: () => void = () => {};
  mock.method(process, 'on', (event: string, listener: typeof receive) => { assert.equal(event, 'message'); receive = listener; return process; });
  mock.method(process, 'once', (event: string, listener: () => void) => { assert.equal(event, 'disconnect'); disconnect = listener; return process; });
  const originalConnected = Object.getOwnPropertyDescriptor(process, 'connected');
  const originalSend = Object.getOwnPropertyDescriptor(process, 'send');
  t.after(() => {
    mock.restoreAll();
    for (const [key, descriptor] of [['connected', originalConnected], ['send', originalSend]] as const) {
      if (descriptor) { Object.defineProperty(process, key, descriptor); } else { Reflect.deleteProperty(process, key); }
    }
  });
  Object.defineProperty(process, 'connected', { configurable: true, value: true });
  const responses: unknown[] = [];
  Object.defineProperty(process, 'send', { configurable: true, writable: true,
    value: (value: unknown) => { responses.push(value); return true; } });
  let exited = false;
  mock.method(process, 'exit', () => { exited = true; return undefined as never; });
  let compositions = 0;
  let closed = false;
  const graphFactory = async () => {
    compositions++;
    return { mission: { repositoryId: 'repo' }, operatorState: { db: { query: async () => [] }, close: async () => { closed = true; } },
      presentationCapabilities: { boardProjection: { build: async () => ({ stages: [], attentionQueue: [] }) } } };
  };
  const terminalFactory = () => ({
    overview: (mission: string) => `overview:${mission}`, live: (mission: string) => `live:${mission}`,
    page: (_mission: string, request: unknown) => request, search: (_mission: string, request: unknown) => request,
  });
  runWorkflowObservation('/unused', resolveConfiguration({}), terminalFactory as never, graphFactory as never);
  receive({ id: 1, observation: { kind: 'board' } });
  receive({ id: 2, observation: { kind: 'overview', mission: 'task-test' } });
  receive({ id: 3, observation: { kind: 'live', mission: 'task-test' } });
  receive({ id: 4, observation: { kind: 'page', mission: 'task-test', request: { runId: 'run' } } });
  receive({ id: 5, observation: { kind: 'search', mission: 'task-test', request: { pattern: 'needle' } } });
  disconnect();
  for (let turn = 0; turn < 50 && !exited; turn++) { await Promise.resolve(); }
  assert.equal(exited, true);
  assert.equal(closed, true);
  assert.equal(compositions, 1);
  assert.deepEqual(responses.slice(1), [
    { id: 2, value: 'overview:task-test' }, { id: 3, value: 'live:task-test' },
    { id: 4, value: { runId: 'run' } }, { id: 5, value: { pattern: 'needle' } },
  ]);
  assert.equal((responses[0] as { id: number }).id, 1);
});

test('one-shot observation always closes the reader after a response (TASK-2750)', async t => {
  const { observeWorkflow } = await import('../../../src/composition/workflow-observation.js');
  t.after(() => mock.restoreAll());
  let disconnected = false;
  const child = Object.assign(new EventEmitter(), { connected: true,
    send: (request: { id: number }) => { queueMicrotask(() => child.emit('message', { id: request.id, value: 'board result' })); },
    disconnect: () => { disconnected = true; queueMicrotask(() => child.emit('exit', 0)); },
  });
  mock.method(workflowObservationSystem, 'spawn', () => child);
  assert.equal(await observeWorkflow('/unused', resolveConfiguration({}), { kind: 'board' }, { command: 'unused', args: [] }), 'board result');
  assert.equal(disconnected, true);
});
