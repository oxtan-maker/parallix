import { failureReason, type FailureReason } from '../../domain/failure-reason.js';
import { authorizeMissionWrite } from '../../application/ports/mission-write-authorization.js';
import type { postComment, postReview, getPrAuthor, getComments } from './review-adapter.js';
/**
 * Reviewer artifact consumption: resolve the reviewer artifact set, persist
 * reviewer events, and post the reviewer outcome to the provider.
 */

import * as fmt from '../../application/presentation/cli-format.js';
import { readReviewState, writeReviewState } from './review-state.js';
import type { MissionStore } from '../../application/domain-ports.js';
import { type ReviewFinding } from '../../domain/review.js';
import { isEnabled } from './review-adapter.js';
import { createEvent, consumeHumanNotes, CreateEventParams, CreateEventOptions, CreateEventResult } from './review-events.js';
import { parseReviewFindings, recordRequestedChanges, recordApproval, approvalLegalDiagnostic, type ReviewRoundResult } from './review-round.js';
import { incompleteReviewerArtifacts, invalidReviewerProcessResult } from './reviewer-artifact-admission.js';
import { reviewerResultAttribution, type ReviewerProcessResult } from './reviewer-result-attribution.js';
import type { MissionLifecycleService } from '../../application/mission-lifecycle-service.js';
import { reviewArtifactPath, staleReviewWrite, renderFindings, resolveArtifactRead, resolveArtifactDir, readArtifactFile, deleteArtifactFile, normalizeReviewVerdict, headRevision, type ReviewStateReader } from './review-artifact-files.js';
import { postWorkflowComment, postWorkflowReview } from './review-workflow-posting.js';
import type { ParallixConfiguration } from '../../application/ports/configuration.js';
import type { LiveMissionExecutionContext } from '../../application/ports/mission-execution-context.js';
import type { ReviewPublicationState } from './review-publication.js';
import { persistReviewerPublicationEvents, publicationContextError, reviewerPublicationEventDrafts } from './review-artifact-publication.js';
import type { ReviewEventDraft } from './review-publication.js';

type ReviewerArtifactOptions = {
  executionContext: LiveMissionExecutionContext;
  log?: (_msg: string) => void;
  error?: (_msg: string) => void;
  readArtifactFn?: typeof readArtifactFile;
  deleteArtifactFn?: typeof deleteArtifactFile;
  tmpDir?: string | null;
  revision?: string;
  providerEnabled?: boolean | null;
  forgejoEnabled?: boolean | null;
  readTokenFn?: (_user: string, _opts?: Record<string, unknown>) => string | null;
  getCommentsFn?: typeof getComments;
  postCommentFn?: typeof postComment;
  postReviewFn?: typeof postReview;
  getPrAuthorFn?: typeof getPrAuthor;
  buildMetadataFooterFn?: (_s: string, _r?: string, _store?: MissionStore | null) => string | Promise<string>;
  createEventFn?: (_s: string, _t: string, _p: CreateEventParams, _o: CreateEventOptions) => CreateEventResult | Promise<CreateEventResult>;
  readReviewStateFn?: ReviewStateReader;
  writeReviewStateFn?: typeof writeReviewState;
  currentState?: { metadata?: Record<string, unknown> } | null;
  missionStore?: MissionStore | null;
  lifecycleService?: Pick<MissionLifecycleService, 'transition'> | null;
  recordRequestedChangesFn?: typeof recordRequestedChanges;
  recordApprovalFn?: typeof recordApproval;
  verbose?: boolean;
  /**
   * Typed inbound transport (`px verdict`). When present no artifact file is
   * read or deleted, and the findings reach the domain as `ReviewFinding`
   * values. Markdown is rendered here, at the export boundary, for the review
   * event and the provider comment only — it is never parsed back.
   */
  output?: { findings: readonly ReviewFinding[]; comment: string | null; verdict: string };
  /** Mission version the caller read; threaded to the recorders so a stale decision fails closed. */
  expectedVersion?: number;
  /** Present only for agent-produced artifacts; operator verdicts have no child process. */
  processResult?: ReviewerProcessResult | null;
  configuration?: ParallixConfiguration;
};

