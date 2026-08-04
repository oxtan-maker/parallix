import * as fs from 'node:fs';
import path from 'node:path';
import { loadAdapterConfig, isStandaloneWorkflowLayout } from '../config/product-config.js';
import * as gitModule from './git.js';
import {
  resolveMissionAdapter,
  missionBaseDir,
  missionBranchPrefix,
  missionBranchName,
  missionBranchRef,
  findMissionDir,
  getMissionYear,
} from '../filesystem/mission-paths.js';

/** @param {string|Function} rootDirOrGitFn @param {Function|null} [maybeGitFn] */
export function getPrimaryBranch(rootDirOrGitFn: string | Function = process.cwd(), maybeGitFn: Function | null = null): string {
  const rootDir = typeof rootDirOrGitFn === 'function' ? process.cwd() : rootDirOrGitFn;
  /** @type {Function} */
  const runner = typeof rootDirOrGitFn === 'function' ? rootDirOrGitFn : (maybeGitFn || gitModule.git);
  const listLocalBranches = () => {
    const result = runner(['-C', rootDir, 'branch', '--list', '--format=%(refname:short)', 'main', 'master']);
    return (result.stdout || '').split('\n').map((b: string) => b.trim()).filter(Boolean);
  };

  try {
    const config = loadAdapterConfig(rootDir);
    const missions = (config.missions as Record<string, unknown>) || {};
    if (typeof missions.primaryBranch === 'string' && missions.primaryBranch.trim()) {
      const configured = missions.primaryBranch.trim();
      const branches = listLocalBranches();
      if (branches.includes(configured)) {
        return configured;
      }
      if (configured !== 'main' && configured !== 'master') {
        return configured;
      }
    }
  } catch (_) {
    // fall through to git-based detection
  }
  try {
    const branches = listLocalBranches();
    if (branches.includes('main')) {return 'main';}
    if (branches.includes('master')) {return 'master';}
  } catch (_) {
    // fall through
  }
  throw new Error(
    "Could not detect primary branch. Neither 'main' nor 'master' exists as a local branch."
  );
}

export function resolveMainRepo(): string {
  if (process.env.PRIMARY_WORKTREE) {return process.env.PRIMARY_WORKTREE;}

  const cwd = process.cwd();
  const primaryBranch = getPrimaryBranch(process.cwd(), gitModule.git);
  try {
    const lines = gitModule.git(['worktree', 'list', '--porcelain']).stdout.split('\n');
    const worktrees: Array<{path: string; branch: string|null; bare: boolean}> = [];
    let current: {path: string; branch: string|null; bare: boolean} | null = null;

    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        if (current) {worktrees.push(current);}
        current = { path: line.slice('worktree '.length).trim(), branch: null, bare: false };
        continue;
      }

      if (!current) {continue;}

      if (line.startsWith('branch ')) {
        current.branch = line.slice('branch '.length).trim();
      } else if (line === 'bare') {
        current.bare = true;
      } else if (line === '') {
        worktrees.push(current);
        current = null;
      }
    }

    if (current) {worktrees.push(current);}

    const primaryWorktree = worktrees.find(wt => !wt.bare && wt.branch === `refs/heads/${primaryBranch}`);
    if (primaryWorktree) {return primaryWorktree.path;}
  } catch (_) {
    // ignore git errors, fall through to error
  }

  try {
    const currentBranch = gitModule.getCurrentBranch(cwd);
    const toplevel = gitModule.git(['-C', cwd, 'rev-parse', '--show-toplevel']);
    const repoRoot = (toplevel.stdout || '').trim();
    if (toplevel.status === 0 && repoRoot) {
      if (currentBranch === primaryBranch) {
        return repoRoot;
      }

      if (
        path.resolve(repoRoot) === path.resolve(cwd) &&
        isStandaloneWorkflowLayout(repoRoot) &&
        !currentBranch
      ) {
        return repoRoot;
      }
    }
  } catch (_) {
    // ignore git errors, fall through to error
  }

  throw new Error(
    `Could not resolve primary repository. No worktree on '${primaryBranch}' branch found and PRIMARY_WORKTREE is not set. ` +
    "Verify your worktree setup or set the PRIMARY_WORKTREE environment variable."
  );
}

export function getPrimaryWorktree(): string {
  return resolveMainRepo();
}

/** @param {string} slug @param {string} [mainRepo] */
export function conventionalWorktreePath(slug: string, mainRepo: string = getPrimaryWorktree()): string {
  const projectName = path.basename(mainRepo);
  const pattern = resolveMissionAdapter(mainRepo).worktreePattern;
  const rendered = pattern
    .replaceAll('<repo>', projectName)
    .replaceAll('<slug>', slug);
  return path.resolve(mainRepo, rendered);
}

