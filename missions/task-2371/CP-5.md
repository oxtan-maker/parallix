# CP-5: Red PR-fix observation regressions

Added final aggregation assertions for `[0, 2, unknown, unknown]` and all-unknown observations. The pre-change report divides by all completed Missions and renders `0.50`; it does not expose an observation count or an unavailable value.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Known zero and known positive values are observations | test name `R7/R8: PR-fix averages exclude unknown rounds and retain known zero`; `test/task-2369-regressions.test.ts` | RED |
| Unknown values are excluded from average denominator | `npm test -- test/task-2369-regressions.test.ts` | RED |
| No observations render unavailable and report zero observation count | `test/task-2369-regressions.test.ts` | RED |

Next action: retain nullable PR-fix values through aggregation, expose `PR fix n`, and render no observations as unavailable.
