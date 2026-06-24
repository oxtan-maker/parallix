const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');

const gatekeeper = require('../lib/tools/gatekeeper');
const { DEFAULT_GATEKEEPER_USER } = gatekeeper;

function withTempRoot(run) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gatekeeper-test-'));
  try {
    run(tmpRoot);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

// ---------- checkMandatoryFiles ----------

test('checkMandatoryFiles returns ok when MISSION.md, checkpoint, and backlog task exist', () => {
  withTempRoot(rootDir => {
    // Create mission directory with MISSION.md and a checkpoint doc
    const missionDir = path.join(rootDir, 'docs', 'missions', '2026', 'task-gk-001');
    fs.mkdirSync(missionDir, { recursive: true });
    fs.writeFileSync(path.join(missionDir, 'MISSION.md'), '# Task GK 001');
    fs.writeFileSync(path.join(missionDir, 'CP-1.md'), '# CP-1');

    // Create backlog task file
    const tasksDir = path.join(rootDir, 'backlog', 'tasks');
    fs.mkdirSync(tasksDir, { recursive: true });
    fs.writeFileSync(path.join(tasksDir, 'task-gk-001 - test task.md'), 'status: active');

    const result = gatekeeper.checkMandatoryFiles('task-gk-001', { rootDir });
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(result.missing, []);
  });
});

test('checkMandatoryFiles flags missing MISSION.md', () => {
  withTempRoot(rootDir => {
    // Create mission directory but no MISSION.md
    const missionDir = path.join(rootDir, 'docs', 'missions', '2026', 'task-gk-002');
    fs.mkdirSync(missionDir, { recursive: true });
    fs.writeFileSync(path.join(missionDir, 'CP-1.md'), '# CP-1');

    const tasksDir = path.join(rootDir, 'backlog', 'tasks');
    fs.mkdirSync(tasksDir, { recursive: true });
    fs.writeFileSync(path.join(tasksDir, 'task-gk-002 - test task.md'), 'status: active');

    const result = gatekeeper.checkMandatoryFiles('task-gk-002', { rootDir });
    assert.strictEqual(result.ok, false);
    assert.ok(result.missing.some(m => m.includes('MISSION.md')));
  });
});

test('checkMandatoryFiles flags missing checkpoint documents', () => {
  withTempRoot(rootDir => {
    const missionDir = path.join(rootDir, 'docs', 'missions', '2026', 'task-gk-003');
    fs.mkdirSync(missionDir, { recursive: true });
    fs.writeFileSync(path.join(missionDir, 'MISSION.md'), '# Task GK 003');

    const tasksDir = path.join(rootDir, 'backlog', 'tasks');
    fs.mkdirSync(tasksDir, { recursive: true });
    fs.writeFileSync(path.join(tasksDir, 'task-gk-003 - test task.md'), 'status: active');

    const result = gatekeeper.checkMandatoryFiles('task-gk-003', { rootDir });
    assert.strictEqual(result.ok, false);
    assert.ok(result.missing.some(m => m.includes('CP-')));
  });
});

test('checkMandatoryFiles accepts missing backlog task file when mission artifacts exist', () => {
  withTempRoot(rootDir => {
    const missionDir = path.join(rootDir, 'docs', 'missions', '2026', 'task-gk-004');
    fs.mkdirSync(missionDir, { recursive: true });
    fs.writeFileSync(path.join(missionDir, 'MISSION.md'), '# Task GK 004');
    fs.writeFileSync(path.join(missionDir, 'CP-1.md'), '# CP-1');

    const result = gatekeeper.checkMandatoryFiles('task-gk-004', { rootDir });
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(result.missing, []);
  });
});

test('checkMandatoryFiles flags all three missing when mission dir does not exist', () => {
  withTempRoot(rootDir => {
    const result = gatekeeper.checkMandatoryFiles('task-gk-missing', { rootDir });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.missing.length, 3);
    assert.ok(result.missing.some(m => m.includes('MISSION.md')));
    assert.ok(result.missing.some(m => m.includes('CP-')));
    assert.ok(result.missing.some(m => m.includes('backlog/tasks')));
  });
});

test('checkMandatoryFiles accepts custom findMissionDirFn and findCheckpointsFn', async (t) => {
  withTempRoot(rootDir => {
    const missionDir = path.join(rootDir, 'docs', 'missions', '2026', 'task-custom');
    fs.mkdirSync(missionDir, { recursive: true });
    fs.writeFileSync(path.join(missionDir, 'MISSION.md'), '# Task Custom');
    fs.writeFileSync(path.join(missionDir, 'CP-1.md'), '# CP-1');

    const tasksDir = path.join(rootDir, 'backlog', 'tasks');
    fs.mkdirSync(tasksDir, { recursive: true });
    fs.writeFileSync(path.join(tasksDir, 'task-custom - test task.md'), 'status: active');

    const result = gatekeeper.checkMandatoryFiles('task-custom', {
      rootDir,
      findMissionDirFn: (slug, root) => {
        assert.strictEqual(slug, 'task-custom');
        assert.strictEqual(root, rootDir);
        return missionDir;
      },
      findCheckpointsFn: (dir) => {
        assert.strictEqual(dir, missionDir);
        return ['CP-1.md'];
      },
      resolveTaskFileFn: (slug, root) => {
        assert.strictEqual(slug, 'task-custom');
        return { ok: true, taskFile: path.join(tasksDir, 'task-custom - test task.md') };
      }
    });
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(result.missing, []);
  });
});

// ---------- buildPushbackBody ----------

