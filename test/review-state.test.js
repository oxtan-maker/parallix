const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// We test the state file path resolution and the read/write contract
// by temporarily pointing the module at a fake mission directory tree.

function withTempMissionDir(slug, fn) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'review-state-test-'));

  // Create a minimal docs/missions/2026/<slug>/ layout
  const missionDir = path.join(tmpRoot, 'docs', 'missions', '2026', slug);
  fs.mkdirSync(missionDir, { recursive: true });

  // Minimal MISSION.md so findMissionDir can locate it
  fs.writeFileSync(path.join(missionDir, 'MISSION.md'), `# Mission: ${slug}\n`);

  // Minimal backlog/tasks dir
  const tasksDir = path.join(tmpRoot, 'backlog', 'tasks');
  fs.mkdirSync(tasksDir, { recursive: true });

  // Git init so git commands work in the temp repo
  const { spawnSync } = require('child_process');
  spawnSync('git', ['init'], { cwd: tmpRoot });
  spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: tmpRoot });
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd: tmpRoot });
  spawnSync('git', ['checkout', '-b', `mission/${slug}`], { cwd: tmpRoot });
  spawnSync('git', ['add', '.'], { cwd: tmpRoot });
  spawnSync('git', ['commit', '-m', 'init', '--allow-empty'], { cwd: tmpRoot });

  const prev = process.cwd();
  process.chdir(tmpRoot);

  try {
    fn(tmpRoot, missionDir, slug);
  } finally {
    process.chdir(prev);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

test('reviewStateFile returns null for unknown slug', () => {
  const { reviewStateFile } = require('../lib/review/review-state');
  // Non-existent slug in the real repo
  const result = reviewStateFile('task-nonexistent-zzz');
  assert.equal(result, null);
});

test('readReviewState returns null when file does not exist', () => {
  withTempMissionDir('task-rs-1', (root, missionDir, slug) => {
    const { readReviewState } = require('../lib/review/review-state');
    assert.equal(readReviewState(slug), null);
  });
});

test('readReviewState returns null for malformed JSON', () => {
  withTempMissionDir('task-rs-2', (root, missionDir, slug) => {
    const stateFile = path.join(missionDir, 'review-state.json');
    fs.writeFileSync(stateFile, '{not valid json}', 'utf8');

    const { readReviewState } = require('../lib/review/review-state');
    assert.equal(readReviewState(slug), null);
  });
});

test('readReviewState returns null for JSON missing reviewer/implementer', () => {
  withTempMissionDir('task-rs-3', (root, missionDir, slug) => {
    const stateFile = path.join(missionDir, 'review-state.json');
    fs.writeFileSync(stateFile, JSON.stringify({ round: 1 }), 'utf8');

    const { readReviewState } = require('../lib/review/review-state');
    assert.equal(readReviewState(slug), null);
  });
});

test('writeReviewState writes a valid JSON file', () => {
  withTempMissionDir('task-rs-4', (root, missionDir, slug) => {
    // Stage initial commit so git commit has something
    const { spawnSync } = require('child_process');
    spawnSync('git', ['add', '-A'], { cwd: root });
    spawnSync('git', ['commit', '-m', 'mission init', '--allow-empty-message'], { cwd: root });

    const { writeReviewState, readReviewState } = require('../lib/review/review-state');

    const state = { reviewer: 'codex', implementer: 'claude', round: 1 };
    const ok = writeReviewState(slug, state);
    assert.equal(ok, true);

    const read = readReviewState(slug);
    assert.ok(read, 'state should be readable after write');
    assert.equal(read.reviewer, 'codex');
    assert.equal(read.implementer, 'claude');
    assert.equal(read.round, 1);
    assert.ok(read.startedAt, 'startedAt should be set');
  });
});

test('writeReviewState logs warning if git commit fails', () => {
  withTempMissionDir('task-rs-4c', (root, missionDir, slug) => {
    const { writeReviewState } = require('../lib/review/review-state');
    const logs = [];
    const originalLog = console.log;
    console.log = (msg) => logs.push(msg);

    try {
      const gitFn = (args) => {
        if (args.includes('commit')) {
          return { status: 1, stderr: 'commit failed' };
        }
        if (args.includes('status')) {
          return { status: 0, stdout: 'M docs/missions/2026/task-rs-4c/review-state.json\n', stderr: '' };
        }
        return { status: 0, stdout: '', stderr: '' };
      };
      const state = { reviewer: 'codex', implementer: 'claude', round: 1 };
      const ok = writeReviewState(slug, state, root, gitFn);
      assert.equal(ok, true);
      assert.ok(logs.some(l => l.includes('Failed to commit review state update')));
    } finally {
      console.log = originalLog;
    }
  });
});

test('writeReviewState commits in the provided worktree even from the wrong cwd', () => {
  withTempMissionDir('task-rs-4b', (root, missionDir, slug) => {
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-state-outside-'));
    const previous = process.cwd();

    try {
      process.chdir(outsideDir);
      const { writeReviewState } = require('../lib/review/review-state');
      const ok = writeReviewState(slug, { reviewer: 'codex', implementer: 'claude', round: 2 }, root);
      assert.equal(ok, true);

      const { spawnSync } = require('child_process');
      const status = spawnSync('git', ['status', '--short'], { cwd: root, encoding: 'utf8' });
      assert.equal(status.stdout.trim(), '');
    } finally {
      process.chdir(previous);
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });
});

test('readReviewState reads from the provided rootDir, not process.cwd()', () => {
  withTempMissionDir('task-rs-cross-cwd', (root, missionDir, slug) => {
    const stateFile = path.join(missionDir, 'review-state.json');
    fs.writeFileSync(stateFile, JSON.stringify({ reviewer: 'codex', implementer: 'gemini', round: 2, startedAt: '2026-01-01T00:00:00.000Z' }), 'utf8');

    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-state-cross-'));
    const previous = process.cwd();
    try {
      process.chdir(outsideDir);
      const { readReviewState } = require('../lib/review/review-state');
      // Without rootDir: should return null (outsideDir has no mission)
      assert.equal(readReviewState(slug), null);
      // With rootDir pointing at the worktree: should find the state
      const state = readReviewState(slug, root);
      assert.ok(state, 'state should be readable via explicit rootDir even when cwd is wrong');
      assert.equal(state.reviewer, 'codex');
      assert.equal(state.implementer, 'gemini');
      assert.equal(state.round, 2);
    } finally {
      process.chdir(previous);
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });
});

test('resetReviewState returns false when no state exists', () => {
  withTempMissionDir('task-rs-5', (root, missionDir, slug) => {
    const { resetReviewState } = require('../lib/review/review-state');
    assert.equal(resetReviewState(slug), false);
  });
});

test('resetReviewState removes the state file', () => {
  withTempMissionDir('task-rs-6', (root, missionDir, slug) => {
    const stateFile = path.join(missionDir, 'review-state.json');
    fs.writeFileSync(stateFile, JSON.stringify({ reviewer: 'codex', implementer: 'claude', round: 1 }), 'utf8');

    const { resetReviewState, readReviewState } = require('../lib/review/review-state');

    const deleted = resetReviewState(slug);
    assert.equal(deleted, true);
    assert.equal(fs.existsSync(stateFile), false);
    assert.equal(readReviewState(slug), null);
  });
});
