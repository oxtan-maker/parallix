import test from 'node:test';
import assert from 'node:assert/strict';

import { BoardCommandController } from '../src/application/controller/board-controller.js';
import { makeExecutePorts } from './fixtures/execute-mission-ports.js';
import type { BoardCommandRequest, OperationEvent } from '../src/application/controller/board-command.js';

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
// SC6: Progress-event sequence ordering
// ---------------------------------------------------------------------------

test('progress events are emitted in launch-record-handoff order with increasing sequence', async () => {
  const { ports } = makeExecutePorts();
  const events: OperationEvent[] = [];
  const controller = new BoardCommandController(ports, (event) => events.push(event as OperationEvent));
  await controller.dispatch(makeRequest());

  const phases = events.map((e) => e.phase);
  const sequences = events.map((e) => e.sequence);

  // Controller dispatch event (sequence 0) before ExecuteMissionService events (1, 2, 3)
  assert.ok(sequences[0] === 0, 'First event is dispatch (sequence 0)');
  assert.ok(phases.includes('launch'), 'launch phase present');
  assert.ok(phases.includes('record'), 'record phase present');
  assert.ok(phases.includes('handoff'), 'handoff phase present');

  // Launch (1) before record (2) before handoff (3)
  const launchIdx = phases.indexOf('launch');
  const recordIdx = phases.indexOf('record');
  const handoffIdx = phases.indexOf('handoff');
  assert.ok(launchIdx < recordIdx, 'launch before record');
  assert.ok(recordIdx < handoffIdx, 'record before handoff');

  // Sequence numbers are monotonically increasing
  for (let i = 1; i < sequences.length; i++) {
    assert.ok(sequences[i] > sequences[i - 1], `sequence ${i} (${sequences[i]}) not > ${i - 1} (${sequences[i - 1]})`);
  }
});

test('progress events share stable operationId across all phases', async () => {
  const { ports } = makeExecutePorts();
  const events: OperationEvent[] = [];
  const controller = new BoardCommandController(ports, (event) => events.push(event as OperationEvent));
  await controller.dispatch(makeRequest({ operationId: 'stable-id-123' }));

  for (const event of events) {
    assert.equal(event.operationId, 'stable-id-123', `Event ${event.phase} has wrong operationId: ${event.operationId}`);
  }
});

test('progress events carry timestamps in ISO format', async () => {
  const { ports } = makeExecutePorts();
  const events: OperationEvent[] = [];
  const controller = new BoardCommandController(ports, (event) => events.push(event as OperationEvent));
  await controller.dispatch(makeRequest());

  for (const event of events) {
    assert.ok(event.timestamp, `Event ${event.phase} missing timestamp`);
    assert.ok(!isNaN(Date.parse(event.timestamp)), `Event ${event.phase} has invalid timestamp: ${event.timestamp}`);
  }
});

test('progress event carries agent name after handoff phase', async () => {
  const { ports } = makeExecutePorts();
  const events: OperationEvent[] = [];
  const controller = new BoardCommandController(ports, (event) => events.push(event as OperationEvent));
  await controller.dispatch(makeRequest({ agent: 'codex' }));

  // The handoff phase (sequence 3) should carry the agent name
  const handoffEvent = events.find((e) => e.phase === 'handoff');
  assert.ok(handoffEvent, 'handoff event present');
  assert.equal(handoffEvent.agent, 'codex');
});

// ---------------------------------------------------------------------------
// SC6: Cancellation at safe boundaries
// ---------------------------------------------------------------------------

test('cancellation before any port call returns cancelled with no evidence', async () => {
  const { ports, calls } = makeExecutePorts();
  const controller = new BoardCommandController(ports);
  const result = await controller.dispatch(makeRequest({
    cancellation: { requested: true },
  }));
  assert.equal(result.status, 'cancelled');
  assert.equal(result.error.kind, 'cancelled');
  assert.equal(result.durableEvidence.length, 0);
  assert.deepEqual(calls, []);
});

test('cancellation after durable record returns partial evidence without rollback', async () => {
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
  // Partial evidence: launch evidence + record evidence
  assert.ok(result.durableEvidence.length >= 2);
});

// ---------------------------------------------------------------------------
// SC7: Stale command rejection with conflict kind
// ---------------------------------------------------------------------------

test('stale command returns failed status with conflict error kind', async () => {
  const { ports } = makeExecutePorts();
  const controller = new BoardCommandController(ports);
  const result = await controller.dispatchWithStatus(
    makeRequest({ missionStatusAtRequest: 'refined' }),
    'active',
  );
  assert.equal(result.status, 'failed');
  assert.equal(result.error.kind, 'conflict');
  assert.ok(result.error.message.includes('refined'));
  assert.ok(result.error.message.includes('active'));
  assert.ok(result.durableEvidence.length === 0);
});

test('non-stale command proceeds to dispatch', async () => {
  const { ports, calls } = makeExecutePorts();
  const controller = new BoardCommandController(ports);
  const result = await controller.dispatchWithStatus(
    makeRequest({ missionStatusAtRequest: 'refined' }),
    'refined',
  );
  assert.equal(result.status, 'completed');
  assert.ok(calls.length > 0, 'Port was called for non-stale command');
});

test('stale check happens before capability dispatch', async () => {
  const { ports, calls } = makeExecutePorts();
  const controller = new BoardCommandController(ports);
  const result = await controller.dispatchWithStatus(
    makeRequest({ missionStatusAtRequest: 'refined' }),
    'active',
  );
  assert.equal(result.status, 'failed');
  assert.deepEqual(calls, [], 'No port calls for stale command');
});

// ---------------------------------------------------------------------------
// SC9: Progress-event sequence ordering (comprehensive)
// ---------------------------------------------------------------------------

test('progress-event sequence: dispatch(0) < launch(1) < record(2) < handoff(3)', async () => {
  const { ports } = makeExecutePorts();
  const events: OperationEvent[] = [];
  const controller = new BoardCommandController(ports, (event) => events.push(event as OperationEvent));
  await controller.dispatch(makeRequest());

  const expectedPhases = ['dispatch', 'launch', 'record', 'handoff'];
  const expectedSequences = [0, 1, 2, 3];

  assert.equal(events.length, expectedPhases.length, `Expected ${expectedPhases.length} events, got ${events.length}`);
  for (let i = 0; i < expectedPhases.length; i++) {
    assert.equal(events[i].phase, expectedPhases[i], `Event ${i}: expected phase ${expectedPhases[i]}, got ${events[i].phase}`);
    assert.equal(events[i].sequence, expectedSequences[i], `Event ${i}: expected sequence ${expectedSequences[i]}, got ${events[i].sequence}`);
  }
});
