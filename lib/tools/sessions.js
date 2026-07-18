"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sessionsDir = sessionsDir;
exports.sessionFile = sessionFile;
exports.readSession = readSession;
exports.writeSession = writeSession;
exports.shouldResume = shouldResume;
exports.getSessionId = getSessionId;
exports.clearSession = clearSession;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const storage_js_1 = require("../core/storage.js");
// Per-worktree session markers used by startAgent to decide whether to launch
// an agent fresh or with its family-specific resume flag. Stored under
// .workflow/sessions/ which is already gitignored, so markers live with the
// mission worktree and survive harness restarts but never travel through git.
/** @param {string} worktree */
function sessionsDir(worktree) {
    return path_1.default.join(worktree, '.workflow', 'sessions');
}
/** @param {string} worktree @param {string} slug @param {string} role */
function sessionFile(worktree, slug, role) {
    return path_1.default.join(sessionsDir(worktree), `${slug}-${role}.json`);
}
/** @param {string} worktree @param {string} slug @param {string} role */
function readSession(worktree, slug, role) {
    if (!worktree || !slug || !role) {
        return null;
    }
    const file = sessionFile(worktree, slug, role);
    if (!fs_1.default.existsSync(file)) {
        return null;
    }
    try {
        const parsed = JSON.parse(fs_1.default.readFileSync(file, 'utf8'));
        if (parsed && typeof parsed.agent === 'string') {
            return parsed;
        }
        return null;
    }
    catch (_) {
        return null;
    }
}
/** @param {string} worktree @param {string} slug @param {string} role @param {{agent: string, lastLaunched?: string, sessionId?: string|null}} payload */
function writeSession(worktree, slug, role, payload, writeJsonFn = storage_js_1.writeJson) {
    if (!worktree || !slug || !role || !payload || typeof payload.agent !== 'string') {
        return false;
    }
    const body = {
        agent: payload.agent,
        lastLaunched: payload.lastLaunched || new Date().toISOString(),
        sessionId: payload.sessionId || null
    };
    writeJsonFn(sessionFile(worktree, slug, role), body);
    return true;
}
// Resume only when the previous launch in this (slug, role) used the same
// agent family. A fallback to a different family invalidates the marker —
// the new family has no prior session to continue.
/** @param {string} worktree @param {string} slug @param {string} role @param {string} agent */
function shouldResume(worktree, slug, role, agent) {
    const prev = readSession(worktree, slug, role);
    return Boolean(prev && prev.agent === agent);
}
// Return the session ID from the marker, if one was persisted.
/** @param {string} worktree @param {string} slug @param {string} role */
function getSessionId(worktree, slug, role) {
    const prev = readSession(worktree, slug, role);
    return prev && prev.sessionId ? prev.sessionId : null;
}
/** @param {string} worktree @param {string} slug @param {string} role */
function clearSession(worktree, slug, role) {
    if (!worktree || !slug || !role) {
        return false;
    }
    const file = sessionFile(worktree, slug, role);
    if (!fs_1.default.existsSync(file)) {
        return false;
    }
    fs_1.default.unlinkSync(file);
    return true;
}
;
