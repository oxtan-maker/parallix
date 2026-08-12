# CP-3: Remove telemetry completion semantics

Removed the contemporary telemetry completion field from measurement contracts, SQLite reads/writes, and the shared statistics selector. Migration `0014-remove-usage-closed.sql` copies existing non-empty values into the explicitly named `legacy_usage_completion_evidence` repair boundary before rebuilding `usage_statistics` without the column.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Contemporary telemetry exposes no completion field | `test/task-2367-regressions.test.ts`, `TASK-2367: contemporary telemetry has no completion field`; `src/application/measurement-ports.ts` | PASS |
| Statistics cannot select Mission completion from telemetry | `test/task-2367-regressions.test.ts`, `TASK-2367: statistics never select completion from telemetry`; `src/application/services/statistics-service.ts` | PASS |
| Migrated SQLite has no telemetry completion column | `test/task-2367-telemetry-schema.test.ts`, `TASK-2367: migrated telemetry has no completion column and preserves legacy repair evidence` | PASS |
| Legacy evidence remains quarantined for repair | `src/adapters/sqlite/migrations/0014-remove-usage-closed.sql`; `test/task-2367-telemetry-schema.test.ts` | PASS |

Next action: Expand integration ordering coverage for failure-before-landing and landed retry idempotency through `MissionIntegrationService`.
