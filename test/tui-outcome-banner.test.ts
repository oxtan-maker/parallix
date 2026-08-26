import test from 'node:test';
import assert from 'node:assert/strict';
import type { BoardCommandResult } from '../src/application/controller/board-command.js';
import 'react';
import 'ink';
import '../src/interfaces/tui/outcome-banner.js';

function outcome(status: BoardCommandResult['status']): BoardCommandResult {
  return status === 'completed'
    ? { status, value: {}, durableEvidence: [] }
    : { status, error: { kind: status === 'cancelled' ? 'cancelled' : 'execution', message: `${status} safely` }, durableEvidence: [] };
}

test('outcome banner renders completed rejected failed and cancelled with distinct indicators', async () => {
  const ink = await import('ink');
  const React = await import('react');
  const { OutcomeBanner } = await import('../src/interfaces/tui/outcome-banner.js');
  const outputs = new Map(['completed', 'rejected', 'failed', 'cancelled'].map((status) => [
    status,
    ink.renderToString(React.createElement(OutcomeBanner, { outcome: outcome(status as BoardCommandResult['status']) })),
  ]));
  assert.match(outputs.get('completed')!, /✓ COMPLETED/);
  assert.match(outputs.get('rejected')!, /! REJECTED/);
  assert.match(outputs.get('failed')!, /✕ FAILED/);
  assert.match(outputs.get('cancelled')!, /○ CANCELLED/);
  assert.doesNotMatch(outputs.get('failed')!, /COMPLETED/);
  assert.doesNotMatch(outputs.get('rejected')!, /COMPLETED/);
});
