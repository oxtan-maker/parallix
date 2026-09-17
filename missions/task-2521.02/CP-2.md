# CP-2: Persist bounded execution context

Added `MissionExecutionContext`: goal, why, scope, constraints, refinement signals, declared gates, and dependency/predecessor references with optional bounded outcomes. Validation limits individual fields and collections; detailed artifacts remain references. SQLite migration `0020` stores scalar fields and typed item rows, while aggregate hydration/save stays on the existing Mission version compare-and-swap path. `MissionExecutionContextService` supplies application-owned read/write requests with no file or SQL input.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Execution context is available without document authority | `src/domain/mission-execution-context.ts`, `src/application/mission-execution-context-service.ts`, and `src/domain/mission.ts`. | PASS |
| Checkpoint Goal Check evidence round-trips through application behavior | `SC3: checkpoint data round-trips through the boundary with GoalCheckRow semantics` in `test/task-2322-05-mission-use-cases.test.ts`. | PASS |
| SQLite holds typed state rather than raw Markdown authority | `src/adapters/sqlite/migrations/0020-mission-execution-context.sql` and ADR 0053. | PASS |
| Every new persisted field has a demonstrated consumer and meaning | `src/adapters/mission/execute-mission-adapters.ts`, `src/adapters/review/review-static-evidence.ts`, and `src/domain/mission-execution-context.ts`. | PASS |
| State survives database restart without repository metadata | Context-specific restart coverage is the next checkpoint; existing aggregate baseline is `test/sqlite-mission-store.integration.test.ts`. | PENDING |
| Existing lifecycle invariants and stale-write protection remain | `src/adapters/sqlite/mission-store.ts` retains `MissionStaleWriteError`; `npx tsc --noEmit --allowJs --checkJs false --module nodenext --moduleResolution nodenext --target es2022 src/domain/mission-execution-context.ts src/domain/mission.ts src/application/mission-execution-context-service.ts src/adapters/sqlite/mission-serialization.ts src/adapters/sqlite/mission-store.ts` passed. | PASS |

Next action: add the context and checkpoint restart/no-file/stale-write cases against a real reopened SQLite database.
