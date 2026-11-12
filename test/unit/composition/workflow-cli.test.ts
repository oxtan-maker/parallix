// Human command boundary: original parsing is retained inside the owner;
// retained bytes and phases are visible without giving observation ownership.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ownWorkflowCli, workflowCliObserver } from '../../../src/composition/workflow-cli.js';
import type { ProductionApplicationServices } from '../../../src/composition/application-services.js';
import type { Command } from '../../../src/interfaces/cli/runtime.js';
import type { WorkflowOperation } from '../../../src/domain/workflow-operation.js';
import type { MissionTerminalCapability } from '../../../src/application/ports/mission-terminal.js';
import { completed, failure } from '../../../src/application/contracts.js';
import type { BoardCommandDispatcher, BoardCommandRequest } from '../../../src/application/controller/board-command.js';

test('review SIGTERM disconnects without fencing its detached reviewer (TASK-2826)', async () => {
  const before = process.listenerCount('SIGTERM');
  const existing = new Set(process.listeners('SIGTERM'));
  let fenced = false;
  let verdict = false;
  const registry = { review: async () => {} } as Record<string, Command>;
  const graph = { presentationCapabilities: { commandController: { dispatch: async (request: BoardCommandRequest) => {
    // The controlled owner has launched independently before the client dies.
    // Invoke only this client's signal handler, not the runner's shutdown hook.
    for (const listener of process.listeners('SIGTERM')) { if (!existing.has(listener)) { listener('SIGTERM'); } }
    fenced = Boolean(request.cancellation?.requested && request.cancellation.stopOwnedWorkflow);
    verdict = !fenced;
    return failure('cancelled', 'Stopped waiting; workflow continues independently');
  } } }, operatorState: { close: async () => {} } } as unknown as ProductionApplicationServices;
  ownWorkflowCli(registry, async () => graph);
  await assert.rejects(async () => registry.review(['task-test']), /continues independently/);
  assert.equal(fenced, false, 'client disconnect must not request an ownership-fencing stop');
  assert.equal(verdict, true);
  assert.equal(process.listenerCount('SIGTERM'), before);
});

test('CLI preserves review flags and reports stop diagnostics while closing its graph (TASK-2750 F4)', async t => {
  const requests: BoardCommandRequest[] = [];
  let closed = 0;
  let pending = true;
  const messages: string[] = [];
  t.mock.method(console, 'log', (line: string) => { messages.push(line); });
  const registry: Record<string, Command> = { draft: async () => {}, integrate: async () => {}, review: async () => {} };
  const graph = { mission: { store: { load: async () => ({ kind: 'found', mission: { status: 'review' } }) } },
    presentationCapabilities: { commandController: { dispatch: async (request: BoardCommandRequest) => {
      requests.push(request); return request.kind === 'workflow:stop' && pending ? failure('conflict', 'Stop is pending') : completed({});
    } } }, operatorState: { close: async () => { closed++; } } } as unknown as ProductionApplicationServices;
  ownWorkflowCli(registry, async () => graph);
  await registry.review(['task-test', '--reviewer', 'codex']);
  assert.deepEqual(requests[0].invocation, { command: 'review', args: ['task-test', '--reviewer', 'codex'], interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY) });
  await assert.rejects(async () => registry.stop(['task-test']), /Stop is pending/);
  assert.equal(closed, 2);
  pending = false;
  await registry.stop(['task-test']);
  assert.deepEqual(messages, ['Stop task-test: owned-work shutdown confirmed; mission and history retained.']);
  assert.equal(closed, 3);
});

test('public rebase enters durable workflow ownership and the inherited worker runs it without readmission (TASK-2835)', async () => {
  const requests: BoardCommandRequest[] = [];
  let directRuns = 0; let opened = 0;
  const registry = { rebase: async () => { directRuns++; } } as Record<string, Command>;
  const graph = { presentationCapabilities: { commandController: { dispatch: async (request: BoardCommandRequest) => {
    requests.push(request); return completed({});
  } } }, operatorState: { close: async () => {} } } as unknown as ProductionApplicationServices;
  ownWorkflowCli(registry, async () => { opened++; return graph; });
  await registry.rebase(['task-test', '--push']);
  assert.equal(directRuns, 0);
  assert.equal(opened, 1);
  assert.equal(requests[0].kind, 'rebase:run');
  assert.deepEqual(requests[0].invocation, { command: 'rebase', args: ['task-test', '--push'], interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY) });

  configureMissionWriteAuthorization({ operationId: 'owned-rebase', generation: 2, inherited: true, assert: async () => {} });
  try {
    await registry.rebase(['task-test']);
    assert.equal(directRuns, 1);
    assert.equal(opened, 1);
  } finally { configureMissionWriteAuthorization(null); }
});

