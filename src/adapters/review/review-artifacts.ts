/**
 * Review Artifacts Module - Utility Functions
 * Resolves, validates, persists, and mirrors reviewer and implementer artifacts.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as fmt from '../../application/presentation/cli-format.js';
import { git } from '../git/git.js';
import { missionBranchName, resolveWorktree } from '../filesystem/mission-utils.js';
import { readReviewState, writeReviewState, reviewStateFile, ReviewState, resolveReviewIdentity, persistReviewStateOrThrow, type ReviewStateData } from './review-state.js';
import {
  rebound,
  DEFAULT_REBOUND_ATTEMPTS,
  type ReboundContext,
  type ReboundStartAgent,
  type VerifyResult,
} from '../../application/rebound-kernel.js';
import type { MissionStore } from '../../application/domain-ports.js';
import { parseResolutionDispositions, type ReviewFinding, type ReviewItemDisposition } from '../../domain/review.js';
import { readToken, postComment, postReview, getPrAuthor, isEnabled, resolveArtifactDir as resolveConfiguredArtifactDir } from './review-adapter.js';
import { createEvent, consumeHumanNotes, VALID_EVENT_TYPES, CreateEventParams, CreateEventOptions, CreateEventResult } from './review-events.js';
import { parseReviewFindings, recordImplementerResolution, recordRequestedChanges, recordApproval } from './review-round.js';
import type { MissionLifecycleService } from '../../application/mission-lifecycle-service.js';

type CreateResult = { ok: boolean; path: string | null; error?: string | null; event?: unknown };
type CreateEventFn = (_s: string, _t: string, _p: Record<string, unknown>, _o: Record<string, unknown>) => CreateResult | Promise<CreateResult>;
type ReviewStateReader = (_s: string, _r?: string, _store?: MissionStore | null) => ReviewState | ReviewStateData | null | Promise<ReviewState | ReviewStateData | null>;

// ============================================================================
// Metadata Footer
// ============================================================================

async function buildMetadataFooter(slug: string, rootDir = process.cwd(), missionStore: MissionStore | null = null): Promise<string> {
  const state = await readReviewState(slug, rootDir, missionStore);
  if (!state) { return ''; }
  return `\n\n---\n\`[workflow-round:${state.round}, workflow-phase:${state.phase}]\``;
}

// ============================================================================
// Artifact Path Utilities
// ============================================================================

function reviewArtifactPath(slug: string, artifactName: string, tmpDir = os.tmpdir()): string {
  return path.join(tmpDir, `${slug}-${artifactName}`);
}

// ============================================================================
// Typed-transport rendering (one-way export)
// ============================================================================

/**
 * Render typed findings as the Markdown the review event and the provider
 * comment carry. One direction only: the domain already has the findings, so
 * nothing reads this back.
 */
/**
 * Fast pre-check that refuses a review write whose caller read an older Mission.
 *
 * Not the authority: the recorders commit with a compare-and-swap on the
 * version they check, and that is what makes a submission atomic. This runs
 * first so an obviously stale caller is turned away before any work, and it is
 * the only guard on the paths that record no decision at all — a `BLOCKED`
 * resolution writes events without reaching a recorder.
 */
async function staleReviewWrite(
  slug: string,
  expectedVersion: number | undefined,
  missionStore: MissionStore | null | undefined,
): Promise<string | null> {
  if (expectedVersion === undefined || !missionStore) { return null; }
  if (typeof (missionStore as { load?: unknown }).load !== 'function') { return null; }
  const loaded = await missionStore.load(slug as never);
  if (loaded.kind !== 'found') { return null; }
  const actual = (loaded as { version: number }).version;
  if (actual === expectedVersion) { return null; }
  return `stale write for ${slug}: expected version ${expectedVersion}, found ${actual}. `
    + `Re-read \`px status ${slug}\` and retry.`;
}

function renderFindings(findings: readonly ReviewFinding[]): string {
  if (findings.length === 0) { return 'No findings.'; }
  return findings
    .map((finding) => `## ${finding.id}: ${finding.summary}${finding.location ? `\n\nLocation: ${finding.location}` : ''}`)
    .join('\n\n');
}

