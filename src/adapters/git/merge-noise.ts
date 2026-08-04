import path from 'node:path';
import * as fmt from '../../application/presentation/cli-format.js';
import { resolveTaskStorage } from '../config/product-config.js';
import * as gitModule from './git.js';
import { missionPathForSlug, missionDirForSlug, getMissionYear } from '../filesystem/mission-paths.js';

/**
 * Parse files with merge conflicts from the output of `git merge --no-commit --no-ff`.
 *
 * Git emits lines of the form:
 *   CONFLICT (content): Merge conflict in path/to/file
 *   CONFLICT (modify/delete): path/to/file deleted in HEAD.
 *   CONFLICT (add/add): Merge conflict in path/to/file
 *
 * Returns an array of relative file paths (deduped).
 */
/** @param {string} output */
export function parseConflictFilesFromMergeOutput(output: string): string[] {
  const seen = new Set<string>();
  const files: string[] = [];
  for (const line of output.split('\n')) {
    if (!line.startsWith('CONFLICT')) {continue;}
    const inMatch = line.match(/Merge conflict in (.+)$/);
    if (inMatch) {
      const f = inMatch[1].trim();
      if (f && !seen.has(f)) { seen.add(f); files.push(f); }
      continue;
    }
    const colonIdx = line.indexOf(':');
    if (colonIdx !== -1) {
      const rest = line.slice(colonIdx + 1).trim();
      const f = rest.split(/\s+/)[0];
      if (f && !seen.has(f)) { seen.add(f); files.push(f); }
    }
  }
  return files;
}

/**
 * Identify files that would have merge conflicts when merging `branch` into `rootDir`.
 *
 * Performs a dry `git merge --no-commit --no-ff` in `rootDir`, collects conflict
 * file paths from the output, aborts the in-progress merge, and returns the list.
 *
 * @param {string} rootDir - Absolute path to the git worktree to test in.
 * @param {string} branch  - Branch (or ref) to attempt merging.
 * @param {{ gitRunner?: Function }} [options]
 * @returns {string[]} Relative paths of conflicting files (empty if no conflicts).
 */
/** @param {string} rootDir @param {string} branch @param {{gitRunner?: Function}} [options] */
export function getConflictFiles(rootDir: string, branch: string, options: { gitRunner?: Function } = {}): string[] {
  const runner = options.gitRunner || gitModule.git;

  const merge = runner(['-C', rootDir, 'merge', '--no-commit', '--no-ff', branch]);
  runner(['-C', rootDir, 'merge', '--abort']);

  if (merge.status === 0) {return [];}

  const output = [merge.stdout, merge.stderr].filter(Boolean).join('\n');
  const conflictFiles = parseConflictFilesFromMergeOutput(output);

  if (conflictFiles.length === 0) {
    const summary = output.slice(0, 500) || '(no output)';
    throw new Error(`git merge exited ${merge.status} with no CONFLICT lines — raw output:\n${summary}`);
  }

  return conflictFiles;
}

