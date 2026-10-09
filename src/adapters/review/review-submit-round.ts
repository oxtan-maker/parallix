import type { ParallixConfiguration } from "../../application/ports/configuration.js";
/**
 * Reviewer-side round submission: record the decision, apply local and
 * provider review state, and close the mission PR.
 */

import * as fmt from '../../application/presentation/cli-format.js';
import { resolveWorktree, missionBranchName } from '../filesystem/mission-utils.js';
import { resolveTaskFile, getTaskStatus, transitionTask } from '../backlog/backlog.js';
import { readToken, postReview, closePr, resolveReviewUser, isProviderEnabled } from './review-adapter.js';
import { readReviewState, writeReviewState, resolveReviewIdentity, ReviewState, persistReviewStateOrThrow } from './review-state.js';
import type { MissionStore } from '../../application/domain-ports.js';
import type { MissionLifecycleService } from '../../application/mission-lifecycle-service.js';
import { mirrorReviewOutcome } from '../../application/review-task-mirroring.js';
import type { ReviewTaskMirror } from '../../application/ports/review-task-mirror.js';
import { parseReviewFindings, recordRequestedChanges, recordApproval, approvalLegalDiagnostic } from './review-round.js';
import { reviewFindingId } from '../../domain/review.js';
import { createEvent } from './review-events.js';
import { buildMetadataFooter, postWorkflowReview } from './review-artifacts.js';
import { runPhaseGates } from '../config/repository-gates.js';
import { repairStaleActiveTaskAfterReview } from './review-intervention-commands.js';

type SubmitReviewOptions = {
  configuration?: ParallixConfiguration;
  log?: (_msg: string) => void;
  error?: (_msg: string) => void;
  exit?: (_code: number) => never;
  transitionTaskFn?: typeof transitionTask;
  readReviewStateFn?: typeof readReviewState;
  writeReviewStateFn?: typeof writeReviewState;
  isReviewProviderEnabledFn?: typeof isProviderEnabled;
  isForgejoReviewEnabledFn?: typeof isProviderEnabled;
  resolveReviewUserFn?: typeof resolveReviewUser;
  resolveForgejoUserFn?: typeof resolveReviewUser;
  resolveTaskFileFn?: typeof resolveTaskFile;
  getTaskStatusFn?: typeof getTaskStatus;
  worktree?: string;
  readTokenFn?: typeof readToken;
  postReviewFn?: typeof postReview;
  getPrAuthorFn?: unknown;
  createEventFn?: typeof createEvent;
  buildMetadataFooterFn?: typeof buildMetadataFooter;
  missionStore?: MissionStore | null;
  lifecycleService?: MissionLifecycleService | null;
  recordRequestedChangesFn?: typeof recordRequestedChanges;
  recordApprovalFn?: typeof recordApproval;
};

/** Repository-configured pre-review gates block an approve (TASK-2457). Returns true when the outcome must stop. */
async function runPreReviewApproveGates(slug: string, worktree: string, log: (_msg: string) => void, error: (_msg: string) => void): Promise<boolean> {
  const preReviewResult = await runPhaseGates('review', {
    slug,
    checkoutPath: worktree,
    log: (/** @type {string} */ msg: string) => log(msg),
    error: (/** @type {string} */ msg: string) => error(msg),
  });
  if (!preReviewResult.ok && !preReviewResult.skipped) {
    error(fmt.status('FAIL', `Pre-review gate "${preReviewResult.failedGate?.key}" failed for ${slug}: ${preReviewResult.error}`));
    error(fmt.status('FAIL', `Mission stays in review. Resolve the gate and retry px review ${slug} --submit-review approve.`));
    return true;
  }
  return false;
}

