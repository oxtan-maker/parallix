# CP 3 — Implement the per-worktree/branch analysis identity and route every query through it

## Goal
Derive the SonarQube analysis identity from the active branch, route both scan
submission and quality-gate query through it, and preserve the local no-token
path.

## Work done
Implemented `resolveSonarBranch` + `resolveSonarProjectKey` in
`scripts/sonar-local.ts` (exported, shared by submit and query):

- `main` → `parallix` (dedicated main-branch view).
- every other branch → `parallix-<sanitized-branch>` (distinct per branch).
- branch resolution: runner env `PARALLIX_SONAR_BRANCH` / `GITHUB_REF_NAME`
  (CI detached-HEAD fallback) → `git rev-parse --abbrev-ref HEAD` → worktree
  path basename. Sanitized to SonarQube key charset.

Routing:
- `runSonar` now passes `-Dsonar.projectKey=<resolveSonarProjectKey(rootDir)>`
  alongside the still-pinned `-Dsonar.newCode.referenceBranch=main` (SC4).
- `assertNewIssuesFail` now queries
  `get_by_project?project=${resolveSonarProjectKey(rootDir)}` instead of the
  literal `parallix` constant (SC2).

Local no-token path unchanged: `setupSonar`/`readSonarToken` still use
`.forgejo-local/tokens/sonarqube`, loopback host, `SONAR_TOKEN` env preference.

Verified resolver: `PARALLIX_SONAR_BRANCH=main` → `parallix`;
`PARALLIX_SONAR_BRANCH=mission/task-2544` → `parallix-mission-task-2544`.

Existing tests that pinned the exact scan args were updated to assert the
derived key: `test/task-2527-local-sonar.test.ts` and
`test/task-2525.03-sonar-enforcement.test.ts` (both pass).

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC2: query no longer targets literal `parallix` | `scripts/sonar-local.ts` `assertNewIssuesFail` uses `resolveSonarProjectKey(rootDir)` | PASS |
| SC4: runSonar still pins newCode to main | `scripts/sonar-local.ts` `-Dsonar.newCode.referenceBranch=main` retained | PASS |
| SC1: two branches resolve to two keys | `resolveSonarProjectKey('main')` vs `resolveSonarProjectKey('mission/task-2544')` differ | PASS |
| Local no-token path preserved | `scripts/sonar-local.ts` `setupSonar` / `readSonarToken` unchanged | PASS |
| Existing sonar tests still pass | `node --import tsx --test test/task-2527-local-sonar.test.ts` (3 pass), `test/task-2525.03-sonar-enforcement.test.ts` (6 pass) | PASS |

## Next action
Commit CP-3.md, then CP 5: add the focused automated test proving two distinct
branch analyses remain independently queryable.
