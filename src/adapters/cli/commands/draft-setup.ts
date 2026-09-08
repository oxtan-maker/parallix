// @ts-nocheck
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import * as fmt from '../../../application/presentation/cli-format.js';
import { git, getWorktreeStatus } from '../../git/git.js';
import { resolveTaskFile, reportTaskResolution, getTaskStorage } from '../../backlog/backlog.js';
import { getPrimaryBranch, missionDirForSlug, squashTrailingBacklogNoiseIntoPreviousMission } from '../../filesystem/mission-utils.js';
import { runtimeAssetStore } from '../../assets/runtime-assets.js';
import { parseDirtyEntry } from './draft-conflicts.js';

const SYNTHETIC_SLUG_PREFIX = 'adhoc-';

function slugifyDraftIntent(/** @type {string} */ value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^[./\\]+/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 64);
}

function syntheticTaskId(/** @type {string} */ slug, /** @type {string} */ seed) {
  // The DB-owned adhoc identity carries no content hash: the per-repository
  // counter is its sole origin, so the task identity is the slug upper-cased,
  // matching the resolver's own rule (`normalizedId = slug.toUpperCase()`,
  // src/adapters/backlog/task-file-io.ts). A legacy `adhoc-*` free-text slug
  // keeps its historical hashed identity so existing missions stay resolvable.
  const trimmed = String(slug || '').trim();
  if (/^parallix-adhoc-\d{4,}$/i.test(trimmed)) {
    return trimmed.toUpperCase();
  }
  const hash = crypto.createHash('sha1').update(String(seed || slug)).digest('hex').slice(0, 8).toUpperCase();
  const prefix = trimmed.startsWith(SYNTHETIC_SLUG_PREFIX) ? 'ADHOC' : 'TASK';
  const base = trimmed
    .replace(/^(task|adhoc)-/i, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .toUpperCase();
  return `${prefix}-${base}-${hash}`;
}

function resolveDraftTarget(/** @type {string} */ rawInput, cwd = process.cwd()) {
  const explicit = String(rawInput || '').trim();
  if (!explicit) {return null;}

  // Re-entering an existing DB-owned adhoc identity (task-2468, F6): the
  // `parallix-adhoc-<NNNN>` counter is repository-scoped and monotonic, so a
  // fresh draft of the same identity must reuse the minted identity rather than
  // minting a second one. Recognize the explicit input as an existing identity
  // reference; the preflight step skips allocation for it.
  if (/^parallix-adhoc-\d{4,}$/i.test(explicit)) {
    return {
      slug: explicit.toLowerCase(),
      syntheticTask: null,
      existingAdhocIdentity: true,
    };
  }

  if (explicit.toLowerCase().startsWith('task-')) {
    return {
      slug: explicit.toLowerCase(),
      syntheticTask: null,
    };
  }

  if (explicit.toLowerCase().startsWith(SYNTHETIC_SLUG_PREFIX)) {
    return {
      slug: explicit.toLowerCase(),
      syntheticTask: {
        title: explicit,
        intent: explicit,
        id: syntheticTaskId(explicit.toLowerCase(), explicit),
        source: 'synthetic-explicit-slug',
      },
    };
  }

  const absoluteCandidate = path.resolve(cwd, explicit);
  if (fs.existsSync(absoluteCandidate) && fs.statSync(absoluteCandidate).isDirectory()) {
    const baseName = path.basename(absoluteCandidate);
    const normalizedBase = slugifyDraftIntent(baseName) || 'project';
    const slug = `${SYNTHETIC_SLUG_PREFIX}${normalizedBase}`;
    return {
      slug,
      syntheticTask: {
        title: `Draft mission for ${baseName}`,
        intent: `Directory input: ${explicit}`,
        id: syntheticTaskId(slug, absoluteCandidate),
        source: 'synthetic-directory',
      },
    };
  }

  const normalized = slugifyDraftIntent(explicit) || 'mission';
  const slug = normalized.startsWith(SYNTHETIC_SLUG_PREFIX) ? normalized : `${SYNTHETIC_SLUG_PREFIX}${normalized}`;
  return {
    slug,
    syntheticTask: {
      title: explicit,
      intent: explicit,
      id: syntheticTaskId(slug, explicit),
      source: 'synthetic-free-text',
    },
  };
}

function ensureMissionBranch(mainRepo, branchName, {
  gitFn = git,
  logFn = fmt.log.plain,
  squashTrailingBacklogNoiseIntoPreviousMissionFn = squashTrailingBacklogNoiseIntoPreviousMission,
  baseBranch = null
} = {}) {
  const branches = gitFn(['-C', mainRepo, 'branch', '--list', branchName]).stdout.trim();
  if (branches) {
    logFn(fmt.status('PASS', `Branch ${fmt.branch(branchName)} already exists.`));
    return;
  }

  squashTrailingBacklogNoiseIntoPreviousMissionFn(mainRepo, gitFn);

  // The base is whatever HEAD pointed at when draft ran (a feature branch); when
  // none was recorded it falls back to the primary branch — byte-identical to
  // the legacy single-branch behaviour.
  const startPoint = baseBranch || getPrimaryBranch();
  gitFn(['-C', mainRepo, 'branch', branchName, startPoint]);
  logFn(fmt.status('PASS', `Created branch ${fmt.branch(branchName)} from ${fmt.branch(startPoint)}.`));
}

/**
 * Persist the resolved mission base as a single machine-readable `Base-Branch:`
 * line in MISSION.md. Idempotent: a no-op when the correct line is already
 * present, when `baseBranch` is falsy and no base line exists, or when the
 * mission file is missing. Replaces a stale line in place, otherwise inserts the
 * line just under the title.
 *
 * A primary/detached-HEAD launch records no feature base, so `baseBranch` is
 * falsy. Previously that was an unconditional no-op, which let a stale
 * `Base-Branch` left by a prior feature-branch re-draft survive: the next
 * `resolveMissionBaseBranch` would then resolve a branch that no longer exists
 * (task-2389, `friday-08-21`). Clear the stale line here so the resolver falls
 * back to the primary branch before any downstream lifecycle work consumes it.
 */
// @ts-expect-error implicit any on missionFile/baseBranch
function ensureMissionBaseBranchRecorded(missionFile, baseBranch, { logFn = fmt.log.plain } = {}) {
  if (!missionFile || !fs.existsSync(missionFile)) {
    return false;
  }

  const content = fs.readFileSync(missionFile, 'utf8');

  // Primary/detached launch: no feature base to record. Drop any stale
  // Base-Branch line so resolveMissionBaseBranch resolves the primary branch.
  if (!baseBranch) {
    if (!/^Base-Branch:\s*\S+\s*$/m.test(content)) {
      return false;
    }
    const updated = content.replace(/^Base-Branch:\s*\S+\s*$/m, '');
    fs.writeFileSync(missionFile, updated);
    logFn(fmt.status('PASS', 'Cleared stale Base-Branch for primary/detached launch'));
    return true;
  }

  const line = `Base-Branch: ${baseBranch}`;
  const existing = content.match(/^Base-Branch:\s*(\S+)\s*$/m);
  if (existing && existing[1] === baseBranch) {
    return false;
  }

  let updated;
  if (existing) {
    updated = content.replace(/^Base-Branch:\s*\S+\s*$/m, line);
  } else {
    const lines = content.split('\n');
    const insertAt = lines.length > 0 ? 1 : 0;
    lines.splice(insertAt, 0, '', line);
    updated = lines.join('\n');
  }

  fs.writeFileSync(missionFile, updated);
  logFn(fmt.status('PASS', `Recorded ${line} in ${fmt.path(missionFile)}`));
  return true;
}

// ponytail: single choke point — every draft-startup caller routes the launch
// base through this writer, so clearing a stale base here (not in each caller)
// fixes primary re-drafts and leaves non-primary replace behavior untouched.

// @ts-expect-error implicit any on mainRepo/targetWorktree/branchName
function ensureWorktree(mainRepo, targetWorktree, branchName, {
  existsFn = fs.existsSync,
  gitFn = git,
  logFn = fmt.log.plain,
  errorFn = fmt.log.plainError,
  exitFn = process.exit
} = {}) {
  if (existsFn(targetWorktree)) {
    logFn(fmt.status('PASS', `Worktree directory ${fmt.path(targetWorktree)} already exists.`));
    try {
      gitFn(['-C', mainRepo, 'worktree', 'add', targetWorktree, branchName]);
    } catch (_error) {
      // Ignore "already exists" style failures; the directory is already usable.
    }
    return;
  }

  try {
    gitFn(['-C', mainRepo, 'worktree', 'add', targetWorktree, branchName]);
    logFn(fmt.status('PASS', `Created worktree at ${fmt.path(targetWorktree)}.`));
  } catch (error) {
    errorFn(fmt.status('FAIL', `Could not create worktree: ${/** @type {any} */ (error).message}`));
    exitFn(1);
  }
}

// @ts-expect-error implicit any on targetWorktree/mainRepo
function ensureGraphifyWorkspace(targetWorktree, mainRepo, { logFn = fmt.log.plain } = {}) {
  const targetPath = path.join(targetWorktree, 'graphify-out');

  if (fs.existsSync(targetPath)) {
    try {
      if (fs.lstatSync(targetPath).isDirectory()) {
        logFn(fmt.status('PASS', `graphify-out directory already exists in the mission worktree at ${fmt.path(targetPath)}.`));
      } else {
        logFn(fmt.status('WARN', `${fmt.path(targetPath)} already exists and is not a directory. Leaving it unchanged.`));
        return false;
      }
    } catch (_) {
      logFn(fmt.status('WARN', `${fmt.path(targetPath)} already exists and is not a directory. Leaving it unchanged.`));
      return false;
    }
  } else {
    fs.mkdirSync(targetPath, { recursive: true });
    logFn(fmt.status('PASS', `Created independent graphify-out directory in the mission worktree at ${fmt.path(targetPath)}.`));

    // Copy graphify-out contents (graph.json, wiki/, etc.) from the primary worktree
    // so the draft agent has graph context from the start. Scoped to newly-created
    // directories so a re-run of px draft does not clobber a mission worktree's
    // fresher graph with the primary's staler one.
    if (mainRepo) {
      const sourcePath = path.join(mainRepo, 'graphify-out');
      try {
        if (fs.existsSync(sourcePath) && fs.lstatSync(sourcePath).isDirectory()) {
          fs.cpSync(sourcePath, targetPath, { recursive: true, force: true });
          logFn(fmt.status('PASS', `Copied graphify-out contents from primary worktree ${fmt.path(sourcePath)}.`));
        }
      } catch (_) {
        // Graceful degradation: graphify not installed, source unavailable, or copy failed.
        // The empty directory is still created and draft proceeds.
      }
    }
  }

  return true;
}

// @ts-expect-error implicit any on targetWorktree
function ensureGraphifyIgnore(targetWorktree, { gitFn = git, logFn = fmt.log.plain } = {}) {
  const targetPath = path.join(targetWorktree, '.graphifyignore');

  if (fs.existsSync(targetPath) || fs.existsSync(path.join(targetWorktree, '.gitignore'))) {
    logFn(fmt.status('PASS', '.graphifyignore or .gitignore already exists. Leaving unchanged.'));
    return true;
  }

  if (!fs.existsSync(targetWorktree)) {
    logFn(fmt.status('PASS', `Worktree ${fmt.path(targetWorktree)} does not exist yet. .graphifyignore will be created by the draft agent.`));
    return true;
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath,
    '# Files owned by the workflow toolkit — not part of the project codebase.\n' +
    '# Prevents graphify from extracting session logs, agent state, and tool caches.\n' +
    '.workflow/\n',
    { encoding: 'utf-8' }
  );

  try {
    const gitRoot = targetWorktree;
    gitFn(['-C', gitRoot, 'add', '.graphifyignore']);
    gitFn(['-C', gitRoot, 'commit', '-m', 'workflow: add .graphifyignore to exclude .workflow/ from graphify']);
    logFn(fmt.status('PASS', `Created and committed .graphifyignore in ${fmt.path(gitRoot)}.`));
  } catch (error) {
    logFn(fmt.status('WARN', `Created .graphifyignore but could not commit: ${/** @type {any} */ (error).message}. It will be picked up by the draft safety harness.`));
  }

  return true;
}

// @ts-expect-error implicit any on targetWorktree/slug
function ensureMissionFile(targetWorktree, slug, { logFn = fmt.log.plain } = {}) {
  const missionDir = missionDirForSlug(targetWorktree, slug);
  if (!fs.existsSync(missionDir)) {
    fs.mkdirSync(missionDir, { recursive: true });
  }

  const missionFile = path.join(missionDir, 'MISSION.md');
  if (fs.existsSync(missionFile)) {
    logFn(fmt.status('PASS', `MISSION.md already exists at ${fmt.path(missionFile)}`));
    return missionFile;
  }

  const template = runtimeAssetStore.readText('templates/mission-scaffold.md').replaceAll('{{slug}}', slug);
  fs.writeFileSync(missionFile, template);
  logFn(fmt.status('PASS', `Scaffolded MISSION.md at ${fmt.path(missionFile)}`));
  logFn(fmt.status('INFO', 'Note: Draft mode involves AI refinement. Use the draft prompt to complete the contract.'));
  return missionFile;
}

// @ts-expect-error implicit any on mainRepo
function ensureDraftRepoConfigCommitted(mainRepo, {
  getWorktreeStatusFn = getWorktreeStatus,
  errorFn = fmt.log.plainError
} = {}) {
  const dirtyEntries = getWorktreeStatusFn(mainRepo);
  if (!dirtyEntries || dirtyEntries.length === 0) {
    return true;
  }

  const configPaths = new Set([
    'workflow.config.json',
    'backlog/config.yml',
    'config/state-map.json'
  ]);
  const dirtyConfigEntries = dirtyEntries
    .map(parseDirtyEntry)
    .filter(entry => configPaths.has(entry.filePath));

  if (dirtyConfigEntries.length === 0) {
    return true;
  }

  errorFn(fmt.status('FAIL', `Draft preflight: repo-state config that affects mission layout is uncommitted in ${fmt.path(mainRepo)}.`));
  for (const entry of dirtyConfigEntries) {
    errorFn(`  ${entry.status} ${entry.filePath}`);
  }
  errorFn('Commit these repo-state config changes before running draft. Mission worktrees are created from HEAD, so uncommitted config would produce a stale layout.');
  return false;
}

// @ts-expect-error implicit any on targetWorktree/mainRepo/slug
function bootstrapBacklogTask(targetWorktree, mainRepo, slug, {
  resolveTaskFileFn = resolveTaskFile,
  reportTaskResolutionFn = reportTaskResolution,
  gitFn = git,
  logFn = fmt.log.plain,
  errorFn = fmt.log.plainError,
  syntheticTask = null
} = {}) {
  const taskResolution = resolveTaskFileFn(slug, targetWorktree);
  if (taskResolution.ok) {
    logFn(fmt.status('PASS', `Backlog task for ${fmt.slug(slug)} already exists in worktree.`));
    return true;
  }

  if (taskResolution.reason === 'ambiguous') {
    reportTaskResolutionFn(taskResolution, slug, errorFn);
    return false;
  }

  if (syntheticTask) {
    // DB-owned adhoc identity (task-2468, F1): the mission's identity lives in
    // the repository-scoped counter, not in a Backlog task file. The task file
    // is a best-effort one-way mirror. It still carries the synthetic `unknown`
    // classification the draft needs, so we create it — but a failure to commit
    // it (read-only `backlog/`, a rejecting hook) must never make `px draft`
    // load-bearing on Backlog. Warn and continue; the DB identity is authority.
    const { tasksDir } = getTaskStorage(targetWorktree);
    const taskPath = path.join(tasksDir, `${slug} - ${slugifyDraftIntent(/** @type {any} */ (syntheticTask).title || slug) || 'mission'}.md`);
    const body = [
      '---',
      `id: ${/** @type {any} */ (syntheticTask).id || syntheticTaskId(slug, /** @type {any} */ (syntheticTask).intent || slug)}`,
      `title: ${/** @type {any} */ (syntheticTask).title || slug}`,
      'status: backlog',
      'assignee: []',
      "created_date: '" + new Date().toISOString().slice(0, 16).replace('T', ' ') + "'",
      'labels: [unknown]',
      'dependencies: []',
      'source: synthetic',
      '---',
      '',
      '## Description',
      '',
      /** @type {any} */ (syntheticTask).intent || `Synthetic task created for ${slug}.`,
      ''
    ].join('\n');

    fs.mkdirSync(path.dirname(taskPath), { recursive: true });
    fs.writeFileSync(taskPath, body, 'utf8');
    logFn(fmt.status('PASS', `Created synthetic backlog task at ${fmt.path(path.relative(targetWorktree, taskPath))}.`));

    try {
      const relativePath = path.relative(targetWorktree, taskPath);
      gitFn(['-C', targetWorktree, 'add', relativePath]);
      gitFn(['-C', targetWorktree, 'commit', '-m', `backlog(${slug}): create synthetic task`]);
      logFn(fmt.status('PASS', 'Committed synthetic task in worktree.'));
    } catch (error) {
      // Best-effort mirror (task-2468, F1): the synthetic task file is a
      // one-way Backlog mirror, not the mission's authority. A commit failure
      // (read-only `backlog/`, a rejecting hook) warns but does not fail the
      // draft — the DB-owned adhoc identity and lifecycle are unaffected.
      errorFn(fmt.status('WARN', `Could not commit synthetic task: ${/** @type {any} */ (error).message}. The DB-owned adhoc identity is authoritative; the Backlog mirror is best-effort.`));
    }
    return true;
  }

  logFn(fmt.status('INFO', `Backlog task for ${fmt.slug(slug)} not found in worktree. Attempting to bootstrap from ${fmt.path(mainRepo)}...`));
  const mainResolution = resolveTaskFileFn(slug, mainRepo);
  if (!mainResolution.ok) {
    reportTaskResolutionFn(mainResolution, slug, errorFn);
    return false;
  }

  // @ts-expect-error mainResolution.taskFile may be undefined
  const relativePath = path.relative(mainRepo, mainResolution.taskFile);
  const targetPath = path.join(targetWorktree || '', relativePath);

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  // @ts-expect-error mainResolution.taskFile may be undefined
  fs.copyFileSync(mainResolution.taskFile, targetPath);

  logFn(fmt.status('PASS', `Bootstrapped ${fmt.path(relativePath)} from main repo.`));

  try {
    gitFn(['-C', targetWorktree, 'add', relativePath]);
    gitFn(['-C', targetWorktree, 'commit', '-m', `backlog(${slug}): bootstrap task from ${getPrimaryBranch()}`]);
    logFn(fmt.status('PASS', 'Committed bootstrapped task in worktree.'));
  } catch (error) {
    errorFn(fmt.status('FAIL', `Could not commit bootstrapped task: ${/** @type {any} */ (error).message}`));
    return false;
  }

  return true;
}

// @ts-expect-error implicit any on mainRepo
function ensureRepoExists(mainRepo, exitFn = process.exit, errorFn = fmt.log.fail) {
  if (!fs.existsSync(mainRepo)) {
    errorFn(`Main repository not found at ${mainRepo}. Please ensure it exists or set PRIMARY_WORKTREE.`);
    exitFn(1);
    return false;
  }
  return true;
}



export { SYNTHETIC_SLUG_PREFIX, slugifyDraftIntent, syntheticTaskId, resolveDraftTarget, ensureMissionBranch, ensureMissionBaseBranchRecorded, ensureWorktree, ensureGraphifyWorkspace, ensureGraphifyIgnore, ensureMissionFile, ensureDraftRepoConfigCommitted, ensureRepoExists, bootstrapBacklogTask };
