const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getPatternsForAgent,
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
  parseResetTime,
  formatBlockUntil,
  ceilToNextHour,
  detectLimitHit
} = require('../lib/agents/limit-hit');

// ---------- getPatternsForAgent ----------

test('getPatternsForAgent returns patterns for claude', () => {
  const patterns = getPatternsForAgent('claude');
  assert.ok(Array.isArray(patterns));
  assert.ok(patterns.length > 0);
});

test('getPatternsForAgent returns patterns for codex', () => {
  const patterns = getPatternsForAgent('codex');
  assert.ok(Array.isArray(patterns));
  assert.ok(patterns.length > 0);
});

test('getPatternsForAgent returns patterns for gemini', () => {
  const patterns = getPatternsForAgent('gemini');
  assert.ok(Array.isArray(patterns));
});

test('getPatternsForAgent returns patterns for mistral', () => {
  const patterns = getPatternsForAgent('mistral');
  assert.ok(Array.isArray(patterns));
  assert.ok(patterns.length > 0);
});

test('getPatternsForAgent returns empty array for unknown agent', () => {
  const patterns = getPatternsForAgent('unknown');
  assert.deepEqual(patterns, []);
});

// ---------- findLimitHitMatch ----------

test('findLimitHitMatch finds matching phrase in stdout', () => {
  const match = findLimitHitMatch('claude', 'Hello Claude usage limit reached. Your limit will reset at 5pm (UTC).');
  assert.ok(match);
  assert.equal(typeof match.index, 'number');
});

test('findLimitHitMatch returns null when no match', () => {
  const match = findLimitHitMatch('Hello world', ['claude'], 'stdout');
  assert.equal(match, null);
});

test('findLimitHitMatch finds mistral quota exceeded', () => {
  const match = findLimitHitMatch('mistral', 'Mistral AI quota exceeded. Please try again later.');
  assert.ok(match);
  assert.equal(typeof match.index, 'number');
});

test('findLimitHitMatch finds mistral rate limit', () => {
  const match = findLimitHitMatch('mistral', 'Mistral AI rate limit reached');
  assert.ok(match);
  assert.equal(typeof match.index, 'number');
});

test('findLimitHitMatch does NOT match bare quota exceeded for mistral', () => {
  // Bare "quota exceeded" without mistral/vibe context should not match
  const match = findLimitHitMatch('mistral', 'reviewed comment: quota exceeded');
  assert.equal(match, null);
});

test('findLimitHitMatch does NOT match bare rate limit exceeded for mistral', () => {
  // Bare "rate limit exceeded" without mistral/vibe context should not match
  const match = findLimitHitMatch('mistral', 'reviewed comment: rate limit exceeded');
  assert.equal(match, null);
});

test('detectLimitHit returns null for mistral when quoted quota exceeded text appears with launcher success', () => {
  // Even if "quota exceeded" appears in transcript, if launcher succeeded (status 0),
  // it should not be treated as a limit hit
  const result = detectLimitHit({
    agent: 'mistral',
    stdout: 'reviewed comment: quota exceeded',
    stderr: '',
    status: 0,
    signal: null,
    error: null
  });
  assert.equal(result, null);
});

// ---------- clipContext ----------

test('clipContext returns surrounding context around match', () => {
  const text = 'x'.repeat(100) + 'LIMIT_REACHED' + 'y'.repeat(100);
  const clip = clipContext(text, 100, 'LIMIT_REACHED'.length);
  assert.ok(clip.includes('LIMIT_REACHED'));
});

// ---------- parseIsoOffset ----------

test('parseIsoOffset parses PT1H5M format', () => {
  const result = parseIsoOffset('+01:05');
  assert.equal(result, 65); // minutes
});

test('parseIsoOffset parses PT30M format', () => {
  const result = parseIsoOffset('-00:30');
  assert.equal(result, -30);
});

test('parseIsoOffset returns null for invalid format', () => {
  const result = parseIsoOffset('not-an-iso');
  assert.equal(result, null);
});

