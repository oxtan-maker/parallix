/**
 * Rebase helpers for pre-review workflow.
 *
 * Extracted from review-loop.js to break the circular dependency:
 *   handoff.js -> review-loop.js -> handoff.js
 *
 * Both handoff.js and review-loop.js import from this module instead.
 */

const path = require('path');
const fmt = require('../core/fmt');
const { git } = require('../core/git');
const { resolveWorktree } = require('../core/mission-utils');
const { isProviderEnabled } = require('./review-adapter');

const SHARED_FILE_REBASE_CONFLICT_RE = /shared file(?:\(s\))? require agent-assisted resolution|shared-file-conflicts/i;

/**
 * Auto-commit safe mission artifacts before rebase.
 * Only touches mission-generated files, task files, and stats CSV.
 */
async function commitSafeMissionArtifacts(slug, worktree, {
  taskFile = null,
  gitFn = git,
  log = fmt.log.plain,
  error = fmt.log.plainError,
  isMissionArtifactFn = require('../core/mission-utils').isMissionArtifact,
  isWorkflowGeneratedArtifactFn = require('../core/mission-utils').isWorkflowGeneratedArtifact,
  resolveStatsRelPathFn = () => null
} = {}) {
  const rootDir = worktree || process.cwd();
  const statusResult = gitFn(['-C', rootDir, 'status', '--porcelain=v1', '-z']);
  if (statusResult.status !== 0 || !statusResult.stdout) {
    return { ok: true, dirty: false };
  }

  const parsePorcelainZ = (stdout) => {
    const entries = String(stdout).split('\0').filter(Boolean);
    const dirty = [];
    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i];
      const xy = entry.slice(0, 2);
      const file = entry.slice(3);
      const record = { xy, file, paths: [file] };
      if ((xy[0] === 'R' || xy[0] === 'C') && i + 1 < entries.length) {
        const source = entries[i + 1];
        record.source = source;
        record.paths.push(source);
        i += 1;
      }
      dirty.push(record);
    }
    return dirty;
  };

  const dirtyFiles = parsePorcelainZ(statusResult.stdout);

  const unmerged = dirtyFiles.filter(f => ['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'].includes(f.xy));
  if (unmerged.length > 0) {
    error(fmt.status('FAIL', `Cannot auto-commit: unmerged/conflicting files detected:\n${unmerged.map(f => `       - ${f.file}`).join('\n')}`));
    return { ok: false, dirty: true, unsafe: true };
  }

  const resolvedTaskFile = taskFile ? path.relative(rootDir, taskFile) : null;
  const statsRelPath = resolveStatsRelPathFn(rootDir);
  const isSafeToCommit = (file) =>
    isWorkflowGeneratedArtifactFn(file)
    || isMissionArtifactFn(file, slug, rootDir)
    || (resolvedTaskFile && file === resolvedTaskFile)
    || (statsRelPath && file === statsRelPath);

  const unsafeFiles = dirtyFiles
    .flatMap(f => f.paths)
    .filter(file => !isSafeToCommit(file));
  if (unsafeFiles.length > 0) {
    error(fmt.status('FAIL', `Cannot auto-commit: dirty files include non-mission paths:`));
    unsafeFiles.forEach(file => error(`       - ${file}`));
    return { ok: false, dirty: true, unsafe: true };
  }

  log(`Auto-committing safe mission artifacts for ${fmt.branch(`mission/${slug}`)} before rebase...`);
  dirtyFiles.forEach(f => {
    log(`       - ${f.file}`);
    gitFn(['-C', rootDir, 'add', '--', f.file]);
  });

  const commitRes = gitFn(['-C', rootDir, 'commit', '-m', `workflow(${slug}): auto-commit mission artifacts before pre-review rebase`]);
  if (commitRes.status === 0) {
    log(fmt.status('PASS', 'Mission artifacts committed.'));
    return { ok: true, dirty: true };
  } else {
    const failureMsg = [commitRes.stderr, commitRes.stdout].filter(Boolean).join('\n').trim();
    error(fmt.status('FAIL', `Failed to commit mission artifacts: ${failureMsg}`));
    return { ok: false, dirty: true };
  }
}

/**
 * Rebase the mission branch onto the latest primary/main branch before launching a reviewer.
 *
 * Always commits safe worktree state first, then rebases via the workflow CLI.
 * In standalone (provider-disabled) mode, skips the rebase after committing.
 */
async function rebaseBeforeReviewRound(slug, {
  runFn = require('child_process').spawnSync,
  gitFn = git,
  taskFile = null,
  worktree = resolveWorktree(slug) || process.cwd(),
  log = fmt.log.plain,
  error = fmt.log.plainError,
  isReviewProviderEnabledFn = undefined,
  legacyIsForgejoReviewEnabledFn = null,
  isForgejoReviewEnabledFn = null
} = {}) {
  const cleanup = await commitSafeMissionArtifacts(slug, worktree, { taskFile, gitFn, log, error });
  if (!cleanup.ok) {
    error(fmt.status('WARN', 'Worktree is dirty with unsafe or conflicted files. Rebase may fail.'));
    return { ok: false, sharedFileConflicts: false };
  }

  const forgejoEnabledFn = isReviewProviderEnabledFn
    || legacyIsForgejoReviewEnabledFn
    || isForgejoReviewEnabledFn
    || isProviderEnabled;
  const forgejoEnabled = forgejoEnabledFn(worktree);
  if (!forgejoEnabled) {
    log(fmt.status('INFO', `Review provider disabled; committed worktree state and skipping pre-review rebase for ${fmt.branch(`mission/${slug}`)}.`));
    return { ok: true, sharedFileConflicts: false };
  }

  const workflowCli = path.resolve(__dirname, '..', 'index.js');

  log(`Rebasing ${fmt.branch(`mission/${slug}`)} onto the latest primary branch before reviewer launch...`);

  const result = runFn(process.execPath, [workflowCli, 'rebase', slug, '--push'], {
    cwd: worktree,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();

  if (result.status === 0) {
    log(fmt.status('PASS', `Pre-review rebase completed for ${fmt.branch(`mission/${slug}`)}.`));
    return { ok: true, sharedFileConflicts: false };
  }

  if (output) {
    error(output);
  }
  const sharedFileConflicts = SHARED_FILE_REBASE_CONFLICT_RE.test(output);
  if (sharedFileConflicts) {
    error(fmt.status('FAIL', 'Shared-file rebase conflicts detected. Autonomous review loop cannot continue safely.'));
    log(fmt.status('INFO', `Resolve the conflicts in the worktree, then re-run: px review ${slug} --start`));
  } else {
    error(fmt.status('FAIL', `Rebase failed before launching reviewer for ${fmt.branch(`mission/${slug}`)}.`));
  }
  return { ok: false, sharedFileConflicts };
}

module.exports = {
  commitSafeMissionArtifacts,
  rebaseBeforeReviewRound,
};
