import { reviewPushIdentity } from '../../domain/review-command-policy.js';
/**
 * Review Commands Module
 * Implements the current review command dispatch and CLI behavior.
 */

import * as fmt from '../../application/presentation/cli-format.js';
import { resolveWorktree, missionBranchName } from '../filesystem/mission-utils.js';
import { resolveTaskFile, getTaskStatus, getTaskImplementer, transitionTask } from '../backlog/backlog.js';
import { readToken, postComment, createPr, getComments, resolveReviewUser, isProviderEnabled } from './review-adapter.js';
import { readReviewState, writeReviewState, resolveReviewIdentity, persistReviewStateOrThrow, reconcileInterruptedHandoff } from './review-state.js';
import type { MissionStore } from '../../application/domain-ports.js';
import { readAllEvents } from './review-events.js';
import { bootstrapReviewSurface } from './setup-review.js';
import { resolveReviewAdapter } from '../config/product-config.js';
import { buildMetadataFooter, postWorkflowComment } from './review-artifacts.js';
export { resumeIntervenedReview, continueReviewClearsIntervention, continueReviewInvalidatesBlocker } from './review-intervention-commands.js';
export { verifyReview, submitForReview } from './review-verify-commands.js';
export { submitReviewRound, closeMissionPr } from './review-submit-round.js';
export { createEventHandler, importLegacyHandler, backfillReviewHandler, reconcileInterruptedHandoffHandler } from './review-event-handlers.js';

export { REVIEW_FLAGS, REVIEW_VALUE_FLAGS, unknownReviewFlags, flagValue, readTextFlag, repeatedFlagValues } from './review-cli-flags.js';
export { formatStaticReviewFindings, formatStaticReviewSuccess, performStaticReview } from './review-static-evidence.js';

export async function postStaticReviewComment(
  slug: string,
  message: string,
  options: {
    log?: (_msg: string) => void;
    error?: (_msg: string) => void;
    resolveTaskFileFn?: typeof resolveTaskFile;
    getTaskStatusFn?: typeof getTaskStatus;
    getTaskImplementerFn?: typeof getTaskImplementer;
    resolveWorktreeFn?: typeof resolveWorktree;
    reconcileInterruptedHandoffFn?: typeof reconcileInterruptedHandoff;
    /** Production composition enables the pre-launch aggregate guard. */
    requireReviewAggregate?: boolean;
    missionStore?: MissionStore | null;
    readTokenFn?: typeof readToken;
    postCommentFn?: typeof postComment;
    resolveReviewUserFn?: typeof resolveReviewUser;
    resolveForgejoUserFn?: typeof resolveReviewUser;
    readReviewStateFn?: typeof readReviewState;
    buildMetadataFooterFn?: typeof buildMetadataFooter;
    rootDir?: string;
  } = {}
): Promise<{ ok: boolean; error?: string }> {
  const log = options.log || fmt.log.plain;
  const error = options.error || fmt.log.plainError;
  const resolveTaskFileFn = options.resolveTaskFileFn || resolveTaskFile;
  const getTaskImplementerFn = options.getTaskImplementerFn || getTaskImplementer;
  const resolveWorktreeFn = options.resolveWorktreeFn || resolveWorktree;
  const readTokenFn = options.readTokenFn || readToken;
  const postCommentFn = options.postCommentFn || postComment;
  const resolveReviewUserFn = options.resolveReviewUserFn || options.resolveForgejoUserFn || resolveReviewUser;
  const readReviewStateFn = options.readReviewStateFn || readReviewState;
  const buildMetadataFooterFn = options.buildMetadataFooterFn || buildMetadataFooter;

  const rootDir = options.rootDir || resolveWorktreeFn(slug) || process.cwd();
  const branch = missionBranchName(slug, rootDir);
  const { identityUser } = await resolveReviewIdentity(slug, rootDir, {
    readReviewStateFn,
  });
  let resolvedUser = identityUser;

  if (!resolvedUser) {
    const taskResolution = resolveTaskFileFn(slug, rootDir);
    if (taskResolution.ok) {
      resolvedUser = getTaskImplementerFn(taskResolution.taskFile!);
    }
  }
  if (!resolvedUser) {
    error(`Cannot determine review identity. Set FORGEJO_USER, start the review with px review ${slug} --start, or assign the task implementer.`);
    return { ok: false, error: 'missing-user' };
  }
  resolvedUser = resolveReviewUserFn(resolvedUser!);
  const token = readTokenFn(resolvedUser!, { rootDir });
  if (!token) {
    error(`No Forgejo token found for user "${resolvedUser}". Cannot post static review comment.`);
    return { ok: false, error: 'missing-token' };
  }

  const taggedMessage = message + buildMetadataFooterFn(slug, rootDir);
  log(`Posting static review comment on ${fmt.branch(branch)} as ${resolvedUser}...`);
  const result = postCommentFn(branch, token, taggedMessage, { reviewIdentity: resolvedUser, forgejoUser: resolvedUser }) as { ok: boolean; error?: string };

  if (!result.ok) {
    error(`Could not post static review comment: ${result.error || 'API error'}`);
    return result;
  }

  log(fmt.status('PASS', `Static review comment posted on PR for ${fmt.branch(branch)}.`));
  return result;
}

