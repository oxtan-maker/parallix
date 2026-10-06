import { classifierGroups, classifierStatistics, type ClassifierStatisticsInput } from '../review-classification/statistics.js';

export function renderClassifierStatistics(input: ClassifierStatisticsInput | null, window: { start: Date; end: Date; label: string }): string {
  if (!input) { return `PR decisions (${window.label}, UTC): unavailable`; }
  const counts = classifierStatistics(input, window);
  const groups = classifierGroups(input, window);
  const share = counts.percentage === null ? 'unavailable' : `${counts.percentage.toFixed(1)}%`;
  const count = (value: number) => counts.coverage === 'unavailable' ? 'unavailable'
    : `${value}${counts.coverage === 'partial' ? ' (partial)' : ''}`;
  return [
    `PR decisions (${window.label}, UTC, current repository; includes open missions):`,
    `Total: ${count(counts.total)} | Classifier: ${count(counts.classifier)} | Classifier share: ${share} | Clears: ${count(counts.clears)} | Implementer returns: ${count(counts.returns)}`,
    `Coverage: ${counts.coverage} | Calls: ${counts.calls} | Attempts: ${counts.attempts} | Eligible decisions: ${counts.eligibleDecisions} | Reviewer fallbacks: ${counts.fallbacks} | Shadow judgments: ${counts.shadows}`,
    `Observed false clears: ${counts.falseClears} | Observed false returns: ${counts.falseReturns} | Unobserved applied outcomes: ${counts.unobserved}`,
    `Shadow false-clear signals: ${counts.shadowFalseClears} | Shadow false-return signals: ${counts.shadowFalseReturns} | Unobserved shadow outcomes: ${counts.shadowUnobserved}`,
    `New findings: ${counts.newFindingObservations ? counts.newFindings : 'unavailable'} | Fallback mix: ${JSON.stringify(counts.fallbackReasons)}`,
    `Packet preparation: ${counts.preparation.totalMs === null ? 'unavailable' : `${counts.preparation.totalMs.toFixed(2)} ms`} | Classification: ${counts.classification.totalMs === null ? 'unavailable' : `${counts.classification.totalMs.toFixed(2)} ms`}`,
    ...(groups === null ? ['Completed-mission classifier cohorts: unavailable'] : groups.map(group =>
      `Completed-mission cohort (full history) ${group.implementer}/${group.reviewer} classifier ${group.provider ?? 'unavailable'}/${group.model ?? 'unavailable'}: missions=${group.missions}, PR rounds=${group.reviewRounds}, fix rounds=${group.fixRounds}, eligible decisions=${group.statistics.eligibleDecisions}, calls=${group.statistics.calls}, fallbacks=${group.statistics.fallbacks}, false clears=${group.statistics.falseClears}, false returns=${group.statistics.falseReturns}, unobserved=${group.statistics.unobserved}, measured cycles=${group.measuredCycles}, cycle ms=${group.totalCycleMs ?? 'unavailable'}, matched cycles=${group.matchedCycles}, measured net ms=${group.measuredNetMs ?? 'unavailable'}, implementer models=${group.implementerModels.join(',') || 'unavailable'}, reviewer models=${group.reviewerModels.join(',') || 'unavailable'}`)),
  ].join('\n');
}
