"use strict";
/**
 * Reviewer-family persistence for the autonomous review loop.
 *
 * State is stored under the adapter-resolved mission directory on the mission branch.
 * Writing and committing state before each round ensures session-restart safety.
 *
 * Owned by the Node workflow harness (ADR 0037 / task-089).
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReviewState = exports.VALID_PHASES = void 0;
exports.assertReviewStatePersisted = assertReviewStatePersisted;
exports.persistReviewStateOrThrow = persistReviewStateOrThrow;
exports.reviewStateFile = reviewStateFile;
exports.readReviewState = readReviewState;
exports.resolveReviewIdentity = resolveReviewIdentity;
exports.normalizeReviewPhase = normalizeReviewPhase;
exports.writeReviewState = writeReviewState;
exports.resetReviewState = resetReviewState;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const git_js_1 = require("../core/git.js");
const mission_utils_js_1 = require("../core/mission-utils.js");
const storage_js_1 = require("../core/storage.js");
function diagnosticFrom(error, fallback) {
    if (error instanceof Error && error.message.trim()) {
        return error.message.trim();
    }
    const text = String(error || '').trim();
    return text || fallback;
}
function gitDiagnostic(result, fallback) {
    return String(result.stderr || result.stdout || '').trim() || fallback;
}
function assertReviewStatePersisted(result, context) {
    if (result === true || result === undefined) {
        return;
    }
    if (result === false) {
        throw new Error(`Review-state persistence failed for mission ${context.slug}, phase ${context.phase || 'unknown'}, round ${context.round ?? 'unknown'}: persistence returned false`);
    }
    if (!result || typeof result !== 'object' || !('outcome' in result)) {
        return;
    }
    const persistenceResult = result;
    if (persistenceResult.outcome === 'committed' || persistenceResult.outcome === 'unchanged') {
        return;
    }
    throw new Error(`Review-state persistence failed for mission ${context.slug}, phase ${context.phase || 'unknown'}, round ${context.round ?? 'unknown'}, stage ${persistenceResult.stage}: ${persistenceResult.diagnostic}`);
}
function persistReviewStateOrThrow(writeFn, slug, state, worktree) {
    const result = writeFn(slug, state, worktree);
    assertReviewStatePersisted(result, {
        slug,
        phase: state instanceof ReviewState ? state.phase : String(state.phase || 'unknown'),
        round: state instanceof ReviewState ? state.round : (typeof state.round === 'number' ? state.round : null)
    });
    return result;
}
/**
 * Return the path to the review-state file for a given slug.
 * Resolves using the same mission-dir discovery as other workflow commands.
 *
 * @param {string} slug
 * @param {string} [rootDir]
 * @returns {string|null}  Absolute path, or null if mission dir not found
 */
function reviewStateFile(slug, rootDir = process.cwd()) {
    const missionDir = (0, mission_utils_js_1.findMissionDir)(slug, rootDir);
    if (!missionDir) {
        return null;
    }
    return path.join(missionDir, 'review-state.json');
}
/**
 * Read the persisted review state for a mission.
 *
 * @param {string} slug
 * @param {string} [rootDir]  Directory to resolve the mission from (defaults to process.cwd())
 * @returns {ReviewState|null}
 */
function readReviewState(slug, rootDir = process.cwd()) {
    const statePath = reviewStateFile(slug, rootDir);
    if (!statePath || !fs.existsSync(statePath)) {
        return null;
    }
    try {
        const raw = fs.readFileSync(statePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && parsed.reviewer && parsed.implementer) {
            return new ReviewState(slug, parsed);
        }
        return null;
    }
    catch {
        return null;
    }
}
/**
 * Resolve the review-provider identity for a review workflow path.
 *
 * The normal contract is review-state-backed so standard review/handoff/rebase
 * paths do not require a provider identity env var to be exported.
 *
 * @param {string} slug
 * @param {string} [rootDir]
 * @param {{readReviewStateFn?: Function}} [options]
 * @returns {{ identityUser: string|null, commentIdentityUser: string|null, forgejoUser: string|null, commentForgejoUser: string|null, reviewState: ReviewState|null, source: 'review-state'|null }}
 */
