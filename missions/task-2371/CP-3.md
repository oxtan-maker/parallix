# CP-3: Red opposing-date performance regression

Added an adversarial production aggregation regression: Mission A completes in Aug 6–12 but has Aug 4/5 telemetry, while Mission B completes in the prior window but has Aug 8 closeout telemetry. The old telemetry-first performance filter excludes A; spend remains independently telemetry-date-windowed.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Current performance includes A by lifecycle completion despite older telemetry | test name `R5/R6: Agent Performance follows completed Missions, not telemetry dates`; `npm test -- test/task-2369-regressions.test.ts` | RED |
| Previous performance keeps B despite current-week closeout telemetry | `test/task-2369-regressions.test.ts` | RED |
| Agent Spend retains telemetry-date semantics | test name `R5/R6: Agent Performance follows completed Missions, not telemetry dates` | PASS |

Next action: select per-window lifecycle completion keys in report rendering and join all telemetry for those Missions.
