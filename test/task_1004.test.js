const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveTaskFile, checkBacklogIntegrity } = require('../lib/tools/backlog');

function withTempRepo(fn) {
  const previous = process.cwd();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-task-1004-'));
  fs.mkdirSync(path.join(root, 'backlog', 'tasks'), { recursive: true });
  process.chdir(root);

  try {
    fn(root);
  } finally {
    process.chdir(previous);
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('resolveTaskFile prefers exact frontmatter id: match over filename-prefix matches', () => {
  withTempRepo(root => {
    const taskDir = path.join(root, 'backlog', 'tasks');
    
    // Create two files with the same filename prefix but different frontmatter IDs
    const file1 = path.join(taskDir, 'task-093 - gemini-draft-bug.md');
    fs.writeFileSync(file1, '---\nid: TASK-093\n---\n');
    
    const file2 = path.join(taskDir, 'task-093 - Non-UI-Login-Helper.md');
    fs.writeFileSync(file2, '---\nid: TASK-099\n---\n');

    // Searching for task-093 should resolve to file1 because it has id: TASK-093
    const result = resolveTaskFile('task-093');
    assert.equal(result.ok, true);
    assert.equal(result.taskFile, file1);
    
    // Searching for task-099 should resolve to file2 even if its filename starts with task-093
    const result2 = resolveTaskFile('task-099');
    assert.equal(result2.ok, true, `Expected task-099 to resolve via frontmatter ID, got: ${result2.reason}`);
    assert.equal(result2.taskFile, file2);
  });
});

test('resolveTaskFile handles slugs with suffixes by falling back to base task ID', () => {
  withTempRepo(root => {
    const taskDir = path.join(root, 'backlog', 'tasks');
    
    const file1 = path.join(taskDir, 'task-1004 - harden-workflow.md');
    fs.writeFileSync(file1, '---\nid: TASK-1004\n---\n');
    
    // Searching for task-1004-modern should resolve to file1 because it starts with task-1004
    const result = resolveTaskFile('task-1004-modern');
    assert.equal(result.ok, true);
    assert.equal(result.taskFile, file1);
  });
});

test('findMissionDir and getMissionYear handle slugs with suffixes', () => {
  withTempRepo(root => {
    const { findMissionDir, getMissionYear } = require('../lib/core/mission-utils');
    const missionDir = path.join(root, 'docs', 'missions', '2026', 'task-1004');
    fs.mkdirSync(missionDir, { recursive: true });
    fs.writeFileSync(path.join(missionDir, 'MISSION.md'), '# Mission\n');

    // Should find the year even with suffix
    assert.equal(getMissionYear('task-1004-modern', root), '2026');

    // Should find the directory even with suffix
    const found = findMissionDir('task-1004-modern', root);
    assert.equal(found, missionDir);
  });
});
