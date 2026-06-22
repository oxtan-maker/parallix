/**
 * Reviewer-family persistence for the autonomous review loop.
 *
 * State is stored under the adapter-resolved mission directory on the mission branch.
 * Writing and committing state before each round ensures session-restart safety.
 *
 * Owned by the Node workflow harness (ADR 0037 / task-089).
 */

const fs = require('fs');
const path = require('path');
const { git } = require('../core/git');
const { findMissionDir, resolveWorktree } = require('../core/mission-utils');
const fmt = require('../core/fmt');

/**
 * Return the path to the review-state file for a given slug.
 * Resolves using the same mission-dir discovery as other workflow commands.
 *
 * @param {string} slug
 * @param {string} [rootDir]
 * @returns {string|null}  Absolute path, or null if mission dir not found
 */
function reviewStateFile(slug, rootDir = process.cwd()) {
  const missionDir = findMissionDir(slug, rootDir);
  if (!missionDir) return null;
  return path.join(missionDir, 'review-state.json');
}

/**
 * Read the persisted review state for a mission.
 *
 * @param {string} slug
 * @param {string} [rootDir]  Directory to resolve the mission from (defaults to process.cwd())
 * @returns {ReviewState|null}
 */
function readReviewState(slug, rootDir = process.cwd()) {
  const statePath = reviewStateFile(slug, rootDir);
  if (!statePath || !fs.existsSync(statePath)) return null;

  try {
    const raw = fs.readFileSync(statePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && parsed.reviewer && parsed.implementer) {
      return new ReviewState(slug, parsed);
    }
    return null;
  } catch (_) {
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
 * @param {object} [options]
 * @returns {{ identityUser: string|null, commentIdentityUser: string|null, forgejoUser: string|null, commentForgejoUser: string|null, reviewState: ReviewState|null, source: 'review-state'|null }}
 */
function resolveReviewIdentity(slug, rootDir = process.cwd(), options = {}) {
  const readReviewStateFn = options.readReviewStateFn || readReviewState;
  const reviewState = readReviewStateFn(slug, rootDir);
  const reviewerUser = reviewState ? (reviewState.reviewer || reviewState.implementer || null) : null;
  const implementerUser = reviewState ? (reviewState.implementer || reviewState.reviewer || null) : null;

  return {
    identityUser: reviewerUser || null,
    commentIdentityUser: implementerUser || null,
    // Legacy aliases kept for compatibility while generic review orchestration
    // moves to provider-neutral option names.
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
const VALID_PHASES = ['reviewing', 'fixing', 'pending-approval', 'approved'];
const PHASE_ALIASES = new Map([
  ['review', 'reviewing'],
  ['rewiewing', 'reviewing'],
  ['fix', 'fixing'],
  ['pending_approval', 'pending-approval'],
  ['pending approval', 'pending-approval']
]);

const PHASE_TRANSITIONS = {
  'reviewing': ['fixing', 'approved'],
  'fixing': ['reviewing', 'pending-approval'],
  'pending-approval': ['reviewing'],
  'approved': []
};

function inferPhaseFromDisposition(disposition) {
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

function normalizeReviewPhase(phase, disposition) {
  if (!phase) {
    return { phase: 'reviewing', original: null, normalized: false };
  }

  const raw = String(phase).trim();
  const canonical = raw.toLowerCase().replace(/[_\s]+/g, '-');
  if (VALID_PHASES.includes(canonical)) {
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

class ReviewState {
  constructor(slug, data = {}) {
    const phaseInfo = normalizeReviewPhase(data.phase, data.disposition);
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

  static from(slug, dataOrInstance) {
    if (dataOrInstance instanceof ReviewState) {
      if (dataOrInstance.slug !== slug) {
        throw new Error(`ReviewState slug mismatch: expected "${slug}", got "${dataOrInstance.slug}"`);
      }
      return dataOrInstance;
    }
    return new ReviewState(slug, dataOrInstance || {});
  }

  transitionTo(nextPhase) {
    if (!VALID_PHASES.includes(nextPhase)) {
      throw new Error(`Invalid phase: "${nextPhase}". Valid: ${VALID_PHASES.join(', ')}`);
    }
    const allowed = PHASE_TRANSITIONS[this.phase];
    if (!allowed || !allowed.includes(nextPhase)) {
      throw new Error(`Cannot transition from "${this.phase}" to "${nextPhase}". Allowed: ${(allowed || []).join(', ') || 'none'}`);
    }
    this.phase = nextPhase;
    return this;
  }

  advanceRound() {
    this.round += 1;
    this.phase = 'reviewing';
    this.disposition = null;
    this.reviewerRetryCount = 0;
    this.implementerRetryCount = 0;
    this.startedAt = new Date().toISOString();
    return this;
  }

  toJSON() {
    const payload = {
      reviewer: this.reviewer,
      implementer: this.implementer,
      round: this.round,
      startedAt: this.startedAt,
      phase: this.phase,
      disposition: this.disposition
    };

    if (this.reviewerRetryCount > 0) payload.reviewerRetryCount = this.reviewerRetryCount;
    if (this.implementerRetryCount > 0) payload.implementerRetryCount = this.implementerRetryCount;
    if (Object.keys(this.metadata).length > 0) payload.metadata = this.metadata;

    return payload;
  }

  save(worktree = resolveWorktree(this.slug) || process.cwd(), gitFn = git) {
    const statePath = reviewStateFile(this.slug, worktree);
    if (!statePath) return false;

    const payload = this.toJSON();
    fs.writeFileSync(statePath, JSON.stringify(payload, null, 2) + '\n', 'utf8');

    const relPath = path.relative(worktree, statePath);
    gitFn(['-C', worktree, 'add', relPath]);
    const msg = `review-state(${this.slug}): round ${this.round} (${this.phase}) [${this.reviewer} -> ${this.implementer}]${this.disposition ? ` disposition=${this.disposition}` : ''}`;
    const result = gitFn(['-C', worktree, 'commit', '-m', msg]);

    if (result.status !== 0) {
      const statusResult = gitFn(['-C', worktree, 'status', '--porcelain', relPath]);
      if (statusResult.stdout.trim() === '') {
        return true;
      }
      fmt.log.warn(`Failed to commit review state update: ${result.stderr}`);
    }

    return true;
  }
}

/**
 * Write and commit the review state for a mission.
 * Commits to the current branch so the state is visible after session restarts.
 *
 * @param {string} slug
 * @param {ReviewState|object} state
 * @returns {boolean}  true if written successfully
 */
function writeReviewState(slug, state, worktree = resolveWorktree(slug) || process.cwd(), gitFn = git) {
  const instance = state instanceof ReviewState ? state : new ReviewState(slug, state);
  return instance.save(worktree, gitFn);
}

/**
 * Delete the review state file for a mission (used by --reset).
 * Commits the deletion if the file was tracked.
 *
 * @param {string} slug
 * @returns {boolean}  true if a file was deleted
 */
function resetReviewState(slug, worktree = resolveWorktree(slug) || process.cwd(), gitFn = git) {
  const statePath = reviewStateFile(slug, worktree);
  if (!statePath || !fs.existsSync(statePath)) return false;

  fs.unlinkSync(statePath);

  const relPath = path.relative(worktree, statePath);
  try {
    gitFn(['-C', worktree, 'rm', '--cached', relPath]);
    const result = gitFn(['-C', worktree, 'commit', '-m', `review-state(${slug}): reset (--reset flag)`]);
    if (result.status !== 0) {
      fmt.log.warn(`Failed to commit review state reset: ${result.stderr}`);
    }
  } catch (_) {
    // file may not have been tracked yet
  }

  return true;
}

module.exports = {
  ReviewState,
  VALID_PHASES,
  normalizeReviewPhase,
  reviewStateFile,
  readReviewState,
  resolveReviewIdentity,
  writeReviewState,
  resetReviewState
};
