import { BOOKKEEPING_TRAILER } from '../../domain/approval-coverage.js';
import { isVerificationBookkeeping } from '../../domain/integration-validation-policy.js';
import { git, type GitReader } from './git.js';

interface JsonManifest { version: unknown; packages?: Record<string, { version: unknown }>; [key: string]: unknown }
const manifest = (raw: string): JsonManifest => JSON.parse(raw) as JsonManifest;
const RELEASE_MANIFESTS = new Set(['package.json', 'package-lock.json']);
const REVISION = /^[a-f0-9]{40,64}$/;

/** Exactly the hook's root version fields; formatting, dependencies and every other byte stay substantive. */
export function releaseVersionOnly(before: string, after: string, filePath: string): boolean {
  try {
    const old = manifest(before), next = manifest(after);
    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(old.version));
    if (!match || next.version !== `${match[1]}.${match[2]}.${Number(match[3]) + 1}`) { return false; }
    const version = next.version;
    next.version = old.version;
    if (filePath === 'package-lock.json' && next.packages?.['']) {
      if (next.packages[''].version !== version || old.packages?.['']?.version !== old.version) { return false; }
      next.packages[''].version = old.version;
    }
    return JSON.stringify(next) === JSON.stringify(old)
      && after === `${JSON.stringify(manifest(after), null, 2)}\n`
      && before === `${JSON.stringify(old, null, 2)}\n`;
  } catch { return false; }
}

function read(root: string, args: string[], gitRunner: GitReader): string | null {
  try {
    const result = gitRunner(['-C', root, ...args]);
    return result.status === 0 ? result.stdout : null;
  } catch { return null; }
}

function changedPaths(root: string, from: string, to: string, gitRunner: GitReader): string[] | null {
  const output = read(root, ['diff', '--name-only', '--no-renames', '-z', from, to, '--'], gitRunner);
  return output === null ? null : output.split('\0').filter(Boolean);
}

function verifiedVersionCommit(root: string, commit: string, gitRunner: GitReader): boolean {
  const parents = read(root, ['show', '-s', '--format=%P', commit], gitRunner)?.trim().split(/\s+/).filter(Boolean);
  if (parents?.length !== 1) { return false; }
  const paths = changedPaths(root, parents[0], commit, gitRunner);
  if (!paths || paths.some(file => !isVerificationBookkeeping(file) && !RELEASE_MANIFESTS.has(file))) { return false; }
  const releasePaths = paths.filter(file => RELEASE_MANIFESTS.has(file));
  if (releasePaths.length === 0) { return paths.every(isVerificationBookkeeping); }
  const trailer = read(root, ['show', '-s', `--format=%(trailers:key=${BOOKKEEPING_TRAILER},valueonly)`, commit], gitRunner)?.trim();
  if (trailer !== 'pre-commit-hook') { return false; }
  return releasePaths.every(file => {
    const before = read(root, ['show', `${parents[0]}:${file}`], gitRunner);
    const after = read(root, ['show', `${commit}:${file}`], gitRunner);
    return before !== null && after !== null && releaseVersionOnly(before, after, file);
  });
}

/**
 * Whether `to` is `from` plus only verification-neutral repository movement:
 * Backlog task records and genuine, tagged patch-version hook commits. The
 * common same-revision path performs no Git read; Backlog-only and obviously
 * substantive paths stop after one diff. Manifest contents and trailers are
 * read only for the narrow release-hook candidate.
 */
export function verificationEquivalentRevision(
  root: string,
  from: string,
  to: string,
  gitRunner: GitReader = git,
): boolean {
  if (from === to) { return REVISION.test(from); }
  if (!REVISION.test(from) || !REVISION.test(to)) { return false; }
  const paths = changedPaths(root, from, to, gitRunner);
  if (!paths) { return false; }
  if (paths.every(isVerificationBookkeeping)) { return true; }
  if (paths.some(file => !isVerificationBookkeeping(file) && !RELEASE_MANIFESTS.has(file))) { return false; }
  const ancestry = read(root, ['merge-base', '--is-ancestor', from, to], gitRunner);
  if (ancestry === null) { return false; }
  const revisions = read(root, ['rev-list', '--reverse', `${from}..${to}`], gitRunner)?.trim().split('\n').filter(Boolean);
  return Boolean(revisions?.length) && revisions!.every(commit => verifiedVersionCommit(root, commit, gitRunner));
}
