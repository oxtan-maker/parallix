/**
 * Extracted report-rendering slice from stats.ts (task-2217).
 * Contains formatStatsTable, renderWeeklyStatsReport, renderRangeStatsReport,
 * and renderMissionPhaseReport — the four core report generators.
 */

import { localReportingTimeZone } from '../../../domain/decision-window.js';
import * as fmt from '../../../application/presentation/cli-format.js';

import {
  summarizeAgentWindow,
  summarizeAgentStageSpend,
  formatAgentSpendCell,
  colorMissionCounts,
  AGENT_SPEND_STAGE_COLUMNS,
  MISSION_PHASE_ORDER,
  resolveStatsRepoName,
  statsRowActorKey,
} from './stats.js';
import { statisticsMissionKey } from '../../../application/services/statistics-service.js';
import { selectStatsReport } from '../../../application/services/statistics-report-selection.js';
import { compareCodeUnits } from '../../../domain/comparators.js';
import type { StatsRow } from '../../../application/services/statistics-row.js';

interface StatsReportOptions {
  rootDir?: string;
  repo?: string;
  repos?: readonly string[];
  selection?: ReturnType<typeof selectStatsReport>;
  missionFlow?: Parameters<typeof selectStatsReport>[1];
  today?: string;
  from?: string;
  to?: string;
}

type StatsField = keyof StatsRow;

// ---------------------------------------------------------------------------
// Mission flow
//
// Mission flow counts missions whose lifecycle entered `done` — the same
// population `BoardMetrics` and `px stats cohorts` report, supplied by the
// caller as `MissionOutcome[]`.
// ---------------------------------------------------------------------------

function missionFlowSection(heading: string, selected: ReturnType<typeof selectStatsReport>['current']) {
  const lines = [fmt.bold(`${heading} (${selected.window.label})`)];
  if (selected.flow === null) {
    lines.push('Mission flow unavailable: lifecycle history was not read.');
    return lines;
  }
  const flow = selected.flow;
  lines.push(formatStatsTable(
    ['# completed missions', '# user value missions', '# AI SDLC missions', '# unclassified missions'],
    [[String(flow.total), String(flow.userValue), String(flow.aiSdlc), String(flow.unclassified)]],
  ));
  return lines;
}

function sharedFlowSection(selection: ReturnType<typeof selectStatsReport>): string[] {
  if (!selection.flowStatistics) { return []; }
  const renderRate = (metric: import('../../../application/projections/flow-statistics.js').FlowRate) => metric.state === 'measured'
    ? `${((metric.value ?? 0) * 100).toFixed(1)}% (${metric.numerator}/${metric.denominator}, coverage ${(metric.coverage * 100).toFixed(0)}%)`
    : metric.state === 'no-eligible-population' ? 'n/a (no eligible population)' : `unavailable (coverage ${(metric.coverage * 100).toFixed(0)}%)`;
  const period = (name: string, flow: import('../../../application/projections/flow-statistics.js').FlowWindowStatistics) => {
    const largest = flow.time.largestHolder;
    return [fmt.bold(`${name} — shared FLOW lifecycle (${flow.label})`), formatStatsTable(
      ['Nodes/edges', 'First-pass yield', 'Extra launches', 'Agent send-backs', 'Human send-backs', 'Largest elapsed holder'],
      [[`${flow.diagram.nodeCount}/${flow.diagram.edgeCount}`, renderRate(flow.firstPassYield),
        flow.extraAgentLaunches.total === null ? `unavailable (n=${flow.extraAgentLaunches.n})`
          : flow.completedMissions === 0 ? 'n/a (no completed missions)'
            : `${flow.extraAgentLaunches.lowerBound ? 'at least ' : ''}${flow.extraAgentLaunches.total} (mean ${flow.extraAgentLaunches.meanPerMission!.toFixed(1)}, n=${flow.extraAgentLaunches.n})`,
        renderRate(flow.sendBacks.agent), renderRate(flow.sendBacks.human), largest
          ? `${largest.step}/${largest.actor}${largest.model ? `/${largest.model}` : ''}/${largest.state} ${largest.totalMs}ms (${(largest.share * 100).toFixed(1)}%)`
          : 'n/a (no elapsed observations)']]),
      ...flow.time.rows.map(row => `${row.step}/${row.actor}${row.model ? `/${row.model}` : ''}/${row.state}: total ${row.totalMs}ms, mean ${row.meanMs.toFixed(1)}ms, p90 ${row.p90Ms}ms, n=${row.n}`),
      ...flow.defects.map(defect => `Collection defect: ${defect}`)];
  };
  return [...period('Current week', selection.flowStatistics.current),
    ...period('Previous week', selection.flowStatistics.previous)];
}

