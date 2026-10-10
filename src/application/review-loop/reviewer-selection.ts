/**
 * Reviewer selection policy for the autonomous review loop.
 *
 * The routing port reports which families are eligible and launchable and what
 * the configured selector nominates. This module decides: the implementer's
 * family is excluded, another eligible family is preferred, a single runnable
 * family reviews its own work, a resumed round keeps its reviewer, and the loop
 * stops when no route can finish the review.
 */
import type { ReviewLoopOutput } from '../ports/review-round.js';
import type { LauncherStatus, ReviewerRoutingPort, ReviewLoopState } from '../ports/review-round.js';

export interface ReviewerSelectionRequest {
  readonly reviewer?: string;
  readonly implementer: string;
  readonly isContinue: boolean;
  readonly persisted: Pick<ReviewLoopState, 'reviewer' | 'round' | 'phase'> | null;
  readonly maxAttempts: number;
  readonly dryRun: boolean;
  readonly providerEnabled: boolean;
  readonly slug: string;
}

export interface ReviewerSelection { reviewer: string; reviewerSource: string }

type Selection = { reviewer: string | undefined; source: string };
type Context = ReviewerSelectionRequest & { routing: ReviewerRoutingPort; agents: string[]; emit: ReviewLoopOutput['emit'] };

function reportNoRunnableReviewerRoute(context: Context): null {
  context.emit({ kind: 'runtime-matrix-header' });
  context.routing.runtimeMatrix().forEach(line => context.emit({ kind: 'runtime-matrix-line', line: line }));
  context.emit({ kind: 'reviewer-route-unavailable', implementer: context.implementer });
  return null;
}

function logSingleFamilyFallback(context: Context): void {
  const unavailable = context.agents.filter(agent => agent !== context.implementer)
    .map(agent => ({ agent, detail: context.routing.launcherStatus(agent).detail }));
  context.emit({ kind: 'different-family-unavailable', implementer: context.implementer, unavailable: unavailable });
  context.emit({ kind: 'single-family-review', implementer: context.implementer });
}

function hasDifferentFamilyRoute(context: Context): boolean {
  return context.agents.some(agent => agent !== context.implementer && context.routing.launcherStatus(agent).supported);
}

function implementerRunnable(context: Context): boolean {
  return context.agents.includes(context.implementer) && context.routing.launcherStatus(context.implementer).supported;
}

/** The reviewer a flag, a resumed round, or the selector names; the selector's error otherwise. */
function deriveInitialReviewer(selection: Selection, context: Context): Error | null {
  if (selection.reviewer) { return null; }
  if (context.persisted?.reviewer) {
    selection.reviewer = context.persisted.reviewer;
    selection.source = 'persisted';
    context.emit({ kind: 'reviewer-resumed', reviewer: selection.reviewer, round: context.persisted.round, isContinue: context.isContinue });
    return null;
  }
  selection.source = 'auto-derived';
  try {
    selection.reviewer = context.routing.nominate(new Set([context.implementer]));
    context.emit({ kind: 'agent-selection', outcome: 'nominated', fields: { agent: selection.reviewer, step: 'review' } });
    return null;
  } catch (err: unknown) {
    selection.reviewer = undefined;
    return err as Error;
  }
}

/**
 * Nobody was nominated. A single runnable family reviews its own work; with no
 * runnable route at all, provider=none completes the loop through workflow-owned
 * artifacts, while a live provider has no way to finish and fails closed.
 */
function fallbackForUnnamedReviewer(selection: Selection, context: Context, selectErr: Error | null): boolean {
  const differentFamilyRoute = hasDifferentFamilyRoute(context);
  if (!differentFamilyRoute && implementerRunnable(context)) {
    logSingleFamilyFallback(context);
    selection.reviewer = context.implementer;
    selection.source = 'single-family-fallback';
    context.emit({ kind: 'agent-selection', outcome: 'fallback', fields: { agent: selection.reviewer, step: 'review', reason: 'single-family' } });
    return true;
  }
  const detail = selectErr?.message ?? null;
  if (differentFamilyRoute || !context.providerEnabled) {
    selection.reviewer = 'autonomous';
    selection.source = 'fallback';
    context.emit({ kind: 'reviewer-defaulted', detail: detail });
    if (!differentFamilyRoute) {
      context.emit({ kind: 'local-review-surfaces' });
    }
    return true;
  }
  context.emit({ kind: 'reviewer-derivation-failed', detail: detail });
  reportNoRunnableReviewerRoute(context);
  return false;
}

/** While resuming, an unsupported explicit reviewer yields to the in-flight round's reviewer. */
function fallbackToPersistedContinueReviewer(selection: Selection, persistedContinueReviewer: string | null, context: Context): boolean {
  if (!persistedContinueReviewer || selection.reviewer === persistedContinueReviewer) { return false; }
  context.emit({ kind: 'reviewer-override-unavailable', reviewer: selection.reviewer, slug: context.slug, persistedContinueReviewer: persistedContinueReviewer });
  selection.reviewer = persistedContinueReviewer;
  selection.source = 'persisted-continue-fallback';
  return true;
}

function reportUnsupportedReviewer(selection: Selection, context: Context, detail: string | null, exhausted = false): null {
  context.emit({ kind: 'reviewer-unsupported', reviewer: selection.reviewer, eligible: context.agents.includes(selection.reviewer!), exhausted: exhausted });
  if (detail) { context.emit({ kind: 'launcher-detail', detail: detail }); }
  return reportNoRunnableReviewerRoute(context);
}

