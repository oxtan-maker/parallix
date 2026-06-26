'use strict';

const DEFAULT_FALLBACK_HOURS = 1;
const SIGINT_SHORT_BLOCK_MINUTES = 15;

const PATTERN_SETS = Object.freeze({
  claude: [
    /claude (?:ai )?usage limit reached/i,
    /\b5-hour limit (?:reached|exceeded)\b/i,
    /you(?:'|')?ve hit your limit(?:\b|$)/i,
    /you(?:'|')?ve hit your (?:weekly|daily|monthly|usage) limit/i,
    /(?:usage|rate)\s*limit (?:has been )?(?:reached|exceeded)/i,
    /\b429\b[^\n]*?\b(?:rate|usage|quota)\b/i
  ],
  codex: [
    /you(?:'|’)?ve hit your (?:weekly|daily|monthly|usage) limit/i,
    /\brate[_ ]?limit(?:_| )?(?:exceeded|reached)\b/i,
    /\bweekly (?:codex )?usage limit\b/i,
    /\b429\b[^\n]*?\b(?:rate|quota|usage)\b/i,
    /resource_exhausted/i
  ],

  custom: [
    /\b(?:rate|usage|quota)\s*limit\s*(?:reached|exceeded)\b/i,
    /\b429\b[^\n]*?\b(?:rate|quota|usage)\b/i,
    /\b429\b/i,
    /\binsufficient[_ ]quota\b/i
  ],
  mistral: [
    /\bmistral (?:ai )?usage limit reached/i,
    /\bmistral (?:ai )?quota exceeded/i,
    /\bmistral (?:ai )?rate limit(?: reached| exceeded)/i,
    /you(?:'|')?ve hit your (?:mistral|vibe) (?:weekly|daily|monthly|usage) limit/i,
    /\b429\b[^\n]*?\b(?:rate|quota|usage)\b/i,
    /\bvibe\b[^\n]*?\b(?:quota exceeded|rate limit exceeded)\b/i,
    /\bmistral\b[^\n]*?\b(?:quota exceeded|rate limit exceeded)\b/i,
    /\bresource[_ ]has[_ ]been[_ ]exhausted\b/i,
    /\bresource_exhausted\b/i
  ]
});

function getPatternsForAgent(agent) {
  return PATTERN_SETS[agent] || [];
}

function findLimitHitMatch(agent, text) {
  const patterns = getPatternsForAgent(agent);
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) {
      return { pattern, index: match.index, length: match[0].length };
    }
  }
  return null;
}

function clipContext(text, index, length) {
  const before = Math.max(0, index - 200);
  const after = Math.min(text.length, index + length + 200);
  return text.slice(before, after);
}

const ISO_PATTERN = /(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?/;
const TWELVE_HOUR_PATTERN = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|AM|PM)\b/;
const TWENTY_FOUR_HOUR_PATTERN = /\b([01]?\d|2[0-3]):([0-5]\d)\b/;
const RELATIVE_PATTERN = /\bin\s+(\d+)\s+(hour|hours|minute|minutes|second|seconds)\b/i;
const RETRY_AFTER_PATTERN = /retry[- ]?after[:\s]+(\d+)\s*(seconds?|s|minutes?|m)?/i;
const RETRY_AT_DATE_PATTERN = /(?:retry|reset|try again|reset(?:s)? at)[^\n]{0,40}?(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)/i;

function parseIsoOffset(value) {
  if (!value) return null;
  if (value === 'Z') return 0;
  const m = /([+-])(\d{2}):?(\d{2})/.exec(value);
  if (!m) return null;
  const sign = m[1] === '-' ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3]));
}

function parseIso(text) {
  const m = ISO_PATTERN.exec(text);
  if (!m) return null;
  const [, year, month, day, hour, minute, second, offset] = m;
  const offsetMinutes = parseIsoOffset(offset);
  if (offsetMinutes === null) {
    return new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second || 0), 0);
  }
  const utcMs = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second || 0), 0);
  return new Date(utcMs - offsetMinutes * 60 * 1000);
}

