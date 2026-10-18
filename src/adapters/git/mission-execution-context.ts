import fs from 'node:fs';
import path from 'node:path';
import type { ParallixConfiguration } from '../../application/ports/configuration.js';
import type { MissionExecutionContextResolution } from '../../application/ports/mission-execution-context.js';
import { missionBranchName } from '../filesystem/mission-paths.js';
import * as gitModule from './git.js';
import { conventionalWorktreePath, getPrimaryWorktree, resolveBaseWorktree, resolveMissionBaseBranch, type GitReader } from './worktree.js';

/**
 * Resolve where one Mission operation executes from its identity. `root` is
 * any checkout of the repository (a web host passes its own); it only locates
 * the repository and never stands in for the mission or base checkout.
 */
export function resolveMissionExecutionContext(slug: string, root: string, configuration: ParallixConfiguration,
  gitFn: GitReader = gitModule.git): MissionExecutionContextResolution {
  const missionBranch = missionBranchName(slug, root);
  const located = locateMissionWorktree(slug, root, missionBranch, configuration, gitFn);
  if ('fact' in located) { return { ok: false, reason: `Mission ${slug}: ${located.fact}` }; }
  const missionWorktree = located.path;
  const observed = gitFn(['-C', missionWorktree, 'branch', '--show-current']).stdout.trim();
  if (observed !== missionBranch) {
    return { ok: false, reason: `Mission ${slug}: mission worktree ${missionWorktree} is on ${observed || '(detached HEAD)'}, expected ${missionBranch}.` };
  }
  const base = receivingBase(slug, missionWorktree, configuration);
  if ('fact' in base) { return { ok: false, reason: `Mission ${slug}: ${base.fact}` }; }
  return { ok: true, context: { missionId: slug, missionWorktree: path.resolve(missionWorktree), missionBranch, baseWorktree: path.resolve(base.worktree), baseBranch: base.branch } };
}

/** The live worktree registered on the mission branch, else the conventional path for the wrong-branch diagnosis. */
function locateMissionWorktree(slug: string, root: string, missionBranch: string, configuration: ParallixConfiguration, gitFn: GitReader): { path: string } | { fact: string } {
  const listed = liveWorktree(gitFn(['-C', root, 'worktree', 'list', '--porcelain']).stdout, `refs/heads/${missionBranch}`);
  if (listed && (listed.prunable || !fs.existsSync(listed.path))) {
    return { fact: `mission worktree ${listed.path} for ${missionBranch} is missing; restore it, or run git worktree prune and recreate it, before retrying.` };
  }
  if (listed) { return { path: listed.path }; }
  let expected: string;
  try { expected = conventionalWorktreePath(slug, getPrimaryWorktree(configuration)); }
  catch (error) { return { fact: `mission worktree for ${missionBranch} cannot be located: ${(error as Error).message}` }; }
  return fs.existsSync(expected) ? { path: expected } : { fact: `no worktree is checked out on ${missionBranch} (expected ${expected}).` };
}

function receivingBase(slug: string, missionWorktree: string, configuration: ParallixConfiguration): { branch: string; worktree: string } | { fact: string } {
  let branch: string;
  try { branch = resolveMissionBaseBranch(slug, missionWorktree); }
  catch (error) { return { fact: `receiving base branch cannot be resolved: ${(error as Error).message}` }; }
  let worktree: string;
  try { worktree = resolveBaseWorktree(slug, { rootDir: missionWorktree, configuration }); }
  catch (error) { return { fact: `receiving base worktree for ${branch} cannot be resolved: ${(error as Error).message}` }; }
  if (!worktree || !fs.existsSync(worktree)) { return { fact: `receiving base worktree ${worktree || '(none)'} for ${branch} is missing.` }; }
  return { branch, worktree };
}

function liveWorktree(porcelain: string, branchRef: string): { path: string; prunable: boolean } | null {
  for (const block of porcelain.split('\n\n')) {
    const lines = block.split('\n');
    const entry = lines.find(line => line.startsWith('worktree '));
    if (entry && lines.includes(`branch ${branchRef}`)) {
      return { path: entry.slice('worktree '.length).trim(), prunable: lines.some(line => line.startsWith('prunable')) };
    }
  }
  return null;
}