/** The same one-way render for an implementer's round resolution. */
function renderResolution(output: {
  items: readonly ReviewItemDisposition[];
  evidence: readonly string[];
  blockedReason?: string | null;
}): string {
  const ids = (kind: ReviewItemDisposition['kind']) =>
    output.items.filter((item) => item.kind === kind).map((item) => item.findingId);
  return [
    `fixed_items: ${JSON.stringify(ids('fixed'))}`,
    `pushed_back_items: ${JSON.stringify(ids('pushed_back'))}`,
    `parked_items: ${JSON.stringify(ids('parked'))}`,
    ...(output.blockedReason ? [`blocked_reason: ${JSON.stringify(output.blockedReason)}`] : []),
    '',
    output.evidence.join('\n'),
  ].join('\n');
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
    buildMetadataFooterFn?: (_s: string, _r?: string, _store?: MissionStore | null) => string | Promise<string>;
    readReviewStateFn?: ReviewStateReader;
    rootDir?: string;
    reviewIdentity?: string;
    forgejoUser?: string;
    missionStore?: MissionStore | null;
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
    || (await resolveReviewIdentity(slug, rootDir, { readReviewStateFn: readReviewStateFn as typeof readReviewState })).commentIdentityUser
    || 'human';
  const reviewIdentity = identityResolved;
  const token = readTokenFn(reviewIdentity, { rootDir });
  if (!token) {
    error(fmt.status('FAIL', `No Forgejo token found for user "${reviewIdentity}". Cannot post comment.`));
    return { ok: false };
  }

  const taggedMessage = message + await Promise.resolve(buildMetadataFooterFn(slug, rootDir, options.missionStore ?? null));
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
    createEventFn?: CreateEventFn;
    readReviewStateFn?: ReviewStateReader;
    log?: (_msg: string) => void;
    error?: (_msg: string) => void;
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

  const existing = await Promise.resolve(readReviewStateFn(slug, worktree, missionStore));
  // TASK-2385: a read miss must not fabricate a round-1 verdict. The old
  // `round: 1` fallback silently downgraded the round and fed the stale-round
  // producer observed on task-2377.05. A verdict can only attach to a review
  // `px handoff` started, so fail closed rather than invent one.
  if (!existing) {
    throw new Error(
      `Cannot record review verdict for ${slug}: no review state found. A review must be started with \`px review ${slug} --start\` before recording a verdict; refusing to fabricate round 1`,
    );
  }
  const state = existing instanceof ReviewState
    ? existing
    : new ReviewState(slug, existing as ReviewStateData);
  if (outcome === 'approve') {
    state.disposition = 'APPROVED';
    state.metadata = { ...state.metadata, approvalOwed: true };
    try { state.transitionTo('approved'); } catch { /* ignore */ }
  } else if (outcome === 'request-changes') {
    state.disposition = 'REQUEST_CHANGES';
    try { state.transitionTo('fixing'); } catch { /* ignore */ }
  }
  await persistReviewStateOrThrow(writeReviewStateFn, slug, state, worktree, missionStore);
  const outcomeResult = await createEventFn(slug, VALID_EVENT_TYPES.REVIEWER_OUTCOME, {
    verdict: outcome,
    content: `Review verdict: ${outcome}`,
    ...(outcome === 'approve' ? { blockedReason: 'external-formal-approval-owed' } : {}),
  }, { worktree, log: log, error, missionStore });
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
    buildMetadataFooterFn?: (_s: string, _r?: string, _store?: MissionStore | null) => string | Promise<string>;
    readReviewStateFn?: ReviewStateReader;
    worktree?: string;
    reviewIdentity?: string;
    forgejoUser?: string;
    getPrAuthorFn?: (_branch: string, _token: string, _opts?: Record<string, unknown>) => unknown;
    writeReviewStateFn?: typeof writeReviewState;
    createEventFn?: CreateEventFn;
    missionStore?: MissionStore | null;
    lifecycleService?: MissionLifecycleService | null;
    recordApprovalFn?: typeof recordApproval;
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
    || (await resolveReviewIdentity(slug, worktree, { readReviewStateFn: readReviewStateFn as typeof readReviewState })).identityUser
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
    log(fmt.status('WARN', `Reviewer "${reviewIdentity}" is the PR author for ${branch}; skipping the provider review POST to avoid a self-approval (Forgejo rejects "approve your own pull is not allowed" with HTTP 422). Attempting to record the "${outcome}" verdict locally in the SQLite Review aggregate; a different agent or a human must post the formal approval.`));
    // An approve is a domain decision, not only a provider comment: it is what
    // leaves review through the approval boundary `px integrate` gates on. Record
    // it on the aggregate before the flat loop-state write so a round that cannot
    // legally reach `approved` (for example still in `fixing` after a
    // request-changes) fails loudly here instead of reporting a skipped POST and
    // leaving the mission unintegratable. A read miss below still surfaces as a
    // rejection rather than a swallowed failure.
    if (outcome === 'approve' && missionStore) {
      const recordApprovalFn = options.recordApprovalFn || recordApproval;
      const decision = await recordApprovalFn(slug, {
        comment: null,
        decidedAt: new Date().toISOString(),
        source: { kind: 'local' },
      }, { missionStore, lifecycleService: options.lifecycleService ?? null });
      if (decision.outcome === 'failed') {
        return { ok: false, error: `Could not record the approve decision for ${slug}: ${decision.diagnostic}` };
      }
      if (decision.outcome === 'unchanged') {
        log(`Review outcome "approve" for ${slug} already recorded (${decision.reason}).`);
      }
    }
    await recordLocalReviewVerdict(slug, outcome, {
      worktree,
      writeReviewStateFn: options.writeReviewStateFn,
      createEventFn: options.createEventFn,
      readReviewStateFn: readReviewStateFn as typeof readReviewState,
      log: log,
      error,
      missionStore,
    });
    return { ok: true, skipped: true, reason: 'self-author', prAuthor };
  }

  const taggedMessage = message + await Promise.resolve(buildMetadataFooterFn(slug, worktree, missionStore));
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