test('CLI streams only its coordinator bytes incrementally and renders phase changes (TASK-2750 F4)', async () => {
  const text: string[] = []; const phases: string[] = []; const after: number[] = []; let now = 0;
  const terminal = { history: () => ({ ok: true, runs: [
    { record: { operationId: 'owned', runId: 'run', captureKind: 'coordinator' } },
    { record: { operationId: 'foreign', runId: 'other', captureKind: 'coordinator' } },
  ] }), page: (_mission: string, request: { stream: string; after: number }) => {
    after.push(request.after);
    return { ok: true, text: request.stream === 'stdout' && request.after === 0 ? 'gate failed: detail\n' : '', to: 20, atEnd: true, running: false };
  } } as unknown as MissionTerminalCapability;
  const observe = workflowCliObserver(terminal, event => phases.push(event.phase), line => text.push(line), false, undefined,
    { now: () => now, activeMs: 1000, idleMs: 5000 });
  const operation = { id: 'owned', missionId: 'task-test', phase: 'executing', reason: 'checking gate' } as WorkflowOperation;
  await observe(operation); now = 1000; await observe(operation);
  assert.deepEqual(text, ['gate failed: detail\n']);
  assert.deepEqual(phases, ['executing']);
  assert.deepEqual(after, [0, 0, 20, 20]);
});

test('CLI observation reconciles at active and idle cadence with cursors, immediate changes and failure backoff (PX-0058.02)', async () => {
  let now = 0;
  let histories = 0;
  let state: 'running' | 'exited' = 'running';
  let failHistory = false;
  const after: number[] = [];
  const progress: string[] = [];
  const terminal = {
    history: () => {
      histories += 1;
      if (failHistory) { return { ok: false, error: 'missing', detail: 'temporarily unavailable' }; }
      return { ok: true, unattributed: [], runs: [{ state, record: { operationId: 'owned', runId: 'worker', captureKind: 'coordinator', supervisorPid: process.pid + 1 } }] };
    },
    page: (_mission: string, request: { stream: string; after: number }) => {
      after.push(request.after);
      const to = request.stream === 'stdout' ? 7 : 0;
      return { ok: true, text: request.after === 0 && to > 0 ? 'output\n' : '', from: request.after, to, atEnd: true, running: state === 'running' };
    },
  } as unknown as MissionTerminalCapability;
  const timing = { now: () => now, activeMs: 1000, idleMs: 5000 };
  const observe = workflowCliObserver(terminal, event => progress.push(event.message), () => {}, false, undefined, timing);
  const active = { id: 'owned', missionId: 'task-test', phase: 'executing', reason: 'working', updatedAt: 'one' } as WorkflowOperation;

  await observe(active);
  now = 999; await observe(active);
  assert.deepEqual({ histories, after }, { histories: 1, after: [0, 0] }, 'unchanged active ticks reuse attribution and stream cursors');
  now = 1000; await observe(active);
  assert.deepEqual({ histories, after }, { histories: 2, after: [0, 0, 7, 0] });

  state = 'exited';
  const completed = { ...active, phase: 'completed', reason: 'done', updatedAt: 'two' } as WorkflowOperation;
  await observe(completed);
  assert.deepEqual(progress, ['working', 'done'], 'a relevant operation change is reported immediately');
  now = 5999; await observe(completed);
  assert.equal(histories, 3, 'idle reconciliation waits the full five seconds');
  now = 6000; await observe(completed);
  assert.equal(histories, 4);

  let failures = 0;
  failHistory = true;
  const failing = workflowCliObserver({ ...terminal, history: () => { failures += 1; return { ok: false, error: 'missing', detail: 'offline' }; } } as unknown as MissionTerminalCapability,
    undefined, () => {}, false, undefined, timing);
  now = 10_000; await failing(active);
  now = 10_999; await failing(active);
  now = 11_000; await failing(active);
  now = 12_999; await failing(active);
  now = 13_000; await failing(active);
  now = 16_999; await failing(active);
  now = 17_000; await failing(active);
  assert.equal(failures, 4, 'failed discovery backs off at 1s, 2s and 4s without a retry loop');
});

