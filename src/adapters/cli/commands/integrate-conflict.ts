import type { GitReader } from '../../git/worktree.js';
import { AGENT_COMMAND_COMPLETION_CONTRACT } from '../../../application/agent-completion-contract.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { detectRebaseState, git } from '../../git/git.js';
import { parseUnmergedFiles } from '../../git/unmerged-paths.js';
import * as fmt from '../../../application/presentation/cli-format.js';
import { resolveWorktree, getConflictFiles, getPrimaryWorktree, getPrimaryBranch, conventionalWorktreePath, missionBranchName, isMissionArtifact, resolveMissionBaseBranch } from '../../filesystem/mission-utils.js';
import * as verification from '../../verification/verification.js';
import { IntegrationAbort, shellQuote } from './integrate-post.js';
import { integrationStashMarker } from '../../../application/integrate/base-worktree-repair.js';
import { findResponsibleStash, pausedRebaseGuidance, quoteShellWord, receivingCheckoutLine, stashCleanupGuidance, unresolvedIndexGuidance } from '../../../application/integrate/checkout-recovery-guidance.js';
import type { IntegrationStash } from '../../../application/ports/integration-records.js';
import { isLandedSquashMessage, parseCommitMessageRecords } from './landed-squash.js';

export { findExistingSquashCommit, findLandedSquashOnBaseBranch, isLandedSquashMessage, parseCommitMessageRecords } from './landed-squash.js';

const { formatVerificationCommand } = verification;

