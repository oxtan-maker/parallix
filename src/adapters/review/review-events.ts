import { VALID_EVENT_TYPES, ALL_EVENT_TYPES, MIRRORED_EVENT_TYPES, VALID_DISPOSITIONS, VALID_VERDICTS, isValidEventType, isValidDisposition, isValidVerdict, shouldMirrorToProvider, hasWorkflowFooter, classifyComment } from './review-event-taxonomy.js';
import { consumeProviderHumanNotes, type ConsumeHumanNotesOptions, type ConsumeHumanNotesResult } from './review-human-notes.js';
export type { ConsumeHumanNotesOptions, ConsumeHumanNotesResult } from './review-human-notes.js';
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
import { resolveWorktree } from '../filesystem/mission-utils.js';
import { missionId } from '../../domain/mission.js';
import type { Review, ReviewEventType, ReviewItemDisposition } from '../../domain/review.js';
import { readReviewState, ReviewState } from './review-state.js';
import * as fmt from '../../application/presentation/cli-format.js';
import type { MissionStore } from '../../application/domain-ports.js';

/**
 * Resolve the Mission authority supplied through the application port.
 */
async function resolveMissionStore(_rootDir: string, store?: MissionStore | null) {
  return store ?? null;
}

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
  if (!str) { return 'unknown'; }
  return String(str)
    .toLowerCase()
    .replace(/[@.]/g, '')
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/(?:^-)|(?:-$)/g, '');
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

export type ReviewEventCreator = (slug: string, eventType: string, params: CreateEventParams, options: CreateEventOptions) => CreateEventResult | Promise<CreateEventResult>;

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
async function eventRoundContext(slug: string, rootDir: string, params: CreateEventParams, options: CreateEventOptions) {
  let state: ReviewState | null;
  if (params.round === undefined || params.phase === undefined) {
    state = await readReviewState(slug, rootDir, options.missionStore);
  } else {
    state = null;
  }

  const round = (params.round !== undefined ? params.round : (state ? state.round : 1)) as number;
  const phase = (params.phase !== undefined ? params.phase : (state ? state.phase : 'reviewing')) as string;
  const actor = (params.actor as string) || 'unknown';

  return { round, phase, actor };
}

function appendWorkflowFooter(slug: string, event: NormalizedEvent): void {
  if (event.round !== undefined && event.phase !== undefined && !hasWorkflowFooter(event.content || '')) {
    event.content = `${event.content || ''}${buildEventFooter(slug, event.round, event.phase)}`;
  }

}

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

  const { round, phase, actor } = await eventRoundContext(slug, rootDir, params, options);

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
  appendWorkflowFooter(slug, event);

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
    return await appendReviewEvent(store, slug, event, opts);
  } catch (error) {
    // Retry exactly once when another Mission write advanced the version.
    if (!(error instanceof Error && error.name === 'MissionStaleWriteError')) {
      return { ok: false, path: null, reason: 'write-failed' };
    }
    try { return await appendReviewEvent(store, slug, event, opts); }
    catch { return { ok: false, path: null, reason: 'write-failed' }; }
  }
}

async function appendReviewEvent(store: MissionStore, slug: string, event: NormalizedEvent, opts: { log?: (message: string) => void }): Promise<PersistEventResult> {
  const result = await store.load(missionId(slug));
  if (result.kind !== 'found' || !result.mission.review) {
    return { ok: false, path: null, reason: 'no-review' };
  }

  const mission = result.mission;
  const review = mission.review!; // narrowed above
  const eventRecord = storedReviewEvent(event, review.reviewEvents.length);

  const updatedReview: Review = {
    ...review,
    reviewEvents: [...review.reviewEvents, eventRecord],
  };

  await store.save({ ...mission, review: updatedReview }, result.version);
  opts.log?.(fmt.status('PASS', `Persisted review event to SQLite: ${event.eventType} round ${event.round ?? 'n/a'}`));
  return { ok: true, path: `sqlite:${slug}:${eventRecord.position}` };
}

function storedReviewEvent(event: NormalizedEvent, position: number) {
  return {
    position,
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
async function readAllEvents(slug: string, options: ReadAllEventsOptions = {}) {
  const { rootDir = process.cwd(), missionStore } = options;
  return readAllEventsFromStore(slug, rootDir, missionStore);
}

/**
 * Read all review events from the SQLite operator database.
 */
async function readAllEventsFromStore(slug: string, rootDir: string, missionStore?: MissionStore | null) {
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

async function consumeHumanNotes(slug: string, actor: string, options: ConsumeHumanNotesOptions = {}): Promise<ConsumeHumanNotesResult> {
  return consumeProviderHumanNotes(slug, actor, { ...options, createEventFn: options.createEventFn ?? createEvent });
}
