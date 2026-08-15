/**
 * Review event persistence for autonomous review rounds.
 *
 * Review events live in the operator database (mission_review_events, part of
 * the Review aggregate) and only there. The Markdown files under
 * missions/<slug>/review-events/ are exports of those rows — written so humans
 * and agents can read a mission's review conversation from its directory, and
 * never read back by production. Losing them loses nothing; losing the database
 * row loses the event.
 *
 * Owned by the Node workflow harness (architecture migration).
 */

import * as fs from 'fs';
import * as path from 'path';
import { git } from '../git/git.js';
import { findMissionDir, missionBranchName, resolveWorktree } from '../filesystem/mission-utils.js';
import { missionId } from '../../domain/mission.js';
import type { Review, ReviewEventType, ReviewItemDisposition } from '../../domain/review.js';
import * as crypto from 'node:crypto';
import { readReviewState, writeReviewState, ReviewState } from './review-state.js';
import * as fmt from '../../application/presentation/cli-format.js';
import type { MissionStore } from '../../application/domain-ports.js';

/**
 * Resolve the Mission authority supplied through the application port.
 */
async function resolveMissionStore(_rootDir: string, store?: MissionStore | null) {
  return store ?? null;
}

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
  itemDispositions?: ReviewItemDisposition[];
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
  itemDispositions?: ReviewItemDisposition[];
  blockedReason?: string;
  followUpReference?: string;
  timestamp?: string;
}

export interface CreateEventOptions {
  skipGit?: boolean;
  gitFn?: typeof git;
  log?: (_msg: string) => void;
  error?: (_msg: string) => void;
  worktree?: string;
  allowMissingRequiredFields?: boolean;
  missionStore?: MissionStore | null;
}

export interface CreateEventResult {
  ok: boolean;
  path: string | null;
  event?: NormalizedEvent;
  error?: string;
}

export interface ConsumeHumanNotesResult {
  ok: boolean;
  created: unknown[];
  skipped: unknown[];
  error?: string;
}

