/**
 * Review Artifacts Module - Utility Functions
 * Resolves, validates, persists, and mirrors reviewer and implementer artifacts.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as fmt from '../../application/presentation/cli-format.js';
import { missionBranchName, resolveWorktree } from '../filesystem/mission-utils.js';
import { git } from '../git/git.js';
import { readReviewState, writeReviewState, reviewStateFile, ReviewState, resolveReviewIdentity, persistReviewStateOrThrow } from './review-state.js';
import type { MissionStore } from '../../application/domain-ports.js';
import { readToken, postComment, postReview, getPrAuthor, isEnabled, resolveArtifactDir as resolveConfiguredArtifactDir } from './review-adapter.js';
import { createEvent, consumeHumanNotes, VALID_EVENT_TYPES, CreateEventParams, CreateEventOptions, CreateEventResult } from './review-events.js';
import { parseReviewFindings, recordImplementerResolution, recordRequestedChanges } from './review-round.js';
import type { MissionLifecycleService } from '../../application/mission-lifecycle-service.js';

type CreateResult = { ok: boolean; path: string | null; error?: string | null; event?: Record<string, unknown> };

// ============================================================================
// Metadata Footer
// ============================================================================

async function buildMetadataFooter(slug: string, rootDir = process.cwd()): Promise<string> {
  const state = await readReviewState(slug, rootDir);
  if (!state) { return ''; }
  return `\n\n---\n\`[workflow-round:${state.round}, workflow-phase:${state.phase}]\``;
}

// ============================================================================
// Artifact Path Utilities
// ============================================================================

function reviewArtifactPath(slug: string, artifactName: string, tmpDir = os.tmpdir()): string {
  return path.join(tmpDir, `${slug}-${artifactName}`);
}

/**
 * Read one agent-written artifact from the configured artifact directory.
 *
 * There is no second location to look in: the /tmp legacy fallback was removed
 * by the architecture migration cutover, so an artifact the agent did not write where the
 * loop is looking simply isn't there.
 */
function resolveArtifactRead(
  slug: string,
  artifactName: string,
  opts: { tmpDir: string; readArtifactFn: typeof readArtifactFile }
): { path: string; value: string | null } {
  const { tmpDir, readArtifactFn } = opts;
  const artifactPath = reviewArtifactPath(slug, artifactName, tmpDir);
  return { path: artifactPath, value: readArtifactFn(artifactPath) };
}

/**
 * Resolve the directory where review artifacts are written and consumed.
 */
function resolveArtifactDir(rootDir = process.cwd()): string {
  return resolveConfiguredArtifactDir(rootDir);
}

function readArtifactFile(filePath: string, readFileSync = fs.readFileSync): string | null {
  try {
    const value = readFileSync(filePath, 'utf8');
    return typeof value === 'string' ? value.trim() : '';
  } catch {
    return null;
  }
}

function deleteArtifactFile(filePath: string, unlinkSync = fs.unlinkSync): void {
  try {
    unlinkSync(filePath);
  } catch {
    // Best-effort cleanup only.
  }
}

// ============================================================================
// Normalization Utilities
// ============================================================================

function normalizeReviewVerdict(value: string): string | null {
  const normalized = String(value || '').trim().toLowerCase();
  return ['approve', 'request-changes', 'comment'].includes(normalized) ? normalized : null;
}

function normalizeDisposition(value: string): string | null {
  const normalized = String(value || '').trim().toUpperCase();
  return ['CHANGES_MADE', 'PUSHBACK_ALL', 'PARKED', 'BLOCKED'].includes(normalized) ? normalized : null;
}

/**
 * The revision the implementer hands back — the branch tip it produced.
 *
 * A worktree that cannot report a HEAD has no revision to record; failing here
 * is honest, where a synthesized placeholder would write a non-SHA revision
 * into the aggregate and make the round look answered against a change nobody
 * can resolve.
 */
function headRevision(worktree: string): string {
  const result = git(['-C', worktree, 'rev-parse', 'HEAD']);
  const sha = result.stdout.trim();
  if (!sha) {
    throw new Error(`Cannot resolve HEAD in ${worktree}: the implementer round has no revision to record`);
  }
  return sha;
}

// ============================================================================
// Workflow Comment/Review Posting
// ============================================================================