test('CLI replay reports retention gaps and expiry in order, including after a restart (TASK-2816)', async () => {
  // Bytes 0-100 of the stored stream were dropped by the retention cap.
  let stage: 'retained' | 'unreadable' | 'expired' = 'retained';
  const terminal = { history: () => ({ ok: true, runs: stage === 'expired' ? [] : [{ record: { operationId: 'owned', runId: 'worker', captureKind: 'coordinator' } }] }),
    page: (_mission: string, request: { stream: string; after: number }) => {
      if (stage === 'unreadable') { return { ok: false, error: 'missing', detail: 'gone' }; }
      if (request.stream === 'stderr') { return { ok: true, text: '', from: 0, to: 0, atEnd: true, running: true }; }
      return request.after < 100 ? { ok: true, text: 'retained tail\n', from: 100, to: 114, atEnd: true, running: true }
        : { ok: true, text: '', from: 114, to: 114, atEnd: true, running: true };
    } } as unknown as MissionTerminalCapability;
  const operation = { id: 'owned', missionId: 'task-test', phase: 'executing' } as WorkflowOperation;
  const output: string[] = [];
  let now = 0;
  const timing = { now: () => now, activeMs: 1000, idleMs: 5000 };
  const observe = workflowCliObserver(terminal, undefined, text => output.push(text), true, undefined, timing);
  await observe(operation); now += 1000; await observe(operation);
  assert.deepEqual(output, ['\n[worker:stdout: bytes 0-100 were not retained]\n', 'retained tail\n'], 'the loss is reported once, before the retained bytes');
  const restarted: string[] = [];
  await workflowCliObserver(terminal, undefined, text => restarted.push(text), true, undefined, timing)(operation);
  assert.deepEqual(restarted, output, 'a restarted observer reports the same loss in the same order');
  stage = 'unreadable';
  now += 1000; await observe(operation); now += 1000; await observe(operation);
  stage = 'expired';
  now += 1000; await observe(operation); now += 1000; await observe(operation);
  assert.deepEqual(output.slice(2), [
    '\n[worker:stdout: output from byte 114 is no longer retained (missing)]\n',
    '\n[worker:stderr: output from byte 0 is no longer retained (missing)]\n',
    "\n[worker:stdout: the operation's retained output has expired]\n",
    "\n[worker:stderr: the operation's retained output has expired]\n",
  ]);
});

test('CLI observation excludes its own capture to prevent output feedback and unsettled completion (TASK-2750)', async () => {
  let captured = '';
  const pages: string[] = [];
  const terminal = { history: () => ({ ok: true, runs: [
    { record: { operationId: 'owned', runId: 'observer', captureKind: 'coordinator', supervisorPid: process.pid } },
    { record: { operationId: 'owned', runId: 'worker', captureKind: 'coordinator', supervisorPid: process.pid + 1 } },
  ] }), page: (_mission: string, request: { runId: string; stream: string; after: number }) => {
    pages.push(request.runId);
    const own = request.runId === 'observer';
    const bytes = request.stream === 'stdout' ? own ? captured : 'worker diagnostic\n' : '';
    return { ok: true, text: bytes.slice(request.after), to: bytes.length, atEnd: true, running: own };
  } } as unknown as MissionTerminalCapability;
  let now = 0;
  const observe = workflowCliObserver(terminal, undefined, text => { captured += text; }, false, undefined,
    { now: () => now, activeMs: 1000, idleMs: 5000 });
  const operation = { id: 'owned', missionId: 'task-test', phase: 'completed', updatedAt: 'now' } as WorkflowOperation;
  assert.equal(await observe(operation), true);
  now = 5000;
  assert.equal(await observe(operation), true);
  assert.equal(captured, 'worker diagnostic\n');
  assert.deepEqual(pages, ['worker', 'worker', 'worker', 'worker']);
});


