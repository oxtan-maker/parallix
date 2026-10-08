import { git as defaultGit } from './git.js';
import type { ChangeIdentityPort } from '../../application/approval-coverage.js';
import { BOOKKEEPING_TRAILER, isBookkeepingKind } from '../../domain/approval-coverage.js';

type GitFn = (_args: string[], _options?: Record<string, unknown>) => { status: number | null; stdout: string };

/**
 * Lifecycle bookkeeping the product commits onto a mission branch after review
 * (Backlog status transitions).  It never changes what the reviewer approved.
 */
const LIFECYCLE_PATHS = [':(exclude)backlog'];

/**
 * Git-backed change identity (TASK-2555).  A revision's identity is the stable
 * patch id of the change it would land: its diff from the merge base with the
 * target branch, without context lines and without lifecycle bookkeeping.  A
 * clean rebase replays the same change and keeps its identity; a rebase that
 * resolves conflicts differently, a re-scope or a repair produces a new one.
 */
export interface GitChangeIdentity extends ChangeIdentityPort {
  /**
   * Start a new read: the next branch lookup re-reads every local branch head
   * with one git call and answers all lookups of this read from that snapshot.
   * Only meaningful with `snapshotBranchHeads`.
   */
  beginRead(): void;
}

export interface GitChangeIdentityOptions {
  /**
   * Resolve branch heads (and the merge bases that depend on them) from one
   * snapshot per `beginRead()` instead of one git call per lookup. Callers
   * that cannot mark read boundaries must leave this off, or they would keep
   * answering from a branch head that has since moved.
   */
  readonly snapshotBranchHeads?: boolean;
}

export function createGitChangeIdentity(
  root: string,
  gitFn: GitFn = defaultGit as GitFn,
  options: GitChangeIdentityOptions = {},
): GitChangeIdentity {
  const text = (args: string[], options: Record<string, unknown> = {}): string | null => {
    try {
      const result = gitFn(['-C', root, ...args], options);
      return result.status === 0 ? result.stdout.trim() : null;
    } catch {
      return null;
    }
  };
  // A commit's content, ancestry, trailers and patch id never change, so the
  // answers derived from commit ids alone are memoized (the board asks about
  // every open mission on every refresh). Only positive answers are kept: an
  // absent commit or a failed git call may succeed on a later read. Anything
  // that depends on a moving ref (a branch head, the merge base with a target)
  // is still read from git on every call.
  const memo = createBoundedMemo();
  const commit = (revision: string): string | null => {
    if (!/^[0-9a-f]{7,64}$/i.test(revision)) { return null; }
    return memo(`commit\0${revision}`, () => text(['rev-parse', '--verify', '--quiet', `${revision}^{commit}`]) || null);
  };

  let heads: ReadonlyMap<string, string> | null = null;
  const headOf = (branch: string): string | null => {
    if (options.snapshotBranchHeads !== true) {
      return text(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]);
    }
    if (heads === null) {
      const listing = text(['for-each-ref', '--format=%(objectname) %(refname)', 'refs/heads']);
      if (listing === null) { return text(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]); }
      heads = new Map(listing.split('\n').flatMap((line) => {
        const [sha, ref] = line.split(' ');
        return sha && ref ? [[ref, sha] as const] : [];
      }));
    }
    return heads.get(`refs/heads/${branch}`) ?? null;
  };
  const mergeBase = (target: string, sha: string): string | null => {
    const tip = options.snapshotBranchHeads === true ? headOf(target) : null;
    return tip === null
      ? text(['merge-base', target, sha])
      : memo(`merge-base\0${tip}\0${sha}`, () => text(['merge-base', target, sha]) || null);
  };

  return {
    beginRead: () => { heads = null; },
    branchHead: (branch) => commit(headOf(branch) ?? ''),
    changeIdentity: (revision, target) => {
      const sha = commit(revision);
      const base = sha ? mergeBase(target, sha) : null;
      if (!sha || !base) { return null; }
      return memo(`identity\0${base}\0${sha}`, () => {
        const diff = text(['diff', '--binary', '--unified=0', base, sha, '--', '.', ...LIFECYCLE_PATHS]);
        if (diff === null) { return null; }
        if (!diff) { return 'empty-change'; }
        const id = text(['patch-id', '--stable'], { input: `${diff}\n`, stdio: ['pipe', 'pipe', 'pipe'] });
        return id ? id.split(/\s+/)[0] : null;
      });
    },
    onlyBookkeepingSince: (from, to) => {
      const start = commit(from);
      const end = commit(to);
      if (!start || !end) { return null; }
      return memo(`bookkeeping\0${start}\0${end}`, () => {
        if (text(['merge-base', '--is-ancestor', start, end]) === null) { return false; }
        const trailers = text(['log', `--format=%(trailers:key=${BOOKKEEPING_TRAILER},valueonly,separator=%x2C)%x00`, `${start}..${end}`]);
        if (trailers === null) { return null; }
        // One NUL-terminated trailer value per commit; the text after the last
        // terminator is not a commit. A commit without the trailer is real work.
        const perCommit = trailers.split('\0');
        perCommit.pop();
        return perCommit.every((value) => isBookkeepingKind(value));
      });
    },
  };
}

const MEMO_LIMIT = 1024;

/** A size-bounded memo that never stores `null`. */
function createBoundedMemo() {
  const entries = new Map<string, string | boolean>();
  return <T extends string | boolean>(key: string, compute: () => T | null): T | null => {
    const hit = entries.get(key);
    if (hit !== undefined) { return hit as T; }
    const value = compute();
    if (value !== null) {
      if (entries.size >= MEMO_LIMIT) { entries.clear(); }
      entries.set(key, value);
    }
    return value;
  };
}
