import type { VerificationStatistics } from '../projections/verification-statistics.js';
import { formatDuration } from './duration.js';

/** Wall time in ms and CPU time in us, both shown as readable durations. */
const value = (number: number | null, unit: 'ms' | 'us') => number === null ? 'unknown' : formatDuration(unit === 'us' ? number / 1000 : number);

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
    lines.push(`Controlled ${comparison.coverage ? 'coverage' : 'plain'} profile ${comparison.experimentId}: workload/configuration/runtime equivalent true; control n=${comparison.before.n}, ${value(comparison.before.meanWallMs, 'ms')} / ${value(comparison.before.meanCpuUs, 'us')} → sampled n=${comparison.after.n}, ${value(comparison.after.meanWallMs, 'ms')} / ${value(comparison.after.meanCpuUs, 'us')}; V8 samples ${comparison.samples}.`);
    if (component && bound) {
      lines.push(`Measured component ${component.functionName || '(anonymous)'}: ${component.selfSamples}/${comparison.samples} self samples (${(component.contribution * 100).toFixed(1)}%); hypothetical removable-CPU bound ${(bound.maximumRemovableCpuFraction * 100).toFixed(1)}%, maximum speedup ${bound.maximumSpeedupRatio === null ? 'unbounded' : `${bound.maximumSpeedupRatio.toFixed(3)}x`}. Assumptions: ${bound.assumptions.join('; ')}.`);
    }
    lines.push(comparison.interpretation);
  }
}

/**
 * Shared wording and units; FLOW and stats never recalculate measurements. The `summary` detail keeps the measurements
 * and names how many debugging lines it leaves out; `full` prints every gate batch, comparison, profile and unknown.
 */
export function renderVerificationStatistics(report: VerificationStatistics | null | undefined,
  detail: 'summary' | 'full' = 'full'): readonly string[] {
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
  if (detail === 'summary') {
    for (const row of report.ranked.slice(0, 5)) {lines.push(`Elapsed bottleneck ${row.gate}: ${value(row.wallMs, 'ms')} (n=${row.attempts})`);}
    for (const row of [...report.ranked].sort((a, b) => (b.cpuUs ?? -1) - (a.cpuUs ?? -1)).slice(0, 5)) {
      lines.push(`CPU bottleneck ${row.gate}: ${value(row.cpuUs, 'us')} (n=${row.attempts})`);
    }
    lines.push('Execution overlap is reported only as overlap; it is not contention evidence.');
    const hidden = [[report.batches.length, 'gate batches'], [report.comparisons.length, 'revision comparisons'],
      [report.controlledComparisons.length, 'controlled profiling comparisons'], [report.profileReferences.length, 'profiling references']] as const;
    if (hidden.some(([count]) => count > 0)) { lines.push(`Debugging detail not shown: ${hidden.map(([count, name]) => `${count} ${name}`).join(', ')}; run px stats --verbose.`); }
    return lines;
  }
  appendRankings(lines, report);
  appendComparisons(lines, report);
  lines.push(`Profiling evidence: ${report.profileReferences.join(', ') || 'none'}; profiling is optional and OS CPU is not a V8 sample count.`);
  appendControlledComparisons(lines, report);
  if (!report.controlledComparisons.length) { lines.push('Controlled profiling comparison: none retained (profiling is optional).'); }
  lines.push('Execution overlap is reported only as overlap; it is not contention evidence.');
  for (const unknown of report.unknowns) {lines.push(`Unknown: ${unknown}`);}
  return lines;
}

const percent = (fraction: number | null) => fraction === null ? 'unknown' : `${(fraction * 100).toFixed(1)}%`;
const figure = (number: number | null) => number === null ? 'unknown' : number.toFixed(4);

/** Calibration per check and the model saving; an unknown stays unknown and excluded observations stay counted. */
export function renderVerificationModelStatistics(report: VerificationStatistics | null | undefined): readonly string[] {
  if (!report) {return ['Verification model: unavailable'];}
  const lines = ['Verification model · calibration per check (recorded predicted pass probability against matched observed outcome)'];
  for (const check of report.model.calibration) {
    lines.push(`Calibration ${check.check}: starts ${check.starts}; matched ${check.matched} (passed ${check.matchedPassed}); excluded unknown outcome ${check.unknownOutcome}, unknown prediction ${check.unknownPrediction}; mean predicted ${percent(check.meanPredicted)}; observed pass rate ${percent(check.observedPassRate)}; mean absolute error ${check.meanAbsoluteErrorPoints === null ? 'unknown' : `${check.meanAbsoluteErrorPoints.toFixed(1)} points`}`);
    for (const bin of check.bins) {lines.push(`  predicted ${percent(bin.lower)}-${percent(bin.upper)}: n=${bin.count}; mean predicted ${percent(bin.meanPredicted)}; observed ${percent(bin.observedPassRate)}`);}
  }
  if (report.model.unreadableRows > 0) {lines.push(`Unreadable decision or outcome rows excluded: ${report.model.unreadableRows}`);}
  const { saving } = report.model;
  lines.push(`Model saving J_mu(pi_0) - V(pi_0): J_mu(pi_0) ${figure(saving.currentSequenceValue)}; V(pi_0) ${figure(saving.policyValue)}; saving ${figure(saving.absolute)}; percentage of J_mu(pi_0) ${saving.percentage === null ? 'unknown' : `${saving.percentage.toFixed(1)}%`}`);
  return lines;
}
