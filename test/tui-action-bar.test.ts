import test from 'node:test';
import assert from 'node:assert/strict';
import { makeCard } from './fixtures/board-projection.js';
import React from 'react';
import { renderToString } from 'ink';
import { ActionBar, BOARD_ACTION_KINDS } from '../src/interfaces/tui/action-bar.js';

const controller = { canExecute(kind: string) { return kind === 'active:execute'; }, async dispatch() { return { status: 'completed' as const, durableEvidence: [] }; } };

test('action bar renders the declared command kinds with only active:execute enabled', async () => {
  const output = renderToString(React.createElement(ActionBar, {
    mission: makeCard({ commands: [{ command: 'active', enabled: true, reason: null }] }),
    commandController: controller,
  }), { columns: 160 });
  assert.equal(BOARD_ACTION_KINDS.length, 7);
  assert.match(output, /● active:execute/);
  for (const kind of BOARD_ACTION_KINDS.filter((kind) => kind !== 'active:execute')) {
    assert.match(output, new RegExp(`○ ${kind.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  }
  assert.match(output, /Draft is available only while the mission is in the pre-draft \(backlog\) state/);
});

test('action bar cannot dispatch a disabled command', async () => {
  const { canDispatchAction } = await import('../src/interfaces/tui/action-bar.js');
  const mission = makeCard({ commands: [{ command: 'active', enabled: true, reason: null }] });
  assert.equal(canDispatchAction('active:execute', mission, controller), true);
  assert.equal(canDispatchAction('draft:create', mission, controller), false);
});

test('canDispatchAction gates draft:create on wiring and pre-draft eligibility', async () => {
  const { canDispatchAction } = await import('../src/interfaces/tui/action-bar.js');
  const draftController = {
    canExecute(kind: string) { return kind === 'draft:create'; },
    async dispatch() { return { status: 'completed' as const, durableEvidence: [] }; },
  };
  const backlogCard = makeCard({
    lane: 'backlog', status: 'backlog', rawStatus: 'backlog',
    commands: [{ command: 'draft', enabled: true, reason: null }],
  });
  const activeCard = makeCard({
    lane: 'active', status: 'active', rawStatus: 'active',
    commands: [{ command: 'active', enabled: true, reason: null },
      { command: 'draft', enabled: false, reason: 'Draft is available only while the mission is in the pre-draft (backlog) state' }],
  });
  // Wired controller + eligible card: dispatchable.
  assert.equal(canDispatchAction('draft:create', backlogCard, draftController), true);
  // Eligible card but this interface instance has no draft service: not dispatchable.
  assert.equal(canDispatchAction('draft:create', backlogCard, controller), false);
  // Wired controller but the mission is past the pre-draft state: not dispatchable.
  assert.equal(canDispatchAction('draft:create', activeCard, draftController), false);
});