test('buildPushbackBody formats a readable pushback comment', () => {
  const body = gatekeeper.buildPushbackBody('task-gk-005', [
    'docs/missions/2025/task-gk-005/MISSION.md',
    'backlog/tasks/task-gk-005 - *.md'
  ]);
  assert.ok(body.includes('Pre-review gatekeeper: missing mandatory artifacts'));
  assert.ok(body.includes('task-gk-005'));
  assert.ok(body.includes('MISSION.md'));
  assert.ok(body.includes('backlog/tasks'));
  assert.ok(body.includes('Push the missing artifacts'));
});

test('buildPushbackBody handles empty missing list', () => {
  const body = gatekeeper.buildPushbackBody('task-gk-006', []);
  assert.ok(body.includes('Pre-review gatekeeper: missing mandatory artifacts'));
  assert.ok(body.includes('task-gk-006'));
});

// ---------- runGatekeeper ----------

test('runGatekeeper returns ok=true when all artifacts present and does not post', async (t) => {
  withTempRoot(rootDir => {
    const missionDir = path.join(rootDir, 'docs', 'missions', '2026', 'task-gk-007');
    fs.mkdirSync(missionDir, { recursive: true });
    fs.writeFileSync(path.join(missionDir, 'MISSION.md'), '# Task GK 007');
    fs.writeFileSync(path.join(missionDir, 'CP-1.md'), '# CP-1');

    const tasksDir = path.join(rootDir, 'backlog', 'tasks');
    fs.mkdirSync(tasksDir, { recursive: true });
    fs.writeFileSync(path.join(tasksDir, 'task-gk-007 - test task.md'), 'status: active');

    const logLines = [];
    const result = gatekeeper.runGatekeeper('task-gk-007', {
      rootDir,
      log: (msg) => logLines.push(msg),
      readTokenFn: () => 'fake-token',
      postReviewFn: () => { throw new Error('should not be called'); },
      checkFn: (slug) => gatekeeper.checkMandatoryFiles(slug, { rootDir })
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.posted, false);
    assert.strictEqual(result.missing.length, 0);
  });
});

test('runGatekeeper skips posting when no Forgejo token is available and artifacts are missing', async (t) => {
  withTempRoot(rootDir => {
    const logLines = [];
    const result = gatekeeper.runGatekeeper('task-gk-008', {
      rootDir,
      log: (msg) => logLines.push(msg),
      readTokenFn: () => null, // no token
      postReviewFn: () => { throw new Error('should not be called'); },
      checkFn: () => ({ ok: false, missing: ['docs/missions/2026/task-gk-008/MISSION.md'] })
    });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.posted, false);
    assert.strictEqual(result.skipped, true);
    assert.ok(logLines.some(l => l.includes('[WARN] Gatekeeper: no Forgejo token')));
  });
});

test('runGatekeeper posts request-changes when artifacts are missing', async (t) => {
  withTempRoot(rootDir => {
    const logLines = [];
    let postReviewCalled = false;
    let postReviewArgs = null;

    const result = gatekeeper.runGatekeeper('task-gk-009', {
      rootDir,
      log: (msg) => logLines.push(msg),
      readTokenFn: () => 'fake-token',
      postReviewFn: (branch, token, outcome, body) => {
        postReviewCalled = true;
        postReviewArgs = { branch, token, outcome, body };
        return { ok: true };
      },
      checkFn: () => ({ ok: false, missing: ['docs/missions/2026/task-gk-009/MISSION.md'] })
    });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.posted, true);
    assert.strictEqual(result.skipped, false);
    assert.strictEqual(postReviewCalled, true);
    assert.strictEqual(postReviewArgs.outcome, 'request-changes');
    assert.ok(postReviewArgs.body.includes('Pre-review gatekeeper'));
    assert.ok(logLines.some(l => l.includes('[INFO] Gatekeeper: posting request-changes')));
  });
});

test('runGatekeeper handles postReview failure gracefully', async (t) => {
  withTempRoot(rootDir => {
    const logLines = [];
    const result = gatekeeper.runGatekeeper('task-gk-010', {
      rootDir,
      log: (msg) => logLines.push(msg),
      readTokenFn: () => 'fake-token',
      postReviewFn: () => ({ ok: false, error: 'network error' }),
      checkFn: () => ({ ok: false, missing: ['docs/missions/2026/task-gk-010/MISSION.md'] })
    });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.posted, false);
    assert.ok(logLines.some(l => l.includes('[WARN] Gatekeeper: pushback post failed')));
  });
});

test('runGatekeeper uses custom branch and user from options', async (t) => {
  withTempRoot(rootDir => {
    let postReviewArgs = null;
    const result = gatekeeper.runGatekeeper('task-gk-011', {
      rootDir,
      branch: 'custom/branch',
      user: 'custom-gatekeeper',
      log: () => {},
      readTokenFn: (user) => {
        assert.strictEqual(user, 'custom-gatekeeper');
        return 'fake-token';
      },
      postReviewFn: (branch, token, outcome, body) => {
        postReviewArgs = { branch, token, outcome };
        return { ok: true };
      },
      checkFn: () => ({ ok: false, missing: ['docs/missions/2026/task-gk-011/MISSION.md'] })
    });

    assert.strictEqual(result.posted, true);
    assert.strictEqual(postReviewArgs.branch, 'custom/branch');
  });
});

// ---------- DEFAULT_GATEKEEPER_USER ----------

test('DEFAULT_GATEKEEPER_USER is forgejo-gatekeeper', () => {
  assert.strictEqual(DEFAULT_GATEKEEPER_USER, 'forgejo-gatekeeper');
});
