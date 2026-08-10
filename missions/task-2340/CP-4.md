# Checkpoint 4: Propagate hook failure classification in review/rebase.ts

## Summary
Updated `rebaseBeforeReviewRound()` in `src/adapters/review/rebase.ts` to detect and propagate hook failure classification. Added `hookFailure: boolean` to the return type alongside existing `ok` and `sharedFileConflicts`. Uses `HOOK_FAILURE_RE` pattern matching (pre-commit, pre-push, post-commit, hook) on the rebase output. Updated all callers in `test/task-1107-repro.test.ts` to expect the new field.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| `rebaseBeforeReviewRound` returns `hookFailure` field | `src/adapters/review/rebase.ts:145` | PASS |
| Hook failure detected via `HOOK_FAILURE_RE` | `src/adapters/review/rebase.ts:30` | PASS |
| Hook failure reported in error output | `src/adapters/review/rebase.ts:200-201` | PASS |
| Existing tests updated for new return type | `test/task-1107-repro.test.ts` — 14 assertions updated | PASS |
| Verification gate passes | `./scripts/verify-local.sh all` — 1853 tests pass | PASS |

Next action: End-to-end verification and review handoff (CP-5).
