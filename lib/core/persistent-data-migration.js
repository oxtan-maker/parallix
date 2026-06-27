const fs = require('fs');
const path = require('path');
const storage = require('./storage');

/** @type {any} */
let _stats = null;
function getStats() {
  if (!_stats) {_stats = require('../commands/stats');}
  return _stats;
}

function getStatsHeaders() {
  return getStats().STATS_HEADERS;
}

const ESSENTIAL_STATS_COLUMNS = ['date', 'mission', 'classification', 'implementer', 'pr_fix_rounds'];

/** @param {Record<string, unknown>} row @param {number} rowIndex @param {string} filePath */
function validateStatsRow(row, rowIndex, filePath) {
  const missing = ESSENTIAL_STATS_COLUMNS.filter(col => !(col in row) || row[col] === '');
  if (missing.length > 0) {
    throw new Error(
      `Malformed telemetry row ${rowIndex + 1} in ${path.resolve(filePath)}: ` +
      `missing essential columns: ${missing.join(', ')}`
    );
  }
}

/** @param {string} line */
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
      } else {
        quoted = !quoted;
      }
    } else if (char === ',' && !quoted) {
      values.push(value);
      value = '';
    } else {
      value += char;
    }
  }
  values.push(value);
  return values;
}

/** @param {unknown} value */
function escapeCsvValue(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Minimal CSV loader — avoids circular dependency with stats module (which
 * imports this module at the top). Defined locally so `migrateStats()` can
 * read any schema without triggering a require-cycle.
 */
/** @param {string} filePath */
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
    const row = {};
    /** @param {string} header @param {number} idx */
    headers.forEach((header, idx) => {
      /** @type {Record<string, unknown>} */
      const r = /** @type {Record<string, unknown>} */(row);
      r[header] = values[idx] || '';
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
/** @param {string} filePath @param {{defaultRepo?: string}} [options] */
function readStatsRows(filePath, options = {}) {
  if (!filePath || !fs.existsSync(filePath)) {return [];}
  const data = loadCsv(filePath);
  if (data.headers.length === 0) {return [];}
  const headers = getStatsHeaders();
  /** @type {{defaultRepo?: string}} */
  const opts = options;
  /** @type {Record<string, unknown>[]} */
  const validated = /** @type {Record<string, unknown>[]} */(data.rows).map((/** @type {Record<string, unknown>} */ row, idx) => {
    validateStatsRow(row, idx, filePath);
    return row;
  });
  /** @param {string} h */
  return validated
    .map(row => getStats().normalizeStatsRow(row, { repo: opts.defaultRepo }))
    .map(row => headers.map((/** @type {string} */ h) => row[h] || ''));
}

/** @param {string[][]} rows */
function serializeStatsRows(rows) {
  const headers = getStatsHeaders();
  return `${[
    headers.join(','),
    ...rows.map(row => row.map(escapeCsvValue).join(','))
  ].join('\n')}\n`;
}

/** @param {{sourcePaths?: string[], sourcePath?: string, destinationPath?: string}} [options] */
function migrateStats(options = {}) {
  /** @type {{sourcePaths?: string[], sourcePath?: string, destinationPath?: string}} */
  const opts = options;
  const sourcePaths = /** @type {string[]} */(opts.sourcePaths || [opts.sourcePath].filter(Boolean));
  const destinationPath = opts.destinationPath || storage.resolveStatsPath({ ensureDir: true });
  /** @param {string} sourcePath */
  const sourceRows = sourcePaths.flatMap((/** @type {string} */ sourcePath) => readStatsRows(sourcePath, /** @type {{defaultRepo?: string}} */({})));

  // Fresh-install guard: when no source file exists or all sources are empty,
  // there is no telemetry to import. Returning early prevents writing a
  // header-only destination file that would masquerade as valid stats.
  if (sourceRows.length === 0) {
    return { destinationPath, imported: 0, rows: 0, warn: 'no source data available' };
  }

  const destinationRows = readStatsRows(destinationPath, /** @type {{defaultRepo?: string}} */({}));
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
  const current = fs.existsSync(destinationPath) ? fs.readFileSync(destinationPath, 'utf8') : null;
  if (current !== content) {storage.writeFileAtomic(destinationPath, content);}
  return { destinationPath, imported: rows.length - destinationRows.length, rows: rows.length };
}

/** @param {string} filePath @param {Function} warn @param {boolean} [hardFailure] */
function readBlocklistSource(filePath, warn, hardFailure = false) {
  if (!filePath || !fs.existsSync(filePath)) {return null;}
  try {
    const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('expected a JSON object at the file root');
    }
    if (
      payload.blocklist !== undefined &&
      (!payload.blocklist || typeof payload.blocklist !== 'object' || Array.isArray(payload.blocklist))
    ) {
      throw new Error('expected blocklist to be a JSON object');
    }
    return { filePath, payload, blocklist: payload.blocklist || {} };
  } catch (error) {
    if (hardFailure) {throw error;}
    /** @type {Error} */
    const e = /** @type {Error} */(error);
    warn(`Skipping malformed legacy agent blocklist ${path.resolve(filePath)}: ${e.message}`);
    return null;
  }
}

/** @param {unknown} left @param {unknown} right */
function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** @param {{warn?: Function, destinationPath?: string, sourcePaths?: string[]}} [options] */
function migrateAgentBlocklists(options = {}) {
  /** @type {{warn?: Function, destinationPath?: string, sourcePaths?: string[]}} */
  const opts = options;
  const warn = opts.warn || (() => {});
  const destinationPath = opts.destinationPath || storage.resolveAgentsLocalPath({ ensureDir: true });
  /** @param {string} filePath */
  const sources = (opts.sourcePaths || [])
    .map(filePath => readBlocklistSource(filePath, warn))
    .filter(Boolean);
  const destination = readBlocklistSource(destinationPath, warn, true);
  /** @type {Record<string, unknown>} */
  const selected = {};
  /** @type {Record<string, string>} */
  const selectedFrom = {};
  const conflicts = [];

  for (const source of [...sources, ...(destination ? [destination] : [])]) {
    if (!source) {continue;}
    /** @type {{filePath: string, blocklist: Record<string,unknown>}} */
    const s = source;
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
        warn(
          `Agent blocklist conflict for "${agent}": ${path.resolve(s.filePath)} takes precedence over ` +
          `${path.resolve(selectedFrom[agent])}; selected=${JSON.stringify(value)} previous=${JSON.stringify(selected[agent])}`
        );
      }
      selected[agent] = value;
      selectedFrom[agent] = s.filePath;
    }
  }

  /** @type{Record<string,unknown>} */
  const payload = destination ? { ...destination.payload } : {};
  payload.blocklist = selected;
  const content = `${JSON.stringify(payload, null, 2)}\n`;
  const current = fs.existsSync(destinationPath) ? fs.readFileSync(destinationPath, 'utf8') : null;
  if (current !== content) {storage.writeFileAtomic(destinationPath, content);}
  return { destinationPath, blocklist: selected, conflicts };
}

module.exports = {
  migrateStats,
  migrateAgentBlocklists,
  _internals: { parseCsvLine, readStatsRows, serializeStatsRows }
};
