import type { ReviewLivenessFacts, ReviewWorkflowFact } from './projections/review-liveness.js';

/**
 * Recovery for an orphaned or human-stopped Review: one decision that CLI
 * status, `px review --status`, the board and the web transport render.
 *
 * Stopping workflow execution and acknowledging a Review contract stop are
 * different steps. A settled stop needs no second stop; only the human
 * acknowledgment remains, and it is never granted while owned work may live.
 */
export type ReviewRecoveryAction = 'stop-and-confirm' | 'acknowledge-and-resume' | 'refuse-unconfirmed';

export interface ReviewRecoveryFacts {
  readonly phase: string | null | undefined;
  /** The Review's recorded human-only stop reason, e.g. MAX_ATTEMPTS. */
  readonly humanStop: string | null | undefined;
  /** The open workflow operation; null when none is open. */
  readonly workflow?: ReviewWorkflowFact | null;
  /** Owner and execution probes; absent when they were not observed. */
  readonly liveness?: ReviewLivenessFacts;
}

export interface ReviewRecovery {
  readonly action: ReviewRecoveryAction;
  readonly humanStop: string | null;
  readonly evidence: readonly string[];
  readonly guidance: string;
}

const PROBES = ['workflow', 'coordinator', 'execution', 'reviewer'] as const;

/** Recovery concerns a human-stopped Review or an unsettled reviewing/fixing round. */
export function reviewRecoveryApplies(phase: string | null | undefined, humanStop: string | null | undefined): boolean {
  if (!phase || phase === 'approved') { return false; }
  return Boolean(humanStop?.trim()) || phase === 'reviewing' || phase === 'fixing';
}

function pendingStopRecovery(
  humanStop: string | null,
  workflow: ReviewWorkflowFact | null,
  stopFact: readonly string[],
): ReviewRecovery | null {
  if (workflow?.phase !== 'stopping' || !workflow.reason) { return null; }
  return refuse(humanStop, [...stopFact, `workflow operation ${workflow.id} stop is pending: ${workflow.reason}`],
    `Stop is pending for workflow operation ${workflow.id}; owned work is not confirmed settled, so the Review must not be acknowledged or resumed. ${workflow.reason}`);
}

function ownedWorkRecovery(
  slug: string,
  humanStop: string | null,
  workflow: ReviewWorkflowFact | null,
  live: readonly string[],
  stopFact: readonly string[],
): ReviewRecovery | null {
  if (!workflow && live.length === 0) { return null; }
  const evidence = [...stopFact, ...(workflow ? [`workflow operation ${workflow.id} is ${workflow.phase}`] : []), ...live.map(probe => `${probe} is live`)];
  return { action: 'stop-and-confirm', humanStop, evidence, guidance: workflow
    ? `Owned work remains (${evidence.slice(stopFact.length).join('; ')}). Stop it with px stop ${slug} or the board's Stop run and confirm settlement before resuming the Review.`
    : `Owned work remains (${evidence.slice(stopFact.length).join('; ')}) but no workflow operation owns it, so px stop cannot settle it. Let the live command finish or end it from its terminal (px history ${slug} list names it), then confirm absence with px status ${slug}.` };
}

function isVisiblyLiveRound(live: readonly string[], humanStop: string | null, workflow: ReviewWorkflowFact | null): boolean {
  return live.length > 0 && !humanStop && workflow?.phase !== 'stopping';
}

/**
 * Map authoritative facts to exactly one recovery action, or null when the
 * Review needs none (no stop recorded and its round is visibly live).
 */
export function decideReviewRecovery(slug: string, facts: ReviewRecoveryFacts): ReviewRecovery | null {
  const humanStop = facts.humanStop?.trim() || null;
  if (!reviewRecoveryApplies(facts.phase, humanStop)) { return null; }
  const workflow = facts.workflow ?? null;
  const probes = facts.liveness;
  const live = probes ? PROBES.filter(probe => probes[probe] === true) : [];
  const unknown = probes ? PROBES.filter(probe => probes[probe] === null) : [...PROBES];
  const stopFact = humanStop ? [`Review stopped for human review: ${humanStop}`] : [];
  const pendingStop = pendingStopRecovery(humanStop, workflow, stopFact);
  if (pendingStop) { return pendingStop; }
  if (isVisiblyLiveRound(live, humanStop, workflow)) { return null; }
  const ownedWork = ownedWorkRecovery(slug, humanStop, workflow, live, stopFact);
  if (ownedWork) { return ownedWork; }
  if (unknown.length > 0) {
    const evidence = [...stopFact, 'no open workflow operation', ...unknown.map(probe => `${probe} liveness unknown`)];
    return refuse(humanStop, evidence, `Absence of owned work is unconfirmed (${unknown.join(', ')} liveness unknown); do not acknowledge or resume the Review yet. Inspect px history ${slug} list and rerun px status ${slug} once every probe confirms absence.`);
  }
  const evidence = [...stopFact, 'no open workflow operation', 'no live workflow, coordinator, execution or reviewer'];
  return { action: 'acknowledge-and-resume', humanStop, evidence, guidance: humanStop
    ? `Review stopped for human review (${humanStop}) and owned work has settled, so no further stop is required. Acknowledge the stop and resume with px review ${slug} or the board's Resume review action.`
    : `Review round is orphaned and owned work has settled, so no further stop is required. Resume with px review ${slug} or the board's Resume review action.` };
}

function refuse(humanStop: string | null, evidence: readonly string[], guidance: string): ReviewRecovery {
  return { action: 'refuse-unconfirmed', humanStop, evidence, guidance };
}

/** The one operator-facing line every CLI surface prints for a recovery decision. */
export function describeReviewRecovery(recovery: ReviewRecovery): string {
  return `Review recovery (${recovery.action}): ${recovery.guidance} Evidence: ${recovery.evidence.join('; ')}.`;
}
