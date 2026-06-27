import * as fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as fmt from './fmt.js';
import { loadAdapterConfig, resolveTaskStorage, isStandaloneWorkflowLayout } from './product-config.js';
import { git, run, getCurrentBranch } from './git.js';

/** @param {string} prefix */
function normalizeBranchPrefix(prefix: string): string {
  if (typeof prefix !== 'string' || !prefix.trim()) {
    return 'mission/';
  }
  return prefix.endsWith('/') ? prefix : prefix + '/';
}

function missionAdapterDefaults() {
  return {
    baseDir: 'missions',
    branchPrefix: 'mission/',
    worktreePattern: '../<repo>-<slug>',
  };
}

function resolveMissionAdapter(rootDir: string = process.cwd()) {
  const adapters = loadAdapterConfig(rootDir);
  const missions = (adapters.missions as Record<string, unknown>) || {};
  const defaults = missionAdapterDefaults();
  return {
    baseDir: typeof missions.baseDir === 'string' && missions.baseDir.trim()
      ? missions.baseDir
      : defaults.baseDir,
    branchPrefix: normalizeBranchPrefix(missions.branchPrefix as string || defaults.branchPrefix),
    worktreePattern: typeof missions.worktreePattern === 'string' && missions.worktreePattern.trim()
      ? missions.worktreePattern
      : defaults.worktreePattern,
  };
}

export function missionBaseDir(rootDir: string = process.cwd()): string {
  return path.resolve(rootDir, resolveMissionAdapter(rootDir).baseDir);
}

export function missionUsesYearTier(rootDir: string = process.cwd()): boolean {
  return resolveMissionAdapter(rootDir).baseDir !== missionAdapterDefaults().baseDir;
}

export function missionBranchPrefix(rootDir: string = process.cwd()): string {
  return resolveMissionAdapter(rootDir).branchPrefix;
}

/** @param {string} slug @param {string} [rootDir] */
export function missionBranchName(slug: string, rootDir: string = process.cwd()): string {
  return missionBranchPrefix(rootDir) + slug;
}

/** @param {string} slug @param {string} [rootDir] */
export function missionBranchRef(slug: string, rootDir: string = process.cwd()): string {
  return 'refs/heads/' + missionBranchName(slug, rootDir);
}

/** @param {unknown} value */
export function isMissionSlugCandidate(value: unknown): boolean {
  return typeof value === 'string' && /^(task|adhoc)-[a-z0-9][a-z0-9-]*$/i.test(value.trim());
}

/** @param {string} branch @param {string} [rootDir] */
export function extractSlugFromBranch(branch: string, rootDir: string = process.cwd()): string | null {
  const prefix = missionBranchPrefix(rootDir);
  if (!branch || !branch.startsWith(prefix)) {return null;}
  return branch.slice(prefix.length).toLowerCase();
}

