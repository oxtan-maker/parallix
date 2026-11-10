import { missionId, type MissionId } from '../domain/mission.js';
import { currentReviewRound } from '../domain/review.js';
import type { MissionLoadResult } from './domain-ports.js';
import type { MissionVersion } from './domain-ports.js';
import type { ReviewLivenessFacts, ReviewWorkflowFact } from './projections/review-liveness.js';
import type { ReviewLivenessReader } from './projections/review-liveness.js';

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

/** A settled admission observation, bound to the exact Mission revision it authorized. */
export interface ReviewOperatorResumePermit {
  readonly missionId: MissionId;
  readonly missionVersion: MissionVersion;
  readonly recovery: ReviewRecovery;
}

export type ReviewOperatorResumeAssessment =
  | { readonly outcome: 'not-required' }
  | { readonly outcome: 'permitted'; readonly recovery: ReviewRecovery }
  | { readonly outcome: 'refused'; readonly recovery: ReviewRecovery | null; readonly reason: string }
  | { readonly outcome: 'missing' }
  | { readonly outcome: 'unavailable'; readonly reason: string };

type FoundMission = Extract<MissionLoadResult, { readonly kind: 'found' }>;

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

/**
 * Read authoritative Mission and liveness facts before an operator resume can
 * acknowledge or clear a Review stop. Both CLI and browser admission use this
 * assessment; presentation activity is never an authorization fact.
 */
export async function assessReviewOperatorResume(
  slug: string,
  load: () => Promise<MissionLoadResult>,
  read?: ReviewLivenessReader,
  permit?: ReviewOperatorResumePermit | null,
): Promise<ReviewOperatorResumeAssessment> {
  const authority = await loadReviewAuthority(slug, load);
  if ('outcome' in authority) { return authority; }
  const loaded = authority;
  const phase = loaded.mission.review ? currentReviewRound(loaded.mission.review).phase : null;
  const humanStop = loaded.mission.review?.intervention?.reason ?? null;
  if (!reviewRecoveryApplies(phase, humanStop)) { return { outcome: 'not-required' }; }
  const admitted = assessRecoveryPermit(slug, loaded, permit);
  if (admitted) { return admitted; }
  const observation = await observeReviewLiveness(slug, read);
  const recovery = decideReviewRecovery(slug, {
    phase,
    humanStop,
    workflow: observation?.workflow,
    liveness: observation?.liveness,
  });
  if (recovery?.action === 'acknowledge-and-resume') { return { outcome: 'permitted', recovery }; }
  return {
    outcome: 'refused',
    recovery,
    reason: recovery?.guidance ?? 'Review recovery is not awaiting operator acknowledgment',
  };
}

async function loadReviewAuthority(
  slug: string,
  load: () => Promise<MissionLoadResult>,
): Promise<FoundMission | ReviewOperatorResumeAssessment> {
  let loaded: MissionLoadResult;
  try {
    loaded = await load();
  } catch (error) {
    return { outcome: 'unavailable', reason: error instanceof Error ? error.message : 'Mission authority is unavailable' };
  }
  if (loaded.kind === 'unavailable') { return { outcome: 'unavailable', reason: loaded.reason }; }
  if (loaded.kind === 'missing' || loaded.mission.id !== missionId(slug)) { return { outcome: 'missing' }; }
  return loaded;
}

function assessRecoveryPermit(
  slug: string,
  loaded: FoundMission,
  permit?: ReviewOperatorResumePermit | null,
): ReviewOperatorResumeAssessment | null {
  if (!permit) { return null; }
  if (permit.missionId !== loaded.mission.id || permit.missionVersion !== loaded.version
    || permit.recovery.action !== 'acknowledge-and-resume') {
    return { outcome: 'refused', recovery: null, reason: `Review recovery authority changed; rerun px review ${slug}` };
  }
  return { outcome: 'permitted', recovery: permit.recovery };
}

async function observeReviewLiveness(
  slug: string,
  read?: ReviewLivenessReader,
): Promise<Awaited<ReturnType<ReviewLivenessReader>> | undefined> {
  try { return await read?.(slug); }
  catch { return undefined; } // Missing observation remains unknown and fails closed.
}

function refuse(humanStop: string | null, evidence: readonly string[], guidance: string): ReviewRecovery {
  return { action: 'refuse-unconfirmed', humanStop, evidence, guidance };
}

/** The one operator-facing line every CLI surface prints for a recovery decision. */
export function describeReviewRecovery(recovery: ReviewRecovery): string {
  return `Review recovery (${recovery.action}): ${recovery.guidance} Evidence: ${recovery.evidence.join('; ')}.`;
}
