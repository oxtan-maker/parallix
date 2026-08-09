## CP-4 Summary

Corrected test expectations and added edge-case tests:

1. **`test/board-metrics.test.ts` FLOW projection test** (line 276): Changed `review=90` to `active=90` + added `review=120`. Dwell now attributed to state occupied: active median([60,120])=90, review median([120])=120.

2. **`test/board-event-metrics-fixture.test.ts`**: Added assertions for `medianCycleTimeByState` — active=120 (08:00→10:00), review=120 (10:00→12:00), validating correct attribution on fixture data.

3. **Out-of-order test** (`test/task-2347.03-inverted-dwell-repro.test.ts`): Transitions in reverse order produce same deterministic intervals after sorting by `occurredAt`.

4. **Duplicate test** (`test/task-2347.03-inverted-dwell-repro.test.ts`): Same `missionId+from+to+occurredAt` collapsed to single interval. Dwell computed correctly from deduplicated data.

All 35 tests across 3 test files pass.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC4: board-metrics.test.ts FLOW test corrected | `test/board-metrics.test.ts:279` — `active=90`, `test/board-metrics.test.ts:280` — `review=120` | PASS |
| SC5: fixture test validates attribution | `test/board-event-metrics-fixture.test.ts:206` — `cycleActive=120`, `test/board-event-metrics-fixture.test.ts:207` — `cycleReview=120` | PASS |
| SC6: out-of-order test | `test/task-2347.03-inverted-dwell-repro.test.ts` — `"out-of-order transitions produce deterministic interval sequence"` | PASS |
| SC6: duplicate test | `test/task-2347.03-inverted-dwell-repro.test.ts` — `"duplicate transitions collapsed"` | PASS |

Next action: CP-5 — update doc comment on `medianCycleTimeByStateSeries` and run verification gate.
