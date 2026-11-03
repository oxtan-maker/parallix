/**
 * Round advancement for the autonomous review loop.
 *
 * The approval half of the loop was already authoritative: an approved review
 * persists a `ReviewerDecision(kind=approved)` and fires `review → integration`
 * at the boundary. The request-changes half was not. Reviewer findings reached
 * the review-event trail only, so the aggregate kept `decision: null`, the
 * Mission never moved `review → active` through `request-changes`, no
 * implementer resolution was ever recorded, and `beginNextReviewRound` had
 * nothing to advance. A second review preparation then re-submitted round 1 and the
 * workflow rejected it with "A new review round must advance the same pull
 * request or local branch".
 *
 * This module closes that half of the loop with the domain commands that
 * already exist (`applyReviewerCommand`, `applyImplementerCommand`); it adds no
 * domain type and no second state machine.
 */

import { applyOperatorCorrection } from '../../domain/operator-review-correction.js';
import { WorkflowOwnershipError } from '../../domain/workflow-operation.js';
import { settleRequestedChanges } from './review-request-changes-transition.js';
import { verdictBlockForReview, type VerdictBlock } from '../../application/review-verdict-readiness.js';
import { readReviewForDecision, type ReviewRoundObservation } from './review-round-read.js';
import { isStaleWrite, type MissionStore, type MissionVersion } from '../../application/domain-ports.js';
import type { MissionLifecycleService } from '../../application/mission-lifecycle-service.js';
import { missionId, type Mission } from '../../domain/mission.js';
import { requireReviewIdentity } from '../../domain/mission-workflow.js';
import {
  applyImplementerCommand,
  applyReviewerCommand,
  changeRevision,
  currentReviewRound,
  reviewFindingId,
  reviewStatus,
  type FindingResolution,
  type ReviewApprovalSource,
  type OperatorReviewSource,
  type ReviewDisposition,
  type ReviewFinding,
  type ReviewItemDisposition,
  type Review,
} from '../../domain/review.js';

/**
 * Reject a write whose caller read an older Mission than the one on disk.
 *
 * The review recorders load-modify-save, so without this an agent that read
 * version N could land a decision after another mutation reached N+1 and never
 * be told. Callers that supply no expected version keep the previous behaviour;
 * the agent-facing verbs always supply one.
 */

export type ReviewRoundResult =
  | { outcome: 'recorded' }
  /** Already recorded, or nothing to record. Replaying a round is not an error. */
  | { outcome: 'unchanged'; reason: string; noRevisionChange?: boolean }
  | { outcome: 'failed'; diagnostic: string; kind?: 'stale-write'; workflowBlock?: VerdictBlock };

/** Reviewer verdicts that carry the `changes-requested` decision kind. */
const CHANGES_REQUESTED_DISPOSITIONS: readonly ReviewDisposition[] =
  ['REQUEST_CHANGES', 'COMMENT', 'PUSHBACK_ALL', 'BLOCKED', 'PARKED'];

/**
 * Finding headings in a reviewer findings document.
 *
 * Reviewers write `## F1 (blocking): summary`; the id and the summary are the
 * two parts the domain needs, and the parenthetical severity is dropped rather
 * than modelled — `ReviewFinding` has no severity field.
 */
const FINDING_HEADING = /^#{2,4}\s*(F\d+[a-z]?)\b\s*(?:\([^)]*\))?\s*[:.—-]?\s*(.*)$/gim;

