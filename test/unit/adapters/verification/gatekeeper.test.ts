


import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { mockModule, installModuleMocks } from '../../../lib/module-mock.js';
import { mkdtemp as registeredMkdtemp } from '../../../helpers/temp-dir.js';
const gatekeeper = mockModule<typeof import('../../../../src/adapters/verification/gatekeeper.js')>('../../../../src/adapters/verification/gatekeeper.js', import.meta.url);
await installModuleMocks();
test.afterEach(() => mock.restoreAll());
const { DEFAULT_GATEKEEPER_USER } = gatekeeper;

function withTempRoot(run) {
  const tmpRoot = registeredMkdtemp('gatekeeper-test-');
  try {
    run(tmpRoot);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

// ---------- checkMandatoryFiles ----------

test("checkMandatoryFiles accepts a typed mission without legacy files", () => {
  const result = gatekeeper.checkMandatoryFiles("task-gk-typed", { rootDir: "/nope", checkpointsRecorded: true });
  assert.deepStrictEqual(result, { ok: true, missing: [] });
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

test('buildPushbackBody includes artifact-creation instructions for MISSION.md', () => {
  const body = gatekeeper.buildPushbackBody('task-gk-012', [
    'docs/missions/2026/task-gk-012/MISSION.md'
  ]);
  assert.ok(body.includes('create'));
  assert.ok(body.includes('MISSION.md'));
  assert.ok(body.includes('mission contract template'));
  assert.ok(body.includes('Suggested artifact-creation steps'));
});

test('buildPushbackBody includes artifact-creation instructions for checkpoint documents', () => {
  const body = gatekeeper.buildPushbackBody('task-gk-013', [
    'docs/missions/2026/task-gk-013/CP-*.md (at least one checkpoint document)'
  ]);
  assert.ok(body.includes('create'));
  assert.ok(body.includes('CP-1.md'));
  assert.ok(body.includes('Goal Check'));
  assert.ok(body.includes('Suggested artifact-creation steps'));
});

test('buildPushbackBody includes artifact-creation instructions for backlog task file', () => {
  const body = gatekeeper.buildPushbackBody('task-gk-014', [
    'backlog/tasks/task-gk-014 - *.md'
  ]);
  assert.ok(body.includes('create'));
  assert.ok(body.includes('backlog/tasks'));
  assert.ok(body.includes('frontmatter'));
  assert.ok(body.includes('Suggested artifact-creation steps'));
});

test('buildPushbackBody includes all three artifact-creation instructions when all are missing', () => {
  const body = gatekeeper.buildPushbackBody('task-gk-015', [
    'docs/missions/2026/task-gk-015/MISSION.md',
    'docs/missions/2026/task-gk-015/CP-*.md (at least one checkpoint document)',
    'backlog/tasks/task-gk-015 - *.md'
  ]);
  assert.ok(body.includes('MISSION.md'));
  assert.ok(body.includes('CP-1.md'));
  assert.ok(body.includes('backlog/tasks'));
  assert.ok(body.includes('Suggested artifact-creation steps'));
  // Verify all three instruction lines are present
  const instructionCount = (body.match(/- \*\*create\*\*/g) || []).length;
  assert.strictEqual(instructionCount, 3);
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
