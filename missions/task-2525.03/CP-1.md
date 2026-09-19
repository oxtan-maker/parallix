# CP 1 — Locate and confirm the shared coverage-plus-SonarQube contract

## Summary

Located the existing foundation this mission consumes and confirmed TASK-2522 and
TASK-2525.01 (via TASK-2527) supply a runnable coverage-plus-SonarQube contract
before any edit.

**Shared command (composition of two existing, unmodified implementations).**
The mission forbids a second scanner/coverage/LCOV implementation, so the shared
command is the composition of the two already-present commands:

- Coverage + LCOV producer — `npm run test:coverage -- --lcov`
  (`src/adapters/verification/coverage-gate.ts`): discovers the `test/` suite
  (495 files today), enforces the 90% line threshold, and writes
  `coverage/lcov.info` via `--test-reporter=lcov`.
- SonarQube scanner + quality gate — `npm run sonar`
  (`scripts/sonar-local.ts` → `sonar-scanner-npm`), driven by
  `sonar-project.properties`, which sets `sonar.qualitygate.wait=true` and
  `sonar.javascript.lcov.reportPaths=coverage/lcov.info` (the report the
  coverage gate produces).

**Confirmed contract (no new implementation introduced).**

- `npm run test:coverage -- --lcov` dry-run resolves the full `test/` suite and
  the `--lcov` flag emits `coverage/lcov.info` (verified with `--dry-run`).
- `sonar-project.properties` preserves the recorded legacy baseline:
  `sonar.projectKey=parallix`, `sonar.host.url=http://127.0.0.1:9000`,
  `sonar.sources=src`, `sonar.tests=test`, loopback-only host. No rule is
  disabled/suppressed; `sonar.qualitygate.wait=true` rejects new-code
  regressions against the baseline.
- Scanner credentials: local flow reuses one Forgejo-resolved token file
  (`resolveForgejoHome()/tokens/sonarqube`, 0600). `scripts/sonar-local.ts`
  `runSonar` currently forces the local token file, so CI must supply
  `SONAR_TOKEN` via environment secret — this is the one in-scope scanner
  enhancement CP 2 makes (env token with local-file fallback), not a new flow.

**Call sites to wire (two, per mission).**

- GitHub required verification — `.github/workflows/ci-required.yml`
  (`ci-required` job, literal name for branch protection).
- Parallix pre-integration — `workflow.config.json` →
  `adapters.gates.preIntegration` (executed through `bash -c`, so `&&`
  composition runs; `src/adapters/config/repository-gates.ts`).

**Stop-rule check.** TASK-2522 (coverage gate + LCOV) and TASK-2525.01/2527
(local SonarQube scanner + quality gate) both supply their parts of the single
reusable coverage-plus-SonarQube contract. No parallel command created. No stop
rule triggered.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Shared coverage+LCOV command exists and produces LCOV | `` `FORCE_COLOR=0 npx tsx src/adapters/verification/coverage-gate.ts --dry-run` `` → 495 test files, `--lcov` emits `coverage/lcov.info` | PASS |
| Shared scanner + quality-gate command exists | `sonar-project.properties:8` `sonar.javascript.lcov.reportPaths=coverage/lcov.info`, `sonar-project.properties:10` `sonar.qualitygate.wait=true` | PASS |
| Legacy baseline preserved, new-code regressions rejected | `sonar-project.properties` keeps `sonar.projectKey=parallix` / loopback host; `sonar.qualitygate.wait=true`; no rule disabled | PASS |
| GitHub required workflow located | `.github/workflows/ci-required.yml` (`ci-required` job, `name: ci-required`) | PASS |
| preIntegration gate plan located | `workflow.config.json` → `adapters.gates.preIntegration`, executed via `bash -c` in `src/adapters/config/repository-gates.ts` | PASS |
| TASK-2522 / TASK-2525.01 contract present | `package.json` `test:coverage` script; `scripts/sonar-local.ts` `runSonar`/`setupSonar`; `test/task-2527-local-sonar.test.ts` | PASS |

## Next action

CP 2: add the shared command `npm run test:coverage -- --lcov && npm run sonar`
to `.github/workflows/ci-required.yml` with `SONAR_TOKEN`/`SONAR_HOST_URL` from
environment secrets, quality-gate waiting, job-summary output, and failure
propagation; add the identical command to `workflow.config.json`
`adapters.gates.preIntegration`; and make `scripts/sonar-local.ts` honor an
environment `SONAR_TOKEN` (local-file fallback) so trusted CI runs use secrets
without exposing them to untrusted pull-request code.