export type RepoEventFn = (_s: string, _t: string, _p: CreateEventParams, _o: CreateEventOptions) => CreateEventResult | Promise<CreateEventResult>;

type ResolvedArtifactSet = {
  findings: string | null;
  outcomeMessage: string | null;
  verdictRaw: string | null;
  findingsPath: string;
  outcomePath: string;
  verdictPath: string;
};

export function resolveProviderEnabled(options: { providerEnabled?: boolean | null; forgejoEnabled?: boolean | null }, worktree: string): boolean {
  return options.providerEnabled !== null && options.providerEnabled !== undefined
    ? options.providerEnabled
    : (options.forgejoEnabled !== null && options.forgejoEnabled !== undefined ? options.forgejoEnabled : isEnabled(worktree));
}

/** The same artifact set, supplied by `px verdict` in memory instead of read from files. */
function typedReviewerArtifactSet(slug: string, tmpDir: string, output: { findings: readonly ReviewFinding[]; comment: string | null; verdict: string }): ResolvedArtifactSet {
  return {
    findings: renderFindings(output.findings),
    outcomeMessage: output.comment ?? `Outcome: ${output.verdict}\nVerdict: ${output.verdict}`,
    verdictRaw: output.verdict,
    findingsPath: reviewArtifactPath(slug, 'review-findings.md', tmpDir),
    outcomePath: reviewArtifactPath(slug, 'review-outcome.md', tmpDir),
    verdictPath: reviewArtifactPath(slug, 'review-verdict.txt', tmpDir),
  };
}

function resolveReviewerArtifactSet(slug: string, options: { tmpDir: string; readArtifactFn: typeof readArtifactFile }): ResolvedArtifactSet {
  const findingsResolved = resolveArtifactRead(slug, 'review-findings.md', { tmpDir: options.tmpDir, readArtifactFn: options.readArtifactFn });
  const outcomeResolved = resolveArtifactRead(slug, 'review-outcome.md', { tmpDir: options.tmpDir, readArtifactFn: options.readArtifactFn });
  const verdictResolved = resolveArtifactRead(slug, 'review-verdict.txt', { tmpDir: options.tmpDir, readArtifactFn: options.readArtifactFn });
  return {
    findings: findingsResolved.value,
    outcomeMessage: outcomeResolved.value,
    verdictRaw: verdictResolved.value,
    findingsPath: findingsResolved.path,
    outcomePath: outcomeResolved.path,
    verdictPath: verdictResolved.path,
  };
}

/** The same implementer artifact set, supplied by `px resolve` in memory. */

/**
 * Post the findings as a PR comment, then the verdict as the formal review.
 * Human PR notes are consumed first when the token and comment seams exist.
 * Returns a diagnostic string on the first failed post, else null.
 */
