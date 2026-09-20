# CP 2 — Fix the Sonar branch-identity env leak

## Summary
Closed the `GITHUB_REF_NAME` / `PARALLIX_SONAR_BRANCH` leak that made the two
`test/task-2544-sonar-worktree-isolation.test.ts` Sonar-identity assertions
non-hermetic on the clean runner.

Root cause (from CP 1): `resolveSonarBranch` (`scripts/sonar-local.ts:125`)
returns a runner-supplied branch when `GITHUB_REF_NAME` or
`PARALLIX_SONAR_BRANCH` is present, so `resolveSonarProjectKey` returned a
branch-derived key instead of `parallix` for the seeded `main` repo. The tests
asserted on the seeded repo's real branch identity, which the leaked env
overrode.

Fix: each of the two affected test bodies now saves and deletes
`GITHUB_REF_NAME` / `PARALLIX_SONAR_BRANCH` before `try`, and restores the exact
prior value (or deletes the key when it was absent) in `finally`. This forces
`resolveSonarBranch` to fall back to the seeded repo's real
`git rev-parse --abbrev-ref HEAD` regardless of the runner env. No production
code changed; the fix lives entirely in the test layer. The change is the same
save/clear/restore pattern the test already used for `process.cwd()`, so it
follows an existing pattern (reuse, no new pattern). Committed in
`23e031e73`.

- `task-2544: two distinct branch analyses resolve to distinct identities` —
  strips env, asserts the two worktrees' branch keys differ
- `task-2544: querying one branch analysis targets only that branch identity` —
  strips env, asserts a query for one branch targets only that identity

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Env leak fixed in both task-2544 assertions | `test/task-2544-sonar-worktree-isolation.test.ts` test names `task-2544: two distinct branch analyses resolve to distinct identities`, `task-2544: querying one branch analysis targets only that branch identity` now save + delete `GITHUB_REF_NAME` / `PARALLIX_SONAR_BRANCH` in body and restore in `finally` | PASS |
| Fix is hermetic under runner-supplied env | command `env GITHUB_REF_NAME=pull/999/merge PARALLIX_SONAR_BRANCH=feature/leak node --experimental-test-module-mocks --import tsx --test --test-name-pattern='task-2544: two distinct|task-2544: querying one' test/task-2544-sonar-worktree-isolation.test.ts` exits 0 with both named tests passing | PASS |
| No production behavior changed | `scripts/sonar-local.ts` `resolveSonarBranch` (`scripts/sonar-local.ts:125`) untouched; change is test-layer only per Restricted Areas | PASS |

## Next action
CP 3: fix the three `syncMerged` assertions in `test/forgejo.test.ts` to run
against a temporary fixture Git repository with a `gitRunner`/git-ops contract.