/** Record the request-changes decision on the Review aggregate. Returns true when the outcome must stop. */
async function recordRequestChangesDecision(slug: string, outcome: string, message: string, options: SubmitReviewOptions, log: (_msg: string) => void, error: (_msg: string) => void): Promise<boolean> {
  if (!options.missionStore) {
    log(fmt.status('WARN', `No Mission authority bound for ${slug}; the request-changes decision was not recorded on the Review aggregate.`));
    return false;
  }
  const recordRequestedChangesFn = options.recordRequestedChangesFn || recordRequestedChanges;
  const parsed = parseReviewFindings(message);
  const decision = await recordRequestedChangesFn(slug, {
    // A hand-written message need not use finding headings; the message
    // itself is then the single finding.
    findings: parsed.length > 0 ? parsed : [{
      id: reviewFindingId('F1'),
      summary: (message.split('\n').find((line) => line.trim()) || `Changes requested for ${slug}`).trim(),
      location: null,
    }],
    comment: message || null,
    decidedAt: new Date().toISOString(),
  }, { missionStore: options.missionStore, lifecycleService: options.lifecycleService });
  if (decision.outcome === 'failed') {
    error(fmt.status('FAIL', `Review outcome "${outcome}" could not be recorded for ${slug}: ${decision.diagnostic}`));
    return true;
  }
  if (decision.outcome === 'unchanged') {
    log(fmt.status('INFO', `Review outcome "${outcome}" for ${slug} already recorded (${decision.reason}).`));
  }
  return false;
}

/** Record the authoritative approve on the Review aggregate. Returns true when the outcome must stop. */
async function recordApprovalDecision(slug: string, outcome: string, message: string, options: SubmitReviewOptions, log: (_msg: string) => void, error: (_msg: string) => void): Promise<boolean> {
  if (!options.missionStore) {
    log(fmt.status('WARN', `No Mission authority bound for ${slug}; the approve decision was not recorded on the Review aggregate.`));
    return false;
  }
  const recordApprovalFn = options.recordApprovalFn || recordApproval;
  const decision = await recordApprovalFn(slug, {
    comment: message || null,
    decidedAt: new Date().toISOString(),
    source: { kind: 'local' },
  }, { missionStore: options.missionStore, lifecycleService: options.lifecycleService });
  if (decision.outcome === 'failed') {
    error(fmt.status('FAIL', `Review outcome "${outcome}" could not be recorded for ${slug}: ${decision.diagnostic}`));
    return true;
  }
  if (decision.outcome === 'unchanged') {
    log(fmt.status('INFO', `Review outcome "${outcome}" for ${slug} already recorded (${decision.reason}).`));
  }
  return false;
}

/**
 * provider=none finalization: build or mutate the review state, persist it,
 * transition the Backlog task, and announce the local recording.
 * Returns true when the outcome must stop.
 */
function fallbackImplementer(configuration?: ParallixConfiguration) { return configuration?.agents.override || 'autonomous'; }

async function applyLocalReviewState(slug: string, outcome: string, message: string, worktree: string, options: SubmitReviewOptions, log: (_msg: string) => void, error: (_msg: string) => void): Promise<boolean> {
  const readReviewStateFn = options.readReviewStateFn || readReviewState;
  const writeReviewStateFn = options.writeReviewStateFn || writeReviewState;
  const transitionTaskFn = options.transitionTaskFn || transitionTask;
  const currentState = await Promise.resolve(readReviewStateFn(slug, worktree));

  let stateToWrite: ReviewState;
  if (currentState) {
    stateToWrite = currentState;
    if (outcome === 'approve') {
      stateToWrite.disposition = 'APPROVED';
      try { stateToWrite.transitionTo('approved'); } catch (_) { /* ignore */ }
    } else if (outcome === 'request-changes') {
      stateToWrite.disposition = 'REQUEST_CHANGES';
      try { stateToWrite.transitionTo('fixing'); } catch (_) { /* ignore */ }
    }
  } else {
    // No existing state, create minimal state for tracking
    const phaseForOutcome = outcome === 'approve' ? 'approved' : 'fixing';
    stateToWrite = new ReviewState(slug, {
      disposition: outcome === 'approve' ? 'APPROVED' : outcome === 'request-changes' ? 'REQUEST_CHANGES' : undefined,
      reviewer: 'autonomous',
      implementer: fallbackImplementer(options.configuration),
      round: 1,
      phase: phaseForOutcome,
    });
  }
  try {
    await persistReviewStateOrThrow(writeReviewStateFn, slug, stateToWrite, worktree, options.missionStore);
  } catch (err) {
    // The state write or the review → integration boundary failed. The
    // Mission may still be in review, so the Backlog task must not move —
    // in particular it must not be promoted to approved. px integrate is
    // the repair path.
    error(fmt.status('FAIL', `Review outcome "${outcome}" could not be finalized for ${slug}: ${err instanceof Error ? err.message : String(err)}`));
    error(fmt.status('FAIL', `Recovery: px integrate ${slug}`));
    return true;
  }

  const mirror: ReviewTaskMirror = {
    transition: status => Promise.resolve(transitionTaskFn(slug, status, { rootDir: worktree, log })).catch(() => {
      log(fmt.status('WARN', `Could not transition backlog task ${slug} to ${status}.`));
      return false;
    }),
  };
  void mirrorReviewOutcome(outcome, false, null, mirror);

  log(fmt.status('PASS', `Review outcome "${outcome}" recorded locally for ${slug}.`));
  return false;
}

