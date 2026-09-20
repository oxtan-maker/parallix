# CP 1 — Reproduce (red)

## Summary
Locked the red state for the six failing assertions against the parent commit
(`94adedf56`). Ran each named assertion with the project's test seam
(`node --experimental-test-module-mocks --import tsx --test --test-name-pattern=...`)
and captured the exact failing assertions.

**task-2544 env leak (reproduced).** With runner-supplied env set
(`GITHUB_REF_NAME=pull/999/merge PARALLIX_SONAR_BRANCH=feature/leak`) the two
Sonar-identity tests fail because `resolveSonarBranch` (`scripts/sonar-local.ts:125`)
returns the leaked env branch instead of the seeded repo's real branch, so
`resolveSonarProjectKey` returns a branch-derived key instead of `parallix`:

```
✖ task-2544: two distinct branch analyses resolve to distinct identities
✖ task-2544: querying one branch analysis targets only that branch identity
```

**forgejo `syncMerged` / FORGEJO_USER (root cause confirmed by source).** All
five forgejo assertions call `syncMerged` without a `gitRunner` mock and without
`rootDir`, so `reconcileForgejoBase` (`src/adapters/forgejo/forgejo-git.ts:266`)
runs real `git -C <cwd>` against the CI checkout. On a clean GitHub-hosted
runner the checkout has no `refs/remotes/review/main` (detached PR merge), so
`fetchedSha` resolves empty and reconcile returns
`forgejo-base-sha-unresolved` / `overwrite-refused` instead of the expected
result. Evidence against the local checkout (which *has* `refs/remotes/review/main`
and `main`) — the same tests pass locally, confirming the failure is the
checkout/remote dependency, not a production regression:

- `syncMerged treats 409 Conflict as success if commits match` → `false !== true`
  (`test/forgejo.test.ts:1630`)
- `syncMerged treats 405 Method Not Allowed as success if commits match` →
  `false !== true` (`test/forgejo.test.ts:1669`)
- `syncMerged fails on 409 Conflict if commits do NOT match` → actual
  `'overwrite-refused'` vs expected `'merge-conflict-sha-mismatch'`
  (`test/forgejo.test.ts:1705`)
- `getPrStatus and syncMerged share the same FORGEJO_USER fallback contract` →
  `merged.ok` is false at `test/forgejo.test.ts:914` (same missing `gitRunner`
  root cause)

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Red lock captured for all six assertions | `test/forgejo.test.ts` (names `syncMerged treats 409 Conflict as success if commits match`, `syncMerged treats 405 Method Not Allowed as success if commits match`, `syncMerged fails on 409 Conflict if commits do NOT match`, `getPrStatus and syncMerged share the same FORGEJO_USER fallback contract`) and `test/task-2544-sonar-worktree-isolation.test.ts` (names `task-2544: two distinct branch analyses resolve to distinct identities`, `task-2544: querying one branch analysis targets only that branch identity`) | PASS |
| Sonar env-leak reproducible via runner env | command `env GITHUB_REF_NAME=pull/999/merge PARALLIX_SONAR_BRANCH=feature/leak node --experimental-test-module-mocks --import tsx --test --test-name-pattern='task-2544: two distinct|task-2544: querying one' test/task-2544-sonar-worktree-isolation.test.ts` exits non-zero with both named tests failing | PASS |
| Root cause is checkout/remote dependency, not production bug | `scripts/sonar-local.ts:125` `resolveSonarBranch`; `src/adapters/forgejo/forgejo-git.ts:266` `reconcileForgejoBase` + `:465` `getPrimaryBranch`; tests pass against local checkout that has `refs/remotes/review/main` | PASS |

## Next action
CP 2: save + clear `GITHUB_REF_NAME` / `PARALLIX_SONAR_BRANCH` in
`test/task-2544-sonar-worktree-isolation.test.ts` so `resolveSonarBranch` falls
back to the seeded repo's real branch.
