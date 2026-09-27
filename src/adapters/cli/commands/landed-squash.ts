// Landed-squash detection: recognises a mission's squash commit on HEAD or on
// its recorded base branch, in both the legacy and TASK-2595 message shapes.
import { git } from '../../git/git.js';
import { missionBranchName, resolveMissionBaseBranch } from '../../filesystem/mission-utils.js';

/** @param {string} rootDir @param {string} slug */
export function findExistingSquashCommit(rootDir: string, slug: string) {
  const result = git(['-C', rootDir, 'log', '--format=%x00%H%x00%B', '-50']);
  if (result.status !== 0) {return null;}
  for (const record of parseCommitMessageRecords(result.stdout)) {
    if (isLandedSquashMessage(record.message, slug, rootDir)) {return record.hash;}
  }
  return null;
}

/**
 * Parse `git log --format=%x00%H%x00%B` output into per-commit records. Each
 * record starts with a NUL, so the split tokens strictly alternate
 * (hash, full raw message) after the leading empty token; git's trailing
 * record newline lands at the end of the message and is harmless to the
 * line-based matchers. Commit messages never contain NUL, so the record
 * delimiters are unambiguous for any hash length.
 *
 * @param {string} stdout
 * @returns {Array<{hash: string, message: string}>} records in `git log`
 * order (newest first)
 */
export function parseCommitMessageRecords(stdout: string): Array<{ hash: string, message: string }> {
  const tokens = stdout.split('\0');
  const records: Array<{ hash: string, message: string }> = [];
  for (let i = 1; i + 1 < tokens.length; i += 2) {
    records.push({ hash: tokens[i], message: tokens[i + 1] });
  }
  return records;
}

/**
 * Whether a commit message is the landed squash of `slug` (TASK-2595).
 *
 * The current shape is subject = recorded mission title with the body line
 * `Task: <slug>`; history predating TASK-2595 carries the subject prefix
 * `mission/<slug>:`. Both are durable evidence of the same landing, so every
 * landed-squash detector must accept either — existing commits on base
 * branches keep the old shape and are never rewritten.
 *
 * @param {string} message the full commit message (subject + body)
 * @param {string} slug
 * @param {string} rootDir resolves the mission branch prefix for the legacy shape
 */
export function isLandedSquashMessage(message: string, slug: string, rootDir: string): boolean {
  if (message.startsWith(`${missionBranchName(slug, rootDir)}:`)) {return true;}
  return message.split('\n').some(line => line === `Task: ${slug}`);
}

/**
 * Detect a landed mission squash by scanning the *recorded base branch* rather
 * than the current HEAD. `px integrate` lands with `git merge --squash` onto
 * the base branch, so the squash commit lives on the base branch and is never
 * reachable from a mission worktree's HEAD — the HEAD-scoped
 * `findExistingSquashCommit` returns null there. This is the base-branch-scoped
 * variant used by the SC4 landed-payload guards and the `--recover-landed`
 * closeout, both of which run from the mission worktree the operator stands in.
 *
 * @param {string} rootDir @param {string} slug
 * @returns {string | null} the landed squash commit hash, or null.
 */
export function findLandedSquashOnBaseBranch(rootDir: string, slug: string) {
  // The recorded base branch is the authority for this scan, but resolving it
  // can fail (no primary branch yet, unresolved worktree, mocked boundary in a
  // unit test). An unresolvable base cannot hold a detectable landed squash, so
  // any resolution failure falls through to null rather than aborting the
  // caller — the caller re-resolves the base for the actual rebase/merge.
  let base: string | null = null;
  try {
    base = resolveMissionBaseBranch(slug, rootDir);
  } catch (_) {
    base = null;
  }
  if (!base) {return null;}
  const baseRef = git(['-C', rootDir, 'rev-parse', '--verify', `${base}^{commit}`]);
  if (baseRef.status !== 0) {return null;}
  const log = git(['-C', rootDir, 'log', base, '--format=%x00%H%x00%B', '-200']);
  if (log.status !== 0) {return null;}
  for (const record of parseCommitMessageRecords(log.stdout)) {
    if (isLandedSquashMessage(record.message, slug, rootDir)) {return record.hash;}
  }
  return null;
}