/** Check that an approve can legally reach `approved` before the external POST. Returns true when the outcome must stop. */
async function checkProviderApproveLegality(slug: string, options: SubmitReviewOptions, log: (_msg: string) => void, error: (_msg: string) => void): Promise<boolean> {
  if (!options.missionStore) {
    log(fmt.status('WARN', `No Mission authority bound for ${slug}; the approve decision was not recorded on the Review aggregate.`));
    return false;
  }
  const legalDiagnostic = await approvalLegalDiagnostic(slug, { missionStore: options.missionStore });
  if (legalDiagnostic) {
    error(fmt.status('FAIL', `Review outcome "approve" could not be recorded for ${slug}: ${legalDiagnostic}`));
    return true;
  }
  return false;
}

/**
 * provider-backed finalization after a successful POST: mutate and persist the
 * review state, then transition the Backlog task.
 * Returns true when the outcome must stop.
 */
async function finalizeProviderReviewState(slug: string, outcome: string, worktree: string, options: SubmitReviewOptions, log: (_msg: string) => void, error: (_msg: string) => void): Promise<boolean> {
  const readReviewStateFn = options.readReviewStateFn || readReviewState;
  const writeReviewStateFn = options.writeReviewStateFn || writeReviewState;
  const transitionTaskFn = options.transitionTaskFn || transitionTask;
  const resolveTaskFileFn = options.resolveTaskFileFn || resolveTaskFile;
  const getTaskStatusFn = options.getTaskStatusFn || getTaskStatus;

  const currentState = await Promise.resolve(readReviewStateFn(slug, worktree));
  if (currentState) {
    if (outcome === 'approve') {
      currentState.disposition = 'APPROVED';
      try { currentState.transitionTo('approved'); } catch (_) { /* ignore */ }
    } else if (outcome === 'request-changes') {
      currentState.disposition = 'REQUEST_CHANGES';
      try { currentState.transitionTo('fixing'); } catch (_) { /* ignore */ }
    }
    try {
      await persistReviewStateOrThrow(writeReviewStateFn, slug, currentState, worktree, options.missionStore);
    } catch (err) {
      // The state write or the review → integration boundary failed. The
      // Mission may still be in review, so the Backlog task must not be
      // promoted to approved; px integrate is the repair path.
      error(fmt.status('FAIL', `Review outcome "${outcome}" could not be finalized for ${slug}: ${err instanceof Error ? err.message : String(err)}`));
      error(fmt.status('FAIL', `Recovery: px integrate ${slug}`));
      return true;
    }
  }

  const taskResolution = resolveTaskFileFn(slug, worktree);
  const currentStatus = taskResolution.ok ? getTaskStatusFn(taskResolution.taskFile!) : null;
  const mirror: ReviewTaskMirror = {
    transition: status => Promise.resolve(transitionTaskFn(slug, status, { rootDir: worktree, log })).catch(() => {
      log(fmt.status('WARN', `Could not transition backlog task ${slug} to ${status}.`));
      return false;
    }),
  };
  void mirrorReviewOutcome(outcome, true, currentStatus, mirror);
  return false;
}

