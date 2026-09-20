# CP-1 — RED: lock the Forgejo base-divergence regression

## Summary
Authoring the failing reproduction test for the 2026-09-15 regression before any
fix, per the mission checkpoint contract. The scenario is the diverged-but-
content-equivalent case: local `main` was rewritten so Forgejo `main` points at a
non-ancestor commit whose tree is content-equivalent to the local base.

The reproduction test (`test/task-2520-diverged-base-reconcile.test.ts`) asserts
the *desired* post-fix behaviour: `syncMerged` reconciles the Forgejo base with a
SHA-pinned `--force-with-lease` and the landed commit then reaches Forgejo via a
fast-forward. Verified **red** at the parent commit (source fix stashed): the
diverged-base and content-different cases fail, while the ancestor case still
passes (it needs no reconciliation). Confirmed the pre-fix failure mode is
`push-primary-failed` from the plain non-fast-forward push.

All Git/Forgejo boundaries are injected doubles; no live repository is used.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 diverged-but-equivalent base reconciled with force-with-lease, landed commit fast-forwards | `test/task-2520-diverged-base-reconcile.test.ts`, `"diverged-but-content-equivalent Forgejo base is reconciled with force-with-lease, then the landed commit fast-forwards"` | PASS (green with fix; RED at parent commit) |
| SC1 ancestor base reconciled by normal fast-forward push | `test/task-2520-diverged-base-reconcile.test.ts`, `"ancestor Forgejo base is reconciled by a normal fast-forward push"` | PASS |
| SC3 content-different base refuses force push before any force update | `test/task-2520-diverged-base-reconcile.test.ts`, `"content-different Forgejo base refuses the force push before any force update"` | PASS (green; RED at parent commit) |
| SC2 landed commit reaches Forgejo via fast-forward after reconciliation | `test/task-2520-diverged-base-reconcile.test.ts`, push-sequence assertions (`forceWithLeaseRef === main:<fetched-sha>`) | PASS |
| Reproduction is red at the parent commit (fails before fix) | Verified by `git stash` of `src/adapters/forgejo/forgejo-git.ts`; test fails with `push-primary-failed` | PASS |
| Existing syncMerged behaviour preserved | `test/sync-merged-retry.test.ts`, `test/task-1080-sync-merged-hardening.test.ts` | PASS |

## Next action
Commit CP-1 and the reproduction test, then implement base reconciliation and
landing diagnostics (CP-2): the ancestor fast-forward path, the force-with-lease
path pinned to the fetched SHA, the overwrite-refused abort, and the old→new SHA
diagnostic.
