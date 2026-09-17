import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeImplementer,
  parseDateOnlyStrict,
  formatDateOnly,
  parseToday,
  createRangeWindow,
  buildWeeklyWindows,
  parseBooleanish,
  normalizeRow,
  normalizeRows,
  modelBelongsToImplFamily,
  isValidClassification,
  normalizeClassification,
  accumulateIntegerStrings,
  accumulateDecimalStrings,
  mergeLabel,
  sameStatsIdentity,
  STATS_HEADERS,
  USAGE_NUMBERS,
  VALID_CLASSIFICATIONS,
} from '../src/adapters/cli/commands/stats-normalization.js';

// Pure normalization helpers. These never touch git or the DB; only the
// row-normalizing helpers that resolve a canonical repo id are avoided here so
// the suite stays hermetic under the coverage gate.

test('STATS_HEADERS, USAGE_NUMBERS and VALID_CLASSIFICATIONS export their constants', () => {
  assert.ok(STATS_HEADERS.includes('input_tokens'));
  assert.ok(USAGE_NUMBERS.has('pr_fix_rounds'));
  assert.ok(VALID_CLASSIFICATIONS.has('ai_sdlc'));
});

test('normalizeImplementer trims, lowercases, strips a leading @ and nullifies empty', () => {
  assert.equal(normalizeImplementer('  @Claude  '), 'claude');
  assert.equal(normalizeImplementer('CODEX'), 'codex');
  assert.equal(normalizeImplementer(''), null);
  assert.equal(normalizeImplementer(undefined), null);
});

test('normalizeClassification accepts known classifications and rejects the rest', () => {
  assert.equal(normalizeClassification('ai_sdlc'), 'ai_sdlc');
  assert.equal(normalizeClassification('  USER_VALUE '), 'user_value');
  assert.equal(normalizeClassification('nonsense'), null);
  assert.equal(isValidClassification('user_value'), true);
  assert.equal(isValidClassification('nope'), false);
});

test('parseDateOnlyStrict accepts a valid calendar date and rejects malformed ones', () => {
  assert.equal(parseDateOnlyStrict('2026-03-01').toISOString().slice(0, 10), '2026-03-01');
  assert.throws(() => parseDateOnlyStrict('2026-03-1'), /expected YYYY-MM-DD/);
  assert.throws(() => parseDateOnlyStrict('2026-02-30'), /not a valid calendar date/);
  assert.throws(() => parseDateOnlyStrict(12345), /expected YYYY-MM-DD/);
});

test('formatDateOnly and parseToday round-trip through ISO day strings', () => {
  const d = parseDateOnlyStrict('2026-05-06');
  assert.equal(formatDateOnly(d), '2026-05-06');
  assert.equal(parseToday('2026-05-06').toISOString().slice(0, 10), '2026-05-06');
  assert.equal(parseToday(new Date('2026-05-06T10:00:00Z')).toISOString().slice(0, 10), '2026-05-06');
});

test('createRangeWindow validates from/to ordering and presence', () => {
  const { start, end, label } = createRangeWindow({ from: '2026-01-01', to: '2026-01-31' });
  assert.equal(start.toISOString().slice(0, 10), '2026-01-01');
  assert.equal(end.toISOString().slice(0, 10), '2026-01-31');
  assert.match(label, /2026-01-01 → 2026-01-31/);
  assert.throws(() => createRangeWindow({ to: '2026-01-31' }), /--from: value is required/);
  assert.throws(() => createRangeWindow({ from: '2026-01-01' }), /--to: value is required/);
  assert.throws(() => createRangeWindow({ from: '2026-02-10', to: '2026-01-10' }), /after end date/);
});

test('buildWeeklyWindows returns current and previous weekly windows', () => {
  const windows = buildWeeklyWindows(new Date('2026-05-06T00:00:00Z'));
  assert.equal(windows.current.end.toISOString().slice(0, 10), '2026-05-06');
  assert.equal(windows.previous.end.toISOString().slice(0, 10), '2026-04-29');
});

