// TASK-2534: the real repository must never carry a `backlog/tasks/` copy of a
// task whose canonical record already lives in `backlog/completed/` or
// `backlog/archive/tasks/`. This is the CI guard that keeps main honest; it
// reads the checkout directly and makes no git calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { checkBacklogIntegrity } from '../src/adapters/backlog/task-file-io.js';

test('TASK-2534: the repository has no stale backlog/tasks copies of completed tasks', () => {
  const repoRoot = path.resolve(import.meta.dirname, '..');
  const duplicates = checkBacklogIntegrity(repoRoot).filter(issue => issue.type === 'duplicate-completed');
  assert.deepEqual(
    duplicates.map(issue => issue.file),
    [],
    'stale backlog/tasks copies must be dropped at landing, not carried on main',
  );
});
