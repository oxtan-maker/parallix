#!/usr/bin/env node

interface StatsOptions {
  rootDir?: string;
  ensureDir?: boolean;
  /** Inject a `MeasurementStorePort` (fast isolated tests use a temp database). */
  store?: unknown;
  /** Override the measurement database path instead of `<PARALLIX_HOME>/parallix.db`. */
  dbPath?: string;
  groupBy?: string;
  forWrite?: boolean;
  config?: unknown;
  repo?: string;
  from?: string;
  to?: string;
  deriveFixRoundsFn?: Function;
  log?: Function;
  error?: Function;
  exit?: Function;
}

import type { MissionStore } from '../../../application/domain-ports.js';
import { missionId } from '../../../domain/mission.js';

interface NormalizeStatsRowOptions {
  repo?: string;
  rootDir?: string;
}

interface StatsRow {
  date?: string;
  repo?: string;
  mission?: string;
  classification?: string;
  implementer?: string;
  pr_fix_rounds?: string;
  provider?: string;
  model?: string;
  implementer_agent?: string;
  reviewer_agent?: string;
  stage?: string;
  input_tokens?: string;
  output_tokens?: string;
  cached_tokens?: string;
  thoughts_tokens?: string;
  context_tokens?: string;
  tool_calls?: string;
  openai_usage_before?: string;
  openai_usage_after?: string;
  openai_usage_delta?: string;
  duration_minutes?: string;
  cost_usd?: string;
  isMerged?: boolean;
  normalizedDate?: string;
  normalizedMerged?: string;
  review_count?: string;
  reviewer?: string;
  merged?: string | boolean;
  has_pr?: string | boolean;
  created_at?: string;
  averageFixRounds?: string;
  missions?: number;
}

import * as fs from 'node:fs';

import * as fmt from '../../../application/presentation/cli-format.js';
import { statsCohorts, resolveOperatorRepositories } from './stats-cohorts.js';
import { ConcreteMetricsReadAdapter } from '../../../application/projections/metrics-read-adapter.js';
import { resolveTaskFile, getTaskClassification, getTaskImplementer, getTaskAssignee } from '../../backlog/backlog.js';
import { isForgejoReviewEnabled } from '../../config/product-config.js';
import { currentReviewRound } from '../../../domain/review.js';
import { git } from '../../git/git.js';
import { resolveCanonicalRepositoryId } from '../../git/repository-identity.js';
import * as forgejo from '../../forgejo/forgejo.js';
import * as statsReport from './stats-report.js';
import { resolveMeasurementStore } from '../../sqlite/measurement-store.js';
import { StatsCommandUseCase } from '../../../application/stats-command-use-case.js';
import type { StatsWorkflowPort } from '../../../application/ports/cli-workflows.js';
import {
  statisticsMissionKey,
  statisticsRowInWindow,
  summarizeCompletedMissionWindow,
} from '../../../application/services/statistics-service.js';
import {
  decisionWindowEndingOn,
  weeklyDecisionWindows,
} from '../../../application/services/decision-window.js';

// Extended telemetry schema for measurement rows stored in SQLite.
const STATS_HEADERS = [
  'date', 'repo', 'mission', 'classification', 'implementer', 'pr_fix_rounds',
  'provider', 'model', 'implementer_agent', 'reviewer_agent', 'stage',
  'input_tokens', 'output_tokens', 'cached_tokens', 'thoughts_tokens', 'context_tokens',
  'tool_calls', 'openai_usage_before', 'openai_usage_after',
  'openai_usage_delta', 'duration_minutes', 'cost_usd'
];

// Columns coerced to non-negative integers on canonicalization.
const USAGE_NUMBERS = new Set([
  'pr_fix_rounds', 'input_tokens', 'output_tokens', 'cached_tokens',
  'thoughts_tokens', 'context_tokens', 'tool_calls', 'openai_usage_before', 'openai_usage_after',
  'openai_usage_delta', 'duration_minutes'
]);

const VALID_CLASSIFICATIONS = new Set(['ai_sdlc', 'user_value', 'unknown']);

/**
 * The repository identity statistics rows are written under.
 *
 * There is exactly one owner: `resolveCanonicalRepositoryId`, which resolves a
 * mission worktree back to the checkout it was branched from. Mission lifecycle
 * lane events already use it, and measurement rows must join against them.
 *
 * A configured `product.name` is a display alias, not an identity (TASK-2363).
 * Preferring it here wrote new measurement rows under a name the lifecycle never
 * used, so those missions silently disappeared from every completed-mission
 * statistic.
 */
function resolveStatsRepoName(rootDir = process.cwd()) {
  return resolveCanonicalRepositoryId(rootDir);
}

/**
 * The measurement authority is `<PARALLIX_HOME>/parallix.db` (ADR 0053,
 * architecture migration). It is parallix-owned cross-repository agent telemetry, so one
 * runtime working across several repos accumulates ONE shared statistic. The
 * database path is never derived from a runtime checkout, installed package,
 * or consuming repository, and there is no `stats.csv` fallback: when the
 * database is unavailable the command fails with
 * `MeasurementStoreUnavailableError`.
 *
 * `options.store` lets callers (and fast isolated tests) inject a store bound
 * to a temporary database.
 */
function getMeasurementStore(options: StatsOptions = {}) {
  if (options.store) {return options.store;}
  return resolveMeasurementStore(options.dbPath ? { dbPath: options.dbPath } : {});
}

/**
 * Read every stored measurement back as the string-shaped `StatsRow` the
 * report renderers consume. The mapping restores the historical CSV-era
 * defaults ('' for text, '0' for numeric) so filtering, totals, grouping,
 * formatting, and missing-data behavior are unchanged by the cut-over.
 */
// @ts-ignore -- retained reporting helper is dynamically typed
function measurementToStatsRow(record): StatsRow {
// @ts-ignore -- retained reporting helper is dynamically typed
  const numeric = (value) => (value === null || value === undefined ? '0' : String(value));
  // `pr_fix_rounds` is the one measurement that is genuinely nullable: an
  // unknown number of review-fix rounds is not a measured zero, and collapsing
  // it here would inflate every observation count downstream (TASK-2369).
  const nullableNumeric = (value) => (value === null || value === undefined ? undefined : String(value));
  return {
    date: record.date || '',
    repo: record.repo || '',
    mission: record.mission || '',
    classification: record.classification || '',
    implementer: record.implementer || '',
    pr_fix_rounds: nullableNumeric(record.pr_fix_rounds),
    provider: record.provider || '',
    model: record.model || '',
    implementer_agent: record.implementer_agent || '',
    reviewer_agent: record.reviewer_agent || '',
    stage: record.stage || 'default',
    input_tokens: numeric(record.input_tokens),
    output_tokens: numeric(record.output_tokens),
    cached_tokens: numeric(record.cached_tokens),
    thoughts_tokens: numeric(record.thoughts_tokens),
    context_tokens: numeric(record.context_tokens),
    tool_calls: numeric(record.tool_calls),
    openai_usage_before: numeric(record.openai_usage_before),
    openai_usage_after: numeric(record.openai_usage_after),
    openai_usage_delta: numeric(record.openai_usage_delta),
    duration_minutes: numeric(record.duration_minutes),
    cost_usd: numeric(record.cost_usd),
  };
}

/**
 * Map a canonicalized `StatsRow` onto the checked measurement record.
 * `actorKey` is computed here — by the module that owns the attribution rule —
 * so no adapter has to infer an identity (architecture migration: `Attempt` excluded).
 */
function statsRowToMeasurement(row: StatsRow) {
// @ts-ignore -- retained reporting helper is dynamically typed
  const int = (value) => {
    const parsed = Number.parseInt(String(value), 10);
    return Number.isFinite(parsed) ? parsed : 0;
  };
// @ts-ignore -- retained reporting helper is dynamically typed
  const dec = (value) => {
    const parsed = Number.parseFloat(String(value));
    return Number.isFinite(parsed) ? parsed : 0;
  };
  return {
    repo: String(row.repo || ''),
    mission: String(row.mission || ''),
    stage: String(row.stage || 'default'),
    actorKey: statsRowActorKey(row),
    date: row.date || '',
    classification: row.classification || '',
    implementer: row.implementer || '',
    pr_fix_rounds: row.pr_fix_rounds === undefined ? null : int(row.pr_fix_rounds),
    provider: row.provider || '',
    model: row.model || '',
    implementer_agent: row.implementer_agent || '',
    reviewer_agent: row.reviewer_agent || '',
    input_tokens: int(row.input_tokens),
    output_tokens: int(row.output_tokens),
    cached_tokens: int(row.cached_tokens),
    thoughts_tokens: int(row.thoughts_tokens),
    context_tokens: int(row.context_tokens),
    tool_calls: int(row.tool_calls),
    openai_usage_before: int(row.openai_usage_before),
    openai_usage_after: int(row.openai_usage_after),
    openai_usage_delta: int(row.openai_usage_delta),
    duration_minutes: int(row.duration_minutes),
    cost_usd: dec(row.cost_usd),
  };
}

/**
 * The default statistics read. Returns `{ headers, rows }` in the same shape
 * the former CSV loader returned, so every renderer is untouched.
 */
function loadMeasurementRows(options: StatsOptions = {}) {
  const store = getMeasurementStore(options);
  return {
    headers: [...STATS_HEADERS],
// @ts-ignore -- retained reporting helper is dynamically typed
    rows: store.listMeasurements().map(measurementToStatsRow),
  };
}

/** One lifecycle-completed mission, as the mission-flow report reads it. */
export interface MissionFlowCompletion {
  readonly repo: string;
  readonly mission: string;
  readonly closedAt: string;
  readonly labels: readonly string[];
}

/**
 * The lifecycle-completed mission population behind the mission-flow report.
 *
 * This is deliberately the same `MissionOutcome[]` that `BoardMetrics` and
 * `px stats cohorts` report, read through `ConcreteMetricsReadAdapter`, so the
 * board and the CLI cannot disagree about which missions completed. Telemetry
 * rows answer a different question and are counted separately.
 *
 * Returns `null` — not an empty population — when lane history cannot be read
 * at all (the rollback bundle has no SQLite driver). The report then states
 * that mission flow is unavailable, because "not read" and "nothing completed"
 * are different facts.
 */
async function readMissionFlowPopulation(options: {
  rootDir: string;
  laneEventRepo?: unknown;
  usageRepo?: unknown;
  repositoryId?: string;
}): Promise<MissionFlowCompletion[] | null> {
  try {
    const repositories = options.laneEventRepo && options.usageRepo
      ? { laneEventRepo: options.laneEventRepo as any, usageRepo: options.usageRepo as any }
      : await resolveOperatorRepositories();
    const repositoryId = (options.repositoryId ?? resolveCanonicalRepositoryId(options.rootDir)) as any;
    const outcomes = await new ConcreteMetricsReadAdapter({
      laneEventRepo: repositories.laneEventRepo,
      usageRepo: repositories.usageRepo,
      repositoryId,
    }).readOutcomes();
    return outcomes.map((outcome) => ({ repo: String(repositoryId), mission: String(outcome.missionId), closedAt: outcome.closedAt, labels: outcome.labels }));
  } catch {
    return null;
  }
}

