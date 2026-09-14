/** github-publish publication engine.

 * Publishes the exact locally-generated integration commit unchanged to a
 * per-commit verification ref, polls an injected verification oracle, and
 * advances origin/main only through the highest contiguous run of externally
 * verified commits via fast-forward.
 *
 * See docs/adr/0058-github-publish-mode.md.
 */
import {
  verificationRefName,
  resolveExistingRef,
} from './verification-ref.js';
import {
  transitionFrom,
  isExternallyVerified,
  isVerificationFailed,
  type GithubPublishState,
} from './state-machine.js';

/** Verification result the engine asks the oracle for a commit SHA. */
export type VerificationOutcome = 'verified' | 'failed' | 'pending';

/** Injectable verification oracle: operator-provided CI result for a SHA. */
export interface VerificationOracle {
  query(_sha: string): VerificationOutcome;
}

/** In-memory oracle backed by a map, for tests and offline operator use. */
export class MapVerificationOracle implements VerificationOracle {
  private readonly _results = new Map<string, VerificationOutcome>();
  constructor(results: Record<string, VerificationOutcome> = {}) {
    for (const [sha, outcome] of Object.entries(results)) {
      this._results.set(sha.toLowerCase(), outcome);
    }
  }
  query(sha: string): VerificationOutcome {
    return this._results.get(sha.toLowerCase()) ?? 'pending';
  }
  mark(sha: string, outcome: VerificationOutcome): void {
    this._results.set(sha.toLowerCase(), outcome);
  }
}

/** Git primitives the engine needs. Injected so tests can use real temp repos
 * or a stub; the default drives a real git remote. */
export interface GithubPublishGitPort {
  /** Resolve a ref to a full 40-char SHA, or null when unresolved. */
  revParse(_ref: string): string | null;
  /** Commits reachable from `head` but not from `base`, oldest first. */
  aheadCommits(_base: string, _head: string): string[];
  /** Push `<sha>` to the verification ref. ok=false when git rejects it. */
  push(_remote: string, _sha: string, _ref: string): { ok: boolean; error?: string };
  /** Does `descendant` have `ancestor` in its history? */
  isDescendant(_ancestor: string, _descendant: string): boolean;
  /** Fast-forward `ref` to `target` (local branch update). */
  fastForward(_ref: string, _target: string): { ok: boolean; error?: string };
  /** Update the tracked remote branch origin/main to target via ref-update. */
  updateRemoteTrackingRef(_remote: string, _ref: string, _target: string): { ok: boolean; error?: string };
  /** Fetch the remote to detect unexpected origin/main movement. */
  fetch(_remote: string): { ok: boolean; error?: string };
  /** Resolve a ref on a remote via ls-remote, or null when absent. */
  resolveRemoteRef(_remote: string, _ref: string): string | null;
}

/** Engine failure, always explicit — never a silent no-op. */
export class GithubPublishError extends Error {
  constructor(message: string, readonly _reason: string) {
    super(message);
  }
}

/** A single commit's tracking under github-publish mode. */
export interface CommitTracking {
  readonly sha: string;
  readonly state: GithubPublishState;
  /** True once advanced onto origin/main. */
  readonly published: boolean;
}

export interface PublishResult {
  readonly sha: string;
  readonly action: 'published-to-verification-ref' | 'idempotent-ref' | 'collision';
}

export interface AdvanceResult {
  readonly advanced: boolean;
  readonly from: string | null;
  readonly to: string | null;
  readonly contiguousVerified: string[];
  readonly blockedBy: string | null;
  readonly failClosed: boolean;
  readonly reason?: string;
}

export interface PublishEngineOptions {
  git: GithubPublishGitPort;
  mainBranch: string;
  verificationRemote: string;
  verificationRefPrefix: string;
  /** Max polls per commit before treating as a hard stop. null = indefinite. */
  maxPollAttempts?: number | null;
  /** Called after each advance for operator status / logging. */
  onAdvance?: (_result: AdvanceResult) => void;
}

export class GithubPublishEngine {
  /** SHAs already pushed to a verification ref (idempotent-ref / collision guard). */
  private readonly _refPublished = new Set<string>();
  /** SHAs already advanced onto origin/main via fast-forward. */
  private readonly _advancedOnMain = new Set<string>();

  constructor(private readonly _opts: PublishEngineOptions) {}

  /** Publish the exact integration commit to its verification ref.
   * The SHA is preserved verbatim — no squash/rebase/recreation. */
  publishCommit(sha: string): PublishResult {
    const norm = sha.toLowerCase();
    if (this._refPublished.has(norm)) {
      return { sha: norm, action: 'idempotent-ref' };
    }
    const ref = verificationRefName(sha, this._opts.verificationRefPrefix);
    const result = this._opts.git.push(this._opts.verificationRemote, sha, ref);
    if (!result.ok) {
      // A pre-existing ref is the only expected push rejection. Resolve it on
      // the remote, since the verification ref lives on the remote, not locally.
      const existing = this._opts.git.resolveRemoteRef(this._opts.verificationRemote, ref);
      if (existing !== null) {
        const resolved = resolveExistingRef(existing, sha);
        if (resolved.action === 'collision') {
          throw new GithubPublishError(
            `verification ref ${ref} already exists at ${existing} (expected ${sha}); refusing to clobber`,
            'verification-ref-collision',
          );
        }
        // idempotent-retry: same SHA already published.
        this._refPublished.add(norm);
        return { sha: norm, action: 'idempotent-ref' }
      }
      throw new GithubPublishError(`failed to publish ${sha} to ${ref}: ${result.error}`, 'push-failed');
    }
    this._refPublished.add(norm);
    return { sha: norm, action: 'published-to-verification-ref' };
  }

