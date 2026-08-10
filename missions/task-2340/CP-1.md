# Checkpoint 1: classifyHookFailure() in rebase.ts and integrate.ts with unit tests

## Summary
Implemented `classifyHookFailure(output)` in both `rebase.ts` and `integrate.ts`. Function detects pre-commit, pre-push, post-commit, and generic hook keyword failures via string matching. Returns structured `{ isHookFailure: boolean, hookType: string | null }`. Deleted wrong-scope modules (`automated-operation-recovery.ts`, `automated-operation-repair.ts` and their tests) that substituted lifecycle hooks for git hooks.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| `classifyHookFailure` exported from `rebase.ts` | `src/adapters/cli/commands/rebase.ts:21` | PASS |
| `classifyHookFailure` exported from `integrate.ts` | `src/adapters/cli/commands/integrate.ts:32` | PASS |
| Detects pre-commit output | `test/task-2340-hook-rebounce.test.ts`, `"detects pre-commit hook failure"` | PASS |
| Detects pre-push output | `test/task-2340-hook-rebounce.test.ts`, `"detects pre-push hook failure"` | PASS |
| Detects post-commit output | `test/task-2340-hook-rebounce.test.ts`, `"detects post-commit hook failure"` | PASS |
| Detects generic hook keyword | `test/task-2340-hook-rebounce.test.ts`, `"detects generic hook keyword"` | PASS |
| Non-hook output returns false | `test/task-2340-hook-rebounce.test.ts`, `"returns false for non-hook output"` | PASS |
| Wrong-scope modules deleted | `git diff HEAD --stat` shows 364+427+525+396 lines removed | PASS |
| Verification gate passes | `./scripts/verify-local.sh all` — 1853 tests pass | PASS |

Next action: Implement auto-bounce flow in rebase.ts hook failure path (CP-2).