/** Infrastructure implementation supplied to the application workflow. */
export function createStatsWorkflowAdapter(): StatsWorkflowPort<StatsRow> {
  return {
    loadMeasurements: (options) => loadMeasurementRows(options as StatsOptions).rows,
    resolveClassification: (slug, options) => resolveMissionClassification(slug, String(options.rootDir || process.cwd())),
    deriveImplementerAndFixRounds: (slug, options) => deriveImplementerAndFixRounds(slug, String(options.rootDir || process.cwd())),
    resolveRepositoryName: (options) => resolveStatsRepoName(String(options.rootDir || process.cwd())),
    lookupForgejo: (slug, options) => forgejo.getPrStatus(slug, String(options.rootDir || process.cwd())),
  };
}

/**
 * Map any row (legacy 5-column or full 21-column) to the full schema, defaulting
 * missing text columns to '' and numeric columns to '0'. `stage` defaults to
 * 'default' so legacy rows and integration rows share the (repo, mission, stage)
 * upsert key.
 */
function normalizeStatsRow(row: StatsRow = {} as StatsRow, options: NormalizeStatsRowOptions = {} as NormalizeStatsRowOptions) {
  const repo = String(row.repo || options.repo || resolveStatsRepoName(options.rootDir)).trim();
  return {
    date: row.date || '',
    repo,
    mission: row.mission || '',
    classification: row.classification || '',
    implementer: row.implementer || '',
    pr_fix_rounds: row.pr_fix_rounds === null || row.pr_fix_rounds === undefined
      ? undefined
      : String(row.pr_fix_rounds),
    provider: row.provider || '',
    model: row.model || '',
    implementer_agent: row.implementer_agent || '',
    reviewer_agent: row.reviewer_agent || '',
    stage: row.stage || 'default',
    input_tokens: row.input_tokens || '0',
    output_tokens: row.output_tokens || '0',
    cached_tokens: row.cached_tokens || '0',
    thoughts_tokens: row.thoughts_tokens || '0',
    context_tokens: row.context_tokens || '0',
    tool_calls: row.tool_calls || '0',
    openai_usage_before: row.openai_usage_before || '0',
    openai_usage_after: row.openai_usage_after || '0',
    openai_usage_delta: row.openai_usage_delta || '0',
    duration_minutes: row.duration_minutes || '0',
    cost_usd: row.cost_usd || '0',
  };
}

// `saveStatsCsv` was removed by architecture migration: no production path writes CSV.
// The measurement database is the sole authority (ADR 0053).

/**
 * @param {string} dateStr
 */
// @ts-ignore -- retained reporting helper is dynamically typed
function formatDate(dateStr) {
  if (!dateStr) {return '';}
  try {
    const date = new Date(dateStr);
    return date.toISOString().split('T')[0];
  } catch (/** @type{any} */ _err) {
    return dateStr;
  }
}

/**
 * @param {*} value
 */
// @ts-ignore -- retained reporting helper is dynamically typed
function parseBooleanish(value) {
  if (typeof value === 'boolean') {return value;}
  if (value === null || value === undefined) {return null;}

  const normalized = String(value).trim().toLowerCase();
  if (!normalized || normalized === '—' || normalized === 'n/a') {return null;}
  if (['yes', 'true', '1', 'y', 'merged', 'closed'].includes(normalized)) {return true;}
  if (['no', 'false', '0', 'n', 'open'].includes(normalized)) {return false;}
  return null;
}

/**
 * @param {StatsRow} row
 */
// @ts-ignore -- retained reporting helper is dynamically typed
function normalizeRow(row) {
  const reviewCount = Number.parseInt(String(row.review_count || ''), 10) || 0;
  const mergedValue = Object.prototype.hasOwnProperty.call(row, 'merged')
    ? String(row.merged)
    : row.has_pr;
  let isMerged = parseBooleanish(mergedValue);

  if (isMerged === null && Object.prototype.hasOwnProperty.call(row, 'has_pr')) {
    const hasPr = parseBooleanish(row.has_pr);
    isMerged = hasPr !== null ? hasPr : reviewCount > 0;
  }

  return {
    ...row,
    review_count: String(reviewCount),
    normalizedDate: row.date || row.created_at || '',
    normalizedMerged: isMerged === true ? 'yes' : 'no',
    isMerged: isMerged === true,
  };
}

/**
 * @param {StatsRow[]} rows
 */
// @ts-ignore -- retained reporting helper is dynamically typed
function normalizeRows(rows) {
  return rows.map(normalizeRow);
}

/**
 * @param {StatsRow} row
 */
// @ts-ignore -- retained reporting helper is dynamically typed
function statsMissionKey(row) {
  return statisticsMissionKey(row);
}

/**
 * Checks whether a model name belongs to the given implementer family.
 * The stored `model === implementer` exact match is too strict for
 * family-named implementers (e.g. `claude-sonnet-5` !== `claude`,
 * `gpt-5.4` !== `codex`). This prefix-based check correctly identifies
 * implementer-family models so the dedup logic can prefer them over
 * reviewer-model rows or blank-model rollups.
 *
 * @param {string} model
 * @param {string} impl
 * @returns {boolean}
 */
// @ts-ignore -- retained reporting helper is dynamically typed
function modelBelongsToImplFamily(model, impl) {
  if (!model || !impl) { return false; }
  const m = String(model).toLowerCase();
  const i = String(impl).toLowerCase();
  if (m === i) { return true; }
  // Named families whose models don't prefix with the family label:
  // codex → gpt-*, vibe → mistral
  if (i === 'codex') { return m.startsWith('gpt'); }
  if (i === 'vibe') { return m === 'mistral'; }
  // custom family models are named paths/identifiers (cyankiwi/Qwen..., 
  // QuantTrio/Qwen..., qwen3.6-27b-q8) that don't prefix with "custom".
  // Recognize them as non-blank model names that aren't known reviewer families.
  if (i === 'custom') {
    return !m.startsWith('claude') && !m.startsWith('gpt');
  }
  // All other families: model starts with the family name
  // (claude-sonnet-5 → claude, mistral → mistral, qwen3.6-27b-q8 → qwen, etc.)
  return m.startsWith(i);
}

/**
 * @param {StatsRow[]} rows
 * @param {string} field
 */
// @ts-ignore -- retained reporting helper is dynamically typed
function groupBy(rows, field) {
  /** @type {Record<string, StatsRow[]>} */
  const groups = {};
  for (const row of rows) {
    const key = String(row[field] || 'unknown');
// @ts-ignore -- retained reporting helper is dynamically typed
    if (!groups[key]) {groups[key] = [];}
// @ts-ignore -- retained reporting helper is dynamically typed
    groups[key].push(row);
  }
  return groups;
}

/**
 * @param {StatsRow[]} group
 */
// @ts-ignore -- retained reporting helper is dynamically typed
function computeImplStats(group) {
  const total = group.length;
// @ts-ignore -- retained reporting helper is dynamically typed
  const merged = group.filter(row => row.isMerged).length;
// @ts-ignore -- retained reporting helper is dynamically typed
  const totalReviews = group.reduce((sum, row) => sum + (Number.parseInt(String(row.review_count || ''), 10) || 0), 0);
  const avgReviews = total > 0 ? (totalReviews / total).toFixed(2) : '0.00';
// @ts-ignore -- retained reporting helper is dynamically typed
  const reviewRounds = group.reduce((sum, row) => sum + Math.max(1, Number.parseInt(String(row.review_count || ''), 10) || 0), 0);
  const avgRounds = total > 0 ? (reviewRounds / total).toFixed(2) : '0.00';
  return { total, merged, totalReviews, avgReviews, reviewRounds, avgRounds };
}

/**
 * @param {StatsRow[]} group
 */
// @ts-ignore -- retained reporting helper is dynamically typed
function computePeriodStats(group) {
// @ts-ignore -- retained reporting helper is dynamically typed
  const dates = group.map(row => formatDate(String(row.normalizedDate))).filter(Boolean);
  if (dates.length === 0) {return null;}
  const sorted = dates.sort();
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const start = new Date(first);
  const end = new Date(last);
  const days = Math.max(1, Math.ceil((Number(end) - Number(start)) / (1000 * 60 * 60 * 24)) + 1);
  const total = group.length;
// @ts-ignore -- retained reporting helper is dynamically typed
  const merged = group.filter(row => row.isMerged).length;
  const open = total - merged;
// @ts-ignore -- retained reporting helper is dynamically typed
  const totalReviews = group.reduce((sum, row) => sum + (Number.parseInt(String(row.review_count || ''), 10) || 0), 0);
  const avgReviews = total > 0 ? (totalReviews / total).toFixed(2) : '0.00';
  return { period: `${first} → ${last}`, days, total, merged, open, totalReviews, avgReviews };
}

/**
 * @param {{headers: string[], rows: StatsRow[]}} data
 * @param {StatsOptions} options
 */
