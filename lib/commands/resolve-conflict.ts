import integrate from './integrate.js';
import { findMissionDir, findMissionArea, inferSlug, getPrimaryBranch } from '../core/mission-utils.js';
import { startAgent } from '../agents/agents.js';
import * as fmt from '../core/fmt.js';
import { formatVerificationCommand } from '../core/verification.js';

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

/** @param {string[]} args @param {{resolveConflictsFn?: Function, startAgentFn?: Function, exitFn?: Function}} opts */
async function resolveConflict(args: string[], {
  resolveConflictsFn = (integrate as any).resolveConflictsForMission,
  startAgentFn = startAgent,
  exitFn = ((code: number) => process.exit(code)) as (code: number) => void,
}: {resolveConflictsFn?: Function, startAgentFn?: Function, exitFn?: (code: number) => void} = {}) {
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

  // All conflicts are mission-specific: launch an agent to execute the --theirs rebase.
  const prompt = buildAgentResolutionPrompt({
    slug,
    area,
    worktreePath: result.worktreePath,
    missionSpecificFiles: result.missionSpecificFiles,
  });

  fmt.log.info('Launching agent to execute mission-specific conflict resolution...');
  const { agent, result: agentResult } = await startAgentFn('conflict-resolution', {
    prompt,
    worktree: result.worktreePath,
  });

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

// CJS compat: ensure require() returns the function directly
declare const module: { exports: any } | undefined;
if (typeof module !== 'undefined') { module.exports = resolveConflict; }
