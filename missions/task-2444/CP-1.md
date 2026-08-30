# CP-1: Reproduction locked

Added the projection-level repro fixture without production changes. All five scenarios are red against the parent implementation.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| All-backlog cards are excluded | `test/task-2444-attention-queue-repro.test.ts`, `"task-2444: all-backlog cards produce no attention items"` | RED (2 queued) |
| Queue ranks are contiguous ordinals | `test/task-2444-attention-queue-repro.test.ts`, `"task-2444: mixed-lane attention ranks are contiguous ordinals"` | RED (`[0,1,2,3,4,4]`) |
| Queued action is runnable | `test/task-2444-attention-queue-repro.test.ts`, `"task-2444: queued action is enabled on its card"` | RED (non-runnable item present) |
| Every queued item has sources | `test/task-2444-attention-queue-repro.test.ts`, `"task-2444: every queued reason carries source dependencies"` | RED (reasonless item has no sources) |
| Source facts have tuple identity | `test/task-2444-attention-queue-repro.test.ts`, `"task-2444: source facts are deduplicated by source status and value"` | RED (duplicate retained) |

Next action: Filter and ordinal-rank actionable reason-bearing projection entries in `buildBoardProjection`.
