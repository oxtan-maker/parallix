/**
 * Assemble review and act-on-review prompts for the autonomous review loop.
 * Owned by the Node workflow harness (ADR 0037 / task-089).
 *
 * Node-invoked agent prompts read from parallix/prompts/*.md templates
 * (same pattern as active.js / draft.js). Full verbose prompts are kept
 * for --dry-run diagnostics and human/manual invocation.
 */

import * as fs from 'fs';
import * as path from 'path';
import { getMissionYear, getPrimaryBranch, missionPathForSlug } from '../core/mission-utils.js';
import { resolveArtifactDir } from './review-artifacts.js';

const REVIEW_PROMPT_PATH = path.join(__dirname, '..', '..', 'prompts', 'review.md');
const ACT_ON_REVIEW_PROMPT_PATH = path.join(__dirname, '..', '..', 'prompts', 'act-on-review.md');
const REVIEW_VERBOSE_PROMPT_PATH = path.join(__dirname, '..', '..', 'prompts', 'review-verbose.md');
const ACT_ON_REVIEW_VERBOSE_PROMPT_PATH = path.join(__dirname, '..', '..', 'prompts', 'act-on-review-verbose.md');

type PromptEntry = { review: string; actOnReview: string };
type PromptEntrypoints = { codex: PromptEntry; claude: PromptEntry; mistral: PromptEntry; custom: PromptEntry; autonomous: PromptEntry };

export const PROMPT_ENTRYPOINTS: PromptEntrypoints = {
  codex:  { review: '$review all',                           actOnReview: '$act-on-review' },
  claude: { review: '/review all',                           actOnReview: '/act-on-review' },
  mistral: { review: '$review all',                           actOnReview: '/act-on-review' },
  custom: { review: '$review all',                           actOnReview: '/act-on-review' },
  autonomous: { review: '$review all',                       actOnReview: '/act-on-review' }
};

/** @param {string} agent */
export function reviewEntrypoint(agent: string): string {
  const entry = (PROMPT_ENTRYPOINTS as Record<string, PromptEntry>)[agent];
  if (!entry) { throw new Error(`Unknown agent family for review entrypoint: ${agent}`); }
  return entry.review;
}

/** @param {string} agent */
export function actOnReviewEntrypoint(agent: string): string {
  const entry = (PROMPT_ENTRYPOINTS as Record<string, PromptEntry>)[agent];
  if (!entry) { throw new Error(`Unknown agent family for act-on-review entrypoint: ${agent}`); }
  return entry.actOnReview;
}

/**
 * @param {string} slug
 * @param {string} [repoRoot]
 * @param {string} [missionPathOverride]
 * @returns {string}
 */
function resolveMissionPath(slug: string, repoRoot?: string, missionPathOverride?: string): string {
  if (missionPathOverride) { return missionPathOverride; }
  const root = repoRoot || process.cwd();
  try {
    return missionPathForSlug(root, slug);
  } catch {
    const year = getMissionYear(slug, root);
    return path.join(root, 'docs', 'missions', String(year), slug, 'MISSION.md');
  }
}

/** @param {string} [repoRoot] */
function resolvePrimaryBranch(repoRoot?: string): string {
  try {
    return getPrimaryBranch(repoRoot || process.cwd());
  } catch {
    return 'main';
  }
}

/**
 * @param {{reviewer: string, branch: string, implementer: string, focus?: string, attempt: number, repoRoot?: string, missionPath?: string}} opts
 * @returns {string}
 */
export function buildReviewPrompt({ reviewer, branch, implementer, focus = 'all', attempt, repoRoot = '', missionPath: missionPathOverride }: {
  reviewer: string; branch: string; implementer: string; focus?: string; attempt: number; repoRoot?: string; missionPath?: string;
}): string {
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
 * @param {{implementer: string, branch: string, attempt: number, repoRoot?: string, missionPath?: string}} opts
 * @returns {string}
 */
export function buildActOnReviewPrompt({ implementer, branch, attempt, repoRoot = '', missionPath: missionPathOverride }: {
  implementer: string; branch: string; attempt: number; repoRoot?: string; missionPath?: string;
}): string {
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
 * @param {{reviewer: string, branch: string, implementer: string, focus?: string, attempt: number, actualReviewer?: string, repoRoot?: string, missionPath?: string}} opts
 * @returns {string}
 */
export function buildCompactReviewPrompt({ reviewer, branch, implementer, focus = 'all', attempt, actualReviewer, repoRoot = '', missionPath: missionPathOverride }: {
  reviewer: string; branch: string; implementer: string; focus?: string; attempt: number; actualReviewer?: string; repoRoot?: string; missionPath?: string;
}): string {
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
 * @param {{implementer: string, branch: string, attempt: number, reviewOutcome?: string, actualImplementer?: string, repoRoot?: string, missionPath?: string}} opts
 * @returns {string}
 */
export function buildCompactActOnReviewPrompt({ implementer, branch, attempt, reviewOutcome = '?', actualImplementer, repoRoot = '', missionPath: missionPathOverride }: {
  implementer: string; branch: string; attempt: number; reviewOutcome?: string; actualImplementer?: string; repoRoot?: string; missionPath?: string;
}): string {
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