// @ts-ignore -- retained reporting helper is dynamically typed
function generateMarkdownReport(data, options = {}) {
  const rows = normalizeRows(data.rows);
// @ts-ignore -- retained reporting helper is dynamically typed
  const groupByField = options.groupBy;

  if (rows.length === 0) {
    return 'No data to report.';
  }

  const lines = [];
  lines.push('# Forgejo Stats Report\n');
  lines.push(`Generated: ${new Date().toISOString().split('T')[0]}\n`);
  lines.push(`Total PRs analyzed: ${rows.length}\n`);

// @ts-ignore -- retained reporting helper is dynamically typed
  const overallMerged = rows.filter(row => row.isMerged).length;
  const overallOpen = rows.length - overallMerged;
// @ts-ignore -- retained reporting helper is dynamically typed
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
    lines.push(`| ${/** @type {any} */ (row).mission} | ${/** @type {any} */ (row).implementer} | ${/** @type {any} */ (row).reviewer} | ${row.review_count} | ${row.normalizedMerged} | ${formatDate(String(row.normalizedDate))} |`);
  }
  lines.push('');

  if (groupByField === 'implementer') {
    const groups = groupBy(rows, 'implementer');
    lines.push('## By Implementer\n');
    lines.push('| Agent | PRs | Merged | Open | Total Reviews | Avg Reviews/PR | Avg Review Rounds |');
    lines.push('|-------|-----|--------|------|---------------|----------------|-------------------|');
    const implData = Object.entries(groups)
      .map(([implementer, group]) => {
        const stats = computeImplStats(group);
        return {
          implementer,
          prs: stats.total,
          merged: stats.merged,
// @ts-ignore -- retained reporting helper is dynamically typed
          open: group.filter(row => !row.isMerged).length,
          totalReviews: stats.totalReviews,
          avgReviews: stats.avgReviews,
          avgRounds: stats.avgRounds,
        };
      })
      .sort((a, b) => b.prs - a.prs);
    for (const row of implData) {
      lines.push(`| ${row.implementer} | ${row.prs} | ${row.merged} | ${row.open} | ${row.totalReviews} | ${row.avgReviews} | ${row.avgRounds} |`);
    }
    lines.push('');
  } else if (groupByField === 'period') {
    const groups = {};
    for (const row of rows) {
      const date = formatDate(String(row.normalizedDate));
      if (!date) {continue;}
      const month = date.substring(0, 7);
// @ts-ignore -- retained reporting helper is dynamically typed
      if (!/** @type {any} */ (groups)[month]) {/** @type {any} */ (groups)[month] = [];}
// @ts-ignore -- retained reporting helper is dynamically typed
      /** @type {any} */ (groups)[month].push(row);
    }
    lines.push('## By Period (Month)\n');
    lines.push('| Period | Days | PRs | Merged | Open | Total Reviews | Avg Reviews/PR |');
    lines.push('|--------|------|-----|--------|------|---------------|----------------|');
    for (const month of Object.keys(groups).sort()) {
// @ts-ignore -- retained reporting helper is dynamically typed
      const period = computePeriodStats(/** @type{StatsRow[]} */(/** @type {any} */ (groups)[month]));
      if (period) {
        lines.push(`| ${period.period} | ${period.days} | ${period.total} | ${period.merged} | ${period.open} | ${period.totalReviews} | ${period.avgReviews} |`);
      }
    }
    lines.push('');
  } else if (groupByField === 'merged') {
// @ts-ignore -- retained reporting helper is dynamically typed
    const mergedRows = rows.filter(row => row.isMerged);
// @ts-ignore -- retained reporting helper is dynamically typed
    const unmergedRows = rows.filter(row => !row.isMerged);
    lines.push('## Merged vs Unmerged\n');
    lines.push('### Merged PRs\n');
    if (mergedRows.length > 0) {
      lines.push('| Mission | Implementer | Reviews | Reviewer | Created |');
      lines.push('|---------|-------------|---------|----------|---------|');
// @ts-ignore -- retained reporting helper is dynamically typed
      for (const row of mergedRows.sort((a, b) => String(a.normalizedDate || '').localeCompare(String(b.normalizedDate || '')))) {
        lines.push(`| ${/** @type {any} */ (row).mission} | ${/** @type {any} */ (row).implementer} | ${row.review_count} | ${/** @type {any} */ (row).reviewer} | ${formatDate(String(row.normalizedDate))} |`);
      }
    } else {
      lines.push('None.');
    }
    lines.push('');
    lines.push('### Unmerged/Closed PRs\n');
    if (unmergedRows.length > 0) {
      lines.push('|---------|-------------|---------|----------|---------|');
// @ts-ignore -- retained reporting helper is dynamically typed
      for (const row of unmergedRows.sort((a, b) => String(a.normalizedDate || '').localeCompare(String(b.normalizedDate || '')))) {
        lines.push(`| ${/** @type {any} */ (row).mission} | ${/** @type {any} */ (row).implementer} | ${row.review_count} | ${/** @type {any} */ (row).reviewer} | ${formatDate(String(row.normalizedDate))} |`);
      }
    } else {
      lines.push('None.');
    }
    lines.push('');
  }

  lines.push('## Raw Data\n');
  lines.push('```csv');
  lines.push(data.headers.join(','));
  for (const row of rows) {
// @ts-ignore -- retained reporting helper is dynamically typed
    lines.push(data.headers.map(header => /** @type{any} */(row)[header] || '').join(','));
  }
  lines.push('```\n');

  return lines.join('\n');
}

/**
 * @param {*} value
 */
// @ts-ignore -- retained reporting helper is dynamically typed
function isValidClassification(value) {
  return VALID_CLASSIFICATIONS.has(String(value || '').trim().toLowerCase());
}

/**
 * @param {*} value
 */
// @ts-ignore -- retained reporting helper is dynamically typed
function normalizeClassification(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return isValidClassification(normalized) ? normalized : null;
}

/**
 * @param {*} value
 */
// @ts-ignore -- retained reporting helper is dynamically typed
function normalizeImplementer(value) {
  return String(value || '').trim().replace(/^@/, '').toLowerCase() || null;
}

/**
 * @param {StatsRow} row
 */
function statsRowActorKey(row = {}) {
// @ts-ignore -- retained reporting helper is dynamically typed
  const stage = String(row.stage || 'default').trim().toLowerCase() || 'default';
  if (stage === 'review') {
// @ts-ignore -- retained reporting helper is dynamically typed
    return normalizeImplementer(row.reviewer_agent || row.implementer_agent || row.implementer || '') || '';
  }
// @ts-ignore -- retained reporting helper is dynamically typed
  return normalizeImplementer(row.implementer_agent || row.implementer || '') || '';
}

/**
 * @param {string} value
 */
// @ts-ignore -- retained reporting helper is dynamically typed
function parseDateOnly(value) {
  return new Date(`${value}T00:00:00Z`);
}

/**
 * @param {string} value
 * @param {string} flagName
 */
// @ts-ignore -- retained reporting helper is dynamically typed
function parseDateOnlyStrict(value, flagName) {
  const raw = String(value || '').trim();
  const label = flagName || 'date';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new Error(`Invalid date range argument ${label}: expected YYYY-MM-DD.`);
  }

  const date = parseDateOnly(raw);
  if (Number.isNaN(date.getTime()) || formatDateOnly(date) !== raw) {
    throw new Error(`Invalid date range argument ${label}: ${raw} is not a valid calendar date.`);
  }

  return date;
}

/**
 * @param {Date} date
 */
// @ts-ignore -- retained reporting helper is dynamically typed
function formatDateOnly(date) {
  return date.toISOString().slice(0, 10);
}

/**
 * @param {Date|string} today
 */
function parseToday(today = new Date()) {
  if (today instanceof Date) {
    return parseDateOnly(formatDateOnly(today));
  }
  return parseDateOnly(String(today));
}

/**
 * @param {Date|string} endDate
 * @param {number} days
 */
// @ts-ignore -- retained reporting helper is dynamically typed
function createWindow(endDate, days) {
  return decisionWindowEndingOn(parseToday(endDate), days);
}

/**
 * @param {{from?: string, to?: string}} range
 */
function createRangeWindow(range = {}) {
// @ts-ignore -- retained reporting helper is dynamically typed
  const { from, to } = range;
  if (!from) {
    throw new Error('Invalid date range argument --from: value is required when using range mode.');
  }
  if (!to) {
    throw new Error('Invalid date range argument --to: value is required when using range mode.');
  }

  const start = parseDateOnlyStrict(from, '--from');
  const end = parseDateOnlyStrict(to, '--to');
  if (start > end) {
    throw new Error(`Invalid date range argument --from/--to: start date ${formatDateOnly(start)} is after end date ${formatDateOnly(end)}.`);
  }

  return {
    start,
    end,
    label: `${formatDateOnly(start)} → ${formatDateOnly(end)}`,
  };
}

/**
 * @param {Date} today
 */
function buildWeeklyWindows(today = new Date()) {
  // The application layer owns the rolling-window definition; the board reads
  // the same one, so the CLI's decision cadence and FLOW's cannot drift apart.
  return weeklyDecisionWindows(parseToday(today));
}

/**
 * @param {StatsRow} row
 * @param {{start: Date, end: Date}} window
 */
// @ts-ignore -- retained reporting helper is dynamically typed
function rowInWindow(row, window) {
  return statisticsRowInWindow(row, window);
}

/**
 * @param {StatsRow[]} rows
 * @param {{start: Date, end: Date}} window
 */
// @ts-ignore -- retained reporting helper is dynamically typed
function summarizeMissionWindow(rows, window, completedMissionKeys = new Set()) {
// @ts-ignore -- retained reporting helper is dynamically typed
  const { rows: closedRows, missions: uniqueMissions } = summarizeCompletedMissionWindow(rows, window, completedMissionKeys);
  const userValue = uniqueMissions.filter(row => normalizeClassification(row.classification) === 'user_value').length;
  const aiSdlc = uniqueMissions.filter(row => normalizeClassification(row.classification) === 'ai_sdlc').length;
  const unknown = uniqueMissions.filter(row => normalizeClassification(row.classification) === 'unknown').length;
  const validMissions = uniqueMissions.filter(row => normalizeClassification(row.classification) !== null);
  return {
    rows: closedRows,
    total: validMissions.length,
    userValue,
    aiSdlc,
    unknown,
  };
}

/**
 * @param {StatsRow[]} rows
 * @param {{start: Date, end: Date}} window
 * @param {{rootDir?: string|null, deriveFixRoundsFn?: Function}} [options]
 */
/**
 * Shared mission-dedup + agent-grouping pass behind `Agent performance this
 * week`. Deduplicates globally by (repo, mission) so each mission is counted
 * exactly once across all agent groups, then groups the winning per-mission
 * rows by display key (model name, falling back to implementer family).
 * Also returns a mission-key -> displayKey map so other report sections
 * (e.g. the stage-spend table) can fan back out over the *raw*, non-deduped
 * window rows using the same row identity/grouping without re-deriving it.
 *
 * @param {StatsRow[]} rows
 * @param {{start: Date, end: Date}} window
 * @param {{completedOnly?: boolean}} [options]
 */
