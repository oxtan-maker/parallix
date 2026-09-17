# CP 1 — Failing reproduction test (red at parent commit)

## Work done
- Authored `test/task-2532-stale-integration-state-repro.test.ts`, which builds
  throwaway Git repositories in a temp dir and drives the base-worktree repair
  entry (`createBaseWorktreeRepair(...).repairBaseWorktree`) against both poison
  failure modes:
  - marker-tagged stash sweep (SC1/SC3): a stale `integrate:<slug>: temporary
    integration checkout stash` is dropped; a personal non-marker stash survives.
  - dead rebase (SC2): a live `rebase-merge/` plus an unmerged index is aborted
    and the index cleared.
  - clean worktree (SC4): stash list, `rebase-*` directory set, and HEAD are
    unchanged; `report.markerStashesDropped === 0` and `report.rebaseAborted === false`.
- Registered the file in `test/lib/test-categories.ts` under
  `INTEGRATION_CI_TESTS` (it crosses a real Git boundary: temporary repos in a
  temp dir, no local AI/Forgejo/tooling).
- Confirmed the test is **red at the parent commit** (`2b8c41c`): the repair
  module does not exist yet, so the run fails with
  `ERR_MODULE_NOT_FOUND ... src/application/integrate/base-worktree-repair.js`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 marker stash dropped, later integrate unblocked | `test/task-2532-stale-integration-state-repro.test.ts`, `"drops a marker-tagged integration stash and leaves a real stash untouched"` | PASS (red at parent) |
| SC2 dead rebase aborted + index cleared | `test/task-2532-stale-integration-state-repro.test.ts`, `"aborts a dead rebase and clears the unmerged index"` | PASS (red at parent) |
| SC3 non-marker stash never dropped | `test/task-2532-stale-integration-state-repro.test.ts`, asserts `my personal work in progress` present after sweep | PASS (red at parent) |
| SC4 clean worktree unaffected | `test/task-2532-stale-integration-state-repro.test.ts`, `"leaves an already-clean base worktree unchanged"` | PASS (red at parent) |
| Repro test is red at parent commit | `ERR_MODULE_NOT_FOUND ... base-worktree-repair.js` when running `npx tsx test/task-2532-stale-integration-state-repro.test.ts` at `2b8c41c` | PASS |
| Test registered in CI lane | `test/lib/test-categories.ts` → `INTEGRATION_CI_TESTS` | PASS |

## Next action
Implement the base-worktree repair routine in `src/application/integrate/base-worktree-repair.ts` and share the integration-stash marker literal with `stashMainCheckoutIfNeeded` (CP 2).
