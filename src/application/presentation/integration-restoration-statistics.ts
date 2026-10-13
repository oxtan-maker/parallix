import type { ReportingWindow } from '../../domain/decision-window.js';
import { integrationRestorationStatistics, type IntegrationRepairRoundFact } from '../review-loop/integration-restoration-statistics.js';

/** Estimate and actual counts are deliberately named separately; absent measurements remain explicit. */
export function renderIntegrationRestorationStatistics(facts: readonly IntegrationRepairRoundFact[] | null, windows: readonly (ReportingWindow & { label: string })[]): string {
  const lines = ['Integration repair approval restoration'];
  if (facts === null) { return lines.concat('Restoration statistics unavailable.').join('\n'); }
  for (const window of windows) {
    const s = integrationRestorationStatistics(facts, window);
    lines.push(`Period: ${window.label}`,
      `Integration-repair rounds: ${s.rounds}; actual restores: ${s.restores}; restore share: ${s.share === null ? 'n/a' : `${(100 * s.share).toFixed(1)}%`}.`,
      `Unrecorded or pending restoration decisions: ${s.unrecorded}.`,
      `Fallbacks: ${Object.entries(s.fallbacks).map(([reason, count]) => `${reason}: ${count}`).join('; ')}.`,
      `Observed wrong restores: ${s.observedWrong}/${s.observed} observed; ${s.unobserved}/${s.restores} unobserved. Silence and landing do not establish correctness.`,
      `Median measured normal integration-repair re-review duration: ${s.medianNormalReviewMs === null ? 'unavailable' : `${s.medianNormalReviewMs.toFixed(0)} ms`} (n=${s.durationMeasurements}); cost: ${s.medianNormalReviewCostUsd === null ? 'unavailable' : `$${s.medianNormalReviewCostUsd.toFixed(4)}`} (n=${s.costMeasurements}).`,
      `Estimated avoided review work (${s.restores} actual restores × same-period measured median): duration ${s.estimatedAvoidedMs === null ? 'unavailable' : `${s.estimatedAvoidedMs.toFixed(0)} ms`}; cost ${s.estimatedAvoidedCostUsd === null ? 'unavailable' : `$${s.estimatedAvoidedCostUsd.toFixed(4)}`}.`);
  }
  return lines.join('\n');
}
