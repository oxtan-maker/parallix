"use strict";
/**
 * Review Artifacts Module - Utility Functions
 * Extracted from parallix/lib/review.js for task-1201
 * Handles artifact path resolution, file I/O, and normalization.
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
exports.buildMetadataFooter = buildMetadataFooter;
exports.reviewArtifactPath = reviewArtifactPath;
exports.resolveArtifactDir = resolveArtifactDir;
exports.readArtifactFile = readArtifactFile;
exports.deleteArtifactFile = deleteArtifactFile;
exports.normalizeReviewVerdict = normalizeReviewVerdict;
exports.normalizeDisposition = normalizeDisposition;
exports.postWorkflowComment = postWorkflowComment;
exports.postWorkflowReview = postWorkflowReview;
exports.consumeReviewerArtifacts = consumeReviewerArtifacts;
exports.consumeImplementerArtifacts = consumeImplementerArtifacts;
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const fmt = __importStar(require("../core/fmt.js"));
const mission_utils_js_1 = require("../core/mission-utils.js");
const review_state_js_1 = require("./review-state.js");
const review_adapter_js_1 = require("./review-adapter.js");
const review_events_js_1 = require("./review-events.js");
// ============================================================================
// Metadata Footer
// ============================================================================
function buildMetadataFooter(slug, rootDir = process.cwd()) {
    const state = (0, review_state_js_1.readReviewState)(slug, rootDir);
    if (!state) {
        return '';
    }
    return `\n\n---\n\`[workflow-round:${state.round}, workflow-phase:${state.phase}]\``;
}
// ============================================================================
// Artifact Path Utilities
// ============================================================================
function reviewArtifactPath(slug, artifactName, tmpDir = os.tmpdir()) {
    return path.join(tmpDir, `${slug}-${artifactName}`);
}
/**
 * Resolve artifact read path with optional /tmp fallback.
 */
function resolveArtifactRead(slug, artifactName, opts) {
    const { tmpDir, explicitTmpDir, fallbackToTmp, readArtifactFn } = opts;
    const primaryPath = reviewArtifactPath(slug, artifactName, tmpDir);
    const primaryValue = readArtifactFn(primaryPath);
    const allowTmpFallback = (!explicitTmpDir || fallbackToTmp) && tmpDir !== '/tmp';
    if (primaryValue !== null || !allowTmpFallback) {
        return { path: primaryPath, value: primaryValue };
    }
    const fallbackPath = reviewArtifactPath(slug, artifactName, '/tmp');
    const fallbackValue = readArtifactFn(fallbackPath);
    if (fallbackValue !== null) {
        return { path: fallbackPath, value: fallbackValue };
    }
    return { path: primaryPath, value: null };
}
/**
 * Resolve the directory where review artifacts are written and consumed.
 */
