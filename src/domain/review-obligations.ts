import { reviewFindingId, type Review, type ReviewFinding, type ReviewRound, type ReviewEventRecord } from './review.js';

export interface ObligationScope {
  readonly general: ReviewRound;
  readonly findings: readonly ReviewFinding[];
}
const clean = (text: string) => text.replace(/\n*---\n`\[workflow-round:[\s\S]*$/, '').trim();
const generalDecision = (round: ReviewRound) => round.decision && !round.decision.classifier
  && !(round.decision.kind === 'approved' && round.decision.source.kind === 'mechanical-restoration');
const carriesFindings = (round: ReviewRound) => round.decision?.kind === 'changes-requested' && round.decision.classifier
  && !round.decision.classifier.successCriteria && !round.decision.classifier.integrationRepair;

function priorFindings(review: Review, general: ReviewRound): ReviewFinding[] {
  const findings = general.decision?.kind === 'changes-requested'
    ? general.decision.findings.filter(f => /^F\d+[A-Z]?$/i.test(f.id)).map(f => ({ ...f })) : [];
  const raw = review.reviewEvents.filter(e => e.roundNumber === general.number && e.eventType === 'reviewer_findings').at(-1)?.content ?? '';
  const sections = raw.split(/(?=^#{2,4}\s*F\d+[a-z]?\b)/gim);
  return findings.map(f => {
    const section = sections.find(text => text.match(/^#{2,4}\s*(F\d+[a-z]?)\b/i)?.[1].toUpperCase() === String(f.id).toUpperCase());
    return section ? { ...f, summary: clean(section) } : f;
  });
}
function humanText(event: ReviewEventRecord, since: string): string | null {
  if (event.eventType !== 'human_note' || ['system', 'workflow'].includes(event.actor ?? '')
    || !Number.isFinite(Date.parse(event.createdAt)) || Date.parse(event.createdAt) < Date.parse(since)) { return null; }
  const text = clean(event.content);
  return !text || /^(?:cleared a human-intervention stop|invalidated a BLOCKED stop)/.test(text) ? null : text;
}
function humanFindings(review: Review, general: ReviewRound): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const seen = new Set<string>();
  for (const event of review.reviewEvents) {
    const text = humanText(event, general.decision!.decidedAt);
    if (!text || seen.has(text)) { continue; }
    seen.add(text);
    findings.push({ id: reviewFindingId(`H${event.position}`), summary: text, location: null });
  }
  const revocation = general.decision?.kind === 'approved' ? general.decision.revocation : undefined;
  if (revocation?.cause?.kind === 'operator' && clean(revocation.reason) && !seen.has(clean(revocation.reason))) {
    findings.push({ id: reviewFindingId(`H-revocation-${general.number}`), summary: clean(revocation.reason), location: null });
  }
  return findings;
}
/** General decision ancestry is never reset by a classifier return. */
export function reviewObligations(review: Review): ObligationScope | null {
  const earlier = review.rounds.slice(0, -1).filter(round => round.decision);
  const nearest = earlier.at(-1);
  if (!nearest || (!generalDecision(nearest) && !carriesFindings(nearest))) { return null; }
  const general = [...earlier].reverse().find(generalDecision);
  if (!general) { return null; }
  const prior = priorFindings(review, general);
  if (carriesFindings(nearest) && nearest.decision?.kind === 'changes-requested'
    && prior.some(f => !nearest.decision || nearest.decision.kind !== 'changes-requested' || !nearest.decision.findings.some(item => item.id === f.id))) { return null; }
  const findings = [...prior, ...humanFindings(review, general)];
  return findings.length ? { general, findings } : null;
}
