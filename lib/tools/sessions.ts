import fs from 'fs';
import path from 'path';

// Per-worktree session markers used by startAgent to decide whether to launch
// an agent fresh or with its family-specific resume flag. Stored under
// .workflow/sessions/ which is already gitignored, so markers live with the
// mission worktree and survive harness restarts but never travel through git.

/** @param {string} worktree */
function sessionsDir(worktree: string) {
  return path.join(worktree, '.workflow', 'sessions');
}

/** @param {string} worktree @param {string} slug @param {string} role */
function sessionFile(worktree: string, slug: string, role: string) {
  return path.join(sessionsDir(worktree), `${slug}-${role}.json`);
}

/** @param {string} worktree @param {string} slug @param {string} role */
function readSession(worktree: string, slug: string, role: string) {
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

/** @param {string} worktree @param {string} slug @param {string} role @param {{agent: string, lastLaunched?: string, sessionId?: string|null}} payload */
function writeSession(worktree: string, slug: string, role: string, payload: {agent: string, lastLaunched?: string, sessionId?: string | null}) {
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
/** @param {string} worktree @param {string} slug @param {string} role @param {string} agent */
function shouldResume(worktree: string, slug: string, role: string, agent: string) {
  const prev = readSession(worktree, slug, role);
  return Boolean(prev && prev.agent === agent);
}

// Return the session ID from the marker, if one was persisted.
/** @param {string} worktree @param {string} slug @param {string} role */
function getSessionId(worktree: string, slug: string, role: string) {
  const prev = readSession(worktree, slug, role);
  return prev && prev.sessionId ? prev.sessionId : null;
}

/** @param {string} worktree @param {string} slug @param {string} role */
function clearSession(worktree: string, slug: string, role: string) {
  if (!worktree || !slug || !role) {return false;}
  const file = sessionFile(worktree, slug, role);
  if (!fs.existsSync(file)) {return false;}
  fs.unlinkSync(file);
  return true;
}


export { sessionsDir };
export { sessionFile };
export { readSession };
export { writeSession };
export { shouldResume };
export { getSessionId };
export { clearSession };
;