export interface ReadAllEventsOptions {
  rootDir?: string;
  error?: (_msg: string) => void;
  missionStore?: MissionStore | null;
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
  if (event.itemDispositions !== undefined && event.itemDispositions.length > 0) {
    lines.push(`item_dispositions: ${JSON.stringify(event.itemDispositions)}`);
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
  getCommentsFn?: (_branch: string, _token: string) => Promise<unknown[]>;
    createEventFn?: typeof createEvent;
    readReviewStateFn?: typeof readReviewState;
    readTokenFn?: (_user: string) => string | null;
  reviewIdentity?: string | null;
  forgejoUser?: string | null;
  worktree?: string;
  log?: (_msg: string) => void;
  error?: (_msg: string) => void;
  writeReviewStateFn?: typeof writeReviewState;
  /** Current review state object — dedup metadata is merged into this in place
      so the caller's subsequent persist includes the updated dedup list. */
  currentState?: { round?: number; phase?: string; metadata?: Record<string, unknown> } | null;
}

/**
 * Consume human notes from provider PR comments.
 */
async function consumeHumanNotes(slug: string, actor: string, options: ConsumeHumanNotesOptions = {}): Promise<ConsumeHumanNotesResult> {
  const {
    getCommentsFn,
    createEventFn = createEvent,
    readReviewStateFn = readReviewState,
    writeReviewStateFn = writeReviewState,
    readTokenFn,
    reviewIdentity = null,
    forgejoUser = null,
    worktree,
    log: logger = fmt.log.plain,
    error = fmt.log.plainError,
    currentState
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
  const rootDir = worktree || process.cwd();

  // Load current state for round/phase and dedup metadata.
  // If caller provides currentState, we merge dedup into it in-place so the
  // caller's subsequent persist includes the updated dedup list (avoids the
  // stale-state overwrite problem when the review loop re-persists its state).
  // When no state exists yet, create minimal state so dedup keys are recorded
  // and persisted (N1: durable from first invocation).
  let stateForRound = currentState ?? (await readReviewStateFn(slug, rootDir));
  if (!stateForRound) {
    stateForRound = { round: 1, phase: 'reviewing', metadata: {} };
  }
  const round = (stateForRound as { round?: number }).round ?? 1;
  const phase = (stateForRound as { phase?: string }).phase ?? 'reviewing';

  // Load previously processed dedup keys from metadata.
  const existingMetadata = (stateForRound as { metadata?: Record<string, unknown> })?.metadata as Record<string, unknown> | undefined;
  const existingProcessed = existingMetadata?.processedCommentBodies;
  const processedKeys = new Set<string>(Array.isArray(existingProcessed) ? existingProcessed : []);

  for (const comment of comments) {
    const commentUser = (comment as { user?: string }).user;
    const commentCreated = (comment as { created?: string }).created;
    const commentBody = (comment as { body?: string }).body || '';

    // Dedup key: author + sha256(body) — includes author to avoid collisions
    // when different users post identical text (N4), and hashes body to keep
    // metadata bounded (N3).
    const bodyHash = crypto.createHash('sha256').update(commentBody).digest('hex').slice(0, 16);
    const dedupKey = `${commentUser}\t${bodyHash}`;

    if (processedKeys.has(dedupKey)) {
      skipped.push({ user: commentUser, created: commentCreated, reason: 'already-processed' });
      continue;
    }

    if (hasWorkflowFooter(commentBody)) {
      skipped.push({ user: commentUser, created: commentCreated, reason: 'workflow-generated' });
      processedKeys.add(dedupKey);
      continue;
    }

    const classification = classifyComment(comment as { body?: string });
    if (!classification) {
      skipped.push({ user: commentUser, created: commentCreated, reason: 'already-classified' });
      processedKeys.add(dedupKey);
      continue;
    }

    const result = await createEventFn(slug, classification, {
      content: commentBody,
      round,
      phase,
      actor: actor || commentUser || 'human'
    }, {
      worktree: rootDir,
      skipGit: true,
      log: logger,
      error
    });

    if (result.ok) {
      created.push({ path: result.path, user: commentUser, created: commentCreated });
      processedKeys.add(dedupKey);
    } else {
      error(fmt.status('WARN', `Failed to create human_note event for comment by ${commentUser}: ${(result as { error?: string }).error}`));
    }
  }

  // Merge dedup keys into state metadata in-place.
  // No cap — each key is a compact "author\thex16" string (~22 bytes).
  // Even 500 comments ≈ 11 KB, well within reasonable metadata size.
  // SC4 requires all already-seen comments to be skipped on re-invocation.
  if (stateForRound && processedKeys.size > 0) {
    const targetMetadata = (stateForRound as { metadata?: Record<string, unknown> }).metadata || {};
    (targetMetadata as Record<string, unknown>).processedCommentBodies = [...processedKeys];
    (stateForRound as { metadata?: Record<string, unknown> }).metadata = targetMetadata;

    // When currentState was not provided by caller, persist standalone so dedup
    // survives to next invocation (N2: CLI --consume path).
    // When currentState WAS provided, caller owns the persist (N1: review loop).
    if (!currentState) {
      await writeReviewStateFn(slug, stateForRound as any, rootDir);
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
 *
 * Storage is the operator database (`mission_review_events`, part of the Review
 * aggregate) and nothing else: a mission whose Review is not in the database
 * fails here rather than acquiring a second, file-backed copy of its review
 * conversation. The Markdown file under `missions/<slug>/review-events/` is an
 * export of the stored event — written for humans and for the agents that read
 * the mission directory, never read back by production.
 */
async function createEvent(slug: string, eventType: string, params: CreateEventParams, options: CreateEventOptions = {}): Promise<CreateEventResult> {
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

  let state: ReviewState | null;
  if (params.round === undefined || params.phase === undefined) {
    state = await readReviewState(slug, rootDir, options.missionStore);
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
      itemDispositions: params.itemDispositions as ReviewItemDisposition[] | undefined,
      blockedReason: params.blockedReason as string | undefined,
      followUpReference: params.followUpReference as string | undefined
    }
  );

  const stored = await persistEventInStore(slug, event, rootDir, {
    log: logger,
    error,
    missionStore: options.missionStore,
  });
  if (!stored.ok) {
    // A caller that was never handed the Mission store has a wiring defect. Say
    // so: reporting it as a missing Review sends the operator to --backfill-review,
    // which cannot repair a Review that is already there.
    if (stored.reason === 'no-store') {
      error(fmt.status(
        'FAIL',
        `Cannot store review event for "${slug}": no Mission store was supplied to this call. ` +
        'The composition root must bind the review-event writer to the operator database.',
      ));
      return { ok: false, path: null, error: `No Mission store supplied for ${slug}` };
    }
    if (stored.reason === 'write-failed') {
      error(fmt.status('FAIL', `Cannot store review event for "${slug}": the operator database rejected the write.`));
      return { ok: false, path: null, error: `Review event write failed for ${slug}` };
    }
    error(fmt.status(
      'FAIL',
      `Cannot store review event for "${slug}": no Review in the operator database. ` +
      `px handoff starts a review; px review ${slug} --backfill-review migrates a pre-cutover mission.`,
    ));
    return { ok: false, path: null, error: `No Review in the operator database for ${slug}` };
  }

  const exportedPath = exportEventFile(slug, event, rootDir, {
    timestamp: (params.timestamp as string | undefined) ?? null,
    skipGit,
    gitFn,
    log: logger,
    error,
  });

  return { ok: true, path: exportedPath ?? stored.path, event };
}

/**
 * Render a stored review event as Markdown under `missions/<slug>/review-events/`.
 *
 * This is an export of state the operator database already holds, so a failure
 * here is reported and otherwise ignored: the event is stored either way, and
 * no production reader depends on the file. Returns the written path, or null
 * when the mission directory could not be resolved.
 */
function exportEventFile(
  slug: string,
  event: NormalizedEvent,
  rootDir: string,
  options: {
    timestamp: string | null;
    skipGit: boolean;
    gitFn: typeof git;
    log: (_msg: string) => void;
    error: (_msg: string) => void;
  }
): string | null {
  const { timestamp, skipGit, gitFn, log: logger, error } = options;
  const round = event.round ?? 1;
  const phase = event.phase ?? 'reviewing';

  const filePath = eventFilePath(slug, event.eventType, round, event.actor ?? 'unknown', timestamp, rootDir);
  if (!filePath) {
    error(fmt.status('WARN', `Stored review event for "${slug}", but its mission directory could not be resolved for export`));
    return null;
  }

  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(filePath, renderEventFile(event), 'utf8');
  logger(fmt.status('PASS', `Created review event: ${path.basename(filePath)}`));

  if (!skipGit) {
    const relPath = path.relative(rootDir, filePath);
    const result = gitFn(['-C', rootDir, 'add', relPath]);
    if (result.status !== 0) {
      error(fmt.status('WARN', `Failed to git add event file: ${result.stderr}`));
    } else {
      const commitMsg = `review-event(${slug}): ${event.eventType} round ${round} (${phase}) [${event.actor ?? 'unknown'}]`;
      const commitResult = gitFn(['-C', rootDir, 'commit', '-m', commitMsg, '--allow-empty']);
      if (commitResult.status !== 0) {
        error(fmt.status('WARN', `Failed to commit event file: ${commitResult.stderr}`));
      } else {
        logger(fmt.status('PASS', 'Committed review event to git'));
      }
    }
  }

  return filePath;
}

interface PersistEventResult {
  ok: boolean;
  path: string | null;
  /**
   * Why a failed persist failed. `no-store` means this call site was never
   * given the Mission authority — a wiring defect, not mission state — and must
   * not be reported as a missing Review.
   */
  reason?: 'no-store' | 'no-review' | 'write-failed';
}

/**
 * Persist a review event in the SQLite operator database.
 *
 * Appends the event to the Review aggregate's reviewEvents collection and
 * saves the mission. Returns { ok: true, path: 'sqlite:<mission_id>:<position>' }
 * on success, or { ok: false, path: null } when the store is unavailable.
 */
async function persistEventInStore(
  slug: string,
  event: NormalizedEvent,
  rootDir: string,
  opts: { log?: (_msg: string) => void; error?: (_msg: string) => void; missionStore?: MissionStore | null }
): Promise<PersistEventResult> {
  let store: Awaited<ReturnType<typeof resolveMissionStore>>;
  try {
    store = await resolveMissionStore(rootDir, opts.missionStore);
  } catch {
    return { ok: false, path: null, reason: 'no-store' };
  }
  if (!store) {
    return { ok: false, path: null, reason: 'no-store' };
  }

  try {
    let result = await store.load(missionId(slug));
    if (result.kind !== 'found' || !result.mission.review) {
      return { ok: false, path: null, reason: 'no-review' };
    }

    let mission = result.mission;
    let review = mission.review!; // narrowed above
    const eventRecord = {
      position: review.reviewEvents.length,
      eventType: event.eventType as ReviewEventType,
      roundNumber: event.round ?? null,
      phase: event.phase ?? null,
      actor: event.actor ?? null,
      content: event.content,
      disposition: event.disposition ?? null,
      verdict: event.verdict ?? null,
      itemDispositions: event.itemDispositions ?? null,
      blockedReason: event.blockedReason ?? null,
      followUpReference: event.followUpReference ?? null,
      createdAt: event.timestamp || new Date().toISOString(),
    };

    let updatedReview: Review = {
      ...review,
      reviewEvents: [...review.reviewEvents, eventRecord],
    };

    await store.save({ ...mission, review: updatedReview }, result.version);
    opts.log?.(fmt.status('PASS', `Persisted review event to SQLite: ${event.eventType} round ${event.round ?? 'n/a'}`));
    return { ok: true, path: `sqlite:${slug}:${eventRecord.position}` };
  } catch (error) {
    // Retry once on stale version: another write (e.g. review-state persist)
    // may have advanced the mission version between our load and save.
    const isStale = error instanceof Error && error.name === 'MissionStaleWriteError';
    if (!isStale) {
      return { ok: false, path: null, reason: 'write-failed' };
    }
    try {
      const result = await store.load(missionId(slug));
      if (result.kind !== 'found' || !result.mission.review) {
        return { ok: false, path: null, reason: 'no-review' };
      }
      const mission = result.mission;
      const review = mission.review!;
      const eventRecord = {
        position: review.reviewEvents.length,
        eventType: event.eventType as ReviewEventType,
        roundNumber: event.round ?? null,
        phase: event.phase ?? null,
        actor: event.actor ?? null,
        content: event.content,
        disposition: event.disposition ?? null,
        verdict: event.verdict ?? null,
        itemDispositions: event.itemDispositions ?? null,
        blockedReason: event.blockedReason ?? null,
        followUpReference: event.followUpReference ?? null,
        createdAt: event.timestamp || new Date().toISOString(),
      };
      const updatedReview: Review = {
        ...review,
        reviewEvents: [...review.reviewEvents, eventRecord],
      };
      await store.save({ ...mission, review: updatedReview }, result.version);
      opts.log?.(fmt.status('PASS', `Persisted review event to SQLite: ${event.eventType} round ${event.round ?? 'n/a'}`));
      return { ok: true, path: `sqlite:${slug}:${eventRecord.position}` };
    } catch {
      return { ok: false, path: null, reason: 'write-failed' };
    }
  }
}

// -------- Event Reading --------

/**
 * Read all review events for a mission from the operator database.
 *
 * The exported Markdown files are not a second source: a mission with no Review
 * in the database has no events, and reading the export back would resurrect the
 * dual authority the cutover removed. A pre-cutover mission is migrated once
 * with `px review <slug> --backfill-review`.
 */
async function readAllEvents(slug: string, options: ReadAllEventsOptions = {}): Promise<unknown[]> {
  const { rootDir = process.cwd(), missionStore } = options;
  return readAllEventsFromStore(slug, rootDir, missionStore);
}

/**
 * Read all review events from the SQLite operator database.
 */
async function readAllEventsFromStore(slug: string, rootDir: string, missionStore?: MissionStore | null): Promise<unknown[]> {
  let store: Awaited<ReturnType<typeof resolveMissionStore>>;
  try {
    store = await resolveMissionStore(rootDir, missionStore);
  } catch {
    return [];
  }
  if (!store) {
    return [];
  }

  try {
    const result = await store.load(missionId(slug));
    if (result.kind !== 'found' || !result.mission.review) {
      return [];
    }
    return result.mission.review.reviewEvents.map((event) => ({
      event_type: event.eventType,
      timestamp: event.createdAt,
      content: event.content,
      round: event.roundNumber,
      phase: event.phase,
      actor: event.actor,
      disposition: event.disposition,
      verdict: event.verdict,
      item_dispositions: event.itemDispositions,
      blocked_reason: event.blockedReason,
      followup_reference: event.followUpReference,
    }));
  } catch {
    return [];
  }
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
  eventFilePath
};

// Event creation
export {
  createEvent,
  normalizeEventContent
};

// Event reading
export {
  readAllEvents
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
