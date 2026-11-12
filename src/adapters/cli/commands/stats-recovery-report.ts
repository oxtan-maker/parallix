import type { StatsProjection, StatsRecoveryAudit } from '../../../application/ports.js';
import { analyzeStatsRecovery } from '../../../application/stats-recovery-analysis.js';

// ---------------------------------------------------------------------------
// `px stats backfill` recovery audit
//
// The dry-run audit is the operator's review surface for a recovery run: what
// each source and mission would add, what conflicts with retained history, how
// the reported metrics and coverage move, and which sources stayed unavailable.
// It never presents an inventory as a corrected return total.
// ---------------------------------------------------------------------------

type InventoryKey = keyof StatsRecoveryAudit['inventory'];

const INVENTORY_LABELS: readonly (readonly [InventoryKey, string, InventoryKey | null])[] = [
  ['reviewToActiveTransitions', 'review-to-active lane returns', 'reviewToActiveMissions'],
  ['reviewRounds', 'retained review rounds', 'reviewRoundMissions'],
  ['changesRequestedDecisions', 'changes-requested decisions', null],
  ['integrationGateRevocations', 'integration-gate revocations', null],
  ['reboundRepairs', 'rebound.repair records', 'reboundRepairMissions'],
];

/** Audit lines for one projection; empty when the run collected no recovery evidence. */
export function renderRecoveryAudit(projection: StatsProjection): string[] {
  const audit = projection.recoveryAudit;
  if (!audit) { return []; }
  const lines: string[] = [];
  lines.push(`Recovery audit: collected=${audit.collected} additions=${audit.additions} duplicates=${audit.duplicates} conflicts=${audit.conflicts}`);
  pushSection(lines, 'Recovery additions by source:', source => {
    const value = audit.bySource[source];
    return `- ${source}: collected=${value.collected} additions=${value.additions} conflicts=${value.conflicts}`;
  }, Object.keys(audit.bySource));
  pushSection(lines, 'Recovery additions by mission:', mission => {
    const value = audit.byMission[mission];
    return `- ${mission}: additions=${value.additions} sources=${value.sources.join(',')}`;
  }, Object.keys(audit.byMission));
  pushSection(lines, 'Retained conflicts (raw history is never overwritten):', identity => {
    const conflict = projection.recovery?.conflicts.find(item => item.identity === identity);
    return `- ${identity} fields=${conflict?.fields.join(',') ?? 'unknown'}`;
  }, [...new Set(projection.recovery?.conflicts.map(item => item.identity) ?? [])]);
  pushSection(lines, 'Unresolved gaps:', gap => `- ${gap}`, audit.unresolvedGaps);
  const measurements = projection.measurementRecovery;
  if (measurements) {
    lines.push(`Native-run measurement inventory: candidates=${measurements.summary.candidates} corrections=${measurements.summary.corrections} verified=${measurements.summary.verified} gaps=${measurements.summary.gaps} conflicts=${measurements.summary.conflicts}`);
    for (const item of measurements.inventory) {
      const proof = item.evidence ? ` run=${item.evidence.runId} sha256=${item.evidence.sha256}` : '';
      const detail = [...item.gaps, ...item.conflicts].join('; ');
      lines.push(`- ${item.original.mission}/${item.original.stage}/${JSON.stringify(item.original.actorKey)}: ${item.disposition}${proof}${detail ? `; ${detail}` : ''}`);
    }
  }
  lines.push(`Source inventory before ${audit.inventoryPeriod.before} (candidate evidence, never a corrected return total):`);
  for (const [key, label, populationKey] of INVENTORY_LABELS) {
    const population = populationKey ? ` across ${audit.inventory[populationKey]} missions` : '';
    lines.push(`- ${label}: ${audit.inventory[key]}${population}`);
  }
  pushSection(lines, 'Metric deltas (stored -> recovered):', change => {
    const before = change.before.map(value => value ?? 'unknown').join(', ');
    return `- ${change.mission}: returns [${before}] -> ${change.after ?? 'unknown'}; authors=${JSON.stringify(change.byImplementer)}`;
  }, projection.changes ?? []);
  return lines;
}

/** The same audit in machine-readable form for `--json` and analysis exports. */
export function recoveryAuditPayload(projection: StatsProjection): unknown {
  const audit = projection.recoveryAudit;
  if (!audit) { return null; }
  return {
    ...audit,
    measurementRecovery: projection.measurementRecovery ?? null,
    conflicts: (projection.recovery?.conflicts ?? []).map(conflict => ({ identity: conflict.identity, fields: conflict.fields })),
    reportComparison: (projection.changes ?? []).map(change => ({
      mission: change.mission, before: change.before, beforeObserved: change.beforeObserved,
      after: change.after, byImplementer: change.byImplementer,
    })),
  };
}

/** Concise human interpretation; the complete machine-readable export is emitted in JSON. */
export function renderRecoveryAnalysis(projection: StatsProjection): string[] {
  const analysis = analyzeStatsRecovery(projection);
  const returns = analysis.metrics.returnsPerMission;
  const repairs = analysis.metrics.repairAttemptDuration;
  const turnaround = analysis.metrics.prToReviewTurnaround;
  return [
    `Analysis coverage: ${analysis.dateRange.from ?? 'unavailable'} -> ${analysis.dateRange.to ?? 'unavailable'}; records=${analysis.populations.collectedRecords}; missions=${analysis.populations.linkedMissions}`,
    `Returns/mission [${returns.classification}]: n=${returns.observationCount}/${returns.denominator}; median=${display(returns.median)}; p90=${display(returns.p90)}`,
    `Repair-attempt durationMs [${repairs.classification}]: n=${repairs.observationCount}/${repairs.denominator}; median=${display(repairs.median)}; p90=${display(repairs.p90)}`,
    `PR-to-review elapsed turnaroundMs [${turnaround.classification}]: n=${turnaround.observationCount}/${turnaround.denominator}; median=${display(turnaround.median)}`,
    `Unavailable historical telemetry: ${analysis.unavailable.map(item => item.metric).join(', ')}`,
    analysis.interpretation.representativeness,
    '',
  ];
}

function display(value: number | null): string { return value === null ? 'unavailable' : String(Math.round(value * 100) / 100); }

function pushSection<T>(lines: string[], header: string, render: (_item: T) => string, items: readonly T[]): void {
  if (items.length === 0) { return; }
  lines.push(header);
  for (const item of items) { lines.push(render(item)); }
  lines.push('');
}
