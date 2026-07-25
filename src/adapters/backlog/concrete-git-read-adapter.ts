import type { RepositoryId } from '../../domain/repository.js';
import { repositoryId } from '../../domain/repository.js';
import type { GitReadAdapter } from '../../application/projections/board-readers.js';
import { git } from '../../platform/runtime/lib/core/git.js';

// ---------------------------------------------------------------------------
// Git runner type
// ---------------------------------------------------------------------------

interface GitRunner {
  (_args: string[], _options?: { cwd?: string }): { status: number | null; stdout: string; stderr: string };
}

// ---------------------------------------------------------------------------
// Defaults — static imports (no circular deps)
// ---------------------------------------------------------------------------

function defaultGitRunner(): GitRunner {
  return git as GitRunner;
}

// ---------------------------------------------------------------------------
// Concrete GitReadAdapter
// ---------------------------------------------------------------------------

export interface ConcreteGitReadAdapterOptions {
  readonly rootDir: string;
  /** Git CLI runner. */
  readonly gitRunner?: GitRunner;
  /** Optional: override repository id (falls back to git config / dirname). */
  readonly repositoryId?: RepositoryId;
}

/**
 * Concrete `GitReadAdapter` that supplies repository identity and HEAD commit
 * for staleness checking.
 *
 * Reads from Git directly — no caching. Repository identity comes from
 * `git config --get remote.origin.url` or falls back to the directory name.
 */
export class ConcreteGitReadAdapter implements GitReadAdapter {
  private readonly rootDir: string;
  private readonly gitRunner: GitRunner;
  private readonly repositoryIdOverride?: RepositoryId;

  constructor(options: ConcreteGitReadAdapterOptions) {
    this.rootDir = options.rootDir;
    this.gitRunner = options.gitRunner ?? defaultGitRunner();
    this.repositoryIdOverride = options.repositoryId;
  }

  // -----------------------------------------------------------------------
  // GitReadAdapter port
  // -----------------------------------------------------------------------

  async loadRepositoryId(): Promise<RepositoryId> {
    if (this.repositoryIdOverride) {
      return this.repositoryIdOverride;
    }

    // Try git config for remote origin URL
    try {
      const result = this.gitRunner(
        ['-C', this.rootDir, 'config', '--get', 'remote.origin.url'],
        { cwd: this.rootDir },
      );
      if (result.status === 0 && result.stdout.trim()) {
        const url = result.stdout.trim();
        // Extract repo name from URL (e.g., "parallix" from "git@github.com:user/parallix.git")
        const name = this.extractRepoName(url);
        if (name) {
          return repositoryId(name);
        }
      }
    } catch {
      // fall through
    }

    // Fallback: use directory name
    const { basename } = await import('node:path');
    return repositoryId(basename(this.rootDir));
  }

  async loadHeadCommit(): Promise<string> {
    const result = this.gitRunner(
      ['-C', this.rootDir, 'rev-parse', 'HEAD'],
      { cwd: this.rootDir },
    );
    if (result.status === 0 && result.stdout.trim()) {
      return result.stdout.trim();
    }
    return '';
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  private extractRepoName(url: string): string | null {
    // Handle git@host:user/repo.git → repo
    const sshMatch = url.match(/[^/:]+\/([^/]+?)(?:\.git)?$/);
    if (sshMatch) {
      return sshMatch[1] || null;
    }

    // Handle https://host/user/repo.git → repo
    const httpsMatch = url.match(/\/([^/]+?)(?:\.git)?$/);
    if (httpsMatch) {
      return httpsMatch[1] || null;
    }

    return null;
  }
}
