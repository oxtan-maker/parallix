# CP 4 — FORGEJO_USER fallback assertion is hermetic

## Summary
The `getPrStatus and syncMerged share the same FORGEJO_USER fallback contract`
assertion did not need a file move. Its failure was the same root cause as the
`syncMerged` fixtures: the `syncMerged` call inside the test had no `gitRunner`
mock, so `reconcileForgejoBase` (`src/adapters/forgejo/forgejo-git.ts:266`) ran
real `git -C <cwd>` against the CI checkout and returned
`forgejo-base-sha-unresolved` / `overwrite-refused`, making `merged.ok` false at
`test/forgejo.test.ts:914`.

Fix: added the benign `gitRunner: () => ({ stdout: 'shared-base-sha', status: 0 })`
contract (identical to the other `syncMerged` fixtures) so reconciliation never
touches a real checkout. The test already deletes `FORGEJO_USER`, sets
`FORGEJO_HOME` to a temp dir, and writes a `human` token file, so token
resolution is fully isolated. Verified hermetic under a dirty CI-like env
(`FORGEJO_USER=custom GITHUB_REF_NAME=pull/1/merge`): the test still passes, so
no `FORGEJO_USER`/`FORGEJO_HOME` leak remains. No file was moved; both files stay
in `INTEGRATION_CI_TESTS`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| FORGEJO_USER fallback assertion hermetic | `test/forgejo.test.ts` test name `getPrStatus and syncMerged share the same FORGEJO_USER fallback contract` passes under `env FORGEJO_USER=custom GITHUB_REF_NAME=pull/1/node --experimental-test-module-mocks --import tsx --test --test-name-pattern='share the same FORGEJO_USER fallback contract' test/forgejo.test.ts` | PASS |
| No file moved out of CI lane | `test/lib/test-categories.ts` still lists `test/forgejo.test.ts` and `test/task-2544-sonar-worktree-isolation.test.ts` in `INTEGRATION_CI_TESTS`; `INTEGRATION_LOCAL_TESTS` unchanged | PASS |

## Next action
CP 5: classify/confirm tiering (no move needed) and verify the full green tree
via the mission gate plus static-analysis and integration-ci.
