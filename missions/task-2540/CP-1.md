# CP-1: Conditional GitHub Actions skips

Added node:test option-based conditional skips to exactly the three budget-marker tests. Each condition calls the existing `onGitHubActions()` helper from `test/lib/unit-test-budget-reporter.js`; no environment detection was duplicated. The unrelated plan test and the three GitHub-gating behavior tests remain unmodified.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| The TASK-2423 budget-marker test is conditionally skipped on GitHub Actions | `test/task-2423-repro.test.ts`; `"TASK-2423: headroom mode reports 501ms work while preserving the 1000ms hard cap"`; `onGitHubActions()` imported from `test/lib/unit-test-budget-reporter.js` | PASS |
| Both reporter budget-marker tests use the shared guard | `test/unit-test-budget-reporter.test.ts`; `"unit-test budget reporter marks measured synchronous work over the bound"`; `"unit-test budget reporter reports opted-in headroom without changing the hard cap"` | PASS |
| GitHub detection remains centralized | `test/lib/unit-test-budget-reporter.js`; `grep -rn "process.env.GITHUB_ACTIONS === 'true'" test/` | PASS |
| The non-marker behavior tests remain in scope to run everywhere | `test/unit-test-budget-reporter.test.ts`; `"unit-test budget reporter stays silent on GitHub Actions runners"`; `"GitHub Actions detection keys on the exact env value, not any GitHub-ish value"` | PASS |

Next action: run the focused reporter and TASK-2423 suites with `GITHUB_ACTIONS=true` and with the variable unset, then record CP-2.