function bugTrendSection(selection: ReturnType<typeof selectStatsReport>) {
  const lines = [fmt.bold(`Bug-labeled mission share — local calendar days (${selection.current.window.timeZone ?? localReportingTimeZone()})`)];
  if (selection.bugTrend === null) {
    return [...lines, 'Bug trend unavailable: lifecycle history was not read.'];
  }
  lines.push(formatStatsTable(
    ['Period', 'Local days', '# bug missions', '# completed', 'Bug share'],
    selection.bugTrend.map((period, index) => [
      selection.previous ? (index === 0 ? 'Current rolling 7 days' : 'Previous rolling 7 days') : 'Selected range',
      `${period.start} → ${period.end}`, String(period.bugs), String(period.completed),
      period.share === null ? '— (no completions)' : `${(period.share * 100).toFixed(1)}%`,
    ]),
  ));
  return lines;
}

function selectedAgentStats(selected: ReturnType<typeof selectStatsReport>['current']) {
  const rows: StatsRow[] = [...selected.completedRows];
  const represented = new Set(rows.map(statisticsMissionKey));
  for (const [key, implementer] of selected.completedMissionOwners) {
    if (represented.has(key)) { continue; }
    const [repo, mission] = key.split('::');
    rows.push({ repo, mission, implementer, classification: 'unknown' });
  }
  return selected.flow === null ? [] : summarizeAgentWindow(rows, selected.window, {
    completedMissionKeys: new Set(selected.completedMissionOwners.keys()), completedMissionOwners: selected.completedMissionOwners,
    reviewObservations: selected.completedReviewStatistics,
  });
}

function performanceTable(selected: ReturnType<typeof selectStatsReport>['current']): string[] {
  if (selected.flow === null) { return ['Agent performance unavailable: lifecycle history was not read.']; }
  const stats = selectedAgentStats(selected);
  const named = stats.filter(row => row.model !== null);
  const colors = colorMissionCounts(named);
  // Rounds over the missions with return evidence. A + is a valid lower bound only when every mission was measured;
  // otherwise the missing missions could hold any number of returns, so the measured share is named instead.
  const average = (row: (typeof stats)[number]) => {
    if (row.measuredMissions === 0) { return 'unavailable'; }
    const partial = row.measuredMissions < row.missions;
    return `${(row.reimplementationRounds / row.measuredMissions).toFixed(1)}${partial ? ` (${row.measuredMissions}/${row.missions} measured)` : row.incomplete ? '+' : ''}`;
  };
  const lines = [formatStatsTable(['Model', '# missions as implementer', 'Avg reimplementation rounds / mission'],
    named.length > 0 ? named.map((row, index) => [row.model!, colors[index], average(row)]) : [['none', '0', 'unavailable']])];
  const unattributed = stats.find(row => row.model === null);
  if (unattributed) {
    lines.push(`Unavailable model attribution: ${unattributed.missions} missions, ${unattributed.measuredMissions === 0 ? 'unavailable' : unattributed.reimplementationRounds} reimplementation rounds.`);
  }
  return lines;
}

function formatStatsTable(headers: string[], rows: string[][]) {
  const headerRow = headers.map(header => fmt.bold(header));
  const renderedRows = rows.map(row => row.map(cell => String(cell ?? '')));

  return fmt.table([headerRow, ...renderedRows], {
    indent: 0,
    colPadding: 2,
  });
}

function agentSpendSection(heading: string, selected: ReturnType<typeof selectStatsReport>['current']): string[] {
  const spend = summarizeAgentStageSpend(selected.windowedRows, selected.window);
  const named = spend.filter(row => row.model !== null);
  // Quota levels of unattributed rows are not shown: they cannot be summed into anything meaningful.
  const unavailable = spend.filter(row => row.model === null && row.family !== 'usage' && Boolean(row.total));
  return [
    fmt.bold(`${heading} (${selected.window.label}) — resources`),
    formatStatsTable(
      ['Model', ...AGENT_SPEND_STAGE_COLUMNS.map(entry => entry.label), 'total'],
      named.length > 0
        ? named.map(row => [row.implementer,
          ...AGENT_SPEND_STAGE_COLUMNS.map(entry => formatAgentSpendCell(row.byStage[entry.stage], row.total, row.family)),
          formatAgentSpendCell(row.total, row.total, row.family)])
        : [['none', ...AGENT_SPEND_STAGE_COLUMNS.map(() => '—'), '—']],
    ),
    ...(unavailable.length ? [`Unavailable model attribution: ${unavailable.map(row => `${formatAgentSpendCell(row.total, row.total, row.family).replace(/ \(100%\)$/, '')} ${row.actor || 'unknown'}`).join(', ')}.`] : []),
  ];
}

