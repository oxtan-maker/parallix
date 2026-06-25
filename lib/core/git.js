const childProcess = require('child_process');

function git(args, options = {}) {
  const spawnOptions = {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options
  };
  const result = childProcess.spawnSync('git', args, spawnOptions);
  if (result.error && result.status == null) {
    throw result.error;
  }
  return result;
}

function run(command, args, options = {}) {
  const spawnOptions = {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options
  };
  const result = childProcess.spawnSync(command, args, spawnOptions);
  if (result.error && result.status == null) {
    throw result.error;
  }
  return result;
}

function getCurrentBranch(cwd = process.cwd()) {
  const result = git(['-C', cwd, 'branch', '--show-current']);
  return result.stdout.trim();
}

function getWorktreeStatus(cwd = process.cwd()) {
  const result = git(['-C', cwd, 'status', '--porcelain']);
  return result.stdout
    .split('\n')
    .map(line => line.trimEnd())
    .filter(Boolean);
}

function isDirty(cwd = process.cwd()) {
  const result = git(['-C', cwd, 'status', '--porcelain']);
  return result.stdout.trim().length > 0;
}

function getUncommittedCount(cwd = process.cwd()) {
  const result = git(['-C', cwd, 'status', '--porcelain']);
  if (!result.stdout.trim()) return 0;
  return result.stdout.trim().split('\n').length;
}

function parseUnmergedFiles(output = '') {
  return Array.from(new Set(
    output
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => line.split('\t')[1])
      .filter(Boolean)
  ));
}

function detectRebaseState(cwd = process.cwd(), { gitRunner = git, fsModule = require('fs'), pathModule = require('path') } = {}) {
  const gitDirResult = gitRunner(['-C', cwd, 'rev-parse', '--git-dir']);
  const resolvedGitDir = gitDirResult.status === 0
    ? gitDirResult.stdout.trim()
    : '.git';
  const gitDir = pathModule.isAbsolute(resolvedGitDir)
    ? resolvedGitDir
    : pathModule.join(cwd, resolvedGitDir);
  const rebaseMergeDir = pathModule.join(gitDir, 'rebase-merge');
  const rebaseApplyDir = pathModule.join(gitDir, 'rebase-apply');
  const rebaseDir = fsModule.existsSync(rebaseMergeDir)
    ? rebaseMergeDir
    : (fsModule.existsSync(rebaseApplyDir) ? rebaseApplyDir : null);

  const headResult = gitRunner(['-C', cwd, 'symbolic-ref', '--quiet', '--short', 'HEAD']);
  const detached = headResult.status !== 0;

  const showCurrentResult = gitRunner(['-C', cwd, 'rebase', '--show-current']);
  const rebaseHead = showCurrentResult.status === 0 ? showCurrentResult.stdout.trim() : '';

  const unmergedResult = gitRunner(['-C', cwd, 'ls-files', '-u']);
  const unmergedFiles = unmergedResult.status === 0 ? parseUnmergedFiles(unmergedResult.stdout) : [];

  const inProgress = Boolean(rebaseDir || rebaseHead || unmergedFiles.length > 0);

  return {
    inProgress,
    rebaseHead,
    detached,
    unmergedFiles,
    rebaseDir
  };
}

function getLastCommit() {
  const result = git(['log', '-1', '--format=%H|%ad|%s']);
  const [sha, date, subject] = result.stdout.trim().split('|');
  return { sha, date, subject };
}

function getLastThreeCommits() {
  const result = git(['log', '-3', '--format=%s']);
  return result.stdout.trim().split('\n');
}

module.exports = {
  git,
  run,
  getCurrentBranch,
  getWorktreeStatus,
  isDirty,
  getUncommittedCount,
  detectRebaseState,
  getLastCommit,
  getLastThreeCommits
};
