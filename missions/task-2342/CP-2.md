## Summary

Fixed `persistReviewStateOrThrow` to accept `missionStore` as 5th parameter and forward it to `writeFn(slug, state, worktree, missionStore)`. Threaded `missionStore` through all call sites across `review-loop.ts` (19 sites), `review-commands.ts` (4 sites), and `review-artifacts.ts` (1 site). Bound `writeReviewState` in `reviewLoopBindings` updated to accept 4th param.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: persistReviewStateOrThrow accepts missionStore as 5th param | `src/adapters/review/review-state.ts:81` | PASS |
| SC2: All 19 call sites in review-loop.ts pass missionStore | `src/adapters/review/review-loop.ts:95,206,225,471,473,822,1052,1072,1173,1302,1384,1480,1545,1592,1623,1636,1643,1699,1709` | PASS |
| SC3: Call sites in review-commands.ts and review-artifacts.ts pass missionStore | `src/adapters/review/review-commands.ts:1160,1251,1358,1432` and `src/adapters/review/review-artifacts.ts:202` | PASS |
| Repro test passes | `test/task-2342-missionstore-repro.test.ts`, `"persistReviewStateOrThrow passes missionStore to writeFn"` | PASS |
| Existing tests pass | `test/review-state.test.ts` — 10/10 pass | PASS |

Next action: Add dedup key to `consumeHumanNotes` in `review-events.ts` and add unit test (CP-3).
