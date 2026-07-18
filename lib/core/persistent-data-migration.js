"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports._internals = void 0;
exports.migrateStats = migrateStats;
exports.migrateAgentBlocklists = migrateAgentBlocklists;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const storage = __importStar(require("./storage.js"));
const node_module_1 = require("node:module");
const _require = (0, node_module_1.createRequire)(__filename);
/** Cached stats module — loaded lazily to break circular dependency with `../commands/stats.js`. */
let _stats = null;
/** Lazily load the stats module to break the circular dependency. */
function getStats() {
    if (!_stats) {
        _stats = _require('../commands/stats.js');
    }
    return _stats;
}
/** Resolve the canonical stats CSV headers. */
function getStatsHeaders() {
    return getStats().STATS_HEADERS;
}
const ESSENTIAL_STATS_COLUMNS = ['date', 'mission', 'classification', 'implementer', 'pr_fix_rounds'];
/**
 * Validate that a stats row has all essential columns populated.
 * Throws on the first missing column found.
 * @param row - Row object to validate
 * @param rowIndex - Zero-based row index (for error messages)
 * @param filePath - Source file path (for error messages)
 */
function validateStatsRow(row, rowIndex, filePath) {
    const missing = ESSENTIAL_STATS_COLUMNS.filter(col => !(col in row) || row[col] === '');
    if (missing.length > 0) {
        throw new Error(`Malformed telemetry row ${rowIndex + 1} in ${node_path_1.default.resolve(filePath)}: ` +
            `missing essential columns: ${missing.join(', ')}`);
    }
}
/**
 * Parse a single CSV line, respecting quoted fields and escaped quotes.
 * @param line - Raw CSV line string
 * @returns Array of parsed field values
 */
function parseCsvLine(line) {
    const values = [];
    let value = '';
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
        const char = line[index];
        if (char === '"') {
            if (quoted && line[index + 1] === '"') {
                value += '"';
                index += 1;
            }
            else {
                quoted = !quoted;
            }
        }
        else if (char === ',' && !quoted) {
            values.push(value);
            value = '';
        }
        else {
            value += char;
        }
    }
    values.push(value);
    return values;
}
/**
 * Escape a single CSV value — wraps in quotes if it contains commas, double-quotes, or newlines.
 * @param value - Value to escape
 * @returns Escaped CSV-safe string
 */