async function postWorkflowComment(
  slug: string,
  message: string,
  options: {
    log?: (_msg: string) => void;
    error?: (_msg: string) => void;
    readTokenFn?: (_user: string, _opts: { rootDir?: string }) => string | null;
    postCommentFn?: (_branch: string, _token: string, _body: string, _opts?: Record<string, unknown>) => unknown;
    buildMetadataFooterFn?: (_s: string, _r?: string) => string | Promise<string>;
    readReviewStateFn?: (_s: string, _r?: string) => any;
    rootDir?: string;
    reviewIdentity?: string;
    forgejoUser?: string;
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
    || (await resolveReviewIdentity(slug, rootDir, { readReviewStateFn })).commentIdentityUser
    || 'human';
  const reviewIdentity = identityResolved;
  const token = readTokenFn(reviewIdentity, { rootDir });
  if (!token) {
    error(fmt.status('FAIL', `No Forgejo token found for user "${reviewIdentity}". Cannot post comment.`));
    return { ok: false };
  }

  const taggedMessage = message + await Promise.resolve(buildMetadataFooterFn(slug, rootDir));
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
    createEventFn?: (_s: string, _t: string, _p: Record<string, unknown>, _o: Record<string, unknown>) => CreateResult;
    readReviewStateFn?: (_s: string, _r?: string) => any;
    log?: (_msg: string) => void;
    error?: (_msg: string) => void;
    reviewer?: string;
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

  const existing = await Promise.resolve(readReviewStateFn(slug, worktree));
  const state = existing instanceof ReviewState
    ? existing
    : new ReviewState(slug, existing || {
        reviewer: options.reviewer,
        implementer: options.reviewer,
        round: 1,
        phase: 'reviewing',
      });
  if (outcome === 'approve') {
    state.disposition = 'APPROVED';
    try { state.transitionTo('approved'); } catch { /* ignore */ }
  } else if (outcome === 'request-changes') {
    state.disposition = 'REQUEST_CHANGES';
    try { state.transitionTo('fixing'); } catch { /* ignore */ }
  }
  await persistReviewStateOrThrow(writeReviewStateFn, slug, state, worktree, missionStore);
  const outcomeResult = await createEventFn(slug, VALID_EVENT_TYPES.REVIEWER_OUTCOME, { verdict: outcome, content: `Review verdict: ${outcome}` }, { worktree, log: log, error, missionStore });
  if (!outcomeResult.ok) {
    throw new Error(`Cannot store review event for "${slug}": the operator database rejected the write.`);
  }
}

/**
 * Submit a review outcome to the provider.
 */
async function postWorkflowReview(
  slug: string,
  outcome: string,
  message: string,
  options: {
    log?: (_msg: string) => void;
    error?: (_msg: string) => void;
    readTokenFn?: (_user: string, _opts: { rootDir?: string }) => string | null;
    postReviewFn?: (_branch: string, _token: string, _outcome: string, _body: string, _opts?: Record<string, unknown>) => unknown;
    buildMetadataFooterFn?: (_s: string, _r?: string) => string | Promise<string>;
    readReviewStateFn?: (_s: string, _r?: string) => any;
    worktree?: string;
    reviewIdentity?: string;
    forgejoUser?: string;
    getPrAuthorFn?: (_branch: string, _token: string, _opts?: Record<string, unknown>) => unknown;
    writeReviewStateFn?: typeof writeReviewState;
    createEventFn?: (_s: string, _t: string, _p: Record<string, unknown>, _o: Record<string, unknown>) => CreateResult;
    missionStore?: MissionStore | null;
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
    || (await resolveReviewIdentity(slug, worktree, { readReviewStateFn })).identityUser
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
    log(fmt.status('WARN', `Reviewer "${reviewIdentity}" is the PR author for ${branch}; skipping the provider review POST to avoid a self-approval (Forgejo rejects "approve your own pull is not allowed" with HTTP 422). Recording the "${outcome}" verdict locally in the SQLite Review aggregate; a different agent or a human must post the formal approval.`));
    await recordLocalReviewVerdict(slug, outcome, {
      worktree,
      reviewer: reviewIdentity,
      writeReviewStateFn: options.writeReviewStateFn,
      createEventFn: options.createEventFn,
      readReviewStateFn,
      log: log,
      error,
      missionStore,
    });
    return { ok: true, skipped: true, reason: 'self-author', prAuthor };
  }

  const taggedMessage = message + await Promise.resolve(buildMetadataFooterFn(slug, worktree));
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

// ============================================================================
// Artifact Consumption
// ============================================================================


async function consumeReviewerArtifacts(
  slug: string,
  reviewer: string,
  options: {
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
    buildMetadataFooterFn?: (_s: string, _r?: string) => string | Promise<string>;
    createEventFn?: (_s: string, _t: string, _p: CreateEventParams, _o: CreateEventOptions) => CreateEventResult | Promise<CreateEventResult>;
    readReviewStateFn?: (_s: string, _r?: string) => any;
    writeReviewStateFn?: typeof writeReviewState;
    currentState?: { metadata?: Record<string, unknown> } | null;
    missionStore?: MissionStore | null;
    lifecycleService?: MissionLifecycleService | null;
    recordRequestedChangesFn?: typeof recordRequestedChanges;
  } = {}
): Promise<{ consumed: boolean; ok?: boolean; reviewState?: string | null; diagnostic?: string | null }> {
  const log = options.log || fmt.log.plain;
  const error = options.error || fmt.log.plainError;
  const readArtifactFn = options.readArtifactFn || readArtifactFile;
  const deleteArtifactFn = options.deleteArtifactFn || deleteArtifactFile;
  const worktree = options.worktree || resolveWorktree(slug) || process.cwd();
  const tmpDir = options.tmpDir || resolveArtifactDir(worktree);
  const providerEnabled = options.providerEnabled !== null && options.providerEnabled !== undefined
    ? options.providerEnabled
    : (options.forgejoEnabled !== null && options.forgejoEnabled !== undefined ? options.forgejoEnabled : isEnabled(worktree));
  const reviewStatePath = reviewStateFile(slug, worktree);

  const findingsResolved = resolveArtifactRead(slug, 'review-findings.md', { tmpDir, readArtifactFn });
  const outcomeResolved = resolveArtifactRead(slug, 'review-outcome.md', { tmpDir, readArtifactFn });
  const verdictResolved = resolveArtifactRead(slug, 'review-verdict.txt', { tmpDir, readArtifactFn });
  const findingsPath = findingsResolved.path;
  const outcomePath = outcomeResolved.path;
  const verdictPath = verdictResolved.path;

  const findings = findingsResolved.value;
  const outcomeMessage = outcomeResolved.value;
  const verdictRaw = verdictResolved.value;

  let verdict = normalizeReviewVerdict(verdictRaw || '');
  if (!verdict && outcomeMessage) {
    const outcomeVerdictMatch = outcomeMessage.match(/^verdict:\s*(approve|request-changes|comment)/im) ||
                               outcomeMessage.match(/Verdict:\s*(approve|request-changes|comment)/i);
    if (outcomeVerdictMatch) {
      verdict = normalizeReviewVerdict(outcomeVerdictMatch[1]);
    }
  }

  const hasAny = findings !== null || outcomeMessage !== null || verdictRaw !== null;

  if (!hasAny) {
    return { consumed: false };
  }
  if (!findings || !outcomeMessage) {
    const missingParts: string[] = [];
    if (!findings) { missingParts.push('findings'); }
    if (!outcomeMessage) { missingParts.push('outcome'); }
    if (!providerEnabled) {
      const statePathStr = reviewStatePath ? ` local review state at ${reviewStatePath}; ` : ' ';
      error(fmt.status('FAIL', `Incomplete reviewer artifacts for ${slug}. Expected ${findingsPath} and ${outcomePath}.${statePathStr}No provider review posted (provider=none); add a review-outcome.md with a Verdict line or use \`node parallix review <slug> --submit-review approve\`.`));
    } else {
      error(fmt.status('FAIL', `Incomplete reviewer artifacts for ${slug}. Expected ${findingsPath} and ${outcomePath}.`));
    }
    return { consumed: true, ok: false, diagnostic: `Reviewer artifacts incomplete: missing ${missingParts.join(', ')}` };
  }
  if (!verdict) {
    if (!providerEnabled) {
      const statePathStr = reviewStatePath ? ` local review state at ${reviewStatePath}; ` : ' ';
      error(fmt.status('FAIL', `Reviewer artifacts for ${slug} missing verdict. Expected in ${verdictPath} or in ${outcomePath} content.${statePathStr}No provider review posted (provider=none); add a review-outcome.md with a Verdict line or use \`node parallix review <slug> --submit-review approve\`.`));
    } else {
      error(fmt.status('FAIL', `Reviewer artifacts for ${slug} missing verdict. Expected in ${verdictPath} or in ${outcomePath} content.`));
    }
    return { consumed: true, ok: false, diagnostic: `Reviewer artifacts incomplete: missing verdict` };
  }

  const currentState = await Promise.resolve((options.readReviewStateFn || readReviewState)(slug, worktree));
  const round = currentState ? currentState.round : 1;
  const phase = currentState ? currentState.phase : 'reviewing';

  const createEventFn = options.createEventFn || createEvent;
  const findingsEventResult = await createEventFn(slug, VALID_EVENT_TYPES.REVIEWER_FINDINGS, {
    content: findings, round, phase, actor: reviewer
  }, { worktree, skipGit: true, log: log, error });

  if (!findingsEventResult.ok) {
    const findingsErr = (findingsEventResult as { error?: string }).error;
    error(fmt.status('FAIL', `Failed to persist reviewer findings to repo store: ${findingsErr}`));
    return { consumed: true, ok: false, diagnostic: `Reviewer artifact persist failed (findings): ${findingsErr}` };
  }

  const outcomeEventResult = await createEventFn(slug, VALID_EVENT_TYPES.REVIEWER_OUTCOME, {
    content: outcomeMessage, round, phase, actor: reviewer, verdict
  }, { worktree, skipGit: true, log: log, error });

  if (!outcomeEventResult.ok) {
    const outcomeErr = (outcomeEventResult as { error?: string }).error;
    error(fmt.status('FAIL', `Failed to persist reviewer outcome to repo store: ${outcomeErr}`));
    return { consumed: true, ok: false, diagnostic: `Reviewer artifact persist failed (outcome): ${outcomeErr}` };
  }

  log(fmt.status('INFO', `Persisted reviewer artifacts to repo store: ${(findingsEventResult as { path?: string }).path}, ${(outcomeEventResult as { path?: string }).path}`));

  // The decision itself, not just its prose. Without it the round keeps
  // `decision: null`, the Mission never leaves `review` through
  // `request-changes`, and the next handoff cannot open round N+1.
  if (verdict === 'request-changes') {
    const recordRequestedChangesFn = options.recordRequestedChangesFn || recordRequestedChanges;
    const decision = await recordRequestedChangesFn(slug, {
      findings: parseReviewFindings(findings),
      comment: outcomeMessage,
      decidedAt: new Date().toISOString(),
    }, { missionStore: options.missionStore, lifecycleService: options.lifecycleService });
    if (decision.outcome === 'failed') {
      error(fmt.status('FAIL', `Could not record the reviewer decision for ${slug}: ${decision.diagnostic}`));
      return { consumed: true, ok: false, diagnostic: `Reviewer decision persist failed: ${decision.diagnostic}` };
    }
    if (decision.outcome === 'unchanged') {
      log(fmt.status('INFO', `Reviewer decision for ${slug} already recorded (${decision.reason}).`));
    }
  }

  if (providerEnabled && options.readTokenFn && options.getCommentsFn) {
    await consumeHumanNotes(slug, reviewer, {
      getCommentsFn: options.getCommentsFn,
      createEventFn: createEventFn as any,
      readTokenFn: options.readTokenFn,
      reviewIdentity: reviewer,
      worktree,
      writeReviewStateFn: options.writeReviewStateFn,
      currentState: options.currentState,
      log: log,
      error
    });
  }

  if (providerEnabled) {
    const commentResult = await postWorkflowComment(slug, findings, {
      rootDir: worktree,
      reviewIdentity: reviewer,
      readTokenFn: options.readTokenFn,
      postCommentFn: options.postCommentFn,
      buildMetadataFooterFn: options.buildMetadataFooterFn,
      log: log,
      error
    });
    if (!commentResult.ok) {
      return { consumed: true, ok: false, diagnostic: `Reviewer comment post failed: ${(commentResult as { error?: string }).error}` };
    }

    const reviewResult = await postWorkflowReview(slug, verdict, outcomeMessage, {
      worktree,
      reviewIdentity: reviewer,
      readTokenFn: options.readTokenFn,
      postReviewFn: options.postReviewFn,
      buildMetadataFooterFn: options.buildMetadataFooterFn,
      log: log,
      error,
      missionStore: options.missionStore,
      // Forward the (composition-bound) write function so the self-author
      // local verdict path persists through the same approval boundary as
      // every other approval-producing site (TASK-2378 CP-2 audit site 3).
      writeReviewStateFn: options.writeReviewStateFn,
    });
    if (!reviewResult.ok) {
      return { consumed: true, ok: false, diagnostic: `Reviewer review post failed: ${(reviewResult as { error?: string }).error}` };
    }
  } else {
    log(fmt.status('INFO', `Review provider disabled; skipping PR mirroring for ${slug}`));
  }

  deleteArtifactFn(findingsPath);
  deleteArtifactFn(outcomePath);
  deleteArtifactFn(verdictPath);

  if (verdict === 'approve') { return { consumed: true, ok: true, reviewState: 'APPROVED' }; }
  if (verdict === 'request-changes') { return { consumed: true, ok: true, reviewState: 'REQUEST_CHANGES' }; }
  if (!providerEnabled) {
    const reviewState = verdict.toUpperCase().replace(/-/g, '_');
    log(fmt.status('INFO', `Reviewer ${reviewer} produced verdict "${verdict}" with the provider disabled; normalizing to ${reviewState} for loop control.`));
    return { consumed: true, ok: true, reviewState };
  }
  log(fmt.status('WARN', `Reviewer ${reviewer} produced verdict "${verdict}". Falling back to provider polling for loop control.`));
  return { consumed: true, ok: true, reviewState: null };
}

async function consumeImplementerArtifacts(
  slug: string,
  implementer: string,
  options: {
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
    buildMetadataFooterFn?: (_s: string, _r?: string) => string | Promise<string>;
    createEventFn?: (_s: string, _t: string, _p: CreateEventParams, _o: CreateEventOptions) => CreateEventResult | Promise<CreateEventResult>;
    readReviewStateFn?: (_s: string, _r?: string) => any;
    writeReviewStateFn?: typeof writeReviewState;
    currentState?: { metadata?: Record<string, unknown> } | null;
    missionStore?: MissionStore | null;
    recordImplementerResolutionFn?: typeof recordImplementerResolution;
    headRevisionFn?: (_worktree: string) => string;
  } = {}
): Promise<{ consumed: boolean; ok?: boolean; disposition?: string | null; diagnostic?: string | null }> {
  const log = options.log || fmt.log.plain;
  const error = options.error || fmt.log.plainError;
  const readArtifactFn = options.readArtifactFn || readArtifactFile;
  const deleteArtifactFn = options.deleteArtifactFn || deleteArtifactFile;
  const worktree = options.worktree || resolveWorktree(slug) || process.cwd();
  const tmpDir = options.tmpDir || resolveArtifactDir(worktree);
  const providerEnabled = options.providerEnabled !== null && options.providerEnabled !== undefined
    ? options.providerEnabled
    : (options.forgejoEnabled !== null && options.forgejoEnabled !== undefined ? options.forgejoEnabled : isEnabled(worktree));
  const reviewStatePath = reviewStateFile(slug, worktree);

  const resolutionResolved = resolveArtifactRead(slug, 'round-resolution.md', { tmpDir, readArtifactFn });
  const dispositionResolved = resolveArtifactRead(slug, 'review-disposition.txt', { tmpDir, readArtifactFn });
  const resolutionPath = resolutionResolved.path;
  const dispositionPath = dispositionResolved.path;

  const resolution = resolutionResolved.value;
  const dispositionRaw = dispositionResolved.value;
  const disposition = normalizeDisposition(dispositionRaw || '');
  const hasAny = resolution !== null || dispositionRaw !== null;

  if (!hasAny) {
    return { consumed: false };
  }
  if (!resolution || !disposition) {
    const missingImplParts: string[] = [];
    if (!resolution) { missingImplParts.push('round-resolution'); }
    if (!disposition) { missingImplParts.push('disposition'); }
    if (!providerEnabled) {
      const statePathStr = reviewStatePath ? ` local review state at ${reviewStatePath}; ` : ' ';
      error(fmt.status('FAIL', `Incomplete implementer artifacts for ${slug}. Expected ${resolutionPath} and ${dispositionPath}.${statePathStr}No provider review posted (provider=none); add review-disposition.txt and a round resolution, or use \`node parallix review <slug> --submit-review approve\`.`));
    } else {
      error(fmt.status('FAIL', `Incomplete implementer artifacts for ${slug}. Expected ${resolutionPath} and ${dispositionPath}.`));
    }
    return { consumed: true, ok: false, diagnostic: `Implementer artifacts incomplete: missing ${missingImplParts.join(', ')}` };
  }

  const currentState = await Promise.resolve((options.readReviewStateFn || readReviewState)(slug, worktree));
  const round = currentState ? currentState.round : 1;
  const phase = currentState ? currentState.phase : 'fixing';

  const createEventFn = options.createEventFn || createEvent;

  let itemDispositions: import('../../domain/review.js').ReviewItemDisposition[] = [];
  let blockedReason: string | null = null;

  try {
    const fixedMatch = resolution.match(/fixed_items:\s*(\[[^\]]*\])/i);
    const pushedMatch = resolution.match(/pushed_back_items:\s*(\[[^\]]*\])/i);
    const parkedMatch = resolution.match(/parked_items:\s*(\[[^\]]*\])/i);
    const blockedMatch = resolution.match(/blocked_reason:\s*"([^"]*)"/i);

    if (fixedMatch) {
      const ids = JSON.parse(fixedMatch[1]) as string[];
      itemDispositions.push(...ids.map((id) => ({ kind: 'fixed' as const, findingId: id as import('../../domain/review.js').ReviewFindingId })));
    }
    if (pushedMatch) {
      const ids = JSON.parse(pushedMatch[1]) as string[];
      itemDispositions.push(...ids.map((id) => ({ kind: 'pushed_back' as const, findingId: id as import('../../domain/review.js').ReviewFindingId })));
    }
    if (parkedMatch) {
      const ids = JSON.parse(parkedMatch[1]) as string[];
      itemDispositions.push(...ids.map((id) => ({ kind: 'parked' as const, findingId: id as import('../../domain/review.js').ReviewFindingId })));
    }
    if (blockedMatch) { blockedReason = blockedMatch[1]; }
  } catch {
    itemDispositions = [];
  }

  if (disposition === 'BLOCKED' && !blockedReason) {
    const match = resolution.match(/blocked.*?:\s*(.+)/i);
    if (match) { blockedReason = match[1].trim(); }
  }

  const summaryEventResult = await createEventFn(slug, VALID_EVENT_TYPES.IMPLEMENTER_ROUND_SUMMARY, {
    content: resolution, round, phase, actor: implementer,
    itemDispositions,
    ...(disposition === 'BLOCKED' && blockedReason ? { blockedReason } : {})
  }, { worktree, skipGit: true, log: log, error });

  if (!summaryEventResult.ok) {
    const summaryErr = (summaryEventResult as { error?: string }).error;
    error(fmt.status('FAIL', `Failed to persist implementer round summary to repo store: ${summaryErr}`));
    return { consumed: true, ok: false, diagnostic: `Implementer artifact persist failed (round-summary): ${summaryErr}` };
  }

  const dispositionEventResult = await createEventFn(slug, VALID_EVENT_TYPES.IMPLEMENTER_DISPOSITION, {
    content: `Autonomous review disposition: ${disposition}`, round, phase, actor: implementer, disposition
  }, { worktree, skipGit: true, log: log, error });

  if (!dispositionEventResult.ok) {
    const dispErr = (dispositionEventResult as { error?: string }).error;
    error(fmt.status('FAIL', `Failed to persist implementer disposition to repo store: ${dispErr}`));
    return { consumed: true, ok: false, diagnostic: `Implementer artifact persist failed (disposition): ${dispErr}` };
  }

  log(fmt.status('INFO', `Persisted implementer artifacts to repo store: ${(summaryEventResult as { path?: string }).path}, ${(dispositionEventResult as { path?: string }).path}`));

  // Close the round on the aggregate. `ready-for-next-round` is the state the
  // next handoff needs to open round N+1 on the same pull request.
  if (disposition !== 'BLOCKED') {
    const recordImplementerResolutionFn = options.recordImplementerResolutionFn || recordImplementerResolution;
    const headRevisionFn = options.headRevisionFn || headRevision;
    let resultingRevision: string;
    try {
      resultingRevision = headRevisionFn(worktree);
    } catch (revisionError) {
      const revErr = (revisionError as Error).message;
      error(fmt.status('FAIL', `Could not record the implementer resolution for ${slug}: ${revErr}`));
      return { consumed: true, ok: false, diagnostic: `Implementer resolution persist failed: ${revErr}` };
    }
    const resolution2 = await recordImplementerResolutionFn(slug, {
      itemDispositions,
      evidence: `${disposition} — implementer round summary for ${slug}`,
      resultingRevision,
      respondedAt: new Date().toISOString(),
    }, { missionStore: options.missionStore });
    if (resolution2.outcome === 'failed') {
      error(fmt.status('FAIL', `Could not record the implementer resolution for ${slug}: ${resolution2.diagnostic}`));
      return { consumed: true, ok: false, diagnostic: `Implementer resolution persist failed: ${resolution2.diagnostic}` };
    }
    if (resolution2.outcome === 'unchanged') {
      log(fmt.status('INFO', `Implementer resolution for ${slug} already recorded (${resolution2.reason}).`));
    }
  }

  if (providerEnabled && options.readTokenFn && options.getCommentsFn) {
    await consumeHumanNotes(slug, implementer, {
      getCommentsFn: options.getCommentsFn,
      createEventFn: createEventFn as any,
      readTokenFn: options.readTokenFn,
      reviewIdentity: implementer,
      worktree,
      writeReviewStateFn: options.writeReviewStateFn,
      currentState: options.currentState,
      log: log,
      error
    });
  }

  if (providerEnabled) {
    const resolutionResult = await postWorkflowComment(slug, resolution, {
      rootDir: worktree,
      reviewIdentity: implementer,
      readTokenFn: options.readTokenFn,
      postCommentFn: options.postCommentFn,
      buildMetadataFooterFn: options.buildMetadataFooterFn,
      log: log,
      error
    });
    if (!resolutionResult.ok) {
      return { consumed: true, ok: false, diagnostic: `Implementer resolution post failed: ${(resolutionResult as { error?: string }).error}` };
    }

    const dispositionResult = await postWorkflowComment(slug, `Autonomous review disposition: ${disposition}`, {
      rootDir: worktree,
      reviewIdentity: implementer,
      readTokenFn: options.readTokenFn,
      postCommentFn: options.postCommentFn,
      buildMetadataFooterFn: options.buildMetadataFooterFn,
      log: log,
      error
    });
    if (!dispositionResult.ok) {
      return { consumed: true, ok: false, diagnostic: `Implementer disposition post failed: ${(dispositionResult as { error?: string }).error}` };
    }
  } else {
    log(fmt.status('INFO', `Review provider disabled; skipping PR mirroring for ${slug}`));
  }

  deleteArtifactFn(resolutionPath);
  deleteArtifactFn(dispositionPath);

  return { consumed: true, ok: true, disposition };
}

