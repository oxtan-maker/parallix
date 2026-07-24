import test from 'node:test';
import assert from 'node:assert/strict';

import { BoardCommandController } from '../src/application/controller/board-controller.js';
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

function makeActivePort(overrides: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const port = {
    async validateSlug(slug: string) { calls.push(`validate:${slug}`); return null; },
    async launch(slug: string, agent: string) {
      calls.push(`launch:${slug}:${agent ?? 'default'}`);
      return { agent: agent ?? 'codex', evidence: { id: 'launch-1', source: 'task-markdown' as const, detail: 'agent launched' } };
    },
    async recordLaunch(_slug: string, _agent: string) {
      calls.push(`record:${_slug}:${_agent}`);
      return { id: 'record-1', source: 'task-markdown' as const, detail: 'active recorded' };
    },
    async handoff(slug: string, agent: string) { calls.push(`handoff:${slug}:${agent}`); },
    ...overrides,
  };
  return { port, calls };
}

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

test('controller dispatches active:execute through ActiveService', async () => {
  const { port, calls } = makeActivePort();
  const controller = new BoardCommandController(port);
  const result = await controller.dispatch(makeRequest());
  assert.equal(result.status, 'completed');
  assert.deepEqual(calls, ['validate:task-0001', 'launch:task-0001:codex', 'record:task-0001:codex', 'handoff:task-0001:codex']);
});

test('controller rejects draft:create with capability kind', async () => {
  const { port } = makeActivePort();
  const controller = new BoardCommandController(port);
  const result = await controller.dispatch(makeRequest({ kind: 'draft:create' }));
  assert.equal(result.status, 'rejected');
  assert.equal(result.error.kind, 'capability');
  assert.ok(result.error.message.includes('draft:create'));
});

test('controller rejects checkpoint:record with capability kind', async () => {
  const { port } = makeActivePort();
  const controller = new BoardCommandController(port);
  const result = await controller.dispatch(makeRequest({ kind: 'checkpoint:record' }));
  assert.equal(result.status, 'rejected');
  assert.equal(result.error.kind, 'capability');
});

test('controller rejects review:submit with capability kind', async () => {
  const { port } = makeActivePort();
  const controller = new BoardCommandController(port);
  const result = await controller.dispatch(makeRequest({ kind: 'review:submit' }));
  assert.equal(result.status, 'rejected');
  assert.equal(result.error.kind, 'capability');
});

test('controller rejects review:act-on-findings with capability kind', async () => {
  const { port } = makeActivePort();
  const controller = new BoardCommandController(port);
  const result = await controller.dispatch(makeRequest({ kind: 'review:act-on-findings' }));
  assert.equal(result.status, 'rejected');
  assert.equal(result.error.kind, 'capability');
});

test('controller rejects approve:review with capability kind', async () => {
  const { port } = makeActivePort();
  const controller = new BoardCommandController(port);
  const result = await controller.dispatch(makeRequest({ kind: 'approve:review' }));
  assert.equal(result.status, 'rejected');
  assert.equal(result.error.kind, 'capability');
});

test('controller rejects integrate:merge with capability kind', async () => {
  const { port } = makeActivePort();
  const controller = new BoardCommandController(port);
  const result = await controller.dispatch(makeRequest({ kind: 'integrate:merge' }));
  assert.equal(result.status, 'rejected');
  assert.equal(result.error.kind, 'capability');
});

// ---------------------------------------------------------------------------
// SC6: Progress events with stable operationId, cancellation
// ---------------------------------------------------------------------------

test('progress events carry stable operationId', async () => {
  const { port } = makeActivePort();
  const events: unknown[] = [];
  const controller = new BoardCommandController(port, (event) => events.push(event));
  await controller.dispatch(makeRequest({ operationId: 'stable-op-id' }));
  assert.ok(events.length > 0);
  for (const event of events as Array<{ operationId: string }>) {
    assert.equal(event.operationId, 'stable-op-id');
  }
});

test('progress events have monotonically increasing sequence numbers', async () => {
  const { port } = makeActivePort();
  const events: unknown[] = [];
  const controller = new BoardCommandController(port, (event) => events.push(event));
  await controller.dispatch(makeRequest());
  const sequences = (events as Array<{ sequence: number }>).map((e) => e.sequence);
  for (let i = 1; i < sequences.length; i++) {
    assert.ok(sequences[i] > sequences[i - 1], `sequence ${i} not increasing: ${sequences}`);
  }
});

test('cancellation before launch returns cancelled outcome', async () => {
  const { port, calls } = makeActivePort();
  const controller = new BoardCommandController(port);
  const result = await controller.dispatch(makeRequest({
    cancellation: { requested: true },
  }));
  assert.equal(result.status, 'cancelled');
  assert.equal(result.error.kind, 'cancelled');
  assert.deepEqual(calls, []);
});

test('controller passes cancellation to ActiveService for post-boundary cancellation', async () => {
  const cancellation = { requested: false };
  const { port } = makeActivePort({
    async recordLaunch(_slug: string, _agent: string) {
      cancellation.requested = true;
      return { id: 'record-1', source: 'task-markdown', detail: 'active recorded' };
    },
  });
  const controller = new BoardCommandController(port);
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

test('dispatchWithStatus rejects stale command with conflict kind', async () => {
  const { port } = makeActivePort();
  const controller = new BoardCommandController(port);
  const result = await controller.dispatchWithStatus(
    makeRequest({ missionStatusAtRequest: 'refined' }),
    'active',
  );
  assert.equal(result.status, 'failed');
  assert.equal(result.error.kind, 'conflict');
  assert.ok(result.error.message.includes('refined'));
  assert.ok(result.error.message.includes('active'));
});

test('dispatchWithStatus proceeds when status matches', async () => {
  const { port, calls } = makeActivePort();
  const controller = new BoardCommandController(port);
  const result = await controller.dispatchWithStatus(
    makeRequest({ missionStatusAtRequest: 'refined' }),
    'refined',
  );
  assert.equal(result.status, 'completed');
  assert.ok(calls.length > 0);
});

// ---------------------------------------------------------------------------
// Capability registry
// ---------------------------------------------------------------------------

test('isIntegratedCapability returns true only for active:execute', () => {
  assert.equal(isIntegratedCapability('active:execute'), true);
  assert.equal(isIntegratedCapability('draft:create'), false);
  assert.equal(isIntegratedCapability('checkpoint:record'), false);
  assert.equal(isIntegratedCapability('review:submit'), false);
  assert.equal(isIntegratedCapability('review:act-on-findings'), false);
  assert.equal(isIntegratedCapability('approve:review'), false);
  assert.equal(isIntegratedCapability('integrate:merge'), false);
});

test('INTEGRATED_CAPABILITIES contains exactly active:execute', () => {
  assert.equal(INTEGRATED_CAPABILITIES.size, 1);
  assert.ok(INTEGRATED_CAPABILITIES.has('active:execute'));
});

test('UNAVAILABLE_CAPABILITIES has reasons for all six unextracted commands', () => {
  assert.equal(UNAVAILABLE_CAPABILITIES.size, 6);
  for (const kind of ['draft:create', 'checkpoint:record', 'review:submit', 'review:act-on-findings', 'approve:review', 'integrate:merge'] as const) {
    const reason = unavailableReason(kind);
    assert.ok(reason, `Missing reason for ${kind}`);
    assert.ok(reason.length > 0);
  }
});

// ---------------------------------------------------------------------------
// SC5: No UI module imports
// ---------------------------------------------------------------------------

test('controller does not import ink, react, or node:react', () => {
  const fs = require('node:fs');
  const path = require('node:path');
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
