/**
 * Shared formatting and palette layer for workflow-owned output.
 * Uses Node.js built-in util.styleText for color rendering (ADR 0042).
 * No external dependencies.
 */

import { styleText } from 'node:util';

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

const statusMap: Record<string, string> = {
  PASS: 'green',
  FAIL: 'red',
  WARN: 'yellow',
  INFO: 'cyan',
  DEBUG: 'gray',
};

const agentMap: Record<string, string> = {
  codex: 'magenta',
  claude: 'blue',
  gemini: 'cyan',
  custom: 'yellow',
};

export function colorize(format: string, text: string): string {
  return styleText(format as import('node:util').InspectColor, String(text ?? ''));
}

export function stripAnsi(text: string): string {
  return String(text ?? '').replace(/\x1B\[[0-9;]*m/g, '');
}

export function visibleWidth(text: string): number {
  return stripAnsi(text).length;
}

export function padVisibleEnd(text: string, width: number): string {
  const stringValue = String(text ?? '');
  const padLength = Math.max(0, width - visibleWidth(stringValue));
  return stringValue + ' '.repeat(padLength);
}

export function status(type: string, text: string): string {
  const format = statusMap[type];
  if (!format) {return `[${type}] ${text}`;}
  return `${colorize(format, `[${type}]`)} ${text}`;
}

export function agent(family: string, text: string = family): string {
  let label = text;
  if (family === 'custom' && text !== 'custom') {
    label = 'custom (opencode)';
  }
  const format = agentMap[family];
  if (!format) {return label;}
  return colorize(format, label);
}

export function bold(text: string): string {
  return colorize('bold', text);
}

export function dim(text: string): string {
  return colorize('gray', text);
}

export function kv(key: string, value: string, width: number = 30): string {
  return `${bold(key.padEnd(width))} ${value}`;
}

export function table(rows: string[][], { indent = 2, colPadding = 2 }: { indent?: number; colPadding?: number } = {}): string {
  if (rows.length === 0) {return '';}
  const colWidths = rows[0].map((_, i) => Math.max(...rows.map(row => visibleWidth(row[i] ?? ''))));
  const padding = ' '.repeat(indent);
  return rows.map(row => padding + row.map((col, i) => padVisibleEnd(col ?? '', colWidths[i] + colPadding)).join('')).join('\n');
}

export function list(items: string[], { bullet = '-', indent = 2 }: { bullet?: string; indent?: number } = {}): string {
  const padding = ' '.repeat(indent);
  return items.map(item => `${padding}${bullet} ${item}`).join('\n');
}

export function path(text: string): string { return colorize('blue', text); }
export function slug(text: string): string { return colorize('cyan', bold(text)); }
export function branch(text: string): string { return colorize('magenta', text); }
export function sha(text: string): string { return colorize('yellow', text); }
export function command(text: string): string { return colorize('green', text); }

type LogFn = (...args: unknown[]) => void;
type LogFunc = (text: string) => string | null;

type Logger = {
  log: LogFn;
  error: LogFn;
};

type LoggerInput = { log?: LogFn; error?: LogFn } | LogFn;

let currentLogger: Logger = {
  log: (...args: unknown[]) => console.log(...args),
  error: (...args: unknown[]) => console.error(...args),
};

export const log: {
  info: LogFunc;
  pass: LogFunc;
  fail: LogFunc;
  warn: LogFunc;
  error: LogFunc;
  debug: LogFunc;
  plain: LogFunc;
  plainError: LogFunc;
} = {
  info: (text: string): string => {
    return text.toString().split('\n').map(line => {
      const s = status('INFO', line);
      currentLogger.log(s);
      return s;
    }).join('\n');
  },
  pass: (text: string): string => {
    return text.toString().split('\n').map(line => {
      const s = status('PASS', line);
      currentLogger.log(s);
      return s;
    }).join('\n');
  },
  fail: (text: string): string => {
    return text.toString().split('\n').map(line => {
      const s = status('FAIL', line);
      currentLogger.error(s);
      return s;
    }).join('\n');
  },
  warn: (text: string): string => {
    return text.toString().split('\n').map(line => {
      const s = status('WARN', line);
      currentLogger.log(s);
      return s;
    }).join('\n');
  },
  error: (text: string): string => {
    return text.toString().split('\n').map(line => {
      const s = status('FAIL', line);
      currentLogger.error(s);
      return s;
    }).join('\n');
  },
  debug: (text: string): string | null => {
    if (!process.env.DEBUG) {return null;}
    return text.toString().split('\n').map(line => {
      const s = status('DEBUG', line);
      currentLogger.log(s);
      return s;
    }).join('\n');
  },
  plain: (text: string): string => {
    text.toString().split('\n').forEach(line => currentLogger.log(line));
    return text;
  },
  plainError: (text: string): string => {
    text.toString().split('\n').forEach(line => currentLogger.error(line));
    return text;
  },
};

export function setLogger(newLogger: LoggerInput): Logger {
  const old = currentLogger;
  const logger = newLogger as { log?: LogFn; error?: LogFn };
  currentLogger = {
    log: typeof logger.log === 'function' ? logger.log : (() => {}),
    error: typeof logger.error === 'function' ? logger.error : (typeof logger.log === 'function' ? logger.log : (() => {})),
  };
  return old;
}

export { colors };
