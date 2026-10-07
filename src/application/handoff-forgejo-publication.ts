/**
 * Forgejo publication for handoff: resolve the PR token, write the fallback
 * summary, and push the Backlog transition under a lease.
 */

import * as fmt from './presentation/cli-format.js';
import type { CommandResult, HandoffLog, HandoffResult, HandoffWorkflowPorts } from './ports/handoff-workflow.js';

/** Credentials the Forgejo PR push uses after bootstrap and owner fallback. */
interface HandoffForgejoCredentials {
  token: string;
  fallbackUser: string | null;
}

/** Facts the Backlog transition push needs from the completed handoff. */
interface BacklogPushContext {
  rootDir: string;
  branch: string;
  token: string;
  fallbackUser: string | null;
  forgejoUser: string;
  force: boolean;
  log: HandoffLog;
  error: HandoffLog;
  gatekeeperPushedBack: boolean;
}

/** Collaborators and recursion state carried into gatekeeper remediation. */

/** Publishes the handed-off branch to Forgejo. */
export class HandoffForgejoPublisher {
  private readonly ports: HandoffWorkflowPorts;
  private readonly writeFallbackSummary: (_slug: string, _summary: string, _options: { rootDir?: string; log?: HandoffLog }) => boolean;

  constructor(ports: HandoffWorkflowPorts, writeFallbackSummary: HandoffForgejoPublisher['writeFallbackSummary']) {
    this.ports = ports;
    this.writeFallbackSummary = writeFallbackSummary;
  }

  /**
   * The token the PR is pushed with. A missing agent token is bootstrapped
   * non-interactively, then falls back to the repo owner; only when the owner
   * has no token either does handoff stop for manual action.
   */
  async resolveHandoffForgejoToken(slug: string, forgejoUser: string, context: {
    rootDir: string; log: HandoffLog; error: HandoffLog; internalLog: HandoffLog;
  }): Promise<HandoffResult | HandoffForgejoCredentials> {
    const ports = this.ports;
    const { rootDir, log, error, internalLog } = context;
    const existing = ports.forgejo.readToken(forgejoUser);
    if (existing) { return { token: existing, fallbackUser: null }; }

    error(`Token not found for ${fmt.agent(forgejoUser)}. Attempting non-interactive bootstrap...`);
    const reviewSettings = ports.forgejo.resolveForgejoSettings(rootDir);
    const bootstrapResult = await ports.setupReview.bootstrapReviewSurface(rootDir, {
      baseUrl: reviewSettings.url,
      repo: reviewSettings.repo,
      ownerLogin: 'human',
      ownerPassword: '',
      agentPasswords: [{ user: forgejoUser, password: '' }],
    }, { interactive: false, requestFn: ports.setupReview.apiRequest, log: internalLog });

    let bootstrapFailureReason: string | null = null;
    let token: string | null = null;
    if (bootstrapResult.ok) {
      log(fmt.status('PASS', `Bootstrap succeeded for ${fmt.agent(forgejoUser)}.`));
      token = ports.forgejo.readToken(forgejoUser);
      if (!token) {
        bootstrapFailureReason = 'bootstrap completed but token file for the agent user was not found';
        error('Bootstrap completed but token file for the agent user was not found. Falling back to default user.');
      }
    } else {
      bootstrapFailureReason = bootstrapResult.error || 'unknown';
      error(`Bootstrap for ${fmt.agent(forgejoUser)} failed: ${bootstrapFailureReason}. Falling back to default user.`);
    }
    if (token) { return { token, fallbackUser: null }; }

    token = ports.forgejo.readToken('human');
    if (!token) {
      const msg = `No Forgejo token found for user "${fmt.agent(forgejoUser)}", bootstrap failed (${bootstrapResult.error || 'unknown'}), and no fallback token available for "${fmt.agent('human')}". Manual action required: create a token manually or run \`node parallix setup-review\` first.`;
      error(msg);
      return { ok: false, error: msg };
    }
    log(`Review submission fell back from ${fmt.agent(forgejoUser)} to ${fmt.agent('human')}.`);
    // Durable record of why the PR carries the owner's identity rather than the
    // implementer's, so a reviewer is not left guessing.
    const reason = bootstrapFailureReason || 'agent token was missing and bootstrap did not provide a replacement token';
    const fallbackSummary = `## Fallback: PR submitted as ${fmt.agent('human')}\n\nOriginal user: ${fmt.agent(forgejoUser)}\nBootstrap failure reason: ${reason}`;
    if (!this.writeFallbackSummary(slug, fallbackSummary, { rootDir, log: internalLog })) {
      log(fmt.status('WARN', `Could not persist fallback summary for ${fmt.slug(slug)}`));
    }
    return { token, fallbackUser: 'human' };
  }

