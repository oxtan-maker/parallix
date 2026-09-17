# CP-3: Prove restart-safe context and checkpoint evidence

Added a real SQLite reopen test that writes a Mission carrying bounded execution context and `CheckpointData`, closes the first database connection, reopens the same database, and compares the recovered values. The checkpoint application boundary already records and reads structured Goal Check evidence with no filesystem or SQL request fields, and stale writes remain guarded by the aggregate version.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Execution context is available without document authority | `reopens bounded execution context and checkpoint evidence without repository files` in `test/sqlite-mission-store.integration.test.ts`; `src/application/mission-execution-context-service.ts`. | PASS |
| Checkpoint Goal Check evidence round-trips through application behavior | `SC3: checkpoint data round-trips through the boundary with GoalCheckRow semantics` and `SC3: the checkpoint request carries no persistence path or SQL input` in `test/task-2322-05-mission-use-cases.test.ts`. | PASS |
| SQLite holds typed state rather than raw Markdown authority | `src/adapters/sqlite/migrations/0020-mission-execution-context.sql` and ADR 0053. | PASS |
| Every new persisted field has a demonstrated consumer and meaning | `MissionExecutionContext` in `src/domain/mission-execution-context.ts`; launch and review consumer evidence in `src/adapters/mission/execute-mission-adapters.ts` and `src/adapters/review/review-static-evidence.ts`. | PASS |
| State survives database restart without repository metadata | `reopens bounded execution context and checkpoint evidence without repository files` in `test/sqlite-mission-store.integration.test.ts`. | PASS |
| Existing lifecycle invariants and stale-write protection remain | `uses exact version compare-and-swap and rejects stale transitions without appending events` in `test/sqlite-mission-store.integration.test.ts`. | PASS |

Next action: run `./scripts/verify-local.sh all`, inspect the final schema and contracts for unsupported fields or opaque Markdown authority, then record CP-4.