async function postReviewerToProvider(
  slug: string,
  reviewer: string,
  reviewVerdict: string,
  reviewFindings: string,
  reviewOutcome: string,
  context: {
    executionContext: LiveMissionExecutionContext;
    log: (_msg: string) => void;
    error: (_msg: string) => void;
    readReviewStateFn: ReviewStateReader;
    readTokenFn?: (_user: string, _opts?: Record<string, unknown>) => string | null;
    getCommentsFn?: typeof getComments;
    postCommentFn?: typeof postComment;
    postReviewFn?: typeof postReview;
    getPrAuthorFn?: typeof getPrAuthor;
    buildMetadataFooterFn?: (_s: string, _r?: string, _store?: MissionStore | null) => string | Promise<string>;
    createEventFn?: RepoEventFn;
    writeReviewStateFn?: typeof writeReviewState;
    currentState?: { metadata?: Record<string, unknown> } | null;
    missionStore?: MissionStore | null;
    lifecycleService?: Pick<MissionLifecycleService, 'transition'> | null;
    revision?: string;
    recordApprovalFn?: typeof recordApproval;
    configuration?: ParallixConfiguration;
    round: number;
  },
): Promise<string | null> {
  const { log, error, readReviewStateFn } = context;
  if (context.readTokenFn && context.getCommentsFn) {
    await consumeHumanNotes(slug, reviewer, {
      getCommentsFn: context.getCommentsFn,
      createEventFn: context.createEventFn || createEvent,
      readTokenFn: context.readTokenFn,
      reviewIdentity: reviewer,
      executionContext: context.executionContext,
      writeReviewStateFn: context.writeReviewStateFn,
      readReviewStateFn,
      currentState: context.currentState,
      configuration: context.configuration,
      log: log,
      error
    });
  }

  const commentResult = await postWorkflowComment(slug, reviewFindings, {
    executionContext: context.executionContext,
    reviewIdentity: reviewer,
    readTokenFn: context.readTokenFn,
    postCommentFn: context.postCommentFn,
    buildMetadataFooterFn: context.buildMetadataFooterFn,
    readReviewStateFn,
    missionStore: context.missionStore,
    getCommentsFn: context.getCommentsFn,
    publication: context.revision ? {
      slug, round: context.round, actor: reviewer, revision: context.revision,
      eventType: 'reviewer_findings', target: 'comment',
    } : undefined,
    configuration: context.configuration,
    log: log,
    error
  });
  if (!commentResult.ok) {
    return `Reviewer comment post failed: ${(commentResult as { error?: string }).error}`;
  }

  const reviewResult = await postWorkflowReview(slug, reviewVerdict, reviewOutcome, {
    executionContext: context.executionContext,
    reviewIdentity: reviewer,
    readTokenFn: context.readTokenFn,
    postReviewFn: context.postReviewFn,
    postCommentFn: context.postCommentFn,
    getPrAuthorFn: context.getPrAuthorFn,
    getCommentsFn: context.getCommentsFn,
    buildMetadataFooterFn: context.buildMetadataFooterFn,
    createEventFn: context.createEventFn,
    readReviewStateFn,
    log: log,
    error,
    missionStore: context.missionStore,
    // Forward the (composition-bound) write function so the self-author
    // local verdict path persists through the same approval boundary as
    // every other approval-producing site (TASK-2378 CP-2 audit site 3).
    writeReviewStateFn: context.writeReviewStateFn,
    lifecycleService: context.lifecycleService ?? null,
    recordApprovalFn: context.recordApprovalFn,
    revision: context.revision,
    configuration: context.configuration,
    publication: context.revision ? {
      slug, round: context.round, actor: reviewer, revision: context.revision,
      eventType: 'reviewer_outcome', target: 'review',
    } : undefined,
  });
  if (!reviewResult.ok) {
    return `Reviewer review post failed: ${(reviewResult as { error?: string }).error}`;
  }
  return null;
}

function prepareReviewerArtifacts(slug: string, options: ReviewerArtifactOptions) {
  const log = options.log || fmt.log.plain;
  const error = options.error || fmt.log.plainError;
  const readArtifactFn = options.readArtifactFn || readArtifactFile;
  const deleteArtifactFn = options.deleteArtifactFn || deleteArtifactFile;
  const worktree = options.executionContext.missionWorktree;
  const tmpDir = options.tmpDir || resolveArtifactDir(worktree);
  const providerEnabled = resolveProviderEnabled(options, worktree);

  const artifacts = options.output
    ? typedReviewerArtifactSet(slug, tmpDir, options.output)
    : resolveReviewerArtifactSet(slug, { tmpDir, readArtifactFn });
  const verdict = reviewerVerdictFrom(artifacts.verdictRaw, artifacts.outcomeMessage);

  return { log, error, deleteArtifactFn, worktree, providerEnabled, artifacts, verdict };
}

type AdmittedReviewerArtifacts =
  | { ok: false; failure: { consumed: boolean; failureReason?: FailureReason; ok?: boolean; diagnostic?: string | null; reviewState?: string | null } }
  | { ok: true; reviewFindings: string; reviewOutcome: string; reviewVerdict: string; typedFindings: readonly ReviewFinding[]; options: ReviewerArtifactOptions };

