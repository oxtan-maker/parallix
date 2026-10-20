// Supervisor contract: intent reservation and executor exit, with no native IO.
import test, { mock } from 'node:test';
import { EventEmitter } from 'node:events';
import assert from 'node:assert/strict';
import { runWorkflowWorker, composeWorkflowOperations, observeWorkflowOperations } from '../../../src/composition/workflow-operations.js';
import { resolveConfiguration } from '../../../src/composition/config.js';
import { WorkflowOperationService } from '../../../src/application/workflow-operation-service.js';
import type { WorkflowOperation } from '../../../src/domain/workflow-operation.js';
import { runWorkflowRecovery, startWorkflowRecovery, workflowRecoverySystem } from '../../../src/composition/workflow-recovery.js';
import { setLogger } from '../../../src/application/presentation/cli-format.js';

function fixture(reserved = true, claimed = false, settled = true) {
  const events: string[] = [];
  let operation = { id: 'operation', missionId: 'task-test', repositoryId: 'repo', command: 'active:execute', phase: 'accepted', owner: null } as WorkflowOperation;
  const service = {
    operation: async () => operation,
    recover: (id: string) => WorkflowOperationService.prototype.recover.call({
      _operations: { readOnly: async (read: () => unknown) => read(), open: async () => [operation], get: async () => operation, transaction: async (write: () => unknown) => write(), replace: async (next: WorkflowOperation) => { operation = next; } },
      _processes: { alive: async () => false, effectsSettled: async () => settled },
      publish: async () => { events.push(operation.phase); },
    } as unknown as WorkflowOperationService, id),
    reserveLaunch: async () => reserved,
    async startupFailed(_id: string, reason: string) {
      if (operation.phase === 'accepted') { operation = { ...operation, phase: 'blocked', reason }; events.push('blocked'); }
    },
  };
  const compose = async () => ({ service, close: async () => { events.push('closed'); } }) as unknown as Awaited<ReturnType<typeof composeWorkflowOperations>>;
  const dependencies = { compose, context: () => ({ ok: true as const, context: { missionId: 'task-test', missionWorktree: '/unused', missionBranch: 'mission/task-test', baseWorktree: '/base', baseBranch: 'main' } }), worktree: () => null,
    capture: (() => ({ correlateOperation: () => {}, finish: () => { events.push('capture-ended'); } })) as never,
    host: async () => {
      if (claimed) { operation = { ...operation, phase: 'preparing', owner: { pid: 99, identity: 'executor' } }; }
      return { exitCode: 17, signal: null };
    },
  };
  return { events, dependencies, service };
}

test('executor exit before claim settles accepted intent instead of relaunching (TASK-2750 F1)', async () => {
  const f = fixture();
  const code = await runWorkflowWorker('operation', '/unused', resolveConfiguration({}), false,
    async () => { throw new Error('Supervisor must not build the application graph'); }, f.dependencies);
  assert.equal(code, 17);
  assert.equal((await f.service.operation()).phase, 'blocked');
  assert.match((await f.service.operation()).reason!, /before claiming.*17/);
  assert.deepEqual(f.events, ['blocked', 'capture-ended', 'closed']);
});

test('losing supervisors build no graph, capture or executor (TASK-2750 F3)', async () => {
  const f = fixture(false);
  const code = await runWorkflowWorker('operation', '/unused', resolveConfiguration({}), false,
    async () => { throw new Error('No full graph for losing launcher'); }, {
      ...f.dependencies, capture: () => { throw new Error('No duplicate capture'); },
      host: async () => { throw new Error('No duplicate executor'); },
    });
  assert.equal(code, 0);
  assert.deepEqual(f.events, ['closed']);
});


test('read-only CLI observation uses the existing connection without recovery or write transactions (TASK-2750 F3)', async () => {
  const events: string[] = [];
  const graph = { mission: { repositoryId: 'repo' }, operatorState: {
    db: { query: async () => { events.push('read'); return []; } },
    close: async () => { events.push('close'); },
  }, presentationCapabilities: { boardProjection: {
    build: async () => ({ stages: [], attentionQueue: [] }), buildMissionCard: async () => null,
  }, tui: {} } } as unknown as import('../../../src/composition/application-services.js').ProductionApplicationServices;
  const observed = observeWorkflowOperations(graph);
  await observed.presentationCapabilities!.boardProjection.build();
  await observed.operatorState.close();
  assert.deepEqual(events, ['read', 'close']);
  assert.equal(observed.operatorState, graph.operatorState);
});

