import type { ReviewStateReader } from './review-artifact-files.js';
import type { ReviewEventCreator } from './review-events.js';
import { readReviewState, writeReviewState, type ReviewStateData } from './review-state.js';
import { hasWorkflowFooter, classifyComment } from './review-event-taxonomy.js';
import { missionBranchName } from '../filesystem/mission-utils.js';
import * as crypto from 'node:crypto';
import * as fmt from '../../application/presentation/cli-format.js';

interface CreatedHumanNote {
  path: string | null;
  user: string | undefined;
  created: string | undefined;
}

export interface ConsumeHumanNotesResult {
  ok: boolean;
  created: CreatedHumanNote[];
  skipped: unknown[];
  error?: string;
}

export interface ConsumeHumanNotesOptions {
  getCommentsFn?: (_branch: string, _token: string) => Promise<unknown[]>;
  createEventFn?: ReviewEventCreator;
  readReviewStateFn?: ReviewStateReader;
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
async function humanNoteContext(slug: string, rootDir: string, currentState: ReviewStateData | null | undefined, readReviewStateFn: ReviewStateReader) {
  let stateForRound = currentState ?? (await readReviewStateFn(slug, rootDir));
  if (!stateForRound) {
    stateForRound = { round: 1, phase: 'reviewing', metadata: {} };
  }
  const round = stateForRound.round ?? 1;
  const phase = stateForRound.phase ?? 'reviewing';

  // Load previously processed dedup keys from metadata.
  const existingMetadata = stateForRound.metadata;
  const existingProcessed = existingMetadata?.processedCommentBodies;
  const processedKeys = new Set<unknown>(Array.isArray(existingProcessed) ? existingProcessed : []);

  return { stateForRound, round, phase, processedKeys };
}

async function persistHumanNoteKeys(slug: string, stateForRound: ReviewStateData, processedKeys: Set<unknown>, currentState: ReviewStateData | null | undefined, rootDir: string, writeReviewStateFn: typeof writeReviewState): Promise<void> {
  if (stateForRound && processedKeys.size > 0) {
    const targetMetadata = stateForRound.metadata || {};
    targetMetadata.processedCommentBodies = [...processedKeys];
    stateForRound.metadata = targetMetadata;

    // When currentState was not provided by caller, persist standalone so dedup
    // survives to next invocation (N2: CLI --consume path).
    // When currentState WAS provided, caller owns the persist (N1: review loop).
    if (!currentState) {
      await writeReviewStateFn(slug, stateForRound, rootDir);
    }
  }

}

export async function consumeProviderHumanNotes(slug: string, actor: string, options: ConsumeHumanNotesOptions & { createEventFn: ReviewEventCreator }): Promise<ConsumeHumanNotesResult> {
  const { getCommentsFn, createEventFn, readReviewStateFn, writeReviewStateFn, readTokenFn, reviewIdentity, forgejoUser, worktree, logger, error, currentState } = humanNoteDependencies(options);

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

  const created: CreatedHumanNote[] = [];
  const skipped: unknown[] = [];
  const rootDir = worktree || process.cwd();

  // Load current state for round/phase and dedup metadata.
  // If caller provides currentState, we merge dedup into it in-place so the
  // caller's subsequent persist includes the updated dedup list (avoids the
  // stale-state overwrite problem when the review loop re-persists its state).
  // When no state exists yet, create minimal state so dedup keys are recorded
  // and persisted (N1: durable from first invocation).
  const { stateForRound, round, phase, processedKeys } = await humanNoteContext(slug, rootDir, currentState, readReviewStateFn);

  await consumeComments(comments, { slug, actor, round, phase, rootDir, createEventFn, logger, error, processedKeys, created, skipped });

  // Merge dedup keys into state metadata in-place.
  // No cap — each key is a compact "author\thex16" string (~22 bytes).
  // Even 500 comments ≈ 11 KB, well within reasonable metadata size.
  // SC4 requires all already-seen comments to be skipped on re-invocation.
  await persistHumanNoteKeys(slug, stateForRound, processedKeys, currentState, rootDir, writeReviewStateFn);

  logger(fmt.status('INFO', `consumeHumanNotes: created ${created.length} human_note events, skipped ${skipped.length} workflow comments`));
  return { ok: true, created, skipped };
}

async function consumeComments(comments: unknown[], context: {
  slug: string; actor: string; round: number; phase: string; rootDir: string;
  createEventFn: ReviewEventCreator; logger: (message: string) => void; error: (message: string) => void;
  processedKeys: Set<unknown>; created: CreatedHumanNote[]; skipped: unknown[];
}): Promise<void> {
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
function humanNoteDependencies(options: ConsumeHumanNotesOptions & { createEventFn: ReviewEventCreator }) {
  const {
    getCommentsFn,
    createEventFn,
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
  return { getCommentsFn, createEventFn, readReviewStateFn, writeReviewStateFn, readTokenFn, reviewIdentity, forgejoUser, worktree, logger, error, currentState };
}
