import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const _require = createRequire(import.meta.url);

import { BoardCommandController } from '../src/application/controller/board-controller.js';
import { makeExecutePorts } from './fixtures/execute-mission-ports.js';
import type { BoardCommandRequest } from '../src/application/controller/board-command.js';
import {
  INTEGRATED_CAPABILITIES,
  UNAVAILABLE_CAPABILITIES,
  isIntegratedCapability,
  unavailableReason,
} from '../src/application/controller/board-command.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(overrides: Partial<BoardCommandRequest> = {}): BoardCommandRequest {
  return {
    operationId: 'op-1',
    kind: 'active:execute',
    missionId: 'task-0001',
    missionStatusAtRequest: 'refined',
    agent: 'codex',
    capabilities: new Set(['active:execute']),
    cancellation: { requested: false },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// SC4: Guarded command controller exposes active:execute, rejects others
// ---------------------------------------------------------------------------

test('controller dispatches active:execute through ExecuteMissionService', async () => {
  const { ports, calls } = makeExecutePorts();
  const controller = new BoardCommandController(ports);
  const result = await controller.dispatch(makeRequest());
  assert.equal(result.status, 'completed');
  assert.deepEqual(calls, ['validate:task-0001', 'launch:task-0001:codex', 'record:task-0001:codex', 'handoff:task-0001:codex']);
});

test('controller honors attached CLI launches while defaulting board launches to detached', async () => {
  const launchRequests: Array<{ detached?: boolean }> = [];
  const { ports } = makeExecutePorts({
    agentExecution: {
      async prepare() { return { prompt: 'execute prompt', agentConfig: {} }; },
      async launch(request: { detached?: boolean }) {
        launchRequests.push(request);
        return { agent: 'codex', rebaseDeferred: false, errored: false, errorMessage: null, exitStatus: 0, detail: null };
      },
    },
  });
  const controller = new BoardCommandController(ports);

  await controller.dispatch(makeRequest({ detached: false }));
  await controller.dispatch(makeRequest());

  assert.deepEqual(launchRequests.map(request => request.detached), [false, true]);
});

test('controller rejects draft:create with capability kind', async () => {
  const { ports } = makeExecutePorts();
  const controller = new BoardCommandController(ports);
  const result = await controller.dispatch(makeRequest({ kind: 'draft:create' }));
  assert.equal(result.status, 'rejected');
  assert.equal(result.error.kind, 'capability');
  assert.ok(result.error.message.includes('draft:create'));
});

// checkpoint:record became an integrated capability in TASK-2322.05. A host
// without a Mission authority still gets a typed rejection rather than a
// filesystem or SQL path, and a payload-less request is a validation rejection.
test('controller rejects checkpoint:record without a payload', async () => {
  const { ports } = makeExecutePorts();
  const controller = new BoardCommandController(ports);
  const result = await controller.dispatch(makeRequest({ kind: 'checkpoint:record' }));
  assert.equal(result.status, 'rejected');
  assert.equal(result.error.kind, 'validation');
});

test('controller rejects review:submit with capability kind', async () => {
  const { ports } = makeExecutePorts();
  const controller = new BoardCommandController(ports);
  const result = await controller.dispatch(makeRequest({ kind: 'review:submit' }));
  assert.equal(result.status, 'rejected');
  assert.equal(result.error.kind, 'capability');
});

test('controller rejects review:act-on-findings with capability kind', async () => {
  const { ports } = makeExecutePorts();
  const controller = new BoardCommandController(ports);
  const result = await controller.dispatch(makeRequest({ kind: 'review:act-on-findings' }));
  assert.equal(result.status, 'rejected');
  assert.equal(result.error.kind, 'capability');
});

test('controller rejects approve:review with capability kind', async () => {
  const { ports } = makeExecutePorts();
  const controller = new BoardCommandController(ports);
  const result = await controller.dispatch(makeRequest({ kind: 'approve:review' }));
  assert.equal(result.status, 'rejected');
  assert.equal(result.error.kind, 'capability');
});

test('controller rejects integrate:merge with capability kind', async () => {
  const { ports } = makeExecutePorts();
  const controller = new BoardCommandController(ports);
  const result = await controller.dispatch(makeRequest({ kind: 'integrate:merge' }));
  assert.equal(result.status, 'rejected');
  assert.equal(result.error.kind, 'capability');
});

// ---------------------------------------------------------------------------
// SC6: Progress events with stable operationId, cancellation
// ---------------------------------------------------------------------------

test('progress events carry stable operationId', async () => {
  const { ports } = makeExecutePorts();
  const events: unknown[] = [];
  const controller = new BoardCommandController(ports, (event) => events.push(event));
  await controller.dispatch(makeRequest({ operationId: 'stable-op-id' }));
  assert.ok(events.length > 0);
  for (const event of events as Array<{ operationId: string }>) {
    assert.equal(event.operationId, 'stable-op-id');
  }
});

test('progress events have monotonically increasing sequence numbers', async () => {
  const { ports } = makeExecutePorts();
  const events: unknown[] = [];
  const controller = new BoardCommandController(ports, (event) => events.push(event));
  await controller.dispatch(makeRequest());
  const sequences = (events as Array<{ sequence: number }>).map((e) => e.sequence);
  for (let i = 1; i < sequences.length; i++) {
    assert.ok(sequences[i] > sequences[i - 1], `sequence ${i} not increasing: ${sequences}`);
  }
});

test('cancellation before launch returns cancelled outcome', async () => {
  const { ports, calls } = makeExecutePorts();
  const controller = new BoardCommandController(ports);
  const result = await controller.dispatch(makeRequest({
    cancellation: { requested: true },
  }));
  assert.equal(result.status, 'cancelled');
  assert.equal(result.error.kind, 'cancelled');
  assert.deepEqual(calls, []);
});

test('controller passes cancellation to ExecuteMissionService for post-boundary cancellation', async () => {
  const cancellation = { requested: false };
  const { ports } = makeExecutePorts({
    telemetry: {
      async recordLaunchTelemetry() { cancellation.requested = true; },
    },
  });
  const controller = new BoardCommandController(ports);
  const result = await controller.dispatch(makeRequest({
    cancellation,
  }));
  assert.equal(result.status, 'cancelled');
  assert.equal(result.error.kind, 'cancelled');
  assert.ok(result.durableEvidence.length >= 2);
});

// ---------------------------------------------------------------------------
// SC7: Stale command rejection
// ---------------------------------------------------------------------------

test('authoritative status rejects stale command with conflict kind', async () => {
  const { ports } = makeExecutePorts();
  const controller = new BoardCommandController(ports, undefined, {}, undefined, {
    async load() { return { kind: 'found', mission: { status: 'active' }, version: 1 } as never; },
  });
  const result = await controller.dispatch(makeRequest({ missionStatusAtRequest: 'refined' }));
  assert.equal(result.status, 'failed');
  assert.equal(result.error.kind, 'conflict');
  assert.ok(result.error.message.includes('refined'));
  assert.ok(result.error.message.includes('active'));
});

test('authoritative matching status proceeds to dispatch once', async () => {
  const { ports, calls } = makeExecutePorts();
  const controller = new BoardCommandController(ports);
  const result = await controller.dispatch(makeRequest({ missionStatusAtRequest: 'refined' }));
  assert.equal(result.status, 'completed');
  assert.equal(calls.length, 4);
});

test('authoritative read failure fails closed before the effect is called', async () => {
  const { ports, calls } = makeExecutePorts();
  const controller = new BoardCommandController(ports, undefined, {}, undefined, {
    async load() { throw new Error('store offline'); },
  });

  const result = await controller.dispatch(makeRequest());

  assert.equal(result.status, 'failed');
  assert.equal(result.error?.kind, 'unavailable');
  assert.equal(calls.length, 0);
});

// ---------------------------------------------------------------------------
// Capability registry
// ---------------------------------------------------------------------------

test('isIntegratedCapability covers the Mission commands extracted so far', () => {
  assert.equal(isIntegratedCapability('active:execute'), true);
  assert.equal(isIntegratedCapability('mission:intake'), true);
  assert.equal(isIntegratedCapability('checkpoint:record'), true);
  assert.equal(isIntegratedCapability('handoff:record'), true);
  assert.equal(isIntegratedCapability('draft:create'), false);
  assert.equal(isIntegratedCapability('review:submit'), false);
  assert.equal(isIntegratedCapability('review:act-on-findings'), false);
  assert.equal(isIntegratedCapability('approve:review'), false);
  assert.equal(isIntegratedCapability('integrate:merge'), false);
});

test('INTEGRATED_CAPABILITIES contains active:execute and the Mission commands', () => {
  assert.equal(INTEGRATED_CAPABILITIES.size, 4);
  for (const kind of ['active:execute', 'mission:intake', 'checkpoint:record', 'handoff:record'] as const) {
    assert.ok(INTEGRATED_CAPABILITIES.has(kind), `${kind} should be integrated`);
  }
});

test('UNAVAILABLE_CAPABILITIES has reasons for all five unextracted commands', () => {
  assert.equal(UNAVAILABLE_CAPABILITIES.size, 5);
  for (const kind of ['draft:create', 'review:submit', 'review:act-on-findings', 'approve:review', 'integrate:merge'] as const) {
    const reason = unavailableReason(kind);
    assert.ok(reason, `Missing reason for ${kind}`);
    assert.ok(reason.length > 0);
  }
});

// ---------------------------------------------------------------------------
// SC5: No UI module imports
// ---------------------------------------------------------------------------

test('controller does not import ink, react, or node:react', () => {
  const fs = _require('node:fs');
  const path = _require('node:path');
  const controllerPath = path.join(process.cwd(), 'src', 'application', 'controller', 'board-controller.ts');
  const commandPath = path.join(process.cwd(), 'src', 'application', 'controller', 'board-command.ts');
  const boardPath = path.join(process.cwd(), 'src', 'application', 'projections', 'board.ts');

  for (const filePath of [controllerPath, commandPath, boardPath]) {
    const source = fs.readFileSync(filePath, 'utf8');
    for (const forbidden of ['ink', 'react', 'node:react']) {
      assert.ok(
        !source.includes(`from '${forbidden}'`) && !source.includes(`import '${forbidden}'`) && !source.includes(`from "${forbidden}"`),
        `${filePath} must not import ${forbidden}`,
      );
    }
  }
});
