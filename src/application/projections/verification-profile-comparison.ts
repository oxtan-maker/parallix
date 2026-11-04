import { createHash } from 'node:crypto';
import type { ControlledVerificationComparison, VerificationProfileReport } from '../ports/verification-profile.js';

/** Analyze retained paired evidence without treating V8 samples as OS CPU or noisy wall ratios as causal speedups. */
export function controlledVerificationComparisons(report: VerificationProfileReport,
  preferredComponent = 'localReportingTimeZone'): ControlledVerificationComparison[] {
  return [false, true].map(coverage => comparison(report, coverage, preferredComponent));
}

function comparison(report: VerificationProfileReport, coverage: boolean,
  preferredComponent: string): ControlledVerificationComparison {
  const selected = report.runs.filter(run => run.coverage === coverage);
  const before = selected.filter(run => !run.profiled), after = selected.filter(run => run.profiled);
  if (!before.length || before.length !== after.length) { throw new Error(`Profile evidence requires matched pairs for coverage=${coverage}`); }
  const beforeWorkloads = new Set(before.map(run => fingerprint(canonicalCommand(run.command))));
  const afterWorkloads = new Set(after.map(run => fingerprint(canonicalCommand(run.command))));
  const allWorkloads = new Set([...beforeWorkloads, ...afterWorkloads]);
  const hotspots = after.flatMap(run => run.profiles.flatMap(profile => profile.hotspots));
  const samples = after.reduce((sum, run) => sum + run.profiles.reduce((total, profile) => total + profile.samples, 0), 0);
  const byComponent = new Map<string, { functionName: string; url: string; samples: number }>();
  for (const hotspot of hotspots) {
    const key = `${hotspot.functionName}\0${hotspot.url}`;
    const prior = byComponent.get(key);
    byComponent.set(key, { functionName: hotspot.functionName, url: hotspot.url,
      samples: (prior?.samples ?? 0) + hotspot.samples });
  }
  const ranked = [...byComponent.values()].sort((a, b) => b.samples - a.samples || a.url.localeCompare(b.url));
  const component = ranked.find(row => row.functionName === preferredComponent)
    ?? ranked.find(row => row.url.includes('/src/') && !row.url.includes('/node_modules/')) ?? null;
  const contribution = component && samples > 0 ? component.samples / samples : 0;
  const workloadFingerprint = fingerprint(JSON.stringify([coverage, report.workload,
    [...allWorkloads].sort((left, right) => left.localeCompare(right))]));
  const configurationFingerprint = fingerprint(JSON.stringify([report.revision, report.dirty, report.tsx]));
  const runtimeFingerprint = fingerprint(JSON.stringify([report.node, report.platform, report.arch]));
  return {
    experimentId: fingerprint(JSON.stringify([workloadFingerprint, configurationFingerprint, runtimeFingerprint])),
    coverage, workloadFingerprint, configurationFingerprint, runtimeFingerprint,
    workloadEquivalent: allWorkloads.size === 1,
    configurationEquivalent: true,
    runtimeEquivalent: true,
    before: { label: 'control', n: before.length, meanWallMs: mean(before.map(run => run.wallMs)), meanCpuUs: mean(before.map(run => run.cpuUs)) },
    after: { label: 'sampled', n: after.length, meanWallMs: mean(after.map(run => run.wallMs)), meanCpuUs: mean(after.map(run => run.cpuUs)) },
    samples,
    component: component ? { functionName: component.functionName, url: component.url,
      selfSamples: component.samples, contribution } : null,
    optimizationBenefitBound: component ? { maximumRemovableCpuFraction: contribution,
      maximumSpeedupRatio: contribution >= 1 ? null : 1 / (1 - contribution),
      assumptions: ['V8 self-sample share approximates the removable serial CPU fraction',
        'the named component could be removed at zero replacement cost',
        'all non-component work and the controlled workload remain unchanged'] } : null,
    interpretation: 'Profiled/control differences measure local instrumentation plus noise; they do not establish contention or an optimization speedup.',
  };
}

function canonicalCommand(command: readonly string[]): string {
  return JSON.stringify(command.filter(argument => !argument.startsWith('--cpu-prof')));
}
function fingerprint(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function mean(values: readonly number[]): number { return values.reduce((sum, value) => sum + value, 0) / values.length; }
