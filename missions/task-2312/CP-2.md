# CP-2: Implement `setTaskLabels` in `backlog.ts`

## Summary

Implemented `setTaskLabels(taskFilePath, labels)` in `src/platform/runtime/lib/tools/backlog.ts` and exported it. The function:

1. **Detects existing format** — checks for inline (`labels: [a, b]`) or block (`labels:\n  - a\n  - b`) YAML
2. **Preserves format** — writes labels in the same style as the existing field
3. **Inserts when missing** — adds `labels: [a, b]` after `created_date` (falls back to after `id`)
4. **Returns boolean** — `true` on success, `false` on failure

Added unit tests in `test/task-2312-label-sync.test.ts` covering:
- Inline format writing (SC1)
- Block format writing (SC2)
- Field insertion when no labels field exists (SC2)
- Round-trip with `getTaskClassification` (SC3)

All 5 tests pass (the sync test is skipped until CP-3).

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| `setTaskLabels` writes inline format (SC1) | `src/platform/runtime/lib/tools/backlog.ts:914`, `test/task-2312-label-sync.test.ts`, `"setTaskLabels writes inline format correctly (SC1)"` | PASS |
| `setTaskLabels` writes block format (SC2) | `src/platform/runtime/lib/tools/backlog.ts:925`, `test/task-2312-label-sync.test.ts`, `"setTaskLabels writes block format correctly (SC2)"` | PASS |
| `setTaskLabels` inserts after created_date | `src/platform/runtime/lib/tools/backlog.ts:931-936`, `test/task-2312-label-sync.test.ts`, `"setTaskLabels inserts labels field after created_date when missing (SC2)"` | PASS |
| `getTaskClassification` round-trip (SC3) | `src/platform/runtime/lib/tools/backlog.ts:914`, `test/task-2312-label-sync.test.ts`, `"setTaskLabels + getTaskClassification round-trip (SC3)"` | PASS |
| `setTaskLabels` exported from backlog.ts | `src/platform/runtime/lib/tools/backlog.ts:1164` (`export { setTaskLabels }`) | PASS |
| All tests pass | `` `node --test test/task-2312-label-sync.test.ts` `` — 7 pass, 0 fail, 0 skipped | PASS |

## Next action

Add the post-draft label sync in `src/platform/runtime/lib/commands/draft.ts` (CP-3): implement `syncTaskLabelsToBaseWorktree` that copies labels from the mission worktree task file to the base worktree task file after `normalizeDraftClassification` validates.
