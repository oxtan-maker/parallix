/**
 * Workflow comment and review posting to the provider, with local
 * review-verdict recording.
 */

import * as fmt from '../../application/presentation/cli-format.js';
import { missionBranchName, resolveWorktree } from '../filesystem/mission-utils.js';
import { readReviewState, writeReviewState, ReviewState, resolveReviewIdentity, persistReviewStateOrThrow } from './review-state.js';
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
    postCommentFn?: typeof postComment;
    buildMetadataFooterFn?: (_s: string, _r?: string, _store?: MissionStore | null) => string | Promise<string>;
    readReviewStateFn?: ReviewStateReader;
    rootDir?: string;
    reviewIdentity?: string;
    forgejoUser?: string;
    missionStore?: MissionStore | null;
  } = {}
): Promise<{ ok: boolean; error?: string }> {
  const { log, error, readTokenFn, postCommentFn, buildMetadataFooterFn, readReviewStateFn } = postWorkflowCommentBindings(options);
  const rootDir = options.rootDir || resolveWorktree(slug) || process.cwd();
  const branch = missionBranchName(slug, rootDir);
  const identityResolved = options.reviewIdentity
    || options.forgejoUser
    || (await resolveReviewIdentity(slug, rootDir, { readReviewStateFn: readReviewStateFn })).commentIdentityUser
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
  if (!result.ok) {
    error(fmt.status('FAIL', `Could not post comment: ${providerError(result) || 'API error'}`));
    return { ok: false, error: providerError(result) || 'API error' };
  }

  log(fmt.status('PASS', `Comment posted on PR for ${branch}.`));
  return { ok: true };
}

/** @param {*} result */
function describeProviderFailure(result: unknown): string {
  if (!result || typeof result !== 'object') { return 'API error'; }
  const r = result as Record<string, unknown>;
  const httpStatus = providerHttpStatus(r);
  const body = providerFailureBody(r);
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
): Promise<boolean> {
  const { missionStore, worktree, writeReviewStateFn, createEventFn, readReviewStateFn, log, error } = recordLocalReviewVerdictBindings(options, slug);
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
  const selfReviewAllowed = Boolean(existing.reviewer && existing.reviewer === existing.implementer);
  const state = existing instanceof ReviewState
    ? existing
    : new ReviewState(slug, existing);
  state.metadata = { ...state.metadata, approvalOwed: outcome === 'approve' };
  if (selfReviewAllowed) {
    state.disposition = outcome === 'approve' ? 'APPROVED' : outcome === 'request-changes' ? 'REQUEST_CHANGES' : 'COMMENT';
    if (outcome === 'approve') { state.transitionTo('approved'); }
  }
  await persistReviewStateOrThrow(writeReviewStateFn, slug, state, worktree, missionStore);
  const outcomeResult = await createEventFn(slug, VALID_EVENT_TYPES.REVIEWER_OUTCOME, {
    verdict: selfReviewAllowed ? outcome : 'comment',
    content: selfReviewAllowed ? `Single-family self-author verdict: ${outcome}` : `Advisory self-author verdict: ${outcome}`,
    ...(outcome === 'approve' ? { blockedReason: 'external-formal-approval-owed' } : {}),
  }, { worktree, log: log, error, missionStore });
  if (!outcomeResult.ok) {
    throw new Error(`Cannot store review event for "${slug}": the operator database rejected the write.`);
  }
  return selfReviewAllowed;
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
    postReviewFn?: typeof postReview;
    buildMetadataFooterFn?: (_s: string, _r?: string, _store?: MissionStore | null) => string | Promise<string>;
    readReviewStateFn?: ReviewStateReader;
    worktree?: string;
    revision?: string;
    reviewIdentity?: string;
    forgejoUser?: string;
    getPrAuthorFn?: typeof getPrAuthor;
    writeReviewStateFn?: typeof writeReviewState;
    createEventFn?: CreateEventFn;
    missionStore?: MissionStore | null;
    lifecycleService?: Pick<MissionLifecycleService, 'transition'> | null;
    recordApprovalFn?: typeof recordApproval;
  } = {}
): Promise<{ ok: boolean; error?: string; skipped?: boolean; reason?: string; prAuthor?: unknown }> {
  const { log, error, readTokenFn, postReviewFn, buildMetadataFooterFn, readReviewStateFn } = postWorkflowReviewBindings(options);
  const worktree = options.worktree || resolveWorktree(slug) || process.cwd();
  const branch = missionBranchName(slug, worktree);
  const identityResolved = options.reviewIdentity
    || options.forgejoUser
    || (await resolveReviewIdentity(slug, worktree, { readReviewStateFn: readReviewStateFn })).identityUser
    || 'human';
  const reviewIdentity = identityResolved;
  const missionStore = options.missionStore ?? null;
  const token = readTokenFn(reviewIdentity, { rootDir: worktree });
  if (!token) {
    error(fmt.status('FAIL', `No Forgejo token found for user "${reviewIdentity}". Cannot submit review.`));
    return { ok: false };
  }

  const getPrAuthorFn = options.getPrAuthorFn || getPrAuthor;
  let prAuthor: ReturnType<typeof getPrAuthor> = null;
  try {
    prAuthor = getPrAuthorFn(branch, token, { forgejoUser: reviewIdentity, reviewIdentity, rootDir: worktree });
  } catch {
    prAuthor = null;
  }
  if (prAuthor && prAuthor === reviewIdentity) {
    const diagnostic = `Reviewer "${reviewIdentity}" is the PR author for ${branch}; independent review is required. Self-author verdict "${outcome}" is advisory and cannot approve the Mission or advance integration.`;
    log(fmt.status('WARN', `Provider self-approval POST skipped; single-family review may be recorded locally. A different agent or a human can supply formal approval.`));
    const allowed = await recordLocalReviewVerdict(slug, outcome, {
      worktree,
      writeReviewStateFn: options.writeReviewStateFn,
      createEventFn: options.createEventFn,
      readReviewStateFn: readReviewStateFn,
      log: log,
      error,
      missionStore,
    });
    return { ok: allowed, skipped: true, reason: 'self-author', prAuthor, ...(allowed ? {} : { error: diagnostic }) };
  }

  const taggedMessage = message + await Promise.resolve(buildMetadataFooterFn(slug, worktree, missionStore));
  log(fmt.status('INFO', `Submitting review outcome "${outcome}" on ${branch} as ${reviewIdentity}...`));
  const result = postReviewFn(branch, token, outcome, taggedMessage, { forgejoUser: reviewIdentity, reviewIdentity });
  if (!result.ok) {
    const failureDetail = describeProviderFailure(result);
    error(fmt.status('FAIL', `Could not submit review: ${failureDetail}`));
    return { ok: false, error: failureDetail };
  }

  log(fmt.status('PASS', `Review outcome "${outcome}" posted on PR for ${branch}.`));
  return { ok: true };
}


