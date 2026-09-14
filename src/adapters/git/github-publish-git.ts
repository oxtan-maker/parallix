/** Concrete github-publish git port over a working directory.

 * The `GithubPublishGitPort` contract is application-owned; this module is the
 * git-adapter implementation, so it may import the shared `git` runner and the
 * application port interface. See docs/adr/0058-github-publish-mode.md.
 */
import { git, type GitResult } from './git.js';
import type { GithubPublishGitPort } from '../../application/github-publish/publication-engine.js';

export class GitRepositoryPort implements GithubPublishGitPort {
  constructor(private readonly _rootDir: string, private readonly _git: typeof git = git) {}

  private run(args: string[]): GitResult {
    return this._git(['-C', this._rootDir, ...args]);
  }

  revParse(ref: string): string | null {
    const r = this.run(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
    const out = r.stdout.trim();
    return r.status === 0 && /^[0-9a-f]{40}$/i.test(out) ? out.toLowerCase() : null;
  }

  aheadCommits(base: string, head: string): string[] {
    const r = this.run(['log', '--format=%H', `${base}..${head}`]);
    if (r.status !== 0) {return [];}
    return r.stdout.split('\n').map(l => l.trim()).filter(Boolean).reverse().map(l => l.toLowerCase());
  }

  push(remote: string, sha: string, ref: string): { ok: boolean; error?: string } {
    const r = this.run(['push', remote, `${sha}:${ref}`]);
    return r.status === 0 ? { ok: true } : { ok: false, error: (r.stderr || r.stdout || 'push failed').trim() };
  }

  isDescendant(ancestor: string, descendant: string): boolean {
    const r = this.run(['merge-base', '--is-ancestor', ancestor, descendant]);
    return r.status === 0;
  }

  fastForward(ref: string, target: string): { ok: boolean; error?: string } {
    const r = this.run(['update-ref', `refs/heads/${ref}`, target]);
    return r.status === 0 ? { ok: true } : { ok: false, error: (r.stderr || r.stdout || 'update-ref failed').trim() };
  }

  updateRemoteTrackingRef(remote: string, ref: string, target: string): { ok: boolean; error?: string } {
    const r = this.run(['update-ref', `refs/remotes/${remote}/${ref}`, target]);
    return r.status === 0 ? { ok: true } : { ok: false, error: (r.stderr || r.stdout || 'update remote ref failed').trim() };
  }

  fetch(remote: string): { ok: boolean; error?: string } {
    const r = this.run(['fetch', remote]);
    return r.status === 0 ? { ok: true } : { ok: false, error: (r.stderr || r.stdout || 'fetch failed').trim() };
  }

  resolveRemoteRef(remote: string, ref: string): string | null {
    const r = this.run(['ls-remote', '--exit-code', '--refs', remote, ref]);
    const match = r.stdout.match(/^[0-9a-f]{40}\s+refs\//);
    return r.status === 0 && match ? match[0].slice(0, 40).toLowerCase() : null;
  }
}