/** A non-launching validation only needs an eligible family (or the resumed reviewer). */
function validateWithoutLaunch(selection: Selection, context: Context, persistedContinueReviewer: string | null): boolean {
  if (context.agents.includes(selection.reviewer!)) { return true; }
  if (fallbackToPersistedContinueReviewer(selection, persistedContinueReviewer, context)) {
    context.emit({ kind: 'reviewer-continue-resumed', reviewer: selection.reviewer });
    return true;
  }
  reportUnsupportedReviewer(selection, context, null);
  return false;
}

function nextReviewerCandidate(excluded: Set<string>, context: Context): { fallback?: string; status: LauncherStatus | null } {
  try {
    const fallback = context.routing.nominate(excluded);
    if (fallback) { context.emit({ kind: 'agent-selection', outcome: 'nominated', fields: { agent: fallback, step: 'review', retry: true } }); }
    if (excluded.has(fallback)) { return { status: null }; }
    return { fallback, status: context.routing.launcherStatus(fallback) };
  } catch {
    return { status: null };
  }
}

/** The last resort once no further family can be nominated. */
function exhaustedReviewerRoute(selection: Selection, context: Context, reviewerStatus: LauncherStatus): boolean {
  if (!hasDifferentFamilyRoute(context) && implementerRunnable(context)) {
    logSingleFamilyFallback(context);
    selection.reviewer = context.implementer;
    selection.source = 'single-family-fallback';
    return true;
  }
  if (context.dryRun && context.implementer === 'autonomous') {
    selection.reviewer = 'autonomous';
    selection.source = 'fallback';
    context.emit({ kind: 'reviewer-dry-run-defaulted' });
    return true;
  }
  reportUnsupportedReviewer(selection, context, reviewerStatus.detail, true);
  return false;
}

/** Walk the reviewer families until one is both eligible and launchable. */
function routeRunnableReviewer(selection: Selection, context: Context, persistedContinueReviewer: string | null): boolean {
  let reviewerStatus = context.routing.launcherStatus(selection.reviewer!);
  const triedReviewers = new Set<string>();
  while (!context.agents.includes(selection.reviewer!) || !reviewerStatus.supported) {
    if (!context.agents.includes(selection.reviewer!)) {
      context.emit({ kind: 'agent-selection', outcome: 'skipped-blocked', fields: { agent: selection.reviewer, step: 'review' } });
    }
    triedReviewers.add(selection.reviewer!);
    if (selection.source === 'explicit') {
      if (fallbackToPersistedContinueReviewer(selection, persistedContinueReviewer, context)) {
        reviewerStatus = context.routing.launcherStatus(selection.reviewer!);
        continue;
      }
      reportUnsupportedReviewer(selection, context, reviewerStatus.detail);
      return false;
    }
    const candidate = nextReviewerCandidate(new Set([...triedReviewers, context.implementer]), context);
    if (!candidate.fallback) { return exhaustedReviewerRoute(selection, context, reviewerStatus); }
    context.emit({ kind: 'reviewer-fallback-routing', reviewer: selection.reviewer, eligible: context.agents.includes(selection.reviewer!), fallback: candidate.fallback });
    selection.reviewer = candidate.fallback;
    reviewerStatus = candidate.status!;
    selection.source = selection.source === 'persisted' ? 'persisted-fallback' : 'auto-derived-fallback';
  }
  return true;
}

/**
 * Resolve the reviewer for this loop: explicit, persisted, or nominated, then
 * walk the blocked/unsupported fallback chain. Null when no runnable route
 * exists; the caller stops non-zero.
 */
export function selectReviewer(
  request: ReviewerSelectionRequest,
  routing: ReviewerRoutingPort,
  output: { emit: ReviewLoopOutput['emit'] },
): ReviewerSelection | null {
  const context: Context = { ...request, routing, agents: routing.eligibleFamilies(), emit: event => output.emit(event) };
  const selection: Selection = { reviewer: request.reviewer, source: 'explicit' };
  const persistedContinueReviewer = request.isContinue && request.persisted?.reviewer ? request.persisted.reviewer : null;

  const selectErr = deriveInitialReviewer(selection, context);
  if (!selection.reviewer && !fallbackForUnnamedReviewer(selection, context, selectErr)) { return null; }

  const willLaunchRounds = request.maxAttempts >= (request.persisted?.round || 1);
  const resumesInFixingPhase = request.persisted?.phase === 'fixing' && !request.dryRun;

  let routed: boolean;
  if (selection.source === 'fallback') {
    context.emit({ kind: 'autonomous-reviewer-selected' });
    routed = true;
  } else if (resumesInFixingPhase) {
    context.emit({ kind: 'fixing-reviewer-resumed', reviewer: selection.reviewer });
    routed = true;
  } else if ((request.dryRun && selection.source === 'explicit') || !willLaunchRounds) {
    // No round will launch, so the reviewer only has to be an eligible family.
    routed = validateWithoutLaunch(selection, context, persistedContinueReviewer);
  } else {
    routed = routeRunnableReviewer(selection, context, persistedContinueReviewer);
  }
  if (!routed) { return null; }

  context.emit({ kind: 'reviewer-selected', reviewer: selection.reviewer, source: selection.source, round: request.persisted?.round || 1, isContinue: request.isContinue });
  return { reviewer: selection.reviewer!, reviewerSource: selection.source };
}
