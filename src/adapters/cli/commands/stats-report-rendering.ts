// Markdown/table report rendering for `px stats` (extracted from stats.ts, task-2369.02).
//
// Leaf module: it must never import `./stats.js`. stats.ts imports these symbols
// and re-exports them, so a back-import would close an import cycle.

import type { StatsRow } from '../../../application/services/statistics-row.js';

import type { ReportRow, DateWindow, MissionGroupOptions, AgentWindowOptions, MissionStats } from './stats-rendering-types.js';

import * as fmt from '../../../application/presentation/cli-format.js';
import * as statsReport from './stats-report.js';
import { resolveCanonicalRepositoryId } from '../../git/repository-identity.js';
import { compareCodeUnits } from '../../../domain/comparators.js';

export interface AgentStageSpend {
  readonly implementer: string;
  readonly family: 'usage' | 'cost' | 'duration';
  readonly byStage: Record<string, number>;
  readonly total: number;
}
import {
  statisticsMissionKey,
  statisticsRowInWindow,
} from '../../../application/services/statistics-service.js';
import {
  parseBooleanish, normalizeRow, normalizeRows, statsMissionKey, modelBelongsToImplFamily,
  isValidClassification, normalizeClassification, rowInWindow,
} from './stats-normalization.js';

// Core single-mission renderer from stats-report.ts (task-2217)
const { renderMissionPhaseReport: _renderMissionPhaseReport } = statsReport;

function formatDate(dateStr: string) {
  if (!dateStr) {return '';}
  try {
    const date = new Date(dateStr);
    return date.toISOString().split('T')[0];
  } catch (_err) {
    return dateStr;
  }
}

function groupBy(rows: readonly StatsRow[], field: keyof StatsRow) {

  const groups: Record<string, StatsRow[]> = {};
  for (const row of rows) {
    const key = String(row[field] || 'unknown');
    if (!groups[key]) {groups[key] = [];}
    groups[key].push(row);
  }
  return groups;
}

function computeImplStats(group: readonly StatsRow[]) {
  const total = group.length;
  const merged = group.filter(row => row.isMerged).length;
  const totalReviews = group.reduce((sum, row) => sum + (Number.parseInt(String(row.review_count || ''), 10) || 0), 0);
  const avgReviews = total > 0 ? (totalReviews / total).toFixed(2) : '0.00';
  const reviewRounds = group.reduce((sum, row) => sum + Math.max(1, Number.parseInt(String(row.review_count || ''), 10) || 0), 0);
  const avgRounds = total > 0 ? (reviewRounds / total).toFixed(2) : '0.00';
  return { total, merged, totalReviews, avgReviews, reviewRounds, avgRounds };
}

function computePeriodStats(group: readonly StatsRow[]) {
  const dates = group.map(row => formatDate(String(row.normalizedDate))).filter(Boolean);
  if (dates.length === 0) {return null;}
  const sorted = dates.sort(compareCodeUnits);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const start = new Date(first);
  const end = new Date(last);
  const days = Math.max(1, Math.ceil((Number(end) - Number(start)) / (1000 * 60 * 60 * 24)) + 1);
  const total = group.length;
  const merged = group.filter(row => row.isMerged).length;
  const open = total - merged;
  const totalReviews = group.reduce((sum, row) => sum + (Number.parseInt(String(row.review_count || ''), 10) || 0), 0);
  const avgReviews = total > 0 ? (totalReviews / total).toFixed(2) : '0.00';
  return { period: `${first} → ${last}`, days, total, merged, open, totalReviews, avgReviews };
}

