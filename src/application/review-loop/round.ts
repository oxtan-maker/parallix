/**
 * Shared state and recovery decisions for one autonomous review round.
 *
 * The loop context carries the bound mechanism ports and the identities a
 * fallback may replace. The round budget is the per-round relaunch cap
 * (TASK-2377.04): every launch consumed by a rebound occurrence (gate, hook,
 * artifact) or a timeout recovery counts against it; it is in-memory and
 * resets each round.
 */
import type { ReviewLoopEvent } from '../ports/review-loop-output.js';
import { ConfiguredReviewerEligibility } from '../../domain/review.js';
import { agentFamily } from '../../domain/agents.js';
import { DEFAULT_REBOUND_ATTEMPTS, type ReboundContext, type ReboundStartAgent } from '../rebound-kernel.js';
import type { ReviewAgentLaunchResult, ReviewLoopPorts, ReviewLoopState, ReviewPromptFacts, ReviewRole } from '../ports/review-round.js';

/** Default per-round relaunch cap. */
export const DEFAULT_REBOUNDS_PER_ROUND = 6;

/** Named escalation reason: the per-round relaunch cap is exhausted. */
export const REBOUNDS_PER_ROUND_EXHAUSTED = 'REBOUNDS_PER_ROUND_EXHAUSTED';

export type RoundStep = 'stop' | null;

/** Everything a round needs that outlives it. */
export interface LoopContext {
  readonly ports: ReviewLoopPorts;
  readonly slug: string;
  readonly focus: string;
  readonly maxAttempts: number;
  readonly reboundsPerRound: number;
  readonly dryRun: boolean;
  readonly isContinue: boolean;
  readonly verbose: boolean;
  readonly initialRound: number;
  readonly state: ReviewLoopState;
  /** Current identities; a launcher fallback replaces them for every later round. */
  readonly identities: { implementer: string; reviewer: string };
  emit(_event: ReviewLoopEvent): void;
  exit(_code: number): void;
  escalateToHumanReview(_reason: string): Promise<void>;
}

/** Round-local scratch; nothing here is persisted. */
export class ReviewRound {
  used = 0;
  reviewBaseline: string | undefined;
  /** True when a repair's verification already re-ran the rebase and gate this round. */
  preReviewSetupVerified = false;
  blockingFindings: { id: string; summary: string }[] = [];
  /** The integration repair the reviewer is told about (TASK-2620); empty otherwise. */
  integrationRepair = '';

  readonly attempt: number;

  constructor(attempt: number, private readonly _context: LoopContext) {
    this.attempt = attempt;
    this.reviewBaseline = _context.ports.preReview.reviewBaseline();
  }

  remaining(): number {
    const cap = this._context.reboundsPerRound;
    return cap < 0 ? Number.POSITIVE_INFINITY : Math.max(0, cap - this.used);
  }

  capReached(): boolean {
    const cap = this._context.reboundsPerRound;
    return cap >= 0 && this.used >= cap;
  }

  /** The per-occurrence budget, clamped to what the round cap still allows. */
  occurrenceBudget(perOccurrence = DEFAULT_REBOUND_ATTEMPTS): number {
    return Math.min(perOccurrence, this.remaining());
  }

  /** Stop with the cap diagnostic and the named escalation reason. */
  async stopForCap(occurrence: string): Promise<'stop'> {
    const { slug, reboundsPerRound } = this._context;
    this._context.emit({ kind: 'round-recovery-exhausted', slug: slug, used: this.used, reboundsPerRound: reboundsPerRound, attempt: this.attempt, occurrence: occurrence });
    await this._context.escalateToHumanReview(REBOUNDS_PER_ROUND_EXHAUSTED);
    return 'stop';
  }

  promptFacts(reviewOutcome?: unknown): ReviewPromptFacts {
    const { implementer, reviewer } = this._context.identities;
    return { reviewer, implementer, attempt: this.attempt, reviewBaseline: this.reviewBaseline, integrationRepair: this.integrationRepair, ...(reviewOutcome === undefined ? {} : { reviewOutcome }) };
  }
}

