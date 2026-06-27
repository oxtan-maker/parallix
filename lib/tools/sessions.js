const fs = require('fs');
const path = require('path');

// Per-worktree session markers used by startAgent to decide whether to launch
// an agent fresh or with its family-specific resume flag. Stored under
// .workflow/sessions/ which is already gitignored, so markers live with the
// mission worktree and survive harness restarts but never travel through git.

function sessionsDir(worktree) {
  return path.join(worktree, '.workflow', 'sessions');
}

function sessionFile(worktree, slug, role) {
  return path.join(sessionsDir(worktree), `${slug}-${role}.json`);
}

function readSession(worktree, slug, role) {
  if (!worktree || !slug || !role) {return null;}
  const file = sessionFile(worktree, slug, role);
  if (!fs.existsSync(file)) {return null;}
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (parsed && typeof parsed.agent === 'string') {return parsed;}
    return null;
  } catch (_) {
    return null;
  }
}

function writeSession(worktree, slug, role, payload) {
  if (!worktree || !slug || !role || !payload || typeof payload.agent !== 'string') {
    return false;
  }
  fs.mkdirSync(sessionsDir(worktree), { recursive: true });
  const body = {
    agent: payload.agent,
    lastLaunched: payload.lastLaunched || new Date().toISOString(),
    sessionId: payload.sessionId || null
  };
  fs.writeFileSync(sessionFile(worktree, slug, role), JSON.stringify(body, null, 2) + '\n', 'utf8');
  return true;
}

// Resume only when the previous launch in this (slug, role) used the same
// agent family. A fallback to a different family invalidates the marker —
// the new family has no prior session to continue.
function shouldResume(worktree, slug, role, agent) {
  const prev = readSession(worktree, slug, role);
  return Boolean(prev && prev.agent === agent);
}

// Return the session ID from the marker, if one was persisted.
function getSessionId(worktree, slug, role) {
  const prev = readSession(worktree, slug, role);
  return prev && prev.sessionId ? prev.sessionId : null;
}

function clearSession(worktree, slug, role) {
  if (!worktree || !slug || !role) {return false;}
  const file = sessionFile(worktree, slug, role);
  if (!fs.existsSync(file)) {return false;}
  fs.unlinkSync(file);
  return true;
}

module.exports = {
  sessionsDir,
  sessionFile,
  readSession,
  writeSession,
  shouldResume,
  getSessionId,
  clearSession
};
