/**
 * Workflow comment and review publication. Mission decisions remain with
 * the review round owner; provider authorship selects the transport only.
 */

import * as fmt from '../../application/presentation/cli-format.js';
import { missionBranchName } from '../filesystem/mission-utils.js';
import { readReviewState, writeReviewState, resolveReviewIdentity } from './review-state.js';
import type { MissionStore } from '../../application/domain-ports.js';
import { readToken, postComment, postReview, getPrAuthor, getComments } from './review-adapter.js';
import { recordApproval } from './review-round.js';
import type { MissionLifecycleService } from '../../application/mission-lifecycle-service.js';
import { buildMetadataFooter, type CreateEventFn, type ReviewStateReader } from './review-artifact-files.js';
import type { ParallixConfiguration } from '../../application/ports/configuration.js';
import type { LiveMissionExecutionContext } from '../../application/ports/mission-execution-context.js';
import { missionId } from '../../domain/mission.js';
import { currentReviewRound } from '../../domain/review.js';
import {
  currentReviewPublication,
  markReviewPublication,
  parseReviewPublication,
  reviewPublicationBody,
  reviewPublicationKey,
  reviewPublicationMarker,
  type ReviewPublicationIdentity,
} from './review-publication.js';

type PublicationPostingOptions = {
  publication?: ReviewPublicationIdentity;
  publicationStoredBody?: boolean;
  getCommentsFn?: ReviewCommentsFn;
};

type ReviewCommentsFn = (_branch: string, _token: string, _options?: { rootDir?: string; configuration?: ParallixConfiguration }) => Promise<unknown[] | null>;

function commentBody(comment: unknown): string {
  return comment && typeof comment === 'object' && typeof (comment as { body?: unknown }).body === 'string'
    ? (comment as { body: string }).body : '';
}

async function existingPublication(
  branch: string,
  token: string,
  publication: ReviewPublicationIdentity,
  getCommentsFn: ReviewCommentsFn,
  options: { rootDir: string; configuration?: ParallixConfiguration },
): Promise<boolean | null> {
  const comments = await getCommentsFn(branch, token, options);
  if (!Array.isArray(comments)) { return null; }
  const marker = reviewPublicationMarker(reviewPublicationKey(publication));
  return comments.some(comment => commentBody(comment).includes(marker));
}

async function recordPublicationResult(
  slug: string,
  publication: ReviewPublicationIdentity | undefined,
  missionStore: MissionStore | null | undefined,
  ok: boolean,
  error: string | null = null,
): Promise<void> {
  if (!publication || !missionStore) { return; }
  await markReviewPublication(missionStore, slug, reviewPublicationKey(publication), ok ? 'completed' : 'failed', error);
}

async function preparePublication(
  slug: string,
  branch: string,
  token: string,
  body: string,
  publication: ReviewPublicationIdentity | undefined,
  options: { missionStore?: MissionStore | null; getCommentsFn?: ReviewCommentsFn; rootDir: string; configuration?: ParallixConfiguration },
): Promise<{ ok: true; body: string; published: boolean } | { ok: false; error: string }> {
  if (!publication) { return { ok: true, body, published: false }; }
  const tagged = reviewPublicationBody(body, publication);
  const found = await existingPublication(branch, token, publication, options.getCommentsFn ?? getComments,
    { rootDir: options.rootDir, configuration: options.configuration });
  if (found === null) {
    const error = 'Could not read existing PR discussion; refusing a publication that could duplicate an accepted event.';
    await recordPublicationResult(slug, publication, options.missionStore, false, error);
    return { ok: false, error };
  }
  if (found) { await recordPublicationResult(slug, publication, options.missionStore, true); }
  return { ok: true, body: tagged, published: found };
}

async function runProviderPublication(
  slug: string,
  publication: ReviewPublicationIdentity | undefined,
  missionStore: MissionStore | null | undefined,
  operation: () => ReturnType<typeof postComment>,
  failure: (_result: ReturnType<typeof postComment>) => string,
): Promise<{ ok: boolean; error?: string }> {
  let result: ReturnType<typeof postComment>;
  try { result = operation(); }
  catch (postError) {
    const error = postError instanceof Error ? postError.message : String(postError);
    await recordPublicationResult(slug, publication, missionStore, false, error);
    return { ok: false, error };
  }
  if (!result.ok) {
    const error = failure(result);
    await recordPublicationResult(slug, publication, missionStore, false, error);
    return { ok: false, error };
  }
  await recordPublicationResult(slug, publication, missionStore, true);
  return { ok: true };
}

