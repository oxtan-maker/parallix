import type { VerificationStatistics } from '../projections/verification-statistics.js';

const value = (number: number | null, unit: string) => number === null ? 'unknown' : `${Math.round(number)} ${unit}`;

function appendRankings(lines: string[], report: VerificationStatistics): void {
  for (const batch of report.batches) {lines.push(`Gate batch ${batch.batchId}: dependency path ${value(batch.criticalPathMs, 'ms')}`);}
  for (const row of report.ranked.slice(0, 5)) {lines.push(`Elapsed bottleneck ${row.gate}: ${value(row.wallMs, 'ms')} (n=${row.attempts})`);}
  for (const row of [...report.ranked].sort((a, b) => (b.cpuUs ?? -1) - (a.cpuUs ?? -1)).slice(0, 5)) {
    lines.push(`CPU bottleneck ${row.gate}: ${value(row.cpuUs, 'us')} (n=${row.attempts})`);
  }
}

function appendComparisons(lines: string[], report: VerificationStatistics): void {
  for (const comparison of report.comparisons) {lines.push(
    `Revision comparison ${comparison.gate}: ${comparison.before} n=${comparison.beforeN}, ${value(comparison.beforeWallMs, 'ms')} → ${comparison.after} n=${comparison.afterN}, ${value(comparison.afterWallMs, 'ms')}; configuration equivalent ${comparison.configurationEquivalent ?? 'unobserved'}; workload equivalence unobserved (not a controlled comparison)`,
  );}
}

function appendControlledComparisons(lines: string[], report: VerificationStatistics): void {
  for (const comparison of report.controlledComparisons) {
    const component = comparison.component, bound = comparison.optimizationBenefitBound;
    lines.push(`Controlled ${comparison.coverage ? 'coverage' : 'plain'} profile ${comparison.experimentId}: workload/configuration/runtime equivalent true; control n=${comparison.before.n}, ${Math.round(comparison.before.meanWallMs)} ms / ${Math.round(comparison.before.meanCpuUs)} us → sampled n=${comparison.after.n}, ${Math.round(comparison.after.meanWallMs)} ms / ${Math.round(comparison.after.meanCpuUs)} us; V8 samples ${comparison.samples}.`);
    if (component && bound) {
      lines.push(`Measured component ${component.functionName || '(anonymous)'}: ${component.selfSamples}/${comparison.samples} self samples (${(component.contribution * 100).toFixed(1)}%); hypothetical removable-CPU bound ${(bound.maximumRemovableCpuFraction * 100).toFixed(1)}%, maximum speedup ${bound.maximumSpeedupRatio === null ? 'unbounded' : `${bound.maximumSpeedupRatio.toFixed(3)}x`}. Assumptions: ${bound.assumptions.join('; ')}.`);
    }
    lines.push(comparison.interpretation);
  }
}

/** Shared wording and units; FLOW and stats never recalculate measurements. */
export function renderVerificationStatistics(report: VerificationStatistics | null | undefined): readonly string[] {
  if (!report) {return ['Verification measurements: unavailable'];}
  const lines = [
    `Verification measurements · retained history · ${report.completedMissions} completed missions`,
    `Attempts ${report.attemptCount}; failures ${report.failureCount} (infrastructure ${report.infrastructureFailureCount}); reruns ${report.rerunCount}; reused proofs ${report.reusedProofCount}; incomplete ${report.incompleteCount}`,
    `Elapsed lifetime union ${value(report.endToEndMs, 'ms')}; gate execution union ${value(report.executionMs, 'ms')}; exclusive observed waiting ${value(report.waitingMs, 'ms')}; overlapping execution ${value(report.overlapMs, 'ms')}`,
    `OS waited-tree CPU ${value(report.cpuUs, 'us')} (observations ${report.cpuObservations}/${report.attemptCount}; partial when missing)`,
    `Rerun execution ${value(report.rerun.wallMs, 'ms')}; CPU ${value(report.rerun.cpuUs, 'us')}`,
    `Failure-to-success recovery ${value(report.recovery.wallMs, 'ms')}; observed gate CPU ${value(report.recovery.cpuUs, 'us')}; repair activity ${value(report.repairMs, 'ms')}; re-review activity ${value(report.reReviewMs, 'ms')}`,
    `Observed gate DAG critical path ${value(report.criticalPathMs, 'ms')}; end-to-end workflow critical path unknown`,
  ];
  appendRankings(lines, report);
  appendComparisons(lines, report);
  lines.push(`Profiling evidence: ${report.profileReferences.join(', ') || 'none'}; profiling is optional and OS CPU is not a V8 sample count.`);
  appendControlledComparisons(lines, report);
  if (!report.controlledComparisons.length) { lines.push('Controlled profiling comparison: none retained (profiling is optional).'); }
  lines.push('Execution overlap is reported only as overlap; it is not contention evidence.');
  for (const unknown of report.unknowns) {lines.push(`Unknown: ${unknown}`);}
  return lines;
}
