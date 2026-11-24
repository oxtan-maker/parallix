import type { IntegrationApproval } from '../../application/ports/integration-records.js';
import { randomUUID } from 'node:crypto';
import { dismissStandingApprovals, readToken } from '../forgejo/forgejo.js';
import { PARALLIX_FORGEJO_USER } from './setup-review-repository.js';
import type { MissionStore } from '../../application/domain-ports.js';
import type { LiveMissionExecutionContext } from '../../application/ports/mission-execution-context.js';
import { currentIntegrationRepair, integrationGateWithdrawals } from '../../domain/integration-repair-policy.js';
import { missionId } from '../../domain/mission.js';
import { createEvent, VALID_EVENT_TYPES } from './review-events.js';
import { claimReviewPublication, governReviewPublication, markReviewPublication, parseReviewPublication, reviewPublicationKey, reviewPublicationReference } from './review-publication.js';
import { postWorkflowComment } from './review-workflow-posting.js';
import type { getComments, postComment } from './review-adapter.js';

export interface ApprovalInvalidation {
  /** False when at least one standing approval could not be dismissed. */
  ok: boolean;
  /** Logins whose approval Parallix dismissed. */
  dismissed: string[];
  errors: string[];
}

function settledApprovalClaim(claim: Awaited<ReturnType<typeof claimReviewPublication>>): ApprovalInvalidation | null {
  if (claim === 'completed') { return { ok: true, dismissed: [], errors: [] }; }
  if (claim === 'busy') {
    return { ok: false, dismissed: [], errors: ['Approval withdrawal publication is already in progress.'] };
  }
  if (claim === 'missing') {
    return { ok: false, dismissed: [], errors: ['Approval withdrawal publication obligation disappeared'] };
  }
  return null;
}

type InvalidationOptions = Parameters<typeof invalidateApprovedPrReview>[0];

async function recordApprovalWithdrawal(opts: InvalidationOptions) {
  if (!opts.missionStore || !opts.executionContext) {
    return { ok: false as const, error: 'Mission store and execution context are required for durable approval withdrawal' };
  }
  const loaded = await opts.missionStore.load(missionId(opts.slug));
  if (loaded.kind !== 'found' || !loaded.mission.review) {
    return { ok: false as const, error: 'Mission review unavailable for durable approval withdrawal' };
  }
  const round = integrationGateWithdrawals(loaded.mission).at(-1)?.number
    ?? loaded.mission.review.rounds.at(-1)?.number;
  const revision = opts.approvedRevision;
  if (!round || !revision) {
    return { ok: false as const, error: 'Approval withdrawal requires its review round and exact approved revision' };
  }
  const publication = {
    slug: opts.slug, round, actor: PARALLIX_FORGEJO_USER, revision,
    eventType: VALID_EVENT_TYPES.BLOCKED_PUBLICATION, target: 'comment' as const,
  };
  const result = await createEvent(opts.slug, VALID_EVENT_TYPES.BLOCKED_PUBLICATION, {
    content: opts.summary, round, phase: 'approved', actor: PARALLIX_FORGEJO_USER,
    followUpReference: reviewPublicationReference(publication),
  }, { executionContext: opts.executionContext, missionStore: opts.missionStore, skipGit: true, log: () => {}, error: () => {} });
  return result.ok
    ? { ok: true as const, publication, revision }
    : { ok: false as const, error: 'Could not record approval withdrawal before provider mutation' };
}

async function prepareApprovalWithdrawal(opts: InvalidationOptions, readTokenFn: typeof readToken): Promise<
  | { ok: true; token: string; recorded: Extract<Awaited<ReturnType<typeof recordApprovalWithdrawal>>, { ok: true }> }
  | { ok: false; result: ApprovalInvalidation }
> {
  // Production callers carry Mission authority. Install the obligation before
  // any provider prerequisite so a missing token is a visible, recoverable gap.
  // Keep the legacy no-store diagnostic ordering for isolated callers.
  const preRecorded = opts.missionStore && opts.executionContext
    ? await recordApprovalWithdrawal(opts)
    : null;
  if (preRecorded && !preRecorded.ok) {
    return { ok: false, result: { ok: false, dismissed: [], errors: [preRecorded.error] } };
  }
  const token = readTokenFn(PARALLIX_FORGEJO_USER, opts.executionContext?.missionWorktree, opts.configuration);
  if (!token) {
    let diagnostic = `no Forgejo token for ${PARALLIX_FORGEJO_USER}; run px setup-review to create the ${PARALLIX_FORGEJO_USER} user so it can dismiss the standing approval on ${opts.branch}`;
    if (preRecorded?.ok) {
      const claimToken = randomUUID();
      const claim = await claimReviewPublication(opts.missionStore!, opts.slug, preRecorded.publication, claimToken);
      if (claim === 'acquired') {
        const recorded = await markReviewPublication(opts.missionStore!, opts.slug,
          reviewPublicationKey(preRecorded.publication), 'failed', diagnostic, claimToken);
        if (!recorded) { diagnostic = `${diagnostic}; publication claim changed before failure was recorded`; }
      } else if (claim !== 'completed') {
        diagnostic = `${diagnostic}; approval withdrawal publication claim is ${claim}`;
      }
    }
    return { ok: false, result: { ok: false, dismissed: [], errors: [diagnostic] } };
  }
  const recorded = preRecorded ?? await recordApprovalWithdrawal(opts);
  return recorded.ok
    ? { ok: true, token, recorded }
    : { ok: false, result: { ok: false, dismissed: [], errors: [recorded.error] } };
}

