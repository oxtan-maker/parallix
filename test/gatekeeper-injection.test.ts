import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  checkMandatoryFiles,
  buildPushbackBody,
  runGatekeeper,
  DEFAULT_GATEKEEPER_USER,
} from '../src/adapters/verification/gatekeeper.js';

// Pure, injectable gatekeeper paths. No real Forgejo, no real git, no
// mock.module: every external seam (filesystem resolution, token read, review
// post, mandatory-file check) is passed in as a double so the whole suite stays
// hermetic under the coverage gate.
function withTempRoot(run: (rootDir: string) => void): void {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gk-inject-'));
  try { run(tmpRoot); } finally { fs.rmSync(tmpRoot, { recursive: true, force: true }); }
}

const okResolution = { ok: true, taskFile: 'backlog/tasks/task-1 - x.md' } as const;

test('DEFAULT_GATEKEEPER_USER is the forgejo-gatekeeper sentinel', () => {
  assert.equal(DEFAULT_GATEKEEPER_USER, 'forgejo-gatekeeper');
});

test('checkMandatoryFiles returns ok when every mandatory artifact is present', () => {
  withTempRoot(rootDir => {
    const missionDir = path.join(rootDir, 'docs', 'missions', '2026', 'task-1');
    fs.mkdirSync(missionDir, { recursive: true });
    fs.writeFileSync(path.join(missionDir, 'MISSION.md'), '# Task 1');
    fs.writeFileSync(path.join(missionDir, 'CP-1.md'), '# CP-1');
    const tasksDir = path.join(rootDir, 'backlog', 'tasks');
    fs.mkdirSync(tasksDir, { recursive: true });
    fs.writeFileSync(path.join(tasksDir, 'task-1 - x.md'), 'status: active');

    const result = checkMandatoryFiles('task-1', {
      rootDir,
      findMissionDirFn: (_slug, dir) => dir ? path.join(dir, 'docs', 'missions', '2026', 'task-1') : undefined,
      findCheckpointsFn: (_dir) => ['CP-1.md'],
      resolveTaskFileFn: () => okResolution,
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.missing, []);
  });
});

test('checkMandatoryFiles flags a missing MISSION.md', () => {
  withTempRoot(rootDir => {
    const result = checkMandatoryFiles('task-1', {
      rootDir,
      findMissionDirFn: () => '/nope/mission',
      findCheckpointsFn: () => ['CP-1.md'],
      resolveTaskFileFn: () => okResolution,
    });
    assert.equal(result.ok, false);
    assert.ok(result.missing.some(item => item.includes('MISSION.md')));
  });
});

test('checkMandatoryFiles flags missing checkpoint documents when the mission dir is empty', () => {
  withTempRoot(rootDir => {
    const missionDir = path.join(rootDir, 'docs', 'missions', '2026', 'task-1');
    fs.mkdirSync(missionDir, { recursive: true });
    fs.writeFileSync(path.join(missionDir, 'MISSION.md'), '# Task 1');
    const result = checkMandatoryFiles('task-1', {
      rootDir,
      findMissionDirFn: (_slug, dir) => dir ? missionDir : undefined,
      findCheckpointsFn: (_dir) => [],
      resolveTaskFileFn: () => okResolution,
    });
    assert.equal(result.ok, false);
    assert.ok(result.missing.some(item => item.includes('CP-*.md')));
  });
});

test('checkMandatoryFiles flags CP-*.md when the mission dir cannot be resolved', () => {
  withTempRoot(rootDir => {
    const result = checkMandatoryFiles('task-1', {
      rootDir,
      findMissionDirFn: () => undefined,
      findCheckpointsFn: () => [],
      resolveTaskFileFn: () => ({ ok: false, reason: 'no task' }),
    });
    assert.equal(result.ok, false);
    assert.ok(result.missing.some(item => item.includes('CP-*.md')));
  });
});

test('checkMandatoryFiles flags the backlog task when resolution fails and no mission artifacts exist', () => {
  withTempRoot(rootDir => {
    const result = checkMandatoryFiles('task-1', {
      rootDir,
      findMissionDirFn: () => undefined,
      findCheckpointsFn: () => [],
      resolveTaskFileFn: () => ({ ok: false, reason: 'missing' }),
    });
    assert.equal(result.ok, false);
    assert.ok(result.missing.some(item => item.includes('backlog/tasks') || item.includes('backlog/task')));
  });
});

test('checkMandatoryFiles does not flag the backlog task when mission artifacts are present despite a bad resolution', () => {
  withTempRoot(rootDir => {
    const missionDir = path.join(rootDir, 'docs', 'missions', '2026', 'task-1');
    fs.mkdirSync(missionDir, { recursive: true });
    fs.writeFileSync(path.join(missionDir, 'MISSION.md'), '# Task 1');
    fs.writeFileSync(path.join(missionDir, 'CP-1.md'), '# CP-1');
    const result = checkMandatoryFiles('task-1', {
      rootDir,
      findMissionDirFn: (_slug, dir) => dir ? missionDir : undefined,
      findCheckpointsFn: (_dir) => ['CP-1.md'],
      resolveTaskFileFn: () => ({ ok: false, reason: 'missing' }),
    });
    assert.equal(result.ok, true);
  });
});

test('buildPushbackBody emits creation instructions for every detected artifact type', () => {
  const body = buildPushbackBody('task-1', [
    'missions/2026/task-1/MISSION.md',
    'missions/2026/task-1/CP-*.md',
    'backlog/tasks/task-1 - x.md',
  ]);
  assert.ok(body.includes('create** `MISSION.md`'));
  assert.ok(body.includes('create** at least one checkpoint document'));
  assert.ok(body.includes('create** a backlog task file'));
  assert.ok(body.includes('Suggested artifact-creation steps'));
});

test('buildPushbackBody omits instructions for artifact types not in the missing list', () => {
  const body = buildPushbackBody('task-1', ['backlog/tasks/task-1 - x.md']);
  assert.ok(body.includes('create** a backlog task file'));
  assert.ok(!body.includes('create** `MISSION.md`'));
  assert.ok(!body.includes('create** at least one checkpoint document'));
});

test('buildPushbackBody renders an empty instructions block when there are no recognized artifact types', () => {
  const body = buildPushbackBody('task-1', ['some/other/file.txt']);
  assert.ok(!body.includes('Suggested artifact-creation steps'));
});

test('runGatekeeper short-circuits with ok when the mandatory-file check passes', () => {
  const posted = runGatekeeper('task-1', {
    branch: 'mission/task-1',
    log: () => '',
    checkFn: () => ({ ok: true, missing: [] }),
    readTokenFn: () => 'token',
    postReviewFn: () => ({ ok: true }),
  });
  assert.equal(posted.ok, true);
  assert.equal(posted.posted, false);
  assert.equal(posted.skipped, false);
});

test('runGatekeeper skips pushback when no Forgejo token is available', () => {
  const posted = runGatekeeper('task-1', {
    branch: 'mission/task-1',
    user: 'claude',
    log: () => '',
    checkFn: () => ({ ok: false, missing: ['MISSION.md'] }),
    readTokenFn: () => null,
    postReviewFn: () => { throw new Error('should not post'); },
  });
  assert.equal(posted.skipped, true);
  assert.equal(posted.posted, false);
  assert.deepEqual(posted.missing, ['MISSION.md']);
});

test('runGatekeeper posts a request-changes review on a clean token', () => {
  const posted = runGatekeeper('task-1', {
    branch: 'mission/task-1',
    log: () => '',
    checkFn: () => ({ ok: false, missing: ['MISSION.md'] }),
    readTokenFn: () => 'secret',
    postReviewFn: (branch, _token, state, body) => {
      assert.equal(branch, 'mission/task-1');
      assert.equal(state, 'request-changes');
      assert.ok(body.includes('gatekeeper'));
      return { ok: true };
    },
  });
  assert.equal(posted.posted, true);
  assert.equal(posted.ok, false);
});

test('runGatekeeper reports a failed postReview as skipped=false and posted=false', () => {
  const posted = runGatekeeper('task-1', {
    branch: 'mission/task-1',
    log: () => '',
    checkFn: () => ({ ok: false, missing: ['MISSION.md'] }),
    readTokenFn: () => 'secret',
    postReviewFn: () => ({ ok: false, error: '403 forbidden' }),
  });
  assert.equal(posted.posted, false);
  assert.equal(posted.skipped, false);
  assert.ok(posted.missing.includes('MISSION.md'));
});
