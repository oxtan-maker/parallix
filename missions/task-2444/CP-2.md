# CP-2: Attention queue projection fixed

Filtered reasonless and non-runnable entries before sorting, retained the existing bucket ordering, then assigned ordinal ranks. Updated the affected projection assertion and fixture commands.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| All-backlog cards are excluded | `test/task-2444-attention-queue-repro.test.ts`, `"task-2444: all-backlog cards produce no attention items"` | PASS |
| Queue ranks are contiguous ordinals in priority order | `test/task-2444-attention-queue-repro.test.ts`, `"task-2444: mixed-lane attention ranks are contiguous ordinals"`; `test/board-projections.test.ts` | PASS |
| Queued action is enabled on its own card | `test/task-2444-attention-queue-repro.test.ts`, `"task-2444: queued action is enabled on its card"` | PASS |
| Every queued item has source dependencies | `test/task-2444-attention-queue-repro.test.ts`, `"task-2444: every queued reason carries source dependencies"` | PASS |
| Existing bucket behavior survives | `test/board-projections.test.ts`, `"attentionRank returns 0 for blocking reason present"`; `test/domain-projections.test.ts` | PASS |

Next action: Deduplicate projection source facts and document their tuple identity without changing transport shape.