/** @param {string} rootDir @param {Function} [gitRunner] */
export function findLastNonNoiseCommit(rootDir: string, gitRunner?: Function): string | null {
  const runner = gitRunner || gitModule.git;

  const currentFullRef = runner(['-C', rootDir, 'rev-parse', '--symbolic-full-name', 'HEAD'], { stdio: 'pipe' }).stdout.trim();

  let commit = 'HEAD';
  for (let i = 0; i < 100; i++) {
    const commitSha = runner(['-C', rootDir, 'rev-parse', commit], { stdio: 'pipe' }).stdout.trim();

    const branchesContaining = runner(['-C', rootDir, 'branch', '-a', '--contains', commitSha, '--format=%(refname)'], { stdio: 'pipe' })
      .stdout.trim().split('\n').filter(Boolean);

    const isShared = branchesContaining.some((b: string) => b.startsWith('refs/remotes/'));
    if (isShared) {
      return null;
    }

    const otherLocalBranches = branchesContaining.filter((b: string) => b !== currentFullRef && b.startsWith('refs/heads/'));
    if (otherLocalBranches.length > 0) {
      return null;
    }

    const logResult = runner(['-C', rootDir, 'log', '-1', '--format=%s', commit], { stdio: 'pipe' });
    if (logResult.status !== 0) {return null;}
    const msg = logResult.stdout.trim();

    const diffResult = runner(['-C', rootDir, 'diff-tree', '--no-commit-id', '--name-only', '-r', commit], { stdio: 'pipe' });
    if (diffResult.status !== 0) {return null;}

    const files = diffResult.stdout.trim().split('\n').filter(Boolean);
    if (files.length > 0) {
      let isNoiseFiles = true;
      for (const file of files) {
        if (!file.startsWith('backlog/') && !file.endsWith('agents.local.json')) {
          isNoiseFiles = false;
          break;
        }
      }

      const isNoiseMsg = /^(Create task|Update task|backlog|assign|fixes|backlig|housekeeping|Archive task|fixing tasks|new mission|added new backlog task|docs: move|mission changes|random changes|new\/updated mission|task updates)/i.test(msg);

      if (!isNoiseFiles || !isNoiseMsg) {
        return commit;
      }
    } else {
      return commit;
    }
    commit = `${commit}^`;
  }
  return null;
}

/** @param {string} rootDir @param {Function} [gitRunner] */
export function squashTrailingBacklogNoiseIntoPreviousMission(rootDir: string, gitRunner?: Function): boolean {
  const runner = gitRunner || gitModule.git;

  const status = runner(['-C', rootDir, 'status', '--porcelain']).stdout.trim();
  if (status) {
    fmt.log.warn(`Skipping noise squash in ${rootDir}: worktree is not clean.`);
    return false;
  }

  const nonNoiseCommit = findLastNonNoiseCommit(rootDir, runner);
  if (!nonNoiseCommit) {return false;}

  const headSha = runner(['-C', rootDir, 'rev-parse', 'HEAD']).stdout.trim();
  const baseSha = runner(['-C', rootDir, 'rev-parse', nonNoiseCommit]).stdout.trim();

  if (headSha !== baseSha) {
    fmt.log.info(`Squashing trailing backlog noise into ${baseSha.substring(0, 7)}...`);
    const date = runner(['-C', rootDir, 'log', '-1', '--format=%aD', baseSha]).stdout.trim();
    const resetResult = runner(['-C', rootDir, 'reset', '--soft', baseSha]);
    if (resetResult.status !== 0) {
      fmt.log.fail(`Failed to reset to ${baseSha}: ${resetResult.stderr}`);
      return false;
    }
    const commitResult = runner(['-C', rootDir, 'commit', '--amend', '--no-edit', '--date', date]);
    if (commitResult.status !== 0) {
      fmt.log.fail(`Failed to amend commit: ${commitResult.stderr}`);
      return false;
    }
    return true;
  }
  return false;
}

/** @param {string} rootDir @param {Function} [gitRunner] */
export function softResetTrailingBacklogNoise(rootDir: string, gitRunner?: Function): boolean {
  const runner = gitRunner || gitModule.git;

  const status = runner(['-C', rootDir, 'status', '--porcelain']).stdout.trim();
  if (status) {
    fmt.log.warn(`Skipping noise reset in ${rootDir}: worktree is not clean.`);
    return false;
  }

  const nonNoiseCommit = findLastNonNoiseCommit(rootDir, runner);
  if (!nonNoiseCommit) {return false;}

  const headSha = runner(['-C', rootDir, 'rev-parse', 'HEAD']).stdout.trim();
  const baseSha = runner(['-C', rootDir, 'rev-parse', nonNoiseCommit]).stdout.trim();

  if (headSha !== baseSha) {
    fmt.log.info(`Resetting trailing backlog noise back to ${baseSha.substring(0, 7)} to include in the integration...`);
    const resetResult = runner(['-C', rootDir, 'reset', '--soft', baseSha]);
    if (resetResult.status !== 0) {
      fmt.log.fail(`Failed to reset to ${baseSha}: ${resetResult.stderr}`);
      return false;
    }
    return true;
  }
  return false;
}

