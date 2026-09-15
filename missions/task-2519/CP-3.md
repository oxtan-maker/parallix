# CP-3: Gate run and final verification

## Summary
Ran the mission-declared gates on the final tree.

- `npm test -- --unit-test-headroom` — 2621 pass, 0 fail (elapsed 58234 ms, suite budget 180000 ms).
- `./scripts/verify-local.sh static-analysis` — ESLint, `npm run typecheck`, test-hygiene, and test typecheck all report clean ("ALL STAGES PASSED").
- `./scripts/verify-local.sh all` — exit 0, 2621 pass, 0 fail.
- `./scripts/verify-local.sh integrate` — the resolved plan is CodeQL-free. `INTEGRATE_DRY_RUN=true ./scripts/verify-local.sh integrate` prints exactly:
  ```
  build: npm run build
  integration-suite: npm run test:integration
  workflow: node --import tsx test/e2e-mission-lifecycle.test.ts
  custom-agent-smoke: node --import tsx test/e2e-real-agent-smoke.test.ts
  ```
  No gate command is `npm run test:codeql`. In the full (non-dry) run the only CodeQL text in the log comes from the test `"clean cache directory bootstraps the CodeQL gate on --dry-run"` in `test/task-2502-codeql-clean-cache.test.ts`, which skipped ("no codeql on PATH"); the `npm run test:codeql` gate never executed.

### Known environment failure (pre-existing, not caused by this mission)
The `integration-suite` gate of `./scripts/verify-local.sh integrate` fails on one test:
`"Graphify excludes configured mission documents before extraction while retaining source relationships"` in `test/task-2270-graphify-exclusion.test.ts`, with
`× No solution found when resolving --with dependencies` / `Read-only file system (os error 30) at path "/home/magnus/.cache/uv/..."`.
This is a `uv` cache/network limitation of this workstation, not a code defect: the same test fails identically on the untouched mission baseline commit `8f1fc1eaab1ddaf422c97ab53d5adfae0698aaa8` checked out in a separate worktree. The rest of that suite is green (2165 tests, 2138 pass, 1 fail, 26 skipped), and the remaining integrate gates were run individually and pass:
- `npm run build` — exit 0
- `node --import tsx test/e2e-mission-lifecycle.test.ts` — 9 pass, 0 fail
- `node --import tsx test/e2e-real-agent-smoke.test.ts` — 1 pass, 0 fail, 2 skipped

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| `workflow.config.json` `preIntegration` has no `codeql` key or `npm run test:codeql` command and retains exactly `build`, `verification`, `integration-suite`, `workflow`, `agent-smoke` | `test/repository-gates.test.ts`, test `"this repository selects build, verification, integration-suite, workflow, and agent-smoke gates without codeql"` (23 pass, 0 fail) | PASS |
| `config/integration-pipelines.json` has no `codeql` gate and retains `build`, `integration-suite`, `workflow`, `custom-agent-smoke` with existing commands and ordering | `test/integration-pipelines.test.ts`, tests `"repo config declares build gate with correct metadata (task-1419)"`, `"repo config preserves remaining gate orders (task-1419)"`, `"repo integration config keeps workflow gate on the targeted mission-lifecycle suite"` (48 pass, 0 fail, 10 skipped) | PASS |
| `package.json` still defines `test:codeql` as `bash scripts/codeql-sast.sh` | `package.json`; `scripts/codeql-sast.sh` untouched; `test/task-2502-codeql-suite-flag.test.ts` and `test/task-2502-codeql-regression.test.ts` still green in the unit run | PASS |
| Focused coverage asserts the loaded `preIntegration` plan excludes codeql | `test/repository-gates.test.ts`, test `"this repository selects build, verification, integration-suite, workflow, and agent-smoke gates without codeql"` | PASS |
| `./scripts/verify-local.sh integrate` completes without executing `npm run test:codeql` | `INTEGRATE_DRY_RUN=true ./scripts/verify-local.sh integrate` plan output lists 4 gates, none CodeQL; full run log contains no `npm run test:codeql` invocation | PASS |
| `./scripts/verify-local.sh static-analysis` exits zero | `./scripts/verify-local.sh static-analysis` — "=== Static Analysis Gate: ALL STAGES PASSED ===" | PASS |
| `./scripts/verify-local.sh all` exits zero | `./scripts/verify-local.sh all` — exit 0, 2621 pass, 0 fail | PASS |
| `npm test -- --unit-test-headroom` passes | `npm test -- --unit-test-headroom` — 2621 pass, 0 fail | PASS |
| Remaining integrate gates pass individually despite the environment failure | `npm run build` (exit 0), `node --import tsx test/e2e-mission-lifecycle.test.ts` (9 pass), `node --import tsx test/e2e-real-agent-smoke.test.ts` (1 pass, 2 skipped) | PASS |
| Docs reflect the workflow change | `README.md` marks `npm run test:codeql` as manual, not part of local integration | PASS |
| `./scripts/verify-local.sh integrate` full run | `test/task-2270-graphify-exclusion.test.ts` fails identically on baseline commit `8f1fc1eaab1ddaf422c97ab53d5adfae0698aaa8` (uv read-only cache / offline dependency resolution) | ENVIRONMENT-BLOCKED (pre-existing) |

Next action: hand off for review; if the reviewer needs a fully green `./scripts/verify-local.sh integrate`, rerun it on a workstation with a writable `~/.cache/uv` and network access so `test/task-2270-graphify-exclusion.test.ts` can resolve its `uv --with` dependencies.