function escapeCsvValue(value) {
    const text = String(value ?? '');
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
/**
 * Minimal CSV loader — avoids circular dependency with stats module (which
 * imports this module at the top). Defined locally so `migrateStats()` can
 * read any schema without triggering a require-cycle.
 */
function loadCsv(filePath) {
    if (!node_fs_1.default.existsSync(filePath)) {
        return { headers: [], rows: [] };
    }
    const content = node_fs_1.default.readFileSync(filePath, 'utf8');
    const lines = content.split('\n').filter(line => line.trim());
    if (lines.length === 0) {
        return { headers: [], rows: [] };
    }
    const headers = parseCsvLine(lines[0]);
    const rows = [];
    for (let i = 1; i < lines.length; i += 1) {
        const values = parseCsvLine(lines[i]);
        const row = {};
        headers.forEach((header, idx) => {
            row[header] = values[idx] || '';
        });
        rows.push(row);
    }
    return { headers, rows };
}
/**
 * Read a stats CSV file with any schema (legacy 5-col or extended 21-col).
 * Returns rows as arrays keyed by the 21-column STATS_HEADERS, with missing
 * columns filled by normalizeStatsRow defaults.
 */
function readStatsRows(filePath, options = {}) {
    if (!filePath || !node_fs_1.default.existsSync(filePath)) {
        return [];
    }
    const data = loadCsv(filePath);
    if (data.headers.length === 0) {
        return [];
    }
    const headers = getStatsHeaders();
    const opts = options;
    const validated = data.rows.map((row, idx) => {
        validateStatsRow(row, idx, filePath);
        return row;
    });
    return validated
        .map(row => getStats().normalizeStatsRow(row, { repo: opts.defaultRepo }))
        .map((row) => headers.map((h) => String(row[h] || '')));
}
/**
 * Serialize an array of stats rows back to CSV format with canonical headers.
 * @param rows - Array of row arrays (each row is an array of string values)
 * @returns CSV string with headers and data rows
 */
function serializeStatsRows(rows) {
    const headers = getStatsHeaders();
    return `${[
        headers.join(','),
        ...rows.map(row => row.map(escapeCsvValue).join(','))
    ].join('\n')}\n`;
}
/**
 * Merge stats from one or more source CSV files into the destination file.
 * Deduplicates full rows. Creates the destination directory if needed.
 * When no source data is available, returns early without writing a header-only file.
 * @param options - Migration configuration (sourcePaths, sourcePath, destinationPath)
 * @returns Result with destination path, import counts, and optional warning
 */
function migrateStats(options = {}) {
    const opts = options;
    const sourcePaths = (opts.sourcePaths || [opts.sourcePath].filter(Boolean));
    const destinationPath = opts.destinationPath || storage.resolveStatsPath({ ensureDir: true });
    const sourceRows = sourcePaths.map((sourcePath) => readStatsRows(sourcePath, {})).flat();
    // Fresh-install guard: when no source file exists or all sources are empty,
    // there is no telemetry to import. Returning early prevents writing a
    // header-only destination file that would masquerade as valid stats.
    if (sourceRows.length === 0) {
        return { destinationPath, imported: 0, rows: 0, warn: 'no source data available' };
    }
    const destinationRows = readStatsRows(destinationPath, {});
    const rows = [];
    const seen = new Set();
    for (const row of [...destinationRows, ...sourceRows]) {
        const key = JSON.stringify(row);
        if (!seen.has(key)) {
            seen.add(key);
            rows.push(row);
        }
    }
    const content = serializeStatsRows(rows);
    const current = node_fs_1.default.existsSync(destinationPath) ? node_fs_1.default.readFileSync(destinationPath, 'utf8') : null;
    if (current !== content) {
        storage.writeFileAtomic(destinationPath, content);
    }
    return { destinationPath, imported: rows.length - destinationRows.length, rows: rows.length };
}
function readBlocklistSource(filePath, warn, hardFailure = false) {
    if (!filePath || !node_fs_1.default.existsSync(filePath)) {
        return null;
    }
    try {
        const payload = JSON.parse(node_fs_1.default.readFileSync(filePath, 'utf8'));
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
            throw new Error('expected a JSON object at the file root');
        }
        if (payload.blocklist !== undefined &&
            (!payload.blocklist || typeof payload.blocklist !== 'object' || Array.isArray(payload.blocklist))) {
            throw new Error('expected blocklist to be a JSON object');
        }
        return { filePath, payload, blocklist: payload.blocklist || {} };
    }
    catch (error) {
        if (hardFailure) {
            throw error;
        }
        warn(`Skipping malformed legacy agent blocklist ${node_path_1.default.resolve(filePath)}: ${error.message}`);
        return null;
    }
}
function sameValue(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
}
/**
 * Merge agent blocklists from legacy sources into the destination file.
 * Reports conflicts via `warn` when the same agent appears in multiple sources
 * with different values. Existing destination entries take lowest precedence.
 * @param options - Migration configuration (warn callback, destinationPath, sourcePaths)
 * @returns Result with destination path, merged blocklist, and conflict details
 */
function migrateAgentBlocklists(options = {}) {
    const opts = options;
    const warn = opts.warn || (() => { });
    const destinationPath = opts.destinationPath || storage.resolveAgentsLocalPath({ ensureDir: true });
    const sources = (opts.sourcePaths || [])
        .map(filePath => readBlocklistSource(filePath, warn))
        .filter(Boolean);
    const destination = readBlocklistSource(destinationPath, warn, true);
    const selected = {};
    const selectedFrom = {};
    const conflicts = [];
    for (const s of [...sources, ...(destination ? [destination] : [])]) {
        if (!s) {
            continue;
        }
        for (const [agent, value] of Object.entries(s.blocklist)) {
            if (Object.prototype.hasOwnProperty.call(selected, agent) && !sameValue(selected[agent], value)) {
                const conflict = {
                    agent,
                    previousSource: selectedFrom[agent],
                    previousValue: selected[agent],
                    selectedSource: s.filePath,
                    selectedValue: value
                };
                conflicts.push(conflict);
                warn(`Agent blocklist conflict for "${agent}": ${node_path_1.default.resolve(s.filePath)} takes precedence over ` +
                    `${node_path_1.default.resolve(selectedFrom[agent])}; selected=${JSON.stringify(value)} previous=${JSON.stringify(selected[agent])}`);
            }
            selected[agent] = value;
            selectedFrom[agent] = s.filePath;
        }
    }
    const payload = destination ? { ...destination.payload } : {};
    payload.blocklist = selected;
    const content = `${JSON.stringify(payload, null, 2)}\n`;
    const current = node_fs_1.default.existsSync(destinationPath) ? node_fs_1.default.readFileSync(destinationPath, 'utf8') : null;
    if (current !== content) {
        storage.writeFileAtomic(destinationPath, content);
    }
    return { destinationPath, blocklist: selected, conflicts };
}
exports._internals = { parseCsvLine, readStatsRows, serializeStatsRows };