/**
 * Adopt the family the launcher actually ran. A capacity fallback replaces the
 * role's identity for the rest of the loop, so it is persisted before any poll
 * keyed on that identity, and an implementer fallback becomes the task assignee.
 */
export async function adoptLaunchedAgent(context: LoopContext, role: ReviewRole, original: string, launch: ReviewAgentLaunchResult | null | undefined): Promise<string> {
  const fallback = launch?.agent;
  if (!fallback || fallback === original) { return original; }
  context.emit({ kind: 'agent-fallback', role: role, original: original, fallback: fallback });
  if (role === 'reviewer') {
    context.state.reviewer = fallback;
    context.identities.reviewer = fallback;
  } else {
    context.state.implementer = fallback;
    context.identities.implementer = fallback;
  }
  await context.ports.state.persist(context.state);
  if (role === 'implementer' && context.ports.task.task.ok && !context.ports.task.assign(fallback)) {
    context.emit({ kind: 'assignee-failed', fallback: fallback });
  }
  return fallback;
}

/** The other role's identity, which a launcher fallback must not pick. */
function excludedFor(context: LoopContext, role: ReviewRole): string {
  return role === 'reviewer' ? context.identities.implementer : context.identities.reviewer;
}

/**
 * The launch and fallback collaborators a rebound occurrence uses for a role.
 * With `prompt` the relaunch carries the role prompt plus the kernel's recovery
 * instructions; without it the kernel's repair prompt is launched on its own.
 */
export function reboundCollaborators(context: LoopContext, role: ReviewRole, prompt?: () => ReviewPromptFacts): Pick<ReboundContext, 'startAgent' | 'applyAgentFallback' | 'readHead' | 'slug' | 'worktree' | 'log' | 'error'> {
  const startAgent: ReboundStartAgent = async (_step, launchOptions) => await context.ports.agents.launch({
    role,
    agent: (prompt ? context.identities[role] : launchOptions.agent) as string,
    exclude: prompt ? [excludedFor(context, role)] : (launchOptions.exclude as string[] | undefined) ?? [],
    ...(prompt ? { prompt: prompt() } : {}),
    recovery: { prompt: launchOptions.prompt as (_actual: string) => unknown, sessionPolicy: launchOptions.sessionPolicy },
  }) ?? null;
  return {
    slug: context.slug,
    worktree: context.ports.worktree,
    startAgent,
    applyAgentFallback: async ({ launchResult, original }) => await adoptLaunchedAgent(context, role, original, launchResult as ReviewAgentLaunchResult),
    readHead: () => context.ports.preReview.head(),
    log: diagnostic => context.emit({ kind: 'recovery-progress', channel: 'log', diagnostic }),
    error: diagnostic => context.emit({ kind: 'recovery-progress', channel: 'error', diagnostic }),
  };
}

/** Configured review-step eligibility for a review-repair transition (AC12). */
export function configuredReviewerEligibility(context: LoopContext): ConfiguredReviewerEligibility {
  return ConfiguredReviewerEligibility.fromReviewStep({
    eligible: context.ports.routing.eligibleFamilies().map(agentFamily),
    strategy: 'random',
  });
}

/**
 * A later authoritative round proves this controller's snapshot is stale: stop
 * rather than write it. An approval of this same round is an outcome, not a
 * competing controller, and is reconciled by the reviewer outcome.
 */
export async function stopIfControllerSuperseded(context: LoopContext, boundary: string): Promise<boolean> {
  const authoritative = await context.ports.state.read();
  if (!authoritative || authoritative.round <= context.state.round) { return false; }
  context.emit({ kind: 'controller-superseded', slug: context.slug, boundary: boundary, round: authoritative.round, phase: authoritative.phase });
  return true;
}

/** Seconds since an ISO instant, for recovery diagnostics. */
export function elapsedSince(iso: string): string {
  return `${Math.round((Date.now() - Date.parse(iso)) / 1000)}s`;
}
