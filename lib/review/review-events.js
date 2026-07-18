"use strict";
/**
 * Review event persistence for autonomous review rounds.
 *
 * Stores classified review events under mission-local directories:
 *   missions/<slug>/review-events/ by default, or the configured legacy layout
 *
 * Each event is a structured markdown file with bounded fields, not full
 * transient agent context (to avoid noisy diffs per ADR 0039).
 *
 * Owned by the Node workflow harness (task-1145).
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
exports.LEGACY_ARTIFACT_TO_EVENT_TYPE = exports.VALID_VERDICTS = exports.VALID_DISPOSITIONS = exports.MIRRORED_EVENT_TYPES = exports.ALL_EVENT_TYPES = exports.VALID_EVENT_TYPES = void 0;
exports.shouldMirrorToForgejo = shouldMirrorToProvider;
exports.shouldMirrorToProvider = shouldMirrorToProvider;
exports.isValidEventType = isValidEventType;
exports.isValidDisposition = isValidDisposition;
exports.isValidVerdict = isValidVerdict;
exports.reviewEventsDir = reviewEventsDir;
exports.eventFilePath = eventFilePath;
exports.legacyArtifactPath = legacyArtifactPath;
exports.createEvent = createEvent;
exports.normalizeEventContent = normalizeEventContent;
exports.importLegacyArtifact = importLegacyArtifact;
exports.importAllLegacyArtifacts = importAllLegacyArtifacts;
exports.readAllEvents = readAllEvents;
exports.parseEventFile = parseEventFile;
exports.buildEventFrontmatter = buildEventFrontmatter;
exports.buildEventFooter = buildEventFooter;
exports.renderEventFile = renderEventFile;
exports.hasWorkflowFooter = hasWorkflowFooter;
exports.classifyComment = classifyComment;
exports.consumeHumanNotes = consumeHumanNotes;
exports.generateEventTimestamp = generateEventTimestamp;
exports.sanitizeFilename = sanitizeFilename;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const git_js_1 = require("../core/git.js");
const mission_utils_js_1 = require("../core/mission-utils.js");
const review_state_js_1 = require("./review-state.js");
const fmt = __importStar(require("../core/fmt.js"));
// -------- Event Taxonomy --------
/**
 * Valid event classification labels.
 * These are the canonical types that can be stored and (optionally) mirrored to the review provider.
 */
const VALID_EVENT_TYPES = Object.freeze({
    // Reviewer-produced events
    REVIEWER_FINDINGS: 'reviewer_findings',
    REVIEWER_OUTCOME: 'reviewer_outcome',
    // Implementer-produced events
    IMPLEMENTER_ROUND_SUMMARY: 'implementer_round_summary',
    IMPLEMENTER_DISPOSITION: 'implementer_disposition',
    // Neutral events
    NEUTRAL_DISCUSSION: 'neutral_discussion',
    HUMAN_NOTE: 'human_note',
    // Workflow-internal events (not mirrored to the review provider by default)
    BLOCKED_PUBLICATION: 'blocked_publication',
    PARKED_FOLLOWUP: 'parked_followup'
});
exports.VALID_EVENT_TYPES = VALID_EVENT_TYPES;
/**
 * All valid event type values as an array for validation.
 */
const ALL_EVENT_TYPES = Object.freeze(Object.values(VALID_EVENT_TYPES));
exports.ALL_EVENT_TYPES = ALL_EVENT_TYPES;
/**
 * Event types that should be mirrored to the review provider.
 */
const MIRRORED_EVENT_TYPES = Object.freeze(new Set([
    VALID_EVENT_TYPES.REVIEWER_FINDINGS,
    VALID_EVENT_TYPES.REVIEWER_OUTCOME,
    VALID_EVENT_TYPES.IMPLEMENTER_ROUND_SUMMARY,
    VALID_EVENT_TYPES.IMPLEMENTER_DISPOSITION,
    VALID_EVENT_TYPES.HUMAN_NOTE
]));
exports.MIRRORED_EVENT_TYPES = MIRRORED_EVENT_TYPES;
/**
 * Valid disposition values for implementer disposition events.
 */
