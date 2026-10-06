import test from 'node:test';
import assert from 'node:assert/strict';
import { missionTerminalRequest } from '../../../../src/interfaces/cli/mission-terminal-policy.js';

// Boundary: CLI registry hosting eligibility and its mission positional slot.
test('only declared mission operations can enter a terminal (TASK-2643)', () => {
  for (const command of ['active', 'review', 'integrate', 'recover']) {
    assert.deepEqual(missionTerminalRequest(command, ['task-1']), { slug: 'task-1' });
  }
  for (const command of ['diff', 'stats', 'rebase', 'resolve', 'verdict', 'unassign', 'future-command']) {
    assert.equal(missionTerminalRequest(command, ['task-1']), null);
  }
  assert.equal(missionTerminalRequest('active', ['task-1', '--json']), null);
  assert.equal(missionTerminalRequest('active', ['--help']), null);
});

test('flag values and verification areas cannot become mission selectors (TASK-2643)', () => {
  assert.deepEqual(missionTerminalRequest('active', ['--depends', 'task-1']), {});
  assert.deepEqual(missionTerminalRequest('review', ['--comment', 'task-1']), {});
  assert.deepEqual(missionTerminalRequest('verify', ['docs']), {});
});