/** Completeness, parsing, staleness and revision-pin checks that precede any decision. */
async function admitReviewerArtifacts(
  ctx: { slug: string; artifacts: ReturnType<typeof prepareReviewerArtifacts>['artifacts']; verdict: string | null; providerEnabled: unknown; worktree: string; error: (message: string) => void },
  options: ReviewerArtifactOptions,
): Promise<AdmittedReviewerArtifacts> {
  const { slug, artifacts, verdict, providerEnabled, worktree, error } = ctx;
  const incomplete = incompleteReviewerArtifacts({
    slug, findings: artifacts.findings, outcomeMessage: artifacts.outcomeMessage, verdict,
    findingsPath: artifacts.findingsPath, outcomePath: artifacts.outcomePath, verdictPath: artifacts.verdictPath,
    providerEnabled: Boolean(providerEnabled), error,
  });
  if (incomplete) { return { ok: false, failure: incomplete }; }
  const invalidProcess = invalidReviewerProcessResult('processResult' in options, options.processResult);
  if (invalidProcess) { return { ok: false, failure: invalidProcess }; }
  // Past the completeness guard all three artifacts are present.
  const reviewFindings: string = artifacts.findings!;
  const reviewOutcome: string = artifacts.outcomeMessage!;
  const reviewVerdict: string = verdict!;
  // `px verdict` already names each finding; only a file transport needs parsing.
  const parsed = parseReviewerArtifactFindings(reviewFindings, reviewVerdict, options);
  if (!parsed.ok) { return { ok: false, failure: parsed.failure }; }

  const stale = await staleReviewWrite(slug, options.expectedVersion, options.missionStore);
  if (stale) {
    error(fmt.status('FAIL', stale));
    return { ok: false, failure: { consumed: true, ok: false, diagnostic: stale } };
  }

  const pinned = pinReviewerRevision(options, worktree);
  if (!pinned.ok) { return { ok: false, failure: { consumed: true, ok: false, diagnostic: pinned.diagnostic } }; }
  const publicationError = publicationContextError(Boolean(providerEnabled), {
    store: pinned.options.missionStore, revision: pinned.options.revision, round: (await reviewerArtifactRound(slug, worktree, pinned.options)).round,
  });
  if (publicationError) { return { ok: false, failure: { consumed: true, ok: false, diagnostic: publicationError } }; }
  return { ok: true, reviewFindings, reviewOutcome, reviewVerdict, typedFindings: parsed.findings, options: { ...pinned.options, providerEnabled: Boolean(providerEnabled) } };
}

type ReviewerArtifactFailure = { consumed: true; ok: false; failureReason?: FailureReason; diagnostic: string };

async function completeReviewerPublication(flow: {
  slug: string; providerEnabled: boolean; approval: boolean; durable: boolean;
  persist: (_state: ReviewPublicationState) => Promise<ReviewerArtifactFailure | null>;
  mirror: () => Promise<string | null>;
  legal: () => Promise<string | null>;
  decide: () => Promise<ReviewerArtifactFailure | null>;
}): Promise<ReviewerArtifactFailure | null> {
  if (!flow.durable) { const failed = await flow.persist('completed'); if (failed) { return failed; } }
  const providerFirst = flow.providerEnabled && flow.approval;
  if (flow.durable && providerFirst) { const failed = await flow.persist('pending'); if (failed) { return failed; } }
  const mirrorStage = async (leading: boolean) => {
    if (!flow.providerEnabled || flow.approval !== leading) { return null; }
    await authorizeMissionWrite(flow.slug);
    return (leading && await flow.legal()) || await flow.mirror();
  };
  const leading = await mirrorStage(true);
  if (leading) { return { failureReason: failureReason('infrastructure', 'review-preparation'), consumed: true, ok: false, diagnostic: leading }; }
  const decision = await flow.decide();
  if (decision) { return decision; }
  if (flow.durable && !providerFirst) { const failed = await flow.persist('pending'); if (failed) { return failed; } }
  const trailing = await mirrorStage(false);
  return trailing
    ? { failureReason: failureReason('infrastructure', 'review-preparation'), consumed: true, ok: false, diagnostic: trailing }
    : null;
}

