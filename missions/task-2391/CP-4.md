# CP 4 — Integrated verification complete

## Summary

Completed the mission verification gates after the linked-worktree Bubblewrap
implementation and isolation regressions were committed. The implementation
grants only Git-resolved common and per-worktree metadata to implementer
profiles, retains reviewer Git state as read-only, and preserves the shared
launch guard behavior.

Review-round amendment: the regression fixture now uses a system temporary
directory while its confined profile explicitly removes the production `/tmp`
convenience mount. This makes the result independent of the checkout's
writability without allowing `/tmp` to mask Git metadata permissions. The Git
metadata lookup now returns cached copies before spawning Git again and fails
closed when Git cannot start or times out. `test/default-test-suite.test.ts` is
also updated outside the original Restricted Areas because its maintained
integration inventory must register the process-spawning regression test.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 confined linked-worktree add/commit is a deterministic green regression | `test/bubblewrap-worktree-git.test.ts`, `"every implementer step can git add + commit in a linked worktree under bubblewrap"` | PASS |
| SC2 every implementer step can mutate and continue a rebase | `test/bubblewrap-worktree-git.test.ts`, `"every implementer step continues a real rebase in a linked worktree under bubblewrap"` | PASS |
| SC3 Git metadata paths are Git-resolved and mount as common then per-worktree argv entries | `src/adapters/process/bubblewrap.ts`, `"resolveSandboxProfile grants the Git-resolved common dir and per-worktree git dir for an implementer step"` | PASS |
| SC4 argument-array ordering and bounded deduplication are retained | `src/adapters/process/bubblewrap.ts`, `test/bubblewrap-worktree-git.test.ts` | PASS |
| SC5 writable access excludes checkout parent and unrelated paths | `test/bubblewrap-worktree-git.test.ts` | PASS |
| SC6 reviewer cannot stage or commit and receives no Git metadata bind | `test/bubblewrap-worktree-git.test.ts`, `"reviewer args do not grant the git common dir writable and reviewer git add fails"` | PASS |
| SC7 shared guard seam plus unavailable, disabled, and broken behavior remain covered | `test/bubblewrap-guard.test.ts`, `"isBubblewrapAvailable warns once that the agent runs unsandboxed"`, `"isBubblewrapDisabled honors PARALLIX_NO_BUBBLEWRAP"`, `"spawnAndTee fails before spawning when an available guard cannot be built"` | PASS |
| SC8 focused Bubblewrap tests pass | `FORCE_COLOR=0 npx tsx --test test/bubblewrap-worktree-git.test.ts test/bubblewrap-guard.test.ts` | PASS |
| Fixture is hermetic and cache / lookup failures are covered | `test/bubblewrap-worktree-git.test.ts`, `test/bubblewrap-guard.test.ts`, `"reuses cached Git metadata without spawning Git again for the same worktree"`, `"resolveSandboxProfile fails closed when Git metadata resolution times out"` | PASS |
| Integration inventory includes the process-spawning regression | `test/default-test-suite.test.ts`, `"default test runner routes every moved group to integration and excludes it from default"` | PASS |
| Required general verification gate passes | `./scripts/verify-local.sh all` | PASS |
| Required static-analysis gate passes | `./scripts/verify-local.sh static-analysis` | PASS |

## Next action: Mission execution is complete; hand off the committed checkpoint series for the platform-managed review transition.