/**
 * Conventional path for an auto-created *base* feature-branch worktree.
 *
 * Reuses the same mission `worktreePattern` so the path is discoverable and
 * removable with the existing tooling. The base branch name is slug-sanitised
 * (`/` → `-`) and prefixed with `base-` so it never collides with a mission
 * worktree (`mission/<slug>` → `<repo>-<slug>`).
 */
/** @param {string} baseBranch @param {string} [mainRepo] */
export function conventionalBaseWorktreePath(baseBranch: string, mainRepo: string = getPrimaryWorktree()): string {
  const safeName = String(baseBranch).replace(/[\\/]+/g, '-');
  return conventionalWorktreePath(`base-${safeName}`, mainRepo);
}

/**
 * Detect the branch HEAD is on at draft time, to be used as the mission base.
 *
 * Returns the current branch name. Returns `null` when HEAD is detached so the
 * caller falls back to `getPrimaryBranch()`. Throws when the current branch is
 * itself a mission branch (the `mission/*` prefix is reserved; nesting a mission
 * on a mission is refused).
 *
 * @param {string} [cwd]
 * @param {{ gitFn?: Function }} [options]
 * @returns {string|null}
 */
/** @param {string} [cwd] @param {{gitFn?: Function}} [options] */
export function detectLaunchBaseBranch(cwd: string = process.cwd(), options: { gitFn?: Function } = {}): string | null {
  /** @type {Function} */
  const runner = options.gitFn || gitModule.git;
  const result = runner(['-C', cwd, 'branch', '--show-current']);
  const branch = ((result && result.stdout) || '').trim();
  if (!branch) {
    return null;
  }
  const prefix = missionBranchPrefix(cwd);
  if (branch.startsWith(prefix)) {
    throw new Error(
      `Cannot launch a mission from mission branch '${branch}': the '${prefix}' prefix is reserved. ` +
      'Check out the feature branch or primary branch you want as the base before running draft.'
    );
  }
  return branch;
}

/** @param {string} content */
export function parseBaseBranchLine(content: string): string | null {
  if (!content) {return null;}
  const match = content.match(/^Base-Branch:\s*(\S+)\s*$/m);
  return match ? match[1].trim() : null;
}

/**
 * Read the `Base-Branch:` line recorded in the mission's MISSION.md.
 *
 * Reads the on-disk MISSION.md first (present in the mission worktree); when it
 * is not on disk, falls back to reading it from the mission branch via
 * `git show <branch>:<path>`. Returns `null` when no `Base-Branch:` line exists
 * (every pre-existing mission), so callers fall back to the primary branch.
 */
/** @param {string} slug @param {string} [rootDir] @param {{gitFn?: Function}} [options] */
export function readRecordedBaseBranch(slug: string, rootDir: string = process.cwd(), options: { gitFn?: Function | null } = {}): string | null {
  /** @type {Function | null} */
  const gitFn = options.gitFn ?? null;
  if (!slug) {return null;}

  const missionDir = findMissionDir(slug, rootDir);
  if (missionDir) {
    const missionPath = path.join(missionDir, 'MISSION.md');
    if (fs.existsSync(missionPath)) {
      return parseBaseBranchLine(fs.readFileSync(missionPath, 'utf8'));
    }
  }

  const runner = gitFn || gitModule.git;
  const branch = missionBranchName(slug, rootDir);
  const baseSlugMatch = slug.match(/^(task-\d+)/i);
  const baseSlug = baseSlugMatch ? baseSlugMatch[1].toLowerCase() : slug;
  const year = getMissionYear(slug, rootDir);
  const adapterBaseDir = (path.relative(rootDir, missionBaseDir(rootDir)) || '.').split(path.sep).join('/');
  const files = Array.from(new Set([
    path.posix.join(adapterBaseDir, year, slug, 'MISSION.md'),
    path.posix.join(adapterBaseDir, year, baseSlug, 'MISSION.md')
  ]));

  for (const f of files) {
    try {
      const res = runner(['-C', rootDir, 'show', `${branch}:${f}`]);
      if (res && res.status === 0) {
        const parsed = parseBaseBranchLine(res.stdout);
        if (parsed) {return parsed;}
      }
    } catch (_) {
      // ignore and try the next candidate
    }
  }

  return null;
}

/**
 * Resolve the base branch a mission was drafted from.
 *
 * Returns the recorded `Base-Branch:` when present, otherwise `getPrimaryBranch()`
 * (the byte-identical legacy behaviour for every pre-existing mission).
 */
/** @param {string} slug @param {string} [rootDir] @param {{gitFn?: Function}} [options] */
export function resolveMissionBaseBranch(slug: string, rootDir: string = process.cwd(), options: { gitFn?: Function | null } = {}): string {
  /** @type {Function | null} */
  const gitFn = options.gitFn ?? null;
  const recorded = readRecordedBaseBranch(slug, rootDir, { gitFn: gitFn as Function | undefined });
  if (recorded) {return recorded;}
  return gitFn ? getPrimaryBranch(rootDir, gitFn as Function) : getPrimaryBranch(rootDir);
}

