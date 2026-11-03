// Markdown/table report rendering for `px stats` (extracted from stats.ts, task-2369.02).
//
// Leaf module: it must never import `./stats.js`. stats.ts imports these symbols
// and re-exports them, so a back-import would close an import cycle.

import { quotaUsageLevel, statsRowActorKey, type StatsRow } from '../../../application/services/statistics-row.js';

import type { ReportRow, DateWindow, MissionGroupOptions, AgentWindowOptions, MissionStats } from './stats-rendering-types.js';

import * as fmt from '../../../application/presentation/cli-format.js';
import * as statsReport from './stats-report.js';
import { resolveCanonicalRepositoryId } from '../../git/repository-identity.js';

export interface AgentStageSpend {
  readonly implementer: string;
  readonly family: 'usage' | 'cost' | 'duration';
  readonly byStage: Record<string, number | null>;
  readonly total: number | null;
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
      model: '' };
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

  const { groups } = computeAgentMissionGroups(rows, window, {
    completedOnly: true, completedMissionKeys: options.completedMissionKeys, completedMissionOwners: options.completedMissionOwners,
  });
  const observations = new Map<string, number[]>();
  const summaries = [...(options.reviewObservations?.entries() ?? [])]
    .filter(([key]) => options.completedMissionKeys?.has(key)).map(([, summary]) => summary);
  for (const summary of summaries) {
    for (const [agent, count] of Object.entries(summary.byImplementer)) {
      if (count === null) { continue; }
      observations.set(agent, [...(observations.get(agent) ?? []), count]);
      groups[agent] ??= [];
    }
  }
  return Object.entries(groups).map(([implementer, delivered]) => {
    const values = observations.get(implementer) ?? [];
    return { implementer, missions: delivered.length,
      averageFixRounds: values.length ? (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2) : null,
      prFixObservationCount: values.length };
  }).sort((a, b) => a.implementer.localeCompare(b.implementer));
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
 * Select the resource unit from the stage actor, falling back to telemetry
 * identity only for legacy rows without a recorded actor:
 *  - Codex / OpenAI-backed rows: `openai_usage_after` (usage % snapshot)
 *  - Claude and Mistral rows: `cost_usd` (dollar spend)
 *  - Custom/local-model rows (and anything else unrecognized, since custom/
 *    local is the safe default per the backlog request): `duration_minutes`
 *
 */
function classifyAgentSpendFamily(displayKey: string, groupRows: readonly StatsRow[]): AgentStageSpend['family'] {
  const actor = groupRows.map(statsRowActorKey).find(Boolean);
  const probe = (actor || [displayKey, ...groupRows.flatMap(row => [row.model, row.provider])]
    .filter(Boolean)
    .join(' ')).toLowerCase();
  if (/codex|openai/.test(probe)) {return 'usage';}
  if (/claude|anthropic/.test(probe)) {return 'cost';}
  if (/mistral|vibe/.test(probe)) {return 'cost';}
  return 'duration';
}

function accumulateStageResource(byStage: Record<string, number | null>, row: StatsRow,
  family: AgentStageSpend['family'], knownStages: ReadonlySet<string>): void {
  const rawStage = String(row.stage || 'default').trim().toLowerCase() || 'default';
  const bucket = knownStages.has(rawStage) ? rawStage : 'default';
  if (family === 'usage') {
    // Snapshots can overlap across stages and reset quota windows. No
    // baseline/window identity proves per-run consumption; keep peaks.
    const value = quotaUsageLevel(row.openai_usage_after);
    if (value !== null) {
      byStage[bucket] = Math.max(byStage[bucket] ?? 0, value);
    }
  } else {
    const value = family === 'cost' ? (Number.parseFloat(String(row.cost_usd)) || 0)
      : (Number.parseInt(String(row.duration_minutes), 10) || 0);
    byStage[bucket] = (byStage[bucket] ?? 0) + value;
  }
}

/**
 * Group windowed telemetry by its stage actor and model. Mission ownership
 * and deduplication belong to delivery performance; they cannot assign a
 * reviewer's dollars or a replacement's runtime to another agent's usage.
 *
 */
function summarizeAgentStageSpend(rows: readonly ReportRow[], window: DateWindow): AgentStageSpend[] {
  const groups = new Map<string, { displayKey: string; rows: ReportRow[] }>();
  for (const row of rows) {
    if (!statisticsRowInWindow(row, window) || normalizeClassification(row.classification) === null) { continue; }
    const actor = statsRowActorKey(row);
    const displayKey = String(row.model || actor || 'unknown').trim();
    const key = JSON.stringify([actor, displayKey]);
    const group = groups.get(key) ?? { displayKey, rows: [] };
    group.rows.push(row);
    groups.set(key, group);
  }

  const knownStages = new Set(AGENT_SPEND_STAGE_COLUMNS.map(entry => entry.stage));

  return [...groups.values()]
    .sort((a, b) => a.displayKey.localeCompare(b.displayKey))
    .map(({ displayKey, rows: groupRows }) => {
      const family = classifyAgentSpendFamily(displayKey, groupRows);

      const byStage: Record<string, number | null> = {};
      for (const { stage } of AGENT_SPEND_STAGE_COLUMNS) {byStage[stage] = family === 'usage' ? null : 0;}
      for (const row of groupRows) { accumulateStageResource(byStage, row, family, knownStages); }
      const values = Object.values(byStage).filter((value): value is number => value !== null);
      const total = family === 'usage' ? (values.length ? Math.max(...values) : null)
        : values.reduce((sum, value) => sum + value, 0);
      return { implementer: displayKey, family, byStage, total };
    });
}

/**
 * Quota snapshots show a labelled peak without a consumption share. Other
 * resource cells use `<metric> (<share %>)`, matching the
 * backlog request's example (`1$ (10%)`). Renders a stable empty-state value
 * instead of misleading `0%` share math when the row has no non-zero spend
 * for its metric family (architecture migration, SC-6).
 *
 */
function formatAgentSpendCell(value: number | null, total: number | null, family: AgentStageSpend['family']) {
  if (value === null) {return '—';}
  if (family === 'usage') {return `${value}% quota peak`;}
  if (!total) {return '—';}
  const pct = Math.round((value / total) * 100);
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

function colorMissionCounts(rows: readonly { missions: unknown }[]) {
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
  parseBooleanish,
  normalizeRow,
  normalizeRows,
  statsMissionKey,
  modelBelongsToImplFamily,
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
