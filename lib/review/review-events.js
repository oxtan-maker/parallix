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

const fs = require('fs');
const path = require('path');
const os = require('os');
const { git } = require('../core/git');
const { findMissionDir, missionBranchName, resolveWorktree } = require('../core/mission-utils');
const { readReviewState } = require('./review-state');
const fmt = require('../core/fmt');

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

/**
 * All valid event type values as an array for validation.
 */
const ALL_EVENT_TYPES = Object.freeze(Object.values(VALID_EVENT_TYPES));

/**
 * Event types that should be mirrored to the review provider.
 * Reviewer findings, reviewer outcome, implementer round summary, implementer disposition,
 * and round-affecting human notes are mirrored.
 * Raw draft artifacts, retry bookkeeping, classification metadata, and local diagnostics
 * remain workflow-local by default.
 */
const MIRRORED_EVENT_TYPES = Object.freeze(new Set([
  VALID_EVENT_TYPES.REVIEWER_FINDINGS,
  VALID_EVENT_TYPES.REVIEWER_OUTCOME,
  VALID_EVENT_TYPES.IMPLEMENTER_ROUND_SUMMARY,
  VALID_EVENT_TYPES.IMPLEMENTER_DISPOSITION,
  VALID_EVENT_TYPES.HUMAN_NOTE
]));

/**
 * Valid disposition values for implementer disposition events.
 */
const VALID_DISPOSITIONS = Object.freeze([
  'CHANGES_MADE',
  'PUSHBACK_ALL',
  'PARKED',
  'BLOCKED'
]);

/**
 * Valid review verdict values for reviewer outcome events.
 */
const VALID_VERDICTS = Object.freeze([
  'approve',
  'request-changes',
  'comment'
]);

// -------- Path Resolution --------

/**
 * Returns the absolute path to the mission-local review-events directory.
 * Creates the directory if it does not exist.
 *
 * @param {string} slug - Mission slug
 * @param {string} [rootDir] - Root directory to resolve from (defaults to process.cwd())
 * @returns {string|null} - Absolute path to review-events dir, or null if mission dir not found
 */
