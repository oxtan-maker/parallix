import type { StatsMissionFlow } from '../ports/cli-workflows.js';

export interface BugTrendWeek {
  readonly start: string;
  readonly end: string;
  readonly completed: number;
  readonly bugs: number;
  readonly share: number | null;
  readonly trailingAverage: number | null;
  readonly direction: 'falling' | 'rising' | 'flat' | null;
}

const DAY = 86_400_000;

/** Mean of observed shares in the last three calendar weeks; empty weeks are unknown. */
export function trailingBugShare(shares: readonly (number | null)[]): readonly (number | null)[] {
  return shares.map((_, index) => {
    const observed = shares.slice(Math.max(0, index - 2), index + 1).filter((share): share is number => share !== null);
    return observed.length ? observed.reduce((sum, share) => sum + share, 0) / observed.length : null;
  });
}

/** Only complete Monday–Sunday UTC weeks contained in the reporting span. */
export function selectBugTrend(
  outcomes: readonly StatsMissionFlow[] | null, start: Date, end: Date,
): readonly BugTrendWeek[] | null {
  if (outcomes === null) { return null; }
  const monday = start.getTime() + ((8 - start.getUTCDay()) % 7) * DAY;
  const weeks: Omit<BugTrendWeek, 'trailingAverage' | 'direction'>[] = [];
  for (let at = monday; at + 6 * DAY <= end.getTime(); at += 7 * DAY) {
    const next = at + 7 * DAY;
    const completed = outcomes.filter(outcome => {
      const closed = Date.parse(outcome.closedAt);
      return closed >= at && closed < next;
    });
    const bugs = completed.filter(outcome => outcome.labels.includes('bug')).length;
    weeks.push({ start: new Date(at).toISOString().slice(0, 10), end: new Date(next - DAY).toISOString().slice(0, 10),
      completed: completed.length, bugs, share: completed.length ? bugs / completed.length : null });
  }
  const averages = trailingBugShare(weeks.map(week => week.share));
  return weeks.map((week, index) => {
    const average = averages[index];
    const previous = averages[index - 1];
    return { ...week, trailingAverage: average, direction: average === null || previous === null || previous === undefined ? null
      : average < previous ? 'falling' : average > previous ? 'rising' : 'flat' };
  });
}
