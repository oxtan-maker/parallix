# CP 2 — Implementer profiles mount Git-resolved linked-worktree metadata

## Summary

Implemented the implementer-only Git metadata grant in the shared Bubblewrap
profile. The guard resolves both `git rev-parse --path-format=absolute
--git-common-dir` and `git rev-parse --absolute-git-dir`, caches paths by common
dir and per-worktree dir, and keeps the nested per-worktree bind explicit after
the common-dir bind. Generic nested permissions continue to be deduplicated.

`draft`, `execute`, `act-on-review`, and `active` now receive the mission
worktree plus only the Git-resolved common and per-worktree metadata locations.
The linked-worktree regression executes real confined `git add`/`git commit` and
conflict-resolution `git rebase --continue` successfully.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 linked-worktree mutation regression is green | `test/bubblewrap-worktree-git.test.ts`, `FORCE_COLOR=0 npx tsx --test test/bubblewrap-worktree-git.test.ts` | PASS |
| SC2 all implementer steps receive the bounded Git mounts and real mutations work | `test/bubblewrap-worktree-git.test.ts`, `"implementer git add + commit succeeds in a linked worktree under bubblewrap"`, `"implementer continues a real rebase in a linked worktree under bubblewrap"` | PASS |
| SC3 paths come from Git and retain both nested argv binds | `test/bubblewrap-worktree-git.test.ts`, `"resolveSandboxProfile grants the Git-resolved common dir and per-worktree git dir for an implementer step"` | PASS |
| SC4 mounts remain argv entries, deduplicated safely, and ordered common then per-worktree | `src/adapters/process/bubblewrap.ts`, `test/bubblewrap-worktree-git.test.ts` | PASS |
| SC5 no writable checkout-parent grant | `test/bubblewrap-worktree-git.test.ts` | PASS |

## Next action: Complete CP 3 by proving a confined reviewer cannot mutate linked-worktree Git state and rerunning the shared Bubblewrap guard seam tests.
