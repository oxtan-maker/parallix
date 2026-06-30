#!/usr/bin/env node
"use strict";
// @ts-nocheck
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const fmt = __importStar(require("../core/fmt.js"));
const backlog_js_1 = require("../tools/backlog.js");
const product_config_js_1 = require("../core/product-config.js");
const review_state_js_1 = require("../review/review-state.js");
const reviewEvents = __importStar(require("../review/review-events.js"));
const git_js_1 = require("../core/git.js");
const persistent_data_migration_js_1 = require("../core/persistent-data-migration.js");
const mission_utils_js_1 = require("../core/mission-utils.js");
const forgejo = __importStar(require("../tools/forgejo.js"));
const storage = __importStar(require("../core/storage.js"));
// The original 5-column schema. Retained for backward-compatible CSV detection
// and one-time header migration of legacy stats files (task-1251).
const LEGACY_HEADERS = ['date', 'mission', 'classification', 'implementer', 'pr_fix_rounds'];
// Extended 21-column telemetry schema (task-1314 + task-1251). Legacy 5-column rows are
// migrated in-memory on load: the legacy columns are preserved and the new
// columns default to '' (text) or '0' (numeric). On the next write the file
// header is upgraded and existing rows gain the new columns.
const STATS_HEADERS = [
    'date', 'repo', 'mission', 'classification', 'implementer', 'pr_fix_rounds',
    'provider', 'model', 'implementer_agent', 'reviewer_agent', 'stage',
    'input_tokens', 'output_tokens', 'cached_tokens', 'context_tokens',
    'tool_calls', 'openai_usage_before', 'openai_usage_after',
    'openai_usage_delta', 'duration_minutes', 'cost_usd'
];
// Columns coerced to non-negative integers on canonicalization.
const USAGE_NUMBERS = new Set([
    'pr_fix_rounds', 'input_tokens', 'output_tokens', 'cached_tokens',
    'context_tokens', 'tool_calls', 'openai_usage_before', 'openai_usage_after',
    'openai_usage_delta', 'duration_minutes'
]);
const VALID_CLASSIFICATIONS = new Set(['ai_sdlc', 'user_value', 'unknown']);
const SHIPPED_STATS_CSV_PATH = path.join(__dirname, '..', 'data', 'stats.seed.csv');
function getStorage() {
    return storage;
}
function resolveStatsRepoName(rootDir = process.cwd()) {
    const config = (0, product_config_js_1.loadEffectiveConfig)(rootDir);
    const productName = config && config.product && typeof config.product.name === 'string'
        ? config.product.name.trim()
        : '';
    return productName || path.basename(rootDir) || 'parallix';
}
function resolveRepoStatsCsvPath(rootDir = process.cwd()) {
    return path.join(rootDir, 'stats.csv');
}
/**
 * Resolve the effective stats CSV path.
 *
 * Callers that pass an explicit `filePath` (e.g. `--csv-file`) bypass this
 * resolver entirely.
 */
function resolveStatsPath(options = {}) {
    if (options.filePath) {
        return options.filePath;
    }
    if (options.configuredPath) {
        return options.configuredPath;
    }
    const storage = getStorage();
    const rootDir = options.rootDir || process.cwd();
    const destinationPath = storage.resolveStatsPath({ ensureDir: options.ensureDir !== false });
    (0, persistent_data_migration_js_1.migrateStats)({
        sourcePaths: [resolveRepoStatsCsvPath(rootDir), SHIPPED_STATS_CSV_PATH],
        destinationPath,
        defaultRepo: resolveStatsRepoName(rootDir),
    });
    return destinationPath;
}
/**
 * The effective `<PARALLIX_HOME>/stats.csv` is parallix-owned cross-repository agent telemetry,
 * not consuming-repo state (task-1246 classification correction). It records how
 * agent families perform across the missions a single parallix runtime drives, so
 * one runtime working across several repos accumulates ONE shared statistic.
 *
 * The destination path is never derived from a runtime checkout, installed
 * package, or consuming repository. When a root is supplied, it is used only
 * as the legacy repo-root import source during one-time migration.
 */
/**
 * @param {string} legacyRuntimeRoot
 */
function resolveStatsFilePath(legacyRuntimeRoot) {
    return resolveStatsPath({ rootDir: legacyRuntimeRoot });
}
/**
 * Legacy retrospective CSV/report support is retained for compatibility with
 * task-1099 style inputs, while the default command path now reads the
 * workflow-owned integration CSV.
 */
/**
 * @param {string} line
 */
function parseCsvLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];
        if (ch === '"') {
            if (inQuotes && line[i + 1] === '"') {
                current += '"';
                i += 1;
            }
            else {
                inQuotes = !inQuotes;
            }
        }
        else if (ch === ',' && !inQuotes) {
            result.push(current.trim());
            current = '';
        }
        else {
            current += ch;
        }
    }
    result.push(current.trim());
    return result;
}
/**
 * @param {*} value
 */
