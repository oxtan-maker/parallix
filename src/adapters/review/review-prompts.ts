/**
 * Assemble review and act-on-review prompts for the autonomous review loop.
 * Owned by the Node workflow harness (ADR 0037 / architecture migration).
 *
 * Node-invoked agent prompts read from parallix/prompts/*.md templates
 * (same pattern as active.js / draft.js). Dry-run output uses the exact
 * prompt that a real agent receives, preventing policy drift.
 */

import * as path from 'path';
import { getMissionYear, getPrimaryBranch, missionPathForSlug } from '../filesystem/mission-utils.js';
import { assembleStagePrompt } from '../assets/runtime-assets.js';
import { resolvePromptOverride } from '../config/product-config.js';
import { resolveArtifactDir } from './review-artifacts.js';

type PromptEntry = { review: string; actOnReview: string };
type PromptEntrypoints = { codex: PromptEntry; claude: PromptEntry; vibe: PromptEntry; custom: PromptEntry; qwen: PromptEntry; autonomous: PromptEntry };

export const PROMPT_ENTRYPOINTS: PromptEntrypoints = {
  codex:  { review: '$review all',                           actOnReview: '$act-on-review' },
  claude: { review: '/review all',                           actOnReview: '/act-on-review' },
  vibe: { review: '$review all',                           actOnReview: '/act-on-review' },
  custom: { review: '$review all',                           actOnReview: '/act-on-review' },
  qwen: { review: '$review all',                             actOnReview: '$act-on-review' },
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
export function buildReviewPrompt({ reviewer, branch, implementer, focus = 'all', attempt, actualReviewer, repoRoot = '', missionPath: missionPathOverride, reviewBaseline }: {
  reviewer: string; branch: string; implementer: string; focus?: string; attempt: number; actualReviewer?: string; repoRoot?: string; missionPath?: string; reviewBaseline?: string;
}): string {
  return buildCompactReviewPrompt({ reviewer, branch, implementer, focus, attempt, actualReviewer, repoRoot, missionPath: missionPathOverride, reviewBaseline });
}

/**
 * @param {{implementer: string, branch: string, attempt: number, repoRoot?: string, missionPath?: string}} opts
 * @returns {string}
 */
export function buildActOnReviewPrompt({ implementer, branch, attempt, reviewOutcome = '?', actualImplementer, repoRoot = '', missionPath: missionPathOverride, reviewBaseline }: {
  implementer: string; branch: string; attempt: number; reviewOutcome?: string; actualImplementer?: string; repoRoot?: string; missionPath?: string; reviewBaseline?: string;
}): string {
  return buildCompactActOnReviewPrompt({ implementer, branch, attempt, reviewOutcome, actualImplementer, repoRoot, missionPath: missionPathOverride, reviewBaseline });
}

/**
 * @param {{reviewer: string, branch: string, implementer: string, focus?: string, attempt: number, actualReviewer?: string, repoRoot?: string, missionPath?: string}} opts
 * @returns {string}
 */
export function buildCompactReviewPrompt({ reviewer, branch, implementer, focus = 'all', attempt, actualReviewer, repoRoot = '', missionPath: missionPathOverride, reviewBaseline }: {
  reviewer: string; branch: string; implementer: string; focus?: string; attempt: number; actualReviewer?: string; repoRoot?: string; missionPath?: string; reviewBaseline?: string;
}): string {
  const slug = branch.replace(/^mission\//, '');
  const finalReviewer = actualReviewer || reviewer;
  const year = getMissionYear(slug, repoRoot || process.cwd());
  const missionPath = resolveMissionPath(slug, repoRoot, missionPathOverride);
  const primaryBranch = resolvePrimaryBranch(repoRoot);
  const artifactDir = resolveArtifactDir(repoRoot || process.cwd());
  const overridePath = resolvePromptOverride(repoRoot || process.cwd());
  const template = assembleStagePrompt('review', { overridePath });
  // Dry-run output preserves the runtime-selected agent as a placeholder.
  // Resolve its entrypoint from the configured reviewer instead, because the
  // placeholder is deliberately not a registered agent family.
  const entrypointAgent = finalReviewer === '{{AGENT_NAME}}' ? reviewer : finalReviewer;
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
    .replaceAll('{{reviewBaseline}}',   reviewBaseline || primaryBranch)
    .replaceAll('YYYY',                year)
    .replaceAll('{{review_entrypoint}}', reviewEntrypoint(entrypointAgent));
}

/**
 * @param {{implementer: string, branch: string, attempt: number, reviewOutcome?: string, actualImplementer?: string, repoRoot?: string, missionPath?: string}} opts
 * @returns {string}
 */
export function buildCompactActOnReviewPrompt({ implementer, branch, attempt, reviewOutcome = '?', actualImplementer, repoRoot = '', missionPath: missionPathOverride, reviewBaseline }: {
  implementer: string; branch: string; attempt: number; reviewOutcome?: string; actualImplementer?: string; repoRoot?: string; missionPath?: string; reviewBaseline?: string;
}): string {
  const slug = branch.replace(/^mission\//, '');
  const finalImplementer = actualImplementer || implementer;
  const year = getMissionYear(slug, repoRoot || process.cwd());
  const missionPath = resolveMissionPath(slug, repoRoot, missionPathOverride);
  const primaryBranch = resolvePrimaryBranch(repoRoot);
  const artifactDir = resolveArtifactDir(repoRoot || process.cwd());
  const overridePath = resolvePromptOverride(repoRoot || process.cwd());
  const template = assembleStagePrompt('act-on-review', { overridePath });
  return template
    .replaceAll('{{branch}}',                  branch)
    .replaceAll('{{implementer}}',             finalImplementer)
    .replaceAll('{{attempt}}',                 String(attempt))
    .replaceAll('{{slug}}',                    slug)
    .replaceAll('{{missionPath}}',             missionPath)
    .replaceAll('{{artifactDir}}',             artifactDir)
    .replaceAll('{{primaryBranch}}',           primaryBranch)
    .replaceAll('{{reviewBaseline}}',          reviewBaseline || primaryBranch)
    .replaceAll('{{review_outcome}}',          reviewOutcome)
    .replaceAll('YYYY',                       year)
    .replaceAll('{{act_on_review_entrypoint}}', actOnReviewEntrypoint(finalImplementer));
}
