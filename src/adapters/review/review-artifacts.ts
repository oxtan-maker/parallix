/**
 * Review Artifacts Module - Utility Functions
 * Resolves, validates, persists, and mirrors reviewer and implementer artifacts.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as fmt from '../../application/presentation/cli-format.js';
import { missionBranchName, resolveWorktree } from '../filesystem/mission-utils.js';
import { readReviewState, writeReviewState, reviewStateFile, ReviewState, resolveReviewIdentity, persistReviewStateOrThrow } from './review-state.js';
import { readToken, postComment, postReview, getPrAuthor, isEnabled, resolveArtifactDir as resolveConfiguredArtifactDir } from './review-adapter.js';
import { createEvent, consumeHumanNotes, VALID_EVENT_TYPES, CreateEventParams, CreateEventOptions, CreateEventResult } from './review-events.js';

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
  } = {}
): Promise<void> {
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
  await persistReviewStateOrThrow(writeReviewStateFn, slug, state, worktree);

  createEventFn(slug, VALID_EVENT_TYPES.REVIEWER_OUTCOME, { verdict: outcome, content: `Review verdict: ${outcome}` }, { worktree, log: log, error });
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
  } = {}
): Promise<{ consumed: boolean; ok?: boolean; reviewState?: string | null }> {
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
    if (!providerEnabled) {
      const statePathStr = reviewStatePath ? ` local review state at ${reviewStatePath}; ` : ' ';
      error(fmt.status('FAIL', `Incomplete reviewer artifacts for ${slug}. Expected ${findingsPath} and ${outcomePath}.${statePathStr}No provider review posted (provider=none); add a review-outcome.md with a Verdict line or use \`node parallix review <slug> --submit-review approve\`.`));
    } else {
      error(fmt.status('FAIL', `Incomplete reviewer artifacts for ${slug}. Expected ${findingsPath} and ${outcomePath}.`));
    }
    return { consumed: true, ok: false };
  }
  if (!verdict) {
    if (!providerEnabled) {
      const statePathStr = reviewStatePath ? ` local review state at ${reviewStatePath}; ` : ' ';
      error(fmt.status('FAIL', `Reviewer artifacts for ${slug} missing verdict. Expected in ${verdictPath} or in ${outcomePath} content.${statePathStr}No provider review posted (provider=none); add a review-outcome.md with a Verdict line or use \`node parallix review <slug> --submit-review approve\`.`));
    } else {
      error(fmt.status('FAIL', `Reviewer artifacts for ${slug} missing verdict. Expected in ${verdictPath} or in ${outcomePath} content.`));
    }
    return { consumed: true, ok: false };
  }

  const currentState = await Promise.resolve((options.readReviewStateFn || readReviewState)(slug, worktree));
  const round = currentState ? currentState.round : 1;
  const phase = currentState ? currentState.phase : 'reviewing';

  const createEventFn = options.createEventFn || createEvent;
  const findingsEventResult = await createEventFn(slug, VALID_EVENT_TYPES.REVIEWER_FINDINGS, {
    content: findings, round, phase, actor: reviewer
  }, { worktree, skipGit: true, log: log, error });

  if (!findingsEventResult.ok) {
    error(fmt.status('FAIL', `Failed to persist reviewer findings to repo store: ${(findingsEventResult as { error?: string }).error}`));
    return { consumed: true, ok: false };
  }

  const outcomeEventResult = await createEventFn(slug, VALID_EVENT_TYPES.REVIEWER_OUTCOME, {
    content: outcomeMessage, round, phase, actor: reviewer, verdict
  }, { worktree, skipGit: true, log: log, error });

  if (!outcomeEventResult.ok) {
    error(fmt.status('FAIL', `Failed to persist reviewer outcome to repo store: ${(outcomeEventResult as { error?: string }).error}`));
    return { consumed: true, ok: false };
  }

  log(fmt.status('INFO', `Persisted reviewer artifacts to repo store: ${(findingsEventResult as { path?: string }).path}, ${(outcomeEventResult as { path?: string }).path}`));

  if (providerEnabled && options.readTokenFn && options.getCommentsFn) {
    await consumeHumanNotes(slug, reviewer, {
      getCommentsFn: options.getCommentsFn,
      createEventFn: createEventFn as any,
      readTokenFn: options.readTokenFn,
      reviewIdentity: reviewer,
      worktree,
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
      return { consumed: true, ok: false };
    }

    const reviewResult = await postWorkflowReview(slug, verdict, outcomeMessage, {
      worktree,
      reviewIdentity: reviewer,
      readTokenFn: options.readTokenFn,
      postReviewFn: options.postReviewFn,
      buildMetadataFooterFn: options.buildMetadataFooterFn,
      log: log,
      error
    });
    if (!reviewResult.ok) {
      return { consumed: true, ok: false };
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
  } = {}
): Promise<{ consumed: boolean; ok?: boolean; disposition?: string | null }> {
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
    if (!providerEnabled) {
      const statePathStr = reviewStatePath ? ` local review state at ${reviewStatePath}; ` : ' ';
      error(fmt.status('FAIL', `Incomplete implementer artifacts for ${slug}. Expected ${resolutionPath} and ${dispositionPath}.${statePathStr}No provider review posted (provider=none); add review-disposition.txt and a round resolution, or use \`node parallix review <slug> --submit-review approve\`.`));
    } else {
      error(fmt.status('FAIL', `Incomplete implementer artifacts for ${slug}. Expected ${resolutionPath} and ${dispositionPath}.`));
    }
    return { consumed: true, ok: false };
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
    error(fmt.status('FAIL', `Failed to persist implementer round summary to repo store: ${(summaryEventResult as { error?: string }).error}`));
    return { consumed: true, ok: false };
  }

  const dispositionEventResult = await createEventFn(slug, VALID_EVENT_TYPES.IMPLEMENTER_DISPOSITION, {
    content: `Autonomous review disposition: ${disposition}`, round, phase, actor: implementer, disposition
  }, { worktree, skipGit: true, log: log, error });

  if (!dispositionEventResult.ok) {
    error(fmt.status('FAIL', `Failed to persist implementer disposition to repo store: ${(dispositionEventResult as { error?: string }).error}`));
    return { consumed: true, ok: false };
  }

  log(fmt.status('INFO', `Persisted implementer artifacts to repo store: ${(summaryEventResult as { path?: string }).path}, ${(dispositionEventResult as { path?: string }).path}`));

  if (providerEnabled && options.readTokenFn && options.getCommentsFn) {
    await consumeHumanNotes(slug, implementer, {
      getCommentsFn: options.getCommentsFn,
      createEventFn: createEventFn as any,
      readTokenFn: options.readTokenFn,
      reviewIdentity: implementer,
      worktree,
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
      return { consumed: true, ok: false };
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
      return { consumed: true, ok: false };
    }
  } else {
    log(fmt.status('INFO', `Review provider disabled; skipping PR mirroring for ${slug}`));
  }

  deleteArtifactFn(resolutionPath);
  deleteArtifactFn(dispositionPath);

  return { consumed: true, ok: true, disposition };
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
  consumeImplementerArtifacts
};