/** @param {string|Function} rootDirOrGitFn @param {Function|null} [maybeGitFn] */
export function getPrimaryBranch(rootDirOrGitFn: string | Function, maybeGitFn: Function | null = null): string {
  const rootDir = typeof rootDirOrGitFn === 'function' ? process.cwd() : rootDirOrGitFn;
  /** @type {Function} */
  const runner = typeof rootDirOrGitFn === 'function' ? rootDirOrGitFn : (maybeGitFn || git);
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
  const primaryBranch = getPrimaryBranch(process.cwd(), git);
  try {
    const lines = git(['worktree', 'list', '--porcelain']).stdout.split('\n');
    const worktrees: Array<{ path: string; branch: string | null; bare: boolean }> = [];
    let current: { path: string; branch: string | null; bare: boolean } | null = null;

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
  } catch (error) {
    // ignore git errors, fall through to error
  }

  try {
    const currentBranch = getCurrentBranch(cwd);
    const toplevel = git(['-C', cwd, 'rev-parse', '--show-toplevel']);
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
 */
/** @param {string} baseBranch @param {string} [mainRepo] */
export function conventionalBaseWorktreePath(baseBranch: string, mainRepo: string = getPrimaryWorktree()): string {
  const safeName = String(baseBranch).replace(/[\\/]+/g, '-');
  return conventionalWorktreePath(`base-${safeName}`, mainRepo);
}

/** @param {string} [cwd] @param {{gitFn?: Function}} [options] */
export function detectLaunchBaseBranch(cwd: string = process.cwd(), options: { gitFn?: Function } = {}): string | null {
  /** @type {Function} */
  const runner = options.gitFn || git;
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

  const runner = gitFn || git;
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

/** @param {string} slug @param {{rootDir?: string, gitFn?: Function}} [options] */
export function resolveBaseWorktree(slug: string, options: { rootDir?: string; gitFn?: Function | null } = {}): string {
  const rootDir = options.rootDir || process.cwd();
  /** @type {Function | null} */
  const gitFn = options.gitFn ?? null;
  const runner = gitFn || git;
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

/** @param {string|undefined} [slug] @param {string} [rootDir] */
export function getMissionYear(slug: string | undefined = undefined, rootDir: string = process.cwd()): string {
  if (process.env.MISSION_YEAR_OVERRIDE) {
    return process.env.MISSION_YEAR_OVERRIDE;
  }

  const hasExplicitConfig = fs.existsSync(path.join(rootDir, 'workflow.config.json'));
  if (slug && (missionUsesYearTier(rootDir) || (!hasExplicitConfig && fs.existsSync(path.join(rootDir, 'docs', 'missions'))))) {
    const baseDir = missionUsesYearTier(rootDir)
      ? missionBaseDir(rootDir)
      : path.join(rootDir, 'docs', 'missions');
    if (fs.existsSync(baseDir)) {
      try {
        const stat = fs.statSync(baseDir);
        if (!stat.isDirectory()) {
          return new Date().getFullYear().toString();
        }
      } catch (_) {
        return new Date().getFullYear().toString();
      }
      const years = fs.readdirSync(baseDir)
        .filter(d => /^\d{4}$/.test(d))
        .sort((a: string, b: string) => b.localeCompare(a));

      const slugStr = slug;
      const candidateSlugs = [slugStr.toLowerCase()];
      const baseTaskMatch = slugStr.match(/^(task-\d+)/i);
      if (baseTaskMatch) {
        candidateSlugs.push(baseTaskMatch[1].toLowerCase());
      }

      for (const year of years) {
        for (const s of candidateSlugs) {
          const missionDir = path.join(baseDir, year, s);
          if (fs.existsSync(missionDir)) {
            return year;
          }
        }
      }
    }
  }

  return new Date().getFullYear().toString();
}

/** @param {string} slug @param {string} [rootDir] @param {{missionPath?: string}} options */
export function findMissionDir(slug: string, rootDir: string = process.cwd(), options: { missionPath?: string } = {}): string | null {
  const opts = options;
  if (opts.missionPath && fs.existsSync(opts.missionPath)) {
    return fs.statSync(opts.missionPath).isDirectory() ? opts.missionPath : path.dirname(opts.missionPath);
  }
  if (!slug) {return null;}
  const missionDir = missionDirForSlug(rootDir, slug);
  if (fs.existsSync(missionDir)) {return missionDir;}

  const baseTaskMatch = slug.match(/^(task-\d+)/i);
  if (baseTaskMatch) {
    const baseSlug = baseTaskMatch[1].toLowerCase();
    const baseMissionDir = missionDirForSlug(rootDir, baseSlug);
    if (fs.existsSync(baseMissionDir)) {return baseMissionDir;}
  }

  const legacyBaseDir = path.join(rootDir, 'docs', 'missions');
  if (!missionUsesYearTier(rootDir) && !fs.existsSync(path.join(rootDir, 'workflow.config.json')) && fs.existsSync(legacyBaseDir)) {
    const year = getMissionYear(slug, rootDir);
    const legacyMissionDir = path.join(legacyBaseDir, year, slug);
    if (fs.existsSync(legacyMissionDir)) {return legacyMissionDir;}
    if (baseTaskMatch) {
      const legacyBaseMissionDir = path.join(legacyBaseDir, year, baseTaskMatch[1].toLowerCase());
      if (fs.existsSync(legacyBaseMissionDir)) {return legacyBaseMissionDir;}
    }
  }

  return null;
}

/** @param {string} slug @param {{cwd?: string, gitFn?: Function}} [options] */
export function resolveWorktree(slug: string, options: { cwd?: string; gitFn?: Function | null } = {}): string | null {
  const cwd = options.cwd || process.cwd();
  /** @type {Function | null} */
  const gitFn = options.gitFn ?? null;
  const runGit = gitFn || git;
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
    if (getCurrentBranch(cwd) === missionBranchName(slug, cwd)) {
      return cwd;
    }
  } catch (_) {
    // fall through to null
  }

  return null;
}

/** @param {string} missionDir */
export function findCheckpoints(missionDir: string): string[] {
  const files = fs.readdirSync(missionDir);
  return files
    .filter(f => /^(CHECKPOINT_|CP-\d+).*\.md$/i.test(f))
    .sort(compareCheckpointFiles)
    .map(f => path.join(missionDir, f));
}

/** @param {string} a @param {string} b */
export function compareCheckpointFiles(a: string, b: string): number {
  const aOrder = checkpointOrder(a);
  const bOrder = checkpointOrder(b);

  if (aOrder !== bOrder) {
    return aOrder - bOrder;
  }

  return a.localeCompare(b);
}

/** @param {string} filename */
export function checkpointOrder(filename: string): number {
  const numericMatch = filename.match(/(?:CP-|CHECKPOINT_)(\d+)/i);
  if (numericMatch) {
    return Number(numericMatch[1]);
  }

  return Number.MAX_SAFE_INTEGER;
}

/** @param {string} filePath */
export function getFirstLine(filePath: string): string {
  const content = fs.readFileSync(filePath, 'utf8');
  return content.split('\n')[0].replace(/^#+\s*/, '').trim();
}

/** @param {string} [slug] */
export function missionTitle(slug: string | undefined): string | null {
  if (!slug) {return null;}
  const missionDir = findMissionDir(slug);
  if (!missionDir) {return null;}

  const missionPath = path.join(missionDir, 'MISSION.md');
  if (!fs.existsSync(missionPath)) {return null;}

  const firstLine = fs.readFileSync(missionPath, 'utf8').split('\n')[0] || '';
  return firstLine.replace(/^#\s*Mission:\s*/i, '').trim() || null;
}

export const SUPPORTED_VERIFY_AREAS = new Set(['docs', 'workflow', 'web', 'server', 'auth', 'android', 'k8s', 'deps', 'all']);

/** @param {string} [area] */
export function normalizeVerifyArea(area: string | undefined): string {
  if (!area) {return 'docs';}
  if (area === 'auth-server') {return 'auth';}
  return SUPPORTED_VERIFY_AREAS.has(area) ? area : area;
}

/** @param {string} content */
export function detectMissionAreaFromContent(content: string): string {
  const gateMatch = content.match(
    /(?:^|\s)(?:\.{1,2}\/[\w.\/-]+\.(?:sh|bash|py|rb)|\.{1,2}\/[a-z][\w-]*)\s+([a-zA-Z0-9_-]+)\s*(?:$|\n)/m
  );
  return normalizeVerifyArea(gateMatch ? gateMatch[1] : 'docs');
}

export function findMissionArea(missionDir: string): string {
  const missionPath = path.join(missionDir, 'MISSION.md');
  if (!fs.existsSync(missionPath)) {return 'docs';}

  const content = fs.readFileSync(missionPath, 'utf8');
  return detectMissionAreaFromContent(content);
}

/** @param {{commandRunner?: Function}} [options] */
export function graphifyAvailable(options: { commandRunner?: Function | null } = {}): boolean {
  const commandRunner = options.commandRunner ?? null;
  const cmdRunner = commandRunner || run;
  return probeGraphifyAvailability({ commandRunner: cmdRunner }).available;
}

/** @returns {string[]} */
export function graphifyCommandCandidates(): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();

  const pushCandidate = (candidate: string) => {
    if (!candidate || seen.has(candidate)) {return;}
    seen.add(candidate);
    candidates.push(candidate);
  };

  if (process.env.GRAPHIFY_BIN) {pushCandidate(process.env.GRAPHIFY_BIN);}
  pushCandidate('graphify');
  pushCandidate(path.join(os.homedir(), '.local', 'bin', 'graphify'));

  return candidates;
}

/** @param {{commandRunner?: Function}} [options] */
export function probeGraphifyAvailability(options: { commandRunner?: Function | null } = {}): { available: boolean; command?: string; status?: number | null; reason?: string; error?: unknown } {
  const commandRunner = options.commandRunner ?? null;
  const cmdRunner = commandRunner || run;
  for (const command of graphifyCommandCandidates()) {
    try {
      const result = cmdRunner(command, ['--help']);
      return {
        available: result.status !== null && result.status !== undefined,
        command,
        status: result.status ?? null
      };
    } catch (error: unknown) {
      const e = error as Error & { code?: string };
      if (e && e.code === 'ENOENT') {
        continue;
      }
      return {
        available: false,
        reason: 'probe-failed',
        command,
        error
      };
    }
  }

  return { available: false, reason: 'missing-command' };
}

/** @param {{rootDir?: string, commandRunner?: Function, log?: Function, startMessage?: string, failureHint?: string}} [options] */
export function updateGraphifyKnowledgeGraph(options: { rootDir?: string; commandRunner?: Function; log?: Function; startMessage?: string; failureHint?: string } = {}): { updated: boolean; skipped: boolean; reason?: string; status?: number } {
  const rootDir = options.rootDir || process.cwd();
  const commandRunner = options.commandRunner;
  const logFn = options.log || fmt.log.plain;
  const startMessage = options.startMessage || 'Updating graphify knowledge graph...';
  const failureHint = options.failureHint || 'Continuing without blocking workflow.';
  const cmdRunner = commandRunner || run;
  const probe = probeGraphifyAvailability({ commandRunner: cmdRunner });
  if (!probe.available) {
    if (probe.reason === 'missing-command') {
      logFn(fmt.status('WARN', 'graphify not found in PATH. Skipping knowledge graph update.'));
      return { updated: false, skipped: true, reason: 'missing-command' };
    }

    const probeError = probe.error && typeof probe.error === 'object' && 'message' in probe.error ? (probe.error as {message:string}).message : 'unknown probe failure';
    logFn(fmt.status('WARN', `graphify probe failed (${probeError}). Skipping knowledge graph update.`));
    return { updated: false, skipped: true, reason: 'probe-failed' };
  }

  logFn(fmt.status('INFO', startMessage));
  const result = cmdRunner(probe.command!, ['update', '.'], {
    cwd: rootDir,
    stdio: 'inherit'
  });

  if (result.status !== 0) {
    logFn(fmt.status('WARN', `graphify update failed with status ${result.status}. ${failureHint}`));
    return { updated: false, skipped: true, reason: 'update-failed', status: result.status };
  }

  return { updated: true, skipped: false };
}

/** @param {string} rootDir @param {string} slug */
export function missionPathForSlug(rootDir: string, slug: string): string {
  return path.join(missionDirForSlug(rootDir, slug), 'MISSION.md');
}

/** @param {string} rootDir @param {string} slug */
export function missionDirForSlug(rootDir: string, slug: string): string {
  const parts: string[] = [missionBaseDir(rootDir)];
  if (missionUsesYearTier(rootDir)) {
    parts.push(getMissionYear(slug, rootDir));
  }
  parts.push(slug);
  return path.join(...parts);
}

/** @param {string} [slugCandidate] */
export function inferSlug(slugCandidate: string | undefined): string | null {
  if (slugCandidate && isMissionSlugCandidate(slugCandidate)) {
    return slugCandidate.toLowerCase();
  }

  // 1. Check branch
  try {
    const branch = getCurrentBranch();
    const fromBranch = extractSlugFromBranch(branch);
    if (fromBranch) {return fromBranch;}
  } catch (_) {
    // ignore
  }

  // 3. Check directory name
  const cwd = process.cwd();
  const dirName = path.basename(cwd);
  const dirSlugMatch = dirName.match(/((?:task|adhoc)-[a-z0-9][a-z0-9-]*)$/i);
  if (dirSlugMatch) {
    return dirSlugMatch[1].toLowerCase();
  }


  // 3. Check worktree registry
  try {
    const lines = git(['worktree', 'list', '--porcelain']).stdout.split('\n');
    let currentPath: string | null = null;
    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        currentPath = line.slice('worktree '.length).trim();
      } else if (line.startsWith('branch ') && currentPath === cwd) {
        const branch = line.slice('branch '.length).trim();
        const shortBranch = branch.replace(/^refs\/heads\//, '');
        const fromBranch = extractSlugFromBranch(shortBranch, cwd);
        if (fromBranch) {return fromBranch;}
      } else if (line === '') {
        currentPath = null;
      }
    }
  } catch (_) {
    // ignore
  }

  return null;
}

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

/** @param {string} rootDir @param {string} branch @param {{gitRunner?: Function}} [options] */
export function getConflictFiles(rootDir: string, branch: string, options: { gitRunner?: Function } = {}): string[] {
  const runner = options.gitRunner || git;

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
export function findLastNonNoiseCommit(rootDir: string, gitRunner: Function | undefined): string | null {
  if (!gitRunner) {gitRunner = git;}

  const currentFullRef = gitRunner(['-C', rootDir, 'rev-parse', '--symbolic-full-name', 'HEAD'], { stdio: 'pipe' }).stdout.trim();

  let commit = 'HEAD';
  for (let i = 0; i < 100; i++) {
    const commitSha = gitRunner(['-C', rootDir, 'rev-parse', commit], { stdio: 'pipe' }).stdout.trim();

    const branchesContaining = gitRunner(['-C', rootDir, 'branch', '-a', '--contains', commitSha, '--format=%(refname)'], { stdio: 'pipe' })
      .stdout.trim().split('\n').filter(Boolean);

    const isShared = branchesContaining.some((b: string) => b.startsWith('refs/remotes/'));
    if (isShared) {
      return null;
    }

    const otherLocalBranches = branchesContaining.filter((b: string) => b !== currentFullRef && b.startsWith('refs/heads/'));
    if (otherLocalBranches.length > 0) {
      return null;
    }

    const logResult = gitRunner(['-C', rootDir, 'log', '-1', '--format=%s', commit], { stdio: 'pipe' });
    if (logResult.status !== 0) {return null;}
    const msg = logResult.stdout.trim();

    const diffResult = gitRunner(['-C', rootDir, 'diff-tree', '--no-commit-id', '--name-only', '-r', commit], { stdio: 'pipe' });
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
export function squashTrailingBacklogNoiseIntoPreviousMission(rootDir: string, gitRunner: Function | undefined): boolean {
  if (!gitRunner) {gitRunner = git;}

  const status = gitRunner(['-C', rootDir, 'status', '--porcelain']).stdout.trim();
  if (status) {
    fmt.log.warn(`Skipping noise squash in ${rootDir}: worktree is not clean.`);
    return false;
  }

  const nonNoiseCommit = findLastNonNoiseCommit(rootDir, gitRunner);
  if (!nonNoiseCommit) {return false;}

  const headSha = gitRunner(['-C', rootDir, 'rev-parse', 'HEAD']).stdout.trim();
  const baseSha = gitRunner(['-C', rootDir, 'rev-parse', nonNoiseCommit]).stdout.trim();

  if (headSha !== baseSha) {
    fmt.log.info(`Squashing trailing backlog noise into ${baseSha.substring(0, 7)}...`);
    const date = gitRunner(['-C', rootDir, 'log', '-1', '--format=%aD', baseSha]).stdout.trim();
    const resetResult = gitRunner(['-C', rootDir, 'reset', '--soft', baseSha]);
    if (resetResult.status !== 0) {
      fmt.log.fail(`Failed to reset to ${baseSha}: ${resetResult.stderr}`);
      return false;
    }
    const commitResult = gitRunner(['-C', rootDir, 'commit', '--amend', '--no-edit', '--date', date]);
    if (commitResult.status !== 0) {
      fmt.log.fail(`Failed to amend commit: ${commitResult.stderr}`);
      return false;
    }
    return true;
  }
  return false;
}

/** @param {string} rootDir @param {Function} [gitRunner] */
export function softResetTrailingBacklogNoise(rootDir: string, gitRunner: Function | undefined): boolean {
  if (!gitRunner) {gitRunner = git;}

  const status = gitRunner(['-C', rootDir, 'status', '--porcelain']).stdout.trim();
  if (status) {
    fmt.log.warn(`Skipping noise reset in ${rootDir}: worktree is not clean.`);
    return false;
  }

  const nonNoiseCommit = findLastNonNoiseCommit(rootDir, gitRunner);
  if (!nonNoiseCommit) {return false;}

  const headSha = gitRunner(['-C', rootDir, 'rev-parse', 'HEAD']).stdout.trim();
  const baseSha = gitRunner(['-C', rootDir, 'rev-parse', nonNoiseCommit]).stdout.trim();

  if (headSha !== baseSha) {
    fmt.log.info(`Resetting trailing backlog noise back to ${baseSha.substring(0, 7)} to include in the integration...`);
    const resetResult = gitRunner(['-C', rootDir, 'reset', '--soft', baseSha]);
    if (resetResult.status !== 0) {
      fmt.log.fail(`Failed to reset to ${baseSha}: ${resetResult.stderr}`);
      return false;
    }
    return true;
  }
  return false;
}

/** @param {string} slug @param {string} [rootDir] @param {Function|null} [gitRunner] */
export function findMissionDocInBranches(slug: string, rootDir: string = process.cwd(), gitRunner: Function | null = null): Array<{ branch: string; path: string }> {
  if (!gitRunner) {gitRunner = git;}
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
    branchResult = gitRunner(['-C', rootDir, 'branch', '-a', '--format=%(refname:short)']);
    if (branchResult.status !== 0) {return candidates;}
  } catch (e) {
    return candidates;
  }

  const branches = branchResult.stdout.trim().split('\n')
    .filter(Boolean)
    .filter((b: string) => !b.includes('HEAD'))
    .filter((b: string) => b.endsWith(baseSlug) || b.includes(`/${baseSlug}-`) || b.includes(`/${baseSlug}/`));

  for (const branch of branches) {
    for (const f of uniquePaths) {
      try {
        const lsResult = gitRunner(['-C', rootDir, 'ls-tree', '--name-only', branch, f]);
        if (lsResult.status === 0 && lsResult.stdout.trim() === f) {
          candidates.push({ branch, path: f });
          break;
        }
      } catch (err) {
        // ignore
      }
    }
  }

  return candidates;
}

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
