# CP-4: Close lifecycle only after landing

The integration closeout now calls `MissionIntegrationService.decideIntegration` only after the squash commit is established, before telemetry/reporting. The closeout uses the landed commit in a stable idempotency key and returns immediately for a previously completed Mission.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Successful landed integration moves `integration` to `done` once | `test/task-2367-integration-completion-repro.test.ts`, `TASK-2367: a landed approved integration persists done once before statistics` | PASS |
| Failure before landing cannot complete a Mission | `test/mission-integration-service.test.ts`, `rejects an absent observed verification fact before loading the Mission` | PASS |
| Landed retry does not duplicate lifecycle completion | `test/task-2367-integration-completion-repro.test.ts`, `TASK-2367: a landed retry does not duplicate an already-completed Mission` | PASS |
| Atomic transition uses the existing service and transition store | `src/application/mission-integration-service.ts`; `test/mission-integration-service.test.ts`, `accepts explicit fresh merge and verification facts before integration persistence` | PASS |

Next action: Make standalone reporting consume the same lifecycle completion population as BoardMetrics without telemetry completion filtering.
