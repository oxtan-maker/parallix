/**
 * Reviewer-family persistence for the autonomous review loop.
 *
 * State is stored under the adapter-resolved mission directory on the mission branch.
 * Writing and committing state before each round ensures session-restart safety.
 *
 * Owned by the Node workflow harness (ADR 0037 / task-089).
 */

import * as fs from 'fs';
import * as path from 'path';
import { git } from '../core/git.js';
import { findMissionDir, resolveWorktree } from '../core/mission-utils.js';
import { writeFileAtomic } from '../core/storage.js';

export type ReviewStatePersistenceResult =
  | { outcome: 'committed' }
  | { outcome: 'unchanged' }
  | { outcome: 'write-failed'; stage: 'write'; diagnostic: string }
  | { outcome: 'add-failed'; stage: 'add'; diagnostic: string }
  | { outcome: 'commit-failed-dirty'; stage: 'commit'; diagnostic: string };

type GitFn = typeof git;
type AtomicWriteFn = typeof writeFileAtomic;

interface ReviewStatePersistenceContext {
  slug: string;
  phase?: string | null;
  round?: number | null;
}

function diagnosticFrom(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) { return error.message.trim(); }
  const text = String(error || '').trim();
  return text || fallback;
}

function gitDiagnostic(result: ReturnType<GitFn>, fallback: string): string {
  return String(result.stderr || result.stdout || '').trim() || fallback;
}

export function assertReviewStatePersisted(
  result: ReviewStatePersistenceResult | boolean | void | unknown,
  context: ReviewStatePersistenceContext
): void {
  if (result === true || result === undefined) { return; }
  if (result === false) {
    throw new Error(`Review-state persistence failed for mission ${context.slug}, phase ${context.phase || 'unknown'}, round ${context.round ?? 'unknown'}: persistence returned false`);
  }
  if (!result || typeof result !== 'object' || !('outcome' in result)) { return; }
  const persistenceResult = result as ReviewStatePersistenceResult;
  if (persistenceResult.outcome === 'committed' || persistenceResult.outcome === 'unchanged') { return; }
  throw new Error(
    `Review-state persistence failed for mission ${context.slug}, phase ${context.phase || 'unknown'}, round ${context.round ?? 'unknown'}, stage ${persistenceResult.stage}: ${persistenceResult.diagnostic}`
  );
}

export function persistReviewStateOrThrow(
  writeFn: typeof writeReviewState,
  slug: string,
  state: ReviewState | Record<string, unknown>,
  worktree: string
): ReviewStatePersistenceResult {
  const result = writeFn(slug, state, worktree);
  assertReviewStatePersisted(result, {
    slug,
    phase: state instanceof ReviewState ? state.phase : String(state.phase || 'unknown'),
    round: state instanceof ReviewState ? state.round : (typeof state.round === 'number' ? state.round : null)
  });
  return result;
}

/**
 * Return the path to the review-state file for a given slug.
 * Resolves using the same mission-dir discovery as other workflow commands.
 *
 * @param {string} slug
 * @param {string} [rootDir]
 * @returns {string|null}  Absolute path, or null if mission dir not found
 */
export function reviewStateFile(slug: string, rootDir = process.cwd()): string | null {
  const missionDir = findMissionDir(slug, rootDir);
  if (!missionDir) { return null; }
  return path.join(missionDir, 'review-state.json');
}

/**
 * Read the persisted review state for a mission.
 *
 * @param {string} slug
 * @param {string} [rootDir]  Directory to resolve the mission from (defaults to process.cwd())
 * @returns {ReviewState|null}
 */