function renderWeeklyStatsReport(rows: readonly StatsRow[], options: StatsReportOptions = {}) {
  const selection = options.selection ?? selectStatsReport(rows, options.missionFlow ?? null, { mode: 'weekly', today: options.today });
  const previous = selection.previous;
  if (!previous) { throw new Error('Weekly statistics selection requires a previous window.'); }
  const windows = { current: selection.current.window, previous: previous.window };

  const lines = [`Reporting timezone: ${selection.current.window.timeZone ?? localReportingTimeZone()}; current period updates with new completions.`];
  lines.push(...missionFlowSection('Mission flow — current week', selection.current));
  lines.push(...sharedFlowSection(selection));
  lines.push('');
  lines.push(...missionFlowSection('Mission flow — previous week', selection.previous));
  lines.push('');
  lines.push(...bugTrendSection(selection));
  lines.push('');
  lines.push(fmt.bold(`Agent performance this week (${windows.current.label}) — completed Missions`));
  lines.push(...performanceTable(selection.current));
  lines.push('');
  lines.push(...agentSpendSection('Agent spend by stage this week', selection.current));
  lines.push('');
  lines.push(fmt.bold(`Agent performance previous week (${windows.previous.label}) — completed Missions`));
  lines.push(...performanceTable(previous));
  return lines.join('\n');
}

function renderRangeStatsReport(rows: readonly StatsRow[], options: StatsReportOptions = {}) {
  const selection = options.selection ?? selectStatsReport(rows, options.missionFlow ?? null, { mode: 'range', from: options.from, to: options.to });
  const window = selection.current.window;

  const lines = [`Reporting timezone: ${selection.current.window.timeZone ?? localReportingTimeZone()}; inclusive local calendar dates.`];
  lines.push(...missionFlowSection('Mission flow', selection.current));
  lines.push('');
  lines.push(...bugTrendSection(selection));
  lines.push('');
  lines.push(fmt.bold(`Agent performance (${window.label}) — completed Missions`));
  lines.push(...performanceTable(selection.current));
  lines.push('');
  lines.push(...agentSpendSection('Agent spend by stage', selection.current));
  return lines.join('\n');
}

/**
 * Render a single-mission, per-phase telemetry breakdown.
 *
 */
function missionReportRepositories(opts: StatsReportOptions): Set<string> {
  return new Set(
    (opts.repos && opts.repos.length > 0
      ? opts.repos
      : [opts.repo || resolveStatsRepoName(opts.rootDir)]
    ).map(identity => String(identity).trim()),
  );
}

function statsPhaseActor(row: StatsRow, stage: string, fallback: string): string {
  return statsRowActorKey({ ...row, stage }) || fallback;
}

function missionPhaseTableRow(row: StatsRow, stage: string, label: string, num: (_row: StatsRow, _key: StatsField) => string, cost: (_value: unknown) => string): string[] {
  const actor = statsPhaseActor(row, stage, '\u2014');
  return [
    label,
    row.provider || '\u2014',
    row.model || '\u2014',
    actor,
    num(row, 'input_tokens'),
    num(row, 'output_tokens'),
    num(row, 'cached_tokens'),
    num(row, 'tool_calls'),
    num(row, 'duration_minutes'),
    (() => {
      const displayActor = statsPhaseActor(row, stage, '');
      const actorLower = displayActor.trim().toLowerCase();
      if (actorLower === 'claude') { return '\u2014'; }
      return (row.provider && row.provider.toLowerCase() === 'openai')
        ? num(row, 'openai_usage_after')
        : '\u2014';
    })(),
    cost(row.cost_usd),
  ];
}