// ===============================================================================
// Command: resumeIntervenedReview
// ===============================================================================

export async function readComments(
  slug: string,
  options: {
    log?: (_msg: string) => void;
    error?: (_msg: string) => void;
    exit?: (_code: number) => never;
    readTokenFn?: typeof readToken;
    readReviewStateFn?: typeof readReviewState;
    resolveReviewUserFn?: typeof resolveReviewUser;
    resolveForgejoUserFn?: typeof resolveReviewUser;
    getCommentsFn?: typeof getComments;
    readAllEventsFn?: typeof readAllEvents;
    isReviewProviderEnabledFn?: typeof isProviderEnabled;
    isForgejoReviewEnabledFn?: typeof isProviderEnabled;
    worktree?: string;
  } = {}
): Promise<void> {
  const log = options.log || fmt.log.plain;
  const error = options.error || fmt.log.plainError;
  const exit = options.exit || process.exit;
  const readTokenFn = options.readTokenFn || readToken;
  const readReviewStateFn = options.readReviewStateFn || readReviewState;
  const resolveReviewUserFn = options.resolveReviewUserFn || options.resolveForgejoUserFn || resolveReviewUser;
  const getCommentsFn = options.getCommentsFn || getComments;
  const readAllEventsFn = options.readAllEventsFn || readAllEvents;
  const isReviewProviderEnabledFn = options.isReviewProviderEnabledFn || options.isForgejoReviewEnabledFn || isProviderEnabled;
  const worktree = options.worktree || resolveWorktree(slug) || process.cwd();
  const branch = missionBranchName(slug, worktree);

  // Provider-disabled fallback: read persisted local review events instead of polling the PR.
  // Avoids resolving a provider token (which would FAIL/exit) when the provider is off.
  if (!isReviewProviderEnabledFn(worktree)) {
    log(fmt.status('INFO', `Review provider disabled; reading local review events for ${slug}...`));
    const events = await Promise.resolve(readAllEventsFn(slug, { rootDir: worktree, error }));
    if (!events || events.length === 0) {
      log('no comments');
      return;
    }
    for (const e of events as Record<string, unknown>[]) {
      let label = (e.event_type as string) || 'event';
      if (e.round !== null) { label += ` round ${e.round}`; }
      log(`--- ${label} | ${(e.actor as string) || 'unknown'} (${(e.timestamp as string) || (e.fileCreated as string) || ''}) ---`);
      log((e.content as string) || '(no body)');
      log('');
    }
    return;
  }

  let reviewIdentity = (await resolveReviewIdentity(slug, worktree, {
    readReviewStateFn,
  })).identityUser;

  if (!reviewIdentity) {
    error(fmt.status('FAIL', `Cannot determine review identity for ${slug}. Start the review with px review ${slug} --start, or set FORGEJO_USER.`));
    exit(1);
    return;
  }
  reviewIdentity = resolveReviewUserFn(reviewIdentity);

  const token = readTokenFn(reviewIdentity!, { rootDir: worktree });
  if (!token) {
    error(fmt.status('FAIL', `No Forgejo token found for user "${reviewIdentity}".`));
    exit(1);
    return;
  }

  log(fmt.status('INFO', `Reading PR comments on ${branch} as ${reviewIdentity}...`));
  const comments = await getCommentsFn(branch, token) as unknown[] | null;

  if (comments === null) {
    error(fmt.status('FAIL', `Could not fetch PR comments for ${branch}. The review provider may be unreachable or the PR is missing.`));
    exit(1);
    return;
  }

  if (comments.length === 0) {
    log('no comments');
    return;
  }

  for (const c of comments as Record<string, unknown>[]) {
    let label = c.kind as string;
    if (c.location) { label += ` ${c.location}`; }
    log(`--- ${label} | ${c.user} (${c.created}) ---`);
    log((c.body as string) || '(no body)');
    log('');
  }
}

// ============================================================================
// Command: pushRound
// ============================================================================

