/** Semantic navigation tests: no TTY, command, workflow, filesystem, Git, agent, or Forgejo dependency. */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { makeCard, makeCards, makeProjection } from './fixtures/board-projection.js';

const root = process.cwd();

test('navigation: horizontal movement wraps, skips empty lanes, and preserves the row when possible', async () => {
  const { createNavigationState, moveSelection } = await import('../src/interfaces/tui/navigation.js');
  const projection = makeProjection({
    backlog: makeCards(3, 'backlog'),
    review: [
      makeCard({ id: 'task-review-1' as never, lane: 'review' }),
      makeCard({ id: 'task-review-2' as never, lane: 'review' }),
    ],
  });
  let state = createNavigationState(projection);
  state = moveSelection(state, projection, 'down', 2);
  assert.equal(state.selectedMissionId, 'task-0002');
  state = moveSelection(state, projection, 'right', 2);
  assert.equal(state.selectedMissionId, 'task-review-2', 'right skips refined/active and preserves row in review');
  state = moveSelection(state, projection, 'right', 2);
  assert.equal(state.selectedMissionId, 'task-0002', 'right wraps review to backlog and preserves row');
  state = moveSelection(state, projection, 'left', 2);
  assert.equal(state.selectedMissionId, 'task-review-2', 'left wraps backlog to review and preserves row');
});

test('navigation: vertical boundaries stop and an all-empty board has no selection', async () => {
  const { createNavigationState, moveSelection } = await import('../src/interfaces/tui/navigation.js');
  const projection = makeProjection({ active: [makeCard({ id: 'task-one' as never, lane: 'active' })] });
  let state = createNavigationState(projection);
  state = moveSelection(state, projection, 'up', 3);
  assert.equal(state.selectedMissionId, 'task-one');
  state = moveSelection(state, projection, 'down', 3);
  assert.equal(state.selectedMissionId, 'task-one');
  assert.equal(createNavigationState(makeProjection()).selectedMissionId, null);
});

test('navigation: overflowing lane changes selected id and visible window without rendering commands', async () => {
  const { createNavigationState, moveSelection } = await import('../src/interfaces/tui/navigation.js');
  const projection = makeProjection({ backlog: makeCards(5, 'backlog') });
  let state = createNavigationState(projection);
  for (let index = 0; index < 3; index += 1) {
    state = moveSelection(state, projection, 'down', 2);
  }
  assert.equal(state.selectedMissionId, 'task-0004');
  assert.equal(state.visibleStarts.backlog, 2, 'two-card window scrolls just enough to retain task-0004');
});

test('navigation: reducer is view-state only and imports no board command, workflow, filesystem, Git, agent, or Forgejo capability', () => {
  const source = fs.readFileSync(path.join(root, 'src/interfaces/tui/navigation.ts'), 'utf8');
  assert.doesNotMatch(source, /board-command|workflow|child_process|node:fs|node:net|forgejo|agent|git/i);
});