function resolveArtifactDir(rootDir = process.cwd()) {
    return (0, review_adapter_js_1.resolveArtifactDir)(rootDir);
}
function readArtifactFile(filePath, readFileSync = fs.readFileSync) {
    try {
        const value = readFileSync(filePath, 'utf8');
        return typeof value === 'string' ? value.trim() : '';
    }
    catch {
        return null;
    }
}
function deleteArtifactFile(filePath, unlinkSync = fs.unlinkSync) {
    try {
        unlinkSync(filePath);
    }
    catch {
        // Best-effort cleanup only.
    }
}
// ============================================================================
// Normalization Utilities
// ============================================================================
function normalizeReviewVerdict(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return ['approve', 'request-changes', 'comment'].includes(normalized) ? normalized : null;
}
function normalizeDisposition(value) {
    const normalized = String(value || '').trim().toUpperCase();
    return ['CHANGES_MADE', 'PUSHBACK_ALL', 'PARKED', 'BLOCKED'].includes(normalized) ? normalized : null;
}
// ============================================================================
// Workflow Comment/Review Posting
// ============================================================================
function postWorkflowComment(slug, message, options = {}) {
    const log = options.log || fmt.log.plain;
    const error = options.error || fmt.log.plainError;
    const readTokenFn = options.readTokenFn || review_adapter_js_1.readToken;
    const postCommentFn = options.postCommentFn || review_adapter_js_1.postComment;
    const buildMetadataFooterFn = options.buildMetadataFooterFn || buildMetadataFooter;
    const readReviewStateFn = options.readReviewStateFn || review_state_js_1.readReviewState;
    const rootDir = options.rootDir || (0, mission_utils_js_1.resolveWorktree)(slug) || process.cwd();
    const branch = (0, mission_utils_js_1.missionBranchName)(slug, rootDir);
    const reviewIdentity = options.reviewIdentity
        || options.forgejoUser
        || (0, review_state_js_1.resolveReviewIdentity)(slug, rootDir, { readReviewStateFn }).commentIdentityUser
        || 'human';
    const token = readTokenFn(reviewIdentity, { rootDir });
    if (!token) {
        error(fmt.status('FAIL', `No Forgejo token found for user "${reviewIdentity}". Cannot post comment.`));
        return { ok: false };
    }
    const taggedMessage = message + buildMetadataFooterFn(slug, rootDir);
    log(fmt.status('INFO', `Posting PR comment on ${branch} as ${reviewIdentity}...`));
    const result = postCommentFn(branch, token, taggedMessage, { forgejoUser: reviewIdentity, reviewIdentity });
    const r = result;
    if (!r.ok) {
        error(fmt.status('FAIL', `Could not post comment: ${r.error || 'API error'}`));
        return { ok: false, error: r.error || 'API error' };
    }
    log(fmt.status('PASS', `Comment posted on PR for ${branch}.`));
    return { ok: true };
}
/** @param {*} result */
function describeProviderFailure(result) {
    if (!result || typeof result !== 'object') {
        return 'API error';
    }
    const r = result;
    const httpStatus = (r.statusCode !== null && Number(r.statusCode) > 0)
        ? r.statusCode
        : (r.status !== null && Number(r.status) >= 100 ? r.status : null);
    let body = null;
    if (r.data && typeof r.data === 'object') {
        body = r.data.message || JSON.stringify(r.data);
    }
    else if (typeof r.data === 'string' && r.data) {
        body = r.data;
    }
    const parts = [];
    if (httpStatus !== null) {
        parts.push(String(httpStatus));
    }
    if (body) {
        parts.push(body);
    }
    if (parts.length) {
        return parts.join(' ');
    }
    return r.error || r.raw || 'API error';
}
/**
 * Record a review verdict in local review-state.json / review-events.
 */
function recordLocalReviewVerdict(slug, outcome, options = {}) {
    const worktree = options.worktree || (0, mission_utils_js_1.resolveWorktree)(slug) || process.cwd();
    const writeReviewStateFn = options.writeReviewStateFn || review_state_js_1.writeReviewState;
    const createEventFn = options.createEventFn || review_events_js_1.createEvent;
    const readReviewStateFn = options.readReviewStateFn || review_state_js_1.readReviewState;
    const log = options.log || fmt.log.plain;
    const error = options.error || fmt.log.plainError;
    const existing = readReviewStateFn(slug, worktree);
    const state = existing instanceof review_state_js_1.ReviewState
        ? existing
        : new review_state_js_1.ReviewState(slug, existing || {
            reviewer: options.reviewer,
            implementer: options.reviewer,
            round: 1,
            phase: 'reviewing',
        });
    if (outcome === 'approve') {
        state.disposition = 'APPROVED';
        try {
            state.transitionTo('approved');
        }
        catch { /* ignore */ }
    }
    else if (outcome === 'request-changes') {
        state.disposition = 'REQUEST_CHANGES';
        try {
            state.transitionTo('fixing');
        }
        catch { /* ignore */ }
    }
    (0, review_state_js_1.persistReviewStateOrThrow)(writeReviewStateFn, slug, state, worktree);
    createEventFn(slug, review_events_js_1.VALID_EVENT_TYPES.REVIEWER_OUTCOME, { verdict: outcome, content: `Review verdict: ${outcome}` }, { worktree, log: log, error });
}
/**
 * Submit a review outcome to the provider.
 */
