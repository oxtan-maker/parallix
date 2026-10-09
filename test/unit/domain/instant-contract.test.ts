import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isCanonicalUtcInstant,
  isValidIsoInstant,
  parseInstantMs,
  toCanonicalUtcInstant,
} from '../../../src/domain/instant.js';

// Pure instant contract: parse any ISO-8601 instant, normalize to canonical UTC
// `Z` with millisecond precision, and reject silent timezone inference.
test('parseInstantMs reads both UTC Z and explicit-offset spellings (TASK-2688)', () => {
  assert.equal(parseInstantMs('2026-10-09T07:07:00.000Z'), Date.parse('2026-10-09T07:07:00.000Z'));
  assert.equal(
    parseInstantMs('2026-10-09T09:07:00+02:00'),
    Date.parse('2026-10-09T07:07:00.000Z'),
  );
  assert.equal(parseInstantMs('not-a-date'), Number.NaN);
  assert.equal(parseInstantMs(''), Number.NaN);
  assert.equal(parseInstantMs(42), Number.NaN);
});

test('toCanonicalUtcInstant collapses every spelling to fixed-width UTC Z (TASK-2688)', () => {
  assert.equal(toCanonicalUtcInstant('2026-10-09T09:07:00+02:00'), '2026-10-09T07:07:00.000Z');
  assert.throws(() => toCanonicalUtcInstant('2026-10-09T07:07:00.123456Z'));
  assert.equal(toCanonicalUtcInstant('2026-10-09T07:07:00.123000Z'), '2026-10-09T07:07:00.123Z');
  assert.equal(toCanonicalUtcInstant('2026-10-09T07:07:00+0000'), '2026-10-09T07:07:00.000Z');
  // Output is fixed width, so lexical order equals temporal order.
  assert.match(toCanonicalUtcInstant('2026-10-09T09:07:00+02:00'), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
});

test('toCanonicalUtcInstant reports a malformed value instead of coercing it (TASK-2688)', () => {
  assert.throws(() => toCanonicalUtcInstant('2026-10-09'), /parseable ISO-8601 instant/);
  assert.throws(() => toCanonicalUtcInstant(''), /parseable ISO-8601 instant/);
});

test('isCanonicalUtcInstant accepts only the canonical UTC spelling (TASK-2688)', () => {
  assert.equal(isCanonicalUtcInstant('2026-10-09T07:07:00.000Z'), true);
  assert.equal(isCanonicalUtcInstant('2026-10-09T09:07:00+02:00'), false);
  assert.equal(isCanonicalUtcInstant('2026-10-09T07:07:00Z'), false);
  assert.equal(isCanonicalUtcInstant('2026-10-09'), false);
  assert.equal(isCanonicalUtcInstant('nope'), false);
});

test('isValidIsoInstant distinguishes parseable instants from the rest (TASK-2688)', () => {
  assert.equal(isValidIsoInstant('2026-10-09T09:07:00+02:00'), true);
  assert.equal(isValidIsoInstant('2026-10-09T07:07:00.000Z'), true);
  assert.equal(isValidIsoInstant('2026-10-09'), false);
  assert.equal(isValidIsoInstant(''), false);
});

test('rejects timezone inference, invalid calendars and precision loss (TASK-2688)', () => {
  for (const raw of ['2026-10-09T07:00:00', '2026-02-30T07:00:00.000Z', '2026-10-09T24:00:00Z']) {
    assert.equal(parseInstantMs(raw), Number.NaN);
    assert.throws(() => toCanonicalUtcInstant(raw));
    assert.equal(isCanonicalUtcInstant(raw), false);
  }
  assert.throws(() => toCanonicalUtcInstant('2026-10-09T07:07:00.000001+02:00'));
});
