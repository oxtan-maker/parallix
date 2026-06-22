const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const sessions = require('../lib/tools/sessions');

function withTempWorktree(run) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sessions-test-'));
  try {
    run(tmpRoot);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

test('readSession returns null when no marker exists', () => {
  withTempWorktree(worktree => {
    assert.equal(sessions.readSession(worktree, 'task-1025', 'implementer'), null);
  });
});

test('writeSession then readSession returns the persisted agent and timestamp', () => {
  withTempWorktree(worktree => {
    const ok = sessions.writeSession(worktree, 'task-1025', 'implementer', { agent: 'claude' });
    assert.equal(ok, true);
    const marker = sessions.readSession(worktree, 'task-1025', 'implementer');
    assert.equal(marker.agent, 'claude');
    assert.match(marker.lastLaunched, /^\d{4}-\d{2}-\d{2}T/);
  });
});

test('writeSession refuses payload without an agent string', () => {
  withTempWorktree(worktree => {
    assert.equal(sessions.writeSession(worktree, 'task-1025', 'implementer', {}), false);
    assert.equal(sessions.writeSession(worktree, 'task-1025', 'implementer', null), false);
  });
});

test('shouldResume returns true only when the prior agent matches', () => {
  withTempWorktree(worktree => {
    sessions.writeSession(worktree, 'task-1025', 'implementer', { agent: 'claude' });
    assert.equal(sessions.shouldResume(worktree, 'task-1025', 'implementer', 'claude'), true);
    // Different family invalidates the prior session — no resume.
    assert.equal(sessions.shouldResume(worktree, 'task-1025', 'implementer', 'codex'), false);
    // Different role does not see another role's marker.
    assert.equal(sessions.shouldResume(worktree, 'task-1025', 'reviewer', 'claude'), false);
  });
});

test('shouldResume returns false when worktree, slug, or role is missing', () => {
  assert.equal(sessions.shouldResume(null, 'task-1025', 'implementer', 'claude'), false);
  assert.equal(sessions.shouldResume('/tmp/x', null, 'implementer', 'claude'), false);
  assert.equal(sessions.shouldResume('/tmp/x', 'task-1025', null, 'claude'), false);
});

test('clearSession removes the marker file and reports whether it existed', () => {
  withTempWorktree(worktree => {
    sessions.writeSession(worktree, 'task-1025', 'reviewer', { agent: 'gemini' });
    assert.equal(sessions.clearSession(worktree, 'task-1025', 'reviewer'), true);
    assert.equal(sessions.readSession(worktree, 'task-1025', 'reviewer'), null);
    assert.equal(sessions.clearSession(worktree, 'task-1025', 'reviewer'), false);
  });
});

test('readSession ignores corrupt JSON without throwing', () => {
  withTempWorktree(worktree => {
    const file = sessions.sessionFile(worktree, 'task-1025', 'implementer');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{ not json', 'utf8');
    assert.equal(sessions.readSession(worktree, 'task-1025', 'implementer'), null);
  });
});

test('writeSession persists sessionId when provided', () => {
  withTempWorktree(worktree => {
    const ok = sessions.writeSession(worktree, 'task-1025', 'implementer', {
      agent: 'claude',
      sessionId: 'ses_abc123'
    });
    assert.equal(ok, true);
    const marker = sessions.readSession(worktree, 'task-1025', 'implementer');
    assert.equal(marker.sessionId, 'ses_abc123');
  });
});

test('writeSession persists null sessionId when not provided', () => {
  withTempWorktree(worktree => {
    const ok = sessions.writeSession(worktree, 'task-1025', 'implementer', { agent: 'claude' });
    assert.equal(ok, true);
    const marker = sessions.readSession(worktree, 'task-1025', 'implementer');
    assert.equal(marker.sessionId, null);
  });
});

test('getSessionId returns the persisted session ID or null', () => {
  withTempWorktree(worktree => {
    assert.equal(sessions.getSessionId(worktree, 'task-1025', 'implementer'), null);
    sessions.writeSession(worktree, 'task-1025', 'implementer', {
      agent: 'codex',
      sessionId: '18a15d16-ee3d-4a85-81c8-cbbc7b9c09a2'
    });
    assert.equal(
      sessions.getSessionId(worktree, 'task-1025', 'implementer'),
      '18a15d16-ee3d-4a85-81c8-cbbc7b9c09a2'
    );
  });
});
