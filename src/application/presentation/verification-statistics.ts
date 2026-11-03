import type { VerificationStatistics } from '../projections/verification-statistics.js';

const value = (number: number | null, unit: string) => number === null ? 'unknown' : `${Math.round(number)} ${unit}`;

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
  for (const batch of report.batches) {lines.push(`Gate batch ${batch.batchId}: dependency path ${value(batch.criticalPathMs, 'ms')}`);}
  for (const row of report.ranked.slice(0, 5)) {lines.push(`Elapsed bottleneck ${row.gate}: ${value(row.wallMs, 'ms')} (n=${row.attempts})`);}
  for (const row of [...report.ranked].sort((a, b) => (b.cpuUs ?? -1) - (a.cpuUs ?? -1)).slice(0, 5)) {
    lines.push(`CPU bottleneck ${row.gate}: ${value(row.cpuUs, 'us')} (n=${row.attempts})`);
  }
  for (const comparison of report.comparisons) {lines.push(
    `Revision comparison ${comparison.gate}: ${comparison.before} n=${comparison.beforeN}, ${value(comparison.beforeWallMs, 'ms')} → ${comparison.after} n=${comparison.afterN}, ${value(comparison.afterWallMs, 'ms')}; configuration equivalent ${comparison.configurationEquivalent ?? 'unknown'}; workload equivalent unknown`,
  );}
  lines.push(`Profiling evidence: ${report.profileReferences.join(', ') || 'none'}; sample coverage of these attempts unknown (OS CPU is not samples)`);
  lines.push('Contention and optimization benefit: unknown; overlap alone does not establish contention or a speedup. Revision comparisons do not establish equivalent discovered workloads.');
  for (const unknown of report.unknowns) {lines.push(`Unknown: ${unknown}`);}
  return lines;
}