function providerError(result: ReturnType<typeof postComment>): string | null | undefined { return 'error' in result ? result.error : undefined; }

function postWorkflowCommentBindings(options: NonNullable<Parameters<typeof postWorkflowComment>[2]>) {
  const log = options.log || fmt.log.plain;
  const error = options.error || fmt.log.plainError;
  const readTokenFn = options.readTokenFn || readToken;
  const postCommentFn = options.postCommentFn || postComment;
  const buildMetadataFooterFn = options.buildMetadataFooterFn || buildMetadataFooter;
  const readReviewStateFn = options.readReviewStateFn || readReviewState;
  return { log, error, readTokenFn, postCommentFn, buildMetadataFooterFn, readReviewStateFn };
}

function recordLocalReviewVerdictBindings(options: NonNullable<Parameters<typeof recordLocalReviewVerdict>[2]>, slug: string) {
  const missionStore = options.missionStore ?? null;
  const worktree = options.worktree || resolveWorktree(slug) || process.cwd();
  const writeReviewStateFn = options.writeReviewStateFn || writeReviewState;
  const createEventFn = options.createEventFn || createEvent;
  const readReviewStateFn = options.readReviewStateFn || readReviewState;
  const log = options.log || fmt.log.plain;
  const error = options.error || fmt.log.plainError;

  return { missionStore, worktree, writeReviewStateFn, createEventFn, readReviewStateFn, log, error };
}

function postWorkflowReviewBindings(options: NonNullable<Parameters<typeof postWorkflowReview>[3]>) {
  const log = options.log || fmt.log.plain;
  const error = options.error || fmt.log.plainError;
  const readTokenFn = options.readTokenFn || readToken;
  const postReviewFn = options.postReviewFn || postReview;
  const buildMetadataFooterFn = options.buildMetadataFooterFn || buildMetadataFooter;
  const readReviewStateFn = options.readReviewStateFn || readReviewState;
  return { log, error, readTokenFn, postReviewFn, buildMetadataFooterFn, readReviewStateFn };
}

function providerHttpStatus(r: Record<string, unknown>) {
  const httpStatus = (r.statusCode !== null && Number(r.statusCode) > 0)
    ? r.statusCode
    : (r.status !== null && Number(r.status) >= 100 ? r.status : null);
  return httpStatus;
}

function providerFailureBody(r: Record<string, unknown>): string | null {
  let body: string | null = null;
  if (r.data && typeof r.data === 'object') {
    body = (r.data as { message?: string }).message || JSON.stringify(r.data);
  } else if (typeof r.data === 'string' && r.data) {
    body = r.data as string;
  }
  return body;
}
