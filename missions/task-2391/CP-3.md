# CP 3 — Reviewer Git isolation and shared guard behavior proven

## Summary

Extended the linked-worktree regression to exercise real `git add`/`git commit`
and conflict-resolution `git rebase --continue` through each implementer step:
`draft`, `execute`, `act-on-review`, and `active`.

The reviewer case now verifies that neither Git-resolved metadata directory is a
writable Bubblewrap bind, then proves both staging and committing fail inside
the confined reviewer command. The focused shared guard suite remains green for
the single launch seam, unavailable guard warning, explicit disable switch, and
fail-closed broken-guard path.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC2 every implementer profile performs real linked-worktree mutations | `test/bubblewrap-worktree-git.test.ts`, `"every implementer step can git add + commit in a linked worktree under bubblewrap"`, `"every implementer step continues a real rebase in a linked worktree under bubblewrap"` | PASS |
| SC6 reviewer source and Git state remain read-only | `test/bubblewrap-worktree-git.test.ts`, `"reviewer args do not grant the git common dir writable and reviewer git add fails"` | PASS |
| SC7 shared launch seam and availability modes remain unchanged | `test/bubblewrap-guard.test.ts`, `"wrapWithBubblewrap prefixes bwrap and preserves the original argv"`, `"spawnAndTee fails before spawning when an available guard cannot be built"`, `"isBubblewrapDisabled honors PARALLIX_NO_BUBBLEWRAP"` | PASS |
| Focused regression suite is clean | `FORCE_COLOR=0 npx tsx --test test/bubblewrap-worktree-git.test.ts test/bubblewrap-guard.test.ts` | PASS |

## Next action: Run the mission integration gates (`all`, then `static-analysis`) and capture their durable results in final CP 4.