export function readReviewState(slug: string, rootDir = process.cwd()): ReviewState | null {
  const statePath = reviewStateFile(slug, rootDir);
  if (!statePath || !fs.existsSync(statePath)) { return null; }

  try {
    const raw = fs.readFileSync(statePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && parsed.reviewer && parsed.implementer) {
      return new ReviewState(slug, parsed);
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Resolve the review-provider identity for a review workflow path.
 *
 * The normal contract is review-state-backed so standard review/handoff/rebase
 * paths do not require a provider identity env var to be exported.
 *
 * @param {string} slug
 * @param {string} [rootDir]
 * @param {{readReviewStateFn?: Function}} [options]
 * @returns {{ identityUser: string|null, commentIdentityUser: string|null, forgejoUser: string|null, commentForgejoUser: string|null, reviewState: ReviewState|null, source: 'review-state'|null }}
 */
export function resolveReviewIdentity(
  slug: string,
  rootDir = process.cwd(),
  options: { readReviewStateFn?: (_s: string, _r: string) => ReviewState | null } = {}
): {
  identityUser: string | null;
  commentIdentityUser: string | null;
  forgejoUser: string | null;
  commentForgejoUser: string | null;
  reviewState: ReviewState | null;
  source: 'review-state' | null;
} {
  const readReviewStateFn = options.readReviewStateFn || readReviewState;
  const reviewState = readReviewStateFn(slug, rootDir);
  const reviewerUser = reviewState ? (reviewState.reviewer || reviewState.implementer || null) : null;
  const implementerUser = reviewState ? (reviewState.implementer || reviewState.reviewer || null) : null;

  return {
    identityUser: reviewerUser || null,
    commentIdentityUser: implementerUser || null,
    forgejoUser: reviewerUser || null,
    commentForgejoUser: implementerUser || null,
    reviewState,
    source: reviewerUser ? 'review-state' : null
  };
}

/**
 * Manager class for mission review state.
 * Expanded to include phase, disposition, and metadata for canonical state ownership.
 */
export const VALID_PHASES = ['reviewing', 'fixing', 'pending-approval', 'approved'] as const;
const PHASE_ALIASES = new Map<string, string>([
  ['review', 'reviewing'],
  ['rewiewing', 'reviewing'],
  ['fix', 'fixing'],
  ['pending_approval', 'pending-approval'],
  ['pending approval', 'pending-approval']
]);

const PHASE_TRANSITIONS: Record<string, string[]> = {
  'reviewing': ['fixing', 'approved'],
  'fixing': ['reviewing', 'pending-approval'],
  'pending-approval': ['reviewing'],
  'approved': []
};

/** @param {string} disposition */
function inferPhaseFromDisposition(disposition: string): string {
  switch (String(disposition || '').trim().toUpperCase()) {
  case 'APPROVED':
    return 'approved';
  case 'REQUEST_CHANGES':
  case 'COMMENT':
  case 'PUSHBACK_ALL':
  case 'BLOCKED':
  case 'PARKED':
    return 'fixing';
  case 'CHANGES_MADE':
    return 'reviewing';
  default:
    return 'reviewing';
  }
}

/** @param {string} phase @param {string} disposition */
export function normalizeReviewPhase(phase: string, disposition: string): { phase: string; original: string | null; normalized: boolean } {
  if (!phase) {
    return { phase: 'reviewing', original: null, normalized: false };
  }

  const raw = String(phase).trim();
  const canonical = raw.toLowerCase().replace(/[_\s]+/g, '-');
  if ((VALID_PHASES as readonly string[]).includes(canonical)) {
    return { phase: canonical, original: raw, normalized: canonical !== raw };
  }

  const alias = PHASE_ALIASES.get(raw.toLowerCase()) || PHASE_ALIASES.get(canonical);
  if (alias) {
    return { phase: alias, original: raw, normalized: true };
  }

  return {
    phase: inferPhaseFromDisposition(disposition),
    original: raw,
    normalized: true
  };
}

/** @typedef {{reviewer?: string, implementer?: string, round?: number, startedAt?: string, phase?: string, disposition?: string | null, reviewerRetryCount?: number, implementerRetryCount?: number, metadata?: {[key: string]: unknown}}} ReviewStateData */
export interface ReviewStateData {
  reviewer?: string;
  implementer?: string;
  round?: number;
  startedAt?: string;
  phase?: string;
  disposition?: string | null;
  reviewerRetryCount?: number;
  implementerRetryCount?: number;
  metadata?: Record<string, unknown>;
}

export class ReviewState {
  slug: string;
  reviewer?: string;
  implementer?: string;
  round: number;
  startedAt: string;
  phase: string;
  disposition: string | null;
  reviewerRetryCount: number;
  implementerRetryCount: number;
  metadata: Record<string, unknown>;
  phaseOriginal: string | null;

  /**
   * @param {string} slug
   * @param {ReviewStateData} [data]
   */
  constructor(slug: string, data: ReviewStateData = {}) {
    const phaseInfo = normalizeReviewPhase(data.phase || '', data.disposition || '');
    this.slug = slug;
    this.reviewer = data.reviewer;
    this.implementer = data.implementer;
    this.round = data.round || 1;
    this.startedAt = data.startedAt || new Date().toISOString();
    this.phase = phaseInfo.phase;
    this.disposition = data.disposition || null;
    this.reviewerRetryCount = data.reviewerRetryCount || 0;
    this.implementerRetryCount = data.implementerRetryCount || 0;
    this.metadata = data.metadata || {};
    this.phaseOriginal = phaseInfo.normalized ? phaseInfo.original : null;
  }

  /**
   * @param {string} slug
   * @param {ReviewState|ReviewStateData} dataOrInstance
   * @returns {ReviewState}
   */
  static from(slug: string, dataOrInstance: ReviewState | ReviewStateData): ReviewState {
    if (dataOrInstance instanceof ReviewState) {
      if (dataOrInstance.slug !== slug) {
        throw new Error(`ReviewState slug mismatch: expected "${slug}", got "${dataOrInstance.slug}"`);
      }
      return dataOrInstance;
    }
    return new ReviewState(slug, dataOrInstance || {});
  }

  /**
   * @param {string} nextPhase
   * @returns {ReviewState}
   */
  transitionTo(nextPhase: string): ReviewState {
    if (!(VALID_PHASES as readonly string[]).includes(nextPhase)) {
      throw new Error(`Invalid phase: "${nextPhase}". Valid: ${(VALID_PHASES as readonly string[]).join(', ')}`);
    }
    const allowedArr = PHASE_TRANSITIONS[this.phase];
    if (!allowedArr || !allowedArr.includes(nextPhase)) {
      throw new Error(`Cannot transition from "${this.phase}" to "${nextPhase}". Allowed: ${(allowedArr || []).join(', ') || 'none'}`);
    }
    this.phase = nextPhase;
    return this;
  }

  advanceRound(): ReviewState {
    this.round += 1;
    this.phase = 'reviewing';
    this.disposition = null;
    this.reviewerRetryCount = 0;
    this.implementerRetryCount = 0;
    this.startedAt = new Date().toISOString();
    return this;
  }

  /**
   * @returns {{reviewer?: string, implementer?: string, round?: number, startedAt?: string, phase?: string, disposition?: string, reviewerRetryCount?: number, implementerRetryCount?: number, metadata?: {[key: string]: unknown}}}
   */
  toJSON(): {
    reviewer?: string;
    implementer?: string;
    round?: number;
    startedAt?: string;
    phase?: string;
    disposition?: string;
    reviewerRetryCount?: number;
    implementerRetryCount?: number;
    metadata?: Record<string, unknown>;
  } {
    const payload: {
      reviewer?: string;
      implementer?: string;
      round?: number;
      startedAt?: string;
      phase?: string;
      disposition?: string;
      reviewerRetryCount?: number;
      implementerRetryCount?: number;
      metadata?: Record<string, unknown>;
    } = {
      reviewer: this.reviewer,
      implementer: this.implementer,
      round: this.round,
      startedAt: this.startedAt,
      phase: this.phase,
      disposition: this.disposition || undefined
    };

    if (this.reviewerRetryCount > 0) { payload.reviewerRetryCount = this.reviewerRetryCount; }
    if (this.implementerRetryCount > 0) { payload.implementerRetryCount = this.implementerRetryCount; }
    if (Object.keys(this.metadata || {}).length > 0) { payload.metadata = this.metadata; }

    return payload;
  }

  save(
    worktree = resolveWorktree(this.slug) || process.cwd(),
    gitFn: GitFn = git,
    writeFileAtomicFn: AtomicWriteFn = writeFileAtomic
  ): ReviewStatePersistenceResult {
    const statePath = reviewStateFile(this.slug, worktree);
    if (!statePath) {
      return { outcome: 'write-failed', stage: 'write', diagnostic: `Mission directory not found for ${this.slug}` };
    }

    const payload = this.toJSON();
    try {
      writeFileAtomicFn(statePath, JSON.stringify(payload, null, 2) + '\n');
    } catch (error) {
      return { outcome: 'write-failed', stage: 'write', diagnostic: diagnosticFrom(error, 'Atomic review-state write failed') };
    }

    const relPath = path.relative(worktree, statePath);
    let addResult: ReturnType<GitFn>;
    try {
      addResult = gitFn(['-C', worktree, 'add', relPath]);
    } catch (error) {
      return { outcome: 'add-failed', stage: 'add', diagnostic: diagnosticFrom(error, 'git add failed') };
    }
    if (addResult.status !== 0) {
      return { outcome: 'add-failed', stage: 'add', diagnostic: gitDiagnostic(addResult, 'git add failed') };
    }

    const msg = `review-state(${this.slug}): round ${this.round} (${this.phase}) [${this.reviewer} -> ${this.implementer}]${this.disposition ? ` disposition=${this.disposition}` : ''}`;
    let commitResult: ReturnType<GitFn>;
    try {
      commitResult = gitFn(['-C', worktree, 'commit', '-m', msg]);
    } catch (error) {
      return { outcome: 'commit-failed-dirty', stage: 'commit', diagnostic: diagnosticFrom(error, 'git commit failed') };
    }

    if (commitResult.status !== 0) {
      let statusResult: ReturnType<GitFn>;
      try {
        statusResult = gitFn(['-C', worktree, 'status', '--porcelain', relPath]);
      } catch (error) {
        return { outcome: 'commit-failed-dirty', stage: 'commit', diagnostic: diagnosticFrom(error, gitDiagnostic(commitResult, 'git commit failed')) };
      }
      if (statusResult.status === 0 && statusResult.stdout.trim() === '') {
        return { outcome: 'unchanged' };
      }
      return { outcome: 'commit-failed-dirty', stage: 'commit', diagnostic: gitDiagnostic(commitResult, 'git commit failed and review state remains dirty') };
    }

    return { outcome: 'committed' };
  }
}

/**
 * Write and commit the review state for a mission.
 * Commits to the current branch so the state is visible after session restarts.
 *
 * @param {string} slug
 * @param {ReviewState|object} state
 * @returns {ReviewStatePersistenceResult}
 */
export function writeReviewState(
  slug: string,
  state: ReviewState | Record<string, unknown>,
  worktree = resolveWorktree(slug) || process.cwd(),
  gitFn: GitFn = git,
  writeFileAtomicFn: AtomicWriteFn = writeFileAtomic
): ReviewStatePersistenceResult {
  const instance = state instanceof ReviewState ? state : new ReviewState(slug, state as ReviewStateData);
  return instance.save(worktree, gitFn, writeFileAtomicFn);
}

/**
 * Delete the review state file for a mission (used by --reset).
 * Commits the deletion if the file was tracked.
 *
 * @param {string} slug
 * @returns {ReviewStatePersistenceResult}
 */
export function resetReviewState(
  slug: string,
  worktree = resolveWorktree(slug) || process.cwd(),
  gitFn: GitFn = git
): ReviewStatePersistenceResult {
  const statePath = reviewStateFile(slug, worktree);
  if (!statePath || !fs.existsSync(statePath)) { return { outcome: 'unchanged' }; }

  const relPath = path.relative(worktree, statePath);
  const tombstonePath = path.join(path.dirname(statePath), `.${path.basename(statePath)}.${process.pid}.${Date.now()}.deleted`);
  try {
    fs.renameSync(statePath, tombstonePath);
  } catch (error) {
    return { outcome: 'write-failed', stage: 'write', diagnostic: diagnosticFrom(error, 'Atomic review-state deletion failed') };
  }

  try {
    const addResult = gitFn(['-C', worktree, 'add', '-u', '--', relPath]);
    if (addResult.status !== 0) {
      const statusResult = gitFn(['-C', worktree, 'status', '--porcelain', relPath]);
      if (statusResult.status === 0 && statusResult.stdout.trim() === '') {
        return { outcome: 'unchanged' };
      }
      return { outcome: 'add-failed', stage: 'add', diagnostic: gitDiagnostic(addResult, 'git add deletion failed') };
    }
    const commitResult = gitFn(['-C', worktree, 'commit', '-m', `review-state(${slug}): reset (--reset flag)`]);
    if (commitResult.status === 0) { return { outcome: 'committed' }; }

    const statusResult = gitFn(['-C', worktree, 'status', '--porcelain', relPath]);
    if (statusResult.status === 0 && statusResult.stdout.trim() === '') {
      return { outcome: 'unchanged' };
    }
    return { outcome: 'commit-failed-dirty', stage: 'commit', diagnostic: gitDiagnostic(commitResult, 'git commit failed and review-state deletion remains dirty') };
  } catch (error) {
    return { outcome: 'commit-failed-dirty', stage: 'commit', diagnostic: diagnosticFrom(error, 'Review-state reset commit failed') };
  } finally {
    if (fs.existsSync(tombstonePath)) { fs.unlinkSync(tombstonePath); }
  }
}
