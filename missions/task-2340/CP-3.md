# Checkpoint 3: Auto-bounce flow in integrate.ts hook failure path

## Summary
Added `handleHookFailureAutoBounce()` to `integrate.ts` and wired it into the squash commit hook failure path. When the squash commit fails due to a git hook, the function auto-bounces to the implementer with a fix prompt, then retries the commit. Same retry budget (2) and metadata key (`hookFailureRetryCount`) as rebase path.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| `handleHookFailureAutoBounce` exported from `integrate.ts` | `src/adapters/cli/commands/integrate.ts:67` | PASS |
| Hook failure in squash commit triggers auto-bounce (SC4) | `src/adapters/cli/commands/integrate.ts:1122-1149` | PASS |
| Fix prompt includes hook output | `src/adapters/cli/commands/integrate.ts:108-120` | PASS |
| Fix prompt includes retry attempt and max retries | `src/adapters/cli/commands/integrate.ts:123` | PASS |
| Retry count stored as `hookFailureRetryCount` (SC6) | `src/adapters/cli/commands/integrate.ts:127` | PASS |
| Mission strands after 2 retries (SC6) | `src/adapters/cli/commands/integrate.ts:91-96` | PASS |
| Commit retried after implementer fix (SC5) | `src/adapters/cli/commands/integrate.ts:1128-1142` | PASS |
| Auto-bounce returns true when under budget | `test/task-2340-hook-rebounce.test.ts`, `"returns true (should retry) when under retry budget"` (integrate suite) | PASS |
| Auto-bounce returns false when max retries exceeded | `test/task-2340-hook-rebounce.test.ts`, `"returns false (stranded) when max retries exceeded"` (integrate suite) | PASS |
| Verification gate passes | `./scripts/verify-local.sh all` — 1853 tests pass | PASS |

Next action: Update rebase.ts (review/rebase.ts) to propagate hook failure classification (CP-4).