for (const settled of [true, false]) {
  test(`claimed executor exit reconciles without a recovery host, effects settled=${settled} (TASK-2750 F1)`, async () => {
    const f = fixture(true, true, settled);
    const code = await runWorkflowWorker('operation', '/unused', resolveConfiguration({}), false,
      async () => { throw new Error('Supervisor must not build the application graph'); }, f.dependencies);
    assert.equal(code, 17);
    assert.equal((await f.service.operation()).phase, settled ? 'interrupted' : 'stopping');
    assert.deepEqual(f.events, [settled ? 'interrupted' : 'stopping', 'capture-ended', 'closed']);
  });
}

test('recovery waits for each pass and closes after in-flight work on host disconnect (TASK-2750)', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const lifetime = Object.assign(new EventEmitter(), { connected: true });
  const releases: Array<() => void> = [];
  let closed = false;
  let calls = 0;
  const compose = async () => ({
    service: { recover: () => { calls++; return new Promise<void>(resolve => releases.push(resolve)); } },
    close: async () => { closed = true; },
  }) as unknown as Awaited<ReturnType<typeof composeWorkflowOperations>>;
  const running = runWorkflowRecovery('/unused', resolveConfiguration({}), compose, lifetime as never);
  t.after(async () => { lifetime.emit('disconnect'); releases.forEach(release => release()); await running; });
  await Promise.resolve();
  assert.equal(calls, 1);
  t.mock.timers.tick(6000);
  assert.equal(calls, 1, 'a slow pass must not overlap later recovery');
  releases[0]();
  await Promise.resolve(); await Promise.resolve();
  t.mock.timers.tick(2000);
  assert.equal(calls, 2);
  lifetime.emit('disconnect');
  await Promise.resolve();
  assert.equal(closed, false, 'disconnect must await the active pass before closing its connection');
  releases[1]();
  await running;
  assert.equal(closed, true);
  t.mock.timers.tick(10000);
  assert.equal(calls, 2, 'disconnect cancels subsequent recovery');
});

test('recovery runs in a configured child, restarts exits and bounds host shutdown (TASK-2750)', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => mock.restoreAll());
  mock.method(console, 'error', () => {});
  const children: Array<EventEmitter & { connected: boolean; disconnect(): void; kill(signal: string): boolean }> = [];
  const signals: string[] = [];
  let invocation: unknown[] = [];
  mock.method(workflowRecoverySystem, 'spawn', (...args: unknown[]) => {
    invocation = args;
    const child = Object.assign(new EventEmitter(), { connected: true,
      disconnect() { this.connected = false; },
      kill(signal: string) { signals.push(signal); if (signal === 'SIGKILL') { child.emit('exit', null); } return true; },
    });
    children.push(child); return child;
  });
  const configuration = resolveConfiguration({});
  const recovery = startWorkflowRecovery('/unused', configuration, { command: 'configured-node', args: ['pinned-cli'] });
  t.after(() => { children.forEach(child => child.emit('exit', 0)); });
  assert.deepEqual(invocation, ['configured-node', ['pinned-cli', '--workflow-recover', '/unused'], {
    cwd: '/unused', env: { ...configuration.forwardedEnvironment }, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  }]);
  children[0].emit('exit', 1);
  t.mock.timers.tick(2000);
  assert.equal(children.length, 2);
  const closing = recovery.close();
  assert.equal(children[1].connected, false);
  t.mock.timers.tick(2000);
  assert.deepEqual(signals, ['SIGTERM']);
  t.mock.timers.tick(2000);
  await closing;
  assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
  t.mock.timers.tick(10000);
  assert.equal(children.length, 2, 'shutdown must not restart its recovery child');
});

test('recovery shutdown rejects when termination cannot be confirmed and cleans up (TASK-2750)', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => mock.restoreAll());
  const signals: string[] = [];
  const child = Object.assign(new EventEmitter(), { connected: true,
    disconnect() { this.connected = false; },
    kill(signal: string) { signals.push(signal); return false; },
  });
  let launches = 0;
  mock.method(workflowRecoverySystem, 'spawn', () => { launches++; return child; });
  const recovery = startWorkflowRecovery('/unused', resolveConfiguration({}), { command: 'unused', args: [] });
  const result: { outcome: unknown } = { outcome: 'pending' };
  const closing = recovery.close().then(() => { result.outcome = 'completed'; }, error => { result.outcome = error; });
  t.after(async () => { child.emit('exit', 0); await closing; });
  t.mock.timers.tick(6000);
  await Promise.resolve(); await Promise.resolve();
  assert.ok(result.outcome instanceof Error, 'the confirmation deadline must settle instead of waiting forever');
  assert.match(result.outcome.message, /termination.*unconfirmed/i);
  await closing;
  assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
  assert.equal(child.listenerCount('exit'), 0);
  assert.equal(child.listenerCount('error'), 0);
  t.mock.timers.tick(10000);
  assert.equal(launches, 1, 'unconfirmed shutdown cannot restart recovery');
});