function appendMarkdownGrouping(lines: string[], rows: readonly ReportRow[], groupByField: string | undefined) {
  if (groupByField === 'implementer') {
    const groups = groupBy(rows, 'implementer');
    lines.push('## By Implementer\n', '| Agent | PRs | Merged | Open | Total Reviews | Avg Reviews/PR | Avg Review Rounds |', '|-------|-----|--------|------|---------------|----------------|-------------------|');
    const implData = Object.entries(groups).map(([implementer, group]) => {
      const stats = computeImplStats(group);
      return { implementer, prs: stats.total, merged: stats.merged, open: group.filter(row => !row.isMerged).length, totalReviews: stats.totalReviews, avgReviews: stats.avgReviews, avgRounds: stats.avgRounds };
    }).sort((a, b) => b.prs - a.prs);
    for (const row of implData) { lines.push(`| ${row.implementer} | ${row.prs} | ${row.merged} | ${row.open} | ${row.totalReviews} | ${row.avgReviews} | ${row.avgRounds} |`); }
    lines.push('');
    return;
  }
  if (groupByField === 'period') {
    const groups: Record<string, ReportRow[]> = {};
    for (const row of rows) {
      const date = formatDate(String(row.normalizedDate));
      if (!date) { continue; }
     (groups[date.substring(0, 7)] ||= []).push(row);
    }
    lines.push('## By Period (Month)\n', '| Period | Days | PRs | Merged | Open | Total Reviews | Avg Reviews/PR |', '|--------|------|-----|--------|------|---------------|----------------|');
    for (const month of Object.keys(groups).sort(compareCodeUnits)) {
      const period = computePeriodStats(groups[month]);
      if (period) { lines.push(`| ${period.period} | ${period.days} | ${period.total} | ${period.merged} | ${period.open} | ${period.totalReviews} | ${period.avgReviews} |`); }
    }
    lines.push('');
    return;
  }
  if (groupByField !== 'merged') { return; }
  const renderRows = (title: string, rowsToRender: ReportRow[]) => {
    lines.push(title);
    if (rowsToRender.length === 0) { lines.push('None.', ''); return; }
    lines.push('| Mission | Implementer | Reviews | Reviewer | Created |', '|---------|-------------|---------|----------|---------|');
    for (const row of rowsToRender.sort((a, b) => String(a.normalizedDate || '').localeCompare(String(b.normalizedDate || '')))) {
      lines.push(`| ${row.mission} | ${row.implementer} | ${row.review_count} | ${row.reviewer} | ${formatDate(String(row.normalizedDate))} |`);
    }
    lines.push('');
  };
  lines.push('## Merged vs Unmerged\n');
  renderRows('### Merged PRs\n', rows.filter(row => row.isMerged));
  renderRows('### Unmerged/Closed PRs\n', rows.filter(row => !row.isMerged));
}

function generateMarkdownReport(data: { headers: string[]; rows: StatsRow[] }, options: { groupBy?: string } = {}) {
  const rows = normalizeRows(data.rows);
  const groupByField = options.groupBy;

  if (rows.length === 0) {
    return 'No data to report.';
  }

  const lines = [];
  lines.push('# Forgejo Stats Report\n');
  lines.push(`Generated: ${new Date().toISOString().split('T')[0]}\n`);
  lines.push(`Total PRs analyzed: ${rows.length}\n`);
  const overallMerged = rows.filter(row => row.isMerged).length;
  const overallOpen = rows.length - overallMerged;
  const overallReviews = rows.reduce((sum, row) => sum + (Number.parseInt(row.review_count || '', 10) || 0), 0);
  lines.push('## Overall Summary\n');
  lines.push(`- **Total PRs:** ${rows.length}`);
  lines.push(`- **Merged:** ${overallMerged}`);
  lines.push(`- **Open/Closed:** ${overallOpen}`);
  lines.push(`- **Total Reviews Submitted:** ${overallReviews}`);
  lines.push(`- **Avg Reviews/PR:** ${(overallReviews / rows.length).toFixed(2)}`);
  lines.push('');

  lines.push('## Per-PR Detail\n');
  lines.push('| Mission | Implementer | Reviewer | Reviews | Merged | Created |');
  lines.push('|---------|-------------|----------|---------|--------|---------|');
  const sorted = [...rows].sort((a, b) => String(a.normalizedDate || '').localeCompare(String(b.normalizedDate || '')));
  for (const row of sorted) {
    lines.push(`| ${row.mission} | ${row.implementer} | ${row.reviewer} | ${row.review_count} | ${row.normalizedMerged} | ${formatDate(String(row.normalizedDate))} |`);
  }
  lines.push('');

  appendMarkdownGrouping(lines, rows, groupByField);

  lines.push('## Raw Data\n');
  lines.push('```csv');
  lines.push(data.headers.join(','));
  for (const row of rows) {
    lines.push(data.headers.map(header => (row as Record<string, unknown>)[header] || '').join(','));
  }
  lines.push('```\n');

  return lines.join('\n');
}

