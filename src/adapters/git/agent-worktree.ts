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
    timeout: 1000
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

    const result = spawnSync('git', ['-C', cwd, 'worktree', 'list', '--porcelain'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 1000
    });
    if (result.status !== 0) {
      warn(
        `Could not inspect git worktrees while looking for main-worktree agents.local.json; ` +
        `skipping that lookup (git exited with status ${result.status}).`
      );
      return null;
    }

    const lines = result.stdout.split('\n');
    const mainWorktreePath = detectMainWorktreePath(lines, cwd, commonDir);
    if (mainWorktreePath) {
      MainWorktreeDetector.byCommonDir.set(commonDir, mainWorktreePath);
      return mainWorktreePath;
    }

    let i = 0;
    while (i < lines.length) {
      if (lines[i].startsWith('worktree ')) {
        const wt = lines[i].slice('worktree '.length).trim();
        const branchLineIdx = i + 1;
        if (branchLineIdx < lines.length && lines[branchLineIdx].startsWith('branch refs/heads/main')) {
          MainWorktreeDetector.byCommonDir.set(commonDir, wt);
          return wt;
        }
      }
      i++;
    }

    for (i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('worktree ')) {
        const wt = lines[i].slice('worktree '.length).trim();
        if (wt !== cwd) {
          MainWorktreeDetector.byCommonDir.set(commonDir, wt);
          return wt;
        }
      }
    }
  } catch (err) {
    const e: Error & {code?: string} = (err as any);
    const detail = e && (e.code || e.message) ? (e.code || e.message) : 'unknown error';
    warn(
      `Could not inspect git worktrees while looking for main-worktree agents.local.json; ` +
      `skipping that lookup (${detail}).`
    );
    return null;
  }

  warn(
    'Could not determine the main worktree from `git worktree list --porcelain`; ' +
    'skipping main-worktree agents.local.json lookup.'
  );
  return null;
}

export {
  getMainWorktreePath,
  getGitPath,
  parseWorktreePaths,
  detectMainWorktreePath
};