/**
 * Dismiss the standing approvals on the mission pull request as the dedicated
 * `parallix` Forgejo login, through the review dismissal API.
 *
 * Parallix never posts a review as another login and never writes a finding
 * nobody raised: the approval is dismissed with the integration failure as
 * the stated reason. A missing `parallix` token is an error, not a silent skip
 * — an undismissed approval must fail closed so the changed revision cannot
 * land under it.
 */
export async function invalidateApprovedPrReview(opts: {
  slug: string;
  branch: string;
  approval: IntegrationApproval | null | undefined;
  summary: string;
  approvedRevision?: string;
  executionContext?: LiveMissionExecutionContext;
  missionStore?: MissionStore;
  configuration?: import('../../application/ports/configuration.js').ParallixConfiguration;
  readTokenFn?: typeof readToken;
  dismissFn?: typeof dismissStandingApprovals;
  getCommentsFn?: typeof getComments;
  postCommentFn?: typeof postComment;
}): Promise<ApprovalInvalidation> {
  const { readTokenFn = readToken, dismissFn = dismissStandingApprovals } = opts;
  if (opts.approval?.ok !== true || opts.approval.providerDisabled === true) { return { ok: true, dismissed: [], errors: [] }; }
  const rootDir = opts.executionContext?.missionWorktree;
  const prepared = await prepareApprovalWithdrawal(opts, readTokenFn);
  if (!prepared.ok) { return prepared.result; }
  const { token, recorded } = prepared;
  const missionStore = opts.missionStore!;
  const executionContext = opts.executionContext!;
  const { revision } = recorded;
  const binding = await governReviewPublication(missionStore, opts.slug, recorded.publication);
  if (!binding.ok) { return { ok: false, dismissed: [], errors: [binding.error] }; }
  const publication = binding.identity;
  const claimToken = randomUUID();
  const claim = await claimReviewPublication(missionStore, opts.slug, publication, claimToken);
  const settled = settledApprovalClaim(claim);
  if (settled) { return settled; }
  const result = dismissFn(opts.branch, token, opts.summary, {
    forgejoUser: PARALLIX_FORGEJO_USER, expectedRevision: revision, rootDir,
    ...(opts.configuration ? { configuration: opts.configuration } : {}),
  });
  if (!result.ok) {
    await markReviewPublication(missionStore, opts.slug, reviewPublicationKey(publication), 'failed', result.errors.join('; '), claimToken);
    return { ok: false, dismissed: result.dismissed, errors: result.errors };
  }
  const posted = await postWorkflowComment(opts.slug, opts.summary, {
    executionContext,
    reviewIdentity: PARALLIX_FORGEJO_USER,
    readTokenFn: () => token,
    getCommentsFn: opts.getCommentsFn,
    postCommentFn: opts.postCommentFn,
    missionStore,
    configuration: opts.configuration,
    publication,
    publicationClaim: claimToken,
    log: () => {},
    error: () => {},
  });
  return posted.ok
    ? { ok: true, dismissed: result.dismissed, errors: [] }
    : { ok: false, dismissed: result.dismissed, errors: [posted.error ?? 'Approval withdrawal publication failed'] };
}

/** Recover the provider withdrawal implied by an already-committed integration-repair revocation. */
export async function recoverApprovalWithdrawal(opts: {
  slug: string;
  branch: string;
  executionContext: LiveMissionExecutionContext;
  missionStore: MissionStore;
  configuration?: import('../../application/ports/configuration.js').ParallixConfiguration;
  readTokenFn?: typeof readToken;
  dismissFn?: typeof dismissStandingApprovals;
  getCommentsFn?: typeof getComments;
  postCommentFn?: typeof postComment;
}): Promise<ApprovalInvalidation> {
  const loaded = await opts.missionStore.load(missionId(opts.slug));
  if (loaded.kind !== 'found' || !loaded.mission.review) { return { ok: true, dismissed: [], errors: [] }; }
  const repair = currentIntegrationRepair(loaded.mission);
  if (repair?.kind !== 'review-required') { return { ok: true, dismissed: [], errors: [] }; }
  const revision = repair.withdrawn.decision.revision ? String(repair.withdrawn.decision.revision) : null;
  if (!revision) { return { ok: true, dismissed: [], errors: [] }; }
  const key = reviewPublicationKey({
    slug: opts.slug, round: repair.withdrawn.number, actor: PARALLIX_FORGEJO_USER,
    revision, eventType: VALID_EVENT_TYPES.BLOCKED_PUBLICATION, target: 'comment',
  });
  const completed = loaded.mission.review.reviewEvents.some(event => {
    const publication = parseReviewPublication(event.followUpReference);
    return publication?.key === key && publication.state === 'completed';
  });
  if (completed) { return { ok: true, dismissed: [], errors: [] }; }
  return invalidateApprovedPrReview({
    ...opts,
    approval: { ok: true },
    approvedRevision: revision,
    summary: 'Integration repair changed the approved mission patch; fresh review is required.',
  });
}

