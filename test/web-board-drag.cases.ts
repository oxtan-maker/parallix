import test from 'node:test';
import assert from 'node:assert/strict';
import { dragActionForTarget } from '../web/src/board.js';

test('drag resolves exactly one enabled server target without a browser transition table', () => {
  const actions = [
    { kind: 'active:execute', display: 'px active task-2436', state: 'enabled', reason: null, targetLane: 'active' },
    { kind: 'integrate:merge', display: 'px integrate task-2436', state: 'enabled', reason: null, targetLane: 'integration' },
  ] as const;
  assert.equal(dragActionForTarget(actions, 'integration')?.kind, 'integrate:merge');
  assert.equal(dragActionForTarget(actions, 'review'), null);
  assert.equal(dragActionForTarget([{ ...actions[0] }, { ...actions[0], kind: 'draft:create' }], 'active'), null);
});
