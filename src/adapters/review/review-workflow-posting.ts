/**
 * Workflow comment and review posting to the provider, with local
 * review-verdict recording.
 */

import * as fmt from '../../application/presentation/cli-format.js';
import { missionBranchName, resolveWorktree } from '../filesystem/mission-utils.js';
import { readReviewState, writeReviewState, ReviewState, resolveReviewIdentity, persistReviewStateOrThrow, type ReviewStateData } from './review-state.js';
import type { MissionStore } from '../../application/domain-ports.js';
import { readToken, postComment, postReview, getPrAuthor } from './review-adapter.js';
import { createEvent, VALID_EVENT_TYPES } from './review-events.js';
import { recordApproval } from './review-round.js';
import type { MissionLifecycleService } from '../../application/mission-lifecycle-service.js';
import { buildMetadataFooter, type CreateEventFn, type ReviewStateReader } from './review-artifact-files.js';

// ============================================================================
// Workflow Comment/Review Posting
// ============================================================================

export async function postWorkflowComment(
  slug: string,
  message: string,
  options: {
    log?: (_msg: string) => void;
    error?: (_msg: string) => void;
    readTokenFn?: (_user: string, _opts: { rootDir?: string }) => string | null;
    postCommentFn?: (_branch: string, _token: string, _body: string, _opts?: Record<string, unknown>) => unknown;
    buildMetadataFooterFn?: (_s: string, _r?: string, _store?: MissionStore | null) => string | Promise<string>;
    readReviewStateFn?: ReviewStateReader;
    rootDir?: string;
    reviewIdentity?: string;
    forgejoUser?: string;
    missionStore?: MissionStore | null;
  } = {}
): Promise<{ ok: boolean; error?: string }> {
  const log = options.log || fmt.log.plain;
  const error = options.error || fmt.log.plainError;
  const readTokenFn = options.readTokenFn || readToken;
  const postCommentFn = options.postCommentFn || postComment;
  const buildMetadataFooterFn = options.buildMetadataFooterFn || buildMetadataFooter;
  const readReviewStateFn = options.readReviewStateFn || readReviewState;
  const rootDir = options.rootDir || resolveWorktree(slug) || process.cwd();
  const branch = missionBranchName(slug, rootDir);
  const identityResolved = options.reviewIdentity
    || options.forgejoUser
    || (await resolveReviewIdentity(slug, rootDir, { readReviewStateFn: readReviewStateFn as typeof readReviewState })).commentIdentityUser
    || 'human';
  const reviewIdentity = identityResolved;
  const token = readTokenFn(reviewIdentity, { rootDir });
  if (!token) {
    error(fmt.status('FAIL', `No Forgejo token found for user "${reviewIdentity}". Cannot post comment.`));
    return { ok: false };
  }

  const taggedMessage = message + await Promise.resolve(buildMetadataFooterFn(slug, rootDir, options.missionStore ?? null));
  log(fmt.status('INFO', `Posting PR comment on ${branch} as ${reviewIdentity}...`));
  const result = postCommentFn(branch, token, taggedMessage, { forgejoUser: reviewIdentity, reviewIdentity });
  const r = result as Record<string, unknown>;
  if (!r.ok) {
    error(fmt.status('FAIL', `Could not post comment: ${(r.error as string) || 'API error'}`));
    return { ok: false, error: (r.error as string) || 'API error' };
  }

  log(fmt.status('PASS', `Comment posted on PR for ${branch}.`));
  return { ok: true };
}

/** @param {*} result */
function describeProviderFailure(result: unknown): string {
  if (!result || typeof result !== 'object') { return 'API error'; }
  const r = result as Record<string, unknown>;
  const httpStatus = (r.statusCode !== null && Number(r.statusCode) > 0)
    ? r.statusCode
    : (r.status !== null && Number(r.status) >= 100 ? r.status : null);
  let body: string | null = null;
  if (r.data && typeof r.data === 'object') {
    body = (r.data as { message?: string }).message || JSON.stringify(r.data);
  } else if (typeof r.data === 'string' && r.data) {
    body = r.data as string;
  }
  const parts: string[] = [];
  if (httpStatus !== null) { parts.push(String(httpStatus)); }
  if (body) { parts.push(body); }
  if (parts.length) { return parts.join(' '); }
  return (r.error as string) || (r.raw as string) || 'API error';
}

