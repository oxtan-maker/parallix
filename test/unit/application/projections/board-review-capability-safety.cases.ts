import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isIntegratedCapability, unavailableReason } from '../../../../src/application/controller/board-command.js';
import { BoardCommandController } from '../../../../src/application/controller/board-controller.js';
import { makeExecutePorts } from '../../../fixtures/execute-mission-ports.js';

test('board review dispatch stays unavailable after synthetic state removal (TASK-2428, TASK-2821)', () => {
  const source = readFileSync(new URL('../../../../src/adapters/review/review-submit-round.ts', import.meta.url), 'utf8');

  assert.doesNotMatch(source, /reviewer\s*[:=]\s*(?:[^;\n]*\|\|\s*)?'autonomous'/);
  assert.doesNotMatch(source, /new ReviewState\(slug/);
  assert.equal(isIntegratedCapability('review:act-on-findings'), false);
  assert.match(unavailableReason('review:act-on-findings') ?? '', /synthesize review state or reviewer identity/);
});

test('task-2428: review judgement commands remain typed capability rejections', () => {
  for (const kind of ['review:act-on-findings', 'approve:review'] as const) {
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
    payload: { kind: 'handoff:record', netEngineeringLines: 0, capturedAt: 'never' },
  });

  assert.equal(result.status, 'rejected');
  assert.equal(result.error?.kind, 'capability');
  assert.equal(loads, 0, 'approval state is never read or written by the board path');
});

test('review continuation requires the configured evidence-owning handoff workflow (TASK-2750)', async () => {
  const controller = new BoardCommandController(makeExecutePorts().ports);
  assert.equal(isIntegratedCapability('review:submit'), true);
  assert.equal(controller.canExecute('review:submit'), false);
  const result = await controller.dispatch({
    operationId: 'continue', kind: 'review:submit', missionId: 'task-2428',
    capabilities: new Set(['review:submit']),
  });
  assert.equal(result.status, 'rejected');
  assert.equal(result.error?.kind, 'capability');
});
