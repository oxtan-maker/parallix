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
  assert.deepEqual(requests[0].invocation, { command: 'review', args: ['task-test', '--continue', '--reviewer', 'codex'] });
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
  assert.deepEqual(text, ['[owned] checking gate\n', 'gate failed: detail\n']);
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
  assert.equal(captured, '[owned] completed\nworker diagnostic\n');
  assert.deepEqual(pages, ['worker', 'worker', 'worker', 'worker']);
});
