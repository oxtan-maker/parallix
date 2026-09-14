/** github-publish mode: application-owned port types.

 * These are mechanism-free contracts owned by the application layer. The
 * product-config adapter resolves into `GithubPublishConfig`; the git adapter
 * implements `GithubPublishGitPort`. See docs/adr/0058-github-publish-mode.md.
 */

/** Resolved github-publish mode configuration. `enabled` is false when unset, so
 * an unconfigured repository never publishes and its default behavior is
 * byte-for-byte unchanged. */
export interface GithubPublishConfig {
  readonly enabled: boolean;
  readonly mainBranch: string | null;
  readonly verificationRemote: string;
  readonly verificationRefPrefix: string;
  readonly pollIntervalMs: number;
  readonly maxPollAttempts: number | null;
}
