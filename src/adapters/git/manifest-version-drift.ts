import { git } from './git.js';

// Manifest files the post-integrate self-update hook (scripts/refresh-global-px.sh)
// bumps on every successful non-dry-run integrate. A mission branch branched at
// an older version therefore drifts against the advancing `main` version, and the
// probe/squash merge conflicts purely on the version number — not real content.
// This is a known, auto-mergeable drift: resolve by taking the newer version.
//
// Kept dependency-free (git only) so it can be unit-tested without pulling in
// the integrate command graph, whose circular imports make direct import crash.
export const MANIFEST_VERSION_FILES = ['package.json', 'package-lock.json'];

/** @param {string[]} conflictFiles */
export function isManifestVersionOnlyConflict(conflictFiles: string[]): boolean {
  if (conflictFiles.length === 0) { return false; }
  return conflictFiles.every((f) => MANIFEST_VERSION_FILES.includes(f));
}

/**
 * Resolve a merge conflict on a manifest version file by taking the newer of the
 * two staged versions. Reads stages 2 (ours/main) and 3 (theirs/branch) from the
 * merge index, compares the `version` field, and stages the newer one.
 *
 * @param {string} baseWorktree
 * @param {{ gitRunner?: typeof git }} [options]
 * @returns {boolean} true if every conflicting manifest file was resolved
 */
export function resolveManifestVersionDrift(baseWorktree: string, options: { gitRunner?: typeof git } = {}): boolean {
  const runner = options.gitRunner || git;
  const conflictList = runner(['-C', baseWorktree, 'diff', '--name-only', '--diff-filter=U', '--', ...MANIFEST_VERSION_FILES]);
  if (conflictList.status !== 0) { return false; }
  const files = conflictList.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  if (files.length === 0) { return true; }
  let allResolved = true;
  for (const file of files) {
    const oursContent = readStagedContent(baseWorktree, runner, file, 2);
    const theirsContent = readStagedContent(baseWorktree, runner, file, 3);
    const ours = parseVersion(oursContent);
    const theirs = parseVersion(theirsContent);
    // Fail closed unless the conflict is PURELY the version field: normalise away
    // every "version": "..." occurrence and require the two sides to be byte-identical
    // otherwise. This stops a real content change in the manifest (e.g. a dependency
    // a mission added) from being silently dropped in favour of main's version bump.
    if (oursContent === null || theirsContent === null) { allResolved = false; continue; }
    if (!isPureVersionConflict(oursContent, theirsContent)) { allResolved = false; continue; }
    // Prefer ours (main's advancing version) when either side is unreadable or
    // versions are equal; only take theirs when it is strictly newer.
    const takeTheirs = ours !== null && theirs !== null && compareVersions(theirs, ours) > 0;
    const side = takeTheirs ? '--theirs' : '--ours';
    const checkout = runner(['-C', baseWorktree, 'checkout', side, '--', file]);
    const add = runner(['-C', baseWorktree, 'add', '--', file]);
    if (checkout.status !== 0 || add.status !== 0) { allResolved = false; }
  }
  return allResolved;
}

/** @param {string} baseWorktree @param {typeof git} runner @param {string} file @param {number} stage */
function readStagedContent(baseWorktree: string, runner: typeof git, file: string, stage: number): string | null {
  const shown = runner(['-C', baseWorktree, 'show', `:${stage}:${file}`]);
  return shown.status === 0 ? shown.stdout : null;
}

/** @param {string | null} content */
function parseVersion(content: string | null): string | null {
  if (content === null) { return null; }
  try {
    const parsed = JSON.parse(content);
    return typeof parsed.version === 'string' ? parsed.version : null;
  } catch {
    return null;
  }
}

/**
 * True when `a` and `b` differ only in their "version": "..." string fields.
 * Handles package-lock.json, which carries the version in several places.
 * @param {string} a @param {string} b
 */
function isPureVersionConflict(a: string, b: string): boolean {
  const norm = (s: string) => s.replace(/"version"\s*:\s*"[^"]*"/g, '"__VERSION__"');
  return norm(a) === norm(b);
}

/** @param {string} a @param {string} b returns >0 if a>b, <0 if a<b, 0 if equal */
function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) { return diff; }
  }
  return 0;
}
