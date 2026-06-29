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

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { git } from '../core/git.js';
import { findMissionDir, missionBranchName, resolveWorktree } from '../core/mission-utils.js';
import { readReviewState } from './review-state.js';
import * as fmt from '../core/fmt.js';

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
 */
function reviewEventsDir(slug: string, rootDir = process.cwd()): string | null {
  const missionDir = findMissionDir(slug, rootDir);
  if (!missionDir) {return null;}
  const dir = path.join(missionDir, 'review-events');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Returns the path for a specific event file in the mission-local store.
 */
function eventFilePath(slug: string, eventType: string, round: number, actor: string, timestamp: string | null = null, rootDir = process.cwd()): string | null {
  const eventsDir = reviewEventsDir(slug, rootDir);
  if (!eventsDir) {return null;}

  const ts = timestamp || generateEventTimestamp();
  const sanitizedActor = sanitizeFilename(actor);
  const filename = `${ts}-${eventType}-${round}-${sanitizedActor}.md`;
  return path.join(eventsDir, filename);
}

/**
 * Returns the legacy /tmp/ artifact path for compatibility.
 */
function legacyArtifactPath(slug: string, artifactName: string, tmpDir = os.tmpdir()): string {
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
function sanitizeFilename(str: string): string {
  if (!str) {return 'unknown';}
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
function isValidEventType(eventType: string): boolean {
  return (ALL_EVENT_TYPES as string[]).includes(eventType);
}

/**
 * Validate a disposition value.
 */
function isValidDisposition(disposition: string): boolean {
  return VALID_DISPOSITIONS.includes(disposition);
}

/**
 * Validate a verdict value.
 */
function isValidVerdict(verdict: string): boolean {
  return VALID_VERDICTS.includes(verdict);
}

/**
 * Check if an event type should be mirrored to the review provider.
 */
function shouldMirrorToProvider(eventType: string): boolean {
  return (MIRRORED_EVENT_TYPES as Set<string>).has(eventType);
}

// -------- Event Structure --------

interface EventMetadata { [key: string]: unknown; }

interface NormalizedEvent {
  eventType: string;
  timestamp: string;
  content: string;
  slug?: string;
  round?: number;
  phase?: string;
  actor?: string;
  disposition?: string;
  verdict?: string;
  fixedItems?: unknown[];
  pushedBackItems?: unknown[];
  parkedItems?: unknown[];
  blockedReason?: string;
  followUpReference?: string;
}

export interface CreateEventParams {
  content?: string;
  round?: number;
  phase?: string;
  actor?: string;
  disposition?: string;
  verdict?: string;
  fixedItems?: unknown[];
  pushedBackItems?: unknown[];
  parkedItems?: unknown[];
  blockedReason?: string;
  followUpReference?: string;
  timestamp?: string;
}

export interface CreateEventOptions {
  skipGit?: boolean;
  gitFn?: typeof git;
  log?: (msg: string) => void;
  error?: (msg: string) => void;
  worktree?: string;
  allowMissingRequiredFields?: boolean;
}

export interface CreateEventResult {
  ok: boolean;
  path: string | null;
  event?: NormalizedEvent;
  error?: string;
}

export interface CreateEventResultWithLegacy {
  ok: boolean;
  path: string | null;
  importedFrom?: string;
  event?: NormalizedEvent;
  legacyPath?: string;
  error?: string;
  skipped?: boolean;
}

export interface ConsumeHumanNotesResult {
  ok: boolean;
  created: unknown[];
  skipped: unknown[];
  error?: string;
}

export interface ImportAllLegacyResult {
  ok: boolean;
  imported: unknown[];
  errors: unknown[];
}

export interface ReadAllEventsOptions {
  rootDir?: string;
  readdirSync?: typeof fs.readdirSync;
  readFileSync?: typeof fs.readFileSync;
  error?: (msg: string) => void;
}

export interface ParseEventResult {
  event_type?: string;
  [key: string]: unknown;
  content: string;
  filePath: string;
  fileCreated: string;
  fileModified: string;
}

/**
 * Normalize an event payload into a structured format.
 */
function normalizeEventContent(content: string, eventType: string, metadata: EventMetadata = {}): NormalizedEvent {
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
function buildEventFrontmatter(event: NormalizedEvent): string {
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
function buildEventFooter(slug: string, round: number, phase: string): string {
  return `\n\n---\n\`[workflow-round:${round}, workflow-phase:${phase}]\``;
}

/**
 * Check if a comment body contains the workflow metadata footer.
 */
function hasWorkflowFooter(body: string): boolean {
  return /\`\[workflow-round:\d+, workflow-phase:[^\]]+\]\`/.test(body);
}

/**
 * Classify a comment as either workflow-generated or human.
 */
function classifyComment(comment: { body?: string }): string | null {
  const body = comment.body || '';
  if (hasWorkflowFooter(body)) {
    return null;
  }
  return VALID_EVENT_TYPES.HUMAN_NOTE;
}

export interface ConsumeHumanNotesOptions {
  getCommentsFn?: (branch: string, token: string) => Promise<unknown[]>;
  createEventFn?: typeof createEvent;
  readTokenFn?: (user: string) => string | null;
  reviewIdentity?: string | null;
  forgejoUser?: string | null;
  worktree?: string;
  log?: (msg: string) => void;
  error?: (msg: string) => void;
}

/**
 * Consume human notes from provider PR comments.
 */
async function consumeHumanNotes(slug: string, actor: string, options: ConsumeHumanNotesOptions = {}): Promise<ConsumeHumanNotesResult> {
  const {
    getCommentsFn,
    createEventFn = createEvent,
    readTokenFn,
    reviewIdentity = null,
    forgejoUser = null,
    worktree,
    log: logger = fmt.log.plain,
    error = fmt.log.plainError
  } = options;

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

  const branch = missionBranchName(slug, worktree || process.cwd());
  const comments = await getCommentsFn(branch, token);

  if (!comments || !Array.isArray(comments)) {
    logger(fmt.status('INFO', 'consumeHumanNotes: no comments retrieved; skipping classification.'));
    return { ok: true, created: [], skipped: [] };
  }

  const created: unknown[] = [];
  const skipped: unknown[] = [];

  const currentState = readReviewState(slug, worktree || process.cwd());
  const round = currentState ? currentState.round : 1;
  const phase = currentState ? currentState.phase : 'reviewing';

  for (const comment of comments) {
    if (hasWorkflowFooter((comment as { body?: string }).body || '')) {
      skipped.push({ user: (comment as { user?: string }).user, created: (comment as { created?: string }).created, reason: 'workflow-generated' });
      continue;
    }

    const classification = classifyComment(comment as { body?: string });
    if (!classification) {
      skipped.push({ user: (comment as { user?: string }).user, created: (comment as { created?: string }).created, reason: 'already-classified' });
      continue;
    }

    const result = createEventFn(slug, classification, {
      content: (comment as { body?: string }).body || '',
      round,
      phase,
      actor: actor || (comment as { user?: string }).user || 'human'
    }, {
      worktree: worktree || process.cwd(),
      skipGit: true,
      log: logger,
      error
    });

    if (result.ok) {
      created.push({ path: result.path, user: (comment as { user?: string }).user, created: (comment as { created?: string }).created });
    } else {
      error(fmt.status('WARN', `Failed to create human_note event for comment by ${(comment as { user?: string }).user}: ${(result as { error?: string }).error}`));
    }
  }

  logger(fmt.status('INFO', `consumeHumanNotes: created ${created.length} human_note events, skipped ${skipped.length} workflow comments`));
  return { ok: true, created, skipped };
}

/**
 * Render a complete event file content.
 */
function renderEventFile(event: NormalizedEvent): string {
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
function createEvent(slug: string, eventType: string, params: CreateEventParams, options: CreateEventOptions = {}): CreateEventResult {
  const {
    skipGit = false,
    gitFn = git,
    log: logger = fmt.log.plain,
    error = fmt.log.plainError,
    worktree,
    allowMissingRequiredFields = false
  } = options;

  const rootDir = worktree || resolveWorktree(slug) || process.cwd();

  if (!isValidEventType(eventType)) {
    error(fmt.status('FAIL', `Invalid event type "${eventType}". Valid types: ${ALL_EVENT_TYPES.join(', ')}`));
    return { ok: false, path: null, error: `Invalid event type: ${eventType}` };
  }

  if (params.disposition !== undefined && !isValidDisposition(params.disposition as string)) {
    error(fmt.status('FAIL', `Invalid disposition "${params.disposition}". Valid: ${VALID_DISPOSITIONS.join(', ')}`));
    return { ok: false, path: null, error: `Invalid disposition: ${params.disposition}` };
  }

  if (params.verdict !== undefined && !isValidVerdict(params.verdict as string)) {
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

  let state: ReturnType<typeof readReviewState> | null;
  if (params.round === undefined || params.phase === undefined) {
    state = readReviewState(slug, rootDir);
  } else {
    state = null;
  }

  const round = (params.round !== undefined ? params.round : (state ? state!.round : 1)) as number;
  const phase = (params.phase !== undefined ? params.phase : (state ? state!.phase : 'reviewing')) as string;
  const actor = (params.actor as string) || 'unknown';

  const event = normalizeEventContent(
    (params.content as string) || '',
    eventType,
    {
      slug,
      round,
      phase,
      actor,
      eventType,
      timestamp: params.timestamp as string | undefined,
      disposition: params.disposition as string | undefined,
      verdict: params.verdict as string | undefined,
      fixedItems: params.fixedItems as unknown[] | undefined,
      pushedBackItems: params.pushedBackItems as unknown[] | undefined,
      parkedItems: params.parkedItems as unknown[] | undefined,
      blockedReason: params.blockedReason as string | undefined,
      followUpReference: params.followUpReference as string | undefined
    }
  );

  const ts = (params.timestamp as string | undefined) ?? null;
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
    } else {
      const commitMsg = `review-event(${slug}): ${eventType} round ${round} (${phase}) [${actor}]`;
      const commitResult = gitFn(['-C', rootDir, 'commit', '-m', commitMsg, '--allow-empty']);
      if (commitResult.status !== 0) {
        error(fmt.status('WARN', `Failed to commit event file: ${commitResult.stderr}`));
      } else {
        logger(fmt.status('PASS', 'Committed review event to git'));
      }
    }
  }

  return { ok: true, path: filePath, event };
}

export interface ImportLegacyArtifactOptions {
  tmpDir?: string;
  log?: (msg: string) => void;
  error?: (msg: string) => void;
  worktree?: string;
}

/**
 * Import an event from a legacy /tmp/ artifact file.
 */
function importLegacyArtifact(slug: string, artifactName: string, eventType: string, params: CreateEventParams = {}, options: ImportLegacyArtifactOptions = {}): CreateEventResultWithLegacy {
  const {
    tmpDir = os.tmpdir(),
    log: logger = fmt.log.plain,
    error = fmt.log.plainError,
    worktree
  } = options;

  const legacyPath = legacyArtifactPath(slug, artifactName, tmpDir);

  if (!fs.existsSync(legacyPath)) {
    logger(fmt.status('INFO', `Legacy artifact not found: ${legacyPath}`));
    return { ok: true, path: null, importedFrom: legacyPath, skipped: true };
  }

  let content;
  try {
    content = fs.readFileSync(legacyPath, 'utf8');
  } catch (err) {
    error(fmt.status('FAIL', `Failed to read legacy artifact: ${(err as Error).message}`));
    return { ok: false, path: null, importedFrom: legacyPath, error: (err as Error).message };
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
const LEGACY_ARTIFACT_TO_EVENT_TYPE: Readonly<Record<string, string>> = Object.freeze({
  'review-findings.md': VALID_EVENT_TYPES.REVIEWER_FINDINGS,
  'review-outcome.md': VALID_EVENT_TYPES.REVIEWER_OUTCOME,
  'review-verdict.txt': VALID_EVENT_TYPES.REVIEWER_OUTCOME,
  'round-resolution.md': VALID_EVENT_TYPES.IMPLEMENTER_ROUND_SUMMARY,
  'review-disposition.txt': VALID_EVENT_TYPES.IMPLEMENTER_DISPOSITION,
});

export interface ImportAllLegacyOptions {
  tmpDir?: string;
  error?: (msg: string) => void;
  worktree?: string;
  log?: (msg: string) => void;
}

/**
 * Import all legacy /tmp/ artifacts for a mission.
 */
function importAllLegacyArtifacts(slug: string, options: ImportAllLegacyOptions = {}): ImportAllLegacyResult {
  const {
    tmpDir = os.tmpdir(),
    error = fmt.log.plainError,
    worktree
  } = options;

  const rootDir = worktree || resolveWorktree(slug) || process.cwd();
  const imported = [];
  const errors = [];

  const state = readReviewState(slug, rootDir);
  const round = state ? state.round : 1;
  const phase = state ? state.phase : 'reviewing';

  const legacyFiles: Record<string, string | null> = {};
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
      } catch (err) {
        error(fmt.status('WARN', `Failed to read verdict file: ${(err as Error).message}`));
      }
    }

    const outcomeParams: CreateEventParams = { round, phase, actor: 'legacy' };
    if (verdictContent && isValidVerdict(verdictContent)) {
      outcomeParams.verdict = verdictContent;
    }

    const result = importLegacyArtifact(slug, 'review-outcome.md', VALID_EVENT_TYPES.REVIEWER_OUTCOME,
      outcomeParams,
      { ...options, worktree: rootDir });

    if (result.ok) {
      if (result.path) {
        imported.push({ artifactName: 'review-outcome.md', eventType: VALID_EVENT_TYPES.REVIEWER_OUTCOME, path: result.path, legacyPath: result.legacyPath });
        if (verdictPath && fs.existsSync(verdictPath)) {
          imported.push({ artifactName: 'review-verdict.txt', eventType: VALID_EVENT_TYPES.REVIEWER_OUTCOME, path: result.path, legacyPath: verdictPath, asMetadata: true });
        }
      }
    } else {
      errors.push({ artifactName: 'review-outcome.md', eventType: VALID_EVENT_TYPES.REVIEWER_OUTCOME, error: result.error });
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
    let verdictContent = null;
    try {
      verdictContent = fs.readFileSync(verdictPath, 'utf8').trim();
    } catch (err) {
        error(fmt.status('WARN', `Failed to read verdict file: ${(err as Error).message}`));
    }

    const outcomeParams: CreateEventParams = { round, phase, actor: 'legacy' };
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

  for (const artifactName of Object.keys(LEGACY_ARTIFACT_TO_EVENT_TYPE)) {
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
 */
function readAllEvents(slug: string, options: ReadAllEventsOptions = {}): unknown[] {
  const {
    rootDir = process.cwd(),
    readdirSync = fs.readdirSync,
    readFileSync = fs.readFileSync,
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
    error(fmt.status('WARN', `Failed to read review-events directory: ${(err as Error).message}`));
    return [];
  }

  for (const filename of files) {
    if (!filename.endsWith('.md')) { continue; }

    const filePath = path.join(eventsDir, filename);
    let content;

    try {
      content = readFileSync(filePath, 'utf8');
    } catch (err) {
      error(fmt.status('WARN', `Failed to read event file ${filename}: ${(err as Error).message}`));
      continue;
    }

    const event = parseEventFile(content, filePath);
    if (event) {
      events.push(event);
    }
  }

  events.sort((a, b) => {
    const aTime = (a.timestamp as string) || (a.fileCreated as string) || '';
    const bTime = (b.timestamp as string) || (b.fileCreated as string) || '';
    return bTime.localeCompare(aTime);
  });

  return events;
}

/**
 * Parse an event file into a structured object.
 */
function parseEventFile(content: string, filePath: string): ParseEventResult {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);

  const metadata: Record<string, unknown> = {};
  let body = content;

  if (frontmatterMatch) {
    const frontmatterText = frontmatterMatch[1];
    body = content.slice(frontmatterMatch[0].length);

    const lines = frontmatterText.split('\n');
    for (const line of lines) {
      if (!line.trim()) { continue; }
      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) { continue; }

      const key = line.slice(0, colonIdx).trim().toLowerCase();
      const value = line.slice(colonIdx + 1).trim();

      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        metadata[key] = value.slice(1, -1);
      } else if (value.startsWith('[') && value.endsWith(']')) {
        try {
          metadata[key] = JSON.parse(value);
        } catch {
          metadata[key] = value;
        }
      } else if (value === 'true') { metadata[key] = true; }
      else if (value === 'false') { metadata[key] = false; }
      else if (value !== '' && !isNaN(Number(value))) { metadata[key] = Number(value); }
      else { metadata[key] = value; }
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

export { shouldMirrorToProvider as shouldMirrorToForgejo };

// -------- Module Exports --------

// Taxonomy constants
export {
  VALID_EVENT_TYPES,
  ALL_EVENT_TYPES,
  MIRRORED_EVENT_TYPES,
  VALID_DISPOSITIONS,
  VALID_VERDICTS
};

// Validation
export {
  isValidEventType,
  isValidDisposition,
  isValidVerdict,
  shouldMirrorToProvider
};

// Path resolution
export {
  reviewEventsDir,
  eventFilePath,
  legacyArtifactPath
};

// Event creation
export {
  createEvent,
  normalizeEventContent
};

// Legacy compatibility
export {
  importLegacyArtifact,
  importAllLegacyArtifacts,
  LEGACY_ARTIFACT_TO_EVENT_TYPE
};

// Event reading
export {
  readAllEvents,
  parseEventFile
};

// Rendering
export {
  buildEventFrontmatter,
  buildEventFooter,
  renderEventFile
};

// Classification
export {
  hasWorkflowFooter,
  classifyComment,
  consumeHumanNotes
};

// Utilities
export {
  generateEventTimestamp,
  sanitizeFilename
};
