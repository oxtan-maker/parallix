const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ReviewState, readReviewState, normalizeReviewPhase } = require('../lib/review/review-state');
const fmt = require('../lib/core/fmt');

function withTempMissionDir(slug, fn) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'review-state-class-test-'));

  const missionDir = path.join(tmpRoot, 'docs', 'missions', '2026', slug);
  fs.mkdirSync(missionDir, { recursive: true });
  fs.writeFileSync(path.join(missionDir, 'MISSION.md'), `# Mission: ${slug}\n`);

  const tasksDir = path.join(tmpRoot, 'backlog', 'tasks');
  fs.mkdirSync(tasksDir, { recursive: true });

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

test('ReviewState class can be instantiated and saved', () => {
  withTempMissionDir('task-class-1', (root, missionDir, slug) => {
    const state = new ReviewState(slug, {
      reviewer: 'gemini',
      implementer: 'claude',
      round: 2,
      phase: 'fixing',
      disposition: 'REQUEST_CHANGES',
      metadata: { foo: 'bar' }
    });

    assert.equal(state.reviewer, 'gemini');
    assert.equal(state.phase, 'fixing');
    assert.equal(state.disposition, 'REQUEST_CHANGES');
    assert.deepEqual(state.metadata, { foo: 'bar' });

    const ok = state.save(root);
    assert.equal(ok, true);

    const loaded = readReviewState(slug, root);
    assert.ok(loaded instanceof ReviewState);
    assert.equal(loaded.reviewer, 'gemini');
    assert.equal(loaded.phase, 'fixing');
    assert.equal(loaded.disposition, 'REQUEST_CHANGES');
    assert.deepEqual(loaded.metadata, { foo: 'bar' });
  });
});

test('ReviewState toJSON excludes empty retry counts and metadata', () => {
  const state = new ReviewState('task-1', {
    reviewer: 'gemini',
    implementer: 'claude'
  });

  const json = state.toJSON();
  assert.equal(json.reviewerRetryCount, undefined);
  assert.equal(json.implementerRetryCount, undefined);
  assert.equal(json.metadata, undefined);
});

test('ReviewState toJSON includes retry counts and metadata when present', () => {
  const state = new ReviewState('task-1', {
    reviewer: 'gemini',
    implementer: 'claude',
    reviewerRetryCount: 1,
    metadata: { key: 'value' }
  });

  const json = state.toJSON();
  assert.equal(json.reviewerRetryCount, 1);
  assert.equal(json.implementerRetryCount, undefined);
  assert.deepEqual(json.metadata, { key: 'value' });
});

test('ReviewState.from wraps a plain object into a ReviewState', () => {
  const plain = { reviewer: 'gemini', implementer: 'claude', round: 3, phase: 'fixing' };
  const state = ReviewState.from('task-from-1', plain);
  assert.ok(state instanceof ReviewState);
  assert.equal(state.slug, 'task-from-1');
  assert.equal(state.round, 3);
  assert.equal(state.phase, 'fixing');
});

test('ReviewState.from returns same instance if already a ReviewState', () => {
  const original = new ReviewState('task-from-2', { reviewer: 'a', implementer: 'b' });
  const result = ReviewState.from('task-from-2', original);
  assert.equal(result, original);
});

test('ReviewState.from rejects an instance for a different slug', () => {
  const original = new ReviewState('task-from-3', { reviewer: 'a', implementer: 'b' });
  assert.throws(
    () => ReviewState.from('task-from-other', original),
    /ReviewState slug mismatch: expected "task-from-other", got "task-from-3"/
  );
});

test('transitionTo allows valid phase transitions', () => {
  const state = new ReviewState('task-t1', { reviewer: 'a', implementer: 'b' });
  assert.equal(state.phase, 'reviewing');
  state.transitionTo('fixing');
  assert.equal(state.phase, 'fixing');
  state.transitionTo('reviewing');
  assert.equal(state.phase, 'reviewing');
  state.transitionTo('approved');
  assert.equal(state.phase, 'approved');
});

test('transitionTo rejects invalid phase transitions', () => {
  const state = new ReviewState('task-t2', { reviewer: 'a', implementer: 'b' });
  assert.throws(() => state.transitionTo('approved-wrong'), /Invalid phase/);
  assert.throws(() => state.transitionTo('pending-approval'), /Cannot transition from "reviewing" to "pending-approval"/);
});

test('transitionTo rejects transitions from approved', () => {
  const state = new ReviewState('task-t3', { reviewer: 'a', implementer: 'b', phase: 'approved' });
  assert.throws(() => state.transitionTo('reviewing'), /Cannot transition from "approved"/);
});

test('normalizeReviewPhase repairs the rewiewing typo to reviewing', () => {
  assert.deepEqual(normalizeReviewPhase('rewiewing'), {
    phase: 'reviewing',
    original: 'rewiewing',
    normalized: true
  });
});

test('normalizeReviewPhase falls back from unknown values using disposition', () => {
  assert.deepEqual(normalizeReviewPhase('totally-wrong', 'PUSHBACK_ALL'), {
    phase: 'fixing',
    original: 'totally-wrong',
    normalized: true
  });
});

test('advanceRound increments round and resets phase/disposition/retries', () => {
  const oldTimestamp = '2025-01-01T00:00:00.000Z';
  const state = new ReviewState('task-adv', {
    reviewer: 'a', implementer: 'b', round: 2,
    startedAt: oldTimestamp,
    phase: 'fixing', disposition: 'CHANGES_REQUESTED',
    reviewerRetryCount: 1, implementerRetryCount: 2
  });
  state.advanceRound();
  assert.equal(state.round, 3);
  assert.equal(state.phase, 'reviewing');
  assert.equal(state.disposition, null);
  assert.equal(state.reviewerRetryCount, 0);
  assert.equal(state.implementerRetryCount, 0);
  assert.notEqual(state.startedAt, oldTimestamp);
});

test('ReviewState save treats unchanged state as a successful no-op', () => {
  withTempMissionDir('task-save-noop', (root, missionDir, slug) => {
    const state = new ReviewState(slug, {
      reviewer: 'gemini',
      implementer: 'claude',
      phase: 'fixing'
    });
    const gitCalls = [];
    const gitFn = (args) => {
      gitCalls.push(args);
      if (args.includes('commit')) return { status: 1, stderr: 'nothing to commit, working tree clean' };
      if (args.includes('status')) return { status: 0, stdout: '' };
      return { status: 0, stdout: '', stderr: '' };
    };

    assert.equal(state.save(root, gitFn), true);
    assert.ok(gitCalls.some(args => args.includes('status') && args.includes('--porcelain')));
  });
});

test('ReviewState save warns when commit fails and state file remains changed', () => {
  withTempMissionDir('task-save-fail', (root, missionDir, slug) => {
    const state = new ReviewState(slug, {
      reviewer: 'gemini',
      implementer: 'claude',
      phase: 'fixing'
    });
    const warnings = [];
    const previousLogger = fmt.setLogger({
      log: (message) => warnings.push(message),
      error: () => {}
    });
    const gitFn = (args) => {
      if (args.includes('commit')) return { status: 1, stderr: 'commit failed' };
      if (args.includes('status')) return { status: 0, stdout: 'M docs/missions/2026/task-save-fail/review-state.json\n' };
      return { status: 0, stdout: '', stderr: '' };
    };

    try {
      assert.equal(state.save(root, gitFn), true);
    } finally {
      fmt.setLogger(previousLogger);
    }

    assert.ok(warnings.some(message => message.includes('Failed to commit review state update: commit failed')));
  });
});
