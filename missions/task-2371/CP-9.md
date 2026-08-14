# CP-9: Contradiction sweep

Classified the relevant occurrences: date filtering remains only in telemetry/spend paths; completion-key selection is per lifecycle window; PR-fix aggregation uses nullable observations; and review approval enters integration while landing enters done. Remaining numeric `|| 0` uses are telemetry/resource numeric normalization, not PR-fix observation fallback.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Completion keys are per-window lifecycle selections | `src/adapters/cli/commands/stats-report.ts`; `src/adapters/cli/commands/stats-report-rendering.ts` | PASS |
| Performance does not use telemetry-date admission | `src/adapters/cli/commands/stats-report-rendering.ts`; test name `R5/R6: Agent Performance follows completed Missions, not telemetry dates` | PASS |
| PR-fix fallback preserves unknown | `src/adapters/cli/commands/stats-report-rendering.ts`; test name `R7/R8: PR-fix averages exclude unknown rounds and retain known zero` | PASS |
| Approval and landing own separate lifecycle transitions | `src/adapters/cli/commands/integrate-command.ts`; `src/application/mission-integration-service.ts` | PASS |

Next action: run the mission gates and record their durable results.
