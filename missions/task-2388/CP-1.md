# CP-1: Red-to-green regression reproduction (task-2388)

## Summary
Authored `test/task-2388-repro.test.ts` before any production change. It encodes
the three mission scenarios and currently fails (red) against the mission parent
commit `8b1bceacf`:
- SC1 cross-repository slug collision — an explicit-slug `px draft task-5000`
  launched from `/home/other/parallix` is currently reported as local.
- SC2 nested-CWD miss — a slug-less `px review --continue` from a directory
  nested under a mission worktree is currently ignored.
- SC4 fingerprint-only refresh — `boardFingerprint` ignores `liveSession` and
  `metrics.unattributedRunningSessions`, so identical digests are produced.

`node --test test/task-2388-repro.test.ts` reports 4 failing / 1 passing; the
one passing case is the in-repo explicit-slug positive, which is already correct.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 cross-repository slug collision | `test/task-2388-repro.test.ts`, test "SC1: an explicit-slug process outside the board repository is not reported as local" | RED (expected pre-fix) |
| SC2 nested worktree CWD resolution | `test/task-2388-repro.test.ts`, test "SC2: a slug-less command from a nested directory under a worktree resolves to that mission" | RED (expected pre-fix) |
| SC4 liveSession + unattributed fingerprint | `test/task-2388-repro.test.ts`, tests "SC4: a liveSession change repaints the board" / "SC4: an unattributedRunningSessions change repaints the board" | RED (expected pre-fix) |
| Reproduction is red at parent commit | `node --test test/task-2388-repro.test.ts` @ `8b1bceacf` → 4 fail | RED (expected pre-fix) |

## Next action
Implement CP-2 (repository-scoped recovery + nested CWD in `running-sessions.ts`), then CP-3 (fingerprint + focused tests), verify green.