function postWorkflowReview(slug, outcome, message, options = {}) {
    const log = options.log || fmt.log.plain;
    const error = options.error || fmt.log.plainError;
    const readTokenFn = options.readTokenFn || review_adapter_js_1.readToken;
    const postReviewFn = options.postReviewFn || review_adapter_js_1.postReview;
    const buildMetadataFooterFn = options.buildMetadataFooterFn || buildMetadataFooter;
    const readReviewStateFn = options.readReviewStateFn || review_state_js_1.readReviewState;
    const worktree = options.worktree || (0, mission_utils_js_1.resolveWorktree)(slug) || process.cwd();
    const branch = (0, mission_utils_js_1.missionBranchName)(slug, worktree);
    const reviewIdentity = options.reviewIdentity
        || options.forgejoUser
        || (0, review_state_js_1.resolveReviewIdentity)(slug, worktree, { readReviewStateFn }).identityUser
        || 'human';
    const token = readTokenFn(reviewIdentity, { rootDir: worktree });
    if (!token) {
        error(fmt.status('FAIL', `No Forgejo token found for user "${reviewIdentity}". Cannot submit review.`));
        return { ok: false };
    }
    const getPrAuthorFn = options.getPrAuthorFn || review_adapter_js_1.getPrAuthor;
    let prAuthor = null;
    try {
        prAuthor = getPrAuthorFn(branch, token, { forgejoUser: reviewIdentity, reviewIdentity, rootDir: worktree });
    }
    catch {
        prAuthor = null;
    }
    if (prAuthor && prAuthor === reviewIdentity) {
        log(fmt.status('WARN', `Reviewer "${reviewIdentity}" is the PR author for ${branch}; skipping the provider review POST to avoid a self-approval (Forgejo rejects "approve your own pull is not allowed" with HTTP 422). Recording the "${outcome}" verdict locally in review-state.json / review-events; a different agent or a human must post the formal approval.`));
        recordLocalReviewVerdict(slug, outcome, {
            worktree,
            reviewer: reviewIdentity,
            writeReviewStateFn: options.writeReviewStateFn,
            createEventFn: options.createEventFn,
            readReviewStateFn,
            log: log,
            error,
        });
        return { ok: true, skipped: true, reason: 'self-author', prAuthor };
    }
    const taggedMessage = message + buildMetadataFooterFn(slug, worktree);
    log(fmt.status('INFO', `Submitting review outcome "${outcome}" on ${branch} as ${reviewIdentity}...`));
    const result = postReviewFn(branch, token, outcome, taggedMessage, { forgejoUser: reviewIdentity, reviewIdentity });
    const r = result;
    if (!r.ok) {
        const failureDetail = describeProviderFailure(result);
        error(fmt.status('FAIL', `Could not submit review: ${failureDetail}`));
        return { ok: false, error: failureDetail };
    }
    log(fmt.status('PASS', `Review outcome "${outcome}" posted on PR for ${branch}.`));
    return { ok: true };
}
// ============================================================================
// Artifact Consumption
// ============================================================================
async function consumeReviewerArtifacts(slug, reviewer, options = {}) {
    const log = options.log || fmt.log.plain;
    const error = options.error || fmt.log.plainError;
    const readArtifactFn = options.readArtifactFn || readArtifactFile;
    const deleteArtifactFn = options.deleteArtifactFn || deleteArtifactFile;
    const explicitTmpDir = options.tmpDir !== null && options.tmpDir !== undefined;
    const fallbackToTmp = options.fallbackToTmp === true;
    const worktree = options.worktree || (0, mission_utils_js_1.resolveWorktree)(slug) || process.cwd();
    const tmpDir = options.tmpDir || resolveArtifactDir(worktree);
    const providerEnabled = options.providerEnabled !== null && options.providerEnabled !== undefined
        ? options.providerEnabled
        : (options.forgejoEnabled !== null && options.forgejoEnabled !== undefined ? options.forgejoEnabled : (0, review_adapter_js_1.isEnabled)(worktree));
    const reviewStatePath = (0, review_state_js_1.reviewStateFile)(slug, worktree);
    const findingsResolved = resolveArtifactRead(slug, 'review-findings.md', { tmpDir, explicitTmpDir, fallbackToTmp, readArtifactFn });
    const outcomeResolved = resolveArtifactRead(slug, 'review-outcome.md', { tmpDir, explicitTmpDir, fallbackToTmp, readArtifactFn });
    const verdictResolved = resolveArtifactRead(slug, 'review-verdict.txt', { tmpDir, explicitTmpDir, fallbackToTmp, readArtifactFn });
    const findingsPath = findingsResolved.path;
    const outcomePath = outcomeResolved.path;
    const verdictPath = verdictResolved.path;
    const findings = findingsResolved.value;
    const outcomeMessage = outcomeResolved.value;
    const verdictRaw = verdictResolved.value;
    let verdict = normalizeReviewVerdict(verdictRaw || '');
    if (!verdict && outcomeMessage) {
        const outcomeVerdictMatch = outcomeMessage.match(/^verdict:\s*(approve|request-changes|comment)/im) ||
            outcomeMessage.match(/Verdict:\s*(approve|request-changes|comment)/i);
        if (outcomeVerdictMatch) {
            verdict = normalizeReviewVerdict(outcomeVerdictMatch[1]);
        }
    }
    const hasAny = findings !== null || outcomeMessage !== null || verdictRaw !== null;
    if (!hasAny) {
        return { consumed: false };
    }
    if (!findings || !outcomeMessage) {
        if (!providerEnabled) {
            const statePathStr = reviewStatePath ? ` local review state at ${reviewStatePath}; ` : ' ';
            error(fmt.status('FAIL', `Incomplete reviewer artifacts for ${slug}. Expected ${findingsPath} and ${outcomePath}.${statePathStr}No provider review posted (provider=none); add a review-outcome.md with a Verdict line or use \`node parallix review <slug> --submit-review approve\`.`));
        }
        else {
            error(fmt.status('FAIL', `Incomplete reviewer artifacts for ${slug}. Expected ${findingsPath} and ${outcomePath}.`));
        }
        return { consumed: true, ok: false };
    }
    if (!verdict) {
        if (!providerEnabled) {
            const statePathStr = reviewStatePath ? ` local review state at ${reviewStatePath}; ` : ' ';
            error(fmt.status('FAIL', `Reviewer artifacts for ${slug} missing verdict. Expected in ${verdictPath} or in ${outcomePath} content.${statePathStr}No provider review posted (provider=none); add a review-outcome.md with a Verdict line or use \`node parallix review <slug> --submit-review approve\`.`));
        }
        else {
            error(fmt.status('FAIL', `Reviewer artifacts for ${slug} missing verdict. Expected in ${verdictPath} or in ${outcomePath} content.`));
        }
        return { consumed: true, ok: false };
    }
    const currentState = (0, review_state_js_1.readReviewState)(slug, worktree);
    const round = currentState ? currentState.round : 1;
    const phase = currentState ? currentState.phase : 'reviewing';
    const createEventFn = options.createEventFn || review_events_js_1.createEvent;
    const findingsEventResult = createEventFn(slug, review_events_js_1.VALID_EVENT_TYPES.REVIEWER_FINDINGS, {
        content: findings, round, phase, actor: reviewer
    }, { worktree, skipGit: true, log: log, error });
    if (!findingsEventResult.ok) {
        error(fmt.status('FAIL', `Failed to persist reviewer findings to repo store: ${findingsEventResult.error}`));
        return { consumed: true, ok: false };
    }
    const outcomeEventResult = createEventFn(slug, review_events_js_1.VALID_EVENT_TYPES.REVIEWER_OUTCOME, {
        content: outcomeMessage, round, phase, actor: reviewer, verdict
    }, { worktree, skipGit: true, log: log, error });
    if (!outcomeEventResult.ok) {
        error(fmt.status('FAIL', `Failed to persist reviewer outcome to repo store: ${outcomeEventResult.error}`));
        return { consumed: true, ok: false };
    }
    log(fmt.status('INFO', `Persisted reviewer artifacts to repo store: ${findingsEventResult.path}, ${outcomeEventResult.path}`));
    if (providerEnabled && options.readTokenFn && options.getCommentsFn) {
        await (0, review_events_js_1.consumeHumanNotes)(slug, reviewer, {
            getCommentsFn: options.getCommentsFn,
            createEventFn: createEventFn,
            readTokenFn: options.readTokenFn,
            reviewIdentity: reviewer,
            worktree,
            log: log,
            error
        });
    }
    if (providerEnabled) {
        const commentResult = postWorkflowComment(slug, findings, {
            rootDir: worktree,
            reviewIdentity: reviewer,
            readTokenFn: options.readTokenFn,
            postCommentFn: options.postCommentFn,
            buildMetadataFooterFn: options.buildMetadataFooterFn,
            log: log,
            error
        });
        if (!commentResult.ok) {
            return { consumed: true, ok: false };
        }
        const reviewResult = postWorkflowReview(slug, verdict, outcomeMessage, {
            worktree,
            reviewIdentity: reviewer,
            readTokenFn: options.readTokenFn,
            postReviewFn: options.postReviewFn,
            buildMetadataFooterFn: options.buildMetadataFooterFn,
            log: log,
            error
        });
        if (!reviewResult.ok) {
            return { consumed: true, ok: false };
        }
    }
    else {
        log(fmt.status('INFO', `Review provider disabled; skipping PR mirroring for ${slug}`));
    }
    deleteArtifactFn(findingsPath);
    deleteArtifactFn(outcomePath);
    deleteArtifactFn(verdictPath);
    if (verdict === 'approve') {
        return { consumed: true, ok: true, reviewState: 'APPROVED' };
    }
    if (verdict === 'request-changes') {
        return { consumed: true, ok: true, reviewState: 'REQUEST_CHANGES' };
    }
    if (!providerEnabled) {
        const reviewState = verdict.toUpperCase().replace(/-/g, '_');
        log(fmt.status('INFO', `Reviewer ${reviewer} produced verdict "${verdict}" with the provider disabled; normalizing to ${reviewState} for loop control.`));
        return { consumed: true, ok: true, reviewState };
    }
    log(fmt.status('WARN', `Reviewer ${reviewer} produced verdict "${verdict}". Falling back to provider polling for loop control.`));
    return { consumed: true, ok: true, reviewState: null };
}
async function consumeImplementerArtifacts(slug, implementer, options = {}) {
    const log = options.log || fmt.log.plain;
    const error = options.error || fmt.log.plainError;
    const readArtifactFn = options.readArtifactFn || readArtifactFile;
    const deleteArtifactFn = options.deleteArtifactFn || deleteArtifactFile;
    const explicitTmpDir = options.tmpDir !== null && options.tmpDir !== undefined;
    const fallbackToTmp = options.fallbackToTmp === true;
    const worktree = options.worktree || (0, mission_utils_js_1.resolveWorktree)(slug) || process.cwd();
    const tmpDir = options.tmpDir || resolveArtifactDir(worktree);
    const providerEnabled = options.providerEnabled !== null && options.providerEnabled !== undefined
        ? options.providerEnabled
        : (options.forgejoEnabled !== null && options.forgejoEnabled !== undefined ? options.forgejoEnabled : (0, review_adapter_js_1.isEnabled)(worktree));
    const reviewStatePath = (0, review_state_js_1.reviewStateFile)(slug, worktree);
    const resolutionResolved = resolveArtifactRead(slug, 'round-resolution.md', { tmpDir, explicitTmpDir, fallbackToTmp, readArtifactFn });
    const dispositionResolved = resolveArtifactRead(slug, 'review-disposition.txt', { tmpDir, explicitTmpDir, fallbackToTmp, readArtifactFn });
    const resolutionPath = resolutionResolved.path;
    const dispositionPath = dispositionResolved.path;
    const resolution = resolutionResolved.value;
    const dispositionRaw = dispositionResolved.value;
    const disposition = normalizeDisposition(dispositionRaw || '');
    const hasAny = resolution !== null || dispositionRaw !== null;
    if (!hasAny) {
        return { consumed: false };
    }
    if (!resolution || !disposition) {
        if (!providerEnabled) {
            const statePathStr = reviewStatePath ? ` local review state at ${reviewStatePath}; ` : ' ';
            error(fmt.status('FAIL', `Incomplete implementer artifacts for ${slug}. Expected ${resolutionPath} and ${dispositionPath}.${statePathStr}No provider review posted (provider=none); add review-disposition.txt and a round resolution, or use \`node parallix review <slug> --submit-review approve\`.`));
        }
        else {
            error(fmt.status('FAIL', `Incomplete implementer artifacts for ${slug}. Expected ${resolutionPath} and ${dispositionPath}.`));
        }
        return { consumed: true, ok: false };
    }
    const currentState = (0, review_state_js_1.readReviewState)(slug, worktree);
    const round = currentState ? currentState.round : 1;
    const phase = currentState ? currentState.phase : 'fixing';
    const createEventFn = options.createEventFn || review_events_js_1.createEvent;
    let fixedItems = [];
    let pushedBackItems = [];
    let parkedItems = [];
    let blockedReason = null;
    try {
        const fixedMatch = resolution.match(/fixed_items:\s*(\[[^\]]*\])/i);
        const pushedMatch = resolution.match(/pushed_back_items:\s*(\[[^\]]*\])/i);
        const parkedMatch = resolution.match(/parked_items:\s*(\[[^\]]*\])/i);
        const blockedMatch = resolution.match(/blocked_reason:\s*"([^"]*)"/i);
        if (fixedMatch) {
            fixedItems = JSON.parse(fixedMatch[1]);
        }
        if (pushedMatch) {
            pushedBackItems = JSON.parse(pushedMatch[1]);
        }
        if (parkedMatch) {
            parkedItems = JSON.parse(parkedMatch[1]);
        }
        if (blockedMatch) {
            blockedReason = blockedMatch[1];
        }
    }
    catch {
        fixedItems = [];
        pushedBackItems = [];
        parkedItems = [];
    }
    if (disposition === 'BLOCKED' && !blockedReason) {
        const match = resolution.match(/blocked.*?:\s*(.+)/i);
        if (match) {
            blockedReason = match[1].trim();
        }
    }
    const summaryEventResult = createEventFn(slug, review_events_js_1.VALID_EVENT_TYPES.IMPLEMENTER_ROUND_SUMMARY, {
        content: resolution, round, phase, actor: implementer,
        fixedItems, pushedBackItems, parkedItems,
        ...(disposition === 'BLOCKED' && blockedReason ? { blockedReason } : {})
    }, { worktree, skipGit: true, log: log, error });
    if (!summaryEventResult.ok) {
        error(fmt.status('FAIL', `Failed to persist implementer round summary to repo store: ${summaryEventResult.error}`));
        return { consumed: true, ok: false };
    }
    const dispositionEventResult = createEventFn(slug, review_events_js_1.VALID_EVENT_TYPES.IMPLEMENTER_DISPOSITION, {
        content: `Autonomous review disposition: ${disposition}`, round, phase, actor: implementer, disposition
    }, { worktree, skipGit: true, log: log, error });
    if (!dispositionEventResult.ok) {
        error(fmt.status('FAIL', `Failed to persist implementer disposition to repo store: ${dispositionEventResult.error}`));
        return { consumed: true, ok: false };
    }
    log(fmt.status('INFO', `Persisted implementer artifacts to repo store: ${summaryEventResult.path}, ${dispositionEventResult.path}`));
    if (providerEnabled && options.readTokenFn && options.getCommentsFn) {
        await (0, review_events_js_1.consumeHumanNotes)(slug, implementer, {
            getCommentsFn: options.getCommentsFn,
            createEventFn: createEventFn,
            readTokenFn: options.readTokenFn,
            reviewIdentity: implementer,
            worktree,
            log: log,
            error
        });
    }
    if (providerEnabled) {
        const resolutionResult = postWorkflowComment(slug, resolution, {
            rootDir: worktree,
            reviewIdentity: implementer,
            readTokenFn: options.readTokenFn,
            postCommentFn: options.postCommentFn,
            buildMetadataFooterFn: options.buildMetadataFooterFn,
            log: log,
            error
        });
        if (!resolutionResult.ok) {
            return { consumed: true, ok: false };
        }
        const dispositionResult = postWorkflowComment(slug, `Autonomous review disposition: ${disposition}`, {
            rootDir: worktree,
            reviewIdentity: implementer,
            readTokenFn: options.readTokenFn,
            postCommentFn: options.postCommentFn,
            buildMetadataFooterFn: options.buildMetadataFooterFn,
            log: log,
            error
        });
        if (!dispositionResult.ok) {
            return { consumed: true, ok: false };
        }
    }
    else {
        log(fmt.status('INFO', `Review provider disabled; skipping PR mirroring for ${slug}`));
    }
    deleteArtifactFn(resolutionPath);
    deleteArtifactFn(dispositionPath);
    return { consumed: true, ok: true, disposition };
}