export async function pushRound(
  slug: string,
  options: {
    log?: (_msg: string) => void;
    error?: (_msg: string) => void;
    exit?: (_code: number) => never;
    resolveWorktreeFn?: typeof resolveWorktree;
    resolveTaskFileFn?: typeof resolveTaskFile;
    getTaskImplementerFn?: typeof getTaskImplementer;
    transitionTaskFn?: typeof transitionTask;
    resolveReviewUserFn?: typeof resolveReviewUser;
    resolveForgejoUserFn?: typeof resolveReviewUser;
    isReviewProviderEnabledFn?: typeof isProviderEnabled;
    isForgejoReviewEnabledFn?: typeof isProviderEnabled;
    readTokenFn?: typeof readToken;
    readReviewStateFn?: typeof readReviewState;
    createPrFn?: typeof createPr;
    bootstrapReviewSurfaceFn?: typeof bootstrapReviewSurface;
    resolveReviewAdapterFn?: typeof resolveReviewAdapter;
    cwdFn?: () => string;
    force?: boolean;
  } = {}
): Promise<void> {
  const log = options.log || fmt.log.plain;
  const error = options.error || fmt.log.plainError;
  const exit = options.exit || process.exit;
  const resolveWorktreeFn = options.resolveWorktreeFn || resolveWorktree;
  const resolveTaskFileFn = options.resolveTaskFileFn || resolveTaskFile;
  const getTaskImplementerFn = options.getTaskImplementerFn || getTaskImplementer;
  const transitionTaskFn = options.transitionTaskFn || transitionTask;
  const resolveReviewUserFn = options.resolveReviewUserFn || options.resolveForgejoUserFn || resolveReviewUser;
  const isReviewProviderEnabledFn = options.isReviewProviderEnabledFn || options.isForgejoReviewEnabledFn || isProviderEnabled;
  const readTokenFn = options.readTokenFn || readToken;
  const readReviewStateFn = options.readReviewStateFn || readReviewState;
  const createPrFn = options.createPrFn || createPr;
  const bootstrapReviewSurfaceFn = options.bootstrapReviewSurfaceFn || bootstrapReviewSurface;
  const resolveReviewAdapterFn = options.resolveReviewAdapterFn || resolveReviewAdapter;
  const cwdFn = options.cwdFn || (() => process.cwd());
  const force = options.force || false;
  const worktree = resolveWorktreeFn(slug);
  const rootDir = worktree || cwdFn();
  const branch = missionBranchName(slug, rootDir);
  const providerEnabled = isReviewProviderEnabledFn(rootDir);

  const reviewIdentity = await resolvePushReviewIdentity(slug, rootDir, providerEnabled, readReviewStateFn, resolveTaskFileFn, getTaskImplementerFn, log, error, exit);
  if (!reviewIdentity) { return; }
  const resolvedIdentity = resolveReviewUserFn(reviewIdentity) || reviewIdentity;
  const token = readTokenFn(resolvedIdentity, { rootDir: worktree || undefined });
  if (!token) {
    error(fmt.status('FAIL', `No Forgejo token found for user "${resolvedIdentity}".`));
    exit(1);
    return;
  }

  // Transition to review before pushing so the state change is included in the PR update
  await transitionTaskFn(slug, 'review', { rootDir, log });

  log(fmt.status('INFO', `Pushing ${branch} to the review provider as ${resolvedIdentity}...${force ? ' (force-with-lease)' : ''}`));
  if (worktree) {
    log(fmt.status('INFO', `Found dedicated worktree: ${worktree}`));
  }

  let result = createPrFn(branch, resolvedIdentity, token, { rootDir, forceWithLease: true }) as Record<string, unknown>;
  if (!result.ok && /Repository not found/i.test((result.error as string) || '')) {
    const reviewAdapter = resolveReviewAdapterFn(rootDir) as Record<string, any>;
    const ownerLogin = (reviewAdapter.repo && reviewAdapter.repo.split('/')[0]) || 'human';
    const bootstrap = await bootstrapReviewSurfaceFn(rootDir, {
      baseUrl: reviewAdapter.baseUrl,
      repo: reviewAdapter.repo,
      ownerLogin,
      ownerPassword: '',
      agentPasswords: [],
    }, {
      interactive: false,
      log,
      error,
    });
    if ((bootstrap as Record<string, unknown>).ok) {
      result = createPrFn(branch, resolvedIdentity, token, { rootDir, forceWithLease: true }) as Record<string, unknown>;
    }
  }

  if (!result.ok) {
    error(fmt.status('FAIL', `Push to review provider failed: ${result.error}`));
    exit(1);
    return;
  }

  log(fmt.status('PASS', `Branch pushed and PR updated for ${branch}.`));
}

