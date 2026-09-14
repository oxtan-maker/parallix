/** Composition wiring for the github-publish operator status command.

 * Composition owns adapter binding: it resolves product config, builds the
 * git-adapter port implementation, and hands them to the application-owned
 * `GithubPublishStatusUseCase`. See docs/adr/0058-github-publish-mode.md.
 */
import { git } from '../adapters/git/git.js';
import { GitRepositoryPort } from '../adapters/git/github-publish-git.js';
import { resolveGithubPublishConfig } from '../adapters/config/product-config.js';
import { GithubPublishStatusUseCase, RefExistenceOracle } from '../application/github-publish/status-command-use-case.js';
import type { VerificationOracle } from '../application/github-publish/publication-engine.js';

/** Build the github-publish status use case with its git-port and config wired. */
export function createGithubPublishStatusUseCase(rootDir: string = process.cwd()): GithubPublishStatusUseCase {
  return new GithubPublishStatusUseCase({
    gitPort: new GitRepositoryPort(rootDir, git),
    config: resolveGithubPublishConfig(rootDir),
  });
}

/** Operator status for the github-publish mode. When the mode is disabled
 * (default) it reports `enabled: false` without touching git. */
export async function githubPublishStatus(
  rootDir: string = process.cwd(),
  oracle: VerificationOracle = new RefExistenceOracle(),
): Promise<ReturnType<GithubPublishStatusUseCase['execute']>> {
  return createGithubPublishStatusUseCase(rootDir).execute(oracle);
}
