# CP-8: Repair confirmed historical completions

The one-off repair accepts only `task-2322.07` and `task-2329`: each has an archived `legacy_usage_completion_evidence` record and its recorded landing commit is an ancestor of `main`. It leaves `task-2324` and `task-2002` as explicit ambiguous/skipped IDs. A second run makes no lifecycle change. The repair does not alter ambiguous review-fix or repository-alias data.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Repair records only corroborated historical completions | `scripts/repair-task-2367.ts`; `test/task-2367-repair.test.ts`, `TASK-2367: repair closes only the two approved historical missions before removing telemetry closed` | PASS |
| Repair is idempotent and leaves excluded records unchanged | `scripts/repair-task-2367.ts`; `test/task-2367-repair.test.ts`, `TASK-2367: repair closes only the two approved historical missions before removing telemetry closed` | PASS |
| Current telemetry schema has no completion column | `src/adapters/sqlite/migrations/0014-remove-usage-closed.sql`; `test/task-2367-telemetry-schema.test.ts`, `TASK-2367: migrated telemetry has no completion column and preserves legacy repair evidence` | PASS |
| Repair reports lifecycle and skipped-ID counts without guessing at ambiguous data | `scripts/repair-task-2367.ts`; `test/task-2367-repair.test.ts`, `TASK-2367: repair closes only the two approved historical missions before removing telemetry closed` | PASS — skipped: `task-2002`, `task-2324` |
| Local statistics read the repaired lifecycle population | `npm run dev -- stats` | PASS — previous window: 2 completed Missions; current window: 0 |

Next action: Complete the contradiction sweep and final repository verification.