test('CLI replays progress controls incrementally without operation chatter (TASK-2771)', async () => {
  const frames = '\r⠋ checking\r⠙ checking\r\x1b[2KPASS gate\n';
  let output = '';
  const terminal = { history: () => ({ ok: true, runs: [
    { record: { operationId: 'owned', runId: 'worker', captureKind: 'coordinator' } },
  ] }), page: (_mission: string, request: { stream: string; after: number; presentation?: string }) => {
    const bytes = request.stream === 'stdout' ? frames : '';
    return { ok: true, text: request.presentation === 'terminal' ? bytes.slice(request.after) : bytes.slice(request.after).replace(/[\r\x1b]/g, ''),
      to: bytes.length, atEnd: true, running: false };
  } } as unknown as MissionTerminalCapability;
  const observe = workflowCliObserver(terminal, undefined, text => { output += text; }, true);
  const operation = { id: 'owned', missionId: 'task-test', phase: 'executing', reason: 'internal preparation' } as WorkflowOperation;
  await observe(operation); await observe(operation);
  assert.equal(output, frames);
});


test('redirected CLI output retains final progress lines without spinner debris (TASK-2771)', async () => {
  let text = '\r⠋ checking'; let output = '';
  let running = true;
  const terminal = { history: () => ({ ok: true, runs: [{ record: { operationId: 'owned', runId: 'worker', captureKind: 'coordinator' } }] }),
    page: (_mission: string, request: { after: number; stream: string }) => ({ ok: true, text: request.stream === 'stdout' ? text.slice(request.after) : '',
      to: request.stream === 'stdout' ? text.length : 0, atEnd: true, running }) } as unknown as MissionTerminalCapability;
  let now = 0;
  const observe = workflowCliObserver(terminal, undefined, chunk => { output += chunk; }, false, undefined,
    { now: () => now, activeMs: 1000, idleMs: 5000 });
  const operation = { id: 'owned', missionId: 'task-test', phase: 'executing' } as WorkflowOperation;
  await observe(operation);
  text += '\r⠙ checking\r\x1b[2KPASS gate\nordered message\n';
  now += 1000; await observe(operation); running = false; now += 1000; await observe(operation); now += 1000; await observe(operation);
  assert.equal(output, 'PASS gate\nordered message\n');
});


test('foreground repeated interrupts share cancellation and remain handled through close (TASK-2771)', async () => {
  const before = process.listenerCount('SIGINT');
  let requested = false;
  const registry = { draft: async () => {} } as Record<string, Command>;
  const graph = { mission: { store: { load: async () => ({ kind: 'found', mission: { status: 'backlog' } }) } },
    presentationCapabilities: { commandController: { dispatch: async (request: BoardCommandRequest) => {
      process.emit('SIGINT'); process.emit('SIGINT');
      requested = Boolean(request.cancellation?.requested && request.cancellation.stopOwnedWorkflow);
      return failure('cancelled', 'Workflow interrupted');
    } } }, operatorState: { close: async () => { process.emit('SIGINT'); assert.equal(process.listenerCount('SIGINT'), before + 1); } } } as unknown as ProductionApplicationServices;
  ownWorkflowCli(registry, async () => graph);
  await assert.rejects(async () => registry.draft(['task-test']), /interrupted/);
  assert.equal(requested, true);
  assert.equal(process.listenerCount('SIGINT'), before);
});

test('production failure decoration retains durable workflow surface and bindings (PX-0058.01)', async () => {
  const { workflowFailureController } = await import('../../../src/composition/workflow-cli.js');
  const binding = Symbol('production dispatcher');
  const operation = { id: 'owned', missionId: 'task-test', command: 'active:execute', phase: 'accepted' } as WorkflowOperation;
  const calls: string[] = [];
  const production: BoardCommandDispatcher & { binding: symbol } = {
    binding,
    canExecute() { assert.equal(this.binding, binding); return true; },
    async admit(request) { assert.equal(this.binding, binding); calls.push(`admit:${request.operationId}`); return { status: 'accepted', operation }; },
    async operation(id) { assert.equal(this.binding, binding); calls.push(`operation:${id}`); return operation; },
    async current(mission) { assert.equal(this.binding, binding); calls.push(`current:${mission}`); return operation; },
    async dispatch<T>() { assert.equal(this.binding, binding); return completed(operation) as import('../../../src/application/contracts.js').ApplicationOutcome<T>; },
  };
  const controller = workflowFailureController(production, id => production.operation!(id));
  const request = { kind: 'active:execute', operationId: 'owned', missionId: 'task-test', capabilities: new Set(['active:execute']) } as BoardCommandRequest;

  assert.equal(controller.canExecute(request.kind), true);
  assert.equal(typeof controller.admit, 'function');
  assert.equal(typeof controller.operation, 'function');
  assert.equal(typeof controller.current, 'function');
  assert.equal((await controller.admit!(request)).status, 'accepted');
  assert.equal(await controller.operation!('owned'), operation);
  assert.equal(await controller.current!('task-test'), operation);
  assert.deepEqual(calls, ['admit:owned', 'operation:owned', 'current:task-test']);
});

