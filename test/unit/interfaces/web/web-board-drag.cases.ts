import test from 'node:test';
import assert from 'node:assert/strict';
import { dragActionForTarget, EMPTY_FLIGHT_LANE_WIDTH_PX, FLIGHT_LANE_MIN_WIDTH_PX, flightLaneStyle } from '../../../../web/src/board.js';

test('drag resolves exactly one enabled server target without a browser transition table', () => {
  const actions = [
    { kind: 'active:execute', display: 'px active task-2436', state: 'enabled', reason: null, targetLane: 'active' },
    { kind: 'integrate:merge', display: 'px integrate task-2436', state: 'enabled', reason: null, targetLane: 'integration' },
  ] as const;
  assert.equal(dragActionForTarget(actions, 'integration')?.kind, 'integrate:merge');
  assert.equal(dragActionForTarget(actions, 'review'), null);
  assert.equal(dragActionForTarget([{ ...actions[0] }, { ...actions[0], kind: 'draft:create' }], 'active'), null);
});

test('empty-lane compaction is layout only and never changes the projected drop target (TASK-2773.06)', () => {
  const actions = [
    { kind: 'active:execute', display: 'px active task-2773', state: 'enabled', reason: null, targetLane: 'active' },
    { kind: 'handoff:record', display: 'px handoff task-2773', state: 'enabled', reason: null, targetLane: 'review' },
  ] as const;
  assert.equal(flightLaneStyle(0).minWidth, EMPTY_FLIGHT_LANE_WIDTH_PX, 'a lane the server sent no cards for takes the compact column');
  assert.equal(flightLaneStyle(3).minWidth, FLIGHT_LANE_MIN_WIDTH_PX, 'a lane with cards keeps the reference minimum its cards need');
  // Drop resolution reads only the server-projected actions, never the lane
  // geometry: an empty compact lane resolves the same single target.
  assert.equal(dragActionForTarget(actions, 'review')?.kind, 'handoff:record');
  assert.equal(dragActionForTarget(actions, 'integration'), null, 'a lane with no projected target still rejects the drop');
});
