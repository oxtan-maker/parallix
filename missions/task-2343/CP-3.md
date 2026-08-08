# CP-3: Lifecycle operations reach operational_history

## Summary

`operational_history` had a repository, a read adapter and a composed
`OperationalHistoryService`, but no caller ever appended a row. This checkpoint
adds the write side without adding a second current-state model and without a
second best-effort telemetry writer.

**`OperationEventRecorder`** (`src/application/recording/operation-event-recorder.ts`)
mirrors the shape of the existing `BoardEventRecorder`: a typed
`LifecycleOperationEvent`, a 1:1 mapping to `OperationalHistoryEntry`, and no
database of its own. `eventData` uses the JSON shape
`ConcreteOperationLogReadAdapter` already reads (`message`, `agent`), so no read
adapter changed. The event carries the same `MissionCommand` trigger the lane
event carries, so the two histories cannot disagree about what happened.

**One transaction per state change** (ADR 0053 transaction rule 1). The lane
event and the operation entry describe the same transition, so they are written
inside one explicit SQLite transaction in the single existing telemetry seam,
`transitionTask` (`src/adapters/backlog/backlog.ts`). A failure rolls both back
rather than leaving the board with an operation that has no lane history, or the
reverse. The operation is written only when the lane row was actually appended,
so an idempotent re-transition does not manufacture a second operation. This is
the seam `test/board-event-guardrail.test.ts` already designates as the sole
lane-event write path, so `px active`, `px review` and `px integrate` are all
covered by it without a per-command composition root.

**`px checkpoint`** records evidence without moving a lane, so it has no
`LaneTransitionEvent` to commit alongside. It appends its operation through the
same recorder and the same operator database via `recordLifecycleOperation()`,
declared next to `transitionTask` so the database-opening code stays in one
module. The command became `async` to await that write; the CLI runtime already
awaits command functions (`src/interfaces/cli/runtime.ts:178`), so no dispatch
change was needed and no injected seams were added to the command.

Operator-local telemetry never blocks the command that produced it (ADR 0051):
a database that cannot be opened is a silent no-op, and no lifecycle command
fails because its history row could not be written.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC6: lifecycle operations persist to `operational_history` and the adapter returns them | `src/application/recording/operation-event-recorder.ts:58`, `src/adapters/backlog/concrete-operation-log-read-adapter.ts:30`, test `"recorded lifecycle events reach operational_history and the operation-log adapter"` | PASS |
| SC6: the operation entry matches the stored shape the read adapter parses | `test/task-2343-lifecycle-persistence.test.ts`, test `"operationEventToEntry maps a lifecycle operation onto the operational_history shape"` | PASS |
| SC6: `px active`, `px review` and `px integrate` are covered by the single transition seam | `src/adapters/backlog/backlog.ts:719`, `src/adapters/review/review-commands.ts:395`, `test/board-event-guardrail.test.ts` | PASS |
| SC6: `px checkpoint` records its operation after the commit succeeds | `src/adapters/cli/commands/checkpoint.ts:89`, `src/adapters/backlog/backlog.ts:697`, test `"a lifecycle operation that changes no lane still records its own entry"` | PASS |
| SC6: the lane event and the operation row commit as one unit | `src/adapters/backlog/backlog.ts:795`, ADR 0053 transaction rule 1 | PASS |
| SC4: a usage-limit block persists to `agent_blocklist` and drives availability | `src/adapters/backlog/concrete-agent-read-adapter.ts:72`, test `"task-2343 repro: agent availability reflects the recorded usage-limit block"` | PASS (pre-existing) |
| SC5: lane transitions persist to `board_lane_events` and yield cycle-time values | `src/adapters/backlog/backlog.ts:719`, `src/application/projections/metrics-read-adapter.ts:82`, test `"task-2343 repro: cycle-time series is populated from recorded lane events"` | PASS (pre-existing) |
| SC7: no new SQLite table, migration or read-adapter interface | `src/application/ports/operation-history.ts:8` unchanged; no file added under the migrations directory; `npx tsc --noEmit` clean | PASS |
| Tests invoke no agent, Forgejo instance, database or external CLI process | `test/task-2343-lifecycle-persistence.test.ts` uses in-memory port doubles only | PASS |

Next action: Run `./scripts/verify-local.sh all` on the final committed tree and record the SC1–SC8 evidence table in `missions/task-2343/CP-4.md`.