/** @param {string} rootDir @param {{gitRunner?: GitReader, tmpDir?: string}} opts */
export function prepareNoisePatchForSquash(rootDir: string, opts: {gitRunner?: GitReader, tmpDir?: string} = {}) {
  const runner = opts.gitRunner || git;
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

/** @param {string} rootDir @param {string|null} patchPath @param {{gitRunner?: GitReader}} opts */
export function restoreNoisePatchAfterSquash(rootDir: string, patchPath: string | null, opts: {gitRunner?: GitReader} = {}) {
  if (!patchPath) {return { ok: true };}
  const runner = opts.gitRunner || git;
  const applyResult = runner(['-C', rootDir, 'apply', '--index', patchPath]);
  if (applyResult.status !== 0) {
    return {
      ok: false,
      error: [applyResult.stdout, applyResult.stderr].filter(Boolean).join('\n').trim() || 'Could not re-apply backlog-noise patch after squash merge.'
    };
  }
  return { ok: true };
}

/** @param {string} rootDir @param {{gitRunner?: GitReader}} opts */
export function getUnresolvedIndexConflicts(rootDir = getPrimaryWorktree(), opts: {gitRunner?: GitReader} = {}) {
  const runner = opts.gitRunner || git;
  const result = runner(['-C', rootDir, 'ls-files', '-u', '-z']);
  if (result.status !== 0) {
    return {
      ok: false,
      files: [],
      error: [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
    };
  }

  return {
    ok: true,
    files: parseUnmergedFiles(result.stdout)
  };
}

/**
 * Check if all conflict files are under the backlog/ directory.
 * Uses the same noise-path pattern as softResetTrailingBacklogNoise and
 * findLastNonNoiseCommit. An empty list is treated as backlog-only
 * (no conflicts to classify).
 *
 * @param {string[]} conflictFiles - Relative paths from the unmerged Git index
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

/** The stash entry proven responsible by object identity and marker, or null when ownership is unknown. */
function responsibleStash(runner: GitReader, rootDir: string, expected: {objectId?: string; marker?: string}) {
  if (!expected.marker) { return null; }
  const list = runner(['-C', rootDir, 'stash', 'list', '--format=%gd%x00%H%x00%gs']);
  return list.status === 0 ? findResponsibleStash(list.stdout, { objectId: expected.objectId, marker: expected.marker }) : null;
}

function reportReadableStashRestoreFailure({
  rootDir,
  indexConflictFiles,
  collisionFiles,
  stash,
  detectRebaseStateFn,
  report
}: {
  rootDir: string;
  indexConflictFiles: string[];
  collisionFiles: string[];
  stash: ReturnType<typeof responsibleStash>;
  detectRebaseStateFn: typeof detectRebaseState;
  report: (line: string) => void;
}) {
  if (indexConflictFiles.length > 0) {
    report('Stash restore failure type: merge-conflict (unmerged index entries)');
    indexConflictFiles.forEach((file: string) => report(`Collision file: ${file}`));
    const rebaseMetadata = Boolean(detectRebaseStateFn(rootDir).rebaseDir);
    unresolvedIndexGuidance(rootDir, indexConflictFiles, { rebaseMetadata }).forEach(report);
    if (rebaseMetadata) { pausedRebaseGuidance(rootDir).forEach(report); }
  } else {
    report('Stash restore failure type: file-collision');
    collisionFiles.forEach((file: string) => report(`Collision file: ${file}`));
    report('Move each colliding file aside only after confirming it holds the landed content:');
    collisionFiles.forEach((file: string) => {
      report(`  mv -- ${quoteShellWord(path.join(rootDir, file))} ${quoteShellWord(path.join(rootDir, `${file}.pre-stash-pop`))}`);
    });
    if (collisionFiles.length === 0) { report(`Inspect the stash-pop output below and the paths it names in ${rootDir}.`); }
    if (stash) {
      report('Then restore the verified stash:');
      report(`  git -C ${quoteShellWord(rootDir)} stash pop --index ${quoteShellWord(stash.ref)}`);
    }
  }
  stashCleanupGuidance(rootDir, stash).forEach(report);
}

/**
 * Report a failed stash restore after landing. Landing is claimed only from the
 * verified HEAD message and the stash only from its recorded object and marker.
 * @param {string} slug
 * @param {{stdout: string, stderr: string, status: number}} restoreResult
 * @param {{rootDir?: string, stash?: IntegrationStash, gitRunner?: GitReader, getUnresolvedIndexConflictsFn?: typeof getUnresolvedIndexConflicts}} opts
 */
export function reportStashPopFailure(slug: string, restoreResult: Pick<ReturnType<typeof git>, 'stdout' | 'stderr'>, opts: {rootDir?: string, stash?: IntegrationStash, gitRunner?: GitReader, getUnresolvedIndexConflictsFn?: typeof getUnresolvedIndexConflicts, detectRebaseStateFn?: typeof detectRebaseState} = {}) {
  const output = [restoreResult.stdout, restoreResult.stderr].filter(Boolean).join('\n').trim();
  const runner = opts.gitRunner || git;
  const rootDir = opts.rootDir || getPrimaryWorktree();
  const headResult = runner(['-C', rootDir, 'log', '-1', '--oneline']);
  const headLine = headResult.status === 0 ? headResult.stdout.trim() : '(unavailable)';
  // The landed-squash evidence lives in the full message: legacy commits
  // carry the `mission/<slug>:` subject prefix, TASK-2595 commits carry the
  // `Task: <slug>` body line. `--oneline` cannot show the body, so match on
  // the full message (TASK-2595).
  const headMessageResult = runner(['-C', rootDir, 'log', '-1', '--format=%x00%H%x00%B']);
  const headRecords = headMessageResult.status === 0 ? parseCommitMessageRecords(headMessageResult.stdout) : [];
  const integrationLanded = headRecords.some(record => isLandedSquashMessage(record.message, slug, rootDir));
  const indexConflicts = (opts.getUnresolvedIndexConflictsFn || getUnresolvedIndexConflicts)(rootDir);
  const collisionFiles = parseStashPopCollisionFiles(output);
  const stash = responsibleStash(runner, rootDir, { objectId: opts.stash?.objectId, marker: integrationStashMarker(slug) });
  const report = (line: string) => fmt.log.fail(`  ${line}`);

  fmt.log.fail('[RESTORE] Could not restore the temporarily stashed local integration checkout changes.');
  report(receivingCheckoutLine({ baseWorktree: rootDir, baseBranch: runner(['-C', rootDir, 'symbolic-ref', '--quiet', '--short', 'HEAD']).stdout.trim() || '(detached HEAD)' }));
  if (integrationLanded) {
    report(`Integration commit landed: ${headLine}`);
  } else {
    report(`Integration landing not confirmed by HEAD: ${headLine}`);
  }

  if (!indexConflicts.ok) {
    // Unresolved index state is unknown, so only read-only inspection is offered.
    report(`Stash restore failure type: index-unreadable (${indexConflicts.error || 'unknown error'})`);
    report('Inspect without changing anything; no recovery command is suggested until the index can be read:');
    report(`  git -C ${quoteShellWord(rootDir)} status --short`);
    report(`  git -C ${quoteShellWord(rootDir)} stash list`);
    appendRawOutput(output);
    return;
  }
  reportReadableStashRestoreFailure({
    rootDir,
    indexConflictFiles: indexConflicts.files,
    collisionFiles,
    stash,
    detectRebaseStateFn: opts.detectRebaseStateFn || detectRebaseState,
    report
  });
  appendRawOutput(output);
}

function appendRawOutput(output: string) {
  if (!output) { return; }
  fmt.log.fail('  Raw stash pop output:');
  output.split('\n').forEach((line: string) => fmt.log.fail(`    ${line}`));
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

function currentStashObject(runner: GitReader, rootDir: string): string | undefined {
  const top = runner(['-C', rootDir, 'rev-parse', '--verify', '-q', 'refs/stash']);
  const objectId = top.status === 0 ? top.stdout.trim() : '';
  return objectId || undefined;
}

/** Object id created by this push, only when it is new and its subject carries this run's marker. */
function verifiedStashObject(runner: GitReader, rootDir: string, marker: string, previousObjectId?: string): {objectId?: string} {
  const objectId = currentStashObject(runner, rootDir);
  if (!objectId || objectId === previousObjectId) { return {}; }
  const subject = runner(['-C', rootDir, 'log', '-1', '--format=%s', 'refs/stash']);
  return subject.status === 0 && subject.stdout.trim().endsWith(marker) ? { objectId } : {};
}

/** @param{{slug: string, dirtyEntries?: string[], rootDir?: string, gitRunner?: GitReader}} params */
export function stashMainCheckoutIfNeeded({
  slug,
  dirtyEntries = [],
  rootDir = getPrimaryWorktree(),
  gitRunner = git
}: {slug: string, dirtyEntries?: string[], rootDir?: string, gitRunner?: GitReader}) {
  if (dirtyEntries.length === 0) {
    return { created: false };
  }

  // Shared marker literal (see `integrationStashMarker`): the base-worktree
  // sweep matches against this exact string, so the push and the sweep can't
  // disagree on the identifier.
  const message = integrationStashMarker(slug);
  const previousObjectId = currentStashObject(gitRunner, rootDir);
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
    rootDir,
    ...verifiedStashObject(gitRunner, rootDir, message, previousObjectId)
  };
}

/**
 * Restore only the recorded integration stash: its reference is re-resolved by object identity and
 * marker, so an unrelated stash pushed above it is never applied or deleted. Without a verified
 * owner nothing is popped and every stash is retained for the failure report.
 * @param{{message?: string, objectId?: string, rootDir?: string, gitRunner?: GitReader}} params
 */
export function restoreMainCheckoutStash({ message, objectId, rootDir = getPrimaryWorktree(), gitRunner = git }: {message?: string, objectId?: string, rootDir?: string, gitRunner?: GitReader}) {
  fmt.log.info(`[RESTORE] Restoring temporarily stashed local integration checkout changes: ${message}`);
  const list = gitRunner(['-C', rootDir, 'stash', 'list', '--format=%gd%x00%H%x00%gs'], { cwd: rootDir });
  const owned = list.status === 0 && message ? findResponsibleStash(list.stdout, { objectId, marker: message }) : null;
  if (!owned) {
    return { status: 1, signal: null, stdout: '', stderr: 'Integration stash identity could not be verified; no stash was applied and every stash was retained.' };
  }
  // Use --index for safer restore semantics: git attempts to reinstage the index
  // changes from the stash alongside the working-tree changes. Collisions are
  // left as merge conflicts rather than silently overwriting files.
  // Pass cwd explicitly so spawnSync does not inherit the process cwd, which may have been
  // deleted by worktree cleanup earlier in the same integrate run.
  return gitRunner(['-C', rootDir, 'stash', 'pop', '--index', owned.ref], { cwd: rootDir });
}

/**
 * Decide whether a failed `git stash pop --index` can be resolved by simply
 * dropping the temporary stash. The outcome is benign when it is a pure
 * file-collision: a stashed *untracked* file could not be restored because it
 * now already exists on disk (it was committed by the landed squash merge, so
 * it is tracked and its content is intact). Nothing is dropped unless the
 * recorded stash identity and at least one such collision are proven; an index
 * that cannot be scanned, unmerged entries, a missing colliding file or an
 * unidentified stash leave data at stake and the caller must surface the failure.
 *
 * @returns {{ok: true, ref: string} | null} a drop token when safe to drop,
 *   or null when the failure needs a human.
 */
export function maybeDropStashAfterCollision(
  restoreResult: {stdout: string, stderr: string, status: number | null},
  rootDir: string,
  opts: {gitRunner?: GitReader, expectedObjectId?: string, marker?: string} = {}
): {ok: true, ref: string} | null {
  const runner = opts.gitRunner || git;
  const output = [restoreResult.stdout, restoreResult.stderr].filter(Boolean).join('\n');

  // Unmerged index entries mean a real merge conflict that needs resolution.
  const conflicts = getUnresolvedIndexConflicts(rootDir, {gitRunner: runner});
  if (!conflicts.ok || conflicts.files.length > 0) {
    return null;
  }

  // Every file git refused to checkout because it already exists must in fact
  // exist on disk for the data to be preserved. A collision file that is
  // missing would mean the stash could not be recovered at all.
  const collisionFiles = parseStashPopCollisionFiles(output);
  const missing = collisionFiles.filter((file: string) => !fs.existsSync(path.join(rootDir, file)));
  // An arbitrary failure with no parsed collision proves nothing benign, so the stash is kept.
  if (collisionFiles.length === 0 || missing.length > 0) {
    return null;
  }

  // Resolve the recorded object and marker to its current ref, then guard that same ref again
  // immediately before dropping it so a shifted reference cannot delete an unrelated stash.
  const owned = responsibleStash(runner, rootDir, { objectId: opts.expectedObjectId, marker: opts.marker });
  if (!owned || runner(['-C', rootDir, 'rev-parse', '--verify', '-q', owned.ref]).stdout.trim() !== owned.objectId) {
    return null;
  }

  const drop = runner(['-C', rootDir, 'stash', 'drop', owned.ref]);
  if (drop.status !== 0) {
    return null;
  }
  return { ok: true, ref: owned.ref };
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
/** Unmerged files of a paused rebase, or null when Git state has none to report. */
function pausedRebaseConflicts(worktreePath: string, overridden: boolean): string[] | null {
  const paused = overridden ? null : detectRebaseState(worktreePath);
  return paused?.inProgress || paused?.unmergedFiles.length ? paused.unmergedFiles : null;
}

/**
 * @param {string} slug
 * @param {string} area
 * @param{{getConflictFilesFn: Function, resolveWorktreeFn?: Function, worktreePathOverride?: string|null, rootDir?: string, baseBranch?: string|null}} options
 */
export function resolveConflictsForMission(slug: string, area: string, { getConflictFilesFn, resolveWorktreeFn = resolveWorktree, worktreePathOverride = null, rootDir = getPrimaryWorktree(), baseBranch = null }: { getConflictFilesFn?: typeof getConflictFiles; resolveWorktreeFn?: typeof resolveWorktree; worktreePathOverride?: string | null; rootDir?: string; baseBranch?: string | null } = {}) {
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
  const targetBranch = conflictTargetBranch(slug, rootDir, baseBranch);

  const detectFn = getConflictFilesFn || (() => getConflictFiles(worktreePath, targetBranch));

  if (!fs.existsSync(worktreePath)) {
    fmt.log.fail(`Mission worktree not found: ${worktreePath}`);
    fmt.log.info(`Expected path: ${worktreePath}`);
    return { ok: false, error: 'worktree-missing', conflictFiles: [], sharedFiles: [], missionSpecificFiles: [], worktreePath };
  }

  fmt.log.info(`Detecting conflicts in ${worktreePath} against ${targetBranch}...`);
  let conflictFiles;
  try {
    conflictFiles = pausedRebaseConflicts(worktreePath, Boolean(getConflictFilesFn)) ?? detectFn(worktreePath, targetBranch);
  } catch (err) {
    fmt.log.fail('Merge check failed with a non-conflict error:');
    fmt.log.fail((err as Error).message);
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
  fmt.log.info(AGENT_COMMAND_COMPLETION_CONTRACT);

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
    AGENT_COMMAND_COMPLETION_CONTRACT,
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

function conflictTargetBranch(slug: string, rootDir: string, baseBranch: string | null): string {
  let targetBranch = /** @type {string} */ (baseBranch || getPrimaryBranch());
  if (!targetBranch) {
    try { targetBranch = resolveMissionBaseBranch(slug, rootDir); } catch (_) { targetBranch = getPrimaryBranch(); }
  }
  return targetBranch;
}
