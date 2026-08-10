## CP-3: Lifecycle fallback, terminal lane exclusion, all criteria green

### Summary
- **Terminal lane exclusion**: `bottleneckNarrative` filters out `done` and `integration` lanes via `TERMINAL_LANES` constant (`src/application/projections/metrics.ts:45`). Oldest lane selection skips terminal lanes (`:449`).
- **Lifecycle fallback**: `medianAgeByLaneSeries` accepts `initialStates` and `lifecycleEntries` params (`:404`). Missions without transitions use lifecycle entry timestamp as `enteredAt` (`:424-437`).
- **Adapter wiring**: `ConcreteMetricsReadAdapter` accepts optional `historyRepo` (`:53`), queries operational history for lifecycle entries via `deriveLifecycleEntries` (`:296`), passes to `buildMetrics`.
- **Composition**: `board-projection.ts` wires `historyRepo` into adapter.
- **All tests green**: 35 metric/repro tests pass, 1827 total tests pass. Verification gate clean.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: medianAgeByLaneSeries accepts asOf, computes age correctly | `src/application/projections/metrics.ts:404`, test `"age: mission 3 days (4320 min) before asOf reports age >= 4300 min (SC1)"` in `test/task-2347-06-repro.test.ts` | PASS |
| SC2: Clock injected into ConcreteMetricsReadAdapter | `src/application/projections/metrics-read-adapter.ts:51` (clock option), `:103` (asOf: this.clock()), test `"ConcreteMetricsReadAdapter: asOf from injected clock not instants.at(-1) (SC2)"` in `test/task-2347-06-repro.test.ts` | PASS |
| SC3: Lifecycle fallback for missions without transitions | `src/application/projections/metrics.ts:424-437` (lifecycle entries loop), `src/application/projections/metrics-read-adapter.ts:296` (deriveLifecycleEntries), test `"medianAgeByLaneSeries: mission with no transition uses lifecycle entry timestamp (SC3)"` in `test/task-2347-06-repro.test.ts` | PASS |
| SC4: Terminal lanes excluded from bottleneck | `src/application/projections/metrics.ts:45` (TERMINAL_LANES), `:449` (filter excludes terminal), test `"bottleneck: done lane NOT selected as bottleneck when active has stall (SC4)"` in `test/task-2347-06-repro.test.ts` | PASS |
| SC5: Empty lane reports null, bottleneck unavailable | `src/application/projections/metrics.ts:449` (terminal filter), `:456` (unavailable sentence), test `"bottleneck: unavailable when all non-terminal lanes have no age (SC5)"` in `test/task-2347-06-repro.test.ts` | PASS |
| SC6: formatDuration returns correct human-readable strings | `src/application/projections/metrics.ts:48` (formatDuration impl), tests `"formatDuration: <60 min returns integer minutes (SC6)"`, `"formatDuration: 60-1439 min returns hours with 1 decimal (SC6)"`, `"formatDuration: >=1440 min returns days with 1 decimal (SC6)"` in `test/task-2347-06-repro.test.ts` | PASS |
| SC7: Verification gate passes | `./scripts/verify-local.sh all` — 1827 tests pass, 0 fail | PASS |
| Static analysis gate passes | `./scripts/verify-local.sh static-analysis` — ESLint + tsc + test-hygiene + test typecheck all clean | PASS |

### Verification Gate

```
./scripts/verify-local.sh all
tests 1827, suites 51, pass 1827, fail 0
```

```
./scripts/verify-local.sh static-analysis
ESLint clean, tsc typecheck clean, test-hygiene clean, test typecheck clean
ALL STAGES PASSED
```

Next action: Mission complete. All success criteria verified. Update backlog task and prepare for handoff.