export async function submitReviewRound(
  slug: string,
  outcome: string,
  message: string,
  options: SubmitReviewOptions = {}
): Promise<void> {
  const log = options.log || fmt.log.plain;
  const error = options.error || fmt.log.plainError;
  const exit = options.exit || process.exit;
  const transitionTaskFn = options.transitionTaskFn || transitionTask;
  const readReviewStateFn = options.readReviewStateFn || readReviewState;
  const isReviewProviderEnabledFn = options.isReviewProviderEnabledFn || options.isForgejoReviewEnabledFn || isProviderEnabled;
  const resolveReviewUserFn = options.resolveReviewUserFn || options.resolveForgejoUserFn || resolveReviewUser;
  const resolveTaskFileFn = options.resolveTaskFileFn || resolveTaskFile;
  const getTaskStatusFn = options.getTaskStatusFn || getTaskStatus;
  const VALID_OUTCOMES = ['approve', 'request-changes', 'comment'];
  if (!VALID_OUTCOMES.includes(outcome)) {
    error(fmt.status('FAIL', `Unknown review outcome "${outcome}". Valid: ${VALID_OUTCOMES.join(', ')}.`));
    exit(1);
    return;
  }

  const worktree = options.worktree || resolveWorktree(slug) || process.cwd();
  const providerEnabled = isReviewProviderEnabledFn(worktree);

  // Repository-configured pre-review gates (TASK-2457). The approve is the
  // review -> integration transition; a configured gate that exits non-zero
  // blocks it and leaves the mission in review. Runs from the review checkout
  // with the mission slug, checkout path, and exact phase in its environment.
  if (outcome === 'approve' && await runPreReviewApproveGates(slug, worktree, log, error)) {
    exit(1);
    return;
  }

  // A verdict is a domain decision, not only a provider comment. Recording it
  // is what returns the mission to the implementer and leaves the round able to
  // be resolved and advanced; the flat review-state write below cannot express
  // it, because it carries no findings.
  if (outcome === 'request-changes' && await recordRequestChangesDecision(slug, outcome, message, options, log, error)) {
    exit(1);
    return;
  }

  // An approve is the integration gate itself. It is recorded on the aggregate
  // in exactly one of the two paths below — for provider=none, immediately
  // (there is no external POST to fail); for provider-backed, only after the
  // POST succeeds — so a failed provider POST never leaves an approval behind
  // that `px integrate` would merge with no approval on the pull request. A
  // round that cannot legally reach `approved` (for example still in `fixing`
  // after a request-changes) fails loudly in that branch instead of printing
  // `[PASS]` after a swallowed transition.

  // For provider=none (standalone), skip provider posting and only update review-state
  if (!providerEnabled) {
    log(fmt.status('INFO', `Review provider is none — skipping provider posting, updating review-state only for ${slug}.`));
    // No external POST can fail here, so record the authoritative approve
    // immediately — before the flat review-state write — mirroring the
    // provider-backed post-success recording.
    if (outcome === 'approve' && await recordApprovalDecision(slug, outcome, message, options, log, error)) {
      exit(1);
      return;
    }
    if (await applyLocalReviewState(slug, outcome, message, worktree, options, log, error)) {
      exit(1);
      return;
    }
    return;
  }

  // For provider-backed reviews, post through the adapter. Review-state is the normal source.
  let reviewIdentity = (await resolveReviewIdentity(slug, worktree, {
    readReviewStateFn,
  })).identityUser;

  if (!reviewIdentity) {
    error(fmt.status('FAIL', `Cannot determine review identity for ${slug}. Start the review with px review ${slug} --start, or set FORGEJO_USER.`));
    exit(1);
    return;
  }
  reviewIdentity = resolveReviewUserFn(reviewIdentity);
  // An approve is the integration gate itself: check legality *before* the
  // external POST so an illegal approve (for example still in `fixing` after a
  // request-changes) fails loudly without ever posting, and record the
  // authoritative decision only after the POST succeeds — a failed POST must
  // never leave an approval on the aggregate that `px integrate` would merge
  // with no approval on the pull request. The recording itself happens below,
  // after the `!result.ok` guard.
  if (outcome === 'approve' && await checkProviderApproveLegality(slug, options, log, error)) {
    exit(1);
    return;
  }
  const result = await postWorkflowReview(slug, outcome, message, {
    worktree,
    reviewIdentity: reviewIdentity || undefined,
    readTokenFn: options.readTokenFn,
    postReviewFn: options.postReviewFn,
    getPrAuthorFn: options.getPrAuthorFn as any,
    writeReviewStateFn: options.writeReviewStateFn,
    createEventFn: options.createEventFn as any,
    readReviewStateFn: options.readReviewStateFn,
    buildMetadataFooterFn: options.buildMetadataFooterFn,
    log,
    error,
    missionStore: options.missionStore,
  });

  // Self-author skip: postWorkflowReview intentionally did not POST to the provider
  // (reviewer == PR author) and already persisted the verdict locally. This is
  // a legitimate same-agent-reviewer fallback, not a failure — do NOT exit(1).
  if (result.ok && result.skipped) {
    await repairStaleActiveTaskAfterReview(slug, {
      rootDir: worktree,
      resolveTaskFileFn,
      getTaskStatusFn,
      transitionTaskFn,
      log,
      error
    });
    log(fmt.status('WARN', `Review outcome "${outcome}" recorded locally for ${slug} (self-approval POST skipped). A different agent or a human must post the formal provider approval.`));
    return;
  }

  if (!result.ok) {
    exit(1);
    return;
  }

  // Provider POST succeeded: record the authoritative approve now that the
  // external side-effect is durable, so a failed POST (handled above) never
  // leaves an approval behind. A self-author skip already recorded inside
  // postWorkflowReview and returned early, so reaching here means a real POST
  // went out. Without a bound Mission authority there is nothing to record on
  // the aggregate (the flat review-state write below still mirrors the
  // disposition), matching the no-store WARN taken before the POST.
  if (outcome === 'approve' && options.missionStore && await recordApprovalDecision(slug, outcome, message, options, log, error)) {
    exit(1);
    return;
  }

  if (await finalizeProviderReviewState(slug, outcome, worktree, options, log, error)) {
    exit(1);
    return;
  }
}