function parseTwelveHour(text, now) {
  const m = TWELVE_HOUR_PATTERN.exec(text);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = Number(m[2] || 0);
  const meridiem = m[3].toLowerCase();
  if (hour < 1 || hour > 12) return null;
  if (meridiem === 'pm' && hour !== 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;
  return projectClockTime(now, hour, minute);
}

function parseTwentyFourHour(text, now) {
  const m = TWENTY_FOUR_HOUR_PATTERN.exec(text);
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  return projectClockTime(now, hour, minute);
}

function parseRelative(text, now) {
  const m = RELATIVE_PATTERN.exec(text);
  if (!m) return null;
  const amount = Number(m[1]);
  const unit = m[2].toLowerCase();
  let ms;
  if (unit.startsWith('hour')) ms = amount * 60 * 60 * 1000;
  else if (unit.startsWith('minute')) ms = amount * 60 * 1000;
  else ms = amount * 1000;
  return new Date(now.getTime() + ms);
}

function parseRetryAfter(text, now) {
  const m = RETRY_AFTER_PATTERN.exec(text);
  if (!m) return null;
  const amount = Number(m[1]);
  const unit = (m[2] || 's').toLowerCase();
  let ms;
  if (unit.startsWith('m') && unit !== 's') ms = amount * 60 * 1000;
  else ms = amount * 1000;
  return new Date(now.getTime() + ms);
}

function parseRetryAtDate(text) {
  const m = RETRY_AT_DATE_PATTERN.exec(text);
  if (!m) return null;
  return parseIso(m[1]);
}

function projectClockTime(now, hour, minute) {
  const candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0);
  if (candidate.getTime() <= now.getTime()) {
    candidate.setDate(candidate.getDate() + 1);
  }
  return candidate;
}

function parseResetTime(text, now = new Date()) {
  if (!text) return null;
  return (
    parseRetryAtDate(text) ||
    parseIso(text) ||
    parseTwelveHour(text, now) ||
    parseTwentyFourHour(text, now) ||
    parseRelative(text, now) ||
    parseRetryAfter(text, now)
  );
}

function formatBlockUntil(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  return `${year}-${month}-${day} ${hour}`;
}

function ceilToNextHour(date) {
  const ceil = new Date(date.getTime());
  if (ceil.getMinutes() === 0 && ceil.getSeconds() === 0 && ceil.getMilliseconds() === 0) {
    return ceil;
  }
  ceil.setMinutes(0, 0, 0);
  ceil.setHours(ceil.getHours() + 1);
  return ceil;
}

function detectLimitHit({
  agent,
  stdout = '',
  stderr = '',
  status,
  signal,
  error,
  now = new Date()
} = {}) {
  if (!agent) return null;
  // Gate detection on a failed launcher invocation. A successful child (exit 0,
  // no signal, no spawn error) means any limit-hit phrases in the transcript
  // are quoted text — typically when the agent itself reviewed code, tests, or
  // logs containing those strings. Treating that as a real limit hit would
  // wrongly block a healthy agent in agents.local.json.
  // `status === undefined` means the caller did not pass exit metadata; preserve
  // the legacy behavior so callers that haven't been updated still get detection.
  const launcherFailed =
    error != null ||
    signal != null ||
    (typeof status === 'number' && status !== 0) ||
    typeof status === 'undefined';
  if (!launcherFailed) return null;

  const combined = `${stdout || ''}\n${stderr || ''}`;
  const match = findLimitHitMatch(agent, combined);

  let target;
  let source;

  if (match) {
    const context = clipContext(combined, match.index, match.length);
    const parsed = parseResetTime(context, now);

    if (parsed && !Number.isNaN(parsed.getTime()) && parsed.getTime() > now.getTime()) {
      target = parsed;
      source = 'parsed';
    } else {
      target = new Date(now.getTime() + DEFAULT_FALLBACK_HOURS * 60 * 60 * 1000);
      source = 'fallback';
    }
  } else if (signal != null) {
    // Agent was killed by a signal (e.g. SIGINT/Ctrl-C) but no limit-hit
    // pattern matched. Apply a short-term block so the next invocation
    // selects a different agent instead of re-picking the same one.
    target = new Date(now.getTime() + SIGINT_SHORT_BLOCK_MINUTES * 60 * 1000);
    source = 'sigint';
  } else {
    return null;
  }

  const ceiled = ceilToNextHour(target);
  return { until: formatBlockUntil(ceiled), source };
}

module.exports = {
  detectLimitHit,
  parseResetTime,
  formatBlockUntil,
  ceilToNextHour,
  findLimitHitMatch,
  clipContext,
  parseIsoOffset,
  parseIso,
  parseTwelveHour,
  parseTwentyFourHour,
  parseRelative,
  parseRetryAfter,
  parseRetryAtDate,
  projectClockTime,
  getPatternsForAgent,
  PATTERN_SETS,
  DEFAULT_FALLBACK_HOURS,
  SIGINT_SHORT_BLOCK_MINUTES
};
