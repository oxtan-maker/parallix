/**
 * Reviewer artifact consumption: resolve the reviewer artifact set, persist
 * reviewer events, and post the reviewer outcome to the provider.
 */

import * as fmt from '../../application/presentation/cli-format.js';
import { resolveWorktree } from '../filesystem/mission-utils.js';
import { readReviewState, writeReviewState, reviewStateFile } from './review-state.js';
import type { MissionStore } from '../../application/domain-ports.js';
import { type ReviewFinding } from '../../domain/review.js';
import { isEnabled } from './review-adapter.js';
import { createEvent, consumeHumanNotes, VALID_EVENT_TYPES, CreateEventParams, CreateEventOptions, CreateEventResult } from './review-events.js';
import { parseReviewFindings, recordRequestedChanges, recordApproval } from './review-round.js';
import type { MissionLifecycleService } from '../../application/mission-lifecycle-service.js';
import { reviewArtifactPath, staleReviewWrite, renderFindings, resolveArtifactRead, resolveArtifactDir, readArtifactFile, deleteArtifactFile, normalizeReviewVerdict, type ReviewStateReader } from './review-artifact-files.js';
import { postWorkflowComment, postWorkflowReview } from './review-workflow-posting.js';

type ReviewerArtifactOptions = {
  log?: (_msg: string) => void;
  error?: (_msg: string) => void;
  readArtifactFn?: typeof readArtifactFile;
  deleteArtifactFn?: typeof deleteArtifactFile;
  tmpDir?: string | null;
  worktree?: string;
  providerEnabled?: boolean | null;
  forgejoEnabled?: boolean | null;
  readTokenFn?: (_user: string, _opts?: Record<string, unknown>) => string | null;
  getCommentsFn?: (_branch: string, _token: string) => Promise<unknown[]>;
  postCommentFn?: (_branch: string, _token: string, _body: string, _opts?: Record<string, unknown>) => unknown;
  postReviewFn?: (_branch: string, _token: string, _outcome: string, _body: string, _opts?: Record<string, unknown>) => unknown;
  getPrAuthorFn?: (_branch: string, _token: string, _opts?: Record<string, unknown>) => unknown;
  buildMetadataFooterFn?: (_s: string, _r?: string, _store?: MissionStore | null) => string | Promise<string>;
  createEventFn?: (_s: string, _t: string, _p: CreateEventParams, _o: CreateEventOptions) => CreateEventResult | Promise<CreateEventResult>;
  readReviewStateFn?: ReviewStateReader;
  writeReviewStateFn?: typeof writeReviewState;
  currentState?: { metadata?: Record<string, unknown> } | null;
  missionStore?: MissionStore | null;
  lifecycleService?: MissionLifecycleService | null;
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

async function persistReviewerEvents(params: {
  slug: string;
  reviewer: string;
  round: number | undefined;
  phase: string | undefined;
  reviewFindings: string;
  reviewOutcome: string;
  reviewVerdict: string;
  createEventFn: RepoEventFn;
  worktree: string;
  log: (_msg: string) => void;
  error: (_msg: string) => void;
  verbose: boolean;
}): Promise<{ ok: true } | { ok: false; diagnostic: string }> {
  const { slug, reviewer, round, phase, reviewFindings, reviewOutcome, reviewVerdict, createEventFn, worktree, log, error, verbose } = params;
  const findingsEventResult = await createEventFn(slug, VALID_EVENT_TYPES.REVIEWER_FINDINGS, {
    content: reviewFindings, round, phase, actor: reviewer
  }, { worktree, skipGit: true, log: log, error });

  if (!findingsEventResult.ok) {
    const findingsErr = (findingsEventResult as { error?: string }).error;
    error(fmt.status('FAIL', `Failed to persist reviewer findings to repo store: ${findingsErr}`));
    return { ok: false, diagnostic: `Reviewer artifact persist failed (findings): ${findingsErr}` };
  }

  const outcomeEventResult = await createEventFn(slug, VALID_EVENT_TYPES.REVIEWER_OUTCOME, {
    content: reviewOutcome, round, phase, actor: reviewer, verdict: reviewVerdict
  }, { worktree, skipGit: true, log: log, error });

  if (!outcomeEventResult.ok) {
    const outcomeErr = (outcomeEventResult as { error?: string }).error;
    error(fmt.status('FAIL', `Failed to persist reviewer outcome to repo store: ${outcomeErr}`));
    return { ok: false, diagnostic: `Reviewer artifact persist failed (outcome): ${outcomeErr}` };
  }

  if (verbose) {
    log(fmt.status('INFO', `Persisted reviewer artifacts to repo store: ${(findingsEventResult as { path?: string }).path}, ${(outcomeEventResult as { path?: string }).path}`));
  }
  return { ok: true };
}

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
    worktree: string;
    log: (_msg: string) => void;
    error: (_msg: string) => void;
    readReviewStateFn: ReviewStateReader;
    readTokenFn?: (_user: string, _opts?: Record<string, unknown>) => string | null;
    getCommentsFn?: (_branch: string, _token: string) => Promise<unknown[]>;
    postCommentFn?: (_branch: string, _token: string, _body: string, _opts?: Record<string, unknown>) => unknown;
    postReviewFn?: (_branch: string, _token: string, _outcome: string, _body: string, _opts?: Record<string, unknown>) => unknown;
    getPrAuthorFn?: (_branch: string, _token: string, _opts?: Record<string, unknown>) => unknown;
    buildMetadataFooterFn?: (_s: string, _r?: string, _store?: MissionStore | null) => string | Promise<string>;
    createEventFn?: RepoEventFn;
    writeReviewStateFn?: typeof writeReviewState;
    currentState?: { metadata?: Record<string, unknown> } | null;
    missionStore?: MissionStore | null;
    lifecycleService?: MissionLifecycleService | null;
    recordApprovalFn?: typeof recordApproval;
  },
): Promise<string | null> {
  const { worktree, log, error, readReviewStateFn } = context;
  if (context.readTokenFn && context.getCommentsFn) {
    await consumeHumanNotes(slug, reviewer, {
      getCommentsFn: context.getCommentsFn,
      createEventFn: (context.createEventFn || createEvent) as any,
      readTokenFn: context.readTokenFn,
      reviewIdentity: reviewer,
      worktree,
      writeReviewStateFn: context.writeReviewStateFn,
      readReviewStateFn: readReviewStateFn as typeof readReviewState,
      currentState: context.currentState,
      log: log,
      error
    });
  }

  const commentResult = await postWorkflowComment(slug, reviewFindings, {
    rootDir: worktree,
    reviewIdentity: reviewer,
    readTokenFn: context.readTokenFn,
    postCommentFn: context.postCommentFn,
    buildMetadataFooterFn: context.buildMetadataFooterFn,
    readReviewStateFn,
    missionStore: context.missionStore,
    log: log,
    error
  });
  if (!commentResult.ok) {
    return `Reviewer comment post failed: ${(commentResult as { error?: string }).error}`;
  }

  const reviewResult = await postWorkflowReview(slug, reviewVerdict, reviewOutcome, {
    worktree,
    reviewIdentity: reviewer,
    readTokenFn: context.readTokenFn,
    postReviewFn: context.postReviewFn,
    getPrAuthorFn: context.getPrAuthorFn,
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
  });
  if (!reviewResult.ok) {
    return `Reviewer review post failed: ${(reviewResult as { error?: string }).error}`;
  }
  return null;
}

