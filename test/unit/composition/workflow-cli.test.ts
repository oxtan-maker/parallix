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

test('CLI preserves review flags and reports stop diagnostics while closing its graph (TASK-2750 F4)', async () => {
  const requests: BoardCommandRequest[] = [];
  let closed = 0;
  const registry: Record<string, Command> = { draft: async () => {}, integrate: async () => {}, review: async () => {} };
  const graph = { mission: { store: { load: async () => ({ kind: 'found', mission: { status: 'review' } }) } },
    presentationCapabilities: { commandController: { dispatch: async (request: BoardCommandRequest) => {
      requests.push(request); return request.kind === 'workflow:stop' ? failure('conflict', 'Stop is pending') : completed({});
    } } }, operatorState: { close: async () => { closed++; } } } as unknown as ProductionApplicationServices;
  ownWorkflowCli(registry, async () => graph);
  await registry.review(['task-test', '--continue', '--reviewer', 'codex']);
  assert.deepEqual(requests[0].invocation, { command: 'review', args: ['task-test', '--continue', '--reviewer', 'codex'], interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY) });
  await assert.rejects(async () => registry.stop(['task-test']), /Stop is pending/);
  assert.equal(closed, 2);
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
