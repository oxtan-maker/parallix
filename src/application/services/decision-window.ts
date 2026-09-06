import type { ReportingWindow } from './statistics-service.js';

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
 * A closed, inclusive range of UTC calendar days.
 *
 * `start` and `end` are the midnight instants of the first and last day, which
 * is the shape `statisticsRowInWindow` already compares date-only telemetry
 * against. `startDate`/`endDate` are the same two days as `YYYY-MM-DD`, and are
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

/** The UTC calendar day of an instant, a date-only string, or a `Date`. */
export function decisionWindowDay(at: string | Date): string {
  return at instanceof Date ? at.toISOString().slice(0, 10) : String(at).slice(0, 10);
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
): DecisionWindow {
  const end = decisionWindowDay(endDate);
  const start = shiftDays(end, -(days - 1));
  return {
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
export function weeklyDecisionWindows(today: string | Date = new Date()): DecisionWindows {
  const current = decisionWindowEndingOn(today);
  return {
    current,
    previous: decisionWindowEndingOn(shiftDays(current.startDate, -1)),
  };
}

/** Every UTC calendar day in the window, first to last, both ends inclusive. */
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
 * The comparison is by UTC calendar day, so the window selects whole days at
 * both ends: a mission that closed at any time on the last day is inside it.
 */
export function decisionWindowContains(window: DecisionWindow, at: string): boolean {
  const day = decisionWindowDay(at);
  return day >= window.startDate && day <= window.endDate;
}
