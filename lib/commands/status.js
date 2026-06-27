const { detectRebaseState, getCurrentBranch, getUncommittedCount, getLastThreeCommits, run } = require('../core/git');
const { findTaskFile, getTaskStatus } = require('../tools/backlog');
const { findMissionDir, findCheckpoints, getFirstLine, inferSlug, missionBranchPrefix, missionBranchName } = require('../core/mission-utils');
const { WORKFLOW_AGENT_NAMES, eligibleAgentsForStep, readAgentConfigOrExit, workflowLauncherStatus } = require('../agents/agents');
const { getPrStatus } = require('../tools/forgejo');
const path = require('path');
const fmt = require('../core/fmt');

/** @param {string} porcelain */
function parseWorktreeList(porcelain) {
  const entries = [];
  /** @type{{path: string, branch: string | null} | null} */
  let current = null;

  for (const line of porcelain.split('\n')) {
    if (!line.trim()) {
      if (current) {
        entries.push(current);
        current = null;
      }
      continue;
    }

    if (line.startsWith('worktree ')) {
      if (current) {entries.push(current);}
      current = { path: line.slice('worktree '.length).trim(), branch: null };
      continue;
    }

    if (line.startsWith('branch ') && current) {
      current.branch = line.slice('branch '.length).trim();
    }
  }

  if (current) {entries.push(current);}
  return entries;
}

function findStaleMissionWorktrees({
  gitRun = run,
  findTaskFileFn = findTaskFile,
  getTaskStatusFn = getTaskStatus,
  primaryWorktree = null
} = {}) {
  const result = gitRun('git', ['worktree', 'list', '--porcelain']);
  if (result.status !== 0) {
    return [];
  }

  /** @type {string | null} */
  let resolvedPrimary = primaryWorktree;
  if (!resolvedPrimary) {
    try {
      const { getPrimaryWorktree } = require('../core/mission-utils');
      resolvedPrimary = getPrimaryWorktree();
    } catch (_) {
      resolvedPrimary = null;
    }
  }

  return parseWorktreeList(result.stdout)
    .filter(entry => entry.path !== resolvedPrimary)
    .map(entry => {
      const branchRef = entry.branch || '';
      const prefix = missionBranchPrefix(resolvedPrimary || process.cwd());
      const normalizedRefPrefix = `refs/heads/${prefix}`;
      const match = branchRef.startsWith(normalizedRefPrefix)
        ? [branchRef, branchRef.slice(normalizedRefPrefix.length)]
        : null;
      if (!match) {return null;}

      const slug = match[1];
      const taskFile = findTaskFileFn(slug);
      const taskStatus = taskFile ? getTaskStatusFn(taskFile) : null;
      if (taskStatus !== 'done' && taskFile) {
        return null;
      }

      return {
        slug,
        path: entry.path,
        branch: branchRef,
        taskStatus: taskStatus || 'missing',
        cleanupCommand: taskStatus === 'done'
          ? `scripts/cleanup-mission-worktree.sh ${slug}`
          : `git worktree remove ${entry.path} && git branch -D ${missionBranchName(slug, resolvedPrimary || process.cwd())}`
      };
    })
    .filter(Boolean);
}

