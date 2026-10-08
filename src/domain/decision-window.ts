/** Inclusive local calendar-day reporting range. */
export interface ReportingWindow {
  readonly start: Date;
  readonly end: Date;
  /** IANA timezone captured when this range was selected. */
  readonly timeZone?: string;
}

// ---------------------------------------------------------------------------
// The rolling decision window — one semantic owner for "the last seven days".
//
// `px stats` and the operator board answer the same question: how did the
// missions completed during the last seven days behave, and how does that
// compare with the seven days before them? Both read the window from here, so
// the CLI's decision cadence and FLOW's cannot drift apart.
//
// This is deliberately not a date/time framework. It owns exactly four things:
// the current rolling window, the previous non-overlapping one, containment of
// a completion instant, and the label an operator reads.
// ---------------------------------------------------------------------------

/** Days in one decision window. */
export const DECISION_WINDOW_DAYS = 7;

/**
 * A closed, inclusive range of local calendar days.
 *
 * `start` and `end` encode calendar labels as UTC midnight Dates, not local
 * boundary instants. This preserves the shape used to compare date-only
 * telemetry. `startDate`/`endDate` are the same two days as `YYYY-MM-DD`, and are
 * what `decisionWindowContains` compares a full completion instant against —
 * a mission that closed at 14:00 on the last day is inside the window.
 */
export interface DecisionWindow extends ReportingWindow {
  readonly startDate: string;
  readonly endDate: string;
  /** Operator-facing range, e.g. `2026-08-05 → 2026-08-11`. */
  readonly label: string;
}

export interface DecisionWindows {
  readonly current: DecisionWindow;
  readonly previous: DecisionWindow;
}

/** Resolve the operator machine's timezone; callers can inject a zone for replay. */
export function localReportingTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

const dayFormatters = new Map<string, Intl.DateTimeFormat>();

/** Date-only values are calendar labels; full timestamps are parsed as instants. */
export function decisionWindowDay(at: string | Date, timeZone = localReportingTimeZone()): string {
  if (typeof at === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(at)) {
    const date = new Date(`${at}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === at ? at : '';
  }
  const instant = at instanceof Date ? at : new Date(at);
  if (!Number.isFinite(instant.getTime())) { return ''; }
  let formatter = dayFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    });
    dayFormatters.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(instant);
  const part = (name: string) => parts.find(value => value.type === name)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function midnight(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

function shiftDays(day: string, days: number): string {
  const shifted = midnight(day);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

/** The `days`-long window whose last day is `endDate`, both ends inclusive. */
export function decisionWindowEndingOn(
  endDate: string | Date,
  days: number = DECISION_WINDOW_DAYS,
  timeZone = localReportingTimeZone(),
): DecisionWindow {
  if (!Number.isInteger(days) || days < 1) { throw new Error('Retention days must be a positive integer.'); }
  const end = decisionWindowDay(endDate, timeZone);
  if (!end) { throw new Error('Observation instant must be valid.'); }
  const start = shiftDays(end, -(days - 1));
  return {
    timeZone,
    start: midnight(start),
    end: midnight(end),
    startDate: start,
    endDate: end,
    label: `${start} → ${end}`,
  };
}

/**
 * The current rolling seven days (`today-6 → today`) and the immediately
 * preceding, non-overlapping seven (`today-13 → today-7`). Both inclusive.
 *
 * `today` comes from the caller's injected clock — the CLI's `--today`, the
 * board's projection clock — so nothing here reads wall-clock time.
 */
export function weeklyDecisionWindows(today: string | Date, timeZone = localReportingTimeZone()): DecisionWindows {
  const current = decisionWindowEndingOn(today, DECISION_WINDOW_DAYS, timeZone);
  return {
    current,
    previous: decisionWindowEndingOn(shiftDays(current.startDate, -1), DECISION_WINDOW_DAYS, timeZone),
  };
}

/** Every local calendar day in the window, first to last, both ends inclusive. */
export function decisionWindowDays(window: DecisionWindow): readonly string[] {
  const days: string[] = [];
  for (let day = window.startDate; day <= window.endDate; day = shiftDays(day, 1)) {
    days.push(day);
  }
  return days;
}

/**
 * Whether a completion instant falls inside the window.
 *
 * The comparison is by local calendar day, so the window selects whole days at
 * both ends: a mission that closed at any time on the last day is inside it.
 */
export function decisionWindowContains(window: DecisionWindow, at: string): boolean {
  const day = decisionWindowDay(at, window.timeZone);
  return day !== '' && day >= window.startDate && day <= window.endDate;
}

/** Oldest retained reporting day, including the observation day in the day count. */
export function decisionRetentionBoundary(at: string | Date, days: number, timeZone = localReportingTimeZone()): string {
  if (days === 0) { return shiftDays(decisionWindowEndingOn(at, 1, timeZone).endDate, 1); }
  return decisionWindowEndingOn(at, days, timeZone).startDate;
}

/** Containment for any explicitly selected inclusive calendar-day range. */
export function reportingWindowContains(window: ReportingWindow, at: string): boolean {
  const day = decisionWindowDay(at, window.timeZone);
  return day !== '' && day >= window.start.toISOString().slice(0, 10) && day <= window.end.toISOString().slice(0, 10);
}

/** Last instant of a reporting day, including 23/25-hour daylight-saving days. */
export function decisionWindowDayEnd(day: string, timeZone = localReportingTimeZone()): string {
  const nextDay = shiftDays(day, 1);
  const anchor = midnight(nextDay).getTime();
  // Search the local-date boundary instead of assuming any fixed UTC offset.
  let before = anchor - 36 * 60 * 60 * 1000;
  let after = anchor + 36 * 60 * 60 * 1000;
  while (after - before > 1) {
    const middle = Math.floor((before + after) / 2);
    if (decisionWindowDay(new Date(middle), timeZone) < nextDay) { before = middle; }
    else { after = middle; }
  }
  return new Date(before).toISOString();
}
