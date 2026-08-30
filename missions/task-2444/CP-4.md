# CP-4: Gates and final goal check

All declared verification is green. Review round 1 strengthened SC4 so each
queue-reachable reason kind has an exact dependency lock.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: Queue ranks are contiguous `1..N` ordinals | `test/task-2444-attention-queue-repro.test.ts`, `"task-2444: mixed-lane attention ranks are contiguous ordinals"` | PASS |
| SC2: Reasonless backlog entries are absent | `test/task-2444-attention-queue-repro.test.ts`, `"task-2444: all-backlog cards produce no attention items"` | PASS |
| SC3: A queued action is enabled in its card commands | `test/task-2444-attention-queue-repro.test.ts`, `"task-2444: queued action is enabled on its card"` | PASS |
| SC4: Every queued reason has dependencies | `test/task-2444-attention-queue-repro.test.ts`, `"task-2444: every queued reason carries source dependencies"` | PASS |
| SC5: Source facts have documented tuple identity | `test/task-2444-attention-queue-repro.test.ts`, `"task-2444: source facts are deduplicated by source status and value"`; `src/interfaces/web/transport.ts` | PASS |
| SC6: Existing bucket and domain attention coverage remains green | `test/board-projections.test.ts`, `test/domain-projections.test.ts` | PASS |
| Existing projection-reader and running-work expectations match the queue contract | `test/board-readers.test.ts`, `test/task-2368-agent-running-review-detection.test.ts`, `test/task-2411-integrate-work-detection.test.ts` | PASS |
| Declared project gate | `./scripts/verify-local.sh all` | PASS |
| Targeted reproduction gate | `npm test -- test/task-2444-attention-queue-repro.test.ts` | PASS |

Next action: Review the round-1 SC4 resolution and decide the next review disposition.
