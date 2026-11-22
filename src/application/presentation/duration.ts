const SECOND = 1000, MINUTE = 60 * SECOND, HOUR = 60 * MINUTE, DAY = 24 * HOUR;
/** Each unit with the smaller unit its remainder is shown in; a month is 30 days and a year 12 months. */
const UNITS: readonly (readonly [string, number, string, number])[] = [
  ['y', 360 * DAY, 'mo', 30 * DAY], ['mo', 30 * DAY, 'd', DAY], ['d', DAY, 'h', HOUR], ['h', HOUR, 'm', MINUTE], ['m', MINUTE, 's', SECOND],
];

/**
 * A duration in milliseconds as its two largest readable units: `250ms`, `1.5s`, `12m04s`, `3h05m`, `5d05h`, `2mo11d`,
 * `1y02mo`. The unit is chosen after rounding, so a value never prints as `1000ms`, `60.0s` or `1m60s`, and a measured
 * sub-millisecond value is not zero.
 */
export function formatDuration(ms: number): string {
  const wholeMs = Math.round(ms);
  if (wholeMs < 1000) { return ms > 0 && wholeMs === 0 ? '<1ms' : `${wholeMs}ms`; }
  const tenths = Math.round(ms / 100);
  if (tenths < 600) { return `${(tenths / 10).toFixed(1)}s`; }
  for (const [unit, size, smaller, smallerSize] of UNITS) {
    const total = Math.round(ms / smallerSize), perUnit = size / smallerSize;
    if (total >= perUnit) { return `${Math.floor(total / perUnit)}${unit}${String(total % perUnit).padStart(2, '0')}${smaller}`; }
  }
  return `${(tenths / 10).toFixed(1)}s`;
}
