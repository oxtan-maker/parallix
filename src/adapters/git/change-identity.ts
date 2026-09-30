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
export function createGitChangeIdentity(root: string, gitFn: GitFn = defaultGit as GitFn): ChangeIdentityPort {
  const text = (args: string[], options: Record<string, unknown> = {}): string | null => {
    try {
      const result = gitFn(['-C', root, ...args], options);
      return result.status === 0 ? result.stdout.trim() : null;
    } catch {
      return null;
    }
  };
  const commit = (revision: string): string | null => (/^[0-9a-f]{7,64}$/i.test(revision)
    ? text(['rev-parse', '--verify', '--quiet', `${revision}^{commit}`]) || null
    : null);

  return {
    branchHead: (branch) => commit(text(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]) ?? ''),
    changeIdentity: (revision, target) => {
      const sha = commit(revision);
      const base = sha ? text(['merge-base', target, sha]) : null;
      if (!sha || !base) { return null; }
      const diff = text(['diff', '--binary', '--unified=0', base, sha, '--', '.', ...LIFECYCLE_PATHS]);
      if (diff === null) { return null; }
      if (!diff) { return 'empty-change'; }
      const id = text(['patch-id', '--stable'], { input: `${diff}\n`, stdio: ['pipe', 'pipe', 'pipe'] });
      return id ? id.split(/\s+/)[0] : null;
    },
    onlyBookkeepingSince: (from, to) => {
      const start = commit(from);
      const end = commit(to);
      if (!start || !end) { return null; }
      if (text(['merge-base', '--is-ancestor', start, end]) === null) { return false; }
      const trailers = text(['log', `--format=%(trailers:key=${BOOKKEEPING_TRAILER},valueonly,separator=%x2C)%x00`, `${start}..${end}`]);
      if (trailers === null) { return null; }
      // One NUL-terminated trailer value per commit; the text after the last
      // terminator is not a commit. A commit without the trailer is real work.
      const perCommit = trailers.split('\0');
      perCommit.pop();
      return perCommit.every((value) => isBookkeepingKind(value));
    },
  };
}
