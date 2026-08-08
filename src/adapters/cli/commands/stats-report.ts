// @ts-nocheck

/**
 * Extracted report-rendering slice from stats.ts (task-2217).
 * Contains formatStatsTable, renderWeeklyStatsReport, renderRangeStatsReport,
 * and renderMissionPhaseReport — the four core report generators.
 */

import * as fmt from '../../../application/presentation/cli-format.js';

import {
  buildWeeklyWindows,
  createRangeWindow,
  summarizeMissionWindow,
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

/**
 * @param {string[]} headers
 * @param {string[][]} rows
 */
function formatStatsTable(headers, rows) {
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

/**
 * @param {import('./stats.js').StatsRow[]} rows
 * @param {object} options
 */
function renderWeeklyStatsReport(rows, options = {}) {
  const today = options.today || new Date();
  const rootDir = options.rootDir || null;
  const windows = buildWeeklyWindows(/** @type{Date} */(typeof today === 'string' ? new Date(`${today}T00:00:00Z`) : today));
  const currentMissionStats = summarizeMissionWindow(rows, windows.current);
  const previousMissionStats = summarizeMissionWindow(rows, windows.previous);
  const currentAgentStats = summarizeAgentWindow(rows, windows.current, { rootDir });
  const previousAgentStats = summarizeAgentWindow(rows, windows.previous, { rootDir });
  const currentMissionColors = colorMissionCounts(currentAgentStats);
  const currentAgentColors = colorAverageFixRounds(currentAgentStats);
  const previousMissionColors = colorMissionCounts(previousAgentStats);
  const previousAgentColors = colorAverageFixRounds(previousAgentStats);

  const lines = [];
  lines.push(fmt.bold(`Current week (${windows.current.label})`));
  lines.push(formatStatsTable(
    ['# missions', '# user value missions', '# AI SDLC missions', '# unknown missions'],
    [[String(currentMissionStats.total), String(currentMissionStats.userValue), String(currentMissionStats.aiSdlc), String(currentMissionStats.unknown)]]
  ));
  lines.push('');
  lines.push(fmt.bold(`Previous week (${windows.previous.label})`));
  lines.push(formatStatsTable(
    ['# missions', '# user value missions', '# AI SDLC missions', '# unknown missions'],
    [[String(previousMissionStats.total), String(previousMissionStats.userValue), String(previousMissionStats.aiSdlc), String(previousMissionStats.unknown)]]
  ));
  lines.push('');
  lines.push(fmt.bold(`Agent performance this week (${windows.current.label})`));
  lines.push(formatStatsTable(
    ['Agent family', '# missions as implementer', 'Average PR fix rounds to complete mission'],
    currentAgentStats.length > 0
      ? currentAgentStats.map((row, index) => [row.implementer, currentMissionColors[index], currentAgentColors[index]])
      : [['none', '0', '0.00']]
  ));
  lines.push('');
  const currentAgentSpend = summarizeAgentStageSpend(rows, windows.current);
  lines.push(fmt.bold(`Agent spend by stage this week (${windows.current.label})`));
  lines.push(formatStatsTable(
    ['Agent family', ...AGENT_SPEND_STAGE_COLUMNS.map(entry => entry.label), 'total'],
    currentAgentSpend.length > 0
      ? currentAgentSpend.map(row => [
        row.implementer,
        ...AGENT_SPEND_STAGE_COLUMNS.map(entry => formatAgentSpendCell(row.byStage[entry.stage], row.total, row.family)),
        formatAgentSpendCell(row.total, row.total, row.family),
      ])
      : [['none', ...AGENT_SPEND_STAGE_COLUMNS.map(() => '\u2014'), '\u2014']]
  ));
  lines.push('');
  lines.push(fmt.bold(`Agent performance previous week (${windows.previous.label})`));
  lines.push(formatStatsTable(
    ['Agent family', '# missions as implementer', 'Average PR fix rounds to complete mission'],
    previousAgentStats.length > 0
      ? previousAgentStats.map((row, index) => [row.implementer, previousMissionColors[index], previousAgentColors[index]])
      : [['none', '0', '0.00']]
  ));
  return lines.join('\n');
}

/**
 * @param {import('./stats.js').StatsRow[]} rows
 * @param {object} options
 */
function renderRangeStatsReport(rows, options = {}) {
  const from = options.from;
  const to = options.to;
  const rootDir = options.rootDir || null;
  const window = createRangeWindow({ from, to });
  const missionStats = summarizeMissionWindow(rows, window);
  const agentStats = summarizeAgentWindow(rows, window, { rootDir });
  const missionColors = colorMissionCounts(agentStats);
  const agentColors = colorAverageFixRounds(agentStats);

  const lines = [];
  lines.push(fmt.bold(`Missions (${window.label})`));
  lines.push(formatStatsTable(
    ['# missions', '# user value missions', '# AI SDLC missions', '# unknown missions'],
    [[String(missionStats.total), String(missionStats.userValue), String(missionStats.aiSdlc), String(missionStats.unknown)]]
  ));
  lines.push('');
  lines.push(fmt.bold(`Agent performance (${window.label})`));
  lines.push(formatStatsTable(
    ['Agent family', '# missions as implementer', 'Average PR fix rounds to complete mission'],
    agentStats.length > 0
      ? agentStats.map((row, index) => [row.implementer, missionColors[index], agentColors[index]])
      : [['none', '0', '0.00']]
  ));
  return lines.join('\n');
}

/**
 * Render a single-mission, per-phase telemetry breakdown.
 *
 * @param {import('./stats.js').StatsRow[]} rows
 * @param {string} slug
 * @param {object} options
 */
function renderMissionPhaseReport(rows, slug, options = {}) {
  const wanted = String(slug || '').trim().toLowerCase();
  const opts = options;
  const wantedRepo = String(opts.repo || resolveStatsRepoName(opts.rootDir)).trim();
  const missionRows = (rows || []).filter(row =>
    String(row.mission || '').trim().toLowerCase() === wanted &&
    String(row.repo || '').trim() === wantedRepo
  );

  const byStage = new Map();
  for (const row of missionRows) {
    const stage = String(row.stage || 'default').trim().toLowerCase() || 'default';
    if (!byStage.has(stage)) {byStage.set(stage, []);}
    byStage.get(stage).push(row);
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
    .sort();
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

  const num = (row, key) => String(Number.parseInt(String(row[key]), 10) || 0);
  const cost = (value) => {
    const n = Number.parseFloat(String(value));
    if (!Number.isFinite(n) || n === 0) {return '0';}
    return String(Math.round(n * 100) / 100);
  };
  const tableRows = [];
  for (const { stage, label } of phases) {
    const stageRows = byStage.get(stage) || [];
    if (stageRows.length === 0) {
      tableRows.push([label, '\u2014', '\u2014', '\u2014', '0', '0', '0', '0', '0', '\u2014', '0']);
      continue;
    }
    for (const row of stageRows) {
      const actor = stage === 'review'
        ? (row.reviewer_agent || row.implementer_agent || row.implementer || '\u2014')
        : (row.implementer_agent || row.implementer || '\u2014');
      tableRows.push([
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
          const displayActor = (stage === 'review'
            ? (row.reviewer_agent || row.implementer_agent || row.implementer || '')
            : (row.implementer_agent || row.implementer || ''));
          const actorLower = displayActor.trim().toLowerCase();
          if (actorLower === 'claude') {return '\u2014';}
          return (row.provider && row.provider.toLowerCase() === 'openai')
            ? num(row, 'openai_usage_after')
            : '\u2014';
        })(),
        cost(row.cost_usd),
      ]);
    }
  }

  const totals = ['input_tokens', 'output_tokens', 'cached_tokens', 'tool_calls', 'duration_minutes']
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
