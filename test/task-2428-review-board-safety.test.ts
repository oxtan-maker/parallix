import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isIntegratedCapability, unavailableReason } from '../src/application/controller/board-command.js';
import { BoardCommandController } from '../src/application/controller/board-controller.js';
import { makeExecutePorts } from './fixtures/execute-mission-ports.js';

test('task-2428: persisted-artifact consumer can synthesize review identity, so board dispatch remains unavailable', () => {
  const source = readFileSync(new URL('../src/adapters/review/review-commands.ts', import.meta.url), 'utf8');

  assert.match(source, /reviewer = 'autonomous'/);
  assert.match(source, /new ReviewState\(slug/);
  assert.equal(isIntegratedCapability('review:act-on-findings'), false);
  assert.match(unavailableReason('review:act-on-findings') ?? '', /synthesize review state or reviewer identity/);
});

test('task-2428: all review board commands remain typed capability rejections', () => {
  for (const kind of ['review:submit', 'review:act-on-findings', 'approve:review'] as const) {
    assert.equal(isIntegratedCapability(kind), false, `${kind} must not reach a workflow from board state`);
    assert.ok(unavailableReason(kind));
  }
});

test('task-2428: approve:review cannot reach authority or fabricate approval from a board payload', async () => {
  let loads = 0;
  const controller = new BoardCommandController(makeExecutePorts().ports, undefined, {}, undefined, {
    async load() { loads += 1; throw new Error('approval authority must not be reached'); },
  });

  const result = await controller.dispatch({
    operationId: 'forged-approval', kind: 'approve:review', missionId: 'task-2428',
    capabilities: new Set(),
    payload: { kind: 'handoff:record', netEngineeringLines: 0, capturedAt: 'never' } as never,
  });

  assert.equal(result.status, 'rejected');
  assert.equal(result.error?.kind, 'capability');
  assert.equal(loads, 0, 'approval state is never read or written by the board path');
});