export async function consumeReviewerArtifacts(
  slug: string,
  reviewer: string,
  options: ReviewerArtifactOptions = {}
): Promise<{ consumed: boolean; ok?: boolean; reviewState?: string | null; diagnostic?: string | null; reviewFindings?: { id: string; summary: string }[] }> {
  const log = options.log || fmt.log.plain;
  const error = options.error || fmt.log.plainError;
  const readArtifactFn = options.readArtifactFn || readArtifactFile;
  const deleteArtifactFn = options.deleteArtifactFn || deleteArtifactFile;
  const worktree = options.worktree || resolveWorktree(slug) || process.cwd();
  const tmpDir = options.tmpDir || resolveArtifactDir(worktree);
  const providerEnabled = resolveProviderEnabled(options, worktree);
  const reviewStatePath = reviewStateFile(slug, worktree);

  const artifacts = options.output
    ? typedReviewerArtifactSet(slug, tmpDir, options.output)
    : resolveReviewerArtifactSet(slug, { tmpDir, readArtifactFn });
  const verdict = reviewerVerdictFrom(artifacts.verdictRaw, artifacts.outcomeMessage);

  if (artifacts.findings === null && artifacts.outcomeMessage === null && artifacts.verdictRaw === null) {
    return { consumed: false };
  }
  const incomplete = reportIncompleteReviewerArtifacts({
    slug, findings: artifacts.findings, outcomeMessage: artifacts.outcomeMessage, verdict,
    findingsPath: artifacts.findingsPath, outcomePath: artifacts.outcomePath, verdictPath: artifacts.verdictPath,
    reviewStatePath, providerEnabled: Boolean(providerEnabled), error,
  });
  if (incomplete) { return incomplete; }
  // Past the completeness guard all three artifacts are present.
  const reviewFindings: string = artifacts.findings!;
  const reviewOutcome: string = artifacts.outcomeMessage!;
  const reviewVerdict: string = verdict!;
  // `px verdict` already names each finding; only a file transport needs parsing.
  const typedFindings: readonly ReviewFinding[] = options.output
    ? options.output.findings
    : parseReviewFindings(reviewFindings);
  if (reviewVerdict === 'request-changes' && typedFindings.length === 0) {
    return {
      consumed: true,
      ok: false,
      diagnostic: 'Reviewer artifacts invalid: request-changes findings must use a "## F1: summary" heading',
    };
  }

  const stale = await staleReviewWrite(slug, options.expectedVersion, options.missionStore);
  if (stale) {
    error(fmt.status('FAIL', stale));
    return { consumed: true, ok: false, diagnostic: stale };
  }

  const readReviewStateFn = options.readReviewStateFn || readReviewState;
  const currentState = await Promise.resolve(readReviewStateFn(slug, worktree, options.missionStore ?? null));
  const round = currentState ? currentState.round : 1;
  const phase = currentState ? currentState.phase : 'reviewing';

  // The decision itself, not just its prose. Without it the round keeps
  // `decision: null`, the Mission never leaves `review` through
  // `request-changes`, and the next handoff cannot open round N+1.
  //
  // Committed first, pinned to the version the caller read. It cannot go after
  // the review events: those advance the Mission, so the caller's version would
  // be stale by the time the decision compared it, and a concurrent write
  // landing between the events and the decision would be overwritten silently.
  // The recorders save with a compare-and-swap on the same version they check,
  // so pinning it here is what makes the submission atomic rather than merely
  // pre-checked. It also fails in the safer direction: a decision without its
  // event export is a missing log entry, while an event export without the
  // decision leaves the Mission unapproved and unintegratable.
  if (reviewVerdict === 'request-changes') {
    const recorded = await recordReviewerChangeRequest(slug, typedFindings, reviewOutcome, options, log, error);
    if (recorded) { return recorded; }
  } else if (reviewVerdict === 'approve' && options.missionStore) {
    // An approve is a domain decision, recorded here for the same reason
    // request-changes is: the aggregate is what `px integrate` gates on, and
    // what the next agent reads back. It used to be persisted only inside the
    // self-authored-PR branch of the provider mirroring below, so a review with
    // the provider disabled, or any ordinary provider review, returned APPROVED
    // while the mission stayed unapproved and unintegratable.
    //
    // Recorded before mirroring, so a round that cannot legally reach
    // `approved` fails here instead of after a provider POST that cannot be
    // taken back.
    const recorded = await recordReviewerApproval(slug, reviewOutcome, options, log, error);
    if (recorded) { return recorded; }
  }

  const persisted = await persistReviewerEvents({
    slug, reviewer, round, phase, reviewFindings, reviewOutcome, reviewVerdict,
    createEventFn: options.createEventFn || createEvent, worktree, log, error, verbose: Boolean(options.verbose),
  });
  if (!persisted.ok) { return { consumed: true, ok: false, diagnostic: 'diagnostic' in persisted ? persisted.diagnostic : 'reviewer event persistence failed' }; }

  if (providerEnabled) {
    const diagnostic = await postReviewerToProvider(slug, reviewer, reviewVerdict, reviewFindings, reviewOutcome, {
      worktree, log, error, readReviewStateFn,
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
    });
    if (diagnostic) { return { consumed: true, ok: false, diagnostic }; }
  } else if (options.verbose) {
    log(fmt.status('INFO', `Review provider disabled; skipping PR mirroring for ${slug}`));
  }

  if (!options.output) {
    deleteArtifactFn(artifacts.findingsPath);
    deleteArtifactFn(artifacts.outcomePath);
    deleteArtifactFn(artifacts.verdictPath);
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
 * Report whichever required reviewer artifact is missing, or null when all
 * three are present. With provider=none there is no PR review to fall back on,
 * so the local state path is named: it is the only place the operator can
 * repair this.
 */
function reportIncompleteReviewerArtifacts(context: {
  slug: string; findings: string | null; outcomeMessage: string | null; verdict: string | null;
  findingsPath: string; outcomePath: string; verdictPath: string;
  reviewStatePath: string | null; providerEnabled: boolean; error: (_msg: string) => void;
}): { consumed: true; ok: false; diagnostic: string } | null {
  const { slug, findings, outcomeMessage, verdict, findingsPath, outcomePath, verdictPath, reviewStatePath, providerEnabled, error } = context;
  const localRepair = providerEnabled
    ? ''
    : `${reviewStatePath ? ` local review state at ${reviewStatePath}; ` : ' '}No provider review posted (provider=none); add a review-outcome.md with a Verdict line or use \`node parallix review <slug> --submit-review approve\`.`;
  if (!findings || !outcomeMessage) {
    const missing: string[] = [];
    if (!findings) { missing.push('findings'); }
    if (!outcomeMessage) { missing.push('outcome'); }
    error(fmt.status('FAIL', `Incomplete reviewer artifacts for ${slug}. Expected ${findingsPath} and ${outcomePath}.${localRepair}`));
    return { consumed: true, ok: false, diagnostic: `Reviewer artifacts incomplete: missing ${missing.join(', ')}` };
  }
  if (!verdict) {
    error(fmt.status('FAIL', `Reviewer artifacts for ${slug} missing verdict. Expected in ${verdictPath} or in ${outcomePath} content.${localRepair}`));
    return { consumed: true, ok: false, diagnostic: `Reviewer artifacts incomplete: missing verdict` };
  }
  return null;
}

/**
 * Record the decision itself, not just its prose. Without it the round keeps
 * `decision: null`, the Mission never leaves `review` through `request-changes`,
 * and the next handoff cannot open round N+1.
 */
async function recordReviewerChangeRequest(slug: string, findings: readonly ReviewFinding[], outcomeMessage: string, options: any, log: (_msg: string) => void, error: (_msg: string) => void) {
  const recordRequestedChangesFn = options.recordRequestedChangesFn || recordRequestedChanges;
  const decision = await recordRequestedChangesFn(slug, {
    findings,
    comment: outcomeMessage,
    decidedAt: new Date().toISOString(),
    ...(options.expectedVersion === undefined ? {} : { expectedVersion: options.expectedVersion }),
  }, { missionStore: options.missionStore, lifecycleService: options.lifecycleService });
  if (decision.outcome === 'failed') {
    error(fmt.status('FAIL', `Could not record the reviewer decision for ${slug}: ${decision.diagnostic}`));
    return { consumed: true as const, ok: false as const, diagnostic: `Reviewer decision persist failed: ${decision.diagnostic}` };
  }
  if (decision.outcome === 'unchanged') {
    log(fmt.status('INFO', `Reviewer decision for ${slug} already recorded (${decision.reason}).`));
  }
  return null;
}

async function recordReviewerApproval(slug: string, outcomeMessage: string, options: any, log: (_msg: string) => void, error: (_msg: string) => void) {
  const recordApprovalFn = options.recordApprovalFn || recordApproval;
  const decision = await recordApprovalFn(slug, {
    comment: outcomeMessage,
    decidedAt: new Date().toISOString(),
    source: { kind: 'local' },
    ...(options.expectedVersion === undefined ? {} : { expectedVersion: options.expectedVersion }),
  }, { missionStore: options.missionStore, lifecycleService: options.lifecycleService });
  if (decision.outcome === 'failed') {
    error(fmt.status('FAIL', `Could not record the approve decision for ${slug}: ${decision.diagnostic}`));
    return { consumed: true as const, ok: false as const, diagnostic: `Reviewer decision persist failed: ${decision.diagnostic}` };
  }
  if (decision.outcome === 'unchanged') {
    log(fmt.status('INFO', `Reviewer decision for ${slug} already recorded (${decision.reason}).`));
  }
  return null;
}

/** The loop-control review state a consumed verdict maps to. */
function reviewerConsumeOutcome(verdict: string, findings: readonly ReviewFinding[], reviewer: string, providerEnabled: boolean, verbose: boolean, log: (_msg: string) => void) {
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

