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

/** The agent-telemetry table header, in render order. */
function agentTelemetryHeader() {
  return ['# missions with telemetry', '# user value missions', '# AI SDLC missions', '# unknown missions'];
}

/** The agent-telemetry table row, in header order. */
function agentTelemetryRow(total, userValue, aiSdlc, unknown) {
  return [String(total), String(userValue), String(aiSdlc), String(unknown)];
}

// ---------------------------------------------------------------------------
// Mission flow vs agent telemetry
//
// These are two different quantities and this file no longer lets them share a
// heading. Mission flow counts missions whose lifecycle entered `done` — the
// same population `BoardMetrics` and `px stats cohorts` report, supplied by the
// caller as `MissionOutcome[]`. The telemetry tables below count what agents
// wrote about their own work; a mission with no telemetry is invisible to them,
// and a telemetry row claiming closure does not complete a mission.
// ---------------------------------------------------------------------------

/** The label buckets the mission-flow table reports, in render order. */
const MISSION_FLOW_LABELS = ['user_value', 'ai_sdlc'];

/**
 * Count lifecycle completions inside one window, bucketed by mission label.
 *
 * @param {{closedAt: string, labels: readonly string[]}[]} outcomes
 * @param {{start: Date, end: Date}} window
 */
function summarizeMissionFlowWindow(outcomes, window) {
  const inWindow = outcomes.filter(outcome => {
    const closed = Date.parse(outcome.closedAt);
    const day = String(outcome.closedAt).slice(0, 10);
    return Number.isFinite(closed)
      && day >= window.start.toISOString().slice(0, 10)
      && day <= window.end.toISOString().slice(0, 10);
  });
  const withLabel = label => inWindow.filter(outcome => outcome.labels.includes(label)).length;
  return {
    total: inWindow.length,
    userValue: withLabel('user_value'),
    aiSdlc: withLabel('ai_sdlc'),
    unclassified: inWindow.filter(
      outcome => !outcome.labels.some(label => MISSION_FLOW_LABELS.includes(label)),
    ).length,
  };
}

/**
 * Render one mission-flow section.
 *
 * `outcomes` is null when the caller could not read lifecycle history. That is
 * reported as unavailable rather than as a zero: an unread lane history and a
 * week in which nothing completed are different facts.
 *
 * @param {string} heading
 * @param {{closedAt: string, labels: readonly string[]}[] | null} outcomes
 * @param {{start: Date, end: Date, label: string}} window
 */