// ============================================================================
// Role-Owned Artifact Recovery Dispatcher
// ============================================================================

/**
 * Producing role for review-loop artifacts.
 * Maps artifact categories to the agent role that produces them.
 */
export type ArtifactRole = 'reviewer' | 'implementer';

/**
 * Dispatch decision for an artifact failure.
 * `relaunch` — relaunch the producing role with a fix prompt
 * `strand` — retry bound exhausted; record stranded state for human intervention
 */
export type ArtifactDispatchAction = 'relaunch' | 'strand';

export interface ArtifactDispatchResult {
  action: ArtifactDispatchAction;
  role: ArtifactRole;
  diagnostic: string;
  retryCount: number;
  maxRetries: number;
  /**
   * Updated metadata object. Callers should merge this into their in-memory
   * ReviewState to keep retry counters and strand markers in sync with disk.
   * Present whenever the dispatcher mutates metadata (relaunch or strand).
   */
  metadata?: Record<string, unknown>;
}

/**
 * Default maximum retry attempts for artifact recovery per role.
 * Aligned with existing reviewer/implementer timeout retry bounds.
 */
const MAX_ARTIFACT_RETRY = 2;

/**
 * Metadata key for per-role artifact retry counts.
 * Stored in ReviewState.metadata so counters are independent of timeout retries.
 */
