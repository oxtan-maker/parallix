const fs = require('fs');
const os = require('os');
const path = require('path');
const fmt = require('./fmt');
const { loadAdapterConfig, resolveTaskStorage } = require('./product-config');

function normalizeBranchPrefix(prefix) {
  if (typeof prefix !== 'string' || !prefix.trim()) {
    return 'mission/';
  }
  return prefix.endsWith('/') ? prefix : `${prefix}/`;
}

function missionAdapterDefaults() {
  return {
    baseDir: 'missions',
    branchPrefix: 'mission/',
    worktreePattern: '../<repo>-<slug>',
  };
}

function resolveMissionAdapter(rootDir = process.cwd()) {
  const adapters = loadAdapterConfig(rootDir);
  const missions = adapters.missions || {};
  const defaults = missionAdapterDefaults();
  return {
    baseDir: typeof missions.baseDir === 'string' && missions.baseDir.trim()
      ? missions.baseDir
      : defaults.baseDir,
    branchPrefix: normalizeBranchPrefix(missions.branchPrefix || defaults.branchPrefix),
    worktreePattern: typeof missions.worktreePattern === 'string' && missions.worktreePattern.trim()
      ? missions.worktreePattern
      : defaults.worktreePattern,
  };
}

function missionBaseDir(rootDir = process.cwd()) {
  return path.resolve(rootDir, resolveMissionAdapter(rootDir).baseDir);
}

function missionUsesYearTier(rootDir = process.cwd()) {
  return resolveMissionAdapter(rootDir).baseDir !== missionAdapterDefaults().baseDir;
}

function missionBranchPrefix(rootDir = process.cwd()) {
  return resolveMissionAdapter(rootDir).branchPrefix;
}

function missionBranchName(slug, rootDir = process.cwd()) {
  return `${missionBranchPrefix(rootDir)}${slug}`;
}

function missionBranchRef(slug, rootDir = process.cwd()) {
  return `refs/heads/${missionBranchName(slug, rootDir)}`;
}

function isMissionSlugCandidate(value) {
  return typeof value === 'string' && /^(task|adhoc)-[a-z0-9][a-z0-9-]*$/i.test(value.trim());
}

function extractSlugFromBranch(branch, rootDir = process.cwd()) {
  const prefix = missionBranchPrefix(rootDir);
  if (!branch || !branch.startsWith(prefix)) return null;
  return branch.slice(prefix.length).toLowerCase();
}

function getPrimaryBranch(rootDirOrGitFn = process.cwd(), maybeGitFn = null) {
  const { git } = require('./git');
  const rootDir = typeof rootDirOrGitFn === 'function' ? process.cwd() : rootDirOrGitFn;
  const runner = typeof rootDirOrGitFn === 'function' ? rootDirOrGitFn : (maybeGitFn || git);
  const listLocalBranches = () => {
    const result = runner(['-C', rootDir, 'branch', '--list', '--format=%(refname:short)', 'main', 'master']);
    return (result.stdout || '').split('\n').map(b => b.trim()).filter(Boolean);
  };

  try {
    const missions = loadAdapterConfig(rootDir).missions || {};
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
    if (branches.includes('main')) return 'main';
    if (branches.includes('master')) return 'master';
  } catch (_) {
    // fall through
  }
  throw new Error(
    "Could not detect primary branch. Neither 'main' nor 'master' exists as a local branch."
  );
}

function resolveMainRepo() {
  if (process.env.PRIMARY_WORKTREE) return process.env.PRIMARY_WORKTREE;

  const { git, getCurrentBranch } = require('./git');
  const { isStandaloneWorkflowLayout } = require('./product-config');
  const cwd = process.cwd();
  const primaryBranch = getPrimaryBranch(process.cwd(), git);
  try {
    const lines = git(['worktree', 'list', '--porcelain']).stdout.split('\n');
    const worktrees = [];
    let current = null;

    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        if (current) worktrees.push(current);
        current = { path: line.slice('worktree '.length).trim(), branch: null, bare: false };
        continue;
      }

      if (!current) continue;

      if (line.startsWith('branch ')) {
        current.branch = line.slice('branch '.length).trim();
      } else if (line === 'bare') {
        current.bare = true;
      } else if (line === '') {
        worktrees.push(current);
        current = null;
      }
    }

    if (current) worktrees.push(current);

    const primaryWorktree = worktrees.find(worktree => !worktree.bare && worktree.branch === `refs/heads/${primaryBranch}`);
    if (primaryWorktree) return primaryWorktree.path;
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

      // Fresh exported repos can already have a `.git` directory but still lack
      // stable worktree metadata or a readable current branch. When draft runs
      // from that standalone repo root, treat the current checkout as the
      // primary repository so draft can create the first mission worktree.
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

