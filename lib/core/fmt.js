/**
 * Shared formatting and palette layer for workflow-owned output.
 * Uses Node.js built-in util.styleText for color rendering (ADR 0042).
 * No external dependencies.
 */

const { styleText } = require('node:util');

const colors = {
  reset: 'reset',
  bold: 'bold',
  red: 'red',
  green: 'green',
  yellow: 'yellow',
  blue: 'blue',
  magenta: 'magenta',
  cyan: 'cyan',
  white: 'white',
  dim: 'gray',
};

const statusMap = {
  PASS: 'green',
  FAIL: 'red',
  WARN: 'yellow',
  INFO: 'cyan',
  DEBUG: 'gray',
};

const agentMap = {
  codex: 'magenta',
  claude: 'blue',
  gemini: 'cyan',
  custom: 'yellow',
};

function colorize(format, text) {
  return styleText(format, String(text ?? ''));
}

function stripAnsi(text) {
  return String(text ?? '').replace(/\x1B\[[0-9;]*m/g, '');
}

function visibleWidth(text) {
  return stripAnsi(text).length;
}

function padVisibleEnd(text, width) {
  const stringValue = String(text ?? '');
  const padLength = Math.max(0, width - visibleWidth(stringValue));
  return stringValue + ' '.repeat(padLength);
}

/**
 * Formats a status line prefix (e.g. "[PASS]").
 */
function status(type, text) {
  const format = statusMap[type];
  if (!format) return `[${type}] ${text}`;
  return `${colorize(format, `[${type}]`)} ${text}`;
}

/**
 * Formats an agent family name.
 */
function agent(family, text = family) {
  let label = text;
  // Disambiguate the opencode-backed `custom` family only when the caller
  // passes a distinct display text (e.g. a model id): show `custom (opencode)`
  // so the underlying runtime is explicit. When text is just `custom`, render
  // it plainly to avoid the redundant `custom (opencode)` suffix.
  if (family === 'custom' && text !== 'custom') {
    label = 'custom (opencode)';
  }
  const format = agentMap[family];
  if (!format) return label;
  return colorize(format, label);
}

function bold(text) {
  return colorize('bold', text);
}

function dim(text) {
  return colorize('gray', text);
}

/**
 * Aligned key-value pair.
 */
function kv(key, value, width = 30) {
  return `${bold(key.padEnd(width))} ${value}`;
}

/**
 * Aligned table of columns.
 */
function table(rows, { indent = 2, colPadding = 2 } = {}) {
  if (rows.length === 0) return '';
  const colWidths = rows[0].map((_, i) => Math.max(...rows.map(row => visibleWidth(row[i] ?? ''))));
  const padding = ' '.repeat(indent);
  return rows.map(row => padding + row.map((col, i) => padVisibleEnd(col ?? '', colWidths[i] + colPadding)).join('')).join('\n');
}

/**
 * Bulleted list.
 */
function list(items, { bullet = '-', indent = 2 } = {}) {
  const padding = ' '.repeat(indent);
  return items.map(item => `${padding}${bullet} ${item}`).join('\n');
}

const semantic = {
  path: (text) => colorize('blue', text),
  slug: (text) => colorize('cyan', bold(text)),
  branch: (text) => colorize('magenta', text),
  sha: (text) => colorize('yellow', text),
  command: (text) => colorize('green', text),
};

let currentLogger = {
  log: (...args) => console.log(...args),
  error: (...args) => console.error(...args),
};

const log = {
  info: (text) => {
    return text.toString().split('\n').map(line => {
      const s = status('INFO', line);
      currentLogger.log(s);
      return s;
    }).join('\n');
  },
  pass: (text) => {
    return text.toString().split('\n').map(line => {
      const s = status('PASS', line);
      currentLogger.log(s);
      return s;
    }).join('\n');
  },
  fail: (text) => {
    return text.toString().split('\n').map(line => {
      const s = status('FAIL', line);
      currentLogger.error(s);
      return s;
    }).join('\n');
  },
  warn: (text) => {
    return text.toString().split('\n').map(line => {
      const s = status('WARN', line);
      currentLogger.log(s);
      return s;
    }).join('\n');
  },
  error: (text) => {
    return text.toString().split('\n').map(line => {
      const s = status('FAIL', line);
      currentLogger.error(s);
      return s;
    }).join('\n');
  },
  debug: (text) => {
    if (!process.env.DEBUG) return null;
    return text.toString().split('\n').map(line => {
      const s = status('DEBUG', line);
      currentLogger.log(s);
      return s;
    }).join('\n');
  },
  plain: (text) => {
    text.toString().split('\n').forEach(line => currentLogger.log(line));
    return text;
  },
  plainError: (text) => {
    text.toString().split('\n').forEach(line => currentLogger.error(line));
    return text;
  },
};

function setLogger(newLogger) {
  const old = currentLogger;
  currentLogger = {
    log: newLogger.log || newLogger,
    error: newLogger.error || newLogger.log || newLogger,
  };
  return old;
}

module.exports = {
  colors,
  status,
  agent,
  bold,
  dim,
  colorize,
  stripAnsi,
  visibleWidth,
  padVisibleEnd,
  kv,
  table,
  list,
  ...semantic,
  log,
  setLogger,
};
