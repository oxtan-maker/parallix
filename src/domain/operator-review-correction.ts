import { applyReviewerCommand, currentReviewRound, operatorDecisionSource, replaceCurrentRound, reviewStatus, validateRequestChanges, type OperatorReviewSource, type Review, type ReviewFinding } from './review.js';

/** Add human obligations without replacing an outstanding reviewer's judgment. */
export function applyOperatorCorrection(review: Review, input: {
  source: OperatorReviewSource; findings: readonly ReviewFinding[]; comment: string | null; decidedAt: string;
}): Review {
  // Validate the same finding and author contract as a fresh request.
  operatorDecisionSource(input.source);
  if (!input.decidedAt.trim() || input.findings.length === 0) {
    throw new Error('Operator correction requires an author, time and distinct findings');
  }
  validateRequestChanges(input.findings);
  const status = reviewStatus(review);
  if (status === 'awaiting-review') {
    return applyReviewerCommand(review, { type: 'request-changes', ...input });
  }
  const current = currentReviewRound(review);
  if (status !== 'awaiting-implementation' || review.intervention || current.decision?.kind !== 'changes-requested') {
    throw new Error(`Operator correction cannot be recorded while review is ${status}; open the next review round first`);
  }
  const decision = current.decision;
  const additions = new Map(input.findings.map(f => [f.id, f]));
  const findings = decision.findings.map(f => additions.get(f.id) ?? f);
  for (const finding of input.findings) {
    if (!decision.findings.some(f => f.id === finding.id)) { findings.push(finding); }
  }
  if (JSON.stringify(findings) === JSON.stringify(decision.findings)) { return review; }
  return { ...review, rounds: replaceCurrentRound(review, {
    ...current, decision: { ...decision, findings, comment: [decision.comment, input.comment].filter(Boolean).join('\n') },
  }) };
}
