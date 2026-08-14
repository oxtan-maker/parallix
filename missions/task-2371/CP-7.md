# CP-7: Performance and spend report contract

The report labels now explicitly distinguish performance of Missions completed in a window from spend incurred in a window. The corresponding aggregations retain their separate lifecycle-completion and telemetry-date inputs.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Performance label names completed-Mission semantics | `src/adapters/cli/commands/stats-report.ts` | PASS |
| Spend label names telemetry-date consumption semantics | `src/adapters/cli/commands/stats-report.ts` | PASS |
| Late spend can remain current while performance stays previous | test name `R5/R6: Agent Performance follows completed Missions, not telemetry dates`; `npm test -- test/task-2369-regressions.test.ts` | PASS |

Next action: run the certification-style regression set and complete the contradiction sweep before final gates.
