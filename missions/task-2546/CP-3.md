# CP-3: GitHub `ci-required` runs the same Cloud entrypoint

## Summary

Migrated `.github/workflows/ci-required.yml` to the Cloud path without changing its trust boundary:

- Removed `SONAR_HOST_URL: ${{ secrets.SONAR_HOST_URL }}` from the scan step. The Cloud host and organization are repository configuration (`sonar-project.properties`), so `SONAR_TOKEN` is now the only Sonar secret the workflow requires.
- Rewrote the identity comment above the scan step: `npm run sonar` is the single entrypoint shared with local mission verification, and on GitHub it deliberately sends no `sonar.branch.name` so the scanner's CI integration derives branch/pull-request identity from the event rather than analysing the detached merge commit.
- Unchanged and verified as still present: the `actions/checkout@v7` step with `fetch-depth: 0` (full history for the `main` new-code baseline), the shared `npm run test:coverage -- --threshold 0 --lcov && npm run sonar` command, the gate-result job summary, the "Ensure SONAR_TOKEN configured" fail-closed step, and the trusted-run guard `github.event_name == 'push' || github.event.pull_request.head.repo.full_name == github.repository` on both Sonar steps — so an untrusted fork pull request never receives the token.

Updated the workflow assertions in `test/task-2525.03-sonar-enforcement.test.ts`: the renamed test "task-2525.03: GitHub workflow sources SONAR_TOKEN only from environment secrets" now asserts `SONAR_HOST_URL` appears nowhere in the workflow, alongside the existing secrets-context, trusted-guard and no-literal-token assertions.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC5: no `SONAR_HOST_URL` secret remains | test "task-2525.03: GitHub workflow sources SONAR_TOKEN only from environment secrets" asserts `assert.doesNotMatch(workflow, /SONAR_HOST_URL/)`; `grep -n SONAR_HOST_URL .github/workflows/ci-required.yml` returns nothing | PASS |
| SC5: trusted-run guard preserved | same test asserts `github.event.pull_request.head.repo.full_name == github.repository` and that no step `if:` reads the `secrets` context | PASS |
| SC4: GitHub and the local gate share one entrypoint | test "task-2525.03: GitHub workflow and pre-integration gate reference the same shared command" compares `.github/workflows/ci-required.yml` against `workflow.config.json` `adapters.gates.preIntegration` | PASS |
| Gate result is awaited and published | test "task-2525.03: GitHub workflow waits for the quality gate and publishes it to the job summary"; `sonar.qualitygate.wait=true` in `sonar-project.properties` | PASS |
| New-code baseline has the history it needs | `.github/workflows/ci-required.yml` checkout step keeps `fetch-depth: 0`; `sonar.newCode.referenceBranch=main` in `sonar-project.properties` | PASS |
| Suite still green | `npx tsx --test test/task-2525.03-sonar-enforcement.test.ts` — 6/6 pass | PASS |
| Decision alignment | ADR 0060 — GitHub "submits the checked-out Git ref using SonarQube Cloud's normal branch/SCM analysis" | PASS |

Next action: CP-4 — add a focused Cloud-wiring test covering local branch selection, the GitHub no-branch path, fail-closed token/scanner handling and the shared entrypoint, then inspect the real `parallix` Cloud quality gate against TASK-2525 policy with `assertNewIssuesFail`.