type ImplementerArtifactOptions = {
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
  /**
   * Typed inbound transport (`px resolve`). Same rule as the reviewer side: the
   * dispositions reach the domain typed, and the round-summary Markdown is
   * rendered here for the event body rather than parsed back out of it.
   */
  output?: {
    items: readonly ReviewItemDisposition[];
    evidence: readonly string[];
    blockedReason?: string | null;
    disposition: string;
    resultingRevision?: string;
  };
  /** Mission version the caller read; threaded to the recorder so a stale resolution fails closed. */
  expectedVersion?: number;
};

type RepoEventFn = (_s: string, _t: string, _p: CreateEventParams, _o: CreateEventOptions) => CreateEventResult | Promise<CreateEventResult>;

type ResolvedArtifactSet = {
  findings: string | null;
  outcomeMessage: string | null;
  verdictRaw: string | null;
  findingsPath: string;
  outcomePath: string;
  verdictPath: string;
};

type ResolvedImplementerArtifactSet = {
  resolution: string | null;
  dispositionRaw: string | null;
  resolutionPath: string;
  dispositionPath: string;
};

/** Provider flag precedence: explicit > forgejo alias > worktree config. */
function resolveProviderEnabled(options: { providerEnabled?: boolean | null; forgejoEnabled?: boolean | null }, worktree: string): boolean {
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
function typedImplementerArtifactSet(slug: string, tmpDir: string, output: { items: readonly ReviewItemDisposition[]; evidence: readonly string[]; blockedReason?: string | null; disposition: string }): ResolvedImplementerArtifactSet {
  return {
    resolution: renderResolution(output),
    dispositionRaw: output.disposition,
    resolutionPath: reviewArtifactPath(slug, 'round-resolution.md', tmpDir),
    dispositionPath: reviewArtifactPath(slug, 'review-disposition.txt', tmpDir),
  };
}

function resolveImplementerArtifactSet(slug: string, options: { tmpDir: string; readArtifactFn: typeof readArtifactFile }): ResolvedImplementerArtifactSet {
  const resolutionResolved = resolveArtifactRead(slug, 'round-resolution.md', { tmpDir: options.tmpDir, readArtifactFn: options.readArtifactFn });
  const dispositionResolved = resolveArtifactRead(slug, 'review-disposition.txt', { tmpDir: options.tmpDir, readArtifactFn: options.readArtifactFn });
  return {
    resolution: resolutionResolved.value,
    dispositionRaw: dispositionResolved.value,
    resolutionPath: resolutionResolved.path,
    dispositionPath: dispositionResolved.path,
  };
}

/** Persist the reviewer findings and outcome events to the repo store. */
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

async function consumeReviewerArtifacts(
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

type ImplementerArtifactFailure = { consumed: true; ok: false; diagnostic: string };

/** Name which of the two required implementer artifacts is missing, and why that is fatal. */
function reportIncompleteImplementerArtifacts(context: {
  slug: string; resolution: string | null; disposition: string | null;
  resolutionPath: string; dispositionPath: string; reviewStatePath: string | null;
  providerEnabled: boolean; error: (_msg: string) => void;
}): ImplementerArtifactFailure {
  const { slug, resolutionPath, dispositionPath, reviewStatePath, providerEnabled, error } = context;
  const missing: string[] = [];
  if (!context.resolution) { missing.push('round-resolution'); }
  if (!context.disposition) { missing.push('disposition'); }
  const expected = `Incomplete implementer artifacts for ${slug}. Expected ${resolutionPath} and ${dispositionPath}.`;
  if (providerEnabled) {
    error(fmt.status('FAIL', expected));
  } else {
    // With provider=none there is no PR review to fall back on, so the local
    // state path is named: it is the only place the operator can repair this.
    const statePathStr = reviewStatePath ? ` local review state at ${reviewStatePath}; ` : ' ';
    error(fmt.status('FAIL', `${expected}${statePathStr}No provider review posted (provider=none); add review-disposition.txt and a round resolution, or use \`node parallix review <slug> --submit-review approve\`.`));
  }
  return { consumed: true, ok: false, diagnostic: `Implementer artifacts incomplete: missing ${missing.join(', ')}` };
}

/**
 * Item dispositions and the blocked reason carried by a round resolution. A
 * malformed disposition list yields none rather than failing the round; a
 * BLOCKED disposition falls back to prose when no structured reason was given.
 */
function parseImplementerResolution(resolution: string, disposition: string): { itemDispositions: ReviewItemDisposition[]; blockedReason: string | null } {
  let itemDispositions: ReviewItemDisposition[] = [];
  let blockedReason: string | null = null;
  try {
    itemDispositions = [...parseResolutionDispositions(resolution)];
    const blockedMatch = resolution.match(/blocked_reason:\s*"([^"]*)"/i);
    if (blockedMatch) { blockedReason = blockedMatch[1]; }
  } catch {
    itemDispositions = [];
  }
  if (disposition === 'BLOCKED' && !blockedReason) {
    const match = resolution.match(/blocked.*?:\s*(.+)/i);
    if (match) { blockedReason = match[1].trim(); }
  }
  return { itemDispositions, blockedReason };
}

/**
 * Close the round on the aggregate so the next handoff can open round N+1 on
 * the same pull request. Returns a failure result, or null when the round
 * closed (or was already closed).
 */
async function closeImplementerRound(slug: string, context: {
  disposition: string; itemDispositions: ReviewItemDisposition[]; worktree: string;
  options: any; log: (_msg: string) => void; error: (_msg: string) => void;
}): Promise<ImplementerArtifactFailure | null> {
  const { disposition, itemDispositions, worktree, options, log, error } = context;
  const recordImplementerResolutionFn = options.recordImplementerResolutionFn || recordImplementerResolution;
  const headRevisionFn = options.headRevisionFn || headRevision;
  let resultingRevision: string;
  try {
    resultingRevision = options.output?.resultingRevision ?? headRevisionFn(worktree);
  } catch (revisionError) {
    const revErr = (revisionError as Error).message;
    error(fmt.status('FAIL', `Could not record the implementer resolution for ${slug}: ${revErr}`));
    return { consumed: true, ok: false, diagnostic: `Implementer resolution persist failed: ${revErr}` };
  }
  const recorded = await recordImplementerResolutionFn(slug, {
    itemDispositions,
    evidence: `${disposition} — implementer round summary for ${slug}`,
    resultingRevision,
    respondedAt: new Date().toISOString(),
    ...(options.expectedVersion === undefined ? {} : { expectedVersion: options.expectedVersion }),
  }, { missionStore: options.missionStore });
  if (recorded.outcome === 'failed') {
    error(fmt.status('FAIL', `Could not record the implementer resolution for ${slug}: ${recorded.diagnostic}`));
    return { consumed: true, ok: false, diagnostic: `Implementer resolution persist failed: ${recorded.diagnostic}` };
  }
  if (recorded.outcome === 'unchanged') {
    log(fmt.status('INFO', `Implementer resolution for ${slug} already recorded (${recorded.reason}).`));
  }
  return null;
}

/** Mirror the round resolution and its disposition onto the pull request. */
async function mirrorImplementerArtifacts(slug: string, context: {
  resolution: string; disposition: string; implementer: string; worktree: string;
  options: any; log: (_msg: string) => void; error: (_msg: string) => void;
}): Promise<ImplementerArtifactFailure | null> {
  const { resolution, disposition, implementer, worktree, options, log, error } = context;
  const postOptions = {
    rootDir: worktree, reviewIdentity: implementer, readTokenFn: options.readTokenFn,
    postCommentFn: options.postCommentFn, buildMetadataFooterFn: options.buildMetadataFooterFn, log, error,
  };
  for (const [body, label] of [[resolution, 'resolution'], [`Autonomous review disposition: ${disposition}`, 'disposition']] as const) {
    const result = await postWorkflowComment(slug, body, postOptions);
    if (!result.ok) {
      return { consumed: true, ok: false, diagnostic: `Implementer ${label} post failed: ${(result as { error?: string }).error}` };
    }
  }
  return null;
}

/** Persist the implementer round-summary and disposition events to the repo store. */
async function persistImplementerEvents(params: {
  slug: string;
  implementer: string;
  round: number | undefined;
  phase: string | undefined;
  resolution: string;
  disposition: string;
  itemDispositions: ReviewItemDisposition[];
  blockedReason: string | null;
  createEventFn: RepoEventFn;
  worktree: string;
  log: (_msg: string) => void;
  error: (_msg: string) => void;
}): Promise<{ ok: true } | { ok: false; diagnostic: string }> {
  const { slug, implementer, round, phase, resolution, disposition, itemDispositions, blockedReason, createEventFn, worktree, log, error } = params;
  const summaryEventResult = await createEventFn(slug, VALID_EVENT_TYPES.IMPLEMENTER_ROUND_SUMMARY, {
    content: resolution, round, phase, actor: implementer,
    itemDispositions,
    ...(disposition === 'BLOCKED' && blockedReason ? { blockedReason } : {})
  }, { worktree, skipGit: true, log: log, error });

  if (!summaryEventResult.ok) {
    const summaryErr = (summaryEventResult as { error?: string }).error;
    error(fmt.status('FAIL', `Failed to persist implementer round summary to repo store: ${summaryErr}`));
    return { ok: false, diagnostic: `Implementer artifact persist failed (round-summary): ${summaryErr}` };
  }

  const dispositionEventResult = await createEventFn(slug, VALID_EVENT_TYPES.IMPLEMENTER_DISPOSITION, {
    content: `Autonomous review disposition: ${disposition}`, round, phase, actor: implementer, disposition
  }, { worktree, skipGit: true, log: log, error });

  if (!dispositionEventResult.ok) {
    const dispErr = (dispositionEventResult as { error?: string }).error;
    error(fmt.status('FAIL', `Failed to persist implementer disposition to repo store: ${dispErr}`));
    return { ok: false, diagnostic: `Implementer artifact persist failed (disposition): ${dispErr}` };
  }

  log(fmt.status('INFO', `Persisted implementer artifacts to repo store: ${(summaryEventResult as { path?: string }).path}, ${(dispositionEventResult as { path?: string }).path}`));
  return { ok: true };
}

async function consumeImplementerArtifacts(
  slug: string,
  implementer: string,
  options: ImplementerArtifactOptions = {}
): Promise<{ consumed: boolean; ok?: boolean; disposition?: string | null; diagnostic?: string | null }> {
  const log = options.log || fmt.log.plain;
  const error = options.error || fmt.log.plainError;
  const readArtifactFn = options.readArtifactFn || readArtifactFile;
  const deleteArtifactFn = options.deleteArtifactFn || deleteArtifactFile;
  const worktree = options.worktree || resolveWorktree(slug) || process.cwd();
  const tmpDir = options.tmpDir || resolveArtifactDir(worktree);
  const providerEnabled = resolveProviderEnabled(options, worktree);
  const reviewStatePath = reviewStateFile(slug, worktree);

  const artifacts = options.output
    ? typedImplementerArtifactSet(slug, tmpDir, options.output)
    : resolveImplementerArtifactSet(slug, { tmpDir, readArtifactFn });
  const disposition = normalizeDisposition(artifacts.dispositionRaw || '');
  const hasAny = artifacts.resolution !== null || artifacts.dispositionRaw !== null;

  if (!hasAny) {
    return { consumed: false };
  }
  if (!artifacts.resolution || !disposition) {
    return reportIncompleteImplementerArtifacts({ slug, resolution: artifacts.resolution, disposition, resolutionPath: artifacts.resolutionPath, dispositionPath: artifacts.dispositionPath, reviewStatePath, providerEnabled: Boolean(providerEnabled), error });
  }

  const staleResolution = await staleReviewWrite(slug, options.expectedVersion, options.missionStore);
  if (staleResolution) {
    error(fmt.status('FAIL', staleResolution));
    return { consumed: true, ok: false, diagnostic: staleResolution };
  }

  const currentState = await Promise.resolve((options.readReviewStateFn || readReviewState)(slug, worktree));
  const round = currentState ? currentState.round : 1;
  const phase = currentState ? currentState.phase : 'fixing';

  const { itemDispositions, blockedReason } = options.output
    ? { itemDispositions: [...options.output.items], blockedReason: options.output.blockedReason ?? null }
    : parseImplementerResolution(artifacts.resolution, disposition);

  // Close the round on the aggregate. `ready-for-next-round` is the state the
  // next handoff needs to open round N+1 on the same pull request.
  //
  // Committed before the round-summary events, and pinned to the version the
  // caller read: the events advance the Mission, so a resolution recorded after
  // them could neither check the caller's version nor notice a concurrent write
  // that landed in between. The recorder saves with a compare-and-swap on the
  // version it checks, which is what makes this atomic rather than pre-checked.
  if (disposition !== 'BLOCKED') {
    const closed = await closeImplementerRound(slug, { disposition, itemDispositions, worktree, options, log, error });
    if (closed) { return closed; }
  }

  const persisted = await persistImplementerEvents({
    slug, implementer, round, phase, resolution: artifacts.resolution, disposition, itemDispositions, blockedReason,
    createEventFn: options.createEventFn || createEvent, worktree, log, error,
  });
  if (!persisted.ok) { return { consumed: true, ok: false, diagnostic: 'diagnostic' in persisted ? persisted.diagnostic : 'implementer event persistence failed' }; }

  if (providerEnabled && options.readTokenFn && options.getCommentsFn) {
    await consumeHumanNotes(slug, implementer, {
      getCommentsFn: options.getCommentsFn,
      createEventFn: (options.createEventFn || createEvent) as any,
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
    const mirrored = await mirrorImplementerArtifacts(slug, { resolution: artifacts.resolution, disposition, implementer, worktree, options, log, error });
    if (mirrored) { return mirrored; }
  } else {
    log(fmt.status('INFO', `Review provider disabled; skipping PR mirroring for ${slug}`));
  }

  if (!options.output) {
    deleteArtifactFn(artifacts.resolutionPath);
    deleteArtifactFn(artifacts.dispositionPath);
  }

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
 * Outcome of one artifact-failure occurrence, mapped from the rebound kernel.
 * `fixed` — the relaunched role's artifacts were re-consumed and are complete
 * `strand` — the per-occurrence attempt budget is spent; human intervention
 * `human-only` — the ADR 0048 table says no agent relaunch can fix this
 */
export type ArtifactDispatchAction = 'fixed' | 'strand' | 'human-only';

export interface ArtifactDispatchResult {
  action: ArtifactDispatchAction;
  role: ArtifactRole;
  /** Last diagnostic observed: the verify re-consume's, or the original one. */
  diagnostic: string;
  /** Completed repair attempts consumed by this occurrence. */
  attempts: number;
  maxAttempts: number;
  /** Agent that ran the final attempt (fallback-resolved). */
  agent: string;
}

/**
 * Per-occurrence attempt budget for artifact recovery.
 *
 * The kernel's budget is per local failure and in-memory: every occurrence
 * starts fresh, nothing is persisted (TASK-2377.04 deleted the review-state
 * metadata retry counters this dispatcher used to read and write).
 */
export const ARTIFACT_REBOUND_ATTEMPTS = DEFAULT_REBOUND_ATTEMPTS;

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
 * Bounce one artifact-failure occurrence back to the producing role.
 *
 * This is the artifact-path adapter over the rebound kernel
 * (`src/application/rebound-kernel.ts`): the kernel owns classification (ADR
 * 0048), the fix prompt, the launch, the verify loop, and the attempt budget;
 * this function contributes the structured `artifact-incomplete` reason and
 * the role-aware collaborators.
 *
 * `verifyFn` re-consumes the role's artifacts. The occurrence is only reported
 * `fixed` when that re-consumption returns complete, ok artifacts — a relaunch
 * on its own is no evidence that the artifacts exist.
 *
 * Nothing is persisted: the budget is per occurrence and in-memory.
 *
 * @param role - The producing role ('reviewer' or 'implementer')
 * @param diagnostic - Captured diagnostic describing the artifact failure
 * @param options - Verify callback, launch port, and role collaborators
 */
export async function dispatchArtifactFailure(
  role: ArtifactRole,
  diagnostic: string,
  options: {
    slug: string;
    worktree: string;
    /** Agent identity to relaunch for this role. */
    agent: string;
    /** Re-consumes the role's artifacts; `ok` only when they are complete. */
    verifyFn: (_attempt: number) => Promise<VerifyResult> | VerifyResult;
    /** Role-shaped launch port (step, role, exclude, base prompt). */
    startAgentFn: ReboundStartAgent;
    applyAgentFallbackFn?: ReboundContext['applyAgentFallback'];
    transitionToImplementerFn?: ReboundContext['transitionToImplementer'];
    maxAttempts?: number;
    log?: (_msg: string) => void;
    error?: (_msg: string) => void;
  }
): Promise<ArtifactDispatchResult> {
  const { slug, worktree, agent, verifyFn, startAgentFn, maxAttempts = ARTIFACT_REBOUND_ATTEMPTS } = options;
  const log = options.log || fmt.log.plain;
  const error = options.error || fmt.log.plainError;

  if (typeof verifyFn !== 'function') {
    throw new Error('dispatchArtifactFailure requires a verify callback: an artifact bounce may only be reported fixed when the artifacts are re-consumed and complete.');
  }

  const outcome = await rebound(
    { kind: 'artifact-incomplete', role, diagnostic },
    {
      slug,
      worktree,
      implementer: agent,
      maxAttempts,
      verify: verifyFn,
      startAgent: startAgentFn,
      readHead: () => {
        const result = git(['-C', worktree, 'rev-parse', 'HEAD']);
        return result.status === 0 ? result.stdout.trim() : null;
      },
      applyAgentFallback: options.applyAgentFallbackFn,
      transitionToImplementer: options.transitionToImplementerFn,
      log,
      error,
    },
  );

  const action: ArtifactDispatchAction = outcome.outcome === 'fixed'
    ? 'fixed'
    : (outcome.outcome === 'human-only' ? 'human-only' : 'strand');

  return {
    action,
    role,
    diagnostic: outcome.diagnostic,
    attempts: outcome.attempts,
    maxAttempts,
    agent: outcome.implementer,
  };
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
};