/** @param {string} branchRef @param {Function} runner @param {string} mainRepo */
function findWorktreeForBranch(branchRef: string, runner: Function, mainRepo: string): string | null {
  const result = runner(['-C', mainRepo, 'worktree', 'list', '--porcelain']);
  const lines = ((result && result.stdout) || '').split('\n');
  let current: { path: string; branch: string | null } | null = null;
  for (const line of lines) {
    if (line.startsWith('worktree ')) {
      current = { path: line.slice('worktree '.length).trim(), branch: null };
    } else if (!current) {
      continue;
    } else if (line.startsWith('branch ')) {
      current.branch = line.slice('branch '.length).trim();
    } else if (line === '') {
      if (current.branch === branchRef) {return current.path;}
      current = null;
    }
  }
  if (current && current.branch === branchRef) {return current.path;}
  return null;
}

/**
 * Resolve the worktree the mission integrates back into.
 *
 * When the resolved base equals the primary branch, delegates to
 * `getPrimaryWorktree()` (untouched legacy behaviour). Otherwise returns the
 * live worktree checked out on the base branch, auto-creating one at the
 * conventional pattern path when none exists. Throws a `base branch`-bearing
 * error when the recorded base does not exist locally.
 */
/** @param {string} slug @param {{rootDir?: string, gitFn?: Function}} [options] */
export function resolveBaseWorktree(slug: string, options: { rootDir?: string; gitFn?: Function | null } = {}): string {
  const rootDir = options.rootDir || process.cwd();
  /** @type {Function | null} */
  const gitFn = options.gitFn ?? null;
  const runner = gitFn || gitModule.git;
  const base = resolveMissionBaseBranch(slug, rootDir, { gitFn: gitFn as Function | undefined });
  const primary = gitFn ? getPrimaryBranch(rootDir, gitFn as Function) : getPrimaryBranch(rootDir);
  if (base === primary) {
    return getPrimaryWorktree();
  }

  const mainRepo = getPrimaryWorktree();
  const baseRef = `refs/heads/${base}`;

  const existing = findWorktreeForBranch(baseRef, runner, mainRepo);
  if (existing) {return existing;}

  const branchExists = runner(['-C', mainRepo, 'show-ref', '--verify', '--quiet', baseRef]);
  if (!branchExists || branchExists.status !== 0) {
    throw new Error(
      `Mission ${slug} records base branch '${base}' but it does not exist locally. ` +
      `Create or fetch the '${base}' base branch before integrating.`
    );
  }

  const worktreePath = conventionalBaseWorktreePath(base, mainRepo);
  const addResult = runner(['-C', mainRepo, 'worktree', 'add', worktreePath, base]);
  if (!addResult || addResult.status !== 0) {
    const detail = addResult ? [addResult.stdout, addResult.stderr].filter(Boolean).join('\n').trim() : '';
    throw new Error(
      `Could not create base worktree for base branch '${base}' at ${worktreePath}${detail ? ': ' + detail : '.'}`
    );
  }
  return worktreePath;
}

/** @param {string} slug @param {{cwd?: string, gitFn?: Function}} [options] */
export function resolveWorktree(slug: string, options: { cwd?: string; gitFn?: Function | null } = {}): string | null {
  const cwd = options.cwd || process.cwd();
  /** @type {Function | null} */
  const gitFn = options.gitFn ?? null;
  const runGit = gitFn || gitModule.git;
  const branchRef = missionBranchRef(slug, cwd);

  try {
    const lines = runGit(['worktree', 'list', '--porcelain']).stdout.split('\n');
    const matches: Array<{ path: string; branch: string | null; prunable: boolean }> = [];
    let current: { path: string; branch: string | null; prunable: boolean } | null = null;

    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        current = { path: line.slice('worktree '.length).trim(), branch: null, prunable: false };
        continue;
      }
      if (!current) {continue;}
      if (line.startsWith('branch ')) {
        current.branch = line.slice('branch '.length).trim();
      } else if (line.startsWith('prunable ')) {
        current.prunable = true;
      } else if (line === '') {
        if (current.branch === branchRef) {matches.push(current);}
        current = null;
      }
    }

    if (current && current.branch === branchRef) {matches.push(current);}

    const liveMatches = matches.filter(m => !m.prunable);
    if (liveMatches.length > 0) {
      const cwdMatch = liveMatches.find(m => cwd === m.path || cwd.startsWith(m.path + '/'));
      if (cwdMatch) {return cwdMatch.path;}
      return liveMatches[0].path;
    }
  } catch (_) {
    // fall through to branch-based cwd fallback
  }

  try {
    if (gitModule.getCurrentBranch(cwd) === missionBranchName(slug, cwd)) {
      return cwd;
    }
  } catch (_) {
    // fall through to null
  }

  return null;
}
