import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { checkBacklogIntegrity, completeTask, resolveTaskFile } from '../src/adapters/backlog/backlog.js';

test('TASK-2524: completeTask closes the sole open slug-prefix twin without hiding ambiguity', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2524-'));
  const tasksDir = path.join(root, 'backlog', 'tasks');
  const completedDir = path.join(root, 'backlog', 'completed');
  const openFile = path.join(tasksDir, 'task-2524 - open.md');
  const completedFile = path.join(completedDir, 'task-2524 - renamed.md');

  try {
    fs.mkdirSync(tasksDir, { recursive: true });
    fs.mkdirSync(completedDir, { recursive: true });
    fs.writeFileSync(openFile, 'id: TASK-2524\nstatus: backlog\n');
    fs.writeFileSync(completedFile, 'id: TASK-2524\nstatus: done\n');

    assert.deepEqual(resolveTaskFile('task-2524', root), {
      ok: false,
      reason: 'ambiguous',
      matches: [openFile, completedFile],
    });
    assert.equal(completeTask('task-2524', root), true);
    assert.equal(fs.existsSync(openFile), false);
    assert.deepEqual(fs.readdirSync(completedDir), [path.basename(completedFile)]);
    assert.deepEqual(resolveTaskFile('task-2524', root), {
      ok: true,
      taskFile: completedFile,
      matches: [completedFile],
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('TASK-2524: backlog integrity rejects renamed slug-prefix twins', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2524-'));
  const tasksDir = path.join(root, 'backlog', 'tasks');
  const completedDir = path.join(root, 'backlog', 'completed');

  try {
    fs.mkdirSync(tasksDir, { recursive: true });
    fs.mkdirSync(completedDir, { recursive: true });
    fs.writeFileSync(path.join(tasksDir, 'task-2524 - open.md'), 'id: TASK-2524\nstatus: backlog\n');
    fs.writeFileSync(path.join(completedDir, 'task-2524 - renamed.md'), 'id: TASK-2524\nstatus: done\n');

    assert.deepEqual(checkBacklogIntegrity(root, 'task-2524'), [{
      file: 'backlog/tasks/task-2524 - open.md',
      type: 'duplicate-completed',
      taskId: 'TASK-2524',
      canonicalFile: 'backlog/completed/task-2524 - renamed.md',
    }]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