export async function consumeReviewerArtifacts(
  slug: string,
  reviewer: string,
  options: ReviewerArtifactOptions,
): Promise<{ consumed: boolean; failureReason?: FailureReason; ok?: boolean; reviewState?: string | null; diagnostic?: string | null; reviewFindings?: { id: string; summary: string }[] }> {
  const { log, error, deleteArtifactFn, worktree, providerEnabled, artifacts, verdict } = prepareReviewerArtifacts(slug, options);

  if ([artifacts.findings, artifacts.outcomeMessage, artifacts.verdictRaw].every(value => value === null)) {
    return { consumed: false };
  }
  const prepared = await admitReviewerArtifacts({ slug, artifacts, verdict, providerEnabled, worktree, error }, options);
  if (!prepared.ok) { return prepared.failure; }
  const { reviewFindings, reviewOutcome, reviewVerdict, typedFindings } = prepared;
  options = prepared.options;
  const { round, phase, readReviewStateFn } = await reviewerArtifactRound(slug, worktree, options);

  const mirror = () => postReviewerToProvider(slug, reviewer, reviewVerdict, reviewFindings, reviewOutcome, {
      executionContext: options.executionContext, log, error, readReviewStateFn,
      readTokenFn: options.readTokenFn,
      getCommentsFn: options.getCommentsFn,
      postCommentFn: options.postCommentFn,
      postReviewFn: options.postReviewFn,
      getPrAuthorFn: options.getPrAuthorFn,
      buildMetadataFooterFn: options.buildMetadataFooterFn,
      createEventFn: options.createEventFn,
      writeReviewStateFn: options.writeReviewStateFn,
      currentState: options.currentState,
      missionStore: options.missionStore,
      lifecycleService: options.lifecycleService,
      recordApprovalFn: options.recordApprovalFn,
      revision: options.revision,
      configuration: options.configuration,
      round: round!,
    });
  const persistEvents = async (publicationState: ReviewPublicationState) => {
    const persisted = await persistReviewerPublicationEvents({
      slug, reviewer, round, phase, reviewFindings, reviewOutcome, reviewVerdict,
      createEventFn: options.createEventFn, executionContext: options.executionContext, log, error, verbose: Boolean(options.verbose),
      providerEnabled: Boolean(providerEnabled), revision: options.revision ?? '', publicationState,
    });
    return persisted.ok ? null : { consumed: true as const, ok: false as const, failureReason: persisted.failureReason, diagnostic: persisted.diagnostic };
  };
  const atomicEvents = options.missionStore && providerEnabled && options.revision && round !== undefined && phase !== undefined
    ? reviewerPublicationEventDrafts({ slug, reviewer, round, phase, reviewFindings, reviewOutcome, reviewVerdict,
      providerEnabled: true, revision: options.revision, publicationState: 'pending' })
    : undefined;
  // Approval authority remains provider-first, but its publication obligation
  // must exist before the provider mutation. The controller ignores this
  // pending outcome, so an interrupted post is recoverable without granting a
  // local approval.
  const publicationFailure = await completeReviewerPublication({
    slug, providerEnabled: Boolean(providerEnabled), approval: reviewVerdict === 'approve',
    durable: Boolean(options.missionStore), persist: persistEvents, mirror,
    legal: () => approvalLegalDiagnostic(slug, { missionStore: options.missionStore }),
    decide: () => recordReviewerArtifactDecision(slug, reviewer, reviewVerdict, typedFindings, reviewOutcome, atomicEvents, options, log, error),
  });
  if (publicationFailure) { return publicationFailure; }
  if (!providerEnabled && options.verbose) {
    log(fmt.status('INFO', `Review provider disabled; skipping PR mirroring for ${slug}`));
  }
  if (!options.output) {
    for (const artifactPath of [artifacts.findingsPath, artifacts.outcomePath, artifacts.verdictPath]) { deleteArtifactFn(artifactPath); }
  }

  return reviewerConsumeOutcome(reviewVerdict, typedFindings, reviewer, Boolean(providerEnabled), Boolean(options.verbose), log);
}

