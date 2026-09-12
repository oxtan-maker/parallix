/**
 * Assemble review and act-on-review prompts for the autonomous review loop.
 * Owned by the Node workflow harness (ADR 0037 / architecture migration).
 *
 * Node-invoked agent prompts read from parallix/prompts/*.md templates
 * (same pattern as active.js / draft.js). Dry-run output uses the exact
 * prompt that a real agent receives, preventing policy drift.
 */

import * as fs from 'fs';
import * as path from 'path';
import { getMissionYear, getPrimaryBranch, missionPathForSlug } from '../filesystem/mission-utils.js';
import { assembleStagePrompt } from '../assets/runtime-assets.js';
import { resolvePromptOverride } from '../config/product-config.js';
import { loadRepositoryGates } from '../config/repository-gates.js';
import { GATE_RESULT_RELATIVE_PATH } from '../verification/verification.js';
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


/** Longest command string rendered inside the completed-controls block. */
const CONTROL_COMMAND_MAX = 60;

/** Hard budget for the rendered completed-controls block (SC6). */
export const COMPLETED_CONTROLS_MAX_LINES = 12;
export const COMPLETED_CONTROLS_MAX_CHARS = 900;

/** The single line rendered when no control has a machine record to report. */
const NO_CONTROLS_LINE =
  '  - No verification gate result is recorded for this mission, and no repository or mission gate is declared; running a verification command yourself is permitted.';

/** @param {string} command */
function shortCommand(command: string): string {
  const flat = command.replace(/\s+/g, ' ').trim();
  return flat.length > CONTROL_COMMAND_MAX ? `${flat.slice(0, CONTROL_COMMAND_MAX - 1)}\u2026` : flat;
}

/**
 * Read the gate-result artifact recorded beside a mission. Returns null when the
 * artifact is absent or unreadable; reading must never throw, because
 * `.workflow/` is gitignored and may be missing entirely (fresh clone, removed
 * worktree, board-side render).
 * @param {string} missionDir
 */
function readGateResultRecord(missionDir: string): { command: string; exitCode: number; recordedAt: string } | null {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(missionDir, GATE_RESULT_RELATIVE_PATH), 'utf8'));
    if (!raw || typeof raw !== 'object') { return null; }
    if (typeof raw.command !== 'string' || typeof raw.exitCode !== 'number') { return null; }
    return { command: raw.command, exitCode: raw.exitCode, recordedAt: typeof raw.recordedAt === 'string' ? raw.recordedAt : 'unknown time' };
  } catch {
    return null;
  }
}

/**
 * Parse the command lines of a mission's `## Gates` checklist. Mirrors the
 * checkbox-stripping shape of the handoff runner that actually executes them;
 * this is a read-only restatement, it never decides whether a gate runs.
 * @param {string} missionContent
 */
function parseDeclaredGateCommands(missionContent: string): string[] {
  const section = missionContent.match(/^## Gates\s*\n([\s\S]*?)(?=\n## |\n$)/m);
  if (!section) { return []; }
  return section[1].split('\n')
    .map(line => line.trim())
    .filter(line => line.startsWith('- '))
    .map(line => line.replace(/^- \[[ x]\]\s*/, '').replace(/^- \s*/, '').replace(/^`(.+)`$/, '$1').trim())
    .filter(cmd => cmd.length > 0);
}

/** @param {{key: string, command: string}[]} gates */
function renderGates(gates: { key: string; command: string }[]): string {
  return gates.map(g => `${g.key} \`${shortCommand(g.command)}\``).join(', ');
}

/**
 * Render the "already-executed controls" block injected into the review prompt.
 *
 * Every line is derived from a machine record — the recorded gate-result exit
 * code, the repository's configured `adapters.gates`, and the mission's declared
 * `## Gates` list — never from agent prose (ADR 0048). A pass is claimed only
 * for `exitCode === 0`, and a control is never reported as having run merely
 * because it is configured: only the phases that run strictly before this
 * prompt is issued (handoff) are reported as executed. `preReview` runs on
 * approve and `preIntegration` runs at integration, both after this review.
 *
 * @param {string} missionPath absolute path to the mission's MISSION.md
 * @param {string} [repoRoot]
 * @returns {string} block lines, no trailing newline
 */
export function buildCompletedControlsBlock(missionPath: string, repoRoot?: string): string {
  const root = repoRoot || process.cwd();
  const missionDir = path.dirname(missionPath);

  let missionContent = '';
  try { missionContent = fs.readFileSync(missionPath, 'utf8'); } catch { missionContent = ''; }

  const record = readGateResultRecord(missionDir);
  const declared = parseDeclaredGateCommands(missionContent);
  let configured = { preHandoff: [], preReview: [] } as { preHandoff: { key: string; command: string }[]; preReview: { key: string; command: string }[] };
  try {
    const gates = loadRepositoryGates(root);
    configured = { preHandoff: gates.preHandoff, preReview: gates.preReview };
  } catch { /* an unreadable config degrades to "nothing configured" */ }

  const hasAnyControl = Boolean(record) || declared.length > 0 || configured.preHandoff.length > 0 || configured.preReview.length > 0;
  if (!hasAnyControl) { return NO_CONTROLS_LINE; }

  const lines: string[] = [];
  if (record) {
    const status = record.exitCode === 0 ? 'passed' : 'failed';
    lines.push(`  - Verification gate \`${shortCommand(record.command)}\`: status ${status}, exitCode ${record.exitCode}, recordedAt ${record.recordedAt}.`);
  } else {
    lines.push('  - No verification gate result is recorded for this mission; re-running a verification command is permitted.');
  }
  if (declared.length > 0) {
    lines.push(`  - Mission \`## Gates\` executed by handoff: ${declared.map(c => `\`${shortCommand(c)}\``).join(', ')}.`);
  }
  // preHandoff gates run inside handoff and hard-fail it, so reaching review
  // proves they passed. preReview gates are different: `submitReview` runs them
  // only for an `approve` outcome, which is after this prompt is issued — so
  // they are listed as configured-but-not-yet-run, never as executed.
  if (configured.preHandoff.length > 0) {
    lines.push(`  - Configured preHandoff gates executed by handoff: ${renderGates(configured.preHandoff)}.`);
  }
  if (configured.preReview.length > 0) {
    lines.push(`  - Configured preReview gates NOT yet run (they run on approve, after this review): ${renderGates(configured.preReview)}.`);
  }
  lines.push('  - Handoff already validated every checkpoint Goal Check table for structure and for a verifiable evidence reference per row.');
  if (/^\s*(?:[-*]\s*)?Reproduction-Test:/m.test(missionContent)) {
    lines.push('  - The red-to-green reproduction gate declared by this mission\u2019s `Reproduction-Test:` line already ran.');
  }
  return lines.join('\n');
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
    .replaceAll('{{completedControls}}', buildCompletedControlsBlock(missionPath, repoRoot))
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