test('recovery startup failures exhaust a finite budget with backoff and diagnostics (TASK-2750)', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => mock.restoreAll());
  const children: EventEmitter[] = [];
  const diagnostics: string[] = [];
  const previous = setLogger({ log: () => {}, error: (message: unknown) => { diagnostics.push(String(message)); } });
  t.after(() => { setLogger(previous); });
  mock.method(workflowRecoverySystem, 'spawn', () => {
    const child = new EventEmitter(); children.push(child); return child;
  });
  const recovery = startWorkflowRecovery('/unused', resolveConfiguration({}), { command: 'unused', args: [] });
  t.after(async () => { children.at(-1)?.emit('exit', 0); await recovery.close(); });
  children[0].emit('error', new Error('database unavailable'));
  children[0].emit('exit', 1);
  t.mock.timers.tick(1999);
  assert.equal(children.length, 1);
  t.mock.timers.tick(1);
  assert.equal(children.length, 2);
  children[1].emit('exit', 1);
  t.mock.timers.tick(2000);
  assert.equal(children.length, 2, 'second failure must back off longer than the first');
  t.mock.timers.tick(2000);
  assert.equal(children.length, 3);
  children[2].emit('exit', 1);
  t.mock.timers.tick(60000);
  assert.equal(children.length, 3, 'an exhausted recovery budget must not restart forever');
  assert.equal(diagnostics.length, 3, 'report each failed attempt once, including exhaustion');
  assert.match(diagnostics[0], /database unavailable.*2000/i);
  assert.match(diagnostics[1], /4000/);
  assert.match(diagnostics[2], /unavailable.*restart px web or px ui/i);
});

test('thirty seconds of healthy recovery restores the consecutive failure budget (TASK-2750)', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => mock.restoreAll());
  const children: EventEmitter[] = [];
  const diagnostics: string[] = [];
  mock.method(console, 'error', () => {});
  const previous = setLogger({ log: () => {}, error: (message: unknown) => { diagnostics.push(String(message)); } });
  t.after(() => { setLogger(previous); });
  mock.method(workflowRecoverySystem, 'spawn', () => {
    const child = new EventEmitter(); children.push(child); return child;
  });
  const recovery = startWorkflowRecovery('/unused', resolveConfiguration({}), { command: 'unused', args: [] });
  t.after(async () => { children.at(-1)?.emit('exit', 0); await recovery.close(); });
  children[0].emit('exit', 1);
  t.mock.timers.tick(2000);
  t.mock.timers.tick(30000);
  children[1].emit('exit', 1);
  t.mock.timers.tick(2000);
  assert.equal(children.length, 3, 'a stable child resets retry delay to the first failure');
  assert.match(diagnostics[1], /attempt 1\/3.*2000/i);
  children[2].emit('exit', 1);
  t.mock.timers.tick(4000);
  assert.equal(children.length, 4, 'stable recovery regains a full failure budget');
  children[3].emit('exit', 1);
  t.mock.timers.tick(60000);
  assert.equal(children.length, 4, 'quick failures still exhaust the replenished budget');
  assert.match(diagnostics.at(-1)!, /automatic recovery is unavailable/i);
});

test('an exited recovery child cannot reset the next child failure budget (TASK-2750)', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => mock.restoreAll());
  const children: EventEmitter[] = [];
  const diagnostics: string[] = [];
  const previous = setLogger({ log: () => {}, error: (message: unknown) => { diagnostics.push(String(message)); } });
  t.after(() => { setLogger(previous); });
  mock.method(workflowRecoverySystem, 'spawn', () => {
    const child = new EventEmitter(); children.push(child); return child;
  });
  const recovery = startWorkflowRecovery('/unused', resolveConfiguration({}), { command: 'unused', args: [] });
  t.after(async () => { children.at(-1)?.emit('exit', 0); await recovery.close(); });
  t.mock.timers.tick(20000);
  children[0].emit('exit', 1);
  t.mock.timers.tick(2000);
  t.mock.timers.tick(10000);
  children[1].emit('exit', 1);
  assert.match(diagnostics[1], /attempt 2\/3.*4000/i);
  t.mock.timers.tick(2000);
  assert.equal(children.length, 2, 'an old healthy timer cannot shorten the next retry');
});