// @ts-ignore -- retained reporting helper is dynamically typed
function computeAgentMissionGroups(rows, window, options = {}) {
// @ts-ignore -- retained reporting helper is dynamically typed
  const windowRows = rows.filter(row => rowInWindow(row, window));
// @ts-ignore -- retained reporting helper is dynamically typed
  const validWindowRows = windowRows.filter(row => normalizeClassification(row.classification) !== null);
  // Completion is supplied by lifecycle readers, never inferred from telemetry.
  let allValidWindowRows = validWindowRows;
// @ts-ignore -- retained reporting helper is dynamically typed
  if (options.completedOnly) {
// @ts-ignore -- retained reporting helper is dynamically typed
    const completedMissionKeys = options.completedMissionKeys || new Set();
// @ts-ignore -- retained reporting helper is dynamically typed
    allValidWindowRows = validWindowRows.filter(row => completedMissionKeys.has(statsMissionKey(row)));
  }
  // The non-completed path supports the live spend table, where no final owner
  // exists yet. It picks a concrete model deterministically.
  /** @type {Record<string, StatsRow>} */
  const byMission = {};
  /** @type {Record<string, StatsRow[]>} */
  const rowsByMission = {};
  for (const row of allValidWindowRows) {
    const key = statsMissionKey(row);
// @ts-ignore -- retained reporting helper is dynamically typed
    if (!rowsByMission[key]) {rowsByMission[key] = [];}
// @ts-ignore -- retained reporting helper is dynamically typed
    rowsByMission[key].push(row);
// @ts-ignore -- retained reporting helper is dynamically typed
    const prev = byMission[key];
    const modelTrimmed = (row.model && String(row.model).trim()) || '';
    const implTrimmed = (row.implementer && String(row.implementer).trim()) || '';
    const rowHasModel = Boolean(modelTrimmed);
    const isFamilyMatch = rowHasModel && implTrimmed && modelBelongsToImplFamily(modelTrimmed, implTrimmed);
    let shouldReplace;
    if (!prev) {
      shouldReplace = true;
    } else {
      const prevModelTrimmed = (prev.model && String(prev.model).trim()) || '';
      const prevImplTrimmed = (prev.implementer && String(prev.implementer).trim()) || '';
      const prevHasModel = Boolean(prevModelTrimmed);
      const prevFamilyMatch = prevHasModel && prevImplTrimmed && modelBelongsToImplFamily(prevModelTrimmed, prevImplTrimmed);
      if (rowHasModel && !prevHasModel) {
        shouldReplace = true;
      } else if (!rowHasModel && prevHasModel) {
        shouldReplace = false;
      } else if (rowHasModel && prevHasModel) {
        // Both have models — implementer-family match first, then date, then CSV order.
        if (isFamilyMatch && !prevFamilyMatch) {
          shouldReplace = true;
        } else if (!isFamilyMatch && prevFamilyMatch) {
          shouldReplace = false;
        } else if (row.date > prev.date) {
          shouldReplace = true;
        } else if (row.date < prev.date) {
          shouldReplace = false;
        } else {
          // Same date, same tier — last in CSV wins
          shouldReplace = true;
        }
      } else {
        // Both blank — last in CSV wins
        shouldReplace = true;
      }
    }
    if (shouldReplace) {
// @ts-ignore -- retained reporting helper is dynamically typed
      byMission[key] = row;
    }
  }

// @ts-ignore -- retained reporting helper is dynamically typed
  if (options.completedOnly) {
    for (const [key, missionRows] of Object.entries(rowsByMission)) {
// @ts-ignore -- retained reporting helper is dynamically typed
      const rollup = [...missionRows].reverse().find(row => row.stage === 'default');
// @ts-ignore -- retained reporting helper is dynamically typed
      const owner = rollup?.implementer ?? [...missionRows].reverse().find(row =>
        String(row.stage || 'default').trim().toLowerCase() !== 'review',
      )?.implementer;
// @ts-ignore -- retained reporting helper is dynamically typed
      const ownerModel = [...missionRows].reverse().find(row =>
        row.implementer === owner
          && String(row.stage || 'default').trim().toLowerCase() !== 'review'
          && String(row.model || '').trim(),
      );
// @ts-ignore -- retained reporting helper is dynamically typed
      if (owner && byMission[key]) {
// @ts-ignore -- retained reporting helper is dynamically typed
        byMission[key] = {
// @ts-ignore -- retained reporting helper is dynamically typed
          ...(ownerModel || rollup || byMission[key]),
          reportedImplementer: owner,
// @ts-ignore -- retained reporting helper is dynamically typed
          pr_fix_rounds: rollup?.pr_fix_rounds ?? byMission[key].pr_fix_rounds,
        };
      }
    }
  }

 const uniqueMissions = Object.values(byMission);

  /** @type {Record<string, StatsRow[]>} */
  const groups = {};
  /** @type {Record<string, string>} */
  const missionKeyToDisplayKey = {};
  for (const row of uniqueMissions) {
// @ts-ignore -- retained reporting helper is dynamically typed
    const modelTrimmed = (row.model && String(row.model).trim()) || '';
    let displayKey;
// @ts-ignore -- retained reporting helper is dynamically typed
    if (row.reportedImplementer) {
// @ts-ignore -- retained reporting helper is dynamically typed
      if (modelTrimmed && modelBelongsToImplFamily(modelTrimmed, row.reportedImplementer)) {
        displayKey = modelTrimmed;
      } else {
// @ts-ignore -- retained reporting helper is dynamically typed
        displayKey = row.reportedImplementer;
      }
    } else {
// @ts-ignore -- retained reporting helper is dynamically typed
      displayKey = modelTrimmed || (row.implementer || 'unknown');
    }
// @ts-ignore -- retained reporting helper is dynamically typed
    missionKeyToDisplayKey[statsMissionKey(row)] = displayKey;
// @ts-ignore -- retained reporting helper is dynamically typed
    if (!groups[displayKey]) {groups[displayKey] = [];}
// @ts-ignore -- retained reporting helper is dynamically typed
    groups[displayKey].push(row);
  }
  return { allValidWindowRows, groups, missionKeyToDisplayKey };
}

/**
 * @param {StatsRow[]} rows
 * @param {{start: Date, end: Date}} window
 * @param {{rootDir?: string|null, deriveFixRoundsFn?: Function}} [options]
 */