const VALID_DISPOSITIONS = Object.freeze([
    'CHANGES_MADE',
    'PUSHBACK_ALL',
    'PARKED',
    'BLOCKED'
]);
exports.VALID_DISPOSITIONS = VALID_DISPOSITIONS;
/**
 * Valid review verdict values for reviewer outcome events.
 */
const VALID_VERDICTS = Object.freeze([
    'approve',
    'request-changes',
    'comment'
]);
exports.VALID_VERDICTS = VALID_VERDICTS;
// -------- Path Resolution --------
/**
 * Returns the absolute path to the mission-local review-events directory.
 * Creates the directory if it does not exist.
 */
function reviewEventsDir(slug, rootDir = process.cwd()) {
    const missionDir = (0, mission_utils_js_1.findMissionDir)(slug, rootDir);
    if (!missionDir) {
        return null;
    }
    const dir = path.join(missionDir, 'review-events');
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
}
/**
 * Returns the path for a specific event file in the mission-local store.
 */
function eventFilePath(slug, eventType, round, actor, timestamp = null, rootDir = process.cwd()) {
    const eventsDir = reviewEventsDir(slug, rootDir);
    if (!eventsDir) {
        return null;
    }
    const ts = timestamp || generateEventTimestamp();
    const sanitizedActor = sanitizeFilename(actor);
    const filename = `${ts}-${eventType}-${round}-${sanitizedActor}.md`;
    return path.join(eventsDir, filename);
}
/**
 * Returns the legacy /tmp/ artifact path for compatibility.
 */
function legacyArtifactPath(slug, artifactName, tmpDir = os.tmpdir()) {
    return path.join(tmpDir, `${slug}-${artifactName}`);
}
// -------- Timestamp & Sanitization --------
/**
 * Generate a filesystem-safe ISO timestamp without colons.
 */
function generateEventTimestamp() {
    const now = new Date();
    const datePart = now.toISOString().split('T')[0];
    const timePart = now.toISOString().split('T')[1].split('.')[0];
    return `${datePart}T${timePart.replace(/:/g, '')}`;
}
/**
 * Sanitize a string for use in a filename.
 */
