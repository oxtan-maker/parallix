# CP-2 — Transactional `mission:cancel` use case and database coverage

## Summary

- `BoardCommandKind` gained `mission:cancel` and `INTEGRATED_CAPABILITIES` now lists it
  (`src/application/controller/board-command.ts`). The request carries the mission id in the
  envelope and no payload member, so no surface can widen what is deleted.
- `MissionStore` gained an optional `cancel?(id)` member (`src/application/domain-ports.ts`) — an
  existing port, not a new interface (G6).
- `SqliteMissionStore.cancel` (`src/adapters/sqlite/mission-store.ts`) runs the fixed delete list on
  the store's serialized aggregate queue: it refuses unless `PRAGMA foreign_keys` reads 1, deletes
  `session_markers` and `board_lane_events` by `mission_id` and the `missions` row by `id` (which
  cascades the other ten lifecycle tables), then commits only when `PRAGMA foreign_key_check`
  returns no rows. Any throw rolls the whole transaction back. `usage_statistics` is named nowhere.
- `MissionCancelService` (`src/application/mission-cancel-service.ts`) is the one use case: it
  renders the advisory git cleanup and calls the port. It starts no process.
- `BoardCommandController` dispatches `mission:cancel` through that service and reports
  `completed({ slug, cleanupCommand })`; an unwired store yields a typed unavailable result
  (`src/application/controller/board-controller.ts`).
- Composition builds the service only when the store can cancel, with the cleanup string built by
  `missionCleanupCommand` in `src/composition/production-capabilities.ts` — the same
  `git worktree remove <path> && git branch -D <branch>` shape `src/adapters/cli/commands/status.ts`
  prints, falling back to the conventional worktree path when the worktree is already gone.
- Projection and wire vocabulary now carry the command: `BoardCommand` gained `cancel` and
  `availableBoardCommands` appends it last (`src/application/projections/mission-board.ts`), and
  `WebBoardCommandKind`, `WebCommandRequestKind`, `BOARD_COMMAND_KINDS`, `COMMAND_KINDS` and
  `COMMAND_REQUEST_KINDS` accept `mission:cancel` (`src/interfaces/web/transport.ts`).

Run this checkpoint's coverage with `npx tsx --test test/task-2466-mission-cancel.test.ts`
(7 passing).

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| `mission:cancel` is a `BoardCommandKind`, appears in `INTEGRATED_CAPABILITIES`, and accepts only the target mission id | `"INTEGRATED_CAPABILITIES contains active:execute and the Mission commands"` in `test/board-controller.test.ts` now asserts size 7 including `mission:cancel`; `BoardCommandPayload` in `src/application/controller/board-command.ts` still has no cancel member | Done |
| Cancelling removes rows from all 13 lifecycle tables | `"removes every lifecycle row for the cancelled mission id"` in `test/task-2466-mission-cancel.test.ts` asserts zero rows per table in `LIFECYCLE_TABLES` | Done |
| A three-mission fixture proves the two non-targets are unchanged | `"leaves the other two missions untouched in every lifecycle table"` in `test/task-2466-mission-cancel.test.ts` | Done |
| Cancellation preserves the cancelled mission's `usage_statistics` row count and summed `cost_usd` | `"preserves the cancelled mission usage_statistics rows and summed cost_usd"` in `test/task-2466-mission-cancel.test.ts` (2 rows, 2.00 USD before and after) | Done |
| The transaction verifies `PRAGMA foreign_keys = ON`, commits only on an empty `PRAGMA foreign_key_check`, and an induced mid-transaction failure leaves the database unchanged | `"refuses to delete anything when foreign keys are not enabled"`, `"leaves no foreign-key violation behind"` and `"rolls back the whole cancel when a statement fails mid-transaction"` in `test/task-2466-mission-cancel.test.ts` | Done |
| TUI and web confirmations are distinct; dismissal deletes nothing | Surface work is CP-3 | Planned in CP-3 |
| Projections drop the cancelled mission; cleanup output is advisory only and no git-mutating command runs | `"reports the operator git cleanup without running a git command"` in `test/task-2466-mission-cancel.test.ts` proves the service only renders the string; the read-only git use in `missionCleanupCommand` (`src/composition/production-capabilities.ts`) is asserted in CP-3 | Partial |
| Documentation covers both boards, preserved `usage_statistics`, operator git cleanup | Gate `./scripts/verify-local.sh docs`; documentation lands in CP-4 | Planned in CP-4 |

Next action: wire `px cancel <slug> --yes`, the TUI destructive keypress and the web confirmation panel to the shared command, then add `test/task-2466-cancel-surfaces.test.ts` covering dismissed confirmations, the read-only git use behind the cleanup string, and the cancelled mission's removal from a rebuilt board projection.
