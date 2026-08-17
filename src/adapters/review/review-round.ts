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
