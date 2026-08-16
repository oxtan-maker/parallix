# CP-8 — Lifecycle statistics proof

## Summary

R2 test (`test/task-2376-lifecycle-timing.test.ts`) proves the exact lifecycle dwell statistics using the deterministic fixture:

- 10:00 review start
- 10:30 approve (ReviewerDecision.decidedAt)
- 14:00 integrate command
- 14:15 done

Asserts:
- review dwell = 30m (via `deriveLaneIntervals` and `medianCycleTimeByStateSeries`)
- integration dwell = 225m (same projections consumed by Board/FLOW)

R2 sensitivity test proves old-bug behavior: wall-clock approve (14:00) shifts dwell to review=240m, integration=15m.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| review dwell = 30m | `test/task-2376-lifecycle-timing.test.ts` `"R2: delayed integration dwell — review 30m, integration 225m"` | PASS |
| integration dwell = 225m | same test | PASS |
| Old-bug sensitivity (wall-clock) | `test/task-2376-lifecycle-timing.test.ts` `"R2 sensitivity: wall-clock approve shifts dwell from 30m/225m to 240m/15m"` | PASS |
| medianCycleTimeByStateSeries matches | same test asserts both deriveLaneIntervals and medianCycleTimeByStateSeries | PASS |

Next action: CP-9 — contradiction/dead-code sweep.
