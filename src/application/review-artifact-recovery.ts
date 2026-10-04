import { rebound, DEFAULT_REBOUND_ATTEMPTS, isArtifactInfraDiagnostic, type ReboundContext, type ReboundStartAgent, type VerifyResult } from './rebound-kernel.js';

/**
 * Producing role for review-loop artifacts.
 * Maps artifact categories to the agent role that produces them.
 */
export type ArtifactRole = 'reviewer' | 'implementer';

/**
 * Outcome of one artifact-failure occurrence, mapped from the rebound kernel.
 * `fixed` — the relaunched role's artifacts were re-consumed and are complete
 * `strand` — the per-occurrence attempt budget is spent; human intervention
 * `human-only` — the ADR 0048 table says no agent relaunch can fix this
 */
export type ArtifactDispatchAction = 'fixed' | 'strand' | 'human-only';

export interface ArtifactDispatchResult {
  action: ArtifactDispatchAction;
  role: ArtifactRole;
  /** Last diagnostic observed: the verify re-consume's, or the original one. */
  diagnostic: string;
  /** Completed repair attempts consumed by this occurrence. */
  attempts: number;
  maxAttempts: number;
  /** Agent that ran the final attempt (fallback-resolved). */
  agent: string;
}

export interface ArtifactRecoveryOptions {
  slug: string;
  worktree: string;
  /** Agent identity to relaunch for this role. */
  agent: string;
  /** Re-consumes the role's artifacts; `ok` only when they are complete. */
  verifyFn: (_attempt: number) => Promise<VerifyResult> | VerifyResult;
  /** Role-shaped launch port (step, role, exclude, base prompt). */
  startAgentFn: ReboundStartAgent;
  applyAgentFallbackFn?: ReboundContext['applyAgentFallback'];
  transitionToImplementerFn?: ReboundContext['transitionToImplementer'];
  maxAttempts?: number;
  log: (_msg: string) => void;
  error: (_msg: string) => void;
  /** Concrete revision read supplied by the artifact adapter. */
  readHead: NonNullable<ReboundContext['readHead']>;
}

/**
 * Role-shaped artifact recovery over the rebound kernel. Classification and
 * launch/verify policy stay in application; concrete artifact and Git I/O
 * arrive through the operation's typed callbacks.
 */
export async function dispatchArtifactFailure(
  role: ArtifactRole,
  diagnostic: string,
  options: ArtifactRecoveryOptions,
): Promise<ArtifactDispatchResult> {
  const { slug, worktree, agent, verifyFn, startAgentFn, maxAttempts = DEFAULT_REBOUND_ATTEMPTS } = options;
  const { log, error } = options;

  if (typeof verifyFn !== 'function') {
    throw new Error('dispatchArtifactFailure requires a verify callback: an artifact bounce may only be reported fixed when the artifacts are re-consumed and complete.');
  }

  const outcome = await rebound(
    { kind: 'artifact-incomplete', role, diagnostic },
    {
      slug,
      worktree,
      implementer: agent,
      maxAttempts,
      verify: verifyFn,
      startAgent: startAgentFn,
      readHead: options.readHead,
      applyAgentFallback: options.applyAgentFallbackFn,
      transitionToImplementer: options.transitionToImplementerFn,
      log,
      error,
    },
  );

  const action: ArtifactDispatchAction = outcome.outcome === 'fixed'
    ? 'fixed'
    : (outcome.outcome === 'human-only' ? 'human-only' : 'strand');

  return {
    action,
    role,
    diagnostic: outcome.diagnostic,
    attempts: outcome.attempts,
    maxAttempts,
    agent: outcome.implementer,
  };
}

/**
 * Preserve the existing post-bounce policy: only implementer recovery applies
 * the artifact transport classifier again. Reviewer recovery uses the kernel
 * outcome alone. Changing that asymmetry is a separate behavior change.
 */
export function artifactRecoveryRequiresHuman(result: ArtifactDispatchResult): boolean {
  return result.action === 'human-only'
    || (result.role === 'implementer' && isArtifactInfraDiagnostic(result.diagnostic));
}

/** Shared round budget for gate, hook, artifact, and timeout occurrences. */
export const DEFAULT_REBOUNDS_PER_ROUND = 6;
export const REBOUNDS_PER_ROUND_EXHAUSTED = 'REBOUNDS_PER_ROUND_EXHAUSTED';

/** In-memory only; each review round starts with a new budget. */
export class ReviewRoundRecoveryBudget {
  used = 0;
  readonly limit: number;
  constructor(limit: number) { this.limit = limit; }
  remaining(): number {
    return this.limit < 0 ? Number.POSITIVE_INFINITY : Math.max(0, this.limit - this.used);
  }
  attemptLimit(): number {
    return Math.min(DEFAULT_REBOUND_ATTEMPTS, this.remaining());
  }
  consume(attempts: number): void {
    this.used += attempts;
  }
  reached(): boolean {
    return this.limit >= 0 && this.used >= this.limit;
  }
}
