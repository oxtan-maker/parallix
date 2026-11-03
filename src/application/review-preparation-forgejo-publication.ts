import { preparationFailure, preparationGateFailure } from './review-preparation-failure.js';
/**
 * Forgejo publication for review preparation: resolve implementer credentials and push the
 * Backlog transition under a lease.
 */

import * as fmt from './presentation/cli-format.js';
import type { CommandResult, ReviewPreparationLog, ReviewPreparationResult, ReviewPreparationWorkflowPorts } from "./ports/review-preparation-workflow.js";

export type ReviewPreparationFallbackWriter = (_slug: string, _summary: string, _options: { rootDir: string; log: ReviewPreparationLog }) => boolean;

/** Credentials the Forgejo PR push uses after implementer bootstrap. */
interface ReviewPreparationForgejoCredentials {
  token: string;
  fallbackUser: string | null;
}

/** Facts the Backlog transition push needs from the completed review preparation. */
interface BacklogPushContext {
  rootDir: string;
  branch: string;
  token: string;
  fallbackUser: string | null;
  forgejoUser: string;
  force: boolean;
  log: ReviewPreparationLog;
  error: ReviewPreparationLog;
  gatekeeperPushedBack: boolean;
}

/** Collaborators and recursion state carried into gatekeeper remediation. */

/** Publishes the handed-off branch to Forgejo. */
export class ReviewPreparationForgejoPublisher {
  async publishReviewPreparationPr(slug: string, context: ReviewPreparationPublicationContext): Promise<ReviewPreparationPublication | ReviewPreparationResult> {
    const ports = this.ports;
    const { forgejoEnabled, rootDir, forgejoUser, branch, forceWithLease, area, log, error, internalLog } = context;
    let token: string | null = null;
    let fallbackUser: string | null = null;
    /** The pull request this review preparation hands to the reviewer, when there is one. */
    let submittedPr: { id: string; url: string | null } | null = null;
    if (forgejoEnabled) {
      internalLog(`Updating/Creating Forgejo PR as user ${fmt.agent(forgejoUser)}...`);
      const credentials = await this.resolveReviewPreparationForgejoToken(slug, forgejoUser, { rootDir, log, error, internalLog });
      if (!('token' in credentials)) { return credentials; }
      token = credentials.token;
      fallbackUser = credentials.fallbackUser;

      const prResult = ports.forgejo.createPr(branch || '', String(fallbackUser || forgejoUser || 'default'), String(token || ''), {
        rootDir,
        log: internalLog,
        forceWithLease,
        verificationArea: area,
      });
      if (!prResult.ok) {
        const msg = `Forgejo PR creation/update failed: ${prResult.error}`;
        error(msg);
        return prResult.gateFailure ? preparationGateFailure(msg, prResult.gateFailure)
          : { ...preparationFailure(msg, 'infrastructure', 'forgejo'), ...(prResult.failureReason ? { failureReason: prResult.failureReason, recoveryFailure: { kind: 'review-preparation-verification' as const, error: msg, failureReason: prResult.failureReason } } : {}) };
      }
      if (prResult.prNumber) {
        submittedPr = { id: String(prResult.prNumber), url: prResult.url ?? null };
      }
    }

    return { token, fallbackUser, submittedPr };
  }

  private readonly ports: ReviewPreparationWorkflowPorts;

  constructor(ports: ReviewPreparationWorkflowPorts, private readonly writeFallbackSummary: ReviewPreparationFallbackWriter) { this.ports = ports; }

