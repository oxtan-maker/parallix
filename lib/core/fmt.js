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

/** @param {import('node:util').InspectColor} format @param {string} text */
function colorize(format, text) {
  return styleText(format, String(text ?? ''));
}

/** @param {string} text */
function stripAnsi(text) {
  return String(text ?? '').replace(/\x1B\[[0-9;]*m/g, '');
}

/** @param {string} text */
function visibleWidth(text) {
  return stripAnsi(text).length;
}

/** @param {string} text @param {number} width */
function padVisibleEnd(text, width) {
  const stringValue = String(text ?? '');
  const padLength = Math.max(0, width - visibleWidth(stringValue));
  return stringValue + ' '.repeat(padLength);
}

/**
 * Formats a status line prefix (e.g. "[PASS]").
 */
/** @param {string} type @param {string} text */
function status(type, text) {
  /** @type {Record<string,string>} */
  const sm = statusMap;
  const format = sm[type];
  if (!format) {return `[${type}] ${text}`;}
  return `${colorize(/** @type {import('node:util').InspectColor} */(format), `[${type}]`)} ${text}`;
}

/**
 * Formats an agent family name.
 */
/** @param {string} family @param {string} [text] */
function agent(family, text = family) {
  let label = text;
  // Disambiguate the opencode-backed `custom` family only when the caller
  // passes a distinct display text (e.g. a model id): show `custom (opencode)`
  // so the underlying runtime is explicit. When text is just `custom`, render
  // it plainly to avoid the redundant `custom (opencode)` suffix.
  if (family === 'custom' && text !== 'custom') {
    label = 'custom (opencode)';
  }
  /** @type {Record<string,string>} */
  const am = agentMap;
  const format = am[family];
  if (!format) {return label;}
  return colorize(/** @type {import('node:util').InspectColor} */(format), label);
}

/** @param {string} text */
function bold(text) {
  return colorize('bold', text);
}

/** @param {string} text */
function dim(text) {
  return colorize('gray', text);
}

/**
 * Aligned key-value pair.
 */
/** @param {string} key @param {string} value @param {number} width */
function kv(key, value, width = 30) {
  return `${bold(key.padEnd(width))} ${value}`;
}

/**
 * Aligned table of columns.
 */
/** @param {string[][]} rows @param {{indent?: number, colPadding?: number}} [opts] */
function table(rows, { indent = 2, colPadding = 2 } = {}) {
  if (rows.length === 0) {return '';}
  /** @param {unknown} _ @param {number} i */
  const colWidths = rows[0].map((_, i) => Math.max(...rows.map(row => visibleWidth(row[i] ?? ''))));
  const padding = ' '.repeat(indent);
  /** @param {string[]} row */
  return rows.map(row => padding + row.map((col, i) => padVisibleEnd(col ?? '', colWidths[i] + colPadding)).join('')).join('\n');
}

/**
 * Bulleted list.
 */
/** @param {string[]} items @param {{bullet?: string, indent?: number}} [opts] */
function list(items, { bullet = '-', indent = 2 } = {}) {
  const padding = ' '.repeat(indent);
  /** @param {string} item */
  return items.map(item => `${padding}${bullet} ${item}`).join('\n');
}

const semantic = {
  path: /** @param {string} text */(text) => colorize('blue', text),
  slug: /** @param {string} text */(text) => colorize('cyan', bold(text)),
  branch: /** @param {string} text */(text) => colorize('magenta', text),
  sha: /** @param {string} text */(text) => colorize('yellow', text),
  command: /** @param {string} text */(text) => colorize('green', text),
};

/** @type {{log: Function, error: Function}} */
let currentLogger = {
  /** @param {...any} args */
  log: (...args) => console.log(...args),
  /** @param {...any} args */
  error: (...args) => console.error(...args),
};

/** @typedef {{log?: Function, error?: Function}} LoggerObj */

/** @type{{info: Function, pass: Function, fail: Function, warn: Function, error: Function, debug: Function, plain: Function, plainError: Function}} */
const log = {
  /** @param {string} text */
  info: (text) => {
    /** @param {string} line */
    return text.toString().split('\n').map(line => {
      const s = status('INFO', line);
      currentLogger.log(s);
      return s;
    }).join('\n');
  },
  /** @param {string} text */
  pass: (text) => {
    /** @param {string} line */
    return text.toString().split('\n').map(line => {
      const s = status('PASS', line);
      currentLogger.log(s);
      return s;
    }).join('\n');
  },
  /** @param {string} text */
  fail: (text) => {
    /** @param {string} line */
    return text.toString().split('\n').map(line => {
      const s = status('FAIL', line);
      currentLogger.error(s);
      return s;
    }).join('\n');
  },
  /** @param {string} text */
  warn: (text) => {
    /** @param {string} line */
    return text.toString().split('\n').map(line => {
      const s = status('WARN', line);
      currentLogger.log(s);
      return s;
    }).join('\n');
  },
  /** @param {string} text */
  error: (text) => {
    /** @param {string} line */
    return text.toString().split('\n').map(line => {
      const s = status('FAIL', line);
      currentLogger.error(s);
      return s;
    }).join('\n');
  },
  /** @param {string} text */
  debug: (text) => {
    if (!process.env.DEBUG) {return null;}
    /** @param {string} line */
    return text.toString().split('\n').map(line => {
      const s = status('DEBUG', line);
      currentLogger.log(s);
      return s;
    }).join('\n');
  },
  /** @param {string} text */
  plain: (text) => {
    /** @param {string} line */
    text.toString().split('\n').forEach(line => currentLogger.log(line));
    return text;
  },
  /** @param {string} text */
  plainError: (text) => {
    /** @param {string} line */
    text.toString().split('\n').forEach(line => currentLogger.error(line));
    return text;
  },
};

/** @param {LoggerObj|Function} newLogger */
function setLogger(newLogger) {
  const old = currentLogger;
  /** @type {LoggerObj} */
  const logger = /** @type {LoggerObj} */(newLogger);
  currentLogger = {
    log: typeof logger.log === 'function' ? logger.log : (() => {}),
    error: typeof logger.error === 'function' ? logger.error : (typeof logger.log === 'function' ? logger.log : (() => {})),
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
