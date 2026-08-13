// Pure normalization, date-window, and accumulation helpers shared by stats
// command and report rendering. This module deliberately never imports either
// consumer, preventing a command-module import cycle.

import { resolveCanonicalRepositoryId } from '../../git/repository-identity.js';
import { decisionWindowEndingOn, weeklyDecisionWindows } from '../../../application/services/decision-window.js';
import { statisticsMissionKey, statisticsRowInWindow } from '../../../application/services/statistics-service.js';

interface StatsRow {
  date?: string;
  repo?: string;
  mission?: string;
  classification?: string | null;
  implementer?: string | null;
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
}

interface NormalizeStatsRowOptions {
  repo?: string;
  rootDir?: string;
}

const STATS_HEADERS = [
  'date', 'repo', 'mission', 'classification', 'implementer', 'pr_fix_rounds',
  'provider', 'model', 'implementer_agent', 'reviewer_agent', 'stage',
  'input_tokens', 'output_tokens', 'cached_tokens', 'thoughts_tokens', 'context_tokens',
  'tool_calls', 'openai_usage_before', 'openai_usage_after',
  'openai_usage_delta', 'duration_minutes', 'cost_usd'
];

const USAGE_NUMBERS = new Set([
  'pr_fix_rounds', 'input_tokens', 'output_tokens', 'cached_tokens',
  'thoughts_tokens', 'context_tokens', 'tool_calls', 'openai_usage_before', 'openai_usage_after',
  'openai_usage_delta', 'duration_minutes'
]);

const VALID_CLASSIFICATIONS = new Set(['ai_sdlc', 'user_value', 'unknown']);

function normalizeStatsRow(row: StatsRow = {}, options: NormalizeStatsRowOptions = {}) {
  const repo = String(row.repo || options.repo || resolveCanonicalRepositoryId(options.rootDir || process.cwd())).trim();
  return {
    date: row.date || '', repo, mission: row.mission || '', classification: row.classification || '',
    implementer: row.implementer || '',
    pr_fix_rounds: row.pr_fix_rounds === null || row.pr_fix_rounds === undefined ? undefined : String(row.pr_fix_rounds),
    provider: row.provider || '', model: row.model || '', implementer_agent: row.implementer_agent || '',
    reviewer_agent: row.reviewer_agent || '', stage: row.stage || 'default', input_tokens: row.input_tokens || '0',
    output_tokens: row.output_tokens || '0', cached_tokens: row.cached_tokens || '0',
    thoughts_tokens: row.thoughts_tokens || '0', context_tokens: row.context_tokens || '0',
    tool_calls: row.tool_calls || '0', openai_usage_before: row.openai_usage_before || '0',
    openai_usage_after: row.openai_usage_after || '0', openai_usage_delta: row.openai_usage_delta || '0',
    duration_minutes: row.duration_minutes || '0', cost_usd: row.cost_usd || '0',
  };
}

function normalizeImplementer(value: unknown) {
  return String(value || '').trim().replace(/^@/, '').toLowerCase() || null;
}

function parseDateOnly(value: string) {
  return new Date(`${value}T00:00:00Z`);
}

