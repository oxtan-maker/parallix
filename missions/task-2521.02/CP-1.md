# CP-1: Map bounded Mission context consumers

Mapped the live execution path before adding state. `AgentExecutionAdapter.prepare()` still obtains its launch prompt through the legacy `buildCheckpointContext()` and `buildExecutePrompt()` runtime seam; the context consumers require the mission goal, why/context, scope, constraints, refinement signals, declared gates, and dependency/predecessor outcomes. Handoff/review requires named checkpoint Goal Check rows and a next action. The existing `MissionCheckpointService` and relational checkpoint tables already provide direct application-owned checkpoint recording with the Mission version compare-and-swap.

The usable TASK-2521.01 prerequisite is present: `Mission`, `CheckpointData`, and `GoalCheckRow` are guarded as domain authority, and SQLite is the established aggregate persistence path. The large-evidence boundary is ADR 0053: only bounded strings and reference-valued evidence belong in the aggregate; logs, captures, patches, and transcripts remain external artifacts.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Execution context is available without document authority | `src/adapters/mission/execute-mission-adapters.ts`, `src/adapters/cli/commands/active.ts`, and ADR 0053 identify the current file-backed launch seam and the bounded facts to move in CP-2. | MAPPED |
| Checkpoint Goal Check evidence round-trips through application behavior | `MissionCheckpointService` test `SC3: checkpoint data round-trips through the boundary with GoalCheckRow semantics` in `test/task-2322-05-mission-use-cases.test.ts`; `src/application/mission-checkpoint-service.ts`. | PASS |
| SQLite holds typed state rather than raw Markdown authority | `src/adapters/sqlite/migrations/0004-mission-aggregate.sql`, `test/sqlite-mission-store.integration.test.ts`, and ADR 0053. | PASS |
| Every new persisted field has a demonstrated consumer and meaning | Consumer map: `src/adapters/mission/execute-mission-adapters.ts` (launch) and `src/adapters/review/review-static-evidence.ts` (review); CP-2 will encode only the enumerated context fields. | MAPPED |
| State survives database restart without repository metadata | Existing aggregate round trip test `round trips every checked Mission, CheckpointData, and Review value through real rows` in `test/sqlite-mission-store.integration.test.ts`; context-specific restart coverage is CP-3. | PARTIAL |
| Existing lifecycle invariants and stale-write protection remain | `MissionStaleWriteError` in `src/adapters/sqlite/mission-store.ts` and `uses exact version compare-and-swap and rejects stale transitions without appending events` in `test/sqlite-mission-store.integration.test.ts`. | PASS |

Next action: add the bounded `MissionExecutionContext` contract and a forward SQLite migration, then thread it through Mission aggregate hydration and compare-and-swap saves.