// =====================================================================
// Workflow Comment/Review Posting
// =====================================================================
export async function postWorkflowComment(
  slug: string,
  message: string,
  options: {
    log?: (_msg: string) => void;
    error?: (_msg: string) => void;
    readTokenFn?: (_user: string, _opts: { rootDir?: string; configuration?: ParallixConfiguration }) => string | null;
    postCommentFn?: typeof postComment;
    buildMetadataFooterFn?: (_s: string, _r?: string, _store?: MissionStore | null) => string | Promise<string>;
    readReviewStateFn?: ReviewStateReader;
    executionContext: LiveMissionExecutionContext;
    reviewIdentity?: string;
    forgejoUser?: string;
    missionStore?: MissionStore | null;
    configuration?: ParallixConfiguration;
  } & PublicationPostingOptions
): Promise<{ ok: boolean; error?: string }> {
  const { log, error, readTokenFn, postCommentFn, buildMetadataFooterFn, readReviewStateFn } = postWorkflowCommentBindings(options);
  const rootDir = options.executionContext.missionWorktree;
  const branch = missionBranchName(slug, rootDir);
  const identityResolved = options.reviewIdentity
    || options.forgejoUser
    || (await resolveReviewIdentity(slug, rootDir, { readReviewStateFn: readReviewStateFn })).commentIdentityUser
    || 'human';
  const reviewIdentity = identityResolved;
  const token = readTokenFn(reviewIdentity, { rootDir, configuration: options.configuration });
  if (!token) {
    error(fmt.status('FAIL', `No Forgejo token found for user "${reviewIdentity}". Cannot post comment.`));
    return { ok: false };
  }

  const storedBody = options.publicationStoredBody ? message
    : message + await Promise.resolve(buildMetadataFooterFn(slug, rootDir, options.missionStore ?? null));
  const prepared = await preparePublication(slug, branch, token, storedBody, options.publication,
    { missionStore: options.missionStore, getCommentsFn: options.getCommentsFn, rootDir, configuration: options.configuration });
  if (!prepared.ok) { error(fmt.status('FAIL', prepared.error)); return prepared; }
  if (prepared.published) { return { ok: true }; }
  log(fmt.status('INFO', `Posting PR comment on ${branch} as ${reviewIdentity}...`));
  const posted = await runProviderPublication(slug, options.publication, options.missionStore,
    () => postCommentFn(branch, token, prepared.body, { forgejoUser: reviewIdentity, reviewIdentity, rootDir, configuration: options.configuration }),
    result => providerError(result) || 'API error');
  if (!posted.ok) { error(fmt.status('FAIL', `Could not post comment: ${posted.error}`)); return posted; }
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
 * Submit a review outcome to the provider.
 */
export async function postWorkflowReview(
  slug: string,
  outcome: string,
  message: string,
  options: {
    log?: (_msg: string) => void;
    error?: (_msg: string) => void;
    readTokenFn?: (_user: string, _opts: { rootDir?: string; configuration?: ParallixConfiguration }) => string | null;
    postReviewFn?: typeof postReview;
    postCommentFn?: typeof postComment;
    buildMetadataFooterFn?: (_s: string, _r?: string, _store?: MissionStore | null) => string | Promise<string>;
    readReviewStateFn?: ReviewStateReader;
    executionContext: LiveMissionExecutionContext;
    revision?: string;
    reviewIdentity?: string;
    forgejoUser?: string;
    getPrAuthorFn?: typeof getPrAuthor;
    writeReviewStateFn?: typeof writeReviewState;
    createEventFn?: CreateEventFn;
    missionStore?: MissionStore | null;
    lifecycleService?: Pick<MissionLifecycleService, 'transition'> | null;
    recordApprovalFn?: typeof recordApproval;
    configuration?: ParallixConfiguration;
  } & PublicationPostingOptions
): Promise<{ ok: boolean; error?: string; skipped?: boolean; reason?: string; prAuthor?: unknown }> {
  const { log, error, readTokenFn, postReviewFn, buildMetadataFooterFn, readReviewStateFn } = postWorkflowReviewBindings(options);
  const worktree = options.executionContext.missionWorktree;
  const branch = missionBranchName(slug, worktree);
  const identityResolved = options.reviewIdentity
    || options.forgejoUser
    || (await resolveReviewIdentity(slug, worktree, { readReviewStateFn: readReviewStateFn })).identityUser
    || 'human';
  const reviewIdentity = identityResolved;
  const missionStore = options.missionStore ?? null;
  const token = readTokenFn(reviewIdentity, { rootDir: worktree, configuration: options.configuration });
  if (!token) {
    error(fmt.status('FAIL', `No Forgejo token found for user "${reviewIdentity}". Cannot submit review.`));
    return { ok: false };
  }

  const getPrAuthorFn = options.getPrAuthorFn || getPrAuthor;
  const prAuthor = providerPrAuthor(getPrAuthorFn, branch, token, reviewIdentity, worktree, options.configuration);
  if (prAuthor && prAuthor === reviewIdentity) {
    // Provider authorship controls only the transport. The Mission's current
    // reviewer policy owns verdict authority, including after reassignment.
    const mirrored = await postWorkflowComment(slug, `Verdict: ${outcome}\n\n${message}`, {
      ...options,
      reviewIdentity,
      ...(options.publication ? { publication: { ...options.publication, target: 'comment' } } : {}),
    });
    return { ...mirrored, skipped: true, reason: 'self-author', prAuthor };
  }

  return postPreparedWorkflowReview(slug, outcome, message, {
    options, missionStore, branch, token, reviewIdentity, worktree,
    postReviewFn, buildMetadataFooterFn, log, error,
  });
}

async function postPreparedWorkflowReview(
  slug: string,
  outcome: string,
  message: string,
  context: {
    options: NonNullable<Parameters<typeof postWorkflowReview>[3]>;
    missionStore: MissionStore | null; branch: string; token: string; reviewIdentity: string; worktree: string;
    postReviewFn: typeof postReview; buildMetadataFooterFn: NonNullable<Parameters<typeof postWorkflowReview>[3]['buildMetadataFooterFn']>;
    log: (_message: string) => void; error: (_message: string) => void;
  },
): Promise<{ ok: boolean; error?: string }> {
  const { options, missionStore, branch, token, reviewIdentity, worktree, postReviewFn, buildMetadataFooterFn, log, error } = context;
  const storedBody = options.publicationStoredBody ? message
    : message + await Promise.resolve(buildMetadataFooterFn(slug, worktree, missionStore));
  const prepared = await preparePublication(slug, branch, token, storedBody, options.publication,
    { missionStore, getCommentsFn: options.getCommentsFn, rootDir: worktree, configuration: options.configuration });
  if (!prepared.ok || prepared.published) { return prepared.ok ? { ok: true } : prepared; }
  log(fmt.status('INFO', `Submitting review outcome "${outcome}" on ${branch} as ${reviewIdentity}...`));
  const posted = await runProviderPublication(slug, options.publication, missionStore,
    () => postReviewFn(branch, token, outcome, prepared.body, { forgejoUser: reviewIdentity, reviewIdentity, rootDir: worktree, configuration: options.configuration }),
    describeProviderFailure);
  if (!posted.ok) { error(fmt.status('FAIL', `Could not submit review: ${posted.error}`)); return posted; }
  log(fmt.status('PASS', `Review outcome "${outcome}" posted on PR for ${branch}.`));
  return { ok: true };
}

function providerPrAuthor(
  getPrAuthorFn: typeof getPrAuthor,
  branch: string,
  token: string,
  reviewIdentity: string,
  worktree: string,
  configuration?: ParallixConfiguration,
): ReturnType<typeof getPrAuthor> {
  try {
    return getPrAuthorFn(branch, token, { forgejoUser: reviewIdentity, reviewIdentity, rootDir: worktree, configuration });
  } catch {
    return null;
  }
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

export async function recoverReviewPublications(
  slug: string,
  options: {
    executionContext: LiveMissionExecutionContext;
    missionStore: MissionStore;
    configuration?: ParallixConfiguration;
    readTokenFn?: Parameters<typeof postWorkflowComment>[2]['readTokenFn'];
    getCommentsFn?: ReviewCommentsFn;
    postCommentFn?: typeof postComment;
    postReviewFn?: typeof postReview;
    getPrAuthorFn?: typeof getPrAuthor;
    log?: (_message: string) => void;
    error?: (_message: string) => void;
  },
): Promise<{ ok: boolean; pending: number }> {
  const loaded = await options.missionStore.load(missionId(slug));
  if (loaded.kind !== 'found' || !loaded.mission.review) { return { ok: true, pending: 0 }; }
  const round = currentReviewRound(loaded.mission.review);
  const pending = loaded.mission.review.reviewEvents.filter(event => {
    const publication = parseReviewPublication(event.followUpReference);
    return publication && publication.eventType !== 'blocked_publication' && publication.state !== 'completed';
  });
  for (const event of pending) {
    const publication = parseReviewPublication(event.followUpReference)!;
    if (!currentReviewPublication(slug, publication, event, round)) {
      await markReviewPublication(options.missionStore, slug, publication.key, 'completed');
      options.log?.(`Ignoring superseded review publication for round ${publication.round}; current round is ${round.number}.`);
      continue;
    }
    const identity: ReviewPublicationIdentity = {
      slug,
      round: publication.round,
      actor: publication.actor,
      revision: publication.revision,
      eventType: publication.eventType,
      target: publication.target,
    };
    const common = {
      executionContext: options.executionContext,
      missionStore: options.missionStore,
      configuration: options.configuration,
      reviewIdentity: publication.actor,
      readTokenFn: options.readTokenFn,
      getCommentsFn: options.getCommentsFn,
      publication: identity,
      publicationStoredBody: true,
      log: options.log,
      error: options.error,
    };
    const result = publication.target === 'review'
      ? await postWorkflowReview(slug, event.verdict ?? 'comment', event.content, {
        ...common,
        postReviewFn: options.postReviewFn,
        postCommentFn: options.postCommentFn,
        getPrAuthorFn: options.getPrAuthorFn,
      })
      : await postWorkflowComment(slug, event.content, { ...common, postCommentFn: options.postCommentFn });
    if (!result.ok) { return { ok: false, pending: pending.length }; }
  }
  return { ok: true, pending: pending.length };
}