test('disconnected recovery never opens workflow services (TASK-2750)', async () => {
  const lifetime = Object.assign(new EventEmitter(), { connected: false });
  await runWorkflowRecovery('/unused', resolveConfiguration({}), async () => {
    assert.fail('a disconnected recovery child must not open services');
  }, lifetime as never);
  assert.equal(lifetime.listenerCount('disconnect'), 0);
});

test('recovery disconnect during startup skips deferred service composition (TASK-2750)', async () => {
  const lifetime = Object.assign(new EventEmitter(), { connected: true });
  const running = runWorkflowRecovery('/unused', resolveConfiguration({}), undefined, lifetime as never);
  lifetime.connected = false;
  lifetime.emit('disconnect');
  await running;
  assert.equal(lifetime.listenerCount('disconnect'), 0);
});

test('owned active execution retains implementation completion output (TASK-2750)', async t => {
  const messages: string[] = [];
  const previous = setLogger({ log: (message: unknown) => { messages.push(String(message)); }, error: () => {} });
  t.after(() => { setLogger(previous); });
  let operation = { id: 'operation', missionId: 'task-test', repositoryId: 'repo', command: 'active:execute', phase: 'running', generation: 1 } as WorkflowOperation;
  const createGraph: typeof import('../../../src/composition/application-services.js').createProductionApplicationServices = async (_root, progress) => ({
    operatorState: { close: async () => {} }, presentationCapabilities: {
      commandController: { dispatch: async () => {
        progress?.({ operationId: 'operation', sequence: 3, phase: 'handoff', message: 'starting handoff', timestamp: 'now', agent: 'custom' });
        return { status: 'completed' };
      } },
    },
  } as unknown as Awaited<ReturnType<typeof createGraph>>);
  const compose = async () => ({ service: {
    operation: async () => operation,
    run: async (_id: string, execute: (request: unknown) => Promise<unknown>) => {
      await execute({ kind: 'active:execute', missionId: 'task-test' }); operation = { ...operation, phase: 'completed' };
    },
  }, close: async () => {} }) as unknown as Awaited<ReturnType<typeof composeWorkflowOperations>>;
  assert.equal(await runWorkflowWorker('operation', '/unused', resolveConfiguration({}), true, createGraph, { compose }), 0);
  assert.match(messages.join('\n'), /Implementation complete \(custom\)/);
});

test('owned execution scopes writes and provider progress to its claimed generation and clears authority (TASK-2750)', async () => {
  const { authorizeMissionWrite, reportAuthorizedProgress, reportWorkflowProviderStarted, hasMissionWriteAuthorization } = await import('../../../src/application/ports/mission-write-authorization.js');
  const events: unknown[] = [];
  const operation = { id: 'operation', missionId: 'task-test', repositoryId: 'repo', command: 'active:execute', phase: 'running', generation: 2, owner: { pid: 1, identity: 'owner' } } as WorkflowOperation;
  let completed = false;
  const compose = async () => ({ service: {
    operation: async () => completed ? { ...operation, phase: 'completed' } : operation,
    run: async (_id: string, execute: (request: unknown) => Promise<unknown>) => { await execute({ kind: 'active:execute', missionId: 'task-test' }); completed = true; },
    assertOwner: async (...args: unknown[]) => { events.push(args); },
    progress: async (...args: unknown[]) => { events.push(args); },
  }, close: async () => { events.push('store closed'); } }) as unknown as Awaited<ReturnType<typeof composeWorkflowOperations>>;
  const graph: typeof import('../../../src/composition/application-services.js').createProductionApplicationServices = async (_root, _progress, options) => {
    assert.equal(options?.configuration?.runtime.workflowGeneration, 2);
    assert.equal(options?.configuration?.forwardedEnvironment.PARALLIX_WORKFLOW_OPERATION, 'operation');
    return { operatorState: { close: async () => { events.push('graph closed'); } }, presentationCapabilities: { commandController: { dispatch: async () => {
      await authorizeMissionWrite('task-test');
      await authorizeMissionWrite('task-test', async () => operation);
      await assert.rejects(authorizeMissionWrite('other'), /another mission/);
      await assert.rejects(authorizeMissionWrite('task-test', async () => null), /owner missing/);
      await reportAuthorizedProgress('execute', 'working', 'custom');
      await reportWorkflowProviderStarted('custom');
      return { status: 'completed' };
    } } } } as unknown as Awaited<ReturnType<typeof graph>>;
  };
  assert.equal(await runWorkflowWorker('operation', '/unused', resolveConfiguration({}), true, graph, { compose }), 0);
  assert.equal(hasMissionWriteAuthorization(), false);
  assert.deepEqual(events, [['operation', 2], ['operation', 2, 'execute', 'working', 'custom'], ['operation', 2, 'execute', 'provider execution started', 'custom', true], 'graph closed', 'store closed']);
});

