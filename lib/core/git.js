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
  getLastCommit,
  getLastThreeCommits
};
