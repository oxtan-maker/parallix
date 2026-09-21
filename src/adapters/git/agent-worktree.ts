import path from 'node:path';
import { spawnSync } from 'node:child_process';
import * as fmt from '../../application/presentation/cli-format.js';

// Cached per git common directory to avoid repeated subprocess calls without
// leaking a temp-repo answer into later tests or nested workflow invocations.
const MainWorktreeDetector = {
  byCommonDir: new Map<string, string>()
};

function getGitPath(cwd: string, args: string[]) {
  const result = spawnSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    // A busy host (parallel test workers, other jobs) can push a cold git
    // spawn past 1 s; 5 s keeps the lookup useful instead of silently
    // degrading to "no main worktree found".
    timeout: 5000
  });
  if (result.status !== 0) {
    return null;
  }
  return result.stdout.trim() || null;
}

function parseWorktreePaths(lines: string[]) {
  return lines
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice('worktree '.length).trim())
    .filter(Boolean);
}

function detectMainWorktreePath(lines: string[], cwd: string, commonDir: string | null) {
  const worktrees = parseWorktreePaths(lines);
  if (worktrees.length === 0) {
    return null;
  }

  const resolvedCommonDir = commonDir ? path.resolve(commonDir) : null;
  for (const wt of worktrees) {
    const gitDir = getGitPath(wt, ['rev-parse', '--absolute-git-dir']);
    const wtCommonDir = getGitPath(wt, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
    if (
      gitDir &&
      wtCommonDir &&
      path.resolve(gitDir) === path.resolve(wtCommonDir) &&
      (!resolvedCommonDir || path.resolve(wtCommonDir) === resolvedCommonDir)
    ) {
      return wt;
    }
  }

  const currentTopLevel = getGitPath(cwd, ['rev-parse', '--show-toplevel']);
  if (currentTopLevel && worktrees.length === 1 && path.resolve(worktrees[0]) === path.resolve(currentTopLevel)) {
    return worktrees[0];
  }
  return null;
}

function fallbackMainWorktree(lines: string[], cwd: string): string | null {
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].startsWith('worktree ') && lines[i + 1]?.startsWith('branch refs/heads/main')) {
      return lines[i].slice('worktree '.length).trim();
    }
  }
  for (const line of lines) {
    if (line.startsWith('worktree ')) {
      const worktree = line.slice('worktree '.length).trim();
      if (worktree !== cwd) { return worktree; }
    }
  }
  return null;
}

function worktreeLookupWarning(detail?: string) {
  return detail
    ? `Could not inspect git worktrees while looking for main-worktree agents.local.json; skipping that lookup (${detail}).`
    : 'Could not inspect git worktrees while looking for main-worktree agents.local.json; skipping that lookup.';
}

function cacheMainWorktree(commonDir: string, value: string | null) {
  if (value) { MainWorktreeDetector.byCommonDir.set(commonDir, value); }
  return value;
}

function listWorktreeLines(cwd: string, warn: Function): string[] | null {
  const result = spawnSync('git', ['-C', cwd, 'worktree', 'list', '--porcelain'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 });
  if (result.status === 0) { return result.stdout.split('\n'); }
  warn(worktreeLookupWarning(`git exited with status ${result.status}`));
  return null;
}

function getMainWorktreePath(options: {cwd?: string, warn?: Function} = {}) {
  const { cwd = process.cwd(), warn = fmt.log.warn } = options;
  try {
    const commonDir = getGitPath(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
    if (commonDir && MainWorktreeDetector.byCommonDir.has(commonDir)) {
      return MainWorktreeDetector.byCommonDir.get(commonDir);
    }

    if (!commonDir) {
      return null;
    }

    const lines = listWorktreeLines(cwd, warn);
    if (!lines) { return null; }
    const mainWorktreePath = detectMainWorktreePath(lines, cwd, commonDir);
    if (mainWorktreePath) { return cacheMainWorktree(commonDir, mainWorktreePath); }
    return cacheMainWorktree(commonDir, fallbackMainWorktree(lines, cwd));
  } catch (err) {
    const e: Error & {code?: string} = (err as any);
    const detail = e && (e.code || e.message) ? (e.code || e.message) : 'unknown error';
    warn(worktreeLookupWarning(detail));
    return null;
  }

}

export {
  getMainWorktreePath,
  getGitPath,
  parseWorktreePaths,
  detectMainWorktreePath
};
