/**
 * Round advancement for the autonomous review loop.
 *
 * The approval half of the loop was already authoritative: an approved review
 * persists a `ReviewerDecision(kind=approved)` and fires `review → integration`
 * at the boundary. The request-changes half was not. Reviewer findings reached
 * the review-event trail only, so the aggregate kept `decision: null`, the
 * Mission never moved `review → active` through `request-changes`, no
 * implementer resolution was ever recorded, and `beginNextReviewRound` had
 * nothing to advance. A second handoff then re-submitted round 1 and the
 * workflow rejected it with "A new review round must advance the same pull
 * request or local branch".
 *
 * This module closes that half of the loop with the domain commands that
 * already exist (`applyReviewerCommand`, `applyImplementerCommand`); it adds no
 * domain type and no second state machine.
 */

import type { MissionStore } from '../../application/domain-ports.js';
import type { MissionLifecycleService } from '../../application/mission-lifecycle-service.js';
import { missionId } from '../../domain/mission.js';
import {
  applyImplementerCommand,
  applyReviewerCommand,
  changeRevision,
  currentReviewRound,
  reviewFindingId,
  reviewStatus,
  type FindingResolution,
  type ReviewApprovalSource,
  type ReviewDisposition,
  type ReviewFinding,
  type ReviewItemDisposition,
} from '../../domain/review.js';

export type ReviewRoundResult =
  | { outcome: 'recorded' }
  /** Already recorded, or nothing to record. Replaying a round is not an error. */
  | { outcome: 'unchanged'; reason: string }
  | { outcome: 'failed'; diagnostic: string };

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

function diagnosticFrom(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) { return error.message.trim(); }
  const text = String(error || '').trim();
  return text || fallback;
}

export interface ReviewRoundPorts {
  missionStore?: MissionStore | null;
  lifecycleService?: MissionLifecycleService | null;
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
    comment: string | null;
    decidedAt: string;
    disposition?: ReviewDisposition;
  },
  ports: ReviewRoundPorts = {},
): Promise<ReviewRoundResult> {
  const store = ports.missionStore ?? null;
  if (!store) { return { outcome: 'failed', diagnostic: `Operator database unavailable for ${slug}` }; }
  const disposition = input.disposition && CHANGES_REQUESTED_DISPOSITIONS.includes(input.disposition)
    ? input.disposition
    : 'REQUEST_CHANGES';
  try {
    const loaded = await store.load(missionId(slug));
    if (loaded.kind !== 'found') { return { outcome: 'failed', diagnostic: `Mission ${slug} is not in the operator database` }; }
    const mission = loaded.mission;
    if (!('review' in mission) || !mission.review) {
      return { outcome: 'failed', diagnostic: `Mission ${slug} has no review to decide; px handoff starts the review` };
    }
    if (reviewStatus(mission.review) !== 'awaiting-review') {
      return { outcome: 'unchanged', reason: `review is ${reviewStatus(mission.review)}` };
    }
    if (input.findings.length === 0) {
      return { outcome: 'failed', diagnostic: `Reviewer requested changes for ${slug} without a parsable finding (expected a "## F1: ..." heading)` };
    }

    const review = applyReviewerCommand(mission.review, {
      type: 'request-changes',
      decidedAt: input.decidedAt,
      comment: input.comment,
      findings: input.findings,
      ...(disposition === 'REQUEST_CHANGES' ? {} : { disposition: disposition as Exclude<ReviewDisposition, 'APPROVED' | 'CHANGES_MADE'> }),
    });
    const version = await store.save({ ...mission, review }, loaded.version);

    // The mirror of the approval boundary: the decision is what moves the lane,
    // so the Mission returns to `active` at the reviewer's decision time.
    if (ports.lifecycleService && mission.status === 'review') {
      const transition = await ports.lifecycleService.transition({
        operationId: `review-request-changes:${slug}`,
        missionId: missionId(slug),
        expectedVersion: version,
        capabilities: new Set(['mission:transition']),
        command: { type: 'request-changes', review },
        actor: currentReviewRound(review).reviewer,
        occurredAt: input.decidedAt,
        idempotencyKey: `request-changes:${slug}:${input.decidedAt}`,
      });
      if (transition.status !== 'completed') {
        return {
          outcome: 'failed',
          diagnostic: `review → active transition failed for ${slug}: ${transition.error?.message ?? 'unknown failure'}`,
        };
      }
    }
    return { outcome: 'recorded' };
  } catch (error) {
    return { outcome: 'failed', diagnostic: diagnosticFrom(error, 'Reviewer decision write failed') };
  }
}

/**
 * The single source of truth for the diagnostic printed when an `approve`
 * cannot legally move the current round to `approved`. Shared by the
 * non-mutating {@link approvalLegalDiagnostic} pre-check and the write-time
 * check in {@link recordApproval}, so a future wording change to one cannot
 * make the pre-POST failure and the record-time failure diverge for the same
 * condition.
 */
