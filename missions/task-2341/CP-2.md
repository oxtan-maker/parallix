# CP-2 — Review adapter store wiring

`ConcreteReviewReadAdapter` now requires the composition-supplied `MissionStore`, retains it as adapter state, and forwards it to `readReviewState()` in both the full-review and approval-only paths.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Adapter options declare the store dependency | `src/adapters/backlog/concrete-review-read-adapter.ts:56` | PASS |
| Full review loading forwards the store | `src/adapters/backlog/concrete-review-read-adapter.ts:90` | PASS |
| Approval loading forwards the store | `src/adapters/backlog/concrete-review-read-adapter.ts:99` | PASS |
| Reproduction test is green at adapter level | `test/task-2341-review-store-wiring.test.ts:49`, `npm test -- test/task-2341-review-store-wiring.test.ts` | PASS |

Next action: construct a mission store in board-projection composition and provide it to this adapter.
