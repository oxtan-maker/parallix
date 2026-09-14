/** CLI command for the github-publish publication engine status.

 * Additive operator surface; when the mode is disabled it prints a single
 * line and exits 0, leaving the default `px status` output untouched. The use
 * case is wired in composition; this file only renders it. See
 * docs/adr/0058-github-publish-mode.md.
 */
import * as fmt from '../../application/presentation/cli-format.js';
import type { GithubPublishStatusUseCase } from '../../application/github-publish/status-command-use-case.js';
import type { GithubPublishStatusResult } from '../../application/github-publish/status-command-use-case.js';

function short(sha: string): string {
  return sha.slice(0, 12);
}

/** Render github-publish status lines. */
export function renderGithubPublishStatus(result: GithubPublishStatusResult, log: (_msg: string) => void): void {
  if (!result.enabled) {
    log('github-publish: disabled (default squash-merge integration)');
    return;
  }
  log(fmt.bold('--- GitHub Publish Status ---'));
  log(`Local integration head: ${fmt.path(result.localHead ?? 'none')}`);
  log(`Published head (origin/main): ${fmt.path(result.publishedHead ?? 'none')}`);
  log(`Awaiting verification: ${result.awaitingVerification.length}`);
  for (const sha of result.awaitingVerification) { log(`  - ${short(sha)}`); }
  log(`Verified, blocked behind earlier mission: ${result.verifiedBlocked.length}`);
  for (const sha of result.verifiedBlocked) { log(`  - ${short(sha)}`); }
  log(`Failed verification: ${result.failed.length}`);
  for (const sha of result.failed) { log(`  - ${short(sha)}`); }
  if (result.publishableRun.length > 0) {
    log(`Ready to advance origin/main through: ${result.publishableRun.map(short).join(', ')}`);
  }
}

export interface GithubPublishStatusCommandOptions {
  readonly exitFn?: (_code?: number) => never;
  readonly logFn?: (_msg: string) => void;
  readonly errorFn?: (_msg: string) => void;
}

/** Create the github-publish status CLI command from a wired use case. */
export function createGithubPublishStatusCommand(useCase: GithubPublishStatusUseCase) {
  return async (args: string[], options: GithubPublishStatusCommandOptions = {}) => {
    const logFn = options.logFn || fmt.log.plain;
    const errorFn = options.errorFn || fmt.log.plainError;
    const exitFn = options.exitFn || process.exit;
    try {
      const result = await useCase.execute();
      renderGithubPublishStatus(result, logFn);
      exitFn(0);
    } catch (error) {
      errorFn(fmt.status('FAIL', `github-publish status: ${(error as Error).message}`));
      exitFn(1);
    }
  };
}
