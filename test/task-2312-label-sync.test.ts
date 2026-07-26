const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');

const {
  getTaskLabels,
  getTaskClassification,
  setTaskLabels,
  syncTaskLabelsToBaseWorktree,
} = require('../dist/lib/tools/backlog');

// These exports are required — the test file goes red if they are missing.
assert.ok(typeof setTaskLabels === 'function', 'setTaskLabels must be exported');
assert.ok(typeof syncTaskLabelsToBaseWorktree === 'function', 'syncTaskLabelsToBaseWorktree must be exported');

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

async function withTempGitRepo(fn) {
  const previous = process.cwd();
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-label-sync-')));
  fs.mkdirSync(path.join(root, 'backlog', 'tasks'), { recursive: true });
  fs.mkdirSync(path.join(root, 'workflow', 'config'), { recursive: true });

  const agentsConfig = {
    agents: {
      codex: { families: ['codex'] },
      claude: { families: ['claude'] },
      gemini: { families: ['gemini'] },
      custom: { families: ['custom'] },
    },
    steps: {
      draft: { agents: ['codex', 'claude', 'gemini'] },
      active: { agents: ['codex', 'claude', 'gemini'] },
      review: { agents: ['codex', 'claude', 'gemini', 'custom'] },
    },
  };
  fs.writeFileSync(
    path.join(root, 'workflow', 'config', 'agents.json'),
    JSON.stringify(agentsConfig),
  );

  process.chdir(root);

  childProcess.spawnSync('git', ['init'], { cwd: root });
  childProcess.spawnSync('git', ['symbolic-ref', 'HEAD', 'refs/heads/main'], { cwd: root });
  childProcess.spawnSync('git', ['config', 'user.name', 'Workflow Test'], { cwd: root });
  childProcess.spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });

  try {
    await fn(root);
  } finally {
    process.chdir(previous);
    // Remove root last so git worktrees can clean up first
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function createMissionWorktree(root, slug) {
  const missionWorktree = path.join(os.tmpdir(), `workflow-mw-${slug}-${Date.now()}`);
  childProcess.spawnSync(
    'git',
    ['worktree', 'add', '-b', `mission/${slug}`, missionWorktree, 'HEAD'],
    { cwd: root },
  );
  return missionWorktree;
}

function removeMissionWorktree(root, missionWorktree, slug) {
  childProcess.spawnSync(
    'git',
    ['worktree', 'remove', '--force', missionWorktree],
    { cwd: root },
  );
  childProcess.spawnSync(
    'git',
    ['branch', '-D', `mission/${slug}`],
    { cwd: root },
  );
  fs.rmSync(missionWorktree, { recursive: true, force: true });
}

function writeTaskFile(dir, slug, content) {
  const taskDir = path.join(dir, 'backlog', 'tasks');
  fs.mkdirSync(taskDir, { recursive: true });
  const taskPath = path.join(taskDir, `${slug} - task.md`);
  fs.writeFileSync(taskPath, content, 'utf8');
  return taskPath;
}

function seedAndCommit(root) {
  childProcess.spawnSync('git', ['add', '.'], { cwd: root });
  childProcess.spawnSync('git', ['commit', '-m', 'seed'], { cwd: root });
}

/* ------------------------------------------------------------------ */
/* CP-1: Failing reproduction test                                    */
/* ------------------------------------------------------------------ */

test('CP-1 reproduction: labels diverge between mission and base worktree', async () => {
  await withTempGitRepo(async (root) => {
    const slug = 'task-2312';

    // 1. Seed the base repo with a task file (commit first so worktree gets files)
    const baseTaskContent = `---
id: TASK-2312
title: label sync reproduction
status: refined
assignee: [custom]
created_date: '2026-07-25'
labels: [ai_sdlc, bug]
dependencies: []
---

## Description
Reproduction task.
`;
    const baseTaskPath = writeTaskFile(root, slug, baseTaskContent);
    seedAndCommit(root);

    // 2. Create mission worktree AFTER the initial commit so files are checked out
    const missionWorktree = createMissionWorktree(root, slug);
    const missionTaskPath = path.join(missionWorktree, 'backlog', 'tasks', `${slug} - task.md`);

    try {
      // 3. Simulate draft agent: modifies labels in the mission worktree
      const missionTaskUpdated = `---
id: TASK-2312
title: label sync reproduction
status: backlog
assignee: [codex]
created_date: '2026-07-25'
labels: [ai_sdlc, bug]
dependencies: []
---

## Description
Updated by draft agent.
`;
      fs.writeFileSync(missionTaskPath, missionTaskUpdated, 'utf8');
      childProcess.spawnSync('git', ['add', '.'], { cwd: missionWorktree });
      childProcess.spawnSync('git', ['commit', '-m', 'draft agent output'], { cwd: missionWorktree });

      // 4. BUG: Base worktree task has empty labels (never synced from mission worktree)
      const baseTaskStale = `---
id: TASK-2312
title: label sync reproduction
status: refined
assignee: [custom]
created_date: '2026-07-25'
labels: []
dependencies: []
---

## Description
Reproduction task.
`;
      fs.writeFileSync(baseTaskPath, baseTaskStale, 'utf8');
      childProcess.spawnSync('git', ['add', '.'], { cwd: root });
      childProcess.spawnSync('git', ['commit', '-m', 'base worktree labels empty'], { cwd: root });

      // 5. Assert: getTaskClassification on mission worktree returns valid classification
      const missionClass = getTaskClassification(missionTaskPath);
      assert.equal(missionClass, 'ai_sdlc', 'mission worktree should have valid classification');

      // 6. ASSERTION THAT DEMONSTRATES THE BUG:
      //    getTaskClassification on the base worktree returns null because
      //    the labels were never synced from the mission worktree.
      const baseClass = getTaskClassification(baseTaskPath);
      assert.equal(baseClass, null, 'base worktree has no classification — this is the bug (red)');

      // 7. GREEN: After syncTaskLabelsToBaseWorktree, base worktree gets the labels.
      //    This verifies the fix works end-to-end.
      const syncOk = syncTaskLabelsToBaseWorktree(slug, missionWorktree, root);
      assert.equal(syncOk, true, 'syncTaskLabelsToBaseWorktree should succeed');

      const baseClassAfterSync = getTaskClassification(baseTaskPath);
      assert.equal(baseClassAfterSync, 'ai_sdlc',
        'base worktree should have ai_sdlc classification after sync (green)');

      // Verify the base worktree file was committed
      const statusOutput = childProcess.spawnSync(
        'git', ['status', '--porcelain', path.relative(root, baseTaskPath)],
        { cwd: root, encoding: 'utf8' },
      ).stdout.trim();
      assert.equal(statusOutput, '', 'base worktree task should have no uncommitted changes after sync');
    } finally {
      removeMissionWorktree(root, missionWorktree, slug);
    }
  });
});

/* ------------------------------------------------------------------ */
/* CP-2: setTaskLabels unit tests                                     */
/* ------------------------------------------------------------------ */

test('setTaskLabels writes inline format correctly (SC1)', async () => {
  await withTempGitRepo(async (root) => {
    const taskPath = path.join(root, 'backlog', 'tasks', 'task-201 - inline.md');
    fs.mkdirSync(path.dirname(taskPath), { recursive: true });
    fs.writeFileSync(taskPath, `---
id: TASK-201
title: inline format
labels: [old_label]
---
`, 'utf8');

    const ok = setTaskLabels(taskPath, ['ai_sdlc', 'bug']);
    assert.equal(ok, true, 'setTaskLabels should return true');

    const content = fs.readFileSync(taskPath, 'utf8');
    assert.match(content, /labels: \[ai_sdlc, bug\]/, 'should write inline format');
  });
});

test('setTaskLabels writes block format correctly (SC2)', async () => {
  await withTempGitRepo(async (root) => {
    const taskPath = path.join(root, 'backlog', 'tasks', 'task-202 - block.md');
    fs.mkdirSync(path.dirname(taskPath), { recursive: true });
    fs.writeFileSync(taskPath, `---
id: TASK-202
title: block format
labels:
  - old_label
  - another
---
`, 'utf8');

    const ok = setTaskLabels(taskPath, ['ai_sdlc', 'bug']);
    assert.equal(ok, true, 'setTaskLabels should return true for block format');

    const content = fs.readFileSync(taskPath, 'utf8');
    assert.match(content, /labels:\n  - ai_sdlc\n  - bug\n/, 'should preserve block format');
  });
});

test('setTaskLabels inserts labels field after created_date when missing (SC2)', async () => {
  await withTempGitRepo(async (root) => {
    const taskPath = path.join(root, 'backlog', 'tasks', 'task-203 - no-labels.md');
    fs.mkdirSync(path.dirname(taskPath), { recursive: true });
    fs.writeFileSync(taskPath, `---
id: TASK-203
title: no labels field
created_date: '2026-07-25'
dependencies: []
---
`, 'utf8');

    const ok = setTaskLabels(taskPath, ['ai_sdlc', 'bug']);
    assert.equal(ok, true, 'setTaskLabels should insert labels field');

    const content = fs.readFileSync(taskPath, 'utf8');
    // Should be inserted after created_date
    const createdIdx = content.indexOf('created_date');
    const labelsIdx = content.indexOf('labels:');
    assert.ok(labelsIdx > createdIdx, 'labels should be inserted after created_date');
    assert.match(content, /labels: \[ai_sdlc, bug\]/, 'should write inline format when inserting');
  });
});

test('setTaskLabels + getTaskClassification round-trip (SC3)', async () => {
  await withTempGitRepo(async (root) => {
    const taskPath = path.join(root, 'backlog', 'tasks', 'task-204 - roundtrip.md');
    fs.mkdirSync(path.dirname(taskPath), { recursive: true });
    fs.writeFileSync(taskPath, `---
id: TASK-204
title: round-trip test
labels: []
---
`, 'utf8');

    setTaskLabels(taskPath, ['ai_sdlc', 'bug']);
    const classification = getTaskClassification(taskPath);
    assert.equal(classification, 'ai_sdlc', 'getTaskClassification should return ai_sdlc after setTaskLabels');

    const labels = getTaskLabels(taskPath);
    assert.deepEqual(labels, ['ai_sdlc', 'bug'], 'getTaskLabels should return exact labels');
  });
});

/* ------------------------------------------------------------------ */
/* CP-3/CP-4: Sync behavior test                                      */
/* ------------------------------------------------------------------ */

test('syncTaskLabelsToBaseWorktree copies labels from mission to base worktree (SC4/SC5)', async () => {
  await withTempGitRepo(async (root) => {
    const slug = 'task-2312';

    // Seed base worktree task with empty labels (commit first so worktree gets files)
    const baseTaskContent = `---
id: TASK-2312
title: sync test
status: refined
assignee: [custom]
created_date: '2026-07-25'
labels: []
dependencies: []
---

## Description
Sync test task.
`;
    const baseTaskPath = writeTaskFile(root, slug, baseTaskContent);
    seedAndCommit(root);

    // Create mission worktree AFTER the initial commit
    const missionWorktree = createMissionWorktree(root, slug);

    try {
      // Mission worktree task has labels set by draft agent
      const missionTaskPath = path.join(missionWorktree, 'backlog', 'tasks', `${slug} - task.md`);
      const missionTaskContent = `---
id: TASK-2312
title: sync test
status: backlog
assignee: [codex]
created_date: '2026-07-25'
labels: [ai_sdlc, bug]
dependencies: []
---

## Description
Updated by draft agent.
`;
      fs.writeFileSync(missionTaskPath, missionTaskContent, 'utf8');
      childProcess.spawnSync('git', ['add', '.'], { cwd: missionWorktree });
      childProcess.spawnSync('git', ['commit', '-m', 'draft agent labels'], { cwd: missionWorktree });

      // Before sync: base has null classification
      assert.equal(getTaskClassification(baseTaskPath), null, 'base worktree should have null classification before sync');

      // Run the sync
      const ok = syncTaskLabelsToBaseWorktree(slug, missionWorktree, root);
      assert.equal(ok, true, 'sync should succeed');

      // After sync: base should have the same classification
      // Need to re-read base file because git may have updated it
      const baseClassAfter = getTaskClassification(baseTaskPath);
      assert.equal(baseClassAfter, 'ai_sdlc', 'base worktree should have ai_sdlc classification after sync (SC5)');

      // Verify the base worktree file was committed
      const statusOutput = childProcess.spawnSync(
        'git', ['status', '--porcelain', path.relative(root, baseTaskPath)],
        { cwd: root, encoding: 'utf8' },
      ).stdout.trim();
      assert.equal(statusOutput, '', 'base worktree task should have no uncommitted changes after sync');
    } finally {
      removeMissionWorktree(root, missionWorktree, slug);
    }
  });
});

test('syncTaskLabelsToBaseWorktree resolves base worktree via resolveBaseWorktree (SC4)', async () => {
  await withTempGitRepo(async (root) => {
    const slug = 'task-2312';

    // Seed base worktree task with empty labels (commit first so worktree gets files)
    const baseTaskContent = `---
id: TASK-2312
title: resolve-base-worktree test
status: refined
assignee: [custom]
created_date: '2026-07-25'
labels: []
dependencies: []
---

## Description
Resolve base worktree test.
`;
    const baseTaskPath = writeTaskFile(root, slug, baseTaskContent);
    seedAndCommit(root);

    // Create mission worktree AFTER the initial commit
    const missionWorktree = createMissionWorktree(root, slug);

    try {
      // Mission worktree task has labels set by draft agent
      const missionTaskPath = path.join(missionWorktree, 'backlog', 'tasks', `${slug} - task.md`);
      const missionTaskContent = `---
id: TASK-2312
title: resolve-base-worktree test
status: backlog
assignee: [codex]
created_date: '2026-07-25'
labels: [ai_sdlc, bug]
dependencies: []
---

## Description
Updated by draft agent.
`;
      fs.writeFileSync(missionTaskPath, missionTaskContent, 'utf8');
      childProcess.spawnSync('git', ['add', '.'], { cwd: missionWorktree });
      childProcess.spawnSync('git', ['commit', '-m', 'draft agent labels'], { cwd: missionWorktree });

      // Before sync: base has null classification
      assert.equal(getTaskClassification(baseTaskPath), null, 'base worktree should have null classification before sync');

      // Run the sync WITHOUT passing baseRoot — forces resolveBaseWorktree
      const ok = syncTaskLabelsToBaseWorktree(slug, missionWorktree);
      assert.equal(ok, true, 'sync should succeed using resolveBaseWorktree');

      // After sync: base should have the same classification
      const baseClassAfter = getTaskClassification(baseTaskPath);
      assert.equal(baseClassAfter, 'ai_sdlc', 'base worktree should have ai_sdlc classification after sync via resolveBaseWorktree');
    } finally {
      removeMissionWorktree(root, missionWorktree, slug);
    }
  });
});