/**
 * Shared mission-dedup + agent-grouping pass behind `Agent performance this
 * week`. Deduplicates globally by (repo, mission) so each mission is counted
 * exactly once across all agent groups, then groups the winning per-mission
 * rows by display key (model name, falling back to implementer family).
 * Also returns a mission-key -> displayKey map so other report sections
 * (e.g. the stage-spend table) can fan back out over the *raw*, non-deduped
 * window rows using the same row identity/grouping without re-deriving it.
 *
 */
function shouldReplaceMissionRow(row: ReportRow, previous: ReportRow | undefined): boolean {
  if (!previous) { return true; }
  const model = String(row.model || '').trim();
  const previousModel = String(previous.model || '').trim();
  if (Boolean(model) !== Boolean(previousModel)) { return Boolean(model); }
  if (!model) { return true; }
  const familyMatch = row.implementer && modelBelongsToImplFamily(model, row.implementer);
  const previousFamilyMatch = previous.implementer && modelBelongsToImplFamily(previousModel, previous.implementer);
  if (Boolean(familyMatch) !== Boolean(previousFamilyMatch)) { return Boolean(familyMatch); }
  return row.date !== undefined && previous.date !== undefined && row.date >= previous.date;
}

function missionCandidates(rows: readonly ReportRow[]) {
  const byMission: Record<string, ReportRow> = {};
  const rowsByMission: Record<string, ReportRow[]> = {};
  for (const row of rows) {
    const key = statisticsMissionKey(row);
   (rowsByMission[key] ||= []).push(row);
    if (shouldReplaceMissionRow(row, byMission[key])) { byMission[key] = row; }
  }
  return { byMission, rowsByMission };
}

function assignCompletedMissionOwners(byMission: Record<string, ReportRow>, rowsByMission: Record<string, ReportRow[]>, owners?: ReadonlyMap<string, string | null>) {
  for (const [key, rows] of Object.entries(rowsByMission)) {
    const rollup = [...rows].reverse().find(row => (row.stage || 'default') === 'default');
    // An integration rollup records the Review's final implementer explicitly.
    // Production reports supply the current DB owner, including null for unknown.
    const owner = owners ? owners.get(key) : rollup?.implementer;
    if (!owner) { delete byMission[key]; continue; }
    byMission[key] = { ...(rollup || byMission[key]), reportedImplementer: owner,
      model: '', pr_fix_rounds: rollup?.pr_fix_rounds ?? byMission[key].pr_fix_rounds };
  }
}

function groupMissionCandidates(rows: readonly ReportRow[]) {
  const groups: Record<string, ReportRow[]> = {};
  const missionKeyToDisplayKey: Record<string, string> = {};
  for (const row of rows) {
    const model = String(row.model || '').trim();
    const displayKey = row.reportedImplementer
      ? (model && modelBelongsToImplFamily(model, row.reportedImplementer) ? model : row.reportedImplementer)
      : (model || row.implementer || 'unknown');
    missionKeyToDisplayKey[statisticsMissionKey(row)] = displayKey;
   (groups[displayKey] ||= []).push(row);
  }
  return { groups, missionKeyToDisplayKey };
}