/** @param {string} slug @param {string} [rootDir] @param {Function|null} [gitRunner] */
export function findMissionDocInBranches(slug: string, rootDir: string = process.cwd(), gitRunner?: Function): Array<{ branch: string; path: string }> {
  const runner = gitRunner || gitModule.git;
  const candidates: Array<{ branch: string; path: string }> = [];

  const baseSlugMatch = slug.match(/^(task-\d+)/i);
  const baseSlug = baseSlugMatch ? baseSlugMatch[1].toLowerCase() : slug;
  const files = [
    path.relative(rootDir, missionPathForSlug(rootDir, slug)).split(path.sep).join('/'),
    path.relative(rootDir, missionPathForSlug(rootDir, baseSlug)).split(path.sep).join('/')
  ];
  const uniquePaths = Array.from(new Set(files));

  let branchResult;
  try {
    branchResult = runner(['-C', rootDir, 'branch', '-a', '--format=%(refname:short)']);
    if (branchResult.status !== 0) {return candidates;}
  } catch (_e) {
    return candidates;
  }

  const branches = branchResult.stdout.trim().split('\n')
    .filter(Boolean)
    .filter((b: string) => !b.includes('HEAD'))
    .filter((b: string) => b.endsWith(baseSlug) || b.includes(`/${baseSlug}-`) || b.includes(`/${baseSlug}/`));

  for (const branch of branches) {
    for (const f of uniquePaths) {
      try {
        const lsResult = runner(['-C', rootDir, 'ls-tree', '--name-only', branch, f]);
        if (lsResult.status === 0 && lsResult.stdout.trim() === f) {
          candidates.push({ branch, path: f });
          break;
        }
      } catch (_err) {
        // ignore
      }
    }
  }

  return candidates;
}

/**
 * Check if a file path is a mission artifact for a specific slug.
 * Mission artifacts include:
 * - missions/<slug>/* by default, or the adapter-configured legacy path
 * - the adapter-configured task storage path for active tasks
 * - the adapter-configured task storage path for completed tasks
 *
 * @param {string} file - Relative file path
 * @param {string} slug - Mission slug (e.g. architecture migration)
 * @param {string} rootDir - Workspace root
 * @returns {boolean}
 */
/** @param {string} file @param {string} slug @param {string} [rootDir] */
export function isMissionArtifact(file: string, slug: string, rootDir: string = process.cwd()): boolean {
  if (!file || !slug) {return false;}

  const missionDir = `${path.relative(rootDir, missionDirForSlug(rootDir, slug)).split(path.sep).join('/')}/`;
  if (file.startsWith(missionDir)) {return true;}
  const legacyMissionDir = `docs/missions/${getMissionYear(slug, rootDir)}/${slug}/`;
  if (file.startsWith(legacyMissionDir)) {return true;}

  const escapedSlug = slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const taskStorage = resolveTaskStorage(rootDir);
  const taskDirs = [taskStorage.tasksDir, taskStorage.completedDir]
    .map(dir => path.relative(rootDir, dir).split(path.sep).join('/'))
    .map(dir => dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const taskPattern = new RegExp(`^(?:${taskDirs.join('|')})/${escapedSlug}(?:\\s+-\\s+[^/]+\\.md|\\.md)$`, 'i');
  if (taskPattern.test(file)) {return true;}

  return false;
}

/** @param {string} [file] */
export function isWorkflowGeneratedArtifact(file: string | undefined): boolean {
  if (!file) {return false;}
  return file.startsWith('.workflow/')
    || file.startsWith('.sessions/')
    || file.startsWith('.forgejo-local/')
    || file === 'graphify-out'
    || file.startsWith('graphify-out/');
}
