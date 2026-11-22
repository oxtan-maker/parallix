import test from 'node:test';
import assert from 'node:assert/strict';
import { renderVerificationStatistics } from '../../../../src/application/presentation/verification-statistics.js';
import { formatDuration } from '../../../../src/application/presentation/duration.js';
import { verificationStatistics } from '../../../../src/application/projections/verification-statistics.js';

test('the summary report counts its debugging lines and the full report prints them (TASK-2867.07)', () => {
  const base = verificationStatistics({ repositoryId: 'repo', history: [], operations: [], lifecycle: [] });
  const report = { ...base, unknowns: ['Open activity intervals excluded', 'Gate identity incomplete for px-1'],
    comparisons: [{ gate: 'unit', before: 'a', beforeN: 1, beforeWallMs: 1, after: 'b', afterN: 1, afterWallMs: 2, configurationEquivalent: true, workloadEquivalent: 'unobserved' as const }],
    profileReferences: ['retained/report.json'],
    batches: Array.from({ length: 9 }, (_, index) => ({ batchId: `batch-${index}`, criticalPathMs: index * 1000 })) };
  const summary = renderVerificationStatistics(report, 'summary');
  assert.equal(summary.some(line => line.startsWith('Gate batch') || line.startsWith('Unknown:')), false);
  assert.ok(summary.includes('Debugging detail not shown: 9 gate batches, 1 revision comparisons, 0 controlled profiling comparisons, 1 profiling references; run px stats --verbose.'));
  const full = renderVerificationStatistics(report);
  assert.equal(full.filter(line => line.startsWith('Gate batch ')).length, 9);
  assert.deepEqual(full.filter(line => line.startsWith('Unknown:')), ['Unknown: Open activity intervals excluded', 'Unknown: Gate identity incomplete for px-1']);
  assert.equal(full.filter(line => line.startsWith('Revision comparison ')).length, 1);
  assert.equal(full.some(line => line.startsWith('Debugging detail')), false);
  assert.ok(summary.some(line => line.startsWith('Execution overlap')), 'the guardrail for the overlap figure stays in the summary');
  assert.equal(renderVerificationStatistics({ ...base, unknowns: [], batches: [], comparisons: report.comparisons }, 'summary').some(line => line.includes('1 revision comparisons')), true, 'comparisons alone are still counted');
  assert.equal(renderVerificationStatistics({ ...base, unknowns: [], batches: [] }, 'summary').some(line => line.startsWith('Debugging detail')), false, 'nothing hidden means no notice');
  assert.equal(renderVerificationStatistics({ ...base, unknowns: report.unknowns, batches: [] }, 'summary').some(line => line.startsWith('Debugging detail')), false, 'unknown observations are only printed by --verbose, never counted in the default report');
});

test('durations read as ms, s or m and CPU microseconds read the same way (TASK-2867.07)', () => {
  const report = { ...verificationStatistics({ repositoryId: 'repo', history: [], operations: [], lifecycle: [] }),
    endToEndMs: 250, executionMs: 1500, waitingMs: 125_000, cpuUs: 2_000_000, cpuObservations: 1 };
  const text = renderVerificationStatistics(report).join('\n');
  assert.match(text, /Elapsed lifetime union 250ms; gate execution union 1\.5s; exclusive observed waiting 2m05s/);
  assert.match(text, /OS waited-tree CPU 2\.0s/);
  assert.match(renderVerificationStatistics({ ...report, cpuUs: 400 }).join('\n'), /OS waited-tree CPU <1ms/, 'a measured sub-millisecond value is not shown as zero');
  const boundaries: readonly [number, string][] = [[0, '0ms'], [0.4, '<1ms'], [999.4, '999ms'], [999.6, '1.0s'], [59_949, '59.9s'], [59_950, '1m00s'],
    [59_999, '1m00s'], [119_500, '2m00s'], [3_659_999, '1h01m'],
    [3_599_999, '1h00m'], [11_100_000, '3h05m'], [86_399_999, '1d00h'], [450_000_000, '5d05h'], [30 * 86_400_000, '1mo00d'], [71 * 86_400_000, '2mo11d'],
    [365 * 86_400_000, '1y00mo'], [(365 + 65) * 86_400_000, '1y02mo']];
  for (const [ms, expected] of boundaries) { assert.equal(formatDuration(ms), expected, `${ms} ms`); }
});
