# CP-2: Narrow retry/rebase implementation

## Summary

Implemented the backlog-only conflict classification and retry logic in the Step 2 probe-merge block of `integrate.ts`. When the dry-run merge detects conflicts, the code now:

1. Parses conflict files from the merge output using `parseConflictFilesFromMergeOutput`
2. Checks if all conflict files are under `backlog/` using the new `areAllBacklogOnlyConflicts()` helper
3. If backlog-only: re-fetches the base branch (`git fetch --all --prune`) and retries the probe merge once
4. On retry success: proceeds to Step 3 (squash-merge) with the updated base
5. On retry failure or non-backlog conflicts: falls through to the existing conflict-resolution flow (fail closed)

The existing `softResetTrailingBacklogNoise` path in Step 3 and the noise-patch capture/reset/restore cycle remain unchanged.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| `areAllBacklogOnlyConflicts` helper function | `src/platform/runtime/lib/commands/integrate.ts:163` — classifies conflict files as backlog-only when all match `^backlog/` | PASS |
| Conflict classification after probe merge | `src/platform/runtime/lib/commands/integrate.ts:757-758` — parses initial conflict output and classifies files | PASS |
| Re-fetch base branch on backlog-only | `src/platform/runtime/lib/commands/integrate.ts:762` — `git fetch --all --prune` when all conflicts are backlog/ | PASS |
| Retry probe merge once | `src/platform/runtime/lib/commands/integrate.ts:764` — second `git merge --no-commit --no-ff` after fetch | PASS |
| Retry success proceeds to Step 3 | `src/platform/runtime/lib/commands/integrate.ts:769-770` — sets `retried = true`, falls through to squash-merge | PASS |
| Non-backlog conflicts fall through to fail-closed | `src/platform/runtime/lib/commands/integrate.ts:779` — `if (retried)` empty block skips to `else` (Step 3) | PASS |
| `softResetTrailingBacklogNoise` path unchanged | `src/platform/runtime/lib/commands/integrate.ts:832` — Step 3 noise-patch cycle unmodified | PASS |
| `merge-noise.ts` not modified | `src/platform/runtime/lib/core/mission-utils/merge-noise.ts` — no changes (restricted area) | PASS |
| No new dependencies or CLI flags | No new imports or flag parsing added | PASS |

## Next action

Add integration regression test cases for overlapping code conflicts and mission task-file conflicts (CP-3), then run the final verification gate.
