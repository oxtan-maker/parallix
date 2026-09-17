# CP 2 — Base-worktree repair routine + shared marker

## Work done
- Added `src/application/integrate/base-worktree-repair.ts`:
  - `integrationStashMarker(slug)` / `INTEGRATION_STASH_MARKER_SUFFIX` — single
    source of truth for the marker literal.
  - `isIntegrationMarkerStash(message)` — anchored match (`integrate:` … shared
    suffix) that drops a marker stash for **any** slug but never a real stash.
  - `repairBaseWorktree(slug, { baseWorktree, git })` — sweeps marker stashes via
    `git stash list`/`git stash drop`, and when a live `rebase-merge/` or
    `rebase-apply/` directory is present runs `git rebase --abort` then
    `git reset --hard HEAD`. Returns `{ markerStashesDropped, rebaseAborted }`.
  - `createBaseWorktreeRepair(ports)` factory seam.
- Shared the marker with `stashMainCheckoutIfNeeded` (`src/adapters/cli/commands/integrate-conflict.ts`):
  it now calls `integrationStashMarker(slug)` instead of an inline literal, so the
  sweep and the push agree on the identifier exactly.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Repair drops marker stashes only | `src/application/integrate/base-worktree-repair.ts` `isIntegrationMarkerStash` (anchored `integrate:` … suffix) | PASS |
| Marker shared with push | `src/adapters/cli/commands/integrate-conflict.ts` `stashMainCheckoutIfNeeded` → `integrationStashMarker(slug)` | PASS |
| Rebase abort gated on live dir | `src/application/integrate/base-worktree-repair.ts` `liveRebaseDirPresent` guards `git rebase --abort` + `git reset --hard HEAD` | PASS |
| Repro test green against routine | `npx tsx test/task-2532-stale-integration-state-repro.test.ts` → pass 3 / fail 0 | PASS |
| SC3 non-marker stash survives | `test/task-2532-stale-integration-state-repro.test.ts`, `"drops a marker-tagged integration stash and leaves a real stash untouched"` | PASS |
| SC4 clean worktree unaffected | `test/task-2532-stale-integration-state-repro.test.ts`, `"leaves an already-clean base worktree unchanged"` | PASS |

## Next action
Wire `repairBaseWorktree` into `runIntegration` (`src/application/integrate/integrate-workflow.ts`) before the stash/rebase steps (CP 3).
