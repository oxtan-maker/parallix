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
import type { BoardCommandRequest } from '../../../src/application/controller/board-command.js';

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
  await registry.review(['task-test', '--continue', '--reviewer', 'codex']);
  assert.deepEqual(requests[0].invocation, { command: 'review', args: ['task-test', '--continue', '--reviewer', 'codex'], interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY) });
  await assert.rejects(async () => registry.stop(['task-test']), /Stop is pending/);
  assert.equal(closed, 2);
  pending = false;
  await registry.stop(['task-test']);
  assert.deepEqual(messages, ['Stop task-test: owned-work shutdown confirmed; mission and history retained.']);
  assert.equal(closed, 3);
});

test('CLI streams only its coordinator bytes incrementally and renders phase changes (TASK-2750 F4)', () => {
  const text: string[] = []; const phases: string[] = []; const after: number[] = [];
  const terminal = { history: () => ({ ok: true, runs: [
    { record: { operationId: 'owned', runId: 'run', captureKind: 'coordinator' } },
    { record: { operationId: 'foreign', runId: 'other', captureKind: 'coordinator' } },
  ] }), page: (_mission: string, request: { stream: string; after: number }) => {
    after.push(request.after);
    return { ok: true, text: request.stream === 'stdout' && request.after === 0 ? 'gate failed: detail\n' : '', to: 20, atEnd: true, running: false };
  } } as unknown as MissionTerminalCapability;
  const observe = workflowCliObserver(terminal, event => phases.push(event.phase), line => text.push(line));
  const operation = { id: 'owned', missionId: 'task-test', phase: 'checking', reason: 'checking gate' } as WorkflowOperation;
  observe(operation); observe(operation);
  assert.deepEqual(text, ['gate failed: detail\n']);
  assert.deepEqual(phases, ['checking']);
  assert.deepEqual(after, [0, 0, 20, 20]);
});

test('CLI observation excludes its own capture to prevent output feedback and unsettled completion (TASK-2750)', () => {
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
  const observe = workflowCliObserver(terminal, undefined, text => { captured += text; });
  const operation = { id: 'owned', missionId: 'task-test', phase: 'completed', updatedAt: 'now' } as WorkflowOperation;
  assert.equal(observe(operation), true);
  assert.equal(observe(operation), true);
  assert.equal(captured, 'worker diagnostic\n');
  assert.deepEqual(pages, ['worker', 'worker', 'worker', 'worker']);
});


test('CLI replays progress controls incrementally without operation chatter (TASK-2771)', () => {
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
  const operation = { id: 'owned', missionId: 'task-test', phase: 'checking', reason: 'internal preparation' } as WorkflowOperation;
  observe(operation); observe(operation);
  assert.equal(output, frames);
});


test('redirected CLI output retains final progress lines without spinner debris (TASK-2771)', () => {
  let text = '\r⠋ checking'; let output = '';
  let running = true;
  const terminal = { history: () => ({ ok: true, runs: [{ record: { operationId: 'owned', runId: 'worker', captureKind: 'coordinator' } }] }),
    page: (_mission: string, request: { after: number; stream: string }) => ({ ok: true, text: request.stream === 'stdout' ? text.slice(request.after) : '',
      to: request.stream === 'stdout' ? text.length : 0, atEnd: true, running }) } as unknown as MissionTerminalCapability;
  const observe = workflowCliObserver(terminal, undefined, chunk => { output += chunk; }, false);
  const operation = { id: 'owned', missionId: 'task-test', phase: 'checking' } as WorkflowOperation;
  observe(operation);
  text += '\r⠙ checking\r\x1b[2KPASS gate\nordered message\n';
  observe(operation); running = false; observe(operation); observe(operation);
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

test('owned CLI failure footer follows verbose trailing output and preserves outcome metadata (TASK-2772)', async () => {
  const { workflowFailureController } = await import('../../../src/composition/workflow-cli.js');
  for (const kind of ['draft:create', 'review:submit', 'integrate:merge', 'active:execute', 'workflow:stop'] as const) {
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
    const observe = workflowCliObserver(terminal, undefined, text => { output += text; }, false);
    const controller = workflowFailureController({ canExecute: () => true, async dispatch<T>() {
      assert.equal(observe(operation), false);
      running = false;
      assert.equal(observe(operation), true);
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