// ============================================================================
// Command: closeMissionPr
// ============================================================================

export async function closeMissionPr(
  slug: string,
  options: {
    log?: (_msg: string) => void;
    error?: (_msg: string) => void;
    exit?: (_code: number) => never;
    readTokenFn?: typeof readToken;
    readReviewStateFn?: typeof readReviewState;
    resolveReviewUserFn?: typeof resolveReviewUser;
    resolveForgejoUserFn?: typeof resolveReviewUser;
    closePrFn?: typeof closePr;
    worktree?: string;
  } = {}
): Promise<void> {
  const log = options.log || fmt.log.plain;
  const error = options.error || fmt.log.plainError;
  const exit = options.exit || process.exit;
  const readTokenFn = options.readTokenFn || readToken;
  const readReviewStateFn = options.readReviewStateFn || readReviewState;
  const resolveReviewUserFn = options.resolveReviewUserFn || options.resolveForgejoUserFn || resolveReviewUser;
  const closePrFn = options.closePrFn || closePr;
  const worktree = options.worktree || resolveWorktree(slug) || process.cwd();
  const branch = missionBranchName(slug, worktree);

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

  log(fmt.status('INFO', `Closing PR for ${branch} as ${reviewIdentity}...`));
  const result = await closePrFn(branch, token, reviewIdentity!) as Record<string, unknown>;

  if (!result.ok) {
    exit(1);
  }
}

// ============================================================================
// Event CLI Handlers
// ============================================================================

/** One `<key>: [ids]` frontmatter list and the disposition kind it records. */