function renderMissionPhaseReport(rows: readonly StatsRow[], slug: string, options: StatsReportOptions = {}) {
  const wanted = String(slug || '').trim().toLowerCase();
  const opts = options;
  // The canonical identity, plus any explicitly declared legacy alias this
  // repository's older rows were persisted under. Never a broadened query: the
  // caller supplies the exact identities, and new rows only use the canonical one.
  const wantedRepos = missionReportRepositories(opts);
  const missionRows = (rows || []).filter(row =>
    String(row.mission || '').trim().toLowerCase() === wanted &&
    wantedRepos.has(String(row.repo || '').trim())
  );

  const byStage = new Map<string, StatsRow[]>();
  for (const row of missionRows) {
    const stage = String(row.stage || 'default').trim().toLowerCase() || 'default';
    const stageRows = byStage.get(stage) ?? [];
    stageRows.push(row);
    byStage.set(stage, stageRows);
  }

  for (const stageRows of byStage.values()) {
    stageRows.sort((a, b) =>
      statsRowActorKey(a).localeCompare(statsRowActorKey(b))
      || String(a.provider || '').localeCompare(String(b.provider || ''))
      || String(a.model || '').localeCompare(String(b.model || ''))
    );
  }

  const orderedStages = MISSION_PHASE_ORDER.map(entry => entry.stage);
  const extraStages = [...byStage.keys()]
    .filter(stage => !orderedStages.includes(stage))
    .sort(compareCodeUnits);
  const phases = [
    ...MISSION_PHASE_ORDER,
    ...extraStages.map(stage => ({ stage, label: stage })),
  ];

  const lines = [];
  lines.push(fmt.bold(`Mission telemetry by phase: ${wanted}`));

  if (missionRows.length === 0) {
    lines.push(formatStatsTable(
      ['Phase', 'Provider', 'Model', 'Implementer', 'Input', 'Output', 'Cached', 'Tool calls', 'Duration (min)', 'Usage %', 'Cost ($)'],
      MISSION_PHASE_ORDER.map(entry => [entry.label, '\u2014', '\u2014', '\u2014', '0', '0', '0', '0', '0', '\u2014', '0'])
    ));
    lines.push('');
    lines.push(`No telemetry rows recorded for mission "${wanted}".`);
    return lines.join('\n');
  }

  const integer = (value: unknown): number | null => {
    if (value === null || value === undefined || String(value).trim() === '') { return null; }
    const parsed = Number.parseInt(String(value), 10);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const decimal = (value: unknown): number | null => {
    if (value === null || value === undefined || String(value).trim() === '') { return null; }
    const parsed = Number.parseFloat(String(value));
    return Number.isFinite(parsed) ? parsed : null;
  };
  const num = (row: StatsRow, key: StatsField) => integer(row[key])?.toString() ?? '\u2014';
  const cost = (value: unknown) => {
    const n = decimal(value);
    if (n === null) { return '\u2014'; }
    if (n === 0) { return '0'; }
    return String(Math.round(n * 100) / 100);
  };
  const tableRows: string[][] = [];
  for (const { stage, label } of phases) {
    const stageRows = byStage.get(stage) || [];
    if (stageRows.length === 0) {
      tableRows.push([label, '\u2014', '\u2014', '\u2014', '0', '0', '0', '0', '0', '\u2014', '0']);
      continue;
    }
    for (const row of stageRows) {
      tableRows.push(missionPhaseTableRow(row, stage, label, num, cost));
    }
  }

  const totals = ['input_tokens', 'output_tokens', 'cached_tokens', 'tool_calls', 'duration_minutes']
    .map(key => key as StatsField)
    .map(key => missionRows.map(row => integer(row[key])).filter((value): value is number => value !== null))
    .map(values => values.length ? String(values.reduce((sum, value) => sum + value, 0)) : '\u2014');
  // Sum the displayed, rounded phase values so the total reconciles exactly
  // with the cells above it while still excluding unavailable observations.
  const costs = missionRows.map(row => decimal(cost(row.cost_usd))).filter((value): value is number => value !== null);
  const totalCost = costs.length ? cost(costs.reduce((sum, value) => sum + value, 0)) : '\u2014';
  tableRows.push(['total', '', '', '', ...totals, '\u2014', totalCost]);

  lines.push(formatStatsTable(
    ['Phase', 'Provider', 'Model', 'Implementer', 'Input', 'Output', 'Cached', 'Tool calls', 'Duration (min)', 'Usage %', 'Cost ($)'],
    tableRows
  ));
  return lines.join('\n');
}

export {
  formatStatsTable,
  renderWeeklyStatsReport,
  renderRangeStatsReport,
  renderMissionPhaseReport,
};
