# CP-3: Adapter refactored

## Summary

Rewrote `usageRecordsToOutcomes` in
`src/application/projections/metrics-read-adapter.ts` so the two quantities it
used to conflate are computed from their own sources.

**Lifecycle cycle time from lane events.** A new `missionLifecycles` helper
(`src/application/projections/metrics-read-adapter.ts:290`) indexes, per
mission, the earliest lane event and the event that moved it to `done`, scoped
to the projection's repository. `usageRecordsToOutcomes` now takes the lane
entries and sets `createdAt`, `closedAt` and
`cycleTimeMinutes = elapsedMinutes(createdAt, closedAt)` from that window. The
old accumulator line that summed `record.duration_minutes` into
`cycleTimeMinutes` is gone. When a mission has no lane events, the outcome falls
back to the first and last usage-row dates, matching the mission's stated
assumption about pre-lane-recording telemetry.

**Runs populated.** `usageRecordToRun`
(`src/application/projections/metrics-read-adapter.ts:360`) maps one usage row
to one `AgentRunMeasurement` using the CP-2 field table: duration, all four
token counts, tool calls, provider/model, provider-usage percentages, cost,
stage and role. Absent columns become
`{ kind: 'unavailable', reason: '<column> missing on usage record' }` via
`optional()` (`:332`) rather than a fabricated `0`, so `sumMeasured`
(`src/domain/usage.ts:142`) still returns `null` for a partially measured
mission. `runs: []` no longer appears anywhere in the adapter.

**Instants corrected.** `deriveInstants` now also emits each outcome's exact
`closedAt` (`src/application/projections/metrics-read-adapter.ts:256`).
Transition timestamps are truncated to the hour, so a mission closing at 12:34
would otherwise sit after every instant in the series and vanish from the very
metric that reports its cycle time.

**Outcomes observable.** Added `readOutcomes()`
(`src/application/projections/metrics-read-adapter.ts:133`) so SC3 can be
asserted on the outcomes directly instead of only through aggregated medians.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC2: `cycleTimeMinutes` computed from lifecycle events, not summed durations | `src/application/projections/metrics-read-adapter.ts:290` (`missionLifecycles`), `src/application/projections/metrics-read-adapter.ts:318` (`elapsedMinutes`), `"SC1: cycle time reflects the lifecycle wall clock, not the summed agent runtime"` | PASS |
| SC1: 1560-minute lifecycle wins over 37 minutes of agent runtime | `test/task-2347.05-cycle-time-vs-runtime.test.ts:144`, `"SC1: cycle time reflects the lifecycle wall clock, not the summed agent runtime"` | PASS |
| SC2: one `AgentRunMeasurement` per usage record, all dimensions preserved | `src/application/projections/metrics-read-adapter.ts:360` (`usageRecordToRun`), `"SC2/SC3: every outcome carries one AgentRunMeasurement per usage record"` | PASS |
| SC3: no outcome returned with `runs: []` | `test/task-2347.05-cycle-time-vs-runtime.test.ts:162` (`outcomes.every((o) => o.runs.length > 0)`) | PASS |
| Missing columns stay unavailable rather than becoming zero | `src/application/projections/metrics-read-adapter.ts:332` (`optional`), `"SC2: lifecycle cycle time survives usage rows whose durations are absent"` | PASS |
| Lane-event-free telemetry falls back to usage dates | `"SC2: cycle time falls back to usage-row dates when lane events are missing"` | PASS |
| Closure instants are not truncated out of the series | `src/application/projections/metrics-read-adapter.ts:256` (`deriveInstants` adds `outcome.closedAt`) | PASS |
| Existing metrics fixtures still pass | `npx tsx --test test/board-event-metrics-fixture.test.ts test/board-metrics.test.ts` — 0 failures | PASS |
| Types and lint clean on the changed file | `npm run typecheck`, `npx eslint src/application/projections/metrics-read-adapter.ts` — no output | PASS |

Next action: CP-4 — confirm `medianStateTimes` (`src/application/projections/metrics.ts:119`) now reports the lifecycle span and add the separate `medianAgentRuntime` series it must not be confused with.
