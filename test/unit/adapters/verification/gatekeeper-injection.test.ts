import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkMandatoryFiles,
  buildPushbackBody,
  runGatekeeper,
  DEFAULT_GATEKEEPER_USER,
} from '../../../../src/adapters/verification/gatekeeper.js';

// Every Forgejo seam is injected; these checks stay hermetic.

test('DEFAULT_GATEKEEPER_USER is the forgejo-gatekeeper sentinel', () => {
  assert.equal(DEFAULT_GATEKEEPER_USER, 'forgejo-gatekeeper');
});

test("checkMandatoryFiles accepts a typed mission without legacy files", () => {
  assert.deepEqual(checkMandatoryFiles("task-1", { rootDir: "/nope", checkpointsRecorded: true }), { ok: true, missing: [] });
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
