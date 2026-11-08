import type { ParallixConfiguration } from '../../../application/ports/configuration.js';
import * as path from 'node:path';
import * as fmt from '../../../application/presentation/cli-format.js';
import { resolveTaskFile } from '../../backlog/backlog.js';
import { getMissionYear, missionDirForSlug } from '../../filesystem/mission-utils.js';
import { assembleStagePrompt } from '../../assets/runtime-assets.js';
import { resolvePromptOverride } from '../../config/product-config.js';
import * as stats from './stats.js';
import { formatVerificationCommand } from '../../verification/verification.js';
import { isDbAdhocIdentity } from '../../../domain/mission.js';
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
function resolveClassificationInstructions() {
  return 'Classify this Mission from what it is about: ai_sdlc for workflow, prompt, or agent-fix work; user_value otherwise. Record exactly one in Mission state with --classification <ai_sdlc|user_value> in px mission author; unknown is not a completed draft classification.';
}
function buildDraftPrompt(slug: string, { rootDir = process.cwd(), worktree = null, dbOwnedNoMirror = false }: { rootDir?: string; worktree?: string | null; dbOwnedNoMirror?: boolean } = {}) {
  const promptRoot = worktree || rootDir;
  const overridePath = resolvePromptOverride(promptRoot);
  const template = assembleStagePrompt('draft', { overridePath });
  const year = getMissionYear(slug, promptRoot) || String(new Date().getFullYear());
  const missionPath = path.join(missionDirForSlug(promptRoot, slug), 'MISSION.md');
  const missionDir = path.dirname(missionPath);
  const databaseOwned = isDbAdhocIdentity(slug) || dbOwnedNoMirror;
  const taskPath = databaseOwned ? '' : resolveTaskPath(slug, promptRoot);
  const intentSourceLine = databaseOwned
    ? `Mission intent: exact database record from \`px status ${slug}\``
    : `Backlog task: ${taskPath}`;
  const intakeInstructions = databaseOwned
    ? `The harness has already created the mission branch, worktree, and Mission database record. The exact record returned by \`px status ${slug}\` is the sole intent authority. Turn that recorded operator intent into a complete mission contract. Preserve explicit requirements verbatim, including exact lists, quoted text, and stop checkpoints. There is no mission document to write; every fact below is recorded with a command.`
    : `The harness has already created the mission branch, worktree, mission record, and backlog task. Your job is to turn the user's intent from \`${taskPath}\` into a complete mission record. There is no mission document to write; every fact below is recorded with a command.`;
  const providerInstructions = databaseOwned
    ? `- use only \`px status ${slug}\` for Mission intent; if the exact record or intent is unavailable, stop with an actionable database-access error`
    : `- preserve \`${taskPath}\`: update content as needed but do not delete, rename, or move the file
- do not edit the backlog \`assignee\` field; the workflow records ownership itself`;
  const bugApplicability = databaseOwned
    ? '- this section applies only to a Mission recorded with the `bug` label; otherwise ignore it.'
    : `- this section applies only when the backlog task at \`${taskPath}\` carries a \`bug\` label; otherwise ignore it.`;
  const completionTransitionInstruction = '- the harness will transition the Mission to `ready` after a clean draft; do not transition it yourself';
  return template
    .replaceAll('{{slug}}', slug)
    .replaceAll('{{year}}', year)
    .replaceAll('{{missionPath}}', missionPath)
    .replaceAll('{{missionDir}}', missionDir)
    .replaceAll('{{taskPath}}', taskPath)
    .replaceAll('{{intentSourceLine}}', intentSourceLine)
    .replaceAll('{{intakeInstructions}}', intakeInstructions)
    .replaceAll('{{classificationInstructions}}', resolveClassificationInstructions())
    .replaceAll('{{providerInstructions}}', providerInstructions)
    .replaceAll('{{bugApplicability}}', bugApplicability)
    .replaceAll('{{completionTransitionInstruction}}', completionTransitionInstruction)
    .replaceAll('{{verifyCmd}}', resolveVerifyCmd(promptRoot));
}
function fallbackDraftCommitMessage(slug: string) {
  return `draft(${slug}): capture agent output`;
}

type DraftClassificationResolver = (...args: Parameters<typeof stats.resolveMissionClassification>) => Pick<ReturnType<typeof stats.resolveMissionClassification>, 'classification' | 'error'>;

function resolveMissionClassificationResolver(resolveMissionClassificationFn?: DraftClassificationResolver | null) {
  if (typeof resolveMissionClassificationFn === 'function') {
    return resolveMissionClassificationFn;
  }
  if (typeof stats.resolveMissionClassification === 'function') {
    return stats.resolveMissionClassification;
  }
  throw new TypeError('resolveMissionClassificationFn is not a function');
}
function validateDraftClassification(slug: string, worktree: string, {
  configuration,
  resolveMissionClassificationFn = stats.resolveMissionClassification,
  errorFn = fmt.log.plainError
}: { configuration?: ParallixConfiguration; resolveMissionClassificationFn?: DraftClassificationResolver | null; errorFn?: (_message: string) => void } = {}) {
  try {
    const resolveClassification = resolveMissionClassificationResolver(resolveMissionClassificationFn);
    const { classification, error: classificationError } = resolveClassification(slug, worktree, undefined, configuration);
    if (!classification) {
      if (classificationError) {errorFn(fmt.status('FAIL', classificationError));}
      return { ok: true, classification: null };
    }
    return { ok: true, classification };
  } catch (error) {
    errorFn(fmt.status('FAIL', (error instanceof Error ? error.message : String(error))));
    return { ok: false, reason: 'invalid-classification' };
  }
}
function normalizeDraftClassification(slug: string, worktree: string, {
  configuration,
  resolveMissionClassificationFn = stats.resolveMissionClassification,
  errorFn = fmt.log.plainError
}: { configuration?: ParallixConfiguration; resolveMissionClassificationFn?: DraftClassificationResolver | null; errorFn?: (_message: string) => void } = {}) {
  try {
    const resolveClassification = resolveMissionClassificationResolver(resolveMissionClassificationFn);
    const { classification, error: classificationError } = resolveClassification(slug, worktree, undefined, configuration);
    if (classification !== 'ai_sdlc' && classification !== 'user_value') {
      if (classificationError) {errorFn(fmt.status('FAIL', classificationError));}
      return { ok: false, reason: 'missing-classification' };
    }
    return { ok: true, classification };
  } catch (error) {
    errorFn(fmt.status('FAIL', (error instanceof Error ? error.message : String(error))));
    return { ok: false, reason: 'invalid-classification' };
  }
}
function buildRestartPrompt(slug: string, { rootDir = process.cwd(), worktree = null }: { rootDir?: string; worktree?: string | null } = {}) {
  return `${buildDraftPrompt(slug, { rootDir, worktree })}

Focused repair:
- read \`px status ${slug}\`, then use \`px classification set --value <ai_sdlc|user_value>\`
- choose exactly one of \`ai_sdlc\` or \`user_value\`; unknown must be resolved before draft completion
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