async function resolvePushReviewIdentity(slug: string, rootDir: string, providerEnabled: boolean, readState: typeof readReviewState, resolveTask: typeof resolveTaskFile, getImplementer: typeof getTaskImplementer, log: Function, error: Function, exit: Function): Promise<string | null> {
  const { identityUser } = await resolveReviewIdentity(slug, rootDir, { readReviewStateFn: readState });
  const task = identityUser ? null : resolveTask(slug, rootDir);
  const taskImplementer = task?.ok ? getImplementer(task.taskFile!) : null;
  const { identity, defaulted } = reviewPushIdentity(identityUser, taskImplementer, providerEnabled);
  if (!identity) {
    error(fmt.status('FAIL', providerEnabled ? `No review identity resolved for --push on ${slug}. Start the review with px review ${slug} --start, or set the task implementer.` : 'No review identity resolved for push.'));
    exit(1);
    return null;
  }
  if (defaulted) { log(fmt.status('WARN', 'No reviewer/implementer identity resolved for --push; defaulting to "autonomous"')); }
  return identity;
}

// ============================================================================
// Command: showReviewStatus
// ============================================================================

export async function showReviewStatus(
  slug: string,
  options: {
    log?: (_msg: string) => void;
    readReviewStateFn?: typeof readReviewState;
    resolveWorktreeFn?: typeof resolveWorktree;
  } = {}
): Promise<void> {
  const log = options.log || fmt.log.plain;
  const readReviewStateFn = options.readReviewStateFn || readReviewState;
  const resolveWorktreeFn = options.resolveWorktreeFn || resolveWorktree;

  const worktree = resolveWorktreeFn(slug) || process.cwd();
  const state = await Promise.resolve(readReviewStateFn(slug, worktree));

  log(fmt.status('INFO', `Review status for mission: ${fmt.slug(slug)}`));

  if (!state) {
    log(fmt.status('INFO', 'No persisted review state found.'));
    return;
  }

  log(`  Round:       ${state.round}`);
  log(`  Phase:       ${state.phase}`);
  log(`  Reviewer:    ${fmt.agent(state.reviewer ?? '')}`);
  log(`  Implementer: ${fmt.agent(state.implementer ?? '')}`);
  log(`  Started at:  ${state.startedAt}`);
  if (state.disposition) {
    log(`  Disposition: ${state.disposition}`);
  }
}

// ============================================================================
// Command: commentRound
// ============================================================================

export async function commentRound(
  slug: string,
  message: string,
  options: {
    log?: (_msg: string) => void;
    error?: (_msg: string) => void;
    exit?: (_code: number) => never;
    readReviewStateFn?: typeof readReviewState;
    writeReviewStateFn?: typeof writeReviewState;
    resolveReviewUserFn?: typeof resolveReviewUser;
    resolveForgejoUserFn?: typeof resolveReviewUser;
    rootDir?: string;
    readTokenFn?: typeof readToken;
    postCommentFn?: typeof postComment;
    buildMetadataFooterFn?: typeof buildMetadataFooter;
    missionStore?: MissionStore | null;
  } = {}
): Promise<void> {
  const log = options.log || fmt.log.plain;
  const error = options.error || fmt.log.plainError;
  const exit = options.exit || process.exit;
  const readReviewStateFn = options.readReviewStateFn || readReviewState;
  const writeReviewStateFn = options.writeReviewStateFn || writeReviewState;
  const resolveReviewUserFn = options.resolveReviewUserFn || options.resolveForgejoUserFn || resolveReviewUser;
  const rootDir = options.rootDir || resolveWorktree(slug) || process.cwd();
  const missionStore = options.missionStore;

  let reviewIdentity = (await resolveReviewIdentity(slug, rootDir, {
    readReviewStateFn,
  })).identityUser;

  if (!reviewIdentity) {
    error(fmt.status('FAIL', `Cannot determine review identity for ${slug}. Start the review with px review ${slug} --start, or set FORGEJO_USER.`));
    exit(1);
    return;
  }
  reviewIdentity = resolveReviewUserFn(reviewIdentity);
  const result = await postWorkflowComment(slug, message, {
    rootDir,
    reviewIdentity: reviewIdentity || undefined,
    readTokenFn: options.readTokenFn,
    postCommentFn: options.postCommentFn,
    buildMetadataFooterFn: options.buildMetadataFooterFn,
    log,
    error
  });

  if (!result.ok) {
    exit(1);
    return;
  }

  const currentState = await Promise.resolve(readReviewStateFn(slug, rootDir));
  if (currentState) {
    await persistReviewStateOrThrow(writeReviewStateFn, slug, currentState, rootDir, missionStore);
  }
}

// ============================================================================
// Command: submitReviewRound
// ============================================================================

export { ReviewWorkflowAdapter, createReviewWorkflowAdapter } from './review-workflow-adapter.js';
