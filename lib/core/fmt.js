"use strict";
/**
 * Shared formatting and palette layer for workflow-owned output.
 * Uses Node.js built-in util.styleText for color rendering (ADR 0042).
 * No external dependencies.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.colors = exports.log = void 0;
exports.colorize = colorize;
exports.stripAnsi = stripAnsi;
exports.visibleWidth = visibleWidth;
exports.padVisibleEnd = padVisibleEnd;
exports.status = status;
exports.agent = agent;
exports.bold = bold;
exports.dim = dim;
exports.kv = kv;
exports.table = table;
exports.list = list;
exports.path = path;
exports.slug = slug;
exports.branch = branch;
exports.sha = sha;
exports.command = command;
exports.setLogger = setLogger;
const node_util_1 = require("node:util");
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
exports.colors = colors;
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
    return (0, node_util_1.styleText)(format, String(text ?? ''));
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
function status(type, text) {
    const format = statusMap[type];
    if (!format) {
        return `[${type}] ${text}`;
    }
    return `${colorize(format, `[${type}]`)} ${text}`;
}
function agent(family, text = family, runner) {
    let label = text;
    if (family === 'custom' && text === 'custom' && runner) {
        label = `custom (${runner})`;
    }
    else if (family === 'custom' && text !== 'custom') {
        label = `custom (${text})`;
    }
    const format = agentMap[family];
    if (!format) {
        return label;
    }
    return colorize(format, label);
}
function bold(text) {
    return colorize('bold', text);
}
function dim(text) {
    return colorize('gray', text);
}
function kv(key, value, width = 30) {
    return `${bold(key.padEnd(width))} ${value}`;
}
function table(rows, { indent = 2, colPadding = 2 } = {}) {
    if (rows.length === 0) {
        return '';
    }
    const colWidths = rows[0].map((_, i) => Math.max(...rows.map(row => visibleWidth(row[i] ?? ''))));
    const padding = ' '.repeat(indent);
    return rows.map(row => padding + row.map((col, i) => padVisibleEnd(col ?? '', colWidths[i] + colPadding)).join('')).join('\n');
}
function list(items, { bullet = '-', indent = 2 } = {}) {
    const padding = ' '.repeat(indent);
    return items.map(item => `${padding}${bullet} ${item}`).join('\n');
}
function path(text) { return colorize('blue', text); }
function slug(text) { return colorize('cyan', bold(text)); }
function branch(text) { return colorize('magenta', text); }
function sha(text) { return colorize('yellow', text); }
function command(text) { return colorize('green', text); }
let currentLogger = {
    log: (...args) => console.log(...args),
    error: (...args) => console.error(...args),
};
exports.log = {
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
        if (!process.env.DEBUG) {
            return null;
        }
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
    const logger = newLogger;
    currentLogger = {
        log: typeof logger.log === 'function' ? logger.log : (() => { }),
        error: typeof logger.error === 'function' ? logger.error : (typeof logger.log === 'function' ? logger.log : (() => { })),
    };
    return old;
}
