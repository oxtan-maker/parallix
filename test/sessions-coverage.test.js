const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');

const sessions = require('../lib/tools/sessions');

function withTempWorktree(run) {
  const tmpRoot = require('fs').mkdtempSync(path.join(os.tmpdir(), 'sessions-coverage-'));
  try {
    run(tmpRoot);
  } finally {
    require('fs').rmSync(tmpRoot, { recursive: true, force: true });
  }
}

// ---------- sessionsDir / sessionFile ----------

test('sessionsDir returns the expected path', () => {
  assert.equal(sessions.sessionsDir('/tmp/worktree'), '/tmp/worktree/.workflow/sessions');
});

test('sessionFile returns the expected filename', () => {
  const file = sessions.sessionFile('/tmp/worktree', 'task-1', 'implementer');
  assert.equal(file, '/tmp/worktree/.workflow/sessions/task-1-implementer.json');
});

// ---------- writeSession ----------

test('writeSession creates the sessions directory', () => {
  withTempWorktree(worktree => {
    const ok = sessions.writeSession(worktree, 'task-1', 'reviewer', { agent: 'claude' });
    assert.equal(ok, true);
    assert.ok(require('fs').existsSync(sessions.sessionsDir(worktree)));
  });
});

test('writeSession persists lastLaunched timestamp', () => {
  withTempWorktree(worktree => {
    sessions.writeSession(worktree, 'task-1', 'implementer', { agent: 'codex' });
    const marker = sessions.readSession(worktree, 'task-1', 'implementer');
    assert.match(marker.lastLaunched, /^\d{4}-\d{2}-\d{2}T/);
  });
});

// ---------- shouldResume ----------

test('shouldResume returns false when no prior session exists', () => {
  withTempWorktree(worktree => {
    assert.equal(sessions.shouldResume(worktree, 'task-1', 'implementer', 'claude'), false);
  });
});

test('shouldResume returns true when prior agent matches', () => {
  withTempWorktree(worktree => {
    sessions.writeSession(worktree, 'task-1', 'implementer', { agent: 'claude' });
    assert.equal(sessions.shouldResume(worktree, 'task-1', 'implementer', 'claude'), true);
  });
});

// ---------- clearSession ----------

test('clearSession returns false when no session exists', () => {
  withTempWorktree(worktree => {
    assert.equal(sessions.clearSession(worktree, 'task-1', 'implementer'), false);
  });
});

test('clearSession returns true and removes the file', () => {
  withTempWorktree(worktree => {
    sessions.writeSession(worktree, 'task-1', 'implementer', { agent: 'claude' });
    assert.equal(sessions.clearSession(worktree, 'task-1', 'implementer'), true);
    assert.equal(sessions.readSession(worktree, 'task-1', 'implementer'), null);
  });
});
