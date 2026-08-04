# CP-1 — Reproduction test

Added a focused regression test that provides a `MissionStore` containing a mission with persisted review data and asserts that `ConcreteReviewReadAdapter.loadReview()` returns a non-null domain review.

The test is deliberately red on the parent implementation: the adapter has no `missionStore` option and therefore calls `readReviewState()` without the store, which returns `null` before querying persistence.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Reproduction test exists | `test/task-2341-review-store-wiring.test.ts:49` | PASS |
| Test uses a MissionStore with persisted review data | `test/task-2341-review-store-wiring.test.ts:40` | PASS |
| Parent behaviour is demonstrably red | `npm test -- test/task-2341-review-store-wiring.test.ts` | PASS (expected failure) |

Next action: add the `MissionStore` dependency to `ConcreteReviewReadAdapter` and forward it to both review-state reads.