  /**
   * The token the PR is pushed with. A missing agent token is bootstrapped
   * non-interactively; Parallix credentials may publish when bootstrap fails.
   */
  async resolveReviewPreparationForgejoToken(slug: string, forgejoUser: string, context: {
    rootDir: string; log: ReviewPreparationLog; error: ReviewPreparationLog; internalLog: ReviewPreparationLog;
  }): Promise<ReviewPreparationResult | ReviewPreparationForgejoCredentials> {
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
        error('Bootstrap completed but token file for the agent user was not found. Publication remains blocked.');
      }
    } else {
      bootstrapFailureReason = bootstrapResult.error || 'unknown';
      error(`Bootstrap for ${fmt.agent(forgejoUser)} failed: ${bootstrapFailureReason}. Publication remains blocked.`);
    }
    if (token) { return { token, fallbackUser: null }; }

    const fallbackUser = reviewSettings.repo?.split('/')[0] || 'human';
    const fallbackToken = ports.forgejo.readToken(fallbackUser);
    if (fallbackToken) {
      error(`Using Parallix publication credentials (${fallbackUser}); implementer remains ${forgejoUser}. Bootstrap failure: ${bootstrapFailureReason || 'token unavailable'}`);
      this.writeFallbackSummary(slug, `## Fallback: PR submitted as ${fallbackUser}

Original user: ${forgejoUser}
Bootstrap failure reason: ${bootstrapFailureReason || 'token unavailable'}`, { rootDir, log });
      return { token: fallbackToken, fallbackUser };
    }
    const msg = `No Forgejo token found for implementer "${forgejoUser}" after bootstrap (${bootstrapFailureReason || 'token unavailable'}). Publication for ${slug} stopped; configure that implementer's credentials with px setup-review. Parallix publication credentials are also unavailable.`;
    error(msg);
    return preparationFailure(msg, 'infrastructure', 'forgejo');
  }

  /**
   * Push the Backlog transition commit to Forgejo under a lease.
   *
   * Returns a terminal `ReviewPreparationResult` when the caller must stop (failure, or the
   * plain-force success path that historically returned early), or `null` when the
   * push succeeded and the caller should continue to the success message.
   */
  pushBacklogTransition(slug: string, context: BacklogPushContext): ReviewPreparationResult | null {
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

  private backlogPushLease(slug: string, rootDir: string, branch: string, remoteUrl: string, error: (_: string) => void): string | ReviewPreparationResult {
    const fetchArgs = ['-C', rootDir, 'fetch', remoteUrl, `+refs/heads/${branch}:refs/remotes/review/${branch}`];
    const fetchResult = this.ports.git.git(fetchArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    if (fetchResult.status !== 0) {
      const fetchError = (fetchResult.stderr || fetchResult.stdout || '').trim();
      const msg = `Failed to refresh Backlog transition lease for ${fmt.slug(slug)} before Forgejo push.`;
      error(`${msg}${fetchError ? ` ${fetchError}` : ''}`);
      return preparationFailure(msg, 'infrastructure', 'forgejo');
    }
    const tracking = this.ports.forgejo.resolveTrackingBranchSha(branch || '', rootDir);
    if (!tracking.ok) {
      const msg = `Failed to resolve Backlog transition lease for ${fmt.slug(slug)} before Forgejo push.`;
      error(msg);
      return preparationFailure(`${msg} ${tracking.error || ''}`.trim(), 'git-failed', 'git');
    }
    return `--force-with-lease=refs/heads/${branch}:${String(tracking.sha || '')}`;
  }

  private handleBacklogPushResult(slug: string, result: CommandResult, context: Pick<BacklogPushContext, 'rootDir' | 'branch' | 'force' | 'error' | 'gatekeeperPushedBack'> & { remoteUrl: string }): ReviewPreparationResult | null {
    if (result.status === 0) { return null; }
    const pushError = [result.stderr, result.stdout].filter(Boolean).join('\n');
    if (context.force && result.failureReason?.code === 'git-behind') {
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

  private backlogPushFailure(slug: string, detail: string, error: (_: string) => void): ReviewPreparationResult {
    const msg = `Failed to push Backlog transition for ${fmt.slug(slug)} to Forgejo.`;
    error(msg);
    return preparationFailure(detail ? `${msg} ${detail}` : msg, 'git-failed', 'git');
  }

}

export interface ReviewPreparationPublication { token: string | null; fallbackUser: string | null; submittedPr: { id: string; url: string | null } | null }
interface ReviewPreparationPublicationContext { forgejoEnabled: boolean; rootDir: string; forgejoUser: string; branch: string; forceWithLease: boolean; area: string; log: ReviewPreparationLog; error: ReviewPreparationLog; internalLog: ReviewPreparationLog }