test('owned CLI failure footer follows verbose trailing output and preserves outcome metadata (TASK-2772)', async () => {
  const { workflowFailureController } = await import('../../../src/composition/workflow-cli.js');
  for (const kind of ['draft:create', 'review:submit', 'rebase:run', 'integrate:merge', 'active:execute', 'workflow:stop'] as const) {
    const output: string[] = [];
    const original = failure('execution', 'Workflow exited with status 7', [{ id: 'evidence', source: 'mission-store', detail: 'kept' }]);
    const controller = workflowFailureController({ canExecute: () => true, dispatch: async <T>() => {
      output.push('early diagnostic', ...Array.from({ length: 200 }, (_, i) => `trailing report ${i}`));
      return original as import('../../../src/application/contracts.js').ApplicationOutcome<T>;
    } }, async () => null);
    const result = await controller.dispatch({ kind, operationId: 'owned', missionId: 'task-test', capabilities: new Set([kind]) });
    output.push(result.error!.message);
    assert.equal(result.status, original.status);
    assert.equal(result.error?.kind, original.error?.kind);
    assert.deepEqual(result.durableEvidence, original.durableEvidence);
    assert.ok(output.join('\n').indexOf('Workflow failure summary') > output.join('\n').indexOf('trailing report 199'));
    assert.match(result.error!.message, new RegExp(kind));
    assert.match(result.error!.message, /Workflow exited with status 7/);
  }
});

test('workflow footer projects coordinator exit, retained ranges, gate failure and only correlated recovery (TASK-2772)', async () => {
  const { workflowFailureEvidence } = await import('../../../src/composition/workflow-failure-evidence.js');
  const operation = { id: 'owned', missionId: 'task-test', createdAt: '2026-01-01', updatedAt: '2026-01-03' } as import('../../../src/application/ports/workflow-operation.js').WorkflowOperationRecord;
  const run = { operationId: 'owned', captureKind: 'coordinator', runId: 'workflow-example', startedAt: '2026-01-01', exitCode: 7, signal: null,
    streams: { stdout: { bytes: 100000, retainedBytes: 20000, omitted: [{ from: 10000, to: 90000 }] }, stderr: { bytes: 0, retainedBytes: 0, omitted: [] } }, omissions: ['middle output omitted'] } as unknown as import('../../../src/application/run-history-types.js').RunRecord;
  const gate = { capturedAt: '2026-01-02', command: 'custom verifier', exitCode: 23, signal: null } as import('../../../src/application/recovery-evidence-types.js').RecoveryEvidenceRef;
  const outcome = { operationId: 'owned', missionId: 'task-test', outcome: 'exhausted', attempts: 2, diagnostic: 'recorded gate diagnostic' } as const;
  const facts = workflowFailureEvidence(operation, [run], [gate], [outcome]);
  assert.equal(facts.exitCode, 7);
  assert.deepEqual(facts.output, [{ runId: 'workflow-example', stream: 'stdout', offset: 90000, length: 10000 }]);
  assert.ok(facts.diagnostics?.includes('Gate: custom verifier; exit 23'));
  assert.deepEqual(facts.recovery, { outcome: 'exhausted', attempts: 2 });
  assert.equal(workflowFailureEvidence(operation, [run], [], [{ ...outcome, operationId: 'other' }]).recovery, undefined);
  assert.deepEqual(workflowFailureEvidence(operation, [], [{ ...gate, capturedAt: '2025' }], []).diagnostics, []);
  assert.equal(workflowFailureEvidence(operation, [{ ...run, exitCode: null, signal: 'SIGTERM' }], [], []).signal, 'SIGTERM');
});