function reviewEventsDir(slug, rootDir = process.cwd()) {
  const missionDir = findMissionDir(slug, rootDir);
  if (!missionDir) return null;
  const dir = path.join(missionDir, 'review-events');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Returns the path for a specific event file in the mission-local store.
 *
 * Filename pattern: <timestamp>-<classification>-<round>-<actor>.md
 *   timestamp: ISO 8601 date-time without colons (e.g., 2026-05-25T143022)
 *   classification: event type from VALID_EVENT_TYPES
 *   round: review round number
 *   actor: agent family name or 'human'
 *
 * @param {string} slug - Mission slug
 * @param {string} eventType - One of VALID_EVENT_TYPES
 * @param {number} round - Review round number
 * @param {string} actor - Agent family or 'human'
 * @param {string} [timestamp] - Optional ISO timestamp; defaults to now
 * @param {string} [rootDir] - Root directory to resolve from
 * @returns {string|null} - Absolute file path, or null if mission dir not found
 */
function eventFilePath(slug, eventType, round, actor, timestamp = null, rootDir = process.cwd()) {
  const eventsDir = reviewEventsDir(slug, rootDir);
  if (!eventsDir) return null;
  
  const ts = timestamp || generateEventTimestamp();
  const sanitizedActor = sanitizeFilename(actor);
  const filename = `${ts}-${eventType}-${round}-${sanitizedActor}.md`;
  return path.join(eventsDir, filename);
}

/**
 * Returns the legacy /tmp/ artifact path for compatibility.
 *
 * @param {string} slug - Mission slug
 * @param {string} artifactName - e.g., 'review-findings.md'
 * @param {string} [tmpDir] - Temp directory, defaults to os.tmpdir()
 * @returns {string} - Full path to the /tmp/ artifact
 */
function legacyArtifactPath(slug, artifactName, tmpDir = os.tmpdir()) {
  return path.join(tmpDir, `${slug}-${artifactName}`);
}

// -------- Timestamp & Sanitization --------

/**
 * Generate a filesystem-safe ISO timestamp without colons.
 * @returns {string} - e.g., '2026-05-25T143022'
 */
function generateEventTimestamp() {
  const now = new Date();
  const datePart = now.toISOString().split('T')[0];
  const timePart = now.toISOString().split('T')[1].split('.')[0];
  // Replace colons with nothing for filesystem safety
  return `${datePart}T${timePart.replace(/:/g, '')}`;
}

/**
 * Sanitize a string for use in a filename.
 * Removes all non-alphanumeric characters except hyphens and underscores.
 * @param {string} str - Input string
 * @returns {string} - Filesystem-safe string
 */
function sanitizeFilename(str) {
  if (!str) return 'unknown';
  return String(str)
    .toLowerCase()
    // Replace @ and . with empty string first (common in emails/agent names)
    .replace(/[@.]/g, '')
    // Then replace any remaining non-alphanumeric/underscore/hyphen with hyphen
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// -------- Event Validation --------

/**
 * Validate an event type against the taxonomy.
 * @param {string} eventType - The type to validate
 * @returns {boolean} - True if valid
 */
function isValidEventType(eventType) {
  return ALL_EVENT_TYPES.includes(eventType);
}

/**
 * Validate a disposition value.
 * @param {string} disposition - The disposition to validate
 * @returns {boolean} - True if valid
 */
function isValidDisposition(disposition) {
  return VALID_DISPOSITIONS.includes(disposition);
}

/**
 * Validate a verdict value.
 * @param {string} verdict - The verdict to validate
 * @returns {boolean} - True if valid
 */
function isValidVerdict(verdict) {
  return VALID_VERDICTS.includes(verdict);
}

/**
 * Check if an event type should be mirrored to the review provider.
 * @param {string} eventType - The event type
 * @returns {boolean} - True if mirrored
 */
function shouldMirrorToProvider(eventType) {
  return MIRRORED_EVENT_TYPES.has(eventType);
}

// -------- Event Structure --------

/**
 * Normalize an event payload into a structured format.
 * Extracts metadata from content and ensures required fields are present.
 *
 * @param {string} content - The raw event content (markdown)
 * @param {string} eventType - The event classification
 * @param {Object} [metadata] - Additional metadata (round, phase, actor, etc.)
 * @returns {Object} - Normalized event structure
 */
function normalizeEventContent(content, eventType, metadata = {}) {
  const payload = { ...metadata };
  
  // Ensure we have the base metadata
  payload.eventType = eventType;
  payload.timestamp = payload.timestamp || new Date().toISOString();
  
  // Add content
  payload.content = content;
  
  return payload;
}

/**
 * Build the frontmatter for an event file.
 * Uses YAML-style frontmatter for structured metadata.
 *
 * @param {Object} event - Normalized event structure
 * @returns {string} - Frontmatter block
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
  
  // Add event-specific fields
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
 * Matches the existing pattern in review.js:793-797
 *
 * @param {string} slug - Mission slug
 * @param {number} round - Review round
 * @param {string} phase - Current phase
 * @returns {string} - Metadata footer
 */
function buildEventFooter(slug, round, phase) {
  return `\n\n---\n\`[workflow-round:${round}, workflow-phase:${phase}]\``;
}

/**
 * Check if a comment body contains the workflow metadata footer.
 * Comments with this footer are workflow-generated; comments without are human.
 *
 * @param {string} body - Comment body text
 * @returns {boolean} - true if comment has workflow footer
 */
function hasWorkflowFooter(body) {
  return /\`\[workflow-round:\d+, workflow-phase:[^\]]+\]\`/.test(body);
}

/**
 * Classify a comment as either workflow-generated or human.
 * Workflow-generated comments have the metadata footer; human comments do not.
 *
 * @param {Object} comment - Comment object with body field
 * @returns {string|null} - 'human_note' if human, null if workflow-generated
 */
function classifyComment(comment) {
  const body = comment.body || '';
  // Workflow-generated comments have the metadata footer
  if (hasWorkflowFooter(body)) {
    return null; // Workflow-generated, not a human note
  }
  // Human comments (no workflow footer) are classified as human_note
  return VALID_EVENT_TYPES.HUMAN_NOTE;
}

/**
 * Consume human notes from provider PR comments.
 * Reads PR comments, classifies human (non-workflow) comments, and creates
 * human_note events for them. Human comments do not have the workflow metadata footer.
 * 
 * This function satisfies SC 6: Human provider comments are classified as human_note
 * or ignored as non-round-affecting input by an explicit workflow rule; neither path
 * can mutate review-state.json without a workflow command that records a repo-owned event.
 * 
 * @param {string} slug - Mission slug
 * @param {string} actor - Actor family (e.g., 'codex', 'mistral') or 'human'
 * @param {Object} [options] - Options
 * @param {Function} [options.getCommentsFn] - Function to get provider comments
 * @param {Function} [options.createEventFn] - Function to create events (default: createEvent)
 * @param {Function} [options.readTokenFn] - Function to read provider token
 * @param {string} [options.worktree] - Working tree directory
 * @param {Function} [options.log] - Log function
 * @param {Function} [options.error] - Error function
 * @returns {Object} - { ok: boolean, created: Array, skipped: Array }
 */
async function consumeHumanNotes(slug, actor, options = {}) {
  const {
    getCommentsFn,
    createEventFn = createEvent,
    readTokenFn,
    reviewIdentity = null,
    forgejoUser = null,
    worktree,
    log = fmt.log.plain,
    error = fmt.log.plainError
  } = options;

  const actorIdentity = reviewIdentity || forgejoUser;
  if (!actorIdentity) {
    error(fmt.status('FAIL', 'Review identity is required for consumeHumanNotes.'));
    return { ok: false, created: [], skipped: [], error: 'reviewIdentity required' };
  }

  // In sandbox/Codex environments, the provider may be unreachable from Node subprocesses.
  // This is acceptable - human note classification is best-effort
  if (!getCommentsFn) {
    log(fmt.status('INFO', 'consumeHumanNotes: no getCommentsFn provided; skipping human note classification.'));
    return { ok: true, created: [], skipped: [] };
  }

  const token = readTokenFn ? readTokenFn(actorIdentity) : null;
  if (!token) {
    log(fmt.status('INFO', 'consumeHumanNotes: no provider token found; skipping human note classification.'));
    return { ok: true, created: [], skipped: [] };
  }

  const branch = missionBranchName(slug, worktree || process.cwd());
  const comments = await getCommentsFn(branch, token);

  if (!comments || !Array.isArray(comments)) {
    log(fmt.status('INFO', 'consumeHumanNotes: no comments retrieved; skipping classification.'));
    return { ok: true, created: [], skipped: [] };
  }

  const created = [];
  const skipped = [];

  // Get current review state for round/phase metadata
  const currentState = readReviewState(slug, worktree || process.cwd());
  const round = currentState ? currentState.round : 1;
  const phase = currentState ? currentState.phase : 'reviewing';

  for (const comment of comments) {
    // Skip workflow-generated comments (have the metadata footer)
    if (hasWorkflowFooter(comment.body || '')) {
      skipped.push({ user: comment.user, created: comment.created, reason: 'workflow-generated' });
      continue;
    }

    // Classify as human_note
    const classification = classifyComment(comment);
    if (!classification) {
      skipped.push({ user: comment.user, created: comment.created, reason: 'already-classified' });
      continue;
    }

    // Create human_note event
    const result = createEventFn(slug, classification, {
      content: comment.body || '',
      round,
      phase,
      actor: actor || comment.user || 'human'
    }, {
      worktree: worktree || process.cwd(),
      skipGit: true,
      log,
      error
    });

    if (result.ok) {
      created.push({ path: result.path, user: comment.user, created: comment.created });
    } else {
      error(fmt.status('WARN', `Failed to create human_note event for comment by ${comment.user}: ${result.error}`));
    }
  }

  log(fmt.status('INFO', `consumeHumanNotes: created ${created.length} human_note events, skipped ${skipped.length} workflow comments`));
  return { ok: true, created, skipped };
}

/**
 * Render a complete event file content.
 *
 * @param {Object} event - Normalized event structure
 * @returns {string} - Complete file content
 */
function renderEventFile(event) {
  const frontmatter = buildEventFrontmatter(event);
  const content = event.content || '';
  
  // If the content already has a metadata footer, don't add another
  const hasFooter = /\n\n---\n`\[workflow-round:\d+, workflow-phase:[^\]]+\]`/.test(content);
  
  if (hasFooter) {
    return `${frontmatter}\n\n${content}`;
  }
  
  // Add footer if we have round and phase
  const footer = event.round !== undefined && event.phase !== undefined
    ? buildEventFooter(event.slug, event.round, event.phase)
    : '';
  
  return `${frontmatter}\n\n${content}${footer}`;
}

// -------- Event Creation --------

/**
 * Create and persist a classified review event.
 *
 * @param {string} slug - Mission slug
 * @param {string} eventType - One of VALID_EVENT_TYPES
 * @param {Object} params - Event parameters
 * @param {string} params.content - The event content (markdown)
 * @param {number} [params.round] - Review round number (from state)
 * @param {string} [params.phase] - Current phase (from state)
 * @param {string} [params.actor] - Agent family or 'human'
 * @param {string} [params.disposition] - For implementer disposition events
 * @param {string} [params.verdict] - For reviewer outcome events
 * @param {Array} [params.fixedItems] - For implementer round summary
 * @param {Array} [params.pushedBackItems] - For implementer round summary
 * @param {Array} [params.parkedItems] - For implementer round summary
 * @param {string} [params.blockedReason] - For BLOCKED events
 * @param {string} [params.followUpReference] - For PARKED_FOLLOWUP events
 * @param {string} [params.timestamp] - Custom timestamp
 * @param {string} [rootDir] - Root directory
 * @param {Object} [options] - Additional options
 * @param {boolean} [options.skipGit] - Skip git add/commit
 * @param {Function} [options.gitFn] - Git function override for testing
 * @returns {Object} - { ok: boolean, path: string|null, error: string|null }
 */
function createEvent(slug, eventType, params, options = {}) {
  const {
    skipGit = false,
    gitFn = git,
    log = fmt.log.plain,
    error = fmt.log.plainError,
    worktree,
    allowMissingRequiredFields = false
  } = options;
  
  const rootDir = worktree || resolveWorktree(slug) || process.cwd();
  
  // Validate event type
  if (!isValidEventType(eventType)) {
    error(fmt.status('FAIL', `Invalid event type "${eventType}". Valid types: ${ALL_EVENT_TYPES.join(', ')}`));
    return { ok: false, path: null, error: `Invalid event type: ${eventType}` };
  }
  
  // Validate disposition if provided
  if (params.disposition !== undefined && !isValidDisposition(params.disposition)) {
    error(fmt.status('FAIL', `Invalid disposition "${params.disposition}". Valid: ${VALID_DISPOSITIONS.join(', ')}`));
    return { ok: false, path: null, error: `Invalid disposition: ${params.disposition}` };
  }
  
  // Validate verdict if provided
  if (params.verdict !== undefined && !isValidVerdict(params.verdict)) {
    error(fmt.status('FAIL', `Invalid verdict "${params.verdict}". Valid: ${VALID_VERDICTS.join(', ')}`));
    return { ok: false, path: null, error: `Invalid verdict: ${params.verdict}` };
  }
  
  // Validate required fields for specific event types
  // Skip validation for legacy imports which may not have all required fields
  if (!allowMissingRequiredFields) {
    if (eventType === VALID_EVENT_TYPES.REVIEWER_OUTCOME && !params.verdict) {
      error(fmt.status('FAIL', `reviewer_outcome event requires --verdict`));
      return { ok: false, path: null, error: 'reviewer_outcome event requires verdict' };
    }
    if (eventType === VALID_EVENT_TYPES.IMPLEMENTER_DISPOSITION && !params.disposition) {
      error(fmt.status('FAIL', `implementer_disposition event requires --disposition`));
      return { ok: false, path: null, error: 'implementer_disposition event requires disposition' };
    }
  }
  
  // Get current review state for round/phase if not provided
  let state;
  if (params.round === undefined || params.phase === undefined) {
    state = readReviewState(slug, rootDir);
  }
  
  const round = params.round !== undefined ? params.round : (state ? state.round : 1);
  const phase = params.phase !== undefined ? params.phase : (state ? state.phase : 'reviewing');
  const actor = params.actor || 'unknown';
  
  // Build event structure
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
  
  // Determine file path
  const filePath = eventFilePath(slug, eventType, round, actor, params.timestamp, rootDir);
  if (!filePath) {
    error(fmt.status('FAIL', `Cannot resolve mission directory for slug "${slug}"`));
    return { ok: false, path: null, error: `Mission directory not found` };
  }
  
  // Ensure parent directory exists
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  // Render and write
  const content = renderEventFile(event);
  fs.writeFileSync(filePath, content, 'utf8');
  
  log(fmt.status('PASS', `Created review event: ${path.basename(filePath)}`));
  
  // Git add and commit
  if (!skipGit) {
    const relPath = path.relative(rootDir, filePath);
    const result = gitFn(['-C', rootDir, 'add', relPath]);
    if (result.status !== 0) {
      error(fmt.status('WARN', `Failed to git add event file: ${result.stderr}`));
    } else {
      const commitMsg = `review-event(${slug}): ${eventType} round ${round} (${phase}) [${actor}]`;
      const commitResult = gitFn(['-C', rootDir, 'commit', '-m', commitMsg, '--allow-empty']);
      if (commitResult.status !== 0) {
        error(fmt.status('WARN', `Failed to commit event file: ${commitResult.stderr}`));
      } else {
        log(fmt.status('PASS', `Committed review event to git`));
      }
    }
  }
  
  return { ok: true, path: filePath, event };
}

/**
 * Import an event from a legacy /tmp/ artifact file.
 * Normalizes the content and stores it in the repo-owned mission store.
 *
 * @param {string} slug - Mission slug
 * @param {string} artifactName - e.g., 'review-findings.md', 'round-resolution.md'
 * @param {string} eventType - The classification to assign
 * @param {Object} [params] - Additional parameters (round, phase, actor, etc.)
 * @param {Object} [options] - Options (same as createEvent)
 * @returns {Object} - { ok: boolean, path: string|null, importedFrom: string|null, error: string|null }
 */
function importLegacyArtifact(slug, artifactName, eventType, params = {}, options = {}) {
  const {
    tmpDir = os.tmpdir(),
    log = fmt.log.plain,
    error = fmt.log.plainError,
    worktree
  } = options;
  
  const rootDir = worktree || resolveWorktree(slug) || process.cwd();
  const legacyPath = legacyArtifactPath(slug, artifactName, tmpDir);
  
  // Check if legacy file exists
  if (!fs.existsSync(legacyPath)) {
    log(fmt.status('INFO', `Legacy artifact not found: ${legacyPath}`));
    return { ok: true, path: null, importedFrom: legacyPath, skipped: true };
  }
  
  // Read legacy content
  let content;
  try {
    content = fs.readFileSync(legacyPath, 'utf8');
  } catch (err) {
    error(fmt.status('FAIL', `Failed to read legacy artifact: ${err.message}`));
    return { ok: false, path: null, importedFrom: legacyPath, error: err.message };
  }
  
  // Create the normalized event
  // Allow missing required fields for legacy imports (they may not have verdict/disposition)
  const result = createEvent(slug, eventType, { 
    content,
    ...params,
    // Default actor from artifact name
    actor: params.actor || inferActorFromArtifact(artifactName)
  }, { ...options, worktree: rootDir, allowMissingRequiredFields: true });
  
  if (!result.ok) {
    return { ok: false, path: null, importedFrom: legacyPath, error: result.error };
  }
  
  log(fmt.status('PASS', `Imported legacy artifact ${artifactName} to ${path.basename(result.path)}`));
  
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
 * In practice, the actor should be passed explicitly from the workflow context.
 */
function inferActorFromArtifact(artifactName) {
  // Can't reliably infer from artifact name alone
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

/**
 * Import all legacy /tmp/ artifacts for a mission.
 * Used during the transition to repo-owned storage.
 *
 * Special handling: review-verdict.txt is treated as metadata (verdict field)
 * for review-outcome.md, not as a standalone reviewer_outcome event.
 * This prevents duplicate reviewer_outcome events.
 *
 * @param {string} slug - Mission slug
 * @param {Object} [options] - Options
 * @returns {Object} - { ok: boolean, imported: Array, errors: Array }
 */
function importAllLegacyArtifacts(slug, options = {}) {
  const {
    tmpDir = os.tmpdir(),
    log = fmt.log.plain,
    error = fmt.log.plainError,
    worktree
  } = options;
  
  const rootDir = worktree || resolveWorktree(slug) || process.cwd();
  const imported = [];
  const errors = [];
  
  // Get current review state for round/phase
  const state = readReviewState(slug, rootDir);
  const round = state ? state.round : 1;
  const phase = state ? state.phase : 'reviewing';
  
  // Track which legacy files exist
  const legacyFiles = {};
  for (const artifactName of Object.keys(LEGACY_ARTIFACT_TO_EVENT_TYPE)) {
    const legacyPath = legacyArtifactPath(slug, artifactName, tmpDir);
    legacyFiles[artifactName] = fs.existsSync(legacyPath) ? legacyPath : null;
  }
  
  // Special case: handle review-outcome.md and review-verdict.txt together
  // review-verdict.txt contains the verdict metadata for review-outcome.md
  const outcomePath = legacyFiles['review-outcome.md'];
  const verdictPath = legacyFiles['review-verdict.txt'];
  
  if (outcomePath && fs.existsSync(outcomePath)) {
    // Read verdict content if it exists
    let verdictContent = null;
    if (verdictPath) {
      try {
        if (fs.existsSync(verdictPath)) {
          verdictContent = fs.readFileSync(verdictPath, 'utf8').trim();
        }
      } catch (err) {
        error(fmt.status('WARN', `Failed to read verdict file: ${err.message}`));
      }
    }
    
    // Import review-outcome.md with verdict as metadata (only include verdict if valid)
    const outcomeParams = { round, phase, actor: 'legacy' };
    if (verdictContent && isValidVerdict(verdictContent)) {
      outcomeParams.verdict = verdictContent;
    }
    
    const result = importLegacyArtifact(slug, 'review-outcome.md', VALID_EVENT_TYPES.REVIEWER_OUTCOME, 
      outcomeParams, 
      { ...options, worktree: rootDir });
    
    if (result.ok) {
      if (result.path) {
        imported.push({ artifactName: 'review-outcome.md', eventType: VALID_EVENT_TYPES.REVIEWER_OUTCOME, path: result.path, legacyPath: result.legacyPath });
        // Mark review-verdict.txt as imported (as metadata) even though it wasn't a separate event
        if (verdictPath && fs.existsSync(verdictPath)) {
          imported.push({ artifactName: 'review-verdict.txt', eventType: VALID_EVENT_TYPES.REVIEWER_OUTCOME, path: result.path, legacyPath: verdictPath, asMetadata: true });
        }
      }
    } else {
      errors.push({ artifactName: 'review-outcome.md', eventType: VALID_EVENT_TYPES.REVIEWER_OUTCOME, error: result.error });
      // If outcome import fails and verdict exists separately, still try to import it
      if (verdictPath && fs.existsSync(verdictPath)) {
        const verdictResult = importLegacyArtifact(slug, 'review-verdict.txt', VALID_EVENT_TYPES.REVIEWER_OUTCOME, 
          { round, phase, actor: 'legacy' }, 
          { ...options, worktree: rootDir });
        if (verdictResult.ok && verdictResult.path) {
          imported.push({ artifactName: 'review-verdict.txt', eventType: VALID_EVENT_TYPES.REVIEWER_OUTCOME, path: verdictResult.path, legacyPath: verdictResult.legacyPath });
        } else if (!verdictResult.ok) {
          errors.push({ artifactName: 'review-verdict.txt', eventType: VALID_EVENT_TYPES.REVIEWER_OUTCOME, error: verdictResult.error });
        }
      }
    }
  } else if (verdictPath && fs.existsSync(verdictPath)) {
    // Only review-verdict.txt exists (no review-outcome.md) - import it as a standalone event
    // This is a fallback for incomplete artifact sets
    // Read the verdict content from the file to use as the verdict param
    let verdictContent = null;
    try {
      verdictContent = fs.readFileSync(verdictPath, 'utf8').trim();
    } catch (err) {
      error(fmt.status('WARN', `Failed to read verdict file: ${err.message}`));
    }
    
    const outcomeParams = { round, phase, actor: 'legacy' };
    if (verdictContent && isValidVerdict(verdictContent)) {
      outcomeParams.verdict = verdictContent;
    }
    
    const result = importLegacyArtifact(slug, 'review-verdict.txt', VALID_EVENT_TYPES.REVIEWER_OUTCOME, 
      outcomeParams, 
      { ...options, worktree: rootDir });
    
    if (result.ok) {
      if (result.path) {
        imported.push({ artifactName: 'review-verdict.txt', eventType: VALID_EVENT_TYPES.REVIEWER_OUTCOME, path: result.path, legacyPath: result.legacyPath });
      }
    } else {
      errors.push({ artifactName: 'review-verdict.txt', eventType: VALID_EVENT_TYPES.REVIEWER_OUTCOME, error: result.error });
    }
  }
  
  // Import all other artifacts normally
  for (const artifactName of Object.keys(LEGACY_ARTIFACT_TO_EVENT_TYPE)) {
    // Skip review-outcome.md and review-verdict.txt as they were handled above
    if (artifactName === 'review-outcome.md' || artifactName === 'review-verdict.txt') {
      continue;
    }
    
    const result = importLegacyArtifact(slug, artifactName, LEGACY_ARTIFACT_TO_EVENT_TYPE[artifactName], 
      { round, phase, actor: 'legacy' }, 
      { ...options, worktree: rootDir });
    
    if (result.ok) {
      if (result.path) {
        imported.push({ artifactName, eventType: LEGACY_ARTIFACT_TO_EVENT_TYPE[artifactName], path: result.path, legacyPath: result.legacyPath });
      }
    } else {
      errors.push({ artifactName, eventType: LEGACY_ARTIFACT_TO_EVENT_TYPE[artifactName], error: result.error });
    }
  }
  
  return { ok: errors.length === 0, imported, errors };
}

// -------- Event Reading --------

/**
 * Read all review events for a mission.
 *
 * @param {string} slug - Mission slug
 * @param {Object} [options] - Options
 * @param {string} [options.rootDir] - Root directory
 * @param {Function} [options.readdirSync] - readdirSync override for testing
 * @param {Function} [options.readFileSync] - readFileSync override for testing
 * @returns {Array} - Array of parsed event objects
 */
function readAllEvents(slug, options = {}) {
  const {
    rootDir = process.cwd(),
    readdirSync = fs.readdirSync,
    readFileSync = fs.readFileSync,
    log = fmt.log.plain,
    error = fmt.log.plainError
  } = options;
  
  const eventsDir = reviewEventsDir(slug, rootDir);
  if (!eventsDir || !fs.existsSync(eventsDir)) {
    return [];
  }
  
  const events = [];
  let files;
  
  try {
    files = readdirSync(eventsDir);
  } catch (err) {
    error(fmt.status('WARN', `Failed to read review-events directory: ${err.message}`));
    return [];
  }
  
  for (const filename of files) {
    if (!filename.endsWith('.md')) continue;
    
    const filePath = path.join(eventsDir, filename);
    let content;
    
    try {
      content = readFileSync(filePath, 'utf8');
    } catch (err) {
      error(fmt.status('WARN', `Failed to read event file ${filename}: ${err.message}`));
      continue;
    }
    
    const event = parseEventFile(content, filePath);
    if (event) {
      events.push(event);
    }
  }
  
  // Sort by timestamp descending (newest first)
  events.sort((a, b) => {
    const aTime = a.timestamp || a.fileCreated || '';
    const bTime = b.timestamp || b.fileCreated || '';
    return bTime.localeCompare(aTime);
  });
  
  return events;
}

/**
 * Parse an event file into a structured object.
 * Extracts frontmatter metadata and content body.
 *
 * @param {string} content - File content
 * @param {string} filePath - File path (for fallback metadata)
 * @returns {Object|null} - Parsed event or null
 */
function parseEventFile(content, filePath) {
  // Try to parse frontmatter
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  
  const metadata = {};
  let body = content;
  
  if (frontmatterMatch) {
    const frontmatterText = frontmatterMatch[1];
    body = content.slice(frontmatterMatch[0].length);
    
    // Parse YAML-like frontmatter
    const lines = frontmatterText.split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) continue;
      
      const key = line.slice(0, colonIdx).trim().toLowerCase();
      const value = line.slice(colonIdx + 1).trim();
      
      // Handle quoted strings
      if ((value.startsWith('"') && value.endsWith('"')) || 
          (value.startsWith("'") && value.endsWith("'"))) {
        metadata[key] = value.slice(1, -1);
      }
      // Handle JSON arrays
      else if (value.startsWith('[') && value.endsWith(']')) {
        try {
          metadata[key] = JSON.parse(value);
        } catch (_) {
          metadata[key] = value;
        }
      }
      // Handle booleans and numbers
      else if (value === 'true') metadata[key] = true;
      else if (value === 'false') metadata[key] = false;
      else if (!isNaN(value)) metadata[key] = Number(value);
      else metadata[key] = value;
    }
  }
  
  // Extract from filename if frontmatter missing
  if (!metadata.event_type && filePath) {
    const basename = path.basename(filePath, '.md');
    // Pattern: <timestamp>-<eventType>-<round>-<actor>
    const parts = basename.split('-');
    if (parts.length >= 4) {
      // eventType is typically the second part after timestamp
      const possibleType = parts.slice(1, -2).join('-');
      if (isValidEventType(possibleType)) {
        metadata.event_type = possibleType;
      }
    }
  }
  
  // Add file metadata
  const stat = fs.statSync(filePath);
  
  return {
    ...metadata,
    content: body.trim(),
    filePath,
    fileCreated: stat.birthtime.toISOString(),
    fileModified: stat.mtime.toISOString()
  };
}

const shouldMirrorToForgejo = shouldMirrorToProvider;

// -------- Module Exports --------

module.exports = {
  // Taxonomy constants
  VALID_EVENT_TYPES,
  ALL_EVENT_TYPES,
  MIRRORED_EVENT_TYPES,
  VALID_DISPOSITIONS,
  VALID_VERDICTS,
  
  // Validation
  isValidEventType,
  isValidDisposition,
  isValidVerdict,
  shouldMirrorToProvider,
  shouldMirrorToForgejo,
  
  // Path resolution
  reviewEventsDir,
  eventFilePath,
  legacyArtifactPath,
  
  // Event creation
  createEvent,
  normalizeEventContent,
  
  // Legacy compatibility
  importLegacyArtifact,
  importAllLegacyArtifacts,
  LEGACY_ARTIFACT_TO_EVENT_TYPE,
  
  // Event reading
  readAllEvents,
  parseEventFile,
  
  // Rendering
  buildEventFrontmatter,
  buildEventFooter,
  renderEventFile,
  
  // Classification
  hasWorkflowFooter,
  classifyComment,
  consumeHumanNotes,
  
  // Utilities
  generateEventTimestamp,
  sanitizeFilename,
};
