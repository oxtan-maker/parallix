# CP-2: Single shared SonarQube Cloud scan entrypoint

## Summary

Rewrote `scripts/sonar-local.ts` into the one scan entrypoint behind `npm run sonar`, used unchanged by the local pre-integration gate and by GitHub:

- Submits to `https://sonarcloud.io`, organization `oxtan-maker`, project `parallix` — constants in the script, mirrored in `sonar-project.properties`.
- `resolveSonarBranch()` returns the worktree's real Git branch and the scanner receives it as `-Dsonar.branch.name`. On GitHub (`GITHUB_ACTIONS=true`) it returns `null` so the scanner's own CI integration derives branch/pull-request identity from the event instead of analysing a detached merge commit as `HEAD`. A detached local HEAD fails with a precise message rather than guessing.
- Fail-closed: a missing `SONAR_TOKEN` throws before any spawn; a missing `node_modules/.bin/sonar-scanner-npm` throws; a non-zero scanner status throws, which — with `sonar.qualitygate.wait=true` in `sonar-project.properties` — covers both analysis failure and a failed quality gate. The token is only ever read from the environment and passed through the child env; it is never logged.
- The scanner is the lockfile-pinned `sonarqube-scanner` devDependency resolved from `node_modules/.bin`, never `npx --yes`.

Removed with the rewrite: `resolveSonarProjectKey()`, `sanitizeProjectKey()`, `encodeBranchIdentity()`, `setupSonar()`, the admin-password prompt, the Forgejo token-file storage/reuse, and the `127.0.0.1:9000` default. `assertNewIssuesFail()` survives, retargeted at the Cloud organization-scoped quality-gate API.

`sonar-project.properties` now carries `sonar.host.url=https://sonarcloud.io` and `sonar.organization=oxtan-maker`; `sonar.projectKey=parallix`, `sonar.sources=src`, `sonar.javascript.lcov.reportPaths=coverage/lcov.info`, `sonar.qualitygate.wait=true` and `sonar.newCode.referenceBranch=main` are unchanged. The Sonar sections of `test/task-2525.03-sonar-enforcement.test.ts` were rewritten to assert the Cloud endpoint/organization and the Cloud scanner argument vector instead of the loopback host and the per-branch project key.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC2: project-key machinery removed | `grep -n 'resolveSonarProjectKey\|sanitizeProjectKey\|encodeBranchIdentity\|127.0.0.1:9000' scripts/sonar-local.ts` returns nothing; `npx tsc --noEmit --project tsconfig.scripts.json` exits 0 | PASS |
| SC3: Cloud analysis configuration | `sonar-project.properties`; test "task-2525.03: scanner configuration preserves the recorded legacy baseline and rejects new-code regressions" asserts `sonar.host.url=https://sonarcloud.io`, `sonar.organization=oxtan-maker`, `sonar.projectKey=parallix`, `sonar.qualitygate.wait=true` | PASS |
| SC4: shared entrypoint, lockfile-pinned scanner | `npm run sonar` → `scripts/sonar-local.ts scan`; the same command string is the `quality-gate` preIntegration gate in `workflow.config.json`, asserted by "task-2525.03: GitHub workflow and pre-integration gate reference the same shared command"; scanner bin comes from the `sonarqube-scanner` devDependency in `package.json`/`package-lock.json` | PASS |
| SC6: no test imports a removed symbol | `test/task-2525.03-sonar-enforcement.test.ts` no longer imports `resolveSonarProjectKey`; `npx tsx --test test/task-2525.03-sonar-enforcement.test.ts` — 6/6 pass | PASS |
| Token handling fails closed and stays unprinted | test "task-2525.03: scanner uses an environment SONAR_TOKEN for trusted CI runs" asserts the environment token reaches the scanner child env and the Cloud argument vector | PASS |
| Decision alignment | ADR 0060 — "The analysis identity is the Git branch already owned by the repository", one project `oxtan-maker`/`parallix` | PASS |

Next action: CP-3 — migrate `.github/workflows/ci-required.yml` to the Cloud path (drop the `SONAR_HOST_URL` secret, keep `SONAR_TOKEN` plus the `github.event.pull_request.head.repo.full_name == github.repository` trusted-run guard) and update the workflow assertions in `test/task-2525.03-sonar-enforcement.test.ts`.