test('parseBooleanish maps the full truthy/falsy vocabulary and nullish inputs', () => {
  assert.equal(parseBooleanish(true), true);
  assert.equal(parseBooleanish('yes'), true);
  assert.equal(parseBooleanish('1'), true);
  assert.equal(parseBooleanish('merged'), true);
  assert.equal(parseBooleanish('no'), false);
  assert.equal(parseBooleanish('0'), false);
  assert.equal(parseBooleanish(''), null);
  assert.equal(parseBooleanish('—'), null);
  assert.equal(parseBooleanish('n/a'), null);
  assert.equal(parseBooleanish(null), null);
  assert.equal(parseBooleanish(undefined), null);
  assert.equal(parseBooleanish('maybe'), null);
});

test('normalizeRow parses review count, booleanish merged and derives normalized fields', () => {
  const merged = normalizeRow({ review_count: '3', merged: 'yes', date: '2026-05-06' });
  assert.equal(merged.review_count, '3');
  assert.equal(merged.normalizedMerged, 'yes');
  assert.equal(merged.isMerged, true);

  const noMerged = normalizeRow({ review_count: '2', has_pr: 'no' });
  assert.equal(noMerged.normalizedMerged, 'no');
  assert.equal(noMerged.isMerged, false);

  const reviewDriven = normalizeRow({ review_count: '1', has_pr: '' });
  assert.equal(reviewDriven.normalizedMerged, 'yes', 'a positive review count implies a merged PR');
});

test('normalizeRows maps a batch of rows', () => {
  const rows = normalizeRows([{ review_count: '1', merged: 'yes' }, { review_count: '0' }]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].normalizedMerged, 'yes');
  assert.equal(rows[1].normalizedMerged, 'no');
});

test('modelBelongsToImplFamily matches exact families and provider prefixes', () => {
  assert.equal(modelBelongsToImplFamily('claude', 'claude'), true);
  assert.equal(modelBelongsToImplFamily('gpt-4', 'codex'), true);
  assert.equal(modelBelongsToImplFamily('mistral', 'vibe'), true);
  assert.equal(modelBelongsToImplFamily('claude-3', 'custom'), false, 'custom excludes claude and gpt');
  assert.equal(modelBelongsToImplFamily('llama', 'custom'), true);
  assert.equal(modelBelongsToImplFamily('', 'claude'), false);
});

test('accumulateIntegerStrings honours mode and accumulates by default', () => {
  assert.equal(accumulateIntegerStrings('10', '5'), '15');
  assert.equal(accumulateIntegerStrings('10', '5', { mode: 'max' }), '10');
  assert.equal(accumulateIntegerStrings('10', '5', { mode: 'replace' }), '5');
  assert.equal(accumulateIntegerStrings('', '7'), '7');
});

test('accumulateDecimalStrings sums floating usage values', () => {
  assert.equal(accumulateDecimalStrings('1.5', '2.25'), '3.75');
  assert.equal(accumulateDecimalStrings('', '4'), '4');
});

test('mergeLabel merges matching, empty and conflicting labels', () => {
  assert.equal(mergeLabel('daily', 'daily'), 'daily');
  assert.equal(mergeLabel('', 'weekly'), 'weekly');
  assert.equal(mergeLabel('weekly', ''), 'weekly');
  assert.equal(mergeLabel('daily', 'weekly'), 'mixed');
});

test('sameStatsIdentity compares repo, mission, stage and normalized implementer', () => {
  const a = { repo: 'r', mission: 'mission a', stage: 'draft', implementer_agent: '@Claude' };
  const b = { repo: 'r', mission: 'mission a', stage: 'draft', implementer_agent: 'claude' };
  const c = { repo: 'r', mission: 'mission a', stage: 'review', implementer_agent: 'claude' };
  assert.equal(sameStatsIdentity(a, b), true, 'stage and implementer normalize equal');
  assert.equal(sameStatsIdentity(a, c), false, 'a different stage is a different identity');
});