/**
 * The verdict a reviewer recorded: the dedicated verdict artifact when present,
 * otherwise the `Verdict:` line the outcome prose carries.
 */
function reviewerVerdictFrom(verdictRaw: string | null, outcomeMessage: string | null): string | null {
  const verdict = normalizeReviewVerdict(verdictRaw || '');
  if (verdict || !outcomeMessage) { return verdict; }
  const match = outcomeMessage.match(/^verdict:\s*(approve|request-changes|comment)/im)
    || outcomeMessage.match(/Verdict:\s*(approve|request-changes|comment)/i);
  return match ? normalizeReviewVerdict(match[1]) : verdict;
}

/**
 * Record the decision itself, not just its prose. Without it the round keeps
 * `decision: null`, the Mission never leaves `review` through `request-changes`,
 * and the next review preparation cannot open round N+1.
 */
async function recordReviewerChangeRequest(slug: string, reviewer: string, findings: readonly ReviewFinding[], outcomeMessage: string, publicationEvents: readonly ReviewEventDraft[] | undefined, options: ReviewerArtifactOptions, log: (_msg: string) => void, error: (_msg: string) => void) {
  const recordRequestedChangesFn = options.recordRequestedChangesFn || recordRequestedChanges;
  const write = () => recordRequestedChangesFn(slug, {
    findings,
    comment: outcomeMessage,
    decidedAt: new Date().toISOString(),
    revision: options.revision,
    ...(options.expectedVersion === undefined ? {} : { expectedVersion: options.expectedVersion }),
    result: reviewerResultAttribution(reviewer, options.processResult),
    publicationEvents,
  }, { missionStore: options.missionStore, lifecycleService: options.lifecycleService });
  const decision = await recordConcurrentReviewerDecision(write, options.expectedVersion === undefined);
  if (decision.outcome === 'failed') {
    error(fmt.status('FAIL', `Could not record the reviewer decision for ${slug}: ${decision.diagnostic}`));
    return { failureReason: failureReason('infrastructure', 'review-preparation'), consumed: true as const, ok: false as const, diagnostic: `Reviewer decision persist failed: ${decision.diagnostic}` };
  }
  if (decision.outcome === 'unchanged') {
    log(fmt.status('INFO', `Reviewer decision for ${slug} already recorded (${decision.reason}).`));
  }
  return null;
}

async function recordReviewerApproval(slug: string, reviewer: string, outcomeMessage: string, options: ReviewerArtifactOptions, log: (_msg: string) => void, error: (_msg: string) => void) {
  const recordApprovalFn = options.recordApprovalFn || recordApproval;
  const write = () => recordApprovalFn(slug, {
    comment: outcomeMessage,
    decidedAt: new Date().toISOString(),
    revision: options.revision,
    source: options.providerEnabled ? { kind: 'provider', provider: 'forgejo' } : { kind: 'local' },
    ...(options.expectedVersion === undefined ? {} : { expectedVersion: options.expectedVersion }),
    result: reviewerResultAttribution(reviewer, options.processResult),
  }, { missionStore: options.missionStore, lifecycleService: options.lifecycleService });
  const decision = await recordConcurrentReviewerDecision(write, options.expectedVersion === undefined);
  if (decision.outcome === 'failed') {
    error(fmt.status('FAIL', `Could not record the approve decision for ${slug}: ${decision.diagnostic}`));
    return { failureReason: failureReason('infrastructure', 'review-preparation'), consumed: true as const, ok: false as const, diagnostic: `Reviewer decision persist failed: ${decision.diagnostic}` };
  }
  if (decision.outcome === 'unchanged') {
    log(fmt.status('INFO', `Reviewer decision for ${slug} already recorded (${decision.reason}).`));
  }
  return null;
}