/**
 * Record a review verdict on the mission's Review.
 */
async function recordLocalReviewVerdict(
  slug: string,
  outcome: string,
  options: {
    worktree?: string;
    writeReviewStateFn?: typeof writeReviewState;
    createEventFn?: CreateEventFn;
    readReviewStateFn?: ReviewStateReader;
    log?: (_msg: string) => void;
    error?: (_msg: string) => void;
    missionStore?: MissionStore | null;
  } = {}
): Promise<void> {
  const missionStore = options.missionStore ?? null;
  const worktree = options.worktree || resolveWorktree(slug) || process.cwd();
  const writeReviewStateFn = options.writeReviewStateFn || writeReviewState;
  const createEventFn = options.createEventFn || createEvent;
  const readReviewStateFn = options.readReviewStateFn || readReviewState;
  const log = options.log || fmt.log.plain;
  const error = options.error || fmt.log.plainError;

  const existing = await Promise.resolve(readReviewStateFn(slug, worktree, missionStore));
  // TASK-2385: a read miss must not fabricate a round-1 verdict. The old
  // `round: 1` fallback silently downgraded the round and fed the stale-round
  // producer observed on task-2377.05. A verdict can only attach to a review
  // `px handoff` started, so fail closed rather than invent one.
  if (!existing) {
    throw new Error(
      `Cannot record review verdict for ${slug}: no review state found. A review must be started with \`px review ${slug} --start\` before recording a verdict; refusing to fabricate round 1`,
    );
  }
  const state = existing instanceof ReviewState
    ? existing
    : new ReviewState(slug, existing as ReviewStateData);
  if (outcome === 'approve') {
    state.disposition = 'APPROVED';
    state.metadata = { ...state.metadata, approvalOwed: true };
    try { state.transitionTo('approved'); } catch { /* ignore */ }
  } else if (outcome === 'request-changes') {
    state.disposition = 'REQUEST_CHANGES';
    try { state.transitionTo('fixing'); } catch { /* ignore */ }
  }
  await persistReviewStateOrThrow(writeReviewStateFn, slug, state, worktree, missionStore);
  const outcomeResult = await createEventFn(slug, VALID_EVENT_TYPES.REVIEWER_OUTCOME, {
    verdict: outcome,
    content: `Review verdict: ${outcome}`,
    ...(outcome === 'approve' ? { blockedReason: 'external-formal-approval-owed' } : {}),
  }, { worktree, log: log, error, missionStore });
  if (!outcomeResult.ok) {
    throw new Error(`Cannot store review event for "${slug}": the operator database rejected the write.`);
  }
}

/**
 * Submit a review outcome to the provider.
 */
