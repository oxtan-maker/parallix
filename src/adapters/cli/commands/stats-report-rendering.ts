// Markdown/table report rendering for `px stats` (extracted from stats.ts, task-2369.02).
//
// Leaf module: it must never import `./stats.js`. stats.ts imports these symbols
// and re-exports them, so a back-import would close an import cycle.

import { quotaUsageLevel, statsRowActorKey, type StatsRow } from '../../../application/services/statistics-row.js';

import type { ReviewStatistics } from '../../../application/services/review-statistics.js';
import type { ReportRow, DateWindow, AgentWindowOptions } from './stats-rendering-types.js';

import * as fmt from '../../../application/presentation/cli-format.js';
import * as statsReport from './stats-report.js';
import { resolveCanonicalRepositoryId } from '../../git/repository-identity.js';

export interface AgentStageSpend {
  readonly implementer: string;
  /** Concrete recorded model; null when no evidence names one. */
  readonly model: string | null;
  readonly actor: string;
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

/** A recorded model that is not a runner-family label or a legacy merge marker. */
function concreteModel(value: unknown): string | null {
  const model = String(value ?? '').trim();
  return model && !GENERIC_MODEL_LABELS.has(model.toLowerCase()) ? model : null;
}
const GENERIC_MODEL_LABELS = new Set(['codex', 'claude', 'custom', 'mixed', 'unknown', 'vibe', 'mistral', 'openai', 'anthropic']);

/**
 * The model that performed this agent's implementation work on a mission;
 * reviewer rows never contribute. Without `at` the latest recorded model wins
 * (the finisher). With `at`: an agent that used exactly one concrete model on
 * the mission wrote everything with it; otherwise the model must be provable
 * from the telemetry dates: the newest implementation evidence on or before the
 * return's day, where a generic, mixed or blank row counts as evidence that
 * names no model. A same-day switch, newer unknown evidence or nothing earlier
 * is unavailable (null).
 */
function implementerModel(rows: readonly ReportRow[], agent: string, at?: string | null): string | null {
  // Unknown-model implementation rows (generic, mixed, blank) are evidence too: they date work no concrete model can claim.
  // Integration rollup rows (stage default) carry the final model but a blank one is routine, so only a concrete default row counts.
  const evidence = rows.filter(row => (row.stage || 'default') !== 'review' && statsRowActorKey(row) === agent
    && ((row.stage || 'default') !== 'default' || concreteModel(row.model)))
    .map(row => ({ model: concreteModel(row.model), date: String(row.date || '') })).sort((a, b) => a.date.localeCompare(b.date));
  if (!at) { return evidence.filter(entry => entry.model).at(-1)?.model ?? null; }
  const known = new Set(evidence.map(entry => entry.model));
  // One model proves everything only when no implementation row of the agent is unknown.
  if (known.size === 1 && !known.has(null)) { return evidence[0].model; }
  const day = at.slice(0, 10);
  const upTo = evidence.filter(entry => entry.date <= day);
  const latestDate = upTo.at(-1)?.date;
  if (!latestDate) { return null; }
  const latest = new Set(upTo.filter(entry => entry.date === latestDate).map(entry => entry.model));
  // Work on the return's own day may come before or after it, so the prior evidence stays possible.
  if (latestDate === day) { upTo.filter(entry => entry.date < day).slice(-1).forEach(entry => latest.add(entry.model)); }
  return latest.size === 1 ? [...latest][0] : null;
}

/** Every concrete model this agent recorded implementation work with on the mission. */
function agentModels(rows: readonly ReportRow[], agent: string): string[] {
  return [...new Set(rows.filter(row => (row.stage || 'default') !== 'review' && statsRowActorKey(row) === agent)
    .map(row => concreteModel(row.model)).filter((model): model is string => model !== null))];
}

export interface ModelPerformance {
  readonly model: string | null;
  /** Completed missions this model implemented: it finished them or wrote work that was sent back. */
  readonly missions: number;
  /** Of those, the missions with return evidence; only they enter the average. */
  readonly measuredMissions: number;
  /** Returns of work this model wrote, over its measured missions. */
  readonly reimplementationRounds: number;
  /** True when a return could belong to this model but cannot be attributed: its returns are a lower bound. */
  readonly incomplete: boolean;
}

/**
 * A mission counts for every model that implemented it (finisher or author of
 * returned work) and each return follows the model that wrote the rejected
 * work, so a model's average is its returns over the missions it was attributed
 * in. A return no concrete model can claim accumulates under the single
 * `model: null` entry and marks the mission's named models incomplete; a
 * mission without return evidence makes its models incomplete, never zero.
 */
type AttributedReturn = { author: string | null | undefined; model: string | null };

/** Models a return nobody could pin down might belong to: the author's own models, or every involved model when the author is unknown. */
function uncertainModels(missionRows: readonly ReportRow[], attributed: readonly AttributedReturn[], involved: ReadonlySet<string | null>): Set<string> {
  // Collected only after the whole involved set is known, so the result never depends on return order.
  const uncertain = new Set<string>();
  for (const { author, model } of attributed) {
    if (model !== null) { continue; }
    if (author) { agentModels(missionRows, author).forEach(candidate => uncertain.add(candidate)); }
    else { involved.forEach(candidate => candidate && uncertain.add(candidate)); }
  }
  return uncertain;
}

function attributeMission(missionRows: readonly ReportRow[], owner: string, info: ReviewStatistics | undefined) {
  const involved = new Set<string | null>([implementerModel(missionRows, owner)]);
  for (const author of Object.keys(info?.byImplementer ?? {})) { if (author !== 'unknown') { involved.add(implementerModel(missionRows, author)); } }
  const rounds = new Map<string | null, number>();
  const attributed: AttributedReturn[] = (info?.returns ?? []).map(({ author, at }) => ({ author, model: author ? implementerModel(missionRows, author, at) : null }));
  for (const { model } of attributed) { rounds.set(model, (rounds.get(model) ?? 0) + 1); if (model !== null) { involved.add(model); } }
  if (rounds.has(null)) { involved.add(null); }
  return { involved, rounds, uncertain: uncertainModels(missionRows, attributed, involved) };
}

function rowsByCompletedMission(rows: readonly ReportRow[], keys: ReadonlySet<string>): Map<string, ReportRow[]> {
  const byMission = new Map<string, ReportRow[]>();
  for (const row of rows) {
    const key = statisticsMissionKey(row);
    if (keys.has(key)) { (byMission.get(key) ?? byMission.set(key, []).get(key)!).push(row); }
  }
  return byMission;
}

function summarizeAgentWindow(rows: readonly ReportRow[], _window: DateWindow, options: AgentWindowOptions = {}): ModelPerformance[] {
  const keys = options.completedMissionKeys ?? new Set<string>();
  const byMission = rowsByCompletedMission(rows, keys);
  const groups = new Map<string | null, { missions: number; measured: number; rounds: number; incomplete: boolean }>();
  const group = (model: string | null) => groups.get(model) ?? groups.set(model, { missions: 0, measured: 0, rounds: 0, incomplete: false }).get(model)!;
  for (const key of keys) {
    const owner = options.completedMissionOwners?.get(key);
    if (!owner) { continue; }
    const info = options.reviewObservations?.get(key);
    const measured = Boolean(info) && info!.total !== null;
    const { involved, rounds, uncertain } = attributeMission(byMission.get(key) ?? [], owner, info);
    for (const model of involved) {
      const target = group(model);
      target.missions += 1;
      if (!measured) { continue; }
      target.measured += 1;
      target.rounds += rounds.get(model) ?? 0;
      if (model !== null && uncertain.has(model)) { target.incomplete = true; }
    }
  }
  return [...groups.entries()].map(([model, value]) => ({ model, missions: value.missions, measuredMissions: value.measured,
    reimplementationRounds: value.rounds, incomplete: value.incomplete }))
    .sort((a, b) => String(a.model ?? '\uffff').localeCompare(String(b.model ?? '\uffff')));
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
 * Group windowed telemetry by stage actor and recorded model. Evidence with no
 * concrete model keeps its actor's resource unit under `model: null`, so
 * totals conserve without inventing a model or showing a generic family row.
 * Mission ownership cannot assign a reviewer's dollars to another agent.
 */
function summarizeAgentStageSpend(rows: readonly ReportRow[], window: DateWindow): AgentStageSpend[] {
  const groups = new Map<string, { actor: string; model: string | null; rows: ReportRow[] }>();
  for (const row of rows) {
    if (!statisticsRowInWindow(row, window) || normalizeClassification(row.classification) === null) { continue; }
    const actor = statsRowActorKey(row);
    const model = concreteModel(row.model);
    const key = JSON.stringify([actor, model]);
    const group = groups.get(key) ?? { actor, model, rows: [] };
    group.rows.push(row);
    groups.set(key, group);
  }

  const knownStages = new Set(AGENT_SPEND_STAGE_COLUMNS.map(entry => entry.stage));

  return [...groups.values()]
    .sort((a, b) => String(a.model ?? '\uffff').localeCompare(String(b.model ?? '\uffff')) || a.actor.localeCompare(b.actor))
    .map(({ actor, model, rows: groupRows }) => {
      const family = classifyAgentSpendFamily(model ?? actor, groupRows);
      const byStage: Record<string, number | null> = {};
      for (const { stage } of AGENT_SPEND_STAGE_COLUMNS) {byStage[stage] = family === 'usage' ? null : 0;}
      for (const row of groupRows) { accumulateStageResource(byStage, row, family, knownStages); }
      const values = Object.values(byStage).filter((value): value is number => value !== null);
      // Quota levels per stage and dollars/minutes alike: the total adds the stage columns.
      const total = family === 'usage' && values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0);
      return { implementer: model ?? 'unavailable', model, actor, family, byStage, total };
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
  if (family === 'usage') {return `${value}%`;}
  if (!total) {return '—';}
  const pct = Math.round((value / total) * 100);
  if (family === 'cost') {
    const rounded = Math.round(value * 100) / 100;
    return `$${rounded} (${pct}%)`;
  }
  return `${value}m (${pct}%)`;
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
  summarizeAgentWindow,
  summarizeAgentStageSpend,
  classifyAgentSpendFamily,
  formatAgentSpendCell,
  colorMissionCounts,
  AGENT_SPEND_STAGE_COLUMNS,
  MISSION_PHASE_ORDER,
  renderMissionPhaseReport,
};