function getPrimaryWorktree() {
  return resolveMainRepo();
}

function conventionalWorktreePath(slug, mainRepo = getPrimaryWorktree()) {
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
function conventionalBaseWorktreePath(baseBranch, mainRepo = getPrimaryWorktree()) {
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
function detectLaunchBaseBranch(cwd = process.cwd(), { gitFn = null } = {}) {
  const { git } = require('./git');
  const runner = gitFn || git;
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

function parseBaseBranchLine(content) {
  if (!content) return null;
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
function readRecordedBaseBranch(slug, rootDir = process.cwd(), { gitFn = null } = {}) {
  if (!slug) return null;

  const missionDir = findMissionDir(slug, rootDir);
  if (missionDir) {
    const missionPath = path.join(missionDir, 'MISSION.md');
    if (fs.existsSync(missionPath)) {
      return parseBaseBranchLine(fs.readFileSync(missionPath, 'utf8'));
    }
  }

  const { git } = require('./git');
  const runner = gitFn || git;
  const branch = missionBranchName(slug, rootDir);
  const baseSlugMatch = slug.match(/^(task-\d+)/i);
  const baseSlug = baseSlugMatch ? baseSlugMatch[1].toLowerCase() : slug;
  const year = getMissionYear(slug, rootDir);
  const adapterBaseDir = (path.relative(rootDir, missionBaseDir(rootDir)) || '.').split(path.sep).join('/');
  const paths = Array.from(new Set([
    path.posix.join(adapterBaseDir, year, slug, 'MISSION.md'),
    path.posix.join(adapterBaseDir, year, baseSlug, 'MISSION.md')
  ]));

  for (const p of paths) {
    try {
      const res = runner(['-C', rootDir, 'show', `${branch}:${p}`]);
      if (res && res.status === 0) {
        const parsed = parseBaseBranchLine(res.stdout);
        if (parsed) return parsed;
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
function resolveMissionBaseBranch(slug, rootDir = process.cwd(), { gitFn = null } = {}) {
  const recorded = readRecordedBaseBranch(slug, rootDir, { gitFn });
  if (recorded) return recorded;
  return gitFn ? getPrimaryBranch(rootDir, gitFn) : getPrimaryBranch(rootDir);
}

function findWorktreeForBranch(branchRef, runner, mainRepo) {
  const result = runner(['-C', mainRepo, 'worktree', 'list', '--porcelain']);
  const lines = ((result && result.stdout) || '').split('\n');
  let current = null;
  for (const line of lines) {
    if (line.startsWith('worktree ')) {
      current = { path: line.slice('worktree '.length).trim(), branch: null };
    } else if (!current) {
      continue;
    } else if (line.startsWith('branch ')) {
      current.branch = line.slice('branch '.length).trim();
    } else if (line === '') {
      if (current.branch === branchRef) return current.path;
      current = null;
    }
  }
  if (current && current.branch === branchRef) return current.path;
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
function resolveBaseWorktree(slug, { rootDir = process.cwd(), gitFn = null } = {}) {
  const { git } = require('./git');
  const runner = gitFn || git;
  const base = resolveMissionBaseBranch(slug, rootDir, { gitFn });
  const primary = gitFn ? getPrimaryBranch(rootDir, gitFn) : getPrimaryBranch(rootDir);
  if (base === primary) {
    return getPrimaryWorktree();
  }

  const mainRepo = getPrimaryWorktree();
  const baseRef = `refs/heads/${base}`;

  const existing = findWorktreeForBranch(baseRef, runner, mainRepo);
  if (existing) return existing;

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
      `Could not create base worktree for base branch '${base}' at ${worktreePath}${detail ? `: ${detail}` : '.'}`
    );
  }
  return worktreePath;
}

function getMissionYear(slug = null, rootDir = process.cwd()) {
  if (process.env.MISSION_YEAR_OVERRIDE) {
    return process.env.MISSION_YEAR_OVERRIDE;
  }

  // Flat default layout has no year tier. Keep returning the current year for
  // callers that use it as metadata, but do not scan it as a path component.
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
        .sort((a, b) => b.localeCompare(a)); // Descending order (newest first)

      const candidateSlugs = [slug.toLowerCase()];
      const baseTaskMatch = slug.match(/^(task-\d+)/i);
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

function findMissionDir(slug, rootDir = process.cwd(), options = {}) {
  if (options.missionPath && fs.existsSync(options.missionPath)) {
    return fs.statSync(options.missionPath).isDirectory() ? options.missionPath : path.dirname(options.missionPath);
  }
  if (!slug) return null;
  const missionDir = missionDirForSlug(rootDir, slug);
  if (fs.existsSync(missionDir)) return missionDir;

  // Hardening: Try base task ID if slug has a suffix (e.g., task-1004-modern -> task-1004)
  const baseTaskMatch = slug.match(/^(task-\d+)/i);
  if (baseTaskMatch) {
    const baseSlug = baseTaskMatch[1].toLowerCase();
    const baseMissionDir = missionDirForSlug(rootDir, baseSlug);
    if (fs.existsSync(baseMissionDir)) return baseMissionDir;
  }

  // Read compatibility during the TASK-1243 migration window. New no-config
  // missions are created flat, but existing year-tier history remains readable.
  const legacyBaseDir = path.join(rootDir, 'docs', 'missions');
  if (!missionUsesYearTier(rootDir) && !fs.existsSync(path.join(rootDir, 'workflow.config.json')) && fs.existsSync(legacyBaseDir)) {
    const year = getMissionYear(slug, rootDir);
    const legacyMissionDir = path.join(legacyBaseDir, year, slug);
    if (fs.existsSync(legacyMissionDir)) return legacyMissionDir;
    if (baseTaskMatch) {
      const legacyBaseMissionDir = path.join(legacyBaseDir, year, baseTaskMatch[1].toLowerCase());
      if (fs.existsSync(legacyBaseMissionDir)) return legacyBaseMissionDir;
    }
  }

  return null;
}

function resolveWorktree(slug, { cwd = process.cwd(), gitFn = null } = {}) {
  const { git, getCurrentBranch } = require('./git');
  const runGit = gitFn || git;
  const branchRef = missionBranchRef(slug, cwd);

  try {
    const lines = runGit(['worktree', 'list', '--porcelain']).stdout.split('\n');
    const matches = [];
    let current = null;

    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        current = { path: line.slice('worktree '.length).trim(), branch: null, prunable: false };
        continue;
      }
      if (!current) continue;
      if (line.startsWith('branch ')) {
        current.branch = line.slice('branch '.length).trim();
      } else if (line.startsWith('prunable ')) {
        current.prunable = true;
      } else if (line === '') {
        if (current.branch === branchRef) matches.push(current);
        current = null;
      }
    }

    if (current && current.branch === branchRef) matches.push(current);

    const liveMatches = matches.filter(match => !match.prunable);
    if (liveMatches.length > 0) {
      const cwdMatch = liveMatches.find(match => cwd === match.path || cwd.startsWith(`${match.path}/`));
      if (cwdMatch) return cwdMatch.path;
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

function findCheckpoints(missionDir) {
  const files = fs.readdirSync(missionDir);
  return files
    .filter(f => /^(CHECKPOINT_|CP-\d+).*\.md$/i.test(f))
    .sort(compareCheckpointFiles)
    .map(f => path.join(missionDir, f));
}

function compareCheckpointFiles(a, b) {
  const aOrder = checkpointOrder(a);
  const bOrder = checkpointOrder(b);

  if (aOrder !== bOrder) {
    return aOrder - bOrder;
  }

  return a.localeCompare(b);
}

function checkpointOrder(filename) {
  const numericMatch = filename.match(/(?:CP-|CHECKPOINT_)(\d+)/i);
  if (numericMatch) {
    return Number(numericMatch[1]);
  }

  return Number.MAX_SAFE_INTEGER;
}

function getFirstLine(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  return content.split('\n')[0].replace(/^#+\s*/, '').trim();
}

function missionTitle(slug) {
  if (!slug) return null;
  const missionDir = findMissionDir(slug);
  if (!missionDir) return null;

  const missionPath = path.join(missionDir, 'MISSION.md');
  if (!fs.existsSync(missionPath)) return null;

  const firstLine = fs.readFileSync(missionPath, 'utf8').split('\n')[0] || '';
  return firstLine.replace(/^#\s*Mission:\s*/i, '').trim() || null;
}

const SUPPORTED_VERIFY_AREAS = new Set(['docs', 'workflow', 'web', 'server', 'auth', 'android', 'k8s', 'deps', 'all']);

function normalizeVerifyArea(area) {
  if (!area) return 'docs';
  if (area === 'auth-server') return 'auth';
  return SUPPORTED_VERIFY_AREAS.has(area) ? area : area;
}

function detectMissionAreaFromContent(content) {
  // Capture the area argument after a verification-script invocation. Matches only
  // scripts with recognized extensions (.sh, .bash, .py, .rb) or bare executables
  // (no dots) referenced via `./` or `../`. The area argument must sit at end-of-line
  // to prevent prose-matched paths (e.g. "run ./scripts/deploy.sh server before merge")
  // from being mistaken for gate invocations. Falls back to `docs` when none found.
  const gateMatch = content.match(
    /(?:^|\s)(?:\.{1,2}\/[\w.\/-]+\.(?:sh|bash|py|rb)|\.{1,2}\/[a-z][\w-]*)\s+([a-zA-Z0-9_-]+)\s*(?:$|\n)/m
  );
  return normalizeVerifyArea(gateMatch ? gateMatch[1] : 'docs');
}

function findMissionArea(missionDir) {
  const missionPath = path.join(missionDir, 'MISSION.md');
  if (!fs.existsSync(missionPath)) return 'docs';

  const content = fs.readFileSync(missionPath, 'utf8');
  return detectMissionAreaFromContent(content);
}

function graphifyAvailable({ commandRunner = null } = {}) {
  const run = commandRunner || require('./git').run;
  return probeGraphifyAvailability({ commandRunner: run }).available;
}

function graphifyCommandCandidates() {
  const candidates = [];
  const seen = new Set();

  const pushCandidate = candidate => {
    if (!candidate || seen.has(candidate)) return;
    seen.add(candidate);
    candidates.push(candidate);
  };

  pushCandidate(process.env.GRAPHIFY_BIN);
  pushCandidate('graphify');
  pushCandidate(path.join(os.homedir(), '.local', 'bin', 'graphify'));

  return candidates;
}

function probeGraphifyAvailability({ commandRunner = null } = {}) {
  const run = commandRunner || require('./git').run;
  for (const command of graphifyCommandCandidates()) {
    try {
      const result = run(command, ['--help']);
      return {
        available: result.status !== null && result.status !== undefined,
        command,
        status: result.status ?? null
      };
    } catch (error) {
      if (error && error.code === 'ENOENT') {
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

function updateGraphifyKnowledgeGraph({
  rootDir = process.cwd(),
  commandRunner = null,
  log = fmt.log.plain,
  startMessage = 'Updating graphify knowledge graph...',
  failureHint = 'Continuing without blocking workflow.'
} = {}) {
  const run = commandRunner || ((command, args, options) => require('./git').run(command, args, options));
  const probe = probeGraphifyAvailability({ commandRunner: run });
  if (!probe.available) {
    if (probe.reason === 'missing-command') {
      log(fmt.status('WARN', 'graphify not found in PATH. Skipping knowledge graph update.'));
      return { updated: false, skipped: true, reason: 'missing-command' };
    }

    const probeError = probe.error && probe.error.message ? probe.error.message : 'unknown probe failure';
    log(fmt.status('WARN', `graphify probe failed (${probeError}). Skipping knowledge graph update.`));
    return { updated: false, skipped: true, reason: 'probe-failed' };
  }

  log(fmt.status('INFO', startMessage));
  const result = run(probe.command, ['update', '.'], {
    cwd: rootDir,
    stdio: 'inherit'
  });

  if (result.status !== 0) {
    log(fmt.status('WARN', `graphify update failed with status ${result.status}. ${failureHint}`));
    return { updated: false, skipped: true, reason: 'update-failed', status: result.status };
  }

  return { updated: true, skipped: false };
}

function missionPathForSlug(rootDir, slug) {
  return path.join(missionDirForSlug(rootDir, slug), 'MISSION.md');
}

function missionDirForSlug(rootDir, slug) {
  const parts = [missionBaseDir(rootDir)];
  if (missionUsesYearTier(rootDir)) {
    parts.push(getMissionYear(slug, rootDir));
  }
  parts.push(slug);
  return path.join(...parts);
}

/**
 * Infer mission slug from current context:
 * 1. Explicit slugCandidate (task-NNN)
 * 2. Current branch (mission/slug)
 * 3. Current directory name (mission-task-slug)
 * 4. Registered worktree branch for current directory
 *
 * @param {string} [slugCandidate]
 * @returns {string|null}
 */
function inferSlug(slugCandidate) {
  if (isMissionSlugCandidate(slugCandidate)) {
    return slugCandidate.toLowerCase();
  }

  const { git, getCurrentBranch } = require('./git');

  // 1. Check branch
  try {
    const branch = getCurrentBranch();
    const fromBranch = extractSlugFromBranch(branch);
    if (fromBranch) return fromBranch;
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
    let currentPath = null;
    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        currentPath = line.slice('worktree '.length).trim();
      } else if (line.startsWith('branch ') && currentPath === cwd) {
        const branch = line.slice('branch '.length).trim();
        const shortBranch = branch.replace(/^refs\/heads\//, '');
        const fromBranch = extractSlugFromBranch(shortBranch, cwd);
        if (fromBranch) return fromBranch;
      } else if (line === '') {
        currentPath = null;
      }
    }
  } catch (_) {
    // ignore
  }

  return null;
}

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
function parseConflictFilesFromMergeOutput(output) {
  const seen = new Set();
  const files = [];
  for (const line of output.split('\n')) {
    if (!line.startsWith('CONFLICT')) continue;
    // "Merge conflict in <file>" pattern (content, add/add, rename/rename, etc.)
    const inMatch = line.match(/Merge conflict in (.+)$/);
    if (inMatch) {
      const f = inMatch[1].trim();
      if (f && !seen.has(f)) { seen.add(f); files.push(f); }
      continue;
    }
    // "CONFLICT (modify/delete): <file> deleted in ..." — file is right after the colon
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
function getConflictFiles(rootDir, branch, { gitRunner } = {}) {
  const { git: defaultGit } = require('./git');
  const runner = gitRunner || defaultGit;

  const merge = runner(['-C', rootDir, 'merge', '--no-commit', '--no-ff', branch]);
  // Always clean up the in-progress merge (ignore abort errors for clean merges)
  runner(['-C', rootDir, 'merge', '--abort']);

  if (merge.status === 0) return [];

  const output = [merge.stdout, merge.stderr].filter(Boolean).join('\n');
  const conflictFiles = parseConflictFilesFromMergeOutput(output);

  if (conflictFiles.length === 0) {
    // Merge failed but no CONFLICT lines found — a non-conflict failure (dirty worktree,
    // unfinished rebase, locked index, etc.). Surface the raw failure rather than returning
    // an empty list, which callers would interpret as "no conflicts / merge was clean".
    const summary = output.slice(0, 500) || '(no output)';
    throw new Error(`git merge exited ${merge.status} with no CONFLICT lines — raw output:\n${summary}`);
  }

  return conflictFiles;
}

function findLastNonNoiseCommit(rootDir, gitRunner) {
  if (!gitRunner) gitRunner = require('./git').git;

  const currentFullRef = gitRunner(['-C', rootDir, 'rev-parse', '--symbolic-full-name', 'HEAD'], { stdio: 'pipe' }).stdout.trim();

  let commit = 'HEAD';
  // safety break after 100 commits
  for (let i = 0; i < 100; i++) {
    const commitSha = gitRunner(['-C', rootDir, 'rev-parse', commit], { stdio: 'pipe' }).stdout.trim();

    // Safety: If any OTHER branch (local or remote) contains this commit, it's a branch-off point.
    // We must stop here to avoid rewriting history that other branches depend on.
    const branchesContaining = gitRunner(['-C', rootDir, 'branch', '-a', '--contains', commitSha, '--format=%(refname)'], { stdio: 'pipe' })
      .stdout.trim().split('\n').filter(Boolean);

    // Safety: If this commit is already published to ANY remote, we MUST NOT amend it.
    const isShared = branchesContaining.some(b => b.startsWith('refs/remotes/'));
    if (isShared) {
      return null;
    }

    // Safety: If any OTHER local branch contains this commit, it's the branch-off point.
    // We must return null (not the commit) so the caller does not amend a commit another
    // branch depends on — returning the commit here caused squash to rewrite it.
    const otherLocalBranches = branchesContaining.filter(b => b !== currentFullRef && b.startsWith('refs/heads/'));
    if (otherLocalBranches.length > 0) {
      return null;
    }

    const log = gitRunner(['-C', rootDir, 'log', '-1', '--format=%s', commit], { stdio: 'pipe' });
    if (log.status !== 0) return null;
    const msg = log.stdout.trim();

    const diff = gitRunner(['-C', rootDir, 'diff-tree', '--no-commit-id', '--name-only', '-r', commit], { stdio: 'pipe' });
    if (diff.status !== 0) return null;

    const files = diff.stdout.trim().split('\n').filter(Boolean);
    if (files.length > 0) {
      let isNoiseFiles = true;
      for (const file of files) {
        if (!file.startsWith('backlog/') && !file.endsWith('agents.local.json')) {
          isNoiseFiles = false;
          break;
        }
      }

      // Learnings from manual cleanup: check for automated/grooming message patterns
      const isNoiseMsg = /^(Create task|Update task|backlog|assign|fixes|backlig|housekeeping|Archive task|fixing tasks|new mission|added new backlog task|docs: move|mission changes|random changes|new\/updated mission|task updates)/i.test(msg);

      if (!isNoiseFiles || !isNoiseMsg) {
        return commit;
      }
    } else {
      // Empty commit (e.g. from a merge or manual empty commit) - stop here
      return commit;
    }
    commit = `${commit}^`;
  }
  return null;
}

function squashTrailingBacklogNoiseIntoPreviousMission(rootDir, gitRunner) {
  if (!gitRunner) gitRunner = require('./git').git;

  // Pattern violation fix: destructive history rewrite without a cleanliness gate.
  // Refuse to squash if the index or worktree is dirty to avoid absorbing unrelated changes.
  const status = gitRunner(['-C', rootDir, 'status', '--porcelain']).stdout.trim();
  if (status) {
    fmt.log.warn(`Skipping noise squash in ${rootDir}: worktree is not clean.`);
    return false;
  }

  const nonNoiseCommit = findLastNonNoiseCommit(rootDir, gitRunner);
  if (!nonNoiseCommit) return false;

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

function softResetTrailingBacklogNoise(rootDir, gitRunner) {
  if (!gitRunner) gitRunner = require('./git').git;

  // Refuse to reset if the index or worktree is dirty.
  const status = gitRunner(['-C', rootDir, 'status', '--porcelain']).stdout.trim();
  if (status) {
    fmt.log.warn(`Skipping noise reset in ${rootDir}: worktree is not clean.`);
    return false;
  }

  const nonNoiseCommit = findLastNonNoiseCommit(rootDir, gitRunner);
  if (!nonNoiseCommit) return false;

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

function findMissionDocInBranches(slug, rootDir = process.cwd(), gitRunner = null) {
  if (!gitRunner) gitRunner = require('./git').git;
  const candidates = [];

  const baseSlugMatch = slug.match(/^(task-\d+)/i);
  const baseSlug = baseSlugMatch ? baseSlugMatch[1].toLowerCase() : slug;
  const paths = [
    path.relative(rootDir, missionPathForSlug(rootDir, slug)).split(path.sep).join('/'),
    path.relative(rootDir, missionPathForSlug(rootDir, baseSlug)).split(path.sep).join('/')
  ];
  const uniquePaths = Array.from(new Set(paths));

  let branchResult;
  try {
    branchResult = gitRunner(['-C', rootDir, 'branch', '-a', '--format=%(refname:short)']);
    if (branchResult.status !== 0) return candidates;
  } catch (err) {
    return candidates;
  }

  const branches = branchResult.stdout.trim().split('\n')
    .filter(Boolean)
    .filter(b => !b.includes('HEAD'))
    .filter(b => b.endsWith(baseSlug) || b.includes(`/${baseSlug}-`) || b.includes(`/${baseSlug}/`));

  for (const branch of branches) {
    for (const p of uniquePaths) {
      try {
        const lsResult = gitRunner(['-C', rootDir, 'ls-tree', '--name-only', branch, p]);
        if (lsResult.status === 0 && lsResult.stdout.trim() === p) {
          candidates.push({ branch, path: p });
          break; // Next branch
        }
      } catch (err) {
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
 * @param {string} slug - Mission slug (e.g. task-1107)
 * @param {string} rootDir - Workspace root
 * @returns {boolean}
 */
function isMissionArtifact(file, slug, rootDir = process.cwd()) {
  if (!file || !slug) return false;

  const missionDir = `${path.relative(rootDir, missionDirForSlug(rootDir, slug)).split(path.sep).join('/')}/`;
  if (file.startsWith(missionDir)) return true;
  const legacyMissionDir = `docs/missions/${getMissionYear(slug, rootDir)}/${slug}/`;
  if (file.startsWith(legacyMissionDir)) return true;

  // Task files: task-NNN - title.md or task-NNN.md in the configured storage.
  const escapedSlug = slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const taskStorage = resolveTaskStorage(rootDir);
  const taskDirs = [taskStorage.tasksDir, taskStorage.completedDir]
    .map(dir => path.relative(rootDir, dir).split(path.sep).join('/'))
    .map(dir => dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const taskPattern = new RegExp(`^(?:${taskDirs.join('|')})/${escapedSlug}(?:\\s+-\\s+[^/]+\\.md|\\.md)$`, 'i');
  if (taskPattern.test(file)) return true;

  return false;
}

function isWorkflowGeneratedArtifact(file) {
  if (!file) return false;
  return file.startsWith('.workflow/')
    || file.startsWith('.sessions/')
    || file.startsWith('.forgejo-local/')
    || file === 'graphify-out'
    || file.startsWith('graphify-out/');
}

module.exports = {
  resolveMissionAdapter,
  missionBaseDir,
  missionUsesYearTier,
  missionBranchPrefix,
  missionBranchName,
  missionBranchRef,
  extractSlugFromBranch,
  isMissionSlugCandidate,
  getPrimaryBranch,
  getPrimaryWorktree,
  resolveMainRepo,
  conventionalWorktreePath,
  conventionalBaseWorktreePath,
  detectLaunchBaseBranch,
  parseBaseBranchLine,
  readRecordedBaseBranch,
  resolveMissionBaseBranch,
  resolveBaseWorktree,
  getMissionYear,
  findMissionDir,
  resolveWorktree,
  findCheckpoints,
  compareCheckpointFiles,
  checkpointOrder,
  getFirstLine,
  findMissionArea,
  graphifyAvailable,
  probeGraphifyAvailability,
  updateGraphifyKnowledgeGraph,
  missionTitle,
  normalizeVerifyArea,
  detectMissionAreaFromContent,
  missionPathForSlug,
  missionDirForSlug,
  inferSlug,
  parseConflictFilesFromMergeOutput,
  getConflictFiles,
  findLastNonNoiseCommit,
  squashTrailingBacklogNoiseIntoPreviousMission,
  softResetTrailingBacklogNoise,
  findMissionDocInBranches,
  isMissionArtifact,
  isWorkflowGeneratedArtifact
};
