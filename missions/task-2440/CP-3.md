# CP-3: Regression and gate coverage

## Summary

Completed the external lifecycle regression with its sibling-Mission and board-read assertions. Registered the temporary Git-and-SQLite repro in the integration suite and moved the existing concrete worktree-board repro out of the hermetic unit tier.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Supported external write is followed by a board read | `test/task-2440-repro.test.ts`, test `external lifecycle update moves only its persisted board card` | PASS |
| Updated Mission reaches the new board lane | `test/task-2440-repro.test.ts`, `node --import tsx --test test/task-2440-repro.test.ts` | PASS |
| Sibling Mission retains its board lane | `test/task-2440-repro.test.ts` | PASS |
| Regression is registered in the integration test plan | `test/default-test-suite.test.ts`, `node --import tsx --test test/default-test-suite.test.ts test/task-2440-repro.test.ts` | PASS |
| Concrete worktree-board repro is outside the unit timing tier | `test/lib/test-run-plan.ts`, `test/default-test-suite.test.ts` | PASS |
| Hermetic unit tests retain the 1-second budget without worker contention | `test/lib/test-run-plan.ts`, `test/default-test-suite.test.ts` | PASS |
| Required repository gate | `./scripts/verify-local.sh all` | PASS |

Next action: hand off the committed mission for review.