function computeAgentMissionGroups(rows: readonly ReportRow[], window: DateWindow, options: MissionGroupOptions = {}) {
  const completedMissionKeys = options.completedMissionKeys || new Set();
  const windowRows = options.completedOnly
    ? rows.filter((row: ReportRow) => completedMissionKeys.has(statisticsMissionKey(row)))
    : rows.filter((row: ReportRow) => statisticsRowInWindow(row, window));
  const allValidWindowRows = windowRows.filter((row: ReportRow) => normalizeClassification(row.classification) !== null);
  const { byMission, rowsByMission } = missionCandidates(allValidWindowRows);
  if (options.completedOnly) { assignCompletedMissionOwners(byMission, rowsByMission, options.completedMissionOwners); }
  const { groups, missionKeyToDisplayKey } = groupMissionCandidates(Object.values(byMission));
  return { allValidWindowRows, groups, missionKeyToDisplayKey };
}

function summarizeAgentWindow(rows: readonly ReportRow[], window: DateWindow, options: AgentWindowOptions = {}) {

  const opts = options;
  const { rootDir = null, deriveFixRoundsFn = null } = opts;
  // Mission counts and repair-round averages describe completed missions only.
  // Other report sections reuse the grouping helper without this filter so
  // their live stage telemetry remains unchanged.
  const { allValidWindowRows, groups } = computeAgentMissionGroups(rows, window, {
    completedOnly: true, completedMissionKeys: options.completedMissionKeys, completedMissionOwners: options.completedMissionOwners,
  });
  // Build agent groups from the globally deduplicated missions.
  //
  // `pr_fix_rounds` comes off the stored measurement rows. This used to be
  // re-derived here from the mission-local review event files, because those
  // files were the only complete record of the loop and the stored value could
  // lag them. After the architecture migration cutover the Review aggregate in the
  // operator database is that record, and it is what stamps the stored value —
  // so there is nothing left for a render-time override to correct, and a
  // synchronous renderer has no business reading the database behind the
  // application's back to try. `deriveFixRoundsFn` stays as an injection point
  // for a caller that has already derived a count.
  //
  // Review-fix values are nullable telemetry observations, keyed by lifecycle
  // completion rather than a telemetry completion row.
  const storedRoundsByMission = collectStoredFixRounds(allValidWindowRows);
  const roundsFor = (row: ReportRow) => {
    if (rootDir && deriveFixRoundsFn) {
      const authoritative = deriveFixRoundsFn(row.mission, rootDir, row.repo);
      if (authoritative !== null && authoritative !== undefined) {
        const rounds = Number.parseInt(String(authoritative), 10);
        return Number.isInteger(rounds) && rounds >= 0 ? rounds : null;
      }
    }
    return storedRoundsByMission[statisticsMissionKey(row)] ?? null;
  };
  return Object.entries(groups)
    .map(([displayKey, group]) => {
      const rounds = group.map(roundsFor).filter(value => value !== null);
      const totalRounds = rounds.reduce((sum: number, value: number) => sum + value, 0);
      return {
        implementer: displayKey,
        missions: group.length,
        averageFixRounds: rounds.length > 0 ? (totalRounds / rounds.length).toFixed(2) : null,
        prFixObservationCount: rounds.length,
      };
    })
    .sort((a, b) => a.implementer.localeCompare(b.implementer));
}

function collectStoredFixRounds(rows: readonly ReportRow[]): Record<string, number> {
  const storedRoundsByMission: Record<string, number> = {};
  const roundsFromRollupByMission = new Set<string>();
  for (const row of rows) {
    const key = statisticsMissionKey(row);
    if (row.pr_fix_rounds === undefined || (row.stage !== 'default' && roundsFromRollupByMission.has(key))) { continue; }
    const rounds = Number.parseInt(String(row.pr_fix_rounds), 10);
    if (!Number.isInteger(rounds) || rounds < 0) { continue; }
    storedRoundsByMission[key] = rounds;
    if (row.stage === 'default') { roundsFromRollupByMission.add(key); }
  }
  return storedRoundsByMission;
}

