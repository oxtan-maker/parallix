/** Operator status use case for github-publish mode.

 * Exposes local integration head, published head, missions awaiting external
 * verification, verified-but-blocked missions, and failed verification.
 * Additive to the existing `px status` command; does not touch the squash-merge
 * path. See docs/adr/0058-github-publish-mode.md.
 *
 * The use case is application-owned and depends only on the injected git port
 * and resolved config; composition wires the git-adapter implementation and the
 * product-config resolver to it.
 */
import type { GithubPublishConfig } from '../ports/github-publish.js';
import type { GithubPublishGitPort, VerificationOracle } from './publication-engine.js';
import { computeGithubPublishStatus } from './status.js';

/** Status of the github-publish publication engine for a repository. */
export interface GithubPublishStatusResult {
  readonly enabled: boolean;
  readonly localHead: string | null;
  readonly publishedHead: string | null;
  readonly awaitingVerification: string[];
  readonly verifiedBlocked: string[];
  readonly failed: string[];
  readonly publishableRun: string[];
}

export interface GithubPublishStatusUseCasePorts {
  readonly gitPort: GithubPublishGitPort;
  readonly config: GithubPublishConfig;
}

/**
 * Compute github-publish status for a repository. When the mode is disabled
 * (default) it returns `enabled: false` and does no git work, so the default
 * squash-merge behavior and its status output are unchanged.
 */
export class GithubPublishStatusUseCase {
  constructor(private readonly _ports: GithubPublishStatusUseCasePorts) {}

  async execute(oracle: VerificationOracle = new RefExistenceOracle()): Promise<GithubPublishStatusResult> {
    const { gitPort, config } = this._ports;
    if (!config.enabled) {
      return { enabled: false, localHead: null, publishedHead: null, awaitingVerification: [], verifiedBlocked: [], failed: [], publishableRun: [] };
    }

    const mainBranch = config.mainBranch ?? 'main';
    const originMain = gitPort.revParse(`origin/${mainBranch}`);
    const localHead = gitPort.revParse(mainBranch);
    if (!originMain || !localHead) {
      return { enabled: true, localHead, publishedHead: originMain, awaitingVerification: [], verifiedBlocked: [], failed: [], publishableRun: [] };
    }
    const ahead = gitPort.aheadCommits(originMain, mainBranch);
    const status = computeGithubPublishStatus(
      ahead.map(sha => ({ sha, state: oracle.query(sha) === 'verified' ? 'externally verified' : 'external verification pending', published: false })),
      localHead,
      originMain,
      oracle,
    );
    return {
      enabled: true,
      localHead,
      publishedHead: originMain,
      awaitingVerification: status.awaitingVerification.map(c => c.sha),
      verifiedBlocked: status.verifiedBlocked.map(c => c.sha),
      failed: status.failed.map(c => c.sha),
      publishableRun: status.publishableRun,
    };
  }
}

/** Default oracle: a verification ref that exists on the remote is pending
 * (published to the ref) until CI surfaces a verified/failed result. */
export class RefExistenceOracle implements VerificationOracle {
  query(_sha: string): 'verified' | 'failed' | 'pending' {
    // No CI metadata locally: a published-to-ref commit is pending.
    return 'pending';
  }
}
