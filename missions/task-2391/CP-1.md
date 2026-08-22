# CP 1 — Failing reproduction test locks the linked-worktree Git mutation bug

## Summary

Authored the regression test `test/bubblewrap-worktree-git.test.ts` that builds a
real temporary Git repository with one committed base, adds a **linked** worktree
(`.git` is a file under `<parent>/.git/worktrees/<name>`), and runs `git` inside
the Bubblewrap-confined worktree via the actual `bwrap` argument array produced by
`resolveSandboxProfile` + `buildBubblewrapArgs`.

The test goes red at the parent commit: the current guard binds only the worktree,
so the per-worktree `index.lock`/`rebase-merge` (under the parent common dir, which
stays under the read-only `/`) cannot be written and `git add`/`commit`/`rebase
--continue` exit non-zero. All four tests are red before the fix and must go green
after CP 2.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 regression is a real linked worktree that fails pre-fix | `test/bubblewrap-worktree-git.test.ts`, test `"implementer git add + commit succeeds in a linked worktree under bubblewrap"` — 4/4 red before fix | PASS |
| SC2 implementer add/commit + rebase --continue exercised under guard | `test/bubblewrap-worktree-git.test.ts`, `"implementer continues a real rebase in a linked worktree under bubblewrap"` | PASS (red, pending fix) |
| SC3 mounts derived from `git rev-parse` | `test/bubblewrap-worktree-git.test.ts`, `"resolveSandboxProfile grants the Git-resolved common dir and per-worktree git dir for an implementer step"` | PASS (red, pending fix) |
| SC4/SC5 writable grant bounded | `test/bubblewrap-worktree-git.test.ts`, `"reviewer args do not grant the git common dir writable"` | PASS (red, pending fix) |
| SC6 reviewer isolation | `test/bubblewrap-worktree-git.test.ts`, `"reviewer args do not grant the git common dir writable and reviewer git add fails"` | PASS (red, pending fix) |

Red→green proof command (run after CP 2):

```
FORCE_COLOR=0 npx tsx --test test/bubblewrap-worktree-git.test.ts
```

Observed pre-fix (this checkpoint): `tests 4, pass 0, fail 4`, including
`writable set must include common dir /tmp/bwtest-.../parent/.git` and
`git add` exiting non-zero under the worktree-only bind.

## Next action: Implement the Git-metadata mount grant in `src/adapters/process/bubblewrap.ts` for implementer steps (CP 2).
