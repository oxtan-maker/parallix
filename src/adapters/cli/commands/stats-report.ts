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
  colorAverageFixRounds,
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

function repairCauseSection(selected: ReturnType<typeof selectStatsReport>['current']): string {
  const counts = new Map<string, number>();
  let observed = 0;
  for (const info of selected.completedReviewStatistics.values()) {
    if (info.prFixRounds !== null) { observed += 1; }
    for (const obligation of info.obligations) { counts.set(obligation.cause, (counts.get(obligation.cause) ?? 0) + 1); }
  }
  const owned = [...selected.completedMissionOwners.values()].filter(owner => owner && owner !== 'unknown').length;
  return `Delivery ownership coverage: ${owned}/${selected.flow?.total ?? 0}.\nReview-fix mission coverage: ${observed}/${selected.flow?.total ?? 0}. Delivery counts use final ownership; PR fix n counts missions with measured authorship for that agent.\n`
    + formatStatsTable(['Repair/re-review cause', 'Obligations'],
      ['review', 'human', 'integration', 'infrastructure', 'pushback', 'mechanical', 'unknown'].map(cause => [cause, String(counts.get(cause) ?? 0)]));
}

function formatStatsTable(headers: string[], rows: string[][]) {
  const headerRow = headers.map(header => fmt.bold(header));
  const renderedRows = rows.map(row => row.map((cell, index) => {
    if (index === 0 && headers[0] === 'Agent family' && cell !== 'none') {
      return fmt.agent(String(cell), String(cell));
    }
    return String(cell ?? '');
  }));

  return fmt.table([headerRow, ...renderedRows], {
    indent: 0,
    colPadding: 2,
  });
}

function agentSpendSection(heading: string, selected: ReturnType<typeof selectStatsReport>['current']): string[] {
  const spend = summarizeAgentStageSpend(selected.windowedRows, selected.window);
  return [
    fmt.bold(`${heading} (${selected.window.label}) — resources and quota levels`),
    formatStatsTable(
      ['Agent family', ...AGENT_SPEND_STAGE_COLUMNS.map(entry => entry.label), 'total / peak'],
      spend.length > 0
        ? spend.map(row => [row.implementer,
          ...AGENT_SPEND_STAGE_COLUMNS.map(entry => formatAgentSpendCell(row.byStage[entry.stage], row.total, row.family)),
          formatAgentSpendCell(row.total, row.total, row.family)])
        : [['none', ...AGENT_SPEND_STAGE_COLUMNS.map(() => '—'), '—']],
    ),
    'Spend follows the stage actor and measurement date. Parentheses show stage shares for dollars and runtime.',
    'Codex cells show the recorded quota peak per stage; the final column is the row’s peak quota level, not consumption. Quota snapshots lack attributable per-run deltas; missing levels show —.',
  ];
}

