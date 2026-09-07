import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { git, run } from '../../git/git.js';
import * as fmt from '../../../application/presentation/cli-format.js';
import { resolveWorktree, getConflictFiles, updateGraphifyKnowledgeGraph, getPrimaryWorktree, getPrimaryBranch, conventionalWorktreePath, missionBranchName, isMissionArtifact, resolveMissionBaseBranch } from '../../filesystem/mission-utils.js';
import * as verification from '../../verification/verification.js';
import { IntegrationAbort, shellQuote } from './integrate-post.js';

const { formatVerificationCommand } = verification;

/** @param {string} rootDir @param {{commandRunner?: Function, log?: Function}} opts */
export function maybeUpdateGraphifyOnPrimary(rootDir = getPrimaryWorktree(), opts: {commandRunner?: Function, log?: Function} = {}) {
  return updateGraphifyKnowledgeGraph({
    rootDir,
    commandRunner: opts.commandRunner || ((/** @type{string} */ command: string, /** @type{string[]} */ args: string[], /** @type{object} */ options: any) => run(command, args, options)),
    log: opts.log,
    startMessage: `Updating graphify knowledge graph on ${getPrimaryBranch(rootDir)}...`,
    failureHint: 'Continuing without blocking integration.'
  });
}

/** @param {string} rootDir @param {{gitRunner?: Function, tmpDir?: string}} opts */
export function prepareNoisePatchForSquash(rootDir: string, opts: {gitRunner?: Function, tmpDir?: string} = {}) {
  const runner = (opts.gitRunner || git) as Function;
  const diffResult = runner(['-C', rootDir, 'diff', '--cached', '--binary']);
  if (diffResult.status !== 0) {
    return {
      ok: false,
      error: [diffResult.stdout, diffResult.stderr].filter(Boolean).join('\n').trim() || 'Could not capture staged backlog-noise patch.'
    };
  }

  const patch = diffResult.stdout || '';
  if (!patch.trim()) {
    return { ok: true, patchPath: null, cleanup: () => {} };
  }

  // mkdtemp gives this invocation an ownership-scoped cleanup target. Never
  // remove the supplied root: it may be an operator or concurrent process path.
  const patchDir = fs.mkdtempSync(path.join(opts.tmpDir || os.tmpdir(), 'parallix-integrate-noise-'));
  const patchPath = path.join(patchDir, 'backlog-noise.patch');
  const cleanup = () => fs.rmSync(patchDir, { recursive: true, force: true });
  fs.writeFileSync(patchPath, patch, 'utf8');

  const resetResult = runner(['-C', rootDir, 'reset', '--hard', 'HEAD']);
  if (resetResult.status !== 0) {
    cleanup();
    return {
      ok: false,
      error: [resetResult.stdout, resetResult.stderr].filter(Boolean).join('\n').trim() || 'Could not restore a clean checkout after capturing backlog-noise patch.'
    };
  }

  return {
    ok: true,
    patchPath,
    cleanup
  };
}

/** @param {string} rootDir @param {string|null} patchPath @param {{gitRunner?: Function}} opts */
export function restoreNoisePatchAfterSquash(rootDir: string, patchPath: string | null, opts: {gitRunner?: Function} = {}) {
  if (!patchPath) {return { ok: true };}
  const runner = (opts.gitRunner || git) as Function;
  const applyResult = runner(['-C', rootDir, 'apply', '--index', patchPath]);
  if (applyResult.status !== 0) {
    return {
      ok: false,
      error: [applyResult.stdout, applyResult.stderr].filter(Boolean).join('\n').trim() || 'Could not re-apply backlog-noise patch after squash merge.'
    };
  }
  return { ok: true };
}

