# CP-3: Post-Draft Label Sync in `draft.ts`

## Summary

Added the post-draft label sync in `src/platform/runtime/lib/commands/draft.ts` and a reusable `syncTaskLabelsToBaseWorktree` helper in `backlog.ts`.

### Changes

1. **`draft.ts` imports** (line 8): Added `getTaskLabels`, `setTaskLabels`, `commitTaskFileUpdate`, `syncTaskLabelsToBaseWorktree` from `backlog.js`.

2. **`draft.ts` post-draft sync** (line 355-370): After `normalizeDraftClassification` validates labels on the mission worktree, the new sync block:
   - Resolves the mission worktree task file
   - Reads labels with `getTaskLabels`
   - Calls `syncTaskLabelsToBaseWorktree(slug, missionWorktree)` which internally resolves the base worktree, writes labels, and commits
   - Logs a PASS status on success, WARN on failure (non-blocking per stop rules)

3. **`backlog.ts` `syncTaskLabelsToBaseWorktree`** (line 960): Standalone exported function that encapsulates the sync logic. Used by both `draft.ts` (production) and the regression test to verify the full sync flow.

### Stop Rules Applied

- If `resolveBaseWorktree` throws, logs a warning and continues (does not block the draft)
- If `setTaskLabels` fails, logs a warning and continues

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Post-draft sync copies labels to base worktree (SC4) | `src/platform/runtime/lib/commands/draft.ts:355-370`, `src/platform/runtime/lib/tools/backlog.ts:960` | PASS |
| Sync calls `syncTaskLabelsToBaseWorktree` (single implementation) | `src/platform/runtime/lib/commands/draft.ts:363` | PASS |
| Sync checks return value (logs WARN on failure) | `src/platform/runtime/lib/commands/draft.ts:364-367` | PASS |
| Sync is non-blocking (logs warning on failure) | `src/platform/runtime/lib/commands/draft.ts:369-370` | PASS |
| `syncTaskLabelsToBaseWorktree` exported from backlog.ts | `src/platform/runtime/lib/tools/backlog.ts:1165` | PASS |
| Sync test passes (SC4/SC5) | `test/task-2312-label-sync.test.ts`, `"syncTaskLabelsToBaseWorktree copies labels from mission to base worktree (SC4/SC5)"` | PASS |
| resolveBaseWorktree exercised in test | `test/task-2312-label-sync.test.ts:359`, `"syncTaskLabelsToBaseWorktree resolves base worktree via resolveBaseWorktree (SC4)"` | PASS |

## Next action

Update the reproduction test to verify the full sync behavior (green) and run `./scripts/verify-local.sh all` (CP-4).
