import test from 'node:test';
import assert from 'node:assert/strict';
import { makeCard } from './fixtures/board-projection.js';

test('action bar renders the declared command kinds with only active:execute enabled', async () => {
  const ink = await import('ink');
  const React = await import('react');
  const { ActionBar, BOARD_ACTION_KINDS } = await import('../src/interfaces/tui/action-bar.js');
  const output = ink.renderToString(React.createElement(ActionBar, {
    mission: makeCard({ commands: [{ command: 'active', enabled: true, reason: null }] }),
  }), { columns: 160 });
  assert.equal(BOARD_ACTION_KINDS.length, 7);
  assert.match(output, /● active:execute/);
  for (const kind of BOARD_ACTION_KINDS.filter((kind) => kind !== 'active:execute')) {
    assert.match(output, new RegExp(`○ ${kind.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  }
  assert.match(output, /Draft extraction not yet integrated \(TASK-2289\)/);
});

test('action bar cannot dispatch a disabled command', async () => {
  const { canDispatchAction } = await import('../src/interfaces/tui/action-bar.js');
  const mission = makeCard({ commands: [{ command: 'active', enabled: true, reason: null }] });
  assert.equal(canDispatchAction('active:execute', mission), true);
  assert.equal(canDispatchAction('draft:create', mission), false);
});