/** @param {string} ref */
function formatWorktreeBranch(ref) {
  if (!ref) {return '(detached HEAD)';}
  return ref.replace(/^refs\/heads\//, '');
}

/** @param {Function} log @param {string} label @param {{detached?: boolean, unmergedFiles: string[]}} rebaseState */
function logRebaseDiagnostics(log, label, rebaseState) {
  const detachedText = rebaseState.detached ? 'detached HEAD, ' : '';
  log(`${label}: ${detachedText}${rebaseState.unmergedFiles.length} unmerged file(s)`);
  rebaseState.unmergedFiles.forEach(file => {
    log(`  - ${file}`);
  });
}

/** @param {string[]} args @param {{exit?: Function, log?: Function, inferSlugFn?: Function, getCurrentBranchFn?: Function, findTaskFileFn?: Function, getTaskStatusFn?: Function, findMissionDirFn?: Function, findCheckpointsFn?: Function, getFirstLineFn?: Function, getPrStatusFn?: Function, findStaleMissionWorktreesFn?: Function, readAgentConfigOrExitFn?: Function, eligibleAgentsForStepFn?: Function, allWorkflowAgentNamesFn?: Function, workflowLauncherStatusFn?: Function, getLastThreeCommitsFn?: Function, getUncommittedCountFn?: Function, detectRebaseStateFn?: Function}} opts */
function status(args, opts = {}) {
  const exit = opts.exit || process.exit;
  const log = opts.log || fmt.log.plain;
  const inferSlugFn = opts.inferSlugFn || inferSlug;
  const getCurrentBranchFn = opts.getCurrentBranchFn || getCurrentBranch;
  const findTaskFileFn = opts.findTaskFileFn || findTaskFile;
  const getTaskStatusFn = opts.getTaskStatusFn || getTaskStatus;
  const findMissionDirFn = opts.findMissionDirFn || findMissionDir;
  const findCheckpointsFn = opts.findCheckpointsFn || findCheckpoints;
  const getFirstLineFn = opts.getFirstLineFn || getFirstLine;
  const getPrStatusFn = opts.getPrStatusFn || getPrStatus;
  const findStaleMissionWorktreesFn = opts.findStaleMissionWorktreesFn || findStaleMissionWorktrees;
  const readAgentConfigOrExitFn = opts.readAgentConfigOrExitFn || readAgentConfigOrExit;
  const eligibleAgentsForStepFn = opts.eligibleAgentsForStepFn || eligibleAgentsForStep;
  const allWorkflowAgentNamesFn = opts.allWorkflowAgentNamesFn || (() => WORKFLOW_AGENT_NAMES);
  const workflowLauncherStatusFn = opts.workflowLauncherStatusFn || workflowLauncherStatus;
  const getLastThreeCommitsFn = opts.getLastThreeCommitsFn || getLastThreeCommits;
  const getUncommittedCountFn = opts.getUncommittedCountFn || getUncommittedCount;
  const detectRebaseStateFn = opts.detectRebaseStateFn || detectRebaseState;

  const explicitSlug = args[0];
  const slug = inferSlugFn(explicitSlug);

  log(fmt.bold('--- Mission Status ---'));
  log(`Branch: ${fmt.branch(getCurrentBranchFn())}`);
  log(`Worktree: ${fmt.path(process.cwd())}`);

  try {
    const rebaseState = detectRebaseStateFn(process.cwd());
    if (rebaseState.inProgress && rebaseState.detached) {
      logRebaseDiagnostics(log, 'Detached HEAD: rebase in progress', rebaseState);
    }
  } catch (_) {
    // Ignore transient worktree/git-state failures in status output.
  }

  if (slug) {
    const taskFile = findTaskFileFn(slug);
    const taskStatus = getTaskStatusFn(taskFile);
    log(`Backlog status: ${taskStatus || 'unknown'}`);

    const missionDir = findMissionDirFn(slug);
    if (missionDir) {
      const checkpoints = findCheckpointsFn(missionDir);
      if (checkpoints.length > 0) {
        const lastCP = checkpoints[checkpoints.length - 1];
        const firstLine = getFirstLineFn(lastCP);
        log(`Last checkpoint: ${path.basename(lastCP)} - ${firstLine}`);
      } else {
        log('Last checkpoint: none');
      }
    } else {
      log('Last checkpoint: unknown');
    }

    // Forgejo PR state
    const pr = getPrStatusFn(missionBranchName(slug));
    if (pr.exists) {
      log(`Forgejo PR: #${pr.number} (${pr.state})`);
    } else if (pr.raw) {
      log(`Forgejo PR: unavailable (${pr.raw})`);
    } else {
      log('Forgejo PR: none');
    }
  }

  if (!explicitSlug) {
    const staleWorktrees = findStaleMissionWorktreesFn();
    staleWorktrees.forEach(/** @param {{path: string, branch: string | null, taskStatus: string | null, cleanupCommand?: string}} entry */ (entry) => {
      log(`Stale worktree: ${fmt.path(entry.path)} (task: ${entry.taskStatus})`);
      try {
        const rebaseState = detectRebaseStateFn(entry.path);
        if (rebaseState.inProgress) {
          logRebaseDiagnostics(log, `Rebase in progress on ${formatWorktreeBranch(entry.branch || '')}`, rebaseState);
        }
      } catch (_) {
        // Ignore stale worktrees that disappear during inspection.
      }
      log(`  Cleanup: ${fmt.command(entry.cleanupCommand || '')}`);
    });
  }

  // Agent eligibility matrix
  const config = readAgentConfigOrExitFn();
  const draftEligible = eligibleAgentsForStepFn('draft', { config });
  const activeEligible = eligibleAgentsForStepFn('active', { config });
  const baseAgents = allWorkflowAgentNamesFn();
  const allAgents = [...new Set([...baseAgents, ...draftEligible, ...activeEligible])].sort();
  const envOverride = process.env.WORKFLOW_AGENT;
  log('Agent launcher matrix:');
  for (const agent of allAgents) {
    const launcher = workflowLauncherStatusFn(agent);
    const support = launcher.supported ? 'supported' : 'blocked';
    const draftMark = draftEligible.includes(agent) ? 'draft' : '-';
    const activeMark = activeEligible.includes(agent) ? 'active' : '-';
    log(`  ${fmt.agent(agent)}: ${support} | eligible: ${draftMark},${activeMark}`);
  }
  if (envOverride) {
    log(`  (WORKFLOW_AGENT override: ${fmt.agent(envOverride)})`);
  }

  const lastThree = getLastThreeCommitsFn();
  log('Last 3 commits:');
  lastThree.forEach(/** @param {string} c */ (c) => log(`  - ${c}`));

  log(`Uncommitted files: ${getUncommittedCountFn()}`);
  log(fmt.bold('----------------------'));
  exit(0);
}

module.exports = status;
module.exports.parseWorktreeList = parseWorktreeList;
module.exports.findStaleMissionWorktrees = findStaleMissionWorktrees;
