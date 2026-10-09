/**
 * Canonical UTC instant handling for persisted mission timestamps (TASK-2688).
 *
 * Mission lifecycle (`board_lane_events.occurred_at`) and administrative
 * closure (`missions.closed_at`) historically stored two ISO-8601 spellings:
 * UTC `Z` instants (from `Date.prototype.toISOString`) and explicit-offset
 * instants (from `git show --format=%cI`, e.g. `2026-10-09T09:07:00+02:00`).
 * Mixed spellings break two invariants:
 *
 *   1. Lexical ordering equals temporal ordering only for a single fixed-width
 *      UTC spelling, so `ORDER BY occurred_at` and string compares misorder
 *      across formats.
 *   2. Reporting must keep reading every spelling during the transition, while
 *      new writes and the stored form agree on one precision.
 *
 * The canonical form is `Date.prototype.toISOString`: `YYYY-MM-DDTHH:mm:ss.sssZ`
 * — explicit millisecond precision, explicit `Z`, fixed width so lexical order
 * matches temporal order. This module is the single source of truth for that
 * contract and stays pure (no filesystem/adapter edges) so callers in the
 * domain, application and adapter layers can share one parsing rule.
 */

/**
 * Parse a single-ISO-8601 instant (`Z` or explicit offset) to epoch
 * milliseconds. Returns `NaN` for a value that is not a parseable instant so
 * callers can report it rather than coerce it. Requires a `T` time designator:
 * a bare calendar date (`2026-10-09`) is not an instant and must not be
 * silently coerced to midnight UTC.
 */
export function parseInstantMs(value: unknown): number {
  if (typeof value !== 'string') { return Number.NaN; }
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:?\d{2})$/i.exec(value);
  if (!match) { return Number.NaN; }
  const [, year, month, day, hour, minute, second, , zone] = match;
  const calendar = `${year}-${month}-${day}T00:00:00.000Z`;
  const calendarMs = Date.parse(calendar);
  if (!Number.isFinite(calendarMs) || new Date(calendarMs).toISOString() !== calendar
    || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) {
    return Number.NaN;
  }
  if (zone!.toUpperCase() !== 'Z') {
    const digits = zone!.replace(/[^0-9]/g, '');
    if (Number(digits.slice(0, 2)) > 23 || Number(digits.slice(2)) > 59) { return Number.NaN; }
  }
  return Date.parse(value);
}

/** True when `value` is a non-empty string that parses as one instant. */
export function isValidIsoInstant(value: unknown): boolean {
  return !Number.isNaN(parseInstantMs(value));
}

/**
 * Normalize any single-ISO-8601 instant to the canonical UTC form
 * `YYYY-MM-DDTHH:mm:ss.sssZ`. Throws on a value that is not a parseable
 * instant so a malformed historical value is reported, never silently
 * rewritten. The output is fixed width, so lexical order equals temporal
 * order for the stored column.
 */
export function toCanonicalUtcInstant(value: unknown): string {
  const ms = parseInstantMs(value);
  if (Number.isNaN(ms) || (typeof value === 'string' && /\.\d{3}\d*[1-9]\d*(?:Z|[+-]\d{2}:?\d{2})$/i.test(value))) {
    throw new Error(
      `Not a parseable ISO-8601 instant: ${JSON.stringify(value)}`,
    );
  }
  return new Date(ms).toISOString();
}

/** True when `value` is already the canonical UTC `Z` spelling. */
export function isCanonicalUtcInstant(value: unknown): boolean {
  if (typeof value !== 'string') { return false; }
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && Number.isFinite(parseInstantMs(value));
}