// ---------- parseRetryAfter ----------

test('parseRetryAfter parses numeric seconds', () => {
  const now = new Date('2026-05-01T10:00:00Z');
  const result = parseRetryAfter('retry-after: 3600', now);
  assert.equal(result.getTime(), now.getTime() + 3600 * 1000);
});

test('parseRetryAfter returns null for non-numeric', () => {
  const result = parseRetryAfter('abc', new Date('2026-05-01T10:00:00Z'));
  assert.equal(result, null);
});

// ---------- projectClockTime ----------

test('projectClockTime projects a reset offset to a future clock time', () => {
  const now = new Date('2026-05-01T10:00:00Z');
  const result = projectClockTime(now, 11, 0);
  assert.ok(result.getTime() >= now.getTime());
});

// ---------- parseResetTime ----------

test('parseResetTime handles ISO offset format', () => {
  const result = parseResetTime('2026-05-01T11:00:00Z');
  assert.ok(result instanceof Date);
});

test('parseResetTime handles numeric seconds', () => {
  const now = new Date('2026-05-01T10:00:00Z');
  const result = parseResetTime('retry-after: 1800', now);
  assert.ok(result instanceof Date);
});

test('parseResetTime handles the reported Claude transcript clock time', () => {
  const now = new Date('2026-05-01T16:30:00+02:00');
  const result = parseResetTime("You've hit your limit · resets 7:10pm (Europe/Stockholm)", now);
  assert.ok(result instanceof Date);
  assert.equal(result.getHours(), 19);
  assert.equal(result.getMinutes(), 10);
  assert.ok(result.getTime() > now.getTime(), 'parsed reset time must be in the future');
});

// ---------- formatBlockUntil ----------

test('formatBlockUntil formats YYYY-MM-DD HH', () => {
  const date = new Date('2026-05-01T18:00:00Z');
  const result = formatBlockUntil(date);
  assert.match(result, /^\d{4}-\d{2}-\d{2} \d{2}$/);
});

// ---------- ceilToNextHour ----------

test('ceilToNextHour rounds up to next hour', () => {
  const now = new Date('2026-05-01T10:30:00Z');
  const result = ceilToNextHour(now);
  assert.equal(result.getUTCMinutes(), 0);
  assert.equal(result.getUTCHours(), 11);
});

test('ceilToNextHour same hour stays same', () => {
  const now = new Date('2026-05-01T10:00:00Z');
  const result = ceilToNextHour(now);
  assert.equal(result.getUTCMinutes(), 0);
  assert.equal(result.getUTCHours(), 10);
});

// ---------- detectLimitHit ----------

test('detectLimitHit returns null when status is 0 (success)', () => {
  const result = detectLimitHit({
    agent: 'claude',
    stdout: 'Claude usage limit reached',
    stderr: '',
    status: 0,
    signal: null,
    error: null
  });
  assert.equal(result, null);
});

test('detectLimitHit returns null when status is non-zero but no phrase match', () => {
  const result = detectLimitHit({
    agent: 'claude',
    stdout: 'Hello world',
    stderr: '',
    status: 1,
    signal: null,
    error: null
  });
  assert.equal(result, null);
});

test('detectLimitHit returns null when error is set (spawn error)', () => {
  const result = detectLimitHit({
    agent: 'claude',
    stdout: '',
    stderr: '',
    status: null,
    signal: null,
    error: new Error('ENOENT')
  });
  assert.equal(result, null);
});

test('detectLimitHit parses the reported Claude transcript and rounds the block to the next local hour', () => {
  const now = new Date('2026-05-01T16:30:00+02:00');
  const result = detectLimitHit({
    agent: 'claude',
    stdout: "You've hit your limit · resets 7:10pm (Europe/Stockholm)",
    stderr: '',
    status: 1,
    signal: null,
    error: null,
    now
  });

  assert.deepEqual(result, {
    until: '2026-05-01 20',
    source: 'parsed'
  });
});
