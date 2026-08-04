# Checkpoint 1: Copy graphify-out from primary worktree at draft time

## Summary

Updated `ensureGraphifyWorkspace()` in `src/adapters/cli/commands/draft.ts` to copy `graphify-out/` contents (including `graph.json`, `wiki/`, etc.) from the primary worktree into the mission worktree. This ensures the draft agent has access to the knowledge graph from the start, rather than working with an empty `graphify-out/` directory.

The copy is scoped to the newly-created-directory branch so a re-run of `px draft` does not clobber a mission worktree's fresher graph with the primary's staler one.

Changes:
- Added `mainRepo` parameter to `ensureGraphifyWorkspace()` (line 591), passed from the call site (line 230)
- Added a guarded copy step using `fs.cpSync(sourcePath, targetPath, { recursive: true, force: true })` (line 618)
- Copy is wrapped in try/catch for graceful degradation when graphify is not installed or source is absent (lines 615-626)
- Empty-directory creation is preserved when no graph is found (line 607)
- Copy scoped to new-directory branch only — existing directories not clobbered on re-draft
- All existing `draft.test.ts` tests pass; added 3 new tests for copy behavior

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: Copies graphify-out/graph.json from primary worktree | `src/adapters/cli/commands/draft.ts:618` (`fs.cpSync(sourcePath, targetPath, { recursive: true, force: true })`) | PASS |
| SC2: Gracefully skips when graphify not installed or graph absent | `src/adapters/cli/commands/draft.ts:615-626` (guarded by `if (mainRepo)` and `fs.existsSync(sourcePath)` + try/catch) | PASS |
| SC3: Empty-directory creation preserved when no graph found | `src/adapters/cli/commands/draft.ts:607` (`fs.mkdirSync(targetPath, { recursive: true })`) | PASS |
| SC4: Draft command completes in all cases | `test/draft.test.ts` (48 tests pass including 3 new copy tests), `test/draft-command.test.ts` (5 tests pass) | PASS |
| SC5: No Parallix source files outside draft.ts modified | `git diff --stat src/` shows only `src/adapters/cli/commands/draft.ts` | PASS |
| Verification gate ran | `./scripts/verify-local.sh all` (1677 pass) | PASS |

## Next action

Stage all changes and hand off to review (`px review task-2333`).
