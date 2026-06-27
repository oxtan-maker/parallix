/**
 * Assemble review and act-on-review prompts for the autonomous review loop.
 * Owned by the Node workflow harness (ADR 0037 / task-089).
 *
 * Node-invoked agent prompts read from parallix/prompts/*.md templates
 * (same pattern as active.js / draft.js). Full verbose prompts are kept
 * for --dry-run diagnostics and human/manual invocation.
 */

const fs = require('fs');
const path = require('path');
const { getMissionYear, getPrimaryBranch, missionPathForSlug } = require('../core/mission-utils');
const { resolveArtifactDir } = require('./review-artifacts');

const REVIEW_PROMPT_PATH = path.join(__dirname, '..', '..', 'prompts', 'review.md');
const ACT_ON_REVIEW_PROMPT_PATH = path.join(__dirname, '..', '..', 'prompts', 'act-on-review.md');
const REVIEW_VERBOSE_PROMPT_PATH = path.join(__dirname, '..', '..', 'prompts', 'review-verbose.md');
const ACT_ON_REVIEW_VERBOSE_PROMPT_PATH = path.join(__dirname, '..', '..', 'prompts', 'act-on-review-verbose.md');

/**
 * Slash-command / entrypoint used to invoke the review skill for each agent family.
 * Moved from scripts/autonomous-review.sh prompt_entrypoint_for() into Node.
 */
/**
 * @typedef {{review: string, actOnReview: string}} PromptEntry
 * @typedef {{codex: PromptEntry, claude: PromptEntry, mistral: PromptEntry, custom: PromptEntry, autonomous: PromptEntry}} PromptEntrypoints
 */

/** @type {PromptEntrypoints} */
const PROMPT_ENTRYPOINTS = {
  codex:  { review: '$review all',                           actOnReview: '$act-on-review' },
  claude: { review: '/review all',                           actOnReview: '/act-on-review' },
  mistral: { review: '$review all',                           actOnReview: '$act-on-review' },
  custom: { review: '$review all',                           actOnReview: '$act-on-review' },
  autonomous: { review: '$review all',                       actOnReview: '$act-on-review' }
};

/** @param {string} agent */
function reviewEntrypoint(agent) {
  const entry = /** @type {PromptEntry} */ (/** @type {{[key: string]: PromptEntry}} */ (PROMPT_ENTRYPOINTS)[agent]);
  if (!entry) {throw new Error(`Unknown agent family for review entrypoint: ${agent}`);}
  return entry.review;
}

/** @param {string} agent */
function actOnReviewEntrypoint(agent) {
  const entry = /** @type {PromptEntry} */ (/** @type {{[key: string]: PromptEntry}} */ (PROMPT_ENTRYPOINTS)[agent]);
  if (!entry) {throw new Error(`Unknown agent family for act-on-review entrypoint: ${agent}`);}
  return entry.actOnReview;
}

/**
 * Build the prompt sent to the reviewer agent for a given round.
 *
 * @param {object} opts
 * @param {string} opts.reviewer      - Reviewer agent family (codex|claude)
 * @param {string} opts.branch        - Mission branch name (e.g. 'mission/task-089')
 * @param {string} opts.implementer   - Implementer agent family
 * @param {string} opts.focus         - Review focus (default: 'all')
 * @param {number} opts.attempt       - Round number (1-based)
 * @param {string} [opts.repoRoot]    - Absolute repo root path
 * @returns {string}
 */
/**
 * @param {string} slug
 * @param {string} [repoRoot]
 * @param {string} [missionPathOverride]
 * @returns {string}
 */
function resolveMissionPath(slug, repoRoot, missionPathOverride) {
  // `--mission <path>` override: when the caller points the review loop at a
  // mission contract in a non-standard location, agents must read that file
  // instead of the slug-derived standard path (task-1272 SC7).
  if (missionPathOverride) {return missionPathOverride;}
  const root = repoRoot || process.cwd();
  try {
    return missionPathForSlug(root, slug);
  } catch (_) {
    const year = getMissionYear(slug, root);
    return path.join(root, 'docs', 'missions', String(year), slug, 'MISSION.md');
  }
}

