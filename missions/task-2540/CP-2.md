# CP-2: Verify conditional execution

Verified both execution environments for the two focused test files. With `GITHUB_ACTIONS` unset, all three marker assertions pass. With `GITHUB_ACTIONS=true`, those three tests report as skipped while the GitHub-behavior tests, suite-source test, and the unrelated TASK-2423 plan test continue to pass. The source checks also confirm one exact GitHub detection definition and no focused or bare skipped tests.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Marker assertions pass outside GitHub Actions | `env -u GITHUB_ACTIONS node --import tsx test/unit-test-budget-reporter.test.ts`; `env -u GITHUB_ACTIONS node --import tsx test/task-2423-repro.test.ts`; `"unit-test budget reporter marks measured synchronous work over the bound"`; `"TASK-2423: headroom mode reports 501ms work while preserving the 1000ms hard cap"` | PASS |
| Marker assertions skip on GitHub Actions | `GITHUB_ACTIONS=true node --import tsx test/unit-test-budget-reporter.test.ts`; `GITHUB_ACTIONS=true node --import tsx test/task-2423-repro.test.ts`; `"unit-test budget reporter reports opted-in headroom without changing the hard cap"` | PASS |
| GitHub-behavior and suite-source tests still run in both modes | `test/unit-test-budget-reporter.test.ts`; `"unit-test budget reporter stays silent on GitHub Actions runners"`; `"GitHub Actions detection keys on the exact env value, not any GitHub-ish value"`; `"the suite-level budget check is gated on the shared GitHub Actions detection"` | PASS |
| No duplicate detection or forbidden focused/bare skip calls exist | `grep -rn "process.env.GITHUB_ACTIONS === 'true'" test/`; `rg -n "\\.only\\(|\\.skip\\(" test/task-2423-repro.test.ts test/unit-test-budget-reporter.test.ts` | PASS |

Next action: run the mission verification gate `./scripts/verify-local.sh all` against the committed implementation and capture its result in CP-3.
