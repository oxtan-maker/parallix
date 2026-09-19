# CP 3 — Focused configuration coverage and final gate evidence

## Summary

Added the focused configuration test that proves both declarative call sites
invoke the same shared command and validate the trusted-secret / quality-gate
contract, then ran the required gates on the committed tree.

**Focused test — `test/task-2525.03-sonar-enforcement.test.ts`** (unit lane;
hermetic: reads repo config from disk, injects the scanner spawn, no Docker /
real SonarQube server / committed token). Five assertions, all green:

- `"GitHub workflow and pre-integration gate reference the same shared command"` —
  asserts `.github/workflows/ci-required.yml` and
  `workflow.config.json` `adapters.gates.preIntegration` both contain
  `npm run test:coverage -- --lcov && npm run sonar`.
- `"GitHub workflow sources SONAR_TOKEN and server URL only from environment secrets"` —
  asserts `SONAR_TOKEN: ${{ secrets.SONAR_TOKEN }}`,
  `SONAR_HOST_URL: ${{ secrets.SONAR_HOST_URL }}`, the
  the step `if:` branches on the event/repodata context
  (`github.event.pull_request.head.repo.full_name == github.repository`) and
  never references the `secrets` context (rejected by GitHub Actions in a
  step-level `if:`); trusted runs fail clearly when the token is missing
  (`SONAR_TOKEN environment secret is not configured`), and no literal token.
- `"GitHub workflow waits for the quality gate and publishes it to the job summary"` —
  asserts the job-summary step and the redirected shared command.
- `"scanner configuration preserves the recorded legacy baseline and rejects new-code regressions"` —
  asserts `sonar.project.properties` keeps `sonar.projectKey=parallix` + loopback
  host and `sonar.qualitygate.wait=true`, with no rule suppression markers.
- `"scanner uses an environment SONAR_TOKEN for trusted CI runs"` —
  injects a spawn mock and asserts the environment token reaches the scanner.

**Related gates still green:** `test/repository-gates.test.ts`
(`"this repository selects build, verification, integration-suite, quality-gate,
workflow, and agent-smoke gates without codeql"`) and
`test/default-test-suite.test.ts` (integration-inventory consistency).

Round-2 regression evidence: `SONAR_TOKEN=ci-secret node --import tsx --test
test/task-2527-local-sonar.test.ts` passes (3/3) — the file-token test clears
`SONAR_TOKEN` around its `runSonar` call so it asserts the local fallback even
when a CI environment exports the token. Secrets are scoped to the guard and
scan steps (least privilege) rather than job-level `env`, so `npm run test:ci`
and `npm ci` no longer inherit `SONAR_TOKEN`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| GitHub workflow invokes shared command, consumes LCOV, waits for quality gate, writes result, fails on scan/gate failure | `.github/workflows/ci-required.yml`; `test/task-2525.03-sonar-enforcement.test.ts`, `"GitHub workflow waits for the quality gate and publishes it to the job summary"` | PASS |
| SONAR_TOKEN / non-local server URL only from environment secrets; no token committed/emitted/untrusted | `test/task-2525.03-sonar-enforcement.test.ts`, `"GitHub workflow sources SONAR_TOKEN and server URL only from environment secrets"`; `.github/workflows/ci-required.yml` `secrets.SONAR_TOKEN` / `secrets.SONAR_HOST_URL` | PASS |
| `workflow.config.json` lists identical shared command in `adapters.gates.preIntegration` → mandatory `px integrate` gate | `workflow.config.json` `quality-gate` = `npm run test:coverage -- --lcov && npm run sonar`; `test/repository-gates.test.ts`, `"this repository selects build, verification, integration-suite, quality-gate, workflow, and agent-smoke gates without codeql"` | PASS |
| Scanner preserves recorded legacy baseline, rejects new-code regressions via quality gate | `sonar-project.properties:1` `sonar.projectKey=parallix`, `sonar-project.properties:10` `sonar.qualitygate.wait=true`; `test/task-2525.03-sonar-enforcement.test.ts`, `"scanner configuration preserves the recorded legacy baseline and rejects new-code regressions"` | PASS |
| Focused test asserts both declarations share the command; static-analysis passes | `test/task-2525.03-sonar-enforcement.test.ts`, `"GitHub workflow and pre-integration gate reference the same shared command"`; `` `./scripts/verify-local.sh static-analysis` `` ALL STAGES PASSED | PASS |
| Gate `all` passes | `` `./scripts/verify-local.sh all` `` → 2669 pass, 0 fail (`test/task-2525.03-sonar-enforcement.test.ts`, `test/repository-gates.test.ts`, `test/default-test-suite.test.ts`) | PASS |

## Next action

All three checkpoints committed and both mission gates (`static-analysis`,
`all`) pass. Mission complete; no further slices. Handoff candidate once the
review remote accepts the mission branch (not performed here per harness rules).
