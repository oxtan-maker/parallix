/**
 * Review event persistence for autonomous review rounds.
 *
 * Review events live in the operator database (mission_review_events, part of
 * the Review aggregate) and only there. TASK-2521.03 removed the Markdown
 * export under missions/<slug>/review-events/: a mission's review conversation
 * is read back through `px status`, not from its directory.
 *
 * Owned by the Node workflow harness (architecture migration).
 */

import { git } from '../git/git.js';
import { missionBranchName, resolveWorktree } from '../filesystem/mission-utils.js';
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
    .replace(/(?:^-)|(?:-$)/g, '');
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
    lines.push(`blocked_reason: "${event.blockedReason.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
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

  await consumeComments(comments, { slug, actor, round, phase, rootDir, createEventFn, logger, error, processedKeys, created, skipped });

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

async function consumeComments(comments: unknown[], context: any): Promise<void> {
  for (const comment of comments) {
    const user = (comment as { user?: string }).user;
    const created = (comment as { created?: string }).created;
    const body = (comment as { body?: string }).body || '';
    const key = `${user}\t${crypto.createHash('sha256').update(body).digest('hex').slice(0, 16)}`;
    if (context.processedKeys.has(key)) { context.skipped.push({ user, created, reason: 'already-processed' }); continue; }
    if (hasWorkflowFooter(body)) { context.skipped.push({ user, created, reason: 'workflow-generated' }); context.processedKeys.add(key); continue; }
    const classification = classifyComment(comment as { body?: string });
    if (!classification) { context.skipped.push({ user, created, reason: 'already-classified' }); context.processedKeys.add(key); continue; }
    const result = await context.createEventFn(context.slug, classification, { content: body, round: context.round, phase: context.phase, actor: context.actor || user || 'human' }, { worktree: context.rootDir, skipGit: true, log: context.logger, error: context.error });
    if (result.ok) { context.created.push({ path: result.path, user, created }); context.processedKeys.add(key); }
    else { context.error(fmt.status('WARN', `Failed to create human_note event for comment by ${user}: ${result.error}`)); }
  }
}

// -------- Event Creation --------

/** @typedef {{content: string, round?: number, phase?: string, actor?: string, disposition?: string, verdict?: string, fixedItems?: unknown[], pushedBackItems?: unknown[], parkedItems?: unknown[], blockedReason?: string, followUpReference?: string, timestamp?: string}} CreateEventParams */

function invalidEventParams(eventType: string, params: CreateEventParams, allowMissingRequiredFields: boolean, error: (_message: string) => void): CreateEventResult | null {
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
  if (!allowMissingRequiredFields && eventType === VALID_EVENT_TYPES.REVIEWER_OUTCOME && !params.verdict) {
    error(fmt.status('FAIL', 'reviewer_outcome event requires --verdict'));
    return { ok: false, path: null, error: 'reviewer_outcome event requires verdict' };
  }
  if (!allowMissingRequiredFields && eventType === VALID_EVENT_TYPES.IMPLEMENTER_DISPOSITION && !params.disposition) {
    error(fmt.status('FAIL', 'implementer_disposition event requires --disposition'));
    return { ok: false, path: null, error: 'implementer_disposition event requires disposition' };
  }
  return null;
}

function storedEventFailure(slug: string, reason: string, error: (_message: string) => void): CreateEventResult {
  if (reason === 'no-store') {
    error(fmt.status('FAIL', `Cannot store review event for "${slug}": no Mission store was supplied to this call. The composition root must bind the review-event writer to the operator database.`));
    return { ok: false, path: null, error: `No Mission store supplied for ${slug}` };
  }
  if (reason === 'write-failed') {
    error(fmt.status('FAIL', `Cannot store review event for "${slug}": the operator database rejected the write.`));
    return { ok: false, path: null, error: `Review event write failed for ${slug}` };
  }
  error(fmt.status('FAIL', `Cannot store review event for "${slug}": no Review in the operator database. px review ${slug} --start starts a review; px review ${slug} --backfill-review migrates a pre-cutover mission.`));
  return { ok: false, path: null, error: `No Review in the operator database for ${slug}` };
}

/**
 * Create and persist a classified review event.
 *
 * Storage is the operator database (`mission_review_events`, part of the Review
 * aggregate) and nothing else: a mission whose Review is not in the database
 * fails here rather than acquiring a second, file-backed copy of its review
 * conversation. Nothing is written to the repository; agents read the stored
 * events back through `px status`.
 */
async function createEvent(slug: string, eventType: string, params: CreateEventParams, options: CreateEventOptions = {}): Promise<CreateEventResult> {
  const {
    log: logger = fmt.log.plain,
    error = fmt.log.plainError,
    worktree,
    allowMissingRequiredFields = false
  } = options;

  const rootDir = worktree || resolveWorktree(slug) || process.cwd();

  const invalid = invalidEventParams(eventType, params, allowMissingRequiredFields, error);
  if (invalid) { return invalid; }

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

  // The workflow footer used to be applied when rendering the exported file.
  // With the export gone the stored row is the only copy, so the footer that
  // downstream provider comments match on is applied to the stored content.
  if (event.round !== undefined && event.phase !== undefined && !hasWorkflowFooter(event.content || '')) {
    event.content = `${event.content || ''}${buildEventFooter(slug, event.round, event.phase)}`;
  }

  const stored = await persistEventInStore(slug, event, rootDir, {
    log: logger,
    error,
    missionStore: options.missionStore,
  });
  if (!stored.ok) {
    return storedEventFailure(slug, stored.reason ?? '', error);
  }

  // ADR 0053 (Generated repository metadata): normal lifecycle execution must
  // not create Git-tracked workflow metadata. The stored row is the event;
  // `readExportedReviewEvents` remains for one-shot import of legacy missions
  // whose conversation exists only as files.
  logger(fmt.status('PASS', `Recorded review event: ${event.eventType} round ${event.round ?? 1} [${event.actor ?? 'unknown'}]`));
  return { ok: true, path: stored.path, event };
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
