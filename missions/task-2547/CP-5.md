# CP-5 — Repository gates and final Goal Check

## Summary of work done

Ran the repository verification gates on the final tree and captured evidence.
Two regressions introduced by the CP-2/CP-3 refactor were found and fixed during
this run:

- `test/default-test-suite.test.ts` still read only
  `run-default-tests.ts` + `test-run-plan.ts` for the `.integration.test.ts`
  suffix assertion, but the suffix check now lives in
  `test/lib/test-tier-selection.ts`; added that file to the read so the moved
  group classification stays pinned.
- `test/sonarqube-cloud-wiring.test.ts` asserted the GitHub workflow contained
  the old combined `npm run test:coverage -- --threshold 0 --lcov && npm run
  sonar` string; the hosted path now unions per-tier LCOV with
  `npm run coverage:merge` and then reaches `npm run sonar`. Updated the test to
  pin the shared `npm run sonar` entrypoint plus the `coverage:merge` step while
  keeping the local pre-integration `quality-gate` gate on its combined command.
- Removed an unused `E2E_TEST_FILES` constant from
  `src/adapters/verification/coverage-gate.ts` that the
  `selectTierFiles()` refactor orphaned (ESLint `no-unused-vars`).

Gate evidence (final tree):

```
$ npm test
ℹ tests 2885  pass 2885  fail 0
[unit-test-budget] suite budget=180000ms, elapsed=41722ms

$ npm run test:integration:ci
ℹ tests 2309  pass 2283  fail 0  skipped 26

$ node --experimental-test-module-mocks --import tsx --test test/task-2547-repro.test.ts
✔ hosted coverage selection ⊆ unit ∪ integration-ci and ∩ integration-local = ∅

$ ./scripts/verify-local.sh static-analysis
PASS: ESLint clean / tsc typecheck clean / test-hygiene clean / test typecheck clean
```

`npm test`, `npm run test:integration:ci`, and `./scripts/verify-local.sh
static-analysis` exit zero with no `.only` or bare `.skip` introduced.

Round 1 review (findings F1/F2) resolved this round: F1 added a committed
`mergeLcov` regression test (`test/coverage-gate.test.ts`, 3 new cases covering
multi-fragment union, no `DA:` duplication, recomputed LF/LH, distinct `SF:`
files, and empty input) — SC4's merged-LCOV behavior is now asserted by a
committed regression test of the production function under test, not by
checkpoint prose. F2: SC5's static wiring evidence passes (`ci-required.yml`
reaches `npm run sonar` with `SONAR_TOKEN` from secrets and the mandatory
`new_violations > 0` quality gate); the required live `github-publish/<sha>`
Sonar quality-gate log is an external blocker and is recorded rather than
claimed (Stop Rules), because mission branches may not be pushed to the `origin`
GitHub remote (only `main` may), the review remote is the local Forgejo, and
this standalone review loop has no GitHub-hosted Actions run with the trusted
token reaching SonarQube Cloud.

`npm run test:integration:local`, `npm run test:agent-e2e`, and
`npm run test:lifecycle-e2e` are workstation / real-agent-gated by design
(ADR 0057): the local lane keeps `integration-local` files that need
`bwrap` / `graphify` / the SEA toolchain, and the agent and lifecycle suites
need a configured agent runner and model backend. They are not part of the
GitHub-hosted gate this mission touches and require a workstation to execute.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 — red-to-green selector test | `test/task-2547-repro.test.ts` (red at `0b233992f`, green at final tree) | PASS |
| SC2 — selection from planner authority | `test/lib/test-tier-selection.ts` + `coverageTestFiles()` in `src/adapters/verification/coverage-gate.ts` | PASS |
| SC3 — each unit / integration-ci test runs at most once | `test/run-default-tests.ts` `PARALLIX_TEST_COVERAGE`; `test:integration:ci` 2283 pass, no local/agent/lifecycle selected | PASS |
| SC4 — one merged Sonar-consumable `coverage/lcov.info` | `scripts/coverage-merge.ts` + `mergeLcov()`; `test/coverage-gate.test.ts` `mergeLcov` regression test | PASS |
| SC5 — hosted path reaches `npm run sonar` with trusted token + quality gate | `.github/workflows/ci-required.yml`; `test/sonarqube-cloud-wiring.test.ts` | PASS (static) / DEFERRED (live) |
| SC6 — tier commands retain populations | `test/lib/test-run-plan.ts`; `test:test-categories.test.ts` 7 pass | PASS |
| SC7 — no duplicate `--lcov` expansion | `package.json` `test:coverage`, `.github/workflows/ci-required.yml` | PASS |
| SC8 — `npm test` / `test:integration:ci` / static-analysis exit zero | gate evidence above | PASS |

## Next action:
Run the workstation-gated gates (`npm run test:integration:local`,
`npm run test:agent-e2e`, `npm run test:lifecycle-e2e`) on a machine with the
required agent runner and workstation tooling, then run
`./scripts/verify-local.sh all` as the final pre-merge gate and capture its
aggregate result as mission-closing evidence. To close SC5's live-proof row,
publish a real `github-publish/<sha>` branch to the `origin` GitHub remote
(only `main` and published-sha refs may go there, never the mission branch) and
capture the `ci-required` Sonar quality-gate log; until then SC5 stays
PASS (static) / DEFERRED (live).
