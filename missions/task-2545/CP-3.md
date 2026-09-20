# CP 3 — Fix the three syncMerged assertions hermetically

## Summary
The three `syncMerged` fixtures (`test/forgejo.test.ts`) called `syncMerged`
without a `gitRunner` mock and without `rootDir`. So `reconcileForgejoBase`
(`src/adapters/forgejo/forgejo-git.ts:266`) ran real `git -C <cwd>` against the
CI checkout. On a clean GitHub-hosted runner the checkout is a detached PR merge
with no `refs/remotes/review/main`, so `fetchedSha` resolved empty and reconcile
returned `forgejo-base-sha-unresolved` / `overwrite-refused` instead of the
expected already-merged / sha-mismatch result.

Fix: added the benign `gitRunner: () => ({ stdout: 'shared-base-sha', status: 0 })`
contract to each of the three tests. With `gitFetch` already returning status 0,
`reconcileForgejoBase` takes the `unchanged` no-op path, so no real checkout is
touched and the merge-API status codes (409 / 405 / 409-sha-mismatch) drive the
assertions deterministically. This is the exact hermetic contract already used by
the other `syncMerged` fixtures in the same file (reuse, no new pattern).

- `syncMerged treats 409 Conflict as success if commits match` — base=head=abc123
  → `verifyMergeState` confirms match → ok
- `syncMerged treats 405 Method Not Allowed as success if commits match` — same
- `syncMerged fails on 409 Conflict if commits do NOT match` — base=some-other-sha
  → `merge-conflict-sha-mismatch`

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Three syncMerged fixtures pass hermetically | `test/forgejo.test.ts` test names `syncMerged treats 409 Conflict as success if commits match`, `syncMerged treats 405 Method Not Allowed as success if commits match`, `syncMerged fails on 409 Conflict if commits do NOT match` — all pass under `npm run test:integration:ci` (see CP-5 log) | PASS |
| No real checkout touched | benign `gitRunner` contract intercepts every `reconcileForgejoBase` git call; `src/adapters/forgejo/forgejo-git.ts` production code unchanged | PASS |

## Next action
CP 4: confirm the FORGEJO_USER fallback assertion is hermetic (same root cause).
