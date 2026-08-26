import test from 'node:test';
import assert from 'node:assert/strict';
import 'react';
import 'ink';
import '../src/interfaces/tui/confirmation-dialog.js';

test('confirmation dialog displays the exact active application command and explicit keys', async () => {
  const ink = await import('ink');
  const React = await import('react');
  const { ConfirmationDialog, applicationCommandText } = await import('../src/interfaces/tui/confirmation-dialog.js');
  assert.equal(applicationCommandText('active:execute', 'task-2307'), 'px active task-2307');
  const output = ink.renderToString(React.createElement(ConfirmationDialog, { kind: 'active:execute', missionId: 'task-2307' }));
  assert.match(output, /px active task-2307/);
  assert.match(output, /Enter: confirm/);
  assert.match(output, /Escape: cancel/);
});
