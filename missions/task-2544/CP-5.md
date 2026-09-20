# CP 5 — Add the focused automated test proving two distinct analyses remain independently queryable

## Goal
Add a focused test proving two distinct worktree/branch analyses remain
independently queryable (SC6).

## Work done
Wrote `test/task-2544-sonar-worktree-isolation.test.ts` with two tests:

1. `"task-2544: two distinct branch analyses resolve to distinct identities"` —
   seeds a base repo on `main`, adds two feature worktrees (`feature/a`,
   `feature/b`), and asserts `resolveSonarProjectKey` returns `parallix` for
   main and `parallix-feature-a` / `parallix-feature-b` for the two branches —
   all distinct (SC1/SC3).
2. `"task-2544: querying one branch analysis targets only that branch identity"`
   — runs `assertNewIssuesFail` from each feature worktree with a request
   recorder and asserts each `get_by_project` query targets only its own key,
   never the other's (SC6).

The test seeds temporary Git worktrees (git boundary) and injects fetch, so it
is classified `integration-ci` and registered in
`test/lib/test-categories.ts` `INTEGRATION_CI_TESTS` (clean runner has git).
No `.only` / bare `.skip` introduced (SC7).

Result: `node --import tsx --test test/task-2544-sonar-worktree-isolation.test.ts`
→ 2 pass, 0 fail.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC6: two distinct branch analyses independently queryable | `test/task-2544-sonar-worktree-isolation.test.ts`, `"task-2544: querying one branch analysis targets only that branch identity"` | PASS |
| SC1: distinct identities verified | `test/task-2544-sonar-worktree-isolation.test.ts`, `"task-2544: two distinct branch analyses resolve to distinct identities"` | PASS |
| SC3: main dedicated identity verified | same test asserts `resolveSonarProjectKey(base) === 'parallix'` distinct from feature keys | PASS |
| Test classified (no unclassified boundary test) | `test/lib/test-categories.ts` `INTEGRATION_CI_TESTS` includes `task-2544-sonar-worktree-isolation.test.ts` | PASS |
| No `.only` / bare `.skip` introduced | `test/task-2544-sonar-worktree-isolation.test.ts` | PASS |
| Focused test passes | `node --import tsx --test test/task-2544-sonar-worktree-isolation.test.ts` (2 pass) | PASS |

## Next action
Commit CP-5.md with the test and category registration, then execute CP 6: run
`./scripts/verify-local.sh static-analysis` and the `all` gate and complete the
final Goal Check.