// Canonical report stages for the per-agent spend-by-stage table (architecture migration).
// Stored stage `active` is displayed as `execute`, matching the alias already
// used by `MISSION_PHASE_ORDER` for the single-mission phase report. Unlike
// `MISSION_PHASE_ORDER`, this table also carries an explicit `default` column
// (rows with no stage recorded) because the backlog request names it directly.
const AGENT_SPEND_STAGE_COLUMNS = [
  { stage: 'draft', label: 'draft' },
  { stage: 'active', label: 'execute' },
  { stage: 'review', label: 'review' },
  { stage: 'follow-up', label: 'follow-up' },
  { stage: 'default', label: 'default' },
];

/**
 * Classifies a grouped agent row into the spend metric family whose stored
 * telemetry field is the right lens for that agent (architecture migration):
 *  - Codex / OpenAI-backed rows: `openai_usage_after` (usage % snapshot)
 *  - Claude and Mistral rows: `cost_usd` (dollar spend)
 *  - Custom/local-model rows (and anything else unrecognized, since custom/
 *    local is the safe default per the backlog request): `duration_minutes`
 *
 */
function classifyAgentSpendFamily(displayKey: string, groupRows: readonly StatsRow[]): AgentStageSpend['family'] {
  const probe = [displayKey, ...groupRows.flatMap(row => [row.model, row.implementer, row.provider])]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (/codex|openai/.test(probe)) {return 'usage';}
  if (/claude|anthropic/.test(probe)) {return 'cost';}
  if (/mistral/.test(probe)) {return 'cost';}
  return 'duration';
}

/**
 * Builds the current-week per-agent stage-spend breakdown behind the new
 * weekly stats table (architecture migration). Reuses the exact same mission dedup and
 * display-key grouping as `summarizeAgentWindow()` (so rows/ordering match
 * `Agent performance this week`), then fans back out over every raw window
 * row (not just the deduped mission winner) to sum each stage's spend metric,
 * since draft/execute/review/follow-up/default are stored as separate rows
 * per mission.
 *
 */
function summarizeAgentStageSpend(rows: readonly ReportRow[], window: DateWindow): AgentStageSpend[] {
  const { allValidWindowRows, groups, missionKeyToDisplayKey } = computeAgentMissionGroups(rows, window);

  const rawRowsByDisplayKey: Record<string, ReportRow[]> = {};
  for (const row of allValidWindowRows) {
    const displayKey = missionKeyToDisplayKey[statisticsMissionKey(row)];
    if (!displayKey) {continue;}
    if (!rawRowsByDisplayKey[displayKey]) {rawRowsByDisplayKey[displayKey] = [];}
    rawRowsByDisplayKey[displayKey].push(row);
  }

  const knownStages = new Set(AGENT_SPEND_STAGE_COLUMNS.map(entry => entry.stage));

  return Object.keys(groups)
    .sort((a, b) => a.localeCompare(b))
    .map(displayKey => {
      const family = classifyAgentSpendFamily(displayKey, groups[displayKey]);

      const byStage: Record<string, number> = {};
      for (const { stage } of AGENT_SPEND_STAGE_COLUMNS) {byStage[stage] = 0;}
      for (const row of (rawRowsByDisplayKey[displayKey] || [])) {
        const rawStage = String(row.stage || 'default').trim().toLowerCase() || 'default';
        const bucket = knownStages.has(rawStage) ? rawStage : 'default';
        const value = family === 'usage' ? (Number.parseInt(String(row.openai_usage_after), 10) || 0)
          : family === 'cost' ? (Number.parseFloat(String(row.cost_usd)) || 0)
          : (Number.parseInt(String(row.duration_minutes), 10) || 0);
        byStage[bucket] += value;
      }
      const total = AGENT_SPEND_STAGE_COLUMNS.reduce((sum, { stage }) => sum + byStage[stage], 0);
      return { implementer: displayKey, family, byStage, total };
    });
}

/**
 * Formats one spend-table cell as `<metric> (<share %>)`, matching the
 * backlog request's example (`1$ (10%)`). Renders a stable empty-state value
 * instead of misleading `0%` share math when the row has no non-zero spend
 * for its metric family (architecture migration, SC-6).
 *
 */
