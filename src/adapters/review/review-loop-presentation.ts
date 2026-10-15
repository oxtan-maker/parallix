/** Render application review observations for the CLI. No workflow decisions live here. */
import type { ReviewLoopEvent } from '../../application/ports/review-loop-output.js';
import type { ReviewLoopTextOutput, ReviewLoopRenderers } from './review-loop-output-formatting.js';
import { implementerOutputRenderers } from './review-loop-implementer-output.js';
import { handoffOutputRenderers } from './review-loop-handoff-output.js';
import { reviewerOutputRenderers } from './review-loop-reviewer-output.js';
export { renderReviewVerdict, reviewIndependence } from './review-loop-output-formatting.js';
export type { ReviewLoopTextOutput } from './review-loop-output-formatting.js';

const OUTPUT_RENDERERS = { ...implementerOutputRenderers, ...handoffOutputRenderers, ...reviewerOutputRenderers } satisfies ReviewLoopRenderers;

export function renderReviewLoopEvent(event: ReviewLoopEvent, output: ReviewLoopTextOutput): void {
  const render = Object.hasOwn(OUTPUT_RENDERERS, event.kind) ? OUTPUT_RENDERERS[event.kind] : undefined;
  if (!render) { throw new Error(`Unhandled review observation: ${JSON.stringify(event)}`); }
  render(event, output);
}

export function reviewLoopReporter(output: ReviewLoopTextOutput): { emit(_event: ReviewLoopEvent): void } {
  return { emit: event => renderReviewLoopEvent(event, output) };
}
