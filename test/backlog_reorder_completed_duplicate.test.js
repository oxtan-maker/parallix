// Regression for TASK-1343: a "Reorder tasks in backlog" / ordinal write path
// recreates a `status: backlog` copy in backlog/tasks/ for a task whose
// canonical record already lives in backlog/completed/ (or backlog/archive/).
// The integrity gate must flag the duplicate; pruning must drop the stale
// backlog/tasks/ copy while keeping the completed copy canonical.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  checkBacklogIntegrity,
  pruneStaleBacklogDuplicates,
  resolveTaskFile,
} = require('../lib/tools/backlog');

function withTempRepo(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-reorder-dup-'));
  fs.mkdirSync(path.join(root, 'backlog', 'tasks'), { recursive: true });
  fs.mkdirSync(path.join(root, 'backlog', 'completed'), { recursive: true });
  fs.mkdirSync(path.join(root, 'backlog', 'archive', 'tasks'), { recursive: true });
  try {
    fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// Mirror the evidence from TASK-1343: a recreated backlog copy carrying
// `status: backlog` and an `ordinal:` field alongside a done completed copy.
function reproduceReorderRecreate(root) {
  const completedFile = path.join(root, 'backlog', 'completed', 'task-1323 - example.md');
  fs.writeFileSync(completedFile, '---\nid: TASK-1323\nstatus: done\n---\n# done copy\n');

  const staleFile = path.join(root, 'backlog', 'tasks', 'task-1323 - example.md');
  fs.writeFileSync(staleFile, '---\nid: TASK-1323\nstatus: backlog\nordinal: 43000\n---\n# recreated backlog copy\n');

  return { completedFile, staleFile };
}

test('checkBacklogIntegrity flags a reorder-recreated backlog copy of a completed task', () => {
  withTempRepo(root => {
    const { staleFile, completedFile } = reproduceReorderRecreate(root);

    const issues = checkBacklogIntegrity(root);
    const dup = issues.find(i => i.type === 'duplicate-completed' && i.taskId === 'TASK-1323');

    assert.ok(dup, 'expected a duplicate-completed issue for TASK-1323');
    assert.equal(dup.file, path.relative(root, staleFile));
    assert.equal(dup.canonicalFile, path.relative(root, completedFile));
  });
});

test('checkBacklogIntegrity also flags a tasks/ copy that duplicates an archived task', () => {
  withTempRepo(root => {
    fs.writeFileSync(
      path.join(root, 'backlog', 'archive', 'tasks', 'task-1400 - archived.md'),
      '---\nid: TASK-1400\nstatus: done\n---\n'
    );
    fs.writeFileSync(
      path.join(root, 'backlog', 'tasks', 'task-1400 - archived.md'),
      '---\nid: TASK-1400\nstatus: backlog\nordinal: 50000\n---\n'
    );

    const issues = checkBacklogIntegrity(root);
    assert.ok(
      issues.some(i => i.type === 'duplicate-completed' && i.taskId === 'TASK-1400'),
      'expected the archive duplicate to be flagged'
    );
  });
});

test('pruneStaleBacklogDuplicates removes the stale copy and clears the gate', () => {
  withTempRepo(root => {
    const { staleFile, completedFile } = reproduceReorderRecreate(root);

    const removed = pruneStaleBacklogDuplicates(root);

    assert.equal(removed.length, 1);
    assert.equal(removed[0].taskId, 'TASK-1323');
    assert.equal(fs.existsSync(staleFile), false, 'stale backlog/tasks copy must be removed');
    assert.equal(fs.existsSync(completedFile), true, 'completed copy must remain canonical');

    // After pruning, the integrity gate is clean and resolution returns the
    // canonical completed copy rather than the stale backlog copy.
    const issues = checkBacklogIntegrity(root);
    assert.equal(issues.filter(i => i.type === 'duplicate-completed').length, 0);

    const resolution = resolveTaskFile('task-1323', root);
    assert.equal(resolution.ok, true);
    assert.equal(resolution.taskFile, completedFile);
  });
});

test('integrity gate stays clean when no duplicate exists', () => {
  withTempRepo(root => {
    fs.writeFileSync(
      path.join(root, 'backlog', 'completed', 'task-1500 - shipped.md'),
      '---\nid: TASK-1500\nstatus: done\n---\n'
    );
    fs.writeFileSync(
      path.join(root, 'backlog', 'tasks', 'task-1501 - open.md'),
      '---\nid: TASK-1501\nstatus: backlog\n---\n'
    );

    const issues = checkBacklogIntegrity(root);
    assert.equal(issues.filter(i => i.type === 'duplicate-completed').length, 0);
    assert.equal(pruneStaleBacklogDuplicates(root).length, 0);
  });
});
