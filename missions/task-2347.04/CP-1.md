# CP 1 — Red reproduction test

Added the regression reproduction with closed, active, and review telemetry. It
currently fails on the parent implementation because all three records enter
throughput; it also specifies the expected ISO-week buckets for closures eight
weeks apart.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC11: active and review missions are excluded from completions | `test/task-2347.04-throughput-truthful.test.ts`; `"throughput excludes active and review telemetry, and weekly buckets use closure week"` | RED on parent |
| SC3: weekly throughput uses closure-week buckets | `test/task-2347.04-throughput-truthful.test.ts:36` | RED on parent |

Next action: Add closure timestamps to the outcome contract and have the metrics read adapter produce only closed outcomes.
