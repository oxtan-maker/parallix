# CP-6: PR-fix observation semantics

Aggregation now preserves `reviewFixRounds` tri-state semantics: valid non-negative values, including zero, are observations; absent or invalid values are excluded. Reports show `PR fix n` and render no known observations as `unavailable`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| `[0, 2, unknown, unknown]` reports n=2 and average 1.00 | test name `R7/R8: PR-fix averages exclude unknown rounds and retain known zero`; `npm test -- test/task-2369-regressions.test.ts` | PASS |
| Known zero remains an observation | test name `R5: the live review-fix writers keep known zero and unknown apart` | PASS |
| No known observations report unavailable | test name `R7/R8: PR-fix averages exclude unknown rounds and retain known zero`; `src/adapters/cli/commands/stats-report.ts` | PASS |

Next action: verify report labels and the full deterministic certification fixture through the CLI/application statistics path.