function missionFlowSection(heading, outcomes, window) {
  const lines = [fmt.bold(`${heading} (${window.label})`)];
  if (outcomes === null) {
    lines.push('Mission flow unavailable: lifecycle history was not read.');
    return lines;
  }
  const flow = summarizeMissionFlowWindow(outcomes, window);
  lines.push(formatStatsTable(
    ['# completed missions', '# user value missions', '# AI SDLC missions', '# unclassified missions'],
    [[String(flow.total), String(flow.userValue), String(flow.aiSdlc), String(flow.unclassified)]],
  ));
  return lines;
}

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
  const missionFlow = options.missionFlow ?? null;
  const completedMissionKeys = window => new Set((missionFlow || [])
    .filter(outcome => String(outcome.closedAt).slice(0, 10) >= window.start.toISOString().slice(0, 10)
      && String(outcome.closedAt).slice(0, 10) <= window.end.toISOString().slice(0, 10))
    .map(outcome => `${String(outcome.repo).trim()}::${String(outcome.mission).trim().toLowerCase()}`));
  const telemetryMissionKeys = new Set(rows.map(row =>
    `${String(row.repo ?? '').trim()}::${String(row.mission ?? '').trim().toLowerCase()}`,
  ));
  const currentMissionStats = summarizeMissionWindow(rows, windows.current, telemetryMissionKeys);
  const previousMissionStats = summarizeMissionWindow(rows, windows.previous, telemetryMissionKeys);
  const currentAgentStats = missionFlow === null ? [] : summarizeAgentWindow(rows, windows.current, { rootDir, completedMissionKeys: completedMissionKeys(windows.current) });
  const previousAgentStats = missionFlow === null ? [] : summarizeAgentWindow(rows, windows.previous, { rootDir, completedMissionKeys: completedMissionKeys(windows.previous) });
  const currentMissionColors = colorMissionCounts(currentAgentStats);
  const currentAgentColors = colorAverageFixRounds(currentAgentStats);
  const previousMissionColors = colorMissionCounts(previousAgentStats);
  const previousAgentColors = colorAverageFixRounds(previousAgentStats);

  const lines = [];
  lines.push(...missionFlowSection('Mission flow — current week', missionFlow, windows.current));
  lines.push('');
  lines.push(...missionFlowSection('Mission flow — previous week', missionFlow, windows.previous));
  lines.push('');
  lines.push(fmt.bold(`Agent telemetry — current week (${windows.current.label})`));
  lines.push(formatStatsTable(
    agentTelemetryHeader(),
    [agentTelemetryRow(currentMissionStats.total, currentMissionStats.userValue, currentMissionStats.aiSdlc, currentMissionStats.unknown)]
  ));
  lines.push('');
  lines.push(fmt.bold(`Agent telemetry — previous week (${windows.previous.label})`));
  lines.push(formatStatsTable(
    agentTelemetryHeader(),
    [agentTelemetryRow(previousMissionStats.total, previousMissionStats.userValue, previousMissionStats.aiSdlc, previousMissionStats.unknown)]
  ));
  lines.push('');
  lines.push(fmt.bold(`Agent performance this week (${windows.current.label}) — completed Missions`));
  lines.push(missionFlow === null ? 'Agent performance unavailable: lifecycle history was not read.' : formatStatsTable(
    ['Agent family', '# missions as implementer', 'Average PR fix rounds to complete mission', 'PR fix n'],
    currentAgentStats.length > 0
      ? currentAgentStats.map((row, index) => [row.implementer, currentMissionColors[index], currentAgentColors[index] ?? 'unavailable', String(row.prFixObservationCount)])
      : [['none', '0', 'unavailable', '0']]
  ));
  lines.push('');
  const currentAgentSpend = summarizeAgentStageSpend(rows, windows.current);
  lines.push(fmt.bold(`Agent spend by stage this week (${windows.current.label}) — resource consumption`));
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
  lines.push(fmt.bold(`Agent performance previous week (${windows.previous.label}) — completed Missions`));
  lines.push(missionFlow === null ? 'Agent performance unavailable: lifecycle history was not read.' : formatStatsTable(
    ['Agent family', '# missions as implementer', 'Average PR fix rounds to complete mission', 'PR fix n'],
    previousAgentStats.length > 0
      ? previousAgentStats.map((row, index) => [row.implementer, previousMissionColors[index], previousAgentColors[index] ?? 'unavailable', String(row.prFixObservationCount)])
      : [['none', '0', 'unavailable', '0']]
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
  const missionFlow = options.missionFlow ?? null;
  const completedMissionKeys = new Set((missionFlow || [])
    .filter(outcome => String(outcome.closedAt).slice(0, 10) >= window.start.toISOString().slice(0, 10)
      && String(outcome.closedAt).slice(0, 10) <= window.end.toISOString().slice(0, 10))
    .map(outcome => `${String(outcome.repo).trim()}::${String(outcome.mission).trim().toLowerCase()}`));
  const telemetryMissionKeys = new Set(rows.map(row =>
    `${String(row.repo ?? '').trim()}::${String(row.mission ?? '').trim().toLowerCase()}`,
  ));
  const missionStats = summarizeMissionWindow(rows, window, telemetryMissionKeys);
  const agentStats = missionFlow === null ? [] : summarizeAgentWindow(rows, window, { rootDir, completedMissionKeys });
  const missionColors = colorMissionCounts(agentStats);
  const agentColors = colorAverageFixRounds(agentStats);

  const lines = [];
  lines.push(...missionFlowSection('Mission flow', missionFlow, window));
  lines.push('');
  lines.push(fmt.bold(`Agent telemetry missions (${window.label})`));
  lines.push(formatStatsTable(
    agentTelemetryHeader(),
    [agentTelemetryRow(missionStats.total, missionStats.userValue, missionStats.aiSdlc, missionStats.unknown)]
  ));
  lines.push('');
  lines.push(fmt.bold(`Agent performance (${window.label}) — completed Missions`));
  lines.push(missionFlow === null ? 'Agent performance unavailable: lifecycle history was not read.' : formatStatsTable(
    ['Agent family', '# missions as implementer', 'Average PR fix rounds to complete mission', 'PR fix n'],
    agentStats.length > 0
      ? agentStats.map((row, index) => [row.implementer, missionColors[index], agentColors[index] ?? 'unavailable', String(row.prFixObservationCount)])
      : [['none', '0', 'unavailable', '0']]
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
  // The canonical identity, plus any explicitly declared legacy alias this
  // repository's older rows were persisted under. Never a broadened query: the
  // caller supplies the exact identities, and new rows only use the canonical one.
  const wantedRepos = new Set(
    (opts.repos && opts.repos.length > 0
      ? opts.repos
      : [opts.repo || resolveStatsRepoName(opts.rootDir)]
    ).map(identity => String(identity).trim()),
  );
  const missionRows = (rows || []).filter(row =>
    String(row.mission || '').trim().toLowerCase() === wanted &&
    wantedRepos.has(String(row.repo || '').trim())
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