function escapeCsvValue(value) {
    const stringValue = String(value ?? '');
    if (!/[",\n]/.test(stringValue)) {
        return stringValue;
    }
    return `"${stringValue.replace(/"/g, '""')}"`;
}
/**
 * @param {string} rootDir
 * @param {string} repoRelativePath
 */
function resolveRepoRelativePath(rootDir, repoRelativePath) {
    if (!repoRelativePath || typeof repoRelativePath !== 'string') {
        return null;
    }
    return path.isAbsolute(repoRelativePath)
        ? repoRelativePath
        : path.join(rootDir, repoRelativePath);
}
/**
 * Backwards-compatible resolver for configured stats CSV paths.
 * Respects `adapters.stats.path` from workflow.config.json and otherwise
 * resolves to the repo-root legacy import path. When PARALLIX_HOME is
 * initialized the effective parallix-owned path is via the storage resolver.
 */
/**
 * @param {string|StatsCsvPathOptions} options
 */
function resolveStatsCsvPath(options = {}) {
    if (typeof options === 'string') {
        return options;
    }
    const opts = options;
    const filePath = opts.filePath;
    if (filePath) {
        return filePath;
    }
    const rootDir = opts.rootDir || process.cwd();
    const config = opts.config || (0, product_config_js_1.loadEffectiveConfig)(rootDir);
    const configuredPath = config.adapters?.stats?.path;
    const repoPath = resolveRepoRelativePath(rootDir, configuredPath);
    if (repoPath && (opts.forWrite || fs.existsSync(repoPath))) {
        return repoPath;
    }
    return resolveRepoStatsCsvPath(rootDir);
}
/**
 * @param {string} filePath
 * @returns {CsvData}
 */
function loadCsv(filePath) {
    if (!fs.existsSync(filePath)) {
        return { headers: [], rows: [] };
    }
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n').filter(line => line.trim());
    if (lines.length === 0) {
        return { headers: [], rows: [] };
    }
    const headers = parseCsvLine(lines[0]);
    const rows = [];
    for (let i = 1; i < lines.length; i += 1) {
        const values = parseCsvLine(lines[i]);
        /** @type {Record<string, string>} */
        const row = {};
        headers.forEach((header, idx) => {
            row[header] = values[idx] || '';
        });
        rows.push(row);
    }
    return { headers, rows };
}
function loadStatsCsv(filePath = null, options = {}) {
    // Resolve effective path: explicit filePath > config > PARALLIX_HOME
    let effectivePath = filePath;
    if (!effectivePath) {
        effectivePath = resolveStatsPath({ rootDir: options.rootDir });
    }
    if (!fs.existsSync(effectivePath)) {
        return { headers: [...STATS_HEADERS], rows: [] };
    }
    const data = loadCsv(effectivePath);
    if (data.headers.length === 0) {
        return { headers: [...STATS_HEADERS], rows: [] };
    }
    return {
        headers: [...STATS_HEADERS],
        rows: data.rows.map((row) => normalizeStatsRow(row, { rootDir: options.rootDir })),
    };
}
/**
 * Map any row (legacy 5-column or full 21-column) to the full schema, defaulting
 * missing text columns to '' and numeric columns to '0'. `stage` defaults to
 * 'default' so legacy rows and integration rows share the (repo, mission, stage)
 * upsert key.
 */
function normalizeStatsRow(row = {}, options = {}) {
    const repo = String(row.repo || options.repo || resolveStatsRepoName(options.rootDir)).trim();
    return {
        date: row.date || '',
        repo,
        mission: row.mission || '',
        classification: row.classification || '',
        implementer: row.implementer || '',
        pr_fix_rounds: row.pr_fix_rounds || '0',
        provider: row.provider || '',
        model: row.model || '',
        implementer_agent: row.implementer_agent || '',
        reviewer_agent: row.reviewer_agent || '',
        stage: row.stage || 'default',
        input_tokens: row.input_tokens || '0',
        output_tokens: row.output_tokens || '0',
        cached_tokens: row.cached_tokens || '0',
        context_tokens: row.context_tokens || '0',
        tool_calls: row.tool_calls || '0',
        openai_usage_before: row.openai_usage_before || '0',
        openai_usage_after: row.openai_usage_after || '0',
        openai_usage_delta: row.openai_usage_delta || '0',
        duration_minutes: row.duration_minutes || '0',
        cost_usd: row.cost_usd || '0',
    };
}
/**
 * @param {string} filePath
 * @param {StatsRow[]} rows
 */
function saveStatsCsv(filePath, rows) {
    let effectivePath = filePath;
    if (!effectivePath) {
        effectivePath = resolveStatsPath({ ensureDir: true });
    }
    const lines = [STATS_HEADERS.join(',')];
    for (const row of rows) {
        lines.push(STATS_HEADERS.map(header => escapeCsvValue(row[header] || '')).join(','));
    }
    getStorage().writeFileAtomic(effectivePath, `${lines.join('\n')}\n`);
    return effectivePath;
}
/**
 * @param {string} dateStr
 */
function formatDate(dateStr) {
    if (!dateStr) {
        return '';
    }
    try {
        const date = new Date(dateStr);
        return date.toISOString().split('T')[0];
    }
    catch ( /** @type{any} */_err) {
        return dateStr;
    }
}
/**
 * @param {*} value
 */
function parseBooleanish(value) {
    if (typeof value === 'boolean') {
        return value;
    }
    if (value === null || value === undefined) {
        return null;
    }
    const normalized = String(value).trim().toLowerCase();
    if (!normalized || normalized === '—' || normalized === 'n/a') {
        return null;
    }
    if (['yes', 'true', '1', 'y', 'merged', 'closed'].includes(normalized)) {
        return true;
    }
    if (['no', 'false', '0', 'n', 'open'].includes(normalized)) {
        return false;
    }
    return null;
}
/**
 * @param {StatsRow} row
 */
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
function normalizeRows(rows) {
    return rows.map(normalizeRow);
}
/**
 * @param {StatsRow} row
 */
function statsMissionKey(row) {
    return `${String(row.repo || '').trim()}::${String(row.mission || '').trim().toLowerCase()}`;
}
/**
 * @param {StatsRow[]} rows
 * @param {string} field
 */
function groupBy(rows, field) {
    /** @type {Record<string, StatsRow[]>} */
    const groups = {};
    for (const row of rows) {
        const key = String(row[field] || 'unknown');
        if (!groups[key]) {
            groups[key] = [];
        }
        groups[key].push(row);
    }
    return groups;
}
/**
 * @param {StatsRow[]} group
 */
function computeImplStats(group) {
    const total = group.length;
    const merged = group.filter(row => row.isMerged).length;
    const totalReviews = group.reduce((sum, row) => sum + (Number.parseInt(String(row.review_count || ''), 10) || 0), 0);
    const avgReviews = total > 0 ? (totalReviews / total).toFixed(2) : '0.00';
    const reviewRounds = group.reduce((sum, row) => sum + Math.max(1, Number.parseInt(String(row.review_count || ''), 10) || 0), 0);
    const avgRounds = total > 0 ? (reviewRounds / total).toFixed(2) : '0.00';
    return { total, merged, totalReviews, avgReviews, reviewRounds, avgRounds };
}
/**
 * @param {StatsRow[]} group
 */
function computePeriodStats(group) {
    const dates = group.map(row => formatDate(String(row.normalizedDate))).filter(Boolean);
    if (dates.length === 0) {
        return null;
    }
    const sorted = dates.sort();
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
/**
 * @param {{headers: string[], rows: StatsRow[]}} data
 * @param {StatsOptions} options
 */
function generateMarkdownReport(data, options = {}) {
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
        lines.push(`| ${ /** @type {any} */(row).mission} | ${ /** @type {any} */(row).implementer} | ${ /** @type {any} */(row).reviewer} | ${row.review_count} | ${row.normalizedMerged} | ${formatDate(String(row.normalizedDate))} |`);
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
    }
    else if (groupByField === 'period') {
        const groups = {};
        for (const row of rows) {
            const date = formatDate(String(row.normalizedDate));
            if (!date) {
                continue;
            }
            const month = date.substring(0, 7);
            if (!(groups)[month]) { /** @type {any} */
                (groups)[month] = [];
            }
            /** @type {any} */ (groups)[month].push(row);
        }
        lines.push('## By Period (Month)\n');
        lines.push('| Period | Days | PRs | Merged | Open | Total Reviews | Avg Reviews/PR |');
        lines.push('|--------|------|-----|--------|------|---------------|----------------|');
        for (const month of Object.keys(groups).sort()) {
            const period = computePeriodStats(/** @type{StatsRow[]} */ ( /** @type {any} */(groups)[month]));
            if (period) {
                lines.push(`| ${period.period} | ${period.days} | ${period.total} | ${period.merged} | ${period.open} | ${period.totalReviews} | ${period.avgReviews} |`);
            }
        }
        lines.push('');
    }
    else if (groupByField === 'merged') {
        const mergedRows = rows.filter(row => row.isMerged);
        const unmergedRows = rows.filter(row => !row.isMerged);
        lines.push('## Merged vs Unmerged\n');
        lines.push('### Merged PRs\n');
        if (mergedRows.length > 0) {
            lines.push('| Mission | Implementer | Reviews | Reviewer | Created |');
            lines.push('|---------|-------------|---------|----------|---------|');
            for (const row of mergedRows.sort((a, b) => String(a.normalizedDate || '').localeCompare(String(b.normalizedDate || '')))) {
                lines.push(`| ${ /** @type {any} */(row).mission} | ${ /** @type {any} */(row).implementer} | ${row.review_count} | ${ /** @type {any} */(row).reviewer} | ${formatDate(String(row.normalizedDate))} |`);
            }
        }
        else {
            lines.push('None.');
        }
        lines.push('');
        lines.push('### Unmerged/Closed PRs\n');
        if (unmergedRows.length > 0) {
            lines.push('|---------|-------------|---------|----------|---------|');
            for (const row of unmergedRows.sort((a, b) => String(a.normalizedDate || '').localeCompare(String(b.normalizedDate || '')))) {
                lines.push(`| ${ /** @type {any} */(row).mission} | ${ /** @type {any} */(row).implementer} | ${row.review_count} | ${ /** @type {any} */(row).reviewer} | ${formatDate(String(row.normalizedDate))} |`);
            }
        }
        else {
            lines.push('None.');
        }
        lines.push('');
    }
    lines.push('## Raw Data\n');
    lines.push('```csv');
    lines.push(data.headers.join(','));
    for (const row of rows) {
        lines.push(data.headers.map(header => /** @type{any} */ (row)[header] || '').join(','));
    }
    lines.push('```\n');
    return lines.join('\n');
}
/**
 * @param {*} value
 */
function isValidClassification(value) {
    return VALID_CLASSIFICATIONS.has(String(value || '').trim().toLowerCase());
}
/**
 * @param {*} value
 */
function normalizeClassification(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return isValidClassification(normalized) ? normalized : null;
}
/**
 * @param {*} value
 */
function normalizeImplementer(value) {
    return String(value || '').trim().replace(/^@/, '').toLowerCase() || null;
}
/**
 * @param {StatsRow} row
 */
function statsRowActorKey(row = {}) {
    const stage = String(row.stage || 'default').trim().toLowerCase() || 'default';
    if (stage === 'review') {
        return normalizeImplementer(row.reviewer_agent || row.implementer_agent || row.implementer || '') || '';
    }
    return normalizeImplementer(row.implementer_agent || row.implementer || '') || '';
}
/**
 * @param {string} value
 */
function parseDateOnly(value) {
    return new Date(`${value}T00:00:00Z`);
}
/**
 * @param {string} value
 * @param {string} flagName
 */
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
function formatDateOnly(date) {
    return date.toISOString().slice(0, 10);
}
/**
 * @param {Date} date
 * @param {number} days
 */
function addDays(date, days) {
    const next = new Date(date.getTime());
    next.setUTCDate(next.getUTCDate() + days);
    return next;
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
function createWindow(endDate, days) {
    const end = parseToday(endDate);
    const start = addDays(end, -(days - 1));
    return {
        start,
        end,
        label: `${formatDateOnly(start)} → ${formatDateOnly(end)}`,
    };
}
/**
 * @param {{from?: string, to?: string}} range
 */
function createRangeWindow(range = {}) {
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
    const current = createWindow(today, 7);
    const previous = createWindow(addDays(current.start, -1), 7);
    return { current, previous };
}
/**
 * @param {StatsRow} row
 * @param {{start: Date, end: Date}} window
 */
function rowInWindow(row, window) {
    if (!row.date) {
        return false;
    }
    const date = parseDateOnly(String(row.date));
    return date >= window.start && date <= window.end;
}
/**
 * @param {StatsRow[]} rows
 * @param {{start: Date, end: Date}} window
 */
function summarizeMissionWindow(rows, window) {
    const windowRows = rows.filter(row => rowInWindow(row, window));
    // Deduplicate by mission so multi-stage telemetry rows don't inflate counts.
    // One row per unique repo+mission pair is kept (first occurrence is sufficient
    // since classification is stable across stages for the same mission in a repo).
    const seenMissions = new Set();
    const uniqueMissions = windowRows.filter(row => {
        const key = statsMissionKey(row);
        if (seenMissions.has(key)) {
            return false;
        }
        seenMissions.add(key);
        return true;
    });
    const userValue = uniqueMissions.filter(row => normalizeClassification(row.classification) === 'user_value').length;
    const aiSdlc = uniqueMissions.filter(row => normalizeClassification(row.classification) === 'ai_sdlc').length;
    const unknown = uniqueMissions.filter(row => normalizeClassification(row.classification) === 'unknown').length;
    const validMissions = uniqueMissions.filter(row => normalizeClassification(row.classification) !== null);
    return {
        rows: windowRows,
        total: validMissions.length,
        userValue,
        aiSdlc,
        unknown,
    };
}
/**
 * Re-derive a mission's fix-round count from COMPLETE local ground truth — the
 * mission-local review event store — for use as a render-time override of a
 * stale/zero stored value. We deliberately use ONLY the event store here, not
 * branch-history: the event store is self-contained per mission directory, so a
 * non-null result is trustworthy. Branch-history derivation depends on
 * `review-state.json` being present in this checkout, which is not guaranteed for
 * arbitrary other missions during a cross-mission report and could yield a
 * misleading 0 — so we never let it override a stored value. Returns null when
 * the event store isn't available (different repo / not checked out), leaving the
 * caller on the stored value.
 */
/**
 * @param {string} slug
 * @param {string} rootDir
 * @param {string} repo
 */
function deriveFixRoundsLocalAuthoritative(slug, rootDir, repo) {
    if (!slug || !rootDir) {
        return null;
    }
    // Only derive for missions belonging to the current checkout's repo.
    if (repo && String(repo).trim() && String(repo).trim() !== resolveStatsRepoName(rootDir)) {
        return null;
    }
    const fromEvents = deriveFixRoundsFromReviewEvents(slug, rootDir);
    if (fromEvents && Number.isInteger(fromEvents.prFixRounds)) {
        return fromEvents.prFixRounds;
    }
    return null;
}
/**
 * @param {StatsRow[]} rows
 * @param {{start: Date, end: Date}} window
 * @param {{rootDir?: string|null, deriveFixRoundsFn?: Function}} [options]
 */
function summarizeAgentWindow(rows, window, options = {}) {
    /** @type {{rootDir?: string|null, deriveFixRoundsFn?: Function}} */
    const opts = options;
    const { rootDir = null, deriveFixRoundsFn = deriveFixRoundsLocalAuthoritative } = opts;
    const windowRows = rows.filter(row => rowInWindow(row, window));
    // Only count missions with a valid classification so the agent table totals
    // align with the mission-count table (which also excludes null/invalid
    // classifications via summarizeMissionWindow → validMissions).
    const validWindowRows = windowRows.filter(row => normalizeClassification(row.classification) !== null);
    // Deduplicate globally by (repo, mission) first so each mission is counted
    // exactly once across all agent groups — matching the mission-count table.
    // Prefer the row where model === implementer (the implementer's own model),
    // since the implementer field is the last implementer who closed the mission.
    // Among those, prefer the row with the highest fix rounds. Falls back to the
    // row with the highest fix rounds when no implementer-row exists.
    /** @type {Record<string, StatsRow>} */
    const byMission = {};
    for (const row of validWindowRows) {
        const key = statsMissionKey(row);
        const prev = byMission[key];
        const rounds = Number.parseInt(String(row.pr_fix_rounds), 10) || 0;
        const prevRounds = prev ? (Number.parseInt(String(prev.pr_fix_rounds), 10) || 0) : -1;
        const modelTrimmed = (row.model && String(row.model).trim()) || '';
        const implTrimmed = (row.implementer && String(row.implementer).trim()) || '';
        const isImplementerRow = modelTrimmed && implTrimmed && modelTrimmed.toLowerCase() === implTrimmed.toLowerCase();
        let prevIsImpl = false;
        if (prev) {
            const prevModelTrimmed = (prev.model && String(prev.model).trim()) || '';
            const prevImplTrimmed = (prev.implementer && String(prev.implementer).trim()) || '';
            prevIsImpl = prevModelTrimmed && prevImplTrimmed && prevModelTrimmed.toLowerCase() === prevImplTrimmed.toLowerCase();
        }
        if (!prev || (isImplementerRow && !prevIsImpl) || (isImplementerRow && prevIsImpl && rounds > prevRounds) || (!isImplementerRow && !prevIsImpl && rounds > prevRounds)) {
            byMission[key] = row;
        }
    }
    const uniqueMissions = Object.values(byMission);
    /** @type {Record<string, StatsRow[]>} */
    const groups = {};
    for (const row of uniqueMissions) {
        const displayKey = (row.model && String(row.model).trim()) || (row.implementer || 'unknown');
        if (!groups[displayKey]) {
            groups[displayKey] = [];
        }
        groups[displayKey].push(row);
    }
    // Build agent groups from the globally deduplicated missions.
    // For each mission, trust local ground truth (events/branch history) over
    // the stored value when available — this is what makes the report reflect
    // the review loop rather than the (untrusted) CSV. `pr_fix_rounds` is a
    // review-loop quantity, independent of whether the mission was integrated.
    const roundsFor = (/** @type {any} */ row) => {
        if (rootDir) {
            const authoritative = deriveFixRoundsFn(row.mission, rootDir, row.repo);
            if (authoritative !== null && authoritative !== undefined) {
                return Number.parseInt(authoritative, 10) || 0;
            }
        }
        return Number.parseInt(row.pr_fix_rounds, 10) || 0;
    };
    return Object.entries(groups)
        .map(([displayKey, group]) => {
        const totalRounds = group.reduce((sum, row) => sum + roundsFor(row), 0);
        return {
            implementer: displayKey,
            missions: group.length,
            averageFixRounds: group.length > 0 ? (totalRounds / group.length).toFixed(2) : '0.00',
        };
    })
        .sort((a, b) => a.implementer.localeCompare(b.implementer));
}
/**
 * @param {MissionStats[]} rows
 */
function colorAverageFixRounds(rows) {
    const values = rows
        .map(row => Number.parseFloat(row.averageFixRounds))
        .filter(value => Number.isFinite(value));
    if (values.length === 0) {
        return rows.map(row => row.averageFixRounds);
    }
    const best = Math.min(...values);
    const worst = Math.max(...values);
    return rows.map(row => {
        const value = Number.parseFloat(row.averageFixRounds);
        if (!Number.isFinite(value)) {
            return row.averageFixRounds;
        }
        if (best === worst) {
            return fmt.colorize(/** @type {import('node:util').InspectColor} */ (fmt.colors.green), row.averageFixRounds);
        }
        if (value === best) {
            return fmt.colorize(/** @type {import('node:util').InspectColor} */ (fmt.colors.green), row.averageFixRounds);
        }
        if (value === worst) {
            return fmt.colorize(/** @type {import('node:util').InspectColor} */ (fmt.colors.red), row.averageFixRounds);
        }
        return fmt.colorize(/** @type {import('node:util').InspectColor} */ (fmt.colors.yellow), row.averageFixRounds);
    });
}
/**
 * @param {MissionStats[]} rows
 */
function colorMissionCounts(rows) {
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
        if (!Number.isFinite(value)) {
            return String(row.missions);
        }
        if (best === worst) {
            return fmt.colorize(/** @type {import('node:util').InspectColor} */ (fmt.colors.green), String(row.missions));
        }
        if (value === best) {
            return fmt.colorize(/** @type {import('node:util').InspectColor} */ (fmt.colors.green), String(row.missions));
        }
        if (value === worst) {
            return fmt.colorize(/** @type {import('node:util').InspectColor} */ (fmt.colors.red), String(row.missions));
        }
        return fmt.colorize(/** @type {import('node:util').InspectColor} */ (fmt.colors.yellow), String(row.missions));
    });
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
 * @param {StatsRow[]} rows
 * @param {RenderWeeklyStatsReportOptions} options
 */
function renderWeeklyStatsReport(rows, options = {}) {
    const today = options.today || new Date();
    const rootDir = options.rootDir || null;
    const windows = buildWeeklyWindows(/** @type{Date} */ (typeof today === 'string' ? parseDateOnly(today) : today));
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
    lines.push(formatStatsTable(['# missions', '# user value missions', '# AI SDLC missions', '# unknown missions'], [[String(currentMissionStats.total), String(currentMissionStats.userValue), String(currentMissionStats.aiSdlc), String(currentMissionStats.unknown)]]));
    lines.push('');
    lines.push(fmt.bold(`Previous week (${windows.previous.label})`));
    lines.push(formatStatsTable(['# missions', '# user value missions', '# AI SDLC missions', '# unknown missions'], [[String(previousMissionStats.total), String(previousMissionStats.userValue), String(previousMissionStats.aiSdlc), String(previousMissionStats.unknown)]]));
    lines.push('');
    lines.push(fmt.bold(`Agent performance this week (${windows.current.label})`));
    lines.push(formatStatsTable(['Agent family', '# missions as implementer', 'Average PR fix rounds to complete mission'], currentAgentStats.length > 0
        ? currentAgentStats.map((row, index) => [row.implementer, currentMissionColors[index], currentAgentColors[index]])
        : [['none', '0', '0.00']]));
    lines.push('');
    lines.push(fmt.bold(`Agent performance previous week (${windows.previous.label})`));
    lines.push(formatStatsTable(['Agent family', '# missions as implementer', 'Average PR fix rounds to complete mission'], previousAgentStats.length > 0
        ? previousAgentStats.map((row, index) => [row.implementer, previousMissionColors[index], previousAgentColors[index]])
        : [['none', '0', '0.00']]));
    return lines.join('\n');
}
/**
 * @param {StatsRow[]} rows
 * @param {RenderRangeStatsReportOptions} options
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
    lines.push(formatStatsTable(['# missions', '# user value missions', '# AI SDLC missions', '# unknown missions'], [[String(missionStats.total), String(missionStats.userValue), String(missionStats.aiSdlc), String(missionStats.unknown)]]));
    lines.push('');
    lines.push(fmt.bold(`Agent performance (${window.label})`));
    lines.push(formatStatsTable(['Agent family', '# missions as implementer', 'Average PR fix rounds to complete mission'], agentStats.length > 0
        ? agentStats.map((row, index) => [row.implementer, missionColors[index], agentColors[index]])
        : [['none', '0', '0.00']]));
    return lines.join('\n');
}
// Maps the stored `stage` value to the phase label used in the mission report.
// The execute phase is persisted as stage `active` (the active-launch hook), but
// the mission contract and the backlog item both ask for an "execute" breakdown,
// so we surface it under that name. Canonical order is draft → execute → review,
// then any follow-up/extra stages discovered in the data.
const MISSION_PHASE_ORDER = [
    { stage: 'draft', label: 'draft' },
    { stage: 'active', label: 'execute' },
    { stage: 'review', label: 'review' },
    { stage: 'follow-up', label: 'follow-up' },
];
/**
 * Render a single-mission, per-phase telemetry breakdown. Rows are filtered to
 * the requested mission slug and indexed by their stored `stage`. The draft,
 * execute, and review phases are always printed (zeros when no row exists) so
 * the output is comparable across missions; any additional recorded stages
 * (e.g. follow-up, default) are appended in stable alphabetical order. Output is
 * a pure function of the supplied rows — re-running with the same stored rows
 * produces identical text.
 */
/**
 * @param {StatsRow[]} rows
 * @param {string} slug
 * @param {StatsOptions} options
 */
function renderMissionPhaseReport(rows, slug, options = {}) {
    const wanted = String(slug || '').trim().toLowerCase();
    /** @type {StatsOptions} */
    const opts = options;
    const wantedRepo = String(opts.repo || resolveStatsRepoName(opts.rootDir)).trim();
    const missionRows = (rows || []).filter(row => String(row.mission || '').trim().toLowerCase() === wanted &&
        String(row.repo || '').trim() === wantedRepo);
    const byStage = new Map();
    for (const row of missionRows) {
        const stage = String(row.stage || 'default').trim().toLowerCase() || 'default';
        if (!byStage.has(stage)) {
            byStage.set(stage, []);
        }
        byStage.get(stage).push(row);
    }
    for (const stageRows of byStage.values()) {
        stageRows.sort((/** @type{StatsRow} */ a, /** @type{StatsRow} */ b) => statsRowActorKey(a).localeCompare(statsRowActorKey(b))
            || String(a.provider || '').localeCompare(String(b.provider || ''))
            || String(a.model || '').localeCompare(String(b.model || '')));
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
        lines.push(formatStatsTable(['Phase', 'Provider', 'Model', 'Implementer', 'Input', 'Output', 'Cached', 'Tool calls', 'Duration (min)', 'Usage %', 'Cost ($)'], MISSION_PHASE_ORDER.map(entry => [entry.label, '—', '—', '—', '0', '0', '0', '0', '0', '—', '0'])));
        lines.push('');
        lines.push(`No telemetry rows recorded for mission "${wanted}".`);
        return lines.join('\n');
    }
    const num = (/** @type{StatsRow} */ row, /** @type{string} */ key) => String(Number.parseInt(String(row[key]), 10) || 0);
    // cost_usd is a fractional dollar value; parseInt would truncate (e.g.
    // 1.42 -> "1", 0.46 -> "0"), silently discarding sub-dollar costs. Format
    // as a rounded decimal, collapsing exact zeros to "0".
    const cost = (/** @type {string | number} */ value) => {
        const n = Number.parseFloat(String(value));
        if (!Number.isFinite(n) || n === 0) {
            return '0';
        }
        return String(Math.round(n * 100) / 100);
    };
    const tableRows = [];
    for (const { stage, label } of phases) {
        const stageRows = byStage.get(stage) || [];
        if (stageRows.length === 0) {
            tableRows.push([label, '—', '—', '—', '0', '0', '0', '0', '0', '—', '0']);
            continue;
        }
        for (const row of stageRows) {
            const actor = stage === 'review'
                ? (row.reviewer_agent || row.implementer_agent || row.implementer || '—')
                : (row.implementer_agent || row.implementer || '—');
            tableRows.push([
                label,
                row.provider || '—',
                row.model || '—',
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
                    if (actorLower === 'claude') {
                        return '—';
                    }
                    return (row.provider && row.provider.toLowerCase() === 'openai')
                        ? num(row, 'openai_usage_after')
                        : '—';
                })(),
                cost(row.cost_usd),
            ]);
        }
    }
    const totals = ['input_tokens', 'output_tokens', 'cached_tokens', 'tool_calls', 'duration_minutes']
        .map(key => missionRows.reduce((sum, row) => sum + (Number.parseInt(String(row[key]), 10) || 0), 0));
    // Compute total cost from rounded individual costs so the total equals
    // the sum of displayed phase costs (avoids floating-point rounding drift).
    const totalCost = tableRows
        .filter(r => r[0] !== 'total')
        .reduce((sum, r) => sum + (Number.parseFloat(cost(r[10])) || 0), 0);
    tableRows.push(['total', '', '', '', String(totals[0]), String(totals[1]), String(totals[2]), String(totals[3]), String(totals[4]), '—', cost(totalCost)]);
    lines.push(formatStatsTable(['Phase', 'Provider', 'Model', 'Implementer', 'Input', 'Output', 'Cached', 'Tool calls', 'Duration (min)', 'Usage %', 'Cost ($)'], tableRows));
    return lines.join('\n');
}
/**
 * @param {string} taskFilePath
 */