export async function postWorkflowReview(
  slug: string,
  outcome: string,
  message: string,
  options: {
    log?: (_msg: string) => void;
    error?: (_msg: string) => void;
    readTokenFn?: (_user: string, _opts: { rootDir?: string }) => string | null;
    postReviewFn?: (_branch: string, _token: string, _outcome: string, _body: string, _opts?: Record<string, unknown>) => unknown;
    buildMetadataFooterFn?: (_s: string, _r?: string, _store?: MissionStore | null) => string | Promise<string>;
    readReviewStateFn?: ReviewStateReader;
    worktree?: string;
    reviewIdentity?: string;
    forgejoUser?: string;
    getPrAuthorFn?: (_branch: string, _token: string, _opts?: Record<string, unknown>) => unknown;
    writeReviewStateFn?: typeof writeReviewState;
    createEventFn?: CreateEventFn;
    missionStore?: MissionStore | null;
    lifecycleService?: MissionLifecycleService | null;
    recordApprovalFn?: typeof recordApproval;
  } = {}
): Promise<{ ok: boolean; error?: string; skipped?: boolean; reason?: string; prAuthor?: unknown }> {
  const log = options.log || fmt.log.plain;
  const error = options.error || fmt.log.plainError;
  const readTokenFn = options.readTokenFn || readToken;
  const postReviewFn = options.postReviewFn || postReview;
  const buildMetadataFooterFn = options.buildMetadataFooterFn || buildMetadataFooter;
  const readReviewStateFn = options.readReviewStateFn || readReviewState;
  const worktree = options.worktree || resolveWorktree(slug) || process.cwd();
  const branch = missionBranchName(slug, worktree);
  const identityResolved = options.reviewIdentity
    || options.forgejoUser
    || (await resolveReviewIdentity(slug, worktree, { readReviewStateFn: readReviewStateFn as typeof readReviewState })).identityUser
    || 'human';
  const reviewIdentity = identityResolved;
  const missionStore = options.missionStore ?? null;
  const token = readTokenFn(reviewIdentity, { rootDir: worktree });
  if (!token) {
    error(fmt.status('FAIL', `No Forgejo token found for user "${reviewIdentity}". Cannot submit review.`));
    return { ok: false };
  }

  const getPrAuthorFn = options.getPrAuthorFn || getPrAuthor;
  let prAuthor: unknown = null;
  try {
    prAuthor = getPrAuthorFn(branch, token, { forgejoUser: reviewIdentity, reviewIdentity, rootDir: worktree });
  } catch {
    prAuthor = null;
  }
  if (prAuthor && prAuthor === reviewIdentity) {
    log(fmt.status('WARN', `Reviewer "${reviewIdentity}" is the PR author for ${branch}; skipping the provider review POST to avoid a self-approval (Forgejo rejects "approve your own pull is not allowed" with HTTP 422). Attempting to record the "${outcome}" verdict locally in the SQLite Review aggregate; a different agent or a human must post the formal approval.`));
    // An approve is a domain decision, not only a provider comment: it is what
    // leaves review through the approval boundary `px integrate` gates on. Record
    // it on the aggregate before the flat loop-state write so a round that cannot
    // legally reach `approved` (for example still in `fixing` after a
    // request-changes) fails loudly here instead of reporting a skipped POST and
    // leaving the mission unintegratable. A read miss below still surfaces as a
    // rejection rather than a swallowed failure.
    if (outcome === 'approve' && missionStore) {
      const recordApprovalFn = options.recordApprovalFn || recordApproval;
      const decision = await recordApprovalFn(slug, {
        comment: null,
        decidedAt: new Date().toISOString(),
        source: { kind: 'local' },
      }, { missionStore, lifecycleService: options.lifecycleService ?? null });
      if (decision.outcome === 'failed') {
        return { ok: false, error: `Could not record the approve decision for ${slug}: ${decision.diagnostic}` };
      }
      if (decision.outcome === 'unchanged') {
        log(`Review outcome "approve" for ${slug} already recorded (${decision.reason}).`);
      }
    }
    await recordLocalReviewVerdict(slug, outcome, {
      worktree,
      writeReviewStateFn: options.writeReviewStateFn,
      createEventFn: options.createEventFn,
      readReviewStateFn: readReviewStateFn as typeof readReviewState,
      log: log,
      error,
      missionStore,
    });
    return { ok: true, skipped: true, reason: 'self-author', prAuthor };
  }

  const taggedMessage = message + await Promise.resolve(buildMetadataFooterFn(slug, worktree, missionStore));
  log(fmt.status('INFO', `Submitting review outcome "${outcome}" on ${branch} as ${reviewIdentity}...`));
  const result = postReviewFn(branch, token, outcome, taggedMessage, { forgejoUser: reviewIdentity, reviewIdentity });
  const r = result as Record<string, unknown>;
  if (!r.ok) {
    const failureDetail = describeProviderFailure(result);
    error(fmt.status('FAIL', `Could not submit review: ${failureDetail}`));
    return { ok: false, error: failureDetail };
  }

  log(fmt.status('PASS', `Review outcome "${outcome}" posted on PR for ${branch}.`));
  return { ok: true };
}