const REVIEWER_ARTIFACT_RETRY_KEY = 'reviewerArtifactRetryCount';
const IMPLEMENTER_ARTIFACT_RETRY_KEY = 'implementerArtifactRetryCount';

/**
 * Check if a diagnostic string indicates an infrastructure failure
 * (provider-post or repo-store-persist) rather than an artifact production
 * failure (missing/malformed content).
 *
 * Infrastructure diagnostics contain "post failed" or "persist failed" markers
 * emitted by consumeReviewerArtifacts / consumeImplementerArtifacts on
 * downstream Forgejo/network/storage errors. These map to ADR 0048 InfraBlocker
 * (HumanOnly) and must not be dispatched to the artifact recovery dispatcher.
 *
 * @param diagnostic - The diagnostic string from consume*Artifacts
 * @returns true if this is an infrastructure-level failure
 */
export function isArtifactInfraDiagnostic(diagnostic: string | undefined | null): boolean {
  if (!diagnostic) { return false; }
  return diagnostic.includes('post failed') || diagnostic.includes('persist failed');
}

/**
 * Dispatch an artifact failure to the producing role with bounded retry.
 *
 * Reads persisted retry count from ReviewState.metadata, increments it,
 * persists the updated state, and returns the dispatch decision.
 * When the retry bound is exhausted, returns `strand` with an actionable
 * stranded state recorded in metadata.
 *
 * ADR 0048: artifact failures (missing/malformed) map to MissingArtifacts
 * which is AutoSendBack — the producing role relaunches. This dispatcher
 * does not reinterpret that policy; it enforces the role-aware routing
 * and retry bound.
 *
 * When `options.state` is provided, the function also updates the in-memory
 * state's metadata so the caller's next persist carries the counters.
 *
 * @param role - The producing role ('reviewer' or 'implementer')
 * @param diagnostic - Captured diagnostic describing the artifact failure
 * @param options - Dependencies for state persistence and logging
 * @returns Dispatch decision with retry metadata
 */
