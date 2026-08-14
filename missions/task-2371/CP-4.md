# CP-4: Lifecycle-completed Agent Performance cohorts

Agent Performance now selects each window from lifecycle completion keys and then includes all telemetry for each selected Mission. Agent Spend retains its telemetry-date filter and remains a separate resource-consumption table.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Current and previous performance use separate lifecycle-completed populations | `src/adapters/cli/commands/stats-report.ts`; test name `R5/R6: Agent Performance follows completed Missions, not telemetry dates` | PASS |
| Selected Missions retain complete relevant telemetry | `src/adapters/cli/commands/stats-report-rendering.ts`; `npm test -- test/task-2369-regressions.test.ts` | PASS |
| Agent Spend remains telemetry-date resource consumption | test name `R5/R6: Agent Performance follows completed Missions, not telemetry dates`; `src/adapters/cli/commands/stats-report-rendering.ts` | PASS |

Next action: add final aggregation and rendering regressions for unknown versus known-zero PR-fix rounds.