export function parseReviewFindings(markdown: string): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const seen = new Set<string>();
  FINDING_HEADING.lastIndex = 0;
  for (const match of markdown.matchAll(FINDING_HEADING)) {
    const id = match[1].toUpperCase();
    const summary = match[2].replace(/[`*]/g, '').trim();
    if (!summary || seen.has(id)) { continue; }
    seen.add(id);
    findings.push({ id: reviewFindingId(id), summary, location: null });
  }
  return findings;
}

/** Preserve actual findings or a reviewer's plain-text change request. */
export function reviewFindingsFromMessage(message: string): ReviewFinding[] {
  const parsed = parseReviewFindings(message);
  const summary = message.split('\n').find(line => line.trim())?.trim();
  return parsed.length > 0 || !summary ? parsed : [{ id: reviewFindingId('F1'), summary, location: null }];
}

function diagnosticFrom(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) { return error.message.trim(); }
  const text = String(error || '').trim();
  return text || fallback;
}

export interface ReviewRoundPorts {
  missionStore?: MissionStore | null;
  lifecycleService?: Pick<MissionLifecycleService, 'transition'> | null;
}

/**
 * Record the reviewer's request-changes decision and hand the mission back to
 * the implementer.
 *
 * Idempotent: a replayed artifact consumption finds the round already decided
 * and reports `unchanged` instead of rewriting the decision.
 */
export async function recordRequestedChanges(
  slug: string,
  input: {
    findings: readonly ReviewFinding[];
    source?: OperatorReviewSource;
    comment: string | null;
    revision?: string | null;
    decidedAt: string;
    disposition?: ReviewDisposition;
    /** Mission version the caller read; a mismatch fails closed. */
    expectedVersion?: number;
    observedRound?: ReviewRoundObservation;
  },
  ports: ReviewRoundPorts = {},
): Promise<ReviewRoundResult> {
  const store = ports.missionStore ?? null;
  if (!store) { return { outcome: 'failed', diagnostic: `Operator database unavailable for ${slug}` }; }
  const disposition = changesRequestedDisposition(input.disposition);
  try {
    const loaded = await readReviewForDecision(slug, store, input.expectedVersion, 'decide', input.observedRound);
    if (loaded.kind === 'failed') { return loaded.result; }
    const mission = loaded.mission;
    if (input.source) {
      const review = applyOperatorCorrection(mission.review, { ...input, source: input.source });
      const version = review === mission.review ? loaded.version : await store.save({ ...mission, review }, loaded.version);
      return await settleRequestedChanges(slug, { ...mission, review }, version, ports, input.source.author);
    }

    if (!mission.review.intervention && currentReviewRound(mission.review).decision?.kind === 'changes-requested') {
      return await settleRequestedChanges(slug, mission, loaded.version, ports);
    }

    const rejected = requestedChangesRejection(slug, mission.review, input.findings);
    if (rejected) { return rejected; }

    const review = applyReviewerCommand(mission.review, {
      type: 'request-changes',
      decidedAt: input.decidedAt,
      revision: typeof input.revision === 'string' ? changeRevision(input.revision) : null,
      comment: input.comment,
      findings: input.findings,
      ...(disposition === 'REQUEST_CHANGES' ? {} : { disposition: disposition }),
    });
    const version = await store.save({ ...mission, review }, loaded.version);

    return await settleRequestedChanges(slug, { ...mission, review }, version, ports);
  } catch (error) {
    return roundWriteFailure(error, 'Reviewer decision write failed');
  }
}

function requestedChangesRejection(slug: string, review: Review, findings: readonly ReviewFinding[]): ReviewRoundResult | null {
  if (review.intervention && reviewStatus(review) !== 'approved') {
    const workflowBlock = verdictBlockForReview(slug, review)!;
    return { outcome: 'failed', diagnostic: workflowBlock.diagnostic, workflowBlock };
  }
  if (reviewStatus(review) !== 'awaiting-review') {
    return { outcome: 'unchanged', reason: `review is ${reviewStatus(review)}` };
  }
  if (findings.length === 0) {
    return { outcome: 'failed', diagnostic: `Reviewer requested changes for ${slug} without a parsable finding (expected a "## F1: ..." heading)` };
  }

  return null;
}

/**
 * The TASK-2582 mismatch: an approval whose Mission is not in the review lane
 * cannot complete the `review → integration` boundary. The diagnostic names
 * the recorded lane state and the two supported repairs: open the round so
 * the Mission returns to review, or recover an already-approved round through
 * `px integrate` (TASK-2397).
 */
function approvalLaneDiagnostic(slug: string, status: string): string {
  return `The Mission is ${status}, not review; the review → integration boundary cannot complete from ${status}. Open the round with \`px review ${slug}\` so the Mission returns to review, or recover an already-approved round with \`px integrate ${slug}\`.`;
}

/**
 * Non-mutating legality guard for an `approve` verdict, backing
 * {@link recordApproval} and the provider-backed pre-check in
 * `submitReviewRound`.
 *
 * Returns `null` when the approve can legally proceed (the round is
 * `awaiting-review`) or is already settled (`approved`); otherwise a diagnostic
 * naming the illegal transition. It deliberately performs no write: the caller
 * uses it to fail a provider-backed approve *before* the external POST, so a
 * failed POST never leaves an authoritative approval behind that `px integrate`
 * would merge with no approval on the pull request. The authoritative
 * {@link recordApproval} still performs the same check at the point of recording.
 */
export async function approvalLegalDiagnostic(
  slug: string,
  ports: { missionStore?: MissionStore | null },
): Promise<string | null> {
  const store = ports.missionStore ?? null;
  if (!store) { return null; } // no authority: recordApproval rejects at write time
  try {
    const loaded = await store.load(missionId(slug));
    if (loaded.kind !== 'found') { return null; }
    const mission = loaded.mission;
    if (!('review' in mission) || !mission.review) { return null; }
    requireReviewIdentity(mission, mission.review);
    const status = reviewStatus(mission.review);
    if (status !== 'awaiting-review' && status !== 'approved') {
      return verdictBlockForReview(slug, mission.review)!.diagnostic;
    }
    return null;
  } catch (error) {
    return diagnosticFrom(error, 'Cannot verify independent approval');
  }
}

function blockedApproval(slug: string, review: Review): ReviewRoundResult {
  const workflowBlock = verdictBlockForReview(slug, review)!;
  return { outcome: 'failed', diagnostic: workflowBlock.diagnostic, workflowBlock };
}

/**
 * Record authoritative approval and its Mission lifecycle boundary.
 * Provider callers invoke this after a successful POST. A replay settles the
 * boundary without rewriting the original decision time. Illegal phases and
 * stale observations fail before mutation; active repair uses the atomic move.
 */
export async function recordApproval(
  slug: string,
  input: {
    comment: string | null;
    revision?: string | null;
    decidedAt: string;
    source?: ReviewApprovalSource;
    /** Mission version the caller read; a mismatch fails closed. */
    expectedVersion?: number;
    observedRound?: ReviewRoundObservation;
  },
  ports: ReviewRoundPorts = {},
): Promise<ReviewRoundResult> {
  const store = ports.missionStore ?? null;
  if (!store) { return { outcome: 'failed', diagnostic: `Operator database unavailable for ${slug}` }; }
  const source: ReviewApprovalSource = input.source ?? { kind: 'local' };
  try {
    const loaded = await readReviewForDecision(slug, store, input.expectedVersion, 'approve', input.observedRound);
    if (loaded.kind === 'failed') { return loaded.result; }
    const mission = loaded.mission;
    const status = reviewStatus(mission.review);
    requireReviewIdentity(mission, mission.review);
    if (status === 'approved') {
      // The decision is already recorded, but the review → integration boundary
      // may have failed after it was saved. Replaying the approve finishes that
      // transition instead of leaving the mission parked in review forever.
      return await replayApprovalTransition(slug, input.decidedAt, mission, loaded.version, ports)
        ?? { outcome: 'unchanged', reason: `review is already ${status}` };
    }
    if (status !== 'awaiting-review') {
      // The round cannot legally reach `approved` from here (REVIEW_PHASE_TRANSITIONS
      // allows `fixing -> reviewing | pending-approval` only). Fail loudly instead
      // of writing `disposition === 'APPROVED'` over a `changes-requested`
      // decision, which is what leaves the mission permanently unintegratable.
      // The diagnostic names the documented resolution → new round → approve
      // sequence, not `px integrate`, which cannot repair a `fixing` round.
      return blockedApproval(slug, mission.review);
    }
    if (!['review', 'integration', 'active'].includes(mission.status)) {
      // TASK-2582: an approve recorded over a Mission that is not in the review
      // lane is the TASK-2579 mismatch. Fail before writing the decision
      // instead of reporting `recorded` over a Mission the boundary cannot
      // move.
      return {
        outcome: 'failed',
        diagnostic: `Approve cannot be recorded for ${slug}: ${approvalLaneDiagnostic(slug, mission.status)}`,
      };
    }
    const review = applyReviewerCommand(mission.review, {
      type: 'approve',
      decidedAt: input.decidedAt,
      revision: typeof input.revision === 'string' ? changeRevision(input.revision) : null,
      comment: input.comment,
      source,
    });
    if (mission.status === 'active') {
      return await approveRepairedActiveLane(slug, input.decidedAt, loaded.version, review, ports);
    }
    const version = await store.save({ ...mission, review }, loaded.version);
    return await transitionApprovedReview(slug, input.decidedAt, mission, version, review, ports) ?? { outcome: 'recorded' };
  } catch (error) {
    return roundWriteFailure(error, 'Approval write failed');
  }
}

/**
 * TASK-2514: approve the awaiting-review round of a Mission whose lane a manual
 * repair left active. The decision and the `active → integration` move commit
 * in one lifecycle transition, so a refused transition never leaves an approval
 * attached to an active Mission (the TASK-2579 shape).
 */
async function approveRepairedActiveLane(
  slug: string,
  decidedAt: string,
  version: MissionVersion,
  review: Review,
  ports: ReviewRoundPorts,
): Promise<ReviewRoundResult> {
  if (!ports.lifecycleService) {
    return { outcome: 'failed', diagnostic: `Approve cannot be recorded for ${slug}: the Mission is active and no lifecycle service is bound to move it to integration` };
  }
  const round = currentReviewRound(review);
  const transition = await ports.lifecycleService.transition({
    operationId: `review-approve:${slug}`,
    missionId: missionId(slug), expectedVersion: version, capabilities: new Set(['mission:transition']),
    command: { type: 'approve', review }, actor: round.reviewer, occurredAt: decidedAt,
    idempotencyKey: `approve:${slug}:round-${round.number}`,
  });
  if (transition.status === 'completed') { return { outcome: 'recorded' }; }
  return { outcome: 'failed', diagnostic: `active → integration transition failed for ${slug}: ${transition.error?.message ?? 'unknown failure'}` };
}

async function transitionApprovedReview(
  slug: string,
  decidedAt: string,
  mission: Mission,
  version: MissionVersion,
  review: Review,
  ports: ReviewRoundPorts,
): Promise<ReviewRoundResult | null> {
  // TASK-2582: the approval may not report success from a lane the
  // `review → integration` boundary cannot leave. `integration` is already the
  // destination, so the recorded decision stands with no lane move.
  if (mission.status !== 'review' && mission.status !== 'integration') {
    return {
      outcome: 'failed',
      diagnostic: `review → integration transition failed for ${slug}: ${approvalLaneDiagnostic(slug, mission.status)}`,
    };
  }
  if (!ports.lifecycleService || mission.status !== 'review') { return null; }
  const round = currentReviewRound(review);
  const transition = await ports.lifecycleService.transition({
    operationId: `review-approve:${slug}`,
    missionId: missionId(slug), expectedVersion: version, capabilities: new Set(['mission:transition']),
    command: { type: 'approve', review }, actor: round.reviewer, occurredAt: decidedAt,
    idempotencyKey: `approve:${slug}:round-${round.number}`,
  });
  if (transition.status === 'completed') { return null; }
  return { outcome: 'failed', diagnostic: `review → integration transition failed for ${slug}: ${transition.error?.message ?? 'unknown failure'}` };
}

async function replayApprovalTransition(
  slug: string,
  decidedAt: string,
  mission: Mission,
  version: MissionVersion,
  ports: ReviewRoundPorts,
): Promise<ReviewRoundResult | null> {
  if (!('review' in mission) || !mission.review) { return null; }
  // TASK-2582: a replay over a Mission that never reached the review lane is
  // the TASK-2579 stranded shape. It fails loudly instead of reporting the
  // approval as already handled.
  if (mission.status === 'integration') {
    return { outcome: 'unchanged', reason: 'mission is already in integration' };
  }
  if (mission.status !== 'review') {
    return {
      outcome: 'failed',
      diagnostic: `review → integration replay failed for ${slug}: ${approvalLaneDiagnostic(slug, mission.status)}`,
    };
  }
  if (!ports.lifecycleService) { return null; }
  const round = currentReviewRound(mission.review);
  const transition = await ports.lifecycleService.transition({
    operationId: `review-approve:${slug}`,
    missionId: missionId(slug),
    expectedVersion: version,
    capabilities: new Set(['mission:transition']),
    command: { type: 'approve', review: mission.review },
    actor: round.reviewer,
    occurredAt: round.decision?.decidedAt ?? decidedAt,
    idempotencyKey: `approve:${slug}:round-${round.number}`,
  });
  if (transition.status === 'completed') { return { outcome: 'recorded' }; }
  return {
    outcome: 'failed',
    diagnostic: `review → integration transition failed for ${slug}: ${transition.error?.message ?? 'unknown failure'}`,
  };
}

/**
 * Every finding of the decided round, resolved.
 *
 * `pushed_back` and `parked` are the implementer disputing the finding, which
 * is what `disputed` means in the domain; anything the implementer's artifact
 * did not classify is recorded as fixed against the round summary, because the
 * implementer handed the round back rather than escalating.
 */
function resolutionsFor(
  findings: readonly ReviewFinding[],
  itemDispositions: readonly ReviewItemDisposition[],
  evidence: string,
): FindingResolution[] {
  const classified = new Map(itemDispositions.map((item) => [String(item.findingId).toUpperCase(), item.kind]));
  return findings.map((finding) => {
    const kind = classified.get(String(finding.id).toUpperCase());
    if (kind === 'pushed_back' || kind === 'parked') {
      return { findingId: finding.id, kind: 'disputed' as const, rationale: `${kind}: ${evidence}` };
    }
    return { findingId: finding.id, kind: 'fixed' as const, evidence };
  });
}

/**
 * Record the implementer's resolution of the decided round.
 *
 * After this the review is `ready-for-next-round`, which is what the next
 * review preparation needs in order to open round N+1 on the same pull request.
 */
export async function recordImplementerResolution(
  slug: string,
  input: {
    itemDispositions: readonly ReviewItemDisposition[];
    evidence: string;
    resultingRevision: string;
    respondedAt: string;
    /** Mission version the caller read; a mismatch fails closed. */
    expectedVersion?: number;
    observedRound?: ReviewRoundObservation;
  },
  ports: ReviewRoundPorts = {},
): Promise<ReviewRoundResult> {
  const store = ports.missionStore ?? null;
  if (!store) { return { outcome: 'failed', diagnostic: `Operator database unavailable for ${slug}` }; }
  try {
    const loaded = await readReviewForDecision(slug, store, input.expectedVersion, 'resolve', input.observedRound);
    if (loaded.kind === 'failed') { return loaded.result; }
    const mission = loaded.mission;
    if (reviewStatus(mission.review) !== 'awaiting-implementation') {
      return { outcome: 'unchanged', reason: `review is ${reviewStatus(mission.review)}` };
    }
    const currentRound = currentReviewRound(mission.review);
    const decision = currentRound.decision;
    const findings = decision?.kind === 'changes-requested' ? decision.findings : [];
    // TASK-2478/criterion 8: an implementer resolution whose resulting revision
    // equals the round's subject revision means the finding was NOT addressed.
    // Reject it here, before recording, so the round never becomes
    // ready-for-next-round on the unchanged tree (a later resume could otherwise
    // open round 2 on the original revision and approve the finding).
    if (input.resultingRevision && input.resultingRevision === currentRound.subject.revision) {
      return { outcome: 'unchanged', reason: 'resulting revision did not change from the round subject revision', noRevisionChange: true };
    }
    const evidence = input.evidence.trim() || `Round resolution for ${slug}`;
    const review = applyImplementerCommand(mission.review, {
      type: 'submit-resolution',
      respondedAt: input.respondedAt,
      resolutions: resolutionsFor(findings, input.itemDispositions, evidence),
      resultingRevision: changeRevision(input.resultingRevision),
    });
    await store.save({ ...mission, review }, loaded.version);
    return { outcome: 'recorded' };
  } catch (error) {
    return roundWriteFailure(error, 'Implementer resolution write failed');
  }
}

function isChangesRequestedDisposition(value: ReviewDisposition): value is Exclude<ReviewDisposition, 'APPROVED' | 'CHANGES_MADE'> {
  return CHANGES_REQUESTED_DISPOSITIONS.includes(value);
}
function changesRequestedDisposition(value: ReviewDisposition | undefined): Exclude<ReviewDisposition, 'APPROVED' | 'CHANGES_MADE'> {
  return value && isChangesRequestedDisposition(value) ? value : 'REQUEST_CHANGES';
}

function roundWriteFailure(error: unknown, fallback: string): ReviewRoundResult {
  if (error instanceof WorkflowOwnershipError) { throw error; }
  return { outcome: 'failed', diagnostic: diagnosticFrom(error, fallback), ...(isStaleWrite(error) ? { kind: 'stale-write' as const } : {}) };
}
