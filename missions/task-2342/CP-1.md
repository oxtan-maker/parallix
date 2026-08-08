## Summary

Author failing reproduction test for `persistReviewStateOrThrow` missing `missionStore`. Test verifies that `writeFn` receives 4 arguments (slug, state, worktree, missionStore). Currently fails because `persistReviewStateOrThrow` passes only 3 args to `writeFn`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Repro test file created | `test/task-2342-missionstore-repro.test.ts` | PASS |
| Test fails on current tree (red) | `"persistReviewStateOrThrow passes missionStore to writeFn"` — `writeFn should receive 4 arguments` 3 !== 4 | PASS |
| Test committed | `d291e4e63` | PASS |

Next action: Fix `persistReviewStateOrThrow` signature in `review-state.ts` and update all call sites in `review-loop.ts`, `review-commands.ts`, `review-artifacts.ts` (CP-2).