  /**
   * Push the Backlog transition commit to Forgejo under a lease.
   *
   * Returns a terminal `HandoffResult` when the caller must stop (failure, or the
   * plain-force success path that historically returned early), or `null` when the
   * push succeeded and the caller should continue to the success message.
   */
  pushBacklogTransition(slug: string, context: BacklogPushContext): HandoffResult | null {
    const ports = this.ports;
    const { rootDir, branch, token, fallbackUser, forgejoUser, force, log, error, gatekeeperPushedBack } = context;
    log('Pushing state change to Forgejo...');
    const reviewSettings = ports.forgejo.resolveForgejoSettings(rootDir);
    const repoOwner = (reviewSettings.repo && reviewSettings.repo.split('/')[0]) || null;
    const ownerToken = repoOwner ? ports.forgejo.readToken(repoOwner) : null;
    const pushUser = ownerToken && repoOwner ? repoOwner : (fallbackUser || forgejoUser);
    const pushToken = ownerToken || token;
    const remoteUrl = ports.forgejo.authenticatedReviewUrl(pushUser, pushToken, rootDir);
    const pushLease = this.backlogPushLease(slug, rootDir, branch, remoteUrl, error);
    if (typeof pushLease !== 'string') { return pushLease; }
    const pushResult = ports.git.git(['-C', rootDir, 'push', pushLease, String(remoteUrl || ''), branch || '']);
    return this.handleBacklogPushResult(slug, pushResult, { rootDir, branch, remoteUrl, force, error, gatekeeperPushedBack });
  }

  private backlogPushLease(slug: string, rootDir: string, branch: string, remoteUrl: string, error: (_: string) => void): string | HandoffResult {
    const fetchArgs = ['-C', rootDir, 'fetch', remoteUrl, `+refs/heads/${branch}:refs/remotes/review/${branch}`];
    const fetchResult = this.ports.git.git(fetchArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    if (fetchResult.status !== 0) {
      const fetchError = (fetchResult.stderr || fetchResult.stdout || '').trim();
      const msg = `Failed to refresh Backlog transition lease for ${fmt.slug(slug)} before Forgejo push.`;
      error(`${msg}${fetchError ? ` ${fetchError}` : ''}`);
      return { ok: false, error: msg };
    }
    const tracking = this.ports.forgejo.resolveTrackingBranchSha(branch || '', rootDir);
    if (!tracking.ok) {
      const msg = `Failed to resolve Backlog transition lease for ${fmt.slug(slug)} before Forgejo push.`;
      error(msg);
      return { ok: false, error: `${msg} ${tracking.error || ''}`.trim() };
    }
    return `--force-with-lease=refs/heads/${branch}:${String(tracking.sha || '')}`;
  }

  private handleBacklogPushResult(slug: string, result: CommandResult, context: Pick<BacklogPushContext, 'rootDir' | 'branch' | 'force' | 'error' | 'gatekeeperPushedBack'> & { remoteUrl: string }): HandoffResult | null {
    if (result.status === 0) { return null; }
    const pushError = [result.stderr, result.stdout].filter(Boolean).join('\n');
    if (context.force && /non-fast-forward|stale info|fetch first/i.test(pushError)) {
      const forced = this.ports.git.git(['-C', context.rootDir, 'push', '--force', String(context.remoteUrl || ''), context.branch || '']);
      if (forced.status === 0) {
        fmt.log.info(`Backlog transition for ${fmt.slug(slug)} required plain force after stale lease.`);
        return { ok: true, gatekeeperPushedBack: context.gatekeeperPushedBack };
      }
      const forceError = (forced.stderr || forced.stdout || '').trim();
      return this.backlogPushFailure(slug, forceError, context.error);
    }
    return this.backlogPushFailure(slug, pushError.trim(), context.error);
  }

  private backlogPushFailure(slug: string, detail: string, error: (_: string) => void): HandoffResult {
    const msg = `Failed to push Backlog transition for ${fmt.slug(slug)} to Forgejo.`;
    error(msg);
    return { ok: false, error: detail ? `${msg} ${detail}` : msg };
  }

}
