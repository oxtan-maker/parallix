import * as fmt from '../../application/presentation/cli-format.js';
import type { ReviewLoopEvent } from '../../application/ports/review-loop-output.js';
export interface ReviewLoopTextOutput { log(_message: string): void; error(_message: string): void }
export type ReviewLoopRenderers = Record<ReviewLoopEvent['kind'], (_event: ReviewLoopEvent, _output: ReviewLoopTextOutput) => void>;

function isReviewEventKind<K extends ReviewLoopEvent['kind']>(event: ReviewLoopEvent, kind: K): event is Extract<ReviewLoopEvent, { kind: K }> {
  return event.kind === kind;
}
/** Bind a renderer to its discriminated observation without casting payloads. */
export function reviewEventRenderer<K extends ReviewLoopEvent['kind']>(kind: K, render: (_event: Extract<ReviewLoopEvent, { kind: K }>, _output: ReviewLoopTextOutput) => void): ReviewLoopRenderers[K] {
  return (event, output) => {
    if (!isReviewEventKind(event, kind)) { throw new Error(`Unhandled review observation: ${JSON.stringify(event)}`); }
    render(event, output);
  };
}

/** Fallback reasons after the classifier was called and did not decide; every other reason means it was not used. */
const CLASSIFIER_FAILURES = new Set(['classifier-failure', 'classifier-exception', 'classifier-publication-failed', 'evidence-over-budget', 'evidence-read-failed']);

/** Says plainly whether the classifier ran, so a fallback is never mistaken for a classifier that never started. */
export function classifierFallbackMessage(reason: string): string {
  if (reason === 'abstention') { return 'Reviewer classifier abstained, continuing with general reviewer.'; }
  const outcome = CLASSIFIER_FAILURES.has(reason) ? 'failed' : 'not used';
  return `Reviewer classifier ${outcome} (${reason}), continuing with general reviewer.`;
}

/** Render only a persisted, authoritative review state as the operator verdict. */
export function renderReviewVerdict(reviewState: string | null, findings: readonly { id: string; summary: string }[], log: (_msg: string) => void, verbose = false, round?: number): void {
  if (reviewState === 'APPROVED') {
    log(fmt.status('PASS', `========== APPROVED${round && round > 1 ? ` · round ${round}` : ''} ==========`));
    return;
  }
  if (reviewState === 'REQUEST_CHANGES') {
    log(fmt.status('WARN', '====== CHANGES REQUESTED ======'));
    for (const finding of findings) {
      log(fmt.status('WARN', `Blocking finding: ${finding.id} — ${finding.summary}`));
    }
    return;
  }
  // A non-binary outcome (e.g. COMMENT) is demoted to verbose rather than
  // dropped, so a silent non-binary verdict is not a regression (TASK-2477/F2).
  if (verbose && reviewState) {
    log(fmt.status('INFO', `Reviewer outcome = ${reviewState}`));
  }
}

/** The review relationship, expressed with configured agent-family IDs. */
export function reviewIndependence(implementer: string, reviewer: string): string {
  return implementer === reviewer
    ? 'same-family fallback / self-review'
    : 'different-family review';
}