// @ts-ignore -- retained reporting helper is dynamically typed
function summarizeAgentWindow(rows, window, options = {}) {
  /** @type {{rootDir?: string|null, deriveFixRoundsFn?: Function}} */
  const opts = options;
// @ts-ignore -- retained reporting helper is dynamically typed
  const { rootDir = null, deriveFixRoundsFn = null } = opts;
  // Mission counts and repair-round averages describe completed missions only.
  // Other report sections reuse the grouping helper without this filter so
  // their live stage telemetry remains unchanged.
  const { allValidWindowRows, groups } = computeAgentMissionGroups(rows, window, {
// @ts-ignore -- retained reporting helper is dynamically typed
    completedOnly: true, completedMissionKeys: options.completedMissionKeys,
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
  /** @type {Record<string, number>} */
  const storedRoundsByMission = {};
  const roundsFromRollupByMission = new Set();
  for (const row of allValidWindowRows) {
    const key = statsMissionKey(row);
    if (row.pr_fix_rounds !== undefined) {
      // The default rollup is authoritative; without one, the final row is.
      if (row.stage === 'default' || !roundsFromRollupByMission.has(key)) {
// @ts-ignore -- retained reporting helper is dynamically typed
        storedRoundsByMission[key] = Number.parseInt(String(row.pr_fix_rounds), 10) || 0;
        if (row.stage === 'default') { roundsFromRollupByMission.add(key); }
      }
    }
  }
// @ts-ignore -- retained reporting helper is dynamically typed
  const roundsFor = (/** @type {any} */ row) => {
    if (rootDir && deriveFixRoundsFn) {
      const authoritative = deriveFixRoundsFn(row.mission, rootDir, row.repo);
      if (authoritative !== null && authoritative !== undefined) {
        return Number.parseInt(authoritative, 10) || 0;
      }
    }
// @ts-ignore -- retained reporting helper is dynamically typed
    return storedRoundsByMission[statsMissionKey(row)] || 0;
  };
  return Object.entries(groups)
    .map(([displayKey, group]) => {
// @ts-ignore -- retained reporting helper is dynamically typed
      const totalRounds = group.reduce((sum, row) => sum + roundsFor(row), 0);
      return {
        implementer: displayKey,
// @ts-ignore -- retained reporting helper is dynamically typed
        missions: group.length,
// @ts-ignore -- retained reporting helper is dynamically typed
        averageFixRounds: group.length > 0 ? (totalRounds / group.length).toFixed(2) : '0.00',
      };
    })
    .sort((a, b) => a.implementer.localeCompare(b.implementer));
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
 * @param {string} displayKey
 * @param {StatsRow[]} groupRows
 */
// @ts-ignore -- retained reporting helper is dynamically typed
function classifyAgentSpendFamily(displayKey, groupRows) {
// @ts-ignore -- retained reporting helper is dynamically typed
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
 * @param {StatsRow[]} rows
 * @param {{start: Date, end: Date}} window
 */
// @ts-ignore -- retained reporting helper is dynamically typed
function summarizeAgentStageSpend(rows, window) {
  const { allValidWindowRows, groups, missionKeyToDisplayKey } = computeAgentMissionGroups(rows, window);

  /** @type {Record<string, StatsRow[]>} */
  const rawRowsByDisplayKey = {};
  for (const row of allValidWindowRows) {
// @ts-ignore -- retained reporting helper is dynamically typed
    const displayKey = missionKeyToDisplayKey[statsMissionKey(row)];
    if (!displayKey) {continue;}
// @ts-ignore -- retained reporting helper is dynamically typed
    if (!rawRowsByDisplayKey[displayKey]) {rawRowsByDisplayKey[displayKey] = [];}
// @ts-ignore -- retained reporting helper is dynamically typed
    rawRowsByDisplayKey[displayKey].push(row);
  }

  const knownStages = new Set(AGENT_SPEND_STAGE_COLUMNS.map(entry => entry.stage));

  return Object.keys(groups)
    .sort((a, b) => a.localeCompare(b))
    .map(displayKey => {
// @ts-ignore -- retained reporting helper is dynamically typed
      const family = classifyAgentSpendFamily(displayKey, groups[displayKey]);
      /** @type {Record<string, number>} */
      const byStage = {};
// @ts-ignore -- retained reporting helper is dynamically typed
      for (const { stage } of AGENT_SPEND_STAGE_COLUMNS) {byStage[stage] = 0;}
// @ts-ignore -- retained reporting helper is dynamically typed
      for (const row of (rawRowsByDisplayKey[displayKey] || [])) {
        const rawStage = String(row.stage || 'default').trim().toLowerCase() || 'default';
        const bucket = knownStages.has(rawStage) ? rawStage : 'default';
        const value = family === 'usage' ? (Number.parseInt(String(row.openai_usage_after), 10) || 0)
          : family === 'cost' ? (Number.parseFloat(String(row.cost_usd)) || 0)
          : (Number.parseInt(String(row.duration_minutes), 10) || 0);
// @ts-ignore -- retained reporting helper is dynamically typed
        byStage[bucket] += value;
      }
// @ts-ignore -- retained reporting helper is dynamically typed
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
 * @param {number} value
 * @param {number} total
 * @param {'usage'|'cost'|'duration'} family
 */
// @ts-ignore -- retained reporting helper is dynamically typed
function formatAgentSpendCell(value, total, family) {
  if (!total) {return '—';}
  const pct = Math.round((value / total) * 100);
  if (family === 'usage') {return `${value}% (${pct}%)`;}
  if (family === 'cost') {
    const rounded = Math.round(value * 100) / 100;
    return `$${rounded} (${pct}%)`;
  }
  return `${value}m (${pct}%)`;
}

/**
 * @param {MissionStats[]} rows
 */
// @ts-ignore -- retained reporting helper is dynamically typed
function colorAverageFixRounds(rows) {
  const values = rows
// @ts-ignore -- retained reporting helper is dynamically typed
    .map(row => Number.parseFloat(row.averageFixRounds))
// @ts-ignore -- retained reporting helper is dynamically typed
    .filter(value => Number.isFinite(value));

  if (values.length === 0) {
// @ts-ignore -- retained reporting helper is dynamically typed
    return rows.map(row => row.averageFixRounds);
  }

  const best = Math.min(...values);
  const worst = Math.max(...values);

// @ts-ignore -- retained reporting helper is dynamically typed
  return rows.map(row => {
    const value = Number.parseFloat(row.averageFixRounds);
    if (!Number.isFinite(value)) {return row.averageFixRounds;}
    if (best === worst) {
      return fmt.colorize(/** @type {import('node:util').InspectColor} */(fmt.colors.green), row.averageFixRounds);
    }
    if (value === best) {
      return fmt.colorize(/** @type {import('node:util').InspectColor} */(fmt.colors.green), row.averageFixRounds);
    }
    if (value === worst) {
      return fmt.colorize(/** @type {import('node:util').InspectColor} */(fmt.colors.red), row.averageFixRounds);
    }
    return fmt.colorize(/** @type {import('node:util').InspectColor} */(fmt.colors.yellow), row.averageFixRounds);
  });
}

/**
 * @param {MissionStats[]} rows
 */
// @ts-ignore -- retained reporting helper is dynamically typed
function colorMissionCounts(rows) {
  const values = rows
// @ts-ignore -- retained reporting helper is dynamically typed
    .map(row => Number.parseInt(String(row.missions), 10))
// @ts-ignore -- retained reporting helper is dynamically typed
    .filter(value => Number.isFinite(value));

  if (values.length === 0) {
// @ts-ignore -- retained reporting helper is dynamically typed
    return rows.map(row => String(row.missions));
  }

  const best = Math.max(...values);
  const worst = Math.min(...values);

// @ts-ignore -- retained reporting helper is dynamically typed
  return rows.map(row => {
    const value = Number.parseInt(String(row.missions), 10);
    if (!Number.isFinite(value)) {return String(row.missions);}
    if (best === worst) {
      return fmt.colorize(/** @type {import('node:util').InspectColor} */(fmt.colors.green), String(row.missions));
    }
    if (value === best) {
      return fmt.colorize(/** @type {import('node:util').InspectColor} */(fmt.colors.green), String(row.missions));
    }
    if (value === worst) {
      return fmt.colorize(/** @type {import('node:util').InspectColor} */(fmt.colors.red), String(row.missions));
    }
    return fmt.colorize(/** @type {import('node:util').InspectColor} */(fmt.colors.yellow), String(row.missions));
  });
}

 // Core renderers from stats-report.ts (task-2217)
const { formatStatsTable, renderWeeklyStatsReport, renderRangeStatsReport, renderMissionPhaseReport: _renderMissionPhaseReport } = statsReport;

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
 * @param {StatsRow[]} rows
 * @param {string} slug
 * @param {StatsOptions} options
 */
// @ts-ignore -- retained reporting helper is dynamically typed
function renderMissionPhaseReport(rows, slug, options = {}) {
  const opts = options || {};
  return _renderMissionPhaseReport(rows, slug, {
    ...opts,
// @ts-ignore -- retained reporting helper is dynamically typed
    repo: opts.repo || resolveStatsRepoName(opts.rootDir),
// @ts-ignore -- retained reporting helper is dynamically typed
    repos: [resolveStatsRepoName(opts.rootDir)],
  });
}

// @ts-ignore -- retained reporting helper is dynamically typed
function deriveFixRoundsFromTaskText(taskFilePath) {
  if (!taskFilePath || !fs.existsSync(taskFilePath)) {return 0;}
  const content = fs.readFileSync(taskFilePath, 'utf8');
  const patterns = [
    /Review round\s+(\d+)/gi,
    /round[- ](\d+)\s+(?:fix|re-review|completed)/gi,
  ];

  let maxRound = 0;
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      maxRound = Math.max(maxRound, Number.parseInt(match[1], 10) || 0);
    }
  }

  return Math.max(0, maxRound - 1);
}

/**
 * @param {string} slug
 * @param {string} finalImplementer
 * @param {string} latestRound
 * @param {string} [rootDir]
 */
// @ts-ignore -- retained reporting helper is dynamically typed
function deriveFixRoundsFromReviewStateHistory(slug, finalImplementer, latestRound, rootDir = process.cwd()) {
  const normalizedImplementer = normalizeImplementer(finalImplementer);
  const declaredRound = Number.parseInt(latestRound, 10) || 0;
  if (!slug || !normalizedImplementer) {
    return 0;
  }

  const branch = `mission/${slug}`;
  const result = git(['-C', rootDir, 'log', '--reverse', '--format=%s', branch]);
  if (result.status !== 0) {
    return Math.max(0, declaredRound - 1);
  }

  let firstFinalImplementerRound = null;
  // This path only runs for a mission with no Review in the database, so there
  // is no round counter to read: the highest round in the commit history is
  // the mission's latest round.
  let highestRound = 0;
  // review-state commit subjects are formatted as:
  //   review-state(<slug>): round N (<phase>) [<reviewer> -> <implementer>] ...
  // The implementer sits on the right of the `->`. Match the earliest reviewing
  // round whose implementer is the final implementer. (An older format placed the
  // implementer inside the phase parens, e.g. `(reviewing <impl>)`; accept both.)
// @ts-ignore -- retained reporting helper is dynamically typed
  const esc = (/** @type{string} */ s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const reviewStatePattern = new RegExp(
    `^review-state\\(${esc(slug)}\\):\\s*round\\s+(\\d+)\\s+\\(reviewing[^)]*\\)\\s*\\[[^\\]]*->\\s*${esc(normalizedImplementer)}\\b`,
    'i'
  );
  const legacyPattern = new RegExp(
    `^review-state\\(${esc(slug)}\\):\\s*round\\s+(\\d+)\\s+\\([^)]*reviewing\\s+${esc(normalizedImplementer)}\\)`,
    'i'
  );
  const anyRoundPattern = new RegExp(`^review-state\\(${esc(slug)}\\):\\s*round\\s+(\\d+)\\b`, 'i');

  for (const line of result.stdout.split('\n')) {
    const trimmed = line.trim();

    const anyRound = trimmed.match(anyRoundPattern);
    if (anyRound) {
      const seen = Number.parseInt(anyRound[1], 10);
      if (Number.isInteger(seen) && seen > highestRound) { highestRound = seen; }
    }

    if (firstFinalImplementerRound !== null) {continue;}
    const match = trimmed.match(reviewStatePattern) || trimmed.match(legacyPattern);
    if (!match) {continue;}
    const candidateRound = Number.parseInt(match[1], 10);
    if (Number.isInteger(candidateRound) && candidateRound > 0) {
      firstFinalImplementerRound = candidateRound;
    }
  }

  const round = declaredRound || highestRound || 1;
  if (round <= 1) {
    return 0;
  }

  if (!firstFinalImplementerRound) {
    return Math.max(0, round - 1);
  }

  return Math.max(0, round - firstFinalImplementerRound);
}

/**
 * @param {string} slug
 * @param {string} [rootDir]
 */
// @ts-ignore -- retained reporting helper is dynamically typed
function deriveFinalImplementerFromBranchHistory(slug, rootDir = process.cwd()) {
  if (!slug) {return null;}

  const branches = [`mission/${slug}`, `origin/mission/${slug}`];
  for (const branch of branches) {
    const result = git(['-C', rootDir, 'log', '--format=%s', branch]);
    if (result.status !== 0) {
      continue;
    }

    const activeImplementerPattern = new RegExp(
      `^backlog\\(${slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\):\\s*transition to active and implementer=([^\\s)]+)`,
      'i'
    );

    for (const line of result.stdout.split('\n')) {
      const match = line.trim().match(activeImplementerPattern);
      if (!match) {continue;}
      const implementer = normalizeImplementer(match[1]);
      if (implementer) {
        return implementer;
      }
  }
  }

  return null;
}

/**
 * @param {string} slug
 * @param {string} [rootDir]
 */
// @ts-ignore -- retained reporting helper is dynamically typed
function deriveImplementerAndFixRoundsFromPrComments(slug, rootDir = process.cwd()) {
  if (!slug) {return null;}

  // Only attempt Forgejo PR comment lookup when Forgejo review is enabled
  if (!isForgejoReviewEnabled(rootDir)) {return null;}

  // forgejo already imported at top
  const token = forgejo.readToken(/** @type{string} */(forgejo.resolveForgejoUser()));
  if (!token) {return null;}

  const comments = forgejo.getCommentsSync(`mission/${slug}`, token);
  if (!Array.isArray(comments) || comments.length === 0) {
    return null;
  }

  const resolutionPattern = /^(?:#|##|###)\s*(?:Review\s+(?:Round|Attempt)\s+\d+\s+Resolution\b|Review\s+Follow-up\s+Resolution\b|Round\s+\d+\s+Resolution(?:\s+Summary)?\b|Round\s+resolution\b|Task-\d+\s+[—-]\s+Act-on-Review Round Resolution\b)/i;
// @ts-ignore -- retained reporting helper is dynamically typed
  const isResolutionComment = (/** @type{*} */ comment) => comment.kind === 'issue-comment'
    && normalizeImplementer(comment.user)
    && resolutionPattern.test(String(comment.body || '').trim());
  const resolutionComments = comments
    .filter(isResolutionComment)
    .map(comment => ({
      implementer: normalizeImplementer(comment.user),
      body: String(comment.body || '').trim(),
    }));

  if (resolutionComments.length === 0) {
    return null;
  }

  const findingPattern = /(^###\s*Finding:|^##\s*Review Findings\b|^Review findings\b|^\d+\.\s+(?:HIGH|MEDIUM|LOW)\s+[—-]|^#\s*Review Round\s+\d+\b(?!.*Resolution)|^#\s*Review Attempt\s+\d+\b(?!.*Resolution)|^Review attempt\s+\d+\s+by\b)/im;
  const resolvedRounds = [];
  let pendingRound = null;

  for (const comment of comments) {
    const isBlockingReview = String(comment.kind || '').startsWith('review')
      && !String(comment.kind || '').includes('stale')
      && !String(comment.kind || '').includes('dismissed')
      && String(comment.state || '').toUpperCase() === 'REQUEST_CHANGES';
    const isFindingComment = comment.kind === 'issue-comment'
      && findingPattern.test(String(comment.body || '').trim());

    if (isBlockingReview || isFindingComment) {
      if (pendingRound?.implementer) {
        resolvedRounds.push(pendingRound);
      }
      pendingRound = {};
      continue;
    }

    if (pendingRound && isResolutionComment(comment)) {
      pendingRound = { implementer: normalizeImplementer(comment.user) };
    }
  }

  if (pendingRound?.implementer) {
    resolvedRounds.push(pendingRound);
  }

  if (resolvedRounds.length > 0) {
    const latest = resolvedRounds[resolvedRounds.length - 1];
    return {
      implementer: latest.implementer,
      prFixRounds: resolvedRounds.filter(round => round.implementer === latest.implementer).length,
      source: 'pr-comments',
    };
  }

  const latest = resolutionComments[resolutionComments.length - 1];
  return {
    implementer: latest.implementer,
    prFixRounds: resolutionComments.filter(comment => comment.implementer === latest.implementer).length,
    source: 'pr-comments',
  };
}

/**
 * Load a mission's `Review` aggregate from the operator database.
 *
 * The statistics projection reads review data through `SqliteMissionStore`
 * (ADR 0053 / architecture migration) rather than through the review modules' readers,
 * so no statistics path can reintroduce a file-backed round history.
 *
 * @param {string} slug
 * @param {string} [rootDir]
 * @returns {Promise<import('../../../domain/review.js').Review|null>}  Null when the mission has no Review.
 */
// @ts-ignore -- retained reporting helper is dynamically typed
async function loadMissionReview(slug, rootDir = process.cwd(), missionStore: MissionStore | null = null) {
  void rootDir;
  if (!missionStore) { return null; }
  const result = await missionStore.load(missionId(slug));
  if (result.kind === 'unavailable') {
    throw new Error(`Mission store unavailable while reading review statistics: ${result.reason}`);
  }
  return result.kind === 'found' ? result.mission.review : null;
}

/**
 * @param {string} slug
 * @param {string} [rootDir]
 */
// @ts-ignore -- retained reporting helper is dynamically typed
async function deriveImplementerAndFixRounds(slug, rootDir = process.cwd(), missionStore: MissionStore | null = null) {
  const review = await loadMissionReview(slug, rootDir, missionStore);
  const currentRound = review ? currentReviewRound(review) : null;

  // The Review aggregate is the authority for the round conversation: a fix
  // round is one the reviewer sent back, which the rounds record directly. The
  // network and commit-subject derivations below are for missions with no
  // Review in the database at all — imported history, or a mission whose loop
  // ran before the cutover and has not been backfilled.
  const rounds = review ? review.rounds : [];
  if (rounds.length > 0) {
    const owner = rounds[rounds.length - 1].implementer;
    const implementer = normalizeImplementer(owner)
      || deriveFinalImplementerFromBranchHistory(slug, rootDir)
      || (currentRound?.implementer ? normalizeImplementer(currentRound.implementer) : null);
    if (implementer) {
      // Primary: count from reviewEvents — the live review loop writes
      // reviewer_outcome events with verdict 'request-changes' via
      // persistEventInStore. This is the authoritative source.
// @ts-ignore -- retained reporting helper is dynamically typed
      const events = review.reviewEvents || [];
      const hasOutcomes = events.some((e) => e.eventType === 'reviewer_outcome');
      const eventCount = events.filter(
        (e) => e.eventType === 'reviewer_outcome' && e.verdict === 'request-changes',
      ).length;

      // Fallback: rounds[].decision.kind === 'changes-requested' for
      // pre-cutover missions or missions seeded via applyReviewerCommand.
      // Filter by implementer to ensure we count rounds for the correct implementer.
      const decisionCount = rounds.filter(
        (round) => round.decision?.kind === 'changes-requested' && round.implementer === implementer,
      ).length;

      if (eventCount > 0) {
        return { implementer, prFixRounds: eventCount, source: 'review-aggregate' };
      }
      if (decisionCount > 0) {
        return { implementer, prFixRounds: decisionCount, source: 'review-aggregate' };
      }

      // reviewEvents has outcomes (live loop ran) but none requested changes.
      // This is a determined zero — approved first time or comment-only.
      if (hasOutcomes) {
        return { implementer, prFixRounds: 0, source: 'review-aggregate' };
      }

      // No fix-round signal from either source — count cannot be determined.
      // Return null so callers exclude this mission from averages.
      return { implementer, prFixRounds: null, source: 'review-aggregate' };
    }
  }

  const prCommentImplementer = deriveImplementerAndFixRoundsFromPrComments(slug, rootDir);
  if (prCommentImplementer) {
    return prCommentImplementer;
  }

  const historyImplementer = deriveFinalImplementerFromBranchHistory(slug, rootDir);
  if (historyImplementer) {
    return {
      implementer: historyImplementer,
      prFixRounds: deriveFixRoundsFromReviewStateHistory(slug, historyImplementer, String(currentRound?.number ?? ''), rootDir),
      source: 'branch-history',
    };
  }

  // No `review-state` source follows: a mission with a Review always has at
  // least one round, so the aggregate branch above already owns every case a
  // review-state read used to cover.

  const resolution = resolveTaskFile(slug, rootDir);
  if (resolution.ok) {
// @ts-ignore -- task resolution guarantees a task file for successful lookups
    const implementer = normalizeImplementer(getTaskImplementer(resolution.taskFile) || getTaskAssignee(resolution.taskFile) || '');
    if (implementer) {
      return {
        implementer,
// @ts-ignore -- retained reporting helper is dynamically typed
        prFixRounds: deriveFixRoundsFromTaskText(resolution.taskFile),
        source: 'backlog-fallback',
      };
    }
  }

  // No implementer and no fix-round signal from any source. The count is
  // unknown, not zero — a manufactured zero here would enter the integration
  // rollup row as a real observation (TASK-2369 Part D).
  return {
    implementer: 'unknown',
    prFixRounds: null,
    source: 'unknown-fallback',
  };
}

/**
 * @param {string} slug
 * @param {string} [rootDir]
 */
// @ts-ignore -- retained reporting helper is dynamically typed
function resolveMissionClassification(slug, rootDir = process.cwd()) {
  const resolution = resolveTaskFile(slug, rootDir);
  if (!resolution.ok) {
    return {
      classification: null,
      taskFile: null,
      error: `Could not resolve backlog task for ${slug}.`,
    };
  }

// @ts-ignore -- task resolution guarantees a task file for successful lookups
  const classification = normalizeClassification(getTaskClassification(resolution.taskFile) || '');
  if (!classification) {
    return {
      classification: null,
      taskFile: resolution.taskFile,
      error: `Missing or invalid classification for ${slug}; expected exactly one of ai_sdlc, user_value, or unknown in the labels of ${resolution.taskFile}. Fix: add exactly one of those labels and do not use a separate frontmatter field for mission type.`,
    };
  }

  return {
    classification,
    taskFile: resolution.taskFile,
  };
}

/**
 * @param {StatsRow} row
 * @param {{normalizeImplementer?: boolean, normalizeClassification?: boolean, rootDir?: string}} options
 */
// @ts-ignore -- retained reporting helper is dynamically typed
function canonicalizeStatsRow(row, options = {}) {
  const normalized = normalizeStatsRow(row, options);
  /** @type {StatsRow} */
  const canonical = {
    ...normalized,
// @ts-ignore -- retained reporting helper is dynamically typed
    date: formatDateOnly(parseToday(String(row.date))),
// @ts-ignore -- retained reporting helper is dynamically typed
    repo: String(normalized.repo || resolveStatsRepoName(options.rootDir)).trim(),
    mission: String(row.mission).trim().toLowerCase(),
    classification: /** @type{string|number|boolean|undefined} */(normalizeClassification(row.classification)),
    implementer: /** @type{string|number|boolean|undefined} */(normalizeImplementer(row.implementer)),
    stage: String(row.stage || '').trim().toLowerCase() || 'default',
  };
  for (const key of USAGE_NUMBERS) {
// @ts-ignore -- retained reporting helper is dynamically typed
    const value = /** @type{any} */(normalized)[key];
    // pr_fix_rounds: undefined means "unknown" — must not become '0'
    if (key === 'pr_fix_rounds' && canonical[key] === undefined) { continue; }
// @ts-ignore -- retained reporting helper is dynamically typed
    canonical[key] = String(Math.max(0, Number.parseInt(String(value), 10) || 0));
  }
  return canonical;
}

/**
 * Persist one measurement through the `MeasurementStorePort`.
 *
 * The canonicalization and validation rules are unchanged; only the sink
 * moved from `<PARALLIX_HOME>/stats.csv` to the measurement database
 * (ADR 0053, architecture migration). The returned `data.rows` are read back from the
 * store in the same `date, repo, mission, stage` order the file authority
 * produced, so `recordIntegrationStats` and `px integrate` render identically.
 *
 * @param {StatsRow} row
 * @param {UpsertStatsRowOptions} options
 */
// @ts-ignore -- retained reporting helper is dynamically typed
function upsertMeasurementRow(row: StatsRow, options: {rootDir?: string, store?: unknown, dbPath?: string} = {}) {
  /** @type {UpsertStatsRowOptions} */
  const opts = options;
  const canonicalRow = canonicalizeStatsRow(row, /** @type {any} */ ({ rootDir: opts.rootDir }));
  if (!canonicalRow.classification) {
    throw new Error(`Invalid classification for ${canonicalRow.mission}.`);
  }
  if (!canonicalRow.implementer) {
    throw new Error(`Invalid implementer for ${canonicalRow.mission}.`);
  }

  const store = getMeasurementStore(opts);
// @ts-ignore -- retained reporting helper is dynamically typed
  const { changed } = store.upsertMeasurement(statsRowToMeasurement(canonicalRow));
// @ts-ignore -- retained reporting helper is dynamically typed
  const data = { headers: [...STATS_HEADERS], rows: store.listMeasurements().map(measurementToStatsRow) };

  return { changed, row: canonicalRow, data };
}

/**
 * @param {RecordIntegrationStatsOptions} options
 */
// @ts-ignore -- retained reporting helper is dynamically typed
// @ts-ignore -- retained reporting helper is dynamically typed
async function recordIntegrationStats(options = {}) {
  /** @type {RecordIntegrationStatsOptions} */
  const opts = options;
// @ts-ignore -- retained reporting helper is dynamically typed
  const { slug, rootDir = process.cwd(), date = formatDateOnly(new Date()), store = undefined, dbPath = undefined, missionStore = null } = opts;
  if (!slug) {
    throw new Error('recordIntegrationStats requires a mission slug.');
  }

  const resolution = resolveMissionClassification(slug, rootDir);
  if (!resolution.classification) {
    throw new Error(`Cannot record integration stats for ${slug}: ${resolution.error || 'missing classification'}`);
  }
  const { classification } = resolution;
  const implementerInfo = await deriveImplementerAndFixRounds(slug, rootDir, missionStore);
 const result = upsertMeasurementRow({
    date,
    mission: slug,
    classification,
// @ts-ignore -- retained reporting helper is dynamically typed
    implementer: implementerInfo.implementer,
// @ts-ignore -- retained reporting helper is dynamically typed
    pr_fix_rounds: implementerInfo.prFixRounds,
 }, { rootDir, store, dbPath });
  const missionFlow = await readMissionFlowPopulation({ rootDir });

 return {
   ...result,
    report: renderWeeklyStatsReport(result.data.rows, { today: date, rootDir, missionFlow }),
    metadataSource: {
      classification: 'backlog-task',
      implementer: implementerInfo.source,
    },
  };
}

/**
 * Map an agent telemetry object onto the numeric stats columns. The mapping is
 * agent-family-agnostic: it consumes the normalized fields produced by either
 * `codex-telemetry.js` (`extractCodexTelemetry`) or `claude-telemetry.js`
 * (`extractClaudeTelemetryFromStdout`) — both expose the same shape
 * (`inputTokens`, `outputTokens`, `cachedTokens`, `totalTokens`, `toolCalls`,
 * `provider`, `model`, `usagePercent`). When telemetry is absent the token
 * columns are honest zeros and provider/model fall back to the agent family
 * name.
 *
 * NOTE: `context_tokens` records the session's cumulative `total_tokens` as a
 * coarse context-size signal. `cached_tokens` records prompt-cache reads
 * (Codex `cached_input_tokens`; Claude `cache_read_input_tokens`).
 * `openai_usage_after` records the rate-limit `used_percent` snapshot when
 * available — Codex exposes it; Claude has no CLI rate-limit endpoint so it
 * stays 0. `openai_usage_before`/`_delta` are left at 0 — proper
 * before/after/delta attribution is deferred to the follow-up mission that adds
 * the regression model.
 */
/**
 * @param {*} telemetry
 * @param {TelemetryToStatsOptions} options
 */
// @ts-ignore -- retained reporting helper is dynamically typed
function telemetryToStatsFields(telemetry: any, options: {agentFamily: string, durationMinutes?: number, model?: string} = {}) {
  const { agentFamily, durationMinutes = 0, model } = options;
  const t = telemetry || null;
  const usageAfter = t && typeof t.usagePercent === 'number' ? Math.round(t.usagePercent) : 0;
  return {
    provider: (t && t.provider) || model || agentFamily || '',
    model: (t && t.model) || model || agentFamily || '',
    input_tokens: String((t && t.inputTokens) || 0),
    output_tokens: String((t && t.outputTokens) || 0),
    cached_tokens: String((t && t.cachedTokens) || 0),
    thoughts_tokens: String((t && t.thoughtsTokens) || 0),
    context_tokens: String((t && t.totalTokens) || 0),
    tool_calls: String((t && t.toolCalls) || 0),
    openai_usage_before: '0',
    openai_usage_after: String(usageAfter),
    openai_usage_delta: '0',
    duration_minutes: String(Math.max(0, Math.round(durationMinutes) || 0)),
    cost_usd: String((t && typeof t.cost_usd === 'number') ? t.cost_usd : 0),
  };
}

/**
 * @param {StatsRow} a
 * @param {StatsRow} b
 */
function sameStatsIdentity(a: StatsRow, b: StatsRow) {
  return a.repo === b.repo
    && a.mission === b.mission
    && (a.stage || 'default') === (b.stage || 'default')
    && statsRowActorKey(a) === statsRowActorKey(b);
}

/**
 * @param {string} existing
 * @param {string} incoming
 * @param {AccModeOptions} [options]
 */
function accumulateIntegerStrings(existing: string, incoming: string, options: {mode?: string} = {}) {
  /** @type {AccModeOptions} */
  const opts = options;
  const current = Number.parseInt(existing, 10) || 0;
  const next = Number.parseInt(incoming, 10) || 0;
  if (opts.mode === 'max') {return String(Math.max(current, next));}
  if (opts.mode === 'replace') {return String(next);}
  return String(current + next);
}

/**
 * @param {string} existing
 * @param {string} incoming
 */
function accumulateDecimalStrings(existing: string, incoming: string) {
  const current = Number.parseFloat(existing) || 0;
  const next = Number.parseFloat(incoming) || 0;
  return String(current + next);
}

/**
 * @param {string} existing
 * @param {string} incoming
 */
function mergeLabel(existing: string, incoming: string) {
  const a = String(existing || '').trim();
  const b = String(incoming || '').trim();
  if (!a) {return b;}
  if (!b) {return a;}
  return a === b ? a : 'mixed';
}

/**
 * Record one stage row (draft/active/review/...) keyed by (repo, mission, stage).
 * Shared by the draft launcher and the review-loop hooks. Token columns come
 * from `telemetry` when supplied, else honest zeros.
  */
/**
 * @param {RecordStageStatsOptions} options
 */
// @ts-expect-error recordStageStats options missing slug/stage
function recordStageStats(options: {slug: string, stage: string, rootDir?: string, date?: string, implementer?: string, reviewer?: string, prFixRounds?: string, telemetry?: any, durationMinutes?: number, model?: string} = {}) {
  /** @type {any} */
  const opts = options;
  // `prFixRounds` is deliberately not defaulted to '0'. A draft or active stage
  // row has no review-fix count yet, and writing a zero there fabricates a
  // measured zero that the board can no longer tell from unknown (TASK-2363).
// @ts-ignore -- retained reporting helper is dynamically typed
  const { slug, stage, rootDir = process.cwd(), date = formatDateOnly(new Date()), implementer, reviewer = '', prFixRounds = undefined, telemetry = null, durationMinutes = 0, model = null, store = undefined, dbPath = undefined } = opts;
  if (!slug) {throw new Error('recordStageStats requires a mission slug.');}
  if (!stage) {throw new Error('recordStageStats requires a stage.');}

  const { classification, error: classificationError } = resolveMissionClassification(slug, rootDir);
  if (!classification) {
    throw new Error(`Cannot record stage stats for ${slug}: ${classificationError || 'missing classification'}`);
  }
  const agentFamily = implementer || reviewer || 'unknown';

  return upsertMeasurementRow({
    date,
    mission: slug,
    classification,
    implementer: agentFamily,
    pr_fix_rounds: prFixRounds,
    implementer_agent: implementer || '',
    reviewer_agent: reviewer || '',
    stage,
// @ts-ignore -- retained reporting helper is dynamically typed
    ...telemetryToStatsFields(telemetry, { agentFamily, durationMinutes, model }),
  }, { rootDir, store, dbPath });
}

/**
 * @param {{slug: string, stage: string, rootDir?: string, date?: string, implementer?: string, reviewer?: string, prFixRounds?: string, telemetry?: {provider?: string, model?: string, inputTokens?: number, outputTokens?: number, cachedTokens?: number, totalTokens?: number, toolCalls?: number, usagePercent?: number, cost_usd?: number} | null, durationMinutes?: number, model?: string}} options
 */
function accumulateStageStats(options: {slug: string, stage: string, rootDir?: string, date?: string, implementer?: string, reviewer?: string, prFixRounds?: string, telemetry?: any, durationMinutes?: number, model?: string}) {
  // Unknown stays unknown here too; see recordStageStats above.
// @ts-ignore -- retained reporting helper is dynamically typed
  const { slug, stage, rootDir = process.cwd(), date = formatDateOnly(new Date()), implementer, reviewer = '', prFixRounds = undefined, telemetry = null, durationMinutes = 0, model = null, store = undefined, dbPath = undefined } = options;
  if (!slug) {throw new Error('accumulateStageStats requires a mission slug.');}
  if (!stage) {throw new Error('accumulateStageStats requires a stage.');}

  const { classification, error: classificationError } = resolveMissionClassification(slug, rootDir);
  if (!classification) {
    throw new Error(`Cannot record stage stats for ${slug}: ${classificationError || 'missing classification'}`);
  }
  const agentFamily = implementer || reviewer || 'unknown';
  const incomingRow = canonicalizeStatsRow({
    date,
    mission: slug,
    classification,
    implementer: agentFamily,
    pr_fix_rounds: prFixRounds,
    implementer_agent: implementer || '',
    reviewer_agent: reviewer || '',
    stage,
    ...telemetryToStatsFields(telemetry, { agentFamily, durationMinutes, model: model || undefined }),
  }, { rootDir });

  const data = loadMeasurementRows({ rootDir, store, dbPath });
// @ts-ignore -- retained reporting helper is dynamically typed
  const existing = data.rows.find(row => sameStatsIdentity(row, incomingRow));
  if (!existing) {
// @ts-ignore -- retained reporting helper is dynamically typed
    return upsertMeasurementRow(incomingRow, { rootDir, store, dbPath });
  }

  const mergedRow = {
    ...existing,
    date: incomingRow.date,
    classification: incomingRow.classification,
    implementer: incomingRow.implementer,
    pr_fix_rounds: incomingRow.pr_fix_rounds,
    implementer_agent: incomingRow.implementer_agent,
    reviewer_agent: incomingRow.reviewer_agent,
    provider: mergeLabel(String(existing.provider), String(incomingRow.provider)),
    model: mergeLabel(String(existing.model), String(incomingRow.model)),
    input_tokens: accumulateIntegerStrings(String(existing.input_tokens), String(incomingRow.input_tokens)),
    output_tokens: accumulateIntegerStrings(String(existing.output_tokens), String(incomingRow.output_tokens)),
    cached_tokens: accumulateIntegerStrings(String(existing.cached_tokens), String(incomingRow.cached_tokens)),
    thoughts_tokens: accumulateIntegerStrings(String(existing.thoughts_tokens), String(incomingRow.thoughts_tokens)),
    context_tokens: accumulateIntegerStrings(String(existing.context_tokens), String(incomingRow.context_tokens)),
    tool_calls: accumulateIntegerStrings(String(existing.tool_calls), String(incomingRow.tool_calls)),
    openai_usage_before: accumulateIntegerStrings(String(existing.openai_usage_before), String(incomingRow.openai_usage_before), { mode: 'replace' }),
    openai_usage_after: accumulateIntegerStrings(String(existing.openai_usage_after), String(incomingRow.openai_usage_after), { mode: 'max' }),
    openai_usage_delta: accumulateIntegerStrings(String(existing.openai_usage_delta), String(incomingRow.openai_usage_delta)),
    duration_minutes: accumulateIntegerStrings(String(existing.duration_minutes), String(incomingRow.duration_minutes)),
    cost_usd: accumulateDecimalStrings(String(existing.cost_usd), String(incomingRow.cost_usd)),
  };

  return upsertMeasurementRow(mergedRow, { rootDir, store, dbPath });
}

/**
 * Default the per-mission fix-round count when the caller didn't supply one.
 *
 * Fix rounds are a property of the mission/implementer (NOT of integration), so
 * the count is stamped onto the implementer-attributed stage rows as the loop
 * progresses; the final round's row then carries the true count even if the
 * mission is never integrated. A stage row written without a count carries the
 * highest count already recorded for the mission forward, so an intermediate
 * row can't silently reset it to zero.
 *
 * This reads the measurement store (SQLite), synchronously, on the same port
 * the row is about to be written through — the review event files it used to
 * read are gone, and the Review aggregate is only reachable asynchronously.
 */
/**
 * A caller that supplies no count, with no prior KNOWN count on the mission,
 * has measured nothing — so this returns `undefined` (unknown), never `'0'`.
 * NULL rows are skipped when searching for the prior maximum: `[NULL, NULL]`
 * is unknown, `[NULL, 0]` is a known zero, `[NULL, 2]` is a known 2. A store
 * that cannot be read yields unknown as well, because a read failure is not
 * evidence of zero rounds (TASK-2369 Part D).
 *
 * @param {string} slug
 * @param {string} rootDir
 * @param {string|null|undefined} provided
 * @param{{store?: unknown, dbPath?: string}} storeOptions
 */
function defaultPrFixRounds(slug: string, rootDir: string, provided: string | null | undefined, storeOptions: {store?: unknown, dbPath?: string} = {}) {
  if (provided !== undefined && provided !== null) {return provided;}
  if (!slug) {return undefined;}
  try {
    // The same port the row is about to be written through, so a caller writing
    // to an injected store reads its own history rather than the ambient one.
    const store = getMeasurementStore({ rootDir, ...storeOptions });
// @ts-ignore -- retained reporting helper is dynamically typed
    const recorded = store.findByMission(slug)
// @ts-ignore -- retained reporting helper is dynamically typed
      .map((record) => record.pr_fix_rounds)
// @ts-ignore -- retained reporting helper is dynamically typed
      .filter((value) => value !== null && value !== undefined)
// @ts-ignore -- retained reporting helper is dynamically typed
      .map((value) => Number.parseInt(String(value), 10) || 0);
    return recorded.length > 0 ? String(Math.max(...recorded)) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * @param {RecordActiveStatsOptions} options
 */
// @ts-expect-error recordActiveStats options missing slug
function recordActiveStats(options: {slug: string, stage?: string, rootDir?: string, implementer?: string, prFixRounds?: string, telemetry?: any, durationMinutes?: number, model?: string} = {}) {
  /** @type {any} */
  const opts = options;
  const { stage = 'active', slug, rootDir = process.cwd(), prFixRounds, model, ...rest } = opts;
  return recordStageStats({
    stage, slug, rootDir, model,
    prFixRounds: defaultPrFixRounds(slug, rootDir, prFixRounds, { store: rest.store, dbPath: rest.dbPath }),
    ...rest,
  });
}

/**
 * @param {RecordReviewStatsOptions} options
 */
// @ts-expect-error recordReviewStats options missing slug
function recordReviewStats(options: {slug: string, stage?: string, rootDir?: string, reviewer?: string, implementer?: string, prFixRounds?: string, model?: string} = {}) {
  /** @type {any} */
  const opts = options;
  const { stage = 'review', slug, rootDir = process.cwd(), reviewer, implementer, prFixRounds, model, ...rest } = opts;
  // A review row's TOKENS belong to the reviewer (telemetry is the reviewer's
  // session), but the row stays keyed to the MISSION'S implementer so the weekly
  // per-implementer summary counts the mission under whoever implemented it — not
  // under the reviewer. The phase report surfaces the reviewer for review phases
  // via `reviewer_agent` (see renderMissionPhaseReport), so no information is lost.
  return recordStageStats({
    stage, slug, rootDir, reviewer, model,
    implementer: implementer || reviewer,
    prFixRounds: defaultPrFixRounds(slug, rootDir, prFixRounds, { store: rest.store, dbPath: rest.dbPath }),
    ...rest,
  });
}

/**
 * @param {Function} [log]
 */
function printStatsUsage(log: typeof fmt.log.plain = fmt.log.plain) {
  log(`Usage: px stats [--today YYYY-MM-DD] [--from YYYY-MM-DD --to YYYY-MM-DD] [--output <file>]
       px stats cohorts [--by label|implementer|model|provider] [--min-sample <n>]

Examples:
  px stats
  px stats --today 2026-05-18
  px stats --from 2026-05-01 --to 2026-05-31
  px stats architecture migration
  px stats --mission architecture migration
  px stats cohorts
  px stats cohorts --by implementer --min-sample 8

Notes:
  - The measurement DATABASE is the authority for statistics:
    <PARALLIX_HOME>/parallix.db. The command reads the database, and an
    unavailable database fails the command.
  - Pass a mission slug (e.g. architecture migration) or --mission <slug> to print a single
    mission broken down by phase (draft, execute, review, follow-up).
  - "px stats cohorts" compares completed missions along one experiment
    dimension. Every cohort figure is printed beside its sample size n, and a
    cohort with too few completed missions is marked low-sample rather than
    presented as a comparable result. Run "px stats cohorts --help" for detail.
  - Workflow-owned stats datasets print the current/previous-week summary tables by default.
  - Use --from and --to together to print one inclusive arbitrary-range report.`);
}

/**
 * @param {string[]} args
 * @param {StatsCmdOptions} options
 */
export function createStatsCommand(useCase: StatsCommandUseCase<StatsRow>) {
  return async function stats(args: string[], options: {log?: Function, error?: Function, exit?: Function, rootDir?: string, store?: unknown, dbPath?: string, laneEventRepo?: unknown, usageRepo?: unknown, repositoryId?: string} = {}) {
  /** @type {StatsCmdOptions} */
  const opts = options;
  const log = opts.log || fmt.log.plain;
  const error = opts.error || fmt.log.plainError;
  const exit = opts.exit || process.exit;
  const rootDir = opts.rootDir || process.cwd();

  // Cohort comparison reads lane-event history as well as measurements, so it
  // owns its own module — including its own --help. The weekly, range, and
  // mission paths below are untouched by it.
  if (args[0] === 'cohorts') {
    return statsCohorts(args.slice(1), {
// @ts-ignore -- retained reporting helper is dynamically typed
      log, error, exit, rootDir,
// @ts-ignore -- retained reporting helper is dynamically typed
      laneEventRepo: opts.laneEventRepo,
// @ts-ignore -- retained reporting helper is dynamically typed
      usageRepo: opts.usageRepo,
// @ts-ignore -- retained reporting helper is dynamically typed
      repositoryId: opts.repositoryId,
    });
  }

  if (args.includes('--help') || args.includes('-h')) {
// @ts-ignore -- retained reporting helper is dynamically typed
    printStatsUsage(log);
    return;
  }

  const positionalArgs = [];
  let outputFile = null;
  let today = new Date();
  let from = null;
  let to = null;
  let mission = null;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--mission' && i + 1 < args.length) {
      mission = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--output' && i + 1 < args.length) {
      outputFile = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--today' && i + 1 < args.length) {
      // @ts-expect-error today is parsed as string but typed as Date
      today = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--from') {
      from = i + 1 < args.length ? args[i + 1] : '';
      i += 1;
      continue;
    }
    if (arg === '--to') {
      to = i + 1 < args.length ? args[i + 1] : '';
      i += 1;
      continue;
    }
    if (!arg.startsWith('--')) {
      positionalArgs.push(arg);
    }
  }

  // A positional mission slug selects a per-mission report.
  const MISSION_SLUG_RE = /^[a-z][a-z0-9]*-\d+$/i;
  if (!mission && positionalArgs.length > 0
      && MISSION_SLUG_RE.test(positionalArgs[0])) {
    mission = positionalArgs[0];
    positionalArgs.length = 0;
  }

  // Mission-phase breakdown from the measurement database.
  if (mission) {
    let rows;
    try {
      rows = useCase.execute({
          mode: 'mission',
          mission,
          options: { rootDir, store: opts.store, dbPath: opts.dbPath },
        }).rows;
    } catch (err: any) {
      error(fmt.status('FAIL', err.message));
      exit(1);
      return;
    }
    const report = renderMissionPhaseReport(rows, mission, { rootDir });
    if (outputFile) {
      fs.writeFileSync(outputFile, `${report}\n`, 'utf8');
      log(fmt.status('PASS', `Report written to ${outputFile}`));
    } else {
      log(report);
    }
    return;
  }

  // Validate range args before async work so sync callers see the error.
  if (from !== null || to !== null) {
    try { createRangeWindow({ from: from || undefined, to: to || undefined }); }
    catch (err: any) {
      error(fmt.status('FAIL', err.message));
      exit(1);
      return;
    }
  }

  let report;
  try {
      const result = useCase.execute({
        mode: from !== null || to !== null ? 'range' : 'weekly',
        from: from || undefined,
        to: to || undefined,
        today,
        options: { rootDir, store: opts.store, dbPath: opts.dbPath },
      });
      const rows = result.rows;
      log(fmt.status('INFO', `Loaded ${rows.length} measurements from the statistics database`));
      // Mission flow is a lifecycle fact and telemetry is an agent fact. Both
      // are read here so the report can state them side by side instead of
      // letting one stand in for the other.
      const missionFlow = await readMissionFlowPopulation({
        rootDir,
        laneEventRepo: opts.laneEventRepo,
        usageRepo: opts.usageRepo,
        repositoryId: opts.repositoryId,
      });
      report = from !== null || to !== null
        ? renderRangeStatsReport(rows, { from: from || undefined, to: to || undefined, rootDir, missionFlow })
        : renderWeeklyStatsReport(rows, { today, rootDir, missionFlow });
  } catch (err: any) {
    error(fmt.status('FAIL', err.message));
    exit(1);
    return;
  }

  if (outputFile) {
    fs.writeFileSync(outputFile, `${report}\n`, 'utf8');
    log(fmt.status('PASS', `Report written to ${outputFile}`));
  } else {
    log(report);
  }
  };
}

const stats = createStatsCommand(new StatsCommandUseCase(createStatsWorkflowAdapter()));

export default stats;
export { stats, statsCohorts, STATS_HEADERS, resolveStatsRepoName, recordIntegrationStats, renderWeeklyStatsReport, renderMissionPhaseReport, renderRangeStatsReport, buildWeeklyWindows, resolveMissionClassification, deriveImplementerAndFixRounds, upsertMeasurementRow, loadMeasurementRows, measurementToStatsRow, statsRowToMeasurement, normalizeStatsRow, canonicalizeStatsRow, recordStageStats, accumulateStageStats, recordActiveStats, recordReviewStats, telemetryToStatsFields, formatDateOnly, USAGE_NUMBERS, formatStatsTable, computeAgentMissionGroups, createRangeWindow, summarizeMissionWindow, summarizeAgentWindow, summarizeAgentStageSpend, formatAgentSpendCell, colorAverageFixRounds, colorMissionCounts, AGENT_SPEND_STAGE_COLUMNS, MISSION_PHASE_ORDER, statsRowActorKey };

(stats as any).statsCohorts = statsCohorts;
(stats as any).STATS_HEADERS = STATS_HEADERS;
(stats as any).resolveStatsRepoName = resolveStatsRepoName;
(stats as any).recordIntegrationStats = recordIntegrationStats;
(stats as any).renderWeeklyStatsReport = renderWeeklyStatsReport;
(stats as any).renderMissionPhaseReport = renderMissionPhaseReport;
(stats as any).renderRangeStatsReport = renderRangeStatsReport;
(stats as any).buildWeeklyWindows = buildWeeklyWindows;
(stats as any).resolveMissionClassification = resolveMissionClassification;
(stats as any).deriveImplementerAndFixRounds = deriveImplementerAndFixRounds;
(stats as any).upsertMeasurementRow = upsertMeasurementRow;
(stats as any).loadMeasurementRows = loadMeasurementRows;
(stats as any).measurementToStatsRow = measurementToStatsRow;
(stats as any).statsRowToMeasurement = statsRowToMeasurement;
(stats as any).normalizeStatsRow = normalizeStatsRow;
(stats as any).canonicalizeStatsRow = canonicalizeStatsRow;
(stats as any).recordStageStats = recordStageStats;
(stats as any).accumulateStageStats = accumulateStageStats;
(stats as any).recordActiveStats = recordActiveStats;
(stats as any).recordReviewStats = recordReviewStats;
(stats as any).telemetryToStatsFields = telemetryToStatsFields;
(stats as any).formatDateOnly = formatDateOnly;
(stats as any).formatStatsTable = formatStatsTable;
(stats as any).computeAgentMissionGroups = computeAgentMissionGroups;
(stats as any).createRangeWindow = createRangeWindow;
(stats as any).summarizeMissionWindow = summarizeMissionWindow;
(stats as any).summarizeAgentWindow = summarizeAgentWindow;
(stats as any).summarizeAgentStageSpend = summarizeAgentStageSpend;
(stats as any).formatAgentSpendCell = formatAgentSpendCell;
(stats as any).colorAverageFixRounds = colorAverageFixRounds;
(stats as any).colorMissionCounts = colorMissionCounts;
(stats as any).AGENT_SPEND_STAGE_COLUMNS = AGENT_SPEND_STAGE_COLUMNS;
(stats as any).MISSION_PHASE_ORDER = MISSION_PHASE_ORDER;
(stats as any).statsRowActorKey = statsRowActorKey;
(stats as any).createWindow = createWindow;
(stats as any).USAGE_NUMBERS = USAGE_NUMBERS;
(stats as any)._internals = {
  generateMarkdownReport,
  normalizeRow,
  normalizeRows,
  parseBooleanish,
  normalizeClassification,
  canonicalizeStatsRow,
  parseDateOnlyStrict,
  createRangeWindow,
  deriveFixRoundsFromTaskText,
  deriveFixRoundsFromReviewStateHistory,
  deriveFinalImplementerFromBranchHistory,
  deriveImplementerAndFixRoundsFromPrComments,
  deriveImplementerAndFixRounds,
  summarizeMissionWindow,
  summarizeAgentWindow,
  summarizeAgentStageSpend,
  classifyAgentSpendFamily,
  formatAgentSpendCell,
  colorAverageFixRounds,
  colorMissionCounts,
  printStatsUsage,
};
