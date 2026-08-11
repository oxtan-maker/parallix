import integrate from './integrate.js';
import { findMissionDir, findMissionArea, inferSlug, getPrimaryBranch } from '../../filesystem/mission-utils.js';
import { startAgent } from '../../agents/agents.js';
import { resolveTaskFile, getTaskImplementer } from '../../backlog/backlog.js';
import * as fmt from '../../../application/presentation/cli-format.js';
import { formatVerificationCommand } from '../../verification/verification.js';

/** @param {string} value */
function shellQuote(value: string) {
  return `"${String(value).replace(/(["\\$`])/g, '\\$1')}"`;
}

/** @param {{slug: string, area: string, worktreePath: string, missionSpecificFiles: string[]}} opts */
function buildAgentResolutionPrompt({ slug, area, worktreePath, missionSpecificFiles }: {slug: string, area: string, worktreePath: string, missionSpecificFiles: string[]}) {
  const fileCommands = missionSpecificFiles
    .map(f => `  git checkout --theirs "${f}" && git add "${f}"`)
    .join('\n');
  const quotedWorktreePath = shellQuote(worktreePath);

  return [
    'Mode: conflict-resolution.',
    '',
    `Mission: ${slug}`,
    `Mission worktree: ${worktreePath}`,
    '',
    `Conflicts detected between the mission branch and ${getPrimaryBranch()}.`,
    'All conflicts are in mission-specific files that can be resolved by keeping',
    'the mission branch version (--theirs). Execute these steps in order:',
    '',
    `  cd ${quotedWorktreePath}`,
    `  git rebase ${getPrimaryBranch()}`,
    '  # When the rebase pauses on conflicts, run for each file:',
    fileCommands,
    '  git rebase --continue',
    `  ${formatVerificationCommand(area, worktreePath)}`,
    `  px integrate ${slug} --dry-run`,
    '',
    'Rules:',
    '- Take --theirs for every file listed above. Do not inspect or edit conflict content.',
    '- If the rebase pauses on a file NOT in the list above, stop immediately and',
    '  report the unexpected file. Do not guess the resolution.',
    '- If any command fails, stop immediately and report the failure.',
    '  Do not continue to the next step.',
  ].join('\n');
}

/**
 * @param {string[]} args
 * @param {{resolveConflictsFn?: Function, startAgentFn?: Function, exitFn?: Function,
 *   resolveTaskFileFn?: Function, getTaskImplementerFn?: Function, rootDir?: string}} opts
 */
async function resolveConflict(args: string[], {
  resolveConflictsFn = (integrate as any).resolveConflictsForMission,
  startAgentFn = startAgent,
  exitFn = ((_code: number) => process.exit(_code)) as (_code: number) => void,
  resolveTaskFileFn = resolveTaskFile,
  getTaskImplementerFn = getTaskImplementer,
  rootDir = process.cwd(),
}: {
  resolveConflictsFn?: Function,
  startAgentFn?: Function,
  exitFn?: (_code: number) => void,
  resolveTaskFileFn?: Function,
  getTaskImplementerFn?: Function,
  rootDir?: string,
} = {}) {
  const explicitSlug = args[0];
  const slug = inferSlug(explicitSlug);
  if (!slug) {
    fmt.log.fail('Usage: px resolve-conflict [<slug>]');
    exitFn(1);
    return;
  }

  const missionDir = findMissionDir(slug);
  const area = missionDir ? findMissionArea(missionDir) : 'docs';

  const result = resolveConflictsFn(slug, area);

  // No conflicts — nothing to resolve.
  if (result.ok && result.conflictFiles.length === 0) {
    exitFn(0);
    return;
  }

  // Shared-file conflicts: the agent cannot guess the correct resolution.
  // Stop and require human intervention.
  if (!result.ok && result.error === 'shared-file-conflicts') {
    fmt.log.fail('Shared-file conflicts require human resolution. Agent cannot guess the correct merge outcome.');
    fmt.log.info(`Shared files: ${result.sharedFiles.map((f: string) => fmt.path(f)).join(', ')}`);
    fmt.log.info(`Resolve manually, then re-run: ${fmt.command(`px integrate ${slug} --dry-run`)}`);
    exitFn(1);
    return;
  }

  // Other errors (worktree missing, merge-failed, etc.) — already logged by resolveConflictsFn.
  if (!result.ok) {
    exitFn(1);
    return;
  }

  // Conflict resolution is implementation work owned by the mission's recorded
  // implementer (TASK-2294.01). Resolve that family before launching; there is
  // no separate conflict-resolution pool to fall back on.
  const taskResolution = resolveTaskFileFn(slug, rootDir) as {ok: boolean, taskFile?: string};
  const implementer = taskResolution && taskResolution.ok && taskResolution.taskFile
    ? getTaskImplementerFn(taskResolution.taskFile) as string | null
    : null;
  if (!implementer) {
    fmt.log.fail(`No recorded implementer for ${fmt.slug(slug)}; cannot launch conflict resolution.`);
    fmt.log.info('Conflict resolution runs as the mission implementer. Set the task assignee to a supported agent family, then re-run.');
    fmt.log.info(`Recovery: ${fmt.command(`px resolve-conflict ${slug}`)}`);
    exitFn(1);
    return;
  }

  // All conflicts are mission-specific: launch an agent to execute the --theirs rebase.
  const prompt = buildAgentResolutionPrompt({
    slug,
    area,
    worktreePath: result.worktreePath,
    missionSpecificFiles: result.missionSpecificFiles,
  });

  fmt.log.info(`Launching implementer (${fmt.agent(implementer)}) to execute mission-specific conflict resolution...`);
  let agent: string;
  let agentResult: {status: number};
  try {
    ({ agent, result: agentResult } = await startAgentFn('conflict-resolution', {
      prompt,
      worktree: result.worktreePath,
      agent: implementer,
      slug,
      role: 'implementer',
      pinnedAgent: true,
    }));
  } catch (err: any) {
    fmt.log.fail(`Implementer (${fmt.agent(implementer)}) cannot run conflict resolution: ${err.message || String(err)}`);
    fmt.log.info('Parallix does not substitute another agent family for the mission implementer.');
    fmt.log.info(`Recovery: clear the blocker for ${fmt.agent(implementer)}, then re-run ${fmt.command(`px resolve-conflict ${slug}`)}`);
    exitFn(1);
    return;
  }

  if (agentResult.status !== 0) {
    fmt.log.fail(`Agent (${fmt.agent(agent)}) exited with status ${agentResult.status}.`);
    exitFn(agentResult.status || 1);
    return;
  }

  fmt.log.pass(`Agent (${fmt.agent(agent)}) completed conflict resolution.`);
  exitFn(0);
}

(resolveConflict as any).buildAgentResolutionPrompt = buildAgentResolutionPrompt;
export default resolveConflict;
export { resolveConflict, buildAgentResolutionPrompt };