test('retained diagnostics survive long trailing replay before command, signal and exhaustion footers (TASK-2772)', async () => {
  const { workflowFailureController } = await import('../../../src/composition/workflow-cli.js');
  const { workflowFailureEvidence } = await import('../../../src/composition/workflow-failure-evidence.js');
  for (const scenario of ['command', 'signal', 'exhaustion'] as const) {
    let output = '';
    let running = true;
    const transcript = 'early verifier diagnostic\n' + Array.from({ length: 500 }, (_, i) => `coverage row ${i}\n`).join('');
    const record = { operationId: 'owned', runId: 'workflow-example', captureKind: 'coordinator', startedAt: '2026-01-01',
      exitCode: scenario === 'signal' ? null : 1, signal: scenario === 'signal' ? 'SIGTERM' : null,
      streams: { stdout: { bytes: transcript.length, retainedBytes: transcript.length, omitted: [] }, stderr: { bytes: 0, retainedBytes: 0, omitted: [] } }, omissions: [] } as unknown as import('../../../src/application/run-history-types.js').RunRecord;
    const operation = { id: 'owned', missionId: 'task-test', command: 'review:submit', phase: 'blocked', createdAt: '2026-01-01', updatedAt: '2026-01-03' } as import('../../../src/application/ports/workflow-operation.js').WorkflowOperationRecord;
    const terminal = { history: () => ({ ok: true, runs: [{ record }] }), page: (_mission: string, request: { stream: string; after: number }) => {
      const bytes = request.stream === 'stdout' ? transcript : '';
      const to = running ? Math.min(bytes.length, 600) : bytes.length;
      return { ok: true, text: bytes.slice(request.after, to), to, atEnd: to === bytes.length, running };
    } } as unknown as MissionTerminalCapability;
    let now = 0;
    const observe = workflowCliObserver(terminal, undefined, text => { output += text; }, false, undefined,
      { now: () => now, activeMs: 1000, idleMs: 5000 });
    const controller = workflowFailureController({ canExecute: () => true, async dispatch<T>() {
      assert.equal(await observe(operation), false);
      running = false; now = 1000;
      assert.equal(await observe(operation), true);
      return failure<T>('execution', 'Workflow exited with status 1');
    } }, async () => operation, async op => workflowFailureEvidence(op, [record], [], scenario === 'exhaustion'
      ? [{ operationId: 'owned', missionId: 'task-test', outcome: 'exhausted', attempts: 2, diagnostic: 'early verifier diagnostic' }] : []));
    const result = await controller.dispatch({ kind: 'review:submit', operationId: 'owned', missionId: 'task-test', capabilities: new Set(['review:submit']) });
    output += result.error!.message;
    assert.ok(output.indexOf('coverage row 499') < output.indexOf('Workflow failure summary'));
    assert.match(result.error!.message, /review:submit \/ blocked/);
    assert.match(result.error!.message, scenario === 'signal' ? /signal SIGTERM/ : /exit 1/);
    assert.match(result.error!.message, /px history task-test show run:workflow-example:stdout@\d+\+\d+/);
    if (scenario === 'exhaustion') {
      assert.match(result.error!.message, /Diagnostic: early verifier diagnostic/);
      assert.match(result.error!.message, /budget exhausted \(2 attempts\)/);
    } else { assert.doesNotMatch(result.error!.message, /budget exhausted/); }
  }
});

test('workflow footer rejects malformed telemetry and preserves human-only intervention (TASK-2772)', async () => {
  const { retainedRecoveryOutcome, workflowFailureEvidence } = await import('../../../src/composition/workflow-failure-evidence.js');
  for (const data of ['invalid', 'null', '{}', JSON.stringify({ repositoryId: 'repo', operationId: 'op', missionId: 'task-test', outcome: 'exhausted', attempts: -1, diagnostic: 'invalid' })]) {
    assert.deepEqual(retainedRecoveryOutcome(data, 'repo'), []);
  }
  const event = { repositoryId: 'repo', operationId: 'op', missionId: 'task-test', outcome: 'human-only', attempts: 0, diagnostic: 'operator contract decision required' };
  assert.deepEqual(retainedRecoveryOutcome(JSON.stringify(event), 'foreign'), []);
  const facts = workflowFailureEvidence({ id: 'op', missionId: 'task-test' } as import('../../../src/application/ports/workflow-operation.js').WorkflowOperationRecord,
    [], [], retainedRecoveryOutcome(JSON.stringify(event), 'repo'));
  assert.equal(facts.recovery, undefined);
  assert.match(facts.next!, /human-only blocker/);
});