function formatAgentSpendCell(value: number, total: number, family: AgentStageSpend['family']) {
  if (!total) {return '—';}
  const pct = Math.round((value / total) * 100);
  if (family === 'usage') {return `${value}% (${pct}%)`;}
  if (family === 'cost') {
    const rounded = Math.round(value * 100) / 100;
    return `$${rounded} (${pct}%)`;
  }
  return `${value}m (${pct}%)`;
}

function colorAverageFixRounds(rows: readonly Pick<MissionStats, 'averageFixRounds'>[]) {
  const values = rows
    .map(row => Number.parseFloat(row.averageFixRounds ?? ''))
    .filter(value => Number.isFinite(value));

  if (values.length === 0) {
    return rows.map(row => row.averageFixRounds);
  }

  const best = Math.min(...values);
  const worst = Math.max(...values);
  return rows.map(row => {
    const value = Number.parseFloat(row.averageFixRounds ?? '');
    if (!Number.isFinite(value)) {return row.averageFixRounds;}
    if (best === worst) {
      return fmt.colorize(fmt.colors.green, row.averageFixRounds ?? '');
    }
    if (value === best) {
      return fmt.colorize(fmt.colors.green, row.averageFixRounds ?? '');
    }
    if (value === worst) {
      return fmt.colorize(fmt.colors.red, row.averageFixRounds ?? '');
    }
    return fmt.colorize(fmt.colors.yellow, row.averageFixRounds ?? '');
  });
}

function colorMissionCounts(rows: readonly Pick<MissionStats, 'missions'>[]) {
  const values = rows
    .map(row => Number.parseInt(String(row.missions), 10))
    .filter(value => Number.isFinite(value));

  if (values.length === 0) {
    return rows.map(row => String(row.missions));
  }

  const best = Math.max(...values);
  const worst = Math.min(...values);
  return rows.map(row => {
    const value = Number.parseInt(String(row.missions), 10);
    if (!Number.isFinite(value)) {return String(row.missions);}
    if (best === worst) {
      return fmt.colorize(fmt.colors.green, String(row.missions));
    }
    if (value === best) {
      return fmt.colorize(fmt.colors.green, String(row.missions));
    }
    if (value === worst) {
      return fmt.colorize(fmt.colors.red, String(row.missions));
    }
    return fmt.colorize(fmt.colors.yellow, String(row.missions));
  });
}

// Maps the stored `stage` value to the phase label used in the mission report.
const MISSION_PHASE_ORDER = [
  { stage: 'draft', label: 'draft' },
  { stage: 'active', label: 'execute' },
  { stage: 'review', label: 'review' },
  { stage: 'follow-up', label: 'follow-up' },
];

/**
 * Render a single-mission, per-phase telemetry breakdown.
 * Delegates to stats-report.ts (task-2217 extraction).
 *
 */
function renderMissionPhaseReport(rows: readonly StatsRow[], slug: string, options: Parameters<typeof _renderMissionPhaseReport>[2] = {}) {
  const opts = options || {};
  // Same identity `resolveStatsRepoName()` in stats.ts resolves; called directly
  // here so this module stays a leaf (no import back into stats.ts). An
  // explicit repo option takes precedence and skips the git-based resolution.
  const repo = opts.repo || resolveCanonicalRepositoryId(opts.rootDir || process.cwd());
  return _renderMissionPhaseReport(rows, slug, {
    ...opts,
    repo,
    repos: [repo],
  });
}

export {
  formatDate,
  parseBooleanish,
  normalizeRow,
  normalizeRows,
  statsMissionKey,
  modelBelongsToImplFamily,
  groupBy,
  computeImplStats,
  computePeriodStats,
  generateMarkdownReport,
  isValidClassification,
  normalizeClassification,
  rowInWindow,
  computeAgentMissionGroups,
  summarizeAgentWindow,
  summarizeAgentStageSpend,
  classifyAgentSpendFamily,
  formatAgentSpendCell,
  colorAverageFixRounds,
  colorMissionCounts,
  AGENT_SPEND_STAGE_COLUMNS,
  MISSION_PHASE_ORDER,
  renderMissionPhaseReport,
};