/** @param {string} rootDir @param {{gitRunner?: Function}} opts */
export function getUnresolvedIndexConflicts(rootDir = getPrimaryWorktree(), opts: {gitRunner?: Function} = {}) {
  const runner = (opts.gitRunner || git) as Function;
  const result = runner(['-C', rootDir, 'ls-files', '-u']);
  if (result.status !== 0) {
    return {
      ok: false,
      files: [],
      error: [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
    };
  }

  const files = Array.from(new Set(
    result.stdout
      .split('\n')
      .map((line: string) => line.trim())
      .filter(Boolean)
      .map((line: string) => line.split('\t')[1])
      .filter(Boolean)
  ));

  return {
    ok: true,
    files
  };
}

/**
 * Check if all conflict files are under the backlog/ directory.
 * Uses the same noise-path pattern as softResetTrailingBacklogNoise and
 * findLastNonNoiseCommit. An empty list is treated as backlog-only
 * (no conflicts to classify).
 *
 * @param {string[]} conflictFiles - Relative file paths from parseConflictFilesFromMergeOutput
 * @returns {boolean} true if every file starts with 'backlog/'
 */
export function areAllBacklogOnlyConflicts(conflictFiles: string[]): boolean {
  if (conflictFiles.length === 0) { return true; }
  return conflictFiles.every(f => f.startsWith('backlog/'));
}

export function parseStashPopCollisionFiles(output = '') {
  return output
    .split('\n')
    .map(line => line.trim())
    .filter(line => /already exists, no checkout$/i.test(line))
    .map(line => line.replace(/\s+already exists, no checkout$/i, ''));
}

/**
 * @param {string} slug
 * @param {{stdout: string, stderr: string, status: number}} restoreResult
 * @param {{rootDir?: string, gitRunner?: Function, getUnresolvedIndexConflictsFn?: Function}} opts
 */
export function reportStashPopFailure(slug: string, restoreResult: any, opts: {rootDir?: string, gitRunner?: Function, getUnresolvedIndexConflictsFn?: Function} = {}) {
  const output = [restoreResult.stdout, restoreResult.stderr].filter(Boolean).join('\n').trim();
  const runner = (opts.gitRunner || git) as Function;
  const rootDir = opts.rootDir || getPrimaryWorktree();
  const headResult = runner(['-C', rootDir, 'log', '-1', '--oneline']);
  const headLine = headResult.status === 0 ? headResult.stdout.trim() : '(unavailable)';
  const integrationLanded = headLine.includes(`${missionBranchName(slug, rootDir)}:`);
  const indexConflicts = (opts.getUnresolvedIndexConflictsFn || getUnresolvedIndexConflicts)(rootDir);
  const collisionFiles = parseStashPopCollisionFiles(output);

  fmt.log.fail('[RESTORE] Could not restore the temporarily stashed local integration checkout changes.');
  if (integrationLanded) {
    fmt.log.fail(`  Integration commit landed: ${headLine}`);
  } else {
    fmt.log.fail(`  Integration landing not confirmed by HEAD: ${headLine}`);
  }

  if (indexConflicts.ok && indexConflicts.files.length > 0) {
    fmt.log.fail('  Stash restore failure type: merge-conflict (unmerged index entries)');
    indexConflicts.files.forEach((file: string) => fmt.log.fail(`  Collision file: ${file}`));
    fmt.log.fail('  Recovery steps:');
    fmt.log.fail(`    1. cd ${rootDir}`);
    indexConflicts.files.forEach((file: string) => {
      fmt.log.fail(`    2. Resolve ${file}, then run git add "${file}" or git rm "${file}"`);
    });
    fmt.log.fail('    3. git status --short');
    fmt.log.fail('    4. git stash drop');
  } else {
    fmt.log.fail('  Stash restore failure type: file-collision');
    if (collisionFiles.length > 0) {
      collisionFiles.forEach((file: string) => fmt.log.fail(`  Collision file: ${file}`));
    }
    fmt.log.fail('  Recovery steps:');
    fmt.log.fail(`    1. git -C ${rootDir} stash show --name-only stash@{0}`);
    if (collisionFiles.length > 0) {
      collisionFiles.forEach((file: string) => {
        fmt.log.fail(`    2. mv ${path.join(rootDir, file)} ${path.join(rootDir, `${file}.pre-stash-pop`)}`);
      });
      fmt.log.fail(`    3. git -C ${rootDir} stash pop`);
    } else {
      fmt.log.fail(`    2. Inspect the latest stash-pop output and move or remove the colliding files in ${rootDir}`);
      fmt.log.fail(`    3. git -C ${rootDir} stash pop`);
    }
  }

  if (output) {
    fmt.log.fail('  Raw stash pop output:');
    output.split('\n').forEach((line: string) => fmt.log.fail(`    ${line}`));
  }
}

/** @param {string} taskFilePath @param {string} slug @param{{rootDir?: string}} options */
export function rewriteWorktreePaths(taskFilePath: string, slug: string, options: {rootDir?: string} = {}) {
  const rootDir = options.rootDir || getPrimaryWorktree();
  const before = fs.readFileSync(taskFilePath, 'utf8');
  const updated = before.replace(
    new RegExp(`${conventionalWorktreePath(slug, rootDir)}`, 'g'),
    rootDir
  );

  if (before !== updated) {
    fs.writeFileSync(taskFilePath, updated, 'utf8');
  }
}

/** @param{{slug: string, dirtyEntries?: string[], rootDir?: string, gitRunner?: Function}} params */
export function stashMainCheckoutIfNeeded({
  slug,
  dirtyEntries = [],
  rootDir = getPrimaryWorktree(),
  gitRunner = git
}: {slug: string, dirtyEntries?: string[], rootDir?: string, gitRunner?: Function}) {
  if (dirtyEntries.length === 0) {
    return { created: false };
  }

  const message = `integrate:${slug}: temporary integration checkout stash`;
  fmt.log.info(`[STASH] Stashing unrelated local integration checkout changes before integration: ${message}`);
  const result = gitRunner([
    '-C',
    rootDir,
    'stash',
    'push',
    '--include-untracked',
    '-m',
    message
  ]);

  if (result.status !== 0) {
    fmt.log.fail('[STASH] Could not stash the unrelated local integration checkout changes.');
    throw new IntegrationAbort();
  }

  return {
    created: true,
    message,
    rootDir
  };
}

/** @param{{message: string, rootDir?: string, gitRunner?: Function}} params */
export function restoreMainCheckoutStash({ message, rootDir = getPrimaryWorktree(), gitRunner = git }: {message: string, rootDir?: string, gitRunner?: Function}) {
  fmt.log.info(`[RESTORE] Restoring temporarily stashed local integration checkout changes: ${message}`);
  // Use --index for safer restore semantics: git attempts to reinstage the index
  // changes from the stash alongside the working-tree changes. Collisions are
  // left as merge conflicts rather than silently overwriting files.
  // Pass cwd explicitly so spawnSync does not inherit the process cwd, which may have been
  // deleted by worktree cleanup earlier in the same integrate run.
  return gitRunner(['-C', rootDir, 'stash', 'pop', '--index'], { cwd: rootDir });
}

/**
 * Decide whether a failed `git stash pop --index` can be resolved by simply
 * dropping the temporary stash. The outcome is benign when it is a pure
 * file-collision: a stashed *untracked* file could not be restored because it
 * now already exists on disk (it was committed by the landed squash merge, so
 * it is tracked and its content is intact). When the stash pop instead left
 * unmerged index entries, or a colliding file is missing from disk, data may
 * still be at stake and the caller must surface the failure instead.
 *
 * @returns {{ok: true, ref: string} | null} a drop token when safe to drop,
 *   or null when the failure needs a human.
 */
export function maybeDropStashAfterCollision(
  restoreResult: {stdout: string, stderr: string, status: number},
  rootDir: string,
  opts: {gitRunner?: Function} = {}
): {ok: true, ref: string} | null {
  const runner = opts.gitRunner || git;
  const output = [restoreResult.stdout, restoreResult.stderr].filter(Boolean).join('\n');

  // Unmerged index entries mean a real merge conflict that needs resolution.
  const conflicts = getUnresolvedIndexConflicts(rootDir, {gitRunner: runner});
  if (conflicts.ok && conflicts.files.length > 0) {
    return null;
  }

  // Every file git refused to checkout because it already exists must in fact
  // exist on disk for the data to be preserved. A collision file that is
  // missing would mean the stash could not be recovered at all.
  const collisionFiles = parseStashPopCollisionFiles(output);
  const missing = collisionFiles.filter((file: string) => !fs.existsSync(path.join(rootDir, file)));
  if (missing.length > 0) {
    return null;
  }

  const drop = runner(['-C', rootDir, 'stash', 'drop', 'stash@{0}']);
  if (drop.status !== 0) {
    return null;
  }
  return { ok: true, ref: 'stash@{0}' };
}

/** @param {string} rootDir @param {string} slug */
export function findExistingSquashCommit(rootDir: string, slug: string) {
  const result = git(['-C', rootDir, 'log', '--format=%H %s', '-50']);
  if (result.status !== 0) {return null;}
  const prefix = `${missionBranchName(slug, rootDir)}:`;
  for (const line of result.stdout.trim().split('\n')) {
    const spaceIdx = line.indexOf(' ');
    if (spaceIdx === -1) {continue;}
    const hash = line.slice(0, spaceIdx);
    const subject = line.slice(spaceIdx + 1);
    if (subject.startsWith(prefix)) {return hash;}
  }
  return null;
}

/**
 * Detect merge conflicts in the mission worktree and emit a bounded resolution plan.
 *
 * Categories:
 *   - Mission-specific: the adapter-resolved mission directory and backlog/{tasks,completed}/ files matching the slug.
 *     These can be resolved by taking the mission's own version (--theirs during rebase).
 *   - Shared: everything else — warn only, do not auto-skip.
 *
 * @param {string} slug - Backlog task key (e.g. "architecture migration")
 * @param {string} area - Mission gate area passed to the configured verification command
 * @param {{ getConflictFilesFn?: Function }} [options] - Overrides for testing
 * @returns {{ ok: boolean, conflictFiles: string[], sharedFiles: string[], missionSpecificFiles: string[], error?: string, worktreePath?: string }}
 */
/**
 * @param {string} slug
 * @param {string} area
 * @param{{getConflictFilesFn: Function, resolveWorktreeFn?: Function, worktreePathOverride?: string|null, rootDir?: string, baseBranch?: string|null}} options
 */
// @ts-expect-error resolveConflictsForMission options missing getConflictFilesFn
export function resolveConflictsForMission(slug, area, { getConflictFilesFn, resolveWorktreeFn = resolveWorktree, worktreePathOverride = null, rootDir = getPrimaryWorktree(), baseBranch = null } = {}) {
  // Resolve the actual attached worktree dynamically; fall back to the conventional
  // path only when git worktree list has no entry for this mission branch.
  const conventionalPath = `${conventionalWorktreePath(slug, rootDir)}`;
  const resolvedPath = worktreePathOverride || resolveWorktreeFn(slug);
  const worktreePath = resolvedPath || conventionalPath;
  if (!resolvedPath) {
    fmt.log.warn(`No registered worktree found for ${missionBranchName(slug, rootDir)}; falling back to conventional path.`);
  }

  // Conflicts must be detected against the branch the mission integrates back
  // into. For a feature-branch mission that is the recorded base branch, not the
  // primary branch; for legacy missions resolveMissionBaseBranch returns primary.
  /** @type {string} */
  let targetBranch = /** @type {string} */ (baseBranch || getPrimaryBranch());
  if (!targetBranch) {
    try { targetBranch = resolveMissionBaseBranch(slug, rootDir); } catch (_) { targetBranch = getPrimaryBranch(); }
  }

  const detectFn = getConflictFilesFn || (() => getConflictFiles(worktreePath, targetBranch));

  if (!fs.existsSync(worktreePath)) {
    fmt.log.fail(`Mission worktree not found: ${worktreePath}`);
    fmt.log.info(`Expected path: ${worktreePath}`);
    return { ok: false, error: 'worktree-missing', conflictFiles: [], sharedFiles: [], missionSpecificFiles: [], worktreePath };
  }

  fmt.log.info(`Detecting conflicts in ${worktreePath} against ${targetBranch}...`);
  let conflictFiles;
  try {
    conflictFiles = detectFn(worktreePath, targetBranch);
  } catch (err: any) {
    fmt.log.fail('Merge check failed with a non-conflict error:');
    fmt.log.fail(err.message);
    return { ok: false, error: 'merge-failed', conflictFiles: [], sharedFiles: [], missionSpecificFiles: [], worktreePath };
  }

  if (conflictFiles.length === 0) {
    fmt.log.pass('No conflicts detected in mission worktree. Integration should proceed cleanly.');
    fmt.log.info(`Retry: px integrate ${slug} --dry-run`);
    return { ok: true, conflictFiles: [], sharedFiles: [], missionSpecificFiles: [], worktreePath };
  }

  fmt.log.info(`Conflicting files (${conflictFiles.length}):`);
  conflictFiles.forEach((f: string) => fmt.log.info(`  - ${f}`));

  // Derive the mission-doc directory prefix from the actual located mission dir
  // so the classification works for non-standard doc paths (e.g. renamed year dir).
  const taskPattern = new RegExp(`backlog/(?:tasks|completed)/[^/]*${slug}`);
  const missionSpecificFiles = conflictFiles.filter((f: string) =>
    isMissionArtifact(f, slug, worktreePath) || taskPattern.test(f)
  );
  const sharedFiles = conflictFiles.filter((f: string) => !missionSpecificFiles.includes(f));
  const quotedWorktreePath = shellQuote(worktreePath);

  if (sharedFiles.length > 0) {
    fmt.log.warn(`Conflicts in ${sharedFiles.length} shared file(s) require manual resolution:`);
    sharedFiles.forEach((f: string) => fmt.log.plain(`  - ${f}`));
    fmt.log.info('Manual resolution path:');
    fmt.log.info(`  cd ${quotedWorktreePath}`);
    fmt.log.info(`  git rebase ${targetBranch}`);
    fmt.log.info('  # resolve each shared file conflict manually');
    fmt.log.info('  git add <resolved-files>');
    fmt.log.info('  git rebase --continue');
    fmt.log.info(`  ${formatVerificationCommand(area, worktreePath)}`);
    fmt.log.info(`  px integrate ${slug} --dry-run`);
    return { ok: false, error: 'shared-file-conflicts', conflictFiles, sharedFiles, missionSpecificFiles, worktreePath };
  }

  fmt.log.info(`All ${missionSpecificFiles.length} conflict(s) are in mission-specific files.`);
  fmt.log.info('Skip-all-conflicts path (use --theirs to keep the mission version):');
  fmt.log.info(`  cd ${quotedWorktreePath}`);
  fmt.log.info(`  git rebase ${targetBranch}`);
  fmt.log.info('  # after the rebase pauses on conflicts:');
  missionSpecificFiles.forEach((f: string) => fmt.log.info(`  git checkout --theirs "${f}" && git add "${f}"`));
  fmt.log.info('  git rebase --continue');
  fmt.log.info(`  ${formatVerificationCommand(area, worktreePath)}`);
  fmt.log.info(`  px integrate ${slug} --dry-run`);

  return { ok: true, conflictFiles, sharedFiles: [], missionSpecificFiles, worktreePath };
}

/** @param{string} slug @param{string} area @param{{rootDir?: string, worktreePath?: string, baseBranch?: string|null}} options */
export function buildConflictResolutionPrompt(slug: string = '<slug>', area: string = '<area>', options: {rootDir?: string, worktreePath?: string, baseBranch?: string|null} = {}) {
  const rootDir = options.rootDir || getPrimaryWorktree();
  const worktreePath = options.worktreePath || resolveWorktree(slug) || conventionalWorktreePath(slug, rootDir);
  const quotedWorktreePath = shellQuote(worktreePath);
  // Rebase guidance must target the branch the mission integrates back into: the
  // recorded base for feature-branch missions, the primary branch otherwise.
  let targetBranch = options.baseBranch;
  if (!targetBranch) {
    try { targetBranch = resolveMissionBaseBranch(slug, rootDir); } catch (_) { targetBranch = getPrimaryBranch(); }
  }
  return [
    'Conflict resolution options:',
    '',
    'Option A — Agent-assisted (recommended):',
    '  Copy/paste from the mission worktree:',
    `  cd ${quotedWorktreePath} && px resolve-conflict ${slug}`,
    '  (Detects conflict files, categorises mission-specific vs shared, and prints exact resolution commands.)',
    '',
    'Option B — Manual rebase path:',
    `  1. Stay in the mission worktree (${worktreePath}); do not resolve non-trivial conflicts inside ${rootDir}.`,
    `     cd ${quotedWorktreePath}`,
    '     git status --short',
    `  2. Rebase the mission branch onto the local ${targetBranch} branch:`,
    `     git fetch review ${targetBranch}`,
    `     git rebase ${targetBranch}`,
    `  3. Re-run the mission gate: ${formatVerificationCommand(area, worktreePath)}`,
    `  4. Retry the dry-run integration preflight: px integrate ${slug} --dry-run`
  ];
}
