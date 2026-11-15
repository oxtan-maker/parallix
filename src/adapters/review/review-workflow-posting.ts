import { assertReviewPhaseTransition } from '../../domain/review-phase-policy.js';
/**
 * Workflow comment and review posting to the provider, with local
 * review-verdict recording.
 */

import * as fmt from '../../application/presentation/cli-format.js';
import { missionBranchName } from '../filesystem/mission-utils.js';
import { readReviewState, writeReviewState, ReviewState, resolveReviewIdentity, persistReviewStateOrThrow } from './review-state.js';
import type { MissionStore } from '../../application/domain-ports.js';
import { readToken, postComment, postReview, getPrAuthor, getComments } from './review-adapter.js';
import { createEvent, VALID_EVENT_TYPES } from './review-events.js';
import { recordApproval } from './review-round.js';
import type { MissionLifecycleService } from '../../application/mission-lifecycle-service.js';
import { buildMetadataFooter, type CreateEventFn, type ReviewStateReader } from './review-artifact-files.js';
import type { ParallixConfiguration } from '../../application/ports/configuration.js';
import { reviewerResultAttribution } from './reviewer-result-attribution.js';
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

/** Only an advisory approve owes an independent approval; a same-agent review is a complete agent review. */
function advisoryApprovalOwed(outcome: string, selfReviewAllowed: boolean): boolean {
  return outcome === 'approve' && !selfReviewAllowed;
}

function localReviewOutcomeEvent(outcome: string, selfReviewAllowed: boolean) {
  return {
    verdict: selfReviewAllowed ? outcome : 'comment',
    content: selfReviewAllowed ? `Single-family self-author verdict: ${outcome}` : `Advisory self-author verdict: ${outcome}`,
    ...(advisoryApprovalOwed(outcome, selfReviewAllowed) ? { blockedReason: 'external-formal-approval-owed' } : {}),
  };
}

/**
 * Record a review verdict on the mission's Review.
 */
async function recordLocalReviewVerdict(
  slug: string,
  outcome: string,
  options: {
    executionContext: LiveMissionExecutionContext;
    writeReviewStateFn?: typeof writeReviewState;
    createEventFn?: CreateEventFn;
    readReviewStateFn?: ReviewStateReader;
    log?: (_msg: string) => void;
    error?: (_msg: string) => void;
    missionStore?: MissionStore | null;
    revision?: string;
    recordApprovalFn?: typeof recordApproval;
    lifecycleService?: Pick<MissionLifecycleService, 'transition'> | null;
    recordOutcomeEvent?: boolean;
  }
): Promise<boolean> {
  const { missionStore, worktree, writeReviewStateFn, createEventFn, readReviewStateFn, log, error } = recordLocalReviewVerdictBindings(options);
  const existing = await Promise.resolve(readReviewStateFn(slug, worktree, missionStore));
  // TASK-2385: a read miss must not fabricate a round-1 verdict. The old
  // `round: 1` fallback silently downgraded the round and fed the stale-round
  // producer observed on task-2377.05. A verdict can only attach to a review
  // `px review` started, so fail closed rather than invent one.
  if (!existing) {
    throw new Error(
      `Cannot record review verdict for ${slug}: no review state found. A review must be started with \`px review ${slug}\` before recording a verdict; refusing to fabricate round 1`,
    );
  }
  const selfReviewAllowed = Boolean(existing.reviewer && existing.reviewer === existing.implementer);
  const state = existing instanceof ReviewState
    ? existing
    : new ReviewState(slug, existing);
  // A same-agent review is a complete agent review; it leaves no approval debt. Only an advisory (non-authoritative) verdict owes one.
  state.metadata = { ...state.metadata, approvalOwed: advisoryApprovalOwed(outcome, selfReviewAllowed) };
  if (selfReviewAllowed) {
    state.disposition = outcome === 'approve' ? 'APPROVED' : outcome === 'request-changes' ? 'REQUEST_CHANGES' : 'COMMENT';
    if (outcome === 'approve' && state.phase !== 'approved') {
      assertReviewPhaseTransition(state.phase, 'approved');
      const decision = await (options.recordApprovalFn ?? recordApproval)(slug, {
        comment: null,
        decidedAt: new Date().toISOString(),
        revision: options.revision,
        observedRound: { number: state.round, startedAt: state.startedAt },
        result: reviewerResultAttribution(existing.reviewer ?? 'reviewer', null),
      }, { missionStore, lifecycleService: options.lifecycleService });
      if (decision.outcome === 'failed') { throw new Error(decision.diagnostic); }
      state.phase = 'approved';
    }
  }
  await persistReviewStateOrThrow(writeReviewStateFn, slug, state, worktree, missionStore);
  if (options.recordOutcomeEvent !== false) {
    const outcomeResult = await createEventFn(
      slug,
      VALID_EVENT_TYPES.REVIEWER_OUTCOME,
      localReviewOutcomeEvent(outcome, selfReviewAllowed),
      { executionContext: options.executionContext, log: log, error, missionStore },
    );
    if (!outcomeResult.ok) {
      throw new Error(`Cannot store review event for "${slug}": the operator database rejected the write.`);
    }
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
    const diagnostic = `Reviewer "${reviewIdentity}" is the PR author for ${branch}; independent review is required. Self-author verdict "${outcome}" is advisory and cannot approve the Mission or advance integration.`;
    const allowed = await recordLocalReviewVerdict(slug, outcome, {
      executionContext: options.executionContext,
      writeReviewStateFn: options.writeReviewStateFn,
      createEventFn: options.createEventFn,
      readReviewStateFn: readReviewStateFn,
      log: log,
      error,
      missionStore,
      lifecycleService: options.lifecycleService,
      recordApprovalFn: options.recordApprovalFn,
      revision: options.revision,
      // The accepted artifact already installed this exact publication
      // obligation in the decision CAS. A second unreferenced outcome would
      // look complete to controller consumption before the PR mirror exists.
      recordOutcomeEvent: !options.publication,
    });
    if (allowed && options.publication) {
      const storedBody = options.publicationStoredBody ? message
        : message + await Promise.resolve(buildMetadataFooterFn(slug, worktree, missionStore));
      const mirrored = await postWorkflowComment(slug, storedBody, {
        executionContext: options.executionContext,
        reviewIdentity,
        readTokenFn: options.readTokenFn,
        getCommentsFn: options.getCommentsFn,
        postCommentFn: options.postCommentFn,
        missionStore,
        configuration: options.configuration,
        publication: { ...options.publication, target: 'comment' },
        publicationStoredBody: true,
        log,
        error,
      });
      if (!mirrored.ok) { return { ...mirrored, skipped: true, reason: 'self-author', prAuthor }; }
    }
    log(fmt.status('WARN', allowed
      ? `Provider self-review was recorded as a provenance comment because Forgejo forbids self-approval reviews. Human inspection remains optional.`
      : `Provider self-approval POST skipped; a different agent or a human must supply formal approval.`));
    return { ok: allowed, skipped: true, reason: 'self-author', prAuthor, ...(allowed ? {} : { error: diagnostic }) };
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

function recordLocalReviewVerdictBindings(options: NonNullable<Parameters<typeof recordLocalReviewVerdict>[2]>) {
  const missionStore = options.missionStore ?? null;
  const worktree = options.executionContext.missionWorktree;
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
