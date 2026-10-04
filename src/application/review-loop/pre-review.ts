/**
 * Pre-review prerequisites: the rebase onto the primary branch and the declared
 * verification gate, with their repair decisions.
 *
 * A failure is repaired through one rebound-kernel occurrence (the kernel owns
 * classification, the fix prompt and the per-occurrence budget). This module
 * decides whether a repair is attempted at all (the per-round cap), which
 * lifecycle transitions bracket it, and whether the round continues.
 */
import { DEFAULT_REBOUND_ATTEMPTS, rebound, type GateFailureReason, type HookFailureReason, type ReboundOutcome, type VerifyResult } from '../rebound-kernel.js';
import { transitionReviewRepair } from '../review-repair-lifecycle.js';
import { configuredReviewerEligibility, reboundCollaborators, type LoopContext, type ReviewRound, type RoundStep } from './round.js';

export interface PreReviewRepair {
  /** True when the kernel verified the fix: the failing check re-ran and passed. */
  readonly bounced: boolean;
  readonly outcome: ReboundOutcome['outcome'];
  readonly attempts: number;
  readonly diagnostic: string;
  readonly implementer: string;
}

/**
 * Re-run the failing pre-review check: the rebase followed by the gate. A gate
 * or hook repair is reported fixed only when this passes.
 */
export async function verifyPreReviewSetup(context: LoopContext): Promise<VerifyResult> {
  const rebase = await context.ports.preReview.rebase();
  // Narrow on a literal comparison so the ok:false members resolve even when
  // this file is type-checked without strict mode (the test typecheck).
  if (rebase.ok === false) {
    return { ok: false, diagnostic: rebase.diagnostic || 'pre-review rebase still fails after the repair attempt', reason: rebase.verifyReason };
  }
  const gate = await context.ports.preReview.runGate();
  if (gate.ok !== false) { return { ok: true, diagnostic: '' }; }
  return { ok: false, diagnostic: gate.diagnostic, reason: gate.reason };
}

/**
 * Bounce one pre-review failure to the implementer and verify the repair. The
 * Mission returns to the active lane before each launch and to review once the
 * kernel verified the fix.
 */
export async function repairPreReviewFailure(
  context: LoopContext,
  reason: GateFailureReason | HookFailureReason,
  maxAttempts: number,
): Promise<PreReviewRepair> {
  const { slug, ports } = context;
  const outcome = await rebound(reason, {
    ...reboundCollaborators(context, 'implementer'),
    implementer: context.identities.implementer,
    maxAttempts,
    verify: async () => await verifyPreReviewSetup(context),
    transitionToImplementer: async () => {
      if (ports.missionStore) { await transitionReviewRepair(slug, 'active', context.identities.implementer, ports.missionStore, ports.lifecycle); }
      await ports.task.mirror('active');
    },
  });
  if (outcome.outcome === 'fixed') {
    if (ports.missionStore) { await transitionReviewRepair(slug, 'review', outcome.implementer, ports.missionStore, ports.lifecycle, configuredReviewerEligibility(context)); }
    await ports.task.mirror('review');
  }
  context.identities.implementer = outcome.implementer || context.identities.implementer;
  return { bounced: outcome.outcome === 'fixed', outcome: outcome.outcome, attempts: outcome.attempts, diagnostic: outcome.diagnostic, implementer: outcome.implementer };
}

/** Repair under the round cap; 'stop' when the round must end. */
async function repairUnderCap(context: LoopContext, round: ReviewRound, reason: GateFailureReason | HookFailureReason, occurrence: string, onStranded: (_repair: PreReviewRepair) => void): Promise<RoundStep> {
  if (round.capReached()) { return await round.stopForCap(occurrence); }
  const repair = await repairPreReviewFailure(context, reason, round.occurrenceBudget(DEFAULT_REBOUND_ATTEMPTS));
  round.used += repair.attempts ?? 0;
  if (repair.bounced) { return null; }
  if (round.capReached()) { return await round.stopForCap(occurrence); }
  onStranded(repair);
  context.exit(1);
  return 'stop';
}

/**
 * Rebase before the reviewer runs and repair its gate or hook rejection. The
 * Backlog mirror follows a successful rebase only; the database lane was
 * settled by the round-open boundary (TASK-2582).
 */
export async function runPreReviewRebase(context: LoopContext, round: ReviewRound): Promise<RoundStep> {
  const { slug, emit } = context;
  const rebase = await context.ports.preReview.rebase();
  if (rebase.ok === false) {
    if (rebase.gate) {
      // TASK-2377.02: the push-time verification gate is a gate failure even
      // when its output mentions the enclosing pre-push hook; it never consumes
      // the hook budget or the hook fix prompt.
      emit({ kind: 'rebase-gate-failed', area: rebase.gate.area, exitCode: rebase.gate.exitCode, operation: rebase.gate.operation });
      emit({ kind: 'gate-command', command: rebase.gate.command });
      const step = await repairUnderCap(context, round, rebase.gate.reason, 'pre-review gate', repair =>
        emit({ kind: 'rebase-repair-stranded', slug: slug, outcome: repair.outcome }));
      if (step) { return step; }
      emit({ kind: 'rebase-repair-verified', slug: slug });
      round.preReviewSetupVerified = true;
    }
    if (rebase.hook) {
      const step = await repairUnderCap(context, round, rebase.hook, 'pre-review hook', repair =>
        emit({ kind: 'hook-repair-stranded', outcome: repair.outcome, slug: slug }));
      if (step) { return step; }
      // The repair's verification re-ran the rebase and the gate and both
      // passed, so this round continues on the proven fix.
      emit({ kind: 'hook-repair-verified', slug: slug });
      round.preReviewSetupVerified = true;
    } else if (!round.preReviewSetupVerified) {
      // TASK-2415: only an unclassified or unrepaired failure ends the round.
      context.exit(1);
      return 'stop';
    }
  }
  round.reviewBaseline = context.ports.preReview.reviewBaseline();
  if (!context.dryRun) { await context.ports.task.mirror('review'); }
  return null;
}

/** Run the declared pre-review gate unless a repair already verified it this round. */
export async function runDeclaredPreReviewGate(context: LoopContext, round: ReviewRound): Promise<RoundStep> {
  const { slug, emit } = context;
  if (context.dryRun || round.preReviewSetupVerified) { return null; }
  const gate = await context.ports.preReview.runGate();
  if (gate.ok !== false) { return null; }
  emit({ kind: 'gate-repair-started', area: gate.area, exitCode: gate.exitCode });
  const step = await repairUnderCap(context, round, gate.reason, 'pre-review gate', repair =>
    emit({ kind: 'gate-repair-stranded', slug: slug, outcome: repair.outcome }));
  if (step) { return step; }
  // The repair re-ran the rebase and the gate, so this round resumes with the
  // verified tree rather than restarting the review setup.
  emit({ kind: 'gate-repair-verified', slug: slug });
  round.reviewBaseline = context.ports.preReview.reviewBaseline();
  await context.ports.task.mirror('review');
  return null;
}
