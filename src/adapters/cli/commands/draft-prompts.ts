import * as fs from 'node:fs';
import * as path from 'node:path';
import * as fmt from '../../../application/presentation/cli-format.js';
import { resolveTaskFile } from '../../backlog/backlog.js';
import { getMissionYear, missionDirForSlug } from '../../filesystem/mission-utils.js';
import { assembleStagePrompt } from '../../assets/runtime-assets.js';
import { resolvePromptOverride } from '../../config/product-config.js';
import * as stats from './stats.js';
import { formatVerificationCommand } from '../../verification/verification.js';
function resolveVerifyCmd(rootDir: string) {
  return formatVerificationCommand(undefined, rootDir);
}
function resolveTaskPath(slug: string, promptRoot: string) {
  const resolution = resolveTaskFile(slug, promptRoot);
  if (resolution && resolution.ok && resolution.taskFile) {
    return resolution.taskFile;
  }
  return path.join(promptRoot, 'backlog', 'tasks', `<${slug}>.md`);
}
function resolveClassificationInstructions(taskPath: string) {
  if (taskPath && fs.existsSync(taskPath)) {
    const content = fs.readFileSync(taskPath, 'utf8');
    if (/^source:\s*synthetic\s*$/mi.test(content)) {
      return 'because this task was synthesized by the harness, preserve the `unknown` label unless you have concrete repo-specific evidence to replace it. Do not add a separate frontmatter field for mission type.';
    }
  }
  return 'set exactly one Mission classification with `px classification set --value <ai_sdlc|user_value|unknown>`. Backlog task labels may describe the task, but Mission state is authoritative. Use `ai_sdlc` for workflow, prompt, or agent-fix work; use `user_value` for everything else; use `unknown` only when evidence is unavailable.';
}
function buildDraftPrompt(slug: string, { rootDir = process.cwd(), worktree = null }: { rootDir?: string; worktree?: string | null } = {}) {
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
function fallbackDraftCommitMessage(slug: string) {
  return `draft(${slug}): capture agent output`;
}

function resolveMissionClassificationResolver(resolveMissionClassificationFn?: typeof stats.resolveMissionClassification) {
  if (typeof resolveMissionClassificationFn === 'function') {
    return resolveMissionClassificationFn;
  }
  if (typeof stats.resolveMissionClassification === 'function') {
    return stats.resolveMissionClassification;
  }
  throw new TypeError('resolveMissionClassificationFn is not a function');
}
function validateDraftClassification(slug: string, worktree: string, {
  resolveMissionClassificationFn = stats.resolveMissionClassification,
  errorFn = fmt.log.plainError
}: { resolveMissionClassificationFn?: typeof stats.resolveMissionClassification; errorFn?: (_message: string) => void } = {}) {
  try {
    const resolveClassification = resolveMissionClassificationResolver(resolveMissionClassificationFn);
    const { classification, error: classificationError } = resolveClassification(slug, worktree);
    if (!classification) {
      if (classificationError) {errorFn(fmt.status('FAIL', classificationError));}
      return { ok: true, classification: null };
    }
    return { ok: true, classification };
  } catch (error) {
    if ((error instanceof Error ? error.message : String(error)).includes('Missing or invalid classification')) {
      return { ok: true, classification: null };
    }
    errorFn(fmt.status('FAIL', (error instanceof Error ? error.message : String(error))));
    return { ok: false, reason: 'invalid-classification' };
  }
}
function normalizeDraftClassification(slug: string, worktree: string, {
  resolveMissionClassificationFn = stats.resolveMissionClassification,
  errorFn = fmt.log.plainError
}: { resolveMissionClassificationFn?: typeof stats.resolveMissionClassification; errorFn?: (_message: string) => void } = {}) {
  try {
    const resolveClassification = resolveMissionClassificationResolver(resolveMissionClassificationFn);
    const { classification, error: classificationError } = resolveClassification(slug, worktree);
    if (!classification) {
      if (classificationError) {errorFn(fmt.status('FAIL', classificationError));}
      return { ok: false, reason: 'missing-classification' };
    }
    return { ok: true, classification };
  } catch (error) {
    if ((error instanceof Error ? error.message : String(error)).includes('Missing or invalid classification')) {
      return { ok: false, reason: 'missing-classification' };
    }
    errorFn(fmt.status('FAIL', (error instanceof Error ? error.message : String(error))));
    return { ok: false, reason: 'invalid-classification' };
  }
}
function buildRestartPrompt(slug: string, { rootDir = process.cwd(), worktree = null }: { rootDir?: string; worktree?: string | null } = {}) {
  return `${buildDraftPrompt(slug, { rootDir, worktree })}

Focused repair:
- read \`px status ${slug}\`, then use \`px classification set --value <ai_sdlc|user_value|unknown>\`
- choose exactly one of \`ai_sdlc\` or \`user_value\` when the Mission has evidence; use \`unknown\` only when it does not
- classification is Mission state: do not repair it by editing a provider task
`;
}

/**
 * Prompt for an agent whose contract refine refused. The refusal names every
 * missing part and the command that records it; everything already recorded
 * stays, so the agent only adds what is missing.
 */
function buildContractRepairPrompt(slug: string, { rootDir = process.cwd(), worktree = null, refusal = '' }: { rootDir?: string; worktree?: string | null; refusal?: string } = {}) {
  return `${buildDraftPrompt(slug, { rootDir, worktree })}

Contract repair:
The harness tried to finish this draft and the mission contract was refused:

${refusal}

What is already recorded stays recorded. Read it back with \`px status ${slug}\`, record only the missing parts listed above, one foreground command per write, then read it back again and confirm every required part is reported before you finish.
`;
}

export { buildDraftPrompt, buildRestartPrompt, buildContractRepairPrompt, fallbackDraftCommitMessage, resolveMissionClassificationResolver, validateDraftClassification, normalizeDraftClassification, resolveVerifyCmd, resolveTaskPath, resolveClassificationInstructions };