function resolveReviewIdentity(slug, rootDir = process.cwd(), options = {}) {
    const readReviewStateFn = options.readReviewStateFn || readReviewState;
    const reviewState = readReviewStateFn(slug, rootDir);
    const reviewerUser = reviewState ? (reviewState.reviewer || reviewState.implementer || null) : null;
    const implementerUser = reviewState ? (reviewState.implementer || reviewState.reviewer || null) : null;
    return {
        identityUser: reviewerUser || null,
        commentIdentityUser: implementerUser || null,
        forgejoUser: reviewerUser || null,
        commentForgejoUser: implementerUser || null,
        reviewState,
        source: reviewerUser ? 'review-state' : null
    };
}
/**
 * Manager class for mission review state.
 * Expanded to include phase, disposition, and metadata for canonical state ownership.
 */
exports.VALID_PHASES = ['reviewing', 'fixing', 'pending-approval', 'approved'];
const PHASE_ALIASES = new Map([
    ['review', 'reviewing'],
    ['rewiewing', 'reviewing'],
    ['fix', 'fixing'],
    ['pending_approval', 'pending-approval'],
    ['pending approval', 'pending-approval']
]);
const PHASE_TRANSITIONS = {
    'reviewing': ['fixing', 'approved'],
    'fixing': ['reviewing', 'pending-approval'],
    'pending-approval': ['reviewing'],
    'approved': []
};
/** @param {string} disposition */
function inferPhaseFromDisposition(disposition) {
    switch (String(disposition || '').trim().toUpperCase()) {
        case 'APPROVED':
            return 'approved';
        case 'REQUEST_CHANGES':
        case 'COMMENT':
        case 'PUSHBACK_ALL':
        case 'BLOCKED':
        case 'PARKED':
            return 'fixing';
        case 'CHANGES_MADE':
            return 'reviewing';
        default:
            return 'reviewing';
    }
}
/** @param {string} phase @param {string} disposition */
function normalizeReviewPhase(phase, disposition) {
    if (!phase) {
        return { phase: 'reviewing', original: null, normalized: false };
    }
    const raw = String(phase).trim();
    const canonical = raw.toLowerCase().replace(/[_\s]+/g, '-');
    if (exports.VALID_PHASES.includes(canonical)) {
        return { phase: canonical, original: raw, normalized: canonical !== raw };
    }
    const alias = PHASE_ALIASES.get(raw.toLowerCase()) || PHASE_ALIASES.get(canonical);
    if (alias) {
        return { phase: alias, original: raw, normalized: true };
    }
    return {
        phase: inferPhaseFromDisposition(disposition),
        original: raw,
        normalized: true
    };
}
class ReviewState {
    slug;
    reviewer;
    implementer;
    round;
    startedAt;
    phase;
    disposition;
    reviewerRetryCount;
    implementerRetryCount;
    metadata;
    phaseOriginal;
    /**
     * @param {string} slug
     * @param {ReviewStateData} [data]
     */
    constructor(slug, data = {}) {
        const phaseInfo = normalizeReviewPhase(data.phase || '', data.disposition || '');
        this.slug = slug;
        this.reviewer = data.reviewer;
        this.implementer = data.implementer;
        this.round = data.round || 1;
        this.startedAt = data.startedAt || new Date().toISOString();
        this.phase = phaseInfo.phase;
        this.disposition = data.disposition || null;
        this.reviewerRetryCount = data.reviewerRetryCount || 0;
        this.implementerRetryCount = data.implementerRetryCount || 0;
        this.metadata = data.metadata || {};
        this.phaseOriginal = phaseInfo.normalized ? phaseInfo.original : null;
    }
    /**
     * @param {string} slug
     * @param {ReviewState|ReviewStateData} dataOrInstance
     * @returns {ReviewState}
     */
    static from(slug, dataOrInstance) {
        if (dataOrInstance instanceof ReviewState) {
            if (dataOrInstance.slug !== slug) {
                throw new Error(`ReviewState slug mismatch: expected "${slug}", got "${dataOrInstance.slug}"`);
            }
            return dataOrInstance;
        }
        return new ReviewState(slug, dataOrInstance || {});
    }
    /**
     * @param {string} nextPhase
     * @returns {ReviewState}
     */
    transitionTo(nextPhase) {
        if (!exports.VALID_PHASES.includes(nextPhase)) {
            throw new Error(`Invalid phase: "${nextPhase}". Valid: ${exports.VALID_PHASES.join(', ')}`);
        }
        const allowedArr = PHASE_TRANSITIONS[this.phase];
        if (!allowedArr || !allowedArr.includes(nextPhase)) {
            throw new Error(`Cannot transition from "${this.phase}" to "${nextPhase}". Allowed: ${(allowedArr || []).join(', ') || 'none'}`);
        }
        this.phase = nextPhase;
        return this;
    }
    advanceRound() {
        this.round += 1;
        this.phase = 'reviewing';
        this.disposition = null;
        this.reviewerRetryCount = 0;
        this.implementerRetryCount = 0;
        this.startedAt = new Date().toISOString();
        return this;
    }
    /**
     * @returns {{reviewer?: string, implementer?: string, round?: number, startedAt?: string, phase?: string, disposition?: string, reviewerRetryCount?: number, implementerRetryCount?: number, metadata?: {[key: string]: unknown}}}
     */
    toJSON() {
        const payload = {
            reviewer: this.reviewer,
            implementer: this.implementer,
            round: this.round,
            startedAt: this.startedAt,
            phase: this.phase,
            disposition: this.disposition || undefined
        };
        if (this.reviewerRetryCount > 0) {
            payload.reviewerRetryCount = this.reviewerRetryCount;
        }
        if (this.implementerRetryCount > 0) {
            payload.implementerRetryCount = this.implementerRetryCount;
        }
        if (Object.keys(this.metadata || {}).length > 0) {
            payload.metadata = this.metadata;
        }
        return payload;
    }
    save(worktree = (0, mission_utils_js_1.resolveWorktree)(this.slug) || process.cwd(), gitFn = git_js_1.git, writeFileAtomicFn = storage_js_1.writeFileAtomic) {
        const statePath = reviewStateFile(this.slug, worktree);
        if (!statePath) {
            return { outcome: 'write-failed', stage: 'write', diagnostic: `Mission directory not found for ${this.slug}` };
        }
        const payload = this.toJSON();
        try {
            writeFileAtomicFn(statePath, JSON.stringify(payload, null, 2) + '\n');
        }
        catch (error) {
            return { outcome: 'write-failed', stage: 'write', diagnostic: diagnosticFrom(error, 'Atomic review-state write failed') };
        }
        const relPath = path.relative(worktree, statePath);
        let addResult;
        try {
            addResult = gitFn(['-C', worktree, 'add', relPath]);
        }
        catch (error) {
            return { outcome: 'add-failed', stage: 'add', diagnostic: diagnosticFrom(error, 'git add failed') };
        }
        if (addResult.status !== 0) {
            return { outcome: 'add-failed', stage: 'add', diagnostic: gitDiagnostic(addResult, 'git add failed') };
        }
        const msg = `review-state(${this.slug}): round ${this.round} (${this.phase}) [${this.reviewer} -> ${this.implementer}]${this.disposition ? ` disposition=${this.disposition}` : ''}`;
        let commitResult;
        try {
            commitResult = gitFn(['-C', worktree, 'commit', '-m', msg]);
        }
        catch (error) {
            return { outcome: 'commit-failed-dirty', stage: 'commit', diagnostic: diagnosticFrom(error, 'git commit failed') };
        }
        if (commitResult.status !== 0) {
            let statusResult;
            try {
                statusResult = gitFn(['-C', worktree, 'status', '--porcelain', relPath]);
            }
            catch (error) {
                return { outcome: 'commit-failed-dirty', stage: 'commit', diagnostic: diagnosticFrom(error, gitDiagnostic(commitResult, 'git commit failed')) };
            }
            if (statusResult.status === 0 && statusResult.stdout.trim() === '') {
                return { outcome: 'unchanged' };
            }
            return { outcome: 'commit-failed-dirty', stage: 'commit', diagnostic: gitDiagnostic(commitResult, 'git commit failed and review state remains dirty') };
        }
        return { outcome: 'committed' };
    }
}
exports.ReviewState = ReviewState;
/**
 * Write and commit the review state for a mission.
 * Commits to the current branch so the state is visible after session restarts.
 *
 * @param {string} slug
 * @param {ReviewState|object} state
 * @returns {ReviewStatePersistenceResult}
 */