function renderWeeklyStatsReport(rows: readonly StatsRow[], options: StatsReportOptions = {}) {
  const selection = options.selection ?? selectStatsReport(rows, options.missionFlow ?? null, { mode: 'weekly', today: options.today });
  const previous = selection.previous;
  if (!previous) { throw new Error('Weekly statistics selection requires a previous window.'); }
  const windows = { current: selection.current.window, previous: previous.window };
  const missionFlow = selection.current.flow;
  const currentAgentStats = selectedAgentStats(selection.current);
  const previousAgentStats = selectedAgentStats(previous);
  const currentMissionColors = colorMissionCounts(currentAgentStats);
  const currentAgentColors = colorAverageFixRounds(currentAgentStats);
  const previousMissionColors = colorMissionCounts(previousAgentStats);
  const previousAgentColors = colorAverageFixRounds(previousAgentStats);

  const lines = [`Reporting timezone: ${selection.current.window.timeZone ?? localReportingTimeZone()}; current period updates with new completions.`];
  lines.push(...missionFlowSection('Mission flow — current week', selection.current));
  lines.push('');
  lines.push(...missionFlowSection('Mission flow — previous week', selection.previous));
  lines.push('');
  lines.push(...bugTrendSection(selection));
  lines.push('');
  lines.push(fmt.bold(`Agent performance this week (${windows.current.label}) — completed Missions`));
  lines.push(missionFlow === null ? 'Agent performance unavailable: lifecycle history was not read.' : formatStatsTable(
    ['Agent family', '# missions as implementer', 'Average authored PR fix rounds', 'PR fix n'],
    currentAgentStats.length > 0
      ? currentAgentStats.map((row, index) => [row.implementer, currentMissionColors[index], currentAgentColors[index] ?? 'unavailable', String(row.prFixObservationCount)])
      : [['none', '0', 'unavailable', '0']]
  ));
  lines.push(repairCauseSection(selection.current));
  lines.push('');
  lines.push(...agentSpendSection('Agent spend by stage this week', selection.current));
  lines.push('');
  lines.push(fmt.bold(`Agent performance previous week (${windows.previous.label}) — completed Missions`));
  lines.push(missionFlow === null ? 'Agent performance unavailable: lifecycle history was not read.' : formatStatsTable(
    ['Agent family', '# missions as implementer', 'Average authored PR fix rounds', 'PR fix n'],
    previousAgentStats.length > 0
      ? previousAgentStats.map((row, index) => [row.implementer, previousMissionColors[index], previousAgentColors[index] ?? 'unavailable', String(row.prFixObservationCount)])
      : [['none', '0', 'unavailable', '0']]
  ));
  return lines.join('\n');
}

function renderRangeStatsReport(rows: readonly StatsRow[], options: StatsReportOptions = {}) {
  const selection = options.selection ?? selectStatsReport(rows, options.missionFlow ?? null, { mode: 'range', from: options.from, to: options.to });
  const window = selection.current.window;
  const missionFlow = selection.current.flow;
  const agentStats = selectedAgentStats(selection.current);
  const missionColors = colorMissionCounts(agentStats);
  const agentColors = colorAverageFixRounds(agentStats);

  const lines = [`Reporting timezone: ${selection.current.window.timeZone ?? localReportingTimeZone()}; inclusive local calendar dates.`];
  lines.push(...missionFlowSection('Mission flow', selection.current));
  lines.push('');
  lines.push(...bugTrendSection(selection));
  lines.push('');
  lines.push(fmt.bold(`Agent performance (${window.label}) — completed Missions`));
  lines.push(missionFlow === null ? 'Agent performance unavailable: lifecycle history was not read.' : formatStatsTable(
    ['Agent family', '# missions as implementer', 'Average authored PR fix rounds', 'PR fix n'],
    agentStats.length > 0
      ? agentStats.map((row, index) => [row.implementer, missionColors[index], agentColors[index] ?? 'unavailable', String(row.prFixObservationCount)])
      : [['none', '0', 'unavailable', '0']]
  ));
  lines.push(repairCauseSection(selection.current));
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

  const num = (row: StatsRow, key: StatsField) => String(Number.parseInt(String(row[key]), 10) || 0);
  const cost = (value: unknown) => {
    const n = Number.parseFloat(String(value));
    if (!Number.isFinite(n) || n === 0) { return '0'; }
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

  const totals: number[] = ['input_tokens', 'output_tokens', 'cached_tokens', 'tool_calls', 'duration_minutes']
    .map(key => key as StatsField)
    .map(key => missionRows.reduce((sum, row) => sum + (Number.parseInt(String(row[key]), 10) || 0), 0));
  const totalCost = tableRows
    .filter(r => r[0] !== 'total')
    .reduce((sum, r) => sum + (Number.parseFloat(cost(r[10])) || 0), 0);
  tableRows.push(['total', '', '', '', String(totals[0]), String(totals[1]), String(totals[2]), String(totals[3]), String(totals[4]), '\u2014', cost(totalCost)]);

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
