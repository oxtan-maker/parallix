## CP-2 Summary

Introduced `LaneInterval` type and `deriveLaneIntervals()` function in `src/application/projections/metrics.ts`.

**LaneInterval type** (`metrics.ts:39`): `{ state: BoardLane; enteredAt: string; exitedAt: string | null }`. Open intervals (exitedAt: null) mark current lane.

**deriveLaneIntervals** (`metrics.ts:50`): Takes ordered `MissionTransition[]`, groups by missionId, replays transitions chronologically. For each transition, closes the previous open interval and opens a new one for `transition.to`. Remaining open intervals after all transitions are current lanes. Deduplicates by `missionId|from|to|occurredAt`. Sorts by `occurredAt` then `missionId` for determinism.

**Red-to-green verified**: `test/task-2347.03-inverted-dwell-repro.test.ts` all 3 tests now pass (were 2 failing).

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC2: LaneInterval type with correct shape | `src/application/projections/metrics.ts:39` — `export interface LaneInterval { state: BoardLane; enteredAt: string; exitedAt: string \| null }` | PASS |
| SC2: Interval derivation from ordered transitions | `src/application/projections/metrics.ts:50` — `deriveLaneIntervals()` groups by missionId, sorts by occurredAt, deduplicates | PASS |
| SC2: Current-lane interval marked open | `src/application/projections/metrics.ts:82` — remaining open intervals pushed with `exitedAt: null` | PASS |
| SC1: Repro test now green | `test/task-2347.03-inverted-dwell-repro.test.ts` — 3/3 pass | PASS |

Next action: CP-3 — rewrite `medianCycleTimeByStateSeries` to consume lane intervals (done inline with CP-2).