function writeReviewState(slug, state, worktree = (0, mission_utils_js_1.resolveWorktree)(slug) || process.cwd(), gitFn = git_js_1.git, writeFileAtomicFn = storage_js_1.writeFileAtomic) {
    const instance = state instanceof ReviewState ? state : new ReviewState(slug, state);
    return instance.save(worktree, gitFn, writeFileAtomicFn);
}
/**
 * Delete the review state file for a mission (used by --reset).
 * Commits the deletion if the file was tracked.
 *
 * @param {string} slug
 * @returns {ReviewStatePersistenceResult}
 */
function resetReviewState(slug, worktree = (0, mission_utils_js_1.resolveWorktree)(slug) || process.cwd(), gitFn = git_js_1.git) {
    const statePath = reviewStateFile(slug, worktree);
    if (!statePath || !fs.existsSync(statePath)) {
        return { outcome: 'unchanged' };
    }
    const relPath = path.relative(worktree, statePath);
    const tombstonePath = path.join(path.dirname(statePath), `.${path.basename(statePath)}.${process.pid}.${Date.now()}.deleted`);
    try {
        fs.renameSync(statePath, tombstonePath);
    }
    catch (error) {
        return { outcome: 'write-failed', stage: 'write', diagnostic: diagnosticFrom(error, 'Atomic review-state deletion failed') };
    }
    try {
        const addResult = gitFn(['-C', worktree, 'add', '-u', '--', relPath]);
        if (addResult.status !== 0) {
            const statusResult = gitFn(['-C', worktree, 'status', '--porcelain', relPath]);
            if (statusResult.status === 0 && statusResult.stdout.trim() === '') {
                return { outcome: 'unchanged' };
            }
            return { outcome: 'add-failed', stage: 'add', diagnostic: gitDiagnostic(addResult, 'git add deletion failed') };
        }
        const commitResult = gitFn(['-C', worktree, 'commit', '-m', `review-state(${slug}): reset (--reset flag)`]);
        if (commitResult.status === 0) {
            return { outcome: 'committed' };
        }
        const statusResult = gitFn(['-C', worktree, 'status', '--porcelain', relPath]);
        if (statusResult.status === 0 && statusResult.stdout.trim() === '') {
            return { outcome: 'unchanged' };
        }
        return { outcome: 'commit-failed-dirty', stage: 'commit', diagnostic: gitDiagnostic(commitResult, 'git commit failed and review-state deletion remains dirty') };
    }
    catch (error) {
        return { outcome: 'commit-failed-dirty', stage: 'commit', diagnostic: diagnosticFrom(error, 'Review-state reset commit failed') };
    }
    finally {
        if (fs.existsSync(tombstonePath)) {
            fs.unlinkSync(tombstonePath);
        }
    }
}
