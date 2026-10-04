#!/usr/bin/env node

type StatisticsMeasurementStore = Pick<MeasurementStorePort, 'listMeasurements' | 'upsertMeasurement'>
  & Partial<Pick<MeasurementStorePort, 'findByMission'>>;
type ReviewReadStore = Pick<MissionStore, 'load'>;

interface StatsOptions {
  rootDir?: string;
  ensureDir?: boolean;
  /** Inject a `MeasurementStorePort` (fast isolated tests use a temp database). */
  store?: StatisticsMeasurementStore;
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


import { statsCohorts } from './stats-cohorts.js';
import { resolveCanonicalRepositoryId } from '../../git/repository-identity.js';
import * as statsReport from './stats-report.js';
import { resolveMeasurementStore } from '../../sqlite/measurement-store.js';
import { resolveMissionClassification } from './mission-classification.js';
import type { StatsWorkflowPort, StatsMissionFlow } from '../../../application/ports/cli-workflows.js';
import type { MeasurementStorePort } from '../../../application/measurement-ports.js';
import type { StatsRow } from '../../../application/services/statistics-row.js';
import type { StatisticsRecordingPort } from '../../../application/ports/statistics-recording.js';
import { StatsRecordingUseCase, telemetryToStatsFields, type StageStatsRequest } from '../../../application/stats-recording-use-case.js';
import { reviewStatistics } from '../../../application/services/review-statistics.js';
// Report rendering lives in its own module (task-2369.02). Re-exported below so
// every existing caller keeps importing it from `./stats.js`.
import {
  generateMarkdownReport,
  computeAgentMissionGroups,
  summarizeAgentWindow,
  summarizeAgentStageSpend,
  classifyAgentSpendFamily,
  formatAgentSpendCell,
  colorAverageFixRounds,
  colorMissionCounts,
  renderMissionPhaseReport,
  AGENT_SPEND_STAGE_COLUMNS,
  MISSION_PHASE_ORDER,
} from './stats-report-rendering.js';
import {
  STATS_HEADERS, USAGE_NUMBERS, VALID_CLASSIFICATIONS, normalizeStatsRow, normalizeImplementer,
  parseDateOnly, parseDateOnlyStrict, formatDateOnly, parseToday, createWindow, createRangeWindow, buildWeeklyWindows, canonicalizeStatsRow,
  sameStatsIdentity, accumulateIntegerStrings, accumulateDecimalStrings, mergeLabel,
  normalizeClassification, isValidClassification, normalizeRow, normalizeRows, parseBooleanish, statsMissionKey, modelBelongsToImplFamily, rowInWindow,
} from './stats-normalization.js';

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
function getMeasurementStore(options: StatsOptions = {}): StatisticsMeasurementStore {
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
  const numeric = (value: unknown) => (value === null || value === undefined ? '0' : String(value));
  // `pr_fix_rounds` is the one measurement that is genuinely nullable: an
  // unknown number of review-fix rounds is not a measured zero, and collapsing
  // it here would inflate every observation count downstream (TASK-2369).
  const nullableNumeric = (value: unknown) => (value === null || value === undefined ? undefined : String(value));
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
    pr_fix_rounds: row.pr_fix_rounds === undefined ? undefined : int(row.pr_fix_rounds),
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

export interface StatsReadBinding extends StatsOptions {
  readonly readMissionFlow: () => Promise<readonly StatsMissionFlow[] | null>;
}

export function createStatsWorkflowAdapter(binding: StatsReadBinding): StatsWorkflowPort<StatsRow> {
  return {
    loadMeasurements: async () => loadMeasurementRows(binding).rows,
    loadMissionFlow: binding.readMissionFlow,
  };
}

// `saveStatsCsv` was removed by architecture migration: no production path writes CSV.
// The measurement database is the sole authority (ADR 0053).

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

 // Core renderers from stats-report.ts (task-2217)
const { formatStatsTable, renderWeeklyStatsReport, renderRangeStatsReport } = statsReport;


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
async function loadMissionReview(slug, _rootDir = process.cwd(), missionStore: ReviewReadStore) {
  if (!missionStore) {
    throw new Error(
      `loadMissionReview requires a MissionStore: the stats caller must supply the operator store so ${slug} is read from the authoritative Review aggregate. Store omission is an invariant error; there is no heuristic fallback.`,
    );
  }
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
async function deriveImplementerAndFixRounds(slug, rootDir = process.cwd(), missionStore: ReviewReadStore) {
  if (!missionStore) {
    throw new Error(
      `deriveImplementerAndFixRounds requires a MissionStore: the stats caller must supply the operator store so ${slug} is read from the authoritative Review aggregate. Store omission is an invariant error; there is no PR, Git, or backlog fallback.`,
    );
  }
  return reviewStatistics(await loadMissionReview(slug, rootDir, missionStore));
}

/**
 * Resolve classification from the Mission aggregate used by integration.
 * Missing, unreadable, or unclassified state is an error.
 */
async function resolveStoredMissionClassification(slug: string, missionStore: ReviewReadStore) {
  if (!missionStore) {throw new Error('Mission store is required for statistics classification.');}
  let result;
  try {
    result = await missionStore.load(missionId(slug));
  } catch (error) {
    throw new Error(`Cannot read Mission ${slug} from px database for statistics: ${(error as Error).message || String(error)}`);
  }
  if (result.kind !== 'found') {
    throw new Error(`Mission ${slug} is absent from the px database; cannot record statistics.`);
  }
  const classifications = (result.mission.labels || [])
    .map((label: string) => String(label).toLowerCase())
    .filter((label: string) => isValidClassification(label));
  if (classifications.length !== 1) {
    throw new Error(`Mission ${slug} requires exactly one classification in px state. Fix: px classification set --value <ai_sdlc|user_value|unknown>.`);
  }
  return classifications[0];
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
function upsertMeasurementRow(row: StatsRow, options: StatsOptions = {}) {
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

export interface StatsRecordingOptions extends StatsOptions {
  slug?: string;
  stage?: string;
  date?: string;
  implementer?: string;
  reviewer?: string;
  prFixRounds?: string | null;
  telemetry?: StageStatsRequest['telemetry'];
  durationMinutes?: number;
  model?: string | null;
  missionStore?: ReviewReadStore;
  readMissionFlow?: StatsReadBinding['readMissionFlow'];
}

export function createStatsRecordingUseCase(options: StatsRecordingOptions): StatsRecordingUseCase {
  const rootDir = options.rootDir || process.cwd();
  const port: StatisticsRecordingPort = {
    get repositoryName() { return resolveStatsRepoName(rootDir); },
    readClassification: slug => resolveMissionClassification(slug, rootDir),
    readStoredClassification: slug => resolveStoredMissionClassification(slug, options.missionStore!),
    readReview: slug => loadMissionReview(slug, rootDir, options.missionStore!),
    readMeasurements: () => loadMeasurementRows(options).rows,
    readFixRoundHistory: slug => {
      const store = getMeasurementStore(options);
      if (!store.findByMission) { throw new Error('Measurement history reader is unavailable.'); }
      return store.findByMission(slug).map(record => record.pr_fix_rounds);
    },
    upsert: row => upsertMeasurementRow(row, options),
    readMissionFlow: options.readMissionFlow ?? (async () => null),
  };
  return new StatsRecordingUseCase(port);
}

function stageRequest(options: StatsRecordingOptions): StageStatsRequest {
  return {
    slug: options.slug || '', stage: options.stage || '',
    date: options.date ?? formatDateOnly(new Date()),
    implementer: options.implementer, reviewer: options.reviewer, prFixRounds: options.prFixRounds,
    telemetry: options.telemetry, durationMinutes: options.durationMinutes, model: options.model,
  };
}

async function recordIntegrationStats(options: StatsRecordingOptions = {}) {
  if (!options.slug) { throw new Error('recordIntegrationStats requires a mission slug.'); }
  if (!options.missionStore) {
    throw new Error('recordIntegrationStats requires a MissionStore: the post-integration stats caller must supply the operator store so the implementer and fix rounds are read from the authoritative Review aggregate. Store omission is an invariant error; there is no heuristic fallback.');
  }
  const result = await createStatsRecordingUseCase(options).recordIntegration({
    slug: options.slug, date: options.date ?? formatDateOnly(new Date()),
  });
  let report: string | null = null;
  let reportError = result.reportError;
  if (result.selection) {
    try {
      report = renderWeeklyStatsReport(result.data.rows, { rootDir: options.rootDir, selection: result.selection });
    } catch (error) { reportError = error instanceof Error ? error.message : String(error); }
  }
  return { changed: result.changed, row: result.row, data: result.data, metadataSource: result.metadataSource, report, reportError };
}

function recordStageStats(options: StatsRecordingOptions = {}) {
  return createStatsRecordingUseCase(options).recordStage(stageRequest(options));
}

function accumulateStageStats(options: StatsRecordingOptions) {
  return createStatsRecordingUseCase(options).accumulateStage(stageRequest(options));
}

function defaultPrFixRounds(slug: string, rootDir: string, provided: string | null | undefined, options: StatsOptions = {}) {
  return createStatsRecordingUseCase({ ...options, rootDir }).defaultPrFixRounds(slug, provided);
}

function recordActiveStats(options: StatsRecordingOptions = {}) {
  return createStatsRecordingUseCase(options).recordActive({ ...stageRequest(options), stage: options.stage });
}

function recordReviewStats(options: StatsRecordingOptions = {}) {
  return createStatsRecordingUseCase(options).recordReview({ ...stageRequest(options), stage: options.stage });
}

// Module-level helper namespace (not a command): consumers use it for helpers
// that do not derive (classification, stage stats). The production `px stats`
// command is built in the composition root with the operator MissionStore
// (TASK-2378/SC13) — no store-less workflow adapter exists at module level.
const _internals = {
  generateMarkdownReport,
  normalizeRow,
  normalizeRows,
  parseBooleanish,
  normalizeClassification,
  canonicalizeStatsRow,
  parseDateOnlyStrict,
  createRangeWindow,
  deriveImplementerAndFixRounds,
  summarizeAgentWindow,
  summarizeAgentStageSpend,
  classifyAgentSpendFamily,
  formatAgentSpendCell,
  colorAverageFixRounds,
  colorMissionCounts,
};

const stats = {
  statsCohorts,
  STATS_HEADERS,
  resolveStatsRepoName,
  recordIntegrationStats,
  renderWeeklyStatsReport,
  renderMissionPhaseReport,
  renderRangeStatsReport,
  buildWeeklyWindows,
  resolveMissionClassification,
  deriveImplementerAndFixRounds,
  upsertMeasurementRow,
  loadMeasurementRows,
  measurementToStatsRow,
  statsRowToMeasurement,
  normalizeStatsRow,
  canonicalizeStatsRow,
  recordStageStats,
  accumulateStageStats,
  recordActiveStats,
  recordReviewStats,
  telemetryToStatsFields,
  formatDateOnly,
  formatStatsTable,
  computeAgentMissionGroups,
  createRangeWindow,
  summarizeAgentWindow,
  summarizeAgentStageSpend,
  formatAgentSpendCell,
  colorAverageFixRounds,
  colorMissionCounts,
  AGENT_SPEND_STAGE_COLUMNS,
  MISSION_PHASE_ORDER,
  statsRowActorKey,
  createWindow,
  USAGE_NUMBERS,
  _internals,
};

export default stats;
export { stats, _internals, statsCohorts, STATS_HEADERS, USAGE_NUMBERS, VALID_CLASSIFICATIONS, normalizeStatsRow, normalizeImplementer, parseDateOnly, parseDateOnlyStrict, formatDateOnly, parseToday, createWindow, createRangeWindow, buildWeeklyWindows, canonicalizeStatsRow, sameStatsIdentity, accumulateIntegerStrings, accumulateDecimalStrings, mergeLabel, parseBooleanish, normalizeRow, normalizeRows, statsMissionKey, modelBelongsToImplFamily, isValidClassification, normalizeClassification, rowInWindow, resolveStatsRepoName, recordIntegrationStats, renderWeeklyStatsReport, renderMissionPhaseReport, renderRangeStatsReport, resolveMissionClassification, deriveImplementerAndFixRounds, upsertMeasurementRow, loadMeasurementRows, measurementToStatsRow, statsRowToMeasurement, recordStageStats, accumulateStageStats, defaultPrFixRounds, recordActiveStats, recordReviewStats, telemetryToStatsFields, formatStatsTable, computeAgentMissionGroups, summarizeAgentWindow, summarizeAgentStageSpend, formatAgentSpendCell, colorAverageFixRounds, colorMissionCounts, AGENT_SPEND_STAGE_COLUMNS, MISSION_PHASE_ORDER, statsRowActorKey };
