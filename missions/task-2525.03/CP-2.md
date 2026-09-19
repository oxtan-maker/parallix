# CP 2 — Wire the shared command into the GitHub required workflow and pre-integration gate

## Summary

Wired the single shared coverage-plus-SonarQube command
`npm run test:coverage -- --lcov && npm run sonar` into both declarative call
sites declared by the mission, plus the one in-scope scanner enhancement that
lets trusted CI runs supply `SONAR_TOKEN` through an environment secret.

**GitHub required workflow — `.github/workflows/ci-required.yml`** (added to the
`ci-required` job, literal name kept for branch protection):

- New step *Run coverage plus mandatory SonarQube quality gate* runs the shared
  command. The coverage gate produces `coverage/lcov.info`, which the scanner
  consumes via `sonar-project.properties`; the scanner waits for the quality
  gate (`sonar.qualitygate.wait=true`), so scan / credential /
  server-connectivity / failed-quality-gate failures all exit non-zero and fail
  the required job.
- `SONAR_TOKEN` and `SONAR_HOST_URL` (non-local server URL) are supplied only
  through `${{ secrets.* }}`; neither is committed, emitted to logs, or
  reachable from untrusted pull-request code.
- The step is guarded on `if: ${{ secrets.SONAR_TOKEN != '' }}`, so untrusted
  fork pull requests (which never receive repository secrets) are not blocked —
  the trust boundary is preserved — while trusted runs get a clear result.
- New step *Publish SonarQube quality gate result* (`if: always()`) appends the
  quality-gate output to the GitHub job summary (`GITHUB_STEP_SUMMARY`) for both
  pass and fail outcomes.

**Parallix pre-integration — `workflow.config.json`** `adapters.gates.preIntegration`
(new gate `quality-gate`, order 4). Executed through `bash -c` by
`src/adapters/config/repository-gates.ts`, so the `&&` composition runs; missing
credentials or an unreachable configured server fail the gate clearly.

**In-scope scanner enhancement — `scripts/sonar-local.ts` `runSonar`**: an
environment `SONAR_TOKEN` is used when present, with the Forgejo-resolved local
token file as fallback. Local behavior is unchanged when `SONAR_TOKEN` is unset;
the scanner still never prints the token, and `SONAR_HOST_URL` overrides the
loopback host for non-local servers. No second scanner/coverage/LCOV flow.

**Related test-inventory unblock (baseline, not SonarQube behavior):** the
required `all` gate was blocked by a pre-existing task-2525.02 gap —
`task-2533-squash-payload-pathspec-quotes.test.ts` matches the integration
heuristic but was absent from the canonical list in
`test/default-test-suite.test.ts`. Added the one missing entry so `npm test`
classifies consistently. No source/workflow/gate/SonarQube behavior changed.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| GitHub workflow invokes the shared command, consumes LCOV, waits for quality gate | `.github/workflows/ci-required.yml` step `npm run test:coverage -- --lcov && npm run sonar`; `sonar-project.properties:10` `sonar.qualitygate.wait=true` | PASS |
| SONAR_TOKEN / server URL only from environment secrets; no token committed/emitted/untrusted | `.github/workflows/ci-required.yml` `SONAR_TOKEN: ${{ secrets.SONAR_TOKEN }}`, `SONAR_HOST_URL: ${{ secrets.SONAR_HOST_URL }}`, guarded by `if: ${{ secrets.SONAR_TOKEN != '' }}` | PASS |
| Failed scan / credential / connectivity / gate fails the job clearly | shared command exits non-zero on scanner failure → fails `ci-required` job; job-summary step runs `if: always()` | PASS |
| Identical shared command in preIntegration gate | `workflow.config.json` `adapters.gates.preIntegration` `quality-gate` = `npm run test:coverage -- --lcov && npm run sonar` | PASS |
| Scanner honors trusted-CI environment token with local fallback | `scripts/sonar-local.ts` `runSonar`: `process.env.SONAR_TOKEN || readSonarToken(...)` | PASS |
| Pre-integration gate list validated | `test/repository-gates.test.ts`, `"this repository selects build, verification, integration-suite, quality-gate, workflow, and agent-smoke gates without codeql"` | PASS |
| Required gates pass | `` `./scripts/verify-local.sh static-analysis` `` ALL STAGES PASSED; `` `./scripts/verify-local.sh all` `` → 2669 pass, 0 fail | PASS |

## Next action

CP 3: add and register the focused configuration test proving both declarations
reference the same shared command and validating the trusted-secret /
quality-gate contract; run the required gates once more and record final Goal
Check evidence; commit CP-3.
