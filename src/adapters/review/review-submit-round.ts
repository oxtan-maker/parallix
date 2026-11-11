import { headRevision } from './review-artifact-files.js';
import type { ParallixConfiguration } from "../../application/ports/configuration.js";
/**
 * Reviewer-side round submission: record the decision, apply local and
 * provider review state, and close the mission PR.
 */

import * as fmt from '../../application/presentation/cli-format.js';
import { resolveWorktree, missionBranchName } from '../filesystem/mission-utils.js';
import { resolveTaskFile, getTaskStatus, transitionTask } from '../backlog/backlog.js';
import { readToken, postReview, closePr, resolveReviewUser, isProviderEnabled } from './review-adapter.js';
import { type ReviewStateInstanceReader, readReviewState, writeReviewState, resolveReviewIdentity } from './review-state.js';
import type { MissionStore } from '../../application/domain-ports.js';
import type { MissionLifecycleService } from '../../application/mission-lifecycle-service.js';
import { mirrorReviewOutcome } from '../../application/review-task-mirroring.js';
import type { ReviewTaskMirror } from '../../application/ports/review-task-mirror.js';
import { reviewFindingsFromMessage, recordRequestedChanges, recordApproval, approvalLegalDiagnostic } from './review-round.js';
import { createEvent } from './review-events.js';
import { reviewerResultAttribution } from './reviewer-result-attribution.js';
import { postWorkflowReview } from './review-artifacts.js';
import { runPhaseGates } from '../config/repository-gates.js';
import { repairStaleActiveTaskAfterReview } from './review-intervention-commands.js';

