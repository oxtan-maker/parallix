# CP-7: Certify lifecycle-owned completion

The deterministic checks cover successful post-landing completion, failure before landing, retry idempotency, and telemetry records that lack a lifecycle completion. No agent, network, or external review service is involved.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Successful landed integration persists one lifecycle completion before reporting | `test/task-2367-integration-completion-repro.test.ts`, `TASK-2367: a landed approved integration persists done once before statistics` | PASS |
| Failure before landing cannot complete a Mission | `test/mission-integration-service.test.ts`, `rejects an absent observed verification fact before loading the Mission` | PASS |
| A landed retry remains idempotent | `test/task-2367-integration-completion-repro.test.ts`, `TASK-2367: a landed retry does not duplicate an already-completed Mission` | PASS |
| Telemetry alone cannot create a completed outcome | `test/task-2347.05-cycle-time-vs-runtime.test.ts`, `SC2: telemetry without lifecycle completion produces no outcome` | PASS |

Next action: Run the authorized local repair, migrate the live telemetry schema, and record the resulting statistics population.
