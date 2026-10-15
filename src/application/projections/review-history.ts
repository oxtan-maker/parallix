import { parseResolutionDispositions, type Review, type ReviewDisposition } from '../../domain/review.js';
import type { ReviewRoundSummary } from './mission-board.js';

function outcomeComment(content: string): string | null {
  const summary = content.match(/(?:^|\n)## Summary[^\S\n]*\n+([^\n]+)/);
  if (summary?.[1]) { return summary[1].trim(); }
  const lines = content.split('\n').map((line) => line.trim());
  const outcome = lines.findIndex((line) => /^Outcome:\s*/i.test(line));
  if (outcome >= 0) {
    const next = lines.slice(outcome + 1).find((line) => line && !line.startsWith('#'));
    if (next) { return next; }
    // Verdict inline on Outcome line (e.g. "Outcome: request-changes")
    const inline = lines[outcome].replace(/^Outcome:\s*/i, '').trim();
    if (inline) { return inline; }
  }
  return null;
}

function findingSummaries(content: string): readonly string[] {
  return content.split('\n').flatMap((line) => {
    const trimmed = line.trim();
    if (!trimmed) { return []; }
    // `\b` after the keyword is load-bearing: without it `Finding` matches the
    // prefix of `Findings`, `[^—]*` eats the rest, and a findings document's own
    // title ("# Findings — <slug> (round 1)") is reported as a finding.
    //
    // Linear by construction: `[^—]*` cannot cross the em dash, so there is one
    // split point, and it already covers an optional finding number. Leading
    // whitespace is trimmed here rather than matched with a `\s*` that would
    // overlap the capture.
    const heading = trimmed.match(/^#{1,3}\s+Finding\b[^—]*—(.*)$/i);
    const headingSummary = heading?.[1]?.trim();
    if (headingSummary) { return [headingSummary]; }
    const numbered = trimmed.match(/^\d+\.\s+\*\*(?:\[[^\]]+\][^\S\n]*)?(\S.*?)\*\*/);
    if (numbered?.[1]) { return [numbered[1]]; }
    // Raw finding line: "path:line:", "path:Lline:" or a line range
    // "path:L10-L20:" (🔴/🟡 type: description)
    const raw = trimmed.match(/^[^:]+:L?\d+(?:-L?\d+)?:\s*(\S.*)$/);
    if (raw?.[1]) { return [raw[1]]; }
    // Same line shape with a subject that has no line number — reviewers scope
    // findings to a command or a whole file too ("px status <slug>: 🔴 ...").
    // Anchored on the severity marker so ordinary prose is not a finding.
    const scoped = trimmed.match(/^[^:]+:\s*((?:🔴|🟡|🟠|🔵|⚪)\s*\S.*)$/u);
    if (scoped?.[1]) { return [scoped[1]]; }
    return [];
  });
}

function outcomeDisposition(verdict: string | null): ReviewDisposition | null {
  return verdict?.toLowerCase() === 'request-changes' ? 'REQUEST_CHANGES' : null;
}

export function projectReviewHistory(review: Review | null): readonly ReviewRoundSummary[] {
  if (!review) { return []; }
  return review.rounds.map((round) => {
    const events = review.reviewEvents.filter((event) => event.roundNumber === round.number);
    const outcome = [...events].reverse().find((event) => event.eventType === 'reviewer_outcome');
    const findings = [...events].reverse().find((event) => event.eventType === 'reviewer_findings');
    const summary = [...events].reverse().find((event) => event.eventType === 'implementer_round_summary');
    const humanNotes = events
      .filter((event) => event.eventType === 'human_note' && event.content.trim())
      .map((event) => `Human feedback from ${event.actor ?? 'operator'}: ${event.content}`);
    const { resolutions, hasResolutions, items } = roundResolutions(round, summary);

    return {
      ...roundAssessment(round),
      number: round.number,
      ...roundRevisions(round),
      reviewer: round.reviewer,
      implementer: round.implementer,
      phase: round.phase,
      disposition: round.disposition === 'CHANGES_MADE'
        ? outcomeDisposition(outcome?.verdict ?? null) ?? round.disposition
        : round.disposition,
      comment: round.decision?.comment ?? outcomeComment(outcome?.content ?? ''),
      findingSummaries: round.decision?.kind === 'changes-requested'
        ? [...round.decision.findings.map((finding) => finding.summary), ...humanNotes]
        : findings ? [...findingSummaries(findings.content), ...humanNotes] : humanNotes,
      pushbacks: hasResolutions
        ? resolutions.filter((r) => r.kind === 'disputed')
          .map((r) => `${r.findingId}: ${r.rationale}`)
        : items.filter((d) => d.kind === 'pushed_back')
          .map((d) => String(d.findingId)),
      fixes: hasResolutions
        ? resolutions.filter((r) => r.kind === 'fixed')
          .map((r) => `${r.findingId}: ${r.evidence}`)
        : items.filter((d) => d.kind === 'fixed')
          .map((d) => String(d.findingId)),
      ...roundApprovalHistory(round),
    };
  });
}

type HistoryRound = Review['rounds'][number];
type HistoryEvent = Review['reviewEvents'][number];
function roundResolutions(round: HistoryRound, summary: HistoryEvent | undefined) {
  const resolutions = round.response?.resolutions;
  const hasResolutions = resolutions && resolutions.length > 0;

  // itemDispositions is populated from the implementer's round summary
  // artifact. response.resolutions is the formal domain model path.
  // Use itemDispositions as fallback when resolutions are not set. A summary
  // stored before the artifact consumer parsed Markdown sections carries no
  // dispositions, so the summary content itself is the last fallback.
  const storedItems = round.itemDispositions ?? summary?.itemDispositions ?? [];
  const items = hasResolutions
    ? []
    : storedItems.length > 0
      ? storedItems
      : summary ? parseResolutionDispositions(summary.content) : [];

  return { resolutions: resolutions ?? [], hasResolutions, items };
}
function roundAssessment(round: HistoryRound) {
  return round.integrationRepairAssessment ? { integrationRepairAssessment: round.integrationRepairAssessment } : {};
}
function roundApprovalHistory(round: HistoryRound) {
  return {
    ...(round.decision?.kind === 'approved' && round.decision.revocation
      ? { revocation: { by: round.decision.revocation.revokedBy, reason: round.decision.revocation.reason, at: round.decision.revocation.revokedAt } }
      : {}),
    ...(round.decision?.kind === 'approved' && round.decision.supersession
      ? { supersession: { revision: round.decision.supersession.supersedingRevision, by: round.decision.supersession.recordedBy, at: round.decision.supersession.supersededAt } }
      : {}),
  };
}

function roundRevisions(round: HistoryRound) {
  return { startRevision: round.subject.revision, decidedRevision: round.decision?.revision ?? null };
}