type SubmitReviewOptions = {
  configuration?: ParallixConfiguration;
  log?: (_msg: string) => void;
  error?: (_msg: string) => void;
  exit?: (_code: number) => void;
  transitionTaskFn?: typeof transitionTask;
  readReviewStateFn?: ReviewStateInstanceReader;
  writeReviewStateFn?: typeof writeReviewState;
  isReviewProviderEnabledFn?: typeof isProviderEnabled;
  isForgejoReviewEnabledFn?: typeof isProviderEnabled;
  resolveReviewUserFn?: typeof resolveReviewUser;
  resolveForgejoUserFn?: typeof resolveReviewUser;
  resolveTaskFileFn?: typeof resolveTaskFile;
  getTaskStatusFn?: typeof getTaskStatus;
  worktree?: string;
  revision?: string;
  readTokenFn?: typeof readToken;
  postReviewFn?: typeof postReview;
  getPrAuthorFn?: NonNullable<Parameters<typeof postWorkflowReview>[3]>['getPrAuthorFn'];
  createEventFn?: typeof createEvent;
  buildMetadataFooterFn?: NonNullable<Parameters<typeof postWorkflowReview>[3]>['buildMetadataFooterFn'];
  missionStore?: MissionStore | null;
  lifecycleService?: Pick<MissionLifecycleService, 'transition'> | null;
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
    error(fmt.status('FAIL', `No Mission authority bound for ${slug}; the review decision cannot be recorded.`));
    return true;
  }
  const recordRequestedChangesFn = options.recordRequestedChangesFn || recordRequestedChanges;
  const decision = await recordRequestedChangesFn(slug, {
    findings: reviewFindingsFromMessage(message || `Changes requested for ${slug}`),
    comment: message || null,
    decidedAt: new Date().toISOString(),
    revision: options.revision ?? headRevision(options.worktree || resolveWorktree(slug) || process.cwd()),
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

type ApprovalDecisionResult = { stop: boolean; awaitingApprovals: number };

/** Record the authoritative approve on the Review aggregate. */
async function recordApprovalDecision(slug: string, outcome: string, message: string, options: SubmitReviewOptions, log: (_msg: string) => void, error: (_msg: string) => void, providerBacked = false): Promise<ApprovalDecisionResult> {
  if (!options.missionStore) {
    error(fmt.status('FAIL', `No Mission authority bound for ${slug}; the review decision cannot be recorded.`));
    return { stop: true, awaitingApprovals: 0 };
  }
  const recordApprovalFn = options.recordApprovalFn || recordApproval;
  const worktree = options.worktree || resolveWorktree(slug) || process.cwd();
  // The reviewer's own verdict counts toward the round's required approvals; it is attributed, never operator-directed.
  const identity = (await resolveReviewIdentity(slug, worktree, { readReviewStateFn: options.readReviewStateFn })).identityUser;
  const decision = await recordApprovalFn(slug, {
    comment: message || null,
    decidedAt: new Date().toISOString(),
    revision: options.revision ?? headRevision(worktree),
    source: providerBacked ? { kind: 'provider', provider: 'forgejo' } : { kind: 'local' },
    result: reviewerResultAttribution(identity || 'reviewer', null),
  }, { missionStore: options.missionStore, lifecycleService: options.lifecycleService });
  if (decision.outcome === 'failed') {
    error(fmt.status('FAIL', `Review outcome "${outcome}" could not be recorded for ${slug}: ${decision.diagnostic}`));
    return { stop: true, awaitingApprovals: 0 };
  }
  if (decision.outcome === 'unchanged') {
    log(fmt.status('INFO', `Review outcome "${outcome}" for ${slug} already recorded (${decision.reason}).`));
  }
  return { stop: false, awaitingApprovals: decision.outcome === 'held' ? decision.awaitingApprovals : 0 };
}

/** Mirror an already-recorded verdict through the existing task projection owner. */
async function mirrorSubmittedReview(slug: string, outcome: string, providerBacked: boolean, worktree: string, options: SubmitReviewOptions, log: (_msg: string) => void): Promise<void> {
  const transitionTaskFn = options.transitionTaskFn || transitionTask;
  const task = providerBacked ? (options.resolveTaskFileFn || resolveTaskFile)(slug, worktree) : null;
  const status = task?.ok ? (options.getTaskStatusFn || getTaskStatus)(task.taskFile!) : null;
  const mirror: ReviewTaskMirror = {
    transition: lane => Promise.resolve(transitionTaskFn(slug, lane, { rootDir: worktree, log })).catch(() => {
      log(fmt.status('WARN', `Could not transition backlog task ${slug} to ${lane}.`));
      return false;
    }),
  };
  await mirrorReviewOutcome(outcome, providerBacked, status, mirror);
}

/** Check that an approve can legally reach `approved` before the external POST. Returns true when the outcome must stop. */
async function checkProviderApproveLegality(slug: string, options: SubmitReviewOptions, error: (_msg: string) => void): Promise<boolean> {
  if (!options.missionStore) {
    error(fmt.status('FAIL', `No Mission authority bound for ${slug}; the review decision cannot be recorded.`));
    return true;
  }
  const legalDiagnostic = await approvalLegalDiagnostic(slug, { missionStore: options.missionStore });
  if (legalDiagnostic) {
    error(fmt.status('FAIL', `Review outcome "approve" could not be recorded for ${slug}: ${legalDiagnostic}`));
    return true;
  }
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
  const isReviewProviderEnabledFn = options.isReviewProviderEnabledFn || options.isForgejoReviewEnabledFn || isProviderEnabled;
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
    await submitLocalReview(slug, outcome, message, worktree, options, log, error, exit);
    return;
  }

  await submitProviderReview(slug, outcome, message, worktree, options, log, error, exit);
}

async function submitLocalReview(slug: string, outcome: string, message: string, worktree: string, options: SubmitReviewOptions, log: (_msg: string) => void, error: (_msg: string) => void, exit: (_code: number) => void): Promise<void> {
  log(fmt.status('INFO', `Review provider is none — skipping provider posting, updating review-state only for ${slug}.`));
  // No external POST can fail here, so record the authoritative approve
  // immediately — before the flat review-state write — mirroring the
  // provider-backed post-success recording.
  if (outcome === 'approve') {
    const decision = await recordApprovalDecision(slug, outcome, message, options, log, error);
    if (decision.stop) { exit(1); return; }
    if (decision.awaitingApprovals > 0) {
      log(fmt.status('INFO', `Approval recorded for ${slug}; ${decision.awaitingApprovals} additional reviewer approval${decision.awaitingApprovals === 1 ? '' : 's'} required before integration.`));
      return;
    }
  }
  await mirrorSubmittedReview(slug, outcome, false, worktree, options, log);
  log(fmt.status('PASS', `Review outcome "${outcome}" recorded locally for ${slug}.`));
}

function providerReviewBindings(options: SubmitReviewOptions) {
  const transitionTaskFn = options.transitionTaskFn || transitionTask;
  const readReviewStateFn = options.readReviewStateFn || readReviewState;
  const resolveReviewUserFn = options.resolveReviewUserFn || options.resolveForgejoUserFn || resolveReviewUser;
  const resolveTaskFileFn = options.resolveTaskFileFn || resolveTaskFile;
  const getTaskStatusFn = options.getTaskStatusFn || getTaskStatus;
  return { transitionTaskFn, readReviewStateFn, resolveReviewUserFn, resolveTaskFileFn, getTaskStatusFn };
}

async function submitProviderReview(slug: string, outcome: string, message: string, worktree: string, options: SubmitReviewOptions, log: (_msg: string) => void, error: (_msg: string) => void, exit: (_code: number) => void): Promise<void> {
  const { readReviewStateFn, resolveReviewUserFn } = providerReviewBindings(options);
  // For provider-backed reviews, post through the adapter. Review-state is the normal source.
  let reviewIdentity = (await resolveReviewIdentity(slug, worktree, {
    readReviewStateFn,
  })).identityUser;

  if (!reviewIdentity) {
    error(fmt.status('FAIL', `Cannot determine review identity for ${slug}. Start the review with px review ${slug}, or set FORGEJO_USER.`));
    exit(1);
    return;
  }
  reviewIdentity = resolveReviewUserFn(reviewIdentity, options.configuration);
  // An approve is the integration gate itself: check legality *before* the
  // external POST so an illegal approve (for example still in `fixing` after a
  // request-changes) fails loudly without ever posting, and record the
  // authoritative decision only after the POST succeeds — a failed POST must
  // never leave an approval on the aggregate that `px integrate` would merge
  // with no approval on the pull request. The recording itself happens below,
  // after the `!result.ok` guard.
  if (outcome === 'approve' && await checkProviderApproveLegality(slug, options, error)) {
    exit(1);
    return;
  }
  const result = await postWorkflowReview(slug, outcome, message, {
    worktree,
    revision: options.revision ?? headRevision(worktree),
    reviewIdentity: reviewIdentity || undefined,
    readTokenFn: options.readTokenFn,
    postReviewFn: options.postReviewFn,
    getPrAuthorFn: options.getPrAuthorFn,
    writeReviewStateFn: options.writeReviewStateFn,
    createEventFn: options.createEventFn,
    readReviewStateFn: options.readReviewStateFn,
    buildMetadataFooterFn: options.buildMetadataFooterFn,
    log,
    error,
    missionStore: options.missionStore,
    lifecycleService: options.lifecycleService,
    configuration: options.configuration,
  });

  if (result.skipped && result.reason === 'self-author') {
    if (!result.ok) {
      error(fmt.status('WARN', result.error || 'Independent review is required before approval or integration.'));
      exit(1);
      return;
    }
    const { resolveTaskFileFn, getTaskStatusFn, transitionTaskFn } = providerReviewBindings(options);
    await repairStaleActiveTaskAfterReview(slug, {
      rootDir: worktree, resolveTaskFileFn, getTaskStatusFn, transitionTaskFn, log, error,
    });
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
  if (outcome === 'approve') {
    const decision = await recordApprovalDecision(slug, outcome, message, options, log, error, true);
    if (decision.stop) { exit(1); return; }
    if (decision.awaitingApprovals > 0) {
      log(fmt.status('INFO', `Approval recorded for ${slug}; ${decision.awaitingApprovals} additional reviewer approval${decision.awaitingApprovals === 1 ? '' : 's'} required before integration.`));
      return;
    }
  }

  await mirrorSubmittedReview(slug, outcome, true, worktree, options, log);
}

// ============================================================================
// Command: closeMissionPr
// ============================================================================

export async function closeMissionPr(
  slug: string,
  options: {
    log?: (_msg: string) => void;
    error?: (_msg: string) => void;
    exit?: (_code: number) => void;
    readTokenFn?: typeof readToken;
    readReviewStateFn?: ReviewStateInstanceReader;
    resolveReviewUserFn?: typeof resolveReviewUser;
    resolveForgejoUserFn?: typeof resolveReviewUser;
    closePrFn?: typeof closePr;
    worktree?: string;
    configuration?: ParallixConfiguration;
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
    error(fmt.status('FAIL', `Cannot determine review identity for ${slug}. Start the review with px review ${slug}, or set FORGEJO_USER.`));
    exit(1);
    return;
  }
  reviewIdentity = resolveReviewUserFn(reviewIdentity, options.configuration);

  const token = readTokenFn(reviewIdentity!, { rootDir: worktree, configuration: options.configuration });
  if (!token) {
    error(fmt.status('FAIL', `No Forgejo token found for user "${reviewIdentity}".`));
    exit(1);
    return;
  }

  log(fmt.status('INFO', `Closing PR for ${branch} as ${reviewIdentity}...`));
  const result = await closePrFn(branch, token, reviewIdentity!, {
    rootDir: worktree,
    configuration: options.configuration,
  }) as Record<string, unknown>;

  if (!result.ok) {
    exit(1);
  }
}

// ============================================================================
// Event CLI Handlers
// ============================================================================

/** One `<key>: [ids]` frontmatter list and the disposition kind it records. */