function sanitizeFilename(str) {
    if (!str) {
        return 'unknown';
    }
    return String(str)
        .toLowerCase()
        .replace(/[@.]/g, '')
        .replace(/[^a-z0-9_-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
}
// -------- Event Validation --------
/**
 * Validate an event type against the taxonomy.
 */
function isValidEventType(eventType) {
    return ALL_EVENT_TYPES.includes(eventType);
}
/**
 * Validate a disposition value.
 */
function isValidDisposition(disposition) {
    return VALID_DISPOSITIONS.includes(disposition);
}
/**
 * Validate a verdict value.
 */
function isValidVerdict(verdict) {
    return VALID_VERDICTS.includes(verdict);
}
/**
 * Check if an event type should be mirrored to the review provider.
 */
function shouldMirrorToProvider(eventType) {
    return MIRRORED_EVENT_TYPES.has(eventType);
}
/**
 * Normalize an event payload into a structured format.
 */
function normalizeEventContent(content, eventType, metadata = {}) {
    const payload = {
        eventType,
        timestamp: '',
        content,
        ...metadata
    };
    payload.eventType = eventType;
    payload.timestamp = payload.timestamp || new Date().toISOString();
    payload.content = content;
    return payload;
}
/**
 * Build the frontmatter for an event file.
 */
function buildEventFrontmatter(event) {
    const lines = [
        '---',
        `event_type: ${event.eventType}`,
        `timestamp: ${event.timestamp}`,
    ];
    if (event.round !== undefined) {
        lines.push(`round: ${event.round}`);
    }
    if (event.phase !== undefined) {
        lines.push(`phase: ${event.phase}`);
    }
    if (event.actor !== undefined) {
        lines.push(`actor: ${event.actor}`);
    }
    if (event.slug !== undefined) {
        lines.push(`slug: ${event.slug}`);
    }
    if (event.disposition !== undefined) {
        lines.push(`disposition: ${event.disposition}`);
    }
    if (event.verdict !== undefined) {
        lines.push(`verdict: ${event.verdict}`);
    }
    if (event.fixedItems !== undefined) {
        lines.push(`fixed_items: ${JSON.stringify(event.fixedItems)}`);
    }
    if (event.pushedBackItems !== undefined) {
        lines.push(`pushed_back_items: ${JSON.stringify(event.pushedBackItems)}`);
    }
    if (event.parkedItems !== undefined) {
        lines.push(`parked_items: ${JSON.stringify(event.parkedItems)}`);
    }
    if (event.blockedReason !== undefined) {
        lines.push(`blocked_reason: "${event.blockedReason.replace(/"/g, '\\"')}"`);
    }
    if (event.followUpReference !== undefined) {
        lines.push(`followup_reference: ${event.followUpReference}`);
    }
    lines.push('---');
    return lines.join('\n');
}
/**
 * Build the workflow metadata footer for an event.
 */
function buildEventFooter(slug, round, phase) {
    return `\n\n---\n\`[workflow-round:${round}, workflow-phase:${phase}]\``;
}
/**
 * Check if a comment body contains the workflow metadata footer.
 */
function hasWorkflowFooter(body) {
    return /\`\[workflow-round:\d+, workflow-phase:[^\]]+\]\`/.test(body);
}
/**
 * Classify a comment as either workflow-generated or human.
 */
function classifyComment(comment) {
    const body = comment.body || '';
    if (hasWorkflowFooter(body)) {
        return null;
    }
    return VALID_EVENT_TYPES.HUMAN_NOTE;
}
/**
 * Consume human notes from provider PR comments.
 */
async function consumeHumanNotes(slug, actor, options = {}) {
    const { getCommentsFn, createEventFn = createEvent, readTokenFn, reviewIdentity = null, forgejoUser = null, worktree, log: logger = fmt.log.plain, error = fmt.log.plainError } = options;
    const actorIdentity = reviewIdentity || forgejoUser;
    if (!actorIdentity) {
        error(fmt.status('FAIL', 'Review identity is required for consumeHumanNotes.'));
        return { ok: false, created: [], skipped: [], error: 'reviewIdentity required' };
    }
    if (!getCommentsFn) {
        logger(fmt.status('INFO', 'consumeHumanNotes: no getCommentsFn provided; skipping human note classification.'));
        return { ok: true, created: [], skipped: [] };
    }
    const token = readTokenFn ? readTokenFn(actorIdentity) : null;
    if (!token) {
        logger(fmt.status('INFO', 'consumeHumanNotes: no provider token found; skipping human note classification.'));
        return { ok: true, created: [], skipped: [] };
    }
    const branch = (0, mission_utils_js_1.missionBranchName)(slug, worktree || process.cwd());
    const comments = await getCommentsFn(branch, token);
    if (!comments || !Array.isArray(comments)) {
        logger(fmt.status('INFO', 'consumeHumanNotes: no comments retrieved; skipping classification.'));
        return { ok: true, created: [], skipped: [] };
    }
    const created = [];
    const skipped = [];
    const currentState = (0, review_state_js_1.readReviewState)(slug, worktree || process.cwd());
    const round = currentState ? currentState.round : 1;
    const phase = currentState ? currentState.phase : 'reviewing';
    for (const comment of comments) {
        if (hasWorkflowFooter(comment.body || '')) {
            skipped.push({ user: comment.user, created: comment.created, reason: 'workflow-generated' });
            continue;
        }
        const classification = classifyComment(comment);
        if (!classification) {
            skipped.push({ user: comment.user, created: comment.created, reason: 'already-classified' });
            continue;
        }
        const result = createEventFn(slug, classification, {
            content: comment.body || '',
            round,
            phase,
            actor: actor || comment.user || 'human'
        }, {
            worktree: worktree || process.cwd(),
            skipGit: true,
            log: logger,
            error
        });
        if (result.ok) {
            created.push({ path: result.path, user: comment.user, created: comment.created });
        }
        else {
            error(fmt.status('WARN', `Failed to create human_note event for comment by ${comment.user}: ${result.error}`));
        }
    }
    logger(fmt.status('INFO', `consumeHumanNotes: created ${created.length} human_note events, skipped ${skipped.length} workflow comments`));
    return { ok: true, created, skipped };
}
/**
 * Render a complete event file content.
 */
function renderEventFile(event) {
    const frontmatter = buildEventFrontmatter(event);
    const content = event.content || '';
    const hasFooter = /\n\n---\n`\[workflow-round:\d+, workflow-phase:[^\]]+\]`/.test(content);
    if (hasFooter) {
        return `${frontmatter}\n\n${content}`;
    }
    const footer = event.round !== undefined && event.phase !== undefined
        ? buildEventFooter(event.slug || '', event.round, event.phase)
        : '';
    return `${frontmatter}\n\n${content}${footer}`;
}
// -------- Event Creation --------
/** @typedef {{content: string, round?: number, phase?: string, actor?: string, disposition?: string, verdict?: string, fixedItems?: unknown[], pushedBackItems?: unknown[], parkedItems?: unknown[], blockedReason?: string, followUpReference?: string, timestamp?: string}} CreateEventParams */
/**
 * Create and persist a classified review event.
 */
function createEvent(slug, eventType, params, options = {}) {
    const { skipGit = false, gitFn = git_js_1.git, log: logger = fmt.log.plain, error = fmt.log.plainError, worktree, allowMissingRequiredFields = false } = options;
    const rootDir = worktree || (0, mission_utils_js_1.resolveWorktree)(slug) || process.cwd();
    if (!isValidEventType(eventType)) {
        error(fmt.status('FAIL', `Invalid event type "${eventType}". Valid types: ${ALL_EVENT_TYPES.join(', ')}`));
        return { ok: false, path: null, error: `Invalid event type: ${eventType}` };
    }
    if (params.disposition !== undefined && !isValidDisposition(params.disposition)) {
        error(fmt.status('FAIL', `Invalid disposition "${params.disposition}". Valid: ${VALID_DISPOSITIONS.join(', ')}`));
        return { ok: false, path: null, error: `Invalid disposition: ${params.disposition}` };
    }
    if (params.verdict !== undefined && !isValidVerdict(params.verdict)) {
        error(fmt.status('FAIL', `Invalid verdict "${params.verdict}". Valid: ${VALID_VERDICTS.join(', ')}`));
        return { ok: false, path: null, error: `Invalid verdict: ${params.verdict}` };
    }
    if (!allowMissingRequiredFields) {
        if (eventType === VALID_EVENT_TYPES.REVIEWER_OUTCOME && !params.verdict) {
            error(fmt.status('FAIL', 'reviewer_outcome event requires --verdict'));
            return { ok: false, path: null, error: 'reviewer_outcome event requires verdict' };
        }
        if (eventType === VALID_EVENT_TYPES.IMPLEMENTER_DISPOSITION && !params.disposition) {
            error(fmt.status('FAIL', 'implementer_disposition event requires --disposition'));
            return { ok: false, path: null, error: 'implementer_disposition event requires disposition' };
        }
    }
    let state;
    if (params.round === undefined || params.phase === undefined) {
        state = (0, review_state_js_1.readReviewState)(slug, rootDir);
    }
    else {
        state = null;
    }
    const round = (params.round !== undefined ? params.round : (state ? state.round : 1));
    const phase = (params.phase !== undefined ? params.phase : (state ? state.phase : 'reviewing'));
    const actor = params.actor || 'unknown';
    const event = normalizeEventContent(params.content || '', eventType, {
        slug,
        round,
        phase,
        actor,
        eventType,
        timestamp: params.timestamp,
        disposition: params.disposition,
        verdict: params.verdict,
        fixedItems: params.fixedItems,
        pushedBackItems: params.pushedBackItems,
        parkedItems: params.parkedItems,
        blockedReason: params.blockedReason,
        followUpReference: params.followUpReference
    });
    const ts = params.timestamp ?? null;
    const filePath = eventFilePath(slug, eventType, round, actor, ts, rootDir);
    if (!filePath) {
        error(fmt.status('FAIL', `Cannot resolve mission directory for slug "${slug}"`));
        return { ok: false, path: null, error: `Mission directory not found` };
    }
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    const content = renderEventFile(event);
    fs.writeFileSync(filePath, content, 'utf8');
    logger(fmt.status('PASS', `Created review event: ${path.basename(filePath)}`));
    if (!skipGit) {
        const relPath = path.relative(rootDir, filePath);
        const result = gitFn(['-C', rootDir, 'add', relPath]);
        if (result.status !== 0) {
            error(fmt.status('WARN', `Failed to git add event file: ${result.stderr}`));
        }
        else {
            const commitMsg = `review-event(${slug}): ${eventType} round ${round} (${phase}) [${actor}]`;
            const commitResult = gitFn(['-C', rootDir, 'commit', '-m', commitMsg, '--allow-empty']);
            if (commitResult.status !== 0) {
                error(fmt.status('WARN', `Failed to commit event file: ${commitResult.stderr}`));
            }
            else {
                logger(fmt.status('PASS', 'Committed review event to git'));
            }
        }
    }
    return { ok: true, path: filePath, event };
}
/**
 * Import an event from a legacy /tmp/ artifact file.
 */
function importLegacyArtifact(slug, artifactName, eventType, params = {}, options = {}) {
    const { tmpDir = os.tmpdir(), log: logger = fmt.log.plain, error = fmt.log.plainError, worktree } = options;
    const legacyPath = legacyArtifactPath(slug, artifactName, tmpDir);
    if (!fs.existsSync(legacyPath)) {
        logger(fmt.status('INFO', `Legacy artifact not found: ${legacyPath}`));
        return { ok: true, path: null, importedFrom: legacyPath, skipped: true };
    }
    let content;
    try {
        content = fs.readFileSync(legacyPath, 'utf8');
    }
    catch (err) {
        error(fmt.status('FAIL', `Failed to read legacy artifact: ${err.message}`));
        return { ok: false, path: null, importedFrom: legacyPath, error: err.message };
    }
    const result = createEvent(slug, eventType, {
        ...params,
        content,
        actor: params.actor || inferActorFromArtifact()
    }, { ...options, worktree: worktree || undefined, allowMissingRequiredFields: true });
    if (!result.ok) {
        return { ok: false, path: null, importedFrom: legacyPath, error: result.error ?? undefined };
    }
    logger(fmt.status('PASS', `Imported legacy artifact ${artifactName} to ${path.basename(result.path || '')}`));
    return {
        ok: true,
        path: result.path,
        importedFrom: legacyPath,
        event: result.event,
        legacyPath
    };
}
/**
 * Infer actor from legacy artifact name (best guess).
 */
function inferActorFromArtifact() {
    return 'unknown';
}
/**
 * Map legacy artifact names to event types.
 */
const LEGACY_ARTIFACT_TO_EVENT_TYPE = Object.freeze({
    'review-findings.md': VALID_EVENT_TYPES.REVIEWER_FINDINGS,
    'review-outcome.md': VALID_EVENT_TYPES.REVIEWER_OUTCOME,
    'review-verdict.txt': VALID_EVENT_TYPES.REVIEWER_OUTCOME,
    'round-resolution.md': VALID_EVENT_TYPES.IMPLEMENTER_ROUND_SUMMARY,
    'review-disposition.txt': VALID_EVENT_TYPES.IMPLEMENTER_DISPOSITION,
});
exports.LEGACY_ARTIFACT_TO_EVENT_TYPE = LEGACY_ARTIFACT_TO_EVENT_TYPE;
/**
 * Import all legacy /tmp/ artifacts for a mission.
 */
function importAllLegacyArtifacts(slug, options = {}) {
    const { tmpDir = os.tmpdir(), error = fmt.log.plainError, worktree } = options;
    const rootDir = worktree || (0, mission_utils_js_1.resolveWorktree)(slug) || process.cwd();
    const imported = [];
    const errors = [];
    const state = (0, review_state_js_1.readReviewState)(slug, rootDir);
    const round = state ? state.round : 1;
    const phase = state ? state.phase : 'reviewing';
    const legacyFiles = {};
    for (const artifactName of Object.keys(LEGACY_ARTIFACT_TO_EVENT_TYPE)) {
        const legacyPath = legacyArtifactPath(slug, artifactName, tmpDir);
        legacyFiles[artifactName] = fs.existsSync(legacyPath) ? legacyPath : null;
    }
    const outcomePath = legacyFiles['review-outcome.md'];
    const verdictPath = legacyFiles['review-verdict.txt'];
    if (outcomePath && fs.existsSync(outcomePath)) {
        let verdictContent = null;
        if (verdictPath) {
            try {
                if (fs.existsSync(verdictPath)) {
                    verdictContent = fs.readFileSync(verdictPath, 'utf8').trim();
                }
            }
            catch (err) {
                error(fmt.status('WARN', `Failed to read verdict file: ${err.message}`));
            }
        }
        const outcomeParams = { round, phase, actor: 'legacy' };
        if (verdictContent && isValidVerdict(verdictContent)) {
            outcomeParams.verdict = verdictContent;
        }
        const result = importLegacyArtifact(slug, 'review-outcome.md', VALID_EVENT_TYPES.REVIEWER_OUTCOME, outcomeParams, { ...options, worktree: rootDir });
        if (result.ok) {
            if (result.path) {
                imported.push({ artifactName: 'review-outcome.md', eventType: VALID_EVENT_TYPES.REVIEWER_OUTCOME, path: result.path, legacyPath: result.legacyPath });
                if (verdictPath && fs.existsSync(verdictPath)) {
                    imported.push({ artifactName: 'review-verdict.txt', eventType: VALID_EVENT_TYPES.REVIEWER_OUTCOME, path: result.path, legacyPath: verdictPath, asMetadata: true });
                }
            }
        }
        else {
            errors.push({ artifactName: 'review-outcome.md', eventType: VALID_EVENT_TYPES.REVIEWER_OUTCOME, error: result.error });
            if (verdictPath && fs.existsSync(verdictPath)) {
                const verdictResult = importLegacyArtifact(slug, 'review-verdict.txt', VALID_EVENT_TYPES.REVIEWER_OUTCOME, { round, phase, actor: 'legacy' }, { ...options, worktree: rootDir });
                if (verdictResult.ok && verdictResult.path) {
                    imported.push({ artifactName: 'review-verdict.txt', eventType: VALID_EVENT_TYPES.REVIEWER_OUTCOME, path: verdictResult.path, legacyPath: verdictResult.legacyPath });
                }
                else if (!verdictResult.ok) {
                    errors.push({ artifactName: 'review-verdict.txt', eventType: VALID_EVENT_TYPES.REVIEWER_OUTCOME, error: verdictResult.error });
                }
            }
        }
    }
    else if (verdictPath && fs.existsSync(verdictPath)) {
        let verdictContent = null;
        try {
            verdictContent = fs.readFileSync(verdictPath, 'utf8').trim();
        }
        catch (err) {
            error(fmt.status('WARN', `Failed to read verdict file: ${err.message}`));
        }
        const outcomeParams = { round, phase, actor: 'legacy' };
        if (verdictContent && isValidVerdict(verdictContent)) {
            outcomeParams.verdict = verdictContent;
        }
        const result = importLegacyArtifact(slug, 'review-verdict.txt', VALID_EVENT_TYPES.REVIEWER_OUTCOME, outcomeParams, { ...options, worktree: rootDir });
        if (result.ok) {
            if (result.path) {
                imported.push({ artifactName: 'review-verdict.txt', eventType: VALID_EVENT_TYPES.REVIEWER_OUTCOME, path: result.path, legacyPath: result.legacyPath });
            }
        }
        else {
            errors.push({ artifactName: 'review-verdict.txt', eventType: VALID_EVENT_TYPES.REVIEWER_OUTCOME, error: result.error });
        }
    }
    for (const artifactName of Object.keys(LEGACY_ARTIFACT_TO_EVENT_TYPE)) {
        if (artifactName === 'review-outcome.md' || artifactName === 'review-verdict.txt') {
            continue;
        }
        const result = importLegacyArtifact(slug, artifactName, LEGACY_ARTIFACT_TO_EVENT_TYPE[artifactName], { round, phase, actor: 'legacy' }, { ...options, worktree: rootDir });
        if (result.ok) {
            if (result.path) {
                imported.push({ artifactName, eventType: LEGACY_ARTIFACT_TO_EVENT_TYPE[artifactName], path: result.path, legacyPath: result.legacyPath });
            }
        }
        else {
            errors.push({ artifactName, eventType: LEGACY_ARTIFACT_TO_EVENT_TYPE[artifactName], error: result.error });
        }
    }
    return { ok: errors.length === 0, imported, errors };
}
// -------- Event Reading --------
/**
 * Read all review events for a mission.
 */
function readAllEvents(slug, options = {}) {
    const { rootDir = process.cwd(), readdirSync = fs.readdirSync, readFileSync = fs.readFileSync, error = fmt.log.plainError } = options;
    const eventsDir = reviewEventsDir(slug, rootDir);
    if (!eventsDir || !fs.existsSync(eventsDir)) {
        return [];
    }
    const events = [];
    let files;
    try {
        files = readdirSync(eventsDir);
    }
    catch (err) {
        error(fmt.status('WARN', `Failed to read review-events directory: ${err.message}`));
        return [];
    }
    for (const filename of files) {
        if (!filename.endsWith('.md')) {
            continue;
        }
        const filePath = path.join(eventsDir, filename);
        let content;
        try {
            content = readFileSync(filePath, 'utf8');
        }
        catch (err) {
            error(fmt.status('WARN', `Failed to read event file ${filename}: ${err.message}`));
            continue;
        }
        const event = parseEventFile(content, filePath);
        if (event) {
            events.push(event);
        }
    }
    events.sort((a, b) => {
        const aTime = a.timestamp || a.fileCreated || '';
        const bTime = b.timestamp || b.fileCreated || '';
        return bTime.localeCompare(aTime);
    });
    return events;
}
/**
 * Parse an event file into a structured object.
 */
function parseEventFile(content, filePath) {
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    const metadata = {};
    let body = content;
    if (frontmatterMatch) {
        const frontmatterText = frontmatterMatch[1];
        body = content.slice(frontmatterMatch[0].length);
        const lines = frontmatterText.split('\n');
        for (const line of lines) {
            if (!line.trim()) {
                continue;
            }
            const colonIdx = line.indexOf(':');
            if (colonIdx === -1) {
                continue;
            }
            const key = line.slice(0, colonIdx).trim().toLowerCase();
            const value = line.slice(colonIdx + 1).trim();
            if ((value.startsWith('"') && value.endsWith('"')) ||
                (value.startsWith("'") && value.endsWith("'"))) {
                metadata[key] = value.slice(1, -1);
            }
            else if (value.startsWith('[') && value.endsWith(']')) {
                try {
                    metadata[key] = JSON.parse(value);
                }
                catch {
                    metadata[key] = value;
                }
            }
            else if (value === 'true') {
                metadata[key] = true;
            }
            else if (value === 'false') {
                metadata[key] = false;
            }
            else if (value !== '' && !isNaN(Number(value))) {
                metadata[key] = Number(value);
            }
            else {
                metadata[key] = value;
            }
        }
    }
    if (!metadata.event_type && filePath) {
        const basename = path.basename(filePath, '.md');
        const parts = basename.split('-');
        if (parts.length >= 4) {
            const possibleType = parts.slice(1, -2).join('-');
            if (isValidEventType(possibleType)) {
                metadata.event_type = possibleType;
            }
        }
    }
    const stat = fs.statSync(filePath);
    return {
        ...metadata,
        content: body.trim(),
        filePath,
        fileCreated: stat.birthtime.toISOString(),
        fileModified: stat.mtime.toISOString()
    };
}
