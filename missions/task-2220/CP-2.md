# CP-2: Atomic structured persistence

Replaced the direct review-state write with the shared atomic writer and introduced a discriminated persistence result covering committed, unchanged, write failure, add failure, and dirty commit failure. `writeReviewState()` now delegates the injected atomic writer and returns the same result. A non-zero commit is classified as unchanged only after a successful path-scoped status check reports clean. The CP-1 regression now passes.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Structured result defines all five required outcomes | `lib/review/review-state.ts:17` | PASS |
| Review-state JSON uses the shared atomic write mechanism | `lib/review/review-state.ts:15`, `lib/review/review-state.ts:312` | PASS |
| Git add failures are reported instead of proceeding to commit | `lib/review/review-state.ts:318` | PASS |
| Non-zero commit is unchanged only after a clean path-scoped status result | `lib/review/review-state.ts:336`, `lib/review/review-state.ts:343` | PASS |
| `writeReviewState()` returns the structured save result | `lib/review/review-state.ts:361`, `lib/review/review-state.ts:369` | PASS |
| Dirty commit reproduction is green | `node --test test/task-2220-repro.test.js`, "writeReviewState does not report success when commit fails and state path remains dirty" | PASS |

Next action: Add a shared fail-closed persistence assertion and migrate `recordLocalReviewVerdict`, `submitReviewRound`, review events, and every review-loop checkpoint to inspect structured outcomes with mission/phase/round diagnostics.