test('invalid integrate flags fail before workflow admission opens state (TASK-2762)', async () => {
  let opened = false;
  const registry: Record<string, Command> = { draft: async () => {}, integrate: async () => {}, review: async () => {} };
  ownWorkflowCli(registry, async () => { opened = true; throw new Error('must not open state'); });
  await assert.rejects(async () => registry.integrate(['task-does-not-exist', '--invalid-option']),
    /Unknown integrate option: --invalid-option/);
  assert.equal(opened, false);
});

test('landed closeout bypasses ordinary integration admission (TASK-2833)', async () => {
  const calls: string[][] = [];
  let opened = 0;
  const registry = {
    draft: async () => {},
    review: async () => {},
    integrate: async (args: string[]) => { calls.push(args); },
  } as Record<string, Command>;
  ownWorkflowCli(registry, async () => {
    opened++;
    throw new Error('landed closeout must not enter integrate:merge admission');
  });

  await registry.integrate(['task-landed', '--recover-landed']);

  assert.deepEqual(calls, [['task-landed', '--recover-landed']]);
  assert.equal(opened, 0);
});


test('removed review switches fail before workflow admission or effects (TASK-2810)', async () => {
  const registry = { review: async () => assert.fail('invalid flags must not run review') } as Record<string, Command>;
  ownWorkflowCli(registry, async () => assert.fail('invalid flags must not open the workflow graph'));
  for (const flag of ['--start', '--continue', '--resume', '--create-event', '--import-legacy']) {
    await assert.rejects(async () => registry.review(['task-test', flag]), /Unknown flag for px review/);
  }
});


import { IntegrateCommandUseCase } from '../../../src/application/integrate-command-use-case.js';
import { createIntegrateCommand } from '../../../src/interfaces/cli/integrate.js';
import { configureMissionWriteAuthorization } from '../../../src/application/ports/mission-write-authorization.js';

for (const args of [['task-test'], []]) {
  test(`inherited public integration wrapper refuses effects${args.length ? '' : ' before inferring a mission'} (TASK-2822)`, async () => {
    let integrationCalls = 0; let inferred = 0; let opened = 0;
    const activity: string[] = [];
    const useCase = new IntegrateCommandUseCase({ execute: async () => { integrationCalls++; } },
      { running: async () => { activity.push('running'); }, blocked: async () => { activity.push('blocked'); }, ended: async () => { activity.push('ended'); } },
      () => { inferred++; return 'task-test'; });
    const registry: Record<string, Command> = { draft: async () => {}, review: async () => {}, integrate: createIntegrateCommand(useCase) };
    ownWorkflowCli(registry, async () => { opened++; throw new Error('inherited wrapper bypasses admission'); });
    configureMissionWriteAuthorization({ operationId: 'parent', inherited: true, assert: async () => {} });
    try {
      await assert.rejects(async () => registry.integrate(args), /parent workflow|inherited agent/i);
      assert.equal(integrationCalls, 0); assert.equal(inferred, 0); assert.equal(opened, 0);
      assert.deepEqual(activity, [], 'child refusal cannot alter parent activity');
    } finally { configureMissionWriteAuthorization(null); }
  });
}

test('public integration wrapper continues its admitted owner without readmission (TASK-2822)', async () => {
  let integrations = 0; let opened = 0;
  const registry: Record<string, Command> = { draft: async () => {}, review: async () => {},
    integrate: createIntegrateCommand(new IntegrateCommandUseCase({ execute: async () => { integrations++; } })) };
  ownWorkflowCli(registry, async () => { opened++; throw new Error('already admitted owner must not reacquire'); });
  configureMissionWriteAuthorization({ operationId: 'owned', inherited: false, assert: async () => {} });
  try { await registry.integrate(['task-test']); assert.equal(integrations, 1); assert.equal(opened, 0); }
  finally { configureMissionWriteAuthorization(null); }
});
