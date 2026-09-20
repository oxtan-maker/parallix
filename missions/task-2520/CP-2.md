# CP-2 — Base reconciliation and landing diagnostics

## Summary
Implemented Forgejo base reconciliation inside `syncMerged` so the landed commit
always reaches Forgejo through a fast-forward, and added the landing diagnostics
required by SC1–SC3.

Changes (`src/adapters/forgejo/forgejo-git.ts`):
- New `reconcileForgejoBase()` runs before the landed-commit push. It refreshes
  the Forgejo base ref, then:
  - **unchanged** — Forgejo base already equals local base (no push);
  - **fast-forward** — Forgejo base is an ancestor of local base → normal push
    (SC1);
  - **force-with-lease** — local base rewrote the Forgejo base (non-ancestor),
    and the fetched base tree equals the local base tree → `gitPush` with
    `forceWithLease: true` and `forceWithLeaseRef: <base>:<fetched-sha>` (SC1/SC2);
  - **overwrite-refused** — the diverged Forgejo base holds tree content absent
    from the local base → abort before any force push (SC3).
- `pushReviewRef` now honours `forceWithLeaseRef`, emitting
  `--force-with-lease=<ref>` (SHA-pinned) instead of a bare `--force-with-lease`,
  so a remote SHA that changes between fetch and push is rejected rather than
  overwritten (Risks and Assumptions).
- `syncMerged` takes a `gitRunner` seam (defaults to the module `git`); the
  reconciliation reads local/fetched SHAs, ancestry, and tree SHAs through it.
- Diagnostics print the full old→new base SHAs (SC2).

Test coverage (`test/task-2520-diverged-base-reconcile.test.ts`): diverged-but-
content-equivalent, ancestor fast-forward, and content-different abort. Existing
`syncMerged` tests updated to inject a benign `gitRunner` so reconciliation is a
no-op and their push/fetch sequences are preserved.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 ancestor base updated by normal push; non-ancestor tree-equivalent base by force-with-lease pinned to fetched SHA | `test/task-2520-diverged-base-reconcile.test.ts`, `"ancestor Forgejo base is reconciled by a normal fast-forward push"` + `"diverged-but-content-equivalent..."` (`forceWithLeaseRef === main:<fetched-sha>`) | PASS |
| SC2 forced-update diagnostic names fetched base SHA and local replacement SHA; landed commit fast-forwards or fails with a diagnostic | `src/adapters/forgejo/forgejo-git.ts` `reconcileForgejoBase` (old→new SHA logs, `overwrite-refused`/`forgejo-base-push-failed` errors) | PASS |
| SC3 abort before any force push when Forgejo base holds absent content | `test/task-2520-diverged-base-reconcile.test.ts`, `"content-different Forgejo base refuses the force push before any force update"` (`result.error === 'overwrite-refused'`, `pushCalls.length === 0`) | PASS |
| SC2 landed commit reaches Forgejo via fast-forward after reconciliation | `test/task-2520-diverged-base-reconcile.test.ts`, landed-push assertions after the reconcile force push | PASS |
| Typecheck clean | `tsc --noEmit` (exit 0) | PASS |
| Existing syncMerged regression tests preserved | `test/sync-merged-retry.test.ts`, `test/task-1080-sync-merged-hardening.test.ts` | PASS |

## Next action
Repair retry and rebase-state handling (CP-3): detect an existing local squash
before the integration rebase (SC5/AC6), inspect the mission worktree for an
active rebase instead of the base worktree (SC7/AC8), and stop `px rebase` from
reporting clean while a rebase remains active (SC6/AC7). Then run the gates
(CP-4).