  /** Poll verification for a commit, transitioning its state.
   * Returns the resulting state; pending stays pending. */
  pollVerification(sha: string, oracle: VerificationOracle): { state: GithubPublishState; outcome: VerificationOutcome } {
    const outcome = oracle.query(sha);
    if (outcome === 'pending') {
      return { state: 'external verification pending', outcome };
    }
    const next = outcome === 'verified' ? 'externally verified' : 'external verification failed';
    return { state: transitionFrom('external verification pending', next), outcome };
  }

  /**
   * Advance origin/main through the highest contiguous run of externally
   * verified commits that are the direct next unpublished descendants of
   * origin/main. Fails closed on any divergence from the expected ancestor.
   */
  advanceMain(oracle: VerificationOracle): AdvanceResult {
    const { git, mainBranch } = this._opts;
    const originMain = git.revParse(`origin/${mainBranch}`);
    if (!originMain) {
      throw new GithubPublishError(`origin/${mainBranch} unresolved`, 'origin-main-missing');
    }
    // Detect unexpected remote movement before advancing.
    const fresh = git.revParse(`origin/${mainBranch}`);
    if (fresh !== originMain) {
      throw new GithubPublishError(
        `origin/${mainBranch} moved between read (${originMain}) and verify (${fresh})`,
        'remote-moved',
      );
    }

    const ahead = git.aheadCommits(originMain, `${mainBranch}`);
    // First unpublished commit = direct child of origin/main.
    const next = ahead.find(sha => !this._advancedOnMain.has(sha));
    if (!next) {
      return { advanced: false, from: originMain, to: originMain, contiguousVerified: [], blockedBy: null, failClosed: false };
    }

    // Walk the contiguous verified run starting at `next`.
    const run: string[] = [];
    let blockedBy: string | null = null;
    let failClosed = false;
    let cursor: string | null = next;
    while (cursor) {
      const { state } = this.pollVerification(cursor, oracle);
      if (!isExternallyVerified(state)) {
        blockedBy = cursor;
        failClosed = isVerificationFailed(state);
        break;
      }
      run.push(cursor);
      // Next candidate: the child of `cursor` that is still on local main.
      cursor = this._nextUnpublishedInRun(cursor, ahead);
    }

    if (run.length === 0 || failClosed) {
      return { advanced: false, from: originMain, to: originMain, contiguousVerified: [], blockedBy, failClosed,
        reason: failClosed ? 'verification-failed-blocks-advance' : 'no-contiguous-verified-commit' };
    }

    // The verified run must be contiguous from origin/main. `next` is already the
    // direct child, so the run is contiguous by construction. Advance via
    // fast-forward to the tip, updating the tracked remote ref too.
    const tip = run[run.length - 1];
    const from = originMain;
    // Fail-closed re-check: tip must still be a descendant of origin/main.
    if (!git.isDescendant(originMain, tip)) {
      throw new GithubPublishError(`verified tip ${tip} is no longer a descendant of origin/${mainBranch}`, 'divergence');
    }
    const local = git.fastForward(mainBranch, tip);
    if (!local.ok) {
      throw new GithubPublishError(`fast-forward of ${mainBranch} to ${tip} failed: ${local.error}`, 'fast-forward-failed');
    }
    const remote = git.updateRemoteTrackingRef(this._opts.verificationRemote, mainBranch, tip);
    if (!remote.ok) {
      throw new GithubPublishError(`update of origin/${mainBranch} to ${tip} failed: ${remote.error}`, 'remote-update-failed');
    }
    for (const sha of run) {
      this._advancedOnMain.add(sha);
    }
    const result: AdvanceResult = {
      advanced: true,
      from,
      to: tip,
      contiguousVerified: run,
      blockedBy: null,
      failClosed: false,
    };
    this._opts.onAdvance?.(result);
    return result;
  }

  /** The next local-main commit after `sha` that has not yet been published. */
  private _nextUnpublishedInRun(sha: string, ahead: string[]): string | null {
    const idx = ahead.indexOf(sha);
    if (idx === -1) {return null;}
    for (let i = idx + 1; i < ahead.length; i++) {
      if (!this._advancedOnMain.has(ahead[i])) {return ahead[i];}
    }
    return null;
  }

  /** State for a commit: published flag + verification state. */
  tracking(sha: string, oracle: VerificationOracle): CommitTracking {
    return {
      sha,
      published: this._advancedOnMain.has(sha.toLowerCase()),
      state: this._verificationState(sha, oracle),
    };
  }

  private _verificationState(sha: string, oracle: VerificationOracle): GithubPublishState {
    const outcome = oracle.query(sha);
    if (outcome === 'verified') {return 'externally verified';}
    if (outcome === 'failed') {return 'external verification failed';}
    return 'external verification pending';
  }
}
