import childProcess from 'node:child_process';
import path from 'node:path';
import { git } from '../core/git.js';
import { getPrimaryBranch, missionBranchName, inferSlug, resolveWorktree } from '../core/mission-utils.js';
import * as fmt from '../core/fmt.js';

/** @param {string[]} args @param {{gitFn?: Function, spawnSyncFn?: Function, getPrimaryBranchFn?: Function, missionBranchNameFn?: Function, inferSlugFn?: Function, resolveWorktreeFn?: Function, exitFn?: Function, failFn?: Function}} opts */
async function diff(args: any, {
  gitFn = git,
  spawnSyncFn = childProcess.spawnSync,
  getPrimaryBranchFn = getPrimaryBranch,
  missionBranchNameFn = missionBranchName,
  inferSlugFn = inferSlug,
  resolveWorktreeFn = resolveWorktree,
  exitFn = process.exit,
  failFn = fmt.log.fail,
} = {}) {
  /** @param {string} a */
  const explicitSlug = args.filter((a: string) => !a.startsWith('--'))[0];
  const slug = inferSlugFn(explicitSlug);

  if (!slug) {
    failFn('Usage: node parallix diff [<slug>]');
    exitFn(1);
    return;
  }

  const worktree = resolveWorktreeFn(slug);
  if (!worktree) {
    failFn(`Mission worktree not found for ${fmt.slug(slug)}. Run this from the mission worktree or create it first.`);
    exitFn(1);
    return;
  }

  let primary;
  try {
    primary = getPrimaryBranchFn(worktree);
  } catch (err) {
    failFn((err as Error).message);
    exitFn(1);
    return;
  }

  const branch = missionBranchNameFn(slug);
  const target = `${primary}..HEAD`;

  // Detect configured diff tool/pager
  /** @param {string} key */
  const getGitConfig = (key: string) => {
    const result = gitFn(['-C', worktree, 'config', '--get', key]);
    return result.status === 0 ? result.stdout.trim() : null;
  };

  /** @param {string} cmd */
  const isSpecializedTool = (cmd: string) => {
    if (!cmd) {return false;}
    const parts = cmd.split(/\s+/);
    // Handle cases like "LESS=FRX less" or "/usr/bin/delta"
    /** @param {string} p */
    const exePart = parts.find((p: string) => !p.includes('='));
    if (!exePart) {return false;}
    const exe = path.basename(exePart).toLowerCase();
    
    // Explicitly reject known default pagers
    if (['less', 'cat', 'more'].includes(exe)) {return false;}
    
    // Accept known specialized tools documented in review-tooling.md
    if (['delta', 'difft', 'diff-so-fancy'].includes(exe)) {return true;}
    
    // Fallback: if it's not a known default, and we have a value, treat it as specialized
    // for now to avoid breaking custom setups like "vimdiff", but we've rejected plain "less".
    return true;
  };

  /** @param {childProcess.SpawnSyncReturns<string>} result @param {string} toolName */
  const handleLaunchResult = (result: any, toolName: string) => {
    if (result.error) {
      failFn(`Failed to launch ${toolName}: ${result.error.message}`);
      exitFn(1);
      return;
    }
    if (result.signal) {
      failFn(`${toolName} terminated by signal: ${result.signal}`);
      exitFn(1);
      return;
    }
    if (result.status === null) {
      failFn(`${toolName} exited with unknown status.`);
      exitFn(1);
      return;
    }
    exitFn(result.status);
  };

  const diffTool = getGitConfig('diff.tool');
  if (diffTool) {
    fmt.log.info(`Launching ${fmt.command('git difftool')} for ${fmt.branch(branch)} (tool: ${fmt.bold(diffTool)})...`);
    const result = spawnSyncFn('git', ['difftool', '-d', '--no-prompt', target], { cwd: worktree, stdio: 'inherit' });
    handleLaunchResult(result, 'git difftool');
    return;
  }

  const pagerDiff = getGitConfig('pager.diff');
  if (isSpecializedTool(pagerDiff || '')) {
    fmt.log.info(`Launching ${fmt.command('git diff')} for ${fmt.branch(branch)} (pager: ${fmt.bold(pagerDiff || "")})...`);
    const result = spawnSyncFn('git', ['diff', target], { cwd: worktree, stdio: 'inherit' });
    handleLaunchResult(result, 'git diff');
    return;
  }

  const corePager = getGitConfig('core.pager');
  if (isSpecializedTool(corePager || '')) {
    fmt.log.info(`Launching ${fmt.command('git diff')} for ${fmt.branch(branch)} (core.pager: ${fmt.bold(corePager || "")})...`);
    const result = spawnSyncFn('git', ['diff', target], { cwd: worktree, stdio: 'inherit' });
    handleLaunchResult(result, 'git diff');
    return;
  }

  failFn('No specialized local diff tool (e.g., delta, difftastic) is configured in Git.');
  fmt.log.info('The workflow diff command requires an explicitly configured diff.tool or a non-default core.pager.');
  fmt.log.info(`Refer to ${fmt.path('docs/developer-setup/review-tooling.md')} for setup guidance.`);
  exitFn(1);
}

export default diff;
export { diff };

// CJS compat: ensure require() returns the function directly
declare const module: { exports: any } | undefined;
if (typeof module !== 'undefined') { module.exports = diff; }