function parseDateOnlyStrict(value: unknown, flagName?: string) {
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

function formatDateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

function parseToday(today: Date | string = new Date()) {
  return today instanceof Date ? parseDateOnly(formatDateOnly(today)) : parseDateOnly(String(today));
}

function createWindow(endDate: Date | string, days: number) {
  return decisionWindowEndingOn(parseToday(endDate), days);
}

function createRangeWindow(range = {}) {
  const { from, to } = range as {from?: string, to?: string};
  if (!from) { throw new Error('Invalid date range argument --from: value is required when using range mode.'); }
  if (!to) { throw new Error('Invalid date range argument --to: value is required when using range mode.'); }
  const start = parseDateOnlyStrict(from, '--from');
  const end = parseDateOnlyStrict(to, '--to');
  if (start > end) {
    throw new Error(`Invalid date range argument --from/--to: start date ${formatDateOnly(start)} is after end date ${formatDateOnly(end)}.`);
  }
  return { start, end, label: `${formatDateOnly(start)} → ${formatDateOnly(end)}` };
}

function buildWeeklyWindows(today = new Date()) {
  return weeklyDecisionWindows(parseToday(today));
}

function parseBooleanish(value: unknown) {
  if (typeof value === 'boolean') { return value; }
  if (value === null || value === undefined) { return null; }
  const normalized = String(value).trim().toLowerCase();
  if (!normalized || normalized === '—' || normalized === 'n/a') { return null; }
  if (['yes', 'true', '1', 'y', 'merged', 'closed'].includes(normalized)) { return true; }
  if (['no', 'false', '0', 'n', 'open'].includes(normalized)) { return false; }
  return null;
}

function normalizeRow(row: StatsRow) {
  const reviewCount = Number.parseInt(String(row.review_count || ''), 10) || 0;
  const mergedValue = Object.prototype.hasOwnProperty.call(row, 'merged') ? String(row.merged) : row.has_pr;
  let isMerged = parseBooleanish(mergedValue);
  if (isMerged === null && Object.prototype.hasOwnProperty.call(row, 'has_pr')) {
    const hasPr = parseBooleanish(row.has_pr);
    isMerged = hasPr !== null ? hasPr : reviewCount > 0;
  }
  return { ...row, review_count: String(reviewCount), normalizedDate: row.date || row.created_at || '', normalizedMerged: isMerged === true ? 'yes' : 'no', isMerged: isMerged === true };
}

function normalizeRows(rows: StatsRow[]) {
  return rows.map(normalizeRow);
}

function statsMissionKey(row: StatsRow) {
  return statisticsMissionKey(row);
}

function modelBelongsToImplFamily(model: unknown, impl: unknown) {
  if (!model || !impl) { return false; }
  const m = String(model).toLowerCase();
  const i = String(impl).toLowerCase();
  if (m === i) { return true; }
  if (i === 'codex') { return m.startsWith('gpt'); }
  if (i === 'vibe') { return m === 'mistral'; }
  if (i === 'custom') { return !m.startsWith('claude') && !m.startsWith('gpt'); }
  return m.startsWith(i);
}

function isValidClassification(value: unknown) {
  return VALID_CLASSIFICATIONS.has(String(value || '').trim().toLowerCase());
}

function normalizeClassification(value: unknown) {
  const normalized = String(value || '').trim().toLowerCase();
  return isValidClassification(normalized) ? normalized : null;
}

function rowInWindow(row: StatsRow, window: {start: Date, end: Date}) {
  return statisticsRowInWindow(row, window);
}

function canonicalizeStatsRow(row: StatsRow, options: NormalizeStatsRowOptions = {}) {
  const normalized = normalizeStatsRow(row, options);
  const canonical: StatsRow = {
    ...normalized, date: formatDateOnly(parseToday(String(row.date))),
    repo: String(normalized.repo || resolveCanonicalRepositoryId(options.rootDir || process.cwd())).trim(),
    mission: String(row.mission).trim().toLowerCase(), classification: normalizeClassification(row.classification),
    implementer: normalizeImplementer(row.implementer), stage: String(row.stage || '').trim().toLowerCase() || 'default',
  };
  for (const key of USAGE_NUMBERS) {
    const value = (normalized as Record<string, unknown>)[key];
    if (key === 'pr_fix_rounds' && (canonical as Record<string, unknown>)[key] === undefined) { continue; }
    (canonical as Record<string, unknown>)[key] = String(Math.max(0, Number.parseInt(String(value), 10) || 0));
  }
  return canonical;
}

function sameStatsIdentity(a: StatsRow, b: StatsRow) {
  const actor = (row: StatsRow) => normalizeImplementer(row.implementer_agent || row.implementer || '') || '';
  return a.repo === b.repo && a.mission === b.mission && (a.stage || 'default') === (b.stage || 'default') && actor(a) === actor(b);
}

function accumulateIntegerStrings(existing: string, incoming: string, options: {mode?: string} = {}) {
  const current = Number.parseInt(existing, 10) || 0;
  const next = Number.parseInt(incoming, 10) || 0;
  if (options.mode === 'max') { return String(Math.max(current, next)); }
  if (options.mode === 'replace') { return String(next); }
  return String(current + next);
}

function accumulateDecimalStrings(existing: string, incoming: string) {
  return String((Number.parseFloat(existing) || 0) + (Number.parseFloat(incoming) || 0));
}

function mergeLabel(existing: string, incoming: string) {
  const a = String(existing || '').trim();
  const b = String(incoming || '').trim();
  if (!a) { return b; }
  if (!b) { return a; }
  return a === b ? a : 'mixed';
}

export {
  STATS_HEADERS, USAGE_NUMBERS, VALID_CLASSIFICATIONS,
  normalizeStatsRow, normalizeImplementer, parseDateOnly, parseDateOnlyStrict, formatDateOnly, parseToday,
  createWindow, createRangeWindow, buildWeeklyWindows, canonicalizeStatsRow, sameStatsIdentity,
  accumulateIntegerStrings, accumulateDecimalStrings, mergeLabel, parseBooleanish, normalizeRow, normalizeRows,
  statsMissionKey, modelBelongsToImplFamily, isValidClassification, normalizeClassification, rowInWindow,
};
