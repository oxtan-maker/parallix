// @ts-nocheck
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as fmt from '../../../application/presentation/cli-format.js';
import { resolveTaskFile } from '../../backlog/backlog.js';
import { getMissionYear, missionDirForSlug } from '../../filesystem/mission-utils.js';
import { assembleStagePrompt } from '../../assets/runtime-assets.js';
import { resolvePromptOverride } from '../../config/product-config.js';
import * as stats from './stats.js';
import { formatVerificationCommand } from '../../verification/verification.js';

// @ts-expect-error implicit any on rootDir
function resolveVerifyCmd(rootDir) {
  return formatVerificationCommand(undefined, rootDir);
}

// @ts-expect-error implicit any on slug/promptRoot
function resolveTaskPath(slug, promptRoot) {
  const resolution = resolveTaskFile(slug, promptRoot);
  if (resolution && resolution.ok && resolution.taskFile) {
    return resolution.taskFile;
  }
  return path.join(promptRoot, 'backlog', 'tasks', `<${slug}>.md`);
}

// @ts-expect-error implicit any on taskPath
function resolveClassificationInstructions(taskPath) {
  if (taskPath && fs.existsSync(taskPath)) {
    const content = fs.readFileSync(taskPath, 'utf8');
    if (/^source:\s*synthetic\s*$/mi.test(content)) {
      return 'because this task was synthesized by the harness, preserve the `unknown` label unless you have concrete repo-specific evidence to replace it. Do not add a separate frontmatter field for mission type.';
    }
  }
  return 'set exactly one of `ai_sdlc` or `user_value` in the Backlog task labels — plus optionally `bug` for bug-fix missions. Use `ai_sdlc` for workflow, prompt, or agent-fix work; use `user_value` for everything else (including code tech debt). Do not add a separate frontmatter field for mission type.';
}

// @ts-expect-error implicit any on slug/rootDir/worktree
function buildDraftPrompt(slug, { rootDir = process.cwd(), worktree = null } = {}) {
  const promptRoot = worktree || rootDir;
  const overridePath = resolvePromptOverride(promptRoot);
  const template = assembleStagePrompt('draft', { overridePath });
  const year = getMissionYear(slug, promptRoot) || String(new Date().getFullYear());
  const missionPath = path.join(missionDirForSlug(promptRoot, slug), 'MISSION.md');
  const missionDir = path.dirname(missionPath);
  const taskPath = resolveTaskPath(slug, promptRoot);
  return template
    .replaceAll('{{slug}}', slug)
    .replaceAll('{{year}}', year)
    .replaceAll('{{missionPath}}', missionPath)
    .replaceAll('{{missionDir}}', missionDir)
    .replaceAll('{{taskPath}}', taskPath)
    .replaceAll('{{classificationInstructions}}', resolveClassificationInstructions(taskPath))
    .replaceAll('{{verifyCmd}}', resolveVerifyCmd(promptRoot));
}

// @ts-expect-error implicit any on slug
function fallbackDraftCommitMessage(slug) {
  return `draft(${slug}): capture agent output`;
}

function resolveMissionClassificationResolver(resolveMissionClassificationFn) {
  if (typeof resolveMissionClassificationFn === 'function') {
    return resolveMissionClassificationFn;
  }
  if (typeof stats.resolveMissionClassification === 'function') {
    return stats.resolveMissionClassification;
  }
  throw new TypeError('resolveMissionClassificationFn is not a function');
}

// @ts-expect-error implicit any on slug/worktree
function validateDraftClassification(slug, worktree, {
  resolveMissionClassificationFn = stats.resolveMissionClassification,
  errorFn = fmt.log.plainError
} = {}) {
  try {
    const resolveClassification = resolveMissionClassificationResolver(resolveMissionClassificationFn);
    const { classification, error: classificationError } = resolveClassification(slug, worktree);
    if (!classification) {
      if (classificationError) {errorFn(fmt.status('FAIL', classificationError));}
      return { ok: true, classification: null };
    }
    return { ok: true, classification };
  } catch (error) {
    if (/** @type {any} */ (error).message.includes('Missing or invalid classification')) {
      return { ok: true, classification: null };
    }
    errorFn(fmt.status('FAIL', /** @type {any} */ (error).message));
    return { ok: false, reason: 'invalid-classification' };
  }
}

// @ts-expect-error implicit any on slug/worktree
function normalizeDraftClassification(slug, worktree, {
  resolveMissionClassificationFn = stats.resolveMissionClassification,
  errorFn = fmt.log.plainError
} = {}) {
  try {
    const resolveClassification = resolveMissionClassificationResolver(resolveMissionClassificationFn);
    const { classification, error: classificationError } = resolveClassification(slug, worktree);
    if (!classification) {
      if (classificationError) {errorFn(fmt.status('FAIL', classificationError));}
      return { ok: false, reason: 'missing-classification' };
    }
    return { ok: true, classification };
  } catch (error) {
    if (/** @type {any} */ (error).message.includes('Missing or invalid classification')) {
      return { ok: false, reason: 'missing-classification' };
    }
    errorFn(fmt.status('FAIL', /** @type {any} */ (error).message));
    return { ok: false, reason: 'invalid-classification' };
  }
}

// @ts-expect-error implicit any on slug/rootDir/worktree
function buildRestartPrompt(slug, { rootDir = process.cwd(), worktree = null } = {}) {
  return `${buildDraftPrompt(slug, { rootDir, worktree })}

Focused repair:
- update the backlog task so labels contain exactly one of \`ai_sdlc\` or \`user_value\` (plus optionally \`bug\` if this is a bug fix)
- use \`ai_sdlc\` for workflow, prompt, or agent-fix work; use \`user_value\` for everything else, including standard code tech debt
- do not add a separate frontmatter field for mission type
- if both classification labels are present, keep only the correct one
`;
}



export { buildDraftPrompt, buildRestartPrompt, fallbackDraftCommitMessage, resolveMissionClassificationResolver, validateDraftClassification, normalizeDraftClassification, resolveVerifyCmd, resolveTaskPath, resolveClassificationInstructions };