/** @param {string} [repoRoot] */
function resolvePrimaryBranch(repoRoot) {
  try {
    return getPrimaryBranch(repoRoot || process.cwd());
  } catch (_) {
    return 'main';
  }
}

/**
 * @param {{reviewer: string, branch: string, implementer: string, focus?: string, attempt: number, repoRoot?: string, missionPath?: string}} opts
 * @returns {string}
 */
function buildReviewPrompt({ reviewer, branch, implementer, focus = 'all', attempt, repoRoot = '', missionPath: missionPathOverride }) {
  const entrypoint = reviewEntrypoint(reviewer);
  const repoLine = repoRoot ? `\noperate from repo root: ${repoRoot}` : '';
  const slug = branch.replace(/^mission\//, '');
  const year = getMissionYear(slug, repoRoot || process.cwd());
  const missionPath = resolveMissionPath(slug, repoRoot, missionPathOverride);
  const artifactDir = resolveArtifactDir(repoRoot || process.cwd());

  const template = fs.readFileSync(REVIEW_VERBOSE_PROMPT_PATH, 'utf8');
  return template
    .replaceAll('{{branch}}',           branch)
    .replaceAll('{{reviewer}}',         reviewer)
    .replaceAll('{{implementer}}',      implementer)
    .replaceAll('{{focus}}',            focus)
    .replaceAll('{{attempt}}',          String(attempt))
    .replaceAll('{{slug}}',             slug)
    .replaceAll('{{missionPath}}',      missionPath)
    .replaceAll('{{artifactDir}}',      artifactDir)
    .replaceAll('{{primaryBranch}}',    resolvePrimaryBranch(repoRoot))
    .replaceAll('{{review_entrypoint}}', entrypoint)
    .replaceAll('YYYY',                year)
    .replaceAll('{{repo_line}}',        repoLine ? repoLine.trim() + '\n- ' : '');
}

/**
 * Build the prompt sent back to the implementer agent after a review round.
 *
 * @param {object} opts
 * @param {string} opts.implementer   - Implementer agent family
 * @param {string} opts.branch        - Mission branch name
 * @param {number} opts.attempt       - Round number (1-based)
 * @param {string} [opts.repoRoot]    - Absolute repo root path
 * @returns {string}
 */
/**
 * @param {{implementer: string, branch: string, attempt: number, repoRoot?: string, missionPath?: string}} opts
 * @returns {string}
 */
function buildActOnReviewPrompt({ implementer, branch, attempt, repoRoot = '', missionPath: missionPathOverride }) {
  const entrypoint = actOnReviewEntrypoint(implementer);
  const repoLine = repoRoot ? `\noperate from repo root: ${repoRoot}` : '';
  const slug = branch.replace(/^mission\//, '');
  const year = getMissionYear(slug, repoRoot || process.cwd());
  const missionPath = resolveMissionPath(slug, repoRoot, missionPathOverride);
  const artifactDir = resolveArtifactDir(repoRoot || process.cwd());

  const template = fs.readFileSync(ACT_ON_REVIEW_VERBOSE_PROMPT_PATH, 'utf8');
  return template
    .replaceAll('{{branch}}',                  branch)
    .replaceAll('{{implementer}}',             implementer)
    .replaceAll('{{attempt}}',                 String(attempt))
    .replaceAll('{{slug}}',                    slug)
    .replaceAll('{{missionPath}}',             missionPath)
    .replaceAll('{{artifactDir}}',             artifactDir)
    .replaceAll('{{primaryBranch}}',           resolvePrimaryBranch(repoRoot))
    .replaceAll('{{act_on_review_entrypoint}}', entrypoint)
    .replaceAll('YYYY',                       year)
    .replaceAll('{{repo_line}}',               repoLine ? repoLine.trim() + '\n- ' : '');
}


/**
 * Node-invoked reviewer prompt built from parallix/prompts/review.md template.
 * Uses the same template-substitution pattern as active.js (execute.md).
 *
 * @param {object} opts
 * @param {string} opts.reviewer      - Reviewer agent family
 * @param {string} opts.branch        - Mission branch name
 * @param {string} opts.implementer   - Implementer agent family
 * @param {string} opts.focus         - Review focus (default: 'all')
 * @param {number} opts.attempt       - Round number (1-based)
 * @param {string} [opts.repoRoot]    - Absolute repo root path (unused but kept for API symmetry)
 * @param {string} [opts.actualReviewer] - The actual agent family launched (overrides reviewer for identity text, TASK-1051)
 * @returns {string}
 */
/**
 * @param {{reviewer: string, branch: string, implementer: string, focus?: string, attempt: number, actualReviewer?: string, repoRoot?: string, missionPath?: string}} opts
 * @returns {string}
 */
function buildCompactReviewPrompt({ reviewer, branch, implementer, focus = 'all', attempt, actualReviewer, repoRoot = '', missionPath: missionPathOverride }) {
  const slug = branch.replace(/^mission\//, '');
  const finalReviewer = actualReviewer || reviewer;
  const year = getMissionYear(slug, repoRoot || process.cwd());
  const missionPath = resolveMissionPath(slug, repoRoot, missionPathOverride);
  const primaryBranch = resolvePrimaryBranch(repoRoot);
  const artifactDir = resolveArtifactDir(repoRoot || process.cwd());
  const template = fs.readFileSync(REVIEW_PROMPT_PATH, 'utf8');
  return template
    .replaceAll('{{branch}}',           branch)
    .replaceAll('{{reviewer}}',         finalReviewer)
    .replaceAll('{{implementer}}',      implementer)
    .replaceAll('{{focus}}',            focus)
    .replaceAll('{{attempt}}',          String(attempt))
    .replaceAll('{{slug}}',             slug)
    .replaceAll('{{missionPath}}',      missionPath)
    .replaceAll('{{artifactDir}}',      artifactDir)
    .replaceAll('{{primaryBranch}}',    primaryBranch)
    .replaceAll('YYYY',                year)
    .replaceAll('{{review_entrypoint}}', reviewEntrypoint(finalReviewer));
}

/**
 * Node-invoked act-on-review prompt built from parallix/prompts/act-on-review.md template.
 *
 * @param {object} opts
 * @param {string} opts.implementer   - Implementer agent family
 * @param {string} opts.branch        - Mission branch name
 * @param {number} opts.attempt       - Round number (1-based)
 * @param {string} [opts.reviewOutcome] - Outcome of latest review (e.g. 'REQUEST_CHANGES')
 * @param {string} [opts.repoRoot]    - Absolute repo root path
 * @param {string} [opts.actualImplementer] - The actual agent family launched (overrides implementer for identity text, TASK-1051)
 * @returns {string}
 */
/**
 * @param {{implementer: string, branch: string, attempt: number, reviewOutcome?: string, actualImplementer?: string, repoRoot?: string, missionPath?: string}} opts
 * @returns {string}
 */
function buildCompactActOnReviewPrompt({ implementer, branch, attempt, reviewOutcome = '?', actualImplementer, repoRoot = '', missionPath: missionPathOverride }) {
  const slug = branch.replace(/^mission\//, '');
  const finalImplementer = actualImplementer || implementer;
  const year = getMissionYear(slug, repoRoot || process.cwd());
  const missionPath = resolveMissionPath(slug, repoRoot, missionPathOverride);
  const primaryBranch = resolvePrimaryBranch(repoRoot);
  const artifactDir = resolveArtifactDir(repoRoot || process.cwd());
  const template = fs.readFileSync(ACT_ON_REVIEW_PROMPT_PATH, 'utf8');
  return template
    .replaceAll('{{branch}}',                  branch)
    .replaceAll('{{implementer}}',             finalImplementer)
    .replaceAll('{{attempt}}',                 String(attempt))
    .replaceAll('{{slug}}',                    slug)
    .replaceAll('{{missionPath}}',             missionPath)
    .replaceAll('{{artifactDir}}',             artifactDir)
    .replaceAll('{{primaryBranch}}',           primaryBranch)
    .replaceAll('{{review_outcome}}',          reviewOutcome)
    .replaceAll('YYYY',                       year)
    .replaceAll('{{act_on_review_entrypoint}}', actOnReviewEntrypoint(finalImplementer));
}

module.exports = {
  PROMPT_ENTRYPOINTS,
  reviewEntrypoint,
  actOnReviewEntrypoint,
  buildReviewPrompt,
  buildActOnReviewPrompt,
  buildCompactReviewPrompt,
  buildCompactActOnReviewPrompt
};
