# CP 3 — Time-scoped historical metrics

Replaced the throughput stub with closure-time counting, limited median cycle
time and review-loop averages to outcomes closed by each instant, and grouped
weekly throughput by UTC ISO-week start. The regression suite now proves that a
future closure cannot influence an earlier historical point.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC3: weekly throughput is bucketed by closure week | `src/application/projections/metrics.ts:334`; `"throughput excludes active and review telemetry, and weekly buckets use closure week"` | PASS |
| SC4: throughput counts only closures at or before each instant | `src/application/projections/metrics.ts:204`; `"historical metrics exclude outcomes closed after each instant"` | PASS |
| SC5: median cycle time is time-scoped | `src/application/projections/metrics.ts:122`; `"historical metrics exclude outcomes closed after each instant"` | PASS |
| SC6: review-loop rate is time-scoped | `src/application/projections/metrics.ts:229`; `"historical metrics exclude outcomes closed after each instant"` | PASS |
| SC11: red reproduction is green | `node --import tsx --test test/task-2347.04-throughput-truthful.test.ts` | PASS |

Next action: Remove the constant-valued cumulative-flow series and align the board narrative and FLOW label with weekly closure semantics.