function deriveFixRoundsFromTaskText(taskFilePath) {
    if (!taskFilePath || !fs.existsSync(taskFilePath)) {
        return 0;
    }
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
function deriveFixRoundsFromReviewStateHistory(slug, finalImplementer, latestRound, rootDir = process.cwd()) {
    const normalizedImplementer = normalizeImplementer(finalImplementer);
    const round = Number.parseInt(latestRound, 10) || 1;
    if (!slug || !normalizedImplementer || round <= 1) {
        return 0;
    }
    const branch = `mission/${slug}`;
    const result = (0, git_js_1.git)(['-C', rootDir, 'log', '--reverse', '--format=%s', branch]);
    if (result.status !== 0) {
        return Math.max(0, round - 1);
    }
    let firstFinalImplementerRound = null;
    // review-state commit subjects are formatted as:
    //   review-state(<slug>): round N (<phase>) [<reviewer> -> <implementer>] ...
    // The implementer sits on the right of the `->`. Match the earliest reviewing
    // round whose implementer is the final implementer. (An older format placed the
    // implementer inside the phase parens, e.g. `(reviewing <impl>)`; accept both.)
    const esc = (/** @type{string} */ s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const reviewStatePattern = new RegExp(`^review-state\\(${esc(slug)}\\):\\s*round\\s+(\\d+)\\s+\\(reviewing[^)]*\\)\\s*\\[[^\\]]*->\\s*${esc(normalizedImplementer)}\\b`, 'i');
    const legacyPattern = new RegExp(`^review-state\\(${esc(slug)}\\):\\s*round\\s+(\\d+)\\s+\\([^)]*reviewing\\s+${esc(normalizedImplementer)}\\)`, 'i');
    for (const line of result.stdout.split('\n')) {
        const trimmed = line.trim();
        const match = trimmed.match(reviewStatePattern) || trimmed.match(legacyPattern);
        if (!match) {
            continue;
        }
        const candidateRound = Number.parseInt(match[1], 10);
        if (Number.isInteger(candidateRound) && candidateRound > 0) {
            firstFinalImplementerRound = candidateRound;
            break;
        }
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
function deriveFinalImplementerFromBranchHistory(slug, rootDir = process.cwd()) {
    if (!slug) {
        return null;
    }
    const branches = [`mission/${slug}`, `origin/mission/${slug}`];
    for (const branch of branches) {
        const result = (0, git_js_1.git)(['-C', rootDir, 'log', '--format=%s', branch]);
        if (result.status !== 0) {
            continue;
        }
        const activeImplementerPattern = new RegExp(`^backlog\\(${slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\):\\s*transition to active and implementer=([^\\s)]+)`, 'i');
        for (const line of result.stdout.split('\n')) {
            const match = line.trim().match(activeImplementerPattern);
            if (!match) {
                continue;
            }
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
function deriveImplementerAndFixRoundsFromPrComments(slug, rootDir = process.cwd()) {
    if (!slug) {
        return null;
    }
    // Only attempt Forgejo PR comment lookup when Forgejo review is enabled
    if (!(0, product_config_js_1.isForgejoReviewEnabled)(rootDir)) {
        return null;
    }
    // forgejo already imported at top
    const token = forgejo.readToken(/** @type{string} */ (forgejo.resolveForgejoUser()));
    if (!token) {
        return null;
    }
    const comments = forgejo.getCommentsSync(`mission/${slug}`, token);
    if (!Array.isArray(comments) || comments.length === 0) {
        return null;
    }
    const resolutionPattern = /^(?:#|##|###)\s*(?:Review\s+(?:Round|Attempt)\s+\d+\s+Resolution\b|Review\s+Follow-up\s+Resolution\b|Round\s+\d+\s+Resolution(?:\s+Summary)?\b|Round\s+resolution\b|Task-\d+\s+[—-]\s+Act-on-Review Round Resolution\b)/i;
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
 * Derive the final implementer and fix-round count from the mission-local review
 * event store (`missions/<slug>/review-events/*.md`). This is the most reliable
 * LOCAL source of review-loop ground truth: each round records a
 * `reviewer_outcome` (with a verdict) and, when the implementer responds, an
 * `implementer_disposition`/`implementer_round_summary` authored by the
 * implementer.
 *
 * A "fix round" is a round in which the reviewer returned `request-changes` and
 * the FINAL implementer was the one resolving it (so a mid-mission implementer
 * handoff only counts rounds owned by the agent who finished the mission).
 *
 * Returns `{ implementer, prFixRounds, source: 'review-events' }` or null when no
 * usable round events exist.
 */
/**
 * @param {string} slug
 * @param {string} [rootDir]
 */
function deriveFixRoundsFromReviewEvents(slug, rootDir = process.cwd()) {
    if (!slug) {
        return null;
    }
    let events;
    try {
        // Guard against reading (and, as a side effect, creating) an events dir that
        // doesn't exist yet — this runs on every active-stage recording.
        // findMissionDir already imported at top
        const missionDir = (0, mission_utils_js_1.findMissionDir)(slug, rootDir);
        if (!missionDir || !fs.existsSync(path.join(missionDir, 'review-events'))) {
            return null;
        }
        events = reviewEvents.readAllEvents(slug, /** @type{any} */ ({ rootDir, log: () => { }, error: () => { } }));
    }
    catch ( /** @type{any} */_err) {
        return null;
    }
    if (!Array.isArray(events) || events.length === 0) {
        return null;
    }
    // Collapse events into per-round facts: did the reviewer request changes, and
    // which implementer OWNED the round. A round can contain a mid-round handoff
    // (multiple implementer dispositions by different agents); the agent who
    // actually resolved the round is the one with the LATEST disposition, so we
    // track timestamps and keep the most recent — never just the last one iterated
    // (event order is not guaranteed and `readAllEvents` is newest-first).
    const rounds = new Map();
    for (const event of events) {
        const round = Number.parseInt(event.round, 10);
        if (!Number.isInteger(round) || round <= 0) {
            continue;
        }
        if (!rounds.has(round)) {
            rounds.set(round, { requestedChanges: false, implementer: null, implementerTs: '' });
        }
        const entry = rounds.get(round);
        if (event.event_type === reviewEvents.VALID_EVENT_TYPES.REVIEWER_OUTCOME
            && String(event.verdict || '').toLowerCase() === 'request-changes') {
            entry.requestedChanges = true;
        }
        if (event.event_type === reviewEvents.VALID_EVENT_TYPES.IMPLEMENTER_DISPOSITION
            || event.event_type === reviewEvents.VALID_EVENT_TYPES.IMPLEMENTER_ROUND_SUMMARY) {
            const impl = normalizeImplementer(event.actor);
            const ts = String(event.timestamp || '');
            if (impl && (entry.implementer === null || ts >= entry.implementerTs)) {
                entry.implementer = impl;
                entry.implementerTs = ts;
            }
        }
    }
    if (rounds.size === 0) {
        return null;
    }
    // Final implementer = implementer of the highest-numbered round that names one.
    let finalImplementer = null;
    for (const round of [...rounds.keys()].sort((a, b) => b - a)) {
        const impl = rounds.get(round).implementer;
        if (impl) {
            finalImplementer = impl;
            break;
        }
    }
    // Count request-changes rounds owned by the final implementer (or all such
    // rounds when no implementer could be attributed).
    let prFixRounds = 0;
    for (const [, entry] of rounds) {
        if (!entry.requestedChanges) {
            continue;
        }
        if (!finalImplementer || !entry.implementer || entry.implementer === finalImplementer) {
            prFixRounds += 1;
        }
    }
    return { implementer: finalImplementer, prFixRounds, source: 'review-events' };
}
/**
 * @param {string} slug
 * @param {string} [rootDir]
 */
function deriveImplementerAndFixRounds(slug, rootDir = process.cwd()) {
    const reviewState = (0, review_state_js_1.readReviewState)(slug, rootDir);
    // Prefer the mission-local review event store — the most reliable local record
    // of review-loop ground truth — over the network (Forgejo) and over fragile
    // commit-subject/text heuristics. Fall back to branch-history for the final
    // implementer when the events record rounds but not an implementer.
    const eventImplementer = deriveFixRoundsFromReviewEvents(slug, rootDir);
    if (eventImplementer && Number.isInteger(eventImplementer.prFixRounds)) {
        const implementer = eventImplementer.implementer
            || deriveFinalImplementerFromBranchHistory(slug, rootDir)
            || (reviewState?.implementer ? normalizeImplementer(reviewState.implementer) : null);
        if (implementer) {
            return { implementer, prFixRounds: eventImplementer.prFixRounds, source: 'review-events' };
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
            prFixRounds: deriveFixRoundsFromReviewStateHistory(slug, historyImplementer, String(/** @type {any} */ (reviewState)?.round ?? ''), rootDir),
            source: 'branch-history',
        };
    }
    if (reviewState?.implementer) {
        const implementer = normalizeImplementer(reviewState.implementer);
        return {
            implementer,
            // @ts-expect-error reviewState.round may be null
            prFixRounds: deriveFixRoundsFromReviewStateHistory(slug, implementer, String(/** @type {any} */ (reviewState)?.round ?? '') || '', rootDir),
            source: 'review-state',
        };
    }
    const resolution = (0, backlog_js_1.resolveTaskFile)(slug, rootDir);
    if (resolution.ok) {
        // @ts-expect-error resolution.taskFile may be undefined
        const implementer = normalizeImplementer((0, backlog_js_1.getTaskImplementer)(resolution.taskFile) || (0, backlog_js_1.getTaskAssignee)(resolution.taskFile) || '');
        if (implementer) {
            return {
                implementer,
                // @ts-expect-error resolution.taskFile may be undefined
                prFixRounds: deriveFixRoundsFromTaskText(resolution.taskFile),
                source: 'backlog-fallback',
            };
        }
    }
    return {
        implementer: 'unknown',
        prFixRounds: 0,
        source: 'unknown-fallback',
    };
}
/**
 * @param {string} slug
 * @param {string} [rootDir]
 */
function resolveMissionClassification(slug, rootDir = process.cwd()) {
    const resolution = (0, backlog_js_1.resolveTaskFile)(slug, rootDir);
    if (!resolution.ok) {
        return {
            classification: null,
            taskFile: null,
            error: `Could not resolve backlog task for ${slug}.`,
        };
    }
    // @ts-expect-error resolution.taskFile may be undefined
    const classification = normalizeClassification((0, backlog_js_1.getTaskClassification)(resolution.taskFile) || '');
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
function canonicalizeStatsRow(row, options = {}) {
    const normalized = normalizeStatsRow(row, options);
    /** @type {StatsRow} */
    const canonical = {
        ...normalized,
        date: formatDateOnly(parseToday(String(row.date))),
        repo: String(normalized.repo || resolveStatsRepoName(options.rootDir)).trim(),
        mission: String(row.mission).trim().toLowerCase(),
        classification: /** @type{string|number|boolean|undefined} */ (normalizeClassification(row.classification)),
        implementer: /** @type{string|number|boolean|undefined} */ (normalizeImplementer(row.implementer)),
        stage: String(row.stage || '').trim().toLowerCase() || 'default',
    };
    for (const key of USAGE_NUMBERS) {
        canonical[key] = String(Math.max(0, Number.parseInt(String(/** @type{any} */ (normalized)[key]), 10) || 0));
    }
    return canonical;
}
/**
 * @param {StatsRow} a
 * @param {StatsRow} b
 */
function rowsEqual(a, b) {
    return STATS_HEADERS.every(header => String(a[header] || '') === String(b[header] || ''));
}
/**
 * @param {StatsRow} row
 * @param {UpsertStatsRowOptions} options
 */
// @ts-expect-error JSDoc param types for options
function upsertStatsRow(row, options = {}) {
    /** @type {UpsertStatsRowOptions} */
    const opts = options;
    const filePath = opts.filePath || resolveStatsPath({ ensureDir: true });
    const canonicalRow = canonicalizeStatsRow(row, /** @type {any} */ ({ rootDir: opts.rootDir }));
    if (!canonicalRow.classification) {
        throw new Error(`Invalid classification for ${canonicalRow.mission}.`);
    }
    if (!canonicalRow.implementer) {
        throw new Error(`Invalid implementer for ${canonicalRow.mission}.`);
    }
    const data = loadStatsCsv(filePath, { rootDir: opts.rootDir });
    const existingIndex = data.rows.findIndex(existing => existing.repo === canonicalRow.repo &&
        existing.mission === canonicalRow.mission &&
        (existing.stage || 'default') === canonicalRow.stage &&
        statsRowActorKey(existing) === statsRowActorKey(canonicalRow));
    let changed = false;
    if (existingIndex === -1) {
        // @ts-expect-error canonicalRow type mismatch
        data.rows.push(canonicalRow);
        changed = true;
    }
    else if (!rowsEqual(data.rows[existingIndex], canonicalRow)) {
        // @ts-expect-error canonicalRow type mismatch
        data.rows[existingIndex] = canonicalRow;
        changed = true;
    }
    data.rows.sort((a, b) => String(a.date).localeCompare(String(b.date)) ||
        String(a.repo || '').localeCompare(String(b.repo || '')) ||
        String(a.mission).localeCompare(String(b.mission)) ||
        String(a.stage || 'default').localeCompare(String(b.stage || 'default')));
    if (changed) {
        saveStatsCsv(filePath, data.rows);
    }
    return { changed, row: canonicalRow, data };
}
/**
 * @param {RecordIntegrationStatsOptions} options
 */
// @ts-expect-error recordIntegrationStats options missing slug
// @ts-expect-error
function recordIntegrationStats(options = {}) {
    /** @type {RecordIntegrationStatsOptions} */
    const opts = options;
    const { slug, rootDir = process.cwd(), filePath = resolveStatsPath({ rootDir, forWrite: true }), date = formatDateOnly(new Date()) } = opts;
    if (!slug) {
        throw new Error('recordIntegrationStats requires a mission slug.');
    }
    const resolution = resolveMissionClassification(slug, rootDir);
    if (!resolution.classification) {
        throw new Error(`Cannot record integration stats for ${slug}: ${resolution.error || 'missing classification'}`);
    }
    const { classification } = resolution;
    const implementerInfo = deriveImplementerAndFixRounds(slug, rootDir);
    const result = upsertStatsRow({
        date,
        mission: slug,
        classification,
        implementer: implementerInfo.implementer,
        pr_fix_rounds: implementerInfo.prFixRounds,
    }, { filePath, rootDir });
    return {
        ...result,
        report: renderWeeklyStatsReport(result.data.rows, { today: date, rootDir }),
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
// @ts-expect-error telemetryToStatsFields options missing agentFamily
// @ts-expect-error JSDoc param types for options
function telemetryToStatsFields(telemetry, options = {}) {
    const { agentFamily, durationMinutes = 0, model } = options;
    const t = telemetry || null;
    const usageAfter = t && typeof t.usagePercent === 'number' ? Math.round(t.usagePercent) : 0;
    return {
        provider: (t && t.provider) || model || agentFamily || '',
        model: (t && t.model) || model || agentFamily || '',
        input_tokens: String((t && t.inputTokens) || 0),
        output_tokens: String((t && t.outputTokens) || 0),
        cached_tokens: String((t && t.cachedTokens) || 0),
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
function sameStatsIdentity(a, b) {
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
function accumulateIntegerStrings(existing, incoming, options = {}) {
    /** @type {AccModeOptions} */
    const opts = options;
    const current = Number.parseInt(existing, 10) || 0;
    const next = Number.parseInt(incoming, 10) || 0;
    if (opts.mode === 'max') {
        return String(Math.max(current, next));
    }
    if (opts.mode === 'replace') {
        return String(next);
    }
    return String(current + next);
}
/**
 * @param {string} existing
 * @param {string} incoming
 */
function accumulateDecimalStrings(existing, incoming) {
    const current = Number.parseFloat(existing) || 0;
    const next = Number.parseFloat(incoming) || 0;
    return String(current + next);
}
/**
 * @param {string} existing
 * @param {string} incoming
 */
function mergeLabel(existing, incoming) {
    const a = String(existing || '').trim();
    const b = String(incoming || '').trim();
    if (!a) {
        return b;
    }
    if (!b) {
        return a;
    }
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
function recordStageStats(options = {}) {
    /** @type {any} */
    const opts = options;
    const { slug, stage, rootDir = process.cwd(), filePath = resolveStatsPath({ rootDir, forWrite: true }), date = formatDateOnly(new Date()), implementer, reviewer = '', prFixRounds = '0', telemetry = null, durationMinutes = 0, model = null } = opts;
    if (!slug) {
        throw new Error('recordStageStats requires a mission slug.');
    }
    if (!stage) {
        throw new Error('recordStageStats requires a stage.');
    }
    const { classification, error: classificationError } = resolveMissionClassification(slug, rootDir);
    if (!classification) {
        throw new Error(`Cannot record stage stats for ${slug}: ${classificationError || 'missing classification'}`);
    }
    const agentFamily = implementer || reviewer || 'unknown';
    return upsertStatsRow({
        date,
        mission: slug,
        classification,
        implementer: agentFamily,
        pr_fix_rounds: prFixRounds ?? '0',
        implementer_agent: implementer || '',
        reviewer_agent: reviewer || '',
        stage,
        ...telemetryToStatsFields(telemetry, { agentFamily, durationMinutes, model }),
    }, { filePath, rootDir });
}
/**
 * @param {{slug: string, stage: string, rootDir?: string, filePath?: string, date?: string, implementer?: string, reviewer?: string, prFixRounds?: string, telemetry?: {provider?: string, model?: string, inputTokens?: number, outputTokens?: number, cachedTokens?: number, totalTokens?: number, toolCalls?: number, usagePercent?: number, cost_usd?: number} | null, durationMinutes?: number, model?: string}} options
 */
function accumulateStageStats(options) {
    const { slug, stage, rootDir = process.cwd(), filePath = resolveStatsPath({ rootDir, forWrite: true }), date = formatDateOnly(new Date()), implementer, reviewer = '', prFixRounds = '0', telemetry = null, durationMinutes = 0, model = null } = options;
    if (!slug) {
        throw new Error('accumulateStageStats requires a mission slug.');
    }
    if (!stage) {
        throw new Error('accumulateStageStats requires a stage.');
    }
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
        pr_fix_rounds: prFixRounds ?? '0',
        implementer_agent: implementer || '',
        reviewer_agent: reviewer || '',
        stage,
        ...telemetryToStatsFields(telemetry, { agentFamily, durationMinutes, model: model || undefined }),
    }, { rootDir });
    const data = loadStatsCsv(filePath, { rootDir });
    const existing = data.rows.find(row => sameStatsIdentity(row, incomingRow));
    if (!existing) {
        return upsertStatsRow(incomingRow, { filePath, rootDir });
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
        context_tokens: accumulateIntegerStrings(String(existing.context_tokens), String(incomingRow.context_tokens)),
        tool_calls: accumulateIntegerStrings(String(existing.tool_calls), String(incomingRow.tool_calls)),
        openai_usage_before: accumulateIntegerStrings(String(existing.openai_usage_before), String(incomingRow.openai_usage_before), { mode: 'replace' }),
        openai_usage_after: accumulateIntegerStrings(String(existing.openai_usage_after), String(incomingRow.openai_usage_after), { mode: 'max' }),
        openai_usage_delta: accumulateIntegerStrings(String(existing.openai_usage_delta), String(incomingRow.openai_usage_delta)),
        duration_minutes: accumulateIntegerStrings(String(existing.duration_minutes), String(incomingRow.duration_minutes)),
        cost_usd: accumulateDecimalStrings(String(existing.cost_usd), String(incomingRow.cost_usd)),
    };
    return upsertStatsRow(mergedRow, { filePath, rootDir });
}
/**
 * Default the per-mission fix-round count from the mission-local review event
 * store when the caller didn't supply one. Fix rounds are a property of the
 * mission/implementer (NOT of integration), so we stamp the running count of
 * request-changes rounds onto the implementer-attributed stage rows as the loop
 * progresses; the final round's row then carries the true count even if the
 * mission is never integrated. The weekly summary reads it back per mission.
 */
/**
 * @param {string} slug
 * @param {string} rootDir
 * @param {string|null|undefined} provided
 */
function defaultPrFixRounds(slug, rootDir, provided) {
    if (provided !== undefined && provided !== null) {
        return provided;
    }
    if (!slug) {
        return '0';
    }
    const derived = deriveFixRoundsFromReviewEvents(slug, rootDir);
    return derived ? String(derived.prFixRounds) : '0';
}
/**
 * @param {RecordActiveStatsOptions} options
 */
// @ts-expect-error recordActiveStats options missing slug
function recordActiveStats(options = {}) {
    /** @type {any} */
    const opts = options;
    const { stage = 'active', slug, rootDir = process.cwd(), prFixRounds, model, ...rest } = opts;
    return recordStageStats({
        stage, slug, rootDir, model,
        prFixRounds: defaultPrFixRounds(slug, rootDir, prFixRounds),
        ...rest,
    });
}
/**
 * @param {RecordReviewStatsOptions} options
 */
// @ts-expect-error recordReviewStats options missing slug
function recordReviewStats(options = {}) {
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
        prFixRounds: defaultPrFixRounds(slug, rootDir, prFixRounds),
        ...rest,
    });
}
/**
 * @param {CsvData} data
 */
function isIntegrationStatsDataset(data) {
    return LEGACY_HEADERS.every(header => data.headers.includes(header));
}
/**
 * @param {Function} [log]
 */
function printStatsUsage(log = fmt.log.plain) {
    log(`Usage: px stats [<csv_file>|--csv-file <path>] [--today YYYY-MM-DD] [--from YYYY-MM-DD --to YYYY-MM-DD] [--output <file>] [--group-by implementer|period|merged]

Examples:
  px stats
  px stats --today 2026-05-18
  px stats --from 2026-05-01 --to 2026-05-31
  px stats --csv-file stats.csv --today 2026-05-18
  px stats --csv-file stats.csv --from 2026-05-01 --to 2026-05-31 --output /tmp/workflow-stats.txt
  px stats legacy-report.csv --group-by period --output retrospective.md
  px stats task-1285
  px stats --mission task-1285

Notes:
  - Pass a mission slug (e.g. task-1285) or --mission <slug> to print a single
    mission broken down by phase (draft, execute, review, follow-up).
  - With no CSV path, the command reads <PARALLIX_HOME>/stats.csv.
  - Legacy repo-root stats.csv rows are imported when that file is present in the checkout.
  - Workflow-owned stats CSVs print the current/previous-week summary tables by default.
  - Use --from and --to together to print one inclusive arbitrary-range report for workflow-owned stats CSVs.
  - Legacy retrospective CSVs still render the markdown report.`);
}
/**
 * @param {string[]} args
 * @param {StatsCmdOptions} options
 */
function stats(args, options = {}) {
    /** @type {StatsCmdOptions} */
    const opts = options;
    const log = opts.log || fmt.log.plain;
    const error = opts.error || fmt.log.plainError;
    const exit = opts.exit || process.exit;
    const rootDir = opts.rootDir || process.cwd();
    if (args.includes('--help') || args.includes('-h')) {
        printStatsUsage(log);
        return;
    }
    const positionalArgs = [];
    let inputFile = null;
    let groupByField = 'implementer';
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
        if (arg === '--group-by' && i + 1 < args.length) {
            groupByField = args[i + 1];
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
        if (arg === '--csv-file' && i + 1 < args.length) {
            inputFile = args[i + 1];
            i += 1;
            continue;
        }
        if (!arg.startsWith('--')) {
            positionalArgs.push(arg);
        }
    }
    // A positional arg that is not an existing file but looks like a Backlog
    // mission slug (e.g. `task-1285`) is treated as a mission filter, not a CSV
    // path. Existing CSV paths still route to file mode, so this is back-compatible.
    const MISSION_SLUG_RE = /^[a-z][a-z0-9]*-\d+$/i;
    if (!mission && positionalArgs.length > 0
        && !fs.existsSync(positionalArgs[0])
        && MISSION_SLUG_RE.test(positionalArgs[0])) {
        mission = positionalArgs[0];
        positionalArgs.length = 0;
    }
    if (positionalArgs.length > 0) {
        inputFile = positionalArgs[0];
    }
    if (!inputFile) {
        inputFile = resolveStatsPath({ rootDir });
    }
    // Mission-phase breakdown: read the workflow stats CSV (or the explicit
    // --csv-file override) and render one mission grouped by phase.
    if (mission) {
        const statsPath = positionalArgs.length > 0 || args.includes('--csv-file')
            ? inputFile
            : resolveStatsPath({ rootDir });
        const rows = fs.existsSync(statsPath) ? loadStatsCsv(statsPath, { rootDir }).rows : [];
        const report = renderMissionPhaseReport(rows, mission, { rootDir });
        if (outputFile) {
            fs.writeFileSync(outputFile, `${report}\n`, 'utf8');
            log(fmt.status('PASS', `Report written to ${outputFile}`));
        }
        else {
            log(report);
        }
        return;
    }
    if (!fs.existsSync(inputFile)) {
        error(fmt.status('FAIL', `CSV file not found: ${inputFile}`));
        exit(1);
        return;
    }
    log(fmt.status('INFO', `Loading CSV: ${inputFile}`));
    const data = loadCsv(inputFile);
    log(fmt.status('INFO', `Loaded ${data.rows.length} rows with headers: ${data.headers.join(', ')}`));
    let report;
    try {
        if (isIntegrationStatsDataset(data)) {
            const rows = loadStatsCsv(inputFile, { rootDir }).rows;
            report = from !== null || to !== null
                ? renderRangeStatsReport(rows, { from: from || undefined, to: to || undefined, rootDir })
                : renderWeeklyStatsReport(rows, { today, rootDir });
        }
        else {
            report = generateMarkdownReport(data, { groupBy: groupByField });
        }
    }
    catch (err) {
        error(fmt.status('FAIL', err.message));
        exit(1);
        return;
    }
    if (outputFile) {
        fs.writeFileSync(outputFile, `${report}\n`, 'utf8');
        log(fmt.status('PASS', `Report written to ${outputFile}`));
    }
    else {
        log(report);
    }
}
stats.STATS_HEADERS = STATS_HEADERS;
stats.STATS_CSV_PATH = resolveRepoStatsCsvPath();
stats.LEGACY_STATS_CSV_PATH = resolveRepoStatsCsvPath();
stats.resolveRepoStatsCsvPath = resolveRepoStatsCsvPath;
stats.resolveStatsRepoName = resolveStatsRepoName;
stats.resolveStatsFilePath = resolveStatsFilePath;
stats.resolveStatsCsvPath = resolveStatsCsvPath;
stats.resolveStatsPath = resolveStatsPath;
stats.recordIntegrationStats = recordIntegrationStats;
stats.renderWeeklyStatsReport = renderWeeklyStatsReport;
stats.renderMissionPhaseReport = renderMissionPhaseReport;
stats.renderRangeStatsReport = renderRangeStatsReport;
stats.buildWeeklyWindows = buildWeeklyWindows;
stats.resolveMissionClassification = resolveMissionClassification;
stats.deriveImplementerAndFixRounds = deriveImplementerAndFixRounds;
stats.upsertStatsRow = upsertStatsRow;
stats.loadStatsCsv = loadStatsCsv;
stats.saveStatsCsv = saveStatsCsv;
stats.normalizeStatsRow = normalizeStatsRow;
stats.canonicalizeStatsRow = canonicalizeStatsRow;
stats.recordStageStats = recordStageStats;
stats.accumulateStageStats = accumulateStageStats;
stats.recordActiveStats = recordActiveStats;
stats.recordReviewStats = recordReviewStats;
stats.telemetryToStatsFields = telemetryToStatsFields;
stats.formatDateOnly = formatDateOnly;
stats.LEGACY_HEADERS = LEGACY_HEADERS;
stats.USAGE_NUMBERS = USAGE_NUMBERS;
stats._internals = {
    generateMarkdownReport,
    loadCsv,
    normalizeRow,
    normalizeRows,
    parseBooleanish,
    parseCsvLine,
    escapeCsvValue,
    normalizeClassification,
    canonicalizeStatsRow,
    parseDateOnlyStrict,
    createRangeWindow,
    deriveFixRoundsFromTaskText,
    deriveFixRoundsFromReviewStateHistory,
    deriveFixRoundsFromReviewEvents,
    deriveFinalImplementerFromBranchHistory,
    deriveImplementerAndFixRoundsFromPrComments,
    deriveImplementerAndFixRounds,
    summarizeAgentWindow,
    colorAverageFixRounds,
    colorMissionCounts,
    printStatsUsage,
};
module.exports = stats;