for (const hostFailure of [false, true]) {
  test(`worker startup failure closes resources, host failure=${hostFailure} (TASK-2750)`, async () => {
    const events: string[] = [];
    const compose = async () => ({ service: {
      operation: async () => hostFailure ? { id: 'operation', missionId: 'task-test', repositoryId: 'repo', command: 'active:execute' } : null,
      reserveLaunch: async () => true,
      startupFailed: async (_id: string, reason: string) => { events.push(reason); },
    }, close: async () => { events.push('closed'); } }) as unknown as Awaited<ReturnType<typeof composeWorkflowOperations>>;
    await assert.rejects(runWorkflowWorker('operation', '/unused', resolveConfiguration({}), false, undefined, {
      compose, worktree: () => '/worktree',
      capture: (() => ({ correlateOperation: () => {}, finish: () => { events.push('capture ended'); } })) as never,
      context: () => ({ ok: true as const, context: { missionId: 'task-test', missionWorktree: '/unused', missionBranch: 'mission/task-test', baseWorktree: '/base', baseBranch: 'main' } }),
      host: async () => { throw new Error('host unavailable'); },
    }), hostFailure ? /host unavailable/ : /Unknown workflow operation/);
    assert.equal(events.at(-1), 'closed');
    assert.equal(events.includes('capture ended'), hostFailure);
    assert.match(events[0], hostFailure ? /host unavailable/ : /Unknown workflow operation/);
  });
}

for (const [label, patch, expected] of [
  ['board integration runs in the resolved mission worktree', { command: 'integrate:merge' }, '/missions/task-test'],
  ['terminal integration resolves the Mission checkout', { command: 'integrate:merge', invocation: { command: 'integrate', args: ['task-test'] } }, '/missions/task-test'],
  ['execute resolves the Mission checkout', { command: 'active:execute' }, '/missions/task-test'],
] as const) {
  test(`${label} (TASK-2777)`, async () => {
    const f = fixture();
    Object.assign(await f.service.operation(), patch);
    const roots: string[] = [];
    const resolved: string[] = [];
    await runWorkflowWorker('operation', '/host', resolveConfiguration({}), false, undefined, { ...f.dependencies,
      context: (slug, root) => { resolved.push(`${slug}@${root}`); return { ok: true, context: { missionId: slug, missionWorktree: `/missions/${slug}`, missionBranch: `mission/${slug}`, baseWorktree: '/host', baseBranch: 'main' } }; },
      host: async (_cli, _operation, root) => { roots.push(root); return { exitCode: 0, signal: null }; } });
    assert.deepEqual(roots, [expected]);
    assert.deepEqual(resolved, ['task-test@/host']);
  });
}

test('unresolved board integration context blocks with its reason before any executor (TASK-2777)', async () => {
  const f = fixture();
  Object.assign(await f.service.operation(), { command: 'integrate:merge' });
  const written: string[] = [];
  const code = await runWorkflowWorker('operation', '/host', resolveConfiguration({}), false, undefined, { ...f.dependencies,
    capture: (() => ({ correlateOperation: () => {}, write: (_stream: string, chunk: Buffer) => { written.push(String(chunk)); }, finish: () => { f.events.push('capture-ended'); } })) as never,
    context: () => ({ ok: false, reason: 'Mission task-test: no worktree is checked out on mission/task-test (expected /missions/task-test).' }),
    host: async () => { throw new Error('No executor for an unresolved context'); } });
  assert.equal(code, 1);
  assert.equal((await f.service.operation()).phase, 'blocked');
  assert.match((await f.service.operation()).reason!, /^Mission task-test: no worktree is checked out on mission\/task-test/);
  assert.match(written.join(''), /Mission task-test: no worktree/);
  assert.deepEqual(f.events, ['blocked', 'capture-ended', 'closed']);
});