/** Concurrent child verdicts retry only an unpinned compare-and-swap conflict. */
async function recordConcurrentReviewerDecision(write: () => Promise<ReviewRoundResult>, automaticVersion: boolean): Promise<ReviewRoundResult> {
  const maxAttempts = automaticVersion ? 3 : 1;
  let result: ReviewRoundResult = { outcome: 'failed', diagnostic: 'Reviewer decision was not attempted' };
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    result = await write();
    if (result.outcome !== 'failed' || result.kind !== 'stale-write') { return result; }
  }
  return result;
}

/** The loop-control review state a consumed verdict maps to. */
export function reviewerConsumeOutcome(verdict: string, findings: readonly ReviewFinding[], reviewer: string, providerEnabled: boolean, verbose: boolean, log: (_msg: string) => void) {
  const reviewFindings = findings.map(({ id, summary }) => ({ id, summary }));
  if (verdict === 'approve') { return { consumed: true, ok: true, reviewState: 'APPROVED', reviewFindings }; }
  if (verdict === 'request-changes') { return { consumed: true, ok: true, reviewState: 'REQUEST_CHANGES', reviewFindings }; }
  if (!providerEnabled) {
    const reviewState = verdict.toUpperCase().replace(/-/g, '_');
    if (verbose) {
      log(fmt.status('INFO', `Reviewer ${reviewer} produced verdict "${verdict}" with the provider disabled; normalizing to ${reviewState} for loop control.`));
    }
    return { consumed: true, ok: true, reviewState, reviewFindings };
  }
  log(fmt.status('WARN', `Reviewer ${reviewer} produced verdict "${verdict}". Falling back to provider polling for loop control.`));
  return { consumed: true, ok: true, reviewState: null };
}

async function recordReviewerArtifactDecision(slug: string, reviewer: string, reviewVerdict: string, typedFindings: readonly ReviewFinding[], reviewOutcome: string, publicationEvents: readonly ReviewEventDraft[] | undefined, options: ReviewerArtifactOptions, log: (message: string) => void, error: (message: string) => void) {
  if (reviewVerdict === 'request-changes') {
    const recorded = await recordReviewerChangeRequest(slug, reviewer, typedFindings, reviewOutcome, publicationEvents, options, log, error);
    if (recorded) { return recorded; }
  } else if (reviewVerdict === 'approve' && options.missionStore) {
    const recorded = await recordReviewerApproval(slug, reviewer, reviewOutcome, options, log, error);
    if (recorded) { return recorded; }
  }

  return null;
}

async function reviewerArtifactRound(slug: string, worktree: string, options: ReviewerArtifactOptions) {
  const readReviewStateFn = options.readReviewStateFn || readReviewState;
  const currentState = await Promise.resolve(readReviewStateFn(slug, worktree, options.missionStore ?? null));
  const round = currentState ? currentState.round : 1;
  const phase = currentState ? currentState.phase : 'reviewing';
  return { round, phase, readReviewStateFn };
}

function parseReviewerArtifactFindings(reviewFindings: string, reviewVerdict: string, options: ReviewerArtifactOptions) {
  const typedFindings: readonly ReviewFinding[] = options.output
    ? options.output.findings
    : parseReviewFindings(reviewFindings);
  if (reviewVerdict === 'request-changes' && typedFindings.length === 0) {
    return {
      ok: false as const, failure: {
        consumed: true as const,
        ok: false as const,
        diagnostic: 'Reviewer artifacts invalid: request-changes findings must use a "## F1: summary" heading',
      }
    };
  }

  return { ok: true as const, findings: typedFindings };
}

function pinReviewerRevision(options: ReviewerArtifactOptions, worktree: string) {
  try {
    return { ok: true as const, options: options.missionStore
      ? { ...options, revision: options.revision ?? headRevision(worktree) } : options };
  } catch (error) {
    return { ok: false as const, diagnostic: String(error) };
  }
}
