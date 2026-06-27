const { detectRebaseState, getCurrentBranch, getUncommittedCount, getLastThreeCommits, run } = require('../core/git');
const { findTaskFile, getTaskStatus } = require('../tools/backlog');
const { findMissionDir, findCheckpoints, getFirstLine, inferSlug, missionBranchPrefix, missionBranchName } = require('../core/mission-utils');
const { WORKFLOW_AGENT_NAMES, eligibleAgentsForStep, readAgentConfigOrExit, workflowLauncherStatus } = require('../agents/agents');
const { getPrStatus } = require('../tools/forgejo');
const path = require('path');
const fmt = require('../core/fmt');

function parseWorktreeList(porcelain) {
  const entries = [];
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

function formatWorktreeBranch(ref) {
  if (!ref) {return '(detached HEAD)';}
  return ref.replace(/^refs\/heads\//, '');
}

function logRebaseDiagnostics(log, label, rebaseState) {
  const detachedText = rebaseState.detached ? 'detached HEAD, ' : '';
  log(`${label}: ${detachedText}${rebaseState.unmergedFiles.length} unmerged file(s)`);
  rebaseState.unmergedFiles.forEach(file => {
    log(`  - ${file}`);
  });
}

function status(args, options = {}) {
  const exit = options.exit || process.exit;
  const log = options.log || fmt.log.plain;
  const inferSlugFn = options.inferSlugFn || inferSlug;
  const getCurrentBranchFn = options.getCurrentBranchFn || getCurrentBranch;
  const findTaskFileFn = options.findTaskFileFn || findTaskFile;
  const getTaskStatusFn = options.getTaskStatusFn || getTaskStatus;
  const findMissionDirFn = options.findMissionDirFn || findMissionDir;
  const findCheckpointsFn = options.findCheckpointsFn || findCheckpoints;
  const getFirstLineFn = options.getFirstLineFn || getFirstLine;
  const getPrStatusFn = options.getPrStatusFn || getPrStatus;
  const findStaleMissionWorktreesFn = options.findStaleMissionWorktreesFn || findStaleMissionWorktrees;
  const readAgentConfigOrExitFn = options.readAgentConfigOrExitFn || readAgentConfigOrExit;
  const eligibleAgentsForStepFn = options.eligibleAgentsForStepFn || eligibleAgentsForStep;
  const allWorkflowAgentNamesFn = options.allWorkflowAgentNamesFn || (() => WORKFLOW_AGENT_NAMES);
  const workflowLauncherStatusFn = options.workflowLauncherStatusFn || workflowLauncherStatus;
  const getLastThreeCommitsFn = options.getLastThreeCommitsFn || getLastThreeCommits;
  const getUncommittedCountFn = options.getUncommittedCountFn || getUncommittedCount;
  const detectRebaseStateFn = options.detectRebaseStateFn || detectRebaseState;

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
    staleWorktrees.forEach(entry => {
      log(`Stale worktree: ${fmt.path(entry.path)} (task: ${entry.taskStatus})`);
      try {
        const rebaseState = detectRebaseStateFn(entry.path);
        if (rebaseState.inProgress) {
          logRebaseDiagnostics(log, `Rebase in progress on ${formatWorktreeBranch(entry.branch)}`, rebaseState);
        }
      } catch (_) {
        // Ignore stale worktrees that disappear during inspection.
      }
      log(`  Cleanup: ${fmt.command(entry.cleanupCommand)}`);
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
  lastThree.forEach(c => log(`  - ${c}`));

  log(`Uncommitted files: ${getUncommittedCountFn()}`);
  log(fmt.bold('----------------------'));
  exit(0);
}

module.exports = status;
module.exports.parseWorktreeList = parseWorktreeList;
module.exports.findStaleMissionWorktrees = findStaleMissionWorktrees;