export async function dispatchArtifactFailure(
  role: ArtifactRole,
  diagnostic: string,
  options: {
    slug: string;
    worktree: string;
    maxRetries?: number;
    writeReviewStateFn?: typeof writeReviewState;
    readReviewStateFn?: (_s: string, _r: string) => Promise<any>;
    missionStore?: MissionStore | null;
    log?: (_msg: string) => void;
    error?: (_msg: string) => void;
    /**
     * In-memory ReviewState held by the caller. When provided, the dispatcher
     * syncs metadata mutations (retry count, strand markers) into this object
     * so the caller's next persist does not clobber disk state.
     */
    state?: { metadata?: Record<string, unknown> } | null;
  }
): Promise<ArtifactDispatchResult> {
  const { slug, worktree, maxRetries = MAX_ARTIFACT_RETRY } = options;
  const writeReviewStateFn = options.writeReviewStateFn || writeReviewState;
  const readReviewStateFn = options.readReviewStateFn || readReviewState;
  const log = options.log || fmt.log.plain;
  const error = options.error || fmt.log.plainError;
  const missionStore = options.missionStore || null;

  const retryKey = role === 'reviewer' ? REVIEWER_ARTIFACT_RETRY_KEY : IMPLEMENTER_ARTIFACT_RETRY_KEY;

  // Read persisted state
  const persisted = await Promise.resolve(readReviewStateFn(slug, worktree));
  const retryCount = persisted && persisted.metadata && typeof persisted.metadata === 'object'
    ? (Number((persisted.metadata as any)[retryKey]) || 0)
    : 0;

  if (retryCount >= maxRetries) {
    // Retry bound exhausted — strand with actionable state
    const metadata = persisted && persisted.metadata && typeof persisted.metadata === 'object'
      ? { ...persisted.metadata }
      : {};
    metadata[retryKey] = retryCount;
    metadata[`${role}ArtifactStrandedAt`] = new Date().toISOString();
    metadata[`${role}ArtifactStrandReason`] = diagnostic;
    if (persisted) {
      await persistReviewStateOrThrow(writeReviewStateFn, slug, { ...persisted, metadata } as any, worktree, missionStore);
    } else {
      await persistReviewStateOrThrow(writeReviewStateFn, slug, { metadata } as any, worktree, missionStore);
    }

    // Sync in-memory state so caller's next persist carries strand markers
    if (options.state && options.state.metadata) {
      options.state.metadata = { ...options.state.metadata, ...metadata };
    }

    error(fmt.status('FAIL', `${role === 'reviewer' ? 'Reviewer' : 'Implementer'} artifact recovery exhausted (${retryCount}/${maxRetries}). Mission stranded for ${slug}.`));
    error(fmt.status('FAIL', `Diagnostic: ${diagnostic}. Human intervention required.`));
    return { action: 'strand', role, diagnostic, retryCount, maxRetries, metadata };
  }

  // Increment and persist
  const newCount = retryCount + 1;
  const metadata = persisted && persisted.metadata && typeof persisted.metadata === 'object'
    ? { ...persisted.metadata }
    : {};
  metadata[retryKey] = newCount;
  if (persisted) {
    await persistReviewStateOrThrow(writeReviewStateFn, slug, { ...persisted, metadata } as any, worktree, missionStore);
  } else {
    await persistReviewStateOrThrow(writeReviewStateFn, slug, { metadata } as any, worktree, missionStore);
  }

  // Sync in-memory state so caller's next persist carries the counter
  if (options.state && options.state.metadata) {
    options.state.metadata = { ...options.state.metadata, ...metadata };
  }

  log(fmt.status('INFO', `${role === 'reviewer' ? 'Reviewer' : 'Implementer'} artifact failure — relaunching ${role} (retry ${newCount}/${maxRetries}). Diagnostic: ${diagnostic}`));
  return { action: 'relaunch', role, diagnostic, retryCount: newCount, maxRetries, metadata };
}

// Module exports
export {
  buildMetadataFooter,
  reviewArtifactPath,
  resolveArtifactDir,
  readArtifactFile,
  deleteArtifactFile,
  normalizeReviewVerdict,
  normalizeDisposition,
  postWorkflowComment,
  postWorkflowReview,
  consumeReviewerArtifacts,
  consumeImplementerArtifacts,
  MAX_ARTIFACT_RETRY,
  REVIEWER_ARTIFACT_RETRY_KEY,
  IMPLEMENTER_ARTIFACT_RETRY_KEY,
};

