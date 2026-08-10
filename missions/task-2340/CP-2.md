# Checkpoint 2: Auto-bounce flow in rebase.ts hook failure path

## Summary
Added `handleHookFailureAutoBounce()` to `rebase.ts` and wired it into the non-conflict error path. When a hook failure is detected (pre-commit, pre-push, post-commit, or generic hook keyword), the function reads `hookFailureRetryCount` from review state metadata, launches the implementer with a fix prompt containing hook output and retry attempt, increments retry count, and retries the rebase after implementer fix. Strands mission after 2 retries. Non-hook failures (status 128, merge conflicts) remain unchanged.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| `handleHookFailureAutoBounce` exported from `rebase.ts` | `src/adapters/cli/commands/rebase.ts:58` | PASS |
| Hook failure triggers auto-bounce (SC3) | `src/adapters/cli/commands/rebase.ts:324-344` | PASS |
| Fix prompt includes hook output | `src/adapters/cli/commands/rebase.ts:100-112` | PASS |
| Fix prompt includes retry attempt and max retries | `src/adapters/cli/commands/rebase.ts:115` | PASS |
| Retry count stored as `hookFailureRetryCount` (SC6) | `src/adapters/cli/commands/rebase.ts:119` | PASS |
| Mission strands after 2 retries (SC6) | `src/adapters/cli/commands/rebase.ts:82-87` | PASS |
| Rebase retried after implementer fix (SC5) | `src/adapters/cli/commands/rebase.ts:335-343` | PASS |
| Auto-bounce returns true when under budget | `test/task-2340-hook-rebounce.test.ts`, `"returns true (should retry) when under retry budget"` | PASS |
| Auto-bounce returns false when max retries exceeded | `test/task-2340-hook-rebounce.test.ts`, `"returns false (stranded) when max retries exceeded"` | PASS |
| Retry count increments on each bounce | `test/task-2340-hook-rebounce.test.ts`, `"increments retry count on each bounce"` | PASS |
| Non-hook errors do not trigger bounce (SC9) | `test/task-2340-hook-rebounce.test.ts`, `"Non-hook rebase errors do not trigger bounce — SC9"` | PASS |
| Verification gate passes | `./scripts/verify-local.sh all` — 1853 tests pass | PASS |

Next action: Implement auto-bounce flow in integrate.ts hook failure path (CP-3).
