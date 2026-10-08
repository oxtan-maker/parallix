import type { StatsMissionFlow } from '../ports/cli-workflows.js';
import { decisionWindowDay, reportingWindowContains } from '../../domain/decision-window.js';

export interface BugTrendPeriod {
  readonly start: string;
  readonly end: string;
  readonly completed: number;
  readonly bugs: number;
  readonly share: number | null;
}

/** Exact inclusive local calendar period; partial weeks are never discarded. */
export function selectBugTrend(
  outcomes: readonly StatsMissionFlow[] | null, start: Date, end: Date, timeZone?: string,
): readonly BugTrendPeriod[] | null {
  if (outcomes === null) { return null; }
  const completed = outcomes.filter(outcome => reportingWindowContains({ start, end, timeZone }, outcome.closedAt));
  const bugs = completed.filter(outcome => outcome.labels.includes('bug')).length;
  return [{ start: decisionWindowDay(start, 'UTC'), end: decisionWindowDay(end, 'UTC'),
    completed: completed.length, bugs, share: completed.length ? bugs / completed.length : null }];
}