function approvalBlockedDiagnostic(status: string): string {
  return `Approve cannot move the round to approved while review is ${status}; resolve the outstanding findings with a resolution, open the next round with \`px handoff\`, and approve that awaiting-review round (see MISSION.md "Repair path for a round already stuck in the inconsistent state")`;
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
    const status = reviewStatus(mission.review);
    if (status !== 'awaiting-review' && status !== 'approved') {
      return approvalBlockedDiagnostic(status);
    }
    return null;
  } catch {
    return null; // a read miss surfaces as a rejection at record time, not here
  }
}
/**
 * Record the reviewer's authoritative `approve` decision and return the mission
 * to integration.
 *
 * The mirror of {@link recordRequestedChanges}: `approve` is a domain decision,
 * not only a provider comment, and it is what leaves review through the
 * approval boundary that `px integrate` gates on (`recoveryEstablishesApproval`
 * requires `lastRound.decision.kind === 'approved'`). The flat review-state
 * write cannot express it, because a flattened approve against a non-`reviewing`
 * round silently swallowed the phase transition and left `disposition`
 * `APPROVED` over a `changes-requested` decision.
 *
 * Idempotent: a replayed approve on an already-approved round reports
 * `unchanged` instead of rewriting the decision. An approve that cannot legally
 * move the current round to `approved` (for example a round still in `fixing`
 * after a request-changes) fails loudly with a diagnostic naming the illegal
 * transition rather than writing `disposition === 'APPROVED'` over a
 * `changes-requested` decision.
 */
export async function recordApproval(
  slug: string,
  input: {
    comment: string | null;
    decidedAt: string;
    source?: ReviewApprovalSource;
  },
  ports: ReviewRoundPorts = {},
): Promise<ReviewRoundResult> {
  const store = ports.missionStore ?? null;
  if (!store) { return { outcome: 'failed', diagnostic: `Operator database unavailable for ${slug}` }; }
  const source: ReviewApprovalSource = input.source ?? { kind: 'local' };
  try {
    const loaded = await store.load(missionId(slug));
    if (loaded.kind !== 'found') { return { outcome: 'failed', diagnostic: `Mission ${slug} is not in the operator database` }; }
    const mission = loaded.mission;
    if (!('review' in mission) || !mission.review) {
      return { outcome: 'failed', diagnostic: `Mission ${slug} has no review to approve; px handoff starts the review` };
    }
    const status = reviewStatus(mission.review);
    if (status === 'approved') {
      return { outcome: 'unchanged', reason: `review is already ${status}` };
    }
    if (status !== 'awaiting-review') {
      // The round cannot legally reach `approved` from here (REVIEW_PHASE_TRANSITIONS
      // allows `fixing -> reviewing | pending-approval` only). Fail loudly instead
      // of writing `disposition === 'APPROVED'` over a `changes-requested`
      // decision, which is what leaves the mission permanently unintegratable.
      // The diagnostic names the documented resolution → new round → approve
      // sequence, not `px integrate`, which cannot repair a `fixing` round.
      return {
        outcome: 'failed',
        diagnostic: approvalBlockedDiagnostic(status),
      };
    }
    const review = applyReviewerCommand(mission.review, {
      type: 'approve',
      decidedAt: input.decidedAt,
      comment: input.comment,
      source,
    });
    const version = await store.save({ ...mission, review }, loaded.version);

    // The mirror of the request-changes boundary: the authoritative decision is
    // what moves the lane, so the Mission returns to `integration` at the
    // reviewer's decision time.
    if (ports.lifecycleService && mission.status === 'review') {
      const transition = await ports.lifecycleService.transition({
        operationId: `review-approve:${slug}`,
        missionId: missionId(slug),
        expectedVersion: version,
        capabilities: new Set(['mission:transition']),
        command: { type: 'approve', review },
        actor: currentReviewRound(review).reviewer,
        occurredAt: input.decidedAt,
        idempotencyKey: `approve:${slug}:${input.decidedAt}`,
      });
      if (transition.status !== 'completed') {
        return {
          outcome: 'failed',
          diagnostic: `review → integration transition failed for ${slug}: ${transition.error?.message ?? 'unknown failure'}`,
        };
      }
    }
    return { outcome: 'recorded' };
  } catch (error) {
    return { outcome: 'failed', diagnostic: diagnosticFrom(error, 'Approval write failed') };
  }
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
 * handoff needs in order to open round N+1 on the same pull request.
 */
export async function recordImplementerResolution(
  slug: string,
  input: {
    itemDispositions: readonly ReviewItemDisposition[];
    evidence: string;
    resultingRevision: string;
    respondedAt: string;
  },
  ports: ReviewRoundPorts = {},
): Promise<ReviewRoundResult> {
  const store = ports.missionStore ?? null;
  if (!store) { return { outcome: 'failed', diagnostic: `Operator database unavailable for ${slug}` }; }
  try {
    const loaded = await store.load(missionId(slug));
    if (loaded.kind !== 'found') { return { outcome: 'failed', diagnostic: `Mission ${slug} is not in the operator database` }; }
    const mission = loaded.mission;
    if (!('review' in mission) || !mission.review) {
      return { outcome: 'failed', diagnostic: `Mission ${slug} has no review to resolve` };
    }
    if (reviewStatus(mission.review) !== 'awaiting-implementation') {
      return { outcome: 'unchanged', reason: `review is ${reviewStatus(mission.review)}` };
    }
    const decision = currentReviewRound(mission.review).decision;
    const findings = decision?.kind === 'changes-requested' ? decision.findings : [];
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
    return { outcome: 'failed', diagnostic: diagnosticFrom(error, 'Implementer resolution write failed') };
  }
}
